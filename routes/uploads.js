/**
 * Protected upload serving route — S3 presigned URL version.
 * Replaces local file serving with S3 presigned URL redirects.
 * Supports JWT via Authorization header or ?token= query parameter (for <img src>).
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const s3 = require('../services/s3');
const { verifyToken } = require('../middleware/auth');

const VALID_TYPES = ['finds', 'sites', 'permissions', 'feedback', 'letters', 'signatures', 'signed-letters'];

// ---------------------------------------------------------------------------
// Auth — accept token from header OR query param (?token=JWT)
// Browser <img src=""> and <a href=""> can't send Authorization headers,
// so the frontend appends ?token=JWT to upload URLs.
// ---------------------------------------------------------------------------
function verifyTokenFromHeaderOrQuery(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return verifyToken(req, res, next);
    }
    const queryToken = req.query.token;
    if (queryToken) {
        req.headers.authorization = 'Bearer ' + queryToken;
        return verifyToken(req, res, next);
    }
    return res.status(401).json({ success: false, error: 'No token provided' });
}

router.use(verifyTokenFromHeaderOrQuery);

// ---------------------------------------------------------------------------
// GET /api/uploads/:type/:filename — Serve a protected upload via S3 presigned URL
// For S3 keys, the "filename" is actually the full key or just the file portion.
// We also support legacy S3 key format: type/uuid-filename.ext
// ---------------------------------------------------------------------------
router.get('/:type/:filename', async function (req, res) {
    try {
        const type = req.params.type;
        const filename = req.params.filename;

        // Validate type
        if (VALID_TYPES.indexOf(type) === -1) {
            return res.status(400).json({ success: false, error: 'Invalid upload type' });
        }

        // Construct the S3 key — files are stored as type/filename in S3
        const s3Key = type + '/' + filename;

        // Authorization checks per type
        if (type === 'feedback') {
            // Only admins can view feedback screenshots
            if (req.user.role !== 'admin') {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
        } else if (type === 'finds') {
            // Check find_photos table first (multi-photo), then legacy finds.photo_path
            const findPhotoRow = await db.queryOne(
                'SELECT f.user_id, f.site_id FROM find_photos fp JOIN finds f ON fp.find_id = f.id WHERE fp.photo_path = $1 OR fp.photo_path LIKE $2',
                [s3Key, '%' + filename]
            );
            const find = findPhotoRow || await db.queryOne(
                'SELECT user_id, site_id FROM finds WHERE photo_path = $1 OR photo_path LIKE $2',
                [s3Key, '%' + filename]
            );
            if (!find) {
                return res.status(404).json({ success: false, error: 'File not found' });
            }
            if (req.user.role !== 'admin' && find.user_id !== req.user.id) {
                const findShare = await db.queryOne(
                    'SELECT 1 FROM site_shares WHERE site_id = $1 AND shared_with_id = $2',
                    [find.site_id, req.user.id]
                );
                if (!findShare) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }
            }
        } else if (type === 'sites') {
            const site = await db.queryOne(
                'SELECT user_id, id FROM sites WHERE image_path = $1 OR image_path LIKE $2',
                [s3Key, '%' + filename]
            );
            if (!site) {
                return res.status(404).json({ success: false, error: 'File not found' });
            }
            if (req.user.role !== 'admin' && site.user_id !== req.user.id) {
                const siteShare = await db.queryOne(
                    'SELECT 1 FROM site_shares WHERE site_id = $1 AND shared_with_id = $2',
                    [site.id, req.user.id]
                );
                if (!siteShare) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }
            }
        } else if (type === 'letters') {
            // Check generated_letters table for ownership
            const letter = await db.queryOne(
                'SELECT user_id FROM generated_letters WHERE s3_path = $1 OR s3_path LIKE $2',
                [s3Key, '%' + filename]
            );
            if (!letter) {
                return res.status(404).json({ success: false, error: 'File not found' });
            }
            if (req.user.role !== 'admin' && letter.user_id !== req.user.id) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
        } else if (type === 'signatures' || type === 'signed-letters') {
            // Check permission_links table for ownership
            const linkKey = type === 'signatures' ? 'signature_image_path' : 'signed_pdf_path';
            const linkRow = await db.queryOne(
                'SELECT pl.id, p.user_id FROM permission_links pl JOIN permissions p ON pl.permission_id = p.id WHERE pl.' + linkKey + ' = $1 OR pl.' + linkKey + ' LIKE $2',
                [s3Key, '%' + filename]
            );
            if (!linkRow) {
                return res.status(404).json({ success: false, error: 'File not found' });
            }
            if (req.user.role !== 'admin' && linkRow.user_id !== req.user.id) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
        } else if (type === 'permissions') {
            const perm = await db.queryOne(
                'SELECT user_id, site_id FROM permissions WHERE document_path = $1 OR document_path LIKE $2',
                [s3Key, '%' + filename]
            );
            if (!perm) {
                return res.status(404).json({ success: false, error: 'File not found' });
            }
            if (req.user.role !== 'admin' && perm.user_id !== req.user.id) {
                if (perm.site_id) {
                    const permShare = await db.queryOne(
                        'SELECT 1 FROM site_shares WHERE site_id = $1 AND shared_with_id = $2',
                        [perm.site_id, req.user.id]
                    );
                    if (!permShare) {
                        return res.status(403).json({ success: false, error: 'Access denied' });
                    }
                } else {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }
            }
        }

        // Generate a presigned URL and redirect to it
        const presignedUrl = await s3.getPresignedUrl(s3Key, 900); // 15 minutes
        res.redirect(presignedUrl);
    } catch (err) {
        console.error('Upload serve error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to serve file' });
    }
});

module.exports = router;
