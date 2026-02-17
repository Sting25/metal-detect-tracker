const { request, createUser, createSite, createFind, shareSite } = require('./helpers');

describe('Site Sharing', () => {

    describe('Sharing basics', () => {
        it('POST /api/sites/:id/share grants access to another user', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const viewer = await createUser({ email: 'viewer@test.com' });
            const site = await createSite(owner.user.id);

            const res = await request()
                .post(`/api/sites/${site.id}/share`)
                .set('Authorization', `Bearer ${owner.token}`)
                .send({ email: 'viewer@test.com', permission_level: 'view' });

            expect(res.status).toBe(201);
            expect(res.body.data.shared_with.email).toBe('viewer@test.com');
        });

        it('shared user can see the site in GET /api/sites', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const viewer = await createUser({ email: 'viewer@test.com' });
            const site = await createSite(owner.user.id, { name: 'Shared Site' });
            await shareSite(site.id, owner.user.id, viewer.user.id, 'view');

            const res = await request()
                .get('/api/sites')
                .set('Authorization', `Bearer ${viewer.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].name).toBe('Shared Site');
        });

        it('shared user can access the site via GET /api/sites/:id', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const viewer = await createUser({ email: 'viewer@test.com' });
            const site = await createSite(owner.user.id);
            await shareSite(site.id, owner.user.id, viewer.user.id, 'view');

            const res = await request()
                .get(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${viewer.token}`);

            expect(res.status).toBe(200);
        });

        it('shared user with view permission CANNOT edit the site', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const viewer = await createUser({ email: 'viewer@test.com' });
            const site = await createSite(owner.user.id);
            await shareSite(site.id, owner.user.id, viewer.user.id, 'view');

            const res = await request()
                .put(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${viewer.token}`)
                .send({ name: 'Hacked Name' });

            expect(res.status).toBe(403);
        });

        it('shared user with edit permission CAN edit the site', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const editor = await createUser({ email: 'editor@test.com' });
            const site = await createSite(owner.user.id, { name: 'Original' });
            await shareSite(site.id, owner.user.id, editor.user.id, 'edit');

            const res = await request()
                .put(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${editor.token}`)
                .send({ name: 'Edited' });

            expect(res.status).toBe(200);
            expect(res.body.data.name).toBe('Edited');
        });

        it('shared user CANNOT delete the site', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const editor = await createUser({ email: 'editor@test.com' });
            const site = await createSite(owner.user.id);
            await shareSite(site.id, owner.user.id, editor.user.id, 'edit');

            const res = await request()
                .delete(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${editor.token}`);

            expect(res.status).toBe(403);
        });
    });

    describe('Share management', () => {
        it('GET /api/sites/:id/shares lists all shares (owner only)', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const viewer = await createUser({ email: 'viewer@test.com' });
            const site = await createSite(owner.user.id);
            await shareSite(site.id, owner.user.id, viewer.user.id, 'view');

            const res = await request()
                .get(`/api/sites/${site.id}/shares`)
                .set('Authorization', `Bearer ${owner.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].email).toBe('viewer@test.com');
        });

        it('non-owner cannot see share list', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const viewer = await createUser({ email: 'viewer@test.com' });
            const site = await createSite(owner.user.id);
            await shareSite(site.id, owner.user.id, viewer.user.id, 'view');

            const res = await request()
                .get(`/api/sites/${site.id}/shares`)
                .set('Authorization', `Bearer ${viewer.token}`);

            expect(res.status).toBe(403);
        });

        it('DELETE /api/sites/:id/share/:userId removes share', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const viewer = await createUser({ email: 'viewer@test.com' });
            const site = await createSite(owner.user.id);
            await shareSite(site.id, owner.user.id, viewer.user.id, 'view');

            const res = await request()
                .delete(`/api/sites/${site.id}/share/${viewer.user.id}`)
                .set('Authorization', `Bearer ${owner.token}`);

            expect(res.status).toBe(200);

            // Verify viewer can no longer access the site
            const accessRes = await request()
                .get(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${viewer.token}`);

            expect(accessRes.status).toBe(403);
        });
    });

    describe('Edge cases', () => {
        it('cannot share a site with its owner', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const site = await createSite(owner.user.id);

            const res = await request()
                .post(`/api/sites/${site.id}/share`)
                .set('Authorization', `Bearer ${owner.token}`)
                .send({ email: 'owner@test.com' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/cannot share.*owner/i);
        });

        it('sharing with nonexistent email returns 404', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const site = await createSite(owner.user.id);

            const res = await request()
                .post(`/api/sites/${site.id}/share`)
                .set('Authorization', `Bearer ${owner.token}`)
                .send({ email: 'nobody@test.com' });

            expect(res.status).toBe(404);
        });

        it('non-owner cannot share the site', async () => {
            const owner = await createUser({ email: 'owner@test.com' });
            const viewer = await createUser({ email: 'viewer@test.com' });
            const other = await createUser({ email: 'other@test.com' });
            const site = await createSite(owner.user.id);
            await shareSite(site.id, owner.user.id, viewer.user.id, 'edit');

            const res = await request()
                .post(`/api/sites/${site.id}/share`)
                .set('Authorization', `Bearer ${viewer.token}`)
                .send({ email: 'other@test.com' });

            expect(res.status).toBe(403);
        });
    });
});
