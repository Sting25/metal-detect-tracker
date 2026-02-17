#!/usr/bin/env node
/**
 * One-time data migration script: SQLite → PostgreSQL + local files → S3.
 *
 * This script:
 *  1. Reads all data from the production SQLite database
 *  2. Transforms values for PostgreSQL compatibility
 *  3. Inserts into PostgreSQL preserving original IDs
 *  4. Copies local upload files to DigitalOcean Spaces (S3)
 *  5. Updates file path columns to S3 keys
 *
 * Prerequisites:
 *  - PostgreSQL database already created and initialized (schema created by app startup)
 *  - Environment variables set:
 *      DATABASE_URL=postgresql://user:pass@localhost:5432/metal_detect_tracker
 *      DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
 *      DO_SPACES_BUCKET=your-bucket-name
 *      DO_SPACES_KEY=<key>
 *      DO_SPACES_SECRET=<secret>
 *      DO_SPACES_REGION=nyc3
 *      SQLITE_PATH=/path/to/tracker.db      (path to your SQLite file)
 *      UPLOADS_DIR=/path/to/uploads          (path to your uploads dir)
 *
 * Temporary dependency:
 *   npm install better-sqlite3    (only needed for migration, remove after)
 *
 * Usage:
 *   node scripts/migrate-to-pg.js [--dry-run] [--skip-files]
 *
 * Options:
 *   --dry-run      Show what would be migrated without making changes
 *   --skip-files   Skip file upload to S3 (data only)
 */

const Database = require('better-sqlite3');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// Simple extension-to-MIME map (no external dependency needed)
const MIME_MAP = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
    '.svg': 'image/svg+xml',
};
function getMimeType(filePath) {
    var ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_FILES = process.argv.includes('--skip-files');

const SQLITE_PATH = process.env.SQLITE_PATH || './data/tracker.db';
const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
}

// S3 config
const s3Endpoint = process.env.DO_SPACES_ENDPOINT || 'https://nyc3.digitaloceanspaces.com';
const s3Region = process.env.DO_SPACES_REGION || 'nyc3';
const s3Bucket = process.env.DO_SPACES_BUCKET || '';
const s3Key = process.env.DO_SPACES_KEY;
const s3Secret = process.env.DO_SPACES_SECRET;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(msg) {
    var prefix = DRY_RUN ? '[DRY RUN] ' : '';
    console.log(prefix + msg);
}

function logError(msg) {
    console.error('ERROR: ' + msg);
}

/**
 * Convert SQLite integer boolean (0/1) to PostgreSQL boolean.
 */
function toBool(val) {
    if (val === null || val === undefined) return false;
    return val === 1 || val === true || val === '1' || val === 'true';
}

/**
 * Convert SQLite datetime string to PostgreSQL-compatible timestamp.
 * SQLite stores as "2024-01-15 12:30:00" (no timezone).
 * PostgreSQL TIMESTAMPTZ expects ISO format.
 */
function toTimestamp(val) {
    if (!val) return null;
    // Already ISO-ish: "2024-01-15 12:30:00" → "2024-01-15T12:30:00Z"
    if (typeof val === 'string') {
        // If it has a space between date and time, replace with T and add Z
        var s = val.trim();
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
            return s.replace(' ', 'T') + 'Z';
        }
        // If it already has T and/or Z, return as-is
        return s;
    }
    return val;
}

/**
 * Upload a local file to S3.
 * @returns {string} S3 key
 */
async function uploadFileToS3(s3Client, localPath, s3Key) {
    var buffer = fs.readFileSync(localPath);
    var contentType = getMimeType(localPath);

    await s3Client.send(new PutObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'private',
    }));

    return s3Key;
}

/**
 * Generate an S3 key from a local file path.
 * "uploads/sites/1708531234-567890.jpg" → "sites/1708531234-567890.jpg"
 * "sites/1708531234-567890.jpg" → "sites/1708531234-567890.jpg"
 */
function localPathToS3Key(filePath) {
    if (!filePath) return null;
    // Normalize to forward slashes first
    var normalized = filePath.replace(/\\/g, '/');
    // Extract everything after the last "uploads/" in the path
    // Handles both relative (uploads/sites/foo.jpg) and absolute (C:/dev/.../uploads/sites/foo.jpg)
    var uploadsIdx = normalized.lastIndexOf('uploads/');
    if (uploadsIdx !== -1) {
        return normalized.substring(uploadsIdx + 'uploads/'.length);
    }
    // Fallback: strip leading slashes
    return normalized.replace(/^\/+/, '');
}

