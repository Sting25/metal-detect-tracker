/**
 * Legal page — suggestion system for logged-in users.
 * Depends on legal.js being loaded first (uses window.LegalPage namespace).
 */
(function () {
    'use strict';

    var LP = window.LegalPage;
    if (!LP) return;

    var _loadedSections = [];

    var SUGGESTION_STATUS_COLORS = {
        pending: 'var(--color-warning, #f59e0b)',
        approved: 'var(--color-primary, #6b4f36)',
        rejected: 'var(--color-status-red, #ef4444)',
        applied: 'var(--color-status-green, #22c55e)',
    };

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

    // Wrap loadContent to capture sections for the suggest dropdown
    var _origLoadContent = LP.loadContent;
    LP.loadContent = async function (country, region) {
        var lang = (typeof I18n !== 'undefined' && I18n.getLang) ? I18n.getLang() : 'en';
        var url = '/api/legal?country=' + encodeURIComponent(country) + '&lang=' + encodeURIComponent(lang);
        if (region) url += '&region=' + encodeURIComponent(region);

        LP.nationalContainer.innerHTML = '<p class="text-muted">' + LP.escapeHtml(LP._t('common.loading')) + '</p>';
        LP.regionalContainer.innerHTML = '';

        try {
            var res = await Auth.authedFetch(url);
            var body = await res.json();
            if (!body.success) throw new Error('API error');

            // Capture sections for suggest dropdown
            _loadedSections = (body.data.national || []).concat(body.data.regional || []);
            populateSectionDropdown();

            LP.renderSections(LP.nationalContainer, body.data.national, country);
            if (region && body.data.regional && body.data.regional.length > 0) {
                var regionLabel = LP.REGION_LABELS[region] || region;
                LP.regionalContainer.innerHTML = '<h2 style="margin-top:2rem;margin-bottom:1rem;">' +
                    LP.escapeHtml(regionLabel) + '</h2>';
                var regionAccordion = document.createElement('div');
                LP.regionalContainer.appendChild(regionAccordion);
                LP.renderSections(regionAccordion, body.data.regional, country);
            } else if (region) {
                LP.regionalContainer.innerHTML = '<div style="margin-top:1.5rem;" class="empty-state">' +
                    '<p class="text-muted">' + LP.escapeHtml(LP._t('legal.noContent')) + '</p></div>';
            }
        } catch (err) {
            console.error('Error loading legal content:', err);
            LP.nationalContainer.innerHTML = '<p class="error-text">' +
                LP.escapeHtml(LP._t('legal.noContent')) + '</p>';
        }
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
            html += '<span style="font-weight:600;font-size:0.9rem;">' + LP.escapeHtml(typeLabel) + '</span>';
            html += '<span style="font-size:0.8rem;font-weight:600;padding:2px 8px;border-radius:10px;background:' + statusColor + ';color:#fff;text-transform:uppercase;">' + LP.escapeHtml(s.status) + '</span>';
            html += '</div>';
            html += '<p style="margin:0 0 0.25rem;font-size:0.85rem;color:var(--color-text, #333);">' + LP.escapeHtml(s.suggested_text.length > 100 ? s.suggested_text.substring(0, 100) + '...' : s.suggested_text) + '</p>';
            if (s.admin_notes) {
                html += '<p style="margin:0 0 0.25rem;font-size:0.8rem;color:var(--color-text-muted, #888);font-style:italic;">Admin: ' + LP.escapeHtml(s.admin_notes) + '</p>';
            }
            html += '<span style="font-size:0.75rem;color:var(--color-text-muted, #888);">' + LP.escapeHtml(date) + '</span>';
            html += '</div>';
        });
        list.innerHTML = html;
    }

    async function loadMySuggestions() {
        if (!window.Auth || !Auth.getToken()) return;
        try {
            var res = await Auth.authedFetch('/api/legal/suggestions');
            var body = await res.json();
            if (body.success) renderMySuggestions(body.data);
        } catch (err) {
            console.error('Error loading suggestions:', err);
        }
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

        if (!window.Auth || !Auth.getToken()) return;
        suggestSection.style.display = '';

        loadMySuggestions();

        suggestBtn.addEventListener('click', async function () {
            var message = (suggestText.value || '').trim();
            if (!message) {
                suggestStatus.textContent = window.I18n ? I18n.t('legal.suggest.error') : 'Please enter a suggestion.';
                suggestStatus.style.color = 'var(--color-status-red, #ef4444)';
                return;
            }

            var country = LP.countrySelect.value || 'US';
            var region = LP.regionSelect.value || '';
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

            try {
                var res = await Auth.authedFetch('/api/legal/suggestions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                var body = await res.json();
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
            } catch (err) {
                console.error('Error submitting suggestion:', err);
                suggestStatus.textContent = window.I18n ? I18n.t('legal.suggest.error') : 'Failed to submit. Please try again.';
                suggestStatus.style.color = 'var(--color-status-red, #ef4444)';
            } finally {
                suggestBtn.disabled = false;
                suggestBtn.textContent = window.I18n ? I18n.t('legal.suggest.submit') : 'Submit Suggestion';
            }
        });
    }

    // Init suggest after auth check
    if (window.AppConfig) {
        AppConfig.onReady(initSuggest);
    } else if (localStorage.getItem('mdt_token')) {
        document.addEventListener('DOMContentLoaded', initSuggest);
    }
})();
