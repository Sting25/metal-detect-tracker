/**
 * Finds page — multi-photo gallery, lightbox, and quick log.
 * Adds functions to the shared window.FP namespace created by finds.js.
 */
(function (FP) {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    /* ------------------------------------------------------------------ */
    /*  Multi-Photo Gallery                                               */
    /* ------------------------------------------------------------------ */
    FP.addNewPhotoFiles = function (fileList) {
        var totalCount = FP.currentPhotos.length + FP.newPhotoFiles.length;
        for (var i = 0; i < fileList.length; i++) {
            if (totalCount + i >= 10) {
                Auth.showToast(_t('finds.photo.maxReached'), 'warning');
                break;
            }
            FP.newPhotoFiles.push(fileList[i]);
        }
        FP.renderPhotoGallery();
    };

    FP.renderPhotoGallery = function () {
        var esc = FP.escapeHtml;
        var html = '';

        // Existing server photos
        for (var i = 0; i < FP.currentPhotos.length; i++) {
            var p = FP.currentPhotos[i];
            html += '<div class="photo-gallery-item" data-index="' + i + '" data-type="server" data-photo-id="' + p.id + '">' +
                '<img src="' + esc(Auth.secureUrl(p.photo_url)) + '" alt="Photo" class="photo-gallery-thumb">' +
                '<div class="photo-gallery-actions">' +
                (i > 0 ? '<button type="button" class="photo-action-btn photo-move-up" title="' + _t('finds.photo.moveUp') + '">&#9650;</button>' : '') +
                (i < FP.currentPhotos.length - 1 ? '<button type="button" class="photo-action-btn photo-move-down" title="' + _t('finds.photo.moveDown') + '">&#9660;</button>' : '') +
                '<button type="button" class="photo-action-btn photo-delete-btn" title="' + _t('finds.photo.delete') + '">&times;</button>' +
                '</div>' +
                '</div>';
        }

        // New pending photos (previews)
        for (var j = 0; j < FP.newPhotoFiles.length; j++) {
            var idx = FP.currentPhotos.length + j;
            html += '<div class="photo-gallery-item photo-gallery-item--pending" data-index="' + idx + '" data-type="new" data-new-index="' + j + '">' +
                '<img src="" alt="New photo" class="photo-gallery-thumb photo-preview-thumb" data-file-index="' + j + '">' +
                '<div class="photo-gallery-actions">' +
                '<button type="button" class="photo-action-btn photo-delete-btn" title="' + _t('finds.photo.delete') + '">&times;</button>' +
                '</div>' +
                '</div>';
        }

        FP.els.photoGallery.innerHTML = html;

        // Generate previews for new files
        FP.els.photoGallery.querySelectorAll('.photo-preview-thumb').forEach(function (img) {
            var fileIdx = parseInt(img.dataset.fileIndex, 10);
            var file = FP.newPhotoFiles[fileIdx];
            if (file) {
                var reader = new FileReader();
                reader.onload = function (e) { img.src = e.target.result; };
                reader.readAsDataURL(file);
            }
        });

        // Click on thumbnails opens lightbox
        FP.els.photoGallery.querySelectorAll('.photo-gallery-thumb').forEach(function (img) {
            img.addEventListener('click', function (e) {
                e.stopPropagation();
                var item = img.closest('.photo-gallery-item');
                FP.openLightbox(parseInt(item.dataset.index, 10));
            });
        });

        // Delete buttons
        FP.els.photoGallery.querySelectorAll('.photo-delete-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var item = btn.closest('.photo-gallery-item');
                if (item.dataset.type === 'server') {
                    FP.handlePhotoDelete(parseInt(item.dataset.photoId, 10));
                } else {
                    FP.newPhotoFiles.splice(parseInt(item.dataset.newIndex, 10), 1);
                    FP.renderPhotoGallery();
                }
            });
        });

        // Reorder buttons
        FP.els.photoGallery.querySelectorAll('.photo-move-up').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var idx = parseInt(btn.closest('.photo-gallery-item').dataset.index, 10);
                if (idx > 0) {
                    var temp = FP.currentPhotos[idx];
                    FP.currentPhotos[idx] = FP.currentPhotos[idx - 1];
                    FP.currentPhotos[idx - 1] = temp;
                    FP.renderPhotoGallery();
                }
            });
        });

        FP.els.photoGallery.querySelectorAll('.photo-move-down').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var idx = parseInt(btn.closest('.photo-gallery-item').dataset.index, 10);
                if (idx < FP.currentPhotos.length - 1) {
                    var temp = FP.currentPhotos[idx];
                    FP.currentPhotos[idx] = FP.currentPhotos[idx + 1];
                    FP.currentPhotos[idx + 1] = temp;
                    FP.renderPhotoGallery();
                }
            });
        });

        // Show/hide upload area based on total count
        if (FP.currentPhotos.length + FP.newPhotoFiles.length >= 10) {
            FP.els.uploadArea.classList.add('hidden');
        } else {
            FP.els.uploadArea.classList.remove('hidden');
        }
    };

    FP.handlePhotoDelete = async function (photoId) {
        if (!FP.editingFindId || !photoId) return;
        if (!confirm(_t('finds.photo.deleteConfirm'))) return;
        try {
            var res = await Auth.authedFetch('/api/finds/' + FP.editingFindId + '/photos/' + photoId, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete photo');
            FP.currentPhotos = FP.currentPhotos.filter(function (p) { return p.id !== photoId; });
            FP.renderPhotoGallery();
        } catch (err) {
            console.error('Error deleting photo:', err);
            Auth.showToast(_t('finds.errorSaving'));
        }
    };

    /* ------------------------------------------------------------------ */
    /*  Lightbox                                                          */
    /* ------------------------------------------------------------------ */
    FP.openLightbox = function (index) {
        FP.lightboxPhotos = [];
        for (var i = 0; i < FP.currentPhotos.length; i++) {
            FP.lightboxPhotos.push(Auth.secureUrl(FP.currentPhotos[i].photo_url));
        }
        for (var j = 0; j < FP.newPhotoFiles.length; j++) {
            FP.lightboxPhotos.push(URL.createObjectURL(FP.newPhotoFiles[j]));
        }
        if (FP.lightboxPhotos.length === 0) return;
        FP.lightboxIndex = index;
        showLightboxImage();
        FP.els.lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    };

    FP.closeLightbox = function () {
        FP.els.lightbox.classList.add('hidden');
        if (!FP.els.modalOverlay.classList.contains('open')) {
            document.body.style.overflow = '';
        }
    };

    FP.navigateLightbox = function (delta) {
        FP.lightboxIndex += delta;
        if (FP.lightboxIndex < 0) FP.lightboxIndex = FP.lightboxPhotos.length - 1;
        if (FP.lightboxIndex >= FP.lightboxPhotos.length) FP.lightboxIndex = 0;
        showLightboxImage();
    };

    function showLightboxImage() {
        FP.els.lightboxImg.src = FP.lightboxPhotos[FP.lightboxIndex];
        FP.els.lightboxPrev.classList.toggle('hidden', FP.lightboxPhotos.length <= 1);
        FP.els.lightboxNext.classList.toggle('hidden', FP.lightboxPhotos.length <= 1);
    }

    /* ------------------------------------------------------------------ */
    /*  Quick Log                                                         */
    /* ------------------------------------------------------------------ */
    FP.openQuickLog = function () {
        FP.els.quickLogForm.reset();
        FP.els.quickLogPreview.classList.add('hidden');
        FP.els.quickLogUploadPlaceholder.classList.remove('hidden');
        FP.els.quickLogLocationStatus.textContent = '';

        var lastCategory = localStorage.getItem('sb_lastCategory') || '';
        FP.els.quickLogCategory.value = lastCategory;

        var lastSiteId = localStorage.getItem('sb_lastSiteId') || '';
        if (lastSiteId) FP.els.quickLogSiteId.value = lastSiteId;

        if (navigator.geolocation) {
            FP.els.quickLogLocationStatus.textContent = _t('finds.quickLog.gettingLocation');
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    FP.els.quickLogLatitude.value = pos.coords.latitude.toFixed(6);
                    FP.els.quickLogLongitude.value = pos.coords.longitude.toFixed(6);
                    FP.els.quickLogLocationStatus.textContent = '';
                },
                function () { FP.els.quickLogLocationStatus.textContent = ''; },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
            );
        }

        FP.els.quickLogOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        FP.els.quickLogDescription.focus();
    };

    FP.closeQuickLog = function () {
        FP.els.quickLogOverlay.classList.remove('open');
        document.body.style.overflow = '';
    };

    FP.handleQuickLogSubmit = async function (e) {
        e.preventDefault();
        var formData = new FormData();

        var siteId = FP.els.quickLogSiteId.value;
        if (!siteId && FP.allSites.length > 0) siteId = FP.allSites[0].id;
        if (!siteId) {
            Auth.showToast(_t('finds.errorSaving') + ' No site available');
            return;
        }
        formData.append('site_id', siteId);
        formData.append('date', new Date().toISOString().split('T')[0]);
        formData.append('description', FP.els.quickLogDescription.value.trim());
        var cat = FP.els.quickLogCategory.value;
        if (cat) formData.append('category', cat);
        if (FP.els.quickLogLatitude.value) formData.append('latitude', FP.els.quickLogLatitude.value);
        if (FP.els.quickLogLongitude.value) formData.append('longitude', FP.els.quickLogLongitude.value);
        if (FP.els.quickLogPhoto.files.length > 0) {
            formData.append('photos', FP.els.quickLogPhoto.files[0]);
        }

        try {
            FP.els.btnQuickLogSave.disabled = true;
            FP.els.btnQuickLogSave.textContent = _t('finds.modal.saving');
            var res = await Auth.authedFetch('/api/finds', { method: 'POST', body: formData });
            if (!res.ok) {
                var errData = await res.json().catch(function () { return {}; });
                throw new Error(errData.message || 'Failed to save find');
            }
            localStorage.setItem('sb_lastCategory', cat);
            localStorage.setItem('sb_lastSiteId', siteId);
            FP.closeQuickLog();
            Auth.showToast(_t('finds.quickLog.saved'));
            await FP.loadFinds();
        } catch (err) {
            console.error('Error saving quick log:', err);
            Auth.showToast(_t('finds.errorSaving'));
        } finally {
            FP.els.btnQuickLogSave.disabled = false;
            FP.els.btnQuickLogSave.textContent = _t('finds.quickLog.save');
        }
    };

    FP.quickLogToFullModal = function () {
        var description = FP.els.quickLogDescription.value;
        var category = FP.els.quickLogCategory.value;
        var lat = FP.els.quickLogLatitude.value;
        var lng = FP.els.quickLogLongitude.value;
        var siteId = FP.els.quickLogSiteId.value;
        var photoFile = FP.els.quickLogPhoto.files.length > 0 ? FP.els.quickLogPhoto.files[0] : null;

        FP.closeQuickLog();
        FP.openModal();

        FP.els.description.value = description;
        FP.els.category.value = category;
        if (lat) FP.els.latitude.value = lat;
        if (lng) FP.els.longitude.value = lng;
        if (siteId) FP.els.site.value = siteId;

        if (photoFile) {
            FP.newPhotoFiles = [photoFile];
            FP.renderPhotoGallery();
        }
    };

})(window.FP = window.FP || {});
