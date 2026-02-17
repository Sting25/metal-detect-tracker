const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

function request() {
    const app = require('../server');
    return supertest(app);
}

async function createUser(overrides = {}) {
    const defaults = {
        email: `user${Date.now()}${Math.random().toString(36).slice(2)}@test.com`,
        password: 'Password12345',
        display_name: 'Test User',
        role: 'user',
    };
    const data = { ...defaults, ...overrides };
    const hash = bcrypt.hashSync(data.password, 4); // low rounds for speed
    const result = await db.query(
        'INSERT INTO users (email, password_hash, display_name, role, email_verified) VALUES ($1, $2, $3, $4, true) RETURNING id',
        [data.email.toLowerCase(), hash, data.display_name, data.role]
    );
    const user = await db.queryOne('SELECT id, email, display_name, role FROM users WHERE id = $1', [result.rows[0].id]);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
    return { user, token, password: data.password };
}

async function createAdmin(overrides = {}) {
    return createUser({ role: 'admin', display_name: 'Admin User', ...overrides });
}

async function createSite(userId, overrides = {}) {
    const defaults = {
        name: 'Test Site',
        latitude: 39.7392,
        longitude: -104.9903,
        land_type: 'blm',
        site_status: 'identified',
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO sites (user_id, name, latitude, longitude, land_type, site_status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [userId, data.name, data.latitude, data.longitude, data.land_type, data.site_status]
    );
    return db.queryOne('SELECT * FROM sites WHERE id = $1', [result.rows[0].id]);
}

async function createFind(userId, siteId, overrides = {}) {
    const defaults = {
        description: 'Test find',
        date_found: '2026-01-15',
        material: 'copper',
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO finds (user_id, site_id, description, date_found, material) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, siteId, data.description, data.date_found, data.material]
    );
    return db.queryOne('SELECT * FROM finds WHERE id = $1', [result.rows[0].id]);
}

async function createPermission(userId, siteId, overrides = {}) {
    const defaults = {
        land_type: 'blm',
        agency_or_owner: 'BLM Office',
        status: 'pending',
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO permissions (user_id, site_id, land_type, agency_or_owner, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, siteId, data.land_type, data.agency_or_owner, data.status]
    );
    return db.queryOne('SELECT * FROM permissions WHERE id = $1', [result.rows[0].id]);
}

async function createInviteCode(adminId) {
    const code = 'TEST' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    await db.query('INSERT INTO invite_codes (code, created_by) VALUES ($1, $2)', [code, adminId]);
    return code;
}

async function shareSite(siteId, ownerId, sharedWithId, permissionLevel = 'view') {
    await db.query(
        "INSERT INTO site_shares (site_id, owner_id, shared_with_id, permission_level, created_at) VALUES ($1, $2, $3, $4, NOW())",
        [siteId, ownerId, sharedWithId, permissionLevel]
    );
}

async function createGoogleUser(overrides = {}) {
    const defaults = {
        email: `google${Date.now()}${Math.random().toString(36).slice(2)}@test.com`,
        display_name: 'Google User',
        google_id: 'google_' + Date.now() + Math.random().toString(36).slice(2),
        role: 'user',
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO users (email, password_hash, display_name, role, email_verified, google_id) VALUES ($1, $2, $3, $4, true, $5) RETURNING id',
        [data.email.toLowerCase(), '__NO_PASSWORD__', data.display_name, data.role, data.google_id]
    );
    const user = await db.queryOne('SELECT id, email, display_name, role FROM users WHERE id = $1', [result.rows[0].id]);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
    return { user, token, google_id: data.google_id };
}

async function createPasskeyForUser(userId, overrides = {}) {
    const defaults = {
        id: 'cred_' + Date.now() + Math.random().toString(36).slice(2),
        public_key: Buffer.from('fake-public-key-for-testing'),
        counter: 0,
        device_type: 'multiDevice',
        backed_up: true,
        transports: '["internal"]',
        display_name: 'Test Passkey',
    };
    const data = { ...defaults, ...overrides };
    await db.query(
        'INSERT INTO passkey_credentials (id, user_id, public_key, counter, device_type, backed_up, transports, display_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [data.id, userId, data.public_key, data.counter, data.device_type, data.backed_up, data.transports, data.display_name]
    );
    return data;
}

async function createDemoUser(overrides = {}) {
    const defaults = {
        email: 'demo@example.com',
        display_name: 'Demo User',
        role: 'user',
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO users (email, password_hash, display_name, role, email_verified, is_demo) VALUES ($1, $2, $3, $4, true, true) RETURNING id',
        [data.email.toLowerCase(), '__NO_PASSWORD__', data.display_name, data.role]
    );
    const user = await db.queryOne('SELECT id, email, display_name, role, is_demo FROM users WHERE id = $1', [result.rows[0].id]);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
    return { user, token };
}

