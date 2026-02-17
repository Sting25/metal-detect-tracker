/**
 * Authentication middleware for Metal Detector Location Tracker
 * Provides JWT token verification and role-based access control.
 * Uses async pg queries.
 */
const jwt = require('jsonwebtoken');
const db = require('../database');

// JWT_SECRET MUST be set as an environment variable in all environments.
// Generate one with: openssl rand -hex 32
if (!process.env.JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable must be set. Generate one with: openssl rand -hex 32');
}
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Verify JWT token from Authorization header and attach user to req.
 * Also updates last_active timestamp (throttled to once per 5 minutes).
 */
async function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await db.queryOne(
            'SELECT id, email, display_name, role, country_code, region, unit_preference, language_preference, store_exact_gps, export_obfuscation, google_id, is_demo, is_disabled, last_active, deleted_at FROM users WHERE id = $1',
            [decoded.userId]
        );
        if (!user) {
            return res.status(401).json({ success: false, error: 'User not found' });
        }
        if (user.deleted_at) {
            return res.status(401).json({ success: false, error: 'Account deleted' });
        }
        if (user.is_disabled) {
            return res.status(403).json({ success: false, error: 'Account disabled', isDisabled: true });
        }
        req.user = user;

        // Update last_active throttled — only if older than 5 minutes (or null)
        const now = new Date();
        const lastActive = user.last_active ? new Date(user.last_active) : null;
        if (!lastActive || (now - lastActive) > 5 * 60 * 1000) {
            try {
                await db.query('UPDATE users SET last_active = NOW() WHERE id = $1', [user.id]);
            } catch (_) { /* non-critical */ }
        }

        next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, error: 'Invalid or expired token' });
        }
        // Unexpected error (e.g. DB down) — still return 401 to not leak internals
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
}

/**
 * Require admin role. Must be used AFTER verifyToken.
 */
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
}

/**
 * Reject mutation requests from demo users. Must be used AFTER verifyToken.
 */
function denyDemoUser(req, res, next) {
    if (req.user && req.user.is_demo) {
        return res.status(403).json({
            success: false,
            error: 'This action is not available in demo mode. Sign up for a free account to create your own data.',
            isDemo: true,
        });
    }
    next();
}

module.exports = { verifyToken, requireAdmin, denyDemoUser, JWT_SECRET };
