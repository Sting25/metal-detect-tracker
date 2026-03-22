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
// Multer setup -- validated image uploads to ../uploads/finds/
// ---------------------------------------------------------------------------
const upload = createUpload('finds');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a WHERE clause that scopes finds to the current user.
 * Everyone sees own finds + finds on shared sites. Admin global view is in admin panel.
 * Returns { where, params, nextIdx } where nextIdx is the next $N placeholder index.
 */
function findScopeSQL(user, startIdx) {
  const i = startIdx || 1;
  return {
    where: ` AND (f.user_id = $${i} OR f.site_id IN (SELECT id FROM sites WHERE user_id = $${i + 1}) OR f.site_id IN (SELECT site_id FROM site_shares WHERE shared_with_id = $${i + 2}))`,
    params: [user.id, user.id, user.id],
    nextIdx: i + 3,
  };
}

/**
 * Check whether `user` may access a find record.
 */
async function canAccessFind(user, find) {
  if (user.role === 'admin') return true;
  if (find.user_id === user.id) return true;
  // Site owner can always see finds on their sites
  if (find.site_id) {
    const ownedSite = await db.queryOne(
      'SELECT 1 FROM sites WHERE id = $1 AND user_id = $2',
      [find.site_id, user.id]
    );
    if (ownedSite) return true;
  }
  const share = await db.queryOne(
    'SELECT 1 FROM site_shares WHERE site_id = $1 AND shared_with_id = $2',
    [find.site_id, user.id]
  );
  return !!share;
}

/**
 * Check whether `user` may edit a find record. Only admin or the find owner.
 */
function canEditFind(user, find) {
  if (user.role === 'admin') return true;
  return find.user_id === user.id;
}

function mapFindRow(r, photos) {
  const photoList = photos || [];
  return {
    ...r,
    photo_url: photoList.length > 0
      ? photoList[0].photo_url
      : (r.photo_path ? '/api/uploads/' + r.photo_path : null),
    photos: photoList,
    date: r.date_found,
    depth_cm: r.depth_cm,
    depth_inches: r.depth_cm != null ? +(r.depth_cm / 2.54).toFixed(1) : (r.depth_inches || null),
    depth: r.depth_cm != null ? r.depth_cm : r.depth_inches,
  };
}

async function getPhotosForFind(findId) {
  const result = await db.query(
    'SELECT id, photo_path, sort_order, caption, created_at FROM find_photos WHERE find_id = $1 ORDER BY sort_order, id',
    [findId]
  );
  return result.rows.map(function (p) {
    return {
      id: p.id,
      photo_url: '/api/uploads/' + p.photo_path,
      sort_order: p.sort_order,
      caption: p.caption,
      created_at: p.created_at,
    };
  });
}

