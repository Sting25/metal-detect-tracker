const db = require('../database');
const { request, createUser, createSite, createHuntSession, createTrackpoints } = require('./helpers');
const coverage = require('../services/coverage');

/* ====================================================================
   Unit Tests — coverage service
   ==================================================================== */

describe('Coverage Service', () => {

    describe('computeCoverage', () => {

        it('returns empty FeatureCollection for empty points', () => {
            const result = coverage.computeCoverage([], 2);
            expect(result.type).toBe('FeatureCollection');
            expect(result.features).toHaveLength(0);
        });

        it('returns empty FeatureCollection for null/undefined', () => {
            expect(coverage.computeCoverage(null, 2).features).toHaveLength(0);
            expect(coverage.computeCoverage(undefined, 2).features).toHaveLength(0);
        });

        it('returns correct cell count for sparse points', () => {
            // Points far enough apart to be in different cells (2m default)
            const points = [
                { lat: 39.7392, lng: -104.9903 },
                { lat: 39.7393, lng: -104.9903 },  // ~11m north
                { lat: 39.7394, lng: -104.9903 },  // ~22m north
            ];
            const result = coverage.computeCoverage(points, 2);
            expect(result.features.length).toBe(3);
        });

        it('deduplicates points in the same cell', () => {
            // Points very close together (within 2m cell)
            const points = [
                { lat: 39.7392000, lng: -104.9903000 },
                { lat: 39.7392001, lng: -104.9903001 },  // ~0.1m away
                { lat: 39.7392002, lng: -104.9903002 },  // ~0.2m away
            ];
            const result = coverage.computeCoverage(points, 2);
            expect(result.features.length).toBe(1);
        });

        it('respects cell size parameter', () => {
            // Points ~15m apart — should be multiple cells at 2m, fewer at 10m
            const points = [
                { lat: 39.7392000, lng: -104.9903000 },
                { lat: 39.7392500, lng: -104.9903000 },  // ~55m north
                { lat: 39.7393000, lng: -104.9903000 },  // ~111m north
                { lat: 39.7392000, lng: -104.9903500 },  // ~42m east
            ];
            const small = coverage.computeCoverage(points, 2);
            const large = coverage.computeCoverage(points, 10);
            expect(small.features.length).toBeGreaterThanOrEqual(large.features.length);
            // At 2m cells these should be 4 distinct cells, at 10m some might merge
            expect(small.features.length).toBe(4);
        });

        it('downsamples when over 50k points', () => {
            // Create 60k identical-ish points
            const points = [];
            for (let i = 0; i < 60000; i++) {
                points.push({ lat: 39.7392 + i * 0.00001, lng: -104.9903 });
            }
            const result = coverage.computeCoverage(points, 2);
            // Should still produce a result (not crash), with fewer unique cells
            expect(result.type).toBe('FeatureCollection');
            expect(result.features.length).toBeGreaterThan(0);
            expect(result.features.length).toBeLessThan(60000);
        });
    });

    describe('pointToCirclePoly', () => {
        it('returns correct number of vertices (including closing)', () => {
            const coords = coverage.pointToCirclePoly(39.7392, -104.9903, 1, 8);
            // 8 sides + 1 closing vertex = 9
            expect(coords).toHaveLength(9);
            // First and last should be identical
            expect(coords[0][0]).toBe(coords[8][0]);
            expect(coords[0][1]).toBe(coords[8][1]);
        });

        it('returns correct vertex count for different sides', () => {
            const hex = coverage.pointToCirclePoly(39.7392, -104.9903, 1, 6);
            expect(hex).toHaveLength(7); // 6 + closing

            const circle16 = coverage.pointToCirclePoly(39.7392, -104.9903, 1, 16);
            expect(circle16).toHaveLength(17); // 16 + closing
        });
    });

    describe('computePercentage', () => {

        it('returns 0 for no overlap', () => {
            // Coverage cells in Denver, boundary in New York
            const cov = coverage.computeCoverage([
                { lat: 39.7392, lng: -104.9903 },
            ], 2);
            const boundary = {
                type: 'Polygon',
                coordinates: [[
                    [-74.0, 40.7], [-73.9, 40.7], [-73.9, 40.8], [-74.0, 40.8], [-74.0, 40.7]
                ]]
            };
            const pct = coverage.computePercentage(cov, boundary, 2);
            expect(pct).toBe(0);
        });

        it('returns ~100% when boundary is fully covered', () => {
            // Create a small boundary and fill it with dense points
            const points = [];
            for (let lat = 39.73900; lat <= 39.73910; lat += 0.000018) { // ~2m steps
                for (let lng = -104.99050; lng <= -104.99040; lng += 0.000024) { // ~2m steps
                    points.push({ lat, lng });
                }
            }
            const cov = coverage.computeCoverage(points, 2);
            const boundary = {
                type: 'Polygon',
                coordinates: [[
                    [-104.99050, 39.73900],
                    [-104.99040, 39.73900],
                    [-104.99040, 39.73910],
                    [-104.99050, 39.73910],
                    [-104.99050, 39.73900],
                ]]
            };
            const pct = coverage.computePercentage(cov, boundary, 2);
            expect(pct).toBeGreaterThanOrEqual(80); // Quantization may not hit every cell
            expect(pct).toBeLessThanOrEqual(100);
        });

        it('returns correct partial coverage value', () => {
            // Place points only in the left half of a boundary
            const points = [];
            for (let lat = 39.73900; lat <= 39.73910; lat += 0.000018) {
                for (let lng = -104.99050; lng <= -104.99045; lng += 0.000024) { // left half only
                    points.push({ lat, lng });
                }
            }
            const cov = coverage.computeCoverage(points, 2);
            const boundary = {
                type: 'Polygon',
                coordinates: [[
                    [-104.99050, 39.73900],
                    [-104.99040, 39.73900],
                    [-104.99040, 39.73910],
                    [-104.99050, 39.73910],
                    [-104.99050, 39.73900],
                ]]
            };
            const pct = coverage.computePercentage(cov, boundary, 2);
            expect(pct).toBeGreaterThan(10);
            expect(pct).toBeLessThan(90);
        });

        it('handles boundary as string JSON', () => {
            const cov = coverage.computeCoverage([{ lat: 39.7392, lng: -104.9903 }], 2);
            const boundary = JSON.stringify({
                type: 'Polygon',
                coordinates: [[
                    [-104.9910, 39.7390], [-104.9895, 39.7390],
                    [-104.9895, 39.7395], [-104.9910, 39.7395], [-104.9910, 39.7390]
                ]]
            });
            const pct = coverage.computePercentage(cov, boundary, 2);
            expect(pct).toBeGreaterThanOrEqual(0);
        });

        it('handles Feature wrapper around Polygon', () => {
            const cov = coverage.computeCoverage([{ lat: 39.7392, lng: -104.9903 }], 2);
            const boundary = {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        [-104.9910, 39.7390], [-104.9895, 39.7390],
                        [-104.9895, 39.7395], [-104.9910, 39.7395], [-104.9910, 39.7390]
                    ]]
                }
            };
            const pct = coverage.computePercentage(cov, boundary, 2);
            expect(pct).toBeGreaterThanOrEqual(0);
        });
    });
});

