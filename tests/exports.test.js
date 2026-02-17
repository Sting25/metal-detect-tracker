const AdmZip = require('adm-zip');
const db = require('../database');
const s3 = require('../services/s3');
const { request, createUser, createSite, createFind, createPermission, createDemoUser } = require('./helpers');

describe('POST /api/exports', function () {

    it('returns 401 for unauthenticated request', async function () {
        var res = await request().post('/api/exports');
        expect(res.status).toBe(401);
    });

    it('returns 403 for demo user', async function () {
        var { token } = await createDemoUser();
        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token);
        expect(res.status).toBe(403);
    });

    it('returns valid ZIP with all expected files', async function () {
        var { user, token } = await createUser();
        var site = await createSite(user.id);
        await createFind(user.id, site.id);
        await createPermission(user.id, site.id);

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/zip');

        var zip = new AdmZip(res.body);
        var entries = zip.getEntries().map(function (e) { return e.entryName; });

        expect(entries).toContain('signal-bouncer-export/manifest.json');
        expect(entries).toContain('signal-bouncer-export/sites.json');
        expect(entries).toContain('signal-bouncer-export/sites.csv');
        expect(entries).toContain('signal-bouncer-export/finds.json');
        expect(entries).toContain('signal-bouncer-export/finds.csv');
        expect(entries).toContain('signal-bouncer-export/permissions.json');
        expect(entries).toContain('signal-bouncer-export/permissions.csv');
        expect(entries).toContain('signal-bouncer-export/letter_preferences.json');
    });

    it('manifest contains correct counts', async function () {
        var { user, token } = await createUser();
        var site = await createSite(user.id);
        await createFind(user.id, site.id);
        await createFind(user.id, site.id, { description: 'Second find', material: 'iron' });
        await createPermission(user.id, site.id);

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        var zip = new AdmZip(res.body);
        var manifest = JSON.parse(zip.readAsText('signal-bouncer-export/manifest.json'));

        expect(manifest.version).toBe(1);
        expect(manifest.user_email).toBe(user.email);
        expect(manifest.item_counts.sites).toBe(1);
        expect(manifest.item_counts.finds).toBe(2);
        expect(manifest.item_counts.permissions).toBe(1);
        expect(manifest.item_counts.letter_preferences).toBe(0);
        expect(manifest.exported_at).toBeTruthy();
    });

    it('sites.json contains user site data', async function () {
        var { user, token } = await createUser();
        await createSite(user.id, { name: 'My Test Site', latitude: 39.7392, longitude: -104.9903 });

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        var zip = new AdmZip(res.body);
        var sites = JSON.parse(zip.readAsText('signal-bouncer-export/sites.json'));

        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe('My Test Site');
        expect(sites[0].latitude).toBeCloseTo(39.7392, 4);
        expect(sites[0].longitude).toBeCloseTo(-104.9903, 4);
        // Internal fields should be stripped
        expect(sites[0].user_id).toBeUndefined();
        expect(sites[0].image_path).toBeUndefined();
        // No photo → no _image_file
        expect(sites[0]._image_file).toBeUndefined();
    });

    it('CSV has UTF-8 BOM and correct headers', async function () {
        var { user, token } = await createUser();
        await createSite(user.id);

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        var zip = new AdmZip(res.body);
        var csvBuffer = zip.readFile('signal-bouncer-export/sites.csv');
        var csvText = csvBuffer.toString('utf-8');

        // UTF-8 BOM
        expect(csvText.charCodeAt(0)).toBe(0xFEFF);

        // Header row
        var firstLine = csvText.split('\r\n')[0].replace('\uFEFF', '');
        expect(firstLine).toBe('id,name,latitude,longitude,land_type,site_status,notes,created_at,updated_at');
    });

    it('coordinate obfuscation: rounded_1km', async function () {
        var { user, token } = await createUser();
        await db.query('UPDATE users SET export_obfuscation = $1 WHERE id = $2', ['rounded_1km', user.id]);
        var site = await createSite(user.id, { latitude: 39.73921234, longitude: -104.99031234 });
        // Insert find with lat/lng directly (createFind helper doesn't support coordinates)
        await db.query(
            'INSERT INTO finds (user_id, site_id, description, date_found, material, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [user.id, site.id, 'Test find', '2026-01-15', 'copper', 39.73921234, -104.99031234]
        );

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        var zip = new AdmZip(res.body);
        var sites = JSON.parse(zip.readAsText('signal-bouncer-export/sites.json'));
        var finds = JSON.parse(zip.readAsText('signal-bouncer-export/finds.json'));

        // Rounded to 2 decimal places
        expect(sites[0].latitude).toBe(39.74);
        expect(sites[0].longitude).toBe(-104.99);
        expect(finds[0].latitude).toBe(39.74);
        expect(finds[0].longitude).toBe(-104.99);
    });

    it('coordinate obfuscation: rounded_10km', async function () {
        var { user, token } = await createUser();
        await db.query('UPDATE users SET export_obfuscation = $1 WHERE id = $2', ['rounded_10km', user.id]);
        await createSite(user.id, { latitude: 39.73921234, longitude: -104.99031234 });

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        var zip = new AdmZip(res.body);
        var sites = JSON.parse(zip.readAsText('signal-bouncer-export/sites.json'));

        // Rounded to 1 decimal place
        expect(sites[0].latitude).toBe(39.7);
        expect(sites[0].longitude).toBe(-105.0);
    });

    it('coordinate obfuscation: no_coords', async function () {
        var { user, token } = await createUser();
        await db.query('UPDATE users SET export_obfuscation = $1 WHERE id = $2', ['no_coords', user.id]);
        await createSite(user.id, { latitude: 39.7392, longitude: -104.9903 });

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        var zip = new AdmZip(res.body);
        var sites = JSON.parse(zip.readAsText('signal-bouncer-export/sites.json'));

        expect(sites[0].latitude).toBeUndefined();
        expect(sites[0].longitude).toBeUndefined();

        // CSV should also omit lat/lng columns
        var csvText = zip.readFile('signal-bouncer-export/sites.csv').toString('utf-8');
        var header = csvText.split('\r\n')[0].replace('\uFEFF', '');
        expect(header).not.toContain('latitude');
        expect(header).not.toContain('longitude');
    });

    it('includes S3 files in ZIP', async function () {
        var { user, token } = await createUser();
        // Upload a mock S3 file
        var key = 'sites/test-image.jpg';
        var fileBuffer = Buffer.from('fake-image-data-for-testing');
        await s3.uploadToS3(fileBuffer, key, 'image/jpeg');

        // Create a site with that image
        await db.query(
            'INSERT INTO sites (user_id, name, latitude, longitude, land_type, site_status, image_path) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [user.id, 'Site With Image', 39.0, -105.0, 'blm', 'identified', key]
        );

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        var zip = new AdmZip(res.body);
        var entries = zip.getEntries().map(function (e) { return e.entryName; });

        expect(entries).toContain('signal-bouncer-export/photos/sites/test-image.jpg');
        var imgData = zip.readFile('signal-bouncer-export/photos/sites/test-image.jpg');
        expect(imgData.toString()).toBe('fake-image-data-for-testing');

        // Verify _image_file reference in JSON
        var sites = JSON.parse(zip.readAsText('signal-bouncer-export/sites.json'));
        expect(sites[0]._image_file).toBe('test-image.jpg');
    });

    it('includes _photo_files and _document_file references in exported JSON', async function () {
        var { user, token } = await createUser();
        var site = await createSite(user.id);

        // Upload mock find photo and permission document
        var photoKey = 'finds/test-photo.jpg';
        var docKey = 'permissions/test-doc.pdf';
        await s3.uploadToS3(Buffer.from('fake-photo'), photoKey, 'image/jpeg');
        await s3.uploadToS3(Buffer.from('fake-doc'), docKey, 'application/pdf');

        var findResult = await db.query(
            'INSERT INTO finds (user_id, site_id, description, date_found, material, photo_path) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [user.id, site.id, 'Find with photo', '2026-01-15', 'copper', photoKey]
        );
        // Also insert into find_photos (as migration would do)
        await db.query(
            'INSERT INTO find_photos (find_id, photo_path, sort_order) VALUES ($1, $2, 0)',
            [findResult.rows[0].id, photoKey]
        );
        await db.query(
            'INSERT INTO permissions (user_id, site_id, land_type, agency_or_owner, document_path) VALUES ($1, $2, $3, $4, $5)',
            [user.id, site.id, 'private', 'Test Owner', docKey]
        );

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        var zip = new AdmZip(res.body);
        var finds = JSON.parse(zip.readAsText('signal-bouncer-export/finds.json'));
        var permissions = JSON.parse(zip.readAsText('signal-bouncer-export/permissions.json'));

        expect(finds[0]._photo_files).toEqual(['test-photo.jpg']);
        expect(permissions[0]._document_file).toBe('test-doc.pdf');

        // Verify the files are in the ZIP
        var entries = zip.getEntries().map(function (e) { return e.entryName; });
        expect(entries).toContain('signal-bouncer-export/photos/finds/test-photo.jpg');
        expect(entries).toContain('signal-bouncer-export/documents/permissions/test-doc.pdf');
    });

    it('empty data returns ZIP with empty arrays', async function () {
        var { user, token } = await createUser();

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        expect(res.status).toBe(200);

        var zip = new AdmZip(res.body);
        var sites = JSON.parse(zip.readAsText('signal-bouncer-export/sites.json'));
        var finds = JSON.parse(zip.readAsText('signal-bouncer-export/finds.json'));
        var permissions = JSON.parse(zip.readAsText('signal-bouncer-export/permissions.json'));
        var manifest = JSON.parse(zip.readAsText('signal-bouncer-export/manifest.json'));

        expect(sites).toEqual([]);
        expect(finds).toEqual([]);
        expect(permissions).toEqual([]);
        expect(manifest.item_counts.sites).toBe(0);
        expect(manifest.item_counts.finds).toBe(0);
    });

    it('skips missing S3 files gracefully', async function () {
        var { user, token } = await createUser();

        // Create a site with a non-existent S3 key
        await db.query(
            'INSERT INTO sites (user_id, name, latitude, longitude, land_type, site_status, image_path) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [user.id, 'Site With Missing Image', 39.0, -105.0, 'blm', 'identified', 'sites/nonexistent.jpg']
        );

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        // Should still succeed
        expect(res.status).toBe(200);

        var zip = new AdmZip(res.body);
        var sites = JSON.parse(zip.readAsText('signal-bouncer-export/sites.json'));
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe('Site With Missing Image');
    });

    it('does not include other users data', async function () {
        var { user: user1, token: token1 } = await createUser();
        var { user: user2 } = await createUser();

        await createSite(user1.id, { name: 'User1 Site' });
        await createSite(user2.id, { name: 'User2 Site' });

        var res = await request()
            .post('/api/exports')
            .set('Authorization', 'Bearer ' + token1)
            .buffer(true)
            .parse(function (res, cb) {
                var chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () { cb(null, Buffer.concat(chunks)); });
            });

        var zip = new AdmZip(res.body);
        var sites = JSON.parse(zip.readAsText('signal-bouncer-export/sites.json'));

        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe('User1 Site');
    });

});
