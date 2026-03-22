/**
 * AppConfig — shared configuration module for Metal Detector Location Tracker
 *
 * Loaded on every authenticated page AFTER auth.js. Provides:
 * - User profile with country_code and unit_preference
 * - Land types for the user's country (fetched from API)
 * - Unit-aware depth formatting
 * - Country-aware map defaults
 */
window.AppConfig = (function () {
    'use strict';

    let _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    let _user = null;
    let _landTypes = null;
    let _ready = false;
    let _readyCallbacks = [];

    // ------------------------------------------------------------------
    // Map defaults by country
    // ------------------------------------------------------------------
    const MAP_DEFAULTS = {
        US: { center: [39.8283, -98.5795], zoom: 4 },
        GB: { center: [54.0, -2.0], zoom: 6 },
        AU: { center: [-25.2744, 133.7751], zoom: 4 },
        _default: { center: [20, 0], zoom: 2 }
    };

    // ------------------------------------------------------------------
    // Init — fetch user profile + land types, then fire ready callbacks
    // ------------------------------------------------------------------
    function init() {
        if (typeof Auth === 'undefined' || !Auth.getToken()) {
            // No auth — still init i18n for unauthenticated pages (legal, etc.)
            const i18nReady = (typeof I18n !== 'undefined')
                ? I18n.autoInit()
                : Promise.resolve();
            i18nReady.then(function () {
                _ready = true;
                _readyCallbacks.forEach(function (cb) { cb(); });
                _readyCallbacks = [];
            });
            return;
        }

        Auth.authedFetch('/api/auth/me')
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (body.success && body.data) {
                    _user = body.data;
                    return fetchLandTypes(_user.country_code || 'US');
                }
            })
            .then(function () {
                // Initialize i18n with user's language preference
                if (typeof I18n !== 'undefined') {
                    return I18n.init(_user ? _user.language_preference || 'en' : 'en');
                }
            })
            .then(function () {
                _ready = true;
                _readyCallbacks.forEach(function (cb) { cb(); });
                _readyCallbacks = [];
            })
            .catch(function (err) {
                console.error('AppConfig init error:', err);
                _ready = true;
                _readyCallbacks.forEach(function (cb) { cb(); });
                _readyCallbacks = [];
            });
    }

    function fetchLandTypes(countryCode) {
        return Auth.authedFetch('/api/land-types?country=' + encodeURIComponent(countryCode))
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (body.success && body.data) {
                    _landTypes = body.data;
                }
            })
            .catch(function () {
                _landTypes = [];
            });
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /** Register a callback to fire once user + land types are loaded */
    function onReady(cb) {
        if (_ready) {
            cb();
        } else {
            _readyCallbacks.push(cb);
        }
    }

    /** Current user profile (null until loaded) */
    function getUser() {
        return _user;
    }

    /** Land types array for user's country (null until loaded) */
    function getLandTypes() {
        return _landTypes;
    }

    /** Return {center, zoom} for the user's country */
    function getMapDefaults() {
        const cc = _user ? _user.country_code : 'US';
        return MAP_DEFAULTS[cc] || MAP_DEFAULTS._default;
    }

    /** Format a depth_cm value for display based on unit preference */
    function formatDepth(cm) {
        if (cm == null) return '-';
        if (_user && _user.unit_preference === 'metric') {
            return parseFloat(cm).toFixed(1) + ' cm';
        }
        const inches = cm / 2.54;
        return inches.toFixed(1) + '"';
    }

    /** Is the user using metric units? */
    function isMetric() {
        return _user && _user.unit_preference === 'metric';
    }

    /** Depth label for form fields */
    function depthLabel() {
        return isMetric() ? _t('units.depthCm') : _t('units.depthInches');
    }

    /** Convert user-entered depth input to cm for storage */
    function depthInputToCm(value) {
        if (value == null || value === '') return null;
        const num = parseFloat(value);
        if (isNaN(num)) return null;
        if (isMetric()) return num;
        return +(num * 2.54).toFixed(1);
    }

    /** Convert depth_cm from API to display value (inches or cm) */
    function depthForInput(cm) {
        if (cm == null) return '';
        if (isMetric()) return parseFloat(cm).toFixed(1);
        return (cm / 2.54).toFixed(1);
    }

    /**
     * Update user preferences via API, refresh local state.
     * Returns a promise.
     */
    function updatePreferences(prefs) {
        return Auth.authedFetch('/api/auth/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(prefs)
        })
        .then(function (res) { return res.json(); })
        .then(function (body) {
            if (body.success && body.data) {
                _user = body.data;
                // If country changed, refetch land types
                if (prefs.country_code && prefs.country_code !== (_user.country_code)) {
                    return fetchLandTypes(_user.country_code);
                }
            }
            return body;
        });
    }

    /**
     * Populate a <select> element with land type options from the API.
     * Adds a "Custom..." option at the bottom that prompts for a label.
     */
    function populateLandTypeSelect(selectEl, currentValue) {
        if (!selectEl) return;
        const types = _landTypes || [];

        // Keep the first "Select..." placeholder if it exists
        selectEl.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = _t('common.select');
        selectEl.appendChild(placeholder);

        types.forEach(function (lt) {
            const opt = document.createElement('option');
            opt.value = lt.code;
            opt.textContent = lt.label;
            if (currentValue && lt.code === currentValue) {
                opt.selected = true;
            }
            selectEl.appendChild(opt);
        });

        // Custom option
        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = 'Custom...';
        selectEl.appendChild(customOpt);

        // Handle custom selection
        selectEl.addEventListener('change', function () {
            if (selectEl.value === '__custom__') {
                const label = prompt('Enter custom land type:');
                if (label && label.trim()) {
                    const code = label.trim().toLowerCase().replace(/\s+/g, '_');
                    const opt = document.createElement('option');
                    opt.value = code;
                    opt.textContent = label.trim();
                    opt.selected = true;
                    selectEl.insertBefore(opt, customOpt);
                } else {
                    selectEl.value = currentValue || '';
                }
            }
        });
    }

    /**
     * Get the display label for a land type code.
     * Falls back to title-casing the code.
     */
    function landTypeLabel(code) {
        if (!code) return 'Unknown';
        const types = _landTypes || [];
        for (let i = 0; i < types.length; i++) {
            if (types[i].code === code) return types[i].label;
        }
        // Fallback: title-case the code
        return code.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    // ------------------------------------------------------------------
    // Toggle units (called by auth.js user dropdown)
    // ------------------------------------------------------------------
    function toggleUnits() {
        const newPref = isMetric() ? 'imperial' : 'metric';
        return updatePreferences({ unit_preference: newPref }).then(function () {
            window.location.reload();
        });
    }

    /** Get the current unit display label */
    function unitLabel() {
        return isMetric() ? _t('units.toggleMetric') : _t('units.toggleImperial');
    }

    // ------------------------------------------------------------------
    // Language dropdown in navbar (authenticated pages)
    // ------------------------------------------------------------------
    const SUPPORTED_LANGS = (typeof I18n !== 'undefined' && I18n.SUPPORTED_LANGS)
        ? I18n.SUPPORTED_LANGS
        : [
            { code: 'en', label: 'EN', name: 'English' },
            { code: 'es', label: 'ES', name: 'Español' },
            { code: 'fr', label: 'FR', name: 'Français' }
          ];

    function injectLanguageSelector() {
        const navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        const currentLang = (_user && _user.language_preference) || 'en';
        let currentLabel = 'EN';
        SUPPORTED_LANGS.forEach(function (l) {
            if (l.code === currentLang) currentLabel = l.label;
        });

        const wrapper = document.createElement('div');
        wrapper.className = 'nav-dropdown';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nav-dropdown-toggle';
        toggle.innerHTML = '&#127760; ' + currentLabel + ' <span class="nav-dropdown-chevron">&#9662;</span>';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-haspopup', 'true');

        const menu = document.createElement('div');
        menu.className = 'nav-dropdown-menu';
        menu.setAttribute('role', 'menu');

        SUPPORTED_LANGS.forEach(function (lang) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'nav-dropdown-item' + (lang.code === currentLang ? ' active' : '');
            item.setAttribute('role', 'menuitem');
            const checkMark = lang.code === currentLang ? '&#10003;' : '&nbsp;';
            item.innerHTML = '<span class="nav-dropdown-item-check">' + checkMark + '</span> ' +
                             lang.name;
            item.addEventListener('click', function () {
                if (lang.code === currentLang) {
                    wrapper.classList.remove('open');
                    return;
                }
                updatePreferences({ language_preference: lang.code }).then(function () {
                    window.location.reload();
                });
            });
            menu.appendChild(item);
        });

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            // Close any other open dropdowns first
            document.querySelectorAll('.nav-dropdown.open').forEach(function (dd) {
                if (dd !== wrapper) dd.classList.remove('open');
            });
            const isOpen = wrapper.classList.toggle('open');
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

    // ------------------------------------------------------------------
    // Auto-init when script loads
    // ------------------------------------------------------------------
    init();

    // Inject language selector once config is ready
    onReady(function () {
        // Re-bind _t now that I18n is loaded
        _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };
        injectLanguageSelector();
    });

    return {
        onReady: onReady,
        getUser: getUser,
        getLandTypes: getLandTypes,
        getMapDefaults: getMapDefaults,
        formatDepth: formatDepth,
        isMetric: isMetric,
        depthLabel: depthLabel,
        depthInputToCm: depthInputToCm,
        depthForInput: depthForInput,
        updatePreferences: updatePreferences,
        populateLandTypeSelect: populateLandTypeSelect,
        landTypeLabel: landTypeLabel,
        toggleUnits: toggleUnits,
        unitLabel: unitLabel
    };
})();
