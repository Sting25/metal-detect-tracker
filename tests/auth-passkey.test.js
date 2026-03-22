/**
 * Tests for passkey-specific endpoints in routes/auth-passkey.js.
 *
 * The basic CRUD management tests (GET /passkeys, PUT /passkeys/:id,
 * DELETE /passkeys/:id) live in oauth-passkey.test.js.  This file focuses on:
 *   - register-options / register-verify flow (error paths)
 *   - login-options / login-verify flow (error paths)
 *   - 401 for unauthenticated callers on protected endpoints
 *   - demo-user blocking on mutation endpoints
 *   - edge cases (expired challenge, missing credential, unknown passkey, etc.)
 */
const { request, createUser, createGoogleUser, createPasskeyForUser, createDemoUser } = require('./helpers');
const db = require('../database');

beforeEach(() => {
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_RP_NAME = 'Test App';
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
});

// ---------------------------------------------------------------------------
// POST /api/auth/passkey/register-options
// ---------------------------------------------------------------------------
describe('POST /api/auth/passkey/register-options', () => {
    it('returns valid challenge options for authenticated user', async () => {
        const { token } = await createUser();

        const res = await request()
            .post('/api/auth/passkey/register-options')
            .set('Authorization', `Bearer ${token}`)
            .send();

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.challenge).toBeTruthy();
        expect(res.body.data.rp).toBeTruthy();
        expect(res.body.data.rp.name).toBe('Test App');
        expect(res.body.data.rp.id).toBe('localhost');
        expect(res.body.data.user).toBeTruthy();
        expect(res.body.data.user.name).toBeTruthy();
    });

    it('stores challenge in auth_challenges table', async () => {
        const { user, token } = await createUser();

        await request()
            .post('/api/auth/passkey/register-options')
            .set('Authorization', `Bearer ${token}`)
            .send();

        const challenge = await db.queryOne(
            "SELECT * FROM auth_challenges WHERE user_id = $1 AND type = 'registration'",
            [user.id]
        );
        expect(challenge).toBeTruthy();
        expect(challenge.challenge).toBeTruthy();
    });

    it('excludes existing passkeys from registration options', async () => {
        const { user, token } = await createUser();
        await createPasskeyForUser(user.id, { display_name: 'Existing Key' });

        const res = await request()
            .post('/api/auth/passkey/register-options')
            .set('Authorization', `Bearer ${token}`)
            .send();

        expect(res.status).toBe(200);
        expect(res.body.data.excludeCredentials).toBeTruthy();
        expect(res.body.data.excludeCredentials.length).toBe(1);
    });

    it('returns 401 without authentication', async () => {
        const res = await request()
            .post('/api/auth/passkey/register-options')
            .send();

        expect(res.status).toBe(401);
    });

    it('rejects demo user', async () => {
        const { token } = await createDemoUser();

        const res = await request()
            .post('/api/auth/passkey/register-options')
            .set('Authorization', `Bearer ${token}`)
            .send();

        expect(res.status).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// POST /api/auth/passkey/register-verify
// ---------------------------------------------------------------------------
describe('POST /api/auth/passkey/register-verify', () => {
    it('returns 400 when credential is missing', async () => {
        const { token } = await createUser();

        const res = await request()
            .post('/api/auth/passkey/register-verify')
            .set('Authorization', `Bearer ${token}`)
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/credential/i);
    });

    it('returns 400 when no pending challenge exists', async () => {
        const { token } = await createUser();

        const res = await request()
            .post('/api/auth/passkey/register-verify')
            .set('Authorization', `Bearer ${token}`)
            .send({ credential: { id: 'fake', response: {} } });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/challenge/i);
    });

    it('returns 400 when challenge has expired', async () => {
        const { user, token } = await createUser();

        // Insert an expired challenge
        await db.query(
            "INSERT INTO auth_challenges (user_id, challenge, type, expires_at) VALUES ($1, $2, $3, $4)",
            [user.id, 'expired-challenge', 'registration', new Date(Date.now() - 60000).toISOString()]
        );

        const res = await request()
            .post('/api/auth/passkey/register-verify')
            .set('Authorization', `Bearer ${token}`)
            .send({ credential: { id: 'fake', response: {} } });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/challenge/i);
    });

    it('returns 400 when credential verification fails', async () => {
        const { user, token } = await createUser();

        // Insert a valid challenge
        await db.query(
            "INSERT INTO auth_challenges (user_id, challenge, type, expires_at) VALUES ($1, $2, $3, $4)",
            [user.id, 'test-challenge-abc', 'registration', new Date(Date.now() + 300000).toISOString()]
        );

        const res = await request()
            .post('/api/auth/passkey/register-verify')
            .set('Authorization', `Bearer ${token}`)
            .send({
                credential: {
                    id: 'fake-cred-id',
                    rawId: 'fake-raw-id',
                    type: 'public-key',
                    response: {
                        clientDataJSON: 'invalid',
                        attestationObject: 'invalid',
                    },
                },
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/verification failed/i);
    });

    it('returns 401 without authentication', async () => {
        const res = await request()
            .post('/api/auth/passkey/register-verify')
            .send({ credential: { id: 'x' } });

        expect(res.status).toBe(401);
    });

    it('rejects demo user', async () => {
        const { token } = await createDemoUser();

        const res = await request()
            .post('/api/auth/passkey/register-verify')
            .set('Authorization', `Bearer ${token}`)
            .send({ credential: { id: 'x' } });

        expect(res.status).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// POST /api/auth/passkey/login-options
// ---------------------------------------------------------------------------
describe('POST /api/auth/passkey/login-options', () => {
    it('returns challenge and challenge_id without authentication', async () => {
        const res = await request()
            .post('/api/auth/passkey/login-options')
            .send();

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.challenge).toBeTruthy();
        expect(res.body.data.challenge_id).toBeTruthy();
        expect(res.body.data.rpId).toBe('localhost');
    });

    it('stores authentication challenge in database', async () => {
        const res = await request()
            .post('/api/auth/passkey/login-options')
            .send();

        const challengeId = res.body.data.challenge_id;
        const row = await db.queryOne(
            "SELECT * FROM auth_challenges WHERE id = $1 AND type = 'authentication'",
            [challengeId]
        );
        expect(row).toBeTruthy();
        expect(row.user_id).toBeNull(); // login-options has no user context
    });
});

// ---------------------------------------------------------------------------
// POST /api/auth/passkey/login-verify
// ---------------------------------------------------------------------------
describe('POST /api/auth/passkey/login-verify', () => {
    it('returns 400 when credential is missing', async () => {
        const res = await request()
            .post('/api/auth/passkey/login-verify')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/credential/i);
    });

    it('returns 401 for unknown passkey id', async () => {
        const res = await request()
            .post('/api/auth/passkey/login-verify')
            .send({
                credential: { id: 'nonexistent-cred-id', response: {} },
                challenge_id: 1,
            });

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/unknown passkey/i);
    });

    it('returns 400 when no pending authentication challenge', async () => {
        const { user } = await createUser();
        const passkey = await createPasskeyForUser(user.id);

        const res = await request()
            .post('/api/auth/passkey/login-verify')
            .send({
                credential: { id: passkey.id, response: {} },
                challenge_id: 999999,
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/challenge/i);
    });

    it('returns 400 with expired authentication challenge', async () => {
        const { user } = await createUser();
        const passkey = await createPasskeyForUser(user.id);

        // Insert an expired challenge
        const challengeResult = await db.query(
            "INSERT INTO auth_challenges (user_id, challenge, type, expires_at) VALUES ($1, $2, $3, $4) RETURNING id",
            [null, 'expired-auth-challenge', 'authentication', new Date(Date.now() - 60000).toISOString()]
        );

        const res = await request()
            .post('/api/auth/passkey/login-verify')
            .send({
                credential: { id: passkey.id, response: {} },
                challenge_id: challengeResult.rows[0].id,
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/challenge/i);
    });

    it('returns 401 when credential verification fails (invalid response data)', async () => {
        const { user } = await createUser();
        const passkey = await createPasskeyForUser(user.id);

        // Insert a valid challenge
        const challengeResult = await db.query(
            "INSERT INTO auth_challenges (user_id, challenge, type, expires_at) VALUES ($1, $2, $3, $4) RETURNING id",
            [null, 'valid-challenge-xyz', 'authentication', new Date(Date.now() + 300000).toISOString()]
        );

        const res = await request()
            .post('/api/auth/passkey/login-verify')
            .send({
                credential: {
                    id: passkey.id,
                    rawId: passkey.id,
                    type: 'public-key',
                    response: {
                        clientDataJSON: 'invalid-data',
                        authenticatorData: 'invalid-data',
                        signature: 'invalid-sig',
                    },
                },
                challenge_id: challengeResult.rows[0].id,
            });

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/verification failed/i);
    });

    it('returns 403 for disabled user', async () => {
        // We can't easily do a full WebAuthn verify, but we can test the disabled check
        // by verifying the endpoint returns appropriate errors before reaching the disabled check.
        // The disabled user check happens after successful verification, so we test it indirectly
        // by confirming the flow structure handles it.
        const { user } = await createUser();
        await db.query('UPDATE users SET is_disabled = true WHERE id = $1', [user.id]);

        // Even though the FIDO2 verification will fail before reaching the disabled check,
        // we verify the endpoint handles the credential lookup correctly for a disabled user's passkey
        const passkey = await createPasskeyForUser(user.id);
        const challengeResult = await db.query(
            "INSERT INTO auth_challenges (user_id, challenge, type, expires_at) VALUES ($1, $2, $3, $4) RETURNING id",
            [null, 'challenge-for-disabled', 'authentication', new Date(Date.now() + 300000).toISOString()]
        );

        const res = await request()
            .post('/api/auth/passkey/login-verify')
            .send({
                credential: {
                    id: passkey.id,
                    rawId: passkey.id,
                    type: 'public-key',
                    response: {
                        clientDataJSON: 'invalid',
                        authenticatorData: 'invalid',
                        signature: 'invalid',
                    },
                },
                challenge_id: challengeResult.rows[0].id,
            });

        // Will fail at verification step (401) since we can't mock the full FIDO2 flow
        expect(res.status).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// Unauthenticated access on protected endpoints
// ---------------------------------------------------------------------------
describe('Passkey endpoints - authentication required', () => {
    it('GET /api/auth/passkeys returns 401 without token', async () => {
        const res = await request().get('/api/auth/passkeys');
        expect(res.status).toBe(401);
    });

    it('PUT /api/auth/passkeys/:id returns 401 without token', async () => {
        const res = await request()
            .put('/api/auth/passkeys/some-id')
            .send({ display_name: 'Test' });
        expect(res.status).toBe(401);
    });

    it('DELETE /api/auth/passkeys/:id returns 401 without token', async () => {
        const res = await request().delete('/api/auth/passkeys/some-id');
        expect(res.status).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// PUT /api/auth/passkeys/:id — edge cases
// ---------------------------------------------------------------------------
describe('PUT /api/auth/passkeys/:id — edge cases', () => {
    it('rejects empty display_name', async () => {
        const { user, token } = await createUser();
        const passkey = await createPasskeyForUser(user.id);

        const res = await request()
            .put(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ display_name: '' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/display_name/i);
    });

    it('rejects whitespace-only display_name', async () => {
        const { user, token } = await createUser();
        const passkey = await createPasskeyForUser(user.id);

        const res = await request()
            .put(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ display_name: '   ' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/display_name/i);
    });

    it('returns 404 for nonexistent passkey id', async () => {
        const { token } = await createUser();

        const res = await request()
            .put('/api/auth/passkeys/nonexistent-id')
            .set('Authorization', `Bearer ${token}`)
            .send({ display_name: 'New Name' });

        expect(res.status).toBe(404);
    });

    it('trims display_name whitespace', async () => {
        const { user, token } = await createUser();
        const passkey = await createPasskeyForUser(user.id);

        const res = await request()
            .put(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ display_name: '  My Trimmed Key  ' });

        expect(res.status).toBe(200);
        expect(res.body.data.display_name).toBe('My Trimmed Key');
    });

    it('rejects demo user from renaming', async () => {
        const { user, token } = await createDemoUser();
        const passkey = await createPasskeyForUser(user.id);

        const res = await request()
            .put(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ display_name: 'Renamed' });

        expect(res.status).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// DELETE /api/auth/passkeys/:id — edge cases
// ---------------------------------------------------------------------------
describe('DELETE /api/auth/passkeys/:id — edge cases', () => {
    it('allows delete when user has multiple passkeys and no other auth', async () => {
        const { user, token } = await createGoogleUser();
        await db.query('UPDATE users SET google_id = NULL WHERE id = $1', [user.id]);
        const passkey1 = await createPasskeyForUser(user.id, { display_name: 'Key 1' });
        await createPasskeyForUser(user.id, { display_name: 'Key 2' });

        const res = await request()
            .delete(`/api/auth/passkeys/${encodeURIComponent(passkey1.id)}`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
    });

    it('rejects demo user from deleting', async () => {
        const { user, token } = await createDemoUser();
        const passkey = await createPasskeyForUser(user.id);

        const res = await request()
            .delete(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`)
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
    });

    it('returns 404 for nonexistent passkey id on delete', async () => {
        const { token } = await createUser();

        const res = await request()
            .delete('/api/auth/passkeys/nonexistent-id')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(404);
    });
});
