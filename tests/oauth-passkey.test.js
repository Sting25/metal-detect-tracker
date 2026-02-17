/**
 * Tests for Google OAuth, WebAuthn passkeys, account management, and auth config.
 */
const { request, createUser, createAdmin, createGoogleUser, createPasskeyForUser } = require('./helpers');
const db = require('../database');
const authRouter = require('../routes/auth');

// Set GOOGLE_CLIENT_ID so the route initializes the client
beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_RP_NAME = 'Test App';
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
});

// Helper to set up Google mock for a valid token
// Replaces router._verifyGoogleIdToken with a mock that returns the given payload
function mockGoogleToken(overrides = {}) {
    const defaults = {
        sub: 'google-sub-' + Date.now(),
        email: 'googleuser@gmail.com',
        name: 'Google User',
        email_verified: true,
    };
    const payload = { ...defaults, ...overrides };
    authRouter._verifyGoogleIdToken = async function () {
        return payload;
    };
    return payload;
}

// Helper to make Google verification throw (for invalid token tests)
function mockGoogleTokenReject(errorMessage) {
    authRouter._verifyGoogleIdToken = async function () {
        throw new Error(errorMessage || 'Invalid token');
    };
}

describe('Auth Config', () => {
    it('GET /api/auth/config returns google_client_id and webauthn_enabled', async () => {
        const res = await request().get('/api/auth/config');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.google_client_id).toBeTruthy();
        expect(res.body.data.webauthn_enabled).toBe(true);
    });
});

describe('Google OAuth - POST /api/auth/google', () => {
    it('rejects missing id_token', async () => {
        const res = await request()
            .post('/api/auth/google')
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/token/i);
    });

    it('rejects invalid Google token', async () => {
        mockGoogleTokenReject('Invalid token');
        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'bad-token' });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid/i);
    });

    it('returns JWT for existing user with matching google_id', async () => {
        const payload = mockGoogleToken();
        const { user } = await createGoogleUser({ google_id: payload.sub, email: payload.email });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.token).toBeTruthy();
        expect(res.body.data.user.id).toBe(user.id);
    });

    it('returns needsLink when Google email matches existing user (no auto-linking)', async () => {
        mockGoogleToken({ email: 'existing@test.com' });
        await createUser({ email: 'existing@test.com' });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token' });

        expect(res.status).toBe(200);
        expect(res.body.data.needsLink).toBe(true);
        expect(res.body.data.message).toMatch(/already exists/i);
    });

    it('returns needsTerms for new Google user without terms_accepted', async () => {
        mockGoogleToken({ email: 'brand-new@gmail.com', name: 'New Person' });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token' });

        expect(res.status).toBe(200);
        expect(res.body.data.needsTerms).toBe(true);
        expect(res.body.data.google_name).toBe('New Person');
        expect(res.body.data.google_email).toBe('brand-new@gmail.com');
    });

    it('creates new user when terms_accepted is true', async () => {
        const payload = mockGoogleToken({ email: 'new-google@gmail.com', name: 'New Google' });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token', terms_accepted: true });

        expect(res.status).toBe(201);
        expect(res.body.data.token).toBeTruthy();
        expect(res.body.data.user.email).toBe('new-google@gmail.com');

        // Verify user was created correctly
        const user = await db.queryOne('SELECT * FROM users WHERE email = $1', ['new-google@gmail.com']);
        expect(user.password_hash).toBe('__NO_PASSWORD__');
        expect(user.email_verified).toBe(true);
        expect(user.google_id).toBe(payload.sub);
        expect(user.terms_accepted_at).toBeTruthy();
    });
});

