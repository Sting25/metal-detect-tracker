/**
 * Tests for server-side idempotency middleware.
 * Verifies that duplicate requests with the same x-idempotency-key
 * return the stored response without re-processing.
 */
const { request, createUser, createAdmin, createSite, createDemoUser, createHuntSession } = require('./helpers');
const db = require('../database');

describe('Idempotency Middleware', () => {

    // ------------------------------------------------------------------
    // Basic idempotency on POST /api/sites
    // ------------------------------------------------------------------

    it('request without idempotency key works normally', async () => {
        const { token } = await createUser();
        const res = await request()
            .post('/api/sites')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Test Site', latitude: 39.7, longitude: -104.9 });
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
    });

    it('first request with key processes normally and stores response', async () => {
        const { token } = await createUser();
        const key = 'test-key-' + Date.now();
        const res = await request()
            .post('/api/sites')
            .set('Authorization', `Bearer ${token}`)
            .set('x-idempotency-key', key)
            .send({ name: 'Idempotent Site', latitude: 39.7, longitude: -104.9 });
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);

        // Verify key was stored in DB
        const stored = await db.queryOne('SELECT * FROM idempotency_keys WHERE key = $1', [key]);
        expect(stored).toBeTruthy();
        expect(stored.response_status).toBe(201);
    });

    it('duplicate key returns stored response without re-processing', async () => {
        const { token } = await createUser();
        const key = 'dedup-key-' + Date.now();

        // First request
        const res1 = await request()
            .post('/api/sites')
            .set('Authorization', `Bearer ${token}`)
            .set('x-idempotency-key', key)
            .send({ name: 'First Site', latitude: 39.7, longitude: -104.9 });
        expect(res1.status).toBe(201);

        // Duplicate request — should return stored response, not create another site
        const res2 = await request()
            .post('/api/sites')
            .set('Authorization', `Bearer ${token}`)
            .set('x-idempotency-key', key)
            .send({ name: 'Should Not Create', latitude: 40.0, longitude: -105.0 });
        expect(res2.status).toBe(201);
        expect(res2.body.data.name).toBe('First Site');

        // Verify only one site was created
        const sites = (await db.query('SELECT * FROM sites WHERE user_id = $1', [res1.body.data.user_id])).rows;
        expect(sites.length).toBe(1);
    });

    it('different users can use same key independently', async () => {
        const { token: token1 } = await createUser();
        const { token: token2 } = await createUser();
        const key = 'shared-key-' + Date.now();

        const res1 = await request()
            .post('/api/sites')
            .set('Authorization', `Bearer ${token1}`)
            .set('x-idempotency-key', key)
            .send({ name: 'User 1 Site', latitude: 39.7, longitude: -104.9 });
        expect(res1.status).toBe(201);

        const res2 = await request()
            .post('/api/sites')
            .set('Authorization', `Bearer ${token2}`)
            .set('x-idempotency-key', key)
            .send({ name: 'User 2 Site', latitude: 40.0, longitude: -105.0 });
        expect(res2.status).toBe(201);
        expect(res2.body.data.name).toBe('User 2 Site');
    });

    // ------------------------------------------------------------------
    // Idempotency on POST /api/finds
    // ------------------------------------------------------------------

    it('idempotency works on POST /api/finds', async () => {
        const { user, token } = await createUser();
        const site = await createSite(user.id);
        const key = 'find-key-' + Date.now();

        const res1 = await request()
            .post('/api/finds')
            .set('Authorization', `Bearer ${token}`)
            .set('x-idempotency-key', key)
            .send({ site_id: site.id, description: 'Test Find', material: 'copper', date_found: '2026-01-15' });
        expect(res1.status).toBe(201);

        const res2 = await request()
            .post('/api/finds')
            .set('Authorization', `Bearer ${token}`)
            .set('x-idempotency-key', key)
            .send({ site_id: site.id, description: 'Duplicate Find', material: 'gold', date_found: '2026-01-16' });
        expect(res2.status).toBe(201);
        expect(res2.body.data.description).toBe('Test Find');

        const finds = (await db.query('SELECT * FROM finds WHERE user_id = $1', [user.id])).rows;
        expect(finds.length).toBe(1);
    });

    // ------------------------------------------------------------------
    // Idempotency on POST /api/hunts/:id/trackpoints
    // ------------------------------------------------------------------

    it('idempotency works on POST /api/hunts/:id/trackpoints', async () => {
        const { user, token } = await createUser();
        const session = await createHuntSession(user.id);

        const body = {
            idempotency_key: 'trackpoints-key-' + Date.now(),
            points: [{
                lat: 39.7392,
                lng: -104.9903,
                accuracy_m: 10,
                recorded_at: new Date().toISOString()
            }]
        };

        const res1 = await request()
            .post(`/api/hunts/${session.id}/trackpoints`)
            .set('Authorization', `Bearer ${token}`)
            .send(body);
        expect(res1.status).toBe(200);
        expect(res1.body.points_added).toBe(1);

        // Duplicate — should return stored response
        const res2 = await request()
            .post(`/api/hunts/${session.id}/trackpoints`)
            .set('Authorization', `Bearer ${token}`)
            .send(body);
        expect(res2.status).toBe(200);
        expect(res2.body.points_added).toBe(1);

        // Verify only 1 trackpoint exists
        const count = await db.queryOne(
            'SELECT COUNT(*) as cnt FROM track_points tp JOIN track_segments ts ON tp.segment_id = ts.id WHERE ts.session_id = $1',
            [session.id]
        );
        expect(parseInt(count.cnt)).toBe(1);
    });

    // ------------------------------------------------------------------
    // Idempotency preserves status codes
    // ------------------------------------------------------------------

    it('idempotent response preserves original status code on error', async () => {
        const { token } = await createUser();
        const key = 'error-key-' + Date.now();

        // Create a find with invalid site_id — should fail with 500 or appropriate error
        const res1 = await request()
            .post('/api/finds')
            .set('Authorization', `Bearer ${token}`)
            .set('x-idempotency-key', key)
            .send({ site_id: 999999, description: 'Bad Find', material: 'copper', date_found: '2026-01-15' });
        // Whatever status it returns, the duplicate should return the same
        const originalStatus = res1.status;

        const res2 = await request()
            .post('/api/finds')
            .set('Authorization', `Bearer ${token}`)
            .set('x-idempotency-key', key)
            .send({ site_id: 999999, description: 'Bad Find Again', material: 'gold', date_found: '2026-01-16' });
        expect(res2.status).toBe(originalStatus);
    });

    // ------------------------------------------------------------------
    // Auth checks still apply
    // ------------------------------------------------------------------

    it('returns 401 for unauthenticated request with key', async () => {
        const res = await request()
            .post('/api/sites')
            .set('x-idempotency-key', 'unauth-key')
            .send({ name: 'Unauth Site' });
        expect(res.status).toBe(401);
    });

    it('demo user still rejected even with idempotency key', async () => {
        const { token } = await createDemoUser();
        const res = await request()
            .post('/api/sites')
            .set('Authorization', `Bearer ${token}`)
            .set('x-idempotency-key', 'demo-key')
            .send({ name: 'Demo Site' });
        expect(res.status).toBe(403);
    });

    // ------------------------------------------------------------------
    // PUT routes with idempotency
    // ------------------------------------------------------------------

    it('idempotency works on PUT /api/sites/:id', async () => {
        const { user, token } = await createUser();
        const site = await createSite(user.id);
        const key = 'put-site-key-' + Date.now();

        const res1 = await request()
            .put(`/api/sites/${site.id}`)
            .set('Authorization', `Bearer ${token}`)
            .set('x-idempotency-key', key)
            .send({ name: 'Updated Name' });
        expect(res1.status).toBe(200);
        expect(res1.body.data.name).toBe('Updated Name');

        // Duplicate PUT — should return stored response
        const res2 = await request()
            .put(`/api/sites/${site.id}`)
            .set('Authorization', `Bearer ${token}`)
            .set('x-idempotency-key', key)
            .send({ name: 'Should Not Update' });
        expect(res2.status).toBe(200);
        expect(res2.body.data.name).toBe('Updated Name');
    });

    // ------------------------------------------------------------------
    // Cleanup job
    // ------------------------------------------------------------------

    it('cleanup deletes keys older than 7 days', async () => {
        const { user } = await createUser();

        // Insert an old key
        await db.query(
            "INSERT INTO idempotency_keys (key, user_id, response_status, response_body, created_at) VALUES ($1, $2, 200, $3, NOW() - INTERVAL '8 days')",
            ['old-key', user.id, JSON.stringify({ success: true })]
        );
        // Insert a recent key
        await db.query(
            "INSERT INTO idempotency_keys (key, user_id, response_status, response_body) VALUES ($1, $2, 200, $3)",
            ['recent-key', user.id, JSON.stringify({ success: true })]
        );

        // Run cleanup
        await db.query("DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '7 days'");

        const old = await db.queryOne('SELECT * FROM idempotency_keys WHERE key = $1', ['old-key']);
        const recent = await db.queryOne('SELECT * FROM idempotency_keys WHERE key = $1', ['recent-key']);
        expect(old).toBeFalsy();
        expect(recent).toBeTruthy();
    });
});
