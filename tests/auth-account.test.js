const { request, createUser, createGoogleUser, createAdmin, createDemoUser } = require('./helpers');
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

        it('allows OAuth-only user to set password with valid verification code', async () => {
            const { user, token } = await createGoogleUser();

            // Simulate a verification code being sent
            const code = '123456';
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            await db.query('UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3', [code, expiresAt, user.id]);

            const res = await request()
                .post('/api/auth/change-password')
                .set('Authorization', `Bearer ${token}`)
                .send({ new_password: 'BrandNewPass123!', verification_code: code });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/password updated/i);

            // Verify reset_code was cleared
            const dbUser = await db.queryOne('SELECT reset_code FROM users WHERE id = $1', [user.id]);
            expect(dbUser.reset_code).toBeNull();
        });

        it('rejects OAuth-only user setting password without verification code', async () => {
            const { token } = await createGoogleUser();

            const res = await request()
                .post('/api/auth/change-password')
                .set('Authorization', `Bearer ${token}`)
                .send({ new_password: 'BrandNewPass123!' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/verification code is required/i);
        });

        it('rejects OAuth-only user with wrong verification code', async () => {
            const { user, token } = await createGoogleUser();
            const code = '123456';
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            await db.query('UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3', [code, expiresAt, user.id]);

            const res = await request()
                .post('/api/auth/change-password')
                .set('Authorization', `Bearer ${token}`)
                .send({ new_password: 'BrandNewPass123!', verification_code: '999999' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/invalid or expired/i);
        });

        it('rejects OAuth-only user with expired verification code', async () => {
            const { user, token } = await createGoogleUser();
            const code = '123456';
            const expiredAt = new Date(Date.now() - 60 * 1000).toISOString(); // expired 1 min ago
            await db.query('UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3', [code, expiredAt, user.id]);

            const res = await request()
                .post('/api/auth/change-password')
                .set('Authorization', `Bearer ${token}`)
                .send({ new_password: 'BrandNewPass123!', verification_code: code });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/expired/i);
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

    // --- POST /api/auth/send-set-password-code ---
    describe('POST /api/auth/send-set-password-code', () => {
        it('sends verification code for OAuth-only user', async () => {
            const { user, token } = await createGoogleUser();

            const res = await request()
                .post('/api/auth/send-set-password-code')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/verification code sent/i);

            // Verify code was stored
            const dbUser = await db.queryOne('SELECT reset_code, reset_code_expires_at FROM users WHERE id = $1', [user.id]);
            expect(dbUser.reset_code).toBeTruthy();
            expect(dbUser.reset_code).toHaveLength(6);
            expect(dbUser.reset_code_expires_at).toBeTruthy();
        });

        it('rejects if user already has a password', async () => {
            const { token } = await createUser({ password: 'ExistingPass123!' });

            const res = await request()
                .post('/api/auth/send-set-password-code')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/already has a password/i);
        });

        it('requires authentication', async () => {
            const res = await request()
                .post('/api/auth/send-set-password-code');

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

// --- GET /api/auth/me - profile fields (complementary to oauth-passkey.test.js) ---
describe('GET /api/auth/me - profile fields', () => {
    it('returns country_code and unit_preference defaults', async () => {
        const { token } = await createUser();

        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.country_code).toBe('US');
        expect(res.body.data.unit_preference).toBe('imperial');
    });

    it('returns language_preference field', async () => {
        const { user, token } = await createUser();
        await db.query("UPDATE users SET language_preference = 'fr' WHERE id = $1", [user.id]);

        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.language_preference).toBe('fr');
    });

    it('returns store_exact_gps and export_obfuscation fields', async () => {
        const { user, token } = await createUser();
        await db.query("UPDATE users SET store_exact_gps = false, export_obfuscation = 'rounded_1km' WHERE id = $1", [user.id]);

        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.store_exact_gps).toBe(false);
        expect(res.body.data.export_obfuscation).toBe('rounded_1km');
    });

    it('returns is_demo=true for demo users', async () => {
        const { token } = await createDemoUser();

        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.is_demo).toBe(true);
    });

    it('returns is_demo=false for regular users', async () => {
        const { token } = await createUser();

        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.is_demo).toBe(false);
    });

    it('returns country_code after it was updated', async () => {
        const { user, token } = await createUser();
        await db.query("UPDATE users SET country_code = 'GB', region = 'England' WHERE id = $1", [user.id]);

        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.country_code).toBe('GB');
        expect(res.body.data.region).toBe('England');
    });

    it('requires authentication', async () => {
        const res = await request().get('/api/auth/me');
        expect(res.status).toBe(401);
    });

    it('rejects invalid token', async () => {
        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', 'Bearer invalid-token-here');

        expect(res.status).toBe(401);
    });
});

