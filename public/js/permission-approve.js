/**
 * Permission Approve page — public (no auth required).
 * Loads permission details via token, allows landowner to approve or deny.
 */
(function () {
    'use strict';

    var token = null;
    var permissionData = null;
    var signaturePad = null;

    /* ------------------------------------------------------------------ */
    /*  DOM References                                                     */
    /* ------------------------------------------------------------------ */
    var els = {};
    function cacheElements() {
        els.loadingState = document.getElementById('loading-state');
        els.errorState = document.getElementById('error-state');
        els.errorTitle = document.getElementById('error-title');
        els.errorMessage = document.getElementById('error-message');
        els.doneState = document.getElementById('done-state');
        els.doneIcon = document.getElementById('done-icon');
        els.doneTitle = document.getElementById('done-title');
        els.doneMessage = document.getElementById('done-message');
        els.formState = document.getElementById('approval-form-state');
        els.requesterName = document.getElementById('requester-name');
        els.detailAgency = document.getElementById('detail-agency');
        els.detailSiteRow = document.getElementById('detail-site-row');
        els.detailSite = document.getElementById('detail-site');
        els.detailDescRow = document.getElementById('detail-desc-row');
        els.detailDescription = document.getElementById('detail-description');
        els.detailNotesRow = document.getElementById('detail-notes-row');
        els.detailNotes = document.getElementById('detail-notes');
        els.mapContainer = document.getElementById('approval-map-container');
        els.conditionsSection = document.getElementById('conditions-section');
        els.conditionsText = document.getElementById('conditions-text');
        els.signedName = document.getElementById('signed-name');
        els.signatureCanvas = document.getElementById('signature-canvas');
        els.btnClearSignature = document.getElementById('btn-clear-signature');
        els.landownerConditions = document.getElementById('landowner-conditions');
        els.btnApprove = document.getElementById('btn-approve');
        els.btnDeny = document.getElementById('btn-deny');
        els.denySection = document.getElementById('deny-section');
        els.denyReason = document.getElementById('deny-reason');
        els.btnConfirmDeny = document.getElementById('btn-confirm-deny');
        els.btnCancelDeny = document.getElementById('btn-cancel-deny');
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', function () {
        cacheElements();

        // Parse token from URL
        var params = new URLSearchParams(window.location.search);
        token = params.get('token');

        if (!token) {
            showError('Invalid Link', 'No permission token was provided.');
            return;
        }

        // Initialize signature pad
        if (window.SignaturePad && els.signatureCanvas) {
            signaturePad = new SignaturePad(els.signatureCanvas, {
                backgroundColor: 'rgb(255, 255, 255)',
                penColor: 'rgb(0, 0, 0)',
            });
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);
        }

        bindEvents();
        loadPermissionDetails();
    });

    function resizeCanvas() {
        if (!els.signatureCanvas || !signaturePad) return;
        var ratio = Math.max(window.devicePixelRatio || 1, 1);
        var wrapper = els.signatureCanvas.parentElement;
        els.signatureCanvas.width = wrapper.offsetWidth * ratio;
        els.signatureCanvas.height = 150 * ratio;
        els.signatureCanvas.style.width = wrapper.offsetWidth + 'px';
        els.signatureCanvas.style.height = '150px';
        els.signatureCanvas.getContext('2d').scale(ratio, ratio);
        signaturePad.clear();
    }

    /* ------------------------------------------------------------------ */
    /*  Events                                                             */
    /* ------------------------------------------------------------------ */
    function bindEvents() {
        if (els.btnClearSignature) {
            els.btnClearSignature.addEventListener('click', function () {
                if (signaturePad) signaturePad.clear();
            });
        }

        if (els.btnApprove) {
            els.btnApprove.addEventListener('click', handleApprove);
        }

        if (els.btnDeny) {
            els.btnDeny.addEventListener('click', function () {
                els.denySection.classList.remove('hidden');
                els.btnApprove.classList.add('hidden');
                els.btnDeny.classList.add('hidden');
            });
        }

        if (els.btnCancelDeny) {
            els.btnCancelDeny.addEventListener('click', function () {
                els.denySection.classList.add('hidden');
                els.btnApprove.classList.remove('hidden');
                els.btnDeny.classList.remove('hidden');
            });
        }

        if (els.btnConfirmDeny) {
            els.btnConfirmDeny.addEventListener('click', handleDeny);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Load Permission Details                                            */
    /* ------------------------------------------------------------------ */
    async function loadPermissionDetails() {
        try {
            var res = await fetch('/api/p/' + token);
            var data = await res.json();

            if (!res.ok) {
                showError('Link Unavailable', data.error || 'This permission link is no longer valid.');
                return;
            }

            permissionData = data.data;
            renderPermissionDetails(permissionData);
        } catch (err) {
            console.error('Error loading permission:', err);
            showError('Connection Error', 'Unable to load permission details. Please try again.');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Render                                                             */
    /* ------------------------------------------------------------------ */
    function renderPermissionDetails(data) {
        els.loadingState.classList.add('hidden');
        els.formState.classList.remove('hidden');

        els.requesterName.textContent = data.requester_name || 'Someone';
        els.detailAgency.textContent = data.permission.agency_or_owner || 'Not specified';

        if (data.permission.site_name) {
            els.detailSiteRow.classList.remove('hidden');
            els.detailSite.textContent = data.permission.site_name;
        }

        if (data.permission.site_description) {
            els.detailDescRow.classList.remove('hidden');
            els.detailDescription.textContent = data.permission.site_description;
        }

        if (data.permission.notes) {
            els.detailNotesRow.classList.remove('hidden');
            els.detailNotes.textContent = data.permission.notes;
        }

        // Show conditions if set by requester
        if (data.conditions_text) {
            els.conditionsSection.classList.remove('hidden');
            els.conditionsText.textContent = data.conditions_text;
        }

        // Show map if coordinates available
        if (data.permission.site_latitude && data.permission.site_longitude) {
            els.mapContainer.classList.remove('hidden');
            setTimeout(function () {
                var map = L.map('approval-map').setView(
                    [data.permission.site_latitude, data.permission.site_longitude], 14
                );
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '&copy; OpenStreetMap'
                }).addTo(map);
                L.marker([data.permission.site_latitude, data.permission.site_longitude]).addTo(map);
            }, 100);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Approve                                                            */
    /* ------------------------------------------------------------------ */
    async function handleApprove() {
        var signedName = els.signedName.value.trim();
        if (!signedName) {
            els.signedName.focus();
            els.signedName.classList.add('input-error');
            return;
        }
        els.signedName.classList.remove('input-error');

        var body = { signed_name: signedName };

        // Add signature image if drawn
        if (signaturePad && !signaturePad.isEmpty()) {
            body.signature_image = signaturePad.toDataURL('image/png');
        }

        // Add landowner conditions if provided
        var conditions = els.landownerConditions.value.trim();
        if (conditions) {
            body.conditions_text = conditions;
        }

        els.btnApprove.disabled = true;
        els.btnApprove.textContent = 'Processing...';

        try {
            var res = await fetch('/api/p/' + token + '/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            var data = await res.json();

            if (!res.ok) {
                showError('Error', data.error || 'Failed to process approval.');
                return;
            }

            showDone('\u2705', 'Permission Approved', 'Thank you! The requester has been notified of your approval.');
        } catch (err) {
            console.error('Error approving:', err);
            showError('Error', 'Failed to submit your response. Please try again.');
        } finally {
            els.btnApprove.disabled = false;
            els.btnApprove.textContent = 'Approve Permission';
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Deny                                                               */
    /* ------------------------------------------------------------------ */
    async function handleDeny() {
        var body = {};
        var reason = els.denyReason.value.trim();
        if (reason) body.reason = reason;

        els.btnConfirmDeny.disabled = true;
        els.btnConfirmDeny.textContent = 'Processing...';

        try {
            var res = await fetch('/api/p/' + token + '/deny', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            var data = await res.json();

            if (!res.ok) {
                showError('Error', data.error || 'Failed to process denial.');
                return;
            }

            showDone('\u274C', 'Request Denied', 'The requester has been notified that their request was denied.');
        } catch (err) {
            console.error('Error denying:', err);
            showError('Error', 'Failed to submit your response. Please try again.');
        } finally {
            els.btnConfirmDeny.disabled = false;
            els.btnConfirmDeny.textContent = 'Confirm Denial';
        }
    }

    /* ------------------------------------------------------------------ */
    /*  State Helpers                                                       */
    /* ------------------------------------------------------------------ */
    function showError(title, message) {
        els.loadingState.classList.add('hidden');
        els.formState.classList.add('hidden');
        els.doneState.classList.add('hidden');
        els.errorState.classList.remove('hidden');
        els.errorTitle.textContent = title;
        els.errorMessage.textContent = message;
    }

    function showDone(icon, title, message) {
        els.loadingState.classList.add('hidden');
        els.formState.classList.add('hidden');
        els.errorState.classList.add('hidden');
        els.doneState.classList.remove('hidden');
        els.doneIcon.textContent = icon;
        els.doneTitle.textContent = title;
        els.doneMessage.textContent = message;
    }
})();
