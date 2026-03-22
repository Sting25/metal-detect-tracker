/**
 * Login page — handles first-time setup, login, registration, and email verification.
 * Social login (Google, Passkey) is in login-social.js.
 */
(function () {
    'use strict';

    if (typeof I18n !== 'undefined') { I18n.autoInit(); }

    const _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    const TOKEN_KEY = 'mdt_token';
    const USER_KEY = 'mdt_user';
    let verifyRealEmail = '';

    // Show disabled account message if redirected from authedFetch
    if (window.location.search.indexOf('disabled=1') !== -1) {
        setTimeout(function () {
            const el = document.getElementById('auth-error');
            if (el) {
                el.textContent = 'Your account has been disabled. Contact an administrator for assistance.';
                el.classList.remove('hidden');
            }
        }, 100);
    }

    function showError(msg) {
        const el = document.getElementById('auth-error');
        el.textContent = msg;
        el.classList.remove('hidden');
        setTimeout(function () { el.classList.add('hidden'); }, 5000);
    }

    function setAuth(token, user) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    }

    function switchTab(tabName) {
        document.querySelectorAll('.auth-tab').forEach(function (t) {
            t.classList.remove('active');
            if (t.getAttribute('data-tab') === tabName) t.classList.add('active');
        });
        document.getElementById('login-form').classList.toggle('hidden', tabName !== 'login');
        document.getElementById('register-form').classList.toggle('hidden', tabName !== 'register');
        document.getElementById('auth-error').classList.add('hidden');
    }

    function showVerifySection(maskedEmail, realEmail) {
        verifyRealEmail = realEmail || '';
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('register-form').classList.add('hidden');
        const socialEl = document.getElementById('auth-social');
        if (socialEl) socialEl.classList.add('hidden');
        document.querySelectorAll('.auth-tab').forEach(function (t) { t.classList.remove('active'); });
        document.getElementById('verify-section').classList.remove('hidden');
        document.getElementById('verify-email').value = realEmail || '';
        let sentMsg = _t('auth.verifyEmail.sent');
        if (sentMsg.indexOf('{email}') !== -1) {
            sentMsg = sentMsg.replace('{email}', maskedEmail);
        } else {
            sentMsg = 'We sent a 6-digit code to ' + maskedEmail;
        }
        document.getElementById('verify-sent-msg').textContent = sentMsg;
        document.getElementById('verify-code').value = '';
        document.getElementById('verify-code').focus();
        document.getElementById('verify-resent').classList.add('hidden');
        document.getElementById('auth-error').classList.add('hidden');
    }

    // Expose helpers for login-social.js
    window.LoginPage = {
        showError: showError,
        setAuth: setAuth,
        switchTab: switchTab,
        showVerifySection: showVerifySection
    };

    function detectCountryFromTimezone() {
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            if (tz.startsWith('America/')) return 'US';
            if (tz === 'Europe/London' || tz.startsWith('Europe/London')) return 'GB';
            if (tz.startsWith('Australia/')) return 'AU';
            if (tz.startsWith('Pacific/Auckland') || tz.startsWith('Pacific/Chatham')) return 'NZ';
            if (tz.startsWith('America/Toronto') || tz.startsWith('America/Vancouver') || tz.startsWith('America/Edmonton') || tz.startsWith('America/Winnipeg') || tz.startsWith('America/Halifax') || tz.startsWith('America/St_Johns')) return 'CA';
        } catch (e) { /* ignore */ }
        return 'US';
    }

    function injectLoginLangSelector() {
        if (typeof I18n !== 'undefined' && I18n.injectLanguageSelector) {
            const loginPage = document.querySelector('.login-page');
            if (loginPage) {
                loginPage.style.position = 'relative';
                const langContainer = document.createElement('div');
                langContainer.className = 'login-lang-selector';
                loginPage.appendChild(langContainer);
                I18n.injectLanguageSelector('.login-lang-selector');
            }
        }
    }

    if (window.I18n) { I18n.onReady(injectLoginLangSelector); }

    /* ------------------------------------------------------------------ */
    /*  Password strength                                                  */
    /* ------------------------------------------------------------------ */
    function checkPasswordStrength(pw) {
        let score = 0;
        if (pw.length >= 12) score++;
        if (pw.length >= 16) score++;
        if (/[A-Z]/.test(pw)) score++;
        if (/[a-z]/.test(pw)) score++;
        if (/[0-9]/.test(pw)) score++;
        if (/[^A-Za-z0-9]/.test(pw)) score++;
        return score;
    }

    function updatePasswordStrength(pw) {
        const container = document.getElementById('password-strength');
        if (!container) return;
        if (!pw) { container.classList.add('hidden'); return; }
        container.classList.remove('hidden');
        const score = checkPasswordStrength(pw);
        const fill = container.querySelector('.password-strength-fill');
        const label = container.querySelector('.password-strength-label');
        let pct, color, text;
        if (score <= 2) { pct = '25%'; color = 'var(--color-status-red)'; text = 'Weak'; }
        else if (score <= 3) { pct = '50%'; color = 'var(--color-status-yellow)'; text = 'Fair'; }
        else if (score <= 4) { pct = '75%'; color = 'var(--color-status-blue)'; text = 'Good'; }
        else { pct = '100%'; color = 'var(--color-status-green)'; text = 'Strong'; }
        fill.style.width = pct;
        fill.style.background = color;
        label.style.color = color;
        label.textContent = text;
    }

    function validatePasswordRules(pw) {
        if (pw.length < 12) return 'Password must be at least 12 characters';
        if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter';
        if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter';
        if (!/[0-9]/.test(pw)) return 'Password must include a number';
        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  DOMContentLoaded — form bindings                                   */
    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', async function () {
        // Pre-select country dropdown from timezone detection
        const countrySelect = document.getElementById('reg-country');
        if (countrySelect) countrySelect.value = detectCountryFromTimezone();

        // If already logged in, redirect (unless user explicitly wants to register)
        const token = localStorage.getItem(TOKEN_KEY);
        if (token && window.location.hash !== '#register') {
            try {
                const res = await fetch('/api/auth/me', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) { window.location.href = '/index.html'; return; }
            } catch (e) { /* continue */ }
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
        }

        // Check if setup is needed
        try {
            const setupRes = await fetch('/api/auth/needs-setup');
            const setupJson = await setupRes.json();
            if (setupJson.data && setupJson.data.needsSetup) {
                document.getElementById('setup-section').classList.remove('hidden');
            } else {
                document.getElementById('auth-section').classList.remove('hidden');
            }
        } catch (e) {
            document.getElementById('auth-section').classList.remove('hidden');
        }

        // Tab switching
        document.querySelectorAll('.auth-tab').forEach(function (tab) {
            tab.addEventListener('click', function () { switchTab(tab.getAttribute('data-tab')); });
        });

        if (window.location.hash === '#register') switchTab('register');

        // Setup form
        document.getElementById('setup-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            const name = document.getElementById('setup-name').value.trim();
            const email = document.getElementById('setup-email').value.trim();
            const pw = document.getElementById('setup-password').value;
            const pw2 = document.getElementById('setup-password2').value;

            if (pw !== pw2) { showError(_t('auth.passwordsNoMatch')); return; }

            const btn = document.getElementById('btn-setup');
            btn.disabled = true;
            btn.textContent = _t('auth.creating');

            try {
                const res = await fetch('/api/auth/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, password: pw, display_name: name }),
                });
                const json = await res.json();
                if (!res.ok || !json.success) {
                    showError(json.error || _t('auth.setupFailed'));
                    btn.disabled = false; btn.textContent = _t('auth.createAdmin'); return;
                }
                setAuth(json.data.token, json.data.user);
                window.location.href = '/index.html';
            } catch (err) {
                showError(_t('auth.connectionError'));
                btn.disabled = false; btn.textContent = _t('auth.createAdmin');
            }
        });

        // Login form
        document.getElementById('login-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            const email = document.getElementById('login-email').value.trim();
            const pw = document.getElementById('login-password').value;
            const btn = document.getElementById('btn-login');
            btn.disabled = true; btn.textContent = _t('auth.loggingIn');

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, password: pw }),
                });
                const json = await res.json();
                if (!res.ok || !json.success) {
                    if (json.needsVerification) {
                        showVerifySection(json.email || email, email);
                        btn.disabled = false; btn.textContent = _t('auth.login'); return;
                    }
                    showError(json.error || _t('auth.loginFailed'));
                    btn.disabled = false; btn.textContent = _t('auth.login'); return;
                }
                setAuth(json.data.token, json.data.user);
                window.location.href = '/index.html';
            } catch (err) {
                showError(_t('auth.connectionError'));
                btn.disabled = false; btn.textContent = _t('auth.login');
            }
        });

        // Verify email form
        document.getElementById('verify-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            const code = document.getElementById('verify-code').value.trim();
            const email = document.getElementById('verify-email').value || verifyRealEmail;
            const btn = document.getElementById('btn-verify');
            btn.disabled = true; btn.textContent = _t('common.loading');

            try {
                const res = await fetch('/api/auth/verify-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, code: code }),
                });
                const json = await res.json();
                if (!res.ok || !json.success) {
                    showError(json.error || _t('auth.verifyEmail.invalid'));
                    btn.disabled = false; btn.textContent = _t('auth.verifyEmail.submit'); return;
                }
                setAuth(json.data.token, json.data.user);
                window.location.href = '/index.html';
            } catch (err) {
                showError(_t('auth.connectionError'));
                btn.disabled = false; btn.textContent = _t('auth.verifyEmail.submit');
            }
        });

        // Resend verification code
        document.getElementById('link-resend-code').addEventListener('click', async function (e) {
            e.preventDefault();
            const email = document.getElementById('verify-email').value || verifyRealEmail;
            if (!email) return;
            try {
                await fetch('/api/auth/resend-verification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email }),
                });
                const resentEl = document.getElementById('verify-resent');
                resentEl.classList.remove('hidden');
                setTimeout(function () { resentEl.classList.add('hidden'); }, 3000);
            } catch (err) { /* silently fail */ }
        });

        // Password strength indicator
        const regPwInput = document.getElementById('reg-password');
        if (regPwInput) {
            regPwInput.addEventListener('input', function () { updatePasswordStrength(regPwInput.value); });
        }

        // Register form
        document.getElementById('register-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            const name = document.getElementById('reg-name').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const phone = document.getElementById('reg-phone').value.trim();
            const country = document.getElementById('reg-country').value;
            const pw = document.getElementById('reg-password').value;
            const pw2 = document.getElementById('reg-password2').value;
            const termsChecked = document.getElementById('reg-terms').checked;

            if (!termsChecked) { showError(_t('auth.terms.required')); return; }
            const pwError = validatePasswordRules(pw);
            if (pwError) { showError(pwError); return; }
            if (pw !== pw2) { showError(_t('auth.passwordsNoMatch')); return; }

            const btn = document.getElementById('btn-register');
            btn.disabled = true; btn.textContent = _t('auth.registering');

            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: email, password: pw, display_name: name,
                        terms_accepted: true, phone: phone || undefined,
                        country_code: country || 'US',
                    }),
                });
                const json = await res.json();
                if (!res.ok || !json.success) {
                    showError(json.error || _t('auth.registrationFailed'));
                    btn.disabled = false; btn.textContent = _t('auth.register'); return;
                }
                if (json.data && json.data.needsVerification) {
                    showVerifySection(json.data.email || email, email);
                    btn.disabled = false; btn.textContent = _t('auth.register'); return;
                }
                setAuth(json.data.token, json.data.user);
                window.location.href = '/index.html';
            } catch (err) {
                showError(_t('auth.connectionError'));
                btn.disabled = false; btn.textContent = _t('auth.register');
            }
        });
    });
})();
