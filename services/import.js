/**
 * Data import service — processes a ZIP archive (from a previous export) and
 * inserts records into the database for the given user.
 *
 * Best-effort: valid items are imported, invalid items are skipped with errors reported.
 */
var AdmZip = require('adm-zip');
var path = require('path');
var db = require('../database');
var s3 = require('./s3');

var PREFIX = 'signal-bouncer-export/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely read and parse a JSON file from the ZIP.
 * Returns null if the entry doesn't exist or is invalid JSON.
 */
function readJsonEntry(zip, name) {
    try {
        var text = zip.readAsText(PREFIX + name);
        if (!text) return null;
        return JSON.parse(text);
    } catch (_e) {
        return null;
    }
}

/**
 * Guess MIME type from a filename extension.
 */
function guessMime(filename) {
    var ext = path.extname(filename).toLowerCase();
    var map = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf',
    };
    return map[ext] || 'application/octet-stream';
}

/**
 * Try to read a file from the ZIP and upload it to S3.
 * Returns the new S3 key, or null if the file wasn't found in the ZIP.
 */
async function uploadZipFileToS3(zip, zipPath, s3Subdir, filename) {
    try {
        var entry = zip.getEntry(zipPath);
        if (!entry) return null;
        var buf = entry.getData();
        if (!buf || buf.length === 0) return null;
        var key = s3.generateKey(s3Subdir, filename);
        await s3.uploadToS3(buf, key, guessMime(filename));
        return key;
    } catch (_e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

var VALID_LAND_TYPES = ['blm', 'usfs', 'state', 'county', 'city', 'private', 'other'];
var VALID_SITE_STATUSES = ['identified', 'scouted', 'detecting', 'exhausted'];
var VALID_MATERIALS = ['iron', 'copper', 'brass', 'silver', 'gold', 'lead', 'zinc', 'nickel', 'aluminum', 'tin', 'unknown', 'other'];
var VALID_CONDITIONS = ['excellent', 'good', 'fair', 'poor', 'fragment'];
var VALID_PERM_STATUSES = ['not_requested', 'pending', 'approved', 'denied', 'expired'];

function isValidSite(site) {
    return site && typeof site.name === 'string' && site.name.trim().length > 0;
}

function isValidFind(find, siteIdMap) {
    if (!find) return false;
    // site_id must map to an imported site
    if (find.site_id != null && !siteIdMap[find.site_id]) return false;
    return true;
}

function isValidPermission(perm, siteIdMap) {
    if (!perm) return false;
    // agency_or_owner is required
    if (!perm.agency_or_owner || typeof perm.agency_or_owner !== 'string') return false;
    // site_id must map to an imported site (if present)
    if (perm.site_id != null && !siteIdMap[perm.site_id]) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Main import function
// ---------------------------------------------------------------------------

/**
 * Process an imported ZIP buffer and insert data for the given user.
 * @param {Buffer} buffer - ZIP file contents
 * @param {number} userId - Destination user ID
 * @returns {Promise<{sites_imported: number, finds_imported: number, permissions_imported: number, letter_preferences_imported: boolean, errors: string[]}>}
 */
async function processImportZip(buffer, userId) {
    var errors = [];
    var zip;

    try {
        zip = new AdmZip(buffer);
    } catch (_e) {
        throw new Error('Invalid ZIP file');
    }

    // --- Read and validate manifest ---
    var manifest = readJsonEntry(zip, 'manifest.json');
    if (!manifest) {
        throw new Error('ZIP is missing manifest.json');
    }
    if (manifest.version !== 1) {
        throw new Error('Unsupported manifest version: ' + manifest.version);
    }

    // --- Parse data files ---
    var sites = readJsonEntry(zip, 'sites.json') || [];
    var finds = readJsonEntry(zip, 'finds.json') || [];
    var permissions = readJsonEntry(zip, 'permissions.json') || [];
    var letterPrefs = readJsonEntry(zip, 'letter_preferences.json');

    if (!Array.isArray(sites)) sites = [];
    if (!Array.isArray(finds)) finds = [];
    if (!Array.isArray(permissions)) permissions = [];

    // --- Check for duplicate site names ---
    var existingSites = (await db.query('SELECT name FROM sites WHERE user_id = $1', [userId])).rows;
    var existingNames = {};
    for (var en = 0; en < existingSites.length; en++) {
        existingNames[existingSites[en].name] = true;
    }

    // --- Import sites (build old→new ID map) ---
    var siteIdMap = {};
    var sitesImported = 0;

    for (var si = 0; si < sites.length; si++) {
        var site = sites[si];
        if (!isValidSite(site)) {
            errors.push('Skipped invalid site at index ' + si + ': missing name');
            continue;
        }

        var siteName = site.name.trim();
        if (existingNames[siteName]) {
            siteName = siteName + ' (imported)';
        }
        existingNames[siteName] = true;

        try {
            var siteResult = await db.query(
                'INSERT INTO sites (user_id, name, description, latitude, longitude, land_type, site_status, priority, notes, tags, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING id',
                [
                    userId,
                    siteName,
                    site.description || null,
                    site.latitude != null ? site.latitude : null,
                    site.longitude != null ? site.longitude : null,
                    site.land_type || null,
                    VALID_SITE_STATUSES.indexOf(site.site_status) !== -1 ? site.site_status : 'identified',
                    site.priority || null,
                    site.notes || null,
                    site.tags || null,
                ]
            );
            var newSiteId = siteResult.rows[0].id;
            siteIdMap[site.id] = newSiteId;

            // Upload site image if referenced
            if (site._image_file) {
                var siteImageKey = await uploadZipFileToS3(
                    zip,
                    PREFIX + 'photos/sites/' + site._image_file,
                    'sites',
                    site._image_file
                );
                if (siteImageKey) {
                    await db.query('UPDATE sites SET image_path = $1 WHERE id = $2', [siteImageKey, newSiteId]);
                }
            }

            sitesImported++;
        } catch (err) {
            errors.push('Failed to import site "' + site.name + '": ' + err.message);
        }
    }

    // --- Import finds (remap site_id) ---
    var findsImported = 0;

    for (var fi = 0; fi < finds.length; fi++) {
        var find = finds[fi];
        if (!isValidFind(find, siteIdMap)) {
            errors.push('Skipped invalid find at index ' + fi + ': unmapped site_id');
            continue;
        }

        var findSiteId = find.site_id != null ? siteIdMap[find.site_id] : null;

        try {
            var findResult = await db.query(
                'INSERT INTO finds (user_id, site_id, description, date_found, material, estimated_age, depth_inches, depth_cm, latitude, longitude, condition, value_estimate, notes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()) RETURNING id',
                [
                    userId,
                    findSiteId,
                    find.description || null,
                    find.date_found || new Date().toISOString().slice(0, 10),
                    VALID_MATERIALS.indexOf(find.material) !== -1 ? find.material : null,
                    find.estimated_age || null,
                    find.depth_inches != null ? find.depth_inches : null,
                    find.depth_cm != null ? find.depth_cm : null,
                    find.latitude != null ? find.latitude : null,
                    find.longitude != null ? find.longitude : null,
                    VALID_CONDITIONS.indexOf(find.condition) !== -1 ? find.condition : null,
                    find.value_estimate != null ? find.value_estimate : null,
                    find.notes || null,
                ]
            );

            // Upload find photo if referenced
            if (find._photo_file) {
                var findPhotoKey = await uploadZipFileToS3(
                    zip,
                    PREFIX + 'photos/finds/' + find._photo_file,
                    'finds',
                    find._photo_file
                );
                if (findPhotoKey) {
                    await db.query('UPDATE finds SET photo_path = $1 WHERE id = $2', [findPhotoKey, findResult.rows[0].id]);
                }
            }

            findsImported++;
        } catch (err) {
            errors.push('Failed to import find at index ' + fi + ': ' + err.message);
        }
    }

    // --- Import permissions (remap site_id) ---
    var permissionsImported = 0;

    for (var pi = 0; pi < permissions.length; pi++) {
        var perm = permissions[pi];
        if (!isValidPermission(perm, siteIdMap)) {
            errors.push('Skipped invalid permission at index ' + pi + ': missing agency_or_owner or unmapped site_id');
            continue;
        }

        var permSiteId = perm.site_id != null ? siteIdMap[perm.site_id] : null;

        try {
            var permResult = await db.query(
                'INSERT INTO permissions (user_id, site_id, land_type, agency_or_owner, contact_name, contact_phone, contact_email, contact_address, date_requested, status, date_granted, expiration_date, notes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()) RETURNING id',
                [
                    userId,
                    permSiteId,
                    perm.land_type || null,
                    perm.agency_or_owner,
                    perm.contact_name || null,
                    perm.contact_phone || null,
                    perm.contact_email || null,
                    perm.contact_address || null,
                    perm.date_requested || null,
                    VALID_PERM_STATUSES.indexOf(perm.status) !== -1 ? perm.status : 'pending',
                    perm.date_granted || null,
                    perm.expiration_date != null ? perm.expiration_date : (perm.date_expires || null),
                    perm.notes || null,
                ]
            );

            // Upload permission document if referenced
            if (perm._document_file) {
                var docKey = await uploadZipFileToS3(
                    zip,
                    PREFIX + 'documents/permissions/' + perm._document_file,
                    'permissions',
                    perm._document_file
                );
                if (docKey) {
                    await db.query('UPDATE permissions SET document_path = $1 WHERE id = $2', [docKey, permResult.rows[0].id]);
                }
            }

            permissionsImported++;
        } catch (err) {
            errors.push('Failed to import permission at index ' + pi + ': ' + err.message);
        }
    }

    // --- Upsert letter preferences ---
    var letterPrefsImported = false;
    if (letterPrefs && typeof letterPrefs === 'object' && Object.keys(letterPrefs).length > 0) {
        try {
            var existing = await db.queryOne('SELECT id FROM letter_preferences WHERE user_id = $1', [userId]);
            if (existing) {
                await db.query(
                    'UPDATE letter_preferences SET full_name = $1, address = $2, phone = $3, email = $4, signature_name = $5, signature_title = $6, intro_text = $7, commitments_html = $8, closing_text = $9, insurance_text = $10, updated_at = NOW() WHERE user_id = $11',
                    [
                        letterPrefs.full_name || null,
                        letterPrefs.address || null,
                        letterPrefs.phone || null,
                        letterPrefs.email || null,
                        letterPrefs.signature_name || null,
                        letterPrefs.signature_title || null,
                        letterPrefs.intro_text || null,
                        letterPrefs.commitments_html || null,
                        letterPrefs.closing_text || null,
                        letterPrefs.insurance_text || null,
                        userId,
                    ]
                );
            } else {
                await db.query(
                    'INSERT INTO letter_preferences (user_id, full_name, address, phone, email, signature_name, signature_title, intro_text, commitments_html, closing_text, insurance_text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
                    [
                        userId,
                        letterPrefs.full_name || null,
                        letterPrefs.address || null,
                        letterPrefs.phone || null,
                        letterPrefs.email || null,
                        letterPrefs.signature_name || null,
                        letterPrefs.signature_title || null,
                        letterPrefs.intro_text || null,
                        letterPrefs.commitments_html || null,
                        letterPrefs.closing_text || null,
                        letterPrefs.insurance_text || null,
                    ]
                );
            }
            letterPrefsImported = true;
        } catch (err) {
            errors.push('Failed to import letter preferences: ' + err.message);
        }
    }

    return {
        sites_imported: sitesImported,
        finds_imported: findsImported,
        permissions_imported: permissionsImported,
        letter_preferences_imported: letterPrefsImported,
        errors: errors,
    };
}

module.exports = { processImportZip: processImportZip };
