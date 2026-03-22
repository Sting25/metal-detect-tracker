/**
 * Shared authentication module — include on EVERY page before page-specific scripts.
 * Manages JWT storage, provides authedFetch(), toast notifications, theme, auto-redirects.
 * UI components (navbar, tabs, FAB, feedback) are in auth-nav.js and auth-widgets.js.
 */
window.Auth = (function () {
    'use strict';

    var TOKEN_KEY = 'mdt_token';
    var USER_KEY = 'mdt_user';

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function getUser() {
        var raw = localStorage.getItem(USER_KEY);
        try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }

    function isDemo() {
        var user = getUser();
        return !!(user && user.is_demo);
    }

    function setAuth(token, user) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    }

    function clearAuth() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
    }

    function isAdmin() {
        var user = getUser();
        return user && user.role === 'admin';
    }

    function logout() {
        clearAuth();
        window.location.href = '/login.html';
    }

    /**
     * Derive a cache key from an API URL for IndexedDB storage.
     */
    function cacheKeyFromUrl(url) {
        return url.replace(/^\/api\//, '');
    }

    /**
     * Queue a mutation for later sync when offline.
     */
    function queueOfflineMutation(method, url, body) {
        var parsed = body;
        if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch (e) { /* keep as string */ }
        }
        return OfflineStore.queueMutation(method, url, parsed).then(function (mutationId) {
            if (window.OfflineUI) OfflineUI.updateBannerState();
            return new Response(JSON.stringify({
                success: true,
                queued: true,
                offline_id: mutationId,
                message: 'Saved offline — will sync when connected'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        });
    }

    /**
     * Wrapper around fetch() that adds the Authorization header,
     * redirects to login on 401, and handles offline mode:
     *  - GETs: network-first with IndexedDB fallback
     *  - Mutations: queue in IndexedDB when offline
     */
    function authedFetch(url, options) {
        options = options || {};
        var token = getToken();

        if (!options.headers) {
            if (options.body instanceof FormData) {
                options.headers = {};
            } else {
                options.headers = { 'Content-Type': 'application/json' };
            }
        }
        if (token) {
            options.headers['Authorization'] = 'Bearer ' + token;
        }

        var method = (options.method || 'GET').toUpperCase();
        var isRead = method === 'GET';

        if (isRead) {
            // GET: network-first with offline cache fallback
            return fetch(url, options).then(function (res) {
                if (res.status === 401) {
                    clearAuth();
                    window.location.href = '/login.html';
                    return Promise.reject(new Error('Session expired'));
                }
                if (res.status === 403) {
                    res.clone().json().then(function (body) {
                        if (body && body.isDisabled) {
                            clearAuth();
                            window.location.href = '/login.html?disabled=1';
                        } else if (body && body.isDemo) {
                            showToast('This action is not available in demo mode. Sign up to create your own account!', 'info', 4000);
                        }
                    }).catch(function () {});
                }
                // Cache successful JSON responses for offline use
                if (res.ok && window.OfflineStore) {
                    var ck = cacheKeyFromUrl(url);
                    res.clone().json().then(function (json) {
                        if (json.success !== false) {
                            OfflineStore.cacheResponse(ck, json);
                        }
                    }).catch(function () {});
                }
                return res;
            }).catch(function (err) {
                // Network failed — try offline cache
                if (window.OfflineStore) {
                    var ck = cacheKeyFromUrl(url);
                    return OfflineStore.getCached(ck).then(function (cached) {
                        if (cached) {
                            cached.data.fromCache = true;
                            return new Response(JSON.stringify(cached.data), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }
                        throw err;
                    });
                }
                throw err;
            });
        } else {
            // POST/PUT/DELETE: try network, queue if offline
            if (!navigator.onLine && window.OfflineStore && !(options.body instanceof FormData)) {
                return queueOfflineMutation(method, url, options.body);
            }
            return fetch(url, options).then(function (res) {
                if (res.status === 401) {
                    clearAuth();
                    window.location.href = '/login.html';
                    return Promise.reject(new Error('Session expired'));
                }
                if (res.status === 403) {
                    res.clone().json().then(function (body) {
                        if (body && body.isDisabled) {
                            clearAuth();
                            window.location.href = '/login.html?disabled=1';
                        } else if (body && body.isDemo) {
                            showToast('This action is not available in demo mode. Sign up to create your own account!', 'info', 4000);
                        }
                    }).catch(function () {});
                }
                return res;
            }).catch(function (err) {
                // Network error even though navigator.onLine was true
                if (window.OfflineStore && !(options.body instanceof FormData)) {
                    return queueOfflineMutation(method, url, options.body);
                }
                throw err;
            });
        }
    }

    /**
     * Validate current token. Redirect to login if invalid.
     * Skips on login.html. Falls back to cached user when offline.
     */
    function requireAuth() {
        var path = window.location.pathname;
        if (path === '/login.html' || path === '/landing.html' || path === '/legal.html'
            || path === '/reset-password.html' || path === '/maintenance.html') {
            return Promise.resolve();
        }

        var token = getToken();
        if (!token) {
            window.location.href = '/landing.html';
            return Promise.reject(new Error('No token'));
        }

        return fetch('/api/auth/me', {
            headers: { 'Authorization': 'Bearer ' + token }
        }).then(function (res) {
            if (!res.ok) {
                clearAuth();
                window.location.href = '/landing.html';
                return Promise.reject(new Error('Invalid token'));
            }
            return res.json();
        }).then(function (json) {
            localStorage.setItem(USER_KEY, JSON.stringify(json.data));
        }).catch(function (err) {
            // Offline fallback: if we have a cached user, trust the token
            if (!navigator.onLine || (err && err.message === 'Failed to fetch')) {
                var cachedUser = getUser();
                if (cachedUser && token) {
                    return Promise.resolve();
                }
            }
            clearAuth();
            window.location.href = '/landing.html';
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /* ------------------------------------------------------------------ */
    /*  Toast Notification System                                          */
    /* ------------------------------------------------------------------ */
    var toastContainer = null;

    function ensureToastContainer() {
        if (toastContainer) return toastContainer;
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        toastContainer.setAttribute('aria-live', 'polite');
        document.body.appendChild(toastContainer);
        return toastContainer;
    }

    function showToast(message, type, duration) {
        type = type || 'error';
        duration = duration !== undefined ? duration : 5000;

        var container = ensureToastContainer();
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;

        var icons = { error: '\u2716', success: '\u2714', info: '\u2139', warning: '\u26A0' };
        toast.innerHTML =
            '<span class="toast-icon">' + (icons[type] || '') + '</span>' +
            '<span class="toast-message">' + escapeHtml(message) + '</span>' +
            '<button class="toast-close" aria-label="Dismiss">&times;</button>';

        container.appendChild(toast);
        requestAnimationFrame(function () { toast.classList.add('toast-visible'); });

        var closeBtn = toast.querySelector('.toast-close');
        var dismissed = false;

        function dismiss() {
            if (dismissed) return;
            dismissed = true;
            toast.classList.remove('toast-visible');
            toast.classList.add('toast-hiding');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }

        closeBtn.addEventListener('click', dismiss);
        if (duration > 0) setTimeout(dismiss, duration);
    }

    /* ------------------------------------------------------------------ */
    /*  Theme Management                                                  */
    /* ------------------------------------------------------------------ */
    var DARK_KEY = 'mdt_dark';

    function getDarkMode() {
        var stored = localStorage.getItem(DARK_KEY);
        if (stored === 'true') return true;
        if (stored === 'false') return false;
        return null; // auto
    }

    function isDarkActive() {
        var pref = getDarkMode();
        if (pref === true) return true;
        if (pref === false) return false;
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function applyTheme() {
        var dark = isDarkActive();
        var el = document.documentElement;
        el.removeAttribute('data-theme');
        if (dark) {
            el.setAttribute('data-dark', 'true');
        } else {
            el.removeAttribute('data-dark');
        }
        updateDarkModeUI();
    }

    function setDarkMode(mode) {
        if (mode === 'auto') {
            localStorage.removeItem(DARK_KEY);
        } else if (mode === 'on') {
            localStorage.setItem(DARK_KEY, 'true');
        } else {
            localStorage.setItem(DARK_KEY, 'false');
        }
        applyTheme();
    }

    function updateDarkModeUI() {
        var darkSelect = document.getElementById('nav-dark-mode-select');
        if (darkSelect) {
            var stored = localStorage.getItem(DARK_KEY);
            if (stored === 'true') darkSelect.value = 'on';
            else if (stored === 'false') darkSelect.value = 'off';
            else darkSelect.value = 'auto';
        }
    }

    // Apply theme immediately to prevent flash of unstyled content
    applyTheme();

    // Listen for OS dark mode changes when set to auto
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
            if (getDarkMode() === null) applyTheme();
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Offline Init                                                       */
    /* ------------------------------------------------------------------ */
    function initOffline() {
        var chain = Promise.resolve();
        if (window.OfflineStore) {
            chain = OfflineStore.init().catch(function (err) {
                console.warn('OfflineStore init failed:', err);
            });
        }
        return chain.then(function () {
            if (window.SyncEngine) SyncEngine.init();
            if (window.OfflineUI) OfflineUI.init();
        });
    }

    // Auto-check auth on page load, then dispatch auth:ready for nav/widget scripts
    document.addEventListener('DOMContentLoaded', function () {
        initOffline().then(function () {
            return requireAuth();
        }).then(function () {
            document.dispatchEvent(new CustomEvent('auth:ready'));
        }).catch(function () {
            // Redirect already handled
        });
    });

    function secureUrl(url) {
        if (!url) return url;
        var token = getToken();
        if (!token) return url;
        var sep = url.indexOf('?') !== -1 ? '&' : '?';
        return url + sep + 'token=' + encodeURIComponent(token);
    }

    return {
        getToken: getToken,
        getUser: getUser,
        setAuth: setAuth,
        clearAuth: clearAuth,
        isAdmin: isAdmin,
        isDemo: isDemo,
        logout: logout,
        authedFetch: authedFetch,
        requireAuth: requireAuth,
        setDarkMode: setDarkMode,
        updateDarkModeUI: updateDarkModeUI,
        secureUrl: secureUrl,
        escapeHtml: escapeHtml,
        showToast: showToast
    };
})();
