const { request, createDemoUser, createUser, createSite, createFind, createPermission } = require('./helpers');
require('./setup');

describe('Demo Mode', () => {

    // ---------------------------------------------------------------
    // POST /api/auth/demo
    // ---------------------------------------------------------------
    describe('POST /api/auth/demo', () => {
        it('returns a token when demo user exists', async () => {
            await createDemoUser();
            const res = await request().post('/api/auth/demo').send();
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeTruthy();
            expect(res.body.data.user.email).toBe('demo@example.com');
        });

        it('returns 503 when demo user does not exist', async () => {
            const res = await request().post('/api/auth/demo').send();
            expect(res.status).toBe(503);
            expect(res.body.success).toBe(false);
        });

        it('returns is_demo: true in user data', async () => {
            await createDemoUser();
            const res = await request().post('/api/auth/demo').send();
            expect(res.body.data.user.is_demo).toBe(true);
        });
    });

    // ---------------------------------------------------------------
    // GET /api/auth/me for demo user
    // ---------------------------------------------------------------
    describe('GET /api/auth/me for demo user', () => {
        it('returns is_demo: true', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(res.body.data.is_demo).toBe(true);
        });
    });

    // ---------------------------------------------------------------
    // Demo user can READ data
    // ---------------------------------------------------------------
    describe('Demo user read access', () => {
        it('allows GET /api/sites', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .get('/api/sites')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
        });

        it('allows GET /api/finds', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .get('/api/finds')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
        });

        it('allows GET /api/permissions', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .get('/api/permissions')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
        });
    });

    // ---------------------------------------------------------------
    // Demo user BLOCKED from mutations
    // ---------------------------------------------------------------
    describe('Demo user mutation blocking', () => {
        it('blocks POST /api/sites', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .post('/api/sites')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Test', latitude: 40, longitude: -80, land_type: 'private' });
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('blocks PUT /api/sites/:id', async () => {
            const { user, token } = await createDemoUser();
            const site = await createSite(user.id);
            const res = await request()
                .put(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Updated' });
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('blocks DELETE /api/sites/:id', async () => {
            const { user, token } = await createDemoUser();
            const site = await createSite(user.id);
            const res = await request()
                .delete(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('blocks POST /api/finds', async () => {
            const { user, token } = await createDemoUser();
            const site = await createSite(user.id);
            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .send({ site_id: site.id, description: 'Test find', date_found: '2026-01-01', material: 'iron' });
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('blocks PUT /api/finds/:id', async () => {
            const { user, token } = await createDemoUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);
            const res = await request()
                .put(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ description: 'Updated' });
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('blocks DELETE /api/finds/:id', async () => {
            const { user, token } = await createDemoUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);
            const res = await request()
                .delete(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('blocks POST /api/permissions', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .post('/api/permissions')
                .set('Authorization', `Bearer ${token}`)
                .send({ land_type: 'private', agency_or_owner: 'Test Owner' });
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('blocks PUT /api/permissions/:id', async () => {
            const { user, token } = await createDemoUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const res = await request()
                .put(`/api/permissions/${perm.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ status: 'approved' });
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('blocks DELETE /api/permissions/:id', async () => {
            const { user, token } = await createDemoUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const res = await request()
                .delete(`/api/permissions/${perm.id}`)
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('blocks PUT /api/auth/preferences', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .put('/api/auth/preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ country_code: 'GB' });
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('blocks POST /api/auth/change-password', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .post('/api/auth/change-password')
                .set('Authorization', `Bearer ${token}`)
                .send({ current_password: 'old', new_password: 'NewPassword12345' });
            expect(res.status).toBe(403);
            expect(res.body.isDemo).toBe(true);
        });

        it('returns friendly error message', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .post('/api/sites')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Test', latitude: 40, longitude: -80 });
            expect(res.body.error).toContain('demo mode');
        });
    });

    // ---------------------------------------------------------------
    // Regular users are NOT affected by denyDemoUser
    // ---------------------------------------------------------------
    describe('Regular user not affected', () => {
        it('allows regular user to POST /api/sites', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/sites')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Regular Site', latitude: 40, longitude: -80, land_type: 'private' });
            expect(res.status).toBe(201);
        });
    });
});
