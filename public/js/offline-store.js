/**
 * IndexedDB offline data store.
 * Provides cached GET responses, mutation queue, photo storage, and trackpoint buffer.
 *
 * Usage: window.OfflineStore.init() — called from auth.js on page load.
 */
window.OfflineStore = (function () {
    'use strict';

    var DB_NAME = 'metal-detect-tracker-offline';
    var DB_VERSION = 1;
    var db = null;

    /* ------------------------------------------------------------------ */
    /*  Init / Open Database                                               */
    /* ------------------------------------------------------------------ */
    function init() {
        return new Promise(function (resolve, reject) {
            if (db) return resolve(db);
            if (!window.indexedDB) return reject(new Error('IndexedDB not supported'));

            var request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (e) {
                var idb = e.target.result;

                // cached_data — key-value cache for GET responses
                if (!idb.objectStoreNames.contains('cached_data')) {
                    idb.createObjectStore('cached_data', { keyPath: 'key' });
                }

                // mutation_queue — POST/PUT/DELETE queued while offline
                if (!idb.objectStoreNames.contains('mutation_queue')) {
                    var mutStore = idb.createObjectStore('mutation_queue', { keyPath: 'id', autoIncrement: true });
                    mutStore.createIndex('status', 'status', { unique: false });
                    mutStore.createIndex('created_at', 'created_at', { unique: false });
                }

                // offline_photos — camera photos stored as blobs until S3 upload
                if (!idb.objectStoreNames.contains('offline_photos')) {
                    var photoStore = idb.createObjectStore('offline_photos', { keyPath: 'id' });
                    photoStore.createIndex('mutation_queue_id', 'mutation_queue_id', { unique: false });
                }

                // offline_trackpoints — GPS trackpoint batches
                if (!idb.objectStoreNames.contains('offline_trackpoints')) {
                    var tpStore = idb.createObjectStore('offline_trackpoints', { keyPath: 'id', autoIncrement: true });
                    tpStore.createIndex('status', 'status', { unique: false });
                    tpStore.createIndex('created_at', 'created_at', { unique: false });
                }
            };

            request.onsuccess = function (e) {
                db = e.target.result;
                resolve(db);
            };

            request.onerror = function () {
                reject(request.error);
            };
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */
    function getStore(name, mode) {
        var tx = db.transaction(name, mode || 'readonly');
        return tx.objectStore(name);
    }

    function promisifyRequest(request) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    function generateId() {
        return 'offline_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /* ------------------------------------------------------------------ */
    /*  Cache — GET response storage                                       */
    /* ------------------------------------------------------------------ */
    function cacheResponse(key, data) {
        if (!db) return Promise.resolve();
        var store = getStore('cached_data', 'readwrite');
        return promisifyRequest(store.put({
            key: key,
            data: data,
            cached_at: Date.now()
        }));
    }

    function getCached(key) {
        if (!db) return Promise.resolve(null);
        var store = getStore('cached_data');
        return promisifyRequest(store.get(key));
    }

    function clearCache() {
        if (!db) return Promise.resolve();
        var store = getStore('cached_data', 'readwrite');
        return promisifyRequest(store.clear());
    }

    /* ------------------------------------------------------------------ */
    /*  Mutation Queue — offline writes                                    */
    /* ------------------------------------------------------------------ */
    function queueMutation(method, url, body) {
        if (!db) return Promise.reject(new Error('OfflineStore not initialized'));
        var idempotencyKey = generateId();
        var store = getStore('mutation_queue', 'readwrite');
        return promisifyRequest(store.add({
            method: method,
            url: url,
            body: body,
            idempotency_key: idempotencyKey,
            created_at: Date.now(),
            status: 'pending',
            retry_count: 0,
            error: null
        }));
    }

    function getPendingMutations() {
        if (!db) return Promise.resolve([]);
        return new Promise(function (resolve, reject) {
            var store = getStore('mutation_queue');
            var index = store.index('created_at');
            var results = [];
            var request = index.openCursor();
            request.onsuccess = function (e) {
                var cursor = e.target.result;
                if (cursor) {
                    var val = cursor.value;
                    if (val.status === 'pending' || val.status === 'failed') {
                        results.push(val);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = function () { reject(request.error); };
        });
    }

    function getMutationCount() {
        if (!db) return Promise.resolve(0);
        return new Promise(function (resolve, reject) {
            var store = getStore('mutation_queue');
            var count = 0;
            var request = store.openCursor();
            request.onsuccess = function (e) {
                var cursor = e.target.result;
                if (cursor) {
                    var s = cursor.value.status;
                    if (s === 'pending' || s === 'failed') count++;
                    cursor.continue();
                } else {
                    resolve(count);
                }
            };
            request.onerror = function () { reject(request.error); };
        });
    }

    function updateMutationStatus(id, status, error) {
        if (!db) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var store = getStore('mutation_queue', 'readwrite');
            var request = store.get(id);
            request.onsuccess = function () {
                var record = request.result;
                if (!record) return resolve();
                record.status = status;
                if (error !== undefined) record.error = error;
                if (status === 'failed' || status === 'syncing') {
                    record.retry_count = (record.retry_count || 0) + (status === 'failed' ? 1 : 0);
                }
                promisifyRequest(store.put(record)).then(resolve).catch(reject);
            };
            request.onerror = function () { reject(request.error); };
        });
    }

    function deleteMutation(id) {
        if (!db) return Promise.resolve();
        var store = getStore('mutation_queue', 'readwrite');
        return promisifyRequest(store.delete(id));
    }

    /* ------------------------------------------------------------------ */
    /*  Photos — blob storage for offline camera captures                  */
    /* ------------------------------------------------------------------ */
    function storePhoto(blob, filename, mimeType, entityType, mutationId) {
        if (!db) return Promise.reject(new Error('OfflineStore not initialized'));
        var id = 'offline_photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        var store = getStore('offline_photos', 'readwrite');
        return promisifyRequest(store.put({
            id: id,
            blob: blob,
            filename: filename,
            mime_type: mimeType,
            entity_type: entityType,
            mutation_queue_id: mutationId,
            created_at: Date.now()
        })).then(function () { return id; });
    }

    function getPhoto(tempId) {
        if (!db) return Promise.resolve(null);
        var store = getStore('offline_photos');
        return promisifyRequest(store.get(tempId));
    }

    function deletePhoto(tempId) {
        if (!db) return Promise.resolve();
        var store = getStore('offline_photos', 'readwrite');
        return promisifyRequest(store.delete(tempId));
    }

    function getPhotosForMutation(mutationId) {
        if (!db) return Promise.resolve([]);
        return new Promise(function (resolve, reject) {
            var store = getStore('offline_photos');
            var index = store.index('mutation_queue_id');
            var results = [];
            var request = index.openCursor(IDBKeyRange.only(mutationId));
            request.onsuccess = function (e) {
                var cursor = e.target.result;
                if (cursor) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = function () { reject(request.error); };
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Trackpoints — GPS batch buffer                                     */
    /* ------------------------------------------------------------------ */
    function bufferTrackpoints(sessionId, segmentId, points, idempotencyKey) {
        if (!db) return Promise.reject(new Error('OfflineStore not initialized'));
        var store = getStore('offline_trackpoints', 'readwrite');
        return promisifyRequest(store.add({
            session_id: sessionId,
            segment_id: segmentId,
            points: points,
            idempotency_key: idempotencyKey,
            status: 'pending',
            created_at: Date.now()
        }));
    }

    function getPendingTrackpoints() {
        if (!db) return Promise.resolve([]);
        return new Promise(function (resolve, reject) {
            var store = getStore('offline_trackpoints');
            var index = store.index('created_at');
            var results = [];
            var request = index.openCursor();
            request.onsuccess = function (e) {
                var cursor = e.target.result;
                if (cursor) {
                    if (cursor.value.status === 'pending') {
                        results.push(cursor.value);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = function () { reject(request.error); };
        });
    }

    function updateTrackpointStatus(id, status) {
        if (!db) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var store = getStore('offline_trackpoints', 'readwrite');
            var request = store.get(id);
            request.onsuccess = function () {
                var record = request.result;
                if (!record) return resolve();
                record.status = status;
                promisifyRequest(store.put(record)).then(resolve).catch(reject);
            };
            request.onerror = function () { reject(request.error); };
        });
    }

    function deleteTrackpointBatch(id) {
        if (!db) return Promise.resolve();
        var store = getStore('offline_trackpoints', 'readwrite');
        return promisifyRequest(store.delete(id));
    }

    /* ------------------------------------------------------------------ */
    /*  Status Helpers                                                     */
    /* ------------------------------------------------------------------ */
    function isOnline() {
        return navigator.onLine;
    }

    function getQueueSummary() {
        if (!db) return Promise.resolve({ mutations: 0, photos: 0, trackpoints: 0 });
        return Promise.all([
            getMutationCount(),
            new Promise(function (resolve) {
                var store = getStore('offline_photos');
                var request = store.count();
                request.onsuccess = function () { resolve(request.result); };
                request.onerror = function () { resolve(0); };
            }),
            new Promise(function (resolve) {
                var store = getStore('offline_trackpoints');
                var count = 0;
                var request = store.openCursor();
                request.onsuccess = function (e) {
                    var cursor = e.target.result;
                    if (cursor) {
                        if (cursor.value.status === 'pending') count++;
                        cursor.continue();
                    } else {
                        resolve(count);
                    }
                };
                request.onerror = function () { resolve(0); };
            })
        ]).then(function (counts) {
            return { mutations: counts[0], photos: counts[1], trackpoints: counts[2] };
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                         */
    /* ------------------------------------------------------------------ */
    return {
        init: init,

        // Cache
        cacheResponse: cacheResponse,
        getCached: getCached,
        clearCache: clearCache,

        // Mutations
        queueMutation: queueMutation,
        getPendingMutations: getPendingMutations,
        getMutationCount: getMutationCount,
        updateMutationStatus: updateMutationStatus,
        deleteMutation: deleteMutation,

        // Photos
        storePhoto: storePhoto,
        getPhoto: getPhoto,
        deletePhoto: deletePhoto,
        getPhotosForMutation: getPhotosForMutation,

        // Trackpoints
        bufferTrackpoints: bufferTrackpoints,
        getPendingTrackpoints: getPendingTrackpoints,
        updateTrackpointStatus: updateTrackpointStatus,
        deleteTrackpointBatch: deleteTrackpointBatch,

        // Status
        isOnline: isOnline,
        getQueueSummary: getQueueSummary
    };
})();
