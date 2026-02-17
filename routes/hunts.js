var express = require('express');
var router = express.Router();
var { verifyToken, denyDemoUser } = require('../middleware/auth');
var { validate, schemas } = require('../middleware/validate');
var idempotent = require('../middleware/idempotency');
var db = require('../database');

// All routes require authentication
router.use(verifyToken);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Haversine distance between two points in meters.
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute total distance in meters from an array of trackpoints
 * ordered by recorded_at. Points must have lat, lng properties.
 */
function computeDistance(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) {
        total += haversineMeters(
            points[i - 1].lat, points[i - 1].lng,
            points[i].lat, points[i].lng
        );
    }
    return Math.round(total * 100) / 100; // 2 decimal places
}

/**
 * Compute total duration in seconds from completed segments.
 * Each segment has started_at and ended_at timestamps.
 */
function computeDuration(segments) {
    var total = 0;
    for (var i = 0; i < segments.length; i++) {
        if (segments[i].started_at && segments[i].ended_at) {
            var start = new Date(segments[i].started_at).getTime();
            var end = new Date(segments[i].ended_at).getTime();
            total += Math.max(0, Math.floor((end - start) / 1000));
        }
    }
    return total;
}

// ---------------------------------------------------------------------------
// GET /api/hunts — List user's hunt sessions
// ---------------------------------------------------------------------------
router.get('/', async function (req, res) {
    try {
        var userId = req.user.id;
        var page = Math.max(1, parseInt(req.query.page) || 1);
        var limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        var offset = (page - 1) * limit;

        // Build WHERE clauses
        var conditions = ['hs.user_id = $1'];
        var params = [userId];
        var paramIdx = 2;

        if (req.query.status) {
            conditions.push('hs.status = $' + paramIdx);
            params.push(req.query.status);
            paramIdx++;
        }
        if (req.query.site_id) {
            conditions.push('hs.site_id = $' + paramIdx);
            params.push(parseInt(req.query.site_id));
            paramIdx++;
        }
        if (req.query.from) {
            conditions.push('hs.started_at >= $' + paramIdx);
            params.push(req.query.from);
            paramIdx++;
        }
        if (req.query.to) {
            conditions.push('hs.started_at <= $' + paramIdx);
            params.push(req.query.to);
            paramIdx++;
        }

        var where = conditions.join(' AND ');

        // Count total
        var countResult = await db.query(
            'SELECT COUNT(*) AS total FROM hunt_sessions hs WHERE ' + where,
            params
        );
        var total = parseInt(countResult.rows[0].total);

        // Get sessions with site name and find count
        var dataParams = params.concat([limit, offset]);
        var rows = (await db.query(
            'SELECT hs.*, s.name AS site_name, ' +
            '(SELECT COUNT(*) FROM finds f WHERE f.hunt_session_id = hs.id) AS find_count ' +
            'FROM hunt_sessions hs ' +
            'LEFT JOIN sites s ON hs.site_id = s.id ' +
            'WHERE ' + where + ' ' +
            'ORDER BY hs.started_at DESC ' +
            'LIMIT $' + paramIdx + ' OFFSET $' + (paramIdx + 1),
            dataParams
        )).rows;

        res.json({
            success: true,
            data: rows,
            pagination: {
                page: page,
                limit: limit,
                total: total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/hunts/:id — Session detail
// ---------------------------------------------------------------------------
router.get('/:id', async function (req, res) {
    try {
        var session = await db.queryOne(
            'SELECT hs.*, s.name AS site_name ' +
            'FROM hunt_sessions hs ' +
            'LEFT JOIN sites s ON hs.site_id = s.id ' +
            'WHERE hs.id = $1 AND hs.user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!session) {
            return res.status(404).json({ success: false, error: 'Hunt session not found' });
        }

        // Get segments
        var segments = (await db.query(
            'SELECT * FROM track_segments WHERE session_id = $1 ORDER BY segment_number',
            [session.id]
        )).rows;

        // Get find count and IDs
        var finds = (await db.query(
            'SELECT id, description, date_found FROM finds WHERE hunt_session_id = $1 ORDER BY date_found',
            [session.id]
        )).rows;

        session.segments = segments;
        session.finds = finds;
        session.find_count = finds.length;

        res.json({ success: true, data: session });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/hunts — Start new session
// ---------------------------------------------------------------------------
router.post('/', denyDemoUser, idempotent, validate(schemas.startHunt), async function (req, res) {
    try {
        var userId = req.user.id;

        // Check no other active/paused session exists
        var existing = await db.queryOne(
            "SELECT id FROM hunt_sessions WHERE user_id = $1 AND status IN ('active', 'paused')",
            [userId]
        );
        if (existing) {
            return res.status(409).json({
                success: false,
                error: 'You already have an active or paused hunt session. End it before starting a new one.',
            });
        }

        // Validate site_id belongs to user (if provided)
        if (req.body.site_id) {
            var site = await db.queryOne(
                'SELECT id FROM sites WHERE id = $1 AND user_id = $2',
                [req.body.site_id, userId]
            );
            if (!site) {
                return res.status(400).json({ success: false, error: 'Site not found' });
            }
        }

        // Create session
        var sessionResult = await db.query(
            "INSERT INTO hunt_sessions (user_id, site_id, status, notes) VALUES ($1, $2, 'active', $3) RETURNING id",
            [userId, req.body.site_id || null, req.body.notes || null]
        );
        var sessionId = sessionResult.rows[0].id;

        // Create first segment
        var segmentResult = await db.query(
            'INSERT INTO track_segments (session_id, segment_number) VALUES ($1, 1) RETURNING id',
            [sessionId]
        );

        var session = await db.queryOne(
            'SELECT hs.*, s.name AS site_name FROM hunt_sessions hs LEFT JOIN sites s ON hs.site_id = s.id WHERE hs.id = $1',
            [sessionId]
        );
        session.current_segment_id = segmentResult.rows[0].id;

        db.logAuditEvent({
            userId: userId,
            action: 'hunt.start',
            entityType: 'hunt_session',
            entityId: sessionId,
            details: { site_id: req.body.site_id || null },
            ipAddress: req.ip,
        });

        res.status(201).json({ success: true, data: session });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/hunts/:id/pause — Pause active session
// ---------------------------------------------------------------------------
router.post('/:id/pause', denyDemoUser, async function (req, res) {
    try {
        var session = await db.queryOne(
            'SELECT * FROM hunt_sessions WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!session) {
            return res.status(404).json({ success: false, error: 'Hunt session not found' });
        }
        if (session.status !== 'active') {
            return res.status(400).json({ success: false, error: 'Session is not active' });
        }

        // Close current open segment
        await db.query(
            'UPDATE track_segments SET ended_at = NOW() WHERE session_id = $1 AND ended_at IS NULL',
            [session.id]
        );

        // Compute duration from all completed segments
        var segments = (await db.query(
            'SELECT started_at, ended_at FROM track_segments WHERE session_id = $1',
            [session.id]
        )).rows;
        var duration = computeDuration(segments);

        // Update session
        await db.query(
            "UPDATE hunt_sessions SET status = 'paused', duration_seconds = $1 WHERE id = $2",
            [duration, session.id]
        );

        var updated = await db.queryOne(
            'SELECT hs.*, s.name AS site_name FROM hunt_sessions hs LEFT JOIN sites s ON hs.site_id = s.id WHERE hs.id = $1',
            [session.id]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'hunt.pause',
            entityType: 'hunt_session',
            entityId: session.id,
            ipAddress: req.ip,
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/hunts/:id/resume — Resume paused session
// ---------------------------------------------------------------------------
router.post('/:id/resume', denyDemoUser, async function (req, res) {
    try {
        var session = await db.queryOne(
            'SELECT * FROM hunt_sessions WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!session) {
            return res.status(404).json({ success: false, error: 'Hunt session not found' });
        }
        if (session.status !== 'paused') {
            return res.status(400).json({ success: false, error: 'Session is not paused' });
        }

        // Get next segment number
        var maxSeg = await db.queryOne(
            'SELECT MAX(segment_number) AS max_num FROM track_segments WHERE session_id = $1',
            [session.id]
        );
        var nextSegNum = (maxSeg && maxSeg.max_num ? maxSeg.max_num : 0) + 1;

        // Create new segment
        var segmentResult = await db.query(
            'INSERT INTO track_segments (session_id, segment_number) VALUES ($1, $2) RETURNING id',
            [session.id, nextSegNum]
        );

        // Update session status
        await db.query(
            "UPDATE hunt_sessions SET status = 'active' WHERE id = $1",
            [session.id]
        );

        var updated = await db.queryOne(
            'SELECT hs.*, s.name AS site_name FROM hunt_sessions hs LEFT JOIN sites s ON hs.site_id = s.id WHERE hs.id = $1',
            [session.id]
        );
        updated.current_segment_id = segmentResult.rows[0].id;

        db.logAuditEvent({
            userId: req.user.id,
            action: 'hunt.resume',
            entityType: 'hunt_session',
            entityId: session.id,
            ipAddress: req.ip,
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/hunts/:id/end — End session
// ---------------------------------------------------------------------------
router.post('/:id/end', denyDemoUser, async function (req, res) {
    try {
        var session = await db.queryOne(
            'SELECT * FROM hunt_sessions WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!session) {
            return res.status(404).json({ success: false, error: 'Hunt session not found' });
        }
        if (session.status === 'completed') {
            return res.status(400).json({ success: false, error: 'Session is already completed' });
        }

        // Close current open segment
        await db.query(
            'UPDATE track_segments SET ended_at = NOW() WHERE session_id = $1 AND ended_at IS NULL',
            [session.id]
        );

        // Compute final duration from all segments
        var segments = (await db.query(
            'SELECT started_at, ended_at FROM track_segments WHERE session_id = $1',
            [session.id]
        )).rows;
        var duration = computeDuration(segments);

        // Compute total distance from all trackpoints (ordered)
        var allPoints = (await db.query(
            'SELECT tp.lat, tp.lng FROM track_points tp ' +
            'JOIN track_segments ts ON tp.segment_id = ts.id ' +
            'WHERE ts.session_id = $1 ORDER BY tp.recorded_at',
            [session.id]
        )).rows;
        var distance = computeDistance(allPoints);

        // Count trackpoints
        var countResult = await db.queryOne(
            'SELECT COUNT(*) AS cnt FROM track_points tp ' +
            'JOIN track_segments ts ON tp.segment_id = ts.id ' +
            'WHERE ts.session_id = $1',
            [session.id]
        );
        var trackpointCount = parseInt(countResult.cnt);

        // Update session
        await db.query(
            "UPDATE hunt_sessions SET status = 'completed', ended_at = NOW(), duration_seconds = $1, distance_meters = $2, trackpoint_count = $3 WHERE id = $4",
            [duration, distance, trackpointCount, session.id]
        );

        var updated = await db.queryOne(
            'SELECT hs.*, s.name AS site_name FROM hunt_sessions hs LEFT JOIN sites s ON hs.site_id = s.id WHERE hs.id = $1',
            [session.id]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'hunt.end',
            entityType: 'hunt_session',
            entityId: session.id,
            details: { duration_seconds: duration, distance_meters: distance, trackpoint_count: trackpointCount },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// PUT /api/hunts/:id — Update session (notes, site_id)
// ---------------------------------------------------------------------------
router.put('/:id', denyDemoUser, idempotent, validate(schemas.updateHunt), async function (req, res) {
    try {
        var session = await db.queryOne(
            'SELECT * FROM hunt_sessions WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!session) {
            return res.status(404).json({ success: false, error: 'Hunt session not found' });
        }

        // Validate site_id if provided
        if (req.body.site_id) {
            var site = await db.queryOne(
                'SELECT id FROM sites WHERE id = $1 AND user_id = $2',
                [req.body.site_id, req.user.id]
            );
            if (!site) {
                return res.status(400).json({ success: false, error: 'Site not found' });
            }
        }

        var fields = [];
        var params = [];
        var idx = 1;

        if (req.body.notes !== undefined) {
            fields.push('notes = $' + idx);
            params.push(req.body.notes);
            idx++;
        }
        if (req.body.site_id !== undefined) {
            fields.push('site_id = $' + idx);
            params.push(req.body.site_id);
            idx++;
        }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        params.push(session.id);
        await db.query(
            'UPDATE hunt_sessions SET ' + fields.join(', ') + ' WHERE id = $' + idx,
            params
        );

        var updated = await db.queryOne(
            'SELECT hs.*, s.name AS site_name FROM hunt_sessions hs LEFT JOIN sites s ON hs.site_id = s.id WHERE hs.id = $1',
            [session.id]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'hunt.update',
            entityType: 'hunt_session',
            entityId: session.id,
            ipAddress: req.ip,
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/hunts/:id — Delete session
// ---------------------------------------------------------------------------
router.delete('/:id', denyDemoUser, async function (req, res) {
    try {
        var session = await db.queryOne(
            'SELECT * FROM hunt_sessions WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!session) {
            return res.status(404).json({ success: false, error: 'Hunt session not found' });
        }

        // Clear hunt_session_id on any attached finds
        await db.query(
            'UPDATE finds SET hunt_session_id = NULL WHERE hunt_session_id = $1',
            [session.id]
        );

        // Delete session (cascade deletes segments and points)
        await db.query('DELETE FROM hunt_sessions WHERE id = $1', [session.id]);

        db.logAuditEvent({
            userId: req.user.id,
            action: 'hunt.delete',
            entityType: 'hunt_session',
            entityId: session.id,
            ipAddress: req.ip,
        });

        res.json({ success: true, message: 'Hunt session deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/hunts/:id/trackpoints — Batch upload trackpoints
// ---------------------------------------------------------------------------
router.post('/:id/trackpoints', denyDemoUser, function (req, res, next) {
    // Promote body idempotency_key to header so the idempotent middleware picks it up
    if (req.body && req.body.idempotency_key && !req.headers['x-idempotency-key']) {
        req.headers['x-idempotency-key'] = req.body.idempotency_key;
    }
    next();
}, idempotent, validate(schemas.uploadTrackpoints), async function (req, res) {
    try {
        var session = await db.queryOne(
            'SELECT * FROM hunt_sessions WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!session) {
            return res.status(404).json({ success: false, error: 'Hunt session not found' });
        }
        if (session.status !== 'active') {
            return res.status(400).json({ success: false, error: 'Session is not active' });
        }

        // Find current open segment
        var segment = await db.queryOne(
            'SELECT id FROM track_segments WHERE session_id = $1 AND ended_at IS NULL ORDER BY segment_number DESC LIMIT 1',
            [session.id]
        );
        if (!segment) {
            return res.status(400).json({ success: false, error: 'No open segment found' });
        }

        var points = req.body.points;

        // Build batch INSERT
        var values = [];
        var insertParams = [];
        var pIdx = 1;
        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            values.push('($' + pIdx + ', $' + (pIdx + 1) + ', $' + (pIdx + 2) + ', $' + (pIdx + 3) + ', $' + (pIdx + 4) + ', $' + (pIdx + 5) + ')');
            insertParams.push(segment.id, p.lat, p.lng, p.accuracy_m || null, p.altitude_m || null, p.recorded_at);
            pIdx += 6;
        }

        await db.query(
            'INSERT INTO track_points (segment_id, lat, lng, accuracy_m, altitude_m, recorded_at) VALUES ' + values.join(', '),
            insertParams
        );

        // Update trackpoint count on session
        var countResult = await db.queryOne(
            'SELECT COUNT(*) AS cnt FROM track_points tp JOIN track_segments ts ON tp.segment_id = ts.id WHERE ts.session_id = $1',
            [session.id]
        );
        await db.query(
            'UPDATE hunt_sessions SET trackpoint_count = $1 WHERE id = $2',
            [parseInt(countResult.cnt), session.id]
        );

        db.logAuditEvent({
            userId: req.user.id,
            action: 'hunt.trackpoints',
            entityType: 'hunt_session',
            entityId: session.id,
            details: { points_added: points.length },
            ipAddress: req.ip,
        });

        res.json({ success: true, points_added: points.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/hunts/:id/trackpoints — Get trackpoints for map rendering
// ---------------------------------------------------------------------------
router.get('/:id/trackpoints', async function (req, res) {
    try {
        var session = await db.queryOne(
            'SELECT id FROM hunt_sessions WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!session) {
            return res.status(404).json({ success: false, error: 'Hunt session not found' });
        }

        // Get all segments
        var segments = (await db.query(
            'SELECT id, segment_number FROM track_segments WHERE session_id = $1 ORDER BY segment_number',
            [session.id]
        )).rows;

        // Get total count
        var countResult = await db.queryOne(
            'SELECT COUNT(*) AS cnt FROM track_points tp JOIN track_segments ts ON tp.segment_id = ts.id WHERE ts.session_id = $1',
            [session.id]
        );
        var totalCount = parseInt(countResult.cnt);

        // Determine downsampling factor
        var maxPoints = 2000;
        var nth = totalCount > maxPoints ? Math.ceil(totalCount / maxPoints) : 1;

        var result = [];
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            var points;
            if (nth > 1) {
                // Use row_number for nth-point sampling
                points = (await db.query(
                    'SELECT lat, lng FROM (' +
                    '  SELECT lat, lng, ROW_NUMBER() OVER (ORDER BY recorded_at) AS rn' +
                    '  FROM track_points WHERE segment_id = $1' +
                    ') sub WHERE sub.rn % $2 = 1 OR sub.rn = 1',
                    [seg.id, nth]
                )).rows;
            } else {
                points = (await db.query(
                    'SELECT lat, lng FROM track_points WHERE segment_id = $1 ORDER BY recorded_at',
                    [seg.id]
                )).rows;
            }

            result.push({
                id: seg.id,
                segment_number: seg.segment_number,
                points: points.map(function (p) { return [p.lat, p.lng]; }),
            });
        }

        res.json({ success: true, data: { segments: result, total_points: totalCount } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Expose haversineMeters for testing
router._haversineMeters = haversineMeters;

module.exports = router;
