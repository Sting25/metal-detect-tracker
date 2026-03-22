/**
 * Sync Engine — flushes offline mutation queue and trackpoints when online.
 * Uses idempotency keys to safely retry failed/ambiguous requests.
 *
 * Depends on: window.OfflineStore, window.Auth
 */
window.SyncEngine = (function () {
    'use strict';

    const MAX_RETRIES = 10;
    const SYNC_INTERVAL = 60000; // 60s polling
    let syncing = false;
    let intervalId = null;

    /* ------------------------------------------------------------------ */
    /*  Backoff schedule                                                   */
    /* ------------------------------------------------------------------ */
    function getBackoffMs(retryCount) {
        const delays = [0, 30000, 120000, 600000, 1800000]; // 0s, 30s, 2m, 10m, 30m
        return delays[Math.min(retryCount, delays.length - 1)];
    }

    /* ------------------------------------------------------------------ */
    /*  Sync mutations                                                     */
    /* ------------------------------------------------------------------ */
    function syncMutations() {
        if (!window.OfflineStore) return Promise.resolve();

        return OfflineStore.getPendingMutations().then(function (mutations) {
            if (mutations.length === 0) return;

            // Process sequentially (FIFO)
            return mutations.reduce(function (chain, mutation) {
                return chain.then(function () {
                    return syncOneMutation(mutation);
                });
            }, Promise.resolve());
        });
    }

    function syncOneMutation(mutation) {
        // Check backoff
        const backoff = getBackoffMs(mutation.retry_count);
        if (backoff > 0 && mutation.retry_count > 0) {
            const elapsed = Date.now() - (mutation.last_retry_at || mutation.created_at);
            if (elapsed < backoff) return Promise.resolve(); // Not yet time to retry
        }

        // Exceeded max retries
        if (mutation.retry_count >= MAX_RETRIES) {
            return OfflineStore.updateMutationStatus(mutation.id, 'failed', 'Max retries exceeded');
        }

        // Mark syncing
        return OfflineStore.updateMutationStatus(mutation.id, 'syncing').then(function () {
            const options = {
                method: mutation.method,
                headers: {
                    'Content-Type': 'application/json',
                    'x-idempotency-key': mutation.idempotency_key
                }
            };

            const token = window.Auth ? Auth.getToken() : null;
            if (token) {
                options.headers['Authorization'] = 'Bearer ' + token;
            }

            if (mutation.body && mutation.method !== 'GET') {
                options.body = JSON.stringify(mutation.body);
            }

            return fetch(mutation.url, options).then(function (res) {
                if (res.ok || res.status === 409) {
                    // Success or duplicate key (already processed)
                    return OfflineStore.deleteMutation(mutation.id).then(function () {
                        // Clean up associated photos
                        return OfflineStore.getPhotosForMutation(mutation.id).then(function (photos) {
                            return Promise.all(photos.map(function (p) {
                                return OfflineStore.deletePhoto(p.id);
                            }));
                        });
                    });
                } else if (res.status >= 400 && res.status < 500) {
                    // Client error — don't retry bad data
                    return res.json().catch(function () { return {}; }).then(function (body) {
                        const errorMsg = (body && body.error) || 'Client error ' + res.status;
                        return OfflineStore.updateMutationStatus(mutation.id, 'failed', errorMsg);
                    });
                } else {
                    // Server error — retry with backoff
                    return OfflineStore.updateMutationStatus(mutation.id, 'pending', 'Server error ' + res.status);
                }
            }).catch(function () {
                // Network error — put back to pending
                return OfflineStore.updateMutationStatus(mutation.id, 'pending', 'Network error');
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Sync trackpoints                                                   */
    /* ------------------------------------------------------------------ */
    function syncTrackpoints() {
        if (!window.OfflineStore) return Promise.resolve();

        return OfflineStore.getPendingTrackpoints().then(function (batches) {
            if (batches.length === 0) return;

            return batches.reduce(function (chain, batch) {
                return chain.then(function () {
                    return syncOneTrackpointBatch(batch);
                });
            }, Promise.resolve());
        });
    }

    function syncOneTrackpointBatch(batch) {
        return OfflineStore.updateTrackpointStatus(batch.id, 'syncing').then(function () {
            const token = window.Auth ? Auth.getToken() : null;
            const options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idempotency_key: batch.idempotency_key,
                    points: batch.points
                })
            };
            if (token) {
                options.headers['Authorization'] = 'Bearer ' + token;
            }

            const url = '/api/hunts/' + batch.session_id + '/trackpoints';

            return fetch(url, options).then(function (res) {
                if (res.ok || res.status === 409) {
                    return OfflineStore.deleteTrackpointBatch(batch.id);
                } else {
                    return OfflineStore.updateTrackpointStatus(batch.id, 'pending');
                }
            }).catch(function () {
                return OfflineStore.updateTrackpointStatus(batch.id, 'pending');
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Main sync entry point                                              */
    /* ------------------------------------------------------------------ */
    function trySync() {
        if (syncing) return Promise.resolve();
        if (!navigator.onLine) return Promise.resolve();

        syncing = true;

        return syncMutations()
            .then(function () { return syncTrackpoints(); })
            .then(function () {
                localStorage.setItem('sb_last_sync', Date.now().toString());
                // Broadcast sync-complete event
                if (typeof CustomEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('sync-complete'));
                }
            })
            .catch(function (err) {
                console.warn('SyncEngine: error during sync', err);
            })
            .then(function () {
                syncing = false;
            });
    }

    /* ------------------------------------------------------------------ */
    /*  Init — start listeners + polling                                   */
    /* ------------------------------------------------------------------ */
    function init() {
        // Sync when coming back online
        window.addEventListener('online', function () {
            setTimeout(trySync, 1000); // Short delay for network to stabilize
        });

        // Poll every 60s when online
        if (!intervalId) {
            intervalId = setInterval(function () {
                if (navigator.onLine) {
                    trySync();
                }
            }, SYNC_INTERVAL);
        }

        // Initial sync attempt
        if (navigator.onLine) {
            setTimeout(trySync, 3000); // Wait for page to settle
        }
    }

    function isSyncing() {
        return syncing;
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                         */
    /* ------------------------------------------------------------------ */
    return {
        init: init,
        trySync: trySync,
        isSyncing: isSyncing
    };
})();
