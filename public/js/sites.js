/**
 * Sites management page logic
 * Handles CRUD operations, map interaction, filtering, tags, image upload
 */
(function () {
    'use strict';

    var _t = (typeof I18n !== 'undefined') ? I18n.t : function(k) { return k; };

    /* ------------------------------------------------------------------ */
    /*  Constants & State                                                  */
    /* ------------------------------------------------------------------ */
    const PERMISSION_COLORS = {
        granted: '#2ecc40',
        requested: '#ffdc00',
        denied: '#e74c3c',
        not_required: '#3498db',
        not_requested: '#95a5a6'
    };

    /* Site type definitions matching dashboard icons */
    const SITE_TYPES = {
        stagecoach:     { emoji: '\uD83D\uDE8C', label: 'Stagecoach Stop' },
        homestead:      { emoji: '\uD83C\uDFE0', label: 'Homestead' },
        ranch:          { emoji: '\uD83C\uDF3E', label: 'Ranch' },
        creek:          { emoji: '\uD83C\uDF0A', label: 'Creek Site' },
        ghost_town:     { emoji: '\uD83C\uDFDA\uFE0F', label: 'Ghost Town' },
        magnet_fishing: { emoji: '\uD83E\uDDF2', label: 'Magnet Fishing' },
        general:        { emoji: '\uD83D\uDCCD', label: 'Other Site' }
    };

    let sitesMap = null;
    let markersLayer = null;
    let drawnItems = null;
    let drawControl = null;
    let allSites = [];
    let currentTags = [];
    let selectedPriority = 3;
    let pickingOnMap = false;
    let activeMarkerHighlight = null;
    let mobileMapVisible = false;
    let coverageLayer = null;
    let coverageOpacity = 0.4;

    /* ------------------------------------------------------------------ */
    /*  DOM references                                                    */
    /* ------------------------------------------------------------------ */
    const els = {};
    function cacheElements() {
        els.sitesList = document.getElementById('sites-list');
        els.modalOverlay = document.getElementById('site-modal-overlay');
        els.modal = document.getElementById('site-modal');
        els.modalTitle = document.getElementById('site-modal-title');
        els.form = document.getElementById('site-form');
        els.siteId = document.getElementById('site-id');
        els.name = document.getElementById('site-name');
        els.description = document.getElementById('site-description');
        els.latitude = document.getElementById('site-latitude');
        els.longitude = document.getElementById('site-longitude');
        els.imageInput = document.getElementById('site-image');
        els.imagePreview = document.getElementById('site-image-preview');
        els.uploadPlaceholder = document.getElementById('site-upload-placeholder');
        els.uploadArea = document.getElementById('site-upload-area');
        els.landType = document.getElementById('site-land-type');
        els.permissionStatus = document.getElementById('site-permission-status');
        els.contactName = document.getElementById('site-contact-name');
        els.contactPhone = document.getElementById('site-contact-phone');
        els.contactEmail = document.getElementById('site-contact-email');
        els.legalNotes = document.getElementById('site-legal-notes');
        els.status = document.getElementById('site-status');
        els.prioritySelector = document.getElementById('site-priority-selector');
        els.priorityInput = document.getElementById('site-priority');
        els.notes = document.getElementById('site-notes');
        els.tagsInput = document.getElementById('site-tags-input');
        els.tagsHidden = document.getElementById('site-tags');
        els.tagsDisplay = document.getElementById('site-tags-display');
        els.tagSuggestions = document.getElementById('tag-suggestions');
        els.btnAdd = document.getElementById('btn-add-site');
        els.btnClose = document.getElementById('btn-modal-close');
        els.btnCancel = document.getElementById('btn-cancel-site');
        els.btnDelete = document.getElementById('btn-delete-site');
        els.btnSave = document.getElementById('btn-save-site');
        els.btnPick = document.getElementById('btn-pick-on-map');
        els.filterStatus = document.getElementById('filter-status');
        els.filterLandType = document.getElementById('filter-land-type');
        els.filterPriority = document.getElementById('filter-priority');
        els.filterTags = document.getElementById('filter-tags');
        els.mapPanel = document.getElementById('sites-map-panel');
        els.btnToggleMap = document.getElementById('btn-toggle-map');
        els.toggleMapIcon = document.getElementById('toggle-map-icon');
        els.toggleMapLabel = document.getElementById('toggle-map-label');
        els.btnQuickAddHeader = document.getElementById('btn-quick-add-header');
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                              */
    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', () => {
        cacheElements();
        initSitesMap();
        bindEvents();
        initBulkImport();
        function startLoad() {
            loadSites();
            // Populate land type dropdown from AppConfig once ready
            if (window.AppConfig) {
                AppConfig.onReady(function () {
                    AppConfig.populateLandTypeSelect(els.landType);
                });
            }
        }
        if (window.I18n) { I18n.onReady(startLoad); } else { startLoad(); }
    });

    /* ------------------------------------------------------------------ */
    /*  Map Setup                                                         */
    /* ------------------------------------------------------------------ */
    function initSitesMap() {
        var mapDefaults = (window.AppConfig && AppConfig.getMapDefaults()) || { center: [39.8283, -98.5795], zoom: 4 };
        var defaultCenter = mapDefaults.center;
        var defaultZoom = mapDefaults.zoom;

        if (window.MapModule) {
            sitesMap = window.MapModule.initMap('sites-map', {
                center: defaultCenter,
                zoom: defaultZoom
            });
        } else {
            sitesMap = L.map('sites-map').setView(defaultCenter, defaultZoom);
            // Only add layers if MapModule wasn't used (it already adds them)
            var streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            });
            var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: '&copy; Esri'
            });
            streets.addTo(sitesMap);
            L.control.layers({ 'Streets': streets, 'Satellite': satellite }).addTo(sitesMap);
        }

        markersLayer = L.layerGroup().addTo(sitesMap);

        // Leaflet.draw for boundary drawing (hidden by default, shown when editing)
        drawnItems = new L.FeatureGroup();
        sitesMap.addLayer(drawnItems);
        drawControl = new L.Control.Draw({
            edit: { featureGroup: drawnItems },
            draw: {
                polygon: true,
                rectangle: true,
                polyline: false,
                circle: false,
                circlemarker: false,
                marker: false
            }
        });
        // Don't add draw control by default - only when editing boundaries
        sitesMap.on(L.Draw.Event.CREATED, function (e) {
            drawnItems.addLayer(e.layer);
        });

        // Click handler for pin placement
        sitesMap.on('click', function (e) {
            if (pickingOnMap) {
                els.latitude.value = e.latlng.lat.toFixed(6);
                els.longitude.value = e.latlng.lng.toFixed(6);
                pickingOnMap = false;
                sitesMap.getContainer().style.cursor = '';
                openModal();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Event Bindings                                                    */
    /* ------------------------------------------------------------------ */
    function bindEvents() {
        els.btnAdd.addEventListener('click', () => openModal());
        els.btnClose.addEventListener('click', closeModal);
        els.btnCancel.addEventListener('click', closeModal);
        els.modalOverlay.addEventListener('click', (e) => {
            if (e.target === els.modalOverlay) closeModal();
        });
        els.form.addEventListener('submit', handleFormSubmit);
        els.btnDelete.addEventListener('click', handleDelete);
        els.btnPick.addEventListener('click', startPickOnMap);

        // Star selector
        els.prioritySelector.querySelectorAll('.star').forEach(star => {
            star.addEventListener('click', () => {
                selectedPriority = parseInt(star.dataset.value);
                els.priorityInput.value = selectedPriority;
                renderStars();
            });
        });

        // Tag input
        els.tagsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag(els.tagsInput.value.trim());
                els.tagsInput.value = '';
            }
        });

        // Tag suggestion chips
        els.tagSuggestions.querySelectorAll('.suggestion').forEach(chip => {
            chip.addEventListener('click', () => {
                addTag(chip.dataset.tag);
            });
        });

        // Image upload - click and drag-drop
        els.uploadArea.addEventListener('click', () => els.imageInput.click());
        els.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            els.uploadArea.classList.add('drag-over');
        });
        els.uploadArea.addEventListener('dragleave', () => {
            els.uploadArea.classList.remove('drag-over');
        });
        els.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            els.uploadArea.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                els.imageInput.files = e.dataTransfer.files;
                previewImage(e.dataTransfer.files[0]);
            }
        });
        els.imageInput.addEventListener('change', () => {
            if (els.imageInput.files.length > 0) {
                previewImage(els.imageInput.files[0]);
            }
        });

        // Filters
        els.filterStatus.addEventListener('change', applyFilters);
        els.filterLandType.addEventListener('change', applyFilters);
        els.filterPriority.addEventListener('change', applyFilters);
        els.filterTags.addEventListener('input', applyFilters);

        // Mobile map toggle
        if (els.btnToggleMap) {
            els.btnToggleMap.addEventListener('click', toggleMobileMap);
        }

        // Quick Add button in header
        if (els.btnQuickAddHeader) {
            els.btnQuickAddHeader.addEventListener('click', function () {
                if (window.QuickAddSite) window.QuickAddSite.open();
            });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Mobile Map Toggle                                                  */
    /* ------------------------------------------------------------------ */
    function toggleMobileMap(forceShow) {
        mobileMapVisible = forceShow === true ? true : !mobileMapVisible;

        if (mobileMapVisible) {
            els.mapPanel.classList.remove('map-panel-collapsed');
            els.mapPanel.classList.add('map-panel-expanded');
            els.toggleMapIcon.innerHTML = '&#10005;';
            els.toggleMapLabel.textContent = 'Hide Map';
            // Leaflet needs invalidateSize after becoming visible
            setTimeout(function () {
                if (sitesMap) sitesMap.invalidateSize();
            }, 100);
        } else {
            els.mapPanel.classList.remove('map-panel-expanded');
            els.mapPanel.classList.add('map-panel-collapsed');
            els.toggleMapIcon.innerHTML = '&#128506;';
            els.toggleMapLabel.textContent = _t('sites.showMap');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Data Loading                                                      */
    /* ------------------------------------------------------------------ */
    async function loadSites() {
        try {
            const res = await Auth.authedFetch('/api/sites');
            if (!res.ok) throw new Error('Failed to fetch sites');
            const json = await res.json();
            allSites = json.data || [];
            applyFilters();
            plotSitesOnMap(allSites);
            handleUrlHash();
        } catch (err) {
            console.error('Error loading sites:', err);
            els.sitesList.innerHTML = '<p class="error-text">' + _t('sites.errorLoading') + '</p>';
        }
    }

    /* ------------------------------------------------------------------ */
    /*  URL Hash Navigation (#site-{id})                                  */
    /* ------------------------------------------------------------------ */
    function handleUrlHash() {
        var hash = window.location.hash;
        if (!hash || !hash.startsWith('#site-')) return;

        var siteId = hash.replace('#site-', '');
        var site = allSites.find(function(s) { return String(s.id) === siteId; });
        if (!site) return;

        // Scroll the site card into view
        var card = els.sitesList.querySelector('.site-card[data-id="' + siteId + '"]');
        if (card) {
            // Small delay to let DOM settle
            setTimeout(function() {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('active');
                // Remove highlight after a few seconds
                setTimeout(function() { card.classList.remove('active'); }, 4000);
            }, 300);
        }

        // Fly the map to the site and open its popup
        highlightSiteOnMap(site);

        // Also open the detail panel
        showDetailPanel(site);

        // Clear the hash so refreshing doesn't re-trigger
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname);
        }
    }

    function applyFilters() {
        let filtered = [...allSites];

        const statusVal = els.filterStatus.value;
        if (statusVal) filtered = filtered.filter(s => s.status === statusVal);

        const landVal = els.filterLandType.value;
        if (landVal) filtered = filtered.filter(s => s.land_type === landVal);

        const prioVal = els.filterPriority.value;
        if (prioVal) filtered = filtered.filter(s => (s.priority || 0) >= parseInt(prioVal));

        const tagVal = els.filterTags.value.trim().toLowerCase();
        if (tagVal) {
            filtered = filtered.filter(s => {
                const tags = Array.isArray(s.tags) ? s.tags : (s.tags ? s.tags.split(',') : []);
                return tags.some(t => t.toLowerCase().includes(tagVal));
            });
        }

        renderSitesList(filtered);
        plotSitesOnMap(filtered);
    }

    /* ------------------------------------------------------------------ */
    /*  Rendering                                                         */
    /* ------------------------------------------------------------------ */
    function renderSitesList(sites) {
        if (sites.length === 0) {
            els.sitesList.innerHTML = '<p class="empty-text">' + _t('sites.empty') + '</p>';
            return;
        }

        const esc = window.MapModule ? window.MapModule.escapeHtml : escapeHtmlLocal;
        let html = '';
        sites.forEach(site => {
            const statusClass = 'status-' + (site.permission_status || 'not_requested').replace(/_/g, '-');
            const tags = Array.isArray(site.tags) ? site.tags : (site.tags ? site.tags.split(',') : []);
            const stars = renderStarsHtml(site.priority || 0);
            const thumb = site.image_url
                ? '<img src="' + esc(Auth.secureUrl(site.image_url)) + '" class="site-card-thumb" alt="Site">'
                : '<div class="site-card-thumb-placeholder">&#128205;</div>';
            const statusLabel = (site.status || site.site_status || 'identified').replace(/_/g, ' ');

            html += '<div class="site-card" data-id="' + site.id + '">' +
                '<div class="site-card-image">' + thumb + '</div>' +
                '<div class="site-card-body">' +
                '<div class="site-card-header">' +
                '<h3 class="site-card-title">' + esc(site.name || 'Unnamed') + '</h3>' +
                '<span class="badge ' + statusClass + '">' + esc((site.permission_status || 'N/A').replace(/_/g, ' ')) + '</span>' +
                '</div>' +
                '<div class="site-card-meta">' +
                '<span class="land-type">' + esc((site.land_type || '').replace(/_/g, ' ')) + '</span>' +
                ' <span class="site-status-label">' + esc(statusLabel) + '</span>' +
                '<span class="priority-stars">' + stars + '</span>' +
                '</div>' +
                '<div class="site-card-tags">' +
                tags.map(t => '<span class="tag-chip">' + esc(t.trim()) + '</span>').join('') +
                '</div>' +
                '<div class="site-card-actions">' +
                '<button class="btn btn-sm btn-view" data-id="' + site.id + '" title="View details">View</button>' +
                '<button class="btn btn-sm btn-edit" data-id="' + site.id + '" title="Edit site">Edit</button>' +
                '<button class="btn btn-sm btn-map-focus" data-id="' + site.id + '" title="Show on map">Map</button>' +
                '</div>' +
                '</div>' +
                '</div>';
        });
        els.sitesList.innerHTML = html;

        // Bind action button events
        els.sitesList.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const site = allSites.find(s => String(s.id) === String(btn.dataset.id));
                if (site) showDetailPanel(site);
            });
        });
        els.sitesList.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const site = allSites.find(s => String(s.id) === String(btn.dataset.id));
                if (site) openModal(site);
            });
        });
        els.sitesList.querySelectorAll('.btn-map-focus').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const site = allSites.find(s => String(s.id) === String(btn.dataset.id));
                if (site) highlightSiteOnMap(site);
            });
        });
        // Click on card body also opens detail
        els.sitesList.querySelectorAll('.site-card').forEach(card => {
            card.addEventListener('click', () => {
                const site = allSites.find(s => String(s.id) === String(card.dataset.id));
                if (site) showDetailPanel(site);
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Inline Detail Expansion (expands below the card in list panel)    */
    /* ------------------------------------------------------------------ */
    function showDetailPanel(site) {
        const esc = window.MapModule ? window.MapModule.escapeHtml : escapeHtmlLocal;

        // Close any previously open detail
        closeDetailExpansion();

        // Find the site card
        var card = els.sitesList.querySelector('.site-card[data-id="' + site.id + '"]');
        if (!card) return;

        const tags = Array.isArray(site.tags) ? site.tags : (site.tags ? site.tags.split(',') : []);
        const stars = renderStarsHtml(site.priority || 0);
        const statusLabel = (site.status || site.site_status || 'identified').replace(/_/g, ' ');
        const permLabel = (site.permission_status || 'not_requested').replace(/_/g, ' ');
        const landLabel = (site.land_type || 'unknown').replace(/_/g, ' ');

        let contactHtml = '';
        if (site.contact_name || site.contact_phone || site.contact_email) {
            contactHtml = '<div class="detail-section"><h4>Contact</h4>';
            if (site.contact_name) contactHtml += '<p>' + esc(site.contact_name) + '</p>';
            if (site.contact_phone) contactHtml += '<p>' + esc(site.contact_phone) + '</p>';
            if (site.contact_email) contactHtml += '<p>' + esc(site.contact_email) + '</p>';
            contactHtml += '</div>';
        }

        var expansion = document.createElement('div');
        expansion.className = 'card-detail-expansion';

        // Only show info NOT already on the card (card has: image, name, status, stars, tags, buttons)
        var sections = '';
        if (site.description) {
            sections += '<div class="detail-section"><h4>Description</h4><p>' + esc(site.description) + '</p></div>';
        }
        sections += '<div class="detail-section"><h4>Location</h4><p>' + esc(String(site.latitude || '')) + ', ' + esc(String(site.longitude || '')) + '</p></div>';
        sections += contactHtml;
        if (site.legal_notes) {
            sections += '<div class="detail-section"><h4>Legal Notes</h4><p>' + linkifyUrls(esc(site.legal_notes)) + '</p></div>';
        }
        if (site.notes) {
            sections += '<div class="detail-section"><h4>Notes</h4><p>' + linkifyUrls(esc(site.notes)) + '</p></div>';
        }

        // Coverage section placeholder (populated asynchronously)
        var coverageSectionHtml = '<div class="coverage-section hidden" id="coverage-section-' + site.id + '"></div>';

        expansion.innerHTML =
            '<div class="card-detail-inner">' +
            '<div class="card-detail-header">' +
            '<span>Details</span>' +
            '<button class="btn-close-detail" title="Close">&times;</button>' +
            '</div>' +
            sections +
            coverageSectionHtml +
            '<div class="detail-actions">' +
            '<button class="btn btn-primary detail-edit-btn" data-id="' + site.id + '">Edit Site</button>' +
            '<button class="btn btn-secondary detail-map-btn" data-id="' + site.id + '">Show on Map</button>' +
            '<button class="btn btn-secondary detail-share-btn" data-id="' + site.id + '" title="Share this site">Share</button>' +
            '<button class="btn btn-secondary detail-print-btn" data-id="' + site.id + '" title="Print site info">Print Report</button>' +
            '<button class="btn btn-secondary detail-letter-btn" data-id="' + site.id + '" title="Generate permission letter">Permission Letter</button>' +
            '</div>' +
            '</div>';

        // Insert after the card
        card.after(expansion);
        card.classList.add('card-expanded');

        // Animate in
        requestAnimationFrame(function() {
            expansion.classList.add('open');
        });

        // Scroll the expansion into view
        setTimeout(function() {
            expansion.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);

        // Bind close button
        expansion.querySelector('.btn-close-detail').addEventListener('click', function() {
            closeDetailExpansion();
        });
        expansion.querySelector('.detail-edit-btn').addEventListener('click', function() {
            closeDetailExpansion();
            openModal(site);
        });
        expansion.querySelector('.detail-map-btn').addEventListener('click', function() {
            highlightSiteOnMap(site);
        });
        expansion.querySelector('.detail-share-btn').addEventListener('click', function() {
            openShareModal(site);
        });
        expansion.querySelector('.detail-print-btn').addEventListener('click', function() {
            window.open('/print-site.html?siteId=' + site.id, '_blank');
        });
        expansion.querySelector('.detail-letter-btn').addEventListener('click', function() {
            window.open('/print-permission.html?siteId=' + site.id, '_blank');
        });

        // Load coverage data asynchronously
        loadSiteCoverage(site.id);
    }

    function closeDetailExpansion() {
        var existing = els.sitesList.querySelector('.card-detail-expansion');
        if (existing) {
            existing.classList.remove('open');
            // Remove after transition
            setTimeout(function() { if (existing.parentNode) existing.parentNode.removeChild(existing); }, 300);
        }
        els.sitesList.querySelectorAll('.card-expanded').forEach(function(c) {
            c.classList.remove('card-expanded');
        });
        // Remove coverage overlay
        removeCoverageLayer();
    }

    /* ------------------------------------------------------------------ */
    /*  Coverage Overlay                                                   */
    /* ------------------------------------------------------------------ */
    function removeCoverageLayer() {
        if (coverageLayer && sitesMap) {
            sitesMap.removeLayer(coverageLayer);
            coverageLayer = null;
        }
    }

    async function loadSiteCoverage(siteId) {
        var section = document.getElementById('coverage-section-' + siteId);
        if (!section) return;

        try {
            var res = await Auth.authedFetch('/api/sites/' + siteId + '/coverage');
            if (!res.ok) return;
            var json = await res.json();
            if (!json.success) return;

            var stats = json.data.stats;
            var covGeoJSON = json.data.coverage;

            // Nothing to show?
            if (stats.total_points === 0) return;

            // Build coverage section
            var html = '<h4>' + _t('sites.coverage.title') + '</h4>';

            // Badge: percentage or cell count
            if (stats.coverage_percentage !== undefined) {
                html += '<span class="coverage-badge">' + stats.coverage_percentage + '% ' + _t('sites.coverage.covered') + '</span>';
            } else {
                html += '<span class="coverage-badge">' + stats.unique_cells.toLocaleString() + ' ' + _t('sites.coverage.cellsCovered') + '</span>';
            }

            // Last hunted
            if (stats.last_hunted) {
                var d = new Date(stats.last_hunted);
                html += '<div class="coverage-last-hunted">' + _t('sites.coverage.lastHunted') + ': ' + d.toLocaleDateString() + '</div>';
            }

            // Toggle + opacity slider
            html += '<div class="coverage-controls">' +
                '<label><input type="checkbox" id="cov-toggle-' + siteId + '"> ' + _t('sites.coverage.showOverlay') + '</label>' +
                '<div class="coverage-opacity-row">' +
                '<span>' + _t('sites.coverage.opacity') + '</span>' +
                '<input type="range" id="cov-opacity-' + siteId + '" min="10" max="80" value="40">' +
                '</div>' +
                '</div>';

            section.innerHTML = html;
            section.classList.remove('hidden');

            // Bind toggle
            var toggle = document.getElementById('cov-toggle-' + siteId);
            var opacitySlider = document.getElementById('cov-opacity-' + siteId);

            toggle.addEventListener('change', function() {
                if (toggle.checked) {
                    showCoverageOnMap(covGeoJSON, coverageOpacity);
                } else {
                    removeCoverageLayer();
                }
            });

            opacitySlider.addEventListener('input', function() {
                coverageOpacity = parseInt(opacitySlider.value) / 100;
                if (coverageLayer) {
                    coverageLayer.setStyle({ fillOpacity: coverageOpacity });
                }
            });
        } catch (err) {
            console.error('Failed to load coverage:', err);
        }
    }

    function showCoverageOnMap(geoJSON, opacity) {
        removeCoverageLayer();
        if (!sitesMap || !geoJSON || !geoJSON.features || geoJSON.features.length === 0) return;
        coverageLayer = L.geoJSON(geoJSON, {
            style: {
                fillColor: '#22c55e',
                fillOpacity: opacity,
                stroke: false
            }
        }).addTo(sitesMap);
    }

    function renderStarsHtml(count) {
        let html = '';
        for (let i = 1; i <= 5; i++) {
            html += '<span class="star ' + (i <= count ? 'active' : '') + '">&#9733;</span>';
        }
        return html;
    }

    function renderStars() {
        els.prioritySelector.querySelectorAll('.star').forEach(star => {
            const val = parseInt(star.dataset.value);
            star.classList.toggle('active', val <= selectedPriority);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Map Plotting                                                      */
    /* ------------------------------------------------------------------ */
    function getSiteType(tags) {
        if (!tags) return 'general';
        var t = (',' + (Array.isArray(tags) ? tags.join(',') : tags).toLowerCase() + ',');
        if (t.indexOf(',stagecoach,') !== -1 || t.indexOf(',butterfield,') !== -1 || t.indexOf(',smoky-hill-trail,') !== -1) return 'stagecoach';
        if (t.indexOf(',ghost-town,') !== -1 || t.indexOf(',ghost_town,') !== -1) return 'ghost_town';
        if (t.indexOf(',homestead,') !== -1 || t.indexOf(',windbreak,') !== -1 || t.indexOf(',foundation,') !== -1 || t.indexOf(',old-ranch,') !== -1) return 'homestead';
        if (t.indexOf(',ranch,') !== -1 || t.indexOf(',corral,') !== -1 || t.indexOf(',rangeland,') !== -1) return 'ranch';
        if (t.indexOf(',magnet-fishing,') !== -1 || t.indexOf(',magnet_fishing,') !== -1 || t.indexOf(',magnet,') !== -1) return 'magnet_fishing';
        if (t.indexOf(',creek,') !== -1 || t.indexOf(',springs,') !== -1 || t.indexOf(',confluence,') !== -1) return 'creek';
        return 'general';
    }

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

    function plotSitesOnMap(sites) {
        markersLayer.clearLayers();
        const bounds = [];
        const esc = window.MapModule ? window.MapModule.escapeHtml : escapeHtmlLocal;

        sites.forEach(site => {
            const lat = parseFloat(site.latitude);
            const lng = parseFloat(site.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            var siteType = getSiteType(site.tags);
            var icon = buildSiteTypeIcon(siteType, site.permission_status);
            var typeInfo = SITE_TYPES[siteType] || SITE_TYPES.general;
            var permLabel = (site.permission_status || 'not_requested').replace(/_/g, ' ');
            var landLabel = (site.land_type || '').replace(/_/g, ' ');

            const popup = '<div class="map-popup">' +
                '<strong>' + esc(site.name || 'Unnamed') + '</strong>' +
                '<p>' + typeInfo.emoji + ' ' + esc(typeInfo.label) + '</p>' +
                '<p>' + esc(landLabel) + ' &middot; Permission: ' + esc(permLabel) + '</p>' +
                '<button class="btn btn-sm btn-primary popup-edit-btn" data-id="' + site.id + '">Edit</button>' +
                '</div>';

            const marker = L.marker([lat, lng], { icon: icon, siteId: site.id })
                .bindPopup(popup)
                .addTo(markersLayer);

            marker.on('popupopen', () => {
                const btn = document.querySelector('.popup-edit-btn[data-id="' + site.id + '"]');
                if (btn) {
                    btn.addEventListener('click', () => {
                        openModal(site);
                    });
                }
            });

            bounds.push([lat, lng]);
        });

        if (bounds.length > 0) {
            sitesMap.fitBounds(bounds, { padding: [30, 30] });
        } else if (navigator.geolocation) {
            // No sites yet — try to center on user's location
            navigator.geolocation.getCurrentPosition(function (pos) {
                sitesMap.setView([pos.coords.latitude, pos.coords.longitude], 8);
            }, function () {}, { timeout: 5000, enableHighAccuracy: false });
        }
    }

    function highlightSiteOnMap(site) {
        const lat = parseFloat(site.latitude);
        const lng = parseFloat(site.longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        // Auto-show map on mobile if hidden
        if (!mobileMapVisible && window.innerWidth < 768) {
            toggleMobileMap(true);
        }

        // Small delay to let map container resize
        setTimeout(function () {
            sitesMap.setView([lat, lng], 14);

            // Find and open the marker popup
            markersLayer.eachLayer(layer => {
                if (layer.options.siteId && String(layer.options.siteId) === String(site.id)) {
                    layer.openPopup();
                }
            });
        }, mobileMapVisible ? 0 : 200);
    }

    /* ------------------------------------------------------------------ */
    /*  Modal                                                             */
    /* ------------------------------------------------------------------ */
    function openModal(site) {
        if (site) {
            els.modalTitle.textContent = _t('sites.modal.editTitle');
            els.siteId.value = site.id;
            els.name.value = site.name || '';
            els.description.value = site.description || '';
            els.latitude.value = site.latitude || '';
            els.longitude.value = site.longitude || '';
            if (window.AppConfig) {
                AppConfig.populateLandTypeSelect(els.landType, site.land_type || '');
            } else {
                els.landType.value = site.land_type || '';
            }
            els.permissionStatus.value = site.permission_status || 'not_requested';
            els.contactName.value = site.contact_name || '';
            els.contactPhone.value = site.contact_phone || '';
            els.contactEmail.value = site.contact_email || '';
            els.legalNotes.value = site.legal_notes || '';
            els.status.value = site.status || 'planned';
            selectedPriority = site.priority || 3;
            els.priorityInput.value = selectedPriority;
            els.notes.value = site.notes || '';
            currentTags = Array.isArray(site.tags) ? [...site.tags] : (site.tags ? site.tags.split(',').map(t => t.trim()) : []);
            els.btnDelete.classList.remove('hidden');

            if (site.image_url) {
                els.imagePreview.src = Auth.secureUrl(site.image_url);
                els.imagePreview.classList.remove('hidden');
                els.uploadPlaceholder.classList.add('hidden');
            } else {
                els.imagePreview.classList.add('hidden');
                els.uploadPlaceholder.classList.remove('hidden');
            }
        } else {
            els.modalTitle.textContent = _t('sites.modal.addTitle');
            els.form.reset();
            els.siteId.value = '';
            selectedPriority = 3;
            els.priorityInput.value = 3;
            currentTags = [];
            els.btnDelete.classList.add('hidden');
            els.imagePreview.classList.add('hidden');
            els.uploadPlaceholder.classList.remove('hidden');
        }

        renderStars();
        renderTags();
        els.modalOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        els.modalOverlay.classList.remove('open');
        document.body.style.overflow = '';
        pickingOnMap = false;
        sitesMap.getContainer().style.cursor = '';
    }

    /* ------------------------------------------------------------------ */
    /*  Tags                                                              */
    /* ------------------------------------------------------------------ */
    function addTag(tag) {
        tag = tag.replace(/,/g, '').trim();
        if (!tag || currentTags.includes(tag)) return;
        currentTags.push(tag);
        renderTags();
    }

    function removeTag(tag) {
        currentTags = currentTags.filter(t => t !== tag);
        renderTags();
    }

    function renderTags() {
        const esc = window.MapModule ? window.MapModule.escapeHtml : escapeHtmlLocal;
        els.tagsDisplay.innerHTML = currentTags.map(t =>
            '<span class="tag-chip">' + esc(t) + ' <button type="button" class="tag-remove" data-tag="' + esc(t) + '">&times;</button></span>'
        ).join('');
        els.tagsHidden.value = currentTags.join(',');

        els.tagsDisplay.querySelectorAll('.tag-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeTag(btn.dataset.tag);
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Image Preview                                                     */
    /* ------------------------------------------------------------------ */
    function previewImage(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            els.imagePreview.src = e.target.result;
            els.imagePreview.classList.remove('hidden');
            els.uploadPlaceholder.classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }

    /* ------------------------------------------------------------------ */
    /*  Pick on Map                                                       */
    /* ------------------------------------------------------------------ */
    function startPickOnMap() {
        pickingOnMap = true;
        closeModal();
        sitesMap.getContainer().style.cursor = 'crosshair';
    }

    /* ------------------------------------------------------------------ */
    /*  Form Submit (Create/Update)                                       */
    /* ------------------------------------------------------------------ */
    async function handleFormSubmit(e) {
        e.preventDefault();

        const formData = new FormData();
        formData.append('name', els.name.value.trim());
        formData.append('description', els.description.value.trim());
        formData.append('latitude', els.latitude.value);
        formData.append('longitude', els.longitude.value);
        formData.append('land_type', els.landType.value);
        formData.append('permission_status', els.permissionStatus.value);
        formData.append('contact_name', els.contactName.value.trim());
        formData.append('contact_phone', els.contactPhone.value.trim());
        formData.append('contact_email', els.contactEmail.value.trim());
        formData.append('legal_notes', els.legalNotes.value.trim());
        formData.append('status', els.status.value);
        formData.append('priority', els.priorityInput.value);
        formData.append('notes', els.notes.value.trim());
        formData.append('tags', currentTags.join(','));

        if (els.imageInput.files.length > 0) {
            formData.append('image', els.imageInput.files[0]);
        }

        const id = els.siteId.value;
        const url = id ? '/api/sites/' + id : '/api/sites';
        const method = id ? 'PUT' : 'POST';

        try {
            els.btnSave.disabled = true;
            els.btnSave.textContent = _t('sites.modal.saving');
            const res = await Auth.authedFetch(url, { method: method, body: formData });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || 'Failed to save site');
            }
            closeModal();
            await loadSites();
        } catch (err) {
            console.error('Error saving site:', err);
            Auth.showToast(_t('sites.errorSaving'));
        } finally {
            els.btnSave.disabled = false;
            els.btnSave.textContent = _t('sites.modal.save');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Delete                                                            */
    /* ------------------------------------------------------------------ */
    async function handleDelete() {
        const id = els.siteId.value;
        if (!id) return;
        if (!confirm(_t('sites.confirmDelete'))) return;

        try {
            const res = await Auth.authedFetch('/api/sites/' + id, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete site');
            closeModal();
            await loadSites();
        } catch (err) {
            console.error('Error deleting site:', err);
            Auth.showToast(_t('sites.errorDeleting'));
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Bulk Import                                                       */
    /* ------------------------------------------------------------------ */
    let bulkParsedSites = [];

    function initBulkImport() {
        const btnBulk = document.getElementById('btn-bulk-import');
        const overlay = document.getElementById('bulk-modal-overlay');
        const btnClose = document.getElementById('btn-bulk-close');
        const btnPreview = document.getElementById('btn-bulk-preview');
        const btnSubmit = document.getElementById('btn-bulk-submit');
        const fileInput = document.getElementById('bulk-file');

        if (!btnBulk) return;

        btnBulk.addEventListener('click', () => {
            overlay.classList.add('open');
            document.body.style.overflow = 'hidden';
        });
        btnClose.addEventListener('click', () => {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('open');
                document.body.style.overflow = '';
            }
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    document.getElementById('bulk-data').value = e.target.result;
                };
                reader.readAsText(fileInput.files[0]);
            }
        });

        btnPreview.addEventListener('click', parseBulkData);
        btnSubmit.addEventListener('click', submitBulkImport);
    }

    function parseBulkData() {
        const format = document.getElementById('bulk-format').value;
        const raw = document.getElementById('bulk-data').value.trim();
        const preview = document.getElementById('bulk-preview');
        const list = document.getElementById('bulk-preview-list');
        const count = document.getElementById('bulk-count');
        const btnSubmit = document.getElementById('btn-bulk-submit');

        bulkParsedSites = [];

        try {
            if (format === 'json') {
                bulkParsedSites = JSON.parse(raw);
                if (!Array.isArray(bulkParsedSites)) bulkParsedSites = [bulkParsedSites];
            } else {
                // CSV: name,latitude,longitude,land_type,description,tags
                const lines = raw.split('\n').filter(l => l.trim());
                // skip header if first line looks like headers
                const start = (lines[0] && lines[0].toLowerCase().includes('name')) ? 1 : 0;
                for (let i = start; i < lines.length; i++) {
                    const parts = lines[i].split(',').map(s => s.trim());
                    if (parts.length >= 3 && parts[0]) {
                        bulkParsedSites.push({
                            name: parts[0],
                            latitude: parseFloat(parts[1]) || null,
                            longitude: parseFloat(parts[2]) || null,
                            land_type: parts[3] || 'unknown',
                            description: parts[4] || '',
                            tags: parts[5] || ''
                        });
                    }
                }
            }

            const esc = window.MapModule ? window.MapModule.escapeHtml : escapeHtmlLocal;
            count.textContent = bulkParsedSites.length;
            list.innerHTML = bulkParsedSites.map(s =>
                '<div class="bulk-preview-item"><strong>' + esc(s.name || '?') + '</strong> &mdash; ' +
                esc(String(s.latitude || '')) + ', ' + esc(String(s.longitude || '')) +
                (s.land_type ? ' (' + esc(s.land_type) + ')' : '') + '</div>'
            ).join('');
            preview.classList.remove('hidden');
            btnSubmit.disabled = bulkParsedSites.length === 0;
        } catch (err) {
            console.error('Bulk import parse error:', err);
            Auth.showToast('Failed to parse file. Please check the format and try again.');
            preview.classList.add('hidden');
            btnSubmit.disabled = true;
        }
    }

    async function submitBulkImport() {
        const btnSubmit = document.getElementById('btn-bulk-submit');
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Importing...';

        let imported = 0;
        for (const site of bulkParsedSites) {
            try {
                const res = await Auth.authedFetch('/api/sites', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: site.name,
                        latitude: site.latitude,
                        longitude: site.longitude,
                        land_type: site.land_type || 'unknown',
                        description: site.description || '',
                        tags: site.tags || '',
                        permission_status: site.permission_status || 'not_requested',
                        status: site.status || 'identified',
                        priority: site.priority || 3,
                        notes: site.notes || ''
                    })
                });
                if (res.ok) imported++;
            } catch (err) {
                console.error('Failed to import:', site.name, err);
            }
        }

        btnSubmit.textContent = _t('sites.bulk.btnImport');
        btnSubmit.disabled = false;
        Auth.showToast(_t('sites.bulk.imported', { imported: imported, total: bulkParsedSites.length }), 'success');

        document.getElementById('bulk-modal-overlay').classList.remove('open');
        document.body.style.overflow = '';
        await loadSites();
    }

    /* ------------------------------------------------------------------ */
    /*  Utility                                                           */
    /* ------------------------------------------------------------------ */
    function escapeHtmlLocal(str) {
        return window.Auth ? Auth.escapeHtml(str) : (str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '');
    }

    /**
     * Turn URLs in already-escaped text into clickable links (opens in new window).
     */
    function linkifyUrls(escapedText) {
        if (!escapedText) return '';
        return escapedText.replace(
            /(https?:\/\/[^\s<,|]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer" class="detail-link">$1</a>'
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Share Modal                                                       */
    /* ------------------------------------------------------------------ */
    function openShareModal(site) {
        var overlay = document.getElementById('share-modal-overlay');
        var siteIdInput = document.getElementById('share-site-id');
        var emailInput = document.getElementById('share-email');
        var permSelect = document.getElementById('share-permission');
        var title = document.getElementById('share-modal-title');

        siteIdInput.value = site.id;
        emailInput.value = '';
        permSelect.value = 'view';
        title.textContent = _t('sites.share.title') + ': ' + (site.name || 'Site');

        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';

        // Load existing shares
        loadShareList(site.id);

        // Bind events (clear previous)
        var closeBtn = document.getElementById('btn-share-modal-close');
        var cancelBtn = document.getElementById('btn-cancel-share');
        var submitBtn = document.getElementById('btn-submit-share');

        var closeShareModal = function () {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
        };

        closeBtn.onclick = closeShareModal;
        cancelBtn.onclick = closeShareModal;
        overlay.onclick = function (e) {
            if (e.target === overlay) closeShareModal();
        };

        submitBtn.onclick = async function () {
            var email = emailInput.value.trim();
            var perm = permSelect.value;
            if (!email) {
                Auth.showToast(_t('sites.share.enterEmail'), 'warning');
                return;
            }
            try {
                submitBtn.disabled = true;
                submitBtn.textContent = _t('common.loading');
                var res = await Auth.authedFetch('/api/sites/' + site.id + '/share', {
                    method: 'POST',
                    body: JSON.stringify({ email: email, permission_level: perm }),
                });
                if (!res.ok) {
                    var errJson = await res.json().catch(function () { return {}; });
                    throw new Error(errJson.error || 'Failed to share site');
                }
                emailInput.value = '';
                loadShareList(site.id);
            } catch (err) {
                console.error('Error sharing site:', err);
                Auth.showToast(_t('sites.share.errorSharing'));
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = _t('sites.share.btn');
            }
        };
    }

    async function loadShareList(siteId) {
        var section = document.getElementById('share-list-section');
        var list = document.getElementById('share-list');
        var esc = window.MapModule ? window.MapModule.escapeHtml : escapeHtmlLocal;

        try {
            var res = await Auth.authedFetch('/api/sites/' + siteId + '/shares');
            if (!res.ok) throw new Error('Failed');
            var json = await res.json();
            var shares = json.data || [];

            if (shares.length === 0) {
                section.classList.add('hidden');
                return;
            }

            section.classList.remove('hidden');
            var html = '';
            shares.forEach(function (s) {
                html += '<div class="share-item">' +
                    '<span class="share-user">' + esc(s.display_name || s.email) + '</span>' +
                    '<span class="badge badge-' + s.permission_level + '">' + esc(s.permission_level) + '</span>' +
                    '<button class="btn btn-sm btn-danger btn-unshare" data-site-id="' + siteId + '" data-user-id="' + s.user_id + '">Remove</button>' +
                    '</div>';
            });
            list.innerHTML = html;

            // Bind unshare buttons
            list.querySelectorAll('.btn-unshare').forEach(function (btn) {
                btn.addEventListener('click', async function () {
                    if (!confirm(_t('sites.share.remove') + '?')) return;
                    try {
                        var resp = await Auth.authedFetch(
                            '/api/sites/' + btn.dataset.siteId + '/share/' + btn.dataset.userId,
                            { method: 'DELETE' }
                        );
                        if (!resp.ok) throw new Error('Failed to remove share');
                        loadShareList(siteId);
                    } catch (err) {
                        console.error('Error removing share:', err);
                        Auth.showToast(_t('sites.share.errorRemoving'));
                    }
                });
            });
        } catch (err) {
            console.error('Error loading share list:', err);
            section.classList.add('hidden');
        }
    }
})();
