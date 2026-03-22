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
    var completed = req.query.completed;
    var limit = parseInt(req.query.limit, 10) || 50;
    var sort = req.query.sort === 'due_date' ? 'due_date' : 'created_at';

    var sql = 'SELECT r.*, p.agency_or_owner AS permission_name FROM reminders r LEFT JOIN permissions p ON r.permission_id = p.id WHERE r.user_id = $1';
    var params = [req.user.id];
    var idx = 2;

    if (completed === 'true') {
      sql += ' AND r.is_completed = true';
    } else if (completed === 'false') {
      sql += ' AND r.is_completed = false';
    }

    sql += ' ORDER BY r.' + sort + ' ASC, r.id ASC LIMIT $' + idx;
    params.push(limit);

    var result = await db.query(sql, params);
    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Failed to list reminders:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load reminders' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reminders — create a reminder
// ---------------------------------------------------------------------------
router.post('/', denyDemoUser, validate(schemas.createReminder), async (req, res) => {
  try {
    var { permission_id, reminder_type, title, due_date, notes } = req.body;

    // If permission_id given, verify ownership
    if (permission_id) {
      var perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [permission_id]);
      if (!perm) {
        return res.status(404).json({ success: false, error: 'Permission not found' });
      }
      if (req.user.role !== 'admin' && perm.user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
    }

    var result = await db.query(
      'INSERT INTO reminders (user_id, permission_id, reminder_type, title, due_date, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [req.user.id, permission_id || null, reminder_type, title, due_date, notes || null]
    );

    var reminder = await db.queryOne(
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
    console.error('Failed to create reminder:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create reminder' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/reminders/:id — update a reminder
// ---------------------------------------------------------------------------
router.put('/:id', denyDemoUser, validate(schemas.updateReminder), async (req, res) => {
  try {
    var existing = await db.queryOne('SELECT * FROM reminders WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Reminder not found' });
    }
    if (req.user.role !== 'admin' && existing.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    var { permission_id, reminder_type, title, due_date, notes } = req.body;

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

    var updated = await db.queryOne(
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
    console.error('Failed to update reminder:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update reminder' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/reminders/:id/complete — toggle completion status
// ---------------------------------------------------------------------------
router.patch('/:id/complete', denyDemoUser, validate(schemas.completeReminder), async (req, res) => {
  try {
    var existing = await db.queryOne('SELECT * FROM reminders WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Reminder not found' });
    }
    if (req.user.role !== 'admin' && existing.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    var isCompleted = req.body.is_completed;
    var completedAt = isCompleted ? new Date().toISOString() : null;

    await db.query(
      'UPDATE reminders SET is_completed = $1, completed_at = $2 WHERE id = $3',
      [isCompleted, completedAt, req.params.id]
    );

    var updated = await db.queryOne(
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
    console.error('Failed to complete reminder:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update reminder' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/reminders/:id — delete a reminder
// ---------------------------------------------------------------------------
router.delete('/:id', denyDemoUser, async (req, res) => {
  try {
    var existing = await db.queryOne('SELECT * FROM reminders WHERE id = $1', [req.params.id]);
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
    console.error('Failed to delete reminder:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete reminder' });
  }
});

module.exports = router;
