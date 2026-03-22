/**
 * Legal page — API-driven legal content.
 * Fetches national + regional content from /api/legal, renders accordion sections.
 * Suggestion system is in legal-suggest.js.
 */
(function () {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function (k) { return k; };

    var countrySelect = document.getElementById('legal-country');
    var regionSelect = document.getElementById('legal-region');
    var regionWrapper = document.getElementById('region-selector-wrapper');
    var nationalContainer = document.getElementById('legal-national-content');
    var regionalContainer = document.getElementById('legal-regional-content');

    if (!countrySelect) return;

    var SEVERITY_CLASSES = {
        ok: 'legal-ok',
        caution: 'legal-caution',
        warning: 'legal-warning',
        danger: 'legal-danger'
    };

    /* ------------------------------------------------------------------ */
    /*  Region label mapping                                               */
    /* ------------------------------------------------------------------ */
    var REGION_LABELS = {
        AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
        CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
        HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
        KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
        MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
        MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
        NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
        OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
        SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
        VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
        ENG: 'England', SCT: 'Scotland', WLS: 'Wales', NIR: 'Northern Ireland',
        VIC: 'Victoria', WA_AU: 'Western Australia', QLD: 'Queensland', NSW: 'New South Wales',
        SA: 'South Australia', TAS: 'Tasmania',
        ON: 'Ontario', BC: 'British Columbia', AB: 'Alberta', QC: 'Quebec',
        MB: 'Manitoba', SK: 'Saskatchewan', NS: 'Nova Scotia', NB: 'New Brunswick',
        PE: 'Prince Edward Island', NL: 'Newfoundland and Labrador',
        YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut',
        OTA: 'Otago', WTC: 'West Coast', CAN: 'Canterbury', AUK: 'Auckland',
        BOP: 'Bay of Plenty', STL: 'Southland'
    };

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /* ------------------------------------------------------------------ */
    /*  Fetch & render                                                     */
    /* ------------------------------------------------------------------ */
    async function loadContent(country, region) {
        var lang = (typeof I18n !== 'undefined' && I18n.getLang) ? I18n.getLang() : 'en';
        var url = '/api/legal?country=' + encodeURIComponent(country) + '&lang=' + encodeURIComponent(lang);
        if (region) url += '&region=' + encodeURIComponent(region);

        nationalContainer.innerHTML = '<p class="text-muted">' + escapeHtml(_t('common.loading')) + '</p>';
        regionalContainer.innerHTML = '';

        try {
            var res = await Auth.authedFetch(url);
            var body = await res.json();
            if (!body.success) throw new Error('API error');

            renderSections(nationalContainer, body.data.national, country);
            if (region && body.data.regional && body.data.regional.length > 0) {
                var regionLabel = REGION_LABELS[region] || region;
                regionalContainer.innerHTML = '<h2 style="margin-top:2rem;margin-bottom:1rem;">' +
                    escapeHtml(regionLabel) + '</h2>';
                var regionAccordion = document.createElement('div');
                regionalContainer.appendChild(regionAccordion);
                renderSections(regionAccordion, body.data.regional, country);
            } else if (region) {
                regionalContainer.innerHTML = '<div style="margin-top:1.5rem;" class="empty-state">' +
                    '<p class="text-muted">' + escapeHtml(_t('legal.noContent')) + '</p></div>';
            }
        } catch (err) {
            console.error('Error loading legal content:', err);
            nationalContainer.innerHTML = '<p class="error-text">' +
                escapeHtml(_t('legal.noContent')) + '</p>';
        }
    }

    function renderSections(container, sections, country) {
        if (!sections || sections.length === 0) {
            container.innerHTML = '<p class="text-muted">' + escapeHtml(_t('legal.noContent')) + '</p>';
            return;
        }

        var html = '<div class="accordion">';
        sections.forEach(function (section) {
            var openClass = window.innerWidth >= 768 ? ' open' : '';
            html += '<div class="accordion-item' + openClass + '">';
            html += '<button class="accordion-header" onclick="this.parentElement.classList.toggle(\'open\')">';
            html += '<span>' + escapeHtml(section.section_title) + '</span>';
            html += '<span class="accordion-icon">+</span>';
            html += '</button>';
            html += '<div class="accordion-body">';
            html += section.content_html;
            if (section.last_verified || section.source_url) {
                html += '<div class="legal-meta" style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--color-border, #e0e0e0);font-size:0.85rem;color:var(--color-text-muted, #888);">';
                if (section.last_verified) {
                    html += '<span>' + escapeHtml(_t('legal.lastVerified', { date: section.last_verified })) + '</span>';
                }
                if (section.source_url) {
                    var urls = section.source_url.split(' ').filter(function (u) { return u.trim(); });
                    if (urls.length > 0) {
                        html += '<div style="margin-top:0.5rem;">';
                        html += '<span style="font-weight:600;">&#128279; ' + escapeHtml(_t('legal.verifySources')) + '</span>';
                        html += '<ul style="margin:0.35rem 0 0;padding-left:1.25rem;list-style:none;">';
                        urls.forEach(function (url) {
                            url = url.trim();
                            var display = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
                            if (display.length > 60) display = display.substring(0, 57) + '...';
                            html += '<li style="margin-bottom:0.2rem;"><a href="' + escapeHtml(url) +
                                '" target="_blank" rel="noopener" style="color:var(--color-primary, #6b4f36);text-decoration:underline;">' +
                                escapeHtml(display) + ' &#8599;</a></li>';
                        });
                        html += '</ul></div>';
                    }
                }
                html += '</div>';
            }
            html += '</div></div>';
        });
        html += '</div>';
        container.innerHTML = html;
    }

    /* ------------------------------------------------------------------ */
    /*  Region dropdown                                                    */
    /* ------------------------------------------------------------------ */
    async function loadRegions(country) {
        try {
            var res = await Auth.authedFetch('/api/legal/regions?country=' + encodeURIComponent(country));
            var body = await res.json();
            if (!body.success) return;
            var regions = body.data || [];
            if (regions.length === 0) {
                regionWrapper.style.display = 'none';
                regionSelect.innerHTML = '';
                return;
            }
            regionWrapper.style.display = '';
            regionSelect.innerHTML = '<option value="">' + escapeHtml(_t('legal.selectRegion')) + '</option>';
            regions.forEach(function (code) {
                var opt = document.createElement('option');
                opt.value = code;
                opt.textContent = REGION_LABELS[code] || code;
                regionSelect.appendChild(opt);
            });
        } catch (err) {
            console.error('Error loading regions:', err);
            regionWrapper.style.display = 'none';
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Event handlers                                                     */
    /* ------------------------------------------------------------------ */
    countrySelect.addEventListener('change', function () {
        regionSelect.value = '';
        regionalContainer.innerHTML = '';
        var LP = window.LegalPage;
        loadRegions(countrySelect.value);
        LP.loadContent(countrySelect.value, null);
    });

    regionSelect.addEventListener('change', function () {
        var LP = window.LegalPage;
        LP.loadContent(countrySelect.value, regionSelect.value || null);
    });

    /* ------------------------------------------------------------------ */
    /*  Reverse lookup: region name → region code                          */
    /* ------------------------------------------------------------------ */
    var REGION_NAME_TO_CODE = {};
    Object.keys(REGION_LABELS).forEach(function (code) {
        REGION_NAME_TO_CODE[REGION_LABELS[code].toLowerCase()] = code;
    });

    /* ------------------------------------------------------------------ */
    /*  Geolocation helper                                                 */
    /* ------------------------------------------------------------------ */
    async function setCountryAndRegion(country, regionCode) {
        var opts = countrySelect.options;
        for (var i = 0; i < opts.length; i++) {
            if (opts[i].value === country) { countrySelect.value = country; break; }
        }

        loadRegions(country);

        if (regionCode) {
            try {
                var res = await Auth.authedFetch('/api/legal/regions?country=' + encodeURIComponent(country));
                var body = await res.json();
                if (!body.success) { window.LegalPage.loadContent(country, null); return; }
                var regions = body.data || [];
                if (regions.indexOf(regionCode) !== -1) {
                    regionSelect.value = regionCode;
                    window.LegalPage.loadContent(country, regionCode);
                } else {
                    window.LegalPage.loadContent(country, null);
                }
            } catch (err) {
                console.error('Error setting country and region:', err);
                window.LegalPage.loadContent(country, null);
            }
        } else {
            window.LegalPage.loadContent(country, null);
        }
    }

    function detectLocation() {
        if (!navigator.geolocation) { setCountryAndRegion('US', null); return; }

        navigator.geolocation.getCurrentPosition(
            async function (pos) {
                var lat = pos.coords.latitude;
                var lng = pos.coords.longitude;
                // External API — keep as raw fetch (not our API)
                try {
                    var geoRes = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' +
                        lat + '&lon=' + lng + '&zoom=5&addressdetails=1',
                        { headers: { 'Accept': 'application/json' } });
                    var data = await geoRes.json();
                    var addr = data.address || {};
                    var country = (addr.country_code || 'us').toUpperCase();
                    var supported = ['US', 'GB', 'AU', 'CA', 'NZ'];
                    if (supported.indexOf(country) === -1) country = 'US';
                    var stateName = addr.state || addr.county || '';
                    var regionCode = REGION_NAME_TO_CODE[stateName.toLowerCase()] || null;
                    setCountryAndRegion(country, regionCode);
                } catch (err) {
                    console.error('Error detecting location:', err);
                    setCountryAndRegion('US', null);
                }
            },
            function () { setCountryAndRegion('US', null); },
            { timeout: 5000 }
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Expose namespace for legal-suggest.js                              */
    /* ------------------------------------------------------------------ */
    window.LegalPage = {
        loadContent: loadContent,
        renderSections: renderSections,
        escapeHtml: escapeHtml,
        _t: _t,
        REGION_LABELS: REGION_LABELS,
        nationalContainer: nationalContainer,
        regionalContainer: regionalContainer,
        countrySelect: countrySelect,
        regionSelect: regionSelect
    };

    /* ------------------------------------------------------------------ */
    /*  Nav toggle: show authed vs public nav based on token               */
    /* ------------------------------------------------------------------ */
    function initNavToggle() {
        if (localStorage.getItem('mdt_token')) {
            var authed = document.getElementById('nav-authed');
            var pub = document.getElementById('nav-public');
            if (authed) authed.style.display = '';
            if (pub) pub.style.display = 'none';
        }
    }
    initNavToggle();

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */
    function initLegal() {
        _t = (typeof I18n !== 'undefined') ? I18n.t : function (k) { return k; };
        window.LegalPage._t = _t;

        if (window.AppConfig) {
            var user = AppConfig.getUser();
            if (user && user.country_code) {
                setCountryAndRegion(user.country_code, null);
                return;
            }
        }
        detectLocation();
    }

    if (window.AppConfig) {
        AppConfig.onReady(initLegal);
    } else {
        document.addEventListener('DOMContentLoaded', function () {
            if (typeof I18n !== 'undefined' && I18n.onReady) {
                I18n.onReady(initLegal);
            } else {
                initLegal();
            }
        });
    }
})();