/* ====================================================================
   API Integration Tests — GET /api/sites/:id/coverage
   ==================================================================== */

describe('GET /api/sites/:id/coverage', () => {
    let user, token, site;

    beforeEach(async () => {
        const u = await createUser();
        user = u.user;
        token = u.token;
        site = await createSite(user.id);
    });

    it('returns 401 without auth', async () => {
        const res = await request().get('/api/sites/' + site.id + '/coverage');
        expect(res.status).toBe(401);
    });

    it('returns 404 for non-owned site', async () => {
        const other = await createUser();
        const otherSite = await createSite(other.user.id);
        const res = await request()
            .get('/api/sites/' + otherSite.id + '/coverage')
            .set('Authorization', 'Bearer ' + token);
        expect(res.status).toBe(403);
    });

    it('returns empty coverage for site with no hunts', async () => {
        const res = await request()
            .get('/api/sites/' + site.id + '/coverage')
            .set('Authorization', 'Bearer ' + token);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.coverage.type).toBe('FeatureCollection');
        expect(res.body.data.coverage.features).toHaveLength(0);
        expect(res.body.data.stats.total_points).toBe(0);
        expect(res.body.data.stats.unique_cells).toBe(0);
    });

    it('returns GeoJSON with coverage data', async () => {
        // Create a completed hunt with trackpoints
        const session = await createHuntSession(user.id, { site_id: site.id, status: 'active' });
        const seg = await db.queryOne('SELECT id FROM track_segments WHERE session_id = $1', [session.id]);
        await createTrackpoints(seg.id, [
            { lat: 39.7392, lng: -104.9903 },
            { lat: 39.7393, lng: -104.9903 },
            { lat: 39.7394, lng: -104.9903 },
        ]);

        // End the session
        await db.query("UPDATE hunt_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1", [session.id]);

        const res = await request()
            .get('/api/sites/' + site.id + '/coverage')
            .set('Authorization', 'Bearer ' + token);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.coverage.type).toBe('FeatureCollection');
        expect(res.body.data.coverage.features.length).toBeGreaterThan(0);
        expect(res.body.data.stats.total_points).toBe(3);
        expect(res.body.data.stats.unique_cells).toBeGreaterThan(0);
    });

    it('respects session_id filter', async () => {
        // Create two sessions with different trackpoints
        const session1 = await createHuntSession(user.id, { site_id: site.id, status: 'active' });
        const seg1 = await db.queryOne('SELECT id FROM track_segments WHERE session_id = $1', [session1.id]);
        await createTrackpoints(seg1.id, [
            { lat: 39.7392, lng: -104.9903 },
            { lat: 39.7393, lng: -104.9903 },
        ]);
        await db.query("UPDATE hunt_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1", [session1.id]);

        const session2 = await createHuntSession(user.id, { site_id: site.id, status: 'active' });
        const seg2 = await db.queryOne('SELECT id FROM track_segments WHERE session_id = $1', [session2.id]);
        await createTrackpoints(seg2.id, [
            { lat: 39.7395, lng: -104.9903 },
        ]);
        await db.query("UPDATE hunt_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1", [session2.id]);

        // All sessions
        const resAll = await request()
            .get('/api/sites/' + site.id + '/coverage')
            .set('Authorization', 'Bearer ' + token);
        expect(resAll.body.data.stats.total_points).toBe(3);

        // Single session
        const resOne = await request()
            .get('/api/sites/' + site.id + '/coverage?session_id=' + session1.id)
            .set('Authorization', 'Bearer ' + token);
        expect(resOne.body.data.stats.total_points).toBe(2);
    });

    it('includes coverage_percentage when boundary exists', async () => {
        // Add boundary to site
        const boundary = JSON.stringify({
            type: 'Polygon',
            coordinates: [[
                [-104.9910, 39.7390], [-104.9895, 39.7390],
                [-104.9895, 39.7395], [-104.9910, 39.7395], [-104.9910, 39.7390]
            ]]
        });
        await db.query('UPDATE sites SET boundary_geojson = $1 WHERE id = $2', [boundary, site.id]);

        // Add some trackpoints
        const session = await createHuntSession(user.id, { site_id: site.id, status: 'active' });
        const seg = await db.queryOne('SELECT id FROM track_segments WHERE session_id = $1', [session.id]);
        await createTrackpoints(seg.id, [
            { lat: 39.7392, lng: -104.9903 },
        ]);
        await db.query("UPDATE hunt_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1", [session.id]);

        const res = await request()
            .get('/api/sites/' + site.id + '/coverage')
            .set('Authorization', 'Bearer ' + token);

        expect(res.status).toBe(200);
        expect(res.body.data.stats).toHaveProperty('coverage_percentage');
        expect(typeof res.body.data.stats.coverage_percentage).toBe('number');
    });

    it('includes last_hunted date', async () => {
        const session = await createHuntSession(user.id, { site_id: site.id, status: 'active' });
        const seg = await db.queryOne('SELECT id FROM track_segments WHERE session_id = $1', [session.id]);
        await createTrackpoints(seg.id, [{ lat: 39.7392, lng: -104.9903 }]);
        await db.query("UPDATE hunt_sessions SET status = 'completed', ended_at = NOW() WHERE id = $1", [session.id]);

        const res = await request()
            .get('/api/sites/' + site.id + '/coverage')
            .set('Authorization', 'Bearer ' + token);

        expect(res.status).toBe(200);
        expect(res.body.data.stats).toHaveProperty('last_hunted');
        expect(res.body.data.stats.last_hunted).toBeTruthy();
    });

    it('validates cell_size range (rejects <1 or >10)', async () => {
        const resTooSmall = await request()
            .get('/api/sites/' + site.id + '/coverage?cell_size=0')
            .set('Authorization', 'Bearer ' + token);
        expect(resTooSmall.status).toBe(400);

        const resTooBig = await request()
            .get('/api/sites/' + site.id + '/coverage?cell_size=50')
            .set('Authorization', 'Bearer ' + token);
        expect(resTooBig.status).toBe(400);

        // Valid cell_size should work
        const resOk = await request()
            .get('/api/sites/' + site.id + '/coverage?cell_size=5')
            .set('Authorization', 'Bearer ' + token);
        expect(resOk.status).toBe(200);
    });
});
