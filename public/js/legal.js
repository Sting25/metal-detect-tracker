/**
 * Legal page — API-driven legal content.
 * Fetches national + regional content from /api/legal, renders accordion sections.
 * Supports country/region switching and language-aware content.
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

    // Severity badge/class mapping
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
        // US States
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
        // GB regions
        ENG: 'England', SCT: 'Scotland', WLS: 'Wales', NIR: 'Northern Ireland',
        // AU states
        VIC: 'Victoria', WA_AU: 'Western Australia', QLD: 'Queensland', NSW: 'New South Wales',
        SA: 'South Australia', TAS: 'Tasmania',
        // CA provinces & territories
        ON: 'Ontario', BC: 'British Columbia', AB: 'Alberta', QC: 'Quebec',
        MB: 'Manitoba', SK: 'Saskatchewan', NS: 'Nova Scotia', NB: 'New Brunswick',
        PE: 'Prince Edward Island', NL: 'Newfoundland and Labrador',
        YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut',
        // NZ regions
        OTA: 'Otago', WTC: 'West Coast', CAN: 'Canterbury', AUK: 'Auckland',
        BOP: 'Bay of Plenty', STL: 'Southland'
    };

    /* ------------------------------------------------------------------ */
    /*  Fetch & render                                                     */
    /* ------------------------------------------------------------------ */
    function loadContent(country, region) {
        var lang = (typeof I18n !== 'undefined' && I18n.getLang) ? I18n.getLang() : 'en';
        var url = '/api/legal?country=' + encodeURIComponent(country) + '&lang=' + encodeURIComponent(lang);
        if (region) {
            url += '&region=' + encodeURIComponent(region);
        }

        nationalContainer.innerHTML = '<p class="text-muted">' + Auth.escapeHtml(_t('common.loading')) + '</p>';
        regionalContainer.innerHTML = '';

        fetch(url)
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (!body.success) throw new Error('API error');

                renderSections(nationalContainer, body.data.national, country);
                if (region && body.data.regional && body.data.regional.length > 0) {
                    var regionLabel = REGION_LABELS[region] || region;
                    regionalContainer.innerHTML = '<h2 style="margin-top:2rem;margin-bottom:1rem;">' +
                        Auth.escapeHtml(regionLabel) + '</h2>';
                    var regionAccordion = document.createElement('div');
                    regionalContainer.appendChild(regionAccordion);
                    renderSections(regionAccordion, body.data.regional, country);
                } else if (region) {
                    regionalContainer.innerHTML = '<div style="margin-top:1.5rem;" class="empty-state">' +
                        '<p class="text-muted">' + Auth.escapeHtml(_t('legal.noContent')) + '</p></div>';
                }
            })
            .catch(function (err) {
                console.error('Error loading legal content:', err);
                nationalContainer.innerHTML = '<p class="error-text">' +
                    Auth.escapeHtml(_t('legal.noContent')) + '</p>';
            });
    }

    function renderSections(container, sections, country) {
        if (!sections || sections.length === 0) {
            container.innerHTML = '<p class="text-muted">' + Auth.escapeHtml(_t('legal.noContent')) + '</p>';
            return;
        }

        var html = '<div class="accordion">';
        sections.forEach(function (section) {
            var severityClass = section.severity ? SEVERITY_CLASSES[section.severity] || '' : '';
            var openClass = window.innerWidth >= 768 ? ' open' : '';

            html += '<div class="accordion-item' + openClass + '">';
            html += '<button class="accordion-header" onclick="this.parentElement.classList.toggle(\'open\')">';
            html += '<span>' + Auth.escapeHtml(section.section_title) + '</span>';
            html += '<span class="accordion-icon">+</span>';
            html += '</button>';
            html += '<div class="accordion-body">';
            // content_html is trusted (from our database)
            html += section.content_html;
            // Metadata line
            if (section.last_verified || section.source_url) {
                html += '<div class="legal-meta" style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--color-border, #e0e0e0);font-size:0.85rem;color:var(--color-text-muted, #888);">';
                if (section.last_verified) {
                    html += '<span>' + Auth.escapeHtml(_t('legal.lastVerified', { date: section.last_verified })) + '</span>';
                }
                if (section.source_url) {
                    // Support multiple URLs separated by spaces
                    var urls = section.source_url.split(' ').filter(function (u) { return u.trim(); });
                    if (urls.length > 0) {
                        html += '<div style="margin-top:0.5rem;">';
                        html += '<span style="font-weight:600;">&#128279; ' + Auth.escapeHtml(_t('legal.verifySources')) + '</span>';
                        html += '<ul style="margin:0.35rem 0 0;padding-left:1.25rem;list-style:none;">';
                        urls.forEach(function (url) {
                            url = url.trim();
                            var display = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
                            if (display.length > 60) display = display.substring(0, 57) + '...';
                            html += '<li style="margin-bottom:0.2rem;"><a href="' + Auth.escapeHtml(url) +
                                '" target="_blank" rel="noopener" style="color:var(--color-primary, #6b4f36);text-decoration:underline;">' +
                                Auth.escapeHtml(display) + ' &#8599;</a></li>';
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
    function loadRegions(country) {
        fetch('/api/legal/regions?country=' + encodeURIComponent(country))
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (!body.success) return;

                var regions = body.data || [];
                if (regions.length === 0) {
                    regionWrapper.style.display = 'none';
                    regionSelect.innerHTML = '';
                    return;
                }

                regionWrapper.style.display = '';
                regionSelect.innerHTML = '<option value="">' + Auth.escapeHtml(_t('legal.selectRegion')) + '</option>';
                regions.forEach(function (code) {
                    var opt = document.createElement('option');
                    opt.value = code;
                    opt.textContent = REGION_LABELS[code] || code;
                    regionSelect.appendChild(opt);
                });
            })
            .catch(function () {
                regionWrapper.style.display = 'none';
            });
    }

    /* ------------------------------------------------------------------ */
    /*  Event handlers                                                     */
    /* ------------------------------------------------------------------ */
    countrySelect.addEventListener('change', function () {
        var country = countrySelect.value;
        regionSelect.value = '';
        regionalContainer.innerHTML = '';
        loadRegions(country);
        loadContent(country, null);
    });

    regionSelect.addEventListener('change', function () {
        var country = countrySelect.value;
        var region = regionSelect.value || null;
        loadContent(country, region);
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
    function setCountryAndRegion(country, regionCode) {
        // Set country dropdown
        var opts = countrySelect.options;
        for (var i = 0; i < opts.length; i++) {
            if (opts[i].value === country) {
                countrySelect.value = country;
                break;
            }
        }

        loadRegions(country);

        if (regionCode) {
            // Wait for regions to load, then select and load content
            fetch('/api/legal/regions?country=' + encodeURIComponent(country))
                .then(function (res) { return res.json(); })
                .then(function (body) {
                    if (!body.success) return;
                    var regions = body.data || [];
                    // Only select if this region exists in the data
                    var found = regions.indexOf(regionCode) !== -1;
                    if (found) {
                        regionSelect.value = regionCode;
                        loadContent(country, regionCode);
                    } else {
                        loadContent(country, null);
                    }
                })
                .catch(function () {
                    loadContent(country, null);
                });
        } else {
            loadContent(country, null);
        }
    }

    function detectLocation() {
        if (!navigator.geolocation) {
            setCountryAndRegion('US', null);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            function (pos) {
                var lat = pos.coords.latitude;
                var lng = pos.coords.longitude;
                var url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' +
                    lat + '&lon=' + lng + '&zoom=5&addressdetails=1';

                fetch(url, { headers: { 'Accept': 'application/json' } })
                    .then(function (res) { return res.json(); })
                    .then(function (data) {
                        var addr = data.address || {};
                        var country = (addr.country_code || 'us').toUpperCase();

                        // Map country codes to supported countries, fall back to US
                        var supported = ['US', 'GB', 'AU', 'CA', 'NZ'];
                        if (supported.indexOf(country) === -1) country = 'US';

                        // Try to find region code from state name
                        var stateName = addr.state || addr.county || '';
                        var regionCode = REGION_NAME_TO_CODE[stateName.toLowerCase()] || null;

                        setCountryAndRegion(country, regionCode);
                    })
                    .catch(function () {
                        setCountryAndRegion('US', null);
                    });
            },
            function () {
                // Geolocation denied or failed
                setCountryAndRegion('US', null);
            },
            { timeout: 5000 }
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Init — default to user's country, then load                       */
    /* ------------------------------------------------------------------ */
    function initLegal() {
        // Re-bind _t now that I18n may be loaded
        _t = (typeof I18n !== 'undefined') ? I18n.t : function (k) { return k; };

        // Priority: 1) logged-in user's saved country, 2) geolocation, 3) US
        if (window.AppConfig) {
            var user = AppConfig.getUser();
            if (user && user.country_code) {
                setCountryAndRegion(user.country_code, null);
                return;
            }
        }

        detectLocation();
    }

    // Wait for AppConfig (which now also waits for I18n on unauthenticated
    // pages), otherwise fall back to DOMContentLoaded + I18n.onReady.
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

    /* ------------------------------------------------------------------ */
    /*  Suggest Update (logged-in users only)                              */
    /* ------------------------------------------------------------------ */

    // Track loaded sections for the "Related Section" dropdown
    var _loadedSections = [];

    function populateSectionDropdown() {
        var sectionRef = document.getElementById('legal-suggest-section-ref');
        if (!sectionRef) return;

        sectionRef.innerHTML = '<option value="">(None / General)</option>';
        _loadedSections.forEach(function (s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.section_title;
            sectionRef.appendChild(opt);
        });
    }

    // Wrap the original loadContent to capture sections for the dropdown
    var _origLoadContent = loadContent;
    loadContent = function (country, region) {
        var lang = (typeof I18n !== 'undefined' && I18n.getLang) ? I18n.getLang() : 'en';
        var url = '/api/legal?country=' + encodeURIComponent(country) + '&lang=' + encodeURIComponent(lang);
        if (region) {
            url += '&region=' + encodeURIComponent(region);
        }

        nationalContainer.innerHTML = '<p class="text-muted">' + Auth.escapeHtml(_t('common.loading')) + '</p>';
        regionalContainer.innerHTML = '';

        fetch(url)
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (!body.success) throw new Error('API error');

                // Capture sections for suggest dropdown
                _loadedSections = (body.data.national || []).concat(body.data.regional || []);
                populateSectionDropdown();

                renderSections(nationalContainer, body.data.national, country);
                if (region && body.data.regional && body.data.regional.length > 0) {
                    var regionLabel = REGION_LABELS[region] || region;
                    regionalContainer.innerHTML = '<h2 style="margin-top:2rem;margin-bottom:1rem;">' +
                        Auth.escapeHtml(regionLabel) + '</h2>';
                    var regionAccordion = document.createElement('div');
                    regionalContainer.appendChild(regionAccordion);
                    renderSections(regionAccordion, body.data.regional, country);
                } else if (region) {
                    regionalContainer.innerHTML = '<div style="margin-top:1.5rem;" class="empty-state">' +
                        '<p class="text-muted">' + Auth.escapeHtml(_t('legal.noContent')) + '</p></div>';
                }
            })
            .catch(function (err) {
                console.error('Error loading legal content:', err);
                nationalContainer.innerHTML = '<p class="error-text">' +
                    Auth.escapeHtml(_t('legal.noContent')) + '</p>';
            });
    };

    var SUGGESTION_STATUS_COLORS = {
        pending: 'var(--color-warning, #f59e0b)',
        approved: 'var(--color-primary, #6b4f36)',
        rejected: 'var(--color-status-red, #ef4444)',
        applied: 'var(--color-status-green, #22c55e)',
    };

    function renderMySuggestions(suggestions) {
        var list = document.getElementById('legal-my-suggestions-list');
        var container = document.getElementById('legal-my-suggestions');
        if (!list || !container) return;

        if (!suggestions || suggestions.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = '';
        var html = '';
        suggestions.forEach(function (s) {
            var typeLabel = s.suggestion_type || 'correction';
            typeLabel = typeLabel.replace('_', ' ');
            typeLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);

            var statusColor = SUGGESTION_STATUS_COLORS[s.status] || '#888';
            var date = s.created_at ? new Date(s.created_at).toLocaleDateString() : '';

            html += '<div class="suggestion-item" style="padding:0.75rem;border:1px solid var(--color-border, #e0e0e0);border-radius:var(--radius-sm, 6px);margin-bottom:0.5rem;background:var(--color-surface, #fff);">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">';
            html += '<span style="font-weight:600;font-size:0.9rem;">' + Auth.escapeHtml(typeLabel) + '</span>';
            html += '<span style="font-size:0.8rem;font-weight:600;padding:2px 8px;border-radius:10px;background:' + statusColor + ';color:#fff;text-transform:uppercase;">' + Auth.escapeHtml(s.status) + '</span>';
            html += '</div>';
            html += '<p style="margin:0 0 0.25rem;font-size:0.85rem;color:var(--color-text, #333);">' + Auth.escapeHtml(s.suggested_text.length > 100 ? s.suggested_text.substring(0, 100) + '...' : s.suggested_text) + '</p>';
            if (s.admin_notes) {
                html += '<p style="margin:0 0 0.25rem;font-size:0.8rem;color:var(--color-text-muted, #888);font-style:italic;">Admin: ' + Auth.escapeHtml(s.admin_notes) + '</p>';
            }
            html += '<span style="font-size:0.75rem;color:var(--color-text-muted, #888);">' + Auth.escapeHtml(date) + '</span>';
            html += '</div>';
        });
        list.innerHTML = html;
    }

    function loadMySuggestions() {
        if (!window.Auth || !Auth.getToken()) return;
        Auth.authedFetch('/api/legal/suggestions')
            .then(function (res) { return res.json(); })
            .then(function (body) {
                if (body.success) renderMySuggestions(body.data);
            })
            .catch(function () {});
    }

    function initSuggest() {
        var suggestSection = document.getElementById('legal-suggest-section');
        var suggestBtn = document.getElementById('btn-suggest-legal');
        var suggestText = document.getElementById('legal-suggest-text');
        var suggestReason = document.getElementById('legal-suggest-reason');
        var suggestType = document.getElementById('legal-suggest-type');
        var suggestSectionRef = document.getElementById('legal-suggest-section-ref');
        var suggestStatus = document.getElementById('legal-suggest-status');

        if (!suggestSection || !suggestBtn) return;

        // Only show for logged-in users
        if (!window.Auth || !Auth.getToken()) return;
        suggestSection.style.display = '';

        // Load existing suggestions
        loadMySuggestions();

        suggestBtn.addEventListener('click', function () {
            var message = (suggestText.value || '').trim();
            if (!message) {
                suggestStatus.textContent = window.I18n ? I18n.t('legal.suggest.error') : 'Please enter a suggestion.';
                suggestStatus.style.color = 'var(--color-status-red, #ef4444)';
                return;
            }

            var country = countrySelect.value || 'US';
            var region = regionSelect.value || '';
            var type = suggestType ? suggestType.value : 'correction';
            var sectionId = suggestSectionRef ? suggestSectionRef.value : '';
            var reason = suggestReason ? (suggestReason.value || '').trim() : '';

            suggestBtn.disabled = true;
            suggestBtn.textContent = window.I18n ? I18n.t('legal.suggest.submitting') : 'Submitting...';
            suggestStatus.textContent = '';

            var payload = {
                country_code: country,
                suggestion_type: type,
                suggested_text: message,
            };
            if (region) payload.region_code = region;
            if (sectionId) payload.legal_content_id = parseInt(sectionId, 10);
            if (reason) payload.reason = reason;

            Auth.authedFetch('/api/legal/suggestions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function (res) {
                return res.json();
            }).then(function (body) {
                if (body.success) {
                    suggestStatus.textContent = window.I18n ? I18n.t('legal.suggest.success') : 'Thank you! Your suggestion has been submitted for review.';
                    suggestStatus.style.color = 'var(--color-status-green, #22c55e)';
                    suggestText.value = '';
                    if (suggestReason) suggestReason.value = '';
                    if (suggestType) suggestType.value = 'correction';
                    if (suggestSectionRef) suggestSectionRef.value = '';
                    loadMySuggestions();
                } else {
                    throw new Error(body.error || 'Failed to submit');
                }
            }).catch(function (err) {
                console.error('Error submitting suggestion:', err);
                suggestStatus.textContent = window.I18n ? I18n.t('legal.suggest.error') : 'Failed to submit. Please try again.';
                suggestStatus.style.color = 'var(--color-status-red, #ef4444)';
            }).finally(function () {
                suggestBtn.disabled = false;
                suggestBtn.textContent = window.I18n ? I18n.t('legal.suggest.submit') : 'Submit Suggestion';
            });
        });
    }

    // Init suggest after auth check
    if (window.AppConfig) {
        AppConfig.onReady(initSuggest);
    } else if (localStorage.getItem('mdt_token')) {
        document.addEventListener('DOMContentLoaded', initSuggest);
    }

})();