describe('Google Link/Unlink', () => {
    it('POST /api/auth/google/link links Google to current user', async () => {
        const { token, user } = await createUser();
        const payload = mockGoogleToken();

        const res = await request()
            .post('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`)
            .send({ id_token: 'valid-token' });

        expect(res.status).toBe(200);
        const updated = await db.queryOne('SELECT google_id FROM users WHERE id = $1', [user.id]);
        expect(updated.google_id).toBe(payload.sub);
    });

    it('POST /api/auth/google/link rejects if Google ID already linked to another user', async () => {
        const payload = mockGoogleToken();
        await createGoogleUser({ google_id: payload.sub }); // another user with this google_id
        const { token } = await createUser();

        const res = await request()
            .post('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`)
            .send({ id_token: 'valid-token' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already linked/i);
    });

    it('DELETE /api/auth/google/link unlinks Google when user has password', async () => {
        const { token, user } = await createUser();
        await db.query('UPDATE users SET google_id = $1 WHERE id = $2', ['some-google-id', user.id]);

        const res = await request()
            .delete('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        const updated = await db.queryOne('SELECT google_id FROM users WHERE id = $1', [user.id]);
        expect(updated.google_id).toBeNull();
    });

    it('DELETE /api/auth/google/link rejects when it is the only auth method', async () => {
        const { token } = await createGoogleUser(); // no password, no passkeys

        const res = await request()
            .delete('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/last sign-in/i);
    });
});

describe('Passkey Management', () => {
    it('GET /api/auth/passkeys lists user passkeys', async () => {
        const { user, token } = await createUser();
        await createPasskeyForUser(user.id, { display_name: 'My iPhone' });
        await createPasskeyForUser(user.id, { display_name: 'Work Laptop' });

        const res = await request()
            .get('/api/auth/passkeys')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0].display_name).toBeTruthy();
    });

    it('PUT /api/auth/passkeys/:id renames a passkey', async () => {
        const { user, token } = await createUser();
        const passkey = await createPasskeyForUser(user.id, { display_name: 'Old Name' });

        const res = await request()
            .put(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ display_name: 'New Name' });

        expect(res.status).toBe(200);
        expect(res.body.data.display_name).toBe('New Name');
    });

    it('DELETE /api/auth/passkeys/:id removes a passkey when user has password', async () => {
        const { user, token } = await createUser();
        const passkey = await createPasskeyForUser(user.id);

        const res = await request()
            .delete(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        const remaining = await db.queryOne('SELECT COUNT(*) as cnt FROM passkey_credentials WHERE user_id = $1', [user.id]);
        expect(Number(remaining.cnt)).toBe(0);
    });

    it('DELETE rejects removing another user passkey', async () => {
        const { user: user1 } = await createUser();
        const { token: token2 } = await createUser();
        const passkey = await createPasskeyForUser(user1.id);

        const res = await request()
            .delete(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`)
            .set('Authorization', `Bearer ${token2}`);

        expect(res.status).toBe(404);
    });

    it('DELETE rejects removing last auth method', async () => {
        const { user, token } = await createGoogleUser(); // google only, no password
        const passkey = await createPasskeyForUser(user.id);
        // Unlink Google first so passkey is only remaining method
        await db.query('UPDATE users SET google_id = NULL WHERE id = $1', [user.id]);

        const res = await request()
            .delete(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/last sign-in/i);
    });
});

describe('Login regression with __NO_PASSWORD__', () => {
    it('password login still works for normal users', async () => {
        const { user } = await createUser({ email: 'normal@test.com', password: 'Password12345' });

        const res = await request()
            .post('/api/auth/login')
            .send({ email: 'normal@test.com', password: 'Password12345' });

        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeTruthy();
    });

    it('rejects password login for __NO_PASSWORD__ users', async () => {
        await createGoogleUser({ email: 'googleonly@test.com' });

        const res = await request()
            .post('/api/auth/login')
            .send({ email: 'googleonly@test.com', password: 'anything' });

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid/i);
    });
});

describe('GET /api/auth/me - extended response', () => {
    it('includes has_password, has_google, passkeys for normal user', async () => {
        const { user, token } = await createUser();

        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.has_password).toBe(true);
        expect(res.body.data.has_google).toBe(false);
        expect(res.body.data.passkeys).toEqual([]);
    });

    it('includes has_google=true for Google user', async () => {
        const { token } = await createGoogleUser();

        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.body.data.has_password).toBe(false);
        expect(res.body.data.has_google).toBe(true);
    });

    it('includes passkeys in response', async () => {
        const { user, token } = await createUser();
        await createPasskeyForUser(user.id, { display_name: 'My Key' });

        const res = await request()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.body.data.passkeys).toHaveLength(1);
        expect(res.body.data.passkeys[0].display_name).toBe('My Key');
    });
});

describe('POST /api/auth/change-password', () => {
    it('changes password for user with existing password', async () => {
        const { token } = await createUser({ email: 'changepw@test.com', password: 'Oldpassword12!' });

        const res = await request()
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ current_password: 'Oldpassword12!', new_password: 'NewPassword123!' });

        expect(res.status).toBe(200);

        // Verify new password works
        const loginRes = await request()
            .post('/api/auth/login')
            .send({ email: 'changepw@test.com', password: 'NewPassword123!' });
        expect(loginRes.status).toBe(200);
    });

    it('sets password for Google-only user without current password', async () => {
        const { token, user } = await createGoogleUser({ email: 'setpw@test.com' });

        const res = await request()
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ new_password: 'Brandnew12345' });

        expect(res.status).toBe(200);

        // Verify password now works
        const loginRes = await request()
            .post('/api/auth/login')
            .send({ email: 'setpw@test.com', password: 'Brandnew12345' });
        expect(loginRes.status).toBe(200);
    });

    it('rejects wrong current password', async () => {
        const { token } = await createUser({ password: 'Correctpw1234' });

        const res = await request()
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ current_password: 'WrongPw12345', new_password: 'NewPw1234567!' });

        expect(res.status).toBe(401);
    });

    it('rejects short new password', async () => {
        const { token } = await createUser({ password: 'Password12345' });

        const res = await request()
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ current_password: 'Password12345', new_password: '12345' });

        expect(res.status).toBe(400);
    });
});
