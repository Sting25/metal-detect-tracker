const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const { verifyToken, denyDemoUser } = require('../middleware/auth');
const { createImportUpload } = require('../middleware/upload');
const { processImportZip } = require('../services/import');
const db = require('../database');

const upload = createImportUpload();

// All routes require authentication
router.use(verifyToken);

/**
 * GET /api/imports/template — Download a sample import ZIP with example data.
 * Shows users the expected format for each data type.
 */
router.get('/template', function (_req, res) {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const PREFIX = 'signal-bouncer-export/';

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename="signal-bouncer-import-template.zip"');
    archive.pipe(res);

    // Manifest
    const manifest = {
        version: 1,
        exported_at: new Date().toISOString(),
        user_email: 'template@example.com',
        item_counts: { sites: 2, finds: 3, permissions: 1, letter_preferences: 1 },
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: PREFIX + 'manifest.json' });

    // Sample sites
    const sites = [
        {
            id: 1,
            name: 'Riverside Park',
            description: 'Old park near the river with Civil War-era history',
            latitude: 38.8977,
            longitude: -77.0365,
            land_type: 'city',
            site_status: 'detecting',
            notes: 'Permission granted by city parks dept',
        },
        {
            id: 2,
            name: 'Johnson Farm Field',
            description: 'Private farmland, plowed field section',
            latitude: 39.1234,
            longitude: -76.5678,
            land_type: 'private',
            site_status: 'scouted',
            notes: '',
        },
    ];
    archive.append(JSON.stringify(sites, null, 2), { name: PREFIX + 'sites.json' });

    // Sample finds
    const finds = [
        {
            id: 1,
            site_id: 1,
            description: '1943 Steel Wheat Penny',
            date_found: '2026-01-15',
            material: 'iron',
            category: 'Coins',
            tags: 'penny,wheat,steel',
            depth_inches: 4,
            weight_grams: 2.7,
            latitude: 38.8978,
            longitude: -77.0366,
            notes: 'Found near the old oak tree',
            condition: 'good',
            estimated_age: '1943',
        },
        {
            id: 2,
            site_id: 1,
            description: 'Brass button — military style',
            date_found: '2026-01-15',
            material: 'brass',
            category: 'Buttons',
            tags: 'military,button,brass',
            depth_inches: 6,
            weight_grams: 8.5,
            latitude: 38.8979,
            longitude: -77.0364,
            notes: 'Possible Civil War era',
            condition: 'fair',
            estimated_age: '1860s',
        },
        {
            id: 3,
            site_id: 2,
            description: 'Silver ring — plain band',
            date_found: '2026-02-01',
            material: 'silver',
            category: 'Jewelry',
            tags: 'ring,silver',
            depth_inches: 3,
            weight_grams: 5.2,
            latitude: null,
            longitude: null,
            notes: '',
            condition: 'excellent',
            estimated_age: '',
        },
    ];
    archive.append(JSON.stringify(finds, null, 2), { name: PREFIX + 'finds.json' });

    // Sample permissions
    const permissions = [
        {
            id: 1,
            site_id: 2,
            land_type: 'private',
            agency_or_owner: 'Robert Johnson',
            contact_name: 'Robert Johnson',
            contact_phone: '(555) 123-4567',
            contact_email: 'rjohnson@example.com',
            contact_address: '123 Farm Rd, Anytown, MD 21001',
            status: 'approved',
            date_requested: '2026-01-10',
            date_granted: '2026-01-12',
            expiration_date: '2026-12-31',
            notes: 'Verbal permission, confirmed by email',
        },
    ];
    archive.append(JSON.stringify(permissions, null, 2), { name: PREFIX + 'permissions.json' });

    // Sample letter preferences
    const letterPrefs = {
        full_name: 'Jane Detectorist',
        address: '456 Metal Ave, Findtown, VA 22001',
        phone: '(555) 987-6543',
        email: 'jane@example.com',
        signature_name: 'Jane Detectorist',
        signature_title: 'Hobby Detectorist',
        intro_text: 'I am writing to request permission to use my metal detector on your property.',
        closing_text: 'Thank you for considering my request. I look forward to hearing from you.',
    };
    archive.append(JSON.stringify(letterPrefs, null, 2), { name: PREFIX + 'letter_preferences.json' });

    // CSV versions (sites)
    const sitesCsv = '\uFEFFid,name,latitude,longitude,land_type,site_status,notes\r\n'
        + '1,Riverside Park,38.8977,-77.0365,city,detecting,Permission granted by city parks dept\r\n'
        + '2,Johnson Farm Field,39.1234,-76.5678,private,scouted,\r\n';
    archive.append(sitesCsv, { name: PREFIX + 'sites.csv' });

    // CSV versions (finds)
    const findsCsv = '\uFEFFid,site_id,description,date_found,material,category,tags,depth_inches,weight_grams,latitude,longitude,notes,condition,estimated_age\r\n'
        + '1,1,1943 Steel Wheat Penny,2026-01-15,iron,Coins,"penny,wheat,steel",4,2.7,38.8978,-77.0366,Found near the old oak tree,good,1943\r\n'
        + '2,1,Brass button — military style,2026-01-15,brass,Buttons,"military,button,brass",6,8.5,38.8979,-77.0364,Possible Civil War era,fair,1860s\r\n'
        + '3,2,Silver ring — plain band,2026-02-01,silver,Jewelry,"ring,silver",3,5.2,,,,,excellent,\r\n';
    archive.append(findsCsv, { name: PREFIX + 'finds.csv' });

    // CSV versions (permissions)
    const permsCsv = '\uFEFFid,site_id,land_type,agency_or_owner,status,date_requested,date_granted,date_expires,notes\r\n'
        + '1,2,private,Robert Johnson,approved,2026-01-10,2026-01-12,2026-12-31,"Verbal permission, confirmed by email"\r\n';
    archive.append(permsCsv, { name: PREFIX + 'permissions.csv' });

    // README with format instructions
    const readme = '# Signal Bouncer Import Template\n'
        + '\n'
        + 'This ZIP file shows the expected format for importing data into Signal Bouncer.\n'
        + '\n'
        + '## How to Import\n'
        + '1. Edit the JSON files below with your data\n'
        + '2. Keep the manifest.json with version: 1\n'
        + '3. Go to Settings → Import Data and upload this ZIP\n'
        + '\n'
        + '## File Format\n'
        + '- **manifest.json** — Required. Must have `"version": 1`\n'
        + '- **sites.json** — Array of site objects (name is required)\n'
        + '- **finds.json** — Array of find objects (site_id must match a site in sites.json)\n'
        + '- **permissions.json** — Array of permission objects (agency_or_owner is required)\n'
        + '- **letter_preferences.json** — Object with your letter template preferences\n'
        + '- **photos/sites/** — Site photos (referenced by _image_file in sites.json)\n'
        + '- **photos/finds/** — Find photos (referenced by _photo_files in finds.json)\n'
        + '- **documents/permissions/** — Permission documents (referenced by _document_file)\n'
        + '\n'
        + '## Valid Values\n'
        + '\n'
        + '### land_type\n'
        + 'blm, usfs, state, county, city, private, other\n'
        + '\n'
        + '### site_status\n'
        + 'identified, scouted, detecting, exhausted\n'
        + '\n'
        + '### material\n'
        + 'iron, copper, brass, silver, gold, lead, zinc, nickel, aluminum, tin, unknown, other\n'
        + '\n'
        + '### condition\n'
        + 'excellent, good, fair, poor, fragment\n'
        + '\n'
        + '### permission status\n'
        + 'not_requested, pending, approved, denied, expired\n'
        + '\n'
        + '## Notes\n'
        + '- The CSV files are included for reference only — the importer reads the JSON files\n'
        + '- Site IDs in finds.json and permissions.json must match IDs in sites.json\n'
        + '- Duplicate site names will be renamed with "(imported)" suffix\n'
        + '- Photos can be included in the photos/ directories and referenced from the JSON\n'
        + '- All dates should be in YYYY-MM-DD format\n';
    archive.append(readme, { name: PREFIX + 'README.txt' });

    archive.finalize();
});

/**
 * POST /api/imports — Import data from a previously exported ZIP file.
 */
router.post('/', denyDemoUser, upload.single('file'), async function (req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const result = await processImportZip(req.file.buffer, req.user.id);

        db.logAuditEvent({
            userId: req.user.id,
            action: 'import.create',
            entityType: 'import',
            entityId: req.user.id,
            ipAddress: req.ip,
        });

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('Import error:', err);
        var knownMessages = ['Invalid ZIP file', 'ZIP is missing manifest.json'];
        var isKnown = knownMessages.some(function (m) { return err.message && err.message.includes(m); })
            || (err.message && err.message.startsWith('Unsupported manifest version'));
        var userError = isKnown ? err.message : 'Failed to import data';
        res.status(400).json({ success: false, error: userError });
    }
});

module.exports = router;
