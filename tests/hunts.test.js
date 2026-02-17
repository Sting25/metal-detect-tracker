const db = require('../database');
const { request, createUser, createSite, createFind, createDemoUser, createHuntSession } = require('./helpers');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Hunt Sessions API', function () {

    // -----------------------------------------------------------------------
    // Auth & Access
    // -----------------------------------------------------------------------

    it('returns 401 for unauthenticated request', async function () {
        var res = await request().get('/api/hunts');
        expect(res.status).toBe(401);
    });

    it('returns 403 for demo user on POST', async function () {
        var { token } = await createDemoUser();
        var res = await request()
            .post('/api/hunts')
            .set('Authorization', 'Bearer ' + token)
            .send({});
        expect(res.status).toBe(403);
    });

    // -----------------------------------------------------------------------
    // Start session
    // -----------------------------------------------------------------------

    it('starts a new hunt session without site_id', async function () {
        var { token } = await createUser();
        var res = await request()
            .post('/api/hunts')
            .set('Authorization', 'Bearer ' + token)
            .send({});
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('active');
        expect(res.body.data.site_id).toBeNull();
        expect(res.body.data.current_segment_id).toBeTruthy();
    });

    it('starts a new hunt session with site_id', async function () {
        var { user, token } = await createUser();
        var site = await createSite(user.id, { name: 'Hunt Site' });
        var res = await request()
            .post('/api/hunts')
            .set('Authorization', 'Bearer ' + token)
            .send({ site_id: site.id });
        expect(res.status).toBe(201);
        expect(res.body.data.site_id).toBe(site.id);
        expect(res.body.data.site_name).toBe('Hunt Site');
    });

    it('rejects start when another session is active', async function () {
        var { user, token } = await createUser();
        await createHuntSession(user.id);

        var res = await request()
            .post('/api/hunts')
            .set('Authorization', 'Bearer ' + token)
            .send({});
        expect(res.status).toBe(409);
        expect(res.body.error).toContain('active or paused');
    });

    it('rejects start when another session is paused', async function () {
        var { user, token } = await createUser();
        await createHuntSession(user.id, { status: 'paused' });

        var res = await request()
            .post('/api/hunts')
            .set('Authorization', 'Bearer ' + token)
            .send({});
        expect(res.status).toBe(409);
    });

    it('creates first track segment on start', async function () {
        var { user, token } = await createUser();
        var res = await request()
            .post('/api/hunts')
            .set('Authorization', 'Bearer ' + token)
            .send({});

        var segments = (await db.query(
            'SELECT * FROM track_segments WHERE session_id = $1',
            [res.body.data.id]
        )).rows;
        expect(segments).toHaveLength(1);
        expect(segments[0].segment_number).toBe(1);
    });

    // -----------------------------------------------------------------------
    // Pause / Resume
    // -----------------------------------------------------------------------

    it('pauses an active session', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        var res = await request()
            .post('/api/hunts/' + session.id + '/pause')
            .set('Authorization', 'Bearer ' + token)
            .send();
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('paused');
    });

    it('rejects pause on non-active session', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id, { status: 'paused' });

        var res = await request()
            .post('/api/hunts/' + session.id + '/pause')
            .set('Authorization', 'Bearer ' + token)
            .send();
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('not active');
    });

    it('rejects pause on another user\'s session', async function () {
        var { user: user1 } = await createUser();
        var { token: token2 } = await createUser();
        var session = await createHuntSession(user1.id);

        var res = await request()
            .post('/api/hunts/' + session.id + '/pause')
            .set('Authorization', 'Bearer ' + token2)
            .send();
        expect(res.status).toBe(404);
    });

    it('resumes a paused session', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        // Pause first
        await request()
            .post('/api/hunts/' + session.id + '/pause')
            .set('Authorization', 'Bearer ' + token)
            .send();

        // Resume
        var res = await request()
            .post('/api/hunts/' + session.id + '/resume')
            .set('Authorization', 'Bearer ' + token)
            .send();
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('active');
        expect(res.body.data.current_segment_id).toBeTruthy();
    });

    it('creates new segment on resume', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        await request()
            .post('/api/hunts/' + session.id + '/pause')
            .set('Authorization', 'Bearer ' + token)
            .send();

        await request()
            .post('/api/hunts/' + session.id + '/resume')
            .set('Authorization', 'Bearer ' + token)
            .send();

        var segments = (await db.query(
            'SELECT * FROM track_segments WHERE session_id = $1 ORDER BY segment_number',
            [session.id]
        )).rows;
        expect(segments).toHaveLength(2);
        expect(segments[0].segment_number).toBe(1);
        expect(segments[1].segment_number).toBe(2);
    });

    it('rejects resume on non-paused session', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id); // active

        var res = await request()
            .post('/api/hunts/' + session.id + '/resume')
            .set('Authorization', 'Bearer ' + token)
            .send();
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('not paused');
    });

    // -----------------------------------------------------------------------
    // End session
    // -----------------------------------------------------------------------

    it('ends an active session', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        var res = await request()
            .post('/api/hunts/' + session.id + '/end')
            .set('Authorization', 'Bearer ' + token)
            .send();
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('completed');
        expect(res.body.data.ended_at).toBeTruthy();
    });

    it('ends a paused session', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        await request()
            .post('/api/hunts/' + session.id + '/pause')
            .set('Authorization', 'Bearer ' + token)
            .send();

        var res = await request()
            .post('/api/hunts/' + session.id + '/end')
            .set('Authorization', 'Bearer ' + token)
            .send();
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('completed');
    });

    it('rejects end on already completed session', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        await request()
            .post('/api/hunts/' + session.id + '/end')
            .set('Authorization', 'Bearer ' + token)
            .send();

        var res = await request()
            .post('/api/hunts/' + session.id + '/end')
            .set('Authorization', 'Bearer ' + token)
            .send();
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('already completed');
    });

    it('computes distance_meters with haversine', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        // Get current segment
        var seg = await db.queryOne(
            'SELECT id FROM track_segments WHERE session_id = $1 AND ended_at IS NULL',
            [session.id]
        );

        // Insert some trackpoints with known coordinates
        // Denver (39.7392, -104.9903) → Boulder (40.0150, -105.2705) ≈ ~39 km
        await db.query(
            'INSERT INTO track_points (segment_id, lat, lng, recorded_at) VALUES ($1, 39.7392, -104.9903, $2), ($1, 40.0150, -105.2705, $3)',
            [seg.id, new Date().toISOString(), new Date(Date.now() + 60000).toISOString()]
        );

        var res = await request()
            .post('/api/hunts/' + session.id + '/end')
            .set('Authorization', 'Bearer ' + token)
            .send();

        expect(res.body.data.distance_meters).toBeGreaterThan(35000);
        expect(res.body.data.distance_meters).toBeLessThan(45000);
    });

    it('counts trackpoints correctly on end', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        var seg = await db.queryOne(
            'SELECT id FROM track_segments WHERE session_id = $1 AND ended_at IS NULL',
            [session.id]
        );

        await db.query(
            'INSERT INTO track_points (segment_id, lat, lng, recorded_at) VALUES ($1, 39.0, -105.0, $2), ($1, 39.1, -105.1, $3), ($1, 39.2, -105.2, $4)',
            [seg.id, new Date().toISOString(), new Date(Date.now() + 1000).toISOString(), new Date(Date.now() + 2000).toISOString()]
        );

        var res = await request()
            .post('/api/hunts/' + session.id + '/end')
            .set('Authorization', 'Bearer ' + token)
            .send();

        expect(res.body.data.trackpoint_count).toBe(3);
    });

    // -----------------------------------------------------------------------
    // Trackpoints
    // -----------------------------------------------------------------------

    it('uploads batch of trackpoints', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        var res = await request()
            .post('/api/hunts/' + session.id + '/trackpoints')
            .set('Authorization', 'Bearer ' + token)
            .send({
                idempotency_key: 'test-key-1',
                points: [
                    { lat: 39.7392, lng: -104.9903, accuracy_m: 5.0, recorded_at: new Date().toISOString() },
                    { lat: 39.7395, lng: -104.9905, accuracy_m: 4.0, recorded_at: new Date(Date.now() + 5000).toISOString() },
                ],
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.points_added).toBe(2);
    });

    it('rejects trackpoints for non-active session', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        await request()
            .post('/api/hunts/' + session.id + '/pause')
            .set('Authorization', 'Bearer ' + token)
            .send();

        var res = await request()
            .post('/api/hunts/' + session.id + '/trackpoints')
            .set('Authorization', 'Bearer ' + token)
            .send({
                idempotency_key: 'test-key-2',
                points: [
                    { lat: 39.7392, lng: -104.9903, recorded_at: new Date().toISOString() },
                ],
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('not active');
    });

    it('idempotency key prevents duplicate inserts', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        var payload = {
            idempotency_key: 'unique-key-dedup-test',
            points: [
                { lat: 39.7392, lng: -104.9903, recorded_at: new Date().toISOString() },
            ],
        };

        // First upload
        var res1 = await request()
            .post('/api/hunts/' + session.id + '/trackpoints')
            .set('Authorization', 'Bearer ' + token)
            .send(payload);
        expect(res1.body.points_added).toBe(1);

        // Second upload with same key — DB idempotency replays stored response
        var res2 = await request()
            .post('/api/hunts/' + session.id + '/trackpoints')
            .set('Authorization', 'Bearer ' + token)
            .send(payload);
        expect(res2.body.success).toBe(true);
        expect(res2.body.points_added).toBe(1); // Replayed original response

        // Verify only 1 point in DB
        var count = await db.queryOne(
            'SELECT COUNT(*) AS cnt FROM track_points tp JOIN track_segments ts ON tp.segment_id = ts.id WHERE ts.session_id = $1',
            [session.id]
        );
        expect(parseInt(count.cnt)).toBe(1);
    });

    it('updates trackpoint_count on session after upload', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        await request()
            .post('/api/hunts/' + session.id + '/trackpoints')
            .set('Authorization', 'Bearer ' + token)
            .send({
                idempotency_key: 'tp-count-key',
                points: [
                    { lat: 39.7, lng: -105.0, recorded_at: new Date().toISOString() },
                    { lat: 39.8, lng: -105.1, recorded_at: new Date(Date.now() + 1000).toISOString() },
                    { lat: 39.9, lng: -105.2, recorded_at: new Date(Date.now() + 2000).toISOString() },
                ],
            });

        var updated = await db.queryOne('SELECT trackpoint_count FROM hunt_sessions WHERE id = $1', [session.id]);
        expect(updated.trackpoint_count).toBe(3);
    });

    // -----------------------------------------------------------------------
    // Get trackpoints
    // -----------------------------------------------------------------------

    it('returns trackpoints grouped by segment', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        var seg = await db.queryOne(
            'SELECT id FROM track_segments WHERE session_id = $1 AND ended_at IS NULL',
            [session.id]
        );

        await db.query(
            'INSERT INTO track_points (segment_id, lat, lng, recorded_at) VALUES ($1, 39.0, -105.0, $2), ($1, 39.1, -105.1, $3)',
            [seg.id, new Date().toISOString(), new Date(Date.now() + 1000).toISOString()]
        );

        var res = await request()
            .get('/api/hunts/' + session.id + '/trackpoints')
            .set('Authorization', 'Bearer ' + token);
        expect(res.status).toBe(200);
        expect(res.body.data.segments).toHaveLength(1);
        expect(res.body.data.segments[0].points).toHaveLength(2);
        expect(res.body.data.segments[0].points[0]).toEqual([39.0, -105.0]);
        expect(res.body.data.total_points).toBe(2);
    });

    it('returns empty for session with no points', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        var res = await request()
            .get('/api/hunts/' + session.id + '/trackpoints')
            .set('Authorization', 'Bearer ' + token);
        expect(res.status).toBe(200);
        expect(res.body.data.total_points).toBe(0);
        expect(res.body.data.segments[0].points).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // List & Detail
    // -----------------------------------------------------------------------

    it('lists user hunt sessions with pagination', async function () {
        var { user, token } = await createUser();
        await createHuntSession(user.id, { status: 'completed' });
        await createHuntSession(user.id, { status: 'completed' });
        await createHuntSession(user.id, { status: 'completed' });

        var res = await request()
            .get('/api/hunts?limit=2&page=1')
            .set('Authorization', 'Bearer ' + token);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.pagination.total).toBe(3);
        expect(res.body.pagination.pages).toBe(2);
    });

    it('filters by status', async function () {
        var { user, token } = await createUser();
        await createHuntSession(user.id, { status: 'completed' });
        await createHuntSession(user.id, { status: 'completed' });

        var res = await request()
            .get('/api/hunts?status=completed')
            .set('Authorization', 'Bearer ' + token);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
    });

    it('returns session detail with segments', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        var res = await request()
            .get('/api/hunts/' + session.id)
            .set('Authorization', 'Bearer ' + token);
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(session.id);
        expect(res.body.data.segments).toHaveLength(1);
        expect(res.body.data.find_count).toBe(0);
    });

    it('does not list other user sessions', async function () {
        var { user: user1 } = await createUser();
        var { token: token2 } = await createUser();
        await createHuntSession(user1.id, { status: 'completed' });

        var res = await request()
            .get('/api/hunts')
            .set('Authorization', 'Bearer ' + token2);
        expect(res.body.data).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // Update & Delete
    // -----------------------------------------------------------------------

    it('updates session notes and site_id', async function () {
        var { user, token } = await createUser();
        var site = await createSite(user.id, { name: 'Update Site' });
        var session = await createHuntSession(user.id);

        var res = await request()
            .put('/api/hunts/' + session.id)
            .set('Authorization', 'Bearer ' + token)
            .send({ notes: 'Great session!', site_id: site.id });
        expect(res.status).toBe(200);
        expect(res.body.data.notes).toBe('Great session!');
        expect(res.body.data.site_id).toBe(site.id);
        expect(res.body.data.site_name).toBe('Update Site');
    });

    it('deletes session and cascades', async function () {
        var { user, token } = await createUser();
        var session = await createHuntSession(user.id);

        // Add a trackpoint
        var seg = await db.queryOne(
            'SELECT id FROM track_segments WHERE session_id = $1',
            [session.id]
        );
        await db.query(
            'INSERT INTO track_points (segment_id, lat, lng, recorded_at) VALUES ($1, 39.0, -105.0, $2)',
            [seg.id, new Date().toISOString()]
        );

        var res = await request()
            .delete('/api/hunts/' + session.id)
            .set('Authorization', 'Bearer ' + token);
        expect(res.status).toBe(200);

        // Verify cascade
        var sessionCheck = await db.queryOne('SELECT id FROM hunt_sessions WHERE id = $1', [session.id]);
        expect(sessionCheck).toBeNull();

        var segCheck = await db.queryOne('SELECT id FROM track_segments WHERE session_id = $1', [session.id]);
        expect(segCheck).toBeNull();

        var pointCheck = await db.queryOne('SELECT id FROM track_points WHERE segment_id = $1', [seg.id]);
        expect(pointCheck).toBeNull();
    });

    it('nullifies hunt_session_id on finds after delete', async function () {
        var { user, token } = await createUser();
        var site = await createSite(user.id, { name: 'Del Site' });
        var session = await createHuntSession(user.id);

        // Create find attached to the session
        await db.query(
            "INSERT INTO finds (user_id, site_id, description, date_found, material, hunt_session_id) VALUES ($1, $2, 'Test', '2026-01-15', 'copper', $3)",
            [user.id, site.id, session.id]
        );

        await request()
            .delete('/api/hunts/' + session.id)
            .set('Authorization', 'Bearer ' + token);

        var find = await db.queryOne('SELECT hunt_session_id FROM finds WHERE user_id = $1', [user.id]);
        expect(find.hunt_session_id).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Auto-attach finds
    // -----------------------------------------------------------------------

    it('auto-attaches find to active hunt session', async function () {
        var { user, token } = await createUser();
        var site = await createSite(user.id, { name: 'Attach Site' });
        var session = await createHuntSession(user.id);

        var res = await request()
            .post('/api/finds')
            .set('Authorization', 'Bearer ' + token)
            .send({
                site_id: site.id,
                description: 'Found during hunt',
                date: '2026-01-15',
                material: 'copper',
            });
        expect(res.status).toBe(201);

        var find = await db.queryOne('SELECT hunt_session_id FROM finds WHERE id = $1', [res.body.data.id]);
        expect(find.hunt_session_id).toBe(session.id);
    });

    it('does not auto-attach when hunt_session_id: null sent explicitly', async function () {
        var { user, token } = await createUser();
        var site = await createSite(user.id, { name: 'NoAttach Site' });
        await createHuntSession(user.id);

        var res = await request()
            .post('/api/finds')
            .set('Authorization', 'Bearer ' + token)
            .send({
                site_id: site.id,
                description: 'Not attached',
                date: '2026-01-15',
                material: 'copper',
                hunt_session_id: null,
            });
        expect(res.status).toBe(201);

        var find = await db.queryOne('SELECT hunt_session_id FROM finds WHERE id = $1', [res.body.data.id]);
        expect(find.hunt_session_id).toBeNull();
    });

    it('does not attach when no active session', async function () {
        var { user, token } = await createUser();
        var site = await createSite(user.id, { name: 'NoSession Site' });

        var res = await request()
            .post('/api/finds')
            .set('Authorization', 'Bearer ' + token)
            .send({
                site_id: site.id,
                description: 'No hunt',
                date: '2026-01-15',
                material: 'copper',
            });
        expect(res.status).toBe(201);

        var find = await db.queryOne('SELECT hunt_session_id FROM finds WHERE id = $1', [res.body.data.id]);
        expect(find.hunt_session_id).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Data isolation
    // -----------------------------------------------------------------------

    it('cannot access another user\'s session', async function () {
        var { user: user1 } = await createUser();
        var { token: token2 } = await createUser();
        var session = await createHuntSession(user1.id);

        var res = await request()
            .get('/api/hunts/' + session.id)
            .set('Authorization', 'Bearer ' + token2);
        expect(res.status).toBe(404);
    });

    it('cannot delete another user\'s session', async function () {
        var { user: user1 } = await createUser();
        var { token: token2 } = await createUser();
        var session = await createHuntSession(user1.id);

        var res = await request()
            .delete('/api/hunts/' + session.id)
            .set('Authorization', 'Bearer ' + token2);
        expect(res.status).toBe(404);
    });

    it('cannot upload trackpoints to another user\'s session', async function () {
        var { user: user1 } = await createUser();
        var { token: token2 } = await createUser();
        var session = await createHuntSession(user1.id);

        var res = await request()
            .post('/api/hunts/' + session.id + '/trackpoints')
            .set('Authorization', 'Bearer ' + token2)
            .send({
                idempotency_key: 'foreign-key',
                points: [{ lat: 39.0, lng: -105.0, recorded_at: new Date().toISOString() }],
            });
        expect(res.status).toBe(404);
    });

});
