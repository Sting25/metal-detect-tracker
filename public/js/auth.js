/**
 * Shared authentication module — include on EVERY page before page-specific scripts.
 * Manages JWT storage, provides authedFetch(), updates navbar, auto-redirects.
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

    /**
     * Show a toast notification instead of alert().
     * @param {string} message - Text to display
     * @param {string} type - 'error' | 'success' | 'info' | 'warning'
     * @param {number} duration - Auto-dismiss in ms (0 = manual dismiss)
     */
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

        // Trigger entrance animation
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

        if (duration > 0) {
            setTimeout(dismiss, duration);
        }
    }

    /**
     * Update navbar with user dropdown (units, admin, logout).
     */
    function updateNavbar() {
        var user = getUser();
        if (!user) return;

        // Point brand logo to dashboard when logged in, landing page for demo
        var brand = document.querySelector('a.nav-brand');
        if (brand) brand.href = isDemo() ? '/landing.html' : '/index.html';

        var navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        // Create user dropdown
        var wrapper = document.createElement('div');
        wrapper.className = 'nav-dropdown';

        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nav-dropdown-toggle';
        toggle.innerHTML = '&#128100; ' + escapeHtml(user.display_name) + ' <span class="nav-dropdown-chevron">&#9662;</span>';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-haspopup', 'true');

        var menu = document.createElement('div');
        menu.className = 'nav-dropdown-menu';
        menu.setAttribute('role', 'menu');

        // Units toggle item
        var unitsItem = document.createElement('button');
        unitsItem.type = 'button';
        unitsItem.className = 'nav-dropdown-item';
        unitsItem.setAttribute('role', 'menuitem');
        var unitText = (window.AppConfig && AppConfig.isMetric && AppConfig.isMetric())
            ? '&#9878; Units: cm' : '&#9878; Units: in';
        unitsItem.innerHTML = '<span class="nav-dropdown-item-icon">&#9878;</span> ' +
            ((window.AppConfig && AppConfig.isMetric && AppConfig.isMetric()) ? 'Units: cm' : 'Units: in');
        unitsItem.addEventListener('click', function () {
            if (window.AppConfig && AppConfig.toggleUnits) {
                AppConfig.toggleUnits();
            }
        });
        menu.appendChild(unitsItem);

        // Admin link (if admin)
        if (user.role === 'admin') {
            var adminItem = document.createElement('a');
            adminItem.href = '/admin.html';
            adminItem.className = 'nav-dropdown-item';
            adminItem.setAttribute('role', 'menuitem');
            if (window.location.pathname === '/admin.html') adminItem.classList.add('active');
            adminItem.innerHTML = '<span class="nav-dropdown-item-icon">&#128736;</span> Admin Panel';
            menu.appendChild(adminItem);
        }

        // Account settings
        var accountItem = document.createElement('a');
        accountItem.href = '/account.html';
        accountItem.className = 'nav-dropdown-item';
        accountItem.setAttribute('role', 'menuitem');
        if (window.location.pathname === '/account.html') accountItem.classList.add('active');
        accountItem.innerHTML = '<span class="nav-dropdown-item-icon">&#9881;</span> Account';
        menu.appendChild(accountItem);

        // Settings
        var settingsItem = document.createElement('a');
        settingsItem.href = '/settings.html';
        settingsItem.className = 'nav-dropdown-item';
        settingsItem.setAttribute('role', 'menuitem');
        if (window.location.pathname === '/settings.html') settingsItem.classList.add('active');
        settingsItem.innerHTML = '<span class="nav-dropdown-item-icon">&#9881;</span> Settings';
        menu.appendChild(settingsItem);

        // Privacy
        var privacyItem = document.createElement('a');
        privacyItem.href = '/privacy.html';
        privacyItem.className = 'nav-dropdown-item';
        privacyItem.setAttribute('role', 'menuitem');
        if (window.location.pathname === '/privacy.html') privacyItem.classList.add('active');
        privacyItem.innerHTML = '<span class="nav-dropdown-item-icon">&#128274;</span> Privacy';
        menu.appendChild(privacyItem);

        // Feedback
        var feedbackItem = document.createElement('button');
        feedbackItem.type = 'button';
        feedbackItem.className = 'nav-dropdown-item';
        feedbackItem.setAttribute('role', 'menuitem');
        feedbackItem.innerHTML = '<span class="nav-dropdown-item-icon">&#128172;</span> Feedback';
        feedbackItem.addEventListener('click', function () {
            wrapper.classList.remove('open');
            var fbBtn = document.getElementById('feedback-widget-btn');
            if (fbBtn) fbBtn.click();
        });
        menu.appendChild(feedbackItem);

        // Dark mode toggle
        var darkItem = document.createElement('div');
        darkItem.className = 'nav-dark-toggle';
        darkItem.innerHTML =
            '<span class="nav-dark-toggle-label"><span class="nav-dropdown-item-icon">&#127769;</span> Dark Mode</span>' +
            '<select id="nav-dark-mode-select" class="nav-dark-select">' +
            '<option value="auto">Auto</option>' +
            '<option value="on">On</option>' +
            '<option value="off">Off</option>' +
            '</select>';
        menu.appendChild(darkItem);

        darkItem.querySelector('select').addEventListener('change', function (e) {
            e.stopPropagation();
            setDarkMode(this.value);
        });
        darkItem.addEventListener('click', function (e) {
            e.stopPropagation(); // Prevent dropdown from closing
        });
        updateDarkModeUI();

        // Divider
        var divider = document.createElement('div');
        divider.className = 'nav-dropdown-divider';
        menu.appendChild(divider);

        // Logout
        var logoutItem = document.createElement('button');
        logoutItem.type = 'button';
        logoutItem.className = 'nav-dropdown-item';
        logoutItem.setAttribute('role', 'menuitem');
        logoutItem.innerHTML = isDemo()
            ? '<span class="nav-dropdown-item-icon">&#128682;</span> Exit Demo'
            : '<span class="nav-dropdown-item-icon">&#128682;</span> Logout';
        logoutItem.addEventListener('click', function () {
            logout();
        });
        menu.appendChild(logoutItem);

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            // Close any other open dropdowns first
            document.querySelectorAll('.nav-dropdown.open').forEach(function (dd) {
                if (dd !== wrapper) dd.classList.remove('open');
            });
            var isOpen = wrapper.classList.toggle('open');
            toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        wrapper.appendChild(toggle);
        wrapper.appendChild(menu);
        navLinks.appendChild(wrapper);

        // Close on outside click
        document.addEventListener('click', function (e) {
            if (!wrapper.contains(e.target)) {
                wrapper.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            }
        });

        // Close on Escape
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                wrapper.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            }
        });
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
            if (getDarkMode() === null) {
                applyTheme();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Bottom Tab Navigation (mobile)                                     */
    /* ------------------------------------------------------------------ */
    var TAB_ITEMS = [
        { href: '/index.html',      icon: '&#127968;',   label: 'Dashboard' },
        { href: '/sites.html',      icon: '&#128205;',  label: 'Sites' },
        { href: '/finds.html',      icon: '&#129689;',  label: 'Finds' },
        { href: '/permissions.html', icon: '&#128221;',  label: 'Permits' },
        { href: '#more',            icon: '&#8943;',    label: 'More', isMore: true }
    ];

    function createBottomTabs() {
        var path = window.location.pathname;
        if (path === '/login.html' || path === '/landing.html' ||
            path.indexOf('print-') !== -1 ||
            (path === '/legal.html' && !getToken())) return;

        var nav = document.createElement('nav');
        nav.className = 'bottom-tabs';
        nav.setAttribute('aria-label', 'Main navigation');

        TAB_ITEMS.forEach(function (item) {
            if (item.isMore) {
                var btn = document.createElement('button');
                btn.className = 'bottom-tab bottom-tab-more';
                btn.type = 'button';
                btn.innerHTML = '<span class="bottom-tab-icon">' + item.icon + '</span>' +
                                '<span class="bottom-tab-label">' + item.label + '</span>';
                btn.setAttribute('aria-expanded', 'false');
                btn.setAttribute('aria-controls', 'more-menu-panel');
                var morePages = ['/legal.html', '/admin.html', '/settings.html'];
                if (morePages.indexOf(path) !== -1) btn.classList.add('active');
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    toggleMorePanel();
                });
                nav.appendChild(btn);
            } else {
                var a = document.createElement('a');
                a.href = item.href;
                a.className = 'bottom-tab';
                var isActive = (item.href === '/index.html' && (path === '/' || path === '/index.html')) ||
                               (item.href !== '/index.html' && path === item.href);
                if (isActive) a.classList.add('active');
                a.innerHTML = '<span class="bottom-tab-icon">' + item.icon + '</span>' +
                               '<span class="bottom-tab-label">' + item.label + '</span>';
                a.setAttribute('aria-current', isActive ? 'page' : 'false');
                nav.appendChild(a);
            }
        });

        document.body.appendChild(nav);
        document.body.classList.add('has-bottom-tabs');
        createMorePanel();
    }

    /* ------------------------------------------------------------------ */
    /*  More Menu Panel (mobile overflow menu)                             */
    /* ------------------------------------------------------------------ */
    function createMorePanel() {
        var user = getUser();
        var panel = document.createElement('div');
        panel.className = 'more-menu-panel';
        panel.id = 'more-menu-panel';
        panel.setAttribute('aria-hidden', 'true');

        var backdrop = document.createElement('div');
        backdrop.className = 'more-menu-backdrop';
        backdrop.addEventListener('click', function () { closeMorePanel(); });

        var content = document.createElement('div');
        content.className = 'more-menu-content';

        // User info header
        if (user) {
            var userHeader = document.createElement('div');
            userHeader.className = 'more-menu-user';
            userHeader.innerHTML =
                '<span class="more-menu-user-icon">&#128100;</span>' +
                '<span class="more-menu-user-name">' + escapeHtml(user.display_name) + '</span>';
            content.appendChild(userHeader);
        }

        // Menu items
        var items = [
            { href: '/account.html', icon: '&#9881;', label: 'Account' },
            { href: '/settings.html', icon: '&#9881;', label: 'Settings' },
            { href: '/legal.html', icon: '&#9878;', label: 'Legal Reference' }
        ];
        if (user && user.role === 'admin') {
            items.push({ href: '/admin.html', icon: '&#128736;', label: 'Admin Panel' });
        }

        items.forEach(function (item) {
            var a = document.createElement('a');
            a.href = item.href;
            a.className = 'more-menu-item';
            if (window.location.pathname === item.href) a.classList.add('active');
            a.innerHTML = '<span class="more-menu-item-icon">' + item.icon + '</span>' +
                          '<span class="more-menu-item-label">' + item.label + '</span>';
            content.appendChild(a);
        });

        // Units toggle row
        var unitsRow = document.createElement('button');
        unitsRow.className = 'more-menu-item';
        unitsRow.type = 'button';
        var unitsLabel = (window.AppConfig && AppConfig.isMetric && AppConfig.isMetric())
            ? 'Units: cm' : 'Units: in';
        unitsRow.innerHTML =
            '<span class="more-menu-item-icon">&#9878;</span>' +
            '<span class="more-menu-item-label">' + unitsLabel + '</span>';
        unitsRow.addEventListener('click', function () {
            if (window.AppConfig && AppConfig.toggleUnits) {
                AppConfig.toggleUnits();
            }
        });
        content.appendChild(unitsRow);

        // Language row
        var langRow = document.createElement('button');
        langRow.className = 'more-menu-item';
        langRow.type = 'button';
        var currentLangCode = (window.AppConfig && AppConfig.getUser && AppConfig.getUser())
            ? (AppConfig.getUser().language_preference || 'en') : 'en';
        var currentLangLabel = currentLangCode.toUpperCase();
        langRow.innerHTML =
            '<span class="more-menu-item-icon">&#127760;</span>' +
            '<span class="more-menu-item-label">Language: ' + currentLangLabel + '</span>';
        langRow.addEventListener('click', function () {
            // Cycle through languages: en → es → fr → en
            var langs = ['en', 'es', 'fr'];
            var idx = langs.indexOf(currentLangCode);
            var nextLang = langs[(idx + 1) % langs.length];
            if (window.AppConfig && AppConfig.updatePreferences) {
                AppConfig.updatePreferences({ language_preference: nextLang }).then(function () {
                    window.location.reload();
                });
            }
        });
        content.appendChild(langRow);

        // Theme row
        var themeRow = document.createElement('button');
        themeRow.className = 'more-menu-item';
        themeRow.type = 'button';
        themeRow.innerHTML =
            '<span class="more-menu-item-icon">&#127912;</span>' +
            '<span class="more-menu-item-label">Theme</span>';
        themeRow.addEventListener('click', function () {
            var themePanel = document.getElementById('theme-panel');
            if (themePanel) themePanel.classList.toggle('open');
        });
        content.appendChild(themeRow);

        // Feedback row
        var feedbackRow = document.createElement('button');
        feedbackRow.className = 'more-menu-item';
        feedbackRow.type = 'button';
        feedbackRow.innerHTML =
            '<span class="more-menu-item-icon">&#128172;</span>' +
            '<span class="more-menu-item-label">Feedback</span>';
        feedbackRow.addEventListener('click', function () {
            closeMorePanel();
            var fbBtn = document.getElementById('feedback-widget-btn');
            if (fbBtn) fbBtn.click();
        });
        content.appendChild(feedbackRow);

        // Divider
        var divider = document.createElement('div');
        divider.className = 'more-menu-divider';
        content.appendChild(divider);

        // Logout
        if (user) {
            var logoutItem = document.createElement('button');
            logoutItem.className = 'more-menu-item more-menu-logout';
            logoutItem.type = 'button';
            logoutItem.innerHTML =
                '<span class="more-menu-item-icon">&#128682;</span>' +
                '<span class="more-menu-item-label">Logout</span>';
            logoutItem.addEventListener('click', function () { logout(); });
            content.appendChild(logoutItem);
        }

        panel.appendChild(backdrop);
        panel.appendChild(content);
        document.body.appendChild(panel);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeMorePanel();
        });
    }

    function toggleMorePanel() {
        var panel = document.getElementById('more-menu-panel');
        if (!panel) return;
        if (panel.classList.contains('open')) {
            closeMorePanel();
        } else {
            openMorePanel();
        }
    }

    function openMorePanel() {
        var panel = document.getElementById('more-menu-panel');
        if (!panel) return;
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        var moreBtn = document.querySelector('.bottom-tab-more');
        if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
    }

    function closeMorePanel() {
        var panel = document.getElementById('more-menu-panel');
        if (!panel) return;
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
        var moreBtn = document.querySelector('.bottom-tab-more');
        if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
        var themePanel = document.getElementById('theme-panel');
        if (themePanel) themePanel.classList.remove('open');
    }

    /* ------------------------------------------------------------------ */
    /*  Floating Action Button (FAB)                                       */
    /* ------------------------------------------------------------------ */
    function createFAB() {
        if (isDemo()) return; // No add actions in demo mode
        var path = window.location.pathname;
        var fabConfig = null;

        if (path === '/sites.html') {
            fabConfig = { icon: '+', label: 'Add Site', targetId: 'btn-add-site' };
        } else if (path === '/finds.html') {
            fabConfig = { icon: '+', label: 'Log Find', targetId: 'btn-add-find' };
        } else if (path === '/permissions.html') {
            fabConfig = { icon: '+', label: 'New Request', targetId: 'btn-add-permission' };
        } else if (path === '/' || path === '/index.html' || path === '/legal.html') {
            // Quick-add camera FAB on pages without a specific add action
            fabConfig = { icon: '&#128247;', label: 'Quick Add Site', action: 'quick-add' };
        }

        if (!fabConfig) return;

        var fab = document.createElement('button');
        fab.className = 'fab';
        fab.setAttribute('aria-label', fabConfig.label);
        fab.setAttribute('title', fabConfig.label);
        fab.innerHTML = '<span class="fab-icon">' + fabConfig.icon + '</span>';
        fab.addEventListener('click', function () {
            if (fabConfig.action === 'quick-add') {
                if (window.QuickAddSite) window.QuickAddSite.open();
            } else {
                var target = document.getElementById(fabConfig.targetId);
                if (target) target.click();
            }
        });
        document.body.appendChild(fab);
    }

    /* ------------------------------------------------------------------ */
    /*  Quick Add Site Loader                                              */
    /* ------------------------------------------------------------------ */
    function loadQuickAdd() {
        var path = window.location.pathname;
        if (path === '/login.html' || path === '/landing.html' ||
            path.indexOf('print-') !== -1 ||
            (path === '/legal.html' && !getToken())) return;

        var script = document.createElement('script');
        script.src = '/js/quick-add.js';
        document.body.appendChild(script);
    }

    /* ------------------------------------------------------------------ */
    /*  Feedback Widget                                                    */
    /* ------------------------------------------------------------------ */
    function createFeedbackWidget() {
        if (isDemo()) return; // No feedback in demo mode
        var path = window.location.pathname;
        if (path === '/login.html' || path === '/landing.html' ||
            path.indexOf('print-') !== -1 ||
            (path === '/legal.html' && !getToken())) return;

        var widget = document.createElement('div');
        widget.className = 'feedback-widget';
        widget.innerHTML =
            '<button class="feedback-widget-btn" id="feedback-widget-btn" title="Send Feedback"><span class="feedback-btn-icon">&#128172;</span><span class="feedback-btn-label">Feedback</span></button>' +
            '<div class="feedback-panel" id="feedback-panel">' +
            '<div class="feedback-panel-header">' +
            '<span class="feedback-panel-title">Send Feedback</span>' +
            '<button class="feedback-panel-close" id="feedback-panel-close">&times;</button>' +
            '</div>' +
            '<form id="feedback-form" class="feedback-form">' +
            '<div class="feedback-field">' +
            '<label for="feedback-type">Type</label>' +
            '<select id="feedback-type" class="form-control">' +
            '<option value="suggestion">Suggestion</option>' +
            '<option value="bug">Bug Report</option>' +
            '<option value="question">Question</option>' +
            '<option value="other">Other</option>' +
            '</select>' +
            '</div>' +
            '<div class="feedback-field">' +
            '<label for="feedback-message">Message *</label>' +
            '<textarea id="feedback-message" class="form-control" rows="4" placeholder="What\'s on your mind?" required></textarea>' +
            '</div>' +
            '<div class="feedback-field">' +
            '<label for="feedback-screenshot">Screenshot (optional)</label>' +
            '<input type="file" id="feedback-screenshot" accept="image/*" class="form-control">' +
            '</div>' +
            '<button type="submit" class="btn btn-primary feedback-submit-btn">Send Feedback</button>' +
            '</form>' +
            '<div class="feedback-success" id="feedback-success" style="display:none;">' +
            '<span class="feedback-success-icon">&#10004;</span>' +
            '<p>Thanks for your feedback!</p>' +
            '</div>' +
            '</div>';

        document.body.appendChild(widget);

        var btn = document.getElementById('feedback-widget-btn');
        var panel = document.getElementById('feedback-panel');
        var closeBtn = document.getElementById('feedback-panel-close');
        var form = document.getElementById('feedback-form');
        var successEl = document.getElementById('feedback-success');

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            panel.classList.toggle('open');
        });

        closeBtn.addEventListener('click', function () {
            panel.classList.remove('open');
        });

        document.addEventListener('click', function (e) {
            if (panel.classList.contains('open') && !widget.contains(e.target)) {
                panel.classList.remove('open');
            }
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var formData = new FormData();
            formData.append('type', document.getElementById('feedback-type').value);
            formData.append('message', document.getElementById('feedback-message').value);
            formData.append('page_url', window.location.href);
            formData.append('user_agent', navigator.userAgent);
            var screenshotInput = document.getElementById('feedback-screenshot');
            if (screenshotInput.files.length > 0) {
                formData.append('screenshot', screenshotInput.files[0]);
            }

            var submitBtn = form.querySelector('.feedback-submit-btn');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';

            authedFetch('/api/feedback', { method: 'POST', body: formData })
                .then(function (res) {
                    if (!res.ok) throw new Error('Failed');
                    form.style.display = 'none';
                    successEl.style.display = 'flex';
                    setTimeout(function () {
                        panel.classList.remove('open');
                        // Reset after close animation
                        setTimeout(function () {
                            form.style.display = '';
                            successEl.style.display = 'none';
                            form.reset();
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Send Feedback';
                        }, 300);
                    }, 2000);
                })
                .catch(function () {
                    showToast('Failed to send feedback. Please try again.');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Send Feedback';
                });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Demo Mode Banner                                                   */
    /* ------------------------------------------------------------------ */
    function createDemoBanner() {
        if (!isDemo()) return;

        var banner = document.createElement('div');
        banner.className = 'demo-banner';
        banner.innerHTML =
            '<span class="demo-banner-text">' +
            '&#128269; You\'re viewing a demo &mdash; ' +
            '<a href="/login.html#register" class="demo-banner-link">Sign up free</a> to create your own account' +
            '</span>' +
            '<button class="demo-banner-close" aria-label="Dismiss">&times;</button>';

        document.body.insertBefore(banner, document.body.firstChild);
        document.body.classList.add('has-demo-banner');

        banner.querySelector('.demo-banner-close').addEventListener('click', function () {
            banner.remove();
            document.body.classList.remove('has-demo-banner');
        });
    }

    /**
     * Initialize offline infrastructure (IndexedDB + sync engine + UI).
     * Safe to call even if the scripts aren't loaded — checks window.*
     */
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

    // Auto-check auth on page load (except login page)
    document.addEventListener('DOMContentLoaded', function () {
        // Init offline store early so authedFetch has it available
        initOffline().then(function () {
            return requireAuth();
        }).then(function () {
            updateNavbar();
            createDemoBanner();
            createBottomTabs();
            createFAB();
            loadQuickAdd();
            createFeedbackWidget();
        }).catch(function () {
            // Redirect already handled
        });
    });

    /**
     * Append auth token to a URL for browser-native requests (img src, a href).
     * These can't send Authorization headers, so we pass the JWT as a query param.
     */
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
        updateNavbar: updateNavbar,
        setDarkMode: setDarkMode,
        secureUrl: secureUrl,
        escapeHtml: escapeHtml,
        showToast: showToast
    };
})();
