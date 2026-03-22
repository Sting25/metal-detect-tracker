/**
 * Metal Detecting Site Tracker - Shared Leaflet Map Module
 *
 * Provides map initialization, site marker management, and pin placement
 * utilities. Attach all public functions to window.MapModule so they can
 * be consumed by any page that includes this script after Leaflet.
 *
 * Dependencies: Leaflet.js (L) must be loaded before this file.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  /** @type {L.LayerGroup|null} Layer group that holds all site markers. */
  let _markersLayer = null;

  /** @type {Function|null} Click handler reference used during pin placement. */
  let _pinClickHandler = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Escape a string for safe insertion into HTML to prevent XSS.
   *
   * @param {string} str - The raw string to escape.
   * @returns {string} The escaped string.
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    const text = String(str);
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

  /**
   * Return a color hex code based on a permission status string.
   *
   * @param {string} status
   * @returns {string} Hex color.
   */
  function statusColor(status) {
    const colors = {
      granted: "#22c55e",
      not_required: "#3b82f6",
      requested: "#eab308",
      denied: "#ef4444",
      not_requested: "#6b7280",
    };
    return colors[status] || "#6b7280";
  }

  /**
   * Render a number of filled / empty star characters for a priority value.
   *
   * @param {number} priority - Value between 1 and 5.
   * @returns {string} HTML string of stars.
   */
  function renderStars(priority) {
    let count = parseInt(priority, 10) || 0;
    if (count < 0) count = 0;
    if (count > 5) count = 5;
    let html = "";
    for (let i = 1; i <= 5; i++) {
      if (i <= count) {
        html += '<span class="priority-stars__star priority-stars__star--filled">&#9733;</span>';
      } else {
        html += '<span class="priority-stars__star">&#9734;</span>';
      }
    }
    return html;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Initialize a Leaflet map inside the given container element.
   *
   * @param {string} containerId - The DOM id of the map container div.
   * @param {Object}  [options]  - Optional overrides.
   * @param {number}  [options.lat=38.5]   - Initial center latitude.
   * @param {number}  [options.lng=-103.0] - Initial center longitude.
   * @param {number}  [options.zoom=8]     - Initial zoom level.
   * @returns {L.Map} The Leaflet map instance.
   */
  function initMap(containerId, options) {
    const opts = options || {};
    // Support center as [lat, lng] array or separate lat/lng
    const defaults = (window.AppConfig && AppConfig.getMapDefaults()) || { center: [39.8283, -98.5795], zoom: 4 };
    const center = opts.center || [opts.lat, opts.lng];
    const lat = (center && center[0] != null) ? center[0] : defaults.center[0];
    const lng = (center && center[1] != null) ? center[1] : defaults.center[1];
    const zoom = opts.zoom !== undefined ? opts.zoom : defaults.zoom;

    const map = L.map(containerId, {
      center: [lat, lng],
      zoom: zoom,
      zoomControl: true,
    });

    // --- Tile Layers ---

    const osmStreet = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }
    );

    const esriSatellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
        maxZoom: 18,
      }
    );

    // Add the street layer by default.
    osmStreet.addTo(map);

    // Layer control
    const baseLayers = {
      Street: osmStreet,
      Satellite: esriSatellite,
    };

    L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);

    // Create the shared markers layer group.
    _markersLayer = L.layerGroup().addTo(map);

    return map;
  }

  /**
   * Enter pin-placement mode on the map.  The map container gets a crosshair
   * cursor, and the next click on the map fires the callback with the
   * coordinates then exits crosshair mode.
   *
   * @param {L.Map}   map      - The Leaflet map instance.
   * @param {Function} callback - Called as callback(lat, lng) on click.
   */
  function enablePinPlacement(map, callback) {
    const container = map.getContainer();

    // Clean up any previous handler that was never completed.
    disablePinPlacement(map);

    container.classList.add("map-container--crosshair");

    _pinClickHandler = function (e) {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      // Exit crosshair mode.
      disablePinPlacement(map);

      if (typeof callback === "function") {
        callback(lat, lng);
      }
    };

    map.once("click", _pinClickHandler);
  }

  /**
   * Cancel / clean up pin-placement mode without triggering a callback.
   *
   * @param {L.Map} map
   */
  function disablePinPlacement(map) {
    const container = map.getContainer();
    container.classList.remove("map-container--crosshair");

    if (_pinClickHandler) {
      map.off("click", _pinClickHandler);
      _pinClickHandler = null;
    }
  }

  /**
   * Create a Leaflet CircleMarker for a site object.
   *
   * Expected site properties:
   *   - site.latitude  {number}
   *   - site.longitude {number}
   *   - site.name      {string}
   *   - site.permission_status {string}  (granted|not_required|requested|denied|not_requested)
   *   - site.land_type {string}          (e.g. "Private", "BLM", "State")
   *   - site.priority  {number}          (1-5)
   *   - site.id        {string|number}   (used for detail link)
   *
   * @param {Object} site
   * @returns {L.CircleMarker}
   */
  function createSiteMarker(site) {
    const color = statusColor(site.permission_status);

    const marker = L.circleMarker([site.latitude, site.longitude], {
      radius: 8,
      fillColor: color,
      color: "#ffffff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85,
    });

    // Build popup HTML
    const statusLabel = escapeHtml(
      (site.permission_status || "unknown").replace(/_/g, " ")
    );
    const popupHtml =
      '<div class="popup-title">' +
      escapeHtml(site.name) +
      "</div>" +
      '<div class="popup-meta">' +
      '<span class="badge badge--' +
      escapeHtml(site.permission_status || "gray") +
      '">' +
      statusLabel +
      "</span>" +
      "</div>" +
      "<div><strong>Land:</strong> " +
      escapeHtml(site.land_type || "N/A") +
      "</div>" +
      '<div class="priority-stars" style="margin:4px 0;">' +
      renderStars(site.priority) +
      "</div>" +
      '<div class="popup-link"><a href="/sites/' +
      encodeURIComponent(site.id) +
      '">View Details &rarr;</a></div>';

    marker.bindPopup(popupHtml);

    // Store reference to site data on the marker for external consumers.
    marker._siteData = site;

    return marker;
  }

  /**
   * Clear the existing markers layer and populate it with markers for the
   * given array of site objects.
   *
   * @param {L.Map}   map   - The Leaflet map instance.
   * @param {Array}   sites - Array of site objects.
   */
  function loadSitePins(map, sites) {
    if (!_markersLayer) {
      _markersLayer = L.layerGroup().addTo(map);
    }

    // Remove all existing markers.
    _markersLayer.clearLayers();

    if (!Array.isArray(sites)) return;

    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      if (
        site &&
        typeof site.latitude === "number" &&
        typeof site.longitude === "number"
      ) {
        const marker = createSiteMarker(site);
        _markersLayer.addLayer(marker);
      }
    }
  }

  /**
   * If the sites array is non-empty, adjust the map view so every site pin
   * is visible.
   *
   * @param {L.Map} map
   * @param {Array} sites
   */
  function fitBoundsToSites(map, sites) {
    if (!Array.isArray(sites) || sites.length === 0) return;

    const validPoints = [];
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (
        s &&
        typeof s.latitude === "number" &&
        typeof s.longitude === "number"
      ) {
        validPoints.push([s.latitude, s.longitude]);
      }
    }

    if (validPoints.length === 0) return;

    if (validPoints.length === 1) {
      map.setView(validPoints[0], 14);
    } else {
      const bounds = L.latLngBounds(validPoints);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }

  // ---------------------------------------------------------------------------
  // Export to window
  // ---------------------------------------------------------------------------

  window.MapModule = {
    initMap: initMap,
    enablePinPlacement: enablePinPlacement,
    disablePinPlacement: disablePinPlacement,
    createSiteMarker: createSiteMarker,
    loadSitePins: loadSitePins,
    fitBoundsToSites: fitBoundsToSites,
    escapeHtml: escapeHtml,
  };
})();
