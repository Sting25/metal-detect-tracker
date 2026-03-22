/**
 * Settings page — Privacy Controls (Stage 1.1).
 * Loads user preferences from /api/auth/me and saves via PUT /api/auth/preferences.
 */
(function () {
    'use strict';

    // Require authentication
    if (!window.Auth || !Auth.getToken()) {
        window.location.href = '/login.html';
        return;
    }

    // --- DOM refs ---
    const toggleGps = document.getElementById('toggle-store-gps');
    const selectUnit = document.getElementById('select-unit-preference');
    const selectObfuscation = document.getElementById('select-export-obfuscation');
    const btnSave = document.getElementById('btn-save-privacy');
    const saveMsg = document.getElementById('privacy-save-msg');

    // --- Load current preferences ---
    async function loadPreferences() {
        try {
            const res = await Auth.authedFetch('/api/auth/me');
            const json = await res.json();
            if (json.success && json.data) {
                toggleGps.checked = json.data.store_exact_gps !== false;
                if (selectUnit) selectUnit.value = json.data.unit_preference || 'imperial';
                selectObfuscation.value = json.data.export_obfuscation || 'none';
            }
        } catch (err) {
            console.error('Failed to load preferences:', err);
        }
    }

    // --- Save preferences ---
    async function savePreferences() {
        btnSave.disabled = true;
        saveMsg.textContent = window.I18n ? I18n.t('settings.saving') : 'Saving...';
        saveMsg.style.color = '';

        try {
            const res = await Auth.authedFetch('/api/auth/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    store_exact_gps: toggleGps.checked,
                    unit_preference: selectUnit ? selectUnit.value : undefined,
                    export_obfuscation: selectObfuscation.value,
                }),
            });
            const json = await res.json();
            if (json.success) {
                saveMsg.textContent = window.I18n ? I18n.t('settings.saved') : 'Settings saved';
                saveMsg.style.color = 'var(--color-status-green)';
            } else {
                saveMsg.textContent = json.error || (window.I18n ? I18n.t('settings.saveError') : 'Failed to save settings');
                saveMsg.style.color = 'var(--color-status-red)';
            }
        } catch (err) {
            console.error('Failed to save preferences:', err);
            saveMsg.textContent = window.I18n ? I18n.t('settings.saveError') : 'Failed to save settings';
            saveMsg.style.color = 'var(--color-status-red)';
        } finally {
            btnSave.disabled = false;
            setTimeout(function () { saveMsg.textContent = ''; }, 3000);
        }
    }

    // --- Export Data ---
    const btnExport = document.getElementById('btn-export');
    const exportMsg = document.getElementById('export-msg');

    async function exportData() {
        if (btnExport) btnExport.disabled = true;
        if (btnExport) btnExport.textContent = window.I18n ? I18n.t('settings.exportBtnExporting') : 'Exporting...';
        if (exportMsg) exportMsg.textContent = '';

        try {
            const res = await Auth.authedFetch('/api/exports', { method: 'POST' });
            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.error || 'Export failed');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'signal-bouncer-export.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (exportMsg) {
                exportMsg.textContent = window.I18n ? I18n.t('settings.exportSuccess') : 'Export complete!';
                exportMsg.style.color = 'var(--color-status-green)';
            }
        } catch (err) {
            console.error('Export failed:', err);
            if (exportMsg) {
                exportMsg.textContent = window.I18n ? I18n.t('settings.exportError') : 'Export failed';
                exportMsg.style.color = 'var(--color-status-red)';
            }
        } finally {
            if (btnExport) {
                btnExport.disabled = false;
                btnExport.textContent = window.I18n ? I18n.t('settings.exportBtn') : 'Export My Data';
            }
            if (exportMsg) setTimeout(function () { exportMsg.textContent = ''; }, 5000);
        }
    }

    if (btnExport) {
        btnExport.addEventListener('click', exportData);
    }

    // --- Import Data ---
    const fileImport = document.getElementById('file-import');
    const importBtnText = document.getElementById('import-btn-text');
    const importMsg = document.getElementById('import-msg');

    async function importData(file) {
        if (importBtnText) importBtnText.textContent = window.I18n ? I18n.t('settings.importing') : 'Importing...';
        if (fileImport) fileImport.disabled = true;
        if (importMsg) importMsg.textContent = '';

        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await Auth.authedFetch('/api/imports', {
                method: 'POST',
                body: formData,
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const d = json.data;
            let msg = 'Imported: ' + d.sites_imported + ' sites, ' + d.finds_imported + ' finds, ' + d.permissions_imported + ' permissions';
            if (d.errors && d.errors.length > 0) {
                msg += ' (' + d.errors.length + ' items skipped)';
            }
            if (importMsg) {
                importMsg.textContent = msg;
                importMsg.style.color = 'var(--color-status-green)';
            }
        } catch (err) {
            console.error('Import failed:', err);
            if (importMsg) {
                importMsg.textContent = window.I18n ? I18n.t('settings.importError') : 'Import failed';
                importMsg.style.color = 'var(--color-status-red)';
            }
        } finally {
            if (importBtnText) importBtnText.textContent = window.I18n ? I18n.t('settings.importBtn') : 'Import Data';
            if (fileImport) {
                fileImport.disabled = false;
                fileImport.value = '';
            }
            if (importMsg) setTimeout(function () { importMsg.textContent = ''; }, 10000);
        }
    }

    if (fileImport) {
        fileImport.addEventListener('change', function () {
            if (fileImport.files.length > 0) importData(fileImport.files[0]);
        });
    }

    // --- Download Import Template ---
    const btnDownloadTemplate = document.getElementById('btn-download-template');

    async function downloadTemplate() {
        if (btnDownloadTemplate) btnDownloadTemplate.disabled = true;
        try {
            const res = await Auth.authedFetch('/api/imports/template');
            if (!res.ok) throw new Error('Failed to download template');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'signal-bouncer-import-template.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Template download failed:', err);
            if (importMsg) {
                importMsg.textContent = 'Download failed. Please try again.';
                importMsg.style.color = 'var(--color-status-red)';
                setTimeout(function () { importMsg.textContent = ''; }, 5000);
            }
        } finally {
            if (btnDownloadTemplate) btnDownloadTemplate.disabled = false;
        }
    }

    if (btnDownloadTemplate) {
        btnDownloadTemplate.addEventListener('click', downloadTemplate);
    }

    // --- Delete Account ---
    const btnDelete = document.getElementById('btn-delete-account');
    const deleteOverlay = document.getElementById('delete-modal-overlay');
    const deleteInput = document.getElementById('delete-confirm-input');
    const btnDeleteConfirm = document.getElementById('btn-delete-confirm');
    const btnDeleteCancel = document.getElementById('btn-delete-cancel');
    const btnDeleteClose = document.getElementById('btn-delete-modal-close');
    const deleteErrorMsg = document.getElementById('delete-error-msg');

    function openDeleteModal() {
        if (deleteInput) deleteInput.value = '';
        if (btnDeleteConfirm) btnDeleteConfirm.disabled = true;
        if (deleteErrorMsg) deleteErrorMsg.textContent = '';
        if (deleteOverlay) deleteOverlay.classList.add('open');
    }

    function closeDeleteModal() {
        if (deleteOverlay) deleteOverlay.classList.remove('open');
    }

    if (deleteInput) {
        deleteInput.addEventListener('input', function () {
            if (btnDeleteConfirm) {
                btnDeleteConfirm.disabled = deleteInput.value !== 'DELETE';
            }
        });
    }

    async function deleteAccount() {
        if (btnDeleteConfirm) btnDeleteConfirm.disabled = true;
        if (deleteErrorMsg) deleteErrorMsg.textContent = window.I18n ? I18n.t('settings.deleting') : 'Deleting...';

        try {
            const res = await Auth.authedFetch('/api/auth/delete-account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmation: 'DELETE' }),
            });
            const json = await res.json();
            if (json.success) {
                Auth.clearAuth();
                window.location.href = '/landing.html';
            } else {
                if (deleteErrorMsg) {
                    deleteErrorMsg.textContent = json.error || (window.I18n ? I18n.t('settings.deleteError') : 'Failed to delete account');
                }
                if (btnDeleteConfirm) btnDeleteConfirm.disabled = false;
            }
        } catch (err) {
            console.error('Failed to delete account:', err);
            if (deleteErrorMsg) {
                deleteErrorMsg.textContent = window.I18n ? I18n.t('settings.deleteError') : 'Failed to delete account';
            }
            if (btnDeleteConfirm) btnDeleteConfirm.disabled = false;
        }
    }

    if (btnDelete) btnDelete.addEventListener('click', openDeleteModal);
    if (btnDeleteConfirm) btnDeleteConfirm.addEventListener('click', deleteAccount);
    if (btnDeleteCancel) btnDeleteCancel.addEventListener('click', closeDeleteModal);
    if (btnDeleteClose) btnDeleteClose.addEventListener('click', closeDeleteModal);
    if (deleteOverlay) {
        deleteOverlay.addEventListener('click', function (e) {
            if (e.target === deleteOverlay) closeDeleteModal();
        });
    }

    // --- Event listeners ---
    if (btnSave) {
        btnSave.addEventListener('click', savePreferences);
    }

    // --- Init ---
    loadPreferences();
})();
