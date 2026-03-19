/**
 * Service Worker — app shell + CDN + tile caching.
 * API requests pass through (handled by authedFetch in the app layer).
 */

var CACHE_VERSION = 'v28';
var SHELL_CACHE = 'shell-' + CACHE_VERSION;
var CDN_CACHE = 'cdn-' + CACHE_VERSION;
var TILE_CACHE = 'tiles';
var TILE_LIMIT = 500;

var SHELL_FILES = [
    '/index.html', '/sites.html', '/finds.html', '/hunts.html',
    '/permissions.html', '/legal.html', '/account.html', '/settings.html',
    '/admin.html', '/login.html', '/landing.html', '/reset-password.html', '/privacy.html',
    '/print-site.html', '/print-permission.html', '/permission-approve.html', '/maintenance.html',
    '/css/style.css',
    '/js/auth.js', '/js/config.js', '/js/map.js', '/js/i18n.js',
    '/js/offline-store.js', '/js/sync-engine.js', '/js/offline-ui.js',
    '/js/dashboard.js', '/js/sites.js', '/js/finds.js', '/js/hunts.js',
    '/js/permissions.js', '/js/legal.js', '/js/account.js', '/js/settings.js',
    '/js/admin.js', '/js/login.js', '/js/landing.js', '/js/quick-add.js', '/js/permission-approve.js',
    '/locales/en.json', '/locales/es.json', '/locales/fr.json',
    '/manifest.json',
    '/icons/icon-192.png', '/icons/icon-512.png'
];

var BLANK_TILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">' +
    '<rect width="256" height="256" fill="#e5e5e5"/>' +
    '<text x="128" y="128" text-anchor="middle" fill="#999" font-size="14">Offline</text></svg>';

/* ------------------------------------------------------------------ */
/*  Install — pre-cache app shell                                      */
/* ------------------------------------------------------------------ */
self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(SHELL_CACHE).then(function (cache) {
            // Use addAll with individual fallbacks — don't fail install if one file missing
            return Promise.all(
                SHELL_FILES.map(function (url) {
                    return cache.add(url).catch(function () {
                        console.warn('SW: failed to cache', url);
                    });
                })
            );
        })
    );
});

/* ------------------------------------------------------------------ */
/*  Activate — delete old caches                                       */
/* ------------------------------------------------------------------ */
self.addEventListener('activate', function (e) {
    var keep = [SHELL_CACHE, CDN_CACHE, TILE_CACHE];
    e.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(
                names.filter(function (name) {
                    return keep.indexOf(name) === -1;
                }).map(function (name) {
                    return caches.delete(name);
                })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
});

/* ------------------------------------------------------------------ */
/*  Fetch — routing strategies                                         */
/* ------------------------------------------------------------------ */
function isTileRequest(url) {
    return url.indexOf('tile.openstreetmap.org') !== -1 ||
           url.indexOf('server.arcgisonline.com') !== -1;
}

function isCDNRequest(url) {
    return url.indexOf('unpkg.com') !== -1 ||
           url.indexOf('cdnjs.cloudflare.com') !== -1 ||
           url.indexOf('accounts.google.com/gsi') !== -1 ||
           url.indexOf('simplewebauthn') !== -1 ||
           url.indexOf('googletagmanager.com') !== -1;
}

function isAPIRequest(url) {
    var parsed = new URL(url);
    return parsed.pathname.indexOf('/api/') === 0;
}

self.addEventListener('fetch', function (e) {
    var url = e.request.url;

    // API requests — pass through (handled by authedFetch)
    if (isAPIRequest(url)) {
        return;
    }

    // Map tiles — cache-first with LRU eviction
    if (isTileRequest(url)) {
        e.respondWith(
            caches.open(TILE_CACHE).then(function (cache) {
                return cache.match(e.request).then(function (cached) {
                    if (cached) return cached;
                    return fetch(e.request).then(function (response) {
                        if (response.ok) {
                            cache.put(e.request, response.clone());
                            trimTileCache(cache);
                        }
                        return response;
                    }).catch(function () {
                        // Offline — return blank tile
                        return new Response(BLANK_TILE_SVG, {
                            headers: { 'Content-Type': 'image/svg+xml' }
                        });
                    });
                });
            })
        );
        return;
    }

    // CDN assets (Leaflet, Google Sign-In, etc.) — let browser handle natively.
    // Cross-origin script requests use 'no-cors' mode, returning opaque responses
    // that can't be inspected or reliably cached by a service worker.
    // These resources have their own HTTP cache headers and work fine without SW.
    if (isCDNRequest(url)) {
        return; // Don't call e.respondWith — pass through to browser
    }

    // Any other cross-origin request — pass through to browser
    // Safety net: only handle same-origin requests as app shell
    if (new URL(url).origin !== self.location.origin) {
        return;
    }

    // App shell — stale-while-revalidate
    e.respondWith(
        caches.open(SHELL_CACHE).then(function (cache) {
            return cache.match(e.request).then(function (cached) {
                var fetchPromise = fetch(e.request).then(function (response) {
                    if (response.ok) {
                        cache.put(e.request, response.clone());
                    }
                    return response;
                }).catch(function () {
                    // Network failed — return cached or offline fallback
                    return cached || new Response('Offline', { status: 503 });
                });

                // Return cached immediately, update in background
                return cached || fetchPromise;
            });
        })
    );
});

/* ------------------------------------------------------------------ */
/*  Tile cache LRU eviction                                            */
/* ------------------------------------------------------------------ */
function trimTileCache(cache) {
    cache.keys().then(function (keys) {
        if (keys.length > TILE_LIMIT) {
            // Delete oldest entries (first in the list)
            var toDelete = keys.length - TILE_LIMIT;
            for (var i = 0; i < toDelete; i++) {
                cache.delete(keys[i]);
            }
        }
    });
}

/* ------------------------------------------------------------------ */
/*  Message handling — skip waiting for updates                        */
/* ------------------------------------------------------------------ */
self.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