// ---------------------------------------------------------------------------
// Migration tables in dependency order
// ---------------------------------------------------------------------------

// Order matters: parents before children (foreign key dependencies)
const TABLE_ORDER = [
    'users',
    'sites',
    'finds',
    'permissions',
    'invite_codes',
    'site_shares',
    'password_resets',
    'app_settings',
    'invite_requests',
    'feedback',
    'land_types',
    'legal_content',
    'letter_preferences',
    'passkey_credentials',
    'auth_challenges',
    // audit_events is new in PG — no SQLite data to migrate
];

// ---------------------------------------------------------------------------
// Table-specific insert builders
// ---------------------------------------------------------------------------

function buildInsert_users(row) {
    return {
        sql: `INSERT INTO users (id, email, password_hash, display_name, role,
              phone, country_code, region, unit_preference, language_preference,
              email_verified, verification_code, verification_expires_at,
              terms_accepted_at, google_id, is_demo, last_active,
              created_at, updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.email,
            row.password_hash,
            row.display_name,
            row.role || 'user',
            row.phone || null,
            row.country_code || 'US',
            row.region || null,
            row.unit_preference || 'imperial',
            row.language_preference || 'en',
            toBool(row.email_verified),
            row.verification_code || null,
            toTimestamp(row.verification_expires_at),
            toTimestamp(row.terms_accepted_at),
            row.google_id || null,
            toBool(row.is_demo),
            toTimestamp(row.last_active),
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.updated_at) || new Date().toISOString(),
        ],
    };
}

function buildInsert_sites(row) {
    return {
        sql: `INSERT INTO sites (id, name, description, latitude, longitude, boundary_geojson,
              image_path, land_type, permission_status, permission_contact_name,
              permission_contact_phone, permission_contact_email, legal_notes,
              site_status, priority, notes, tags, user_id, created_at, updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.name,
            row.description || null,
            row.latitude,
            row.longitude,
            row.boundary_geojson || null,
            localPathToS3Key(row.image_path),
            row.land_type || 'unknown',
            row.permission_status || 'not_requested',
            row.permission_contact_name || null,
            row.permission_contact_phone || null,
            row.permission_contact_email || null,
            row.legal_notes || null,
            row.site_status || 'identified',
            row.priority || 3,
            row.notes || null,
            row.tags || null,
            row.user_id,
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.updated_at) || new Date().toISOString(),
        ],
    };
}

function buildInsert_finds(row) {
    return {
        sql: `INSERT INTO finds (id, site_id, date_found, latitude, longitude, photo_path,
              description, material, estimated_age, depth_inches, depth_cm,
              condition, value_estimate, notes, user_id, created_at, updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.site_id,
            row.date_found,
            row.latitude || null,
            row.longitude || null,
            localPathToS3Key(row.photo_path),
            row.description,
            row.material || 'unknown',
            row.estimated_age || null,
            row.depth_inches || null,
            row.depth_cm || null,
            row.condition || 'fair',
            row.value_estimate || null,
            row.notes || null,
            row.user_id,
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.updated_at) || new Date().toISOString(),
        ],
    };
}

function buildInsert_permissions(row) {
    return {
        sql: `INSERT INTO permissions (id, site_id, land_type, agency_or_owner,
              contact_name, contact_phone, contact_email, contact_address,
              date_requested, status, date_granted, expiration_date,
              document_path, notes, user_id, created_at, updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.site_id || null,
            row.land_type,
            row.agency_or_owner,
            row.contact_name || null,
            row.contact_phone || null,
            row.contact_email || null,
            row.contact_address || null,
            row.date_requested || null,
            row.status || 'not_requested',
            row.date_granted || null,
            row.expiration_date || null,
            localPathToS3Key(row.document_path),
            row.notes || null,
            row.user_id,
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.updated_at) || new Date().toISOString(),
        ],
    };
}

function buildInsert_invite_codes(row) {
    return {
        sql: `INSERT INTO invite_codes (id, code, created_by, used_by, created_at, used_at, expires_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.code,
            row.created_by,
            row.used_by || null,
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.used_at),
            toTimestamp(row.expires_at),
        ],
    };
}

function buildInsert_site_shares(row) {
    return {
        sql: `INSERT INTO site_shares (id, site_id, owner_id, shared_with_id, permission_level, created_at)
              VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.site_id,
            row.owner_id,
            row.shared_with_id,
            row.permission_level || 'view',
            toTimestamp(row.created_at) || new Date().toISOString(),
        ],
    };
}