// --- PUT /api/auth/preferences (complementary tests) ---
describe('PUT /api/auth/preferences - combined updates', () => {
    it('updates multiple preferences in a single request', async () => {
        const { token } = await createUser();
        const res = await request()
            .put('/api/auth/preferences')
            .set('Authorization', `Bearer ${token}`)
            .send({
                unit_preference: 'metric',
                country_code: 'GB',
                region: 'Scotland',
                language_preference: 'en',
            });

        expect(res.status).toBe(200);
        expect(res.body.data.unit_preference).toBe('metric');
        expect(res.body.data.country_code).toBe('GB');
        expect(res.body.data.region).toBe('Scotland');
        expect(res.body.data.language_preference).toBe('en');
    });

    it('clears region by sending null', async () => {
        const { user, token } = await createUser();
        await db.query("UPDATE users SET region = 'Colorado' WHERE id = $1", [user.id]);

        const res = await request()
            .put('/api/auth/preferences')
            .set('Authorization', `Bearer ${token}`)
            .send({ region: null, country_code: 'US' });

        expect(res.status).toBe(200);
        expect(res.body.data.region).toBeNull();
    });

    it('persists preferences across requests', async () => {
        const { token } = await createUser();

        await request()
            .put('/api/auth/preferences')
            .set('Authorization', `Bearer ${token}`)
            .send({ unit_preference: 'metric', country_code: 'AU' });

        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.unit_preference).toBe('metric');
        expect(res.body.data.country_code).toBe('AU');
    });

    it('requires authentication', async () => {
        const res = await request()
            .put('/api/auth/preferences')
            .send({ unit_preference: 'metric' });

        expect(res.status).toBe(401);
    });

    it('updates store_exact_gps and export_obfuscation together', async () => {
        const { token } = await createUser();
        const res = await request()
            .put('/api/auth/preferences')
            .set('Authorization', `Bearer ${token}`)
            .send({ store_exact_gps: false, export_obfuscation: 'no_coords' });

        expect(res.status).toBe(200);
        expect(res.body.data.store_exact_gps).toBe(false);
        expect(res.body.data.export_obfuscation).toBe('no_coords');
    });

    it('rejects invalid export_obfuscation with combined valid fields', async () => {
        const { token } = await createUser();
        const res = await request()
            .put('/api/auth/preferences')
            .set('Authorization', `Bearer ${token}`)
            .send({ unit_preference: 'metric', export_obfuscation: 'bad_value' });

        expect(res.status).toBe(400);
    });
});

// --- POST /api/auth/request-invite ---
describe('POST /api/auth/request-invite', () => {
    it('creates an invite request with name and email', async () => {
        const res = await request()
            .post('/api/auth/request-invite')
            .send({ name: 'Jane Doe', email: 'jane@example.com' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.message).toMatch(/request submitted/i);

        const row = await db.queryOne(
            "SELECT * FROM invite_requests WHERE email = 'jane@example.com'"
        );
        expect(row).toBeTruthy();
        expect(row.name).toBe('Jane Doe');
        expect(row.status).toBe('pending');
    });

    it('creates an invite request with optional message', async () => {
        const res = await request()
            .post('/api/auth/request-invite')
            .send({ name: 'Bob Smith', email: 'bob@example.com', message: 'I love metal detecting!' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const row = await db.queryOne(
            "SELECT * FROM invite_requests WHERE email = 'bob@example.com'"
        );
        expect(row.message).toBe('I love metal detecting!');
    });

    it('handles duplicate pending request gracefully', async () => {
        await request()
            .post('/api/auth/request-invite')
            .send({ name: 'Dup User', email: 'dup@example.com' });

        const res = await request()
            .post('/api/auth/request-invite')
            .send({ name: 'Dup User', email: 'dup@example.com' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const rows = await db.query(
            "SELECT * FROM invite_requests WHERE email = 'dup@example.com' AND status = 'pending'"
        );
        expect(rows.rows).toHaveLength(1);
    });

    it('returns 400 when name is missing', async () => {
        const res = await request()
            .post('/api/auth/request-invite')
            .send({ email: 'noname@example.com' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeTruthy();
    });

    it('returns 400 when email is missing', async () => {
        const res = await request()
            .post('/api/auth/request-invite')
            .send({ name: 'No Email' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeTruthy();
    });

    it('normalizes email to lowercase', async () => {
        const res = await request()
            .post('/api/auth/request-invite')
            .send({ name: 'Case Test', email: 'UPPER@Example.COM' });

        expect(res.status).toBe(200);

        const row = await db.queryOne(
            "SELECT * FROM invite_requests WHERE email = 'upper@example.com'"
        );
        expect(row).toBeTruthy();
    });

    it('trims whitespace from name and email', async () => {
        const res = await request()
            .post('/api/auth/request-invite')
            .send({ name: '  Trimmed User  ', email: '  trimmed@example.com  ' });

        expect(res.status).toBe(200);

        const row = await db.queryOne(
            "SELECT * FROM invite_requests WHERE email = 'trimmed@example.com'"
        );
        expect(row).toBeTruthy();
        expect(row.name).toBe('Trimmed User');
    });

    it('does not require authentication', async () => {
        const res = await request()
            .post('/api/auth/request-invite')
            .send({ name: 'Anon User', email: 'anon@example.com' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
