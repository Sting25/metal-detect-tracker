/**
 * Complementary edge-case tests for Google OAuth (auth-social.js).
 * The main happy paths are covered in oauth-passkey.test.js — these tests
 * focus on error paths, boundary conditions, and demo-user restrictions.
 */
const { request, createUser, createGoogleUser, createPasskeyForUser, createDemoUser } = require('./helpers');
const db = require('../database');
const authSocialRouter = require('../routes/auth-social');

// Set GOOGLE_CLIENT_ID so the route enables Google features
beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_RP_NAME = 'Test App';
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
});

function mockGoogleToken(overrides = {}) {
    const defaults = {
        sub: 'google-sub-' + Date.now() + Math.random().toString(36).slice(2),
        email: 'googleuser@gmail.com',
        name: 'Google User',
        email_verified: true,
    };
    const payload = { ...defaults, ...overrides };
    authSocialRouter._verifyGoogleIdToken = async function () {
        return payload;
    };
    return payload;
}

function mockGoogleTokenReject(errorMessage) {
    authSocialRouter._verifyGoogleIdToken = async function () {
        throw new Error(errorMessage || 'Invalid token');
    };
}

describe('Auth Config - edge cases', () => {
    it('GET /api/auth/config returns null google_client_id when env not set', async () => {
        delete process.env.GOOGLE_CLIENT_ID;
        const res = await request().get('/api/auth/config');
        expect(res.status).toBe(200);
        expect(res.body.data.google_client_id).toBeNull();
    });

    it('GET /api/auth/config returns webauthn_enabled false when WEBAUTHN_RP_ID not set', async () => {
        delete process.env.WEBAUTHN_RP_ID;
        const res = await request().get('/api/auth/config');
        expect(res.status).toBe(200);
        expect(res.body.data.webauthn_enabled).toBe(false);
    });
});

describe('Google OAuth - POST /api/auth/google edge cases', () => {
    it('returns 503 when GOOGLE_CLIENT_ID is not configured', async () => {
        delete process.env.GOOGLE_CLIENT_ID;
        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'some-token' });
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/not configured/i);
    });

    it('returns 403 for disabled user with matching google_id', async () => {
        const payload = mockGoogleToken();
        const { user } = await createGoogleUser({ google_id: payload.sub, email: payload.email });
        await db.query('UPDATE users SET is_disabled = true WHERE id = $1', [user.id]);

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token' });

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/disabled/i);
        expect(res.body.isDisabled).toBe(true);
    });

    it('detects country from Google locale en-GB', async () => {
        const payload = mockGoogleToken({
            email: 'brit@gmail.com',
            name: 'British User',
            locale: 'en-GB',
        });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token', terms_accepted: true });

        expect(res.status).toBe(201);
        const user = await db.queryOne('SELECT country_code FROM users WHERE email = $1', ['brit@gmail.com']);
        expect(user.country_code).toBe('GB');
    });

    it('detects country from Google locale en-AU', async () => {
        const payload = mockGoogleToken({
            email: 'aussie@gmail.com',
            name: 'Aussie User',
            locale: 'en_AU',
        });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token', terms_accepted: true });

        expect(res.status).toBe(201);
        const user = await db.queryOne('SELECT country_code FROM users WHERE email = $1', ['aussie@gmail.com']);
        expect(user.country_code).toBe('AU');
    });

    it('defaults to US for unsupported locale', async () => {
        mockGoogleToken({
            email: 'japan@gmail.com',
            name: 'Japan User',
            locale: 'ja-JP',
        });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token', terms_accepted: true });

        expect(res.status).toBe(201);
        const user = await db.queryOne('SELECT country_code FROM users WHERE email = $1', ['japan@gmail.com']);
        expect(user.country_code).toBe('US');
    });

    it('defaults to US when locale is absent', async () => {
        mockGoogleToken({
            email: 'nolocale@gmail.com',
            name: 'No Locale',
        });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token', terms_accepted: true });

        expect(res.status).toBe(201);
        const user = await db.queryOne('SELECT country_code FROM users WHERE email = $1', ['nolocale@gmail.com']);
        expect(user.country_code).toBe('US');
    });

    it('normalizes email to lowercase', async () => {
        mockGoogleToken({
            email: 'MixedCase@Gmail.COM',
            name: 'Case User',
        });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token', terms_accepted: true });

        expect(res.status).toBe(201);
        expect(res.body.data.user.email).toBe('mixedcase@gmail.com');
    });

    it('uses email prefix as name when Google name is absent', async () => {
        mockGoogleToken({
            email: 'noname@gmail.com',
            name: undefined,
        });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token', terms_accepted: true });

        expect(res.status).toBe(201);
        const user = await db.queryOne('SELECT display_name FROM users WHERE email = $1', ['noname@gmail.com']);
        expect(user.display_name).toBe('noname');
    });

    it('sets email_verified to true and terms_accepted_at for new Google users', async () => {
        mockGoogleToken({ email: 'verified@gmail.com' });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token', terms_accepted: true });

        expect(res.status).toBe(201);
        const user = await db.queryOne('SELECT email_verified, terms_accepted_at FROM users WHERE email = $1', ['verified@gmail.com']);
        expect(user.email_verified).toBe(true);
        expect(user.terms_accepted_at).toBeTruthy();
    });

    it('returns user fields including country_code and language_preference on login', async () => {
        const payload = mockGoogleToken();
        await createGoogleUser({ google_id: payload.sub, email: payload.email });

        const res = await request()
            .post('/api/auth/google')
            .send({ id_token: 'valid-token' });

        expect(res.status).toBe(200);
        const userData = res.body.data.user;
        expect(userData).toHaveProperty('country_code');
        expect(userData).toHaveProperty('unit_preference');
        expect(userData).toHaveProperty('role');
    });
});

