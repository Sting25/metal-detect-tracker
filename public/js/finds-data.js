/**
 * Finds page — data loading, tags, filtering, and grid rendering.
 * Adds functions to the shared window.FP namespace created by finds.js.
 */
(function (FP) {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    /* ------------------------------------------------------------------ */
    /*  Data Loading                                                      */
    /* ------------------------------------------------------------------ */
    FP.loadSitesDropdown = async function () {
        try {
            var res = await Auth.authedFetch('/api/sites');
            if (!res.ok) throw new Error('Failed to fetch sites');
            var json = await res.json();
            FP.allSites = json.data || [];
            var esc = FP.escapeHtml;

            // Populate modal dropdown
            var options = '<option value="">' + _t('finds.placeholder.selectSite') + '</option>';
            FP.allSites.forEach(function (s) {
                options += '<option value="' + s.id + '">' + esc(s.name || 'Unnamed') + '</option>';
            });
            options += '<option value="__new__">' + _t('finds.createSite') + '</option>';
            FP.els.site.innerHTML = options;

            // Populate filter dropdown
            var filterOpts = '<option value="">' + _t('finds.filter.allSites') + '</option>';
            FP.allSites.forEach(function (s) {
                filterOpts += '<option value="' + s.id + '">' + esc(s.name || 'Unnamed') + '</option>';
            });
            FP.els.filterSite.innerHTML = filterOpts;

            FP.setupQuickSiteCreate();
        } catch (err) {
            console.error('Error loading sites for dropdown:', err);
        }
    };

    FP.setupQuickSiteCreate = function () {
        var quickRow = document.getElementById('quick-site-create');
        var nameInput = document.getElementById('quick-site-name');
        var saveBtn = document.getElementById('quick-site-save');
        var cancelBtn = document.getElementById('quick-site-cancel');
        if (!quickRow || !nameInput || !saveBtn || !cancelBtn) return;

        FP.els.site.addEventListener('change', function () {
            if (FP.els.site.value === '__new__') {
                quickRow.classList.remove('hidden');
                nameInput.value = '';
                nameInput.focus();
                FP.els.site.removeAttribute('required');
            }
        });

        cancelBtn.addEventListener('click', function () {
            quickRow.classList.add('hidden');
            FP.els.site.value = '';
            FP.els.site.setAttribute('required', '');
        });

        saveBtn.addEventListener('click', async function () {
            var name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }

            saveBtn.disabled = true;
            saveBtn.textContent = '...';

            try {
                var res = await Auth.authedFetch('/api/sites', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name })
                });
                if (!res.ok) throw new Error('Failed to create site');
                var json = await res.json();
                var newSiteId = json.data ? json.data.id : null;

                await FP.loadSitesDropdown();
                if (newSiteId) FP.els.site.value = newSiteId;

                quickRow.classList.add('hidden');
                FP.els.site.setAttribute('required', '');
            } catch (err) {
                console.error('Error creating site:', err);
                Auth.showToast(_t('finds.errorSaving'));
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = _t('finds.quickSiteCreate');
            }
        });

        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
        });
    };

    FP.loadFinds = async function () {
        try {
            var res = await Auth.authedFetch('/api/finds');
            if (!res.ok) throw new Error('Failed to fetch finds');
            var json = await res.json();
            FP.allFinds = json.data || [];
            FP.applyFilters();
        } catch (err) {
            console.error('Error loading finds:', err);
            FP.els.findsGrid.innerHTML = '<p class="error-text">' + _t('finds.errorLoading') + '</p>';
        }
    };

    FP.loadUserTags = async function () {
        try {
            var res = await Auth.authedFetch('/api/finds/tags');
            if (!res.ok) return;
            var json = await res.json();
            FP.allUserTags = json.data || [];
            FP.renderTagSuggestions();
        } catch (err) {
            console.error('Error loading tags:', err);
        }
    };

    /* ------------------------------------------------------------------ */
    /*  Tags                                                              */
    /* ------------------------------------------------------------------ */
    FP.addTag = function (tag) {
        tag = tag.replace(/,/g, '').trim();
        if (!tag || FP.currentTags.includes(tag)) return;
        FP.currentTags.push(tag);
        FP.renderTags();
    };

    FP.removeTag = function (tag) {
        FP.currentTags = FP.currentTags.filter(function (t) { return t !== tag; });
        FP.renderTags();
    };

    FP.renderTags = function () {
        var esc = FP.escapeHtml;
        FP.els.tagsDisplay.innerHTML = FP.currentTags.map(function (t) {
            return '<span class="tag-chip">' + esc(t) + ' <button type="button" class="tag-remove" data-tag="' + esc(t) + '">&times;</button></span>';
        }).join('');
        FP.els.tagsHidden.value = FP.currentTags.join(',');

        FP.els.tagsDisplay.querySelectorAll('.tag-remove').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                FP.removeTag(btn.dataset.tag);
            });
        });
    };

    FP.renderTagSuggestions = function () {
        if (!FP.els.tagSuggestions || FP.allUserTags.length === 0) return;
        var esc = FP.escapeHtml;
        FP.els.tagSuggestions.innerHTML = FP.allUserTags.map(function (t) {
            return '<span class="tag-suggestion-chip" data-tag="' + esc(t) + '">' + esc(t) + '</span>';
        }).join('');
        FP.els.tagSuggestions.querySelectorAll('.tag-suggestion-chip').forEach(function (chip) {
            chip.addEventListener('click', function () { FP.addTag(chip.dataset.tag); });
        });
    };

    /* ------------------------------------------------------------------ */
    /*  Filtering                                                         */
    /* ------------------------------------------------------------------ */
    FP.applyFilters = function () {
        var filtered = FP.allFinds.slice();

        var siteVal = FP.els.filterSite.value;
        if (siteVal) filtered = filtered.filter(function (f) { return String(f.site_id) === String(siteVal); });

        var matVal = FP.els.filterMaterial.value;
        if (matVal) filtered = filtered.filter(function (f) { return f.material === matVal; });

        var catVal = FP.els.filterCategory.value;
        if (catVal) filtered = filtered.filter(function (f) { return f.category === catVal; });

        var fromVal = FP.els.filterDateFrom.value;
        if (fromVal) filtered = filtered.filter(function (f) { return f.date >= fromVal; });

        var toVal = FP.els.filterDateTo.value;
        if (toVal) filtered = filtered.filter(function (f) { return f.date <= toVal; });

        FP.renderFindsGrid(filtered);
    };

    /* ------------------------------------------------------------------ */
    /*  Rendering                                                         */
    /* ------------------------------------------------------------------ */
    FP.renderFindsGrid = function (finds) {
        if (finds.length === 0) {
            FP.els.findsGrid.innerHTML = '<div class="empty-state">' +
                '<div class="empty-state-icon">&#129689;</div>' +
                '<h3 class="empty-state-title">' + _t('finds.empty.title') + '</h3>' +
                '<p class="empty-state-text">' + _t('finds.empty.text') + '</p>' +
                '<button class="btn btn--primary" onclick="document.getElementById(\'btn-add-find\').click()">' + _t('finds.empty.cta') + '</button>' +
                '</div>';
            return;
        }

        var esc = FP.escapeHtml;
        var html = '';
        finds.forEach(function (find) {
            var siteName = FP.getSiteName(find.site_id);
            var dateStr = find.date ? new Date(find.date).toLocaleDateString() : '';
            var materialClass = find.material ? 'material-' + find.material : '';
            var thumbUrl = (find.photos && find.photos.length > 0) ? find.photos[0].photo_url : find.photo_url;
            var photo = thumbUrl
                ? '<img src="' + esc(Auth.secureUrl(thumbUrl)) + '" class="find-card-photo" alt="Find photo">'
                + (find.photos && find.photos.length > 1 ? '<span class="find-card-photo-count">' + find.photos.length + '</span>' : '')
                : '<div class="find-card-photo-placeholder">&#129689;</div>';
            var valueStr = find.value_estimate ? '$' + parseFloat(find.value_estimate).toFixed(2) : '';

            html += '<div class="find-card" data-id="' + find.id + '">' +
                '<div class="find-card-image">' + photo + '</div>' +
                '<div class="find-card-body">' +
                '<h3 class="find-card-title">' + esc(find.description || 'Unknown Find') + '</h3>' +
                '<p class="find-card-site">' + esc(siteName) + '</p>' +
                '<div class="find-card-meta">' +
                (find.material ? '<span class="badge material-badge ' + materialClass + '">' + esc(find.material) + '</span>' : '') +
                (find.category ? '<span class="badge category-badge">' + esc(find.category) + '</span>' : '') +
                (dateStr ? '<span class="find-card-date">' + esc(dateStr) + '</span>' : '') +
                '</div>' +
                '<div class="find-card-details">' +
                (find.depth_cm != null ? '<span>Depth: ' + esc(window.AppConfig ? AppConfig.formatDepth(find.depth_cm) : find.depth_cm + ' cm') + '</span>' : (find.depth ? '<span>Depth: ' + esc(String(find.depth)) + '"</span>' : '')) +
                (valueStr ? '<span class="find-card-value">' + esc(valueStr) + '</span>' : '') +
                '</div>' +
                '</div>' +
                '</div>';
        });

        FP.els.findsGrid.innerHTML = html;

        FP.els.findsGrid.querySelectorAll('.find-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var id = card.dataset.id;
                var find = FP.allFinds.find(function (f) { return String(f.id) === String(id); });
                if (find) FP.openModal(find);
            });
        });
    };

    FP.getSiteName = function (siteId) {
        if (!siteId) return 'No site';
        var site = FP.allSites.find(function (s) { return String(s.id) === String(siteId); });
        return site ? (site.name || 'Unnamed Site') : 'Site #' + siteId;
    };

})(window.FP = window.FP || {});
