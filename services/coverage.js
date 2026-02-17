/**
 * Coverage computation — quantized grid circles as GeoJSON.
 *
 * Converts raw trackpoints into a grid of small circle polygons,
 * suitable for rendering coverage overlays on Leaflet maps.
 * Zero external dependencies.
 */

'use strict';

var EARTH_RADIUS_M = 6371000;
var DEG_PER_M_LAT = 1 / 111320; // approximate degrees latitude per meter
var MAX_POINTS = 50000;

/**
 * Convert cellSizeMeters to degrees at a given latitude.
 */
function cellToDegrees(cellSizeMeters, avgLat) {
    var latDeg = cellSizeMeters * DEG_PER_M_LAT;
    var lngDeg = cellSizeMeters / (111320 * Math.cos(avgLat * Math.PI / 180));
    return { latDeg: latDeg, lngDeg: lngDeg };
}

/**
 * Generate an N-sided polygon approximating a circle at (lat, lng).
 * Returns GeoJSON-style [lng, lat] coordinate ring.
 */
function pointToCirclePoly(lat, lng, radiusMeters, sides) {
    sides = sides || 8;
    var coords = [];
    var latDeg = radiusMeters * DEG_PER_M_LAT;
    var lngDeg = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));

    for (var i = 0; i < sides; i++) {
        var angle = (2 * Math.PI * i) / sides;
        coords.push([
            lng + lngDeg * Math.cos(angle),
            lat + latDeg * Math.sin(angle)
        ]);
    }
    // Close the ring
    coords.push(coords[0].slice());
    return coords;
}

/**
 * Compute coverage GeoJSON from an array of {lat, lng} points.
 *
 * @param {Array} points - [{lat, lng}, ...]
 * @param {number} cellSizeMeters - cell diameter in meters (default 2)
 * @returns {object} GeoJSON FeatureCollection
 */
function computeCoverage(points, cellSizeMeters) {
    cellSizeMeters = cellSizeMeters || 2;

    if (!points || points.length === 0) {
        return { type: 'FeatureCollection', features: [] };
    }

    // Downsample if too many points
    var working = points;
    if (working.length > MAX_POINTS) {
        var nth = Math.ceil(working.length / MAX_POINTS);
        var sampled = [];
        for (var s = 0; s < working.length; s += nth) {
            sampled.push(working[s]);
        }
        working = sampled;
    }

    // Compute average latitude for longitude scaling
    var sumLat = 0;
    for (var a = 0; a < working.length; a++) {
        sumLat += working[a].lat;
    }
    var avgLat = sumLat / working.length;

    var cell = cellToDegrees(cellSizeMeters, avgLat);

    // Quantize to grid and deduplicate
    var seen = {};
    var cells = [];
    for (var i = 0; i < working.length; i++) {
        var p = working[i];
        var gridLat = Math.round(p.lat / cell.latDeg) * cell.latDeg;
        var gridLng = Math.round(p.lng / cell.lngDeg) * cell.lngDeg;
        var key = gridLat.toFixed(8) + ',' + gridLng.toFixed(8);
        if (!seen[key]) {
            seen[key] = true;
            cells.push({ lat: gridLat, lng: gridLng });
        }
    }

    // Generate GeoJSON features — one polygon per cell
    var radius = cellSizeMeters / 2;
    var features = [];
    for (var j = 0; j < cells.length; j++) {
        var c = cells[j];
        features.push({
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [pointToCirclePoly(c.lat, c.lng, radius)]
            },
            properties: {}
        });
    }

    return { type: 'FeatureCollection', features: features };
}

/**
 * Compute area of a polygon using the shoelace formula.
 * Accepts an array of [lng, lat] coordinate pairs (GeoJSON order).
 * Returns area in square degrees (for relative comparison).
 */
function shoelaceArea(ring) {
    var n = ring.length;
    var area = 0;
    for (var i = 0; i < n; i++) {
        var j = (i + 1) % n;
        area += ring[i][0] * ring[j][1];
        area -= ring[j][0] * ring[i][1];
    }
    return Math.abs(area) / 2;
}

/**
 * Ray-casting point-in-polygon test.
 * @param {number} lng - point longitude
 * @param {number} lat - point latitude
 * @param {Array} ring - array of [lng, lat]
 */
function pointInPolygon(lng, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1];
        var xj = ring[j][0], yj = ring[j][1];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/**
 * Compute what percentage of a boundary polygon is covered by the grid cells.
 *
 * @param {object} coverageGeoJSON - FeatureCollection from computeCoverage
 * @param {string|object} boundaryGeoJSON - GeoJSON Polygon/Feature/FeatureCollection
 * @param {number} cellSizeMeters - cell diameter in meters
 * @returns {number} percentage 0–100
 */
function computePercentage(coverageGeoJSON, boundaryGeoJSON, cellSizeMeters) {
    cellSizeMeters = cellSizeMeters || 2;

    // Parse boundary — accept string or object, find the polygon ring
    var boundary = typeof boundaryGeoJSON === 'string' ? JSON.parse(boundaryGeoJSON) : boundaryGeoJSON;
    var ring = null;

    if (boundary.type === 'Polygon') {
        ring = boundary.coordinates[0];
    } else if (boundary.type === 'Feature' && boundary.geometry && boundary.geometry.type === 'Polygon') {
        ring = boundary.geometry.coordinates[0];
    } else if (boundary.type === 'FeatureCollection' && boundary.features && boundary.features.length > 0) {
        var feat = boundary.features[0];
        if (feat.geometry && feat.geometry.type === 'Polygon') {
            ring = feat.geometry.coordinates[0];
        }
    }

    if (!ring || ring.length < 3) return 0;

    var boundaryArea = shoelaceArea(ring);
    if (boundaryArea === 0) return 0;

    // Count coverage cell-centers that fall inside the boundary
    var features = coverageGeoJSON.features || [];
    var cellsInside = 0;
    for (var i = 0; i < features.length; i++) {
        var coords = features[i].geometry.coordinates[0];
        // Cell center is the average of the polygon vertices (excluding closing vertex)
        var sumLng = 0, sumLat = 0;
        var nVerts = coords.length - 1; // exclude closing duplicate
        for (var v = 0; v < nVerts; v++) {
            sumLng += coords[v][0];
            sumLat += coords[v][1];
        }
        var centerLng = sumLng / nVerts;
        var centerLat = sumLat / nVerts;

        if (pointInPolygon(centerLng, centerLat, ring)) {
            cellsInside++;
        }
    }

    // Compute cell area in square degrees (approximate circle as square for simplicity)
    var avgLat = 0;
    for (var r = 0; r < ring.length; r++) {
        avgLat += ring[r][1];
    }
    avgLat /= ring.length;

    var cellDeg = cellToDegrees(cellSizeMeters, avgLat);
    var cellArea = cellDeg.latDeg * cellDeg.lngDeg; // approximate cell footprint

    var coveredArea = cellsInside * cellArea;
    var pct = (coveredArea / boundaryArea) * 100;
    return Math.min(pct, 100);
}

module.exports = {
    computeCoverage: computeCoverage,
    computePercentage: computePercentage,
    pointToCirclePoly: pointToCirclePoly,
    // Exported for testing
    _cellToDegrees: cellToDegrees,
    _shoelaceArea: shoelaceArea,
    _pointInPolygon: pointInPolygon,
};
