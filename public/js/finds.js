/**
 * Finds page logic
 * Handles CRUD for finds, filtering, photo upload with camera capture,
 * GPS geolocation, and mobile-first card grid display.
 */
(function () {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    /* ------------------------------------------------------------------ */
    /*  State                                                             */
    /* ------------------------------------------------------------------ */
    let allFinds = [];
    let allSites = [];
    let currentTags = [];
    let allUserTags = [];
    let currentPhotos = [];   // existing photos from server (when editing)
    let newPhotoFiles = [];   // new files to upload
    let lightboxPhotos = [];  // photos for lightbox navigation
    let lightboxIndex = 0;
    let editingFindId = null;

    /* ------------------------------------------------------------------ */
    /*  DOM References                                                    */
    /* ------------------------------------------------------------------ */
    const els = {};
    function cacheElements() {
        els.findsGrid = document.getElementById('finds-grid');
        els.modalOverlay = document.getElementById('find-modal-overlay');
        els.modal = document.getElementById('find-modal');
        els.modalTitle = document.getElementById('find-modal-title');
        els.form = document.getElementById('find-form');
        els.findId = document.getElementById('find-id');
        els.site = document.getElementById('find-site');
        els.date = document.getElementById('find-date');
        els.latitude = document.getElementById('find-latitude');
        els.longitude = document.getElementById('find-longitude');
        els.photosInput = document.getElementById('find-photos-input');
        els.photoGallery = document.getElementById('find-photo-gallery');
        els.uploadPlaceholder = document.getElementById('find-upload-placeholder');
        els.uploadArea = document.getElementById('find-upload-area');
        els.lightbox = document.getElementById('photo-lightbox');
        els.lightboxImg = document.getElementById('lightbox-img');
        els.lightboxClose = document.getElementById('lightbox-close');
        els.lightboxPrev = document.getElementById('lightbox-prev');
        els.lightboxNext = document.getElementById('lightbox-next');
        els.description = document.getElementById('find-description');
        els.material = document.getElementById('find-material');
        els.estimatedAge = document.getElementById('find-estimated-age');
        els.depth = document.getElementById('find-depth');
        els.condition = document.getElementById('find-condition');
        els.value = document.getElementById('find-value');
        els.notes = document.getElementById('find-notes');
        els.btnAdd = document.getElementById('btn-add-find');
        els.btnClose = document.getElementById('btn-find-modal-close');
        els.btnCancel = document.getElementById('btn-cancel-find');
        els.btnDelete = document.getElementById('btn-delete-find');
        els.btnSave = document.getElementById('btn-save-find');
        els.btnLocation = document.getElementById('btn-use-location');
        els.category = document.getElementById('find-category');
        els.tagsInput = document.getElementById('find-tags-input');
        els.tagsHidden = document.getElementById('find-tags');
        els.tagsDisplay = document.getElementById('find-tags-display');
        els.tagSuggestions = document.getElementById('find-tag-suggestions');
        els.filterSite = document.getElementById('filter-site');
        els.filterMaterial = document.getElementById('filter-material');
        els.filterCategory = document.getElementById('filter-category');
        els.filterDateFrom = document.getElementById('filter-date-from');
        els.filterDateTo = document.getElementById('filter-date-to');
        // Quick Log
        els.btnQuickLog = document.getElementById('btn-quick-log');
        els.quickLogOverlay = document.getElementById('quick-log-overlay');
        els.quickLogForm = document.getElementById('quick-log-form');
        els.quickLogClose = document.getElementById('btn-quick-log-close');
        els.quickLogPhoto = document.getElementById('quick-log-photo');
        els.quickLogPreview = document.getElementById('quick-log-preview');
        els.quickLogUploadArea = document.getElementById('quick-log-upload-area');
        els.quickLogUploadPlaceholder = document.getElementById('quick-log-upload-placeholder');
        els.quickLogCategory = document.getElementById('quick-log-category');
        els.quickLogDescription = document.getElementById('quick-log-description');
        els.quickLogSiteId = document.getElementById('quick-log-site-id');
        els.quickLogLatitude = document.getElementById('quick-log-latitude');
        els.quickLogLongitude = document.getElementById('quick-log-longitude');
        els.quickLogLocationStatus = document.getElementById('quick-log-location-status');
        els.btnQuickLogDetails = document.getElementById('btn-quick-log-details');
        els.btnQuickLogSave = document.getElementById('btn-quick-log-save');
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                              */
    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', () => {
        cacheElements();
        bindEvents();
        function startLoad() {
            loadSitesDropdown();
            loadFinds();
            loadUserTags();
            // Update depth label based on unit preference
            if (window.AppConfig) {
                AppConfig.onReady(function () {
                    var depthLabel = document.querySelector('label[for="find-depth"]');
                    if (depthLabel) depthLabel.textContent = AppConfig.depthLabel();
                });
            }
        }
        if (window.I18n) { I18n.onReady(startLoad); } else { startLoad(); }
    });

    /* ------------------------------------------------------------------ */
    /*  Events                                                            */
    /* ------------------------------------------------------------------ */
    function bindEvents() {
        els.btnAdd.addEventListener('click', () => openModal());
        els.btnClose.addEventListener('click', closeModal);
        els.btnCancel.addEventListener('click', closeModal);
        els.modalOverlay.addEventListener('click', (e) => {
            if (e.target === els.modalOverlay) closeModal();
        });
        els.form.addEventListener('submit', handleFormSubmit);
        els.btnDelete.addEventListener('click', handleDelete);
        els.btnLocation.addEventListener('click', useCurrentLocation);

        // Photo upload (multi)
        els.uploadArea.addEventListener('click', function () { els.photosInput.click(); });
        els.uploadArea.addEventListener('dragover', function (e) {
            e.preventDefault();
            els.uploadArea.classList.add('drag-over');
        });
        els.uploadArea.addEventListener('dragleave', function () {
            els.uploadArea.classList.remove('drag-over');
        });
        els.uploadArea.addEventListener('drop', function (e) {
            e.preventDefault();
            els.uploadArea.classList.remove('drag-over');
            addNewPhotoFiles(e.dataTransfer.files);
        });
        els.photosInput.addEventListener('change', function () {
            addNewPhotoFiles(els.photosInput.files);
            els.photosInput.value = '';
        });

        // Lightbox
        els.lightboxClose.addEventListener('click', closeLightbox);
        els.lightboxPrev.addEventListener('click', function () { navigateLightbox(-1); });
        els.lightboxNext.addEventListener('click', function () { navigateLightbox(1); });
        els.lightbox.addEventListener('click', function (e) {
            if (e.target === els.lightbox) closeLightbox();
        });

        // Tags input
        els.tagsInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag(els.tagsInput.value.trim());
                els.tagsInput.value = '';
            }
        });
        els.tagsInput.addEventListener('blur', function () {
            if (els.tagsInput.value.trim()) {
                addTag(els.tagsInput.value.trim());
                els.tagsInput.value = '';
            }
        });

        // Filters
        els.filterSite.addEventListener('change', applyFilters);
        els.filterMaterial.addEventListener('change', applyFilters);
        els.filterCategory.addEventListener('change', applyFilters);
        els.filterDateFrom.addEventListener('change', applyFilters);
        els.filterDateTo.addEventListener('change', applyFilters);

        // Quick Log
        els.btnQuickLog.addEventListener('click', openQuickLog);
        els.quickLogClose.addEventListener('click', closeQuickLog);
        els.quickLogOverlay.addEventListener('click', function (e) {
            if (e.target === els.quickLogOverlay) closeQuickLog();
        });
        els.quickLogUploadArea.addEventListener('click', function () { els.quickLogPhoto.click(); });
        els.quickLogPhoto.addEventListener('change', function () {
            var file = els.quickLogPhoto.files[0];
            if (file) {
                var reader = new FileReader();
                reader.onload = function (e) {
                    els.quickLogPreview.src = e.target.result;
                    els.quickLogPreview.style.display = 'block';
                    els.quickLogUploadPlaceholder.style.display = 'none';
                };
                reader.readAsDataURL(file);
            }
        });
        els.quickLogForm.addEventListener('submit', handleQuickLogSubmit);
        els.btnQuickLogDetails.addEventListener('click', quickLogToFullModal);
    }

    /* ------------------------------------------------------------------ */
    /*  Data Loading                                                      */
    /* ------------------------------------------------------------------ */
    async function loadSitesDropdown() {
        try {
            const res = await Auth.authedFetch('/api/sites');
            if (!res.ok) throw new Error('Failed to fetch sites');
            const json = await res.json();
            allSites = json.data || [];
            const esc = escapeHtml;

            // Populate modal dropdown
            let options = '<option value="">' + _t('finds.placeholder.selectSite') + '</option>';
            allSites.forEach(s => {
                options += '<option value="' + s.id + '">' + esc(s.name || 'Unnamed') + '</option>';
            });
            // Add "Create New Site" option at end
            options += '<option value="__new__">' + _t('finds.createSite') + '</option>';
            els.site.innerHTML = options;

            // Populate filter dropdown
            let filterOpts = '<option value="">' + _t('finds.filter.allSites') + '</option>';
            allSites.forEach(s => {
                filterOpts += '<option value="' + s.id + '">' + esc(s.name || 'Unnamed') + '</option>';
            });
            els.filterSite.innerHTML = filterOpts;

            // Wire up "Create New Site" inline form
            setupQuickSiteCreate();
        } catch (err) {
            console.error('Error loading sites for dropdown:', err);
        }
    }

    function setupQuickSiteCreate() {
        var quickRow = document.getElementById('quick-site-create');
        var nameInput = document.getElementById('quick-site-name');
        var saveBtn = document.getElementById('quick-site-save');
        var cancelBtn = document.getElementById('quick-site-cancel');
        if (!quickRow || !nameInput || !saveBtn || !cancelBtn) return;

        // Show inline form when "Create New Site" is selected
        els.site.addEventListener('change', function () {
            if (els.site.value === '__new__') {
                quickRow.style.display = 'flex';
                nameInput.value = '';
                nameInput.focus();
                // Temporarily remove required so the __new__ value doesn't block form validation
                els.site.removeAttribute('required');
            }
        });

        // Cancel — hide form, reset dropdown
        cancelBtn.addEventListener('click', function () {
            quickRow.style.display = 'none';
            els.site.value = '';
            els.site.setAttribute('required', '');
        });

        // Create — POST new site, reload dropdown, auto-select
        saveBtn.addEventListener('click', async function () {
            var name = nameInput.value.trim();
            if (!name) {
                nameInput.focus();
                return;
            }

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

                // Reload the dropdown
                await loadSitesDropdown();

                // Auto-select the newly created site
                if (newSiteId) {
                    els.site.value = newSiteId;
                }

                quickRow.style.display = 'none';
                els.site.setAttribute('required', '');
            } catch (err) {
                console.error('Error creating site:', err);
                Auth.showToast(_t('finds.errorSaving') + ' ' + err.message);
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = _t('finds.quickSiteCreate');
            }
        });

        // Allow Enter key in the name input to trigger save
        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveBtn.click();
            }
        });
    }

    async function loadFinds() {
        try {
            const res = await Auth.authedFetch('/api/finds');
            if (!res.ok) throw new Error('Failed to fetch finds');
            const json = await res.json();
            allFinds = json.data || [];
            applyFilters();
        } catch (err) {
            console.error('Error loading finds:', err);
            els.findsGrid.innerHTML = '<p class="error-text">' + _t('finds.errorLoading') + '</p>';
        }
    }

    async function loadUserTags() {
        try {
            var res = await Auth.authedFetch('/api/finds/tags');
            if (!res.ok) return;
            var json = await res.json();
            allUserTags = json.data || [];
            renderTagSuggestions();
        } catch (err) {
            console.error('Error loading tags:', err);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Tags                                                              */
    /* ------------------------------------------------------------------ */
    function addTag(tag) {
        tag = tag.replace(/,/g, '').trim();
        if (!tag || currentTags.includes(tag)) return;
        currentTags.push(tag);
        renderTags();
    }

    function removeTag(tag) {
        currentTags = currentTags.filter(function (t) { return t !== tag; });
        renderTags();
    }

    function renderTags() {
        var esc = escapeHtml;
        els.tagsDisplay.innerHTML = currentTags.map(function (t) {
            return '<span class="tag-chip">' + esc(t) + ' <button type="button" class="tag-remove" data-tag="' + esc(t) + '">&times;</button></span>';
        }).join('');
        els.tagsHidden.value = currentTags.join(',');

        els.tagsDisplay.querySelectorAll('.tag-remove').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                removeTag(btn.dataset.tag);
            });
        });
    }

    function renderTagSuggestions() {
        if (!els.tagSuggestions || allUserTags.length === 0) return;
        var esc = escapeHtml;
        els.tagSuggestions.innerHTML = allUserTags.map(function (t) {
            return '<span class="tag-suggestion-chip" data-tag="' + esc(t) + '">' + esc(t) + '</span>';
        }).join('');
        els.tagSuggestions.querySelectorAll('.tag-suggestion-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                addTag(chip.dataset.tag);
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Filtering                                                         */
    /* ------------------------------------------------------------------ */
    function applyFilters() {
        let filtered = [...allFinds];

        const siteVal = els.filterSite.value;
        if (siteVal) filtered = filtered.filter(f => String(f.site_id) === String(siteVal));

        const matVal = els.filterMaterial.value;
        if (matVal) filtered = filtered.filter(f => f.material === matVal);

        const catVal = els.filterCategory.value;
        if (catVal) filtered = filtered.filter(f => f.category === catVal);

        const fromVal = els.filterDateFrom.value;
        if (fromVal) filtered = filtered.filter(f => f.date >= fromVal);

        const toVal = els.filterDateTo.value;
        if (toVal) filtered = filtered.filter(f => f.date <= toVal);

        renderFindsGrid(filtered);
    }

    /* ------------------------------------------------------------------ */
    /*  Rendering                                                         */
    /* ------------------------------------------------------------------ */
    function renderFindsGrid(finds) {
        if (finds.length === 0) {
            els.findsGrid.innerHTML = '<div class="empty-state">' +
                '<div class="empty-state-icon">&#129689;</div>' +
                '<h3 class="empty-state-title">' + _t('finds.empty.title') + '</h3>' +
                '<p class="empty-state-text">' + _t('finds.empty.text') + '</p>' +
                '<button class="btn btn--primary" onclick="document.getElementById(\'btn-add-find\').click()">' + _t('finds.empty.cta') + '</button>' +
                '</div>';
            return;
        }

        const esc = escapeHtml;
        let html = '';
        finds.forEach(find => {
            const siteName = getSiteName(find.site_id);
            const dateStr = find.date ? new Date(find.date).toLocaleDateString() : '';
            const materialClass = find.material ? 'material-' + find.material : '';
            const thumbUrl = (find.photos && find.photos.length > 0) ? find.photos[0].photo_url : find.photo_url;
            const photo = thumbUrl
                ? '<img src="' + esc(Auth.secureUrl(thumbUrl)) + '" class="find-card-photo" alt="Find photo">'
                + (find.photos && find.photos.length > 1 ? '<span class="find-card-photo-count">' + find.photos.length + '</span>' : '')
                : '<div class="find-card-photo-placeholder">&#129689;</div>';
            const valueStr = find.value_estimate ? '$' + parseFloat(find.value_estimate).toFixed(2) : '';

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

        els.findsGrid.innerHTML = html;

        // Bind click to open edit
        els.findsGrid.querySelectorAll('.find-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const find = allFinds.find(f => String(f.id) === String(id));
                if (find) openModal(find);
            });
        });
    }

    function getSiteName(siteId) {
        if (!siteId) return 'No site';
        const site = allSites.find(s => String(s.id) === String(siteId));
        return site ? (site.name || 'Unnamed Site') : 'Site #' + siteId;
    }

    /* ------------------------------------------------------------------ */
    /*  Modal                                                             */
    /* ------------------------------------------------------------------ */
    function openModal(find) {
        // Reset photo state
        currentPhotos = [];
        newPhotoFiles = [];
        editingFindId = null;

        if (find) {
            els.modalTitle.textContent = _t('finds.modal.editTitle');
            els.findId.value = find.id;
            editingFindId = find.id;
            els.site.value = find.site_id || '';
            els.date.value = find.date || '';
            els.latitude.value = find.latitude || '';
            els.longitude.value = find.longitude || '';
            els.description.value = find.description || '';
            els.material.value = find.material || '';
            els.estimatedAge.value = find.estimated_age || '';
            els.depth.value = find.depth_cm != null
                ? (window.AppConfig ? AppConfig.depthForInput(find.depth_cm) : find.depth_cm)
                : (find.depth || '');
            els.condition.value = find.condition || '';
            els.value.value = find.value_estimate || '';
            els.notes.value = find.notes || '';
            els.category.value = find.category || '';
            currentTags = find.tags ? find.tags.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
            renderTags();
            els.btnDelete.style.display = 'inline-block';

            // Load existing photos into gallery
            currentPhotos = (find.photos || []).slice();
            renderPhotoGallery();
        } else {
            els.modalTitle.textContent = _t('finds.modal.addTitle');
            els.form.reset();
            els.findId.value = '';
            // Default date to today
            const today = new Date().toISOString().split('T')[0];
            els.date.value = today;
            els.category.value = '';
            currentTags = [];
            renderTags();
            els.btnDelete.style.display = 'none';
            renderPhotoGallery();
        }

        els.modalOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        els.modalOverlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    /* ------------------------------------------------------------------ */
    /*  Geolocation                                                       */
    /* ------------------------------------------------------------------ */
    function useCurrentLocation() {
        if (!navigator.geolocation) {
            Auth.showToast(_t('finds.geoNotSupported'), 'warning');
            return;
        }

        els.btnLocation.disabled = true;
        els.btnLocation.textContent = _t('quickAdd.gettingLocation');

        navigator.geolocation.getCurrentPosition(
            (position) => {
                els.latitude.value = position.coords.latitude.toFixed(6);
                els.longitude.value = position.coords.longitude.toFixed(6);
                els.btnLocation.disabled = false;
                els.btnLocation.textContent = _t('finds.btn.useLocation');
            },
            (error) => {
                console.error('Geolocation error:', error);
                Auth.showToast(_t('finds.geoFailed'), 'warning');
                els.btnLocation.disabled = false;
                els.btnLocation.textContent = _t('finds.btn.useLocation');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Multi-Photo Gallery                                               */
    /* ------------------------------------------------------------------ */
    function addNewPhotoFiles(fileList) {
        var totalCount = currentPhotos.length + newPhotoFiles.length;
        for (var i = 0; i < fileList.length; i++) {
            if (totalCount + i >= 10) {
                Auth.showToast(_t('finds.photo.maxReached'), 'warning');
                break;
            }
            newPhotoFiles.push(fileList[i]);
        }
        renderPhotoGallery();
    }

    function renderPhotoGallery() {
        var esc = escapeHtml;
        var html = '';
        var allPhotos = [];

        // Existing server photos
        for (var i = 0; i < currentPhotos.length; i++) {
            var p = currentPhotos[i];
            allPhotos.push({ url: Auth.secureUrl(p.photo_url), type: 'server' });
            html += '<div class="photo-gallery-item" data-index="' + i + '" data-type="server" data-photo-id="' + p.id + '">' +
                '<img src="' + esc(Auth.secureUrl(p.photo_url)) + '" alt="Photo" class="photo-gallery-thumb">' +
                '<div class="photo-gallery-actions">' +
                (i > 0 ? '<button type="button" class="photo-action-btn photo-move-up" title="' + _t('finds.photo.moveUp') + '">&#9650;</button>' : '') +
                (i < currentPhotos.length - 1 ? '<button type="button" class="photo-action-btn photo-move-down" title="' + _t('finds.photo.moveDown') + '">&#9660;</button>' : '') +
                '<button type="button" class="photo-action-btn photo-delete-btn" title="' + _t('finds.photo.delete') + '">&times;</button>' +
                '</div>' +
                '</div>';
        }

        // New pending photos (previews)
        for (var j = 0; j < newPhotoFiles.length; j++) {
            var idx = currentPhotos.length + j;
            allPhotos.push({ file: newPhotoFiles[j], type: 'new' });
            html += '<div class="photo-gallery-item photo-gallery-item--pending" data-index="' + idx + '" data-type="new" data-new-index="' + j + '">' +
                '<img src="" alt="New photo" class="photo-gallery-thumb photo-preview-thumb" data-file-index="' + j + '">' +
                '<div class="photo-gallery-actions">' +
                '<button type="button" class="photo-action-btn photo-delete-btn" title="' + _t('finds.photo.delete') + '">&times;</button>' +
                '</div>' +
                '</div>';
        }

        els.photoGallery.innerHTML = html;

        // Generate previews for new files
        els.photoGallery.querySelectorAll('.photo-preview-thumb').forEach(function (img) {
            var fileIdx = parseInt(img.dataset.fileIndex, 10);
            var file = newPhotoFiles[fileIdx];
            if (file) {
                var reader = new FileReader();
                reader.onload = function (e) { img.src = e.target.result; };
                reader.readAsDataURL(file);
            }
        });

        // Bind click on thumbnails to open lightbox
        els.photoGallery.querySelectorAll('.photo-gallery-thumb').forEach(function (img) {
            img.addEventListener('click', function (e) {
                e.stopPropagation();
                var item = img.closest('.photo-gallery-item');
                var index = parseInt(item.dataset.index, 10);
                openLightbox(index);
            });
        });

        // Bind delete buttons
        els.photoGallery.querySelectorAll('.photo-delete-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var item = btn.closest('.photo-gallery-item');
                if (item.dataset.type === 'server') {
                    handlePhotoDelete(parseInt(item.dataset.photoId, 10));
                } else {
                    var newIdx = parseInt(item.dataset.newIndex, 10);
                    newPhotoFiles.splice(newIdx, 1);
                    renderPhotoGallery();
                }
            });
        });

        // Bind reorder buttons
        els.photoGallery.querySelectorAll('.photo-move-up').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var item = btn.closest('.photo-gallery-item');
                var idx = parseInt(item.dataset.index, 10);
                if (idx > 0) {
                    var temp = currentPhotos[idx];
                    currentPhotos[idx] = currentPhotos[idx - 1];
                    currentPhotos[idx - 1] = temp;
                    renderPhotoGallery();
                }
            });
        });

        els.photoGallery.querySelectorAll('.photo-move-down').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var item = btn.closest('.photo-gallery-item');
                var idx = parseInt(item.dataset.index, 10);
                if (idx < currentPhotos.length - 1) {
                    var temp = currentPhotos[idx];
                    currentPhotos[idx] = currentPhotos[idx + 1];
                    currentPhotos[idx + 1] = temp;
                    renderPhotoGallery();
                }
            });
        });

        // Show/hide upload area based on total count
        if (currentPhotos.length + newPhotoFiles.length >= 10) {
            els.uploadArea.style.display = 'none';
        } else {
            els.uploadArea.style.display = '';
        }
    }

    async function handlePhotoDelete(photoId) {
        if (!editingFindId || !photoId) return;
        if (!confirm(_t('finds.photo.deleteConfirm'))) return;
        try {
            var res = await Auth.authedFetch('/api/finds/' + editingFindId + '/photos/' + photoId, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete photo');
            currentPhotos = currentPhotos.filter(function (p) { return p.id !== photoId; });
            renderPhotoGallery();
        } catch (err) {
            console.error('Error deleting photo:', err);
            Auth.showToast(_t('finds.errorSaving') + ' ' + err.message);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Lightbox                                                          */
    /* ------------------------------------------------------------------ */
    function openLightbox(index) {
        // Build lightbox photo list from current gallery state
        lightboxPhotos = [];
        for (var i = 0; i < currentPhotos.length; i++) {
            lightboxPhotos.push(Auth.secureUrl(currentPhotos[i].photo_url));
        }
        for (var j = 0; j < newPhotoFiles.length; j++) {
            lightboxPhotos.push(URL.createObjectURL(newPhotoFiles[j]));
        }
        if (lightboxPhotos.length === 0) return;
        lightboxIndex = index;
        showLightboxImage();
        els.lightbox.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        els.lightbox.style.display = 'none';
        // Only restore overflow if modal isn't open
        if (!els.modalOverlay.classList.contains('open')) {
            document.body.style.overflow = '';
        }
    }

    function navigateLightbox(delta) {
        lightboxIndex += delta;
        if (lightboxIndex < 0) lightboxIndex = lightboxPhotos.length - 1;
        if (lightboxIndex >= lightboxPhotos.length) lightboxIndex = 0;
        showLightboxImage();
    }

    function showLightboxImage() {
        els.lightboxImg.src = lightboxPhotos[lightboxIndex];
        els.lightboxPrev.style.display = lightboxPhotos.length > 1 ? '' : 'none';
        els.lightboxNext.style.display = lightboxPhotos.length > 1 ? '' : 'none';
    }

    /* ------------------------------------------------------------------ */
    /*  Form Submit                                                       */
    /* ------------------------------------------------------------------ */
    async function handleFormSubmit(e) {
        e.preventDefault();

        const formData = new FormData();
        formData.append('site_id', els.site.value);
        formData.append('date', els.date.value);
        formData.append('latitude', els.latitude.value);
        formData.append('longitude', els.longitude.value);
        formData.append('description', els.description.value.trim());
        formData.append('material', els.material.value);
        formData.append('estimated_age', els.estimatedAge.value.trim());
        // Convert depth input to cm for storage
        var depthVal = els.depth.value;
        if (window.AppConfig && depthVal) {
            formData.append('depth_cm', AppConfig.depthInputToCm(depthVal));
        } else if (depthVal) {
            formData.append('depth', depthVal);
        }
        formData.append('condition', els.condition.value);
        formData.append('value_estimate', els.value.value);
        formData.append('notes', els.notes.value.trim());
        formData.append('category', els.category.value);
        formData.append('tags', els.tagsHidden.value);

        // Append new photo files
        for (var pi = 0; pi < newPhotoFiles.length; pi++) {
            formData.append('photos', newPhotoFiles[pi]);
        }

        // Send reorder if editing and photos were reordered
        const id = els.findId.value;
        const url = id ? '/api/finds/' + id : '/api/finds';
        const method = id ? 'PUT' : 'POST';

        try {
            els.btnSave.disabled = true;
            els.btnSave.textContent = _t('finds.modal.saving');
            const res = await Auth.authedFetch(url, { method: method, body: formData });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || 'Failed to save find');
            }
            // Send reorder request if editing with existing photos
            if (id && currentPhotos.length > 0) {
                var photoIds = currentPhotos.map(function (p) { return p.id; });
                await Auth.authedFetch('/api/finds/' + id + '/photos/reorder', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ photo_ids: photoIds })
                });
            }
            closeModal();
            await loadFinds();
        } catch (err) {
            console.error('Error saving find:', err);
            Auth.showToast(_t('finds.errorSaving') + ' ' + err.message);
        } finally {
            els.btnSave.disabled = false;
            els.btnSave.textContent = _t('finds.modal.save');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Delete                                                            */
    /* ------------------------------------------------------------------ */
    async function handleDelete() {
        const id = els.findId.value;
        if (!id) return;
        if (!confirm(_t('finds.confirmDelete'))) return;

        try {
            const res = await Auth.authedFetch('/api/finds/' + id, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete find');
            closeModal();
            await loadFinds();
        } catch (err) {
            console.error('Error deleting find:', err);
            Auth.showToast(_t('finds.errorDeleting') + ' ' + err.message);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Quick Log                                                         */
    /* ------------------------------------------------------------------ */
    function openQuickLog() {
        els.quickLogForm.reset();
        els.quickLogPreview.style.display = 'none';
        els.quickLogUploadPlaceholder.style.display = '';
        els.quickLogLocationStatus.textContent = '';

        // Smart defaults from localStorage
        var lastCategory = localStorage.getItem('sb_lastCategory') || '';
        els.quickLogCategory.value = lastCategory;

        // Auto-fill site: active hunt session site, or last used site
        var lastSiteId = localStorage.getItem('sb_lastSiteId') || '';
        if (lastSiteId) {
            els.quickLogSiteId.value = lastSiteId;
        }

        // Auto-fill GPS
        if (navigator.geolocation) {
            els.quickLogLocationStatus.textContent = _t('finds.quickLog.gettingLocation');
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    els.quickLogLatitude.value = pos.coords.latitude.toFixed(6);
                    els.quickLogLongitude.value = pos.coords.longitude.toFixed(6);
                    els.quickLogLocationStatus.textContent = '';
                },
                function () {
                    els.quickLogLocationStatus.textContent = '';
                },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
            );
        }

        els.quickLogOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        els.quickLogDescription.focus();
    }

    function closeQuickLog() {
        els.quickLogOverlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    async function handleQuickLogSubmit(e) {
        e.preventDefault();
        var formData = new FormData();

        // Use last-used site or first available site
        var siteId = els.quickLogSiteId.value;
        if (!siteId && allSites.length > 0) {
            siteId = allSites[0].id;
        }
        if (!siteId) {
            Auth.showToast(_t('finds.errorSaving') + ' No site available');
            return;
        }
        formData.append('site_id', siteId);
        formData.append('date', new Date().toISOString().split('T')[0]);
        formData.append('description', els.quickLogDescription.value.trim());
        var cat = els.quickLogCategory.value;
        if (cat) formData.append('category', cat);
        if (els.quickLogLatitude.value) formData.append('latitude', els.quickLogLatitude.value);
        if (els.quickLogLongitude.value) formData.append('longitude', els.quickLogLongitude.value);
        if (els.quickLogPhoto.files.length > 0) {
            formData.append('photos', els.quickLogPhoto.files[0]);
        }

        try {
            els.btnQuickLogSave.disabled = true;
            els.btnQuickLogSave.textContent = _t('finds.modal.saving');
            var res = await Auth.authedFetch('/api/finds', { method: 'POST', body: formData });
            if (!res.ok) {
                var errData = await res.json().catch(function () { return {}; });
                throw new Error(errData.message || 'Failed to save find');
            }
            // Save smart defaults
            localStorage.setItem('sb_lastCategory', cat);
            localStorage.setItem('sb_lastSiteId', siteId);
            closeQuickLog();
            Auth.showToast(_t('finds.quickLog.saved'));
            await loadFinds();
        } catch (err) {
            console.error('Error saving quick log:', err);
            Auth.showToast(_t('finds.errorSaving') + ' ' + err.message);
        } finally {
            els.btnQuickLogSave.disabled = false;
            els.btnQuickLogSave.textContent = _t('finds.quickLog.save');
        }
    }

    function quickLogToFullModal() {
        // Transfer data from quick log to full modal
        var description = els.quickLogDescription.value;
        var category = els.quickLogCategory.value;
        var lat = els.quickLogLatitude.value;
        var lng = els.quickLogLongitude.value;
        var siteId = els.quickLogSiteId.value;
        var photoFile = els.quickLogPhoto.files.length > 0 ? els.quickLogPhoto.files[0] : null;

        closeQuickLog();
        openModal(); // opens empty "add" modal

        // Populate transferred fields
        els.description.value = description;
        els.category.value = category;
        if (lat) els.latitude.value = lat;
        if (lng) els.longitude.value = lng;
        if (siteId) els.site.value = siteId;

        // Transfer photo
        if (photoFile) {
            newPhotoFiles = [photoFile];
            renderPhotoGallery();
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Utility                                                           */
    /* ------------------------------------------------------------------ */
    function escapeHtml(str) {
        return window.Auth ? Auth.escapeHtml(str) : (str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '');
    }
})();
