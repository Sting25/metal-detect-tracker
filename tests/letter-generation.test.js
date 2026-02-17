const { request, createUser, createSite, createPermission } = require('./helpers');
const db = require('../database');

describe('Letter Generation', () => {

    async function createLetterPrefs(userId) {
        await db.query(
            `INSERT INTO letter_preferences (user_id, full_name, address, phone, email, signature_name, signature_title, intro_text, commitments_html, closing_text)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT(user_id) DO UPDATE SET full_name = EXCLUDED.full_name`,
            [userId, 'John Smith', '123 Main St, Denver CO 80202', '555-1234', 'john@example.com',
             'John Smith', 'Metal Detecting Enthusiast',
             'I am writing to request permission to metal detect on {location}.',
             'Fill all holes\nRemove all trash\nShare significant finds',
             'Thank you for your consideration.']
        );
    }

    describe('POST /api/permissions/:id/letter', () => {
        it('generates letter PDF and returns URL', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id, { status: 'approved' });
            await createLetterPrefs(user.id);

            const res = await request()
                .post(`/api/permissions/${perm.id}/letter`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.filename).toContain('permission-letter-');
            expect(res.body.data.filename).toContain('.pdf');
            expect(res.body.data.download_url).toBeTruthy();
            expect(res.body.data.s3_path).toMatch(/^letters\//);
        });

        it('requires letter_preferences to exist (400 if missing)', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);

            const res = await request()
                .post(`/api/permissions/${perm.id}/letter`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('letter preferences');
        });

        it('stores generated_letters record', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id, { status: 'approved' });
            await createLetterPrefs(user.id);

            await request()
                .post(`/api/permissions/${perm.id}/letter`)
                .set('Authorization', `Bearer ${token}`);

            const letters = await db.query(
                'SELECT * FROM generated_letters WHERE permission_id = $1 AND user_id = $2',
                [perm.id, user.id]
            );
            expect(letters.rows).toHaveLength(1);
            expect(letters.rows[0].s3_path).toMatch(/^letters\//);
            expect(letters.rows[0].filename).toContain('.pdf');
        });

        it('cannot generate letter for other user\'s permission (403)', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const site = await createSite(userB.user.id);
            const perm = await createPermission(userB.user.id, site.id);
            await createLetterPrefs(userA.user.id);

            const res = await request()
                .post(`/api/permissions/${perm.id}/letter`)
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(403);
        });

        it('generated letter S3 path follows convention', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id, { status: 'approved' });
            await createLetterPrefs(user.id);

            const res = await request()
                .post(`/api/permissions/${perm.id}/letter`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.body.data.s3_path).toMatch(new RegExp(`^letters/${perm.id}/permission-letter-${perm.id}-\\d+\\.pdf$`));
        });
    });

    describe('GET /api/permissions/:id/letters', () => {
        it('lists letters for permission', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id, { status: 'approved' });
            await createLetterPrefs(user.id);

            // Generate two letters
            await request()
                .post(`/api/permissions/${perm.id}/letter`)
                .set('Authorization', `Bearer ${token}`);
            await request()
                .post(`/api/permissions/${perm.id}/letter`)
                .set('Authorization', `Bearer ${token}`);

            const res = await request()
                .get(`/api/permissions/${perm.id}/letters`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.count).toBe(2);
            expect(res.body.data[0].download_url).toBeTruthy();
        });

        it('cannot list letters for other user\'s permission (403)', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const site = await createSite(userB.user.id);
            const perm = await createPermission(userB.user.id, site.id);

            const res = await request()
                .get(`/api/permissions/${perm.id}/letters`)
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(403);
        });
    });

    describe('Auth Enforcement', () => {
        it('returns 401 without token', async () => {
            const res = await request().post('/api/permissions/1/letter');
            expect(res.status).toBe(401);
        });
    });
});
