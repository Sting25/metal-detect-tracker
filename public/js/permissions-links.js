/**
 * Permissions page — permission links and letter generation.
 * Adds functions to the shared window.PP namespace created by permissions.js.
 */
(function (PP) {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

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

    PP.handleCreateLink = async function () {
        if (!PP.editingPermId) return;
        PP.els.btnCreateLink.disabled = true;
        PP.els.btnCreateLink.textContent = _t('permissions.link.creating');

        try {
            var res = await Auth.authedFetch('/api/permissions/' + PP.editingPermId + '/link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expires_in_days: 30 }),
            });
            var data = await res.json();
            if (!res.ok) {
                Auth.showToast('Failed to create link. Please try again.');
                return;
            }

            PP.els.linkResult.classList.remove('hidden');
            PP.els.linkUrl.value = data.data.url;
            PP.els.linkQrImage.src = data.data.qr_code;
            var expiresDate = new Date(data.data.expires_at).toLocaleDateString();
            PP.els.linkExpiresText.textContent = _t('permissions.link.expires') + ': ' + expiresDate;

            await PP.loadLinkHistory(PP.editingPermId);
        } catch (err) {
            console.error('Error creating link:', err);
            Auth.showToast('Something went wrong. Please try again.');
        } finally {
            PP.els.btnCreateLink.disabled = false;
            PP.els.btnCreateLink.textContent = _t('permissions.link.create');
        }
    };

    PP.handleCopyLink = function () {
        if (!PP.els.linkUrl.value) return;
        PP.els.linkUrl.select();
        navigator.clipboard.writeText(PP.els.linkUrl.value).then(function () {
            PP.els.btnCopyLink.textContent = _t('permissions.link.copied');
            setTimeout(function () {
                PP.els.btnCopyLink.textContent = _t('permissions.link.copyUrl');
            }, 2000);
        }).catch(function () {
            document.execCommand('copy');
        });
    };

    PP.loadLinkHistory = async function (permId) {
        try {
            var res = await Auth.authedFetch('/api/permissions/' + permId + '/links');
            if (!res.ok) return;
            var data = await res.json();
            renderLinkHistory(data.data || []);
        } catch (err) {
            console.error('Error loading links:', err);
        }
    };

    function renderLinkHistory(links) {
        if (!links || links.length === 0) {
            PP.els.linkHistory.innerHTML = '<p class="link-empty">' + PP.escapeHtml(_t('permissions.link.empty')) + '</p>';
            return;
        }

        var esc = PP.escapeHtml;
        var html = '<div class="link-history-list">';
        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            var statusClass = LINK_STATUS_CLASSES[link.status] || '';
            var createdStr = link.created_at ? new Date(link.created_at).toLocaleDateString() : '';
            var expiresStr = link.expires_at ? new Date(link.expires_at).toLocaleDateString() : '';

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

            if (link.status === 'active' && displayStatus === 'active') {
                html += '<button type="button" class="btn btn-sm btn-danger link-revoke-btn" data-lid="' + link.id + '">'
                    + _t('permissions.link.revoke') + '</button>';
            }

            html += '</div>';
        }
        html += '</div>';
        PP.els.linkHistory.innerHTML = html;

        PP.els.linkHistory.querySelectorAll('.link-revoke-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                handleRevokeLink(btn.dataset.lid);
            });
        });
    }

    async function handleRevokeLink(lid) {
        if (!PP.editingPermId || !lid) return;
        if (!confirm(_t('permissions.link.revokeConfirm'))) return;

        try {
            var res = await Auth.authedFetch('/api/permissions/' + PP.editingPermId + '/links/' + lid, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to revoke link');
            await PP.loadLinkHistory(PP.editingPermId);
        } catch (err) {
            console.error('Error revoking link:', err);
            Auth.showToast('Something went wrong. Please try again.');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Letter Generation                                                 */
    /* ------------------------------------------------------------------ */
    PP.handleGenerateLetter = async function () {
        if (!PP.editingPermId) return;
        PP.els.btnGenerateLetter.disabled = true;
        PP.els.btnGenerateLetter.textContent = _t('permissions.letter.generating');
        PP.els.letterStatus.classList.add('hidden');

        try {
            var res = await Auth.authedFetch('/api/permissions/' + PP.editingPermId + '/letter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            var data = await res.json();
            if (!res.ok) {
                if (data.error && data.error.indexOf('letter preferences') !== -1) {
                    PP.els.letterStatus.textContent = _t('permissions.letter.needPrefs');
                } else {
                    PP.els.letterStatus.textContent = _t('permissions.letter.error');
                }
                PP.els.letterStatus.className = 'letter-status letter-status-error';
                PP.els.letterStatus.classList.remove('hidden');
                return;
            }

            PP.els.letterStatus.textContent = _t('permissions.letter.generated');
            PP.els.letterStatus.className = 'letter-status letter-status-success';
            PP.els.letterStatus.classList.remove('hidden');

            if (data.data && data.data.download_url) {
                window.open(data.data.download_url, '_blank');
            }

            await PP.loadLetterHistory(PP.editingPermId);
        } catch (err) {
            console.error('Error generating letter:', err);
            PP.els.letterStatus.textContent = _t('permissions.letter.error');
            PP.els.letterStatus.className = 'letter-status letter-status-error';
            PP.els.letterStatus.classList.remove('hidden');
        } finally {
            PP.els.btnGenerateLetter.disabled = false;
            PP.els.btnGenerateLetter.textContent = _t('permissions.letter.generate');
        }
    };

    PP.loadLetterHistory = async function (permId) {
        try {
            var res = await Auth.authedFetch('/api/permissions/' + permId + '/letters');
            if (!res.ok) return;
            var data = await res.json();
            renderLetterHistory(data.data || []);
        } catch (err) {
            console.error('Error loading letter history:', err);
        }
    };

    function renderLetterHistory(letters) {
        if (!letters || letters.length === 0) {
            PP.els.letterHistory.innerHTML = '<p class="letter-empty">' + PP.escapeHtml(_t('permissions.letter.empty')) + '</p>';
            return;
        }

        var html = '<div class="letter-history-list">';
        for (var i = 0; i < letters.length; i++) {
            var letter = letters[i];
            var dateStr = letter.created_at ? new Date(letter.created_at).toLocaleDateString() : '';
            html += '<div class="letter-history-item">'
                + '<span class="letter-history-icon">\uD83D\uDCC4</span>'
                + '<span class="letter-history-name">' + PP.escapeHtml(letter.filename) + '</span>'
                + '<span class="letter-history-date">' + PP.escapeHtml(dateStr) + '</span>'
                + '<a href="' + PP.escapeHtml(letter.download_url) + '" target="_blank" class="btn btn-sm btn-outline letter-history-download">'
                + _t('permissions.letter.download') + '</a>'
                + '</div>';
        }
        html += '</div>';
        PP.els.letterHistory.innerHTML = html;
    }

})(window.PP = window.PP || {});
