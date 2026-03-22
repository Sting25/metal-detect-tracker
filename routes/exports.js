const express = require('express');
const router = express.Router();
const { verifyToken, denyDemoUser } = require('../middleware/auth');
const { buildExportZip } = require('../services/export');
const db = require('../database');

// All routes require authentication
router.use(verifyToken);

/**
 * POST /api/exports — Stream a ZIP archive of all user data.
 */
router.post('/', denyDemoUser, async function (req, res) {
    try {
        db.logAuditEvent({
            userId: req.user.id,
            action: 'export.create',
            entityType: 'export',
            entityId: req.user.id,
            ipAddress: req.ip,
        });
        await buildExportZip(req.user, res);
    } catch (err) {
        console.error('Export error:', err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Export failed' });
        }
    }
});

module.exports = router;
