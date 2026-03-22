/**
 * Dashboard page logic
 * Loads stats, map pins with site-type icons, and recent activity with fly-to
 */
(function () {
    'use strict';

    const PERMISSION_COLORS = {
        granted: '#2ecc40',
        requested: '#ffdc00',
        denied: '#e74c3c',
        not_required: '#3498db',
        not_requested: '#95a5a6'
    };

    /* Site type definitions: icon character, label, CSS class suffix */
    const SITE_TYPES = {
        stagecoach:     { icon: '\uD83D\uDEBB', label: 'Stagecoach Stop',  emoji: '\uD83D\uDE8C', svg: 'M12 2C7 2 3 6 3 11c0 3.5 4 8 9 13 5-5 9-9.5 9-13 0-5-4-9-9-9z' },
        homestead:      { icon: '\uD83C\uDFE0', label: 'Homestead',        emoji: '\uD83C\uDFE0' },
        ranch:          { icon: '\uD83C\uDF3E', label: 'Ranch',            emoji: '\uD83C\uDF3E' },
        creek:          { icon: '\uD83C\uDF0A', label: 'Creek Site',       emoji: '\uD83C\uDF0A' },
        ghost_town:     { icon: '\uD83C\uDFDA', label: 'Ghost Town',       emoji: '\uD83C\uDFDA\uFE0F' },
        magnet_fishing: { icon: '\uD83E\uDDF2', label: 'Magnet Fishing',   emoji: '\uD83E\uDDF2' },
        general:        { icon: '\uD83D\uDCCD', label: 'Other Site',       emoji: '\uD83D\uDCCD' }
    };

    let dashboardMap = null;
    let markersLayer = null;
    let siteMarkers = {};   // keyed by site id for fly-to
    let allSites = [];      // store loaded sites for activity click
    let userLocation = null; // [lat, lng] from geolocation

    /* ------------------------------------------------------------------ */
    /*  Initialisation                                                    */
    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', () => {
        initDashboardMap();
        loadSiteStats();
        loadFindsStats();
        loadMapPins();
        loadRecentActivity();
        loadUpcomingReminders();
    });

    /* ------------------------------------------------------------------ */
    /*  Map                                                               */
    /* ------------------------------------------------------------------ */
    function initDashboardMap() {
        // Default: user's country center, overridden by sites fitBounds or geolocation
        var mapDefaults = (window.AppConfig && AppConfig.getMapDefaults()) || { center: [39.8283, -98.5795], zoom: 4 };
        var defaultCenter = mapDefaults.center;
        var defaultZoom = mapDefaults.zoom;

        if (window.MapModule) {
            dashboardMap = window.MapModule.initMap('dashboard-map', {
                center: defaultCenter,
                zoom: defaultZoom
            });
        } else {
            dashboardMap = L.map('dashboard-map').setView(defaultCenter, defaultZoom);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(dashboardMap);
        }
        markersLayer = L.layerGroup().addTo(dashboardMap);

        // Try to center on user's location if browser supports geolocation
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(function (pos) {
                userLocation = [pos.coords.latitude, pos.coords.longitude];
                // Only fly to user location if no sites have set bounds yet
                if (allSites.length === 0 && dashboardMap) {
                    dashboardMap.setView(userLocation, 8);
                }
            }, function () {
                // Geolocation denied or failed — keep default view
            }, { timeout: 5000, enableHighAccuracy: false });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Determine site type from tags                                     */
    /* ------------------------------------------------------------------ */
    function getSiteType(tags) {
        if (!tags) return 'general';
        var t = (',' + tags.toLowerCase() + ',');
        // Check stagecoach first (most specific)
        if (t.indexOf(',stagecoach,') !== -1 || t.indexOf(',butterfield,') !== -1 || t.indexOf(',smoky-hill-trail,') !== -1) return 'stagecoach';
        // Ghost town before homestead
        if (t.indexOf(',ghost-town,') !== -1 || t.indexOf(',ghost_town,') !== -1) return 'ghost_town';
        // Homestead (check for exact tag matches)
        if (t.indexOf(',homestead,') !== -1 || t.indexOf(',windbreak,') !== -1 || t.indexOf(',foundation,') !== -1 || t.indexOf(',old-ranch,') !== -1) return 'homestead';
        // Ranch/rangeland
        if (t.indexOf(',ranch,') !== -1 || t.indexOf(',corral,') !== -1 || t.indexOf(',rangeland,') !== -1) return 'ranch';
        // Magnet fishing (check before creek so magnet-fishing sites aren't lumped in)
        if (t.indexOf(',magnet-fishing,') !== -1 || t.indexOf(',magnet_fishing,') !== -1 || t.indexOf(',magnet,') !== -1) return 'magnet_fishing';
        // Creek/water sites
        if (t.indexOf(',creek,') !== -1 || t.indexOf(',springs,') !== -1 || t.indexOf(',confluence,') !== -1) return 'creek';
        return 'general';
    }

    /* ------------------------------------------------------------------ */
    /*  Build icon for site type                                          */
    /* ------------------------------------------------------------------ */
    function buildSiteTypeIcon(siteType, permissionStatus) {
        var type = SITE_TYPES[siteType] || SITE_TYPES.general;
        var borderColor = PERMISSION_COLORS[permissionStatus] || PERMISSION_COLORS.not_requested;

        var html = '<div class="site-type-marker" style="border-color:' + borderColor + ';">' +
            '<span class="site-type-emoji">' + type.emoji + '</span>' +
            '</div>';

        return L.divIcon({
            className: 'custom-pin',
            html: html,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
            popupAnchor: [0, -20]
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Data loaders                                                      */
    /* ------------------------------------------------------------------ */
    async function loadSiteStats() {
        try {
            const res = await Auth.authedFetch('/api/sites/stats');
            if (!res.ok) throw new Error('Failed to fetch site stats');
            const json = await res.json();
            const stats = json.data || {};
            document.getElementById('stat-total-sites').textContent = stats.total ?? 0;
            const permitted = (stats.by_permission_status || [])
                .filter(s => s.permission_status === 'granted' || s.permission_status === 'not_required')
                .reduce((sum, s) => sum + s.cnt, 0);
            document.getElementById('stat-permitted-sites').textContent = permitted;
        } catch (err) {
            console.error('Error loading site stats:', err);
            document.getElementById('stat-total-sites').textContent = '0';
            document.getElementById('stat-permitted-sites').textContent = '0';
        }
    }

    async function loadFindsStats() {
        try {
            const res = await Auth.authedFetch('/api/finds/stats');
            if (!res.ok) throw new Error('Failed to fetch finds stats');
            const json = await res.json();
            const stats = json.data || {};
            document.getElementById('stat-total-finds').textContent = stats.total ?? 0;
            const value = parseFloat(stats.total_value ?? 0);
            document.getElementById('stat-estimated-value').textContent = '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } catch (err) {
            console.error('Error loading finds stats:', err);
            document.getElementById('stat-total-finds').textContent = '0';
            document.getElementById('stat-estimated-value').textContent = '$0.00';
        }
    }

    async function loadMapPins() {
        try {
            const res = await Auth.authedFetch('/api/sites/map');
            if (!res.ok) throw new Error('Failed to fetch map data');
            const json = await res.json();
            const sites = json.data || [];
            allSites = sites;

            if (!Array.isArray(sites) || sites.length === 0) return;

            const bounds = [];
            sites.forEach(site => {
                const lat = parseFloat(site.latitude);
                const lng = parseFloat(site.longitude);
                if (isNaN(lat) || isNaN(lng)) return;

                var siteType = getSiteType(site.tags);
                var icon = buildSiteTypeIcon(siteType, site.permission_status);
                const esc = Auth.escapeHtml;

                const typeInfo = SITE_TYPES[siteType] || SITE_TYPES.general;
                const permLabel = (site.permission_status || 'not_requested').replace(/_/g, ' ');
                const landLabel = (site.land_type || '').replace(/_/g, ' ');
                const popup = '<div class="map-popup">' +
                    '<strong>' + esc(site.name || 'Unnamed Site') + '</strong>' +
                    '<p>' + typeInfo.emoji + ' ' + esc(typeInfo.label) + '</p>' +
                    '<p>' + esc(landLabel) + ' &middot; Permission: ' + esc(permLabel) + '</p>' +
                    '<div class="map-popup-actions">' +
                    '<a href="/sites.html#site-' + site.id + '" class="popup-link">View Site</a>' +
                    '</div>' +
                    '</div>';

                var marker = L.marker([lat, lng], { icon: icon })
                    .bindPopup(popup)
                    .addTo(markersLayer);

                siteMarkers[site.id] = marker;
                bounds.push([lat, lng]);
            });

            if (bounds.length > 0) {
                dashboardMap.fitBounds(bounds, { padding: [30, 30] });
            }
        } catch (err) {
            console.error('Error loading map pins:', err);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Fly to a site on the map                                          */
    /* ------------------------------------------------------------------ */
    function flyToSite(siteId) {
        var marker = siteMarkers[siteId];
        if (marker && dashboardMap) {
            dashboardMap.flyTo(marker.getLatLng(), 14, { duration: 1.2 });
            marker.openPopup();
        }
    }

    async function loadRecentActivity() {
        const container = document.getElementById('recent-activity');
        try {
            const res = await Auth.authedFetch('/api/sites?limit=10&sort=created_desc');
            if (!res.ok) throw new Error('Failed to fetch recent activity');
            const json = await res.json();
            const sites = json.data || [];

            if (sites.length === 0) {
                var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };
                container.innerHTML = '<div class="empty-state">' +
                    '<div class="empty-state-icon">&#128205;</div>' +
                    '<h3 class="empty-state-title">' + _t('dashboard.noActivity.title') + '</h3>' +
                    '<p class="empty-state-text">' + _t('dashboard.noActivity.text') + '</p>' +
                    '<a href="/sites.html" class="btn btn--primary">' + _t('dashboard.noActivity.cta') + '</a>' +
                    '</div>';
                return;
            }

            const esc = Auth.escapeHtml;
            let html = '';
            sites.forEach(site => {
                const date = site.created_at ? new Date(site.created_at).toLocaleDateString() : '';
                const statusClass = 'status-' + (site.permission_status || 'not_requested').replace(/_/g, '-');
                const permLabel = (site.permission_status || 'not_requested').replace(/_/g, ' ');
                const landLabel = (site.land_type || '').replace(/_/g, ' ');
                var siteType = getSiteType(site.tags);
                var typeInfo = SITE_TYPES[siteType] || SITE_TYPES.general;

                html += '<div class="activity-card" data-site-id="' + site.id + '" data-lat="' + (site.latitude || '') + '" data-lng="' + (site.longitude || '') + '">' +
                    '<div class="activity-info">' +
                    '<span class="activity-type-icon">' + typeInfo.emoji + '</span>' +
                    '<strong>' + esc(site.name || 'Unnamed') + '</strong>' +
                    '<span class="badge ' + statusClass + '">' + esc(permLabel) + '</span>' +
                    '</div>' +
                    '<div class="activity-meta">' +
                    '<span>' + esc(landLabel) + '</span>' +
                    '<span class="activity-date">' + esc(date) + '</span>' +
                    '</div>' +
                    '</div>';
            });
            container.innerHTML = html;

            // Attach click handlers for fly-to
            container.querySelectorAll('.activity-card[data-site-id]').forEach(function(card) {
                card.addEventListener('click', function() {
                    var siteId = parseInt(this.getAttribute('data-site-id'), 10);
                    flyToSite(siteId);

                    // Highlight the clicked card
                    container.querySelectorAll('.activity-card').forEach(function(c) {
                        c.classList.remove('activity-card-active');
                    });
                    this.classList.add('activity-card-active');

                    // Scroll map into view
                    document.getElementById('dashboard-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
            });
        } catch (err) {
            console.error('Error loading recent activity:', err);
            var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };
            container.innerHTML = '<p class="error-text">' + _t('dashboard.errorLoadingActivity') + '</p>';
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Upcoming Reminders Widget                                         */
    /* ------------------------------------------------------------------ */
    async function loadUpcomingReminders() {
        var widget = document.getElementById('reminders-widget');
        var list = document.getElementById('reminders-list');
        if (!widget || !list) return;

        var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

        try {
            var res = await Auth.authedFetch('/api/reminders?completed=false&limit=5&sort=due_date');
            if (!res.ok) return;
            var json = await res.json();
            var reminders = json.data || [];

            if (reminders.length === 0) {
                widget.style.display = 'none';
                return;
            }

            widget.style.display = '';
            var now = new Date();
            var esc = Auth.escapeHtml;
            var html = '';

            reminders.forEach(function (r) {
                var dueDate = new Date(r.due_date);
                var daysLeft = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
                var dueBadge = '';
                if (daysLeft < 0) {
                    dueBadge = '<span class="reminder-badge reminder-overdue">' + esc(_t('reminders.overdue')) + '</span>';
                } else if (daysLeft <= 7) {
                    dueBadge = '<span class="reminder-badge reminder-urgent">' + daysLeft + 'd</span>';
                } else {
                    dueBadge = '<span class="reminder-badge reminder-normal">' + daysLeft + 'd</span>';
                }

                var typeLabel = _t('reminder_type.' + r.reminder_type) || r.reminder_type;
                var permLink = r.permission_name ? '<span class="reminder-perm">' + esc(r.permission_name) + '</span>' : '';

                html += '<div class="reminder-card" data-reminder-id="' + r.id + '">' +
                    '<label class="reminder-check">' +
                    '<input type="checkbox" class="reminder-checkbox" data-rid="' + r.id + '">' +
                    '</label>' +
                    '<div class="reminder-card-body">' +
                    '<div class="reminder-card-title">' + esc(r.title) + '</div>' +
                    '<div class="reminder-card-meta">' +
                    '<span class="reminder-type-badge">' + esc(typeLabel) + '</span>' +
                    permLink +
                    dueBadge +
                    '</div>' +
                    '</div>' +
                    '</div>';
            });

            list.innerHTML = html;

            // Bind checkbox click to complete reminder
            list.querySelectorAll('.reminder-checkbox').forEach(function (cb) {
                cb.addEventListener('change', async function () {
                    var rid = cb.dataset.rid;
                    try {
                        await Auth.authedFetch('/api/reminders/' + rid + '/complete', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_completed: true }),
                        });
                        // Fade out and reload
                        var card = cb.closest('.reminder-card');
                        if (card) card.style.opacity = '0.3';
                        setTimeout(function () { loadUpcomingReminders(); }, 600);
                    } catch (err) {
                        console.error('Error completing reminder:', err);
                    }
                });
            });
        } catch (err) {
            console.error('Error loading reminders:', err);
        }
    }

})();
