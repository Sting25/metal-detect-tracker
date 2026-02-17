const { request } = require('./helpers');
const db = require('../database');

/**
 * Seed a few legal_content rows for testing.
 */
async function seedLegalContent() {
    const insert = async (country_code, region_code, language, section_key, section_title, content_html, severity, sort_order, source_url, last_verified) => {
        await db.query(
            `INSERT INTO legal_content
                (country_code, region_code, language, section_key, section_title, content_html, severity, sort_order, source_url, last_verified)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [country_code, region_code, language, section_key, section_title, content_html, severity, sort_order, source_url, last_verified]
        );
    };

    // US national
    await insert('US', null, 'en', 'federal_arpa', 'Federal Law - ARPA', '<p>ARPA content</p>', 'warning', 10, 'https://example.com/arpa', '2025-01-15');
    await insert('US', null, 'en', 'blm_land', 'BLM Land', '<p>BLM content</p>', 'ok', 20, null, '2025-01-15');
    await insert('US', null, 'en', 'best_practices', 'Best Practices', '<p>Best practices content</p>', null, 80, null, '2025-01-15');

    // US national - Spanish
    await insert('US', null, 'es', 'federal_arpa', 'Ley Federal - ARPA', '<p>Contenido ARPA</p>', 'warning', 10, null, '2025-01-15');

    // US regional - Colorado
    await insert('US', 'CO', 'en', 'state_overview', 'Colorado Overview', '<p>Colorado info</p>', 'caution', 10, null, '2025-01-15');
    await insert('US', 'CO', 'en', 'state_trust', 'Colorado State Trust Land', '<p>Trust land info</p>', 'danger', 20, null, '2025-01-15');

    // US regional - Texas
    await insert('US', 'TX', 'en', 'state_overview', 'Texas Overview', '<p>Texas info</p>', 'ok', 10, null, '2025-01-15');

    // GB national
    await insert('GB', null, 'en', 'treasure_act', 'Treasure Act 1996', '<p>Treasure act content</p>', 'warning', 10, null, '2025-01-15');
    await insert('GB', null, 'en', 'pas_scheme', 'Portable Antiquities Scheme', '<p>PAS content</p>', null, 20, null, '2025-01-15');

    // GB regional
    await insert('GB', 'ENG', 'en', 'detecting_england', 'Detecting in England', '<p>England info</p>', 'ok', 10, null, '2025-01-15');
    await insert('GB', 'SCT', 'en', 'detecting_scotland', 'Detecting in Scotland', '<p>Scotland info</p>', 'caution', 10, null, '2025-01-15');

    // AU national
    await insert('AU', null, 'en', 'au_overview', 'General Overview', '<p>AU overview</p>', 'caution', 10, null, '2025-01-15');
}

describe('Legal Routes', () => {

    // --- GET /api/legal ---
    describe('GET /api/legal', () => {
        it('returns national content for US by default', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.country).toBe('US');
            expect(res.body.data.region).toBeNull();
            expect(res.body.data.language).toBe('en');
            expect(res.body.data.national).toBeInstanceOf(Array);
            expect(res.body.data.national.length).toBe(3);
            expect(res.body.data.regional).toEqual([]);
        });

        it('returns national content sorted by sort_order', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal?country=US');
            const keys = res.body.data.national.map(s => s.section_key);
            expect(keys).toEqual(['federal_arpa', 'blm_land', 'best_practices']);
        });

        it('returns content for a specific country', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal?country=GB');
            expect(res.status).toBe(200);
            expect(res.body.data.country).toBe('GB');
            expect(res.body.data.national.length).toBe(2);
            expect(res.body.data.national[0].section_key).toBe('treasure_act');
        });

        it('returns both national and regional content when region specified', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal?country=US&region=CO');
            expect(res.status).toBe(200);
            expect(res.body.data.country).toBe('US');
            expect(res.body.data.region).toBe('CO');
            expect(res.body.data.national.length).toBe(3);
            expect(res.body.data.regional.length).toBe(2);
            expect(res.body.data.regional[0].section_key).toBe('state_overview');
        });

        it('returns empty regional array for region with no content', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal?country=US&region=AK');
            expect(res.status).toBe(200);
            expect(res.body.data.national.length).toBe(3);
            expect(res.body.data.regional).toEqual([]);
        });

        it('returns content in requested language', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal?country=US&lang=es');
            expect(res.status).toBe(200);
            expect(res.body.data.language).toBe('es');
            expect(res.body.data.national.length).toBe(1);
            expect(res.body.data.national[0].section_title).toBe('Ley Federal - ARPA');
        });

        it('falls back to English when requested language has no content', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal?country=GB&lang=es');
            expect(res.status).toBe(200);
            // No Spanish GB content exists, should fall back to English
            expect(res.body.data.national.length).toBe(2);
            expect(res.body.data.national[0].section_key).toBe('treasure_act');
        });

        it('falls back to English for regional content too', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal?country=US&region=CO&lang=fr');
            expect(res.status).toBe(200);
            // No French regional content, should fall back to English
            expect(res.body.data.regional.length).toBe(2);
        });

        it('uppercases country code', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal?country=gb');
            expect(res.status).toBe(200);
            expect(res.body.data.country).toBe('GB');
            expect(res.body.data.national.length).toBe(2);
        });

        it('returns empty national array for country with no content', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal?country=ZZ');
            expect(res.status).toBe(200);
            expect(res.body.data.national).toEqual([]);
        });

        it('includes all expected fields in response sections', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal?country=US');
            const section = res.body.data.national[0];
            expect(section).toHaveProperty('id');
            expect(section).toHaveProperty('section_key', 'federal_arpa');
            expect(section).toHaveProperty('section_title', 'Federal Law - ARPA');
            expect(section).toHaveProperty('content_html', '<p>ARPA content</p>');
            expect(section).toHaveProperty('severity', 'warning');
            expect(section).toHaveProperty('sort_order', 10);
            expect(section).toHaveProperty('source_url', 'https://example.com/arpa');
            expect(section).toHaveProperty('last_verified', '2025-01-15');
        });

        it('does not require authentication', async () => {
            await seedLegalContent();

            // No auth token — should still work
            const res = await request().get('/api/legal?country=AU');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.national.length).toBe(1);
        });
    });

    // --- GET /api/legal/regions ---
    describe('GET /api/legal/regions', () => {
        it('returns available regions for US', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal/regions?country=US');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeInstanceOf(Array);
            expect(res.body.data).toContain('CO');
            expect(res.body.data).toContain('TX');
            expect(res.body.data.length).toBe(2);
        });

        it('returns regions sorted alphabetically', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal/regions?country=US');
            expect(res.body.data).toEqual(['CO', 'TX']);
        });

        it('returns available regions for GB', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal/regions?country=GB');
            expect(res.body.data).toContain('ENG');
            expect(res.body.data).toContain('SCT');
        });

        it('returns empty array for country with no regions', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal/regions?country=AU');
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
        });

        it('returns empty array for unknown country', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal/regions?country=ZZ');
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
        });

        it('uppercases country code', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal/regions?country=us');
            expect(res.body.data).toEqual(['CO', 'TX']);
        });

        it('does not require authentication', async () => {
            await seedLegalContent();

            const res = await request().get('/api/legal/regions?country=US');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
