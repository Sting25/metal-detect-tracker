const express = require('express');
const router = express.Router();
const db = require('../database');
const s3 = require('../services/s3');
const { verifyToken, denyDemoUser } = require('../middleware/auth');
const { createUpload } = require('../middleware/upload');
const { validate, schemas } = require('../middleware/validate');
const idempotent = require('../middleware/idempotency');

// ---------------------------------------------------------------------------
// Auth -- all routes require a valid JWT
// ---------------------------------------------------------------------------
router.use(verifyToken);

// ---------------------------------------------------------------------------
// Multer setup -- validated image + PDF uploads to ../uploads/permissions/
// ---------------------------------------------------------------------------
const upload = createUpload('permissions', { allowDocuments: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a WHERE clause that scopes permissions to the current user.
 * Everyone sees own permissions + those on shared sites. Admin global view is in admin panel.
 * @param {number} startIndex - The starting $N placeholder index
 */
function permScopeSQL(user, startIndex) {
  return {
    where: ` AND (p.user_id = $${startIndex} OR p.site_id IN (SELECT site_id FROM site_shares WHERE shared_with_id = $${startIndex + 1}))`,
    params: [user.id, user.id],
  };
}

/**
 * Check whether `user` may access a permission record.
 */
async function canAccessPerm(user, perm) {
  if (user.role === 'admin') return true;
  if (perm.user_id === user.id) return true;
  const share = await db.queryOne(
    'SELECT 1 FROM site_shares WHERE site_id = $1 AND shared_with_id = $2',
    [perm.site_id, user.id]
  );
  return !!share;
}

/**
 * Check whether `user` may edit a permission record. Only admin or the owner.
 */
function canEditPerm(user, perm) {
  if (user.role === 'admin') return true;
  return perm.user_id === user.id;
}

/**
 * Auto-create/update an expiration reminder when a permission has expiration_date.
 * Creates a reminder 30 days before expiration (if >30 days away).
 * Updates existing expiration reminder if one already exists for this permission.
 */
async function autoExpirationReminder(userId, permId, expirationDate, agencyOrOwner) {
  if (!expirationDate) return;
  try {
    const expDate = new Date(expirationDate);
    const now = new Date();
    const daysUntil = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
    if (daysUntil <= 30) return; // Too soon or already past, no reminder needed

    const dueDate = new Date(expDate);
    dueDate.setDate(dueDate.getDate() - 30);
    const dueDateStr = dueDate.toISOString().split('T')[0];
    const title = 'Permission expiring: ' + (agencyOrOwner || 'Unknown');

    // Check for existing expiration reminder for this permission
    const existing = await db.queryOne(
      "SELECT id FROM reminders WHERE permission_id = $1 AND reminder_type = 'expiration' AND user_id = $2",
      [permId, userId]
    );

    if (existing) {
      await db.query(
        'UPDATE reminders SET title = $1, due_date = $2, is_completed = false, completed_at = NULL WHERE id = $3',
        [title, dueDateStr, existing.id]
      );
    } else {
      await db.query(
        "INSERT INTO reminders (user_id, permission_id, reminder_type, title, due_date) VALUES ($1, $2, 'expiration', $3, $4)",
        [userId, permId, title, dueDateStr]
      );
    }
  } catch (err) {
    console.error('Auto-reminder error:', err.message);
  }
}

function mapPermRow(r) {
  return {
    ...r,
    agency_owner: r.agency_or_owner,
    document_url: r.document_path ? '/api/permissions/' + r.id + '/document' : null,
    document_name: r.document_path ? r.document_path.split('/').pop() : null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/permissions -- list all, with optional filters, includes site name
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { status, site_id } = req.query;
    const scope = permScopeSQL(req.user, 1);

    let sql = `
      SELECT p.*, s.name AS site_name
      FROM permissions p
      LEFT JOIN sites s ON p.site_id = s.id
      WHERE 1=1
    ` + scope.where;
    const params = [...scope.params];
    let paramIndex = params.length + 1;

    if (status) {
      sql += ` AND p.status = $${paramIndex++}`;
      params.push(status);
    }
    if (site_id) {
      sql += ` AND p.site_id = $${paramIndex++}`;
      params.push(site_id);
    }

    sql += ' ORDER BY p.created_at DESC';

    const result = await db.query(sql, params);
    const data = result.rows.map(mapPermRow);

    res.json({ success: true, data, count: data.length });
  } catch (err) {
    console.error('Failed to load permissions:', err);
    res.status(500).json({ success: false, error: 'Failed to load permissions' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/permissions/:id -- single permission with site name
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT p.*, s.name AS site_name
       FROM permissions p
       LEFT JOIN sites s ON p.site_id = s.id
       WHERE p.id = $1`,
      [req.params.id]
    );

    if (!row) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }

    if (!(await canAccessPerm(req.user, row))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    res.json({
      success: true,
      data: mapPermRow(row),
    });
  } catch (err) {
    console.error('Failed to load permission:', err);
    res.status(500).json({ success: false, error: 'Failed to load permission' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/permissions/:id/document -- serve document via S3 presigned URL
// ---------------------------------------------------------------------------
router.get('/:id/document', async (req, res) => {
  try {
    const row = await db.queryOne(
      'SELECT * FROM permissions WHERE id = $1',
      [req.params.id]
    );

    if (!row) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }

    if (!(await canAccessPerm(req.user, row))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!row.document_path) {
      return res.status(404).json({ success: false, error: 'No document attached' });
    }

    const url = await s3.getPresignedUrl(row.document_path);
    res.redirect(url);
  } catch (err) {
    console.error('Failed to load permission document:', err);
    res.status(500).json({ success: false, error: 'Failed to load permission document' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/permissions -- create with multer document upload
// ---------------------------------------------------------------------------
router.post('/', denyDemoUser, idempotent, upload.single('document'), validate(schemas.createPermission), async (req, res) => {
  try {
    const {
      site_id,
      land_type,
      agency_or_owner,
      contact_name,
      contact_phone,
      contact_email,
      contact_address,
      date_requested,
      status,
      date_granted,
      expiration_date,
      notes,
    } = req.body;

    let documentPath = null;
    if (req.file) {
      const s3Key = s3.generateKey('permissions', req.file.originalname);
      await s3.uploadToS3(req.file.buffer, s3Key, req.file.mimetype);
      documentPath = s3Key;
    }

    const result = await db.query(
      `INSERT INTO permissions (
        user_id, site_id, land_type, agency_or_owner,
        contact_name, contact_phone, contact_email, contact_address,
        date_requested, status, date_granted, expiration_date,
        document_path, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, NOW(), NOW()
      ) RETURNING id`,
      [
        req.user.id,
        site_id || null,
        land_type || null,
        agency_or_owner || req.body.agency_owner || null,
        contact_name || null,
        contact_phone || null,
        contact_email || null,
        contact_address || null,
        date_requested || null,
        status || null,
        date_granted || null,
        expiration_date || null,
        documentPath,
        notes || null,
      ]
    );

    const newId = result.rows[0].id;

    const newPerm = await db.queryOne(
      `SELECT p.*, s.name AS site_name
       FROM permissions p
       LEFT JOIN sites s ON p.site_id = s.id
       WHERE p.id = $1`,
      [newId]
    );

    db.logAuditEvent({
      userId: req.user.id,
      action: 'permission.create',
      entityType: 'permission',
      entityId: newPerm.id,
      details: { land_type: newPerm.land_type, agency_or_owner: newPerm.agency_or_owner },
      ipAddress: req.ip,
    });

    // Auto-create expiration reminder if expiration_date is set
    await autoExpirationReminder(req.user.id, newPerm.id, newPerm.expiration_date, newPerm.agency_or_owner);

    res.status(201).json({
      success: true,
      data: mapPermRow(newPerm),
    });
  } catch (err) {
    console.error('Failed to create permission:', err);
    res.status(500).json({ success: false, error: 'Failed to create permission' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/permissions/:id -- update with optional document replacement
// ---------------------------------------------------------------------------
router.put('/:id', denyDemoUser, idempotent, upload.single('document'), validate(schemas.updatePermission), async (req, res) => {
  try {
    const existing = await db.queryOne(
      'SELECT * FROM permissions WHERE id = $1',
      [req.params.id]
    );

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }

    if (!canEditPerm(req.user, existing)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const {
      site_id,
      land_type,
      agency_or_owner,
      contact_name,
      contact_phone,
      contact_email,
      contact_address,
      date_requested,
      status,
      date_granted,
      expiration_date,
      notes,
    } = req.body;

    let documentPath = existing.document_path;
    if (req.file) {
      await s3.deleteFromS3(existing.document_path);
      const s3Key = s3.generateKey('permissions', req.file.originalname);
      await s3.uploadToS3(req.file.buffer, s3Key, req.file.mimetype);
      documentPath = s3Key;
    }

    await db.query(
      `UPDATE permissions SET
        site_id = $1,
        land_type = $2,
        agency_or_owner = $3,
        contact_name = $4,
        contact_phone = $5,
        contact_email = $6,
        contact_address = $7,
        date_requested = $8,
        status = $9,
        date_granted = $10,
        expiration_date = $11,
        document_path = $12,
        notes = $13,
        updated_at = NOW()
      WHERE id = $14`,
      [
        site_id ?? existing.site_id,
        land_type ?? existing.land_type,
        (agency_or_owner || req.body.agency_owner) ?? existing.agency_or_owner,
        contact_name ?? existing.contact_name,
        contact_phone ?? existing.contact_phone,
        contact_email ?? existing.contact_email,
        contact_address ?? existing.contact_address,
        date_requested ?? existing.date_requested,
        status ?? existing.status,
        date_granted ?? existing.date_granted,
        expiration_date ?? existing.expiration_date,
        documentPath,
        notes ?? existing.notes,
        req.params.id,
      ]
    );

    const updated = await db.queryOne(
      `SELECT p.*, s.name AS site_name
       FROM permissions p
       LEFT JOIN sites s ON p.site_id = s.id
       WHERE p.id = $1`,
      [req.params.id]
    );

    db.logAuditEvent({
      userId: req.user.id,
      action: 'permission.update',
      entityType: 'permission',
      entityId: Number(req.params.id),
      details: { status: updated.status },
      ipAddress: req.ip,
    });

    // Auto-create/update expiration reminder if expiration_date changed
    await autoExpirationReminder(req.user.id, updated.id, updated.expiration_date, updated.agency_or_owner);

    res.json({
      success: true,
      data: mapPermRow(updated),
    });
  } catch (err) {
    console.error('Failed to update permission:', err);
    res.status(500).json({ success: false, error: 'Failed to update permission' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/permissions/:id -- delete permission and remove document file
// ---------------------------------------------------------------------------
router.delete('/:id', denyDemoUser, async (req, res) => {
  try {
    const existing = await db.queryOne(
      'SELECT * FROM permissions WHERE id = $1',
      [req.params.id]
    );

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }

    if (!canEditPerm(req.user, existing)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    await s3.deleteFromS3(existing.document_path);

    await db.query('DELETE FROM permissions WHERE id = $1', [req.params.id]);

    // Audit log: permission deletion
    db.logAuditEvent({
      userId: req.user.id,
      action: 'permission_delete',
      entityType: 'permission',
      entityId: Number(req.params.id),
      details: { land_type: existing.land_type, agency_or_owner: existing.agency_or_owner },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { id: Number(req.params.id) } });
  } catch (err) {
    console.error('Failed to delete permission:', err);
    res.status(500).json({ success: false, error: 'Failed to delete permission' });
  }
});

// ===========================================================================
// Contact Log (permission_contacts) — nested under /api/permissions/:id
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/permissions/:id/contacts -- list contacts for a permission
// ---------------------------------------------------------------------------
router.get('/:id/contacts', async (req, res) => {
  try {
    const perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [req.params.id]);
    if (!perm) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }
    if (!(await canAccessPerm(req.user, perm))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const result = await db.query(
      'SELECT * FROM permission_contacts WHERE permission_id = $1 ORDER BY contact_date DESC, created_at DESC',
      [req.params.id]
    );

    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Failed to load contacts:', err);
    res.status(500).json({ success: false, error: 'Failed to load contacts' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/permissions/:id/contacts -- create a contact log entry
// ---------------------------------------------------------------------------
router.post('/:id/contacts', denyDemoUser, validate(schemas.createContact), async (req, res) => {
  try {
    const perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [req.params.id]);
    if (!perm) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }
    if (!canEditPerm(req.user, perm)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { contact_type, outcome, notes, contact_date } = req.body;

    const result = await db.query(
      `INSERT INTO permission_contacts (permission_id, user_id, contact_type, outcome, notes, contact_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        req.params.id,
        req.user.id,
        contact_type,
        outcome || null,
        notes || null,
        contact_date || new Date().toISOString(),
      ]
    );

    const contact = await db.queryOne(
      'SELECT * FROM permission_contacts WHERE id = $1',
      [result.rows[0].id]
    );

    db.logAuditEvent({
      userId: req.user.id,
      action: 'permission.contact_create',
      entityType: 'permission',
      entityId: Number(req.params.id),
      details: { contact_type, outcome: outcome || null },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: contact });
  } catch (err) {
    console.error('Failed to create contact:', err);
    res.status(500).json({ success: false, error: 'Failed to create contact' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/permissions/:id/contacts/:cid -- update a contact log entry
// ---------------------------------------------------------------------------
router.put('/:id/contacts/:cid', denyDemoUser, validate(schemas.updateContact), async (req, res) => {
  try {
    const perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [req.params.id]);
    if (!perm) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }
    if (!canEditPerm(req.user, perm)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const existing = await db.queryOne(
      'SELECT * FROM permission_contacts WHERE id = $1 AND permission_id = $2',
      [req.params.cid, req.params.id]
    );
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    const { contact_type, outcome, notes, contact_date } = req.body;

    await db.query(
      `UPDATE permission_contacts SET
        contact_type = $1,
        outcome = $2,
        notes = $3,
        contact_date = $4
       WHERE id = $5`,
      [
        contact_type ?? existing.contact_type,
        outcome !== undefined ? (outcome || null) : existing.outcome,
        notes !== undefined ? (notes || null) : existing.notes,
        contact_date ?? existing.contact_date,
        req.params.cid,
      ]
    );

    const updated = await db.queryOne(
      'SELECT * FROM permission_contacts WHERE id = $1',
      [req.params.cid]
    );

    db.logAuditEvent({
      userId: req.user.id,
      action: 'permission.contact_update',
      entityType: 'permission',
      entityId: Number(req.params.id),
      details: { contact_id: Number(req.params.cid) },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Failed to update contact:', err);
    res.status(500).json({ success: false, error: 'Failed to update contact' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/permissions/:id/contacts/:cid -- delete a contact log entry
// ---------------------------------------------------------------------------
router.delete('/:id/contacts/:cid', denyDemoUser, async (req, res) => {
  try {
    const perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [req.params.id]);
    if (!perm) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }
    if (!canEditPerm(req.user, perm)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const existing = await db.queryOne(
      'SELECT * FROM permission_contacts WHERE id = $1 AND permission_id = $2',
      [req.params.cid, req.params.id]
    );
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    await db.query('DELETE FROM permission_contacts WHERE id = $1', [req.params.cid]);

    db.logAuditEvent({
      userId: req.user.id,
      action: 'permission.contact_delete',
      entityType: 'permission',
      entityId: Number(req.params.id),
      details: { contact_id: Number(req.params.cid) },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { id: Number(req.params.cid) } });
  } catch (err) {
    console.error('Failed to delete contact:', err);
    res.status(500).json({ success: false, error: 'Failed to delete contact' });
  }
});

// ===========================================================================
// Letter Generation — nested under /api/permissions/:id
// ===========================================================================

const pdfService = require('../services/pdf');

// ---------------------------------------------------------------------------
// POST /api/permissions/:id/letter -- generate a PDF letter, upload to S3
// ---------------------------------------------------------------------------
router.post('/:id/letter', denyDemoUser, async (req, res) => {
  try {
    const perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [req.params.id]);
    if (!perm) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }
    if (!canEditPerm(req.user, perm)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Require letter preferences
    const letterPrefs = await db.queryOne('SELECT * FROM letter_preferences WHERE user_id = $1', [req.user.id]);
    if (!letterPrefs) {
      return res.status(400).json({ success: false, error: 'Letter preferences not set. Please configure your letter preferences first.' });
    }

    // Fetch linked site (optional)
    let site = null;
    if (perm.site_id) {
      site = await db.queryOne('SELECT * FROM sites WHERE id = $1', [perm.site_id]);
    }

    // Generate the PDF
    const pdfBuffer = await pdfService.generatePermissionLetter(letterPrefs, perm, site);

    // Upload to S3
    const timestamp = Date.now();
    const filename = 'permission-letter-' + perm.id + '-' + timestamp + '.pdf';
    const s3Path = 'letters/' + perm.id + '/' + filename;
    await s3.uploadToS3(pdfBuffer, s3Path, 'application/pdf');

    // Store record
    const result = await db.query(
      'INSERT INTO generated_letters (permission_id, user_id, s3_path, filename) VALUES ($1, $2, $3, $4) RETURNING id',
      [perm.id, req.user.id, s3Path, filename]
    );

    const letter = await db.queryOne('SELECT * FROM generated_letters WHERE id = $1', [result.rows[0].id]);

    // Generate a presigned URL for immediate download
    const downloadUrl = await s3.getPresignedUrl(s3Path, 900);

    db.logAuditEvent({
      userId: req.user.id,
      action: 'permission.letter_generate',
      entityType: 'permission',
      entityId: Number(req.params.id),
      details: { letter_id: letter.id, filename: filename },
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      data: {
        id: letter.id,
        permission_id: letter.permission_id,
        filename: letter.filename,
        s3_path: letter.s3_path,
        created_at: letter.created_at,
        download_url: downloadUrl,
      },
    });
  } catch (err) {
    console.error('Failed to generate letter:', err);
    res.status(500).json({ success: false, error: 'Failed to generate letter' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/permissions/:id/letters -- list generated letters for a permission
// ---------------------------------------------------------------------------
router.get('/:id/letters', async (req, res) => {
  try {
    const perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [req.params.id]);
    if (!perm) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }
    if (!(await canAccessPerm(req.user, perm))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const result = await db.query(
      'SELECT * FROM generated_letters WHERE permission_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );

    // Generate presigned URLs for each letter
    const letters = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      const downloadUrl = await s3.getPresignedUrl(row.s3_path, 900);
      letters.push({
        id: row.id,
        permission_id: row.permission_id,
        filename: row.filename,
        s3_path: row.s3_path,
        created_at: row.created_at,
        download_url: downloadUrl,
      });
    }

    res.json({ success: true, data: letters, count: letters.length });
  } catch (err) {
    console.error('Failed to load letters:', err);
    res.status(500).json({ success: false, error: 'Failed to load letters' });
  }
});

// ===========================================================================
// Permission Links — nested under /api/permissions/:id
// ===========================================================================

const crypto = require('crypto');
const QRCode = require('qrcode');

// ---------------------------------------------------------------------------
// POST /api/permissions/:id/link -- create a shareable permission link + QR
// ---------------------------------------------------------------------------
router.post('/:id/link', denyDemoUser, validate(schemas.createPermissionLink), async (req, res) => {
  try {
    const perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [req.params.id]);
    if (!perm) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }
    if (!canEditPerm(req.user, perm)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const expiresInDays = req.body.expires_in_days || 30;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const token = crypto.randomBytes(32).toString('hex');

    const result = await db.query(
      `INSERT INTO permission_links (permission_id, token, status, expires_at, conditions_text)
       VALUES ($1, $2, 'active', $3, $4) RETURNING id`,
      [perm.id, token, expiresAt, req.body.conditions_text || null]
    );

    const link = await db.queryOne('SELECT * FROM permission_links WHERE id = $1', [result.rows[0].id]);

    // Build the public approval URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const approvalUrl = baseUrl + '/permission-approve.html?token=' + token;

    // Generate QR code as data URI
    const qrCode = await QRCode.toDataURL(approvalUrl);

    db.logAuditEvent({
      userId: req.user.id,
      action: 'permission.link_create',
      entityType: 'permission',
      entityId: Number(req.params.id),
      details: { link_id: link.id, expires_in_days: expiresInDays },
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      data: {
        id: link.id,
        permission_id: link.permission_id,
        token: link.token,
        status: link.status,
        expires_at: link.expires_at,
        created_at: link.created_at,
        url: approvalUrl,
        qr_code: qrCode,
      },
    });
  } catch (err) {
    console.error('Failed to create permission link:', err);
    res.status(500).json({ success: false, error: 'Failed to create permission link' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/permissions/:id/links -- list links for a permission
// ---------------------------------------------------------------------------
router.get('/:id/links', async (req, res) => {
  try {
    const perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [req.params.id]);
    if (!perm) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }
    if (!(await canAccessPerm(req.user, perm))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const result = await db.query(
      'SELECT id, permission_id, token, status, expires_at, created_at, signed_name, approved_at, denied_at FROM permission_links WHERE permission_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Failed to load permission links:', err);
    res.status(500).json({ success: false, error: 'Failed to load permission links' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/permissions/:id/links/:lid -- revoke a permission link
// ---------------------------------------------------------------------------
router.delete('/:id/links/:lid', denyDemoUser, async (req, res) => {
  try {
    const perm = await db.queryOne('SELECT * FROM permissions WHERE id = $1', [req.params.id]);
    if (!perm) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }
    if (!canEditPerm(req.user, perm)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const link = await db.queryOne(
      'SELECT * FROM permission_links WHERE id = $1 AND permission_id = $2',
      [req.params.lid, req.params.id]
    );
    if (!link) {
      return res.status(404).json({ success: false, error: 'Link not found' });
    }

    await db.query(
      "UPDATE permission_links SET status = 'revoked' WHERE id = $1",
      [req.params.lid]
    );

    db.logAuditEvent({
      userId: req.user.id,
      action: 'permission.link_revoke',
      entityType: 'permission',
      entityId: Number(req.params.id),
      details: { link_id: Number(req.params.lid) },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { id: Number(req.params.lid), status: 'revoked' } });
  } catch (err) {
    console.error('Failed to revoke permission link:', err);
    res.status(500).json({ success: false, error: 'Failed to revoke permission link' });
  }
});

module.exports = router;
