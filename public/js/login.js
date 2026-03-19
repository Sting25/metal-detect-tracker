/**
 * Login page logic — handles first-time setup, login, registration, and email verification.
 */
(function () {
    'use strict';

    // Initialize i18n for unauthenticated page
    if (typeof I18n !== 'undefined') { I18n.autoInit(); }

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    var TOKEN_KEY = 'mdt_token';
    var USER_KEY = 'mdt_user';

    // Show disabled account message if redirected from authedFetch
    if (window.location.search.indexOf('disabled=1') !== -1) {
        setTimeout(function () {
            var el = document.getElementById('auth-error');
            if (el) {
                el.textContent = 'Your account has been disabled. Contact an administrator for assistance.';
                el.style.display = 'block';
            }
        }, 100);
    }

    function showError(msg) {
        var el = document.getElementById('auth-error');
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(function () { el.style.display = 'none'; }, 5000);
    }

    function setAuth(token, user) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    }

    /**
     * Detect country from browser timezone.
     */
    function detectCountryFromTimezone() {
        try {
            var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            if (tz.startsWith('America/')) return 'US';
            if (tz === 'Europe/London' || tz.startsWith('Europe/London')) return 'GB';
            if (tz.startsWith('Australia/')) return 'AU';
            if (tz.startsWith('Pacific/Auckland') || tz.startsWith('Pacific/Chatham')) return 'NZ';
            if (tz.startsWith('America/Toronto') || tz.startsWith('America/Vancouver') || tz.startsWith('America/Edmonton') || tz.startsWith('America/Winnipeg') || tz.startsWith('America/Halifax') || tz.startsWith('America/St_Johns')) return 'CA';
        } catch (e) { /* ignore */ }
        return 'US';
    }

    // Inject language selector on login page
    function injectLoginLangSelector() {
        if (typeof I18n !== 'undefined' && I18n.injectLanguageSelector) {
            // Create a positioned container in the login page
            var loginPage = document.querySelector('.login-page');
            if (loginPage) {
                loginPage.style.position = 'relative';
                var langContainer = document.createElement('div');
                langContainer.className = 'login-lang-selector';
                loginPage.appendChild(langContainer);
                I18n.injectLanguageSelector('.login-lang-selector');
            }
        }
    }

    if (window.I18n) {
        I18n.onReady(injectLoginLangSelector);
    }

    document.addEventListener('DOMContentLoaded', async function () {
        // Pre-select country dropdown from timezone detection
        var countrySelect = document.getElementById('reg-country');
        if (countrySelect) {
            var detected = detectCountryFromTimezone();
            countrySelect.value = detected;
        }

        // If already logged in, redirect (unless user explicitly wants to register)
        var token = localStorage.getItem(TOKEN_KEY);
        if (token && window.location.hash !== '#register') {
            try {
                var res = await fetch('/api/auth/me', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    window.location.href = '/index.html';
                    return;
                }
            } catch (e) { /* continue */ }
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
        }

        // Check if setup is needed
        try {
            var setupRes = await fetch('/api/auth/needs-setup');
            var setupJson = await setupRes.json();
            if (setupJson.data && setupJson.data.needsSetup) {
                document.getElementById('setup-section').style.display = 'block';
            } else {
                document.getElementById('auth-section').style.display = 'block';
            }
        } catch (e) {
            document.getElementById('auth-section').style.display = 'block';
        }

        // --- Tab switching ---
        function switchTab(tabName) {
            document.querySelectorAll('.auth-tab').forEach(function (t) {
                t.classList.remove('active');
                if (t.getAttribute('data-tab') === tabName) t.classList.add('active');
            });
            document.getElementById('login-form').style.display =
                tabName === 'login' ? 'block' : 'none';
            document.getElementById('register-form').style.display =
                tabName === 'register' ? 'block' : 'none';
            document.getElementById('auth-error').style.display = 'none';
        }

        document.querySelectorAll('.auth-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                switchTab(tab.getAttribute('data-tab'));
            });
        });

        // Auto-switch to register tab if URL hash is #register
        if (window.location.hash === '#register') {
            switchTab('register');
        }

        // --- Setup form ---
        document.getElementById('setup-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            var name = document.getElementById('setup-name').value.trim();
            var email = document.getElementById('setup-email').value.trim();
            var pw = document.getElementById('setup-password').value;
            var pw2 = document.getElementById('setup-password2').value;

            if (pw !== pw2) { showError(_t('auth.passwordsNoMatch')); return; }

            var btn = document.getElementById('btn-setup');
            btn.disabled = true;
            btn.textContent = _t('auth.creating');

            try {
                var res = await fetch('/api/auth/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, password: pw, display_name: name }),
                });
                var json = await res.json();
                if (!res.ok || !json.success) {
                    showError(json.error || _t('auth.setupFailed'));
                    btn.disabled = false;
                    btn.textContent = _t('auth.createAdmin');
                    return;
                }
                setAuth(json.data.token, json.data.user);
                window.location.href = '/index.html';
            } catch (err) {
                showError(_t('auth.connectionError'));
                btn.disabled = false;
                btn.textContent = _t('auth.createAdmin');
            }
        });

        // --- Login form ---
        document.getElementById('login-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            var email = document.getElementById('login-email').value.trim();
            var pw = document.getElementById('login-password').value;

            var btn = document.getElementById('btn-login');
            btn.disabled = true;
            btn.textContent = _t('auth.loggingIn');

            try {
                var res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, password: pw }),
                });
                var json = await res.json();
                if (!res.ok || !json.success) {
                    // Check if this is an unverified email
                    if (json.needsVerification) {
                        showVerifySection(json.email || email, email);
                        btn.disabled = false;
                        btn.textContent = _t('auth.login');
                        return;
                    }
                    showError(json.error || _t('auth.loginFailed'));
                    btn.disabled = false;
                    btn.textContent = _t('auth.login');
                    return;
                }
                setAuth(json.data.token, json.data.user);
                window.location.href = '/index.html';
            } catch (err) {
                showError(_t('auth.connectionError'));
                btn.disabled = false;
                btn.textContent = _t('auth.login');
            }
        });

        // --- Show verification section helper ---
        var verifyRealEmail = ''; // store the actual (unmasked) email for API calls
        function showVerifySection(maskedEmail, realEmail) {
            verifyRealEmail = realEmail || '';
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'none';
            var socialEl = document.getElementById('auth-social');
            if (socialEl) socialEl.style.display = 'none';
            document.querySelectorAll('.auth-tab').forEach(function (t) { t.classList.remove('active'); });
            document.getElementById('verify-section').style.display = 'block';
            document.getElementById('verify-email').value = realEmail || '';
            var sentMsg = _t('auth.verifyEmail.sent');
            if (sentMsg.indexOf('{email}') !== -1) {
                sentMsg = sentMsg.replace('{email}', maskedEmail);
            } else {
                sentMsg = 'We sent a 6-digit code to ' + maskedEmail;
            }
            document.getElementById('verify-sent-msg').textContent = sentMsg;
            document.getElementById('verify-code').value = '';
            document.getElementById('verify-code').focus();
            document.getElementById('verify-resent').style.display = 'none';
            document.getElementById('auth-error').style.display = 'none';
        }

        // --- Verify email form submit ---
        document.getElementById('verify-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            var code = document.getElementById('verify-code').value.trim();
            var email = document.getElementById('verify-email').value || verifyRealEmail;

            var btn = document.getElementById('btn-verify');
            btn.disabled = true;
            btn.textContent = _t('common.loading');

            try {
                var res = await fetch('/api/auth/verify-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, code: code }),
                });
                var json = await res.json();
                if (!res.ok || !json.success) {
                    showError(json.error || _t('auth.verifyEmail.invalid'));
                    btn.disabled = false;
                    btn.textContent = _t('auth.verifyEmail.submit');
                    return;
                }
                setAuth(json.data.token, json.data.user);
                window.location.href = '/index.html';
            } catch (err) {
                showError(_t('auth.connectionError'));
                btn.disabled = false;
                btn.textContent = _t('auth.verifyEmail.submit');
            }
        });

        // --- Resend verification code ---
        document.getElementById('link-resend-code').addEventListener('click', async function (e) {
            e.preventDefault();
            var email = document.getElementById('verify-email').value || verifyRealEmail;
            if (!email) return;

            try {
                await fetch('/api/auth/resend-verification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email }),
                });
                var resentEl = document.getElementById('verify-resent');
                resentEl.style.display = 'block';
                setTimeout(function () { resentEl.style.display = 'none'; }, 3000);
            } catch (err) {
                // silently fail
            }
        });

        // --- Password strength indicator ---
        function checkPasswordStrength(pw) {
            var score = 0;
            if (pw.length >= 12) score++;
            if (pw.length >= 16) score++;
            if (/[A-Z]/.test(pw)) score++;
            if (/[a-z]/.test(pw)) score++;
            if (/[0-9]/.test(pw)) score++;
            if (/[^A-Za-z0-9]/.test(pw)) score++;
            return score; // 0-6
        }

        function updatePasswordStrength(pw) {
            var container = document.getElementById('password-strength');
            if (!container) return;
            if (!pw) { container.style.display = 'none'; return; }
            container.style.display = 'flex';
            var score = checkPasswordStrength(pw);
            var fill = container.querySelector('.password-strength-fill');
            var label = container.querySelector('.password-strength-label');
            var pct, color, text;
            if (score <= 2) { pct = '25%'; color = 'var(--color-status-red)'; text = 'Weak'; }
            else if (score <= 3) { pct = '50%'; color = 'var(--color-status-yellow)'; text = 'Fair'; }
            else if (score <= 4) { pct = '75%'; color = 'var(--color-status-blue)'; text = 'Good'; }
            else { pct = '100%'; color = 'var(--color-status-green)'; text = 'Strong'; }
            fill.style.width = pct;
            fill.style.background = color;
            label.style.color = color;
            label.textContent = text;
        }

        var regPwInput = document.getElementById('reg-password');
        if (regPwInput) {
            regPwInput.addEventListener('input', function () {
                updatePasswordStrength(regPwInput.value);
            });
        }

        function validatePasswordRules(pw) {
            if (pw.length < 12) return 'Password must be at least 12 characters';
            if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter';
            if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter';
            if (!/[0-9]/.test(pw)) return 'Password must include a number';
            return null;
        }

        // --- Register form ---
        document.getElementById('register-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            var name = document.getElementById('reg-name').value.trim();
            var email = document.getElementById('reg-email').value.trim();
            var phone = document.getElementById('reg-phone').value.trim();
            var country = document.getElementById('reg-country').value;
            var pw = document.getElementById('reg-password').value;
            var pw2 = document.getElementById('reg-password2').value;
            var termsChecked = document.getElementById('reg-terms').checked;

            if (!termsChecked) { showError(_t('auth.terms.required')); return; }
            var pwError = validatePasswordRules(pw);
            if (pwError) { showError(pwError); return; }
            if (pw !== pw2) { showError(_t('auth.passwordsNoMatch')); return; }

            var btn = document.getElementById('btn-register');
            btn.disabled = true;
            btn.textContent = _t('auth.registering');

            try {
                var res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: email,
                        password: pw,
                        display_name: name,
                        terms_accepted: true,
                        phone: phone || undefined,
                        country_code: country || 'US',
                    }),
                });
                var json = await res.json();
                if (!res.ok || !json.success) {
                    showError(json.error || _t('auth.registrationFailed'));
                    btn.disabled = false;
                    btn.textContent = _t('auth.register');
                    return;
                }
                // Check if email verification is needed
                if (json.data && json.data.needsVerification) {
                    showVerifySection(json.data.email || email, email);
                    btn.disabled = false;
                    btn.textContent = _t('auth.register');
                    return;
                }
                setAuth(json.data.token, json.data.user);
                window.location.href = '/index.html';
            } catch (err) {
                showError(_t('auth.connectionError'));
                btn.disabled = false;
                btn.textContent = _t('auth.register');
            }
        });

        // =================================================================
        // Google Sign-In + Passkey Login
        // =================================================================
        var pendingGoogleToken = null; // store token while showing terms

        // Fetch auth config to detect available features
        try {
            var configRes = await fetch('/api/auth/config');
            var configJson = await configRes.json();
            if (configJson.success && configJson.data) {
                // Initialize Google Sign-In if configured
                if (configJson.data.google_client_id && typeof google !== 'undefined' && google.accounts) {
                    initGoogleSignIn(configJson.data.google_client_id);
                }
                // Show passkey button if WebAuthn supported
                if (configJson.data.webauthn_enabled && window.PublicKeyCredential) {
                    var passkeyBtn = document.getElementById('btn-passkey-login');
                    if (passkeyBtn) passkeyBtn.style.display = 'block';
                }
            }
        } catch (configErr) {
            // Config not available — hide social login section
            var socialSection = document.getElementById('auth-social');
            if (socialSection) socialSection.style.display = 'none';
        }

        function initGoogleSignIn(clientId) {
            google.accounts.id.initialize({
                client_id: clientId,
                callback: handleGoogleCredentialResponse,
                auto_select: false,
            });
            google.accounts.id.renderButton(
                document.getElementById('google-signin-btn'),
                { theme: 'outline', size: 'large', width: 360, text: 'signin_with' }
            );
        }

        async function handleGoogleCredentialResponse(response) {
            try {
                var res = await fetch('/api/auth/google', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_token: response.credential }),
                });
                var json = await res.json();
                if (!res.ok || !json.success) {
                    showError(json.error || _t('auth.google.failed'));
                    return;
                }
                if (json.data.needsTerms) {
                    // Show terms acceptance for new Google user
                    pendingGoogleToken = response.credential;
                    showGoogleTermsSection(json.data.google_name, json.data.google_email);
                    return;
                }
                setAuth(json.data.token, json.data.user);
                window.location.href = '/index.html';
            } catch (err) {
                showError(_t('auth.connectionError'));
            }
        }

        function showGoogleTermsSection(name, email) {
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'none';
            document.getElementById('auth-social').style.display = 'none';
            document.querySelectorAll('.auth-tab').forEach(function (t) { t.classList.remove('active'); });

            var welcomeMsg = _t('auth.google.welcome');
            if (welcomeMsg.indexOf('{name}') !== -1) {
                welcomeMsg = welcomeMsg.replace('{name}', name);
            } else {
                welcomeMsg = 'Welcome, ' + name + '! Accept the terms to create your account.';
            }
            document.getElementById('google-welcome-msg').textContent = welcomeMsg;
            document.getElementById('google-terms').checked = false;
            document.getElementById('google-terms-section').style.display = 'block';
            document.getElementById('auth-error').style.display = 'none';
        }

        // Google terms accept button
        var btnGoogleAccept = document.getElementById('btn-google-accept');
        if (btnGoogleAccept) {
            btnGoogleAccept.addEventListener('click', async function () {
                if (!document.getElementById('google-terms').checked) {
                    showError(_t('auth.terms.required'));
                    return;
                }
                if (!pendingGoogleToken) {
                    showError(_t('auth.google.failed'));
                    return;
                }

                btnGoogleAccept.disabled = true;
                btnGoogleAccept.textContent = _t('auth.creating');

                try {
                    var res = await fetch('/api/auth/google', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id_token: pendingGoogleToken, terms_accepted: true }),
                    });
                    var json = await res.json();
                    if (!res.ok || !json.success) {
                        showError(json.error || _t('auth.google.failed'));
                        btnGoogleAccept.disabled = false;
                        btnGoogleAccept.textContent = _t('auth.google.createAccount');
                        return;
                    }
                    setAuth(json.data.token, json.data.user);
                    window.location.href = '/index.html';
                } catch (err) {
                    showError(_t('auth.connectionError'));
                    btnGoogleAccept.disabled = false;
                    btnGoogleAccept.textContent = _t('auth.google.createAccount');
                }
            });
        }

        // Back from Google terms
        var linkBackFromGoogle = document.getElementById('link-back-from-google');
        if (linkBackFromGoogle) {
            linkBackFromGoogle.addEventListener('click', function (e) {
                e.preventDefault();
                pendingGoogleToken = null;
                document.getElementById('google-terms-section').style.display = 'none';
                document.getElementById('auth-social').style.display = '';
                switchTab('login');
            });
        }

        // --- Passkey login ---
        var btnPasskeyLogin = document.getElementById('btn-passkey-login');
        if (btnPasskeyLogin) {
            btnPasskeyLogin.addEventListener('click', async function () {
                try {
                    var optionsRes = await fetch('/api/auth/passkey/login-options', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({}),
                    });
                    var optionsJson = await optionsRes.json();
                    if (!optionsRes.ok || !optionsJson.success) {
                        showError(optionsJson.error || _t('auth.passkey.failed'));
                        return;
                    }

                    var credential = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: optionsJson.data });

                    var verifyRes = await fetch('/api/auth/passkey/login-verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ credential: credential, challenge_id: optionsJson.data.challenge_id }),
                    });
                    var verifyJson = await verifyRes.json();
                    if (!verifyRes.ok || !verifyJson.success) {
                        showError(verifyJson.error || _t('auth.passkey.failed'));
                        return;
                    }
                    setAuth(verifyJson.data.token, verifyJson.data.user);
                    window.location.href = '/index.html';
                } catch (err) {
                    if (err.name === 'NotAllowedError') {
                        // User cancelled
                        return;
                    }
                    showError(_t('auth.passkey.failed'));
                }
            });
        }
    });
})();
