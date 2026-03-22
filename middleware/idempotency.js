/**
 * Server-side idempotency middleware.
 *
 * When a request includes an `x-idempotency-key` header, the middleware checks
 * if that key (scoped to the authenticated user) has already been processed.
 *   - If yes: returns the stored response without executing the handler.
 *   - If no:  lets the handler run, captures the response, and stores it.
 *
 * Requests without the header pass through unchanged (backward compatible).
 *
 * Requires `verifyToken` to have run first (needs `req.user.id`).
 */
const db = require('../database');

function idempotent(req, res, next) {
    const key = req.headers['x-idempotency-key'];
    if (!key) return next(); // No key = normal request

    db.queryOne(
        'SELECT response_status, response_body FROM idempotency_keys WHERE key = $1 AND user_id = $2',
        [key, req.user.id]
    ).then(function (existing) {
        if (existing) {
            // Already processed — replay stored response
            return res.status(existing.response_status).json(existing.response_body);
        }

        // Wrap res.json to capture the response for storage
        const originalJson = res.json.bind(res);
        res.json = function (body) {
            // Store idempotency key (fire-and-forget, ON CONFLICT to handle races)
            db.query(
                'INSERT INTO idempotency_keys (key, user_id, response_status, response_body) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING',
                [key, req.user.id, res.statusCode, body]
            ).catch(function () { /* non-critical */ });
            return originalJson(body);
        };
        next();
    }).catch(function () {
        // If DB lookup fails, proceed without idempotency rather than blocking
        next();
    });
}

module.exports = idempotent;
