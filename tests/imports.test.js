const archiver = require('archiver');
const AdmZip = require('adm-zip');
const db = require('../database');
const s3 = require('../services/s3');
const { request, createUser, createSite, createFind, createPermission, createDemoUser } = require('./helpers');

// ---------------------------------------------------------------------------
// Helper: build a ZIP buffer from JSON data (mimics export format)
// ---------------------------------------------------------------------------

function buildTestZip(opts) {
    return new Promise(function (resolve, reject) {
        var archive = archiver('zip', { zlib: { level: 1 } });
        var chunks = [];
        archive.on('data', function (chunk) { chunks.push(chunk); });
        archive.on('end', function () { resolve(Buffer.concat(chunks)); });
        archive.on('error', reject);

        var prefix = 'signal-bouncer-export/';

        var manifest = opts.manifest || {
            version: 1,
            exported_at: new Date().toISOString(),
            user_email: 'test@test.com',
            item_counts: {
                sites: (opts.sites || []).length,
                finds: (opts.finds || []).length,
                permissions: (opts.permissions || []).length,
                letter_preferences: opts.letterPrefs ? 1 : 0,
            },
        };

        archive.append(JSON.stringify(manifest, null, 2), { name: prefix + 'manifest.json' });
        archive.append(JSON.stringify(opts.sites || [], null, 2), { name: prefix + 'sites.json' });
        archive.append(JSON.stringify(opts.finds || [], null, 2), { name: prefix + 'finds.json' });
        archive.append(JSON.stringify(opts.permissions || [], null, 2), { name: prefix + 'permissions.json' });
        archive.append(JSON.stringify(opts.letterPrefs || {}, null, 2), { name: prefix + 'letter_preferences.json' });

        // Add photo/document files
        if (opts.files) {
            for (var i = 0; i < opts.files.length; i++) {
                archive.append(opts.files[i].buffer, { name: prefix + opts.files[i].path });
            }
        }

        archive.finalize();
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/imports', function () {

    it('returns 401 for unauthenticated request', async function () {
        var res = await request().post('/api/imports');
        expect(res.status).toBe(401);
    });

    it('returns 403 for demo user', async function () {
        var { token } = await createDemoUser();
        var zipBuf = await buildTestZip({ sites: [] });
        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');
        expect(res.status).toBe(403);
    });

    it('returns 400 when no file uploaded', async function () {
        var { token } = await createUser();
        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('No file uploaded');
    });

    it('rejects invalid ZIP (not a ZIP file)', async function () {
        var { token } = await createUser();
        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', Buffer.from('this is not a zip'), 'import.zip');
        // multer rejects non-zip MIME, or service rejects invalid zip
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects ZIP with missing manifest', async function () {
        var { token } = await createUser();

        // Build a ZIP without manifest.json
        var zipBuf = await new Promise(function (resolve, reject) {
            var archive = archiver('zip', { zlib: { level: 1 } });
            var chunks = [];
            archive.on('data', function (chunk) { chunks.push(chunk); });
            archive.on('end', function () { resolve(Buffer.concat(chunks)); });
            archive.on('error', reject);
            archive.append('[]', { name: 'signal-bouncer-export/sites.json' });
            archive.finalize();
        });

        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('manifest');
    });

    it('rejects ZIP with invalid manifest version', async function () {
        var { token } = await createUser();
        var zipBuf = await buildTestZip({
            manifest: { version: 99 },
            sites: [],
        });

        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Unsupported manifest version');
    });

    it('imports sites with new IDs', async function () {
        var { user, token } = await createUser();

        var zipBuf = await buildTestZip({
            sites: [
                { id: 100, name: 'Site Alpha', latitude: 39.0, longitude: -105.0, land_type: 'blm', site_status: 'identified' },
                { id: 200, name: 'Site Beta', latitude: 40.0, longitude: -106.0, land_type: 'private', site_status: 'scouted' },
            ],
        });

        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.sites_imported).toBe(2);

        // Verify sites exist in DB with new IDs
        var dbSites = (await db.query('SELECT * FROM sites WHERE user_id = $1 ORDER BY id', [user.id])).rows;
        expect(dbSites).toHaveLength(2);
        expect(dbSites[0].name).toBe('Site Alpha');
        expect(dbSites[1].name).toBe('Site Beta');
        // IDs should be different from the original
        expect(dbSites[0].id).not.toBe(100);
        expect(dbSites[1].id).not.toBe(200);
    });

    it('remaps find site_id to new site IDs', async function () {
        var { user, token } = await createUser();

        var zipBuf = await buildTestZip({
            sites: [
                { id: 50, name: 'Test Site', latitude: 39.0, longitude: -105.0 },
            ],
            finds: [
                { id: 1, site_id: 50, description: 'Old coin', date_found: '2026-01-15', material: 'copper' },
            ],
        });

        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');

        expect(res.body.data.sites_imported).toBe(1);
        expect(res.body.data.finds_imported).toBe(1);

        // Verify the find's site_id points to the new site
        var dbSites = (await db.query('SELECT id FROM sites WHERE user_id = $1', [user.id])).rows;
        var dbFinds = (await db.query('SELECT * FROM finds WHERE user_id = $1', [user.id])).rows;
        expect(dbFinds[0].site_id).toBe(dbSites[0].id);
    });

    it('remaps permission site_id to new site IDs', async function () {
        var { user, token } = await createUser();

        var zipBuf = await buildTestZip({
            sites: [
                { id: 77, name: 'Perm Site', latitude: 39.0, longitude: -105.0 },
            ],
            permissions: [
                { id: 1, site_id: 77, land_type: 'blm', agency_or_owner: 'BLM Office', status: 'pending' },
            ],
        });

        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');

        expect(res.body.data.permissions_imported).toBe(1);

        var dbSites = (await db.query('SELECT id FROM sites WHERE user_id = $1', [user.id])).rows;
        var dbPerms = (await db.query('SELECT * FROM permissions WHERE user_id = $1', [user.id])).rows;
        expect(dbPerms[0].site_id).toBe(dbSites[0].id);
    });

    it('handles duplicate site names with "(imported)" suffix', async function () {
        var { user, token } = await createUser();

        // Create existing site
        await createSite(user.id, { name: 'My Site' });

        var zipBuf = await buildTestZip({
            sites: [
                { id: 1, name: 'My Site', latitude: 39.0, longitude: -105.0 },
            ],
        });

        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');

        expect(res.body.data.sites_imported).toBe(1);

        var dbSites = (await db.query('SELECT name FROM sites WHERE user_id = $1 ORDER BY id', [user.id])).rows;
        expect(dbSites).toHaveLength(2);
        expect(dbSites[0].name).toBe('My Site');
        expect(dbSites[1].name).toBe('My Site (imported)');
    });

    it('imports letter_preferences (upsert)', async function () {
        var { user, token } = await createUser();

        var zipBuf = await buildTestZip({
            letterPrefs: {
                full_name: 'John Doe',
                address: '123 Main St',
                phone: '555-0100',
                email: 'john@example.com',
                signature_name: 'J. Doe',
            },
        });

        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');

        expect(res.body.data.letter_preferences_imported).toBe(true);

        var lp = await db.queryOne('SELECT * FROM letter_preferences WHERE user_id = $1', [user.id]);
        expect(lp.full_name).toBe('John Doe');
        expect(lp.phone).toBe('555-0100');
    });

    it('imports S3 photos from ZIP', async function () {
        var { user, token } = await createUser();

        var photoBuffer = Buffer.from('fake-photo-data-for-import-test');

        var zipBuf = await buildTestZip({
            sites: [
                { id: 10, name: 'Photo Site', latitude: 39.0, longitude: -105.0, _image_file: 'site-photo.jpg' },
            ],
            files: [
                { path: 'photos/sites/site-photo.jpg', buffer: photoBuffer },
            ],
        });

        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');

        expect(res.body.data.sites_imported).toBe(1);

        // Verify photo was uploaded to S3 mock store
        var dbSite = (await db.query('SELECT * FROM sites WHERE user_id = $1', [user.id])).rows[0];
        expect(dbSite.image_path).toBeTruthy();
        expect(dbSite.image_path).toContain('sites/');

        // Verify the data was stored in S3
        var mockStore = s3.getMockStore();
        expect(mockStore.has(dbSite.image_path)).toBe(true);
        var storedData = mockStore.get(dbSite.image_path);
        expect(storedData.buffer.toString()).toBe('fake-photo-data-for-import-test');
    });

    it('empty data imports cleanly', async function () {
        var { token } = await createUser();

        var zipBuf = await buildTestZip({
            sites: [],
            finds: [],
            permissions: [],
        });

        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');

        expect(res.status).toBe(200);
        expect(res.body.data.sites_imported).toBe(0);
        expect(res.body.data.finds_imported).toBe(0);
        expect(res.body.data.permissions_imported).toBe(0);
        expect(res.body.data.errors).toHaveLength(0);
    });

    it('round-trip: export then import preserves data', async function () {
        // Create user1 with data
        var { user: user1, token: token1 } = await createUser();
        var site = await createSite(user1.id, { name: 'Round Trip Site', latitude: 39.7392, longitude: -104.9903 });
        await createFind(user1.id, site.id, { description: 'Round trip find', material: 'silver' });
        await createPermission(user1.id, site.id, { agency_or_owner: 'Test Agency', status: 'approved' });

        // Export user1's data
        var exportRes = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token1)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });
        expect(exportRes.status).toBe(200);

        // Create user2 and import
        var { user: user2, token: token2 } = await createUser();
        var importRes = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token2)
            .attach('file', exportRes.body, 'import.zip');

        expect(importRes.body.success).toBe(true);
        expect(importRes.body.data.sites_imported).toBe(1);
        expect(importRes.body.data.finds_imported).toBe(1);
        expect(importRes.body.data.permissions_imported).toBe(1);

        // Verify imported data
        var dbSites = (await db.query('SELECT * FROM sites WHERE user_id = $1', [user2.id])).rows;
        expect(dbSites).toHaveLength(1);
        expect(dbSites[0].name).toBe('Round Trip Site');
        expect(Number(dbSites[0].latitude)).toBeCloseTo(39.7392, 4);

        var dbFinds = (await db.query('SELECT * FROM finds WHERE user_id = $1', [user2.id])).rows;
        expect(dbFinds).toHaveLength(1);
        expect(dbFinds[0].description).toBe('Round trip find');
        expect(dbFinds[0].material).toBe('silver');

        var dbPerms = (await db.query('SELECT * FROM permissions WHERE user_id = $1', [user2.id])).rows;
        expect(dbPerms).toHaveLength(1);
        expect(dbPerms[0].agency_or_owner).toBe('Test Agency');
    });

    it('skips invalid items and reports errors', async function () {
        var { token } = await createUser();

        var zipBuf = await buildTestZip({
            sites: [
                { id: 1, name: 'Valid Site', latitude: 39.0, longitude: -105.0 },
                { id: 2 }, // Invalid — missing name
            ],
            finds: [
                { id: 1, site_id: 1, description: 'Valid find', material: 'copper' },
                { id: 2, site_id: 999, description: 'Invalid find — bad site_id' }, // site_id 999 won't be mapped
            ],
        });

        var res = await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token)
            .attach('file', zipBuf, 'import.zip');

        expect(res.body.success).toBe(true);
        expect(res.body.data.sites_imported).toBe(1);
        expect(res.body.data.finds_imported).toBe(1);
        expect(res.body.data.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('does not include other users data after import', async function () {
        var { user: user1 } = await createUser();
        var { user: user2, token: token2 } = await createUser();

        // User1 has existing data
        await createSite(user1.id, { name: 'User1 Existing Site' });

        // User2 imports new sites
        var zipBuf = await buildTestZip({
            sites: [
                { id: 1, name: 'User2 Imported Site', latitude: 39.0, longitude: -105.0 },
            ],
        });

        await request()
            .post('/api/imports')
            .set('Authorization', 'Bearer ' + token2)
            .attach('file', zipBuf, 'import.zip');

        // Verify user1's data is untouched
        var u1Sites = (await db.query('SELECT * FROM sites WHERE user_id = $1', [user1.id])).rows;
        expect(u1Sites).toHaveLength(1);
        expect(u1Sites[0].name).toBe('User1 Existing Site');

        // Verify user2 has only their imported data
        var u2Sites = (await db.query('SELECT * FROM sites WHERE user_id = $1', [user2.id])).rows;
        expect(u2Sites).toHaveLength(1);
        expect(u2Sites[0].name).toBe('User2 Imported Site');
    });

});
