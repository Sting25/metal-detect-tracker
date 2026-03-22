/**
 * Authentication routes: setup, register, login, demo.
 * Sub-routers handle account management (auth-account.js) and
 * Google OAuth / WebAuthn passkeys (auth-social.js).
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { verifyToken, denyDemoUser, JWT_SECRET } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const emailService = require('../services/email');

// Email verification toggle — set EMAIL_VERIFICATION_ENABLED=true in ecosystem.config.js to require verification
function isEmailVerificationEnabled() {
    return process.env.EMAIL_VERIFICATION_ENABLED === 'true';
}

// Sentinel value for users without a password (Google/passkey-only)
const NO_PASSWORD_SENTINEL = '__NO_PASSWORD__';

// Admin bootstrap hiding — set ALLOW_SETUP=false in production to disable
function isSetupAllowed() {
    return process.env.ALLOW_SETUP !== 'false'; // defaults to true (backward compatible)
}

// -------------------------------------------------------------------------
// GET /api/auth/needs-setup — Check if first-time setup is needed
// -------------------------------------------------------------------------
router.get('/needs-setup', async (req, res) => {
    try {
        if (!isSetupAllowed()) {
            return res.json({ success: true, data: { needsSetup: false } });
        }
        const row = await db.queryOne('SELECT COUNT(*)::int AS cnt FROM users');
        res.json({ success: true, data: { needsSetup: parseInt(row.cnt, 10) === 0 } });
    } catch (err) {
        console.error('Needs-setup error:', err);
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/setup — Create first admin (only when no users exist)
// -------------------------------------------------------------------------
router.post('/setup', validate(schemas.setup), async (req, res) => {
    try {
        if (!isSetupAllowed()) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        const row = await db.queryOne('SELECT COUNT(*)::int AS cnt FROM users');
        if (parseInt(row.cnt, 10) > 0) {
            return res.status(400).json({ success: false, error: 'Setup already completed' });
        }

        const { email, password, display_name, country_code, region } = req.body;
        if (!email || !password || !display_name) {
            return res.status(400).json({
                success: false,
                error: 'Email, password, and display name are required',
            });
        }
        if (password.length < 12) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 12 characters',
            });
        }

        const hash = bcrypt.hashSync(password, 10);
        const cc = country_code || 'US';
        const result = await db.query(
            'INSERT INTO users (email, password_hash, display_name, role, country_code, region, email_verified) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id',
            [email.toLowerCase().trim(), hash, display_name.trim(), 'admin', cc, region || null]
        );

        const newUserId = result.rows[0].id;

        // Claim any existing orphaned data
        await db.assignOrphanedDataToUser(newUserId);

        const token = jwt.sign({ userId: newUserId }, JWT_SECRET, {
            expiresIn: '7d',
        });
        const user = await db.queryOne(
            'SELECT id, email, display_name, role, country_code, region, unit_preference, language_preference FROM users WHERE id = $1',
            [newUserId]
        );

        db.logAuditEvent({
            userId: newUserId,
            action: 'user.register',
            entityType: 'user',
            entityId: newUserId,
            details: { method: 'setup' },
            ipAddress: req.ip,
        });

        res.status(201).json({ success: true, data: { user, token } });
    } catch (err) {
        if (err.message && err.message.includes('unique')) {
            return res.status(400).json({ success: false, error: 'Email already in use' });
        }
        console.error('Setup error:', err);
        res.status(500).json({ success: false, error: 'Setup failed. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/register — Open registration with terms acceptance
// -------------------------------------------------------------------------
router.post('/register', validate(schemas.register), async (req, res) => {
    try {
        const { email, password, display_name, phone, country_code, region, terms_accepted } = req.body;
        if (!email || !password || !display_name) {
            return res.status(400).json({
                success: false,
                error: 'Email, password, and display name are required',
            });
        }
        if (!terms_accepted) {
            return res.status(400).json({
                success: false,
                error: 'You must agree to the terms to register',
            });
        }
        if (password.length < 12) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 12 characters',
            });
        }

        // Check email uniqueness
        const existing = await db.queryOne(
            'SELECT id FROM users WHERE email = $1',
            [email.toLowerCase().trim()]
        );
        if (existing) {
            return res.status(400).json({ success: false, error: 'Email already registered' });
        }

        const hash = bcrypt.hashSync(password, 10);
        const cleanPhone = phone ? phone.replace(/[^\d+]/g, '') : null;
        const cc = country_code || 'US';

        // Generate 6-digit verification code (used when verification is enabled)
        const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
        const verifyEnabled = isEmailVerificationEnabled();

        const termsAcceptedAt = new Date().toISOString();
        const result = await db.query(
            'INSERT INTO users (email, password_hash, display_name, role, phone, country_code, region, email_verified, verification_code, verification_expires_at, terms_accepted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
            [email.toLowerCase().trim(), hash, display_name.trim(), 'user', cleanPhone, cc, region || null, verifyEnabled ? false : true, verificationCode, expiresAt, termsAcceptedAt]
        );

        const newUserId = result.rows[0].id;

        // Add seed sites so the new user has starter data
        try {
            await db.insertSeedSites(newUserId, cc);
        } catch (seedErr) {
            console.error('Warning: failed to insert seed sites:', seedErr.message);
        }

        db.logAuditEvent({
            userId: newUserId,
            action: 'user.register',
            entityType: 'user',
            entityId: newUserId,
            details: { method: 'registration', country_code: cc },
            ipAddress: req.ip,
        });

        // Send verification email when enabled (fire-and-forget)
        if (verifyEnabled) {
            try {
                if (emailService.isConfigured()) {
                    emailService.sendVerificationEmail(
                        email.toLowerCase().trim(),
                        display_name.trim(),
                        verificationCode
                    ).catch(function (err) {
                        console.error('Failed to send verification email:', err.message);
                    });
                }
            } catch (emailErr) {
                console.error('Warning: verification email failed:', emailErr.message);
            }
        }

        // Send admin notification email (fire-and-forget, never blocks registration)
        try {
            const notifEnabled = await db.getSetting('notify_on_register');
            if (notifEnabled === 'true' && emailService.isConfigured()) {
                const admin = await db.queryOne("SELECT email FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
                if (admin) {
                    emailService.sendRegistrationNotification({
                        display_name: display_name.trim(),
                        email: email.toLowerCase().trim(),
                        timestamp: new Date().toLocaleString(),
                    }, admin.email).catch(function (err) {
                        console.error('Failed to send registration notification:', err.message);
                    });
                }
            }
        } catch (notifErr) {
            console.error('Warning: notification check failed:', notifErr.message);
        }

        // When verification is disabled, auto-login immediately
        if (!verifyEnabled) {
            const token = jwt.sign({ userId: newUserId }, JWT_SECRET, { expiresIn: '7d' });
            return res.status(201).json({
                success: true,
                data: {
                    user: {
                        id: newUserId,
                        email: email.toLowerCase().trim(),
                        display_name: display_name.trim(),
                        role: 'user',
                        country_code: cc,
                    },
                    token,
                },
            });
        }

        // Verification enabled — return masked email and require code entry
        const cleanEmail = email.toLowerCase().trim();
        const atIndex = cleanEmail.indexOf('@');
        const maskedEmail = atIndex > 1
            ? cleanEmail[0] + '***' + cleanEmail.substring(atIndex)
            : cleanEmail;

        res.status(201).json({
            success: true,
            data: {
                needsVerification: true,
                email: maskedEmail,
            },
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/login — Authenticate with email + password
// -------------------------------------------------------------------------
router.post('/login', validate(schemas.login), async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }

        const user = await db.queryOne(
            'SELECT * FROM users WHERE email = $1',
            [email.toLowerCase().trim()]
        );
        if (!user || user.password_hash === NO_PASSWORD_SENTINEL || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        // Check if account is disabled
        if (user.is_disabled) {
            return res.status(403).json({ success: false, error: 'Account disabled. Contact an administrator.', isDisabled: true });
        }

        // Check if email is verified (only when verification is enabled)
        if (isEmailVerificationEnabled() && !user.email_verified) {
            const atIndex = user.email.indexOf('@');
            const maskedEmail = atIndex > 1
                ? user.email[0] + '***' + user.email.substring(atIndex)
                : user.email;
            return res.status(403).json({
                success: false,
                error: 'Please verify your email first',
                needsVerification: true,
                email: maskedEmail,
            });
        }

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

        db.logAuditEvent({
            userId: user.id,
            action: 'user.login',
            entityType: 'user',
            entityId: user.id,
            details: { method: 'password' },
            ipAddress: req.ip,
        });

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    display_name: user.display_name,
                    role: user.role,
                    country_code: user.country_code,
                    unit_preference: user.unit_preference,
                    language_preference: user.language_preference,
                },
                token,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/demo — Start a read-only demo session (no credentials)
// -------------------------------------------------------------------------
router.post('/demo', async (req, res) => {
    try {
        const demoUser = await db.queryOne(
            "SELECT * FROM users WHERE email = 'demo@example.com' AND is_demo = true"
        );

        if (!demoUser) {
            return res.status(503).json({
                success: false,
                error: 'Demo mode is not available',
            });
        }

        // Short-lived token (1 hour instead of the normal 7 days)
        const token = jwt.sign({ userId: demoUser.id }, JWT_SECRET, { expiresIn: '1h' });

        db.logAuditEvent({
            userId: demoUser.id,
            action: 'user.login',
            entityType: 'user',
            entityId: demoUser.id,
            details: { method: 'demo' },
            ipAddress: req.ip,
        });

        res.json({
            success: true,
            data: {
                user: {
                    id: demoUser.id,
                    email: demoUser.email,
                    display_name: demoUser.display_name,
                    role: demoUser.role,
                    country_code: demoUser.country_code,
                    unit_preference: demoUser.unit_preference,
                    language_preference: demoUser.language_preference || 'en',
                    is_demo: true,
                },
                token,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Something went wrong' });
    }
});

// -------------------------------------------------------------------------
// Mount sub-routers for account management and social/passkey auth
// -------------------------------------------------------------------------
router.use('/', require('./auth-account'));
const authSocialRouter = require('./auth-social');
router.use('/', authSocialRouter);
router.use('/', require('./auth-passkey'));

// Re-export _verifyGoogleIdToken for test mocking compatibility
router._verifyGoogleIdToken = authSocialRouter._verifyGoogleIdToken;
Object.defineProperty(router, '_verifyGoogleIdToken', {
    get() { return authSocialRouter._verifyGoogleIdToken; },
    set(fn) { authSocialRouter._verifyGoogleIdToken = fn; },
});

module.exports = router;
