const express = require('express');
const router = express.Router();
const db = require('../database');
const s3 = require('../services/s3');
const coverage = require('../services/coverage');
const { verifyToken, denyDemoUser } = require('../middleware/auth');
const { createUpload } = require('../middleware/upload');
const { validate, schemas } = require('../middleware/validate');
const idempotent = require('../middleware/idempotency');

// ---------------------------------------------------------------------------
// Auth -- all routes require a valid JWT
// ---------------------------------------------------------------------------
router.use(verifyToken);

// ---------------------------------------------------------------------------
// Multer setup -- validated image uploads (memory storage for S3)
// ---------------------------------------------------------------------------
const upload = createUpload('sites');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a WHERE clause that scopes sites to the current user.
 * Everyone sees own sites + shared sites. Admin global view is in admin panel.
 */
function siteScopeSQL(user, startIndex) {
  return {
    where: ` AND (sites.user_id = $${startIndex} OR sites.id IN (SELECT site_id FROM site_shares WHERE shared_with_id = $${startIndex + 1}))`,
    params: [user.id, user.id],
  };
}

/**
 * Check whether `user` may access `site`. Returns true for admins, owners,
 * and users the site has been shared with.
 */
async function canAccessSite(user, site) {
  if (user.role === 'admin') return true;
  if (site.user_id === user.id) return true;
  const share = await db.queryOne(
    'SELECT 1 FROM site_shares WHERE site_id = $1 AND shared_with_id = $2',
    [site.id, user.id]
  );
  return !!share;
}

/**
 * Check whether `user` may edit `site`. Admins and owners always can;
 * shared users need permission_level = 'edit'.
 */
async function canEditSite(user, site) {
  if (user.role === 'admin') return true;
  if (site.user_id === user.id) return true;
  const share = await db.queryOne(
    "SELECT 1 FROM site_shares WHERE site_id = $1 AND shared_with_id = $2 AND permission_level = 'edit'",
    [site.id, user.id]
  );
  return !!share;
}

function mapSiteRow(r) {
  return {
    ...r,
    image_url: r.image_path ? '/api/uploads/' + r.image_path : null,
    contact_name: r.permission_contact_name,
    contact_phone: r.permission_contact_phone,
    contact_email: r.permission_contact_email,
    status: r.site_status,
  };
}

