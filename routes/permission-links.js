/**
 * Public permission link routes — no auth required.
 * Token-based access for landowner approval/denial of permission requests.
 * Mounted at /api/p
 */
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../database');
const s3 = require('../services/s3');
const { validate, schemas } = require('../middleware/validate');

// ---------------------------------------------------------------------------
// Rate limiting — stricter for public endpoints
// ---------------------------------------------------------------------------
const isTest = function () {
    return process.env.NODE_ENV === 'test' || !!process.env.TEST_DB_PATH;
};

const publicLinkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please try again later.' },
    skip: isTest,
});

router.use(publicLinkLimiter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load a permission link by token. Returns null if not found.
 */
async function loadLink(token) {
    return db.queryOne('SELECT * FROM permission_links WHERE token = $1', [token]);
}

/**
 * Check if a link is actionable (active and not expired).
 * Returns { ok: true } or { ok: false, status, error }.
 */
function checkLinkActionable(link) {
    if (!link) {
        return { ok: false, status: 404, error: 'Permission link not found' };
    }
    if (link.status !== 'active') {
        return { ok: false, status: 410, error: 'This permission link has already been ' + link.status };
    }
    if (new Date(link.expires_at) < new Date()) {
        return { ok: false, status: 410, error: 'This permission link has expired' };
    }
    return { ok: true };
}

// ---------------------------------------------------------------------------
// GET /api/p/:token — load permission details for public display
// ---------------------------------------------------------------------------
router.get('/:token', async function (req, res) {
    try {
        const link = await loadLink(req.params.token);
        const check = checkLinkActionable(link);
        if (!check.ok) {
            return res.status(check.status).json({ success: false, error: check.error });
        }

        // Fetch permission + site details
        const perm = await db.queryOne(
            `SELECT p.*, s.name AS site_name, s.description AS site_description,
                    s.latitude AS site_latitude, s.longitude AS site_longitude
             FROM permissions p
             LEFT JOIN sites s ON p.site_id = s.id
             WHERE p.id = $1`,
            [link.permission_id]
        );

        if (!perm) {
            return res.status(404).json({ success: false, error: 'Permission not found' });
        }

        // Get the requester's display name (no sensitive PII)
        const user = await db.queryOne('SELECT display_name FROM users WHERE id = $1', [perm.user_id]);

        res.json({
            success: true,
            data: {
                link_id: link.id,
                token: link.token,
                status: link.status,
                expires_at: link.expires_at,
                conditions_text: link.conditions_text,
                permission: {
                    id: perm.id,
                    land_type: perm.land_type,
                    agency_or_owner: perm.agency_or_owner,
                    status: perm.status,
                    site_name: perm.site_name,
                    site_description: perm.site_description,
                    site_latitude: perm.site_latitude,
                    site_longitude: perm.site_longitude,
                    notes: perm.notes,
                },
                requester_name: user ? user.display_name : 'Unknown',
            },
        });
    } catch (err) {
        console.error('Public link GET error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to load permission details' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/p/:token/approve — landowner approves the permission request
// ---------------------------------------------------------------------------
router.post('/:token/approve', validate(schemas.approvePermissionLink), async function (req, res) {
    try {
        const link = await loadLink(req.params.token);
        const check = checkLinkActionable(link);
        if (!check.ok) {
            return res.status(check.status).json({ success: false, error: check.error });
        }

        const { signed_name, signature_image, conditions_text } = req.body;

        // Handle optional signature image upload to S3
        let signatureImagePath = null;
        if (signature_image && signature_image.startsWith('data:image/')) {
            try {
                // Extract base64 data from data URI
                const matches = signature_image.match(/^data:image\/(\w+);base64,(.+)$/);
                if (matches) {
                    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
                    const buffer = Buffer.from(matches[2], 'base64');
                    const s3Key = 'signatures/' + link.permission_id + '/' + link.token + '.' + ext;
                    await s3.uploadToS3(buffer, s3Key, 'image/' + matches[1]);
                    signatureImagePath = s3Key;
                }
            } catch (sigErr) {
                console.error('Signature upload error:', sigErr.message);
                // Continue without signature image — typed name is the important part
            }
        }

        // Update the link
        await db.query(
            `UPDATE permission_links SET
                status = 'approved',
                approved_at = NOW(),
                signed_name = $1,
                signature_image_path = $2,
                conditions_text = $3
             WHERE id = $4`,
            [signed_name, signatureImagePath, conditions_text || link.conditions_text, link.id]
        );

        // Update the parent permission status to approved
        await db.query(
            "UPDATE permissions SET status = 'approved', date_granted = $1, updated_at = NOW() WHERE id = $2",
            [new Date().toISOString().split('T')[0], link.permission_id]
        );

        // Fetch permission owner for audit log
        const perm = await db.queryOne('SELECT user_id FROM permissions WHERE id = $1', [link.permission_id]);

        // Generate signed PDF if pdf service is available
        let signedPdfPath = null;
        try {
            const pdfService = require('../services/pdf');
            if (pdfService.generateSignedPermissionPDF) {
                const fullPerm = await db.queryOne(
                    `SELECT p.*, s.name AS site_name, s.description AS site_description,
                            s.latitude AS site_latitude, s.longitude AS site_longitude
                     FROM permissions p
                     LEFT JOIN sites s ON p.site_id = s.id
                     WHERE p.id = $1`,
                    [link.permission_id]
                );
                const letterPrefs = await db.queryOne('SELECT * FROM letter_preferences WHERE user_id = $1', [perm.user_id]);
                const updatedLink = await db.queryOne('SELECT * FROM permission_links WHERE id = $1', [link.id]);
                const pdfBuffer = await pdfService.generateSignedPermissionPDF(updatedLink, fullPerm, letterPrefs);
                const pdfKey = 'signed-letters/' + link.permission_id + '/' + link.token + '.pdf';
                await s3.uploadToS3(pdfBuffer, pdfKey, 'application/pdf');
                signedPdfPath = pdfKey;
                await db.query('UPDATE permission_links SET signed_pdf_path = $1 WHERE id = $2', [pdfKey, link.id]);
            }
        } catch (pdfErr) {
            console.error('Signed PDF generation error:', pdfErr.message);
            // Non-fatal — approval still succeeds
        }

        if (perm) {
            db.logAuditEvent({
                userId: perm.user_id,
                action: 'permission.link_approved',
                entityType: 'permission',
                entityId: link.permission_id,
                details: { link_id: link.id, signed_name: signed_name },
                ipAddress: req.ip,
            });
        }

        res.json({
            success: true,
            data: {
                status: 'approved',
                signed_name: signed_name,
                approved_at: new Date().toISOString(),
                signed_pdf_path: signedPdfPath,
            },
        });
    } catch (err) {
        console.error('Public link APPROVE error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to process approval' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/p/:token/deny — landowner denies the permission request
// ---------------------------------------------------------------------------
router.post('/:token/deny', validate(schemas.denyPermissionLink), async function (req, res) {
    try {
        const link = await loadLink(req.params.token);
        const check = checkLinkActionable(link);
        if (!check.ok) {
            return res.status(check.status).json({ success: false, error: check.error });
        }

        // Update the link
        await db.query(
            "UPDATE permission_links SET status = 'denied', denied_at = NOW() WHERE id = $1",
            [link.id]
        );

        // Update the parent permission status to denied
        await db.query(
            "UPDATE permissions SET status = 'denied', updated_at = NOW() WHERE id = $1",
            [link.permission_id]
        );

        // Fetch permission owner for audit log
        const perm = await db.queryOne('SELECT user_id FROM permissions WHERE id = $1', [link.permission_id]);

        if (perm) {
            db.logAuditEvent({
                userId: perm.user_id,
                action: 'permission.link_denied',
                entityType: 'permission',
                entityId: link.permission_id,
                details: { link_id: link.id, reason: req.body.reason || null },
                ipAddress: req.ip,
            });
        }

        res.json({
            success: true,
            data: {
                status: 'denied',
                denied_at: new Date().toISOString(),
            },
        });
    } catch (err) {
        console.error('Public link DENY error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to process denial' });
    }
});

module.exports = router;
