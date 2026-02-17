const { request, createUser, createAdmin } = require('./helpers');
const db = require('../database');

describe('Land Types API', () => {

    describe('GET /api/land-types', () => {
        it('returns US land types by default', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/land-types')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.length).toBeGreaterThanOrEqual(3);
            expect(res.body.data.every(t => t.country_code === 'US')).toBe(true);
        });

        it('returns GB land types when country=GB', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/land-types?country=GB')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.length).toBeGreaterThanOrEqual(2);
            expect(res.body.data.every(t => t.country_code === 'GB')).toBe(true);
        });

        it('returns sorted by sort_order', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/land-types?country=US')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            const orders = res.body.data.map(t => t.sort_order);
            const sorted = [...orders].sort((a, b) => a - b);
            expect(orders).toEqual(sorted);
        });

        it('includes user custom types in results', async () => {
            const { token } = await createUser();

            // Create a custom type first
            await request()
                .post('/api/land-types')
                .set('Authorization', `Bearer ${token}`)
                .send({ code: 'my_land', label: 'My Custom Land' });

            const res = await request()
                .get('/api/land-types')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            const custom = res.body.data.find(t => t.code === 'my_land');
            expect(custom).toBeTruthy();
            expect(custom.is_custom).toBe(true);
        });

        it('returns 401 without auth', async () => {
            const res = await request().get('/api/land-types');
            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/land-types', () => {
        it('creates a custom land type', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/land-types')
                .set('Authorization', `Bearer ${token}`)
                .send({ code: 'ranch', label: 'Ranch Land', description: 'Private ranch' });

            expect(res.status).toBe(201);
            expect(res.body.data.code).toBe('ranch');
            expect(res.body.data.label).toBe('Ranch Land');
            expect(res.body.data.is_custom).toBe(true);
        });

        it('sanitizes code to lowercase with underscores', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/land-types')
                .set('Authorization', `Bearer ${token}`)
                .send({ code: 'My Cool Land!', label: 'Cool Land' });

            expect(res.status).toBe(201);
            expect(res.body.data.code).toBe('my_cool_land_');
        });

        it('rejects missing code or label', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/land-types')
                .set('Authorization', `Bearer ${token}`)
                .send({ code: '', label: '' });

            expect(res.status).toBe(400);
        });

        it('rejects duplicate code for same country', async () => {
            const { token } = await createUser();
            await request()
                .post('/api/land-types')
                .set('Authorization', `Bearer ${token}`)
                .send({ code: 'test_type', label: 'Test' });

            const res = await request()
                .post('/api/land-types')
                .set('Authorization', `Bearer ${token}`)
                .send({ code: 'test_type', label: 'Test Again' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/already exists/i);
        });
    });

    describe('DELETE /api/land-types/:id', () => {
        it('deletes own custom land type', async () => {
            const { token } = await createUser();
            const createRes = await request()
                .post('/api/land-types')
                .set('Authorization', `Bearer ${token}`)
                .send({ code: 'deleteme', label: 'Delete Me' });

            const id = createRes.body.data.id;
            const res = await request()
                .delete(`/api/land-types/${id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
        });

        it('cannot delete preset land types', async () => {
            const { token } = await createUser();
            const preset = await db.queryOne("SELECT id FROM land_types WHERE is_custom = false LIMIT 1");

            const res = await request()
                .delete(`/api/land-types/${preset.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/preset/i);
        });

        it('cannot delete another users custom type', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });

            const createRes = await request()
                .post('/api/land-types')
                .set('Authorization', `Bearer ${userA.token}`)
                .send({ code: 'userA_type', label: 'User A Type' });

            const id = createRes.body.data.id;
            const res = await request()
                .delete(`/api/land-types/${id}`)
                .set('Authorization', `Bearer ${userB.token}`);

            expect(res.status).toBe(403);
        });

        it('returns 404 for nonexistent type', async () => {
            const { token } = await createUser();
            const res = await request()
                .delete('/api/land-types/99999')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(404);
        });
    });
});
