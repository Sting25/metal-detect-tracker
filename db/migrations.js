/**
 * Database migrations — column additions, new tables, and schema changes.
 * All migrations are idempotent (safe to re-run).
 * Accepts a pg Pool instance.
 *
 * Note: For PostgreSQL, we use information_schema to check column existence
 * instead of SQLite's PRAGMA table_info().
 *
 * Since the schema.js now includes all columns up to the current version,
 * these migrations are primarily here as a pattern for future changes.
 * Historical migrations have been consolidated into schema.js.
 */
module.exports = async function runMigrations(pool) {

    // Helper: check if a column exists on a table
    async function columnExists(table, column) {
        var result = await pool.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_name = $1 AND column_name = $2`,
            [table, column]
        );
        return result.rowCount > 0;
    }

    // Helper: check if a table exists
    async function tableExists(table) {
        var result = await pool.query(
            `SELECT 1 FROM information_schema.tables
             WHERE table_name = $1 AND table_schema = 'public'`,
            [table]
        );
        return result.rowCount > 0;
    }

    // ---------------------------------------------------------------------------
    // Future migrations go here. Example pattern:
    // ---------------------------------------------------------------------------
    //
    // if (!(await columnExists('users', 'new_column'))) {
    //     await pool.query("ALTER TABLE users ADD COLUMN new_column TEXT DEFAULT 'value'");
    // }
    //
    // if (!(await tableExists('new_table'))) {
    //     await pool.query(`
    //         CREATE TABLE new_table (
    //             id SERIAL PRIMARY KEY,
    //             ...
    //         );
    //     `);
    // }

    // Stage 1.1 — Privacy preferences
    if (!(await columnExists('users', 'store_exact_gps'))) {
        await pool.query("ALTER TABLE users ADD COLUMN store_exact_gps BOOLEAN DEFAULT true");
    }
    if (!(await columnExists('users', 'export_obfuscation'))) {
        await pool.query("ALTER TABLE users ADD COLUMN export_obfuscation TEXT DEFAULT 'none'");
    }

    // Stage 1.4 — Account deletion
    if (!(await columnExists('users', 'deleted_at'))) {
        await pool.query("ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ");
    }

    // Stage 2 — Hunt sessions: add hunt_session_id to finds
    if (!(await columnExists('finds', 'hunt_session_id'))) {
        await pool.query(
            'ALTER TABLE finds ADD COLUMN hunt_session_id INTEGER REFERENCES hunt_sessions(id) ON DELETE SET NULL'
        );
    }

    // Stage 4 — Coverage: index for fast trackpoint lookup by site
    await pool.query('CREATE INDEX IF NOT EXISTS idx_hunt_sessions_site ON hunt_sessions(site_id)');

    // Stage 5.2 — Find categories + tags
    if (!(await columnExists('finds', 'category'))) {
        await pool.query("ALTER TABLE finds ADD COLUMN category VARCHAR(50)");
    }
    if (!(await columnExists('finds', 'tags'))) {
        await pool.query("ALTER TABLE finds ADD COLUMN tags TEXT DEFAULT ''");
    }
    await pool.query('CREATE INDEX IF NOT EXISTS idx_finds_category ON finds(category)');

    // Stage 6.1 — Permission contacts (contact log timeline)
    if (!(await tableExists('permission_contacts'))) {
        await pool.query(`
            CREATE TABLE permission_contacts (
                id SERIAL PRIMARY KEY,
                permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                contact_type VARCHAR(30) NOT NULL,
                outcome VARCHAR(30),
                notes TEXT,
                contact_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query('CREATE INDEX idx_perm_contacts_perm ON permission_contacts(permission_id)');
    }

    // Stage 6.2 — Reminders
    if (!(await tableExists('reminders'))) {
        await pool.query(`
            CREATE TABLE reminders (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
                reminder_type VARCHAR(30) NOT NULL,
                title VARCHAR(200) NOT NULL,
                due_date DATE NOT NULL,
                is_completed BOOLEAN DEFAULT false,
                completed_at TIMESTAMPTZ,
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query('CREATE INDEX idx_reminders_user ON reminders(user_id)');
        await pool.query('CREATE INDEX idx_reminders_due ON reminders(due_date)');
    }

    // Stage 6.3 — Generated letters
    if (!(await tableExists('generated_letters'))) {
        await pool.query(`
            CREATE TABLE generated_letters (
                id SERIAL PRIMARY KEY,
                permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                s3_path VARCHAR(500) NOT NULL,
                filename VARCHAR(200) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query('CREATE INDEX idx_generated_letters_perm ON generated_letters(permission_id)');
    }

    // Stage 7 — Permission links (digital permissions / PermissionLink)
    if (!(await tableExists('permission_links'))) {
        await pool.query(`
            CREATE TABLE permission_links (
                id SERIAL PRIMARY KEY,
                permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
                token VARCHAR(64) NOT NULL UNIQUE,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                approved_at TIMESTAMPTZ,
                denied_at TIMESTAMPTZ,
                signed_name VARCHAR(200),
                signature_image_path VARCHAR(500),
                conditions_text TEXT,
                signed_pdf_path VARCHAR(500)
            )
        `);
        await pool.query('CREATE INDEX idx_permission_links_token ON permission_links(token)');
        await pool.query('CREATE INDEX idx_permission_links_perm ON permission_links(permission_id)');
    }

    // Stage 9 — Legal suggestions (moderation queue)
    if (!(await tableExists('legal_suggestions'))) {
        await pool.query(`
            CREATE TABLE legal_suggestions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                legal_content_id INTEGER REFERENCES legal_content(id) ON DELETE SET NULL,
                country_code TEXT NOT NULL,
                region_code TEXT,
                suggestion_type VARCHAR(30) NOT NULL DEFAULT 'correction',
                section_title TEXT,
                suggested_text TEXT NOT NULL,
                reason TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                admin_notes TEXT,
                reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                reviewed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                CHECK(suggestion_type IN ('correction','new_section','outdated','add_region','other')),
                CHECK(status IN ('pending','approved','rejected','applied'))
            )
        `);
        await pool.query('CREATE INDEX idx_legal_suggestions_user ON legal_suggestions(user_id)');
        await pool.query('CREATE INDEX idx_legal_suggestions_status ON legal_suggestions(status)');
        await pool.query('CREATE INDEX idx_legal_suggestions_content ON legal_suggestions(legal_content_id)');
    }

    // Stage 9 — Legal revisions (version history)
    if (!(await tableExists('legal_revisions'))) {
        await pool.query(`
            CREATE TABLE legal_revisions (
                id SERIAL PRIMARY KEY,
                legal_content_id INTEGER NOT NULL REFERENCES legal_content(id) ON DELETE CASCADE,
                changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                suggestion_id INTEGER REFERENCES legal_suggestions(id) ON DELETE SET NULL,
                revision_number INTEGER NOT NULL,
                old_title TEXT,
                new_title TEXT,
                old_content_html TEXT,
                new_content_html TEXT,
                old_severity TEXT,
                new_severity TEXT,
                change_summary TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query('CREATE INDEX idx_legal_revisions_content ON legal_revisions(legal_content_id)');
    }

    // Stage 10 — Disable user
    if (!(await columnExists('users', 'is_disabled'))) {
        await pool.query("ALTER TABLE users ADD COLUMN is_disabled BOOLEAN DEFAULT FALSE");
    }

    // Password reset via email — store reset code on user record
    if (!(await columnExists('users', 'reset_code'))) {
        await pool.query("ALTER TABLE users ADD COLUMN reset_code TEXT");
    }
    if (!(await columnExists('users', 'reset_code_expires_at'))) {
        await pool.query("ALTER TABLE users ADD COLUMN reset_code_expires_at TIMESTAMPTZ");
    }

    // Stage 5.1 — Multi-photo: find_photos table + data migration
    if (!(await tableExists('find_photos'))) {
        await pool.query(`
            CREATE TABLE find_photos (
                id SERIAL PRIMARY KEY,
                find_id INTEGER NOT NULL REFERENCES finds(id) ON DELETE CASCADE,
                photo_path VARCHAR(500) NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                caption TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query('CREATE INDEX idx_find_photos_find ON find_photos(find_id)');

        // Migrate existing finds.photo_path into find_photos
        await pool.query(`
            INSERT INTO find_photos (find_id, photo_path, sort_order, created_at)
            SELECT id, photo_path, 0, COALESCE(created_at, NOW())
            FROM finds
            WHERE photo_path IS NOT NULL AND photo_path != ''
        `);
    }
};
