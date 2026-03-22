/**
 * Admin page logic
 * Handles user management, invite code generation, and admin stats display.
 */
(function () {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    /* ------------------------------------------------------------------ */
    /*  DOM References                                                    */
    /* ------------------------------------------------------------------ */
    const els = {};
    function cacheElements() {
        els.statUsers = document.getElementById('stat-users');
        els.statActiveUsers = document.getElementById('stat-active-users');
        els.statSites = document.getElementById('stat-sites');
        els.statFinds = document.getElementById('stat-finds');
        els.statInvites = document.getElementById('stat-invites');
        els.usersTbody = document.getElementById('users-tbody');
        els.invitesTbody = document.getElementById('invites-tbody');
        els.btnGenerate = document.getElementById('btn-generate-invite');
        els.inviteDisplay = document.getElementById('invite-code-display');
        els.generatedCode = document.getElementById('generated-code');
        els.btnCopy = document.getElementById('btn-copy-invite');
        els.btnShare = document.getElementById('btn-share-invite');
        els.btnSms = document.getElementById('btn-sms-invite');
        els.btnEmail = document.getElementById('btn-email-invite');
        els.toggleNotifyRegister = document.getElementById('toggle-notify-register');
        els.emailConfigStatus = document.getElementById('email-config-status');
        els.feedbackTbody = document.getElementById('feedback-tbody');
        els.feedbackFilter = document.getElementById('feedback-filter');
        els.statFeedback = document.getElementById('stat-feedback');
        els.legalTbody = document.getElementById('legal-tbody');
        els.legalCountryFilter = document.getElementById('legal-country-filter');
        els.legalStaleFilter = document.getElementById('legal-stale-filter');
        els.statStaleLegal = document.getElementById('stat-stale-legal');
        els.legalStaleBanner = document.getElementById('legal-stale-banner');
        els.btnAddLegal = document.getElementById('btn-add-legal');
        // Legal suggestions
        els.suggestionsTbody = document.getElementById('suggestions-tbody');
        els.suggestionStatusFilter = document.getElementById('suggestion-status-filter');
        els.suggestionsPrev = document.getElementById('suggestions-prev');
        els.suggestionsNext = document.getElementById('suggestions-next');
        els.suggestionsPageIndicator = document.getElementById('suggestions-page-indicator');
        // Audit log
        els.auditTbody = document.getElementById('audit-tbody');
        els.auditActionFilter = document.getElementById('audit-action-filter');
        els.auditEntityFilter = document.getElementById('audit-entity-filter');
        els.auditUserFilter = document.getElementById('audit-user-filter');
        els.auditStartDate = document.getElementById('audit-start-date');
        els.auditEndDate = document.getElementById('audit-end-date');
        els.auditPrev = document.getElementById('audit-prev');
        els.auditNext = document.getElementById('audit-next');
        els.auditPageIndicator = document.getElementById('audit-page-indicator');
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                              */
    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', () => {
        // Redirect non-admins
        Auth.requireAuth().then(() => {
            if (!Auth.isAdmin()) {
                window.location.href = '/index.html';
                return;
            }
            cacheElements();
            bindEvents();
            function startLoad() {
                loadSettings();
                loadStats();
                loadUsers();
                loadInviteCodes();
                loadFeedback();
                loadLegalContent();
                loadLegalSuggestions();
                loadAuditActions();
                loadAuditLog();
            }
            if (window.I18n) { I18n.onReady(startLoad); } else { startLoad(); }
        });
    });

    /* ------------------------------------------------------------------ */
    /*  Events                                                            */
    /* ------------------------------------------------------------------ */
    function bindEvents() {
        els.btnGenerate.addEventListener('click', generateInviteCode);
        els.btnCopy.addEventListener('click', copyInviteCode);
        els.btnShare.addEventListener('click', function () {
            shareInviteCode(els.generatedCode.textContent);
        });
        els.btnSms.addEventListener('click', function () {
            shareViaSms(els.generatedCode.textContent);
        });
        els.btnEmail.addEventListener('click', function () {
            shareViaEmail(els.generatedCode.textContent);
        });
        // Hide Web Share button if API not available
        if (!navigator.share) {
            els.btnShare.classList.add('hidden');
        }
        // Settings toggle
        els.toggleNotifyRegister.addEventListener('change', toggleNotifyRegister);
        // Feedback filter
        els.feedbackFilter.addEventListener('change', loadFeedback);
        // Legal content filters and add
        if (els.legalCountryFilter) els.legalCountryFilter.addEventListener('change', loadLegalContent);
        if (els.legalStaleFilter) els.legalStaleFilter.addEventListener('change', loadLegalContent);
        if (els.btnAddLegal) els.btnAddLegal.addEventListener('click', function () { openLegalEdit(null); });
        var legalEditForm = document.getElementById('legal-edit-form');
        if (legalEditForm) legalEditForm.addEventListener('submit', saveLegalSection);
        var legalModalCancel = document.getElementById('legal-modal-cancel');
        if (legalModalCancel) legalModalCancel.addEventListener('click', function () {
            document.getElementById('legal-modal').classList.remove('is-open');
        });
        // Legal suggestion filters + pagination
        if (els.suggestionStatusFilter) els.suggestionStatusFilter.addEventListener('change', function () { suggestionsPage = 1; loadLegalSuggestions(); });
        if (els.suggestionsPrev) els.suggestionsPrev.addEventListener('click', function () { if (suggestionsPage > 1) { suggestionsPage--; loadLegalSuggestions(); } });
        if (els.suggestionsNext) els.suggestionsNext.addEventListener('click', function () { suggestionsPage++; loadLegalSuggestions(); });
        var suggestionModalClose = document.getElementById('suggestion-modal-close');
        if (suggestionModalClose) suggestionModalClose.addEventListener('click', function () {
            document.getElementById('suggestion-modal').classList.remove('is-open');
        });
        // Audit log filters
        if (els.auditActionFilter) els.auditActionFilter.addEventListener('change', function () { auditPage = 1; loadAuditLog(); });
        if (els.auditEntityFilter) els.auditEntityFilter.addEventListener('change', function () { auditPage = 1; loadAuditLog(); });
        if (els.auditStartDate) els.auditStartDate.addEventListener('change', function () { auditPage = 1; loadAuditLog(); });
        if (els.auditEndDate) els.auditEndDate.addEventListener('change', function () { auditPage = 1; loadAuditLog(); });
        if (els.auditPrev) els.auditPrev.addEventListener('click', function () { if (auditPage > 1) { auditPage--; loadAuditLog(); } });
        if (els.auditNext) els.auditNext.addEventListener('click', function () { auditPage++; loadAuditLog(); });
        // Debounced user search
        var auditUserTimeout;
        if (els.auditUserFilter) els.auditUserFilter.addEventListener('input', function () {
            clearTimeout(auditUserTimeout);
            auditUserTimeout = setTimeout(function () { auditPage = 1; loadAuditLog(); }, 300);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Stats                                                             */
    /* ------------------------------------------------------------------ */
    async function loadStats() {
        try {
            const res = await Auth.authedFetch('/api/admin/stats');
            if (!res.ok) throw new Error('Failed to fetch stats');
            const json = await res.json();
            const d = json.data;
            els.statUsers.textContent = d.totalUsers || 0;
            els.statActiveUsers.textContent = d.activeUsers || 0;
            els.statSites.textContent = d.totalSites || 0;
            els.statFinds.textContent = d.totalFinds || 0;
            els.statInvites.textContent = d.activeInvites || 0;
            // Load feedback stats separately
            loadFeedbackStats();
        } catch (err) {
            console.error('Error loading admin stats:', err);
        }
    }

    async function loadFeedbackStats() {
        try {
            var res = await Auth.authedFetch('/api/feedback/stats');
            if (!res.ok) return;
            var json = await res.json();
            var stats = json.data || {};
            els.statFeedback.textContent = stats.new || 0;
        } catch (err) {
            console.error('Error loading feedback stats:', err);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Settings                                                          */
    /* ------------------------------------------------------------------ */
    async function loadSettings() {
        try {
            var res = await Auth.authedFetch('/api/admin/settings');
            if (!res.ok) throw new Error('Failed to fetch settings');
            var json = await res.json();
            els.toggleNotifyRegister.checked = json.data.notify_on_register;
            if (!json.data.email_configured) {
                els.emailConfigStatus.textContent = 'Email not configured. SMTP settings required on server.';
                els.emailConfigStatus.style.color = '#ef4444';
            }
        } catch (err) {
            console.error('Error loading settings:', err);
        }
    }

    async function toggleNotifyRegister() {
        var newValue = els.toggleNotifyRegister.checked ? 'true' : 'false';
        try {
            var res = await Auth.authedFetch('/api/admin/settings', {
                method: 'PUT',
                body: JSON.stringify({ key: 'notify_on_register', value: newValue }),
            });
            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                throw new Error(err.error || 'Failed to update setting');
            }
        } catch (err) {
            console.error('Error updating setting:', err);
            // Revert the toggle on failure
            els.toggleNotifyRegister.checked = !els.toggleNotifyRegister.checked;
            Auth.showToast(_t('admin.errorLoadingStats'));
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Users                                                             */
    /* ------------------------------------------------------------------ */
    async function loadUsers() {
        try {
            const res = await Auth.authedFetch('/api/admin/users');
            if (!res.ok) throw new Error('Failed to fetch users');
            const json = await res.json();
            const users = json.data || [];
            renderUsers(users);
        } catch (err) {
            console.error('Error loading users:', err);
            els.usersTbody.innerHTML = '<tr><td colspan="6" class="error-text">' + _t('admin.errorLoadingUsers') + '</td></tr>';
        }
    }

    function renderUsers(users) {
        if (users.length === 0) {
            els.usersTbody.innerHTML = '<tr><td colspan="6" class="empty-text">No users found.</td></tr>';
            return;
        }

        const esc = escapeHtml;
        const currentUser = Auth.getUser();
        let html = '';

        users.forEach(u => {
            const roleBadge = u.role === 'admin'
                ? '<span class="badge badge-admin">Admin</span>'
                : '<span class="badge badge-user">User</span>';

            const isSelf = currentUser && currentUser.id === u.id;

            const roleSelect = isSelf
                ? roleBadge
                : '<select class="role-select form-control-sm" data-user-id="' + u.id + '">' +
                  '<option value="user"' + (u.role === 'user' ? ' selected' : '') + '>User</option>' +
                  '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
                  '</select>';

            const disableBtn = isSelf
                ? ''
                : '<button class="btn btn-sm ' + (u.is_disabled ? 'btn-success' : 'btn-warning') + ' btn-toggle-disable" data-user-id="' + u.id + '" style="margin-right:4px;">' + (u.is_disabled ? 'Enable' : 'Disable') + '</button>';

            const resetBtn = isSelf
                ? ''
                : '<button class="btn btn-sm btn-reset-pw" data-user-id="' + u.id + '" data-user-name="' + esc(u.display_name) + '" style="margin-right:4px;">Reset PW</button>';

            const deleteBtn = isSelf
                ? ''
                : '<button class="btn btn-sm btn-danger btn-delete-user" data-user-id="' + u.id + '">Delete</button>';

            const disabledBadge = u.is_disabled ? ' <span class="badge badge-disabled">Disabled</span>' : '';

            html += '<tr' + (u.is_disabled ? ' class="row-disabled"' : '') + '>' +
                '<td>' + esc(u.email) + disabledBadge + '</td>' +
                '<td>' + esc(u.display_name) + '</td>' +
                '<td>' + roleSelect + '</td>' +
                '<td>' + (u.sites_count || 0) + '</td>' +
                '<td>' + (u.finds_count || 0) + '</td>' +
                '<td>' + disableBtn + resetBtn + deleteBtn + '</td>' +
                '</tr>';
        });

        els.usersTbody.innerHTML = html;

        // Bind role change
        els.usersTbody.querySelectorAll('.role-select').forEach(sel => {
            sel.addEventListener('change', () => changeUserRole(sel.dataset.userId, sel.value));
        });

        // Bind disable/enable toggle
        els.usersTbody.querySelectorAll('.btn-toggle-disable').forEach(btn => {
            btn.addEventListener('click', () => toggleDisableUser(btn.dataset.userId));
        });

        // Bind delete
        els.usersTbody.querySelectorAll('.btn-delete-user').forEach(btn => {
            btn.addEventListener('click', () => deleteUser(btn.dataset.userId));
        });

        // Bind reset password
        els.usersTbody.querySelectorAll('.btn-reset-pw').forEach(btn => {
            btn.addEventListener('click', () => resetUserPassword(btn.dataset.userId, btn.dataset.userName));
        });
    }

    async function changeUserRole(userId, newRole) {
        try {
            const res = await Auth.authedFetch('/api/admin/users/' + userId + '/role', {
                method: 'PUT',
                body: JSON.stringify({ role: newRole }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to update role');
            }
            await loadUsers();
            await loadStats();
        } catch (err) {
            console.error('Error changing user role:', err);
            Auth.showToast(_t('admin.errorChangingRole'));
            await loadUsers();
        }
    }

    async function toggleDisableUser(userId) {
        try {
            const res = await Auth.authedFetch('/api/admin/users/' + userId + '/disable', {
                method: 'PUT',
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to toggle user status');
            }
            await loadUsers();
        } catch (err) {
            console.error('Error toggling user disabled state:', err);
            Auth.showToast('Failed to update user status. Please try again.');
        }
    }

    async function deleteUser(userId) {
        if (!confirm(_t('common.delete') + '?')) return;
        try {
            const res = await Auth.authedFetch('/api/admin/users/' + userId, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to delete user');
            }
            await loadUsers();
            await loadStats();
        } catch (err) {
            console.error('Error deleting user:', err);
            Auth.showToast(_t('admin.errorDeletingUser'));
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Password Reset                                                    */
    /* ------------------------------------------------------------------ */
    async function resetUserPassword(userId, userName) {
        if (!confirm('Generate a password reset link for ' + userName + '?')) return;
        try {
            const res = await Auth.authedFetch('/api/admin/users/' + userId + '/reset-password', {
                method: 'POST',
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to generate reset link');
            }
            const json = await res.json();
            var resetUrl = window.location.origin + '/reset-password.html?token=' + json.data.token;

            // Show the reset link in a prompt so they can copy it
            prompt('Send this link to ' + userName + '. It expires in 24 hours:', resetUrl);
        } catch (err) {
            console.error('Error generating reset link:', err);
            Auth.showToast(_t('admin.errorGeneratingResetLink'));
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Invite Codes                                                      */
    /* ------------------------------------------------------------------ */
    async function loadInviteCodes() {
        try {
            const res = await Auth.authedFetch('/api/admin/invite-codes');
            if (!res.ok) throw new Error('Failed to fetch invite codes');
            const json = await res.json();
            const codes = json.data || [];
            renderInviteCodes(codes);
        } catch (err) {
            console.error('Error loading invite codes:', err);
            els.invitesTbody.innerHTML = '<tr><td colspan="5" class="error-text">' + _t('admin.errorLoadingInvites') + '</td></tr>';
        }
    }

    function renderInviteCodes(codes) {
        if (codes.length === 0) {
            els.invitesTbody.innerHTML = '<tr><td colspan="5" class="empty-text">No invite codes generated yet.</td></tr>';
            return;
        }

        const esc = escapeHtml;
        let html = '';

        codes.forEach(c => {
            let statusBadge;
            if (c.used_by) {
                statusBadge = '<span class="badge badge-used">Used by ' + esc(c.used_by_name || 'User #' + c.used_by) + '</span>';
            } else if (c.expires_at && new Date(c.expires_at) < new Date()) {
                statusBadge = '<span class="badge badge-expired">Expired</span>';
            } else {
                statusBadge = '<span class="badge badge-active">Active</span>';
            }

            const createdDate = c.created_at ? new Date(c.created_at).toLocaleDateString() : '-';
            var isActive = !c.used_by && !(c.expires_at && new Date(c.expires_at) < new Date());

            var shareButtons = isActive
                ? '<div class="invite-table-actions">' +
                  (navigator.share ? '<button class="btn btn-sm btn-share btn-share-table" data-code="' + esc(c.code) + '" title="Share">&#x1F4E4;</button>' : '') +
                  '<button class="btn btn-sm btn-share-sms btn-sms-table" data-code="' + esc(c.code) + '" title="SMS">&#x1F4F1;</button>' +
                  '<button class="btn btn-sm btn-share-email btn-email-table" data-code="' + esc(c.code) + '" title="Email">&#x2709;</button>' +
                  '</div>'
                : '';

            const deleteBtn = c.used_by
                ? ''
                : '<button class="btn btn-sm btn-danger btn-delete-invite" data-invite-id="' + c.id + '">Delete</button>';

            html += '<tr>' +
                '<td><span class="invite-code">' + esc(c.code) + '</span></td>' +
                '<td>' + esc(c.created_by_name || 'Admin') + '</td>' +
                '<td>' + statusBadge + '</td>' +
                '<td>' + esc(createdDate) + '</td>' +
                '<td>' + shareButtons + deleteBtn + '</td>' +
                '</tr>';
        });

        els.invitesTbody.innerHTML = html;

        // Bind delete
        els.invitesTbody.querySelectorAll('.btn-delete-invite').forEach(btn => {
            btn.addEventListener('click', () => deleteInviteCode(btn.dataset.inviteId));
        });

        // Bind table share buttons
        els.invitesTbody.querySelectorAll('.btn-share-table').forEach(function (btn) {
            btn.addEventListener('click', function () { shareInviteCode(btn.dataset.code); });
        });
        els.invitesTbody.querySelectorAll('.btn-sms-table').forEach(function (btn) {
            btn.addEventListener('click', function () { shareViaSms(btn.dataset.code); });
        });
        els.invitesTbody.querySelectorAll('.btn-email-table').forEach(function (btn) {
            btn.addEventListener('click', function () { shareViaEmail(btn.dataset.code); });
        });
    }

    async function generateInviteCode() {
        try {
            els.btnGenerate.disabled = true;
            els.btnGenerate.textContent = _t('common.loading');
            const res = await Auth.authedFetch('/api/admin/invite-codes', { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to generate invite code');
            }
            const json = await res.json();
            const code = json.data.code;

            // Show the generated code
            els.generatedCode.textContent = code;
            els.inviteDisplay.classList.remove('hidden');

            await loadInviteCodes();
            await loadStats();
        } catch (err) {
            console.error('Error generating invite code:', err);
            Auth.showToast(_t('admin.errorGeneratingInvite'));
        } finally {
            els.btnGenerate.disabled = false;
            els.btnGenerate.textContent = _t('admin.invites.generate');
        }
    }

    function copyInviteCode() {
        const code = els.generatedCode.textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(() => {
                els.btnCopy.textContent = _t('admin.invites.copy') + '!';
                setTimeout(() => { els.btnCopy.textContent = _t('admin.invites.copy'); }, 2000);
            });
        } else {
            // Fallback
            const input = document.createElement('input');
            input.value = code;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            els.btnCopy.textContent = _t('admin.invites.copy') + '!';
            setTimeout(() => { els.btnCopy.textContent = _t('admin.invites.copy'); }, 2000);
        }
    }

    async function deleteInviteCode(inviteId) {
        if (!confirm(_t('common.delete') + '?')) return;
        try {
            const res = await Auth.authedFetch('/api/admin/invite-codes/' + inviteId, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to delete invite code');
            }
            await loadInviteCodes();
            await loadStats();
        } catch (err) {
            console.error('Error deleting invite code:', err);
            Auth.showToast(_t('admin.errorDeletingInvite'));
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Share Invite Codes                                                */
    /* ------------------------------------------------------------------ */
    function buildShareMessage(code) {
        var signupUrl = window.location.origin + '/login.html?code=' + encodeURIComponent(code) + '#register';
        return 'Hey! I\'m inviting you to join Signal Bouncer. ' +
               'Use this invite code to sign up:\n\n' +
               code + '\n\n' +
               'Register here: ' + signupUrl;
    }

    function buildShareSubject() {
        return 'You\'re invited to Signal Bouncer!';
    }

    function shareInviteCode(code) {
        navigator.share({
            title: buildShareSubject(),
            text: buildShareMessage(code),
        }).catch(function (err) {
            if (err.name !== 'AbortError') {
                console.error('Share failed:', err);
            }
        });
    }

    function shareViaSms(code) {
        var message = buildShareMessage(code);
        window.location.href = 'sms:?&body=' + encodeURIComponent(message);
    }

    function shareViaEmail(code) {
        var subject = encodeURIComponent(buildShareSubject());
        var body = encodeURIComponent(buildShareMessage(code));
        window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
    }

    /* ------------------------------------------------------------------ */
    /*  User Feedback                                                     */
    /* ------------------------------------------------------------------ */
    async function loadFeedback() {
        try {
            var statusFilter = els.feedbackFilter.value;
            var url = '/api/feedback' + (statusFilter ? '?status=' + statusFilter : '');
            var res = await Auth.authedFetch(url);
            if (!res.ok) throw new Error('Failed to fetch feedback');
            var json = await res.json();
            var feedback = json.data || [];
            renderFeedback(feedback);
        } catch (err) {
            console.error('Error loading feedback:', err);
            els.feedbackTbody.innerHTML = '<tr><td colspan="7" class="error-text">' + _t('admin.errorLoadingFeedback') + '</td></tr>';
        }
    }

    function renderFeedback(feedbackList) {
        if (feedbackList.length === 0) {
            els.feedbackTbody.innerHTML = '<tr><td colspan="7" class="empty-text">No feedback yet.</td></tr>';
            return;
        }

        var esc2 = escapeHtml;
        var html = '';

        feedbackList.forEach(function (f) {
            var statusClass = 'badge-feedback-' + (f.status || 'new');
            var statusLabel = (f.status || 'new').charAt(0).toUpperCase() + (f.status || 'new').slice(1);
            var typeLabel = (f.type || 'suggestion').charAt(0).toUpperCase() + (f.type || 'suggestion').slice(1);
            var createdDate = f.created_at ? new Date(f.created_at).toLocaleDateString() : '-';
            var msgPreview = f.message && f.message.length > 60 ? f.message.substring(0, 60) + '...' : (f.message || '');
            var pageShort = f.page_url ? f.page_url.replace(/^https?:\/\/[^\/]+/, '') : '-';

            var statusSelect = '<select class="form-control-sm feedback-status-select" data-feedback-id="' + f.id + '">' +
                '<option value="new"' + (f.status === 'new' ? ' selected' : '') + '>New</option>' +
                '<option value="reviewed"' + (f.status === 'reviewed' ? ' selected' : '') + '>Reviewed</option>' +
                '<option value="resolved"' + (f.status === 'resolved' ? ' selected' : '') + '>Resolved</option>' +
                '</select>';

            html += '<tr>' +
                '<td>' + esc2(f.display_name || 'Unknown') + '</td>' +
                '<td><span class="badge badge-feedback-type">' + esc2(typeLabel) + '</span></td>' +
                '<td title="' + esc2(f.message || '') + '">' + esc2(msgPreview) + '</td>' +
                '<td title="' + esc2(f.page_url || '') + '">' + esc2(pageShort) + '</td>' +
                '<td>' + esc2(createdDate) + '</td>' +
                '<td>' + statusSelect + '</td>' +
                '<td><button class="btn btn-sm btn-danger btn-delete-feedback" data-feedback-id="' + f.id + '">Delete</button></td>' +
                '</tr>';
        });

        els.feedbackTbody.innerHTML = html;

        // Bind status change
        els.feedbackTbody.querySelectorAll('.feedback-status-select').forEach(function (sel) {
            sel.addEventListener('change', function () {
                updateFeedbackStatus(sel.dataset.feedbackId, sel.value);
            });
        });

        // Bind delete
        els.feedbackTbody.querySelectorAll('.btn-delete-feedback').forEach(function (btn) {
            btn.addEventListener('click', function () {
                deleteFeedback(btn.dataset.feedbackId);
            });
        });
    }

    async function updateFeedbackStatus(feedbackId, newStatus) {
        try {
            var res = await Auth.authedFetch('/api/feedback/' + feedbackId, {
                method: 'PUT',
                body: JSON.stringify({ status: newStatus }),
            });
            if (!res.ok) throw new Error('Failed to update feedback');
            loadFeedbackStats();
        } catch (err) {
            console.error('Error updating feedback:', err);
            Auth.showToast(_t('admin.errorUpdatingFeedback'));
            loadFeedback();
        }
    }

    async function deleteFeedback(feedbackId) {
        if (!confirm(_t('common.delete') + '?')) return;
        try {
            var res = await Auth.authedFetch('/api/feedback/' + feedbackId, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete feedback');
            await loadFeedback();
            loadFeedbackStats();
        } catch (err) {
            console.error('Error deleting feedback:', err);
            Auth.showToast(_t('admin.errorDeletingFeedback'));
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Legal Content Management                                          */
    /* ------------------------------------------------------------------ */
    async function loadLegalContent() {
        try {
            var countryFilter = els.legalCountryFilter ? els.legalCountryFilter.value : '';
            var staleOnly = els.legalStaleFilter ? els.legalStaleFilter.checked : false;
            var url = '/api/admin/legal?';
            if (countryFilter) url += 'country=' + countryFilter + '&';
            if (staleOnly) url += 'stale=true&';

            var res = await Auth.authedFetch(url);
            if (!res.ok) throw new Error('Failed to fetch legal content');
            var json = await res.json();
            var data = json.data || {};
            renderLegalContent(data.sections || []);

            // Update stale count stat and banner
            var staleCount = data.stale_count || 0;
            if (els.statStaleLegal) els.statStaleLegal.textContent = staleCount;
            if (els.legalStaleBanner) {
                if (staleCount > 0) {
                    els.legalStaleBanner.textContent = staleCount + ' section' + (staleCount === 1 ? '' : 's') + ' not verified in 6+ months.';
                    els.legalStaleBanner.classList.remove('hidden');
                } else {
                    els.legalStaleBanner.classList.add('hidden');
                }
            }
        } catch (err) {
            console.error('Error loading legal content:', err);
            if (els.legalTbody) {
                els.legalTbody.innerHTML = '<tr><td colspan="6" class="error-text">Failed to load legal content.</td></tr>';
            }
        }
    }

    function renderLegalContent(sections) {
        if (!els.legalTbody) return;
        if (sections.length === 0) {
            els.legalTbody.innerHTML = '<tr><td colspan="6" class="empty-text">No legal content found.</td></tr>';
            return;
        }

        var esc = escapeHtml;
        var html = '';
        var now = new Date();
        var sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).toISOString().split('T')[0];

        sections.forEach(function (s) {
            var isStale = !s.last_verified || s.last_verified < sixMonthsAgo;
            var staleIcon = isStale ? ' <span title="Not verified in 6+ months" style="color:#ef4444;">&#9888;</span>' : '';
            var severityBadge = s.severity
                ? '<span class="badge badge-feedback-' + esc(s.severity) + '" style="text-transform:capitalize;">' + esc(s.severity) + '</span>'
                : '<span class="text-muted">—</span>';
            var verifiedDate = s.last_verified || '—';

            html += '<tr>' +
                '<td>' + esc(s.country_code) + '</td>' +
                '<td>' + esc(s.region_code || '—') + '</td>' +
                '<td>' + esc(s.section_title) + '</td>' +
                '<td>' + severityBadge + '</td>' +
                '<td>' + esc(verifiedDate) + staleIcon + '</td>' +
                '<td>' +
                    '<button class="btn btn-sm btn-edit-legal" data-id="' + s.id + '" style="margin-right:2px;">Edit</button>' +
                    '<button class="btn btn-sm btn-verify-legal" data-id="' + s.id + '" title="Mark as verified today" style="margin-right:2px;">&#10003;</button>' +
                    '<button class="btn btn-sm btn-danger btn-delete-legal" data-id="' + s.id + '">Del</button>' +
                '</td>' +
                '</tr>';
        });

        els.legalTbody.innerHTML = html;

        // Bind edit
        els.legalTbody.querySelectorAll('.btn-edit-legal').forEach(function (btn) {
            btn.addEventListener('click', function () { openLegalEdit(btn.dataset.id); });
        });

        // Bind verify
        els.legalTbody.querySelectorAll('.btn-verify-legal').forEach(function (btn) {
            btn.addEventListener('click', function () { verifyLegalSection(btn.dataset.id); });
        });

        // Bind delete
        els.legalTbody.querySelectorAll('.btn-delete-legal').forEach(function (btn) {
            btn.addEventListener('click', function () { deleteLegalSection(btn.dataset.id); });
        });
    }

    async function openLegalEdit(id) {
        try {
            if (id) {
                var res = await Auth.authedFetch('/api/admin/legal/' + id);
                if (!res.ok) throw new Error('Not found');
                var json = await res.json();
                var s = json.data;
                document.getElementById('legal-edit-id').value = s.id;
                document.getElementById('legal-edit-country').value = s.country_code;
                document.getElementById('legal-edit-country').disabled = true;
                document.getElementById('legal-edit-region').value = s.region_code || '';
                document.getElementById('legal-edit-region').disabled = true;
                document.getElementById('legal-edit-key').value = s.section_key;
                document.getElementById('legal-edit-key').disabled = true;
                document.getElementById('legal-edit-title').value = s.section_title;
                document.getElementById('legal-edit-severity').value = s.severity || '';
                document.getElementById('legal-edit-sort').value = s.sort_order || 100;
                document.getElementById('legal-edit-source').value = s.source_url || '';
                document.getElementById('legal-edit-html').value = s.content_html;
                document.getElementById('legal-modal-title').textContent = 'Edit Legal Section';
            } else {
                document.getElementById('legal-edit-id').value = '';
                document.getElementById('legal-edit-country').value = '';
                document.getElementById('legal-edit-country').disabled = false;
                document.getElementById('legal-edit-region').value = '';
                document.getElementById('legal-edit-region').disabled = false;
                document.getElementById('legal-edit-key').value = '';
                document.getElementById('legal-edit-key').disabled = false;
                document.getElementById('legal-edit-title').value = '';
                document.getElementById('legal-edit-severity').value = '';
                document.getElementById('legal-edit-sort').value = 100;
                document.getElementById('legal-edit-source').value = '';
                document.getElementById('legal-edit-html').value = '';
                document.getElementById('legal-modal-title').textContent = 'Add Legal Section';
            }
            document.getElementById('legal-modal').classList.add('is-open');

            // Load revision history for existing sections
            if (id) {
                var revContainer = document.getElementById('legal-revision-history');
                if (!revContainer) {
                    // Create revision history container in modal
                    revContainer = document.createElement('div');
                    revContainer.id = 'legal-revision-history';
                    revContainer.style.cssText = 'margin-top:1rem;padding-top:1rem;border-top:1px solid var(--color-border, #e0e0e0);';
                    document.getElementById('legal-edit-form').parentElement.appendChild(revContainer);
                }
                revContainer.innerHTML = '<p style="font-size:0.85rem;color:var(--color-text-muted,#888);">Loading revisions...</p>';
                loadRevisionHistory(id).then(function (html) {
                    revContainer.innerHTML = '<h4 style="margin:0 0 0.5rem;font-size:1rem;">Revision History</h4>' + html;
                });
            } else {
                var revContainer2 = document.getElementById('legal-revision-history');
                if (revContainer2) revContainer2.innerHTML = '';
            }
        } catch (err) {
            console.error('Error loading legal section:', err);
            Auth.showToast('Failed to load section.');
        }
    }

    async function saveLegalSection(e) {
        e.preventDefault();
        var id = document.getElementById('legal-edit-id').value;
        var isNew = !id;

        var body = {
            section_title: document.getElementById('legal-edit-title').value,
            content_html: document.getElementById('legal-edit-html').value,
            severity: document.getElementById('legal-edit-severity').value,
            sort_order: parseInt(document.getElementById('legal-edit-sort').value, 10) || 100,
            source_url: document.getElementById('legal-edit-source').value || null,
        };

        if (isNew) {
            body.country_code = document.getElementById('legal-edit-country').value;
            body.region_code = document.getElementById('legal-edit-region').value || null;
            body.section_key = document.getElementById('legal-edit-key').value;
        }

        try {
            var url = isNew ? '/api/admin/legal' : '/api/admin/legal/' + id;
            var method = isNew ? 'POST' : 'PUT';
            var res = await Auth.authedFetch(url, { method: method, body: JSON.stringify(body) });
            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                throw new Error(err.error || 'Failed to save');
            }
            document.getElementById('legal-modal').classList.remove('is-open');
            await loadLegalContent();
        } catch (err) {
            console.error('Error saving legal section:', err);
            Auth.showToast('Failed to save legal section. Please try again.');
        }
    }

    async function verifyLegalSection(id) {
        try {
            var res = await Auth.authedFetch('/api/admin/legal/' + id + '/verify', { method: 'PUT' });
            if (!res.ok) throw new Error('Failed to verify');
            await loadLegalContent();
        } catch (err) {
            console.error('Error verifying legal section:', err);
            Auth.showToast('Failed to mark as verified.');
        }
    }

    async function deleteLegalSection(id) {
        if (!confirm('Delete this legal section?')) return;
        try {
            var res = await Auth.authedFetch('/api/admin/legal/' + id, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete');
            await loadLegalContent();
        } catch (err) {
            console.error('Error deleting legal section:', err);
            Auth.showToast('Failed to delete section.');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Legal Suggestions                                                 */
    /* ------------------------------------------------------------------ */
    var suggestionsPage = 1;

    async function loadLegalSuggestions() {
        try {
            var params = new URLSearchParams();
            params.set('page', suggestionsPage);
            params.set('limit', '20');
            if (els.suggestionStatusFilter && els.suggestionStatusFilter.value) {
                params.set('status', els.suggestionStatusFilter.value);
            }

            var res = await Auth.authedFetch('/api/admin/legal/suggestions?' + params.toString());
            if (!res.ok) throw new Error('Failed to fetch suggestions');
            var json = await res.json();
            var data = json.data || {};
            renderSuggestions(data.suggestions || [], data.total_count || 0, suggestionsPage, 20);
        } catch (err) {
            console.error('Error loading legal suggestions:', err);
            if (els.suggestionsTbody) {
                els.suggestionsTbody.innerHTML = '<tr><td colspan="7" class="error-text">Failed to load suggestions.</td></tr>';
            }
        }
    }

    function renderSuggestions(suggestions, totalCount, page, pageSize) {
        if (!els.suggestionsTbody) return;
        if (suggestions.length === 0) {
            els.suggestionsTbody.innerHTML = '<tr><td colspan="7" class="empty-text">' + _t('admin.legal.suggestions.empty') + '</td></tr>';
            if (els.suggestionsPageIndicator) els.suggestionsPageIndicator.textContent = '';
            if (els.suggestionsPrev) els.suggestionsPrev.disabled = true;
            if (els.suggestionsNext) els.suggestionsNext.disabled = true;
            return;
        }

        var esc = escapeHtml;
        var html = '';

        suggestions.forEach(function (s) {
            var typeLabel = (s.suggestion_type || 'correction').replace('_', ' ');
            typeLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);

            var statusClass = 'suggestion-status-' + (s.status || 'pending');
            var statusLabel = (s.status || 'pending').charAt(0).toUpperCase() + (s.status || 'pending').slice(1);
            var createdDate = s.created_at ? new Date(s.created_at).toLocaleDateString() : '-';
            var textPreview = s.suggested_text && s.suggested_text.length > 50
                ? s.suggested_text.substring(0, 50) + '...' : (s.suggested_text || '');
            var countryLabel = s.country_code || '';
            if (s.region_code) countryLabel += '/' + s.region_code;

            html += '<tr>' +
                '<td>' + esc(s.display_name || s.email || 'Unknown') + '</td>' +
                '<td><span class="badge suggestion-type-badge">' + esc(typeLabel) + '</span></td>' +
                '<td>' + esc(countryLabel) + '</td>' +
                '<td title="' + esc(s.suggested_text || '') + '">' + esc(textPreview) + '</td>' +
                '<td><span class="badge ' + statusClass + '">' + esc(statusLabel) + '</span></td>' +
                '<td>' + esc(createdDate) + '</td>' +
                '<td>' +
                    '<button class="btn btn-sm btn-view-suggestion" data-id="' + s.id + '" style="margin-right:2px;">View</button>' +
                '</td>' +
                '</tr>';
        });

        els.suggestionsTbody.innerHTML = html;

        // Bind view buttons
        els.suggestionsTbody.querySelectorAll('.btn-view-suggestion').forEach(function (btn) {
            btn.addEventListener('click', function () { openSuggestionDetail(btn.dataset.id); });
        });

        // Pagination
        var totalPages = Math.ceil(totalCount / pageSize) || 1;
        if (els.suggestionsPageIndicator) els.suggestionsPageIndicator.textContent = 'Page ' + page + ' of ' + totalPages;
        if (els.suggestionsPrev) els.suggestionsPrev.disabled = page <= 1;
        if (els.suggestionsNext) els.suggestionsNext.disabled = page >= totalPages;
    }

    async function openSuggestionDetail(id) {
        try {
            var res = await Auth.authedFetch('/api/admin/legal/suggestions/' + id);
            if (!res.ok) throw new Error('Not found');
            var json = await res.json();
            var s = json.data;

            var esc = escapeHtml;
            var typeLabel = (s.suggestion_type || 'correction').replace('_', ' ');
            typeLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
            var statusLabel = (s.status || 'pending').charAt(0).toUpperCase() + (s.status || 'pending').slice(1);
            var statusClass = 'suggestion-status-' + (s.status || 'pending');
            var createdDate = s.created_at ? new Date(s.created_at).toLocaleString() : '-';
            var countryLabel = s.country_code || '';
            if (s.region_code) countryLabel += ' / ' + s.region_code;

            var html = '<div class="suggestion-detail-card">';

            // Info row
            html += '<div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">';
            html += '<div><strong>User:</strong> ' + esc(s.display_name || s.email || 'Unknown') + '</div>';
            html += '<div><strong>Type:</strong> <span class="badge suggestion-type-badge">' + esc(typeLabel) + '</span></div>';
            html += '<div><strong>Status:</strong> <span class="badge ' + statusClass + '">' + esc(statusLabel) + '</span></div>';
            html += '<div><strong>Country:</strong> ' + esc(countryLabel) + '</div>';
            html += '<div><strong>Date:</strong> ' + esc(createdDate) + '</div>';
            html += '</div>';

            // Section reference
            if (s.section_title) {
                html += '<div style="margin-bottom:0.75rem;"><strong>Related Section:</strong> ' + esc(s.section_title) + '</div>';
            }
            if (s.legal_content_id) {
                html += '<div style="margin-bottom:0.75rem;font-size:0.85rem;color:var(--color-text-muted, #888);">Linked to content #' + s.legal_content_id + '</div>';
            }

            // Suggestion text
            html += '<div style="margin-bottom:0.75rem;">';
            html += '<strong>Suggestion:</strong>';
            html += '<div style="background:var(--color-surface-alt, #f9f9f9);border:1px solid var(--color-border, #e0e0e0);border-radius:var(--radius-sm, 6px);padding:0.75rem;margin-top:0.35rem;white-space:pre-wrap;font-size:0.9rem;">' + esc(s.suggested_text) + '</div>';
            html += '</div>';

            // Reason
            if (s.reason) {
                html += '<div style="margin-bottom:0.75rem;">';
                html += '<strong>Reason:</strong>';
                html += '<div style="font-size:0.9rem;color:var(--color-text-muted, #888);font-style:italic;margin-top:0.25rem;">' + esc(s.reason) + '</div>';
                html += '</div>';
            }

            // Admin notes (if already reviewed)
            if (s.admin_notes) {
                html += '<div style="margin-bottom:0.75rem;">';
                html += '<strong>Admin Notes:</strong>';
                html += '<div style="font-size:0.9rem;margin-top:0.25rem;">' + esc(s.admin_notes) + '</div>';
                html += '</div>';
            }

            // Actions (only for pending/approved suggestions)
            if (s.status === 'pending' || s.status === 'approved') {
                html += '<hr style="margin:1rem 0;border:none;border-top:1px solid var(--color-border, #e0e0e0);">';

                // Admin notes input
                html += '<div style="margin-bottom:0.75rem;">';
                html += '<label style="font-size:0.85rem;font-weight:600;">Admin Notes:</label>';
                html += '<textarea id="suggestion-admin-notes" class="form-control" rows="2" style="margin-top:0.25rem;" placeholder="Optional notes...">' + esc(s.admin_notes || '') + '</textarea>';
                html += '</div>';

                html += '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">';
                if (s.status === 'pending') {
                    html += '<button class="btn btn-sm btn-primary" id="btn-approve-suggestion" data-id="' + s.id + '">Approve</button>';
                    html += '<button class="btn btn-sm btn-danger" id="btn-reject-suggestion" data-id="' + s.id + '">Reject</button>';
                }
                if (s.status === 'pending' || s.status === 'approved') {
                    html += '<button class="btn btn-sm" id="btn-apply-suggestion" data-id="' + s.id + '" data-content-id="' + (s.legal_content_id || '') + '" style="background:var(--color-status-green, #22c55e);color:#fff;">Apply to Content</button>';
                }
                html += '</div>';
            }

            html += '</div>';

            document.getElementById('suggestion-modal-body').innerHTML = html;
            document.getElementById('suggestion-modal').classList.add('is-open');

            // Bind action buttons
            var approveBtn = document.getElementById('btn-approve-suggestion');
            if (approveBtn) approveBtn.addEventListener('click', function () { reviewSuggestion(s.id, 'approved'); });
            var rejectBtn = document.getElementById('btn-reject-suggestion');
            if (rejectBtn) rejectBtn.addEventListener('click', function () { reviewSuggestion(s.id, 'rejected'); });
            var applyBtn = document.getElementById('btn-apply-suggestion');
            if (applyBtn) applyBtn.addEventListener('click', function () { openApplySuggestion(s); });

        } catch (err) {
            console.error('Error loading suggestion detail:', err);
            Auth.showToast('Failed to load suggestion.');
        }
    }

    async function reviewSuggestion(id, status) {
        try {
            var adminNotes = (document.getElementById('suggestion-admin-notes') || {}).value || '';
            var body = { status: status };
            if (adminNotes.trim()) body.admin_notes = adminNotes.trim();

            var res = await Auth.authedFetch('/api/admin/legal/suggestions/' + id, {
                method: 'PUT',
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                throw new Error(err.error || 'Failed to update');
            }
            document.getElementById('suggestion-modal').classList.remove('is-open');
            await loadLegalSuggestions();
            Auth.showToast('Suggestion ' + status + '.');
        } catch (err) {
            console.error('Error reviewing suggestion:', err);
            Auth.showToast('Failed to review suggestion. Please try again.');
        }
    }

    function openApplySuggestion(suggestion) {
        // Close suggestion modal
        document.getElementById('suggestion-modal').classList.remove('is-open');

        // Build apply modal content
        var applyModal = document.getElementById('apply-modal');
        if (!applyModal) {
            // Create apply modal dynamically
            applyModal = document.createElement('div');
            applyModal.id = 'apply-modal';
            applyModal.className = 'modal-overlay';
            applyModal.innerHTML = '<div class="modal-content modal-content--narrow">' +
                '<h3>Apply Suggestion to Content</h3>' +
                '<form id="apply-suggestion-form">' +
                '<input type="hidden" id="apply-suggestion-id">' +
                '<input type="hidden" id="apply-content-id">' +
                '<div class="form-group"><label for="apply-section-title">Section Title</label>' +
                '<input type="text" id="apply-section-title" class="form-control"></div>' +
                '<div class="form-group"><label for="apply-severity">Severity</label>' +
                '<select id="apply-severity" class="form-control">' +
                '<option value="">None</option>' +
                '<option value="ok">OK (Green)</option>' +
                '<option value="caution">Caution (Yellow)</option>' +
                '<option value="warning">Warning (Orange)</option>' +
                '<option value="danger">Danger (Red)</option>' +
                '</select></div>' +
                '<div class="form-group"><label for="apply-content-html">Content HTML</label>' +
                '<textarea id="apply-content-html" class="form-control textarea-code" rows="10" required></textarea></div>' +
                '<div class="form-group"><label for="apply-change-summary">Change Summary (optional)</label>' +
                '<input type="text" id="apply-change-summary" class="form-control" placeholder="Brief description of what changed"></div>' +
                '<div class="modal-actions">' +
                '<button type="button" class="btn btn-secondary" id="apply-modal-cancel">Cancel</button>' +
                '<button type="submit" class="btn btn-primary">Apply</button>' +
                '</div></form></div>';
            document.body.appendChild(applyModal);

            document.getElementById('apply-modal-cancel').addEventListener('click', function () {
                applyModal.classList.remove('is-open');
            });
            document.getElementById('apply-suggestion-form').addEventListener('submit', submitApplySuggestion);
        }

        document.getElementById('apply-suggestion-id').value = suggestion.id;
        document.getElementById('apply-content-id').value = suggestion.legal_content_id || '';

        // Pre-fill from suggestion
        document.getElementById('apply-section-title').value = suggestion.section_title || '';
        document.getElementById('apply-content-html').value = suggestion.suggested_text || '';
        document.getElementById('apply-severity').value = '';
        document.getElementById('apply-change-summary').value = '';

        // If linked to existing content, fetch current values
        if (suggestion.legal_content_id) {
            Auth.authedFetch('/api/admin/legal/' + suggestion.legal_content_id)
                .then(function (res) { return res.json(); })
                .then(function (json) {
                    if (json.success && json.data) {
                        document.getElementById('apply-section-title').value = json.data.section_title || '';
                        document.getElementById('apply-severity').value = json.data.severity || '';
                        // Pre-fill with existing HTML so admin can edit
                        document.getElementById('apply-content-html').value = json.data.content_html || suggestion.suggested_text;
                    }
                })
                .catch(function () {});
        }

        applyModal.classList.add('is-open');
    }

    async function submitApplySuggestion(e) {
        e.preventDefault();
        var suggestionId = document.getElementById('apply-suggestion-id').value;

        var body = {
            content_html: document.getElementById('apply-content-html').value,
        };
        var sectionTitle = document.getElementById('apply-section-title').value.trim();
        if (sectionTitle) body.section_title = sectionTitle;
        var severity = document.getElementById('apply-severity').value;
        if (severity) body.severity = severity;
        var changeSummary = document.getElementById('apply-change-summary').value.trim();
        if (changeSummary) body.change_summary = changeSummary;

        try {
            var res = await Auth.authedFetch('/api/admin/legal/suggestions/' + suggestionId + '/apply', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                throw new Error(err.error || 'Failed to apply');
            }
            document.getElementById('apply-modal').classList.remove('is-open');
            await loadLegalSuggestions();
            await loadLegalContent();
            Auth.showToast('Suggestion applied to content.');
        } catch (err) {
            console.error('Error applying suggestion:', err);
            Auth.showToast('Failed to apply suggestion. Please try again.');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Revision History (shown in legal edit modal)                       */
    /* ------------------------------------------------------------------ */
    async function loadRevisionHistory(contentId) {
        try {
            var res = await Auth.authedFetch('/api/admin/legal/' + contentId + '/revisions');
            if (!res.ok) return '';
            var json = await res.json();
            var revisions = json.data || [];
            if (revisions.length === 0) return '<p class="text-muted" style="font-size:0.85rem;">No revision history.</p>';

            var esc = escapeHtml;
            var html = '<div class="revision-timeline">';
            revisions.forEach(function (r) {
                var date = r.created_at ? new Date(r.created_at).toLocaleString() : '-';
                var changedBy = r.changed_by_name || ('User #' + (r.changed_by || '?'));
                var changes = [];
                if (r.old_title !== r.new_title && (r.old_title || r.new_title)) changes.push('title');
                if (r.old_severity !== r.new_severity && (r.old_severity || r.new_severity)) changes.push('severity');
                if (r.old_content_html !== r.new_content_html) changes.push('content');

                html += '<div class="revision-entry" style="padding:0.5rem 0;border-bottom:1px solid var(--color-border, #e0e0e0);">';
                html += '<div style="display:flex;justify-content:space-between;font-size:0.85rem;">';
                html += '<span><strong>Rev #' + r.revision_number + '</strong> by ' + esc(changedBy) + '</span>';
                html += '<span style="color:var(--color-text-muted, #888);">' + esc(date) + '</span>';
                html += '</div>';
                if (r.change_summary) {
                    html += '<div style="font-size:0.85rem;margin-top:0.2rem;">' + esc(r.change_summary) + '</div>';
                }
                if (changes.length > 0) {
                    html += '<div style="font-size:0.8rem;color:var(--color-text-muted, #888);margin-top:0.15rem;">Changed: ' + changes.join(', ') + '</div>';
                }
                if (r.suggestion_id) {
                    html += '<div style="font-size:0.8rem;color:var(--color-text-muted, #888);margin-top:0.15rem;">From suggestion #' + r.suggestion_id + '</div>';
                }
                html += '</div>';
            });
            html += '</div>';
            return html;
        } catch (err) {
            console.error('Error loading revisions:', err);
            return '<p class="text-muted" style="font-size:0.85rem;">Failed to load revisions.</p>';
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Audit Log                                                         */
    /* ------------------------------------------------------------------ */
    var auditPage = 1;

    async function loadAuditActions() {
        try {
            var res = await Auth.authedFetch('/api/admin/audit/actions');
            if (!res.ok) return;
            var json = await res.json();
            var actions = json.data || [];
            var html = '<option value="">' + _t('admin.audit.allActions') + '</option>';
            actions.forEach(function (a) {
                html += '<option value="' + escapeHtml(a) + '">' + escapeHtml(formatActionLabel(a)) + '</option>';
            });
            if (els.auditActionFilter) els.auditActionFilter.innerHTML = html;
        } catch (err) {
            console.error('Error loading audit actions:', err);
        }
    }

    async function loadAuditLog() {
        try {
            var params = new URLSearchParams();
            params.set('page', auditPage);
            params.set('page_size', '50');
            if (els.auditActionFilter && els.auditActionFilter.value) params.set('action', els.auditActionFilter.value);
            if (els.auditEntityFilter && els.auditEntityFilter.value) params.set('entity_type', els.auditEntityFilter.value);
            if (els.auditUserFilter && els.auditUserFilter.value) params.set('user_search', els.auditUserFilter.value);
            if (els.auditStartDate && els.auditStartDate.value) params.set('start_date', els.auditStartDate.value);
            if (els.auditEndDate && els.auditEndDate.value) params.set('end_date', els.auditEndDate.value);

            var res = await Auth.authedFetch('/api/admin/audit?' + params.toString());
            if (!res.ok) throw new Error(_t('admin.errorLoadingAudit'));
            var json = await res.json();
            var data = json.data || {};
            renderAuditLog(data.events || [], data.total_count || 0, data.page || 1, data.page_size || 50);
        } catch (err) {
            console.error('Error loading audit log:', err);
            if (els.auditTbody) els.auditTbody.innerHTML = '<tr><td colspan="7">' + _t('admin.errorLoadingAudit') + '</td></tr>';
        }
    }

    function renderAuditLog(events, totalCount, page, pageSize) {
        if (!els.auditTbody) return;
        if (events.length === 0) {
            els.auditTbody.innerHTML = '<tr><td colspan="7">' + _t('admin.audit.noEvents') + '</td></tr>';
            if (els.auditPageIndicator) els.auditPageIndicator.textContent = '';
            if (els.auditPrev) els.auditPrev.disabled = true;
            if (els.auditNext) els.auditNext.disabled = true;
            return;
        }

        var esc = escapeHtml;
        var html = '';
        events.forEach(function (e) {
            var ts = e.created_at ? new Date(e.created_at).toLocaleString() : '-';
            var userLabel = e.user_display_name ? esc(e.user_display_name) : ('User #' + e.user_id);
            var detailsStr = e.details ? JSON.stringify(e.details) : '';
            var detailsPreview = detailsStr.length > 60 ? detailsStr.substring(0, 60) + '...' : detailsStr;

            html += '<tr>' +
                '<td style="white-space:nowrap;">' + esc(ts) + '</td>' +
                '<td title="' + esc(e.user_email || '') + '">' + userLabel + '</td>' +
                '<td>' + renderActionBadge(e.action) + '</td>' +
                '<td>' + esc(e.entity_type || '') + '</td>' +
                '<td>' + (e.entity_id != null ? e.entity_id : '-') + '</td>' +
                '<td title="' + esc(detailsStr) + '" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(detailsPreview) + '</td>' +
                '<td>' + esc(e.ip_address || '-') + '</td>' +
                '</tr>';
        });
        els.auditTbody.innerHTML = html;

        // Pagination
        var totalPages = Math.ceil(totalCount / pageSize) || 1;
        if (els.auditPageIndicator) els.auditPageIndicator.textContent = _t('admin.audit.page') + ' ' + page + ' ' + _t('admin.audit.of') + ' ' + totalPages;
        if (els.auditPrev) els.auditPrev.disabled = page <= 1;
        if (els.auditNext) els.auditNext.disabled = page >= totalPages;
    }

    function renderActionBadge(action) {
        var esc = escapeHtml;
        var cls = 'badge ';
        if (!action) { cls += 'badge-audit-default'; }
        else if (action.indexOf('delete') !== -1 || action.indexOf('remove') !== -1) cls += 'badge-audit-delete';
        else if (action.indexOf('create') !== -1 || action.indexOf('add') !== -1) cls += 'badge-audit-create';
        else if (action.indexOf('update') !== -1 || action.indexOf('change') !== -1) cls += 'badge-audit-update';
        else if (action.indexOf('login') !== -1) cls += 'badge-audit-login';
        else if (action.indexOf('register') !== -1) cls += 'badge-audit-register';
        else cls += 'badge-audit-default';
        return '<span class="' + cls + '">' + esc(formatActionLabel(action)) + '</span>';
    }

    function formatActionLabel(action) {
        if (!action) return '';
        return action.replace(/[._]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    /* ------------------------------------------------------------------ */
    /*  Utility                                                           */
    /* ------------------------------------------------------------------ */
    function escapeHtml(str) {
        return window.Auth ? Auth.escapeHtml(str) : (str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '');
    }
})();
