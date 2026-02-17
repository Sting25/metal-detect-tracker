/**
 * Base schema creation — all CREATE TABLE IF NOT EXISTS statements, indexes, etc.
 * Called once at startup; safe to re-run (IF NOT EXISTS guards everything).
 * Accepts a pg Pool instance.
 */
module.exports = async function createSchema(pool) {
    await pool.query(`

    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT CHECK(role IN ('admin', 'user')) DEFAULT 'user',
        phone TEXT,
        country_code TEXT DEFAULT 'US',
        region TEXT,
        unit_preference TEXT DEFAULT 'imperial',
        language_preference TEXT DEFAULT 'en',
        store_exact_gps BOOLEAN DEFAULT true,
        export_obfuscation TEXT DEFAULT 'none',
        email_verified BOOLEAN DEFAULT FALSE,
        verification_code TEXT,
        verification_expires_at TIMESTAMPTZ,
        reset_code TEXT,
        reset_code_expires_at TIMESTAMPTZ,
        terms_accepted_at TIMESTAMPTZ,
        google_id TEXT,
        is_demo BOOLEAN DEFAULT FALSE,
        is_disabled BOOLEAN DEFAULT FALSE,
        last_active TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

    CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        boundary_geojson TEXT,
        image_path TEXT,
        land_type TEXT DEFAULT 'unknown',
        permission_status TEXT CHECK(permission_status IN (
            'not_required', 'not_requested', 'requested', 'granted', 'denied'
        )) DEFAULT 'not_requested',
        permission_contact_name TEXT,
        permission_contact_phone TEXT,
        permission_contact_email TEXT,
        legal_notes TEXT,
        site_status TEXT CHECK(site_status IN (
            'identified', 'scouted', 'detecting', 'exhausted'
        )) DEFAULT 'identified',
        priority INTEGER CHECK(priority BETWEEN 1 AND 5) DEFAULT 3,
        notes TEXT,
        tags TEXT,
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS finds (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL,
        date_found TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        photo_path TEXT,
        description TEXT NOT NULL,
        material TEXT CHECK(material IN (
            'iron', 'copper', 'brass', 'silver', 'gold', 'lead',
            'zinc', 'nickel', 'aluminum', 'tin', 'unknown', 'other'
        )) DEFAULT 'unknown',
        estimated_age TEXT,
        depth_inches REAL,
        depth_cm REAL,
        condition TEXT CHECK(condition IN (
            'excellent', 'good', 'fair', 'poor', 'fragment'
        )) DEFAULT 'fair',
        value_estimate REAL,
        notes TEXT,
        category VARCHAR(50),
        tags TEXT DEFAULT '',
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS find_photos (
        id SERIAL PRIMARY KEY,
        find_id INTEGER NOT NULL REFERENCES finds(id) ON DELETE CASCADE,
        photo_path VARCHAR(500) NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        caption TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_find_photos_find ON find_photos(find_id);

    CREATE TABLE IF NOT EXISTS hunt_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active'
            CHECK(status IN ('active', 'paused', 'completed')),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        duration_seconds INTEGER DEFAULT 0,
        distance_meters REAL DEFAULT 0,
        trackpoint_count INTEGER DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS track_segments (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES hunt_sessions(id) ON DELETE CASCADE,
        segment_number INTEGER NOT NULL DEFAULT 1,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS track_points (
        id SERIAL PRIMARY KEY,
        segment_id INTEGER NOT NULL REFERENCES track_segments(id) ON DELETE CASCADE,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        accuracy_m REAL,
        altitude_m REAL,
        recorded_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS permissions (
        id SERIAL PRIMARY KEY,
        site_id INTEGER,
        land_type TEXT NOT NULL,
        agency_or_owner TEXT NOT NULL,
        contact_name TEXT,
        contact_phone TEXT,
        contact_email TEXT,
        contact_address TEXT,
        date_requested TEXT,
        status TEXT CHECK(status IN (
            'not_requested', 'pending', 'approved', 'denied', 'expired'
        )) DEFAULT 'not_requested',
        date_granted TEXT,
        expiration_date TEXT,
        document_path TEXT,
        notes TEXT,
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(site_status);
    CREATE INDEX IF NOT EXISTS idx_sites_land_type ON sites(land_type);
    CREATE INDEX IF NOT EXISTS idx_sites_priority ON sites(priority);
    CREATE INDEX IF NOT EXISTS idx_sites_user_id ON sites(user_id);
    CREATE INDEX IF NOT EXISTS idx_finds_site_id ON finds(site_id);
    CREATE INDEX IF NOT EXISTS idx_finds_date ON finds(date_found);
    CREATE INDEX IF NOT EXISTS idx_finds_user_id ON finds(user_id);
    CREATE INDEX IF NOT EXISTS idx_permissions_site_id ON permissions(site_id);
    CREATE INDEX IF NOT EXISTS idx_permissions_status ON permissions(status);
    CREATE INDEX IF NOT EXISTS idx_permissions_user_id ON permissions(user_id);

    CREATE INDEX IF NOT EXISTS idx_hunt_sessions_user ON hunt_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_hunt_sessions_status ON hunt_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_hunt_sessions_started ON hunt_sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_track_segments_session ON track_segments(session_id);
    CREATE INDEX IF NOT EXISTS idx_track_points_segment ON track_points(segment_id);
    CREATE INDEX IF NOT EXISTS idx_track_points_recorded ON track_points(recorded_at);

    CREATE TABLE IF NOT EXISTS invite_codes (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        created_by INTEGER NOT NULL REFERENCES users(id),
        used_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        used_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS site_shares (
        id SERIAL PRIMARY KEY,
        site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        owner_id INTEGER NOT NULL REFERENCES users(id),
        shared_with_id INTEGER NOT NULL REFERENCES users(id),
        permission_level TEXT CHECK(permission_level IN ('view', 'edit')) DEFAULT 'view',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(site_id, shared_with_id)
    );

    CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invite_requests (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT,
        status TEXT CHECK(status IN ('pending', 'approved', 'denied')) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        reviewed_by INTEGER REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
    CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
    CREATE INDEX IF NOT EXISTS idx_site_shares_site_id ON site_shares(site_id);
    CREATE INDEX IF NOT EXISTS idx_site_shares_shared_with ON site_shares(shared_with_id);
    CREATE INDEX IF NOT EXISTS idx_invite_requests_status ON invite_requests(status);

    CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT CHECK(type IN ('bug', 'suggestion', 'question', 'other')) DEFAULT 'suggestion',
        message TEXT NOT NULL,
        page_url TEXT,
        user_agent TEXT,
        screenshot_path TEXT,
        status TEXT CHECK(status IN ('new', 'reviewed', 'resolved')) DEFAULT 'new',
        admin_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        reviewed_by INTEGER REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
    CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);

    CREATE TABLE IF NOT EXISTS land_types (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL,
        label TEXT NOT NULL,
        country_code TEXT NOT NULL,
        description TEXT,
        is_custom BOOLEAN DEFAULT FALSE,
        created_by INTEGER REFERENCES users(id),
        sort_order INTEGER DEFAULT 100,
        UNIQUE(code, country_code)
    );

    CREATE INDEX IF NOT EXISTS idx_land_types_country ON land_types(country_code);

    CREATE TABLE IF NOT EXISTS legal_content (
        id SERIAL PRIMARY KEY,
        country_code TEXT NOT NULL,
        region_code TEXT,
        language TEXT NOT NULL DEFAULT 'en',
        section_key TEXT NOT NULL,
        section_title TEXT NOT NULL,
        content_html TEXT NOT NULL,
        severity TEXT CHECK(severity IN ('ok','caution','warning','danger')),
        sort_order INTEGER DEFAULT 100,
        source_url TEXT,
        last_verified TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(country_code, region_code, language, section_key)
    );

    CREATE INDEX IF NOT EXISTS idx_legal_content_country ON legal_content(country_code);
    CREATE INDEX IF NOT EXISTS idx_legal_content_region ON legal_content(country_code, region_code);
    CREATE INDEX IF NOT EXISTS idx_legal_content_lang ON legal_content(language);

    CREATE TABLE IF NOT EXISTS letter_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        full_name TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        signature_name TEXT,
        signature_title TEXT,
        intro_text TEXT,
        commitments_html TEXT,
        closing_text TEXT,
        insurance_text TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS passkey_credentials (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_key BYTEA NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        device_type TEXT,
        backed_up BOOLEAN DEFAULT FALSE,
        transports TEXT,
        display_name TEXT DEFAULT 'Passkey',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user_id ON passkey_credentials(user_id);

    CREATE TABLE IF NOT EXISTS auth_challenges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        challenge TEXT NOT NULL,
        type TEXT CHECK(type IN ('registration', 'authentication')) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        details JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON audit_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
    CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);

    CREATE TABLE IF NOT EXISTS permission_contacts (
        id SERIAL PRIMARY KEY,
        permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contact_type VARCHAR(30) NOT NULL,
        outcome VARCHAR(30),
        notes TEXT,
        contact_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_perm_contacts_perm ON permission_contacts(permission_id);

    CREATE TABLE IF NOT EXISTS reminders (
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
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_date);

    CREATE TABLE IF NOT EXISTS generated_letters (
        id SERIAL PRIMARY KEY,
        permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        s3_path VARCHAR(500) NOT NULL,
        filename VARCHAR(200) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_generated_letters_perm ON generated_letters(permission_id);

    CREATE TABLE IF NOT EXISTS permission_links (
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
    );
    CREATE INDEX IF NOT EXISTS idx_permission_links_token ON permission_links(token);
    CREATE INDEX IF NOT EXISTS idx_permission_links_perm ON permission_links(permission_id);

    CREATE TABLE IF NOT EXISTS legal_suggestions (
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
    );
    CREATE INDEX IF NOT EXISTS idx_legal_suggestions_user ON legal_suggestions(user_id);
    CREATE INDEX IF NOT EXISTS idx_legal_suggestions_status ON legal_suggestions(status);
    CREATE INDEX IF NOT EXISTS idx_legal_suggestions_content ON legal_suggestions(legal_content_id);

    CREATE TABLE IF NOT EXISTS legal_revisions (
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
    );
    CREATE INDEX IF NOT EXISTS idx_legal_revisions_content ON legal_revisions(legal_content_id);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
        key VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL,
        response_status INTEGER,
        response_body JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);

    `);

    // Create updated_at trigger function (shared by all tables)
    await pool.query(`
        CREATE OR REPLACE FUNCTION update_timestamp()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    `);

    // Create triggers for updated_at on relevant tables
    var tables = ['sites', 'finds', 'permissions', 'users', 'letter_preferences', 'hunt_sessions', 'legal_suggestions'];
    for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        await pool.query(`
            DO $$ BEGIN
                CREATE TRIGGER update_${t}_timestamp
                BEFORE UPDATE ON ${t}
                FOR EACH ROW
                EXECUTE FUNCTION update_timestamp();
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        `);
    }
};