// ---------------------------------------------------------------------------
// GET /api/sites -- list all sites, with optional filters
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { status, land_type, tag, priority } = req.query;
    const params = [];
    let paramIndex = 1;

    const scope = siteScopeSQL(req.user, paramIndex);
    params.push(...scope.params);
    paramIndex += scope.params.length;

    let sql = 'SELECT * FROM sites WHERE 1=1' + scope.where;

    if (status) {
      sql += ` AND site_status = $${paramIndex++}`;
      params.push(status);
    }
    if (land_type) {
      sql += ` AND land_type = $${paramIndex++}`;
      params.push(land_type);
    }
    if (priority) {
      sql += ` AND priority = $${paramIndex++}`;
      params.push(priority);
    }
    if (tag) {
      sql += ` AND (',' || tags || ',' LIKE '%,' || $${paramIndex++} || ',%')`;
      params.push(tag);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = (await db.query(sql, params)).rows;
    const data = rows.map(mapSiteRow);

    res.json({ success: true, data, count: data.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sites/stats -- aggregate counts
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  try {
    const scope = siteScopeSQL(req.user, 1);
    const whereClause = scope.where ? ' WHERE 1=1' + scope.where : '';

    const totalRow = await db.queryOne(
      'SELECT COUNT(*)::int AS cnt FROM sites' + whereClause,
      scope.params
    );
    const total = totalRow.cnt;

    const byStatus = (await db.query(
      'SELECT site_status, COUNT(*)::int AS cnt FROM sites' + whereClause + ' GROUP BY site_status',
      scope.params
    )).rows;

    const byPermission = (await db.query(
      'SELECT permission_status, COUNT(*)::int AS cnt FROM sites' + whereClause + ' GROUP BY permission_status',
      scope.params
    )).rows;

    res.json({
      success: true,
      data: {
        total,
        by_site_status: byStatus,
        by_permission_status: byPermission,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sites/map -- lightweight payload for map markers
// ---------------------------------------------------------------------------
router.get('/map', async (req, res) => {
  try {
    const scope = siteScopeSQL(req.user, 1);
    const whereClause = scope.where ? ' WHERE 1=1' + scope.where : '';

    const rows = (await db.query(
      `SELECT id, name, latitude, longitude, land_type, site_status, permission_status, priority, tags
       FROM sites` + whereClause,
      scope.params
    )).rows;

    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sites/:id -- single site with finds_count
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const site = await db.queryOne('SELECT * FROM sites WHERE id = $1', [req.params.id]);

    if (!site) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    if (!(await canAccessSite(req.user, site))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const findsRow = await db.queryOne(
      'SELECT COUNT(*)::int AS cnt FROM finds WHERE site_id = $1',
      [req.params.id]
    );
    const findsCount = findsRow.cnt;

    res.json({
      success: true,
      data: {
        ...mapSiteRow(site),
        finds_count: findsCount,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sites/:id/coverage -- coverage overlay data
// ---------------------------------------------------------------------------
router.get('/:id/coverage', async (req, res) => {
  try {
    const site = await db.queryOne('SELECT * FROM sites WHERE id = $1', [req.params.id]);

    if (!site) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    if (!(await canAccessSite(req.user, site))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Validate cell_size
    var cellSize = 2;
    if (req.query.cell_size !== undefined) {
      cellSize = parseFloat(req.query.cell_size);
      if (isNaN(cellSize) || cellSize < 1 || cellSize > 10) {
        return res.status(400).json({ success: false, error: 'cell_size must be between 1 and 10' });
      }
    }

    // Build query — all trackpoints for this site, optionally filtered by session
    var params = [site.id, req.user.id];
    var sessionFilter = '';
    if (req.query.session_id) {
      sessionFilter = ' AND hs.id = $3';
      params.push(parseInt(req.query.session_id));
    }

    var sql = `
      SELECT tp.lat, tp.lng
      FROM track_points tp
      JOIN track_segments ts ON tp.segment_id = ts.id
      JOIN hunt_sessions hs ON ts.session_id = hs.id
      WHERE hs.site_id = $1 AND hs.user_id = $2${sessionFilter}
      ORDER BY tp.recorded_at
    `;

    var rows = (await db.query(sql, params)).rows;
    var points = rows.map(function (r) { return { lat: parseFloat(r.lat), lng: parseFloat(r.lng) }; });

    // Compute coverage
    var covGeoJSON = coverage.computeCoverage(points, cellSize);

    // Stats
    var stats = {
      total_points: points.length,
      unique_cells: covGeoJSON.features.length,
    };

    // Coverage percentage (only if site has boundary)
    if (site.boundary_geojson) {
      stats.coverage_percentage = Math.round(
        coverage.computePercentage(covGeoJSON, site.boundary_geojson, cellSize) * 10
      ) / 10;
    }

    // Last hunted date
    var lastHuntedSql = `
      SELECT MAX(ended_at) AS last_hunted
      FROM hunt_sessions
      WHERE site_id = $1 AND user_id = $2 AND status = 'completed'
    `;
    var lastRow = await db.queryOne(lastHuntedSql, [site.id, req.user.id]);
    if (lastRow && lastRow.last_hunted) {
      stats.last_hunted = lastRow.last_hunted;
    }

    res.json({
      success: true,
      data: {
        coverage: covGeoJSON,
        stats: stats,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sites -- create
// ---------------------------------------------------------------------------
router.post('/', denyDemoUser, idempotent, upload.single('image'), validate(schemas.createSite), async (req, res) => {
  try {
    const b = req.body;

    let imagePath = null;
    if (req.file) {
      const s3Key = s3.generateKey('sites', req.file.originalname);
      await s3.uploadToS3(req.file.buffer, s3Key, req.file.mimetype);
      imagePath = s3Key;
    }

    const result = await db.query(`
      INSERT INTO sites (
        user_id, name, description, latitude, longitude, boundary_geojson,
        image_path, land_type, permission_status,
        permission_contact_name, permission_contact_phone, permission_contact_email,
        legal_notes, site_status, priority, notes, tags, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15, $16, $17, NOW(), NOW()
      )
      RETURNING id
    `, [
      req.user.id,
      b.name,
      b.description || null,
      b.latitude || null,
      b.longitude || null,
      b.boundary_geojson || null,
      imagePath,
      b.land_type || null,
      b.permission_status || null,
      b.contact_name || b.permission_contact_name || null,
      b.contact_phone || b.permission_contact_phone || null,
      b.contact_email || b.permission_contact_email || null,
      b.legal_notes || null,
      b.status || b.site_status || null,
      b.priority || null,
      b.notes || null,
      b.tags || null
    ]);

    const newSite = await db.queryOne('SELECT * FROM sites WHERE id = $1', [result.rows[0].id]);

    db.logAuditEvent({
      userId: req.user.id,
      action: 'site.create',
      entityType: 'site',
      entityId: newSite.id,
      details: { name: newSite.name },
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      data: mapSiteRow(newSite),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/sites/:id -- update (with optional image replacement)
// ---------------------------------------------------------------------------
router.put('/:id', denyDemoUser, idempotent, upload.single('image'), validate(schemas.updateSite), async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM sites WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    if (!(await canEditSite(req.user, existing))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const b = req.body;

    let imagePath = existing.image_path;
    if (req.file) {
      // Delete old image from S3 if it exists
      if (existing.image_path) {
        await s3.deleteFromS3(existing.image_path);
      }
      // Upload new image to S3
      const s3Key = s3.generateKey('sites', req.file.originalname);
      await s3.uploadToS3(req.file.buffer, s3Key, req.file.mimetype);
      imagePath = s3Key;
    }

    await db.query(`
      UPDATE sites SET
        name = $1,
        description = $2,
        latitude = $3,
        longitude = $4,
        boundary_geojson = $5,
        image_path = $6,
        land_type = $7,
        permission_status = $8,
        permission_contact_name = $9,
        permission_contact_phone = $10,
        permission_contact_email = $11,
        legal_notes = $12,
        site_status = $13,
        priority = $14,
        notes = $15,
        tags = $16,
        updated_at = NOW()
      WHERE id = $17
    `, [
      b.name ?? existing.name,
      b.description ?? existing.description,
      b.latitude ?? existing.latitude,
      b.longitude ?? existing.longitude,
      b.boundary_geojson ?? existing.boundary_geojson,
      imagePath,
      b.land_type ?? existing.land_type,
      b.permission_status ?? existing.permission_status,
      (b.contact_name || b.permission_contact_name) ?? existing.permission_contact_name,
      (b.contact_phone || b.permission_contact_phone) ?? existing.permission_contact_phone,
      (b.contact_email || b.permission_contact_email) ?? existing.permission_contact_email,
      b.legal_notes ?? existing.legal_notes,
      (b.status || b.site_status) ?? existing.site_status,
      b.priority ?? existing.priority,
      b.notes ?? existing.notes,
      b.tags ?? existing.tags,
      req.params.id
    ]);

    const updated = await db.queryOne('SELECT * FROM sites WHERE id = $1', [req.params.id]);

    db.logAuditEvent({
      userId: req.user.id,
      action: 'site.update',
      entityType: 'site',
      entityId: Number(req.params.id),
      details: { name: updated.name },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: mapSiteRow(updated),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/sites/:id -- delete site and its image from S3
// ---------------------------------------------------------------------------
router.delete('/:id', denyDemoUser, async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM sites WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    // Only admins and owners may delete a site
    if (req.user.role !== 'admin' && existing.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (existing.image_path) {
      await s3.deleteFromS3(existing.image_path);
    }

    await db.query('DELETE FROM sites WHERE id = $1', [req.params.id]);

    // Audit log: site deletion
    db.logAuditEvent({
      userId: req.user.id,
      action: 'site_delete',
      entityType: 'site',
      entityId: Number(req.params.id),
      details: { name: existing.name },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { id: Number(req.params.id) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sites/:id/share -- share a site with another user by email
// ---------------------------------------------------------------------------
router.post('/:id/share', denyDemoUser, async (req, res) => {
  try {
    const site = await db.queryOne('SELECT * FROM sites WHERE id = $1', [req.params.id]);
    if (!site) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    // Only admins and owners may share
    if (req.user.role !== 'admin' && site.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { email, permission_level } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const targetUser = await db.queryOne(
      'SELECT id, email, display_name FROM users WHERE email = $1',
      [email]
    );
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (targetUser.id === site.user_id) {
      return res.status(400).json({ success: false, error: 'Cannot share a site with its owner' });
    }

    // Upsert: update permission_level if share already exists
    const existingShare = await db.queryOne(
      'SELECT id FROM site_shares WHERE site_id = $1 AND shared_with_id = $2',
      [site.id, targetUser.id]
    );

    if (existingShare) {
      await db.query(
        'UPDATE site_shares SET permission_level = $1 WHERE id = $2',
        [permission_level || 'view', existingShare.id]
      );
    } else {
      await db.query(`
        INSERT INTO site_shares (site_id, owner_id, shared_with_id, permission_level, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [site.id, site.user_id, targetUser.id, permission_level || 'view']);
    }

    // Audit log: share creation/update
    db.logAuditEvent({
      userId: req.user.id,
      action: existingShare ? 'share_update' : 'share_create',
      entityType: 'site',
      entityId: site.id,
      details: { shared_with_email: targetUser.email, permission_level: permission_level || 'view' },
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      data: {
        site_id: site.id,
        shared_with: { id: targetUser.id, email: targetUser.email, display_name: targetUser.display_name },
        permission_level: permission_level || 'view',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sites/:id/shares -- list shares for a site (owner or admin only)
// ---------------------------------------------------------------------------
router.get('/:id/shares', async (req, res) => {
  try {
    const site = await db.queryOne('SELECT * FROM sites WHERE id = $1', [req.params.id]);
    if (!site) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    if (req.user.role !== 'admin' && site.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const shares = (await db.query(`
      SELECT ss.id, ss.permission_level, ss.created_at,
             u.id AS user_id, u.email, u.display_name
      FROM site_shares ss
      JOIN users u ON ss.shared_with_id = u.id
      WHERE ss.site_id = $1
      ORDER BY ss.created_at DESC
    `, [site.id])).rows;

    res.json({ success: true, data: shares, count: shares.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/sites/:id/share/:userId -- remove a share (owner or admin only)
// ---------------------------------------------------------------------------
router.delete('/:id/share/:userId', denyDemoUser, async (req, res) => {
  try {
    const site = await db.queryOne('SELECT * FROM sites WHERE id = $1', [req.params.id]);
    if (!site) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    if (req.user.role !== 'admin' && site.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const result = await db.query(
      'DELETE FROM site_shares WHERE site_id = $1 AND shared_with_id = $2',
      [site.id, req.params.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Share not found' });
    }

    // Audit log: share removal
    db.logAuditEvent({
      userId: req.user.id,
      action: 'share_remove',
      entityType: 'site',
      entityId: site.id,
      details: { removed_user_id: Number(req.params.userId) },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { site_id: site.id, removed_user_id: Number(req.params.userId) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
