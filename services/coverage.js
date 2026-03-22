/**
 * Coverage computation — quantized grid circles as GeoJSON.
 *
 * Converts raw trackpoints into a grid of small circle polygons,
 * suitable for rendering coverage overlays on Leaflet maps.
 * Zero external dependencies.
 */

'use strict';

const EARTH_RADIUS_M = 6371000;
const DEG_PER_M_LAT = 1 / 111320; // approximate degrees latitude per meter
const MAX_POINTS = 50000;

/**
 * Convert cellSizeMeters to degrees at a given latitude.
 */
function cellToDegrees(cellSizeMeters, avgLat) {
    const latDeg = cellSizeMeters * DEG_PER_M_LAT;
    const lngDeg = cellSizeMeters / (111320 * Math.cos(avgLat * Math.PI / 180));
    return { latDeg: latDeg, lngDeg: lngDeg };
}

/**
 * Generate an N-sided polygon approximating a circle at (lat, lng).
 * Returns GeoJSON-style [lng, lat] coordinate ring.
 */
function pointToCirclePoly(lat, lng, radiusMeters, sides) {
    sides = sides || 8;
    const coords = [];
    const latDeg = radiusMeters * DEG_PER_M_LAT;
    const lngDeg = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));

    for (let i = 0; i < sides; i++) {
        const angle = (2 * Math.PI * i) / sides;
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
    let working = points;
    if (working.length > MAX_POINTS) {
        const nth = Math.ceil(working.length / MAX_POINTS);
        const sampled = [];
        for (let s = 0; s < working.length; s += nth) {
            sampled.push(working[s]);
        }
        working = sampled;
    }

    // Compute average latitude for longitude scaling
    let sumLat = 0;
    for (let a = 0; a < working.length; a++) {
        sumLat += working[a].lat;
    }
    const avgLat = sumLat / working.length;

    const cell = cellToDegrees(cellSizeMeters, avgLat);

    // Quantize to grid and deduplicate
    const seen = {};
    const cells = [];
    for (let i = 0; i < working.length; i++) {
        const p = working[i];
        const gridLat = Math.round(p.lat / cell.latDeg) * cell.latDeg;
        const gridLng = Math.round(p.lng / cell.lngDeg) * cell.lngDeg;
        const key = gridLat.toFixed(8) + ',' + gridLng.toFixed(8);
        if (!seen[key]) {
            seen[key] = true;
            cells.push({ lat: gridLat, lng: gridLng });
        }
    }

    // Generate GeoJSON features — one polygon per cell
    const radius = cellSizeMeters / 2;
    const features = [];
    for (let j = 0; j < cells.length; j++) {
        const c = cells[j];
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
    const n = ring.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
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
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
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
    const boundary = typeof boundaryGeoJSON === 'string' ? JSON.parse(boundaryGeoJSON) : boundaryGeoJSON;
    let ring = null;

    if (boundary.type === 'Polygon') {
        ring = boundary.coordinates[0];
    } else if (boundary.type === 'Feature' && boundary.geometry && boundary.geometry.type === 'Polygon') {
        ring = boundary.geometry.coordinates[0];
    } else if (boundary.type === 'FeatureCollection' && boundary.features && boundary.features.length > 0) {
        const feat = boundary.features[0];
        if (feat.geometry && feat.geometry.type === 'Polygon') {
            ring = feat.geometry.coordinates[0];
        }
    }

    if (!ring || ring.length < 3) return 0;

    const boundaryArea = shoelaceArea(ring);
    if (boundaryArea === 0) return 0;

    // Count coverage cell-centers that fall inside the boundary
    const features = coverageGeoJSON.features || [];
    let cellsInside = 0;
    for (let i = 0; i < features.length; i++) {
        const coords = features[i].geometry.coordinates[0];
        // Cell center is the average of the polygon vertices (excluding closing vertex)
        let sumLng = 0, sumLat = 0;
        const nVerts = coords.length - 1; // exclude closing duplicate
        for (let v = 0; v < nVerts; v++) {
            sumLng += coords[v][0];
            sumLat += coords[v][1];
        }
        const centerLng = sumLng / nVerts;
        const centerLat = sumLat / nVerts;

        if (pointInPolygon(centerLng, centerLat, ring)) {
            cellsInside++;
        }
    }

    // Compute cell area in square degrees (approximate circle as square for simplicity)
    let avgLat = 0;
    for (let r = 0; r < ring.length; r++) {
        avgLat += ring[r][1];
    }
    avgLat /= ring.length;

    const cellDeg = cellToDegrees(cellSizeMeters, avgLat);
    const cellArea = cellDeg.latDeg * cellDeg.lngDeg; // approximate cell footprint

    const coveredArea = cellsInside * cellArea;
    const pct = (coveredArea / boundaryArea) * 100;
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
