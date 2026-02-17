const { request, createUser, createSite, createFind, createFindPhoto, createHuntSession } = require('./helpers');
const db = require('../database');
const path = require('path');

describe('Finds Routes', () => {

    // --- DATA ISOLATION ---
    describe('Data Isolation', () => {
        it('GET /api/finds returns only the authenticated users finds', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteA = await createSite(userA.user.id);
            const siteB = await createSite(userB.user.id);
            await createFind(userA.user.id, siteA.id, { description: 'Find A' });
            await createFind(userB.user.id, siteB.id, { description: 'Find B' });

            const res = await request()
                .get('/api/finds')
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].description).toBe('Find A');
        });

        it('GET /api/finds/:id returns 403 for another users find', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteB = await createSite(userB.user.id);
            const findB = await createFind(userB.user.id, siteB.id);

            const res = await request()
                .get(`/api/finds/${findB.id}`)
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(403);
        });

        it('PUT /api/finds/:id returns 403 when editing another users find', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteB = await createSite(userB.user.id);
            const findB = await createFind(userB.user.id, siteB.id);

            const res = await request()
                .put(`/api/finds/${findB.id}`)
                .set('Authorization', `Bearer ${userA.token}`)
                .send({ description: 'Hacked' });

            expect(res.status).toBe(403);
        });

        it('DELETE /api/finds/:id returns 403 when deleting another users find', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteB = await createSite(userB.user.id);
            const findB = await createFind(userB.user.id, siteB.id);

            const res = await request()
                .delete(`/api/finds/${findB.id}`)
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(403);
        });

        it('GET /api/finds/stats counts only the authenticated users finds', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const siteA = await createSite(userA.user.id);
            const siteB = await createSite(userB.user.id);
            await createFind(userA.user.id, siteA.id);
            await createFind(userA.user.id, siteA.id);
            await createFind(userB.user.id, siteB.id);

            const res = await request()
                .get('/api/finds/stats')
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.total).toBe(2);
        });
    });

    // --- CRUD ---
    describe('CRUD', () => {
        it('POST /api/finds creates a find linked to user and site', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    site_id: site.id,
                    description: 'Old coin',
                    date_found: '2026-01-20',
                    material: 'copper',
                });

            expect(res.status).toBe(201);
            expect(res.body.data.description).toBe('Old coin');
            expect(res.body.data.user_id).toBe(user.id);
            expect(res.body.data.site_id).toBe(site.id);
        });

        it('GET /api/finds/:id returns find with site_name', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id, { name: 'My Site' });
            const find = await createFind(user.id, site.id);

            const res = await request()
                .get(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.site_name).toBe('My Site');
        });

        it('PUT /api/finds/:id updates find fields', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id, { description: 'Old' });

            const res = await request()
                .put(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ description: 'Updated' });

            expect(res.status).toBe(200);
            expect(res.body.data.description).toBe('Updated');
        });

        it('DELETE /api/finds/:id removes find', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);

            const res = await request()
                .delete(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(find.id);
        });
    });

    // --- FILTERS ---
    describe('Filters', () => {
        it('filters by material', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            await createFind(user.id, site.id, { material: 'copper' });
            await createFind(user.id, site.id, { material: 'iron' });

            const res = await request()
                .get('/api/finds?material=copper')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].material).toBe('copper');
        });

        it('filters by site_id', async () => {
            const { token, user } = await createUser();
            const site1 = await createSite(user.id, { name: 'Site 1' });
            const site2 = await createSite(user.id, { name: 'Site 2' });
            await createFind(user.id, site1.id);
            await createFind(user.id, site2.id);

            const res = await request()
                .get(`/api/finds?site_id=${site1.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });
    });

    // --- DEPTH CM CONVERSION ---
    describe('Depth cm conversion', () => {
        it('POST stores depth_cm when depth_inches is provided', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    site_id: site.id,
                    description: 'Depth test coin',
                    date_found: '2026-01-20',
                    material: 'copper',
                    depth_inches: 6,
                });

            expect(res.status).toBe(201);
            expect(res.body.data.depth_cm).toBeCloseTo(15.2, 0);
            expect(res.body.data.depth_inches).toBeCloseTo(6, 0);
        });

        it('POST stores depth_cm directly when provided', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    site_id: site.id,
                    description: 'Metric find',
                    date_found: '2026-01-20',
                    material: 'silver',
                    depth_cm: 20,
                });

            expect(res.status).toBe(201);
            expect(res.body.data.depth_cm).toBe(20);
        });

        it('GET returns both depth_cm and depth_inches', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);

            // Update the find to have depth_cm
            await db.query('UPDATE finds SET depth_cm = 25.4 WHERE id = $1', [find.id]);

            const res = await request()
                .get(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.depth_cm).toBe(25.4);
            expect(res.body.data.depth_inches).toBeCloseTo(10, 0);
        });

        it('PUT converts depth_inches to depth_cm', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);

            const res = await request()
                .put(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ depth_inches: 8 });

            expect(res.status).toBe(200);
            expect(res.body.data.depth_cm).toBeCloseTo(20.3, 0);
            expect(res.body.data.depth_inches).toBeCloseTo(8, 0);
        });

        it('PUT accepts depth_cm directly and computes depth_inches', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);

            const res = await request()
                .put(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ depth_cm: 30 });

            expect(res.status).toBe(200);
            expect(res.body.data.depth_cm).toBe(30);
            expect(res.body.data.depth_inches).toBeCloseTo(11.8, 0);
        });
    });

    // --- CATEGORIES AND TAGS ---
    describe('Categories and Tags', () => {
        it('POST creates find with category', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .send({ site_id: site.id, description: 'Silver ring', date_found: '2026-01-15', material: 'silver', category: 'jewelry' });

            expect(res.status).toBe(201);
            expect(res.body.data.category).toBe('jewelry');
        });

        it('POST rejects invalid category', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .send({ site_id: site.id, description: 'Something', date_found: '2026-01-15', category: 'invalid_category' });

            expect(res.status).toBe(400);
        });

        it('PUT updates category', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);

            const res = await request()
                .put(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ category: 'relic' });

            expect(res.status).toBe(200);
            expect(res.body.data.category).toBe('relic');
        });

        it('POST creates find with tags', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .send({ site_id: site.id, description: 'Old button', date_found: '2026-01-15', tags: 'old,rare,civil-war' });

            expect(res.status).toBe(201);
            expect(res.body.data.tags).toBe('old,rare,civil-war');
        });

        it('PUT updates tags', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);

            const res = await request()
                .put(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ tags: 'updated,tags' });

            expect(res.status).toBe(200);
            expect(res.body.data.tags).toBe('updated,tags');
        });

        it('GET filters by category', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            await db.query(
                "INSERT INTO finds (user_id, site_id, description, date_found, material, category) VALUES ($1, $2, 'Coin find', '2026-01-10', 'copper', 'coin')",
                [user.id, site.id]
            );
            await db.query(
                "INSERT INTO finds (user_id, site_id, description, date_found, material, category) VALUES ($1, $2, 'Ring find', '2026-01-11', 'silver', 'jewelry')",
                [user.id, site.id]
            );

            const res = await request()
                .get('/api/finds?category=coin')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].category).toBe('coin');
        });

        it('GET filters by tag', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            await db.query(
                "INSERT INTO finds (user_id, site_id, description, date_found, material, tags) VALUES ($1, $2, 'Tagged find', '2026-01-10', 'copper', 'old,rare')",
                [user.id, site.id]
            );
            await db.query(
                "INSERT INTO finds (user_id, site_id, description, date_found, material, tags) VALUES ($1, $2, 'Other find', '2026-01-11', 'iron', 'modern')",
                [user.id, site.id]
            );

            const res = await request()
                .get('/api/finds?tag=rare')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].description).toBe('Tagged find');
        });

        it('GET /api/finds/tags returns unique user tags', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            await db.query(
                "INSERT INTO finds (user_id, site_id, description, date_found, material, tags) VALUES ($1, $2, 'Find 1', '2026-01-10', 'copper', 'old,rare')",
                [user.id, site.id]
            );
            await db.query(
                "INSERT INTO finds (user_id, site_id, description, date_found, material, tags) VALUES ($1, $2, 'Find 2', '2026-01-11', 'iron', 'rare,modern')",
                [user.id, site.id]
            );

            const res = await request()
                .get('/api/finds/tags')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual(['modern', 'old', 'rare']);
        });
    });

    // --- MULTI-PHOTO ---
    describe('Multi-Photo', () => {
        it('POST with multiple photos creates find_photos rows', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .field('site_id', site.id)
                .field('description', 'Multi photo find')
                .field('date_found', '2026-01-15')
                .field('material', 'copper')
                .attach('photos', Buffer.from('fake-jpg-1'), 'photo1.jpg')
                .attach('photos', Buffer.from('fake-jpg-2'), 'photo2.jpg');

            expect(res.status).toBe(201);
            expect(res.body.data.photos).toHaveLength(2);
            expect(res.body.data.photos[0].sort_order).toBe(0);
            expect(res.body.data.photos[1].sort_order).toBe(1);
            expect(res.body.data.photo_url).toBe(res.body.data.photos[0].photo_url);
        });

        it('POST with no photos creates find without photos', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .send({ site_id: site.id, description: 'No photo', date_found: '2026-01-15' });

            expect(res.status).toBe(201);
            expect(res.body.data.photos).toHaveLength(0);
            expect(res.body.data.photo_url).toBeNull();
        });

        it('GET single find returns photos array', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);
            await createFindPhoto(find.id, { sort_order: 0 });
            await createFindPhoto(find.id, { sort_order: 1 });

            const res = await request()
                .get(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.photos).toHaveLength(2);
        });

        it('GET single find returns backward-compat photo_url from first photo', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);
            const photo = await createFindPhoto(find.id, { sort_order: 0 });

            const res = await request()
                .get(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.photo_url).toContain(photo.photo_path);
        });

        it('GET list returns photos for each find', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find1 = await createFind(user.id, site.id, { description: 'Find 1' });
            const find2 = await createFind(user.id, site.id, { description: 'Find 2' });
            await createFindPhoto(find1.id, { sort_order: 0 });
            await createFindPhoto(find2.id, { sort_order: 0 });
            await createFindPhoto(find2.id, { sort_order: 1 });

            const res = await request()
                .get('/api/finds')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            const f1 = res.body.data.find(f => f.description === 'Find 1');
            const f2 = res.body.data.find(f => f.description === 'Find 2');
            expect(f1.photos).toHaveLength(1);
            expect(f2.photos).toHaveLength(2);
        });

        it('PUT appends new photos to existing gallery', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);
            await createFindPhoto(find.id, { sort_order: 0 });

            const res = await request()
                .put(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`)
                .attach('photos', Buffer.from('new-jpg'), 'new.jpg');

            expect(res.status).toBe(200);
            expect(res.body.data.photos).toHaveLength(2);
        });

        it('DELETE single photo removes from DB', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);
            const photo1 = await createFindPhoto(find.id, { sort_order: 0 });
            await createFindPhoto(find.id, { sort_order: 1 });

            const res = await request()
                .delete(`/api/finds/${find.id}/photos/${photo1.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);

            // Verify only 1 photo remains
            const check = await db.query('SELECT * FROM find_photos WHERE find_id = $1', [find.id]);
            expect(check.rows).toHaveLength(1);
        });

        it('DELETE single photo returns 404 for wrong find', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find1 = await createFind(user.id, site.id);
            const find2 = await createFind(user.id, site.id);
            const photo = await createFindPhoto(find1.id);

            const res = await request()
                .delete(`/api/finds/${find2.id}/photos/${photo.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(404);
        });

        it('PUT reorder updates sort_order', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);
            const p1 = await createFindPhoto(find.id, { sort_order: 0 });
            const p2 = await createFindPhoto(find.id, { sort_order: 1 });
            const p3 = await createFindPhoto(find.id, { sort_order: 2 });

            const res = await request()
                .put(`/api/finds/${find.id}/photos/reorder`)
                .set('Authorization', `Bearer ${token}`)
                .send({ photo_ids: [p3.id, p1.id, p2.id] });

            expect(res.status).toBe(200);
            expect(res.body.data[0].id).toBe(p3.id);
            expect(res.body.data[1].id).toBe(p1.id);
            expect(res.body.data[2].id).toBe(p2.id);
        });

        it('PUT reorder rejects invalid photo IDs', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);
            await createFindPhoto(find.id, { sort_order: 0 });

            const res = await request()
                .put(`/api/finds/${find.id}/photos/reorder`)
                .set('Authorization', `Bearer ${token}`)
                .send({ photo_ids: [99999] });

            expect(res.status).toBe(400);
        });

        it('DELETE find cascades to find_photos', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id);
            await createFindPhoto(find.id, { sort_order: 0 });
            await createFindPhoto(find.id, { sort_order: 1 });

            const res = await request()
                .delete(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            const check = await db.query('SELECT * FROM find_photos WHERE find_id = $1', [find.id]);
            expect(check.rows).toHaveLength(0);
        });

        it('cannot delete another users find photo', async () => {
            const userA = await createUser();
            const userB = await createUser();
            const site = await createSite(userA.user.id);
            const find = await createFind(userA.user.id, site.id);
            const photo = await createFindPhoto(find.id);

            const res = await request()
                .delete(`/api/finds/${find.id}/photos/${photo.id}`)
                .set('Authorization', `Bearer ${userB.token}`);

            expect(res.status).toBe(403);
        });
    });

    // --- QUICK LOG (minimal fields) ---
    describe('Quick Log (minimal POST)', () => {
        it('POST with minimal fields (site_id + description + category) returns 201', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .field('site_id', site.id)
                .field('description', 'Quick coin find')
                .field('category', 'coin')
                .field('date', '2026-02-13');

            expect(res.status).toBe(201);
            expect(res.body.data.description).toBe('Quick coin find');
            expect(res.body.data.category).toBe('coin');
        });

        it('POST with minimal fields + photo returns 201', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .field('site_id', site.id)
                .field('description', 'Quick photo find')
                .field('date', '2026-02-13')
                .attach('photos', Buffer.from('quick-log-photo'), 'quick.jpg');

            expect(res.status).toBe(201);
            expect(res.body.data.photos).toHaveLength(1);
        });

        it('POST with GPS coordinates stores lat/lng', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .field('site_id', site.id)
                .field('description', 'GPS find')
                .field('date', '2026-02-13')
                .field('latitude', '39.739236')
                .field('longitude', '-104.990251');

            expect(res.status).toBe(201);
            expect(parseFloat(res.body.data.latitude)).toBeCloseTo(39.739236, 4);
            expect(parseFloat(res.body.data.longitude)).toBeCloseTo(-104.990251, 4);
        });

        it('POST auto-attaches to active hunt session', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);
            const session = await createHuntSession(user.id, { site_id: site.id });

            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .field('site_id', site.id)
                .field('description', 'Hunt session find')
                .field('date', '2026-02-13');

            expect(res.status).toBe(201);
            expect(res.body.data.hunt_session_id).toBe(session.id);
        });

        it('POST returns complete find object in response', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .field('site_id', site.id)
                .field('description', 'Complete check')
                .field('date', '2026-02-13')
                .field('category', 'relic')
                .field('material', 'iron');

            expect(res.status).toBe(201);
            const d = res.body.data;
            expect(d).toHaveProperty('id');
            expect(d).toHaveProperty('description', 'Complete check');
            expect(d).toHaveProperty('category', 'relic');
            expect(d).toHaveProperty('material', 'iron');
            expect(d).toHaveProperty('photos');
            expect(d).toHaveProperty('date');
        });
    });

    // --- AUTH ---
    describe('Auth Enforcement', () => {
        it('returns 401 with no token', async () => {
            const res = await request().get('/api/finds');
            expect(res.status).toBe(401);
        });
    });
});
