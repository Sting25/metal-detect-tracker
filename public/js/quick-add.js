/**
 * Quick Add Site — mobile-optimized overlay for rapid site entry while scouting.
 * Accessible from any page via FAB or dedicated button.
 * Reuses existing POST /api/sites endpoint.
 */
window.QuickAddSite = (function () {
    'use strict';

    const _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    let overlay = null;
    let form = null;
    let gpsLat = null;
    let gpsLng = null;
    let gpsWatchId = null;

    // DOM refs (set during createOverlay)
    const els = {};

    function createOverlay() {
        overlay = document.createElement('div');
        overlay.className = 'quick-add-overlay';
        overlay.id = 'quick-add-overlay';
        overlay.innerHTML =
            '<div class="quick-add-container">' +
                '<div class="quick-add-header">' +
                    '<h2 class="quick-add-title">&#128247; Quick Add Site</h2>' +
                    '<button class="quick-add-close" id="quick-add-close" type="button">&times;</button>' +
                '</div>' +
                '<form id="quick-add-form" class="quick-add-form">' +
                    '<div class="quick-add-photo-section">' +
                        '<div class="quick-add-photo-area" id="quick-add-photo-area">' +
                            '<img id="quick-add-preview" class="quick-add-preview hidden" alt="Preview">' +
                            '<div class="quick-add-photo-placeholder" id="quick-add-photo-placeholder">' +
                                '<span class="quick-add-camera-icon">&#128247;</span>' +
                                '<p>Tap to take a photo</p>' +
                            '</div>' +
                            '<input type="file" id="quick-add-image" accept="image/*" capture="environment" class="upload-input">' +
                        '</div>' +
                    '</div>' +
                    '<div class="quick-add-gps" id="quick-add-gps">' +
                        '<span class="quick-add-gps-icon" id="quick-add-gps-icon">&#128205;</span>' +
                        '<span class="quick-add-gps-text" id="quick-add-gps-text">Getting location...</span>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label for="quick-add-name">Site Name *</label>' +
                        '<input type="text" id="quick-add-name" class="form-control" placeholder="e.g. Old homestead off Hwy 36" required>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label for="quick-add-notes">Quick Notes</label>' +
                        '<textarea id="quick-add-notes" class="form-control" rows="3" placeholder="What caught your eye? Stone foundation, tree cluster, old road..."></textarea>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label for="quick-add-tags">Tags</label>' +
                        '<input type="text" id="quick-add-tags" class="form-control" placeholder="homestead, foundation, creek (comma-separated)">' +
                    '</div>' +
                    '<button type="submit" class="btn btn-primary quick-add-submit" id="quick-add-submit">Save Site</button>' +
                '</form>' +
                '<div class="quick-add-success hidden" id="quick-add-success">' +
                    '<span class="quick-add-success-icon">&#9989;</span>' +
                    '<p class="quick-add-success-text">Site saved! You can add more details later.</p>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        // Cache elements
        els.closeBtn = document.getElementById('quick-add-close');
        els.form = document.getElementById('quick-add-form');
        els.photoArea = document.getElementById('quick-add-photo-area');
        els.photoInput = document.getElementById('quick-add-image');
        els.photoPreview = document.getElementById('quick-add-preview');
        els.photoPlaceholder = document.getElementById('quick-add-photo-placeholder');
        els.gpsBar = document.getElementById('quick-add-gps');
        els.gpsIcon = document.getElementById('quick-add-gps-icon');
        els.gpsText = document.getElementById('quick-add-gps-text');
        els.name = document.getElementById('quick-add-name');
        els.notes = document.getElementById('quick-add-notes');
        els.tags = document.getElementById('quick-add-tags');
        els.submitBtn = document.getElementById('quick-add-submit');
        els.success = document.getElementById('quick-add-success');

        // Bind events
        els.closeBtn.addEventListener('click', close);
        els.photoArea.addEventListener('click', function () {
            els.photoInput.click();
        });
        els.photoInput.addEventListener('change', function () {
            if (els.photoInput.files.length > 0) {
                previewPhoto(els.photoInput.files[0]);
            }
        });
        els.form.addEventListener('submit', handleSubmit);
    }

    function previewPhoto(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            els.photoPreview.src = e.target.result;
            els.photoPreview.classList.remove('hidden');
            els.photoPlaceholder.classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }

    function startGPS() {
        gpsLat = null;
        gpsLng = null;
        els.gpsBar.className = 'quick-add-gps gps-searching';
        els.gpsIcon.innerHTML = '&#128205;';
        els.gpsText.textContent = _t('quickAdd.gettingLocation');

        if (!navigator.geolocation) {
            els.gpsBar.classList.add('gps-error');
            els.gpsText.textContent = _t('quickAdd.locationUnavailable');
            return;
        }

        // Get initial position
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                gpsLat = pos.coords.latitude;
                gpsLng = pos.coords.longitude;
                updateGPSDisplay();
            },
            function () {
                els.gpsBar.classList.add('gps-error');
                els.gpsText.textContent = _t('quickAdd.locationUnavailable');
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );

        // Watch for updates
        gpsWatchId = navigator.geolocation.watchPosition(
            function (pos) {
                gpsLat = pos.coords.latitude;
                gpsLng = pos.coords.longitude;
                updateGPSDisplay();
            },
            function () {},
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );
    }

    function stopGPS() {
        if (gpsWatchId !== null) {
            navigator.geolocation.clearWatch(gpsWatchId);
            gpsWatchId = null;
        }
    }

    function updateGPSDisplay() {
        els.gpsBar.className = 'quick-add-gps gps-found';
        els.gpsIcon.innerHTML = '&#9989;';
        els.gpsText.textContent = gpsLat.toFixed(5) + ', ' + gpsLng.toFixed(5);
    }

    async function handleSubmit(e) {
        e.preventDefault();

        const name = els.name.value.trim();
        if (!name) {
            Auth.showToast(_t('quickAdd.enterName'), 'warning');
            return;
        }

        if (gpsLat === null || gpsLng === null) {
            Auth.showToast(_t('quickAdd.waitingGps'), 'warning');
            return;
        }

        const formData = new FormData();
        formData.append('name', name);
        formData.append('latitude', gpsLat);
        formData.append('longitude', gpsLng);
        formData.append('notes', els.notes.value.trim());
        formData.append('tags', els.tags.value.trim());
        formData.append('status', 'identified');
        formData.append('land_type', 'unknown');
        formData.append('permission_status', 'not_requested');
        formData.append('priority', '3');

        if (els.photoInput.files.length > 0) {
            formData.append('image', els.photoInput.files[0]);
        }

        try {
            els.submitBtn.disabled = true;
            els.submitBtn.textContent = _t('quickAdd.saving');

            const res = await Auth.authedFetch('/api/sites', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const errData = await res.json().catch(function () { return {}; });
                throw new Error(errData.error || 'Failed to save site');
            }

            // Show success
            els.form.classList.add('hidden');
            els.success.classList.remove('hidden');

            // Auto-close after 1.5 seconds
            setTimeout(function () {
                close();
            }, 1500);

        } catch (err) {
            console.error('Quick add error:', err);
            Auth.showToast(_t('quickAdd.errorSaving'));
        } finally {
            els.submitBtn.disabled = false;
            els.submitBtn.textContent = _t('quickAdd.save');
        }
    }

    function resetForm() {
        if (!els.form) return;
        els.form.reset();
        els.form.classList.remove('hidden');
        els.success.classList.add('hidden');
        els.photoPreview.classList.add('hidden');
        els.photoPlaceholder.classList.remove('hidden');
        els.submitBtn.disabled = false;
        els.submitBtn.textContent = _t('quickAdd.save');
    }

    function open() {
        if (!overlay) createOverlay();
        resetForm();
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        startGPS();
        // Focus name input after a short delay (for transition)
        setTimeout(function () {
            els.name.focus();
        }, 200);
    }

    function close() {
        if (!overlay) return;
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        stopGPS();
    }

    return {
        open: open,
        close: close
    };
})();
