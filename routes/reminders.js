/**
 * Reminders routes — standalone CRUD for user reminders.
 * Reminders can optionally link to a permission, but can also be free-standing.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const { verifyToken, denyDemoUser } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

// All routes require auth
router.use(verifyToken);

// ---------------------------------------------------------------------------
// GET /api/reminders — list user's reminders
// Query: ?completed=false&limit=10&sort=due_date
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const completed = req.query.completed;
    const limit = parseInt(req.query.limit, 10) || 50;
    const sort = req.query.sort === 'due_date' ? 'due_date' : 'created_at';

    let sql = 'SELECT r.*, p.agency_or_owner AS permission_name FROM reminders r LEFT JOIN permissions p ON r.permission_id = p.id WHERE r.user_id = $1';
    const params = [req.user.id];
    const idx = 2;

    if (completed === 'true') {
      sql += ' AND r.is_completed = true';
    } else if (completed === 'false') {
      sql += ' AND r.is_completed = false';
    }

    sql += ' ORDER BY r.' + sort + ' ASC, r.id ASC LIMIT $' + idx;
    params.push(limit);

    const result = await db.query(sql, params);
    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reminders — create a reminder
// ---------------------------------------------------------------------------
router.post('/', denyDemoUser, validate(schemas.createReminder), async (req, res) => {
  try {
    const { permission_id, reminder_type, title, due_date, notes } = req.body;

    // If permission_id given, verify ownership
    if (permission_id) {
      const perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [permission_id]);
      if (!perm) {
        return res.status(404).json({ success: false, error: 'Permission not found' });
      }
      if (req.user.role !== 'admin' && perm.user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
    }

    const result = await db.query(
      'INSERT INTO reminders (user_id, permission_id, reminder_type, title, due_date, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [req.user.id, permission_id || null, reminder_type, title, due_date, notes || null]
    );

    const reminder = await db.queryOne(
      'SELECT r.*, p.agency_or_owner AS permission_name FROM reminders r LEFT JOIN permissions p ON r.permission_id = p.id WHERE r.id = $1',
      [result.rows[0].id]
    );

    db.logAuditEvent({
      userId: req.user.id,
      action: 'reminder.create',
      entityType: 'reminder',
      entityId: reminder.id,
      details: { reminder_type, title },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: reminder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/reminders/:id — update a reminder
// ---------------------------------------------------------------------------
router.put('/:id', denyDemoUser, validate(schemas.updateReminder), async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM reminders WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Reminder not found' });
    }
    if (req.user.role !== 'admin' && existing.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { permission_id, reminder_type, title, due_date, notes } = req.body;

    await db.query(
      `UPDATE reminders SET
        permission_id = $1,
        reminder_type = $2,
        title = $3,
        due_date = $4,
        notes = $5
       WHERE id = $6`,
      [
        permission_id !== undefined ? (permission_id || null) : existing.permission_id,
        reminder_type ?? existing.reminder_type,
        title ?? existing.title,
        due_date ?? existing.due_date,
        notes !== undefined ? (notes || null) : existing.notes,
        req.params.id,
      ]
    );

    const updated = await db.queryOne(
      'SELECT r.*, p.agency_or_owner AS permission_name FROM reminders r LEFT JOIN permissions p ON r.permission_id = p.id WHERE r.id = $1',
      [req.params.id]
    );

    db.logAuditEvent({
      userId: req.user.id,
      action: 'reminder.update',
      entityType: 'reminder',
      entityId: Number(req.params.id),
      details: { title: updated.title },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/reminders/:id/complete — toggle completion status
// ---------------------------------------------------------------------------
router.patch('/:id/complete', denyDemoUser, validate(schemas.completeReminder), async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM reminders WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Reminder not found' });
    }
    if (req.user.role !== 'admin' && existing.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const isCompleted = req.body.is_completed;
    const completedAt = isCompleted ? new Date().toISOString() : null;

    await db.query(
      'UPDATE reminders SET is_completed = $1, completed_at = $2 WHERE id = $3',
      [isCompleted, completedAt, req.params.id]
    );

    const updated = await db.queryOne(
      'SELECT r.*, p.agency_or_owner AS permission_name FROM reminders r LEFT JOIN permissions p ON r.permission_id = p.id WHERE r.id = $1',
      [req.params.id]
    );

    db.logAuditEvent({
      userId: req.user.id,
      action: 'reminder.complete',
      entityType: 'reminder',
      entityId: Number(req.params.id),
      details: { is_completed: isCompleted },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/reminders/:id — delete a reminder
// ---------------------------------------------------------------------------
router.delete('/:id', denyDemoUser, async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM reminders WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Reminder not found' });
    }
    if (req.user.role !== 'admin' && existing.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    await db.query('DELETE FROM reminders WHERE id = $1', [req.params.id]);

    db.logAuditEvent({
      userId: req.user.id,
      action: 'reminder.delete',
      entityType: 'reminder',
      entityId: Number(req.params.id),
      details: { title: existing.title },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { id: Number(req.params.id) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
