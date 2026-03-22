/**
 * Auth navigation UI — navbar dropdown, bottom tabs, and more panel.
 * Loaded after auth.js on every authenticated page.
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Navbar User Dropdown                                               */
    /* ------------------------------------------------------------------ */
    function updateNavbar() {
        var user = Auth.getUser();
        if (!user) return;

        // Point brand logo to dashboard when logged in, landing page for demo
        var brand = document.querySelector('a.nav-brand');
        if (brand) brand.href = Auth.isDemo() ? '/landing.html' : '/index.html';

        var navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        var wrapper = document.createElement('div');
        wrapper.className = 'nav-dropdown';

        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nav-dropdown-toggle';
        toggle.innerHTML = '&#128100; ' + Auth.escapeHtml(user.display_name) + ' <span class="nav-dropdown-chevron">&#9662;</span>';
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
            Auth.setDarkMode(this.value);
        });
        darkItem.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        Auth.updateDarkModeUI();

        // Divider
        var divider = document.createElement('div');
        divider.className = 'nav-dropdown-divider';
        menu.appendChild(divider);

        // Logout
        var logoutItem = document.createElement('button');
        logoutItem.type = 'button';
        logoutItem.className = 'nav-dropdown-item';
        logoutItem.setAttribute('role', 'menuitem');
        logoutItem.innerHTML = Auth.isDemo()
            ? '<span class="nav-dropdown-item-icon">&#128682;</span> Exit Demo'
            : '<span class="nav-dropdown-item-icon">&#128682;</span> Logout';
        logoutItem.addEventListener('click', function () {
            Auth.logout();
        });
        menu.appendChild(logoutItem);

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            document.querySelectorAll('.nav-dropdown.open').forEach(function (dd) {
                if (dd !== wrapper) dd.classList.remove('open');
            });
            var isOpen = wrapper.classList.toggle('open');
            toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        wrapper.appendChild(toggle);
        wrapper.appendChild(menu);
        navLinks.appendChild(wrapper);

        document.addEventListener('click', function (e) {
            if (!wrapper.contains(e.target)) {
                wrapper.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                wrapper.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
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
            (path === '/legal.html' && !Auth.getToken())) return;

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
        var user = Auth.getUser();
        var panel = document.createElement('div');
        panel.className = 'more-menu-panel';
        panel.id = 'more-menu-panel';
        panel.setAttribute('aria-hidden', 'true');

        var backdrop = document.createElement('div');
        backdrop.className = 'more-menu-backdrop';
        backdrop.addEventListener('click', function () { closeMorePanel(); });

        var content = document.createElement('div');
        content.className = 'more-menu-content';

        if (user) {
            var userHeader = document.createElement('div');
            userHeader.className = 'more-menu-user';
            userHeader.innerHTML =
                '<span class="more-menu-user-icon">&#128100;</span>' +
                '<span class="more-menu-user-name">' + Auth.escapeHtml(user.display_name) + '</span>';
            content.appendChild(userHeader);
        }

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

        // Units toggle
        var unitsRow = document.createElement('button');
        unitsRow.className = 'more-menu-item';
        unitsRow.type = 'button';
        var unitsLabel = (window.AppConfig && AppConfig.isMetric && AppConfig.isMetric())
            ? 'Units: cm' : 'Units: in';
        unitsRow.innerHTML =
            '<span class="more-menu-item-icon">&#9878;</span>' +
            '<span class="more-menu-item-label">' + unitsLabel + '</span>';
        unitsRow.addEventListener('click', function () {
            if (window.AppConfig && AppConfig.toggleUnits) AppConfig.toggleUnits();
        });
        content.appendChild(unitsRow);

        // Language
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

        // Theme
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

        // Feedback
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
            logoutItem.addEventListener('click', function () { Auth.logout(); });
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
    /*  Init on auth:ready                                                 */
    /* ------------------------------------------------------------------ */
    document.addEventListener('auth:ready', function () {
        updateNavbar();
        createBottomTabs();
    });
})();