function buildInsert_password_resets(row) {
    return {
        sql: `INSERT INTO password_resets (id, user_id, token, created_at, expires_at, used_at)
              VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.user_id,
            row.token,
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.expires_at),
            toTimestamp(row.used_at),
        ],
    };
}

function buildInsert_app_settings(row) {
    return {
        sql: `INSERT INTO app_settings (key, value, updated_at)
              VALUES ($1,$2,$3)
              ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
        params: [
            row.key,
            row.value,
            toTimestamp(row.updated_at) || new Date().toISOString(),
        ],
    };
}

function buildInsert_invite_requests(row) {
    return {
        sql: `INSERT INTO invite_requests (id, name, email, message, status, created_at, reviewed_at, reviewed_by)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.name,
            row.email,
            row.message || null,
            row.status || 'pending',
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.reviewed_at),
            row.reviewed_by || null,
        ],
    };
}

function buildInsert_feedback(row) {
    return {
        sql: `INSERT INTO feedback (id, user_id, type, message, page_url, user_agent,
              screenshot_path, status, admin_notes, created_at, reviewed_at, reviewed_by)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.user_id,
            row.type || 'suggestion',
            row.message,
            row.page_url || null,
            row.user_agent || null,
            localPathToS3Key(row.screenshot_path),
            row.status || 'new',
            row.admin_notes || null,
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.reviewed_at),
            row.reviewed_by || null,
        ],
    };
}

function buildInsert_land_types(row) {
    return {
        sql: `INSERT INTO land_types (id, code, label, country_code, description, is_custom, created_by, sort_order)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.code,
            row.label,
            row.country_code,
            row.description || null,
            toBool(row.is_custom),
            row.created_by || null,
            row.sort_order || 100,
        ],
    };
}

function buildInsert_legal_content(row) {
    return {
        sql: `INSERT INTO legal_content (id, country_code, region_code, language, section_key,
              section_title, content_html, severity, sort_order, source_url,
              last_verified, created_at, updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.country_code,
            row.region_code || null,
            row.language || 'en',
            row.section_key,
            row.section_title,
            row.content_html,
            row.severity || null,
            row.sort_order || 100,
            row.source_url || null,
            row.last_verified || null,
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.updated_at) || new Date().toISOString(),
        ],
    };
}

function buildInsert_letter_preferences(row) {
    return {
        sql: `INSERT INTO letter_preferences (id, user_id, full_name, address, phone, email,
              signature_name, signature_title, intro_text, commitments_html,
              closing_text, insurance_text, created_at, updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.user_id,
            row.full_name || null,
            row.address || null,
            row.phone || null,
            row.email || null,
            row.signature_name || null,
            row.signature_title || null,
            row.intro_text || null,
            row.commitments_html || null,
            row.closing_text || null,
            row.insurance_text || null,
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.updated_at) || new Date().toISOString(),
        ],
    };
}

function buildInsert_passkey_credentials(row) {
    // SQLite stores public_key as BLOB, PostgreSQL expects BYTEA
    // Node better-sqlite3 returns BLOB as Buffer, pg accepts Buffer for BYTEA
    var publicKey = row.public_key;
    if (publicKey && !(publicKey instanceof Buffer)) {
        publicKey = Buffer.from(publicKey);
    }

    return {
        sql: `INSERT INTO passkey_credentials (id, user_id, public_key, counter, device_type,
              backed_up, transports, display_name, created_at, last_used_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.user_id,
            publicKey,
            row.counter || 0,
            row.device_type || null,
            toBool(row.backed_up),
            row.transports || null,
            row.display_name || 'Passkey',
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.last_used_at),
        ],
    };
}

function buildInsert_auth_challenges(row) {
    return {
        sql: `INSERT INTO auth_challenges (id, user_id, challenge, type, created_at, expires_at)
              VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT (id) DO NOTHING`,
        params: [
            row.id,
            row.user_id || null,
            row.challenge,
            row.type,
            toTimestamp(row.created_at) || new Date().toISOString(),
            toTimestamp(row.expires_at),
        ],
    };
}

// Map table names to builder functions
const INSERT_BUILDERS = {
    users: buildInsert_users,
    sites: buildInsert_sites,
    finds: buildInsert_finds,
    permissions: buildInsert_permissions,
    invite_codes: buildInsert_invite_codes,
    site_shares: buildInsert_site_shares,
    password_resets: buildInsert_password_resets,
    app_settings: buildInsert_app_settings,
    invite_requests: buildInsert_invite_requests,
    feedback: buildInsert_feedback,
    land_types: buildInsert_land_types,
    legal_content: buildInsert_legal_content,
    letter_preferences: buildInsert_letter_preferences,
    passkey_credentials: buildInsert_passkey_credentials,
    auth_challenges: buildInsert_auth_challenges,
};

