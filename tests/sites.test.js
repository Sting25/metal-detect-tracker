const { request, createUser, createAdmin, createSite } = require('./helpers');

describe('Sites Routes', () => {

    // --- DATA ISOLATION ---
    describe('Data Isolation', () => {
        it('GET /api/sites returns only the authenticated users sites', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            await createSite(userA.user.id, { name: 'Site A' });
            await createSite(userB.user.id, { name: 'Site B' });

            const res = await request()
                .get('/api/sites')
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].name).toBe('Site A');
        });

        it('GET /api/sites/:id returns 403 for another users site', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteB = await createSite(userB.user.id, { name: 'Site B' });

            const res = await request()
                .get(`/api/sites/${siteB.id}`)
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(403);
        });

        it('PUT /api/sites/:id returns 403 when editing another users site', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteB = await createSite(userB.user.id, { name: 'Site B' });

            const res = await request()
                .put(`/api/sites/${siteB.id}`)
                .set('Authorization', `Bearer ${userA.token}`)
                .send({ name: 'Hacked' });

            expect(res.status).toBe(403);
        });

        it('DELETE /api/sites/:id returns 403 when deleting another users site', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteB = await createSite(userB.user.id, { name: 'Site B' });

            const res = await request()
                .delete(`/api/sites/${siteB.id}`)
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(403);
        });

        it('GET /api/sites/stats counts only the authenticated users sites', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            await createSite(userA.user.id);
            await createSite(userA.user.id);
            await createSite(userB.user.id);

            const res = await request()
                .get('/api/sites/stats')
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.total).toBe(2);
        });

        it('GET /api/sites/map returns only the authenticated users sites', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            await createSite(userA.user.id);
            await createSite(userB.user.id);

            const res = await request()
                .get('/api/sites/map')
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });
    });

    // --- CRUD ---
    describe('CRUD', () => {
        it('POST /api/sites creates a site owned by authenticated user', async () => {
            const { token, user } = await createUser();
            const res = await request()
                .post('/api/sites')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'New Site', latitude: 39.5, longitude: -104.5, land_type: 'blm' });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('New Site');
            expect(res.body.data.user_id).toBe(user.id);
        });

        it('GET /api/sites/:id returns site with finds_count', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .get(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.finds_count).toBeDefined();
        });

        it('PUT /api/sites/:id updates site fields', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id, { name: 'Old Name' });

            const res = await request()
                .put(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'New Name' });

            expect(res.status).toBe(200);
            expect(res.body.data.name).toBe('New Name');
        });

        it('DELETE /api/sites/:id removes site', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .delete(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(site.id);
        });

        it('GET /api/sites/:id returns 404 for nonexistent site', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/sites/99999')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(404);
        });
    });

    // --- FILTERS ---
    describe('Filters', () => {
        it('filters by status', async () => {
            const { token, user } = await createUser();
            await createSite(user.id, { site_status: 'detecting' });
            await createSite(user.id, { site_status: 'identified' });

            const res = await request()
                .get('/api/sites?status=detecting')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].site_status).toBe('detecting');
        });

        it('filters by land_type', async () => {
            const { token, user } = await createUser();
            await createSite(user.id, { land_type: 'blm' });
            await createSite(user.id, { land_type: 'private' });

            const res = await request()
                .get('/api/sites?land_type=blm')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });
    });

    // --- AUTH ENFORCEMENT ---
    describe('Auth Enforcement', () => {
        it('returns 401 with no token', async () => {
            const res = await request().get('/api/sites');
            expect(res.status).toBe(401);
        });

        it('returns 401 with invalid token', async () => {
            const res = await request()
                .get('/api/sites')
                .set('Authorization', 'Bearer bad-token');

            expect(res.status).toBe(401);
        });
    });
});
