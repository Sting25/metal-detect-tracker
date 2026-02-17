/**
 * Land Types API
 * Provides country-specific land classification presets and user-created custom types.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const { verifyToken, denyDemoUser } = require('../middleware/auth');

/**
 * GET /api/land-types?country=US
 * Returns land type presets for a country + any custom types created by the user.
 * If no country specified, uses the authenticated user's country_code.
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const countryCode = req.query.country || req.user.country_code || 'US';

        const types = (await db.query(`
            SELECT id, code, label, country_code, description, is_custom, sort_order
            FROM land_types
            WHERE (country_code = $1 AND is_custom = false)
               OR (is_custom = true AND created_by = $2)
            ORDER BY sort_order ASC, label ASC
        `, [countryCode, req.user.id])).rows;

        res.json({ success: true, data: types });
    } catch (err) {
        console.error('Error fetching land types:', err);
        res.status(500).json({ success: false, error: 'Failed to load land types' });
    }
});

/**
 * POST /api/land-types
 * Create a custom land type for the authenticated user.
 */
router.post('/', verifyToken, denyDemoUser, async (req, res) => {
    try {
        const { code, label, country_code, description } = req.body;

        if (!code || !label) {
            return res.status(400).json({ success: false, error: 'Code and label are required' });
        }

        // Sanitize code: lowercase, underscores only
        const cleanCode = code.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const cc = country_code || req.user.country_code || 'US';

        const result = await db.query(`
            INSERT INTO land_types (code, label, country_code, description, is_custom, created_by, sort_order)
            VALUES ($1, $2, $3, $4, true, $5, 500)
            RETURNING *
        `, [cleanCode, label, cc, description || null, req.user.id]);

        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') { // PostgreSQL unique violation
            return res.status(400).json({ success: false, error: 'A land type with that code already exists for this country' });
        }
        console.error('Error creating land type:', err);
        res.status(500).json({ success: false, error: 'Failed to create land type' });
    }
});

/**
 * DELETE /api/land-types/:id
 * Delete a custom land type (only if created by the authenticated user).
 */
router.delete('/:id', verifyToken, denyDemoUser, async (req, res) => {
    try {
        const type = await db.queryOne('SELECT * FROM land_types WHERE id = $1', [req.params.id]);

        if (!type) {
            return res.status(404).json({ success: false, error: 'Land type not found' });
        }

        if (!type.is_custom) {
            return res.status(403).json({ success: false, error: 'Cannot delete preset land types' });
        }

        if (type.created_by !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'You can only delete your own custom land types' });
        }

        await db.query('DELETE FROM land_types WHERE id = $1', [req.params.id]);
        res.json({ success: true, data: { id: Number(req.params.id) } });
    } catch (err) {
        console.error('Error deleting land type:', err);
        res.status(500).json({ success: false, error: 'Failed to delete land type' });
    }
});

module.exports = router;
