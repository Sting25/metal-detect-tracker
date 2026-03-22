/**
 * Print Permission Letter — full letter builder with saved preferences.
 *
 * Loads user letter preferences from API, permission record data, and site
 * details to pre-fill a customizable permission request letter.
 *
 * URL params: ?permId=123&siteId=456 (both optional)
 */
(function () {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function (k) { return k; };

    /* ------------------------------------------------------------------ */
    /*  Default generic letter text                                        */
    /* ------------------------------------------------------------------ */
    var DEFAULTS = {
        intro: 'My name is {name}, and I am a hobby metal detectorist in the area. I am writing to respectfully request your permission to use a metal detector on your property located at {location}.',
        commitments: [
            'I will fill all holes and restore the ground to its original condition.',
            'I will remove any trash or debris I encounter.',
            'I will show you all items found and return anything of personal or historical significance.',
            'I will carry out all my own refuse and leave the area cleaner than I found it.',
            'I will respect any boundaries or restrictions you set.',
            'I will carry proof of your permission at all times while on the property.',
            'I will coordinate detection times with you in advance.'
        ].join('\n'),
        insurance: 'I carry liability insurance for my metal detecting activities and can provide proof upon request. I am happy to meet in person to discuss the details and answer any questions you may have.',
        closing: 'If you are willing to grant permission, I would appreciate a written or verbal acknowledgment at your convenience. You can reach me at the contact information listed above.\n\nThank you for considering my request. I look forward to hearing from you.'
    };

    /* ------------------------------------------------------------------ */
    /*  State                                                              */
    /* ------------------------------------------------------------------ */
    var letterPrefs = null;  // from API
    var permRecord = null;   // permission record (if permId)
    var siteData = null;     // site data (if siteId)
    var userData = null;     // from Auth.getUser()
    var locationDesc = '';   // computed location string

    /* ------------------------------------------------------------------ */
    /*  DOM references                                                     */
    /* ------------------------------------------------------------------ */
    var prefEls = {};
    function cachePrefElements() {
        prefEls.fullName = document.getElementById('pref-full-name');
        prefEls.address = document.getElementById('pref-address');
        prefEls.phone = document.getElementById('pref-phone');
        prefEls.email = document.getElementById('pref-email');
        prefEls.sigName = document.getElementById('pref-sig-name');
        prefEls.sigTitle = document.getElementById('pref-sig-title');
        prefEls.toName = document.getElementById('pref-to-name');
        prefEls.toAddress = document.getElementById('pref-to-address');
        prefEls.intro = document.getElementById('pref-intro');
        prefEls.commitments = document.getElementById('pref-commitments');
        prefEls.insurance = document.getElementById('pref-insurance');
        prefEls.closing = document.getElementById('pref-closing');
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', function () {
        Auth.requireAuth().then(function () {
            cachePrefElements();
            bindEvents();
            loadAllData();
        });
    });

    function bindEvents() {
        // Settings panel toggle
        var toggle = document.getElementById('settings-toggle');
        var body = document.getElementById('settings-body');
        var chevron = document.getElementById('settings-chevron');
        if (toggle) {
            toggle.addEventListener('click', function () {
                var isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : '';
                chevron.textContent = isOpen ? '\u25B6' : '\u25BC';
            });
        }

        // Buttons
        document.getElementById('btn-save-prefs').addEventListener('click', savePreferences);
        document.getElementById('btn-reset-defaults').addEventListener('click', resetToDefaults);
        document.getElementById('btn-apply-letter').addEventListener('click', applyToLetter);
    }

    /* ------------------------------------------------------------------ */
    /*  Data loading                                                       */
    /* ------------------------------------------------------------------ */
    async function loadAllData() {
        var params = new URLSearchParams(window.location.search);
        var permId = params.get('permId');
        var siteId = params.get('siteId');

        userData = Auth.getUser();

        // Set date
        var today = new Date();
        var dateStr = today.toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
        document.getElementById('letter-date').textContent = dateStr;
        document.getElementById('sig-date').textContent = dateStr;

        // Parallel fetches
        var promises = [
            Auth.authedFetch('/api/letter-preferences').then(function (r) { return r.json(); })
        ];

        if (permId) {
            promises.push(
                Auth.authedFetch('/api/permissions/' + permId).then(function (r) { return r.json(); })
            );
        } else {
            promises.push(Promise.resolve(null));
        }

        if (siteId) {
            promises.push(
                Auth.authedFetch('/api/sites/' + siteId).then(function (r) { return r.json(); })
            );
        } else {
            promises.push(Promise.resolve(null));
        }

        try {
            var results = await Promise.all(promises);

            // Letter preferences
            if (results[0] && results[0].success) {
                letterPrefs = results[0].data;
            }

            // Permission record
            if (results[1] && results[1].success) {
                permRecord = results[1].data;
                // If permission has a site_id but we didn't have siteId, fetch the site
                if (!siteId && permRecord && permRecord.site_id) {
                    try {
                        var siteRes = await Auth.authedFetch('/api/sites/' + permRecord.site_id);
                        var siteJson = await siteRes.json();
                        if (siteJson.success) siteData = siteJson.data;
                    } catch (e) { /* ignore */ }
                }
            }

            // Site data
            if (results[2] && results[2].success) {
                siteData = results[2].data;
            }

            // Compute location description
            locationDesc = buildLocationDesc();

            // Set page title
            if (siteData && siteData.name) {
                document.title = 'Permission Letter - ' + siteData.name;
            }

            // Populate settings panel
            populateSettingsPanel();

            // Apply to letter
            applyToLetter();

        } catch (err) {
            console.error('Error loading letter data:', err);
            // Still try to populate with whatever we have
            populateSettingsPanel();
            applyToLetter();
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Build location description                                         */
    /* ------------------------------------------------------------------ */
    function buildLocationDesc() {
        if (!siteData) return '';
        var desc = siteData.name || '';
        if (siteData.latitude && siteData.longitude) {
            desc += ' (approximately ' + parseFloat(siteData.latitude).toFixed(4) + ', ' + parseFloat(siteData.longitude).toFixed(4) + ')';
        }
        if (siteData.description) {
            desc += ' \u2014 ' + siteData.description;
        }
        return desc;
    }

    /* ------------------------------------------------------------------ */
    /*  Populate settings panel from preferences + data                    */
    /* ------------------------------------------------------------------ */
    function populateSettingsPanel() {
        var prefs = letterPrefs || {};

        // Your information (prefs > user profile > empty)
        prefEls.fullName.value = prefs.full_name || (userData && userData.display_name) || '';
        prefEls.address.value = prefs.address || '';
        prefEls.phone.value = prefs.phone || (userData && userData.phone) || '';
        prefEls.email.value = prefs.email || (userData && userData.email) || '';
        prefEls.sigName.value = prefs.signature_name || prefs.full_name || (userData && userData.display_name) || '';
        prefEls.sigTitle.value = prefs.signature_title || '';

        // Recipient (permission record > site > empty)
        var toName = '';
        var toAddr = '';
        if (permRecord) {
            toName = permRecord.contact_name || permRecord.agency_owner || '';
            toAddr = permRecord.contact_address || '';
        }
        if (!toName && siteData) {
            toName = siteData.contact_name || siteData.permission_contact_name || '';
        }
        prefEls.toName.value = toName;
        prefEls.toAddress.value = toAddr;

        // Letter body (prefs > defaults)
        prefEls.intro.value = prefs.intro_text || DEFAULTS.intro;
        prefEls.commitments.value = prefs.commitments_html || DEFAULTS.commitments;
        prefEls.insurance.value = prefs.insurance_text || DEFAULTS.insurance;
        prefEls.closing.value = prefs.closing_text || DEFAULTS.closing;
    }

    /* ------------------------------------------------------------------ */
    /*  Apply settings panel values to the letter                          */
    /* ------------------------------------------------------------------ */
    function applyToLetter() {
        var name = prefEls.fullName.value || (userData && userData.display_name) || '[Your Name]';
        var address = prefEls.address.value || '[Your Address]';
        var phone = prefEls.phone.value || '';
        var email = prefEls.email.value || '';
        var contactLine = [phone, email].filter(Boolean).join(' / ') || '[Your Phone / Email]';
        var toName = prefEls.toName.value || '[Property Owner / Agency Name]';
        var toAddr = prefEls.toAddress.value || '[Property Owner Address]';

        // From section
        document.getElementById('from-name').textContent = name;
        document.getElementById('from-address').textContent = address;
        document.getElementById('from-contact').textContent = contactLine;

        // To section
        document.getElementById('to-name').textContent = toName;
        document.getElementById('to-address').textContent = toAddr;

        // Greeting
        var greetingName = toName !== '[Property Owner / Agency Name]' ? toName : '[Property Owner]';
        document.getElementById('owner-greeting').textContent = greetingName;

        // Intro paragraph — substitute {name} and {location}
        var introText = prefEls.intro.value || DEFAULTS.intro;
        var loc = locationDesc || '[property location / description]';
        introText = introText.replace(/\{name\}/g, name).replace(/\{location\}/g, loc);
        document.getElementById('letter-intro').innerHTML = '<p>' + Auth.escapeHtml(introText) + '</p>';

        // Commitments — one per line → <ul><li>
        var commitText = prefEls.commitments.value || DEFAULTS.commitments;
        var commitLines = commitText.split('\n').filter(function (l) { return l.trim(); });
        var commitHtml = '<ul>';
        commitLines.forEach(function (line) {
            commitHtml += '<li>' + Auth.escapeHtml(line.trim()) + '</li>';
        });
        commitHtml += '</ul>';
        document.getElementById('letter-commitments').innerHTML = commitHtml;

        // Insurance
        var insuranceText = prefEls.insurance.value || DEFAULTS.insurance;
        document.getElementById('letter-insurance').innerHTML = '<p>' + Auth.escapeHtml(insuranceText) + '</p>';

        // Closing — support multi-paragraph via double newline
        var closingText = prefEls.closing.value || DEFAULTS.closing;
        var closingParagraphs = closingText.split(/\n\n+/).filter(function (p) { return p.trim(); });
        var closingHtml = closingParagraphs.map(function (p) {
            return '<p>' + Auth.escapeHtml(p.trim()) + '</p>';
        }).join('');
        document.getElementById('letter-closing').innerHTML = closingHtml;

        // Signature
        var sigName = prefEls.sigName.value || prefEls.fullName.value || (userData && userData.display_name) || '[Your Name]';
        document.getElementById('sig-name').textContent = sigName;

        var sigTitleEl = document.getElementById('sig-title');
        var sigTitleVal = prefEls.sigTitle.value || '';
        if (sigTitleVal) {
            sigTitleEl.textContent = sigTitleVal;
            sigTitleEl.style.display = '';
        } else {
            sigTitleEl.style.display = 'none';
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Save preferences to API                                            */
    /* ------------------------------------------------------------------ */
    async function savePreferences() {
        var btn = document.getElementById('btn-save-prefs');
        btn.disabled = true;
        btn.textContent = _t('common.saving') || 'Saving...';

        try {
            var body = {
                full_name: prefEls.fullName.value || null,
                address: prefEls.address.value || null,
                phone: prefEls.phone.value || null,
                email: prefEls.email.value || null,
                signature_name: prefEls.sigName.value || null,
                signature_title: prefEls.sigTitle.value || null,
                intro_text: prefEls.intro.value || null,
                commitments_html: prefEls.commitments.value || null,
                closing_text: prefEls.closing.value || null,
                insurance_text: prefEls.insurance.value || null
            };

            var res = await Auth.authedFetch('/api/letter-preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) throw new Error('Failed to save');
            var json = await res.json();
            if (json.success) {
                letterPrefs = json.data;
                showToast(_t('letterPrefs.saved'));
            }
        } catch (err) {
            console.error('Error saving letter preferences:', err);
            Auth.showToast(_t('letterPrefs.errorSaving') || 'Failed to save preferences.');
        } finally {
            btn.disabled = false;
            btn.textContent = _t('letterPrefs.saveDefaults');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Reset to generic defaults                                          */
    /* ------------------------------------------------------------------ */
    function resetToDefaults() {
        prefEls.intro.value = DEFAULTS.intro;
        prefEls.commitments.value = DEFAULTS.commitments;
        prefEls.insurance.value = DEFAULTS.insurance;
        prefEls.closing.value = DEFAULTS.closing;
        applyToLetter();
        showToast(_t('letterPrefs.resetDone'));
    }

    /* ------------------------------------------------------------------ */
    /*  Toast notification                                                 */
    /* ------------------------------------------------------------------ */
    function showToast(msg) {
        var existing = document.querySelector('.letter-toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.className = 'letter-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(function () { toast.classList.add('show'); }, 10);
        setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () { toast.remove(); }, 300);
        }, 2500);
    }

})();
