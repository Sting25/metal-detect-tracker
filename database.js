/**
 * Database module — PostgreSQL via pg.Pool.
 * Provides async query helpers and application-specific functions.
 */
const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/metal_detect_tracker',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// ---------------------------------------------------------------------------
// Core query helpers
// ---------------------------------------------------------------------------

/**
 * Execute a query. Returns { rows, rowCount }.
 * @param {string} sql - SQL with $1, $2, ... placeholders
 * @param {Array} [params] - Parameter values
 */
async function query(sql, params) {
    return pool.query(sql, params);
}

/**
 * Execute a query and return the first row, or null.
 * @param {string} sql
 * @param {Array} [params]
 * @returns {Object|null}
 */
async function queryOne(sql, params) {
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
}

/**
 * Run a function inside a transaction.
 * The callback receives a `client` with .query() that should be used
 * for all queries within the transaction.
 * @param {Function} fn - async function(client) => result
 * @returns {*} The return value of fn
 */
async function transaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------------
// Application helpers
// ---------------------------------------------------------------------------

/**
 * Get an application setting by key.
 * @param {string} key
 * @returns {string|null}
 */
async function getSetting(key) {
    const row = await queryOne('SELECT value FROM app_settings WHERE key = $1', [key]);
    return row ? row.value : null;
}

/**
 * Set an application setting (upsert).
 * @param {string} key
 * @param {string} value
 */
async function setSetting(key, value) {
    await query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
    );
}

/**
 * Assign all orphaned data (user_id IS NULL) to a specific user.
 * Called during first admin setup to claim existing data.
 */
async function assignOrphanedDataToUser(userId) {
    await query('UPDATE sites SET user_id = $1 WHERE user_id IS NULL', [userId]);
    await query('UPDATE finds SET user_id = $1 WHERE user_id IS NULL', [userId]);
    await query('UPDATE permissions SET user_id = $1 WHERE user_id IS NULL', [userId]);
}

/**
 * Insert starter/seed sites for a new user.
 * Region-aware: seeds different example sites based on country code.
 */
