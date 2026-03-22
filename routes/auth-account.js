/**
 * Account management routes: email verification, password reset/change,
 * preferences, /me, account deletion, invite requests.
 * Mounted by auth.js — shares the same /api/auth base path.
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { verifyToken, denyDemoUser, JWT_SECRET } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const sms = require('../services/sms');
const emailService = require('../services/email');

// Sentinel value for users without a password (Google/passkey-only)
const NO_PASSWORD_SENTINEL = '__NO_PASSWORD__';

// POST /api/auth/verify-email — Verify email with 6-digit code
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

// POST /api/auth/resend-verification — Resend verification code
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

// POST /api/auth/forgot-password — Send a reset code via email or SMS
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

// POST /api/auth/reset-password — Reset password using a code or admin token
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

// POST /api/auth/request-invite — Request an invite code (no auth required)
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

// POST /api/auth/change-password — Change or set password (authenticated)
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
        console.error('Change password error:', err);
        res.status(500).json({ success: false, error: 'Failed to change password. Please try again.' });
    }
});

// PUT /api/auth/preferences — Update user preferences
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
        await db.query('UPDATE users SET ' + updates.join(', ') + ' WHERE id = $' + paramIndex, params);

        const user = await db.queryOne(
            'SELECT id, email, display_name, role, country_code, region, unit_preference, language_preference, store_exact_gps, export_obfuscation FROM users WHERE id = $1',
            [req.user.id]
        );

        res.json({ success: true, data: user });
    } catch (err) {
        console.error('Preferences update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update preferences. Please try again.' });
    }
});

// GET /api/auth/me — Get current authenticated user (extended with auth methods)
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
        console.error('Get /me error:', err);
        res.status(500).json({ success: false, error: 'Failed to load user profile.' });
    }
});

// POST /api/auth/delete-account — Self-service account deletion (soft delete)
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
        console.error('Delete account error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete account. Please try again.' });
    }
});

module.exports = router;
