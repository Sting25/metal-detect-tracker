/**
 * Finds page — core logic.
 * Creates the shared window.FP namespace used by finds-data.js and finds-photos.js.
 * Handles init, event binding, modal, geolocation, form submit, and delete.
 */
(function () {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    /* ------------------------------------------------------------------ */
    /*  Shared State (window.FP namespace)                                */
    /* ------------------------------------------------------------------ */
    var FP = window.FP = window.FP || {};
    FP.allFinds = [];
    FP.allSites = [];
    FP.currentTags = [];
    FP.allUserTags = [];
    FP.currentPhotos = [];
    FP.newPhotoFiles = [];
    FP.lightboxPhotos = [];
    FP.lightboxIndex = 0;
    FP.editingFindId = null;
    FP.els = {};

    FP.escapeHtml = function (str) {
        return window.Auth ? Auth.escapeHtml(str) : (str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '');
    };

    /* ------------------------------------------------------------------ */
    /*  DOM References                                                    */
    /* ------------------------------------------------------------------ */
    function cacheElements() {
        var g = document.getElementById.bind(document);
        FP.els.findsGrid = g('finds-grid');
        FP.els.modalOverlay = g('find-modal-overlay');
        FP.els.modal = g('find-modal');
        FP.els.modalTitle = g('find-modal-title');
        FP.els.form = g('find-form');
        FP.els.findId = g('find-id');
        FP.els.site = g('find-site');
        FP.els.date = g('find-date');
        FP.els.latitude = g('find-latitude');
        FP.els.longitude = g('find-longitude');
        FP.els.photosInput = g('find-photos-input');
        FP.els.photoGallery = g('find-photo-gallery');
        FP.els.uploadPlaceholder = g('find-upload-placeholder');
        FP.els.uploadArea = g('find-upload-area');
        FP.els.lightbox = g('photo-lightbox');
        FP.els.lightboxImg = g('lightbox-img');
        FP.els.lightboxClose = g('lightbox-close');
        FP.els.lightboxPrev = g('lightbox-prev');
        FP.els.lightboxNext = g('lightbox-next');
        FP.els.description = g('find-description');
        FP.els.material = g('find-material');
        FP.els.estimatedAge = g('find-estimated-age');
        FP.els.depth = g('find-depth');
        FP.els.condition = g('find-condition');
        FP.els.value = g('find-value');
        FP.els.notes = g('find-notes');
        FP.els.btnAdd = g('btn-add-find');
        FP.els.btnClose = g('btn-find-modal-close');
        FP.els.btnCancel = g('btn-cancel-find');
        FP.els.btnDelete = g('btn-delete-find');
        FP.els.btnSave = g('btn-save-find');
        FP.els.btnLocation = g('btn-use-location');
        FP.els.category = g('find-category');
        FP.els.tagsInput = g('find-tags-input');
        FP.els.tagsHidden = g('find-tags');
        FP.els.tagsDisplay = g('find-tags-display');
        FP.els.tagSuggestions = g('find-tag-suggestions');
        FP.els.filterSite = g('filter-site');
        FP.els.filterMaterial = g('filter-material');
        FP.els.filterCategory = g('filter-category');
        FP.els.filterDateFrom = g('filter-date-from');
        FP.els.filterDateTo = g('filter-date-to');
        // Quick Log
        FP.els.btnQuickLog = g('btn-quick-log');
        FP.els.quickLogOverlay = g('quick-log-overlay');
        FP.els.quickLogForm = g('quick-log-form');
        FP.els.quickLogClose = g('btn-quick-log-close');
        FP.els.quickLogPhoto = g('quick-log-photo');
        FP.els.quickLogPreview = g('quick-log-preview');
        FP.els.quickLogUploadArea = g('quick-log-upload-area');
        FP.els.quickLogUploadPlaceholder = g('quick-log-upload-placeholder');
        FP.els.quickLogCategory = g('quick-log-category');
        FP.els.quickLogDescription = g('quick-log-description');
        FP.els.quickLogSiteId = g('quick-log-site-id');
        FP.els.quickLogLatitude = g('quick-log-latitude');
        FP.els.quickLogLongitude = g('quick-log-longitude');
        FP.els.quickLogLocationStatus = g('quick-log-location-status');
        FP.els.btnQuickLogDetails = g('btn-quick-log-details');
        FP.els.btnQuickLogSave = g('btn-quick-log-save');
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                              */
    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', function () {
        cacheElements();
        bindEvents();
        function startLoad() {
            FP.loadSitesDropdown();
            FP.loadFinds();
            FP.loadUserTags();
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
        FP.els.btnAdd.addEventListener('click', function () { FP.openModal(); });
        FP.els.btnClose.addEventListener('click', closeModal);
        FP.els.btnCancel.addEventListener('click', closeModal);
        FP.els.modalOverlay.addEventListener('click', function (e) {
            if (e.target === FP.els.modalOverlay) closeModal();
        });
        FP.els.form.addEventListener('submit', handleFormSubmit);
        FP.els.btnDelete.addEventListener('click', handleDelete);
        FP.els.btnLocation.addEventListener('click', useCurrentLocation);

        // Photo upload
        FP.els.uploadArea.addEventListener('click', function () { FP.els.photosInput.click(); });
        FP.els.uploadArea.addEventListener('dragover', function (e) { e.preventDefault(); FP.els.uploadArea.classList.add('drag-over'); });
        FP.els.uploadArea.addEventListener('dragleave', function () { FP.els.uploadArea.classList.remove('drag-over'); });
        FP.els.uploadArea.addEventListener('drop', function (e) {
            e.preventDefault(); FP.els.uploadArea.classList.remove('drag-over');
            FP.addNewPhotoFiles(e.dataTransfer.files);
        });
        FP.els.photosInput.addEventListener('change', function () {
            FP.addNewPhotoFiles(FP.els.photosInput.files);
            FP.els.photosInput.value = '';
        });

        // Lightbox
        FP.els.lightboxClose.addEventListener('click', FP.closeLightbox);
        FP.els.lightboxPrev.addEventListener('click', function () { FP.navigateLightbox(-1); });
        FP.els.lightboxNext.addEventListener('click', function () { FP.navigateLightbox(1); });
        FP.els.lightbox.addEventListener('click', function (e) { if (e.target === FP.els.lightbox) FP.closeLightbox(); });

        // Tags
        FP.els.tagsInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault(); FP.addTag(FP.els.tagsInput.value.trim()); FP.els.tagsInput.value = '';
            }
        });
        FP.els.tagsInput.addEventListener('blur', function () {
            if (FP.els.tagsInput.value.trim()) { FP.addTag(FP.els.tagsInput.value.trim()); FP.els.tagsInput.value = ''; }
        });

        // Filters
        FP.els.filterSite.addEventListener('change', FP.applyFilters);
        FP.els.filterMaterial.addEventListener('change', FP.applyFilters);
        FP.els.filterCategory.addEventListener('change', FP.applyFilters);
        FP.els.filterDateFrom.addEventListener('change', FP.applyFilters);
        FP.els.filterDateTo.addEventListener('change', FP.applyFilters);

        // Quick Log
        FP.els.btnQuickLog.addEventListener('click', FP.openQuickLog);
        FP.els.quickLogClose.addEventListener('click', FP.closeQuickLog);
        FP.els.quickLogOverlay.addEventListener('click', function (e) { if (e.target === FP.els.quickLogOverlay) FP.closeQuickLog(); });
        FP.els.quickLogUploadArea.addEventListener('click', function () { FP.els.quickLogPhoto.click(); });
        FP.els.quickLogPhoto.addEventListener('change', function () {
            var file = FP.els.quickLogPhoto.files[0];
            if (file) {
                var reader = new FileReader();
                reader.onload = function (e) {
                    FP.els.quickLogPreview.src = e.target.result;
                    FP.els.quickLogPreview.style.display = 'block';
                    FP.els.quickLogUploadPlaceholder.style.display = 'none';
                };
                reader.readAsDataURL(file);
            }
        });
        FP.els.quickLogForm.addEventListener('submit', FP.handleQuickLogSubmit);
        FP.els.btnQuickLogDetails.addEventListener('click', FP.quickLogToFullModal);
    }

    /* ------------------------------------------------------------------ */
    /*  Modal                                                             */
    /* ------------------------------------------------------------------ */
    FP.openModal = function (find) {
        FP.currentPhotos = [];
        FP.newPhotoFiles = [];
        FP.editingFindId = null;

        if (find) {
            FP.els.modalTitle.textContent = _t('finds.modal.editTitle');
            FP.els.findId.value = find.id;
            FP.editingFindId = find.id;
            FP.els.site.value = find.site_id || '';
            FP.els.date.value = find.date || '';
            FP.els.latitude.value = find.latitude || '';
            FP.els.longitude.value = find.longitude || '';
            FP.els.description.value = find.description || '';
            FP.els.material.value = find.material || '';
            FP.els.estimatedAge.value = find.estimated_age || '';
            FP.els.depth.value = find.depth_cm != null
                ? (window.AppConfig ? AppConfig.depthForInput(find.depth_cm) : find.depth_cm)
                : (find.depth || '');
            FP.els.condition.value = find.condition || '';
            FP.els.value.value = find.value_estimate || '';
            FP.els.notes.value = find.notes || '';
            FP.els.category.value = find.category || '';
            FP.currentTags = find.tags ? find.tags.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
            FP.renderTags();
            FP.els.btnDelete.style.display = 'inline-block';
            FP.currentPhotos = (find.photos || []).slice();
            FP.renderPhotoGallery();
        } else {
            FP.els.modalTitle.textContent = _t('finds.modal.addTitle');
            FP.els.form.reset();
            FP.els.findId.value = '';
            FP.els.date.value = new Date().toISOString().split('T')[0];
            FP.els.category.value = '';
            FP.currentTags = [];
            FP.renderTags();
            FP.els.btnDelete.style.display = 'none';
            FP.renderPhotoGallery();
        }

        FP.els.modalOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    function closeModal() {
        FP.els.modalOverlay.classList.remove('open');
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
        FP.els.btnLocation.disabled = true;
        FP.els.btnLocation.textContent = _t('quickAdd.gettingLocation');

        navigator.geolocation.getCurrentPosition(
            function (position) {
                FP.els.latitude.value = position.coords.latitude.toFixed(6);
                FP.els.longitude.value = position.coords.longitude.toFixed(6);
                FP.els.btnLocation.disabled = false;
                FP.els.btnLocation.textContent = _t('finds.btn.useLocation');
            },
            function (error) {
                console.error('Geolocation error:', error);
                Auth.showToast(_t('finds.geoFailed'), 'warning');
                FP.els.btnLocation.disabled = false;
                FP.els.btnLocation.textContent = _t('finds.btn.useLocation');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Form Submit                                                       */
    /* ------------------------------------------------------------------ */
    async function handleFormSubmit(e) {
        e.preventDefault();

        var formData = new FormData();
        formData.append('site_id', FP.els.site.value);
        formData.append('date', FP.els.date.value);
        formData.append('latitude', FP.els.latitude.value);
        formData.append('longitude', FP.els.longitude.value);
        formData.append('description', FP.els.description.value.trim());
        formData.append('material', FP.els.material.value);
        formData.append('estimated_age', FP.els.estimatedAge.value.trim());
        var depthVal = FP.els.depth.value;
        if (window.AppConfig && depthVal) {
            formData.append('depth_cm', AppConfig.depthInputToCm(depthVal));
        } else if (depthVal) {
            formData.append('depth', depthVal);
        }
        formData.append('condition', FP.els.condition.value);
        formData.append('value_estimate', FP.els.value.value);
        formData.append('notes', FP.els.notes.value.trim());
        formData.append('category', FP.els.category.value);
        formData.append('tags', FP.els.tagsHidden.value);

        for (var pi = 0; pi < FP.newPhotoFiles.length; pi++) {
            formData.append('photos', FP.newPhotoFiles[pi]);
        }

        var id = FP.els.findId.value;
        var url = id ? '/api/finds/' + id : '/api/finds';
        var method = id ? 'PUT' : 'POST';

        try {
            FP.els.btnSave.disabled = true;
            FP.els.btnSave.textContent = _t('finds.modal.saving');
            var res = await Auth.authedFetch(url, { method: method, body: formData });
            if (!res.ok) {
                var errData = await res.json().catch(function () { return {}; });
                throw new Error(errData.message || 'Failed to save find');
            }
            if (id && FP.currentPhotos.length > 0) {
                var photoIds = FP.currentPhotos.map(function (p) { return p.id; });
                await Auth.authedFetch('/api/finds/' + id + '/photos/reorder', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ photo_ids: photoIds })
                });
            }
            closeModal();
            await FP.loadFinds();
        } catch (err) {
            console.error('Error saving find:', err);
            Auth.showToast(_t('finds.errorSaving'));
        } finally {
            FP.els.btnSave.disabled = false;
            FP.els.btnSave.textContent = _t('finds.modal.save');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Delete                                                            */
    /* ------------------------------------------------------------------ */
    async function handleDelete() {
        var id = FP.els.findId.value;
        if (!id) return;
        if (!confirm(_t('finds.confirmDelete'))) return;

        try {
            var res = await Auth.authedFetch('/api/finds/' + id, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete find');
            closeModal();
            await FP.loadFinds();
        } catch (err) {
            console.error('Error deleting find:', err);
            Auth.showToast(_t('finds.errorDeleting'));
        }
    }
})();
