/**
 * Landing page script.
 * If the user is already logged in, swap nav links to show Dashboard + Logout.
 */
(function () {
    'use strict';

    // Initialize i18n for unauthenticated page
    if (typeof I18n !== 'undefined') { I18n.autoInit(); }

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    var token = localStorage.getItem('mdt_token');
    var user;
    try {
        user = JSON.parse(localStorage.getItem('mdt_user'));
    } catch (e) {
        user = null;
    }

    function applyLoggedInState() {
        if (token && user) {
            var isDemo = user && user.is_demo;

            // Swap sign-up / login links for dashboard link
            var loginLink = document.getElementById('nav-login');
            var registerLink = document.getElementById('nav-register');

            if (loginLink) {
                loginLink.href = '/index.html';
                loginLink.textContent = _t('nav.dashboard');
            }
            if (registerLink) {
                registerLink.href = '#';
                registerLink.textContent = isDemo ? (_t('demo.exitDemo') || 'Exit Demo') : _t('nav.logout');
                registerLink.className = 'nav-auth-link';
                registerLink.addEventListener('click', function (e) {
                    e.preventDefault();
                    localStorage.removeItem('mdt_token');
                    localStorage.removeItem('mdt_user');
                    window.location.reload();
                });
            }

            // Hide demo buttons when already logged in
            var heroDemo = document.getElementById('hero-demo');
            if (heroDemo) heroDemo.classList.add('hidden');
            var ctaDemo = document.getElementById('cta-demo');
            if (ctaDemo) ctaDemo.classList.add('hidden');

            // Update hero CTA
            var heroCta = document.getElementById('hero-signup');
            if (heroCta) {
                if (isDemo) {
                    heroCta.href = '/login.html#register';
                    heroCta.textContent = _t('landing.getStarted') || 'Sign Up Free';
                } else {
                    heroCta.href = '/index.html';
                    heroCta.textContent = _t('nav.dashboard');
                }
            }

            var bottomCta = document.getElementById('cta-signup');
            if (bottomCta) {
                if (isDemo) {
                    bottomCta.href = '/login.html#register';
                    bottomCta.textContent = _t('landing.getStarted') || 'Sign Up Free';
                } else {
                    bottomCta.href = '/index.html';
                    bottomCta.textContent = _t('nav.dashboard');
                }
            }
        }
    }
    function injectLangSelector() {
        if (typeof I18n !== 'undefined' && I18n.injectLanguageSelector) {
            I18n.injectLanguageSelector('.nav-auth-actions');
        }
    }

    function startDemo(redirectTo) {
        var target = redirectTo || '/index.html';
        fetch('/api/auth/demo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        })
        .then(function (res) { return res.json(); })
        .then(function (json) {
            if (json.success && json.data) {
                localStorage.setItem('mdt_token', json.data.token);
                localStorage.setItem('mdt_user', JSON.stringify(json.data.user));
                window.location.href = target;
            } else {
                alert(json.error || 'Demo is not available right now.');
            }
        })
        .catch(function () {
            alert('Could not start demo. Please try again.');
        });
    }

    var heroDemo = document.getElementById('hero-demo');
    if (heroDemo) heroDemo.addEventListener('click', function () { startDemo(); });

    var ctaDemo = document.getElementById('cta-demo');
    if (ctaDemo) ctaDemo.addEventListener('click', function () { startDemo(); });

    // Feature cards: if logged in go directly, otherwise start demo then redirect
    var featureCards = document.querySelectorAll('.landing-feature-card--link[data-page]');
    featureCards.forEach(function (card) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', function (e) {
            e.preventDefault();
            var page = card.getAttribute('data-page');
            if (token && user) {
                window.location.href = page;
            } else {
                startDemo(page);
            }
        });
    });

    if (window.I18n) {
        I18n.onReady(function () {
            applyLoggedInState();
            injectLangSelector();
        });
    } else {
        applyLoggedInState();
    }
})();
