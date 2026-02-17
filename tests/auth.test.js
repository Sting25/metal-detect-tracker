const { request, createUser, createAdmin, createInviteCode, createSite, createFind, createPermission, shareSite, createPasskeyForUser, createDemoUser } = require('./helpers');
const db = require('../database');

describe('Auth Routes', () => {

    // --- POST /api/auth/setup ---
    describe('POST /api/auth/setup', () => {
        it('creates first admin when no users exist', async () => {
            const res = await request()
                .post('/api/auth/setup')
                .send({ email: 'admin@test.com', password: 'Secret12345!', display_name: 'Admin' });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.user.role).toBe('admin');
            expect(res.body.data.token).toBeTruthy();
        });

        it('rejects setup when users already exist', async () => {
            await createUser();
            const res = await request()
                .post('/api/auth/setup')
                .send({ email: 'admin2@test.com', password: 'Secret12345!', display_name: 'Admin2' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/setup already completed/i);
        });

        it('rejects missing fields', async () => {
            const res = await request()
                .post('/api/auth/setup')
                .send({ email: 'admin@test.com' });

            expect(res.status).toBe(400);
        });

        it('rejects short password', async () => {
            const res = await request()
                .post('/api/auth/setup')
                .send({ email: 'admin@test.com', password: '123', display_name: 'Admin' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/at least 12|too small|>=12/i);
        });
    });

    // --- ALLOW_SETUP env guard ---
    describe('ALLOW_SETUP env guard', () => {
        afterEach(() => {
            delete process.env.ALLOW_SETUP;
        });

        it('GET /needs-setup returns needsSetup: false when ALLOW_SETUP=false', async () => {
            process.env.ALLOW_SETUP = 'false';
            const res = await request()
                .get('/api/auth/needs-setup');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.needsSetup).toBe(false);
        });

        it('POST /setup returns 404 when ALLOW_SETUP=false', async () => {
            process.env.ALLOW_SETUP = 'false';
            const res = await request()
                .post('/api/auth/setup')
                .send({ email: 'admin@test.com', password: 'Secret12345!', display_name: 'Admin' });

            expect(res.status).toBe(404);
        });

        it('POST /setup works normally when ALLOW_SETUP=true', async () => {
            process.env.ALLOW_SETUP = 'true';
            const res = await request()
                .post('/api/auth/setup')
                .send({ email: 'admin@test.com', password: 'Secret12345!', display_name: 'Admin' });

            expect(res.status).toBe(201);
            expect(res.body.data.user.role).toBe('admin');
        });

        it('POST /setup works normally when ALLOW_SETUP is unset (backward compatible)', async () => {
            delete process.env.ALLOW_SETUP;
            const res = await request()
                .post('/api/auth/setup')
                .send({ email: 'admin@test.com', password: 'Secret12345!', display_name: 'Admin' });

            expect(res.status).toBe(201);
        });

        it('reads env var at request time (change mid-test)', async () => {
            // First: disabled
            process.env.ALLOW_SETUP = 'false';
            const res1 = await request().get('/api/auth/needs-setup');
            expect(res1.body.data.needsSetup).toBe(false);

            // Now: enabled
            process.env.ALLOW_SETUP = 'true';
            const res2 = await request().get('/api/auth/needs-setup');
            // No users exist → needsSetup should be true
            expect(res2.body.data.needsSetup).toBe(true);
        });
    });

    // --- POST /api/auth/login ---
    describe('POST /api/auth/login', () => {
        it('returns token for valid credentials', async () => {
            const { user, password } = await createUser({ email: 'logintest@test.com' });
            const res = await request()
                .post('/api/auth/login')
                .send({ email: 'logintest@test.com', password });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeTruthy();
            expect(res.body.data.user.email).toBe('logintest@test.com');
        });

        it('rejects wrong password', async () => {
            await createUser({ email: 'wrong@test.com' });
            const res = await request()
                .post('/api/auth/login')
                .send({ email: 'wrong@test.com', password: 'wrongpassword' });

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/invalid email or password/i);
        });

        it('rejects nonexistent email with same message', async () => {
            const res = await request()
                .post('/api/auth/login')
                .send({ email: 'nobody@test.com', password: 'anything' });

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/invalid email or password/i);
        });

        it('returns language_preference in login response', async () => {
            const { user, password } = await createUser({ email: 'lang@test.com' });
            const res = await request()
                .post('/api/auth/login')
                .send({ email: 'lang@test.com', password });

            expect(res.status).toBe(200);
            expect(res.body.data.user).toHaveProperty('language_preference');
            expect(res.body.data.user.language_preference).toBe('en');
        });

        it('rejects missing fields', async () => {
            const res = await request()
                .post('/api/auth/login')
                .send({ email: 'test@test.com' });

            expect(res.status).toBe(400);
        });
    });

    // --- POST /api/auth/register ---
    describe('POST /api/auth/register', () => {
        it('creates user and auto-logins when verification is disabled (default)', async () => {
            const res = await request()
                .post('/api/auth/register')
                .send({
                    email: 'newuser@test.com',
                    password: 'Password12345',
                    display_name: 'New User',
                    terms_accepted: true,
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeTruthy();
            expect(res.body.data.user.email).toBe('newuser@test.com');
        });

        it('requires verification when EMAIL_VERIFICATION_ENABLED=true', async () => {
            process.env.EMAIL_VERIFICATION_ENABLED = 'true';
            try {
                const res = await request()
                    .post('/api/auth/register')
                    .send({
                        email: 'verifyuser@test.com',
                        password: 'Password12345',
                        display_name: 'Verify User',
                        terms_accepted: true,
                    });

                expect(res.status).toBe(201);
                expect(res.body.success).toBe(true);
                expect(res.body.data.needsVerification).toBe(true);
                expect(res.body.data.email).toBeTruthy();
                expect(res.body.data.token).toBeUndefined();
            } finally {
                delete process.env.EMAIL_VERIFICATION_ENABLED;
            }
        });

        it('rejects registration without terms acceptance', async () => {
            const res = await request()
                .post('/api/auth/register')
                .send({
                    email: 'noterms@test.com',
                    password: 'Password12345',
                    display_name: 'No Terms',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/terms/i);
        });

        it('rejects registration with terms_accepted = false', async () => {
            const res = await request()
                .post('/api/auth/register')
                .send({
                    email: 'falseterms@test.com',
                    password: 'Password12345',
                    display_name: 'False Terms',
                    terms_accepted: false,
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/terms/i);
        });

        it('rejects duplicate email', async () => {
            await request()
                .post('/api/auth/register')
                .send({
                    email: 'dupe@test.com',
                    password: 'Password12345',
                    display_name: 'First',
                    terms_accepted: true,
                });

            const res = await request()
                .post('/api/auth/register')
                .send({
                    email: 'dupe@test.com',
                    password: 'Password12345',
                    display_name: 'Second',
                    terms_accepted: true,
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/already registered/i);
        });

        it('stores terms_accepted_at timestamp', async () => {
            await request()
                .post('/api/auth/register')
                .send({
                    email: 'terms@test.com',
                    password: 'Password12345',
                    display_name: 'Terms User',
                    terms_accepted: true,
                });

            const user = await db.queryOne('SELECT terms_accepted_at FROM users WHERE email = $1', ['terms@test.com']);
            expect(user.terms_accepted_at).toBeTruthy();
        });
    });

    // --- Country capture on setup ---
    describe('Country capture on setup', () => {
        it('setup stores country_code and region when provided', async () => {
            const res = await request()
                .post('/api/auth/setup')
                .send({ email: 'admin@test.com', password: 'Secret12345!', display_name: 'Admin', country_code: 'GB', region: 'England' });

            expect(res.status).toBe(201);
            expect(res.body.data.user.country_code).toBe('GB');
            expect(res.body.data.user.region).toBe('England');
        });

        it('setup defaults country_code to US when not provided', async () => {
            const res = await request()
                .post('/api/auth/setup')
                .send({ email: 'admin@test.com', password: 'Secret12345!', display_name: 'Admin' });

            expect(res.status).toBe(201);
            expect(res.body.data.user.country_code).toBe('US');
        });
    });

    // --- Country capture on register ---
    describe('Country capture on register', () => {
        it('register stores country_code and region when provided', async () => {
            const res = await request()
                .post('/api/auth/register')
                .send({
                    email: 'aussie@test.com',
                    password: 'Password12345',
                    display_name: 'Aussie User',
                    terms_accepted: true,
                    country_code: 'AU',
                    region: 'Victoria',
                });

            expect(res.status).toBe(201);
            expect(res.body.data.token).toBeTruthy();
            const user = await db.queryOne('SELECT country_code, region FROM users WHERE email = $1', ['aussie@test.com']);
            expect(user.country_code).toBe('AU');
            expect(user.region).toBe('Victoria');
        });

        it('register defaults country_code to US when not provided', async () => {
            const res = await request()
                .post('/api/auth/register')
                .send({
                    email: 'default@test.com',
                    password: 'Password12345',
                    display_name: 'Default User',
                    terms_accepted: true,
                });

            expect(res.status).toBe(201);
            expect(res.body.data.token).toBeTruthy();
            const user = await db.queryOne('SELECT country_code, unit_preference FROM users WHERE email = $1', ['default@test.com']);
            expect(user.country_code).toBe('US');
            expect(user.unit_preference).toBe('imperial');
        });
    });

    // --- PUT /api/auth/preferences ---
    describe('PUT /api/auth/preferences', () => {
        it('updates unit_preference to metric', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ unit_preference: 'metric' });

            expect(res.status).toBe(200);
            expect(res.body.data.unit_preference).toBe('metric');
        });

        it('updates country_code and region', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ country_code: 'AU', region: 'NSW' });

            expect(res.status).toBe(200);
            expect(res.body.data.country_code).toBe('AU');
            expect(res.body.data.region).toBe('NSW');
        });

        it('rejects invalid unit_preference value', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ unit_preference: 'cubits' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/metric.*imperial/i);
        });

        it('updates language_preference to es', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ language_preference: 'es' });

            expect(res.status).toBe(200);
            expect(res.body.data.language_preference).toBe('es');
        });

        it('updates language_preference to fr', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ language_preference: 'fr' });

            expect(res.status).toBe(200);
            expect(res.body.data.language_preference).toBe('fr');
        });

        it('rejects invalid language_preference value', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ language_preference: 'zh' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/language_preference/i);
        });

        it('rejects empty body with no valid fields', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/no valid fields/i);
        });

        it('updates store_exact_gps to false', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ store_exact_gps: false });

            expect(res.status).toBe(200);
            expect(res.body.data.store_exact_gps).toBe(false);
        });

        it('updates export_obfuscation to rounded_1km', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ export_obfuscation: 'rounded_1km' });

            expect(res.status).toBe(200);
            expect(res.body.data.export_obfuscation).toBe('rounded_1km');
        });

        it('rejects invalid export_obfuscation value', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ export_obfuscation: 'xyz' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/export_obfuscation/i);
        });

        it('rejects non-boolean store_exact_gps', async () => {
            const { token } = await createUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ store_exact_gps: 'yes' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/store_exact_gps/i);
        });

        it('requires authentication', async () => {
            const res = await request()
                .put('/api/auth/preferences')
                .send({ unit_preference: 'metric' });

            expect(res.status).toBe(401);
        });
    });

    // --- Email Verification (requires EMAIL_VERIFICATION_ENABLED=true) ---
    describe('Email verification', () => {
        beforeEach(() => { process.env.EMAIL_VERIFICATION_ENABLED = 'true'; });
        afterEach(() => { delete process.env.EMAIL_VERIFICATION_ENABLED; });

        it('verify-email returns JWT for correct code', async () => {
            await request()
                .post('/api/auth/register')
                .send({
                    email: 'verify@test.com',
                    password: 'Password12345',
                    display_name: 'Verify User',
                    terms_accepted: true,
                });

            const user = await db.queryOne('SELECT verification_code FROM users WHERE email = $1', ['verify@test.com']);
            expect(user.verification_code).toBeTruthy();

            const res = await request()
                .post('/api/auth/verify-email')
                .send({ email: 'verify@test.com', code: user.verification_code });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeTruthy();
            expect(res.body.data.user.email).toBe('verify@test.com');
        });

        it('verify-email rejects wrong code', async () => {
            await request()
                .post('/api/auth/register')
                .send({
                    email: 'wrongcode@test.com',
                    password: 'Password12345',
                    display_name: 'Wrong Code',
                    terms_accepted: true,
                });

            const res = await request()
                .post('/api/auth/verify-email')
                .send({ email: 'wrongcode@test.com', code: '000000' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/invalid or expired/i);
        });

        it('verify-email rejects expired code', async () => {
            await request()
                .post('/api/auth/register')
                .send({
                    email: 'expired@test.com',
                    password: 'Password12345',
                    display_name: 'Expired Code',
                    terms_accepted: true,
                });

            const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
            await db.query("UPDATE users SET verification_expires_at = $1 WHERE email = $2", [pastDate, 'expired@test.com']);

            const user = await db.queryOne('SELECT verification_code FROM users WHERE email = $1', ['expired@test.com']);
            const res = await request()
                .post('/api/auth/verify-email')
                .send({ email: 'expired@test.com', code: user.verification_code });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/expired/i);
        });

        it('login rejects unverified user with needsVerification', async () => {
            await request()
                .post('/api/auth/register')
                .send({
                    email: 'unverified@test.com',
                    password: 'Password12345',
                    display_name: 'Unverified',
                    terms_accepted: true,
                });

            const res = await request()
                .post('/api/auth/login')
                .send({ email: 'unverified@test.com', password: 'Password12345' });

            expect(res.status).toBe(403);
            expect(res.body.needsVerification).toBe(true);
            expect(res.body.email).toBeTruthy();
        });

        it('login works after email verification', async () => {
            await request()
                .post('/api/auth/register')
                .send({
                    email: 'verified@test.com',
                    password: 'Password12345',
                    display_name: 'Verified',
                    terms_accepted: true,
                });

            const user = await db.queryOne('SELECT verification_code FROM users WHERE email = $1', ['verified@test.com']);
            await request()
                .post('/api/auth/verify-email')
                .send({ email: 'verified@test.com', code: user.verification_code });

            const res = await request()
                .post('/api/auth/login')
                .send({ email: 'verified@test.com', password: 'Password12345' });

            expect(res.status).toBe(200);
            expect(res.body.data.token).toBeTruthy();
        });

        it('resend-verification generates new code', async () => {
            await request()
                .post('/api/auth/register')
                .send({
                    email: 'resend@test.com',
                    password: 'Password12345',
                    display_name: 'Resend User',
                    terms_accepted: true,
                });

            const oldUser = await db.queryOne('SELECT verification_code FROM users WHERE email = $1', ['resend@test.com']);
            const oldCode = oldUser.verification_code;

            const res = await request()
                .post('/api/auth/resend-verification')
                .send({ email: 'resend@test.com' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const newUser = await db.queryOne('SELECT verification_code FROM users WHERE email = $1', ['resend@test.com']);
            expect(newUser.verification_code).toBeTruthy();
            expect(newUser.verification_code).not.toBe(oldCode);
        });

        it('setup creates admin with email_verified = true', async () => {
            await request()
                .post('/api/auth/setup')
                .send({ email: 'admin@test.com', password: 'Secret12345!', display_name: 'Admin' });

            const admin = await db.queryOne('SELECT email_verified FROM users WHERE email = $1', ['admin@test.com']);
            expect(admin.email_verified).toBe(true);
        });

        it('verify-email requires both email and code', async () => {
            const res = await request()
                .post('/api/auth/verify-email')
                .send({ email: 'test@test.com' });

            expect(res.status).toBe(400);
        });
    });

    // --- GET /api/auth/me ---
    describe('GET /api/auth/me', () => {
        it('returns current user with valid token', async () => {
            const { token, user } = await createUser();
            const res = await request()
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe(user.id);
        });

        it('returns country_code, region, unit_preference, and language_preference', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveProperty('country_code');
            expect(res.body.data).toHaveProperty('unit_preference');
            expect(res.body.data).toHaveProperty('language_preference');
            expect(res.body.data.language_preference).toBe('en');
        });

        it('returns store_exact_gps and export_obfuscation with defaults', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.store_exact_gps).toBe(true);
            expect(res.body.data.export_obfuscation).toBe('none');
        });

        it('rejects request with no token', async () => {
            const res = await request().get('/api/auth/me');
            expect(res.status).toBe(401);
        });

        it('rejects request with invalid token', async () => {
            const res = await request()
                .get('/api/auth/me')
                .set('Authorization', 'Bearer invalid-token-here');

            expect(res.status).toBe(401);
        });
    });

    // --- POST /api/auth/delete-account ---
    describe('POST /api/auth/delete-account', () => {
        it('soft-deletes user and anonymizes data', async () => {
            const { token, user } = await createUser();
            const res = await request()
                .post('/api/auth/delete-account')
                .set('Authorization', `Bearer ${token}`)
                .send({ confirmation: 'DELETE' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toMatch(/scheduled for deletion/i);

            // Verify DB state
            const dbUser = await db.queryOne('SELECT email, display_name, google_id, deleted_at FROM users WHERE id = $1', [user.id]);
            expect(dbUser.deleted_at).toBeTruthy();
            expect(dbUser.email).toBe(`deleted_${user.id}@deleted`);
            expect(dbUser.display_name).toBe('Deleted User');
            expect(dbUser.google_id).toBeNull();
        });

        it('requires confirmation = DELETE', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/auth/delete-account')
                .set('Authorization', `Bearer ${token}`)
                .send({ confirmation: 'wrong' });

            expect(res.status).toBe(400);
        });

        it('rejects request with missing confirmation', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/auth/delete-account')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(400);
        });

        it('deleted user cannot authenticate', async () => {
            const { token } = await createUser();
            // Soft-delete
            await request()
                .post('/api/auth/delete-account')
                .set('Authorization', `Bearer ${token}`)
                .send({ confirmation: 'DELETE' });

            // Try to access protected endpoint with same token
            const res = await request()
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/account deleted/i);
        });

        it('revokes site shares on deletion', async () => {
            const { token, user } = await createUser();
            const { user: otherUser } = await createUser({ email: 'other@test.com' });
            const site = await createSite(user.id);
            await shareSite(site.id, user.id, otherUser.id);

            // Verify share exists
            const before = await db.queryOne('SELECT id FROM site_shares WHERE site_id = $1', [site.id]);
            expect(before).toBeTruthy();

            // Delete user
            await request()
                .post('/api/auth/delete-account')
                .set('Authorization', `Bearer ${token}`)
                .send({ confirmation: 'DELETE' });

            // Verify share is gone
            const after = await db.queryOne('SELECT id FROM site_shares WHERE site_id = $1', [site.id]);
            expect(after).toBeNull();
        });

        it('deletes passkeys on deletion', async () => {
            const { token, user } = await createUser();
            await createPasskeyForUser(user.id);

            // Verify passkey exists
            const before = await db.queryOne('SELECT id FROM passkey_credentials WHERE user_id = $1', [user.id]);
            expect(before).toBeTruthy();

            // Delete user
            await request()
                .post('/api/auth/delete-account')
                .set('Authorization', `Bearer ${token}`)
                .send({ confirmation: 'DELETE' });

            // Verify passkey is gone
            const after = await db.queryOne('SELECT id FROM passkey_credentials WHERE user_id = $1', [user.id]);
            expect(after).toBeNull();
        });

        it('rejects demo user', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .post('/api/auth/delete-account')
                .set('Authorization', `Bearer ${token}`)
                .send({ confirmation: 'DELETE' });

            expect(res.status).toBe(403);
        });
    });

    // --- hardDeleteUser ---
    describe('hardDeleteUser', () => {
        it('removes all user data and returns S3 keys', async () => {
            const { user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);
            await db.query('UPDATE finds SET photo_path = $1 WHERE id = $2', ['uploads/find1.jpg', find.id]);
            await createPermission(user.id, site.id);

            // Add an image_path to the site
            await db.query('UPDATE sites SET image_path = $1 WHERE id = $2', ['uploads/site1.jpg', site.id]);

            // Soft-delete first (mimics real flow)
            await db.query("UPDATE users SET deleted_at = NOW(), email = 'deleted_' || id || '@deleted', display_name = 'Deleted User' WHERE id = $1", [user.id]);

            // Hard-delete
            const s3Keys = await db.hardDeleteUser(user.id);

            // Verify S3 keys returned
            expect(s3Keys).toContain('uploads/find1.jpg');
            expect(s3Keys).toContain('uploads/site1.jpg');

            // Verify user is gone
            const dbUser = await db.queryOne('SELECT id FROM users WHERE id = $1', [user.id]);
            expect(dbUser).toBeNull();

            // Verify sites, finds, permissions are gone
            const dbSite = await db.queryOne('SELECT id FROM sites WHERE user_id = $1', [user.id]);
            expect(dbSite).toBeNull();

            const dbFind = await db.queryOne('SELECT id FROM finds WHERE user_id = $1', [user.id]);
            expect(dbFind).toBeNull();

            const dbPerm = await db.queryOne('SELECT id FROM permissions WHERE user_id = $1', [user.id]);
            expect(dbPerm).toBeNull();
        });
    });

    // --- POST /api/auth/forgot-password (email channel) ---
    describe('POST /api/auth/forgot-password (email)', () => {
        it('returns success with maskedEmail for valid user', async () => {
            await createUser({ email: 'resetme@test.com' });
            const res = await request()
                .post('/api/auth/forgot-password')
                .send({ email: 'resetme@test.com', channel: 'email' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.channel).toBe('email');
            expect(res.body.data.maskedEmail).toMatch(/r\*\*\*@test\.com/);
        });

        it('stores reset_code in database', async () => {
            const { user } = await createUser({ email: 'resetcode@test.com' });
            await request()
                .post('/api/auth/forgot-password')
                .send({ email: 'resetcode@test.com', channel: 'email' });

            const dbUser = await db.queryOne('SELECT reset_code, reset_code_expires_at FROM users WHERE id = $1', [user.id]);
            expect(dbUser.reset_code).toBeTruthy();
            expect(dbUser.reset_code).toHaveLength(6);
            expect(dbUser.reset_code_expires_at).toBeTruthy();
        });

        it('returns success for non-existent email (no enumeration)', async () => {
            const res = await request()
                .post('/api/auth/forgot-password')
                .send({ email: 'nobody@test.com', channel: 'email' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('defaults to email channel when channel not specified', async () => {
            await createUser({ email: 'defaultchan@test.com' });
            const res = await request()
                .post('/api/auth/forgot-password')
                .send({ email: 'defaultchan@test.com' });

            expect(res.status).toBe(200);
            expect(res.body.data.channel).toBe('email');
        });
    });

    // --- POST /api/auth/reset-password (email code flow) ---
    describe('POST /api/auth/reset-password (email code)', () => {
        it('resets password with valid email code', async () => {
            const { user } = await createUser({ email: 'emailreset@test.com' });
            // Manually set a reset code
            const code = '123456';
            const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            await db.query('UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3', [code, expires, user.id]);

            const res = await request()
                .post('/api/auth/reset-password')
                .send({ email: 'emailreset@test.com', code: '123456', password: 'NewPassword123!', channel: 'email' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.message).toMatch(/password updated/i);

            // Verify code is cleared
            const dbUser = await db.queryOne('SELECT reset_code, reset_code_expires_at FROM users WHERE id = $1', [user.id]);
            expect(dbUser.reset_code).toBeNull();
            expect(dbUser.reset_code_expires_at).toBeNull();

            // Verify login with new password works
            const loginRes = await request()
                .post('/api/auth/login')
                .send({ email: 'emailreset@test.com', password: 'NewPassword123!' });
            expect(loginRes.status).toBe(200);
            expect(loginRes.body.data.token).toBeTruthy();
        });

        it('rejects invalid email code', async () => {
            const { user } = await createUser({ email: 'badcode@test.com' });
            const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            await db.query('UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3', ['123456', expires, user.id]);

            const res = await request()
                .post('/api/auth/reset-password')
                .send({ email: 'badcode@test.com', code: '999999', password: 'NewPassword123!', channel: 'email' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/invalid|expired/i);
        });

        it('rejects expired email code', async () => {
            const { user } = await createUser({ email: 'expired@test.com' });
            const expired = new Date(Date.now() - 60 * 1000).toISOString(); // expired 1 min ago
            await db.query('UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3', ['123456', expired, user.id]);

            const res = await request()
                .post('/api/auth/reset-password')
                .send({ email: 'expired@test.com', code: '123456', password: 'NewPassword123!', channel: 'email' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/expired/i);
        });

        it('rejects short password', async () => {
            const { user } = await createUser({ email: 'shortpw@test.com' });
            const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            await db.query('UPDATE users SET reset_code = $1, reset_code_expires_at = $2 WHERE id = $3', ['123456', expires, user.id]);

            const res = await request()
                .post('/api/auth/reset-password')
                .send({ email: 'shortpw@test.com', code: '123456', password: 'short', channel: 'email' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/at least 12|too small|>=12/i);
        });

        it('rejects reset for non-existent user', async () => {
            const res = await request()
                .post('/api/auth/reset-password')
                .send({ email: 'noone@test.com', code: '123456', password: 'NewPassword123!', channel: 'email' });

            expect(res.status).toBe(400);
        });
    });
});
