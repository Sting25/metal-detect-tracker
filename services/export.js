/**
 * Data export service — builds a ZIP archive of all user data.
 * Streams the ZIP directly to the HTTP response.
 */
var archiver = require('archiver');
var path = require('path');
var db = require('../database');
var s3 = require('./s3');

// ---------------------------------------------------------------------------
// CSV helpers (RFC 4180, UTF-8 BOM for Excel)
// ---------------------------------------------------------------------------

function escCsv(val) {
    if (val == null) return '';
    if (val instanceof Date) val = val.toISOString();
    var s = String(val);
    if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function toCsv(rows, columns) {
    var BOM = '\uFEFF';
    var header = columns.map(escCsv).join(',');
    var lines = rows.map(function (row) {
        return columns.map(function (col) { return escCsv(row[col]); }).join(',');
    });
    return BOM + header + '\r\n' + lines.join('\r\n') + (lines.length ? '\r\n' : '');
}

// ---------------------------------------------------------------------------
// Coordinate obfuscation
// ---------------------------------------------------------------------------

var SITE_CSV_COLUMNS = ['id', 'name', 'latitude', 'longitude', 'land_type', 'site_status', 'notes', 'created_at', 'updated_at'];
var FIND_CSV_COLUMNS = ['id', 'site_id', 'description', 'date_found', 'material', 'category', 'tags', 'depth_inches', 'weight_grams', 'latitude', 'longitude', 'notes', 'condition', 'estimated_age', 'created_at', 'updated_at'];
var PERM_CSV_COLUMNS = ['id', 'site_id', 'land_type', 'agency_or_owner', 'status', 'date_requested', 'date_granted', 'date_expires', 'notes', 'contact_info', 'created_at', 'updated_at'];
var PERM_CONTACT_CSV_COLUMNS = ['id', 'permission_id', 'contact_type', 'outcome', 'notes', 'contact_date', 'created_at'];
var REMINDER_CSV_COLUMNS = ['id', 'permission_id', 'reminder_type', 'title', 'due_date', 'is_completed', 'completed_at', 'notes', 'created_at'];
var GENERATED_LETTER_CSV_COLUMNS = ['id', 'permission_id', 'filename', 's3_path', 'created_at'];
var PERMISSION_LINK_CSV_COLUMNS = ['id', 'permission_id', 'token', 'status', 'expires_at', 'created_at', 'approved_at', 'signed_name', 'conditions_text'];
var LEGAL_SUGGESTION_CSV_COLUMNS = ['id', 'legal_content_id', 'country_code', 'region_code', 'suggestion_type', 'section_title', 'suggested_text', 'reason', 'status', 'admin_notes', 'created_at'];

function obfuscateCoords(row, setting) {
    if (setting === 'no_coords') {
        delete row.latitude;
        delete row.longitude;
    } else if (setting === 'rounded_1km') {
        if (row.latitude != null) row.latitude = Math.round(row.latitude * 100) / 100;
        if (row.longitude != null) row.longitude = Math.round(row.longitude * 100) / 100;
    } else if (setting === 'rounded_10km') {
        if (row.latitude != null) row.latitude = Math.round(row.latitude * 10) / 10;
        if (row.longitude != null) row.longitude = Math.round(row.longitude * 10) / 10;
    }
    // 'none' — no change
    return row;
}

function stripInternalFields(row) {
    var copy = Object.assign({}, row);
    delete copy.user_id;
    delete copy.image_path;
    delete copy.photo_path;
    delete copy.document_path;
    return copy;
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

var PREFIX = 'signal-bouncer-export/';

async function buildExportZip(user, res) {
    var archive = archiver('zip', { zlib: { level: 6 } });

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename="signal-bouncer-export.zip"');
    archive.pipe(res);

    var obfSetting = user.export_obfuscation || 'none';

    // Query all user data
    var sites = (await db.query('SELECT * FROM sites WHERE user_id = $1 ORDER BY id', [user.id])).rows;
    var finds = (await db.query('SELECT * FROM finds WHERE user_id = $1 ORDER BY id', [user.id])).rows;
    var findIds = finds.map(function (f) { return f.id; });
    var findPhotos = findIds.length > 0
        ? (await db.query('SELECT * FROM find_photos WHERE find_id = ANY($1) ORDER BY find_id, sort_order, id', [findIds])).rows
        : [];
    var permissions = (await db.query('SELECT * FROM permissions WHERE user_id = $1 ORDER BY id', [user.id])).rows;
    var permIds = permissions.map(function (p) { return p.id; });
    var permContacts = permIds.length > 0
        ? (await db.query('SELECT * FROM permission_contacts WHERE permission_id = ANY($1) ORDER BY permission_id, contact_date DESC, id', [permIds])).rows
        : [];
    var reminders = (await db.query('SELECT * FROM reminders WHERE user_id = $1 ORDER BY due_date, id', [user.id])).rows;
    var generatedLetters = (await db.query('SELECT * FROM generated_letters WHERE user_id = $1 ORDER BY created_at DESC', [user.id])).rows;
    var permissionLinks = permIds.length > 0
        ? (await db.query('SELECT * FROM permission_links WHERE permission_id = ANY($1) ORDER BY created_at DESC', [permIds])).rows
        : [];
    var legalSuggestions = (await db.query('SELECT * FROM legal_suggestions WHERE user_id = $1 ORDER BY created_at DESC', [user.id])).rows;
    var letterPrefs = await db.queryOne('SELECT * FROM letter_preferences WHERE user_id = $1', [user.id]);

    // Strip internal fields and apply coordinate obfuscation
    var exportSites = sites.map(function (r) { return obfuscateCoords(stripInternalFields(r), obfSetting); });
    var exportFinds = finds.map(function (r) { return obfuscateCoords(stripInternalFields(r), obfSetting); });
    var exportPerms = permissions.map(function (r) { return stripInternalFields(r); });
    var exportPermContacts = permContacts.map(function (r) { return stripInternalFields(r); });
    var exportReminders = reminders.map(function (r) { return stripInternalFields(r); });
    var exportGeneratedLetters = generatedLetters.map(function (r) { return stripInternalFields(r); });
    var exportPermissionLinks = permissionLinks.map(function (r) { return stripInternalFields(r); });
    var exportLegalSuggestions = legalSuggestions.map(function (r) { return stripInternalFields(r); });
    var exportLetterPrefs = letterPrefs ? stripInternalFields(letterPrefs) : null;

    // Add photo/document file references for round-trip import
    for (var ii = 0; ii < sites.length; ii++) {
        if (sites[ii].image_path) {
            exportSites[ii]._image_file = path.basename(sites[ii].image_path);
        }
    }
    // Build a map of find_id → photo paths from find_photos table
    var findPhotoMap = {};
    for (var fp = 0; fp < findPhotos.length; fp++) {
        var fpRow = findPhotos[fp];
        if (!findPhotoMap[fpRow.find_id]) findPhotoMap[fpRow.find_id] = [];
        findPhotoMap[fpRow.find_id].push(path.basename(fpRow.photo_path));
    }
    for (var jj = 0; jj < finds.length; jj++) {
        var photoFiles = findPhotoMap[finds[jj].id] || [];
        if (photoFiles.length > 0) {
            exportFinds[jj]._photo_files = photoFiles;
        } else if (finds[jj].photo_path) {
            // Backward compat: legacy single photo
            exportFinds[jj]._photo_files = [path.basename(finds[jj].photo_path)];
        }
    }
    for (var kk = 0; kk < permissions.length; kk++) {
        if (permissions[kk].document_path) {
            exportPerms[kk]._document_file = path.basename(permissions[kk].document_path);
        }
    }

    // Adjust CSV columns if no_coords
    var siteCols = obfSetting === 'no_coords' ? SITE_CSV_COLUMNS.filter(function (c) { return c !== 'latitude' && c !== 'longitude'; }) : SITE_CSV_COLUMNS;
    var findCols = obfSetting === 'no_coords' ? FIND_CSV_COLUMNS.filter(function (c) { return c !== 'latitude' && c !== 'longitude'; }) : FIND_CSV_COLUMNS;

    // Build manifest
    var manifest = {
        version: 1,
        exported_at: new Date().toISOString(),
        user_email: user.email,
        item_counts: {
            sites: sites.length,
            finds: finds.length,
            permissions: permissions.length,
            permission_contacts: permContacts.length,
            reminders: reminders.length,
            generated_letters: generatedLetters.length,
            permission_links: permissionLinks.length,
            legal_suggestions: legalSuggestions.length,
            letter_preferences: letterPrefs ? 1 : 0,
        },
    };

    // Add JSON files
    archive.append(JSON.stringify(manifest, null, 2), { name: PREFIX + 'manifest.json' });
    archive.append(JSON.stringify(exportSites, null, 2), { name: PREFIX + 'sites.json' });
    archive.append(JSON.stringify(exportFinds, null, 2), { name: PREFIX + 'finds.json' });
    archive.append(JSON.stringify(exportPerms, null, 2), { name: PREFIX + 'permissions.json' });
    archive.append(JSON.stringify(exportPermContacts, null, 2), { name: PREFIX + 'permission_contacts.json' });
    archive.append(JSON.stringify(exportReminders, null, 2), { name: PREFIX + 'reminders.json' });
    archive.append(JSON.stringify(exportGeneratedLetters, null, 2), { name: PREFIX + 'generated_letters.json' });
    archive.append(JSON.stringify(exportPermissionLinks, null, 2), { name: PREFIX + 'permission_links.json' });
    archive.append(JSON.stringify(exportLegalSuggestions, null, 2), { name: PREFIX + 'legal_suggestions.json' });
    archive.append(JSON.stringify(exportLetterPrefs || {}, null, 2), { name: PREFIX + 'letter_preferences.json' });

    // Add CSV files
    archive.append(toCsv(exportSites, siteCols), { name: PREFIX + 'sites.csv' });
    archive.append(toCsv(exportFinds, findCols), { name: PREFIX + 'finds.csv' });
    archive.append(toCsv(exportPerms, PERM_CSV_COLUMNS), { name: PREFIX + 'permissions.csv' });
    archive.append(toCsv(exportPermContacts, PERM_CONTACT_CSV_COLUMNS), { name: PREFIX + 'permission_contacts.csv' });
    archive.append(toCsv(exportReminders, REMINDER_CSV_COLUMNS), { name: PREFIX + 'reminders.csv' });
    archive.append(toCsv(exportGeneratedLetters, GENERATED_LETTER_CSV_COLUMNS), { name: PREFIX + 'generated_letters.csv' });
    archive.append(toCsv(exportPermissionLinks, PERMISSION_LINK_CSV_COLUMNS), { name: PREFIX + 'permission_links.csv' });
    archive.append(toCsv(exportLegalSuggestions, LEGAL_SUGGESTION_CSV_COLUMNS), { name: PREFIX + 'legal_suggestions.csv' });

    // Download and include S3 files
    for (var i = 0; i < sites.length; i++) {
        if (sites[i].image_path) {
            try {
                var buf = await s3.getObjectBuffer(sites[i].image_path);
                if (buf) {
                    archive.append(buf, { name: PREFIX + 'photos/sites/' + path.basename(sites[i].image_path) });
                }
            } catch (err) {
                console.warn('Export: failed to download site image', sites[i].image_path, err.message);
            }
        }
    }

    for (var j = 0; j < findPhotos.length; j++) {
        try {
            var buf2 = await s3.getObjectBuffer(findPhotos[j].photo_path);
            if (buf2) {
                archive.append(buf2, { name: PREFIX + 'photos/finds/' + path.basename(findPhotos[j].photo_path) });
            }
        } catch (err) {
            console.warn('Export: failed to download find photo', findPhotos[j].photo_path, err.message);
        }
    }

    for (var k = 0; k < permissions.length; k++) {
        if (permissions[k].document_path) {
            try {
                var buf3 = await s3.getObjectBuffer(permissions[k].document_path);
                if (buf3) {
                    archive.append(buf3, { name: PREFIX + 'documents/permissions/' + path.basename(permissions[k].document_path) });
                }
            } catch (err) {
                console.warn('Export: failed to download permission document', permissions[k].document_path, err.message);
            }
        }
    }

    for (var m = 0; m < generatedLetters.length; m++) {
        if (generatedLetters[m].s3_path) {
            try {
                var buf4 = await s3.getObjectBuffer(generatedLetters[m].s3_path);
                if (buf4) {
                    archive.append(buf4, { name: PREFIX + 'letters/' + path.basename(generatedLetters[m].s3_path) });
                }
            } catch (err) {
                console.warn('Export: failed to download generated letter', generatedLetters[m].s3_path, err.message);
            }
        }
    }

    await archive.finalize();
}

module.exports = { buildExportZip: buildExportZip };
