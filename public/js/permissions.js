/**
 * Permissions page logic
 * Handles CRUD operations for permission records, status filtering,
 * expiration warnings, and document uploads.
 */
(function () {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    /* ------------------------------------------------------------------ */
    /*  State                                                             */
    /* ------------------------------------------------------------------ */
    let allPermissions = [];
    let allSites = [];
    let activeFilter = 'all';
    let currentContacts = [];
    let editingPermId = null;

    const EXPIRY_WARNING_DAYS = 30;

    /* ------------------------------------------------------------------ */
    /*  DOM References                                                    */
    /* ------------------------------------------------------------------ */
    const els = {};
    function cacheElements() {
        els.permList = document.getElementById('permissions-list');
        els.filterTabs = document.getElementById('filter-tabs');
        els.modalOverlay = document.getElementById('perm-modal-overlay');
        els.modal = document.getElementById('perm-modal');
        els.modalTitle = document.getElementById('perm-modal-title');
        els.form = document.getElementById('perm-form');
        els.permId = document.getElementById('perm-id');
        els.site = document.getElementById('perm-site');
        els.landType = document.getElementById('perm-land-type');
        els.agency = document.getElementById('perm-agency');
        els.contactName = document.getElementById('perm-contact-name');
        els.contactPhone = document.getElementById('perm-contact-phone');
        els.contactEmail = document.getElementById('perm-contact-email');
        els.contactAddress = document.getElementById('perm-contact-address');
        els.dateRequested = document.getElementById('perm-date-requested');
        els.status = document.getElementById('perm-status');
        els.dateGranted = document.getElementById('perm-date-granted');
        els.expiration = document.getElementById('perm-expiration');
        els.docInput = document.getElementById('perm-document');
        els.docPreview = document.getElementById('perm-doc-preview');
        els.docName = document.getElementById('perm-doc-name');
        els.uploadPlaceholder = document.getElementById('perm-upload-placeholder');
        els.uploadArea = document.getElementById('perm-upload-area');
        els.notes = document.getElementById('perm-notes');
        els.btnAdd = document.getElementById('btn-add-permission');
        els.btnClose = document.getElementById('btn-perm-modal-close');
        els.btnCancel = document.getElementById('btn-cancel-perm');
        els.btnDelete = document.getElementById('btn-delete-perm');
        els.btnSave = document.getElementById('btn-save-perm');
        // Contact log elements
        els.contactLogSection = document.getElementById('contact-log-section');
        els.contactForm = document.getElementById('contact-form');
        els.contactTimeline = document.getElementById('contact-timeline');
        els.contactType = document.getElementById('contact-type');
        els.contactOutcome = document.getElementById('contact-outcome');
        els.contactDate = document.getElementById('contact-date');
        els.contactNotes = document.getElementById('contact-notes');
        els.btnAddContact = document.getElementById('btn-add-contact');
        els.btnCancelContact = document.getElementById('btn-cancel-contact');
        els.btnSaveContact = document.getElementById('btn-save-contact');
        // Permission link elements
        els.linkSection = document.getElementById('link-section');
        els.btnCreateLink = document.getElementById('btn-create-link');
        els.linkResult = document.getElementById('link-result');
        els.linkUrl = document.getElementById('link-url');
        els.btnCopyLink = document.getElementById('btn-copy-link');
        els.linkQrImage = document.getElementById('link-qr-image');
        els.linkExpiresText = document.getElementById('link-expires-text');
        els.linkHistory = document.getElementById('link-history');
        // Letter generation elements
        els.letterSection = document.getElementById('letter-section');
        els.btnGenerateLetter = document.getElementById('btn-generate-letter');
        els.letterStatus = document.getElementById('letter-status');
        els.letterHistory = document.getElementById('letter-history');
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                              */
    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', () => {
        cacheElements();
        bindEvents();
        function startLoad() {
            loadSitesDropdown();
            loadPermissions();
            // Populate land type dropdown from AppConfig once ready
            if (window.AppConfig) {
                AppConfig.onReady(function () {
                    AppConfig.populateLandTypeSelect(els.landType);
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

        // Filter tabs
        els.filterTabs.querySelectorAll('.filter-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                els.filterTabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                activeFilter = tab.dataset.filter;
                applyFilter();
            });
        });

        // Permission links
        els.btnCreateLink.addEventListener('click', handleCreateLink);
        els.btnCopyLink.addEventListener('click', handleCopyLink);

        // Letter generation
        els.btnGenerateLetter.addEventListener('click', handleGenerateLetter);

        // Contact log
        els.btnAddContact.addEventListener('click', showContactForm);
        els.btnCancelContact.addEventListener('click', hideContactForm);
        els.btnSaveContact.addEventListener('click', handleContactSubmit);

        // Document upload
        els.uploadArea.addEventListener('click', () => els.docInput.click());
        els.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            els.uploadArea.classList.add('drag-over');
        });
        els.uploadArea.addEventListener('dragleave', () => {
            els.uploadArea.classList.remove('drag-over');
        });
        els.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            els.uploadArea.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                els.docInput.files = e.dataTransfer.files;
                previewDocument(e.dataTransfer.files[0]);
            }
        });
        els.docInput.addEventListener('change', () => {
            if (els.docInput.files.length > 0) {
                previewDocument(els.docInput.files[0]);
            }
        });
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

            let options = '<option value="">' + _t('permissions.label.noSite') + '</option>';
            allSites.forEach(s => {
                options += '<option value="' + s.id + '">' + esc(s.name || 'Unnamed') + '</option>';
            });
            els.site.innerHTML = options;
        } catch (err) {
            console.error('Error loading sites for dropdown:', err);
        }
    }

    async function loadPermissions() {
        try {
            const res = await Auth.authedFetch('/api/permissions');
            if (!res.ok) throw new Error('Failed to fetch permissions');
            const json = await res.json();
            allPermissions = json.data || [];
            applyFilter();
        } catch (err) {
            console.error('Error loading permissions:', err);
            els.permList.innerHTML = '<p class="error-text">' + _t('permissions.errorLoading') + '</p>';
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Filtering                                                         */
    /* ------------------------------------------------------------------ */
    function applyFilter() {
        let filtered = [...allPermissions];

        if (activeFilter !== 'all') {
            filtered = filtered.filter(p => p.status === activeFilter);
        }

        renderPermissionsList(filtered);
    }

    /* ------------------------------------------------------------------ */
    /*  Rendering                                                         */
    /* ------------------------------------------------------------------ */
    function renderPermissionsList(permissions) {
        if (permissions.length === 0) {
            els.permList.innerHTML = '<div class="empty-state">' +
                '<div class="empty-state-icon">&#128221;</div>' +
                '<h3 class="empty-state-title">' + _t('permissions.empty.title') + '</h3>' +
                '<p class="empty-state-text">' + _t('permissions.empty.text') + '</p>' +
                '<button class="btn btn--primary" onclick="document.getElementById(\'btn-add-permission\').click()">' + _t('permissions.empty.cta') + '</button>' +
                '</div>';
            return;
        }

        const esc = escapeHtml;
        const now = new Date();
        let html = '';

        permissions.forEach(perm => {
            const statusClass = 'perm-status-' + (perm.status || 'pending');
            const siteName = getSiteName(perm.site_id);
            const dateRequested = perm.date_requested ? new Date(perm.date_requested).toLocaleDateString() : '';
            const dateGranted = perm.date_granted ? new Date(perm.date_granted).toLocaleDateString() : '';
            const expDate = perm.expiration_date ? new Date(perm.expiration_date) : null;
            const expDateStr = expDate ? expDate.toLocaleDateString() : '';

            // Expiration warning
            let expiryWarning = '';
            if (expDate && perm.status === 'approved') {
                const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
                if (daysLeft <= 0) {
                    expiryWarning = '<span class="badge badge-expired">EXPIRED</span>';
                } else if (daysLeft <= EXPIRY_WARNING_DAYS) {
                    expiryWarning = '<span class="badge badge-expiring">Expires in ' + daysLeft + ' days</span>';
                }
            }

            const hasDoc = perm.document_url || false;

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

        els.permList.innerHTML = html;

        // Bind click to open edit (but not if clicking the letter link)
        els.permList.querySelectorAll('.perm-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.perm-letter-link')) return;
                const id = card.dataset.id;
                const perm = allPermissions.find(p => String(p.id) === String(id));
                if (perm) openModal(perm);
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
    function openModal(perm) {
        // Reset contact form state
        hideContactForm();
        currentContacts = [];
        editingPermId = null;

        if (perm) {
            editingPermId = perm.id;
            els.modalTitle.textContent = _t('permissions.modal.editTitle');
            els.permId.value = perm.id;
            els.site.value = perm.site_id || '';
            if (window.AppConfig) {
                AppConfig.populateLandTypeSelect(els.landType, perm.land_type || '');
            } else {
                els.landType.value = perm.land_type || '';
            }
            els.agency.value = perm.agency_owner || '';
            els.contactName.value = perm.contact_name || '';
            els.contactPhone.value = perm.contact_phone || '';
            els.contactEmail.value = perm.contact_email || '';
            els.contactAddress.value = perm.contact_address || '';
            els.dateRequested.value = perm.date_requested || '';
            els.status.value = perm.status || 'pending';
            els.dateGranted.value = perm.date_granted || '';
            els.expiration.value = perm.expiration_date || '';
            els.notes.value = perm.notes || '';
            els.btnDelete.style.display = 'inline-block';

            if (perm.document_url) {
                els.docPreview.style.display = 'flex';
                els.docName.textContent = perm.document_name || 'Attached document';
                els.uploadPlaceholder.style.display = 'none';
            } else {
                els.docPreview.style.display = 'none';
                els.uploadPlaceholder.style.display = '';
            }

            // Show contact log section and load contacts
            els.contactLogSection.style.display = '';
            loadContacts(perm.id);

            // Show link section and load history
            els.linkSection.style.display = '';
            els.linkResult.style.display = 'none';
            loadLinkHistory(perm.id);

            // Show letter section and load history
            els.letterSection.style.display = '';
            els.letterStatus.style.display = 'none';
            loadLetterHistory(perm.id);
        } else {
            els.modalTitle.textContent = _t('permissions.modal.addTitle');
            els.form.reset();
            els.permId.value = '';
            // Default date requested to today
            const today = new Date().toISOString().split('T')[0];
            els.dateRequested.value = today;
            els.btnDelete.style.display = 'none';
            els.docPreview.style.display = 'none';
            els.uploadPlaceholder.style.display = '';
            // Hide contact log, link, and letter sections for new permissions (no ID yet)
            els.contactLogSection.style.display = 'none';
            els.linkSection.style.display = 'none';
            els.letterSection.style.display = 'none';
        }

        els.modalOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        els.modalOverlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    /* ------------------------------------------------------------------ */
    /*  Document Preview                                                  */
    /* ------------------------------------------------------------------ */
    function previewDocument(file) {
        if (!file) return;
        els.docPreview.style.display = 'flex';
        els.docName.textContent = file.name;
        els.uploadPlaceholder.style.display = 'none';
    }

    /* ------------------------------------------------------------------ */
    /*  Form Submit                                                       */
    /* ------------------------------------------------------------------ */
    async function handleFormSubmit(e) {
        e.preventDefault();

        const formData = new FormData();
        formData.append('site_id', els.site.value);
        formData.append('land_type', els.landType.value.trim());
        formData.append('agency_owner', els.agency.value.trim());
        formData.append('contact_name', els.contactName.value.trim());
        formData.append('contact_phone', els.contactPhone.value.trim());
        formData.append('contact_email', els.contactEmail.value.trim());
        formData.append('contact_address', els.contactAddress.value.trim());
        formData.append('date_requested', els.dateRequested.value);
        formData.append('status', els.status.value);
        formData.append('date_granted', els.dateGranted.value);
        formData.append('expiration_date', els.expiration.value);
        formData.append('notes', els.notes.value.trim());

        if (els.docInput.files.length > 0) {
            formData.append('document', els.docInput.files[0]);
        }

        const id = els.permId.value;
        const url = id ? '/api/permissions/' + id : '/api/permissions';
        const method = id ? 'PUT' : 'POST';

        try {
            els.btnSave.disabled = true;
            els.btnSave.textContent = _t('permissions.modal.saving');
            const res = await Auth.authedFetch(url, { method: method, body: formData });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || 'Failed to save permission');
            }
            closeModal();
            await loadPermissions();
        } catch (err) {
            console.error('Error saving permission:', err);
            Auth.showToast(_t('permissions.errorSaving') + ' ' + err.message);
        } finally {
            els.btnSave.disabled = false;
            els.btnSave.textContent = _t('permissions.modal.save');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Delete                                                            */
    /* ------------------------------------------------------------------ */
    async function handleDelete() {
        const id = els.permId.value;
        if (!id) return;
        if (!confirm(_t('permissions.confirmDelete'))) return;

        try {
            const res = await Auth.authedFetch('/api/permissions/' + id, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete permission');
            closeModal();
            await loadPermissions();
        } catch (err) {
            console.error('Error deleting permission:', err);
            Auth.showToast(_t('permissions.errorDeleting') + ' ' + err.message);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Contact Log                                                       */
    /* ------------------------------------------------------------------ */

    var CONTACT_TYPE_ICONS = {
        phone_call: '\u260E',
        email: '\u2709',
        in_person: '\uD83E\uDD1D',
        letter_sent: '\uD83D\uDCE4',
        letter_received: '\uD83D\uDCE5',
        other: '\uD83D\uDCCC',
    };

    var OUTCOME_CLASSES = {
        positive: 'outcome-positive',
        neutral: 'outcome-neutral',
        negative: 'outcome-negative',
        no_response: 'outcome-no-response',
        follow_up_needed: 'outcome-follow-up',
    };

    async function loadContacts(permId) {
        try {
            var res = await Auth.authedFetch('/api/permissions/' + permId + '/contacts');
            if (!res.ok) throw new Error('Failed to load contacts');
            var json = await res.json();
            currentContacts = json.data || [];
            renderContactTimeline(currentContacts);
        } catch (err) {
            console.error('Error loading contacts:', err);
            els.contactTimeline.innerHTML = '<p class="contact-empty">' + escapeHtml(err.message) + '</p>';
        }
    }

    function renderContactTimeline(contacts) {
        if (!contacts || contacts.length === 0) {
            els.contactTimeline.innerHTML = '<p class="contact-empty">' + _t('permissions.contacts.empty') + '</p>';
            return;
        }

        var esc = escapeHtml;
        var html = '';
        contacts.forEach(function (c) {
            var icon = CONTACT_TYPE_ICONS[c.contact_type] || '\uD83D\uDCCC';
            var typeLabel = _t('contact_type.' + c.contact_type) || c.contact_type;
            var outcomeHtml = '';
            if (c.outcome) {
                var outcomeClass = OUTCOME_CLASSES[c.outcome] || '';
                var outcomeLabel = _t('outcome.' + c.outcome) || c.outcome;
                outcomeHtml = '<span class="contact-outcome-badge ' + outcomeClass + '">' + esc(outcomeLabel) + '</span>';
            }
            var dateStr = c.contact_date ? new Date(c.contact_date).toLocaleDateString() : '';

            html += '<div class="contact-item" data-contact-id="' + c.id + '">' +
                '<div class="contact-item-icon">' + icon + '</div>' +
                '<div class="contact-item-body">' +
                '<div class="contact-item-header">' +
                '<span class="contact-type-label">' + esc(typeLabel) + '</span>' +
                outcomeHtml +
                '<span class="contact-date">' + esc(dateStr) + '</span>' +
                '<button type="button" class="contact-delete-btn" data-cid="' + c.id + '" title="' + esc(_t('permissions.contacts.delete')) + '">&times;</button>' +
                '</div>' +
                (c.notes ? '<p class="contact-notes">' + esc(c.notes) + '</p>' : '') +
                '</div>' +
                '</div>';
        });

        els.contactTimeline.innerHTML = html;

        // Bind delete buttons
        els.contactTimeline.querySelectorAll('.contact-delete-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                handleContactDelete(btn.dataset.cid);
            });
        });
    }

    function showContactForm() {
        var today = new Date().toISOString().split('T')[0];
        els.contactType.value = 'phone_call';
        els.contactOutcome.value = '';
        els.contactDate.value = today;
        els.contactNotes.value = '';
        els.contactForm.style.display = '';
        els.btnAddContact.style.display = 'none';
    }

    function hideContactForm() {
        if (els.contactForm) els.contactForm.style.display = 'none';
        if (els.btnAddContact) els.btnAddContact.style.display = '';
    }

    async function handleContactSubmit() {
        if (!editingPermId) return;
        var body = {
            contact_type: els.contactType.value,
            outcome: els.contactOutcome.value || undefined,
            notes: els.contactNotes.value.trim() || undefined,
            contact_date: els.contactDate.value || undefined,
        };

        try {
            els.btnSaveContact.disabled = true;
            var res = await Auth.authedFetch('/api/permissions/' + editingPermId + '/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                var errData = await res.json().catch(function () { return {}; });
                throw new Error(errData.error || 'Failed to save contact');
            }
            hideContactForm();
            await loadContacts(editingPermId);

            // If outcome is follow_up_needed, offer to create a reminder
            if (body.outcome === 'follow_up_needed') {
                promptFollowUpReminder();
            }
        } catch (err) {
            console.error('Error saving contact:', err);
            Auth.showToast(err.message);
        } finally {
            els.btnSaveContact.disabled = false;
        }
    }

    function promptFollowUpReminder() {
        if (!editingPermId) return;
        if (!confirm(_t('reminders.setReminder') + '?')) return;

        var perm = allPermissions.find(function (p) { return p.id === editingPermId; });
        var defaultTitle = 'Follow up: ' + (perm ? (perm.agency_owner || '') : '');
        var title = prompt(_t('reminders.setReminder'), defaultTitle);
        if (!title) return;

        var dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7);
        var dueDateStr = dueDate.toISOString().split('T')[0];

        Auth.authedFetch('/api/reminders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                permission_id: editingPermId,
                reminder_type: 'follow_up',
                title: title,
                due_date: dueDateStr,
            }),
        }).then(function (res) {
            if (res.ok) {
                Auth.showToast(_t('reminders.setReminder') + ' \u2705');
            }
        }).catch(function (err) {
            console.error('Error creating reminder:', err);
        });
    }

    async function handleContactDelete(cid) {
        if (!editingPermId || !cid) return;
        if (!confirm(_t('permissions.contacts.deleteConfirm'))) return;

        try {
            var res = await Auth.authedFetch('/api/permissions/' + editingPermId + '/contacts/' + cid, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete contact');
            await loadContacts(editingPermId);
        } catch (err) {
            console.error('Error deleting contact:', err);
            Auth.showToast(err.message);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Letter Generation                                                 */
    /* ------------------------------------------------------------------ */

    async function handleGenerateLetter() {
        if (!editingPermId) return;
        els.btnGenerateLetter.disabled = true;
        els.btnGenerateLetter.textContent = _t('permissions.letter.generating');
        els.letterStatus.style.display = 'none';

        try {
            var res = await Auth.authedFetch('/api/permissions/' + editingPermId + '/letter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            var data = await res.json();
            if (!res.ok) {
                if (data.error && data.error.indexOf('letter preferences') !== -1) {
                    els.letterStatus.textContent = _t('permissions.letter.needPrefs');
                } else {
                    els.letterStatus.textContent = _t('permissions.letter.error');
                }
                els.letterStatus.className = 'letter-status letter-status-error';
                els.letterStatus.style.display = '';
                return;
            }

            // Success — show message and open PDF
            els.letterStatus.textContent = _t('permissions.letter.generated');
            els.letterStatus.className = 'letter-status letter-status-success';
            els.letterStatus.style.display = '';

            if (data.data && data.data.download_url) {
                window.open(data.data.download_url, '_blank');
            }

            // Refresh letter history
            await loadLetterHistory(editingPermId);
        } catch (err) {
            console.error('Error generating letter:', err);
            els.letterStatus.textContent = _t('permissions.letter.error');
            els.letterStatus.className = 'letter-status letter-status-error';
            els.letterStatus.style.display = '';
        } finally {
            els.btnGenerateLetter.disabled = false;
            els.btnGenerateLetter.textContent = _t('permissions.letter.generate');
        }
    }

    async function loadLetterHistory(permId) {
        try {
            var res = await Auth.authedFetch('/api/permissions/' + permId + '/letters');
            if (!res.ok) return;
            var data = await res.json();
            renderLetterHistory(data.data || []);
        } catch (err) {
            console.error('Error loading letter history:', err);
        }
    }

    function renderLetterHistory(letters) {
        if (!letters || letters.length === 0) {
            els.letterHistory.innerHTML = '<p class="letter-empty">' + escapeHtml(_t('permissions.letter.empty')) + '</p>';
            return;
        }

        var html = '<div class="letter-history-list">';
        for (var i = 0; i < letters.length; i++) {
            var letter = letters[i];
            var dateStr = letter.created_at ? new Date(letter.created_at).toLocaleDateString() : '';
            html += '<div class="letter-history-item">'
                + '<span class="letter-history-icon">\uD83D\uDCC4</span>'
                + '<span class="letter-history-name">' + escapeHtml(letter.filename) + '</span>'
                + '<span class="letter-history-date">' + escapeHtml(dateStr) + '</span>'
                + '<a href="' + escapeHtml(letter.download_url) + '" target="_blank" class="btn btn-sm btn-outline letter-history-download">'
                + _t('permissions.letter.download') + '</a>'
                + '</div>';
        }
        html += '</div>';
        els.letterHistory.innerHTML = html;
    }

    /* ------------------------------------------------------------------ */
    /*  Permission Links                                                   */
    /* ------------------------------------------------------------------ */

    var LINK_STATUS_CLASSES = {
        active: 'link-status-active',
        approved: 'link-status-approved',
        denied: 'link-status-denied',
        revoked: 'link-status-revoked',
        expired: 'link-status-expired',
    };

    async function handleCreateLink() {
        if (!editingPermId) return;
        els.btnCreateLink.disabled = true;
        els.btnCreateLink.textContent = _t('permissions.link.creating');

        try {
            var res = await Auth.authedFetch('/api/permissions/' + editingPermId + '/link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expires_in_days: 30 }),
            });
            var data = await res.json();
            if (!res.ok) {
                Auth.showToast(data.error || 'Failed to create link');
                return;
            }

            // Show result section with URL, QR, and expiration
            els.linkResult.style.display = '';
            els.linkUrl.value = data.data.url;
            els.linkQrImage.src = data.data.qr_code;
            var expiresDate = new Date(data.data.expires_at).toLocaleDateString();
            els.linkExpiresText.textContent = _t('permissions.link.expires') + ': ' + expiresDate;

            // Refresh link history
            await loadLinkHistory(editingPermId);
        } catch (err) {
            console.error('Error creating link:', err);
            Auth.showToast(err.message);
        } finally {
            els.btnCreateLink.disabled = false;
            els.btnCreateLink.textContent = _t('permissions.link.create');
        }
    }

    function handleCopyLink() {
        if (!els.linkUrl.value) return;
        els.linkUrl.select();
        navigator.clipboard.writeText(els.linkUrl.value).then(function () {
            els.btnCopyLink.textContent = _t('permissions.link.copied');
            setTimeout(function () {
                els.btnCopyLink.textContent = _t('permissions.link.copyUrl');
            }, 2000);
        }).catch(function () {
            // Fallback: execCommand
            document.execCommand('copy');
        });
    }

    async function loadLinkHistory(permId) {
        try {
            var res = await Auth.authedFetch('/api/permissions/' + permId + '/links');
            if (!res.ok) return;
            var data = await res.json();
            renderLinkHistory(data.data || []);
        } catch (err) {
            console.error('Error loading links:', err);
        }
    }

    function renderLinkHistory(links) {
        if (!links || links.length === 0) {
            els.linkHistory.innerHTML = '<p class="link-empty">' + escapeHtml(_t('permissions.link.empty')) + '</p>';
            return;
        }

        var esc = escapeHtml;
        var html = '<div class="link-history-list">';
        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            var statusClass = LINK_STATUS_CLASSES[link.status] || '';
            var createdStr = link.created_at ? new Date(link.created_at).toLocaleDateString() : '';
            var expiresStr = link.expires_at ? new Date(link.expires_at).toLocaleDateString() : '';

            // Check if expired but still marked active
            var displayStatus = link.status;
            if (link.status === 'active' && link.expires_at && new Date(link.expires_at) < new Date()) {
                displayStatus = 'expired';
                statusClass = LINK_STATUS_CLASSES.expired;
            }

            html += '<div class="link-history-item">'
                + '<span class="link-status-badge ' + statusClass + '">' + esc(displayStatus) + '</span>'
                + '<span class="link-history-date">' + esc(createdStr) + '</span>';

            if (link.signed_name) {
                html += '<span class="link-signed-name">Signed: ' + esc(link.signed_name) + '</span>';
            }

            html += '<span class="link-expires">' + _t('permissions.link.expires') + ': ' + esc(expiresStr) + '</span>';

            // Revoke button for active links
            if (link.status === 'active' && displayStatus === 'active') {
                html += '<button type="button" class="btn btn-sm btn-danger link-revoke-btn" data-lid="' + link.id + '">'
                    + _t('permissions.link.revoke') + '</button>';
            }

            html += '</div>';
        }
        html += '</div>';
        els.linkHistory.innerHTML = html;

        // Bind revoke buttons
        els.linkHistory.querySelectorAll('.link-revoke-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                handleRevokeLink(btn.dataset.lid);
            });
        });
    }

    async function handleRevokeLink(lid) {
        if (!editingPermId || !lid) return;
        if (!confirm(_t('permissions.link.revokeConfirm'))) return;

        try {
            var res = await Auth.authedFetch('/api/permissions/' + editingPermId + '/links/' + lid, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to revoke link');
            await loadLinkHistory(editingPermId);
        } catch (err) {
            console.error('Error revoking link:', err);
            Auth.showToast(err.message);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Utility                                                           */
    /* ------------------------------------------------------------------ */
    function escapeHtml(str) {
        return window.Auth ? Auth.escapeHtml(str) : (str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '');
    }
})();
