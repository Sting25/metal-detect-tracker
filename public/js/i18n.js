/**
 * I18n — Internationalization module for Metal Detector Location Tracker
 *
 * Loaded on every page. Provides:
 * - t(key, params) for JS string lookups with {name} interpolation
 * - tPlural(key, count, params) for pluralized strings
 * - translatePage() to scan data-i18n attributes in the DOM
 * - onReady(cb) for post-load callbacks
 */
window.I18n = (function () {
    'use strict';

    var _strings = {};
    var _lang = 'en';
    var _ready = false;
    var _callbacks = [];

    /**
     * Initialize with a language code. Fetches the locale JSON file.
     * Falls back to English if the requested locale is missing.
     */
    function init(lang) {
        _lang = lang || 'en';
        return fetch('/locales/' + _lang + '.json')
            .then(function (res) {
                if (!res.ok) throw new Error('missing locale');
                return res.json();
            })
            .catch(function () {
                if (_lang !== 'en') {
                    return fetch('/locales/en.json')
                        .then(function (r) { return r.ok ? r.json() : {}; })
                        .catch(function () { return {}; });
                }
                return {};
            })
            .then(function (data) {
                _strings = data || {};
                _ready = true;
                translatePage();
                _callbacks.forEach(function (cb) { cb(); });
                _callbacks = [];
            });
    }

    /**
     * Look up a translation key. Supports {name} interpolation.
     * Returns the key itself if no translation found.
     */
    function t(key, params) {
        var str = _strings[key];
        if (str === undefined) return key;
        if (params) {
            Object.keys(params).forEach(function (k) {
                str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
            });
        }
        return str;
    }

    /**
     * Pluralized lookup. Uses key.one for count===1, key.other otherwise.
     */
    function tPlural(key, count, params) {
        var pluralKey = count === 1 ? key + '.one' : key + '.other';
        var merged = {};
        if (params) { for (var k in params) { merged[k] = params[k]; } }
        merged.count = count;
        return t(pluralKey, merged);
    }

    /**
     * Scan the DOM for data-i18n attributes and replace text content.
     * Supports: data-i18n (textContent), data-i18n-placeholder, data-i18n-title,
     *           data-i18n-html (innerHTML for trusted content)
     */
    function translatePage() {
        var els = document.querySelectorAll('[data-i18n]');
        for (var i = 0; i < els.length; i++) {
            var key = els[i].getAttribute('data-i18n');
            var val = _strings[key];
            if (val !== undefined) els[i].textContent = val;
        }
        var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
        for (var j = 0; j < placeholders.length; j++) {
            var pkey = placeholders[j].getAttribute('data-i18n-placeholder');
            var pval = _strings[pkey];
            if (pval !== undefined) placeholders[j].placeholder = pval;
        }
        var titles = document.querySelectorAll('[data-i18n-title]');
        for (var k = 0; k < titles.length; k++) {
            var tkey = titles[k].getAttribute('data-i18n-title');
            var tval = _strings[tkey];
            if (tval !== undefined) titles[k].title = tval;
        }
        var htmlEls = document.querySelectorAll('[data-i18n-html]');
        for (var l = 0; l < htmlEls.length; l++) {
            var hkey = htmlEls[l].getAttribute('data-i18n-html');
            var hval = _strings[hkey];
            if (hval !== undefined) htmlEls[l].innerHTML = hval;
        }
    }

    /** Register a callback for when translations are loaded */
    function onReady(cb) {
        if (_ready) { cb(); } else { _callbacks.push(cb); }
    }

    /** Get current language code */
    function getLang() { return _lang; }

    /** Check if a key exists in the loaded translations */
    function has(key) { return _strings[key] !== undefined; }

    /**
     * Auto-init for unauthenticated pages (no AppConfig).
     * Detects language from localStorage or navigator.language.
     */
    function autoInit() {
        var saved = null;
        try { saved = localStorage.getItem('mdt_lang'); } catch (e) { /* ignore */ }
        if (saved && ['en', 'es', 'fr'].indexOf(saved) !== -1) {
            return init(saved);
        }
        var navLang = (navigator.language || 'en').split('-')[0].toLowerCase();
        if (['en', 'es', 'fr'].indexOf(navLang) !== -1) {
            return init(navLang);
        }
        return init('en');
    }

    // ------------------------------------------------------------------
    // Public language selector dropdown (for unauthenticated pages)
    // ------------------------------------------------------------------
    var SUPPORTED_LANGS = [
        { code: 'en', label: 'EN', name: 'English' },
        { code: 'es', label: 'ES', name: 'Español' },
        { code: 'fr', label: 'FR', name: 'Français' }
    ];

    /**
     * Inject a language dropdown into the given container selector.
     * Used on landing.html and login.html where AppConfig is not loaded.
     * Saves selection to localStorage and reloads the page.
     */
    function injectLanguageSelector(containerSelector) {
        var container = document.querySelector(containerSelector);
        if (!container) return;

        var currentLang = _lang || 'en';
        var currentLabel = 'EN';
        SUPPORTED_LANGS.forEach(function (l) {
            if (l.code === currentLang) currentLabel = l.label;
        });

        var wrapper = document.createElement('div');
        wrapper.className = 'nav-dropdown';

        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nav-dropdown-toggle';
        toggle.innerHTML = '&#127760; ' + currentLabel + ' <span class="nav-dropdown-chevron">&#9662;</span>';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-haspopup', 'true');

        var menu = document.createElement('div');
        menu.className = 'nav-dropdown-menu';
        menu.setAttribute('role', 'menu');

        SUPPORTED_LANGS.forEach(function (lang) {
            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'nav-dropdown-item' + (lang.code === currentLang ? ' active' : '');
            item.setAttribute('role', 'menuitem');
            var checkMark = lang.code === currentLang ? '&#10003;' : '&nbsp;';
            item.innerHTML = '<span class="nav-dropdown-item-check">' + checkMark + '</span> ' +
                             lang.name;
            item.addEventListener('click', function () {
                if (lang.code === currentLang) {
                    wrapper.classList.remove('open');
                    return;
                }
                try { localStorage.setItem('mdt_lang', lang.code); } catch (e) { /* ignore */ }
                window.location.reload();
            });
            menu.appendChild(item);
        });

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = wrapper.classList.toggle('open');
            toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        wrapper.appendChild(toggle);
        wrapper.appendChild(menu);
        container.appendChild(wrapper);

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

    return {
        init: init,
        autoInit: autoInit,
        t: t,
        tPlural: tPlural,
        translatePage: translatePage,
        onReady: onReady,
        getLang: getLang,
        has: has,
        injectLanguageSelector: injectLanguageSelector,
        SUPPORTED_LANGS: SUPPORTED_LANGS
    };
})();
