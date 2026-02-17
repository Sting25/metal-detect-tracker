var express = require('express');
var router = express.Router();
var { verifyToken, denyDemoUser } = require('../middleware/auth');
var { buildExportZip } = require('../services/export');
var db = require('../database');

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