async function insertSeedSites(userId, countryCode) {
    var cc = (countryCode || 'US').toUpperCase();

    var seedsByCountry = {
        US: [
            {
                name: 'Pawnee National Grassland - Crow Creek Area',
                description: 'Large open grassland managed by the USFS. Old homestead sites dot the landscape — look for tree clusters, old foundations, and windmill remnants. Casual metal detecting for modern items is allowed.',
                latitude: 40.8183,
                longitude: -104.1716,
                land_type: 'national_grassland',
                permission_status: 'not_required',
                site_status: 'identified',
                priority: 4,
                notes: 'Check with the Pawnee National Grassland ranger district office before visiting. Avoid any marked archaeological or cultural sites. Buttes area has petroglyphs — stay well clear.',
                tags: 'grassland,homestead,public-land,beginner-friendly'
            },
            {
                name: 'BLM Land - Arkansas River Corridor (near Pueblo)',
                description: 'BLM-managed land along the Arkansas River east of Pueblo. Historical trading routes, old ranch sites, and river crossings make this area promising. No permit needed for casual recreational detecting.',
                latitude: 38.2700,
                longitude: -104.5200,
                land_type: 'blm',
                permission_status: 'not_required',
                site_status: 'identified',
                priority: 3,
                notes: 'Verify specific BLM parcels on the BLM map viewer before going. Some areas are leased to ranchers. Bring plenty of water — can be hot and dry.',
                tags: 'blm,river,public-land,trading-route'
            },
            {
                name: 'Sample Private Land Site (Template)',
                description: 'This is a template site showing how to track a private land permission. Edit this with a real location once you find a landowner willing to let you detect on their property.',
                latitude: 39.7392,
                longitude: -104.9903,
                land_type: 'private',
                permission_status: 'not_requested',
                site_status: 'identified',
                priority: 2,
                notes: 'Tips: Use county assessor records to find property owners. Drive around rural areas looking for old homesteads with tree clusters. Knock on doors or leave a note. Always get written permission.',
                tags: 'private-land,template,how-to'
            }
        ],
        GB: [
            {
                name: 'Example Rally Field (Template)',
                description: 'Template for a rally or club dig site. Many UK detectorists find sites through clubs that arrange permission with landowners for group detecting days.',
                latitude: 52.2053,
                longitude: 0.1218,
                land_type: 'private',
                permission_status: 'not_requested',
                site_status: 'identified',
                priority: 3,
                notes: 'Join a local detecting club to find organised rallies. Always follow the Code of Practice for Responsible Metal Detecting. Report Treasure Act finds to your local Finds Liaison Officer within 14 days.',
                tags: 'rally,club,template,beginner-friendly'
            },
            {
                name: 'Example Beach Detecting Site (Template)',
                description: 'Template for a beach detecting site. Many UK beaches allow detecting on the foreshore, but Crown Estate permission may be needed below the high water mark.',
                latitude: 50.7184,
                longitude: -1.8804,
                land_type: 'beach_foreshore',
                permission_status: 'not_requested',
                site_status: 'identified',
                priority: 3,
                notes: 'Check if the beach is managed by the Crown Estate, National Trust, or local council. Some beaches have bylaws restricting detecting. Best after winter storms when sand shifts.',
                tags: 'beach,foreshore,template,beginner-friendly'
            }
        ],
        AU: [
            {
                name: 'Example Gold Prospecting Area (Template)',
                description: 'Template for a gold prospecting site. Many Australian detectorists focus on the historic goldfield regions of Victoria and Western Australia.',
                latitude: -36.7570,
                longitude: 144.2785,
                land_type: 'crown_land',
                permission_status: 'not_requested',
                site_status: 'identified',
                priority: 3,
                notes: 'Check your state or territory regulations before detecting. In Victoria, you need a Miner\'s Right. In WA, a Miner\'s Right or fossicking licence is required. National parks and Aboriginal heritage sites are strictly off-limits.',
                tags: 'gold,prospecting,template,beginner-friendly'
            },
            {
                name: 'Sample Private Property Site (Template)',
                description: 'Template for a private property detecting site. Always get written permission from the landowner before detecting on private land in Australia.',
                latitude: -33.8688,
                longitude: 151.2093,
                land_type: 'private',
                permission_status: 'not_requested',
                site_status: 'identified',
                priority: 2,
                notes: 'Written permission from the landowner is essential. Many rural properties have old homestead sites. Contact local historical societies for leads on productive areas.',
                tags: 'private-land,template,how-to'
            }
        ]
    };

    var defaultSeed = [
        {
            name: 'My First Detecting Site (Template)',
            description: 'This is a template site to get you started. Edit it with a real location, or create a new site from scratch. Always research local laws and get permission before detecting.',
            latitude: 0,
            longitude: 0,
            land_type: 'unknown',
            permission_status: 'not_requested',
            site_status: 'identified',
            priority: 3,
            notes: 'Research your local metal detecting laws before heading out. Many areas require landowner permission or government permits. Join a local detecting club for advice on where to go.',
            tags: 'template,getting-started'
        }
    ];

    var seedSites = seedsByCountry[cc] || defaultSeed;

    await transaction(async function (client) {
        for (var i = 0; i < seedSites.length; i++) {
            var s = seedSites[i];
            await client.query(
                `INSERT INTO sites (name, description, latitude, longitude, land_type,
                    permission_status, site_status, priority, notes, tags, user_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [s.name, s.description, s.latitude, s.longitude, s.land_type,
                 s.permission_status, s.site_status, s.priority, s.notes, s.tags, userId]
            );
        }
    });
}

/**
 * Log an audit event. Fire-and-forget — never throws on failure.
 */
async function logAuditEvent(opts) {
    try {
        await query(
            'INSERT INTO audit_events (user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
            [opts.userId, opts.action, opts.entityType, opts.entityId || null, opts.details ? JSON.stringify(opts.details) : null, opts.ipAddress || null]
        );
    } catch (err) {
        console.error('Failed to log audit event:', err.message);
    }
}

// ---------------------------------------------------------------------------
// Account hard-delete (deferred cleanup after soft-delete grace period)
// ---------------------------------------------------------------------------

/**
 * Permanently delete all data for a soft-deleted user.
 * Must be called inside a transaction-safe context.
 * Returns an array of S3 keys that need to be deleted (caller handles S3).
 * @param {number} userId
 * @returns {string[]} S3 keys to delete
 */
async function hardDeleteUser(userId) {
    var s3Keys = [];

    return await transaction(async function (client) {
        // Collect S3 keys before deleting rows
        // — finds.photo_path (legacy single-photo field)
        var findPhotos = (await client.query('SELECT photo_path FROM finds WHERE user_id = $1 AND photo_path IS NOT NULL', [userId])).rows;
        findPhotos.forEach(function (r) { s3Keys.push(r.photo_path); });
        // — find_photos.photo_path (multi-photo, cascades from finds so collect first)
        var findPhotoRows = (await client.query(
            'SELECT fp.photo_path FROM find_photos fp JOIN finds f ON fp.find_id = f.id WHERE f.user_id = $1 AND fp.photo_path IS NOT NULL',
            [userId]
        )).rows;
        findPhotoRows.forEach(function (r) { s3Keys.push(r.photo_path); });

        var siteImages = (await client.query('SELECT image_path FROM sites WHERE user_id = $1 AND image_path IS NOT NULL', [userId])).rows;
        siteImages.forEach(function (r) { s3Keys.push(r.image_path); });

        var feedbackScreenshots = (await client.query('SELECT screenshot_path FROM feedback WHERE user_id = $1 AND screenshot_path IS NOT NULL', [userId])).rows;
        feedbackScreenshots.forEach(function (r) { s3Keys.push(r.screenshot_path); });

        var permDocs = (await client.query('SELECT document_path FROM permissions WHERE user_id = $1 AND document_path IS NOT NULL', [userId])).rows;
        permDocs.forEach(function (r) { s3Keys.push(r.document_path); });
        // — generated_letters.s3_path (cascades from permissions+users, collect first)
        var letterPaths = (await client.query('SELECT s3_path FROM generated_letters WHERE user_id = $1 AND s3_path IS NOT NULL', [userId])).rows;
        letterPaths.forEach(function (r) { s3Keys.push(r.s3_path); });
        // — permission_links signature/pdf paths (cascades from permissions, collect first)
        var linkPaths = (await client.query(
            'SELECT pl.signature_image_path, pl.signed_pdf_path FROM permission_links pl JOIN permissions p ON pl.permission_id = p.id WHERE p.user_id = $1',
            [userId]
        )).rows;
        linkPaths.forEach(function (r) {
            if (r.signature_image_path) s3Keys.push(r.signature_image_path);
            if (r.signed_pdf_path) s3Keys.push(r.signed_pdf_path);
        });

        // NULL-out references from tables where this user reviewed/created rows for other users
        await client.query('UPDATE invite_requests SET reviewed_by = NULL WHERE reviewed_by = $1', [userId]);
        await client.query('UPDATE feedback SET reviewed_by = NULL WHERE reviewed_by = $1', [userId]);
        await client.query('UPDATE land_types SET created_by = NULL WHERE created_by = $1', [userId]);
        // legal_revisions.changed_by has ON DELETE SET NULL, but be explicit
        await client.query('UPDATE legal_revisions SET changed_by = NULL WHERE changed_by = $1', [userId]);
        // legal_suggestions.reviewed_by has ON DELETE SET NULL, but be explicit
        await client.query('UPDATE legal_suggestions SET reviewed_by = NULL WHERE reviewed_by = $1', [userId]);

        // Delete from all tables in FK-safe order
        await client.query('DELETE FROM audit_events WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM legal_suggestions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM feedback WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM letter_preferences WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM site_shares WHERE owner_id = $1 OR shared_with_id = $1', [userId]);
        await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM passkey_credentials WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM auth_challenges WHERE user_id = $1', [userId]);
        // Generated letters (cascade from permissions+users, but delete explicitly before permissions)
        await client.query('DELETE FROM generated_letters WHERE user_id = $1', [userId]);
        // Hunt data (track_points → track_segments → hunt_sessions, before finds due to FK)
        await client.query('DELETE FROM track_points WHERE segment_id IN (SELECT ts.id FROM track_segments ts JOIN hunt_sessions hs ON ts.session_id = hs.id WHERE hs.user_id = $1)', [userId]);
        await client.query('DELETE FROM track_segments WHERE session_id IN (SELECT id FROM hunt_sessions WHERE user_id = $1)', [userId]);
        // Finds reference sites and hunt_sessions, so delete finds first (find_photos cascade from finds)
        await client.query('DELETE FROM finds WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM hunt_sessions WHERE user_id = $1', [userId]);
        // Permissions (permission_contacts, reminders, permission_links cascade from permissions)
        await client.query('DELETE FROM permissions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM sites WHERE user_id = $1', [userId]);
        // Invite codes: clear used_by references first, then delete created_by
        await client.query('UPDATE invite_codes SET used_by = NULL WHERE used_by = $1', [userId]);
        await client.query('DELETE FROM invite_codes WHERE created_by = $1', [userId]);
        // Finally delete user row
        await client.query('DELETE FROM users WHERE id = $1', [userId]);

        return s3Keys;
    });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize database: create schema, run migrations, seed data.
 * Must be called (and awaited) before the server starts listening.
 */
async function initialize() {
    await require('./db/schema')(pool);
    await require('./db/migrations')(pool);
    await require('./db/seeds')(pool);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
/**
 * Close the connection pool. Used by test teardown. Idempotent.
 */
var _closed = false;
async function close() {
    if (_closed) return;
    _closed = true;
    await pool.end();
}

var db = {
    pool: pool,
    query: query,
    queryOne: queryOne,
    transaction: transaction,
    getSetting: getSetting,
    setSetting: setSetting,
    assignOrphanedDataToUser: assignOrphanedDataToUser,
    insertSeedSites: insertSeedSites,
    logAuditEvent: logAuditEvent,
    hardDeleteUser: hardDeleteUser,
    initialize: initialize,
    close: close,
};

module.exports = db;
