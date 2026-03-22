const db = require('../database');
const { request, createUser, createSite, createFind, createFindPhoto, shareSite } = require('./helpers');

describe('GET /api/uploads/:type/:filename', () => {
    it('returns 401 for unauthenticated request', async () => {
        const res = await request()
            .get('/api/uploads/finds/some-photo.jpg');

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it('allows user to access their own find photo', async () => {
        const { user, token } = await createUser();
        const site = await createSite(user.id);
        const find = await createFind(user.id, site.id);
        const photo = await createFindPhoto(find.id, {
            photo_path: 'finds/my-find-photo.jpg',
        });

        const res = await request()
            .get('/api/uploads/finds/my-find-photo.jpg')
            .set('Authorization', `Bearer ${token}`)
            .redirects(0);

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('mock-s3');
        expect(res.headers.location).toContain('finds/my-find-photo.jpg');
    });

    it('allows user to access their own site photo', async () => {
        const { user, token } = await createUser();
        const site = await createSite(user.id);
        // Set image_path on the site
        await db.query('UPDATE sites SET image_path = $1 WHERE id = $2', [
            'sites/my-site-photo.jpg',
            site.id,
        ]);

        const res = await request()
            .get('/api/uploads/sites/my-site-photo.jpg')
            .set('Authorization', `Bearer ${token}`)
            .redirects(0);

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('sites/my-site-photo.jpg');
    });

    it('denies access to another user\'s find photo', async () => {
        const owner = await createUser();
        const other = await createUser();
        const site = await createSite(owner.user.id);
        const find = await createFind(owner.user.id, site.id);
        await createFindPhoto(find.id, {
            photo_path: 'finds/owner-photo.jpg',
        });

        const res = await request()
            .get('/api/uploads/finds/owner-photo.jpg')
            .set('Authorization', `Bearer ${other.token}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Access denied');
    });

    it('denies access to another user\'s site photo', async () => {
        const owner = await createUser();
        const other = await createUser();
        const site = await createSite(owner.user.id);
        await db.query('UPDATE sites SET image_path = $1 WHERE id = $2', [
            'sites/owner-site-photo.jpg',
            site.id,
        ]);

        const res = await request()
            .get('/api/uploads/sites/owner-site-photo.jpg')
            .set('Authorization', `Bearer ${other.token}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Access denied');
    });

    it('allows shared user to access find photo on a shared site', async () => {
        const owner = await createUser();
        const shared = await createUser();
        const site = await createSite(owner.user.id);
        const find = await createFind(owner.user.id, site.id);
        await createFindPhoto(find.id, {
            photo_path: 'finds/shared-find-photo.jpg',
        });
        await shareSite(site.id, owner.user.id, shared.user.id, 'view');

        const res = await request()
            .get('/api/uploads/finds/shared-find-photo.jpg')
            .set('Authorization', `Bearer ${shared.token}`)
            .redirects(0);

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('finds/shared-find-photo.jpg');
    });

    it('allows shared user to access site photo on a shared site', async () => {
        const owner = await createUser();
        const shared = await createUser();
        const site = await createSite(owner.user.id);
        await db.query('UPDATE sites SET image_path = $1 WHERE id = $2', [
            'sites/shared-site-photo.jpg',
            site.id,
        ]);
        await shareSite(site.id, owner.user.id, shared.user.id, 'view');

        const res = await request()
            .get('/api/uploads/sites/shared-site-photo.jpg')
            .set('Authorization', `Bearer ${shared.token}`)
            .redirects(0);

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('sites/shared-site-photo.jpg');
    });

    it('supports token-based auth via ?token= query param', async () => {
        const { user, token } = await createUser();
        const site = await createSite(user.id);
        const find = await createFind(user.id, site.id);
        await createFindPhoto(find.id, {
            photo_path: 'finds/token-auth-photo.jpg',
        });

        const res = await request()
            .get('/api/uploads/finds/token-auth-photo.jpg?token=' + token)
            .redirects(0);

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('finds/token-auth-photo.jpg');
    });

    it('returns 400 for invalid upload type', async () => {
        const { token } = await createUser();

        const res = await request()
            .get('/api/uploads/invalid-type/some-file.jpg')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Invalid upload type');
    });

    it('returns 404 for non-existent file', async () => {
        const { token } = await createUser();

        const res = await request()
            .get('/api/uploads/finds/does-not-exist.jpg')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('File not found');
    });
});
