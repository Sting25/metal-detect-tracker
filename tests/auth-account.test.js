const { request, createUser, createGoogleUser, createAdmin } = require('./helpers');
const db = require('../database');
const crypto = require('crypto');

describe('Auth Account Routes', () => {

    // --- POST /api/auth/verify-email ---
    describe('POST /api/auth/verify-email', () => {
        it('verifies email with valid code', async () => {
            const code = '123456';
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            // Create unverified user directly
            const result = await db.query(
                "INSERT INTO users (email, password_hash, display_name, role, email_verified, verification_code, verification_expires_at) VALUES ($1, $2, $3, $4, false, $5, $6) RETURNING id",
                ['unverified@test.com', '$2a$04$fakehashfakehashfakehashfakehashfakehashfakehashfake', 'Unverified User', 'user', code, expiresAt]
            );
            const userId = result.rows[0].id;

            const res = await request()
                .post('/api/auth/verify-email')
                .send({ email: 'unverified@test.com', code });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeTruthy();
            expect(res.body.data.user.email).toBe('unverified@test.com');

            // Verify user is now marked as verified in the DB
            const user = await db.queryOne('SELECT email_verified, verification_code FROM users WHERE id = $1', [userId]);
            expect(user.email_verified).toBe(true);
            expect(user.verification_code).toBeNull();
        });

        it('rejects expired verification code', async () => {
            const code = '654321';
            const expiredAt = new Date(Date.now() - 60 * 1000).toISOString(); // expired 1 min ago
            await db.query(
                "INSERT INTO users (email, password_hash, display_name, role, email_verified, verification_code, verification_expires_at) VALUES ($1, $2, $3, $4, false, $5, $6)",
                ['expired@test.com', '$2a$04$fakehashfakehashfakehashfakehashfakehashfakehashfake', 'Expired User', 'user', code, expiredAt]
            );

            const res = await request()
                .post('/api/auth/verify-email')
                .send({ email: 'expired@test.com', code });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/expired/i);
        });

        it('rejects wrong verification code', async () => {
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            await db.query(
                "INSERT INTO users (email, password_hash, display_name, role, email_verified, verification_code, verification_expires_at) VALUES ($1, $2, $3, $4, false, $5, $6)",
                ['wrongcode@test.com', '$2a$04$fakehashfakehashfakehashfakehashfakehashfakehashfake', 'Wrong Code User', 'user', '111111', expiresAt]
            );

            const res = await request()
                .post('/api/auth/verify-email')
                .send({ email: 'wrongcode@test.com', code: '999999' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/invalid or expired/i);
        });

        it('rejects when email or code is missing', async () => {
            const res = await request()
                .post('/api/auth/verify-email')
                .send({ email: 'test@test.com' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    // --- POST /api/auth/resend-verification ---
    describe('POST /api/auth/resend-verification', () => {
        it('resends verification code for unverified user', async () => {
            await db.query(
                "INSERT INTO users (email, password_hash, display_name, role, email_verified, verification_code) VALUES ($1, $2, $3, $4, false, $5)",
                ['resend@test.com', '$2a$04$fakehashfakehashfakehashfakehashfakehashfakehashfake', 'Resend User', 'user', '000000']
            );

            const res = await request()
                .post('/api/auth/resend-verification')
                .send({ email: 'resend@test.com' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/code has been sent/i);

            // Verify new code was generated
            const user = await db.queryOne("SELECT verification_code, verification_expires_at FROM users WHERE email = 'resend@test.com'");
            expect(user.verification_code).toBeTruthy();
            expect(user.verification_code).not.toBe('000000'); // should be a new code
            expect(user.verification_expires_at).toBeTruthy();
        });

        it('returns success even for already-verified user (prevents enumeration)', async () => {
            await createUser({ email: 'verified@test.com' }); // createUser sets email_verified = true

            const res = await request()
                .post('/api/auth/resend-verification')
                .send({ email: 'verified@test.com' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/code has been sent/i);
        });

        it('returns success for non-existent email (prevents enumeration)', async () => {
            const res = await request()
                .post('/api/auth/resend-verification')
                .send({ email: 'nonexistent@test.com' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    // --- POST /api/auth/change-password ---
    describe('POST /api/auth/change-password', () => {
        it('changes password with correct current password', async () => {
            const { token } = await createUser({ password: 'OldPassword123!' });

            const res = await request()
                .post('/api/auth/change-password')
                .set('Authorization', `Bearer ${token}`)
                .send({ current_password: 'OldPassword123!', new_password: 'NewPassword456!' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/password updated/i);
        });

        it('rejects with wrong current password', async () => {
            const { token } = await createUser({ password: 'OldPassword123!' });

            const res = await request()
                .post('/api/auth/change-password')
                .set('Authorization', `Bearer ${token}`)
                .send({ current_password: 'WrongPassword1!', new_password: 'NewPassword456!' });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/current password is incorrect/i);
        });

        it('allows OAuth-only user to set password without current_password', async () => {
            const { token } = await createGoogleUser();

            const res = await request()
                .post('/api/auth/change-password')
                .set('Authorization', `Bearer ${token}`)
                .send({ new_password: 'BrandNewPass123!' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/password updated/i);
        });

        it('rejects short new password', async () => {
            const { token } = await createUser({ password: 'OldPassword123!' });

            const res = await request()
                .post('/api/auth/change-password')
                .set('Authorization', `Bearer ${token}`)
                .send({ current_password: 'OldPassword123!', new_password: 'Short1a' });

            expect(res.status).toBe(400);
        });

        it('requires authentication', async () => {
            const res = await request()
                .post('/api/auth/change-password')
                .send({ current_password: 'OldPassword123!', new_password: 'NewPassword456!' });

            expect(res.status).toBe(401);
        });
    });

    // --- POST /api/auth/forgot-password ---
    describe('POST /api/auth/forgot-password', () => {
        it('returns success for existing email and stores reset code', async () => {
            const { user } = await createUser({ email: 'forgot@test.com' });

            const res = await request()
                .post('/api/auth/forgot-password')
                .send({ email: 'forgot@test.com' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/reset code has been sent/i);
            expect(res.body.data.channel).toBe('email');

            // Verify reset code was stored
            const dbUser = await db.queryOne('SELECT reset_code, reset_code_expires_at FROM users WHERE id = $1', [user.id]);
            expect(dbUser.reset_code).toBeTruthy();
            expect(dbUser.reset_code).toHaveLength(6);
            expect(dbUser.reset_code_expires_at).toBeTruthy();
        });

        it('returns same success response for non-existent email', async () => {
            const res = await request()
                .post('/api/auth/forgot-password')
                .send({ email: 'nobody@test.com' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/reset code has been sent/i);
        });
    });

    // --- POST /api/auth/reset-password ---
    describe('POST /api/auth/reset-password', () => {
        it('resets password with valid email code', async () => {
            const resetCode = '789012';
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            const { user } = await createUser({ email: 'reset@test.com' });

            await db.query(
                'UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3',
                [resetCode, expiresAt, user.id]
            );

            const res = await request()
                .post('/api/auth/reset-password')
                .send({ email: 'reset@test.com', code: resetCode, password: 'ResetPassword123!' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/password updated/i);

            // Verify reset code was cleared
            const dbUser = await db.queryOne('SELECT reset_code FROM users WHERE id = $1', [user.id]);
            expect(dbUser.reset_code).toBeNull();
        });

        it('rejects expired reset code', async () => {
            const resetCode = '111222';
            const expiredAt = new Date(Date.now() - 60 * 1000).toISOString();
            const { user } = await createUser({ email: 'expiredreset@test.com' });

            await db.query(
                'UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3',
                [resetCode, expiredAt, user.id]
            );

            const res = await request()
                .post('/api/auth/reset-password')
                .send({ email: 'expiredreset@test.com', code: resetCode, password: 'ResetPassword123!' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/expired/i);
        });

        it('rejects invalid reset code', async () => {
            const { user } = await createUser({ email: 'invalidreset@test.com' });

            await db.query(
                'UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3',
                ['333444', new Date(Date.now() + 15 * 60 * 1000).toISOString(), user.id]
            );

            const res = await request()
                .post('/api/auth/reset-password')
                .send({ email: 'invalidreset@test.com', code: '999888', password: 'ResetPassword123!' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/invalid or expired/i);
        });

        it('resets password with valid admin token', async () => {
            const { user } = await createUser({ email: 'tokenreset@test.com' });
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

            await db.query(
                'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
                [user.id, token, expiresAt]
            );

            const res = await request()
                .post('/api/auth/reset-password')
                .send({ token, password: 'TokenResetPass123!' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/password updated/i);
        });

        it('rejects expired admin token', async () => {
            const { user } = await createUser({ email: 'expiredtoken@test.com' });
            const token = crypto.randomBytes(32).toString('hex');
            const expiredAt = new Date(Date.now() - 60 * 1000);

            await db.query(
                'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
                [user.id, token, expiredAt]
            );

            const res = await request()
                .post('/api/auth/reset-password')
                .send({ token, password: 'ExpiredTokenPass1!' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/invalid or expired/i);
        });
    });

});