// ---------------------------------------------------------------------------
// File migration
// ---------------------------------------------------------------------------

/**
 * Collect all file paths that need to be uploaded to S3.
 * Looks at image_path, photo_path, document_path, screenshot_path columns.
 */
function collectFilePaths(sqlite) {
    var paths = new Set();

    // sites.image_path
    var rows = sqlite.prepare("SELECT image_path FROM sites WHERE image_path IS NOT NULL AND image_path != ''").all();
    rows.forEach(function (r) { if (r.image_path) paths.add(r.image_path); });

    // finds.photo_path
    rows = sqlite.prepare("SELECT photo_path FROM finds WHERE photo_path IS NOT NULL AND photo_path != ''").all();
    rows.forEach(function (r) { if (r.photo_path) paths.add(r.photo_path); });

    // permissions.document_path
    rows = sqlite.prepare("SELECT document_path FROM permissions WHERE document_path IS NOT NULL AND document_path != ''").all();
    rows.forEach(function (r) { if (r.document_path) paths.add(r.document_path); });

    // feedback.screenshot_path
    rows = sqlite.prepare("SELECT screenshot_path FROM feedback WHERE screenshot_path IS NOT NULL AND screenshot_path != ''").all();
    rows.forEach(function (r) { if (r.screenshot_path) paths.add(r.screenshot_path); });

    return Array.from(paths);
}

async function migrateFiles(sqlite, s3Client) {
    var filePaths = collectFilePaths(sqlite);

    if (filePaths.length === 0) {
        log('No files to migrate.');
        return { total: 0, uploaded: 0, errors: 0 };
    }

    log('Found ' + filePaths.length + ' files to upload to S3...');

    var uploaded = 0;
    var errors = 0;

    for (var i = 0; i < filePaths.length; i++) {
        var filePath = filePaths[i];
        var s3Key = localPathToS3Key(filePath);

        // Try to find the file on disk
        var localPath = null;
        var candidates = [
            path.join(UPLOADS_DIR, s3Key),
            path.join(UPLOADS_DIR, filePath),
            filePath, // absolute path
        ];

        for (var j = 0; j < candidates.length; j++) {
            if (fs.existsSync(candidates[j])) {
                localPath = candidates[j];
                break;
            }
        }

        if (!localPath) {
            logError('File not found: ' + filePath + ' (tried: ' + candidates.join(', ') + ')');
            errors++;
            continue;
        }

        if (DRY_RUN) {
            log('  Would upload: ' + localPath + ' → s3://' + s3Bucket + '/' + s3Key);
            uploaded++;
        } else {
            try {
                await uploadFileToS3(s3Client, localPath, s3Key);
                uploaded++;
                if ((uploaded % 10) === 0 || uploaded === filePaths.length) {
                    log('  Uploaded ' + uploaded + '/' + filePaths.length + ' files');
                }
            } catch (err) {
                logError('Failed to upload ' + localPath + ': ' + err.message);
                errors++;
            }
        }
    }

    return { total: filePaths.length, uploaded: uploaded, errors: errors };
}

// ---------------------------------------------------------------------------
// Main migration
// ---------------------------------------------------------------------------

