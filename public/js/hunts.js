/**
 * Hunts page — Session tracking with GPS capture, point batching,
 * live timer, and map rendering (Stage 2).
 */
(function () {
    'use strict';

    // Require authentication
    if (!window.Auth || !Auth.getToken()) {
        window.location.href = '/login.html';
        return;
    }

    // ---------------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------------
    var state = {
        view: 'list',           // 'list' | 'active' | 'detail'
        sessions: [],
        page: 1,
        totalPages: 1,
        activeSession: null,    // current active/paused session
        detailSession: null,    // session being viewed in detail
        map: null,
        detailMap: null,
        trackLayer: null,
        watchId: null,
        pointBuffer: [],
        lastAcceptedPoint: null,
        lastAcceptedTime: 0,
        batchTimer: null,
        durationTimer: null,
        durationSeconds: 0,
        wakeLock: null,
        sites: [],
        covSessionLayer: null,
        covAllLayer: null,
        covOpacity: 0.4,
    };

    // ---------------------------------------------------------------------------
    // Config
    // ---------------------------------------------------------------------------
    var GPS_ACCURACY_THRESHOLD = 50;    // meters
    var MIN_DISTANCE_M = 2;             // meters — skip points closer
    var MIN_INTERVAL_MS = 3000;         // 3 seconds between points
    var BATCH_INTERVAL_MS = 30000;      // flush every 30s
    var BATCH_MAX_SIZE = 20;            // flush when buffer reaches 20

    // Segment colors for detail view
    var SEGMENT_COLORS = ['#5c4033', '#2d5016', '#3b82f6', '#ef4444', '#eab308', '#8B7355'];

    // ---------------------------------------------------------------------------
    // DOM refs
    // ---------------------------------------------------------------------------
    var listView = document.getElementById('hunt-list-view');
    var activeView = document.getElementById('active-hunt-view');
    var detailView = document.getElementById('hunt-detail-view');

    var huntsContainer = document.getElementById('hunts-container');
    var huntsEmpty = document.getElementById('hunts-empty');
    var huntsPagination = document.getElementById('hunts-pagination');
    var filterStatus = document.getElementById('filter-status');
    var filterSite = document.getElementById('filter-site');

    var btnStartHunt = document.getElementById('btn-start-hunt');
    var btnPauseHunt = document.getElementById('btn-pause-hunt');
    var btnEndHunt = document.getElementById('btn-end-hunt');
    var btnBackToList = document.getElementById('btn-back-to-list');

    var huntDurationEl = document.getElementById('hunt-duration');
    var huntDistanceEl = document.getElementById('hunt-distance');
    var huntPointsEl = document.getElementById('hunt-points');
    var gpsIndicator = document.getElementById('gps-indicator');

    var startModal = document.getElementById('start-hunt-modal');
    var startHuntSite = document.getElementById('start-hunt-site');
    var startHuntNotes = document.getElementById('start-hunt-notes');
    var btnConfirmStart = document.getElementById('btn-confirm-start');
    var btnCancelStart = document.getElementById('btn-cancel-start');
    var btnStartModalClose = document.getElementById('btn-start-modal-close');
    var startErrorMsg = document.getElementById('start-error-msg');

    // Detail view refs
    var detailStats = document.getElementById('detail-stats');
    var detailNotes = document.getElementById('detail-notes');
    var btnSaveNotes = document.getElementById('btn-save-notes');
    var notesMsg = document.getElementById('notes-msg');
    var btnDeleteHunt = document.getElementById('btn-delete-hunt');
    var detailFindsList = document.getElementById('detail-finds-list');
    var detailFindsSection = document.getElementById('detail-finds-section');

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    function t(key) {
        return window.I18n ? I18n.t(key) : key.split('.').pop();
    }

    function formatDuration(seconds) {
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = seconds % 60;
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function formatDistance(meters) {
        if (meters >= 1000) {
            return (meters / 1000).toFixed(2) + ' km';
        }
        return Math.round(meters) + ' m';
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        var d = new Date(dateStr);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function haversineMeters(lat1, lng1, lat2, lng2) {
        var R = 6371000;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function statusBadgeClass(status) {
        if (status === 'active') return 'status-badge status-badge--green';
        if (status === 'paused') return 'status-badge status-badge--yellow';
        return 'status-badge status-badge--gray';
    }

    // ---------------------------------------------------------------------------
    // View switching
    // ---------------------------------------------------------------------------

    function showView(view) {
        state.view = view;
        listView.classList.toggle('hidden', view !== 'list');
        activeView.classList.toggle('hidden', view !== 'active');
        detailView.classList.toggle('hidden', view !== 'detail');
    }

    // ---------------------------------------------------------------------------
    // Load sites (for filters and start modal)
    // ---------------------------------------------------------------------------

    async function loadSites() {
        try {
            var res = await Auth.authedFetch('/api/sites?limit=200');
            var json = await res.json();
            if (json.success) {
                state.sites = json.data || [];
                populateSiteSelects();
            }
        } catch (err) {
            console.error('Failed to load sites:', err);
        }
    }

    function populateSiteSelects() {
        var selects = [filterSite, startHuntSite];
        for (var s = 0; s < selects.length; s++) {
            var sel = selects[s];
            if (!sel) continue;
            // Keep first option (placeholder)
            while (sel.options.length > 1) sel.remove(1);
            for (var i = 0; i < state.sites.length; i++) {
                var opt = document.createElement('option');
                opt.value = state.sites[i].id;
                opt.textContent = state.sites[i].name;
                sel.appendChild(opt);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Hunt List
    // ---------------------------------------------------------------------------

    async function loadHunts() {
        try {
            var params = '?page=' + state.page + '&limit=20';
            if (filterStatus && filterStatus.value) params += '&status=' + filterStatus.value;
            if (filterSite && filterSite.value) params += '&site_id=' + filterSite.value;

            var res = await Auth.authedFetch('/api/hunts' + params);
            var json = await res.json();
            if (json.success) {
                state.sessions = json.data;
                state.totalPages = json.pagination.pages;
                renderHuntList();
            }
        } catch (err) {
            console.error('Failed to load hunts:', err);
        }
    }

    function renderHuntList() {
        if (!huntsContainer) return;
        huntsContainer.innerHTML = '';

        if (state.sessions.length === 0) {
            if (huntsEmpty) huntsEmpty.classList.remove('hidden');
            if (huntsPagination) huntsPagination.innerHTML = '';
            return;
        }
        if (huntsEmpty) huntsEmpty.classList.add('hidden');

        for (var i = 0; i < state.sessions.length; i++) {
            var s = state.sessions[i];
            var card = document.createElement('div');
            card.className = 'card hunt-card';
            card.style.cursor = 'pointer';
            card.dataset.id = s.id;

            var statusBadge = '<span class="' + statusBadgeClass(s.status) + '">' + s.status + '</span>';
            var siteName = s.site_name || t('hunts.noSite');
            var duration = formatDuration(s.duration_seconds || 0);
            var distance = formatDistance(s.distance_meters || 0);
            var findCount = s.find_count || 0;

            card.innerHTML =
                '<div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">' +
                '  <span style="font-weight: 600;">' + formatDate(s.started_at) + '</span>' +
                '  ' + statusBadge +
                '</div>' +
                '<div class="card-body">' +
                '  <div class="text-muted" style="margin-bottom: var(--space-xs);">' + siteName + '</div>' +
                '  <div style="display: flex; gap: var(--space-md); font-size: var(--font-size-sm);">' +
                '    <span>' + t('hunts.duration') + ': ' + duration + '</span>' +
                '    <span>' + t('hunts.distance') + ': ' + distance + '</span>' +
                '    <span>' + t('hunts.finds') + ': ' + findCount + '</span>' +
                '  </div>' +
                '</div>';

            card.addEventListener('click', (function (session) {
                return function () {
                    if (session.status === 'active' || session.status === 'paused') {
                        enterActiveView(session);
                    } else {
                        showSessionDetail(session.id);
                    }
                };
            })(s));

            huntsContainer.appendChild(card);
        }

        renderPagination();
    }

    function renderPagination() {
        if (!huntsPagination) return;
        huntsPagination.innerHTML = '';
        if (state.totalPages <= 1) return;

        for (var p = 1; p <= state.totalPages; p++) {
            var btn = document.createElement('button');
            btn.className = 'btn btn-sm' + (p === state.page ? ' btn-primary' : '');
            btn.textContent = p;
            btn.addEventListener('click', (function (page) {
                return function () { state.page = page; loadHunts(); };
            })(p));
            huntsPagination.appendChild(btn);
        }
    }

    // ---------------------------------------------------------------------------
    // Start Hunt
    // ---------------------------------------------------------------------------

    function openStartModal() {
        if (startHuntNotes) startHuntNotes.value = '';
        if (startHuntSite) startHuntSite.value = '';
        if (startErrorMsg) startErrorMsg.textContent = '';
        if (startModal) startModal.classList.add('open');
    }

    function closeStartModal() {
        if (startModal) startModal.classList.remove('open');
    }

    async function startHunt() {
        if (btnConfirmStart) btnConfirmStart.disabled = true;
        if (startErrorMsg) startErrorMsg.textContent = '';

        try {
            var payload = {};
            if (startHuntSite && startHuntSite.value) payload.site_id = parseInt(startHuntSite.value);
            if (startHuntNotes && startHuntNotes.value.trim()) payload.notes = startHuntNotes.value.trim();

            var res = await Auth.authedFetch('/api/hunts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            var json = await res.json();
            if (!json.success) throw new Error(json.error);

            closeStartModal();
            enterActiveView(json.data);
        } catch (err) {
            console.error('Error starting hunt:', err);
            if (startErrorMsg) startErrorMsg.textContent = 'Something went wrong. Please try again.';
        } finally {
            if (btnConfirmStart) btnConfirmStart.disabled = false;
        }
    }

    // ---------------------------------------------------------------------------
    // Active Hunt View
    // ---------------------------------------------------------------------------

    function enterActiveView(session) {
        state.activeSession = session;
        showView('active');

        // Update button state based on session status
        updateActiveUI();

        // Initialize map
        setTimeout(function () {
            initActiveMap();
            loadExistingTrackpoints();
        }, 100);

        // Start GPS tracking if active
        if (session.status === 'active') {
            startGPSTracking();
        }

        // Start duration timer
        startDurationTimer(session);

        // Request wake lock
        requestWakeLock();
    }

    function updateActiveUI() {
        if (!state.activeSession) return;
        var isPaused = state.activeSession.status === 'paused';
        if (btnPauseHunt) {
            btnPauseHunt.textContent = isPaused ? t('hunts.resume') : t('hunts.pause');
            btnPauseHunt.className = isPaused ? 'btn btn-primary' : 'btn';
        }
    }

    function initActiveMap() {
        if (state.map) {
            state.map.remove();
            state.map = null;
        }
        var mapEl = document.getElementById('hunt-map');
        if (!mapEl) return;

        state.map = L.map(mapEl).setView([39.7392, -104.9903], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
            maxZoom: 19,
        }).addTo(state.map);

        state.trackLayer = L.layerGroup().addTo(state.map);
    }

    async function loadExistingTrackpoints() {
        if (!state.activeSession) return;
        try {
            var res = await Auth.authedFetch('/api/hunts/' + state.activeSession.id + '/trackpoints');
            var json = await res.json();
            if (json.success && json.data.segments) {
                renderTrackOnMap(json.data.segments, state.trackLayer, state.map);
            }
        } catch (err) {
            console.error('Failed to load trackpoints:', err);
        }
    }

    function renderTrackOnMap(segments, layer, map) {
        if (!layer || !map) return;
        layer.clearLayers();
        var allLatLngs = [];
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            if (seg.points.length === 0) continue;
            var color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
            var latlngs = seg.points.map(function (p) { return [p[0], p[1]]; });
            L.polyline(latlngs, { color: color, weight: 3, opacity: 0.8 }).addTo(layer);
            allLatLngs = allLatLngs.concat(latlngs);
        }
        if (allLatLngs.length > 0) {
            map.fitBounds(L.latLngBounds(allLatLngs).pad(0.1));
        }
    }

    // ---------------------------------------------------------------------------
    // GPS Tracking
    // ---------------------------------------------------------------------------

    function startGPSTracking() {
        if (state.watchId !== null) return;
        if (!navigator.geolocation) {
            setGPSStatus('off');
            return;
        }

        state.watchId = navigator.geolocation.watchPosition(
            onPosition,
            onGPSError,
            {
                enableHighAccuracy: true,
                maximumAge: 5000,
                timeout: 30000,
            }
        );

        // Start batch flush timer
        state.batchTimer = setInterval(flushPointBuffer, BATCH_INTERVAL_MS);
    }

    function stopGPSTracking() {
        if (state.watchId !== null) {
            navigator.geolocation.clearWatch(state.watchId);
            state.watchId = null;
        }
        if (state.batchTimer) {
            clearInterval(state.batchTimer);
            state.batchTimer = null;
        }
        setGPSStatus('off');
    }

    function onPosition(pos) {
        var accuracy = pos.coords.accuracy;

        // Update GPS indicator
        if (accuracy <= 10) setGPSStatus('good');
        else if (accuracy <= 30) setGPSStatus('fair');
        else setGPSStatus('poor');

        // Filter: skip low accuracy
        if (accuracy > GPS_ACCURACY_THRESHOLD) return;

        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        var now = Date.now();

        // Min interval
        if (now - state.lastAcceptedTime < MIN_INTERVAL_MS) return;

        // Min distance
        if (state.lastAcceptedPoint) {
            var dist = haversineMeters(state.lastAcceptedPoint.lat, state.lastAcceptedPoint.lng, lat, lng);
            if (dist < MIN_DISTANCE_M) return;
        }

        var point = {
            lat: lat,
            lng: lng,
            accuracy_m: accuracy,
            altitude_m: pos.coords.altitude || null,
            recorded_at: new Date(pos.timestamp).toISOString(),
        };

        state.pointBuffer.push(point);
        state.lastAcceptedPoint = { lat: lat, lng: lng };
        state.lastAcceptedTime = now;

        // Update map with new point
        addPointToMap(lat, lng);

        // Update point count display
        var currentCount = parseInt(huntPointsEl.textContent) || 0;
        if (huntPointsEl) huntPointsEl.textContent = currentCount + 1;

        // Flush if buffer full
        if (state.pointBuffer.length >= BATCH_MAX_SIZE) {
            flushPointBuffer();
        }
    }

    function onGPSError(err) {
        console.warn('GPS error:', err.message);
        setGPSStatus('off');
    }

    function setGPSStatus(status) {
        if (!gpsIndicator) return;
        gpsIndicator.className = 'gps-dot ' + status;
    }

    function addPointToMap(lat, lng) {
        if (!state.map || !state.trackLayer) return;
        // Get or create current polyline
        var layers = state.trackLayer.getLayers();
        var currentPoly = null;
        for (var i = layers.length - 1; i >= 0; i--) {
            if (layers[i] instanceof L.Polyline) {
                currentPoly = layers[i];
                break;
            }
        }
        if (!currentPoly) {
            currentPoly = L.polyline([], { color: '#5c4033', weight: 3, opacity: 0.8 }).addTo(state.trackLayer);
        }
        currentPoly.addLatLng([lat, lng]);
        state.map.panTo([lat, lng]);
    }

    async function flushPointBuffer() {
        if (state.pointBuffer.length === 0) return;
        if (!state.activeSession) return;

        var points = state.pointBuffer.slice();
        state.pointBuffer = [];

        try {
            var res = await Auth.authedFetch('/api/hunts/' + state.activeSession.id + '/trackpoints', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idempotency_key: generateUUID(),
                    points: points,
                }),
            });
            var json = await res.json();
            if (!json.success && !json.duplicate) {
                // Re-add points to buffer for retry
                state.pointBuffer = points.concat(state.pointBuffer);
            }
        } catch (err) {
            console.error('Failed to upload trackpoints:', err);
            // Re-add to buffer
            state.pointBuffer = points.concat(state.pointBuffer);
        }
    }

    // ---------------------------------------------------------------------------
    // Duration Timer
    // ---------------------------------------------------------------------------

    function startDurationTimer(session) {
        stopDurationTimer();

        // Compute initial duration
        state.durationSeconds = session.duration_seconds || 0;

        // If active, add time since last segment start
        if (session.status === 'active' && session.started_at) {
            // We need to get segments to find the current open segment's start time
            // For simplicity, use a server call or estimate
            fetchCurrentDuration(session.id);
        }

        // Tick every second
        state.durationTimer = setInterval(function () {
            if (state.activeSession && state.activeSession.status === 'active') {
                state.durationSeconds++;
            }
            if (huntDurationEl) huntDurationEl.textContent = formatDuration(state.durationSeconds);
        }, 1000);

        if (huntDurationEl) huntDurationEl.textContent = formatDuration(state.durationSeconds);
    }

    async function fetchCurrentDuration(sessionId) {
        try {
            var res = await Auth.authedFetch('/api/hunts/' + sessionId);
            var json = await res.json();
            if (json.success) {
                var session = json.data;
                var baseDuration = session.duration_seconds || 0;

                // Find open segment and add elapsed time
                if (session.segments) {
                    for (var i = 0; i < session.segments.length; i++) {
                        var seg = session.segments[i];
                        if (!seg.ended_at && seg.started_at) {
                            var elapsed = Math.floor((Date.now() - new Date(seg.started_at).getTime()) / 1000);
                            baseDuration += Math.max(0, elapsed);
                        }
                    }
                }
                state.durationSeconds = baseDuration;
                if (huntDurationEl) huntDurationEl.textContent = formatDuration(state.durationSeconds);

                // Update point count
                if (huntPointsEl) huntPointsEl.textContent = session.trackpoint_count || 0;
            }
        } catch (err) {
            console.error('Failed to fetch duration:', err);
        }
    }

    function stopDurationTimer() {
        if (state.durationTimer) {
            clearInterval(state.durationTimer);
            state.durationTimer = null;
        }
    }

    // ---------------------------------------------------------------------------
    // Wake Lock
    // ---------------------------------------------------------------------------

    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                state.wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) {
            console.warn('Wake lock failed:', err);
        }
    }

    function releaseWakeLock() {
        if (state.wakeLock) {
            state.wakeLock.release().catch(function () {});
            state.wakeLock = null;
        }
    }

    // ---------------------------------------------------------------------------
    // Pause / Resume / End
    // ---------------------------------------------------------------------------

    async function pauseOrResume() {
        if (!state.activeSession) return;

        var isPaused = state.activeSession.status === 'paused';
        var endpoint = isPaused ? '/resume' : '/pause';

        try {
            if (btnPauseHunt) btnPauseHunt.disabled = true;

            // Flush remaining points before pausing
            if (!isPaused) {
                await flushPointBuffer();
            }

            var res = await Auth.authedFetch('/api/hunts/' + state.activeSession.id + endpoint, {
                method: 'POST',
            });
            var json = await res.json();
            if (!json.success) throw new Error(json.error);

            state.activeSession = json.data;
            state.durationSeconds = json.data.duration_seconds || state.durationSeconds;
            updateActiveUI();

            if (json.data.status === 'active') {
                startGPSTracking();
            } else {
                stopGPSTracking();
            }
        } catch (err) {
            console.error('Pause/resume failed:', err);
        } finally {
            if (btnPauseHunt) btnPauseHunt.disabled = false;
        }
    }

    async function endHunt() {
        if (!state.activeSession) return;
        if (!confirm(t('hunts.confirmEnd'))) return;

        try {
            if (btnEndHunt) btnEndHunt.disabled = true;

            // Flush remaining points
            await flushPointBuffer();

            var res = await Auth.authedFetch('/api/hunts/' + state.activeSession.id + '/end', {
                method: 'POST',
            });
            var json = await res.json();
            if (!json.success) throw new Error(json.error);

            // Cleanup
            stopGPSTracking();
            stopDurationTimer();
            releaseWakeLock();
            state.activeSession = null;

            // Go back to list
            showView('list');
            loadHunts();
        } catch (err) {
            console.error('End hunt failed:', err);
        } finally {
            if (btnEndHunt) btnEndHunt.disabled = false;
        }
    }

    // ---------------------------------------------------------------------------
    // Session Detail
    // ---------------------------------------------------------------------------

    async function showSessionDetail(sessionId) {
        try {
            var res = await Auth.authedFetch('/api/hunts/' + sessionId);
            var json = await res.json();
            if (!json.success) return;

            state.detailSession = json.data;
            showView('detail');
            renderDetailView();

            // Load trackpoints for map
            setTimeout(function () {
                initDetailMap();
                loadDetailTrackpoints(sessionId);
            }, 100);
        } catch (err) {
            console.error('Failed to load session detail:', err);
        }
    }

    function renderDetailView() {
        var s = state.detailSession;
        if (!s || !detailStats) return;

        var avgSpeed = (s.duration_seconds > 0 && s.distance_meters > 0)
            ? ((s.distance_meters / s.duration_seconds) * 3.6).toFixed(1) + ' km/h'
            : '-';

        detailStats.innerHTML =
            '<div class="hunt-detail-row"><span class="text-muted">' + t('hunts.status.active').replace('Active', 'Status') + '</span><span class="' + statusBadgeClass(s.status) + '">' + s.status + '</span></div>' +
            '<div class="hunt-detail-row"><span class="text-muted">' + t('hunts.site') + '</span><span>' + (s.site_name || t('hunts.noSite')) + '</span></div>' +
            '<div class="hunt-detail-row"><span class="text-muted">' + t('hunts.startedAt') + '</span><span>' + formatDate(s.started_at) + '</span></div>' +
            '<div class="hunt-detail-row"><span class="text-muted">' + t('hunts.endedAt') + '</span><span>' + formatDate(s.ended_at) + '</span></div>' +
            '<div class="hunt-detail-row"><span class="text-muted">' + t('hunts.duration') + '</span><span>' + formatDuration(s.duration_seconds || 0) + '</span></div>' +
            '<div class="hunt-detail-row"><span class="text-muted">' + t('hunts.distance') + '</span><span>' + formatDistance(s.distance_meters || 0) + '</span></div>' +
            '<div class="hunt-detail-row"><span class="text-muted">' + t('hunts.avgSpeed') + '</span><span>' + avgSpeed + '</span></div>' +
            '<div class="hunt-detail-row"><span class="text-muted">' + t('hunts.trackpoints') + '</span><span>' + (s.trackpoint_count || 0) + '</span></div>' +
            '<div class="hunt-detail-row"><span class="text-muted">' + t('hunts.segments') + '</span><span>' + (s.segments ? s.segments.length : 0) + '</span></div>' +
            '<div class="hunt-detail-row"><span class="text-muted">' + t('hunts.finds') + '</span><span>' + (s.find_count || 0) + '</span></div>';

        if (detailNotes) detailNotes.value = s.notes || '';

        // Render linked finds
        if (s.finds && s.finds.length > 0 && detailFindsList && detailFindsSection) {
            detailFindsSection.classList.remove('hidden');
            detailFindsList.innerHTML = '';
            for (var i = 0; i < s.finds.length; i++) {
                var f = s.finds[i];
                var div = document.createElement('div');
                div.className = 'text-muted';
                div.style.padding = 'var(--space-xs) 0';
                div.textContent = (f.description || 'Find #' + f.id) + ' (' + (f.date_found || '') + ')';
                detailFindsList.appendChild(div);
            }
        } else if (detailFindsSection) {
            detailFindsSection.classList.add('hidden');
        }

        // Coverage controls (if session has a site)
        renderCoverageControls(s);
    }

    // ---------------------------------------------------------------------------
    // Coverage overlay for hunt detail
    // ---------------------------------------------------------------------------

    function renderCoverageControls(session) {
        // Get or create the coverage container
        var container = document.getElementById('hunt-coverage-controls');
        if (!container) return;
        container.innerHTML = '';

        if (!session.site_id) {
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');
        container.innerHTML =
            '<div class="coverage-section">' +
            '<h4>' + t('sites.coverage.title') + '</h4>' +
            '<div class="coverage-controls">' +
            '<label><input type="checkbox" id="cov-this-session"> ' + t('hunts.coverage.thisSession') + '</label>' +
            '<label><input type="checkbox" id="cov-all-sessions"> ' + t('hunts.coverage.allSessions') + '</label>' +
            '<div class="coverage-opacity-row">' +
            '<span>' + t('hunts.coverage.opacity') + '</span>' +
            '<input type="range" id="cov-hunt-opacity" min="10" max="80" value="40">' +
            '</div>' +
            '</div>' +
            '</div>';

        var cbThis = document.getElementById('cov-this-session');
        var cbAll = document.getElementById('cov-all-sessions');
        var slider = document.getElementById('cov-hunt-opacity');

        cbThis.addEventListener('change', function () {
            if (cbThis.checked) {
                loadHuntCoverage(session.site_id, session.id, 'session');
            } else {
                removeCovLayer('session');
            }
        });

        cbAll.addEventListener('change', function () {
            if (cbAll.checked) {
                loadHuntCoverage(session.site_id, null, 'all');
            } else {
                removeCovLayer('all');
            }
        });

        slider.addEventListener('input', function () {
            state.covOpacity = parseInt(slider.value) / 100;
            if (state.covSessionLayer) state.covSessionLayer.setStyle({ fillOpacity: state.covOpacity });
            if (state.covAllLayer) state.covAllLayer.setStyle({ fillOpacity: Math.max(state.covOpacity - 0.15, 0.1) });
        });
    }

    async function loadHuntCoverage(siteId, sessionId, which) {
        try {
            var url = '/api/sites/' + siteId + '/coverage';
            if (sessionId) url += '?session_id=' + sessionId;
            var res = await Auth.authedFetch(url);
            if (!res.ok) return;
            var json = await res.json();
            if (!json.success || !json.data.coverage) return;

            var geoJSON = json.data.coverage;
            if (!geoJSON.features || geoJSON.features.length === 0) return;

            if (which === 'session') {
                removeCovLayer('session');
                state.covSessionLayer = L.geoJSON(geoJSON, {
                    style: { fillColor: '#22c55e', fillOpacity: state.covOpacity, stroke: false }
                }).addTo(state.detailMap);
            } else {
                removeCovLayer('all');
                state.covAllLayer = L.geoJSON(geoJSON, {
                    style: { fillColor: '#86efac', fillOpacity: Math.max(state.covOpacity - 0.15, 0.1), stroke: false }
                }).addTo(state.detailMap);
            }
        } catch (err) {
            console.error('Failed to load hunt coverage:', err);
        }
    }

    function removeCovLayer(which) {
        if (which === 'session' && state.covSessionLayer && state.detailMap) {
            state.detailMap.removeLayer(state.covSessionLayer);
            state.covSessionLayer = null;
        }
        if (which === 'all' && state.covAllLayer && state.detailMap) {
            state.detailMap.removeLayer(state.covAllLayer);
            state.covAllLayer = null;
        }
    }

    function initDetailMap() {
        if (state.detailMap) {
            state.detailMap.remove();
            state.detailMap = null;
        }
        var mapEl = document.getElementById('detail-map');
        if (!mapEl) return;

        state.detailMap = L.map(mapEl).setView([39.7392, -104.9903], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
            maxZoom: 19,
        }).addTo(state.detailMap);
    }

    async function loadDetailTrackpoints(sessionId) {
        try {
            var res = await Auth.authedFetch('/api/hunts/' + sessionId + '/trackpoints');
            var json = await res.json();
            if (json.success && json.data.segments && state.detailMap) {
                var layer = L.layerGroup().addTo(state.detailMap);
                renderTrackOnMap(json.data.segments, layer, state.detailMap);
            }
        } catch (err) {
            console.error('Failed to load detail trackpoints:', err);
        }
    }

    async function saveDetailNotes() {
        if (!state.detailSession) return;
        try {
            if (btnSaveNotes) btnSaveNotes.disabled = true;
            var res = await Auth.authedFetch('/api/hunts/' + state.detailSession.id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: detailNotes.value }),
            });
            var json = await res.json();
            if (json.success) {
                if (notesMsg) {
                    notesMsg.textContent = t('hunts.updateSuccess');
                    notesMsg.style.color = 'var(--color-status-green)';
                    setTimeout(function () { notesMsg.textContent = ''; }, 3000);
                }
            }
        } catch (err) {
            console.error('Save notes failed:', err);
        } finally {
            if (btnSaveNotes) btnSaveNotes.disabled = false;
        }
    }

    async function deleteHunt() {
        if (!state.detailSession) return;
        if (!confirm(t('hunts.confirmDelete'))) return;

        try {
            var res = await Auth.authedFetch('/api/hunts/' + state.detailSession.id, {
                method: 'DELETE',
            });
            var json = await res.json();
            if (json.success) {
                state.detailSession = null;
                showView('list');
                loadHunts();
            }
        } catch (err) {
            console.error('Delete hunt failed:', err);
        }
    }

    // ---------------------------------------------------------------------------
    // Check for active session on page load
    // ---------------------------------------------------------------------------

    async function checkActiveSession() {
        try {
            var res = await Auth.authedFetch('/api/hunts?status=active&limit=1');
            var json = await res.json();
            if (json.success && json.data.length > 0) {
                enterActiveView(json.data[0]);
                return;
            }

            // Check paused
            var res2 = await Auth.authedFetch('/api/hunts?status=paused&limit=1');
            var json2 = await res2.json();
            if (json2.success && json2.data.length > 0) {
                enterActiveView(json2.data[0]);
                return;
            }
        } catch (err) {
            console.error('Failed to check active session:', err);
        }

        // No active session — show list
        loadHunts();
    }

    // ---------------------------------------------------------------------------
    // Event listeners
    // ---------------------------------------------------------------------------

    if (btnStartHunt) btnStartHunt.addEventListener('click', openStartModal);
    if (btnConfirmStart) btnConfirmStart.addEventListener('click', startHunt);
    if (btnCancelStart) btnCancelStart.addEventListener('click', closeStartModal);
    if (btnStartModalClose) btnStartModalClose.addEventListener('click', closeStartModal);
    if (startModal) {
        startModal.addEventListener('click', function (e) {
            if (e.target === startModal) closeStartModal();
        });
    }

    if (btnPauseHunt) btnPauseHunt.addEventListener('click', pauseOrResume);
    if (btnEndHunt) btnEndHunt.addEventListener('click', endHunt);

    if (btnBackToList) {
        btnBackToList.addEventListener('click', function () {
            state.detailSession = null;
            state.covSessionLayer = null;
            state.covAllLayer = null;
            if (state.detailMap) {
                state.detailMap.remove();
                state.detailMap = null;
            }
            showView('list');
            loadHunts();
        });
    }

    if (filterStatus) filterStatus.addEventListener('change', function () { state.page = 1; loadHunts(); });
    if (filterSite) filterSite.addEventListener('change', function () { state.page = 1; loadHunts(); });

    if (btnSaveNotes) btnSaveNotes.addEventListener('click', saveDetailNotes);
    if (btnDeleteHunt) btnDeleteHunt.addEventListener('click', deleteHunt);

    // ---------------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------------

    loadSites();
    checkActiveSession();

})();
