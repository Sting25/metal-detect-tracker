/**
 * Vitest global test setup — PostgreSQL + S3 mock version.
 *
 * Requires a running PostgreSQL instance with a test database.
 * Set DATABASE_URL env var or it defaults to: postgresql://postgres:postgres@localhost:5432/metal_detect_tracker_test
 *
 * To create the test database:
 *   createdb metal_detect_tracker_test
 */
const path = require('path');

// Set test environment BEFORE any app imports
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/metal_detect_tracker_test';
process.env.JWT_SECRET = 'test-secret-key-for-vitest';

// Import db after env vars are set
const db = require('../database');
const s3 = require('../services/s3');

// Enable S3 mock for all tests — stores files in memory
s3.enableMock();

// Initialize database (create tables, run migrations, etc.) once before all tests
let initialized = false;

beforeAll(async () => {
    if (!initialized) {
        await db.initialize();
        initialized = true;
    }
});

beforeEach(async () => {
    // Truncate all tables in correct order (respect foreign keys)
    const tables = [
        'audit_events',
        'auth_challenges', 'passkey_credentials',
        'permission_links', 'generated_letters', 'reminders', 'permission_contacts',
        'legal_revisions', 'legal_suggestions',
        'feedback', 'letter_preferences', 'site_shares', 'password_resets', 'invite_requests',
        'invite_codes',
        'track_points', 'track_segments',
        'find_photos', 'finds',
        'hunt_sessions',
        'permissions', 'sites',
        'land_types', 'legal_content',
        'idempotency_keys',
        'users', 'app_settings'
    ];
    for (const t of tables) {
        await db.query(`DELETE FROM ${t}`);
    }

    // Re-seed default settings
    await db.query("INSERT INTO app_settings (key, value) VALUES ('notify_on_register', 'false') ON CONFLICT DO NOTHING");

    // Re-seed land type presets (needed by land-types tests and any test using land types)
    const insertLT = async (code, label, cc, desc, order) => {
        await db.query(
            'INSERT INTO land_types (code, label, country_code, description, sort_order) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
            [code, label, cc, desc, order]
        );
    };
    await insertLT('private', 'Private Land', 'US', 'Privately owned property', 10);
    await insertLT('blm', 'BLM (Bureau of Land Management)', 'US', 'Federal public land managed by BLM', 20);
    await insertLT('national_grassland', 'National Grassland', 'US', 'USFS-managed grassland', 30);
    await insertLT('usfs', 'National Forest (USFS)', 'US', 'US Forest Service land', 60);
    await insertLT('unknown', 'Unknown', 'US', 'Land ownership not yet determined', 999);
    await insertLT('private', 'Private Land', 'GB', 'Privately owned', 10);
    await insertLT('crown_land', 'Crown Land', 'GB', 'Crown Estate land', 20);
    await insertLT('unknown', 'Unknown', 'GB', 'Unknown', 999);

    // Clear S3 mock store between tests
    s3.getMockStore().clear();
});

afterAll(async () => {
    // Close PostgreSQL pool
    await db.close();
});