async function main() {
    log('='.repeat(60));
    log('Signal Bouncer Data Migration: SQLite → PostgreSQL + S3');
    log('='.repeat(60));
    log('');

    // Validate SQLite database exists
    if (!fs.existsSync(SQLITE_PATH)) {
        logError('SQLite database not found: ' + SQLITE_PATH);
        process.exit(1);
    }

    // Open SQLite (read-only)
    log('Opening SQLite database: ' + SQLITE_PATH);
    var sqlite = new Database(SQLITE_PATH, { readonly: true });

    // Connect to PostgreSQL
    log('Connecting to PostgreSQL: ' + DATABASE_URL.replace(/:[^:@]+@/, ':****@'));
    var pool = new Pool({
        connectionString: DATABASE_URL,
        max: 5,
    });

    // Test PG connection
    try {
        await pool.query('SELECT 1');
        log('PostgreSQL connection OK');
    } catch (err) {
        logError('Cannot connect to PostgreSQL: ' + err.message);
        sqlite.close();
        process.exit(1);
    }

    // S3 client (only needed for file migration)
    var s3Client = null;
    if (!SKIP_FILES && s3Key && s3Secret) {
        s3Client = new S3Client({
            endpoint: s3Endpoint,
            region: s3Region,
            credentials: {
                accessKeyId: s3Key,
                secretAccessKey: s3Secret,
            },
            forcePathStyle: false,
        });
        log('S3 client configured: ' + s3Endpoint + '/' + s3Bucket);
    } else if (!SKIP_FILES) {
        log('WARNING: S3 credentials not set. Skipping file migration.');
    }

    log('');
    log('-'.repeat(60));
    log('Phase 1: Data Migration');
    log('-'.repeat(60));

    var totalRows = 0;
    var totalErrors = 0;

    for (var t = 0; t < TABLE_ORDER.length; t++) {
        var tableName = TABLE_ORDER[t];
        var builder = INSERT_BUILDERS[tableName];

        if (!builder) {
            log('SKIP: No builder for table ' + tableName);
            continue;
        }

        // Check if table exists in SQLite
        var tableExists = sqlite.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).get(tableName);

        if (!tableExists) {
            log('SKIP: Table ' + tableName + ' does not exist in SQLite');
            continue;
        }

        // Read all rows from SQLite
        var rows;
        try {
            rows = sqlite.prepare('SELECT * FROM ' + tableName).all();
        } catch (err) {
            logError('Failed to read ' + tableName + ': ' + err.message);
            totalErrors++;
            continue;
        }

        if (rows.length === 0) {
            log(tableName + ': 0 rows (empty)');
            continue;
        }

        log(tableName + ': ' + rows.length + ' rows');

        if (!DRY_RUN) {
            var inserted = 0;
            var skipped = 0;
            var errors = 0;

            for (var i = 0; i < rows.length; i++) {
                try {
                    var ins = builder(rows[i]);
                    var result = await pool.query(ins.sql, ins.params);
                    if (result.rowCount > 0) {
                        inserted++;
                    } else {
                        skipped++; // ON CONFLICT — already exists
                    }
                } catch (err) {
                    errors++;
                    logError('  Row ' + i + ' in ' + tableName + ': ' + err.message);
                    // Log the problematic row's id for debugging
                    if (rows[i].id) {
                        logError('  (row id: ' + rows[i].id + ')');
                    }
                }
            }

            log('  → inserted: ' + inserted + ', skipped: ' + skipped + ', errors: ' + errors);
            totalRows += inserted;
            totalErrors += errors;
        } else {
            totalRows += rows.length;
        }
    }

    // Reset PostgreSQL sequences to max(id) + 1 for each SERIAL table
    if (!DRY_RUN) {
        log('');
        log('Resetting PostgreSQL sequences...');
        var serialTables = [
            'users', 'sites', 'finds', 'permissions', 'invite_codes',
            'site_shares', 'password_resets', 'invite_requests', 'feedback',
            'land_types', 'legal_content', 'letter_preferences', 'auth_challenges',
            'audit_events',
        ];

        for (var s = 0; s < serialTables.length; s++) {
            var tbl = serialTables[s];
            try {
                var maxRow = await pool.query('SELECT COALESCE(MAX(id), 0)::int AS max_id FROM ' + tbl);
                var maxId = maxRow.rows[0].max_id;
                if (maxId > 0) {
                    await pool.query(
                        "SELECT setval(pg_get_serial_sequence('" + tbl + "', 'id'), $1)",
                        [maxId]
                    );
                    log('  ' + tbl + ': sequence set to ' + maxId);
                }
            } catch (err) {
                // Table might not have a serial id (e.g., app_settings uses text key)
                // or passkey_credentials uses text id — just skip
            }
        }
    }

    // Phase 2: File migration
    if (!SKIP_FILES && s3Client) {
        log('');
        log('-'.repeat(60));
        log('Phase 2: File Migration (local → S3)');
        log('-'.repeat(60));

        var fileResult = await migrateFiles(sqlite, s3Client);
        log('Files: total=' + fileResult.total + ', uploaded=' + fileResult.uploaded + ', errors=' + fileResult.errors);
        totalErrors += fileResult.errors;
    } else {
        log('');
        log('Phase 2: Skipped (--skip-files or no S3 credentials)');
    }

    // Summary
    log('');
    log('='.repeat(60));
    log('Migration Complete');
    log('='.repeat(60));
    log('Total rows migrated: ' + totalRows);
    log('Total errors: ' + totalErrors);

    if (totalErrors > 0) {
        log('');
        log('WARNING: There were errors. Review the output above.');
        log('The migration can be re-run safely (ON CONFLICT DO NOTHING).');
    }

    // Cleanup
    sqlite.close();
    await pool.end();

    process.exit(totalErrors > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
main().catch(function (err) {
    logError('Unexpected error: ' + err.message);
    console.error(err.stack);
    process.exit(1);
});
