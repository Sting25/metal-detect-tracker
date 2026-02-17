const { request, createUser, createAdmin, createSite, createFind, JWT_SECRET } = require('./helpers');
const db = require('../database');

describe('Admin Routes', () => {

    // --- ROLE ENFORCEMENT ---
    describe('Role Enforcement', () => {
        it('regular user gets 403 on GET /api/admin/stats', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/admin/stats')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
        });

        it('regular user gets 403 on GET /api/admin/users', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/admin/users')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
        });

        it('regular user gets 403 on POST /api/admin/invite-codes', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/admin/invite-codes')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
        });

        it('unauthenticated request gets 401 on admin routes', async () => {
            const res = await request().get('/api/admin/stats');
            expect(res.status).toBe(401);
        });
    });

    // --- FUNCTIONALITY ---
    describe('Stats', () => {
        it('GET /api/admin/stats returns correct counts', async () => {
            const admin = await createAdmin();
            await createUser({ email: 'user1@test.com' });
            await createSite(admin.user.id);

            const res = await request()
                .get('/api/admin/stats')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.totalUsers).toBe(2);
            expect(res.body.data.totalSites).toBe(1);
            expect(res.body.data.activeUsers).toBeDefined();
        });

        it('GET /api/admin/stats includes activeUsers count', async () => {
            const admin = await createAdmin();
            // Make a request so admin's last_active is set
            const res = await request()
                .get('/api/admin/stats')
                .set('Authorization', `Bearer ${admin.token}`);
            expect(res.status).toBe(200);
            // The admin just made a request, so activeUsers should be at least 1
            expect(res.body.data.activeUsers).toBeGreaterThanOrEqual(1);
        });
    });

    describe('User Management', () => {
        it('GET /api/admin/users lists all users with stats', async () => {
            const admin = await createAdmin();
            const user = await await createUser({ email: 'user1@test.com' });
            await createSite(user.user.id);

            const res = await request()
                .get('/api/admin/users')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            const userEntry = res.body.data.find(u => u.email === 'user1@test.com');
            expect(userEntry.sites_count).toBe(1);
        });

        it('PUT /api/admin/users/:id/role changes user role', async () => {
            const admin = await createAdmin();
            const user = await await createUser({ email: 'user1@test.com' });

            const res = await request()
                .put(`/api/admin/users/${user.user.id}/role`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ role: 'admin' });

            expect(res.status).toBe(200);
            expect(res.body.data.role).toBe('admin');
        });

        it('PUT /api/admin/users/:id/role rejects invalid role', async () => {
            const admin = await createAdmin();
            const user = await createUser();

            const res = await request()
                .put(`/api/admin/users/${user.user.id}/role`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ role: 'superadmin' });

            expect(res.status).toBe(400);
        });

        it('DELETE /api/admin/users/:id deletes user', async () => {
            const admin = await createAdmin();
            const user = await createUser();

            const res = await request()
                .delete(`/api/admin/users/${user.user.id}`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
        });

        it('DELETE /api/admin/users/:id prevents self-deletion', async () => {
            const admin = await createAdmin();

            const res = await request()
                .delete(`/api/admin/users/${admin.user.id}`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/cannot delete your own/i);
        });

        it('DELETE /api/admin/users/:id with FK data succeeds (hardDeleteUser)', async () => {
            const admin = await createAdmin();
            const user = await createUser();
            const site = await createSite(user.user.id);
            await createFind(user.user.id, site.id);

            const res = await request()
                .delete(`/api/admin/users/${user.user.id}`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            // Verify user is actually gone
            const check = await db.queryOne('SELECT id FROM users WHERE id = $1', [user.user.id]);
            expect(check).toBeNull();
        });
    });

    describe('User Disable/Enable', () => {
        it('PUT /api/admin/users/:id/disable disables a user', async () => {
            const admin = await createAdmin();
            const user = await createUser();

            const res = await request()
                .put(`/api/admin/users/${user.user.id}/disable`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.is_disabled).toBe(true);
        });

        it('PUT /api/admin/users/:id/disable toggles back to enabled', async () => {
            const admin = await createAdmin();
            const user = await createUser();

            // Disable first
            await request()
                .put(`/api/admin/users/${user.user.id}/disable`)
                .set('Authorization', `Bearer ${admin.token}`);

            // Toggle to enabled
            const res = await request()
                .put(`/api/admin/users/${user.user.id}/disable`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.is_disabled).toBe(false);
        });

        it('PUT /api/admin/users/:id/disable prevents self-disable', async () => {
            const admin = await createAdmin();

            const res = await request()
                .put(`/api/admin/users/${admin.user.id}/disable`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/cannot disable your own/i);
        });

        it('PUT /api/admin/users/:id/disable returns 404 for non-existent user', async () => {
            const admin = await createAdmin();

            const res = await request()
                .put('/api/admin/users/99999/disable')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(404);
        });

        it('disabled user cannot login with password', async () => {
            const admin = await createAdmin();
            const user = await createUser({ email: 'disabled@test.com', password: 'Password12345' });

            // Disable the user
            await request()
                .put(`/api/admin/users/${user.user.id}/disable`)
                .set('Authorization', `Bearer ${admin.token}`);

            // Try to login
            const res = await request()
                .post('/api/auth/login')
                .send({ email: 'disabled@test.com', password: 'Password12345' });

            expect(res.status).toBe(403);
            expect(res.body.isDisabled).toBe(true);
            expect(res.body.error).toMatch(/disabled/i);
        });

        it('disabled user cannot use authed endpoints', async () => {
            const admin = await createAdmin();
            const user = await createUser();

            // Disable the user
            await request()
                .put(`/api/admin/users/${user.user.id}/disable`)
                .set('Authorization', `Bearer ${admin.token}`);

            // Try to use an authed endpoint with existing token
            const res = await request()
                .get('/api/sites')
                .set('Authorization', `Bearer ${user.token}`);

            expect(res.status).toBe(403);
            expect(res.body.isDisabled).toBe(true);
        });

        it('GET /api/admin/users includes is_disabled field', async () => {
            const admin = await createAdmin();
            const user = await createUser();

            // Disable the user
            await request()
                .put(`/api/admin/users/${user.user.id}/disable`)
                .set('Authorization', `Bearer ${admin.token}`);

            const res = await request()
                .get('/api/admin/users')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            const disabledUser = res.body.data.find(u => u.id === user.user.id);
            expect(disabledUser.is_disabled).toBe(true);
        });
    });

    describe('Invite Codes', () => {
        it('POST /api/admin/invite-codes creates a code', async () => {
            const admin = await createAdmin();

            const res = await request()
                .post('/api/admin/invite-codes')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(201);
            expect(res.body.data.code).toBeTruthy();
        });

        it('GET /api/admin/invite-codes lists codes', async () => {
            const admin = await createAdmin();
            await request()
                .post('/api/admin/invite-codes')
                .set('Authorization', `Bearer ${admin.token}`);

            const res = await request()
                .get('/api/admin/invite-codes')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Settings', () => {
        it('GET /api/admin/settings returns settings', async () => {
            const admin = await createAdmin();
            const res = await request()
                .get('/api/admin/settings')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveProperty('notify_on_register');
        });

        it('PUT /api/admin/settings updates allowed key', async () => {
            const admin = await createAdmin();
            const res = await request()
                .put('/api/admin/settings')
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ key: 'notify_on_register', value: 'true' });

            expect(res.status).toBe(200);
            expect(res.body.data.value).toBe('true');
        });

        it('PUT /api/admin/settings rejects disallowed key', async () => {
            const admin = await createAdmin();
            const res = await request()
                .put('/api/admin/settings')
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ key: 'evil_setting', value: 'true' });

            expect(res.status).toBe(400);
        });
    });
});
