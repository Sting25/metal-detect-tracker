/**
 * Account Settings page logic — manages auth methods, passkeys, and profile display.
 */
(function () {
    'use strict';

    var _t = function (k) { return k; }; // will be re-bound once i18n is ready

    var accountData = null; // cached /me response
    var authConfig = null;  // cached /config response

    function showToast(msg, duration) {
        var el = document.getElementById('account-toast');
        el.textContent = msg;
        el.classList.remove('hidden');
        setTimeout(function () { el.classList.add('hidden'); }, duration || 3000);
    }

    function showError(msg) {
        showToast(msg, 5000);
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }

    // ----------------------------------------------------------------
    // Load account data
    // ----------------------------------------------------------------
    async function loadAccount() {
        try {
            var res = await Auth.authedFetch('/api/auth/me');
            if (!res.ok) throw new Error('Failed to load account');
            var json = await res.json();
            accountData = json.data;
            renderProfile();
            renderAuthMethods();
            renderPasskeys();
        } catch (err) {
            showError('Failed to load account data');
        }
    }

    async function loadConfig() {
        try {
            var res = await fetch('/api/auth/config');
            var json = await res.json();
            authConfig = json.data || {};
        } catch (e) {
            authConfig = {};
        }
    }

    // ----------------------------------------------------------------
    // Render
    // ----------------------------------------------------------------
    function renderProfile() {
        document.getElementById('profile-email').textContent = accountData.email || '-';
        document.getElementById('profile-name').textContent = accountData.display_name || '-';
    }

    function renderAuthMethods() {
        // Password status
        var pwStatus = document.getElementById('password-status');
        var btnChangePw = document.getElementById('btn-change-password');
        if (accountData.has_password) {
            pwStatus.textContent = _t('account.passwordSet');
            pwStatus.className = 'auth-method-status status-ok';
            btnChangePw.textContent = _t('account.changePassword');
        } else {
            pwStatus.textContent = _t('account.passwordNotSet');
            pwStatus.className = 'auth-method-status status-warn';
            btnChangePw.textContent = _t('account.setPassword');
        }

        // Google status
        var gStatus = document.getElementById('google-status');
        var btnLink = document.getElementById('btn-link-google');
        var btnUnlink = document.getElementById('btn-unlink-google');

        if (accountData.has_google) {
            gStatus.textContent = _t('account.googleLinked');
            gStatus.className = 'auth-method-status status-ok';
            btnLink.classList.add('hidden');
            btnUnlink.classList.remove('hidden');
        } else {
            gStatus.textContent = _t('account.googleNotLinked');
            gStatus.className = 'auth-method-status status-muted';
            btnUnlink.classList.add('hidden');
            // Only show link button if Google is configured
            if (authConfig && authConfig.google_client_id) {
                btnLink.classList.remove('hidden');
            } else {
                btnLink.classList.add('hidden');
            }
        }
    }

    function renderPasskeys() {
        var list = document.getElementById('passkey-list');
        var noMsg = document.getElementById('no-passkeys-msg');
        var passkeys = accountData.passkeys || [];

        if (passkeys.length === 0) {
            noMsg.classList.remove('hidden');
            // Remove any existing passkey items
            list.querySelectorAll('.passkey-item').forEach(function (el) { el.remove(); });
            return;
        }

        noMsg.classList.add('hidden');
        // Remove existing items
        list.querySelectorAll('.passkey-item').forEach(function (el) { el.remove(); });

        passkeys.forEach(function (pk) {
            var item = document.createElement('div');
            item.className = 'passkey-item';
            item.setAttribute('data-id', pk.id);

            var lastUsed = pk.last_used_at
                ? _t('account.lastUsed').replace('{date}', new Date(pk.last_used_at).toLocaleDateString())
                : _t('account.neverUsed');

            item.innerHTML =
                '<div class="passkey-item-info">' +
                    '<span class="passkey-item-name">&#128273; ' + escapeHtml(pk.display_name) + '</span>' +
                    '<span class="passkey-item-meta">' + escapeHtml(lastUsed) + '</span>' +
                '</div>' +
                '<div class="passkey-item-actions">' +
                    '<button class="btn btn-xs btn-secondary btn-rename-passkey" data-id="' + escapeHtml(pk.id) + '" title="Rename">&#9998;</button>' +
                    '<button class="btn btn-xs btn-danger btn-delete-passkey" data-id="' + escapeHtml(pk.id) + '" title="Delete">&#128465;</button>' +
                '</div>';

            list.appendChild(item);
        });

        // Bind rename/delete events
        list.querySelectorAll('.btn-rename-passkey').forEach(function (btn) {
            btn.addEventListener('click', function () { renamePasskey(btn.getAttribute('data-id')); });
        });
        list.querySelectorAll('.btn-delete-passkey').forEach(function (btn) {
            btn.addEventListener('click', function () { deletePasskey(btn.getAttribute('data-id')); });
        });
    }

    // ----------------------------------------------------------------
    // Passkey Actions
    // ----------------------------------------------------------------
    async function addPasskey() {
        try {
            // 1. Get registration options
            var optRes = await Auth.authedFetch('/api/auth/passkey/register-options', { method: 'POST' });
            var optJson = await optRes.json();
            if (!optRes.ok || !optJson.success) {
                showError(optJson.error || 'Failed to start passkey registration');
                return;
            }

            // 2. Create credential with browser
            var credential = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: optJson.data });

            // 3. Ask for name
            var name = prompt(_t('account.passkeyNamePrompt'), 'Passkey');
            if (!name) name = 'Passkey';

            // 4. Verify with server
            var verifyRes = await Auth.authedFetch('/api/auth/passkey/register-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: credential, display_name: name }),
            });
            var verifyJson = await verifyRes.json();
            if (!verifyRes.ok || !verifyJson.success) {
                showError(verifyJson.error || 'Passkey registration failed');
                return;
            }

            showToast(_t('account.passkeyAdded'));
            await loadAccount(); // refresh
        } catch (err) {
            if (err.name === 'NotAllowedError') return; // user cancelled
            showError('Passkey registration failed');
        }
    }

    async function deletePasskey(id) {
        if (!confirm(_t('account.deletePasskeyConfirm'))) return;

        try {
            var res = await Auth.authedFetch('/api/auth/passkeys/' + encodeURIComponent(id), { method: 'DELETE' });
            var json = await res.json();
            if (!res.ok || !json.success) {
                showError(json.error || 'Failed to remove passkey');
                return;
            }
            showToast(_t('account.passkeyDeleted'));
            await loadAccount();
        } catch (err) {
            showError('Failed to remove passkey');
        }
    }

    async function renamePasskey(id) {
        var currentName = '';
        if (accountData.passkeys) {
            var pk = accountData.passkeys.find(function (p) { return p.id === id; });
            if (pk) currentName = pk.display_name;
        }

        var newName = prompt(_t('account.passkeyNamePrompt'), currentName);
        if (!newName || newName === currentName) return;

        try {
            var res = await Auth.authedFetch('/api/auth/passkeys/' + encodeURIComponent(id), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ display_name: newName }),
            });
            var json = await res.json();
            if (!res.ok || !json.success) {
                showError(json.error || 'Failed to rename passkey');
                return;
            }
            showToast(_t('account.passkeyRenamed'));
            await loadAccount();
        } catch (err) {
            showError('Failed to rename passkey');
        }
    }

    // ----------------------------------------------------------------
    // Google Link / Unlink
    // ----------------------------------------------------------------
    function initGoogleLink() {
        if (!authConfig || !authConfig.google_client_id) return;
        if (typeof google === 'undefined' || !google.accounts) return;

        // We use google.accounts.id.initialize for linking too
        google.accounts.id.initialize({
            client_id: authConfig.google_client_id,
            callback: handleGoogleLinkResponse,
            auto_select: false,
        });
    }

    async function handleGoogleLinkResponse(response) {
        try {
            var res = await Auth.authedFetch('/api/auth/google/link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_token: response.credential }),
            });
            var json = await res.json();
            if (!res.ok || !json.success) {
                showError(json.error || 'Failed to link Google account');
                return;
            }
            showToast('Google account linked');
            await loadAccount();
        } catch (err) {
            showError('Failed to link Google account');
        }
    }

    async function unlinkGoogle() {
        try {
            var res = await Auth.authedFetch('/api/auth/google/link', { method: 'DELETE' });
            var json = await res.json();
            if (!res.ok || !json.success) {
                showError(json.error || 'Failed to unlink Google');
                return;
            }
            showToast('Google account unlinked');
            await loadAccount();
        } catch (err) {
            showError('Failed to unlink Google');
        }
    }

    // ----------------------------------------------------------------
    // Password Change
    // ----------------------------------------------------------------
    function showPasswordModal() {
        var modal = document.getElementById('password-modal');
        modal.classList.remove('hidden');

        // Show/hide current password field
        var currentPwGroup = document.getElementById('current-password-group');
        var title = document.getElementById('password-modal-title');
        if (accountData.has_password) {
            currentPwGroup.classList.remove('hidden');
            title.textContent = _t('account.changePassword');
        } else {
            currentPwGroup.classList.add('hidden');
            title.textContent = _t('account.setPassword');
        }

        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-new-password').value = '';
    }

    function hidePasswordModal() {
        document.getElementById('password-modal').classList.add('hidden');
    }

    // ----------------------------------------------------------------
    // Event Binding
    // ----------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', async function () {
        // Wait for Auth module
        if (typeof Auth === 'undefined') return;

        // Wait for AppConfig (which waits for I18n) before loading account
        if (window.AppConfig) {
            await new Promise(function (resolve) { AppConfig.onReady(resolve); });
        }

        // Re-bind _t now that I18n translations are loaded
        _t = (typeof I18n !== 'undefined') ? I18n.t : function (k) { return k; };

        await loadConfig();
        await loadAccount();

        // Init Google for linking (if configured)
        initGoogleLink();

        // Show passkey section only if WebAuthn supported
        if (!window.PublicKeyCredential) {
            var pkSection = document.getElementById('passkeys-section');
            if (pkSection) pkSection.classList.add('hidden');
        }

        // Add Passkey
        document.getElementById('btn-add-passkey').addEventListener('click', addPasskey);

        // Change Password
        document.getElementById('btn-change-password').addEventListener('click', showPasswordModal);
        document.getElementById('btn-cancel-password').addEventListener('click', hidePasswordModal);

        // Password form submit
        document.getElementById('password-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            var newPw = document.getElementById('new-password').value;
            var confirmPw = document.getElementById('confirm-new-password').value;

            if (newPw !== confirmPw) {
                showError(_t('auth.passwordsNoMatch'));
                return;
            }

            var currentPw = document.getElementById('current-password').value;

            var btn = document.getElementById('btn-save-password');
            btn.disabled = true;

            try {
                var res = await Auth.authedFetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        current_password: accountData.has_password ? currentPw : undefined,
                        new_password: newPw,
                    }),
                });
                var json = await res.json();
                if (!res.ok || !json.success) {
                    showError(json.error || 'Failed to update password');
                    btn.disabled = false;
                    return;
                }

                hidePasswordModal();
                showToast(_t('account.passwordChanged') || 'Password updated');
                await loadAccount();
            } catch (err) {
                showError('Failed to update password');
            }
            btn.disabled = false;
        });

        // Link Google
        document.getElementById('btn-link-google').addEventListener('click', function () {
            if (typeof google !== 'undefined' && google.accounts) {
                google.accounts.id.prompt(); // Show the Google one-tap / account chooser
            }
        });

        // Unlink Google
        document.getElementById('btn-unlink-google').addEventListener('click', function () {
            if (confirm('Unlink your Google account?')) {
                unlinkGoogle();
            }
        });
    });
})();
