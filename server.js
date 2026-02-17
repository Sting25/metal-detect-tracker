const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------
app.set('trust proxy', 1); // Trust first proxy (Nginx) for correct client IP in rate limiting
app.disable('x-powered-by');

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdnjs.cloudflare.com", "https://accounts.google.com/gsi/client", "https://www.googletagmanager.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdnjs.cloudflare.com", "https://accounts.google.com/gsi/style"],
            imgSrc: ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org", "https://server.arcgisonline.com", "https://*.digitaloceanspaces.com", "https://www.google-analytics.com"],
            connectSrc: ["'self'", "https://accounts.google.com", "https://www.google-analytics.com", "https://*.google-analytics.com", "https://*.analytics.google.com", "https://www.googletagmanager.com", "https://nominatim.openstreetmap.org", "https://*.tile.openstreetmap.org", "https://server.arcgisonline.com"],
            frameSrc: ["'self'", "https://accounts.google.com"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            workerSrc: ["'self'"],
        },
    },
}));

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
var isTest = function () {
    return process.env.NODE_ENV === 'test' || !!process.env.TEST_DB_PATH;
};

// Strict limit for auth endpoints (login, register, etc.)
var authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please try again later.' },
    skip: isTest,
});

// General API limit
var apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please try again later.' },
    skip: isTest,
});

// Apply strict rate limit to auth endpoints
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/setup', authLimiter);
app.use('/api/auth/verify-email', authLimiter);
app.use('/api/auth/resend-verification', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth/request-invite', authLimiter);
app.use('/api/auth/google', authLimiter);
app.use('/api/auth/passkey/login-options', authLimiter);
app.use('/api/auth/passkey/login-verify', authLimiter);
app.use('/api/auth/demo', authLimiter);

// Strict limit for data exports (expensive operation)
var exportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many export requests. Please try again later.' },
    skip: isTest,
});
app.use('/api/exports', exportLimiter);
app.use('/api/imports', exportLimiter);

// Apply general rate limit to all API routes
app.use('/api', apiLimiter);

// ---------------------------------------------------------------------------
// CSRF protection (Origin/Referer checking for state-changing requests)
// ---------------------------------------------------------------------------
const csrfProtection = require('./middleware/csrf');
app.use('/api', csrfProtection);

// ---------------------------------------------------------------------------
// Body parsing with size limits
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ limit: '50kb', extended: true }));

// ---------------------------------------------------------------------------
// SEO: redirect root to landing page (before static so index.html isn't served for /)
// ---------------------------------------------------------------------------
app.get('/', function (_req, res) {
    res.redirect(302, '/landing.html');
});

// ---------------------------------------------------------------------------
// Static files — public assets only (uploads are auth-gated via /api/uploads)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Auth routes (no middleware — they handle their own auth)
app.use('/api/auth', require('./routes/auth'));

// Data routes (auth middleware applied inside each router)
app.use('/api/sites', require('./routes/sites'));
app.use('/api/finds', require('./routes/finds'));
app.use('/api/hunts', require('./routes/hunts'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/reminders', require('./routes/reminders'));

// Admin routes (auth + admin middleware applied inside router)
app.use('/api/admin', require('./routes/admin'));

// Feedback routes (auth middleware applied inside router)
app.use('/api/feedback', require('./routes/feedback'));

// Land types (auth middleware applied inside router)
app.use('/api/land-types', require('./routes/land-types'));

// Legal content (public endpoint - no auth required)
app.use('/api/legal', require('./routes/legal'));

// Public permission links (no auth - token-based access)
app.use('/api/p', require('./routes/permission-links'));

// Letter preferences (auth middleware applied inside router)
app.use('/api/letter-preferences', require('./routes/letter-prefs'));

// Protected upload serving (replaces old express.static('/uploads'))
app.use('/api/uploads', require('./routes/uploads'));

// Data export/import (auth middleware applied inside routers)
app.use('/api/exports', require('./routes/exports'));
app.use('/api/imports', require('./routes/imports'));

// ---------------------------------------------------------------------------
// Error handlers
// ---------------------------------------------------------------------------

// Multer file upload errors (size limit, invalid type)
app.use(function (err, _req, res, next) {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, error: 'File too large. Maximum size exceeded.' });
        }
        return res.status(400).json({ success: false, error: err.message || 'File upload error' });
    }
    if (err && err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
});

// ---------------------------------------------------------------------------
// Start server — must await async db.initialize() before listening
// ---------------------------------------------------------------------------
async function start() {
    await db.initialize();

    // Hard-delete job: permanently remove accounts deleted > 30 days ago
    if (process.env.NODE_ENV !== 'test') {
        var s3 = require('./services/s3');
        async function runHardDeleteJob() {
            var rows = (await db.query(
                "SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'"
            )).rows;
            for (var i = 0; i < rows.length; i++) {
                try {
                    var s3Keys = await db.hardDeleteUser(rows[i].id);
                    for (var j = 0; j < s3Keys.length; j++) {
                        await s3.deleteFromS3(s3Keys[j]);
                    }
                    console.log('Hard-deleted user', rows[i].id);
                } catch (err) {
                    console.error('Hard delete failed for user', rows[i].id, err.message);
                }
            }
        }
        runHardDeleteJob().catch(function (err) { console.error('Hard delete job error:', err.message); });
        setInterval(function () { runHardDeleteJob().catch(function (err) { console.error('Hard delete job error:', err.message); }); }, 24 * 60 * 60 * 1000);

        // Idempotency key cleanup: delete keys older than 7 days
        async function cleanIdempotencyKeys() {
            var result = await db.query("DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '7 days'");
            if (result.rowCount > 0) {
                console.log('Cleaned', result.rowCount, 'expired idempotency keys');
            }
        }
        cleanIdempotencyKeys().catch(function (err) { console.error('Idempotency cleanup error:', err.message); });
        setInterval(function () { cleanIdempotencyKeys().catch(function (err) { console.error('Idempotency cleanup error:', err.message); }); }, 24 * 60 * 60 * 1000);
    }

    app.listen(PORT, '127.0.0.1', function () {
        console.log('Metal Detector Location Tracker running at http://localhost:' + PORT);
    });
}

if (require.main === module) {
    start().catch(function (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
}

module.exports = app;
