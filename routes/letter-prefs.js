const express = require('express');
const router = express.Router();
const db = require('../database');
const { verifyToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

/**
 * GET /api/letter-preferences
 * Returns the current user's saved letter preferences.
 * If none exist, returns an object with all fields null and isDefault: true.
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const row = await db.queryOne(
            `SELECT id, user_id, full_name, address, phone, email,
                    signature_name, signature_title,
                    intro_text, commitments_html, closing_text, insurance_text,
                    created_at, updated_at
             FROM letter_preferences
             WHERE user_id = $1`,
            [req.user.id]
        );

        if (row) {
            res.json({ success: true, data: row, isDefault: false });
        } else {
            res.json({
                success: true,
                isDefault: true,
                data: {
                    user_id: req.user.id,
                    full_name: null,
                    address: null,
                    phone: null,
                    email: null,
                    signature_name: null,
                    signature_title: null,
                    intro_text: null,
                    commitments_html: null,
                    closing_text: null,
                    insurance_text: null
                }
            });
        }
    } catch (err) {
        console.error('Error fetching letter preferences:', err);
        res.status(500).json({ success: false, error: 'Failed to load letter preferences.' });
    }
});

/**
 * PUT /api/letter-preferences
 * Upsert the current user's letter preferences.
 */
router.put('/', verifyToken, validate(schemas.letterPreferences), async (req, res) => {
    try {
        const {
            full_name, address, phone, email,
            signature_name, signature_title,
            intro_text, commitments_html, closing_text, insurance_text
        } = req.body;

        await db.query(
            `INSERT INTO letter_preferences
                (user_id, full_name, address, phone, email,
                 signature_name, signature_title,
                 intro_text, commitments_html, closing_text, insurance_text)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT(user_id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                address = EXCLUDED.address,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                signature_name = EXCLUDED.signature_name,
                signature_title = EXCLUDED.signature_title,
                intro_text = EXCLUDED.intro_text,
                commitments_html = EXCLUDED.commitments_html,
                closing_text = EXCLUDED.closing_text,
                insurance_text = EXCLUDED.insurance_text,
                updated_at = NOW()`,
            [
                req.user.id,
                full_name ?? null,
                address ?? null,
                phone ?? null,
                email ?? null,
                signature_name ?? null,
                signature_title ?? null,
                intro_text ?? null,
                commitments_html ?? null,
                closing_text ?? null,
                insurance_text ?? null
            ]
        );

        const row = await db.queryOne(
            `SELECT id, user_id, full_name, address, phone, email,
                    signature_name, signature_title,
                    intro_text, commitments_html, closing_text, insurance_text,
                    created_at, updated_at
             FROM letter_preferences
             WHERE user_id = $1`,
            [req.user.id]
        );

        res.json({ success: true, data: row });
    } catch (err) {
        console.error('Error saving letter preferences:', err);
        res.status(500).json({ success: false, error: 'Failed to save letter preferences.' });
    }
});

module.exports = router;
