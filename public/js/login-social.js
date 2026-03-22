/**
 * Login page — Google Sign-In, terms acceptance, and passkey authentication.
 * Depends on login.js being loaded first (uses window.LoginPage helpers).
 */
(function () {
    'use strict';

    const _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    let pendingGoogleToken = null;

    // Wait for the Google GSI library to load (async defer script)
    function waitForGoogle(maxWait) {
        return new Promise(function (resolve) {
            if (typeof google !== 'undefined' && google.accounts) { resolve(true); return; }
            const start = Date.now();
            const iv = setInterval(function () {
                if (typeof google !== 'undefined' && google.accounts) { clearInterval(iv); resolve(true); }
                else if (Date.now() - start > maxWait) { clearInterval(iv); resolve(false); }
            }, 100);
        });
    }

    document.addEventListener('DOMContentLoaded', async function () {
        const LP = window.LoginPage;
        if (!LP) return;

        // Fetch auth config to detect available features
        try {
            const configRes = await fetch('/api/auth/config');
            const configJson = await configRes.json();
            if (configJson.success && configJson.data) {
                if (configJson.data.google_client_id) {
                    const googleReady = await waitForGoogle(5000);
                    if (googleReady) {
                        initGoogleSignIn(configJson.data.google_client_id, LP);
                    }
                }
                if (configJson.data.webauthn_enabled && window.PublicKeyCredential) {
                    const passkeyBtn = document.getElementById('btn-passkey-login');
                    if (passkeyBtn) passkeyBtn.classList.remove('hidden');
                }
            }
        } catch (configErr) {
            const socialSection = document.getElementById('auth-social');
            if (socialSection) socialSection.classList.add('hidden');
        }

        function initGoogleSignIn(clientId, LP) {
            google.accounts.id.initialize({
                client_id: clientId,
                callback: function (response) { handleGoogleCredentialResponse(response, LP); },
                auto_select: false,
            });
            google.accounts.id.renderButton(
                document.getElementById('google-signin-btn'),
                { theme: 'outline', size: 'large', width: 360, text: 'signin_with' }
            );
        }

        async function handleGoogleCredentialResponse(response, LP) {
            try {
                const res = await fetch('/api/auth/google', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_token: response.credential }),
                });
                const json = await res.json();
                if (!res.ok || !json.success) {
                    LP.showError(json.error || _t('auth.google.failed'));
                    return;
                }
                if (json.data.needsLink) {
                    LP.showError(json.data.message || _t('auth.google.needsLink'));
                    return;
                }
                if (json.data.needsTerms) {
                    pendingGoogleToken = response.credential;
                    showGoogleTermsSection(json.data.google_name, json.data.google_email, LP);
                    return;
                }
                LP.setAuth(json.data.token, json.data.user);
                window.location.href = '/index.html';
            } catch (err) {
                LP.showError(_t('auth.connectionError'));
            }
        }

        function showGoogleTermsSection(name, email, LP) {
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('auth-social').classList.add('hidden');
            document.querySelectorAll('.auth-tab').forEach(function (t) { t.classList.remove('active'); });

            let welcomeMsg = _t('auth.google.welcome');
            if (welcomeMsg.indexOf('{name}') !== -1) {
                welcomeMsg = welcomeMsg.replace('{name}', name);
            } else {
                welcomeMsg = 'Welcome, ' + name + '! Accept the terms to create your account.';
            }
            document.getElementById('google-welcome-msg').textContent = welcomeMsg;
            document.getElementById('google-terms').checked = false;
            document.getElementById('google-terms-section').classList.remove('hidden');
            document.getElementById('auth-error').classList.add('hidden');
        }

        // Google terms accept button
        const btnGoogleAccept = document.getElementById('btn-google-accept');
        if (btnGoogleAccept) {
            btnGoogleAccept.addEventListener('click', async function () {
                if (!document.getElementById('google-terms').checked) {
                    LP.showError(_t('auth.terms.required'));
                    return;
                }
                if (!pendingGoogleToken) {
                    LP.showError(_t('auth.google.failed'));
                    return;
                }

                btnGoogleAccept.disabled = true;
                btnGoogleAccept.textContent = _t('auth.creating');

                try {
                    const res = await fetch('/api/auth/google', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id_token: pendingGoogleToken, terms_accepted: true }),
                    });
                    const json = await res.json();
                    if (!res.ok || !json.success) {
                        LP.showError(json.error || _t('auth.google.failed'));
                        btnGoogleAccept.disabled = false;
                        btnGoogleAccept.textContent = _t('auth.google.createAccount');
                        return;
                    }
                    LP.setAuth(json.data.token, json.data.user);
                    window.location.href = '/index.html';
                } catch (err) {
                    LP.showError(_t('auth.connectionError'));
                    btnGoogleAccept.disabled = false;
                    btnGoogleAccept.textContent = _t('auth.google.createAccount');
                }
            });
        }

        // Back from Google terms
        const linkBackFromGoogle = document.getElementById('link-back-from-google');
        if (linkBackFromGoogle) {
            linkBackFromGoogle.addEventListener('click', function (e) {
                e.preventDefault();
                pendingGoogleToken = null;
                document.getElementById('google-terms-section').classList.add('hidden');
                document.getElementById('auth-social').classList.remove('hidden');
                LP.switchTab('login');
            });
        }

        // Passkey login
        const btnPasskeyLogin = document.getElementById('btn-passkey-login');
        if (btnPasskeyLogin) {
            btnPasskeyLogin.addEventListener('click', async function () {
                try {
                    const optionsRes = await fetch('/api/auth/passkey/login-options', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({}),
                    });
                    const optionsJson = await optionsRes.json();
                    if (!optionsRes.ok || !optionsJson.success) {
                        LP.showError(optionsJson.error || _t('auth.passkey.failed'));
                        return;
                    }

                    const credential = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: optionsJson.data });

                    const verifyRes = await fetch('/api/auth/passkey/login-verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ credential: credential, challenge_id: optionsJson.data.challenge_id }),
                    });
                    const verifyJson = await verifyRes.json();
                    if (!verifyRes.ok || !verifyJson.success) {
                        LP.showError(verifyJson.error || _t('auth.passkey.failed'));
                        return;
                    }
                    LP.setAuth(verifyJson.data.token, verifyJson.data.user);
                    window.location.href = '/index.html';
                } catch (err) {
                    if (err.name === 'NotAllowedError') return;
                    LP.showError(_t('auth.passkey.failed'));
                }
            });
        }
    });
})();