async function getPhotosForFinds(findIds) {
  if (!findIds.length) return {};
  const result = await db.query(
    'SELECT id, find_id, photo_path, sort_order, caption FROM find_photos WHERE find_id = ANY($1) ORDER BY sort_order, id',
    [findIds]
  );
  const map = {};
  for (let i = 0; i < result.rows.length; i++) {
    const p = result.rows[i];
    if (!map[p.find_id]) map[p.find_id] = [];
    map[p.find_id].push({
      id: p.id,
      photo_url: '/api/uploads/' + p.photo_path,
      sort_order: p.sort_order,
      caption: p.caption,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// GET /api/finds -- list all finds with optional filters, includes site name
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { site_id, material, date_from, date_to } = req.query;
    const scope = findScopeSQL(req.user, 1);

    let sql = `
      SELECT f.*, s.name AS site_name
      FROM finds f
      LEFT JOIN sites s ON f.site_id = s.id
      WHERE 1=1
    ` + scope.where;
    const params = [...scope.params];
    let idx = scope.nextIdx;

    if (site_id) {
      sql += ` AND f.site_id = $${idx++}`;
      params.push(site_id);
    }
    if (material) {
      sql += ` AND f.material = $${idx++}`;
      params.push(material);
    }
    if (date_from) {
      sql += ` AND f.date_found >= $${idx++}`;
      params.push(date_from);
    }
    if (date_to) {
      sql += ` AND f.date_found <= $${idx++}`;
      params.push(date_to);
    }
    if (req.query.category) {
      sql += ` AND f.category = $${idx++}`;
      params.push(req.query.category);
    }
    if (req.query.tag) {
      sql += ` AND (',' || f.tags || ',' LIKE '%,' || $${idx++} || ',%')`;
      params.push(req.query.tag);
    }

    sql += ' ORDER BY f.date_found DESC';

    const result = await db.query(sql, params);
    const findIds = result.rows.map(function (r) { return r.id; });
    const photosMap = await getPhotosForFinds(findIds);
    const data = result.rows.map(function (r) { return mapFindRow(r, photosMap[r.id] || []); });

    res.json({ success: true, data, count: data.length });
  } catch (err) {
    console.error('GET /api/finds error:', err);
    res.status(500).json({ success: false, error: 'Failed to load finds' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finds/tags -- unique tags for autocomplete
// ---------------------------------------------------------------------------
router.get('/tags', async (req, res) => {
  try {
    const result = await db.query(
      "SELECT DISTINCT unnest(string_to_array(tags, ',')) AS tag FROM finds WHERE user_id = $1 AND tags IS NOT NULL AND tags != ''",
      [req.user.id]
    );
    const tags = result.rows.map(r => r.tag.trim()).filter(Boolean).sort();
    res.json({ success: true, data: tags });
  } catch (err) {
    console.error('GET /api/finds/tags error:', err);
    res.status(500).json({ success: false, error: 'Failed to load tags' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finds/stats -- totals, counts by material, total value
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  try {
    const scope = findScopeSQL(req.user, 1);
    // Build a FROM clause with alias f so the scope SQL referencing f.user_id works
    const fromClause = ' FROM finds f';
    const whereClause = scope.where ? ' WHERE 1=1' + scope.where : '';

    const totalRow = await db.queryOne(
      'SELECT COUNT(*)::int AS cnt' + fromClause + whereClause,
      scope.params
    );
    const total = totalRow.cnt;

    const byMaterialResult = await db.query(
      'SELECT f.material, COUNT(*)::int AS cnt' + fromClause + whereClause + ' GROUP BY f.material',
      scope.params
    );
    const byMaterial = byMaterialResult.rows;

    const byCategoryResult = await db.query(
      'SELECT f.category, COUNT(*)::int AS cnt' + fromClause + whereClause + ' GROUP BY f.category',
      scope.params
    );
    const byCategory = byCategoryResult.rows;

    const totalValueRow = await db.queryOne(
      'SELECT COALESCE(SUM(f.value_estimate), 0) AS total' + fromClause + whereClause,
      scope.params
    );
    const totalValue = totalValueRow.total;

    res.json({
      success: true,
      data: {
        total,
        by_material: byMaterial,
        by_category: byCategory,
        total_value: totalValue,
      },
    });
  } catch (err) {
    console.error('GET /api/finds/stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to load find stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finds/:id -- single find with site name
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT f.*, s.name AS site_name
       FROM finds f
       LEFT JOIN sites s ON f.site_id = s.id
       WHERE f.id = $1`,
      [req.params.id]
    );

    if (!row) {
      return res.status(404).json({ success: false, error: 'Find not found' });
    }

    if (!(await canAccessFind(req.user, row))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const photos = await getPhotosForFind(row.id);
    res.json({
      success: true,
      data: mapFindRow(row, photos),
    });
  } catch (err) {
    console.error('GET /api/finds/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to load find' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/finds -- create with multer photo upload
// ---------------------------------------------------------------------------
router.post('/', denyDemoUser, idempotent, upload.array('photos', 10), validate(schemas.createFind), async (req, res) => {
  try {
    const b = req.body;

    // Handle depth: prefer depth_cm, convert depth_inches if provided
    let depthCm = b.depth_cm || null;
    let depthInches = b.depth || b.depth_inches || null;
    if (!depthCm && depthInches) {
      depthCm = +(parseFloat(depthInches) * 2.54).toFixed(1);
    }

    // Auto-attach to active hunt session (unless explicitly overridden)
    let huntSessionId = b.hunt_session_id !== undefined ? b.hunt_session_id : undefined;
    if (huntSessionId === undefined) {
      const activeHunt = await db.queryOne(
        "SELECT id FROM hunt_sessions WHERE user_id = $1 AND status = 'active'",
        [req.user.id]
      );
      huntSessionId = activeHunt ? activeHunt.id : null;
    }

    const result = await db.query(
      `INSERT INTO finds (
        user_id, site_id, date_found, latitude, longitude, photo_path,
        description, material, estimated_age, depth_inches, depth_cm,
        condition, value_estimate, notes, category, tags,
        hunt_session_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, NOW(), NOW()
      ) RETURNING id`,
      [
        req.user.id,
        b.site_id || null,
        b.date || b.date_found || null,
        b.latitude || null,
        b.longitude || null,
        null,
        b.description || null,
        b.material || null,
        b.estimated_age || null,
        depthInches,
        depthCm,
        b.condition || null,
        b.value_estimate || null,
        b.notes || null,
        b.category || null,
        b.tags || null,
        huntSessionId || null,
      ]
    );

    const newId = result.rows[0].id;

    // Upload photos to S3 and insert into find_photos
    const files = req.files || [];
    let firstPhotoPath = null;
    for (let fi = 0; fi < files.length; fi++) {
      const s3Key = s3.generateKey('finds', files[fi].originalname);
      await s3.uploadToS3(files[fi].buffer, s3Key, files[fi].mimetype);
      await db.query(
        'INSERT INTO find_photos (find_id, photo_path, sort_order) VALUES ($1, $2, $3)',
        [newId, s3Key, fi]
      );
      if (fi === 0) firstPhotoPath = s3Key;
    }

    // Sync finds.photo_path to first photo for backward compat
    if (firstPhotoPath) {
      await db.query('UPDATE finds SET photo_path = $1 WHERE id = $2', [firstPhotoPath, newId]);
    }

    const newFind = await db.queryOne(
      `SELECT f.*, s.name AS site_name
       FROM finds f
       LEFT JOIN sites s ON f.site_id = s.id
       WHERE f.id = $1`,
      [newId]
    );

    const photos = await getPhotosForFind(newId);

    db.logAuditEvent({
      userId: req.user.id,
      action: 'find.create',
      entityType: 'find',
      entityId: newFind.id,
      details: { material: newFind.material, date_found: newFind.date_found },
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      data: mapFindRow(newFind, photos),
    });
  } catch (err) {
    console.error('POST /api/finds error:', err);
    res.status(500).json({ success: false, error: 'Failed to create find' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/finds/:id -- update with optional photo replacement
// ---------------------------------------------------------------------------
router.put('/:id', denyDemoUser, idempotent, upload.array('photos', 10), validate(schemas.updateFind), async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM finds WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Find not found' });
    }

    if (!canEditFind(req.user, existing)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const b = req.body;

    // Handle depth: prefer depth_cm, convert depth_inches if provided
    let depthCm = b.depth_cm ?? existing.depth_cm;
    let depthInches = (b.depth || b.depth_inches) ?? existing.depth_inches;
    if (b.depth_cm !== undefined) {
      depthCm = b.depth_cm;
      depthInches = b.depth_cm != null ? +(parseFloat(b.depth_cm) / 2.54).toFixed(1) : existing.depth_inches;
    } else if (b.depth !== undefined || b.depth_inches !== undefined) {
      const rawInches = b.depth || b.depth_inches;
      depthInches = rawInches;
      depthCm = rawInches != null ? +(parseFloat(rawInches) * 2.54).toFixed(1) : existing.depth_cm;
    }

    // Append new photos to gallery
    const files = req.files || [];
    if (files.length > 0) {
      const maxRow = await db.queryOne(
        'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM find_photos WHERE find_id = $1',
        [req.params.id]
      );
      let sortOrder = (maxRow.max_order || 0) + 1;

      for (let fi = 0; fi < files.length; fi++) {
        const s3Key = s3.generateKey('finds', files[fi].originalname);
        await s3.uploadToS3(files[fi].buffer, s3Key, files[fi].mimetype);
        await db.query(
          'INSERT INTO find_photos (find_id, photo_path, sort_order) VALUES ($1, $2, $3)',
          [req.params.id, s3Key, sortOrder++]
        );
      }
    }

    // Sync finds.photo_path with first photo
    const firstPhoto = await db.queryOne(
      'SELECT photo_path FROM find_photos WHERE find_id = $1 ORDER BY sort_order LIMIT 1',
      [req.params.id]
    );

    await db.query(
      `UPDATE finds SET
        site_id = $1,
        date_found = $2,
        latitude = $3,
        longitude = $4,
        photo_path = $5,
        description = $6,
        material = $7,
        estimated_age = $8,
        depth_inches = $9,
        depth_cm = $10,
        condition = $11,
        value_estimate = $12,
        notes = $13,
        category = $14,
        tags = $15,
        updated_at = NOW()
      WHERE id = $16`,
      [
        b.site_id ?? existing.site_id,
        (b.date || b.date_found) ?? existing.date_found,
        b.latitude ?? existing.latitude,
        b.longitude ?? existing.longitude,
        firstPhoto ? firstPhoto.photo_path : existing.photo_path,
        b.description ?? existing.description,
        b.material ?? existing.material,
        b.estimated_age ?? existing.estimated_age,
        depthInches,
        depthCm,
        b.condition ?? existing.condition,
        b.value_estimate ?? existing.value_estimate,
        b.notes ?? existing.notes,
        b.category ?? existing.category,
        b.tags ?? existing.tags,
        req.params.id,
      ]
    );

    const updated = await db.queryOne(
      `SELECT f.*, s.name AS site_name
       FROM finds f
       LEFT JOIN sites s ON f.site_id = s.id
       WHERE f.id = $1`,
      [req.params.id]
    );

    const updatedPhotos = await getPhotosForFind(Number(req.params.id));

    db.logAuditEvent({
      userId: req.user.id,
      action: 'find.update',
      entityType: 'find',
      entityId: Number(req.params.id),
      details: { material: updated.material },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: mapFindRow(updated, updatedPhotos),
    });
  } catch (err) {
    console.error('PUT /api/finds/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to update find' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/finds/:id -- delete find, photos from S3, and DB record
// ---------------------------------------------------------------------------
router.delete('/:id', denyDemoUser, async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT * FROM finds WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Find not found' });
    }

    if (!canEditFind(req.user, existing)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Delete all photos from S3
    const photoRows = await db.query('SELECT photo_path FROM find_photos WHERE find_id = $1', [req.params.id]);
    for (let pi = 0; pi < photoRows.rows.length; pi++) {
      await s3.deleteFromS3(photoRows.rows[pi].photo_path);
    }
    // Also delete legacy photo_path if it exists and wasn't in find_photos
    if (existing.photo_path) {
      await s3.deleteFromS3(existing.photo_path);
    }

    await db.query('DELETE FROM finds WHERE id = $1', [req.params.id]);

    db.logAuditEvent({
      userId: req.user.id,
      action: 'find_delete',
      entityType: 'find',
      entityId: Number(req.params.id),
      details: { description: existing.description, site_id: existing.site_id },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { id: Number(req.params.id) } });
  } catch (err) {
    console.error('DELETE /api/finds/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete find' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/finds/:id/photos/:photoId -- delete single photo
// ---------------------------------------------------------------------------
router.delete('/:id/photos/:photoId', denyDemoUser, async (req, res) => {
  try {
    const find = await db.queryOne('SELECT * FROM finds WHERE id = $1', [req.params.id]);
    if (!find) return res.status(404).json({ success: false, error: 'Find not found' });
    if (!canEditFind(req.user, find)) return res.status(403).json({ success: false, error: 'Access denied' });

    const photo = await db.queryOne(
      'SELECT * FROM find_photos WHERE id = $1 AND find_id = $2',
      [req.params.photoId, req.params.id]
    );
    if (!photo) return res.status(404).json({ success: false, error: 'Photo not found' });

    await s3.deleteFromS3(photo.photo_path);
    await db.query('DELETE FROM find_photos WHERE id = $1', [req.params.photoId]);

    // Update finds.photo_path to first remaining photo
    const firstRemaining = await db.queryOne(
      'SELECT photo_path FROM find_photos WHERE find_id = $1 ORDER BY sort_order LIMIT 1',
      [req.params.id]
    );
    await db.query('UPDATE finds SET photo_path = $1 WHERE id = $2',
      [firstRemaining ? firstRemaining.photo_path : null, req.params.id]);

    db.logAuditEvent({
      userId: req.user.id,
      action: 'find.photo_delete',
      entityType: 'find',
      entityId: Number(req.params.id),
      details: { photo_id: Number(req.params.photoId) },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { id: Number(req.params.photoId) } });
  } catch (err) {
    console.error('DELETE /api/finds/:id/photos/:photoId error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete photo' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/finds/:id/photos/reorder -- reorder photos
// ---------------------------------------------------------------------------
router.put('/:id/photos/reorder', denyDemoUser, async (req, res) => {
  try {
    const find = await db.queryOne('SELECT * FROM finds WHERE id = $1', [req.params.id]);
    if (!find) return res.status(404).json({ success: false, error: 'Find not found' });
    if (!canEditFind(req.user, find)) return res.status(403).json({ success: false, error: 'Access denied' });

    const photoIds = req.body.photo_ids;
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ success: false, error: 'photo_ids array required' });
    }

    // Verify all photo_ids belong to this find
    const existingPhotos = await db.query(
      'SELECT id FROM find_photos WHERE find_id = $1',
      [req.params.id]
    );
    const existingIdSet = new Set(existingPhotos.rows.map(function (r) { return r.id; }));
    for (let ri = 0; ri < photoIds.length; ri++) {
      if (!existingIdSet.has(photoIds[ri])) {
        return res.status(400).json({ success: false, error: 'Photo ID ' + photoIds[ri] + ' does not belong to this find' });
      }
    }

    for (let oi = 0; oi < photoIds.length; oi++) {
      await db.query(
        'UPDATE find_photos SET sort_order = $1 WHERE id = $2 AND find_id = $3',
        [oi, photoIds[oi], req.params.id]
      );
    }

    // Sync finds.photo_path to first in new order
    const firstReordered = await db.queryOne(
      'SELECT photo_path FROM find_photos WHERE find_id = $1 ORDER BY sort_order LIMIT 1',
      [req.params.id]
    );
    if (firstReordered) {
      await db.query('UPDATE finds SET photo_path = $1 WHERE id = $2',
        [firstReordered.photo_path, req.params.id]);
    }

    const reorderedPhotos = await getPhotosForFind(Number(req.params.id));
    res.json({ success: true, data: reorderedPhotos });
  } catch (err) {
    console.error('PUT /api/finds/:id/photos/reorder error:', err);
    res.status(500).json({ success: false, error: 'Failed to reorder photos' });
  }
});

module.exports = router;
