/**
 * Auth widgets — FAB, feedback widget, demo banner, and quick-add loader.
 * Loaded after auth.js on every authenticated page.
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Floating Action Button (FAB)                                       */
    /* ------------------------------------------------------------------ */
    function createFAB() {
        if (Auth.isDemo()) return;
        var path = window.location.pathname;
        var fabConfig = null;

        if (path === '/sites.html') {
            fabConfig = { icon: '+', label: 'Add Site', targetId: 'btn-add-site' };
        } else if (path === '/finds.html') {
            fabConfig = { icon: '+', label: 'Log Find', targetId: 'btn-add-find' };
        } else if (path === '/permissions.html') {
            fabConfig = { icon: '+', label: 'New Request', targetId: 'btn-add-permission' };
        } else if (path === '/' || path === '/index.html' || path === '/legal.html') {
            fabConfig = { icon: '&#128247;', label: 'Quick Add Site', action: 'quick-add' };
        }

        if (!fabConfig) return;

        var fab = document.createElement('button');
        fab.className = 'fab';
        fab.setAttribute('aria-label', fabConfig.label);
        fab.setAttribute('title', fabConfig.label);
        fab.innerHTML = '<span class="fab-icon">' + fabConfig.icon + '</span>';
        fab.addEventListener('click', function () {
            if (fabConfig.action === 'quick-add') {
                if (window.QuickAddSite) window.QuickAddSite.open();
            } else {
                var target = document.getElementById(fabConfig.targetId);
                if (target) target.click();
            }
        });
        document.body.appendChild(fab);
    }

    /* ------------------------------------------------------------------ */
    /*  Quick Add Site Loader                                              */
    /* ------------------------------------------------------------------ */
    function loadQuickAdd() {
        var path = window.location.pathname;
        if (path === '/login.html' || path === '/landing.html' ||
            path.indexOf('print-') !== -1 ||
            (path === '/legal.html' && !Auth.getToken())) return;

        var script = document.createElement('script');
        script.src = '/js/quick-add.js';
        document.body.appendChild(script);
    }

    /* ------------------------------------------------------------------ */
    /*  Feedback Widget                                                    */
    /* ------------------------------------------------------------------ */
    function createFeedbackWidget() {
        if (Auth.isDemo()) return;
        var path = window.location.pathname;
        if (path === '/login.html' || path === '/landing.html' ||
            path.indexOf('print-') !== -1 ||
            (path === '/legal.html' && !Auth.getToken())) return;

        var widget = document.createElement('div');
        widget.className = 'feedback-widget';
        widget.innerHTML =
            '<button class="feedback-widget-btn" id="feedback-widget-btn" title="Send Feedback"><span class="feedback-btn-icon">&#128172;</span><span class="feedback-btn-label">Feedback</span></button>' +
            '<div class="feedback-panel" id="feedback-panel">' +
            '<div class="feedback-panel-header">' +
            '<span class="feedback-panel-title">Send Feedback</span>' +
            '<button class="feedback-panel-close" id="feedback-panel-close">&times;</button>' +
            '</div>' +
            '<form id="feedback-form" class="feedback-form">' +
            '<div class="feedback-field">' +
            '<label for="feedback-type">Type</label>' +
            '<select id="feedback-type" class="form-control">' +
            '<option value="suggestion">Suggestion</option>' +
            '<option value="bug">Bug Report</option>' +
            '<option value="question">Question</option>' +
            '<option value="other">Other</option>' +
            '</select>' +
            '</div>' +
            '<div class="feedback-field">' +
            '<label for="feedback-message">Message *</label>' +
            '<textarea id="feedback-message" class="form-control" rows="4" placeholder="What\'s on your mind?" required></textarea>' +
            '</div>' +
            '<div class="feedback-field">' +
            '<label for="feedback-screenshot">Screenshot (optional)</label>' +
            '<input type="file" id="feedback-screenshot" accept="image/*" class="form-control">' +
            '</div>' +
            '<button type="submit" class="btn btn-primary feedback-submit-btn">Send Feedback</button>' +
            '</form>' +
            '<div class="feedback-success hidden" id="feedback-success">' +
            '<span class="feedback-success-icon">&#10004;</span>' +
            '<p>Thanks for your feedback!</p>' +
            '</div>' +
            '</div>';

        document.body.appendChild(widget);

        var btn = document.getElementById('feedback-widget-btn');
        var panel = document.getElementById('feedback-panel');
        var closeBtn = document.getElementById('feedback-panel-close');
        var form = document.getElementById('feedback-form');
        var successEl = document.getElementById('feedback-success');

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            panel.classList.toggle('open');
        });

        closeBtn.addEventListener('click', function () {
            panel.classList.remove('open');
        });

        document.addEventListener('click', function (e) {
            if (panel.classList.contains('open') && !widget.contains(e.target)) {
                panel.classList.remove('open');
            }
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var formData = new FormData();
            formData.append('type', document.getElementById('feedback-type').value);
            formData.append('message', document.getElementById('feedback-message').value);
            formData.append('page_url', window.location.href);
            formData.append('user_agent', navigator.userAgent);
            var screenshotInput = document.getElementById('feedback-screenshot');
            if (screenshotInput.files.length > 0) {
                formData.append('screenshot', screenshotInput.files[0]);
            }

            var submitBtn = form.querySelector('.feedback-submit-btn');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';

            Auth.authedFetch('/api/feedback', { method: 'POST', body: formData })
                .then(function (res) {
                    if (!res.ok) throw new Error('Failed');
                    form.classList.add('hidden');
                    successEl.classList.remove('hidden');
                    setTimeout(function () {
                        panel.classList.remove('open');
                        setTimeout(function () {
                            form.classList.remove('hidden');
                            successEl.classList.add('hidden');
                            form.reset();
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Send Feedback';
                        }, 300);
                    }, 2000);
                })
                .catch(function () {
                    Auth.showToast('Failed to send feedback. Please try again.');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Send Feedback';
                });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Demo Mode Banner                                                   */
    /* ------------------------------------------------------------------ */
    function createDemoBanner() {
        if (!Auth.isDemo()) return;

        var banner = document.createElement('div');
        banner.className = 'demo-banner';
        banner.innerHTML =
            '<span class="demo-banner-text">' +
            '&#128269; You\'re viewing a demo &mdash; ' +
            '<a href="/login.html#register" class="demo-banner-link">Sign up free</a> to create your own account' +
            '</span>' +
            '<button class="demo-banner-close" aria-label="Dismiss">&times;</button>';

        document.body.insertBefore(banner, document.body.firstChild);
        document.body.classList.add('has-demo-banner');

        banner.querySelector('.demo-banner-close').addEventListener('click', function () {
            banner.remove();
            document.body.classList.remove('has-demo-banner');
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Init on auth:ready                                                 */
    /* ------------------------------------------------------------------ */
    document.addEventListener('auth:ready', function () {
        createDemoBanner();
        createFAB();
        loadQuickAdd();
        createFeedbackWidget();
    });
})();
