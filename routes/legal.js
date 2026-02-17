const express = require('express');
const router = express.Router();
const db = require('../database');
const { verifyToken, denyDemoUser } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

/**
 * GET /api/legal?country=US&region=CO&lang=en
 * Returns national-level + regional legal content sections.
 * Falls back to English if requested language is not available.
 */
router.get('/', async (req, res) => {
    try {
        const country = (req.query.country || 'US').toUpperCase();
        const region = req.query.region || null;
        const lang = req.query.lang || 'en';

        // Fetch national-level content (region_code IS NULL)
        let nationalContent = (await db.query(
            `SELECT id, section_key, section_title, content_html, severity, sort_order, source_url, last_verified
             FROM legal_content
             WHERE country_code = $1 AND region_code IS NULL AND language = $2
             ORDER BY sort_order, section_key`,
            [country, lang]
        )).rows;

        // If no content in requested language, fall back to English
        if (nationalContent.length === 0 && lang !== 'en') {
            nationalContent = (await db.query(
                `SELECT id, section_key, section_title, content_html, severity, sort_order, source_url, last_verified
                 FROM legal_content
                 WHERE country_code = $1 AND region_code IS NULL AND language = 'en'
                 ORDER BY sort_order, section_key`,
                [country]
            )).rows;
        }

        // Fetch regional content if a region is specified
        let regionalContent = [];
        if (region) {
            regionalContent = (await db.query(
                `SELECT id, section_key, section_title, content_html, severity, sort_order, source_url, last_verified
                 FROM legal_content
                 WHERE country_code = $1 AND region_code = $2 AND language = $3
                 ORDER BY sort_order, section_key`,
                [country, region, lang]
            )).rows;

            // Fall back to English for regional content too
            if (regionalContent.length === 0 && lang !== 'en') {
                regionalContent = (await db.query(
                    `SELECT id, section_key, section_title, content_html, severity, sort_order, source_url, last_verified
                     FROM legal_content
                     WHERE country_code = $1 AND region_code = $2 AND language = 'en'
                     ORDER BY sort_order, section_key`,
                    [country, region]
                )).rows;
            }
        }

        res.json({
            success: true,
            data: {
                country: country,
                region: region,
                language: lang,
                national: nationalContent,
                regional: regionalContent
            }
        });
    } catch (err) {
        console.error('Error fetching legal content:', err);
        res.status(500).json({ success: false, error: 'Failed to load legal content.' });
    }
});

/**
 * GET /api/legal/regions?country=US
 * Returns available regions for a country.
 */
router.get('/regions', async (req, res) => {
    try {
        const country = (req.query.country || 'US').toUpperCase();

        const regions = (await db.query(
            `SELECT DISTINCT region_code
             FROM legal_content
             WHERE country_code = $1 AND region_code IS NOT NULL
             ORDER BY region_code`,
            [country]
        )).rows;

        res.json({
            success: true,
            data: regions.map(r => r.region_code)
        });
    } catch (err) {
        console.error('Error fetching regions:', err);
        res.status(500).json({ success: false, error: 'Failed to load regions.' });
    }
});

// =========================================================================
// LEGAL SUGGESTIONS (authenticated endpoints)
// =========================================================================

/**
 * POST /api/legal/suggestions — Submit a suggestion for a legal content update.
 * Requires authentication.
 */
router.post('/suggestions', verifyToken, denyDemoUser, validate(schemas.createLegalSuggestion), async (req, res) => {
    try {
        const { legal_content_id, country_code, region_code, suggestion_type, section_title, suggested_text, reason } = req.body;

        const result = await db.query(
            `INSERT INTO legal_suggestions
                (user_id, legal_content_id, country_code, region_code, suggestion_type, section_title, suggested_text, reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
                req.user.id,
                legal_content_id || null,
                country_code.toUpperCase(),
                region_code || null,
                suggestion_type || 'correction',
                section_title || null,
                suggested_text,
                reason || null,
            ]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'legal.suggestion_create',
            entityType: 'legal_suggestion',
            entityId: result.rows[0].id,
            ipAddress: req.ip,
        });

        res.json({ success: true, data: { id: result.rows[0].id } });
    } catch (err) {
        console.error('Error creating legal suggestion:', err);
        res.status(500).json({ success: false, error: 'Failed to submit suggestion.' });
    }
});

/**
 * GET /api/legal/suggestions — List the current user's own suggestions.
 * Requires authentication.
 */
router.get('/suggestions', verifyToken, async (req, res) => {
    try {
        const rows = (await db.query(
            `SELECT id, legal_content_id, country_code, region_code, suggestion_type, section_title,
                    suggested_text, reason, status, admin_notes, created_at, updated_at
             FROM legal_suggestions
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [req.user.id]
        )).rows;

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Error fetching legal suggestions:', err);
        res.status(500).json({ success: false, error: 'Failed to load suggestions.' });
    }
});

module.exports = router;
