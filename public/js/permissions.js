/**
 * Permissions page — core logic.
 * Creates the shared window.PP namespace used by permissions-contacts.js and permissions-links.js.
 * Handles init, events, data loading, filtering, rendering, modal, form submit, and delete.
 */
(function () {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    /* ------------------------------------------------------------------ */
    /*  Shared State (window.PP namespace)                                */
    /* ------------------------------------------------------------------ */
    var PP = window.PP = window.PP || {};
    PP.allPermissions = [];
    PP.allSites = [];
    PP.currentContacts = [];
    PP.editingPermId = null;
    PP.els = {};

    var activeFilter = 'all';
    var EXPIRY_WARNING_DAYS = 30;

    PP.escapeHtml = function (str) {
        return window.Auth ? Auth.escapeHtml(str) : (str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '');
    };

    /* ------------------------------------------------------------------ */
    /*  DOM References                                                    */
    /* ------------------------------------------------------------------ */
    function cacheElements() {
        var g = document.getElementById.bind(document);
        PP.els.permList = g('permissions-list');
        PP.els.filterTabs = g('filter-tabs');
        PP.els.modalOverlay = g('perm-modal-overlay');
        PP.els.modal = g('perm-modal');
        PP.els.modalTitle = g('perm-modal-title');
        PP.els.form = g('perm-form');
        PP.els.permId = g('perm-id');
        PP.els.site = g('perm-site');
        PP.els.landType = g('perm-land-type');
        PP.els.agency = g('perm-agency');
        PP.els.contactName = g('perm-contact-name');
        PP.els.contactPhone = g('perm-contact-phone');
        PP.els.contactEmail = g('perm-contact-email');
        PP.els.contactAddress = g('perm-contact-address');
        PP.els.dateRequested = g('perm-date-requested');
        PP.els.status = g('perm-status');
        PP.els.dateGranted = g('perm-date-granted');
        PP.els.expiration = g('perm-expiration');
        PP.els.docInput = g('perm-document');
        PP.els.docPreview = g('perm-doc-preview');
        PP.els.docName = g('perm-doc-name');
        PP.els.uploadPlaceholder = g('perm-upload-placeholder');
        PP.els.uploadArea = g('perm-upload-area');
        PP.els.notes = g('perm-notes');
        PP.els.btnAdd = g('btn-add-permission');
        PP.els.btnClose = g('btn-perm-modal-close');
        PP.els.btnCancel = g('btn-cancel-perm');
        PP.els.btnDelete = g('btn-delete-perm');
        PP.els.btnSave = g('btn-save-perm');
        // Contact log
        PP.els.contactLogSection = g('contact-log-section');
        PP.els.contactForm = g('contact-form');
        PP.els.contactTimeline = g('contact-timeline');
        PP.els.contactType = g('contact-type');
        PP.els.contactOutcome = g('contact-outcome');
        PP.els.contactDate = g('contact-date');
        PP.els.contactNotes = g('contact-notes');
        PP.els.btnAddContact = g('btn-add-contact');
        PP.els.btnCancelContact = g('btn-cancel-contact');
        PP.els.btnSaveContact = g('btn-save-contact');
        // Links
        PP.els.linkSection = g('link-section');
        PP.els.btnCreateLink = g('btn-create-link');
        PP.els.linkResult = g('link-result');
        PP.els.linkUrl = g('link-url');
        PP.els.btnCopyLink = g('btn-copy-link');
        PP.els.linkQrImage = g('link-qr-image');
        PP.els.linkExpiresText = g('link-expires-text');
        PP.els.linkHistory = g('link-history');
        // Letters
        PP.els.letterSection = g('letter-section');
        PP.els.btnGenerateLetter = g('btn-generate-letter');
        PP.els.letterStatus = g('letter-status');
        PP.els.letterHistory = g('letter-history');
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                              */
    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', function () {
        cacheElements();
        bindEvents();
        function startLoad() {
            loadSitesDropdown();
            loadPermissions();
            if (window.AppConfig) {
                AppConfig.onReady(function () {
                    AppConfig.populateLandTypeSelect(PP.els.landType);
                });
            }
        }
        if (window.I18n) { I18n.onReady(startLoad); } else { startLoad(); }
    });

    /* ------------------------------------------------------------------ */
    /*  Events                                                            */
    /* ------------------------------------------------------------------ */
    function bindEvents() {
        PP.els.btnAdd.addEventListener('click', function () { openModal(); });
        PP.els.btnClose.addEventListener('click', closeModal);
        PP.els.btnCancel.addEventListener('click', closeModal);
        PP.els.modalOverlay.addEventListener('click', function (e) {
            if (e.target === PP.els.modalOverlay) closeModal();
        });
        PP.els.form.addEventListener('submit', handleFormSubmit);
        PP.els.btnDelete.addEventListener('click', handleDelete);

        // Filter tabs
        PP.els.filterTabs.querySelectorAll('.filter-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                PP.els.filterTabs.querySelectorAll('.filter-tab').forEach(function (t) { t.classList.remove('active'); });
                tab.classList.add('active');
                activeFilter = tab.dataset.filter;
                applyFilter();
            });
        });

        // Links & letters (functions from permissions-links.js)
        PP.els.btnCreateLink.addEventListener('click', function () { PP.handleCreateLink(); });
        PP.els.btnCopyLink.addEventListener('click', function () { PP.handleCopyLink(); });
        PP.els.btnGenerateLetter.addEventListener('click', function () { PP.handleGenerateLetter(); });

        // Contact log (functions from permissions-contacts.js)
        PP.els.btnAddContact.addEventListener('click', function () { PP.showContactForm(); });
        PP.els.btnCancelContact.addEventListener('click', function () { PP.hideContactForm(); });
        PP.els.btnSaveContact.addEventListener('click', function () { PP.handleContactSubmit(); });

        // Document upload
        PP.els.uploadArea.addEventListener('click', function () { PP.els.docInput.click(); });
        PP.els.uploadArea.addEventListener('dragover', function (e) { e.preventDefault(); PP.els.uploadArea.classList.add('drag-over'); });
        PP.els.uploadArea.addEventListener('dragleave', function () { PP.els.uploadArea.classList.remove('drag-over'); });
        PP.els.uploadArea.addEventListener('drop', function (e) {
            e.preventDefault(); PP.els.uploadArea.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                PP.els.docInput.files = e.dataTransfer.files;
                previewDocument(e.dataTransfer.files[0]);
            }
        });
        PP.els.docInput.addEventListener('change', function () {
            if (PP.els.docInput.files.length > 0) previewDocument(PP.els.docInput.files[0]);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Data Loading                                                      */
    /* ------------------------------------------------------------------ */
    async function loadSitesDropdown() {
        try {
            var res = await Auth.authedFetch('/api/sites');
            if (!res.ok) throw new Error('Failed to fetch sites');
            var json = await res.json();
            PP.allSites = json.data || [];
            var esc = PP.escapeHtml;
            var options = '<option value="">' + _t('permissions.label.noSite') + '</option>';
            PP.allSites.forEach(function (s) {
                options += '<option value="' + s.id + '">' + esc(s.name || 'Unnamed') + '</option>';
            });
            PP.els.site.innerHTML = options;
        } catch (err) {
            console.error('Error loading sites for dropdown:', err);
        }
    }

    async function loadPermissions() {
        try {
            var res = await Auth.authedFetch('/api/permissions');
            if (!res.ok) throw new Error('Failed to fetch permissions');
            var json = await res.json();
            PP.allPermissions = json.data || [];
            applyFilter();
        } catch (err) {
            console.error('Error loading permissions:', err);
            PP.els.permList.innerHTML = '<p class="error-text">' + _t('permissions.errorLoading') + '</p>';
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Filtering & Rendering                                             */
    /* ------------------------------------------------------------------ */
    function applyFilter() {
        var filtered = PP.allPermissions.slice();
        if (activeFilter !== 'all') {
            filtered = filtered.filter(function (p) { return p.status === activeFilter; });
        }
        renderPermissionsList(filtered);
    }

    function renderPermissionsList(permissions) {
        if (permissions.length === 0) {
            PP.els.permList.innerHTML = '<div class="empty-state">' +
                '<div class="empty-state-icon">&#128221;</div>' +
                '<h3 class="empty-state-title">' + _t('permissions.empty.title') + '</h3>' +
                '<p class="empty-state-text">' + _t('permissions.empty.text') + '</p>' +
                '<button class="btn btn--primary" onclick="document.getElementById(\'btn-add-permission\').click()">' + _t('permissions.empty.cta') + '</button>' +
                '</div>';
            return;
        }

        var esc = PP.escapeHtml;
        var now = new Date();
        var html = '';

        permissions.forEach(function (perm) {
            var statusClass = 'perm-status-' + (perm.status || 'pending');
            var siteName = getSiteName(perm.site_id);
            var dateRequested = perm.date_requested ? new Date(perm.date_requested).toLocaleDateString() : '';
            var dateGranted = perm.date_granted ? new Date(perm.date_granted).toLocaleDateString() : '';
            var expDate = perm.expiration_date ? new Date(perm.expiration_date) : null;
            var expDateStr = expDate ? expDate.toLocaleDateString() : '';

            var expiryWarning = '';
            if (expDate && perm.status === 'approved') {
                var daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
                if (daysLeft <= 0) {
                    expiryWarning = '<span class="badge badge-expired">EXPIRED</span>';
                } else if (daysLeft <= EXPIRY_WARNING_DAYS) {
                    expiryWarning = '<span class="badge badge-expiring">Expires in ' + daysLeft + ' days</span>';
                }
            }

            var hasDoc = perm.document_url || false;

            html += '<div class="perm-card" data-id="' + perm.id + '">' +
                '<div class="perm-card-header">' +
                '<div class="perm-card-title-row">' +
                '<h3 class="perm-card-title">' + esc(perm.agency_owner || 'Unknown') + '</h3>' +
                '<span class="badge ' + statusClass + '">' + esc(perm.status || 'pending') + '</span>' +
                expiryWarning +
                '</div>' +
                (perm.land_type ? '<span class="perm-land-type">' + esc(perm.land_type) + '</span>' : '') +
                '</div>' +
                '<div class="perm-card-body">' +
                (siteName !== 'No site' ? '<p class="perm-site-link">Site: <strong>' + esc(siteName) + '</strong></p>' : '') +
                '<div class="perm-card-dates">' +
                (dateRequested ? '<span>Requested: ' + esc(dateRequested) + '</span>' : '') +
                (dateGranted ? '<span>Granted: ' + esc(dateGranted) + '</span>' : '') +
                (expDateStr ? '<span>Expires: ' + esc(expDateStr) + '</span>' : '') +
                '</div>' +
                (hasDoc ? '<div class="perm-card-doc"><span class="doc-icon-small">&#128196;</span> Document attached</div>' : '') +
                '<div class="perm-card-footer">' +
                '<a href="/print-permission.html?permId=' + perm.id + (perm.site_id ? '&siteId=' + perm.site_id : '') + '" class="perm-letter-link" title="' + esc(_t('permissions.generateLetter')) + '">&#128232; ' + esc(_t('permissions.generateLetter')) + '</a>' +
                '</div>' +
                '</div>' +
                '</div>';
        });

        PP.els.permList.innerHTML = html;

        PP.els.permList.querySelectorAll('.perm-card').forEach(function (card) {
            card.addEventListener('click', function (e) {
                if (e.target.closest('.perm-letter-link')) return;
                var id = card.dataset.id;
                var perm = PP.allPermissions.find(function (p) { return String(p.id) === String(id); });
                if (perm) openModal(perm);
            });
        });
    }

    function getSiteName(siteId) {
        if (!siteId) return 'No site';
        var site = PP.allSites.find(function (s) { return String(s.id) === String(siteId); });
        return site ? (site.name || 'Unnamed Site') : 'Site #' + siteId;
    }

    /* ------------------------------------------------------------------ */
    /*  Modal                                                             */
    /* ------------------------------------------------------------------ */
    function openModal(perm) {
        PP.hideContactForm();
        PP.currentContacts = [];
        PP.editingPermId = null;

        if (perm) {
            PP.editingPermId = perm.id;
            PP.els.modalTitle.textContent = _t('permissions.modal.editTitle');
            PP.els.permId.value = perm.id;
            PP.els.site.value = perm.site_id || '';
            if (window.AppConfig) {
                AppConfig.populateLandTypeSelect(PP.els.landType, perm.land_type || '');
            } else {
                PP.els.landType.value = perm.land_type || '';
            }
            PP.els.agency.value = perm.agency_owner || '';
            PP.els.contactName.value = perm.contact_name || '';
            PP.els.contactPhone.value = perm.contact_phone || '';
            PP.els.contactEmail.value = perm.contact_email || '';
            PP.els.contactAddress.value = perm.contact_address || '';
            PP.els.dateRequested.value = perm.date_requested || '';
            PP.els.status.value = perm.status || 'pending';
            PP.els.dateGranted.value = perm.date_granted || '';
            PP.els.expiration.value = perm.expiration_date || '';
            PP.els.notes.value = perm.notes || '';
            PP.els.btnDelete.classList.remove('hidden');

            if (perm.document_url) {
                PP.els.docPreview.classList.remove('hidden');
                PP.els.docName.textContent = perm.document_name || 'Attached document';
                PP.els.uploadPlaceholder.classList.add('hidden');
            } else {
                PP.els.docPreview.classList.add('hidden');
                PP.els.uploadPlaceholder.classList.remove('hidden');
            }

            PP.els.contactLogSection.classList.remove('hidden');
            PP.loadContacts(perm.id);
            PP.els.linkSection.classList.remove('hidden');
            PP.els.linkResult.classList.add('hidden');
            PP.loadLinkHistory(perm.id);
            PP.els.letterSection.classList.remove('hidden');
            PP.els.letterStatus.classList.add('hidden');
            PP.loadLetterHistory(perm.id);
        } else {
            PP.els.modalTitle.textContent = _t('permissions.modal.addTitle');
            PP.els.form.reset();
            PP.els.permId.value = '';
            PP.els.dateRequested.value = new Date().toISOString().split('T')[0];
            PP.els.btnDelete.classList.add('hidden');
            PP.els.docPreview.classList.add('hidden');
            PP.els.uploadPlaceholder.classList.remove('hidden');
            PP.els.contactLogSection.classList.add('hidden');
            PP.els.linkSection.classList.add('hidden');
            PP.els.letterSection.classList.add('hidden');
        }

        PP.els.modalOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        PP.els.modalOverlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    function previewDocument(file) {
        if (!file) return;
        PP.els.docPreview.classList.remove('hidden');
        PP.els.docName.textContent = file.name;
        PP.els.uploadPlaceholder.classList.add('hidden');
    }

    /* ------------------------------------------------------------------ */
    /*  Form Submit & Delete                                              */
    /* ------------------------------------------------------------------ */
    async function handleFormSubmit(e) {
        e.preventDefault();
        var formData = new FormData();
        formData.append('site_id', PP.els.site.value);
        formData.append('land_type', PP.els.landType.value.trim());
        formData.append('agency_owner', PP.els.agency.value.trim());
        formData.append('contact_name', PP.els.contactName.value.trim());
        formData.append('contact_phone', PP.els.contactPhone.value.trim());
        formData.append('contact_email', PP.els.contactEmail.value.trim());
        formData.append('contact_address', PP.els.contactAddress.value.trim());
        formData.append('date_requested', PP.els.dateRequested.value);
        formData.append('status', PP.els.status.value);
        formData.append('date_granted', PP.els.dateGranted.value);
        formData.append('expiration_date', PP.els.expiration.value);
        formData.append('notes', PP.els.notes.value.trim());
        if (PP.els.docInput.files.length > 0) formData.append('document', PP.els.docInput.files[0]);

        var id = PP.els.permId.value;
        var url = id ? '/api/permissions/' + id : '/api/permissions';
        var method = id ? 'PUT' : 'POST';

        try {
            PP.els.btnSave.disabled = true;
            PP.els.btnSave.textContent = _t('permissions.modal.saving');
            var res = await Auth.authedFetch(url, { method: method, body: formData });
            if (!res.ok) {
                var errData = await res.json().catch(function () { return {}; });
                throw new Error(errData.message || 'Failed to save permission');
            }
            closeModal();
            await loadPermissions();
        } catch (err) {
            console.error('Error saving permission:', err);
            Auth.showToast(_t('permissions.errorSaving'));
        } finally {
            PP.els.btnSave.disabled = false;
            PP.els.btnSave.textContent = _t('permissions.modal.save');
        }
    }

    async function handleDelete() {
        var id = PP.els.permId.value;
        if (!id) return;
        if (!confirm(_t('permissions.confirmDelete'))) return;
        try {
            var res = await Auth.authedFetch('/api/permissions/' + id, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete permission');
            closeModal();
            await loadPermissions();
        } catch (err) {
            console.error('Error deleting permission:', err);
            Auth.showToast(_t('permissions.errorDeleting'));
        }
    }
})();
