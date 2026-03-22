/**
 * Google OAuth routes: sign-in, sign-up, account linking.
 * Mounted by auth.js — shares the same /api/auth base path.
 */
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../database');
const { verifyToken, denyDemoUser, JWT_SECRET } = require('../middleware/auth');
const emailService = require('../services/email');
const { OAuth2Client } = require('google-auth-library');

// Sentinel value for users without a password (Google/passkey-only)
const NO_PASSWORD_SENTINEL = '__NO_PASSWORD__';

// Google OAuth — read env vars at request time (not module load) for testability
let _googleClient = null;
let _googleClientId = null;
function getGoogleClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID || null;
    if (clientId && (!_googleClient || _googleClientId !== clientId)) {
        _googleClient = new OAuth2Client(clientId);
        _googleClientId = clientId;
    }
    return clientId ? _googleClient : null;
}
function getGoogleClientId() {
    return process.env.GOOGLE_CLIENT_ID || null;
}

// WebAuthn config — used by /config endpoint for feature detection
const WEBAUTHN_RP_ID = process.env.WEBAUTHN_RP_ID || '';

/**
 * Verify a Google ID token. Extracted for testability — tests can override
 * router._verifyGoogleIdToken to avoid needing to mock the google-auth-library module.
 */
async function verifyGoogleIdToken(idToken) {
    const client = getGoogleClient();
    if (!client) return null;
    const ticket = await client.verifyIdToken({
        idToken: idToken,
        audience: getGoogleClientId(),
    });
    return ticket.getPayload();
}
// Allow tests to replace the verifier
router._verifyGoogleIdToken = verifyGoogleIdToken;

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
        console.error('Google sign-in error:', err);
        res.status(500).json({ success: false, error: 'Google sign-in failed. Please try again.' });
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
        console.error('Google link error:', err);
        res.status(500).json({ success: false, error: 'Failed to link Google account. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// DELETE /api/auth/google/link — Unlink Google account
// -------------------------------------------------------------------------
router.delete('/google/link', verifyToken, denyDemoUser, async (req, res) => {
    try {
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
        console.error('Google unlink error:', err);
        res.status(500).json({ success: false, error: 'Failed to unlink Google account. Please try again.' });
    }
});

module.exports = router;
