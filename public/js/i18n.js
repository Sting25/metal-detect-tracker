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

    let _strings = {};
    let _lang = 'en';
    let _ready = false;
    let _callbacks = [];

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
        let str = _strings[key];
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
        const pluralKey = count === 1 ? key + '.one' : key + '.other';
        const merged = {};
        if (params) { for (const k in params) { merged[k] = params[k]; } }
        merged.count = count;
        return t(pluralKey, merged);
    }

    /**
     * Scan the DOM for data-i18n attributes and replace text content.
     * Supports: data-i18n (textContent), data-i18n-placeholder, data-i18n-title,
     *           data-i18n-html (innerHTML for trusted content)
     */
    function translatePage() {
        const els = document.querySelectorAll('[data-i18n]');
        for (let i = 0; i < els.length; i++) {
            const key = els[i].getAttribute('data-i18n');
            const val = _strings[key];
            if (val !== undefined) els[i].textContent = val;
        }
        const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
        for (let j = 0; j < placeholders.length; j++) {
            const pkey = placeholders[j].getAttribute('data-i18n-placeholder');
            const pval = _strings[pkey];
            if (pval !== undefined) placeholders[j].placeholder = pval;
        }
        const titles = document.querySelectorAll('[data-i18n-title]');
        for (let k = 0; k < titles.length; k++) {
            const tkey = titles[k].getAttribute('data-i18n-title');
            const tval = _strings[tkey];
            if (tval !== undefined) titles[k].title = tval;
        }
        const htmlEls = document.querySelectorAll('[data-i18n-html]');
        for (let l = 0; l < htmlEls.length; l++) {
            const hkey = htmlEls[l].getAttribute('data-i18n-html');
            const hval = _strings[hkey];
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
        let saved = null;
        try { saved = localStorage.getItem('mdt_lang'); } catch (e) { /* ignore */ }
        if (saved && ['en', 'es', 'fr'].indexOf(saved) !== -1) {
            return init(saved);
        }
        const navLang = (navigator.language || 'en').split('-')[0].toLowerCase();
        if (['en', 'es', 'fr'].indexOf(navLang) !== -1) {
            return init(navLang);
        }
        return init('en');
    }

    // ------------------------------------------------------------------
    // Public language selector dropdown (for unauthenticated pages)
    // ------------------------------------------------------------------
    const SUPPORTED_LANGS = [
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
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const currentLang = _lang || 'en';
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
                try { localStorage.setItem('mdt_lang', lang.code); } catch (e) { /* ignore */ }
                window.location.reload();
            });
            menu.appendChild(item);
        });

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            const isOpen = wrapper.classList.toggle('open');
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
