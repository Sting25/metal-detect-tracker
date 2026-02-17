/**
 * Authentication routes: setup, register, login, Google OAuth, WebAuthn passkeys
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../database');
const { verifyToken, denyDemoUser, JWT_SECRET } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const sms = require('../services/sms');
const emailService = require('../services/email');
const { OAuth2Client } = require('google-auth-library');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

// Email verification toggle — set EMAIL_VERIFICATION_ENABLED=true in ecosystem.config.js to require verification
function isEmailVerificationEnabled() {
    return process.env.EMAIL_VERIFICATION_ENABLED === 'true';
}

// Google OAuth — read env vars at request time (not module load) for testability
var _googleClient = null;
var _googleClientId = null;
function getGoogleClient() {
    var clientId = process.env.GOOGLE_CLIENT_ID || null;
    if (clientId && (!_googleClient || _googleClientId !== clientId)) {
        _googleClient = new OAuth2Client(clientId);
        _googleClientId = clientId;
    }
    return clientId ? _googleClient : null;
}
function getGoogleClientId() {
    return process.env.GOOGLE_CLIENT_ID || null;
}

/**
 * Verify a Google ID token. Extracted for testability — tests can override
 * router._verifyGoogleIdToken to avoid needing to mock the google-auth-library module.
 */
async function verifyGoogleIdToken(idToken) {
    var client = getGoogleClient();
    if (!client) return null;
    var ticket = await client.verifyIdToken({
        idToken: idToken,
        audience: getGoogleClientId(),
    });
    return ticket.getPayload();
}
// Allow tests to replace the verifier
router._verifyGoogleIdToken = verifyGoogleIdToken;

// WebAuthn config
const WEBAUTHN_RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Metal Detector Location Tracker';
const WEBAUTHN_RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const WEBAUTHN_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';

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
        res.status(500).json({ success: false, error: err.message });
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
        res.status(500).json({ success: false, error: err.message });
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
        res.status(500).json({ success: false, error: err.message });
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
        res.status(500).json({ success: false, error: err.message });
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
// POST /api/auth/verify-email — Verify email with 6-digit code
// -------------------------------------------------------------------------
router.post('/verify-email', async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ success: false, error: 'Email and verification code are required' });
        }

        const user = await db.queryOne(
            'SELECT * FROM users WHERE email = $1 AND email_verified = false',
            [email.toLowerCase().trim()]
        );

        if (!user) {
            return res.status(400).json({ success: false, error: 'Invalid or expired verification code' });
        }

        // Check code matches
        if (user.verification_code !== code.trim()) {
            return res.status(400).json({ success: false, error: 'Invalid or expired verification code' });
        }

        // Check expiration
        if (user.verification_expires_at && new Date(user.verification_expires_at) < new Date()) {
            return res.status(400).json({ success: false, error: 'Verification code has expired. Please request a new one.' });
        }

        // Mark as verified and clear code
        await db.query(
            'UPDATE users SET email_verified = true, verification_code = NULL, verification_expires_at = NULL WHERE id = $1',
            [user.id]
        );

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        const verifiedUser = await db.queryOne(
            'SELECT id, email, display_name, role, country_code, region, unit_preference, language_preference FROM users WHERE id = $1',
            [user.id]
        );

        res.json({ success: true, data: { user: verifiedUser, token } });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/resend-verification — Resend verification code
// -------------------------------------------------------------------------
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const user = await db.queryOne(
            'SELECT id, email, display_name FROM users WHERE email = $1 AND email_verified = false',
            [email.toLowerCase().trim()]
        );

        // Always return success to prevent email enumeration
        if (!user) {
            return res.json({ success: true, data: { message: 'If an unverified account exists, a new code has been sent.' } });
        }

        // Generate new code
        const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        await db.query(
            'UPDATE users SET verification_code = $1, verification_expires_at = $2 WHERE id = $3',
            [verificationCode, expiresAt, user.id]
        );

        // Send verification email (fire-and-forget)
        try {
            if (emailService.isConfigured()) {
                emailService.sendVerificationEmail(
                    user.email,
                    user.display_name,
                    verificationCode
                ).catch(function (err) {
                    console.error('Failed to resend verification email:', err.message);
                });
            }
        } catch (emailErr) {
            console.error('Warning: resend verification email failed:', emailErr.message);
        }

        res.json({ success: true, data: { message: 'If an unverified account exists, a new code has been sent.' } });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/forgot-password — Send a reset code via email or SMS
