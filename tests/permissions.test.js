const { request, createUser, createSite, createPermission } = require('./helpers');

describe('Permissions Routes', () => {

    describe('Data Isolation', () => {
        it('GET /api/permissions returns only the authenticated users permissions', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteA = await createSite(userA.user.id);
            const siteB = await createSite(userB.user.id);
            await createPermission(userA.user.id, siteA.id, { agency_or_owner: 'Agency A' });
            await createPermission(userB.user.id, siteB.id, { agency_or_owner: 'Agency B' });

            const res = await request()
                .get('/api/permissions')
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].agency_or_owner).toBe('Agency A');
        });

        it('GET /api/permissions/:id returns 403 for another users permission', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteB = await createSite(userB.user.id);
            const permB = await createPermission(userB.user.id, siteB.id);

            const res = await request()
                .get(`/api/permissions/${permB.id}`)
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(403);
        });

        it('PUT /api/permissions/:id returns 403 when editing another users permission', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteB = await createSite(userB.user.id);
            const permB = await createPermission(userB.user.id, siteB.id);

            const res = await request()
                .put(`/api/permissions/${permB.id}`)
                .set('Authorization', `Bearer ${userA.token}`)
                .send({ agency_or_owner: 'Hacked' });

            expect(res.status).toBe(403);
        });

        it('DELETE /api/permissions/:id returns 403 when deleting another users permission', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteB = await createSite(userB.user.id);
            const permB = await createPermission(userB.user.id, siteB.id);

            const res = await request()
                .delete(`/api/permissions/${permB.id}`)
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(403);
        });
    });

    describe('CRUD', () => {
        it('POST /api/permissions creates a permission', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .post('/api/permissions')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    site_id: site.id,
                    land_type: 'blm',
                    agency_or_owner: 'BLM Field Office',
                    status: 'pending',
                });

            expect(res.status).toBe(201);
            expect(res.body.data.agency_or_owner).toBe('BLM Field Office');
            expect(res.body.data.user_id).toBe(user.id);
        });

        it('GET /api/permissions/:id returns permission with site_name', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id, { name: 'Test Site' });
            const perm = await createPermission(user.id, site.id);

            const res = await request()
                .get(`/api/permissions/${perm.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.site_name).toBe('Test Site');
        });

        it('PUT /api/permissions/:id updates permission', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id, { status: 'pending' });

            const res = await request()
                .put(`/api/permissions/${perm.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ status: 'approved' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('approved');
        });

        it('DELETE /api/permissions/:id removes permission', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);

            const res = await request()
                .delete(`/api/permissions/${perm.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(perm.id);
        });
    });

    describe('Auth Enforcement', () => {
        it('returns 401 with no token', async () => {
            const res = await request().get('/api/permissions');
            expect(res.status).toBe(401);
        });
    });
});
