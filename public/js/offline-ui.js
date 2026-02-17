/**
 * Offline UI — banner, sync indicator, queue count badge.
 * Injects a persistent banner below the navbar when offline.
 *
 * Depends on: window.OfflineStore, window.SyncEngine
 */
window.OfflineUI = (function () {
    'use strict';

    var banner = null;
    var bannerText = null;
    var queueBadge = null;
    var updateTimer = null;

    /* ------------------------------------------------------------------ */
    /*  Create banner DOM                                                  */
    /* ------------------------------------------------------------------ */
    function createBanner() {
        if (banner) return;

        banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.className = 'offline-banner';
        banner.style.display = 'none';

        var dot = document.createElement('span');
        dot.className = 'offline-banner-dot';

        bannerText = document.createElement('span');
        bannerText.id = 'offline-banner-text';
        bannerText.textContent = 'Offline';

        queueBadge = document.createElement('span');
        queueBadge.id = 'offline-queue-count';
        queueBadge.className = 'offline-queue-badge';

        var syncBtn = document.createElement('button');
        syncBtn.className = 'offline-sync-btn';
        syncBtn.id = 'offline-sync-btn';
        syncBtn.textContent = 'Sync Now';
        syncBtn.style.display = 'none';
        syncBtn.addEventListener('click', function () {
            if (window.SyncEngine) {
                SyncEngine.trySync();
                updateBannerState();
            }
        });

        banner.appendChild(dot);
        banner.appendChild(bannerText);
        banner.appendChild(queueBadge);
        banner.appendChild(syncBtn);

        // Insert after navbar
        var navbar = document.querySelector('.navbar');
        if (navbar && navbar.nextSibling) {
            navbar.parentNode.insertBefore(banner, navbar.nextSibling);
        } else {
            document.body.insertBefore(banner, document.body.firstChild);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Update banner state                                                */
    /* ------------------------------------------------------------------ */
    function updateBannerState() {
        if (!banner) return;

        var online = navigator.onLine;
        var isSyncing = window.SyncEngine && SyncEngine.isSyncing();

        if (isSyncing) {
            banner.style.display = '';
            banner.className = 'offline-banner offline-banner-syncing';
            bannerText.textContent = window.I18n ? I18n.t('offline.syncing') : 'Syncing...';
            queueBadge.textContent = '';
            var syncBtn = document.getElementById('offline-sync-btn');
            if (syncBtn) syncBtn.style.display = 'none';
            return;
        }

        if (!online) {
            banner.style.display = '';
            banner.className = 'offline-banner';
            bannerText.textContent = window.I18n ? I18n.t('offline.banner') : 'Offline';
            var syncBtn2 = document.getElementById('offline-sync-btn');
            if (syncBtn2) syncBtn2.style.display = 'none';
            updateQueueCount();
            return;
        }

        // Online — check if there's a queue
        if (window.OfflineStore) {
            OfflineStore.getMutationCount().then(function (count) {
                if (count > 0) {
                    banner.style.display = '';
                    banner.className = 'offline-banner offline-banner-queued';
                    var msg = window.I18n ? I18n.t('offline.itemsQueued') : '{count} items queued';
                    bannerText.textContent = msg.replace('{count}', count);
                    queueBadge.textContent = '';
                    var syncBtn3 = document.getElementById('offline-sync-btn');
                    if (syncBtn3) syncBtn3.style.display = '';
                } else {
                    banner.style.display = 'none';
                }
            }).catch(function () {
                banner.style.display = 'none';
            });
        } else {
            banner.style.display = 'none';
        }
    }

    function updateQueueCount() {
        if (!queueBadge || !window.OfflineStore) return;
        OfflineStore.getMutationCount().then(function (count) {
            if (count > 0) {
                var msg = window.I18n ? I18n.t('offline.itemsQueued') : '{count} items queued';
                queueBadge.textContent = msg.replace('{count}', count);
            } else {
                queueBadge.textContent = '';
            }
        }).catch(function () {
            queueBadge.textContent = '';
        });
    }

    /* ------------------------------------------------------------------ */
    /*  SW update notification                                             */
    /* ------------------------------------------------------------------ */
    function listenForSWUpdate() {
        if (!('serviceWorker' in navigator)) return;

        navigator.serviceWorker.ready.then(function (reg) {
            reg.addEventListener('updatefound', function () {
                var newWorker = reg.installing;
                if (!newWorker) return;
                newWorker.addEventListener('statechange', function () {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateToast(reg);
                    }
                });
            });
        });
    }

    function showUpdateToast(registration) {
        if (!window.Auth || !Auth.showToast) return;
        var msg = window.I18n ? I18n.t('offline.updateAvailable') : 'Update available — tap to refresh';
        Auth.showToast(msg, 'info', 0); // 0 = no auto-dismiss

        // On next tap of the toast, activate new SW + reload
        setTimeout(function () {
            var toasts = document.querySelectorAll('.toast');
            var lastToast = toasts[toasts.length - 1];
            if (lastToast) {
                lastToast.style.cursor = 'pointer';
                lastToast.addEventListener('click', function () {
                    if (registration.waiting) {
                        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                    }
                    window.location.reload();
                });
            }
        }, 100);
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */
    function init() {
        createBanner();

        // Listen for online/offline events
        window.addEventListener('online', function () {
            updateBannerState();
            // Show brief "back online" notification
            if (window.Auth && Auth.showToast) {
                Auth.showToast('Back online', 'success', 2000);
            }
        });

        window.addEventListener('offline', function () {
            updateBannerState();
        });

        // Listen for sync-complete
        window.addEventListener('sync-complete', function () {
            // Brief "synced" state
            if (banner) {
                banner.style.display = '';
                banner.className = 'offline-banner offline-banner-synced';
                bannerText.textContent = window.I18n ? I18n.t('offline.synced') : 'All synced';
                queueBadge.textContent = '';
                var syncBtn = document.getElementById('offline-sync-btn');
                if (syncBtn) syncBtn.style.display = 'none';
                setTimeout(function () {
                    updateBannerState();
                }, 3000);
            }
        });

        // Periodic update of queue count
        updateTimer = setInterval(updateBannerState, 15000);

        // Listen for SW updates
        listenForSWUpdate();

        // Initial state
        updateBannerState();
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                         */
    /* ------------------------------------------------------------------ */
    return {
        init: init,
        updateBannerState: updateBannerState
    };
})();
