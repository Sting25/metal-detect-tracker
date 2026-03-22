/**
 * WebAuthn passkey routes: registration, authentication, and management.
 * Mounted by auth.js — shares the same /api/auth base path.
 */
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../database');
const { verifyToken, denyDemoUser, JWT_SECRET } = require('../middleware/auth');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const NO_PASSWORD_SENTINEL = '__NO_PASSWORD__';
const WEBAUTHN_RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Metal Detector Location Tracker';
const WEBAUTHN_RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const WEBAUTHN_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';

// -------------------------------------------------------------------------
// POST /api/auth/passkey/register-options — Start passkey registration
// -------------------------------------------------------------------------
router.post('/passkey/register-options', verifyToken, denyDemoUser, async (req, res) => {
    try {
        await db.query("DELETE FROM auth_challenges WHERE expires_at < NOW()");

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

        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await db.query(
            'INSERT INTO auth_challenges (user_id, challenge, type, expires_at) VALUES ($1, $2, $3, $4)',
            [req.user.id, options.challenge, 'registration', expiresAt]
        );

        res.json({ success: true, data: options });
    } catch (err) {
        console.error('Passkey register-options error:', err);
        res.status(500).json({ success: false, error: 'Failed to start passkey registration. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/passkey/register-verify — Complete passkey registration
// -------------------------------------------------------------------------
router.post('/passkey/register-verify', verifyToken, denyDemoUser, async (req, res) => {
    try {
        const { credential, display_name } = req.body;
        if (!credential) {
            return res.status(400).json({ success: false, error: 'Credential is required' });
        }

        const challengeRow = await db.queryOne(
            "SELECT * FROM auth_challenges WHERE user_id = $1 AND type = 'registration' AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
            [req.user.id]
        );
        if (!challengeRow) {
            return res.status(400).json({ success: false, error: 'No pending registration challenge. Please try again.' });
        }

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
            console.error('Passkey registration verification error:', verifyErr.message);
            return res.status(400).json({ success: false, error: 'Passkey verification failed. Please try again.' });
        }

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({ success: false, error: 'Passkey verification failed' });
        }

        const { credential: regCred, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
        const credId = typeof regCred.id === 'string' ? regCred.id : Buffer.from(regCred.id).toString('base64url');
        const pubKey = Buffer.isBuffer(regCred.publicKey) ? regCred.publicKey : Buffer.from(regCred.publicKey);
        const transports = credential.response && credential.response.transports
            ? JSON.stringify(credential.response.transports)
            : null;

        await db.query(
            'INSERT INTO passkey_credentials (id, user_id, public_key, counter, device_type, backed_up, transports, display_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [credId, req.user.id, pubKey, regCred.counter || 0, credentialDeviceType || null, credentialBackedUp ? true : false, transports, display_name || 'Passkey']
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
            data: { id: credId, display_name: display_name || 'Passkey', created_at: new Date().toISOString() },
        });
    } catch (err) {
        console.error('Passkey register-verify error:', err);
        res.status(500).json({ success: false, error: 'Failed to register passkey. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/passkey/login-options — Start passkey authentication
// -------------------------------------------------------------------------
router.post('/passkey/login-options', async (req, res) => {
    try {
        await db.query("DELETE FROM auth_challenges WHERE expires_at < NOW()");

        const options = await generateAuthenticationOptions({
            rpID: WEBAUTHN_RP_ID,
            userVerification: 'preferred',
            allowCredentials: [],
        });

        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const result = await db.query(
            'INSERT INTO auth_challenges (user_id, challenge, type, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
            [null, options.challenge, 'authentication', expiresAt]
        );

        res.json({ success: true, data: { ...options, challenge_id: result.rows[0].id } });
    } catch (err) {
        console.error('Passkey login-options error:', err);
        res.status(500).json({ success: false, error: 'Failed to start passkey authentication. Please try again.' });
    }
});

// -------------------------------------------------------------------------
// POST /api/auth/passkey/login-verify — Complete passkey authentication
// -------------------------------------------------------------------------
router.post('/passkey/login-verify', async (req, res) => {
    try {
        const { credential, challenge_id } = req.body;
        if (!credential) {
            return res.status(400).json({ success: false, error: 'Credential is required' });
        }

        const credId = credential.id;
        const storedCred = await db.queryOne('SELECT * FROM passkey_credentials WHERE id = $1', [credId]);
        if (!storedCred) {
            return res.status(401).json({ success: false, error: 'Unknown passkey' });
        }

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
            console.error('Passkey login verification error:', verifyErr.message);
            return res.status(401).json({ success: false, error: 'Passkey verification failed. Please try again.' });
        }

        if (!verification.verified) {
            return res.status(401).json({ success: false, error: 'Passkey verification failed' });
        }

        await db.query(
            "UPDATE passkey_credentials SET counter = $1, last_used_at = NOW() WHERE id = $2",
            [verification.authenticationInfo.newCounter, storedCred.id]
        );

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
        console.error('Passkey login-verify error:', err);
        res.status(500).json({ success: false, error: 'Passkey authentication failed. Please try again.' });
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
        console.error('Passkey list error:', err);
        res.status(500).json({ success: false, error: 'Failed to load passkeys.' });
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

        await db.query('UPDATE passkey_credentials SET display_name = $1 WHERE id = $2', [display_name.trim(), req.params.id]);
        res.json({ success: true, data: { id: req.params.id, display_name: display_name.trim() } });
    } catch (err) {
        console.error('Passkey rename error:', err);
        res.status(500).json({ success: false, error: 'Failed to rename passkey.' });
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

        const user = await db.queryOne('SELECT password_hash, google_id FROM users WHERE id = $1', [req.user.id]);
        const passkeyCountRow = await db.queryOne(
            'SELECT COUNT(*)::int as cnt FROM passkey_credentials WHERE user_id = $1',
            [req.user.id]
        );
        const passkeyCount = parseInt(passkeyCountRow.cnt, 10);
        const hasPassword = user.password_hash && user.password_hash !== NO_PASSWORD_SENTINEL;
        const hasGoogle = !!user.google_id;

        const remainingMethods = (hasPassword ? 1 : 0) + (hasGoogle ? 1 : 0) + (passkeyCount - 1);
        if (remainingMethods < 1) {
            return res.status(400).json({ success: false, error: 'Cannot remove your last sign-in method. Add a password or link Google first.' });
        }

        await db.query('DELETE FROM passkey_credentials WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);

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
        console.error('Passkey delete error:', err);
        res.status(500).json({ success: false, error: 'Failed to remove passkey.' });
    }
});

module.exports = router;
