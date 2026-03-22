/**
 * Permissions page — contact log functionality.
 * Adds functions to the shared window.PP namespace created by permissions.js.
 */
(function (PP) {
    'use strict';

    const _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    const CONTACT_TYPE_ICONS = {
        phone_call: '\u260E',
        email: '\u2709',
        in_person: '\uD83E\uDD1D',
        letter_sent: '\uD83D\uDCE4',
        letter_received: '\uD83D\uDCE5',
        other: '\uD83D\uDCCC',
    };

    const OUTCOME_CLASSES = {
        positive: 'outcome-positive',
        neutral: 'outcome-neutral',
        negative: 'outcome-negative',
        no_response: 'outcome-no-response',
        follow_up_needed: 'outcome-follow-up',
    };

    PP.loadContacts = async function (permId) {
        try {
            const res = await Auth.authedFetch('/api/permissions/' + permId + '/contacts');
            if (!res.ok) throw new Error('Failed to load contacts');
            const json = await res.json();
            PP.currentContacts = json.data || [];
            renderContactTimeline(PP.currentContacts);
        } catch (err) {
            console.error('Error loading contacts:', err);
            PP.els.contactTimeline.innerHTML = '<p class="contact-empty">' + PP.escapeHtml(_t('permissions.contacts.loadError')) + '</p>';
        }
    };

    function renderContactTimeline(contacts) {
        if (!contacts || contacts.length === 0) {
            PP.els.contactTimeline.innerHTML = '<p class="contact-empty">' + _t('permissions.contacts.empty') + '</p>';
            return;
        }

        const esc = PP.escapeHtml;
        let html = '';
        contacts.forEach(function (c) {
            const icon = CONTACT_TYPE_ICONS[c.contact_type] || '\uD83D\uDCCC';
            const typeLabel = _t('contact_type.' + c.contact_type) || c.contact_type;
            let outcomeHtml = '';
            if (c.outcome) {
                const outcomeClass = OUTCOME_CLASSES[c.outcome] || '';
                const outcomeLabel = _t('outcome.' + c.outcome) || c.outcome;
                outcomeHtml = '<span class="contact-outcome-badge ' + outcomeClass + '">' + esc(outcomeLabel) + '</span>';
            }
            const dateStr = c.contact_date ? new Date(c.contact_date).toLocaleDateString() : '';

            html += '<div class="contact-item" data-contact-id="' + c.id + '">' +
                '<div class="contact-item-icon">' + icon + '</div>' +
                '<div class="contact-item-body">' +
                '<div class="contact-item-header">' +
                '<span class="contact-type-label">' + esc(typeLabel) + '</span>' +
                outcomeHtml +
                '<span class="contact-date">' + esc(dateStr) + '</span>' +
                '<button type="button" class="contact-delete-btn" data-cid="' + c.id + '" title="' + esc(_t('permissions.contacts.delete')) + '">&times;</button>' +
                '</div>' +
                (c.notes ? '<p class="contact-notes">' + esc(c.notes) + '</p>' : '') +
                '</div>' +
                '</div>';
        });

        PP.els.contactTimeline.innerHTML = html;

        PP.els.contactTimeline.querySelectorAll('.contact-delete-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                handleContactDelete(btn.dataset.cid);
            });
        });
    }

    PP.showContactForm = function () {
        const today = new Date().toISOString().split('T')[0];
        PP.els.contactType.value = 'phone_call';
        PP.els.contactOutcome.value = '';
        PP.els.contactDate.value = today;
        PP.els.contactNotes.value = '';
        PP.els.contactForm.classList.remove('hidden');
        PP.els.btnAddContact.classList.add('hidden');
    };

    PP.hideContactForm = function () {
        if (PP.els.contactForm) PP.els.contactForm.classList.add('hidden');
        if (PP.els.btnAddContact) PP.els.btnAddContact.classList.remove('hidden');
    };

    PP.handleContactSubmit = async function () {
        if (!PP.editingPermId) return;
        const body = {
            contact_type: PP.els.contactType.value,
            outcome: PP.els.contactOutcome.value || undefined,
            notes: PP.els.contactNotes.value.trim() || undefined,
            contact_date: PP.els.contactDate.value || undefined,
        };

        try {
            PP.els.btnSaveContact.disabled = true;
            const res = await Auth.authedFetch('/api/permissions/' + PP.editingPermId + '/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const errData = await res.json().catch(function () { return {}; });
                throw new Error(errData.error || 'Failed to save contact');
            }
            PP.hideContactForm();
            await PP.loadContacts(PP.editingPermId);

            if (body.outcome === 'follow_up_needed') {
                promptFollowUpReminder();
            }
        } catch (err) {
            console.error('Error saving contact:', err);
            Auth.showToast('Something went wrong. Please try again.');
        } finally {
            PP.els.btnSaveContact.disabled = false;
        }
    };

    async function promptFollowUpReminder() {
        if (!PP.editingPermId) return;
        if (!confirm(_t('reminders.setReminder') + '?')) return;

        const perm = PP.allPermissions.find(function (p) { return p.id === PP.editingPermId; });
        const defaultTitle = 'Follow up: ' + (perm ? (perm.agency_owner || '') : '');
        const title = prompt(_t('reminders.setReminder'), defaultTitle);
        if (!title) return;

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7);
        const dueDateStr = dueDate.toISOString().split('T')[0];

        try {
            const res = await Auth.authedFetch('/api/reminders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    permission_id: PP.editingPermId,
                    reminder_type: 'follow_up',
                    title: title,
                    due_date: dueDateStr,
                }),
            });
            if (res.ok) Auth.showToast(_t('reminders.setReminder') + ' \u2705');
        } catch (err) {
            console.error('Error creating reminder:', err);
            Auth.showToast('Something went wrong. Please try again.');
        }
    }

    async function handleContactDelete(cid) {
        if (!PP.editingPermId || !cid) return;
        if (!confirm(_t('permissions.contacts.deleteConfirm'))) return;

        try {
            const res = await Auth.authedFetch('/api/permissions/' + PP.editingPermId + '/contacts/' + cid, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete contact');
            await PP.loadContacts(PP.editingPermId);
        } catch (err) {
            console.error('Error deleting contact:', err);
            Auth.showToast('Something went wrong. Please try again.');
        }
    }

})(window.PP = window.PP || {});
