/**
 * CSRF protection middleware.
 *
 * Since this app uses JWT in the Authorization header (not cookies),
 * traditional CSRF attacks are largely mitigated. However, as defense-in-depth,
 * this middleware rejects state-changing requests (POST/PUT/DELETE) whose
 * Origin or Referer header doesn't match the expected host.
 *
 * Requests without an Origin/Referer (e.g., server-to-server, curl) are
 * allowed through, since they can't be triggered by a browser CSRF attack.
 */

function csrfProtection(req, res, next) {
    // Only check state-changing methods
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
        return next();
    }

    const origin = req.get('Origin');
    const referer = req.get('Referer');

    // No Origin/Referer means this isn't a browser request — allow through
    if (!origin && !referer) {
        return next();
    }

    // Determine expected host from the Host header
    const host = req.get('Host');
    if (!host) {
        return next();
    }

    // Check Origin header first (most reliable)
    if (origin) {
        try {
            const originHost = new URL(origin).host;
            if (originHost === host) {
                return next();
            }
        } catch (_) {
            // Malformed Origin — reject
        }
        return res.status(403).json({ success: false, error: 'CSRF check failed: origin mismatch' });
    }

    // Fall back to Referer header
    if (referer) {
        try {
            const refererHost = new URL(referer).host;
            if (refererHost === host) {
                return next();
            }
        } catch (_) {
            // Malformed Referer — reject
        }
        return res.status(403).json({ success: false, error: 'CSRF check failed: referer mismatch' });
    }

    next();
}

module.exports = csrfProtection;
