/**
 * Offline UI — banner, sync indicator, queue count badge.
 * Injects a persistent banner below the navbar when offline.
 *
 * Depends on: window.OfflineStore, window.SyncEngine
 */
window.OfflineUI = (function () {
    'use strict';

    let banner = null;
    let bannerText = null;
    let queueBadge = null;
    let updateTimer = null;

    /* ------------------------------------------------------------------ */
    /*  Create banner DOM                                                  */
    /* ------------------------------------------------------------------ */
    function createBanner() {
        if (banner) return;

        banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.className = 'offline-banner';
        banner.classList.add('hidden');

        const dot = document.createElement('span');
        dot.className = 'offline-banner-dot';

        bannerText = document.createElement('span');
        bannerText.id = 'offline-banner-text';
        bannerText.textContent = 'Offline';

        queueBadge = document.createElement('span');
        queueBadge.id = 'offline-queue-count';
        queueBadge.className = 'offline-queue-badge';

        const syncBtn = document.createElement('button');
        syncBtn.className = 'offline-sync-btn';
        syncBtn.id = 'offline-sync-btn';
        syncBtn.textContent = 'Sync Now';
        syncBtn.classList.add('hidden');
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
        const navbar = document.querySelector('.navbar');
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

        const online = navigator.onLine;
        const isSyncing = window.SyncEngine && SyncEngine.isSyncing();

        if (isSyncing) {
            banner.classList.remove('hidden');
            banner.className = 'offline-banner offline-banner-syncing';
            bannerText.textContent = window.I18n ? I18n.t('offline.syncing') : 'Syncing...';
            queueBadge.textContent = '';
            const syncBtn = document.getElementById('offline-sync-btn');
            if (syncBtn) syncBtn.classList.add('hidden');
            return;
        }

        if (!online) {
            banner.classList.remove('hidden');
            banner.className = 'offline-banner';
            bannerText.textContent = window.I18n ? I18n.t('offline.banner') : 'Offline';
            const syncBtn2 = document.getElementById('offline-sync-btn');
            if (syncBtn2) syncBtn2.classList.add('hidden');
            updateQueueCount();
            return;
        }

        // Online — check if there's a queue
        if (window.OfflineStore) {
            OfflineStore.getMutationCount().then(function (count) {
                if (count > 0) {
                    banner.classList.remove('hidden');
                    banner.className = 'offline-banner offline-banner-queued';
                    const msg = window.I18n ? I18n.t('offline.itemsQueued') : '{count} items queued';
                    bannerText.textContent = msg.replace('{count}', count);
                    queueBadge.textContent = '';
                    const syncBtn3 = document.getElementById('offline-sync-btn');
                    if (syncBtn3) syncBtn3.classList.remove('hidden');
                } else {
                    banner.classList.add('hidden');
                }
            }).catch(function () {
                banner.classList.add('hidden');
            });
        } else {
            banner.classList.add('hidden');
        }
    }

    function updateQueueCount() {
        if (!queueBadge || !window.OfflineStore) return;
        OfflineStore.getMutationCount().then(function (count) {
            if (count > 0) {
                const msg = window.I18n ? I18n.t('offline.itemsQueued') : '{count} items queued';
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
                const newWorker = reg.installing;
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
        const msg = window.I18n ? I18n.t('offline.updateAvailable') : 'Update available — tap to refresh';
        Auth.showToast(msg, 'info', 0); // 0 = no auto-dismiss

        // On next tap of the toast, activate new SW + reload
        setTimeout(function () {
            const toasts = document.querySelectorAll('.toast');
            const lastToast = toasts[toasts.length - 1];
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
                banner.classList.remove('hidden');
                banner.className = 'offline-banner offline-banner-synced';
                bannerText.textContent = window.I18n ? I18n.t('offline.synced') : 'All synced';
                queueBadge.textContent = '';
                const syncBtn = document.getElementById('offline-sync-btn');
                if (syncBtn) syncBtn.classList.add('hidden');
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
