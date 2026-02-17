/**
 * Reset password page logic.
 * Three flows:
 *   1. Email code flow: user enters email -> gets email code -> enters code + new password
 *   2. SMS code flow: user enters email, picks phone -> gets SMS code -> enters code + new password
 *   3. Admin token flow: user clicks a ?token=xxx link -> enters new password
 */
(function () {
    'use strict';

    // Initialize i18n for unauthenticated page
    if (typeof I18n !== 'undefined') { I18n.autoInit(); }

    var currentEmail = '';
    var currentChannel = 'email';

    function showError(msg) {
        var el = document.getElementById('reset-error');
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(function () { el.style.display = 'none'; }, 5000);
    }

    function hideAll() {
        document.getElementById('email-section').style.display = 'none';
        document.getElementById('code-section').style.display = 'none';
        document.getElementById('token-section').style.display = 'none';
        document.getElementById('success-section').style.display = 'none';
    }

    function getSelectedChannel() {
        var checked = document.querySelector('input[name="reset-channel"]:checked');
        return checked ? checked.value : 'email';
    }

    document.addEventListener('DOMContentLoaded', function () {
        var params = new URLSearchParams(window.location.search);
        var token = params.get('token');

        if (token) {
            // Admin token flow
            hideAll();
            document.getElementById('token-section').style.display = 'block';
            setupTokenForm(token);
        } else {
            // Code flow — email section is already visible
            setupEmailForm();
            setupCodeForm();
        }
    });

    /* ---- Step 1: Email form (request code via email or SMS) ---- */
    function setupEmailForm() {
        document.getElementById('email-form').addEventListener('submit', function (e) {
            e.preventDefault();
            sendResetCode();
        });

        var resendBtn = document.getElementById('btn-resend');
        if (resendBtn) {
            resendBtn.addEventListener('click', function (e) {
                e.preventDefault();
                sendResetCode();
            });
        }
    }

    async function sendResetCode() {
        var email = document.getElementById('reset-email').value.trim();
        if (!email) { showError('Please enter your email'); return; }

        currentEmail = email;
        currentChannel = getSelectedChannel();

        var btn = document.getElementById('btn-send-code');
        btn.disabled = true;
        btn.textContent = 'Sending...';

        try {
            var res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, channel: currentChannel }),
            });
            var json = await res.json();

            if (!res.ok || !json.success) {
                showError(json.error || 'Failed to send reset code');
                btn.disabled = false;
                btn.textContent = 'Send Reset Code';
                return;
            }

            // Show step 2
            hideAll();
            document.getElementById('code-section').style.display = 'block';

            var msgEl = document.getElementById('code-sent-msg');
            if (json.data && json.data.channel === 'phone' && json.data.maskedPhone) {
                msgEl.innerHTML = 'A 6-digit code was sent to <strong>' + escapeHtml(json.data.maskedPhone) + '</strong>. Enter it below with your new password.';
            } else if (json.data && json.data.channel === 'email' && json.data.maskedEmail) {
                msgEl.innerHTML = 'A 6-digit code was sent to <strong>' + escapeHtml(json.data.maskedEmail) + '</strong>. Enter it below with your new password.';
            } else {
                msgEl.textContent = 'If an account exists with that email, a reset code has been sent. Enter it below with your new password.';
            }

        } catch (err) {
            showError('Connection error');
            btn.disabled = false;
            btn.textContent = 'Send Reset Code';
        }
    }

    /* ---- Step 2: Code + new password form ---- */
    function setupCodeForm() {
        document.getElementById('reset-form').addEventListener('submit', async function (e) {
            e.preventDefault();

            var code = document.getElementById('reset-code').value.trim();
            var pw = document.getElementById('reset-password').value;
            var pw2 = document.getElementById('reset-password2').value;

            if (pw !== pw2) { showError('Passwords do not match'); return; }

            var btn = document.getElementById('btn-reset');
            btn.disabled = true;
            btn.textContent = 'Resetting...';

            try {
                var res = await fetch('/api/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: code, email: currentEmail, password: pw, channel: currentChannel }),
                });
                var json = await res.json();

                if (!res.ok || !json.success) {
                    showError(json.error || 'Reset failed');
                    btn.disabled = false;
                    btn.textContent = 'Reset Password';
                    return;
                }

                // Success
                hideAll();
                document.getElementById('success-section').style.display = 'block';
            } catch (err) {
                showError('Connection error');
                btn.disabled = false;
                btn.textContent = 'Reset Password';
            }
        });
    }

    /* ---- Admin token flow ---- */
    function setupTokenForm(token) {
        document.getElementById('token-form').addEventListener('submit', async function (e) {
            e.preventDefault();

            var pw = document.getElementById('token-password').value;
            var pw2 = document.getElementById('token-password2').value;

            if (pw !== pw2) { showError('Passwords do not match'); return; }

            var btn = document.getElementById('btn-token-reset');
            btn.disabled = true;
            btn.textContent = 'Resetting...';

            try {
                var res = await fetch('/api/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: token, password: pw }),
                });
                var json = await res.json();

                if (!res.ok || !json.success) {
                    showError(json.error || 'Reset failed');
                    btn.disabled = false;
                    btn.textContent = 'Reset Password';
                    return;
                }

                hideAll();
                document.getElementById('success-section').style.display = 'block';
            } catch (err) {
                showError('Connection error');
                btn.disabled = false;
                btn.textContent = 'Reset Password';
            }
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
})();