async function createHuntSession(userId, overrides = {}) {
    const defaults = { site_id: null, status: 'active' };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO hunt_sessions (user_id, site_id, status) VALUES ($1, $2, $3) RETURNING id',
        [userId, data.site_id, data.status]
    );
    const session = await db.queryOne('SELECT * FROM hunt_sessions WHERE id = $1', [result.rows[0].id]);
    // Create first segment if active
    if (data.status === 'active') {
        await db.query(
            'INSERT INTO track_segments (session_id, segment_number) VALUES ($1, 1)',
            [session.id]
        );
    }
    return session;
}

async function createTrackpoints(segmentId, points) {
    if (!points || points.length === 0) return;
    const values = [];
    const params = [];
    let idx = 1;
    const baseTime = new Date('2026-02-01T10:00:00Z').getTime();
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const ts = new Date(baseTime + i * 3000).toISOString(); // 3s apart
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(segmentId, p.lat, p.lng, ts);
    }
    await db.query(
        `INSERT INTO track_points (segment_id, lat, lng, recorded_at) VALUES ${values.join(', ')}`,
        params
    );
}

async function createFindPhoto(findId, overrides = {}) {
    const defaults = {
        photo_path: 'finds/test-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jpg',
        sort_order: 0,
        caption: null,
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO find_photos (find_id, photo_path, sort_order, caption) VALUES ($1, $2, $3, $4) RETURNING id',
        [findId, data.photo_path, data.sort_order, data.caption]
    );
    return db.queryOne('SELECT * FROM find_photos WHERE id = $1', [result.rows[0].id]);
}

async function createReminder(userId, overrides = {}) {
    const defaults = {
        reminder_type: 'custom',
        title: 'Test reminder',
        due_date: '2026-03-15',
        permission_id: null,
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO reminders (user_id, permission_id, reminder_type, title, due_date) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, data.permission_id, data.reminder_type, data.title, data.due_date]
    );
    return db.queryOne('SELECT * FROM reminders WHERE id = $1', [result.rows[0].id]);
}

async function createContact(permissionId, userId, overrides = {}) {
    const defaults = {
        contact_type: 'phone_call',
        outcome: 'positive',
        notes: 'Test call',
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO permission_contacts (permission_id, user_id, contact_type, outcome, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [permissionId, userId, data.contact_type, data.outcome, data.notes]
    );
    return db.queryOne('SELECT * FROM permission_contacts WHERE id = $1', [result.rows[0].id]);
}

async function createPermissionLink(permissionId, overrides = {}) {
    const token = crypto.randomBytes(32).toString('hex');
    const defaults = {
        token,
        status: 'active',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO permission_links (permission_id, token, status, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
        [permissionId, data.token, data.status, data.expires_at]
    );
    return db.queryOne('SELECT * FROM permission_links WHERE id = $1', [result.rows[0].id]);
}

async function createLegalContent(overrides = {}) {
    const defaults = {
        country_code: 'US',
        region_code: null,
        language: 'en',
        section_key: 'test_section_' + Date.now() + Math.random().toString(36).slice(2),
        section_title: 'Test Section',
        content_html: '<p>Test content</p>',
        severity: 'ok',
        sort_order: 100,
        source_url: null,
        last_verified: '2026-01-15',
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO legal_content (country_code, region_code, language, section_key, section_title, content_html, severity, sort_order, source_url, last_verified) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
        [data.country_code, data.region_code, data.language, data.section_key, data.section_title, data.content_html, data.severity, data.sort_order, data.source_url, data.last_verified]
    );
    return db.queryOne('SELECT * FROM legal_content WHERE id = $1', [result.rows[0].id]);
}

async function createLegalSuggestion(userId, overrides = {}) {
    const defaults = {
        country_code: 'US',
        suggestion_type: 'correction',
        suggested_text: 'Test suggestion text',
        status: 'pending',
    };
    const data = { ...defaults, ...overrides };
    const result = await db.query(
        'INSERT INTO legal_suggestions (user_id, legal_content_id, country_code, region_code, suggestion_type, section_title, suggested_text, reason, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
        [userId, data.legal_content_id || null, data.country_code, data.region_code || null, data.suggestion_type, data.section_title || null, data.suggested_text, data.reason || null, data.status]
    );
    return db.queryOne('SELECT * FROM legal_suggestions WHERE id = $1', [result.rows[0].id]);
}

module.exports = {
    request,
    createUser,
    createAdmin,
    createSite,
    createFind,
    createFindPhoto,
    createPermission,
    createContact,
    createReminder,
    createPermissionLink,
    createLegalContent,
    createLegalSuggestion,
    createInviteCode,
    shareSite,
    createGoogleUser,
    createPasskeyForUser,
    createDemoUser,
    createHuntSession,
    createTrackpoints,
    JWT_SECRET,
};