// -------------------------------------------------------------------------
router.post('/forgot-password', validate(schemas.forgotPassword), async (req, res) => {
    try {
        const { email, channel } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const useChannel = channel || 'email'; // default to email
        const user = await db.queryOne(
            'SELECT id, email, display_name, phone FROM users WHERE email = $1 AND deleted_at IS NULL',
            [email.toLowerCase().trim()]
        );

        // Always return success to not reveal if email exists
        if (!user) {
            return res.json({
                success: true,
                data: { message: 'If an account with that email exists, a reset code has been sent.', channel: useChannel },
            });
        }

        if (useChannel === 'phone') {
            // SMS flow via Twilio Verify
            if (!user.phone) {
                return res.json({
                    success: true,
                    data: { message: 'If an account with that email exists and has a phone number, a reset code has been sent.', channel: 'phone' },
                });
            }
            if (!sms.isConfigured()) {
                return res.status(503).json({ success: false, error: 'SMS service is not configured. Contact your admin.' });
            }

            const result = await sms.sendVerification(user.phone);
            if (!result.success) {
                console.error('Failed to send SMS verification:', result.error);
            }

            const maskedPhone = user.phone.replace(/(\+?\d{1,3})\d+(\d{4})/, '$1****$2');
            return res.json({
                success: true,
                data: {
                    message: 'If an account with that email exists and has a phone number, a reset code has been sent.',
                    channel: 'phone',
                    maskedPhone: maskedPhone,
                },
            });
        }

        // Email flow — generate 6-digit code, store it, then attempt to send
        const resetCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

        await db.query(
            'UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3',
            [resetCode, expiresAt, user.id]
        );

        // Send email (fire-and-forget — never block the response)
        try {
            if (emailService.isConfigured()) {
                emailService.sendPasswordResetEmail(
                    user.email,
                    user.display_name || user.email,
                    resetCode
                ).catch(function (err) {
                    console.error('Failed to send password reset email:', err.message);
                });
            }
        } catch (emailErr) {
            console.error('Warning: password reset email failed:', emailErr.message);
        }

        // Mask email for display
        const atIndex = user.email.indexOf('@');
        const maskedEmail = atIndex > 1
            ? user.email[0] + '***' + user.email.substring(atIndex)
            : user.email;

        res.json({
            success: true,
            data: {
                message: 'If an account with that email exists, a reset code has been sent.',
                channel: 'email',
                maskedEmail: maskedEmail,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/reset-password — Reset password using a code or admin token
// -------------------------------------------------------------------------
router.post('/reset-password', validate(schemas.resetPassword), async (req, res) => {
    try {
        const { token, code, email, password } = req.body;

        if (!password) {
            return res.status(400).json({ success: false, error: 'New password is required' });
        }
        if (password.length < 12) {
            return res.status(400).json({ success: false, error: 'Password must be at least 12 characters' });
        }

        // Admin token flow (from admin-generated reset links)
        if (token) {
            const reset = await db.queryOne(
                "SELECT * FROM password_resets WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()",
                [token]
            );

            if (!reset) {
                return res.status(400).json({ success: false, error: 'Invalid or expired reset link' });
            }

            const hash = bcrypt.hashSync(password, 10);
            await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, reset.user_id]);
            await db.query("UPDATE password_resets SET used_at = NOW() WHERE id = $1", [reset.id]);

            return res.json({ success: true, data: { message: 'Password updated successfully' } });
        }

        // Code flow (email or SMS)
        if (code && email) {
            const channel = req.body.channel || 'email'; // default to email
            const user = await db.queryOne(
                'SELECT id, phone, reset_code, reset_code_expires_at FROM users WHERE email = $1 AND deleted_at IS NULL',
                [email.toLowerCase().trim()]
            );
            if (!user) {
                return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
            }

            if (channel === 'phone') {
                // Verify via Twilio
                if (!user.phone) {
                    return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
                }
                const result = await sms.checkVerification(user.phone, code);
                if (!result.success || !result.valid) {
                    return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
                }
            } else {
                // Verify email code stored in DB
                if (!user.reset_code || user.reset_code !== code.trim()) {
                    return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
                }
                if (user.reset_code_expires_at && new Date(user.reset_code_expires_at) < new Date()) {
                    return res.status(400).json({ success: false, error: 'Reset code has expired. Please request a new one.' });
                }
            }

            const hash = bcrypt.hashSync(password, 10);
            await db.query('UPDATE users SET password_hash = $1, reset_code = NULL, reset_code_expires_at = NULL WHERE id = $2', [hash, user.id]);

            return res.json({ success: true, data: { message: 'Password updated successfully' } });
        }

        return res.status(400).json({ success: false, error: 'Reset code and new password are required' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/request-invite — Request an invite code (no auth required)
// -------------------------------------------------------------------------
router.post('/request-invite', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        if (!name || !email) {
            return res.status(400).json({ success: false, error: 'Name and email are required' });
        }

        const cleanEmail = email.toLowerCase().trim();
        const cleanName = name.trim();

        // Check for duplicate pending requests
        const existing = await db.queryOne(
            "SELECT id FROM invite_requests WHERE email = $1 AND status = 'pending'",
            [cleanEmail]
        );
        if (existing) {
            // Don't reveal that a request exists, just return success
            return res.json({ success: true, data: { message: 'Request submitted. You will receive an email if approved.' } });
        }

        // Insert the request
        await db.query(
            'INSERT INTO invite_requests (name, email, message) VALUES ($1, $2, $3)',
            [cleanName, cleanEmail, message ? message.trim() : null]
        );

        // Send admin notification email (fire-and-forget)
        try {
            if (emailService.isConfigured()) {
                const admin = await db.queryOne("SELECT email FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
                if (admin) {
                    emailService.sendInviteRequestNotification({
                        name: cleanName,
                        email: cleanEmail,
                        message: message ? message.trim() : null,
                    }, admin.email).catch(function (err) {
                        console.error('Failed to send invite request notification:', err.message);
                    });
                }
            }
        } catch (notifErr) {
            console.error('Warning: invite request notification failed:', notifErr.message);
        }

        res.json({ success: true, data: { message: 'Request submitted. You will receive an email if approved.' } });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/change-password — Change or set password (authenticated)
// -------------------------------------------------------------------------
router.post('/change-password', verifyToken, denyDemoUser, validate(schemas.changePassword), async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!new_password || new_password.length < 12) {
            return res.status(400).json({ success: false, error: 'New password must be at least 12 characters' });
        }

        const user = await db.queryOne('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        const hasPassword = user.password_hash && user.password_hash !== NO_PASSWORD_SENTINEL;

        // If user has a password, require current password
        if (hasPassword) {
            if (!current_password) {
                return res.status(400).json({ success: false, error: 'Current password is required' });
            }
            if (!bcrypt.compareSync(current_password, user.password_hash)) {
                return res.status(401).json({ success: false, error: 'Current password is incorrect' });
            }
        }

        const hash = bcrypt.hashSync(new_password, 10);
        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

        db.logAuditEvent({
            userId: req.user.id,
            action: 'user.password_change',
            entityType: 'user',
            entityId: req.user.id,
            details: {},
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { message: 'Password updated successfully' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// PUT /api/auth/preferences — Update user preferences
// -------------------------------------------------------------------------
router.put('/preferences', verifyToken, denyDemoUser, async (req, res) => {
    try {
        const { unit_preference, country_code, region, language_preference, store_exact_gps, export_obfuscation } = req.body;

        if (unit_preference && !['metric', 'imperial'].includes(unit_preference)) {
            return res.status(400).json({ success: false, error: 'unit_preference must be "metric" or "imperial"' });
        }
        if (language_preference && !['en', 'es', 'fr'].includes(language_preference)) {
            return res.status(400).json({ success: false, error: 'language_preference must be "en", "es", or "fr"' });
        }
        if (export_obfuscation !== undefined && !['none', 'rounded_1km', 'rounded_10km', 'no_coords'].includes(export_obfuscation)) {
            return res.status(400).json({ success: false, error: 'export_obfuscation must be "none", "rounded_1km", "rounded_10km", or "no_coords"' });
        }
        if (store_exact_gps !== undefined && typeof store_exact_gps !== 'boolean') {
            return res.status(400).json({ success: false, error: 'store_exact_gps must be a boolean' });
        }

        // Build dynamic update
        const updates = [];
        const params = [];
        let paramIndex = 1;
        if (unit_preference) { updates.push(`unit_preference = $${paramIndex++}`); params.push(unit_preference); }
        if (country_code !== undefined) { updates.push(`country_code = $${paramIndex++}`); params.push(country_code); }
        if (region !== undefined) { updates.push(`region = $${paramIndex++}`); params.push(region); }
        if (language_preference) { updates.push(`language_preference = $${paramIndex++}`); params.push(language_preference); }
        if (store_exact_gps !== undefined) { updates.push(`store_exact_gps = $${paramIndex++}`); params.push(store_exact_gps); }
        if (export_obfuscation !== undefined) { updates.push(`export_obfuscation = $${paramIndex++}`); params.push(export_obfuscation); }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No valid fields to update' });
        }

        params.push(req.user.id);
        await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);

        const user = await db.queryOne(
            'SELECT id, email, display_name, role, country_code, region, unit_preference, language_preference, store_exact_gps, export_obfuscation FROM users WHERE id = $1',
            [req.user.id]
        );

        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// GET /api/auth/me — Get current authenticated user (extended with auth methods)
// -------------------------------------------------------------------------
router.get('/me', verifyToken, async (req, res) => {
    try {
        const fullUser = await db.queryOne(
            'SELECT id, email, display_name, role, country_code, region, unit_preference, language_preference, store_exact_gps, export_obfuscation, password_hash, google_id, is_demo FROM users WHERE id = $1',
            [req.user.id]
        );
        if (!fullUser) {
            return res.status(401).json({ success: false, error: 'User not found' });
        }

        const passkeys = (await db.query(
            'SELECT id, display_name, created_at, last_used_at, device_type, backed_up FROM passkey_credentials WHERE user_id = $1',
            [req.user.id]
        )).rows;

        res.json({
            success: true,
            data: {
                id: fullUser.id,
                email: fullUser.email,
                display_name: fullUser.display_name,
                role: fullUser.role,
                country_code: fullUser.country_code,
                region: fullUser.region,
                unit_preference: fullUser.unit_preference,
                language_preference: fullUser.language_preference,
                store_exact_gps: fullUser.store_exact_gps,
                export_obfuscation: fullUser.export_obfuscation,
                has_password: !!fullUser.password_hash && fullUser.password_hash !== NO_PASSWORD_SENTINEL,
                has_google: !!fullUser.google_id,
                passkeys: passkeys,
                is_demo: !!fullUser.is_demo,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/delete-account — Self-service account deletion (soft delete)
// -------------------------------------------------------------------------
router.post('/delete-account', verifyToken, denyDemoUser, async (req, res) => {
    try {
        const { confirmation } = req.body;
        if (confirmation !== 'DELETE') {
            return res.status(400).json({ success: false, error: 'You must send confirmation: "DELETE" to delete your account' });
        }

        await db.transaction(async (client) => {
            // Soft-delete: anonymize user record
            await client.query(
                "UPDATE users SET deleted_at = NOW(), email = 'deleted_' || id || '@deleted', display_name = 'Deleted User', google_id = NULL WHERE id = $1",
                [req.user.id]
            );
            // Remove passkeys
            await client.query('DELETE FROM passkey_credentials WHERE user_id = $1', [req.user.id]);
            // Revoke all site shares (owned or shared-with)
            await client.query('DELETE FROM site_shares WHERE owner_id = $1 OR shared_with_id = $1', [req.user.id]);
            // Remove auth challenges
            await client.query('DELETE FROM auth_challenges WHERE user_id = $1', [req.user.id]);
        });

        db.logAuditEvent({
            userId: req.user.id,
            action: 'account.delete',
            entityType: 'user',
            entityId: req.user.id,
            ipAddress: req.ip,
        });

        res.json({ success: true, message: 'Account scheduled for deletion' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// GET /api/auth/config — Public config for frontend feature detection
// -------------------------------------------------------------------------
router.get('/config', (req, res) => {
    res.json({
        success: true,
        data: {
            google_client_id: getGoogleClientId(),
            webauthn_enabled: !!WEBAUTHN_RP_ID,
        },
    });
});

// -------------------------------------------------------------------------
// POST /api/auth/google — Google OAuth sign-in / sign-up
// -------------------------------------------------------------------------
router.post('/google', async (req, res) => {
    try {
        if (!getGoogleClient()) {
            return res.status(503).json({ success: false, error: 'Google sign-in is not configured' });
        }

        const { id_token, terms_accepted } = req.body;
        if (!id_token) {
            return res.status(400).json({ success: false, error: 'ID token is required' });
        }

        // Verify the Google ID token
        let payload;
        try {
            payload = await router._verifyGoogleIdToken(id_token);
        } catch (verifyErr) {
            return res.status(401).json({ success: false, error: 'Invalid Google token' });
        }

        const googleId = payload.sub;
        const googleEmail = (payload.email || '').toLowerCase().trim();
        const googleName = payload.name || googleEmail.split('@')[0];

        // 1. Check if user exists with this google_id
        let user = await db.queryOne('SELECT * FROM users WHERE google_id = $1', [googleId]);
        if (user) {
            if (user.is_disabled) {
                return res.status(403).json({ success: false, error: 'Account disabled. Contact an administrator.', isDisabled: true });
            }
            const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
            return res.json({
                success: true,
                data: {
                    user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role, country_code: user.country_code, unit_preference: user.unit_preference, language_preference: user.language_preference },
                    token,
                },
            });
        }

        // 2. Check if user exists with same email — require explicit linking
        //    Don't auto-link to prevent account takeover. Ask user to log in
        //    with their existing credentials and link via /google/link instead.
        user = await db.queryOne('SELECT * FROM users WHERE email = $1', [googleEmail]);
        if (user) {
            return res.json({
                success: true,
                data: {
                    needsLink: true,
                    message: 'An account with this email already exists. Please log in with your password first, then link your Google account from Account settings.',
                },
            });
        }

        // 3. New user — require terms acceptance
        if (!terms_accepted) {
            return res.json({
                success: true,
                data: {
                    needsTerms: true,
                    google_name: googleName,
                    google_email: googleEmail,
                },
            });
        }

        // 4. Create new user
        const termsAcceptedAt = new Date().toISOString();
        const result = await db.query(
            'INSERT INTO users (email, password_hash, display_name, role, email_verified, google_id, terms_accepted_at, country_code) VALUES ($1, $2, $3, $4, true, $5, $6, $7) RETURNING id',
            [googleEmail, NO_PASSWORD_SENTINEL, googleName, 'user', googleId, termsAcceptedAt, 'US']
        );

        const newUserId = result.rows[0].id;

        // Seed sites
        try {
            await db.insertSeedSites(newUserId, 'US');
        } catch (seedErr) {
            console.error('Warning: failed to insert seed sites for Google user:', seedErr.message);
        }

        // Admin notification
        try {
            const notifEnabled = await db.getSetting('notify_on_register');
            if (notifEnabled === 'true' && emailService.isConfigured()) {
                const admin = await db.queryOne("SELECT email FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
                if (admin) {
                    emailService.sendRegistrationNotification({
                        display_name: googleName,
                        email: googleEmail,
                        timestamp: new Date().toLocaleString(),
                    }, admin.email).catch(function (err) {
                        console.error('Failed to send registration notification:', err.message);
                    });
                }
            }
        } catch (notifErr) {
            console.error('Warning: notification check failed:', notifErr.message);
        }

        const newUser = await db.queryOne(
            'SELECT id, email, display_name, role, country_code, unit_preference, language_preference FROM users WHERE id = $1',
            [newUserId]
        );
        const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({ success: true, data: { user: newUser, token } });
    } catch (err) {
        if (err.message && err.message.includes('unique')) {
            return res.status(400).json({ success: false, error: 'This Google account is already linked to another user' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/google/link — Link Google account to current user
// -------------------------------------------------------------------------
router.post('/google/link', verifyToken, denyDemoUser, async (req, res) => {
    try {
        if (!getGoogleClient()) {
            return res.status(503).json({ success: false, error: 'Google sign-in is not configured' });
        }

        const { id_token } = req.body;
        if (!id_token) {
            return res.status(400).json({ success: false, error: 'ID token is required' });
        }

        let payload;
        try {
            payload = await router._verifyGoogleIdToken(id_token);
        } catch (verifyErr) {
            return res.status(401).json({ success: false, error: 'Invalid Google token' });
        }

        const googleId = payload.sub;

        // Check if this Google ID is already linked to another user
        const existing = await db.queryOne(
            'SELECT id FROM users WHERE google_id = $1 AND id != $2',
            [googleId, req.user.id]
        );
        if (existing) {
            return res.status(400).json({ success: false, error: 'This Google account is already linked to another user' });
        }

        await db.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, req.user.id]);

        db.logAuditEvent({
            userId: req.user.id,
            action: 'user.google_link',
            entityType: 'user',
            entityId: req.user.id,
            details: {},
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { message: 'Google account linked' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// DELETE /api/auth/google/link — Unlink Google account
// -------------------------------------------------------------------------
router.delete('/google/link', verifyToken, denyDemoUser, async (req, res) => {
    try {
        // Check user has another auth method before unlinking
        const user = await db.queryOne(
            'SELECT password_hash, google_id FROM users WHERE id = $1',
            [req.user.id]
        );
        const passkeyCountRow = await db.queryOne(
            'SELECT COUNT(*)::int as cnt FROM passkey_credentials WHERE user_id = $1',
            [req.user.id]
        );
        const passkeyCount = parseInt(passkeyCountRow.cnt, 10);
        const hasPassword = user.password_hash && user.password_hash !== NO_PASSWORD_SENTINEL;

        if (!hasPassword && passkeyCount === 0) {
            return res.status(400).json({ success: false, error: 'Cannot remove your last sign-in method. Add a password or passkey first.' });
        }

        await db.query('UPDATE users SET google_id = NULL WHERE id = $1', [req.user.id]);

        db.logAuditEvent({
            userId: req.user.id,
            action: 'user.google_unlink',
            entityType: 'user',
            entityId: req.user.id,
            details: {},
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { message: 'Google account unlinked' } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// WebAuthn Passkey — Registration (authenticated)
// -------------------------------------------------------------------------
router.post('/passkey/register-options', verifyToken, denyDemoUser, async (req, res) => {
    try {
        // Clean up expired challenges
        await db.query("DELETE FROM auth_challenges WHERE expires_at < NOW()");

        // Get existing passkeys to exclude
        const existingCreds = (await db.query(
            'SELECT id, transports FROM passkey_credentials WHERE user_id = $1',
            [req.user.id]
        )).rows;

        const excludeCredentials = existingCreds.map(cred => ({
            id: cred.id,
            transports: cred.transports ? JSON.parse(cred.transports) : undefined,
        }));

        const options = await generateRegistrationOptions({
            rpName: WEBAUTHN_RP_NAME,
            rpID: WEBAUTHN_RP_ID,
            userID: new TextEncoder().encode(String(req.user.id)),
            userName: req.user.email,
            userDisplayName: req.user.display_name || req.user.email,
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
            excludeCredentials,
        });

        // Store challenge
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await db.query(
            'INSERT INTO auth_challenges (user_id, challenge, type, expires_at) VALUES ($1, $2, $3, $4)',
            [req.user.id, options.challenge, 'registration', expiresAt]
        );

        res.json({ success: true, data: options });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/passkey/register-verify', verifyToken, denyDemoUser, async (req, res) => {
    try {
        const { credential, display_name } = req.body;
        if (!credential) {
            return res.status(400).json({ success: false, error: 'Credential is required' });
        }

        // Atomically fetch and delete the most recent registration challenge (single-use)
        const challengeRow = await db.queryOne(
            "SELECT * FROM auth_challenges WHERE user_id = $1 AND type = 'registration' AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
            [req.user.id]
        );

        if (!challengeRow) {
            return res.status(400).json({ success: false, error: 'No pending registration challenge. Please try again.' });
        }

        // Delete immediately to prevent reuse (single-use challenge)
        await db.query('DELETE FROM auth_challenges WHERE id = $1', [challengeRow.id]);

        let verification;
        try {
            verification = await verifyRegistrationResponse({
                response: credential,
                expectedChallenge: challengeRow.challenge,
                expectedOrigin: WEBAUTHN_ORIGIN,
                expectedRPID: WEBAUTHN_RP_ID,
            });
        } catch (verifyErr) {
            return res.status(400).json({ success: false, error: 'Passkey verification failed: ' + verifyErr.message });
        }

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({ success: false, error: 'Passkey verification failed' });
        }

        const { credential: regCred, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

        // Store the credential
        const credId = typeof regCred.id === 'string' ? regCred.id : Buffer.from(regCred.id).toString('base64url');
        const pubKey = Buffer.isBuffer(regCred.publicKey) ? regCred.publicKey : Buffer.from(regCred.publicKey);
        const transports = credential.response && credential.response.transports
            ? JSON.stringify(credential.response.transports)
            : null;

        await db.query(
            'INSERT INTO passkey_credentials (id, user_id, public_key, counter, device_type, backed_up, transports, display_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [
                credId,
                req.user.id,
                pubKey,
                regCred.counter || 0,
                credentialDeviceType || null,
                credentialBackedUp ? true : false,
                transports,
                display_name || 'Passkey'
            ]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'user.passkey_add',
            entityType: 'user',
            entityId: req.user.id,
            details: { passkey_id: credId },
            ipAddress: req.ip,
        });

        res.status(201).json({
            success: true,
            data: {
                id: credId,
                display_name: display_name || 'Passkey',
                created_at: new Date().toISOString(),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// WebAuthn Passkey — Authentication (no auth required)
// -------------------------------------------------------------------------
router.post('/passkey/login-options', async (req, res) => {
    try {
        // Clean up expired challenges
        await db.query("DELETE FROM auth_challenges WHERE expires_at < NOW()");

        const options = await generateAuthenticationOptions({
            rpID: WEBAUTHN_RP_ID,
            userVerification: 'preferred',
            // Empty allowCredentials = discoverable credential / conditional UI
            allowCredentials: [],
        });

        // Store challenge
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const result = await db.query(
            'INSERT INTO auth_challenges (user_id, challenge, type, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
            [null, options.challenge, 'authentication', expiresAt]
        );

        res.json({
            success: true,
            data: { ...options, challenge_id: result.rows[0].id },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/passkey/login-verify', async (req, res) => {
    try {
        const { credential, challenge_id } = req.body;
        if (!credential) {
            return res.status(400).json({ success: false, error: 'Credential is required' });
        }

        // Look up the credential in our database
        const credId = credential.id;
        const storedCred = await db.queryOne('SELECT * FROM passkey_credentials WHERE id = $1', [credId]);
        if (!storedCred) {
            return res.status(401).json({ success: false, error: 'Unknown passkey' });
        }

        // Get the challenge (either by ID or most recent auth challenge)
        let challengeRow;
        if (challenge_id) {
            challengeRow = await db.queryOne(
                "SELECT * FROM auth_challenges WHERE id = $1 AND type = 'authentication' AND expires_at > NOW()",
                [challenge_id]
            );
        } else {
            challengeRow = await db.queryOne(
                "SELECT * FROM auth_challenges WHERE type = 'authentication' AND expires_at > NOW() ORDER BY id DESC LIMIT 1"
            );
        }

        if (!challengeRow) {
            return res.status(400).json({ success: false, error: 'No pending authentication challenge. Please try again.' });
        }

        // Delete immediately to prevent reuse (single-use challenge)
        await db.query('DELETE FROM auth_challenges WHERE id = $1', [challengeRow.id]);

        let verification;
        try {
            verification = await verifyAuthenticationResponse({
                response: credential,
                expectedChallenge: challengeRow.challenge,
                expectedOrigin: WEBAUTHN_ORIGIN,
                expectedRPID: WEBAUTHN_RP_ID,
                credential: {
                    id: storedCred.id,
                    publicKey: storedCred.public_key,
                    counter: storedCred.counter,
                    transports: storedCred.transports ? JSON.parse(storedCred.transports) : undefined,
                },
            });
        } catch (verifyErr) {
            return res.status(401).json({ success: false, error: 'Passkey verification failed: ' + verifyErr.message });
        }

        if (!verification.verified) {
            return res.status(401).json({ success: false, error: 'Passkey verification failed' });
        }

        // Update counter and last_used_at
        await db.query(
            "UPDATE passkey_credentials SET counter = $1, last_used_at = NOW() WHERE id = $2",
            [verification.authenticationInfo.newCounter, storedCred.id]
        );

        // Get the user and generate JWT
        const user = await db.queryOne(
            'SELECT id, email, display_name, role, country_code, unit_preference, language_preference, is_disabled FROM users WHERE id = $1',
            [storedCred.user_id]
        );

        if (!user) {
            return res.status(401).json({ success: false, error: 'User not found' });
        }
        if (user.is_disabled) {
            return res.status(403).json({ success: false, error: 'Account disabled. Contact an administrator.', isDisabled: true });
        }

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

        db.logAuditEvent({
            userId: user.id,
            action: 'user.login',
            entityType: 'user',
            entityId: user.id,
            details: { method: 'passkey' },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { user, token } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------------------
// Passkey Management (authenticated)
// -------------------------------------------------------------------------
router.get('/passkeys', verifyToken, async (req, res) => {
    try {
        const passkeys = (await db.query(
            'SELECT id, display_name, created_at, last_used_at, device_type, backed_up FROM passkey_credentials WHERE user_id = $1',
            [req.user.id]
        )).rows;
        res.json({ success: true, data: passkeys });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/passkeys/:id', verifyToken, denyDemoUser, async (req, res) => {
    try {
        const { display_name } = req.body;
        if (!display_name || !display_name.trim()) {
            return res.status(400).json({ success: false, error: 'Display name is required' });
        }

        const passkey = await db.queryOne(
            'SELECT * FROM passkey_credentials WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!passkey) {
            return res.status(404).json({ success: false, error: 'Passkey not found' });
        }

        await db.query(
            'UPDATE passkey_credentials SET display_name = $1 WHERE id = $2',
            [display_name.trim(), req.params.id]
        );
        res.json({ success: true, data: { id: req.params.id, display_name: display_name.trim() } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/passkeys/:id', verifyToken, denyDemoUser, async (req, res) => {
    try {
        const passkey = await db.queryOne(
            'SELECT * FROM passkey_credentials WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!passkey) {
            return res.status(404).json({ success: false, error: 'Passkey not found' });
        }

        // Check user has another auth method before deleting
        const user = await db.queryOne(
            'SELECT password_hash, google_id FROM users WHERE id = $1',
            [req.user.id]
        );
        const passkeyCountRow = await db.queryOne(
            'SELECT COUNT(*)::int as cnt FROM passkey_credentials WHERE user_id = $1',
            [req.user.id]
        );
        const passkeyCount = parseInt(passkeyCountRow.cnt, 10);
        const hasPassword = user.password_hash && user.password_hash !== NO_PASSWORD_SENTINEL;
        const hasGoogle = !!user.google_id;

        // After deleting this passkey, do they still have at least one method?
        const remainingMethods = (hasPassword ? 1 : 0) + (hasGoogle ? 1 : 0) + (passkeyCount - 1);
        if (remainingMethods < 1) {
            return res.status(400).json({ success: false, error: 'Cannot remove your last sign-in method. Add a password or link Google first.' });
        }

        await db.query(
            'DELETE FROM passkey_credentials WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'user.passkey_remove',
            entityType: 'user',
            entityId: req.user.id,
            details: { passkey_id: req.params.id },
            ipAddress: req.ip,
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
