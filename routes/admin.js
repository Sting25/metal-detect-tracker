/**
 * Admin routes: user management, invite codes, system stats
 * All routes require authentication + admin role.
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const emailService = require('../services/email');
const { validate, schemas } = require('../middleware/validate');

router.use(verifyToken);
router.use(requireAdmin);

// -------------------------------------------------------------------------
// GET /api/admin/stats — Overview statistics
// -------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
    try {
        const totalUsers = (await db.queryOne('SELECT COUNT(*)::int AS cnt FROM users')).cnt;
        const totalSites = (await db.queryOne('SELECT COUNT(*)::int AS cnt FROM sites')).cnt;
        const totalFinds = (await db.queryOne('SELECT COUNT(*)::int AS cnt FROM finds')).cnt;
        const activeInvites = (await db.queryOne(
            "SELECT COUNT(*)::int AS cnt FROM invite_codes WHERE used_by IS NULL AND (expires_at IS NULL OR expires_at > NOW())"
        )).cnt;
        const pendingRequests = (await db.queryOne(
            "SELECT COUNT(*)::int AS cnt FROM invite_requests WHERE status = 'pending'"
        )).cnt;
        const activeUsers = (await db.queryOne(
            "SELECT COUNT(*)::int AS cnt FROM users WHERE last_active > NOW() - INTERVAL '24 hours'"
        )).cnt;

        res.json({
            success: true,
            data: { totalUsers, totalSites, totalFinds, activeInvites, pendingRequests, activeUsers },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// GET /api/admin/users — List all users with stats
// -------------------------------------------------------------------------
router.get('/users', async (req, res) => {
    try {
        const usersWithStats = (await db.query(
            `SELECT u.id, u.email, u.display_name, u.role, u.is_disabled, u.created_at,
                    COUNT(DISTINCT s.id)::int AS sites_count,
                    COUNT(DISTINCT f.id)::int AS finds_count
             FROM users u
             LEFT JOIN sites s ON s.user_id = u.id
             LEFT JOIN finds f ON f.user_id = u.id
             GROUP BY u.id, u.email, u.display_name, u.role, u.is_disabled, u.created_at
             ORDER BY u.created_at DESC`
        )).rows;

        res.json({ success: true, data: usersWithStats });
    } catch (err) {
        console.error('Failed to list users:', err);
        res.status(500).json({ success: false, error: 'Failed to load users' });
    }
});

// -------------------------------------------------------------------------
// PUT /api/admin/users/:id/role — Change user role
// -------------------------------------------------------------------------
router.put('/users/:id/role', async (req, res) => {
    try {
        const { role } = req.body;
        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({ success: false, error: 'Invalid role' });
        }
        const user = await db.queryOne('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        const oldRole = user.role;
        await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
        const updated = await db.queryOne(
            'SELECT id, email, display_name, role FROM users WHERE id = $1', [req.params.id]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'admin.user_role_change',
            entityType: 'user',
            entityId: Number(req.params.id),
            details: { old_role: oldRole, new_role: role },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// PUT /api/admin/users/:id/disable — Toggle user disabled state
// -------------------------------------------------------------------------
router.put('/users/:id/disable', async (req, res) => {
    try {
        if (String(req.user.id) === String(req.params.id)) {
            return res.status(400).json({ success: false, error: 'Cannot disable your own account' });
        }
        const user = await db.queryOne('SELECT id, email, is_disabled FROM users WHERE id = $1', [req.params.id]);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        const newState = !user.is_disabled;
        await db.query('UPDATE users SET is_disabled = $1 WHERE id = $2', [newState, req.params.id]);

        db.logAuditEvent({
            userId: req.user.id,
            action: newState ? 'admin.user_disable' : 'admin.user_enable',
            entityType: 'user',
            entityId: Number(req.params.id),
            details: { email: user.email, is_disabled: newState },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { id: Number(req.params.id), is_disabled: newState } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// DELETE /api/admin/users/:id — Delete a user (cannot delete self)
// -------------------------------------------------------------------------
router.delete('/users/:id', async (req, res) => {
    try {
        if (String(req.user.id) === String(req.params.id)) {
            return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
        }
        const user = await db.queryOne('SELECT id, email FROM users WHERE id = $1', [req.params.id]);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        // Use hardDeleteUser to handle all FK constraints and collect S3 keys
        const s3Keys = await db.hardDeleteUser(Number(req.params.id));

        // Clean up S3 files in background (non-blocking)
        if (s3Keys && s3Keys.length > 0) {
            const s3 = require('../services/s3');
            for (let si = 0; si < s3Keys.length; si++) {
                try { await s3.deleteFromS3(s3Keys[si]); } catch (e) { /* ignore S3 cleanup errors */ }
            }
        }

        db.logAuditEvent({
            userId: req.user.id,
            action: 'admin.user_delete',
            entityType: 'user',
            entityId: Number(req.params.id),
            details: { email: user.email },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { id: Number(req.params.id) } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// GET /api/admin/invite-codes — List all invite codes
// -------------------------------------------------------------------------
router.get('/invite-codes', async (req, res) => {
    try {
        const codes = (await db.query(
            `SELECT ic.*,
                creator.display_name AS created_by_name,
                redeemer.display_name AS used_by_name
            FROM invite_codes ic
            LEFT JOIN users creator ON ic.created_by = creator.id
            LEFT JOIN users redeemer ON ic.used_by = redeemer.id
            ORDER BY ic.created_at DESC`
        )).rows;
        res.json({ success: true, data: codes });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// POST /api/admin/invite-codes — Generate a new invite code
// -------------------------------------------------------------------------
router.post('/invite-codes', async (req, res) => {
    try {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        const expiresAt = req.body.expires_at || null;

        const result = await db.query(
            'INSERT INTO invite_codes (code, created_by, expires_at) VALUES ($1, $2, $3) RETURNING id',
            [code, req.user.id, expiresAt]
        );

        const newCode = await db.queryOne('SELECT * FROM invite_codes WHERE id = $1', [result.rows[0].id]);

        db.logAuditEvent({
            userId: req.user.id,
            action: 'admin.invite_code_create',
            entityType: 'invite_code',
            entityId: result.rows[0].id,
            details: { code },
            ipAddress: req.ip,
        });

        res.status(201).json({ success: true, data: newCode });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// POST /api/admin/users/:id/reset-password — Generate a password reset link
// -------------------------------------------------------------------------
router.post('/users/:id/reset-password', async (req, res) => {
    try {
        const user = await db.queryOne('SELECT id, email, display_name FROM users WHERE id = $1', [req.params.id]);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Invalidate any existing unused reset tokens for this user
        await db.query(
            "UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL",
            [user.id]
        );

        // Generate a new token (16 bytes = 32 hex chars)
        const token = crypto.randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

        await db.query(
            'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, token, expiresAt]
        );

        res.json({
            success: true,
            data: {
                token,
                user: { id: user.id, email: user.email, display_name: user.display_name },
                expires_at: expiresAt,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// DELETE /api/admin/invite-codes/:id — Delete an invite code
// -------------------------------------------------------------------------
router.delete('/invite-codes/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM invite_codes WHERE id = $1', [req.params.id]);
        res.json({ success: true, data: { id: Number(req.params.id) } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// GET /api/admin/settings — Get admin settings
// -------------------------------------------------------------------------
router.get('/settings', async (req, res) => {
    try {
        const notifyOnRegister = (await db.getSetting('notify_on_register')) === 'true';
        const emailConfigured = emailService.isConfigured();
        res.json({
            success: true,
            data: { notify_on_register: notifyOnRegister, email_configured: emailConfigured },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// PUT /api/admin/settings — Update an admin setting
// -------------------------------------------------------------------------
router.put('/settings', async (req, res) => {
    try {
        const { key, value } = req.body;
        const allowedKeys = ['notify_on_register'];
        if (!allowedKeys.includes(key)) {
            return res.status(400).json({ success: false, error: 'Invalid setting key' });
        }
        await db.setSetting(key, String(value));
        res.json({ success: true, data: { key, value: String(value) } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// GET /api/admin/invite-requests — List all invite requests
// -------------------------------------------------------------------------
router.get('/invite-requests', async (req, res) => {
    try {
        const requests = (await db.query(
            `SELECT ir.*, reviewer.display_name AS reviewed_by_name
             FROM invite_requests ir
             LEFT JOIN users reviewer ON ir.reviewed_by = reviewer.id
             ORDER BY ir.created_at DESC`
        )).rows;
        res.json({ success: true, data: requests });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// POST /api/admin/invite-requests/:id/approve — Approve & send invite code
// -------------------------------------------------------------------------
router.post('/invite-requests/:id/approve', async (req, res) => {
    try {
        const request = await db.queryOne(
            'SELECT * FROM invite_requests WHERE id = $1 AND status = $2', [req.params.id, 'pending']
        );
        if (!request) {
            return res.status(404).json({ success: false, error: 'Request not found or already reviewed' });
        }

        // Generate an invite code
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        await db.query(
            'INSERT INTO invite_codes (code, created_by, expires_at) VALUES ($1, $2, $3)',
            [code, req.user.id, null]
        );

        // Mark request as approved
        await db.query(
            "UPDATE invite_requests SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2",
            [req.user.id, request.id]
        );

        // Email the invite code to the requester (fire-and-forget)
        if (emailService.isConfigured()) {
            emailService.sendInviteCodeToRequester(code, request.email, request.name).catch(function (err) {
                console.error('Failed to send invite code email:', err.message);
            });
        }

        db.logAuditEvent({
            userId: req.user.id,
            action: 'admin.invite_request_approve',
            entityType: 'invite_request',
            entityId: Number(req.params.id),
            details: { email: request.email },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { code, request_id: request.id } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// POST /api/admin/invite-requests/:id/deny — Deny an invite request
// -------------------------------------------------------------------------
router.post('/invite-requests/:id/deny', async (req, res) => {
    try {
        const request = await db.queryOne(
            'SELECT * FROM invite_requests WHERE id = $1 AND status = $2', [req.params.id, 'pending']
        );
        if (!request) {
            return res.status(404).json({ success: false, error: 'Request not found or already reviewed' });
        }

        await db.query(
            "UPDATE invite_requests SET status = 'denied', reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2",
            [req.user.id, request.id]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'admin.invite_request_deny',
            entityType: 'invite_request',
            entityId: Number(req.params.id),
            details: { email: request.email },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { request_id: request.id } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// =========================================================================
// LEGAL CONTENT MANAGEMENT
// =========================================================================

// -------------------------------------------------------------------------
// GET /api/admin/legal — List all legal content (filterable)
// -------------------------------------------------------------------------
router.get('/legal', async (req, res) => {
    try {
        const country = req.query.country || null;
        const staleOnly = req.query.stale === 'true';

        let sql = `SELECT id, country_code, region_code, language, section_key, section_title,
                    severity, sort_order, source_url, last_verified, created_at, updated_at
                    FROM legal_content WHERE 1=1`;
        const params = [];
        let paramIndex = 1;

        if (country) {
            sql += ` AND country_code = $${paramIndex++}`;
            params.push(country.toUpperCase());
        }

        if (staleOnly) {
            sql += " AND (last_verified IS NULL OR last_verified::date < CURRENT_DATE - INTERVAL '6 months')";
        }

        sql += ' ORDER BY country_code, region_code, sort_order, section_key';

        const rows = (await db.query(sql, params)).rows;

        // Also return stale count for the badge
        const staleCount = (await db.queryOne(
            "SELECT COUNT(*)::int AS cnt FROM legal_content WHERE last_verified IS NULL OR last_verified::date < CURRENT_DATE - INTERVAL '6 months'"
        )).cnt;

        res.json({ success: true, data: { sections: rows, stale_count: staleCount } });
    } catch (err) {
        console.error('Error listing legal content:', err);
        res.status(500).json({ success: false, error: 'Failed to load legal content.' });
    }
});

// =========================================================================
// LEGAL SUGGESTIONS MODERATION
// (Must be registered BEFORE /legal/:id to avoid :id capturing "suggestions")
// =========================================================================

// -------------------------------------------------------------------------
// GET /api/admin/legal/suggestions — List all suggestions (paginated, filterable)
// -------------------------------------------------------------------------
router.get('/legal/suggestions', async (req, res) => {
    try {
        const status = req.query.status || null;
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const offset = (page - 1) * limit;

        let whereClauses = [];
        let params = [];
        let paramIdx = 1;

        if (status) {
            whereClauses.push(`ls.status = $${paramIdx++}`);
            params.push(status);
        }

        const whereStr = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        const totalCount = (await db.queryOne(
            `SELECT COUNT(*)::int AS cnt FROM legal_suggestions ls ${whereStr}`,
            params
        )).cnt;

        const rows = (await db.query(
            `SELECT ls.*, u.display_name AS user_display_name, u.email AS user_email
             FROM legal_suggestions ls
             LEFT JOIN users u ON ls.user_id = u.id
             ${whereStr}
             ORDER BY ls.created_at DESC
             LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
            [...params, limit, offset]
        )).rows;

        res.json({ success: true, data: { suggestions: rows, total_count: totalCount, page, limit } });
    } catch (err) {
        console.error('Error listing legal suggestions:', err);
        res.status(500).json({ success: false, error: 'Failed to load suggestions.' });
    }
});

// -------------------------------------------------------------------------
// GET /api/admin/legal/suggestions/:id — Single suggestion details
// -------------------------------------------------------------------------
router.get('/legal/suggestions/:id', async (req, res) => {
    try {
        const suggestion = await db.queryOne(
            `SELECT ls.*, u.display_name AS user_display_name, u.email AS user_email
             FROM legal_suggestions ls
             LEFT JOIN users u ON ls.user_id = u.id
             WHERE ls.id = $1`,
            [req.params.id]
        );
        if (!suggestion) {
            return res.status(404).json({ success: false, error: 'Suggestion not found.' });
        }

        // Include linked legal content if available
        let linkedContent = null;
        if (suggestion.legal_content_id) {
            linkedContent = await db.queryOne(
                'SELECT id, country_code, region_code, section_key, section_title, severity FROM legal_content WHERE id = $1',
                [suggestion.legal_content_id]
            );
        }

        res.json({ success: true, data: { ...suggestion, linked_content: linkedContent } });
    } catch (err) {
        console.error('Error fetching legal suggestion:', err);
        res.status(500).json({ success: false, error: 'Failed to load suggestion.' });
    }
});

// -------------------------------------------------------------------------
// PUT /api/admin/legal/suggestions/:id — Review (approve/reject) a suggestion
// -------------------------------------------------------------------------
router.put('/legal/suggestions/:id', validate(schemas.reviewLegalSuggestion), async (req, res) => {
    try {
        const suggestion = await db.queryOne('SELECT id, status FROM legal_suggestions WHERE id = $1', [req.params.id]);
        if (!suggestion) {
            return res.status(404).json({ success: false, error: 'Suggestion not found.' });
        }

        const { status, admin_notes } = req.body;

        await db.query(
            `UPDATE legal_suggestions SET status = $1, admin_notes = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW() WHERE id = $4`,
            [status, admin_notes || null, req.user.id, req.params.id]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'legal.suggestion_review',
            entityType: 'legal_suggestion',
            entityId: Number(req.params.id),
            details: { status },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { id: Number(req.params.id), status } });
    } catch (err) {
        console.error('Error reviewing legal suggestion:', err);
        res.status(500).json({ success: false, error: 'Failed to review suggestion.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/admin/legal/suggestions/:id/apply — Apply a suggestion to legal content
// -------------------------------------------------------------------------
router.post('/legal/suggestions/:id/apply', validate(schemas.applyLegalSuggestion), async (req, res) => {
    try {
        const suggestion = await db.queryOne('SELECT * FROM legal_suggestions WHERE id = $1', [req.params.id]);
        if (!suggestion) {
            return res.status(404).json({ success: false, error: 'Suggestion not found.' });
        }

        const { content_html, section_title, severity, change_summary } = req.body;
        let contentId = suggestion.legal_content_id;

        if (contentId) {
            // Update existing legal content
            const existing = await db.queryOne('SELECT * FROM legal_content WHERE id = $1', [contentId]);
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Linked legal content not found.' });
            }

            const newTitle = section_title || existing.section_title;
            const newSeverity = severity || existing.severity;

            await db.query(
                `UPDATE legal_content SET
                    section_title = $1, content_html = $2, severity = $3, updated_at = NOW()
                 WHERE id = $4`,
                [newTitle, content_html, newSeverity || null, contentId]
            );

            // Create revision
            const revNum = (await db.queryOne(
                'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_num FROM legal_revisions WHERE legal_content_id = $1',
                [contentId]
            )).next_num;

            await db.query(
                `INSERT INTO legal_revisions (legal_content_id, changed_by, suggestion_id, revision_number, old_title, new_title, old_content_html, new_content_html, old_severity, new_severity, change_summary)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    contentId, req.user.id, suggestion.id, revNum,
                    existing.section_title, newTitle,
                    existing.content_html, content_html,
                    existing.severity || null, newSeverity || null,
                    change_summary || 'Applied from suggestion #' + suggestion.id,
                ]
            );
        } else {
            // Create new legal content section
            const sectionKey = 'suggestion_' + suggestion.id + '_' + Date.now();
            const result = await db.query(
                `INSERT INTO legal_content (country_code, region_code, language, section_key, section_title, content_html, severity, last_verified)
                 VALUES ($1, $2, 'en', $3, $4, $5, $6, CURRENT_DATE) RETURNING id`,
                [
                    suggestion.country_code,
                    suggestion.region_code || null,
                    sectionKey,
                    section_title || suggestion.section_title || 'New Section',
                    content_html,
                    severity || null,
                ]
            );
            contentId = result.rows[0].id;
        }

        // Mark suggestion as applied
        await db.query(
            `UPDATE legal_suggestions SET status = 'applied', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2`,
            [req.user.id, suggestion.id]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'legal.suggestion_apply',
            entityType: 'legal_suggestion',
            entityId: Number(req.params.id),
            details: { legal_content_id: contentId },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { id: Number(req.params.id), legal_content_id: contentId } });
    } catch (err) {
        console.error('Error applying legal suggestion:', err);
        res.status(500).json({ success: false, error: 'Failed to apply suggestion.' });
    }
});

// -------------------------------------------------------------------------
// GET /api/admin/legal/:id — Get a single legal section (with HTML)
// -------------------------------------------------------------------------
router.get('/legal/:id', async (req, res) => {
    try {
        const row = await db.queryOne('SELECT * FROM legal_content WHERE id = $1', [req.params.id]);
        if (!row) {
            return res.status(404).json({ success: false, error: 'Section not found.' });
        }
        res.json({ success: true, data: row });
    } catch (err) {
        console.error('Error fetching legal section:', err);
        res.status(500).json({ success: false, error: 'Failed to load legal section.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/admin/legal — Create a new legal section
// -------------------------------------------------------------------------
router.post('/legal', async (req, res) => {
    try {
        const { country_code, region_code, language, section_key, section_title, content_html, severity, sort_order, source_url } = req.body;

        if (!country_code || !section_key || !section_title || !content_html) {
            return res.status(400).json({ success: false, error: 'country_code, section_key, section_title, and content_html are required.' });
        }

        const validSeverities = ['ok', 'caution', 'warning', 'danger'];
        if (severity && !validSeverities.includes(severity)) {
            return res.status(400).json({ success: false, error: 'Invalid severity. Use: ok, caution, warning, danger.' });
        }

        const result = await db.query(
            `INSERT INTO legal_content (country_code, region_code, language, section_key, section_title, content_html, severity, sort_order, source_url, last_verified)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE) RETURNING id`,
            [
                country_code.toUpperCase(),
                region_code || null,
                language || 'en',
                section_key,
                section_title,
                content_html,
                severity || null,
                sort_order || 100,
                source_url || null
            ]
        );

        res.json({ success: true, data: { id: result.rows[0].id } });
    } catch (err) {
        console.error('Error creating legal section:', err);
        if (err.message && (err.message.includes('unique') || err.message.includes('duplicate key'))) {
            return res.status(409).json({ success: false, error: 'A section with this country/region/language/key already exists.' });
        }
        res.status(500).json({ success: false, error: 'Failed to create legal section.' });
    }
});

// -------------------------------------------------------------------------
// PUT /api/admin/legal/:id — Update a legal section (with auto-revision)
// -------------------------------------------------------------------------
router.put('/legal/:id', async (req, res) => {
    try {
        const existing = await db.queryOne('SELECT * FROM legal_content WHERE id = $1', [req.params.id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Section not found.' });
        }

        const { section_title, content_html, severity, sort_order, source_url } = req.body;

        const validSeverities = ['ok', 'caution', 'warning', 'danger', ''];
        if (severity !== undefined && severity !== null && severity !== '' && !['ok', 'caution', 'warning', 'danger'].includes(severity)) {
            return res.status(400).json({ success: false, error: 'Invalid severity.' });
        }

        await db.query(
            `UPDATE legal_content SET
                section_title = COALESCE($1, section_title),
                content_html = COALESCE($2, content_html),
                severity = $3,
                sort_order = COALESCE($4, sort_order),
                source_url = $5,
                updated_at = NOW()
             WHERE id = $6`,
            [
                section_title || null,
                content_html || null,
                (severity === '') ? null : (severity ?? null),
                sort_order || null,
                source_url ?? null,
                req.params.id
            ]
        );

        // Auto-create revision if title, content, or severity changed
        const newTitle = section_title || existing.section_title;
        const newContent = content_html || existing.content_html;
        const newSeverity = (severity === '') ? null : (severity !== undefined ? severity : existing.severity);

        const titleChanged = newTitle !== existing.section_title;
        const contentChanged = newContent !== existing.content_html;
        const severityChanged = (newSeverity || null) !== (existing.severity || null);

        if (titleChanged || contentChanged || severityChanged) {
            const revNum = (await db.queryOne(
                'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_num FROM legal_revisions WHERE legal_content_id = $1',
                [req.params.id]
            )).next_num;

            await db.query(
                `INSERT INTO legal_revisions (legal_content_id, changed_by, revision_number, old_title, new_title, old_content_html, new_content_html, old_severity, new_severity, change_summary)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    req.params.id,
                    req.user.id,
                    revNum,
                    existing.section_title,
                    newTitle,
                    existing.content_html,
                    newContent,
                    existing.severity || null,
                    newSeverity || null,
                    'Admin edit',
                ]
            );

            db.logAuditEvent({
                userId: req.user.id,
                action: 'legal.content_update',
                entityType: 'legal_content',
                entityId: Number(req.params.id),
                ipAddress: req.ip,
            });
        }

        res.json({ success: true, data: { id: Number(req.params.id) } });
    } catch (err) {
        console.error('Error updating legal section:', err);
        res.status(500).json({ success: false, error: 'Failed to update legal section.' });
    }
});

// -------------------------------------------------------------------------
// PUT /api/admin/legal/:id/verify — Mark a section as verified today
// -------------------------------------------------------------------------
router.put('/legal/:id/verify', async (req, res) => {
    try {
        const result = await db.query(
            "UPDATE legal_content SET last_verified = CURRENT_DATE, updated_at = NOW() WHERE id = $1",
            [req.params.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Section not found.' });
        }

        res.json({ success: true, data: { id: Number(req.params.id) } });
    } catch (err) {
        console.error('Error verifying legal section:', err);
        res.status(500).json({ success: false, error: 'Failed to verify legal section.' });
    }
});

// -------------------------------------------------------------------------
// GET /api/admin/legal/:id/revisions — Revision history for a legal section
// -------------------------------------------------------------------------
router.get('/legal/:id/revisions', async (req, res) => {
    try {
        const existing = await db.queryOne('SELECT id FROM legal_content WHERE id = $1', [req.params.id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Section not found.' });
        }

        const rows = (await db.query(
            `SELECT lr.*, u.display_name AS changed_by_name
             FROM legal_revisions lr
             LEFT JOIN users u ON lr.changed_by = u.id
             WHERE lr.legal_content_id = $1
             ORDER BY lr.revision_number DESC`,
            [req.params.id]
        )).rows;

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Error fetching legal revisions:', err);
        res.status(500).json({ success: false, error: 'Failed to load revisions.' });
    }
});

// -------------------------------------------------------------------------
// DELETE /api/admin/legal/:id — Delete a legal section
// -------------------------------------------------------------------------
router.delete('/legal/:id', async (req, res) => {
    try {
        const result = await db.query('DELETE FROM legal_content WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Section not found.' });
        }
        res.json({ success: true, data: { id: Number(req.params.id) } });
    } catch (err) {
        console.error('Error deleting legal section:', err);
        res.status(500).json({ success: false, error: 'Failed to delete legal section.' });
    }
});

// =========================================================================
// AUDIT LOG
// =========================================================================

// -------------------------------------------------------------------------
// GET /api/admin/audit/actions — Distinct action values for filter dropdown
// -------------------------------------------------------------------------
router.get('/audit/actions', async (req, res) => {
    try {
        const rows = (await db.query(
            'SELECT DISTINCT action FROM audit_events ORDER BY action'
        )).rows;
        res.json({ success: true, data: rows.map(r => r.action) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// GET /api/admin/audit — Paginated, filtered audit event listing
// -------------------------------------------------------------------------
router.get('/audit', async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 50, 1), 500);
        const offset = (page - 1) * pageSize;

        // Build dynamic WHERE clause
        const conditions = [];
        const params = [];
        let paramIdx = 1;

        if (req.query.action) {
            conditions.push(`ae.action = $${paramIdx++}`);
            params.push(req.query.action);
        }
        if (req.query.entity_type) {
            conditions.push(`ae.entity_type = $${paramIdx++}`);
            params.push(req.query.entity_type);
        }
        if (req.query.user_id) {
            conditions.push(`ae.user_id = $${paramIdx++}`);
            params.push(parseInt(req.query.user_id, 10));
        }
        if (req.query.user_search) {
            conditions.push(`(u.display_name ILIKE $${paramIdx} OR u.email ILIKE $${paramIdx})`);
            params.push('%' + req.query.user_search + '%');
            paramIdx++;
        }
        if (req.query.start_date) {
            conditions.push(`ae.created_at >= $${paramIdx++}::date`);
            params.push(req.query.start_date);
        }
        if (req.query.end_date) {
            conditions.push(`ae.created_at < ($${paramIdx++}::date + interval '1 day')`);
            params.push(req.query.end_date);
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // Count total matching rows
        const countResult = await db.queryOne(
            `SELECT COUNT(*)::int AS cnt
             FROM audit_events ae
             LEFT JOIN users u ON ae.user_id = u.id
             ${whereClause}`,
            params
        );
        const totalCount = countResult.cnt;

        // Fetch page of events
        const events = (await db.query(
            `SELECT ae.*, u.display_name AS user_display_name, u.email AS user_email
             FROM audit_events ae
             LEFT JOIN users u ON ae.user_id = u.id
             ${whereClause}
             ORDER BY ae.created_at DESC
             LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
            [...params, pageSize, offset]
        )).rows;

        res.json({
            success: true,
            data: { events, total_count: totalCount, page, page_size: pageSize },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