describe('Google Link - edge cases', () => {
    it('POST /api/auth/google/link returns 401 without auth token', async () => {
        const res = await request()
            .post('/api/auth/google/link')
            .send({ id_token: 'valid-token' });

        expect(res.status).toBe(401);
    });

    it('POST /api/auth/google/link returns 503 when Google not configured', async () => {
        delete process.env.GOOGLE_CLIENT_ID;
        const { token } = await createUser();

        const res = await request()
            .post('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`)
            .send({ id_token: 'valid-token' });

        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/not configured/i);
    });

    it('POST /api/auth/google/link returns 400 when id_token missing', async () => {
        const { token } = await createUser();

        const res = await request()
            .post('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`)
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/token/i);
    });

    it('POST /api/auth/google/link returns 401 for invalid Google token', async () => {
        mockGoogleTokenReject('Bad token');
        const { token } = await createUser();

        const res = await request()
            .post('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`)
            .send({ id_token: 'bad-token' });

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid/i);
    });

    it('POST /api/auth/google/link is denied for demo users', async () => {
        const payload = mockGoogleToken();
        const { token } = await createDemoUser();

        const res = await request()
            .post('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`)
            .send({ id_token: 'valid-token' });

        expect(res.status).toBe(403);
        expect(res.body.isDemo).toBe(true);
    });
});

describe('Google Unlink - edge cases', () => {
    it('DELETE /api/auth/google/link returns 401 without auth token', async () => {
        const res = await request()
            .delete('/api/auth/google/link');

        expect(res.status).toBe(401);
    });

    it('DELETE /api/auth/google/link is denied for demo users', async () => {
        const { token } = await createDemoUser();

        const res = await request()
            .delete('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
        expect(res.body.isDemo).toBe(true);
    });

    it('DELETE /api/auth/google/link succeeds when user has a passkey (no password)', async () => {
        const { user, token } = await createGoogleUser();
        await createPasskeyForUser(user.id);

        const res = await request()
            .delete('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        const updated = await db.queryOne('SELECT google_id FROM users WHERE id = $1', [user.id]);
        expect(updated.google_id).toBeNull();
    });

    it('DELETE /api/auth/google/link succeeds even when google_id is already null', async () => {
        // User with password but no Google linked — unlinking is a no-op success
        const { token, user } = await createUser();

        const res = await request()
            .delete('/api/auth/google/link')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
    });
});
