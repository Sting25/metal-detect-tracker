/**
 * Feedback routes: submit feedback, admin management
 * All routes require authentication. Admin-only routes additionally check role.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const s3 = require('../services/s3');
const { verifyToken, requireAdmin, denyDemoUser } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const emailService = require('../services/email');
const { createUpload } = require('../middleware/upload');

// ---------------------------------------------------------------------------
// Auth -- all routes require a valid JWT
// ---------------------------------------------------------------------------
router.use(verifyToken);

// ---------------------------------------------------------------------------
// Multer setup -- validated image uploads (memory storage for S3)
// ---------------------------------------------------------------------------
const upload = createUpload('feedback');

// ---------------------------------------------------------------------------
// POST /api/feedback -- submit feedback (any authenticated user)
// ---------------------------------------------------------------------------
router.post('/', denyDemoUser, upload.single('screenshot'), validate(schemas.createFeedback), async (req, res) => {
    try {
        const { message, type, page_url, user_agent } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }

        const validTypes = ['bug', 'suggestion', 'question', 'other'];
        const feedbackType = type && validTypes.includes(type) ? type : 'suggestion';

        if (type && !validTypes.includes(type)) {
            return res.status(400).json({ success: false, error: 'Invalid feedback type' });
        }

        let screenshotPath = null;
        if (req.file) {
            const s3Key = s3.generateKey('feedback', req.file.originalname);
            await s3.uploadToS3(req.file.buffer, s3Key, req.file.mimetype);
            screenshotPath = s3Key;
        }

        const result = await db.query(`
            INSERT INTO feedback (
                user_id, type, message, page_url, user_agent, screenshot_path,
                status, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                'new', NOW()
            )
            RETURNING *
        `, [
            req.user.id,
            feedbackType,
            message.trim(),
            page_url || null,
            user_agent || null,
            screenshotPath
        ]);

        const newFeedback = result.rows[0];

        // Fire-and-forget email notification to admin
        if (emailService.isConfigured()) {
            const admin = await db.queryOne(
                "SELECT email FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
            );
            if (admin) {
                emailService.sendFeedbackNotification(newFeedback, admin.email).catch(function (err) {
                    console.error('Failed to send feedback notification email:', err.message);
                });
            }
        }

        res.status(201).json({
            success: true,
            data: {
                ...newFeedback,
                screenshot_url: newFeedback.screenshot_path,
            },
        });
    } catch (err) {
        console.error('Failed to submit feedback:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/feedback -- list all feedback (admin only), with user display_name
// ---------------------------------------------------------------------------
router.get('/', requireAdmin, async (req, res) => {
    try {
        const { status } = req.query;

        let sql = `
            SELECT f.*, u.display_name
            FROM feedback f
            LEFT JOIN users u ON f.user_id = u.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (status) {
            sql += ` AND f.status = $${paramIndex++}`;
            params.push(status);
        }

        sql += ' ORDER BY f.created_at DESC';

        const result = await db.query(sql, params);
        const data = result.rows.map((r) => ({
            ...r,
            screenshot_url: r.screenshot_path,
        }));

        res.json({ success: true, data, count: data.length });
    } catch (err) {
        console.error('Failed to list feedback:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/feedback/stats -- feedback counts by status (admin only)
// ---------------------------------------------------------------------------
router.get('/stats', requireAdmin, async (req, res) => {
    try {
        const newRow = await db.queryOne(
            "SELECT COUNT(*)::int AS cnt FROM feedback WHERE status = 'new'"
        );
        const reviewedRow = await db.queryOne(
            "SELECT COUNT(*)::int AS cnt FROM feedback WHERE status = 'reviewed'"
        );
        const resolvedRow = await db.queryOne(
            "SELECT COUNT(*)::int AS cnt FROM feedback WHERE status = 'resolved'"
        );
        const totalRow = await db.queryOne(
            'SELECT COUNT(*)::int AS cnt FROM feedback'
        );

        res.json({
            success: true,
            data: {
                new: parseInt(newRow.cnt, 10),
                reviewed: parseInt(reviewedRow.cnt, 10),
                resolved: parseInt(resolvedRow.cnt, 10),
                total: parseInt(totalRow.cnt, 10),
            },
        });
    } catch (err) {
        console.error('Failed to get feedback stats:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// PUT /api/feedback/:id -- update feedback status/notes (admin only)
// ---------------------------------------------------------------------------
router.put('/:id', requireAdmin, validate(schemas.updateFeedback), async (req, res) => {
    try {
        const existing = await db.queryOne('SELECT * FROM feedback WHERE id = $1', [req.params.id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Feedback not found' });
        }

        const { status, admin_notes } = req.body;

        const validStatuses = ['new', 'reviewed', 'resolved'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }

        await db.query(`
            UPDATE feedback SET
                status = $1,
                admin_notes = $2,
                reviewed_at = NOW(),
                reviewed_by = $3
            WHERE id = $4
        `, [
            status ?? existing.status,
            admin_notes ?? existing.admin_notes,
            req.user.id,
            req.params.id
        ]);

        const updated = await db.queryOne('SELECT * FROM feedback WHERE id = $1', [req.params.id]);

        res.json({
            success: true,
            data: {
                ...updated,
                screenshot_url: updated.screenshot_path,
            },
        });
    } catch (err) {
        console.error('Failed to update feedback:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/feedback/:id -- delete feedback record (admin only)
// ---------------------------------------------------------------------------
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const existing = await db.queryOne('SELECT * FROM feedback WHERE id = $1', [req.params.id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Feedback not found' });
        }

        if (existing.screenshot_path) {
            await s3.deleteFromS3(existing.screenshot_path);
        }

        await db.query('DELETE FROM feedback WHERE id = $1', [req.params.id]);

        res.json({ success: true, data: { id: Number(req.params.id) } });
    } catch (err) {
        console.error('Failed to delete feedback:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
