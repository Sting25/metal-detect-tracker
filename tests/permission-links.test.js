const { request, createUser, createSite, createPermission, createPermissionLink } = require('./helpers');
const db = require('../database');

describe('Permission Links', () => {

    // =========================================================================
    // Auth'd endpoints (POST/GET/DELETE /api/permissions/:id/link(s))
    // =========================================================================

    describe('POST /api/permissions/:id/link', () => {
        it('creates a link with token and QR code', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);

            const res = await request()
                .post(`/api/permissions/${perm.id}/link`)
                .set('Authorization', `Bearer ${token}`)
                .send({ expires_in_days: 14 });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeTruthy();
            expect(res.body.data.token).toHaveLength(64);
            expect(res.body.data.url).toContain('permission-approve.html?token=');
            expect(res.body.data.qr_code).toMatch(/^data:image\/png;base64,/);
            expect(res.body.data.status).toBe('active');
            expect(res.body.data.expires_at).toBeTruthy();
        });

        it('returns 404 for non-existent permission', async () => {
            const { token } = await createUser();

            const res = await request()
                .post('/api/permissions/99999/link')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(res.status).toBe(404);
        });

        it('cannot create link for other user\'s permission (403)', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const site = await createSite(userB.user.id);
            const perm = await createPermission(userB.user.id, site.id);

            const res = await request()
                .post(`/api/permissions/${perm.id}/link`)
                .set('Authorization', `Bearer ${userA.token}`)
                .send({});

            expect(res.status).toBe(403);
        });
    });

    describe('GET /api/permissions/:id/links', () => {
        it('lists links for a permission', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);

            // Create two links
            await createPermissionLink(perm.id);
            await createPermissionLink(perm.id);

            const res = await request()
                .get(`/api/permissions/${perm.id}/links`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.count).toBe(2);
            expect(res.body.data[0].token).toBeTruthy();
            expect(res.body.data[0].status).toBe('active');
        });
    });

    describe('DELETE /api/permissions/:id/links/:lid', () => {
        it('revokes a permission link', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const link = await createPermissionLink(perm.id);

            const res = await request()
                .delete(`/api/permissions/${perm.id}/links/${link.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('revoked');

            // Verify in DB
            const updated = await db.queryOne('SELECT status FROM permission_links WHERE id = $1', [link.id]);
            expect(updated.status).toBe('revoked');
        });
    });

    describe('Auth Enforcement (link endpoints)', () => {
        it('returns 401 without token', async () => {
            const res = await request().post('/api/permissions/1/link').send({});
            expect(res.status).toBe(401);
        });
    });

    // =========================================================================
    // Public endpoints (GET/POST /api/p/:token)
    // =========================================================================

    describe('GET /api/p/:token', () => {
        it('returns permission details for active link', async () => {
            const { user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const link = await createPermissionLink(perm.id);

            const res = await request()
                .get(`/api/p/${link.token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBe(link.token);
            expect(res.body.data.status).toBe('active');
            expect(res.body.data.permission.id).toBe(perm.id);
            expect(res.body.data.permission.site_name).toBe('Test Site');
            expect(res.body.data.requester_name).toBeTruthy();
        });

        it('returns 410 for expired link', async () => {
            const { user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const link = await createPermissionLink(perm.id, {
                expires_at: new Date(Date.now() - 1000), // expired 1 second ago
            });

            const res = await request()
                .get(`/api/p/${link.token}`);

            expect(res.status).toBe(410);
            expect(res.body.error).toContain('expired');
        });

        it('returns 410 for already-approved link', async () => {
            const { user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const link = await createPermissionLink(perm.id, { status: 'approved' });

            const res = await request()
                .get(`/api/p/${link.token}`);

            expect(res.status).toBe(410);
            expect(res.body.error).toContain('approved');
        });
    });

    describe('POST /api/p/:token/approve', () => {
        it('approves and updates permission status', async () => {
            const { user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id, { status: 'pending' });
            const link = await createPermissionLink(perm.id);

            const res = await request()
                .post(`/api/p/${link.token}/approve`)
                .send({ signed_name: 'John Landowner' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('approved');
            expect(res.body.data.signed_name).toBe('John Landowner');

            // Verify link status updated
            const updatedLink = await db.queryOne('SELECT * FROM permission_links WHERE id = $1', [link.id]);
            expect(updatedLink.status).toBe('approved');
            expect(updatedLink.signed_name).toBe('John Landowner');
            expect(updatedLink.approved_at).toBeTruthy();

            // Verify permission status updated
            const updatedPerm = await db.queryOne('SELECT status FROM permissions WHERE id = $1', [perm.id]);
            expect(updatedPerm.status).toBe('approved');
        });

        it('requires signed_name (400)', async () => {
            const { user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const link = await createPermissionLink(perm.id);

            const res = await request()
                .post(`/api/p/${link.token}/approve`)
                .send({});

            expect(res.status).toBe(400);
        });

        it('cannot approve already-approved link (410)', async () => {
            const { user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const link = await createPermissionLink(perm.id, { status: 'approved' });

            const res = await request()
                .post(`/api/p/${link.token}/approve`)
                .send({ signed_name: 'Test' });

            expect(res.status).toBe(410);
        });

        it('cannot approve expired link (410)', async () => {
            const { user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const link = await createPermissionLink(perm.id, {
                expires_at: new Date(Date.now() - 1000),
            });

            const res = await request()
                .post(`/api/p/${link.token}/approve`)
                .send({ signed_name: 'Test' });

            expect(res.status).toBe(410);
        });
    });

    describe('POST /api/p/:token/deny', () => {
        it('denies and updates permission status', async () => {
            const { user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id, { status: 'pending' });
            const link = await createPermissionLink(perm.id);

            const res = await request()
                .post(`/api/p/${link.token}/deny`)
                .send({ reason: 'Not interested' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('denied');

            // Verify link status updated
            const updatedLink = await db.queryOne('SELECT * FROM permission_links WHERE id = $1', [link.id]);
            expect(updatedLink.status).toBe('denied');
            expect(updatedLink.denied_at).toBeTruthy();

            // Verify permission status updated
            const updatedPerm = await db.queryOne('SELECT status FROM permissions WHERE id = $1', [perm.id]);
            expect(updatedPerm.status).toBe('denied');
        });
    });
});
