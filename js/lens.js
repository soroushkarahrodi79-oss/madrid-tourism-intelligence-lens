// Pure, deterministic lens geometry and statistics. No Leaflet/DOM
// dependency in this file so it can be unit-tested with plain Node.

// Lens radius bounds are shared by the independent A and B controls.
const LENS_RADIUS = Object.freeze({
  minM: 100,
  maxM: 5000,
  stepM: 50,
  defaultM: 900,
});

function clampLensRadius(value) {
  const radiusM = Number(value);
  if (!Number.isFinite(radiusM)) return LENS_RADIUS.defaultM;

  const withinBounds = Math.min(LENS_RADIUS.maxM, Math.max(LENS_RADIUS.minM, radiusM));
  const steppedRadius = Math.round((withinBounds - LENS_RADIUS.minM) / LENS_RADIUS.stepM) * LENS_RADIUS.stepM + LENS_RADIUS.minM;
  return Math.min(LENS_RADIUS.maxM, Math.max(LENS_RADIUS.minM, steppedRadius));
}

const LENS_COMPARISON_RADIUS_MODE = Object.freeze({ EQUAL: "EQUAL_RADIUS", UNEQUAL: "UNEQUAL_RADIUS" });

function radiusComparisonMode(radiusA, radiusB) {
  const a = clampLensRadius(radiusA);
  const b = clampLensRadius(radiusB);
  return a === b ? LENS_COMPARISON_RADIUS_MODE.EQUAL : LENS_COMPARISON_RADIUS_MODE.UNEQUAL;
}

function createLensRadii() { return { A: LENS_RADIUS.defaultM, B: LENS_RADIUS.defaultM }; }
function setLensRadiusState(radii, which, value) {
  if (which !== "A" && which !== "B") throw new RangeError("Lens side must be A or B");
  radii[which] = clampLensRadius(value);
  return radii;
}
function initializeLensBRadius(radii) { radii.B = clampLensRadius(radii.A); return radii; }

function circleAreaKm2(radiusM) {
  const r = Number(radiusM);
  if (!Number.isFinite(r) || r <= 0) return null;
  return Math.PI * Math.pow(r / 1000, 2);
}

function representedRate(count, radiusM) {
  const n = Number(count);
  const area = circleAreaKm2(radiusM);
  if (!Number.isFinite(n) || n < 0 || area == null) return null;
  const rate = n / area;
  return Number.isFinite(rate) ? rate : null;
}

function formatLensRadius(radiusM) {
  const validRadiusM = clampLensRadius(radiusM);
  if (validRadiusM < 1000) return `${validRadiusM} m`;
  return `${Number((validRadiusM / 1000).toFixed(2))} km`;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

// ======================= custom polygon analysis geometry ===================
//
// A SECOND analysis geometry alongside the circular Lens. One is active at a
// time; the circle's own behaviour is untouched.
//
// MEMBERSHIP IS EXACT. A point is inside the polygon if and only if exact
// even-odd ray casting over the ring says so. No bounding box, no enclosing
// circle, no centroid-and-radius approximation is ever substituted — those would
// silently include or exclude records near a concave edge.
//
// BOUNDARY CONVENTION. The ring test uses the SAME half-open edge rule as the
// administrative geometry in js/geography.js (`pointInRing`):
//
//     (yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi
//
// `>` on one side and `<=` on the other makes every horizontal ray cross each
// edge at most once, so a point lying exactly on a boundary is assigned
// deterministically — the same coordinate always gives the same answer, and a
// point on a shared edge between two adjacent areas belongs to exactly one of
// them. It is NOT a rule that boundary points are always "inside": whether an
// exactly-on-edge point counts depends on that edge's vertical orientation, and
// tests pin the actual behaviour rather than assuming a convenience. The same
// convention across the user polygon and the official geography is the point:
// two membership answers in this product never disagree about an edge.
// A parity test asserts this implementation and js/geography.js stay in step.
//
// COORDINATE ORDER. This module speaks {lat, lon} objects throughout, like the
// rest of the Lens model, and never GeoJSON [lon, lat] pairs. Mixing the two is
// the easy bug here, so the ring test takes lon/lat as separate arguments.
const ANALYSIS_GEOMETRY = Object.freeze({ CIRCLE: "CIRCLE", POLYGON: "POLYGON" });

// A ring needs three distinct vertices before it encloses any area at all.
const POLYGON_MIN_VERTICES = 3;

function isFiniteVertex(vertex) {
  return Boolean(vertex) && Number.isFinite(Number(vertex.lat)) && Number.isFinite(Number(vertex.lon));
}

// Normalises a vertex list to a closed ring of finite {lat, lon}. Returns null
// when the input cannot describe an area, so a caller never computes over a
// degenerate ring and reports the result as a measurement.
function normalizePolygonRing(vertices) {
  if (!Array.isArray(vertices)) return null;
  const ring = vertices.filter(isFiniteVertex).map((v) => ({ lat: Number(v.lat), lon: Number(v.lon) }));
  if (ring.length < POLYGON_MIN_VERTICES) return null;
  // Drop a repeated closing vertex: the ring is treated as implicitly closed and
  // a duplicated last point would add a zero-length edge.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > POLYGON_MIN_VERTICES && first.lat === last.lat && first.lon === last.lon) ring.pop();
  if (ring.length < POLYGON_MIN_VERTICES) return null;
  const distinct = new Set(ring.map((v) => `${v.lat},${v.lon}`));
  if (distinct.size < POLYGON_MIN_VERTICES) return null;
  return ring;
}

// TAKES THE RADIUS AS GIVEN. It deliberately does NOT clampLensRadius(): that is
// the radius CONTROL's rule (bounds and a 50 m step), not a property of the
// geometry. Clamping here silently snapped a caller's radius — a restored URL
// state or a test seam can hold an off-step value — so the circle measured was
// not the circle asked for, and membership quietly disagreed with the radius the
// rest of the app was using.
function createCircleGeometry(center, radiusM) {
  if (!isFiniteVertex(center)) return null;
  const radius = Number(radiusM);
  if (!Number.isFinite(radius)) return null;
  return Object.freeze({
    kind: ANALYSIS_GEOMETRY.CIRCLE,
    center: Object.freeze({ lat: Number(center.lat), lon: Number(center.lon) }),
    radiusM: radius,
  });
}

function createPolygonGeometry(vertices) {
  const ring = normalizePolygonRing(vertices);
  if (!ring) return null;
  return Object.freeze({
    kind: ANALYSIS_GEOMETRY.POLYGON,
    ring: Object.freeze(ring.map((v) => Object.freeze(v))),
  });
}

// Exact even-odd ray casting over one closed ring. Half-open edges, as above.
function pointInPolygonRing(lon, lat, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i].lon;
    const yi = ring[i].lat;
    const xj = ring[j].lon;
    const yj = ring[j].lat;
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

// THE single membership predicate for both geometries. Every polygon-aware
// statistic goes through this, so there is one definition of "inside" to test.
function geometryContainsPoint(geometry, point) {
  if (!geometry || !isFiniteVertex(point)) return false;
  if (geometry.kind === ANALYSIS_GEOMETRY.CIRCLE) {
    return haversineMeters(geometry.center, point) <= geometry.radiusM;
  }
  if (geometry.kind === ANALYSIS_GEOMETRY.POLYGON) {
    return pointInPolygonRing(Number(point.lon), Number(point.lat), geometry.ring);
  }
  return false;
}

// Closed-ring perimeter: the sum of great-circle edge lengths, using the same
// haversine the circular Lens uses, so the two geometries measure distance the
// same way.
function polygonPerimeterM(ring) {
  if (!Array.isArray(ring) || ring.length < POLYGON_MIN_VERTICES) return null;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    total += haversineMeters(ring[i], ring[(i + 1) % ring.length]);
  }
  return Number.isFinite(total) ? total : null;
}

// Spherical area by the line-integral form of the spherical excess, on the same
// R = 6371 km sphere as haversineMeters. Deliberately NOT a planar shoelace on
// raw degrees: longitude degrees are ~0.76 of a latitude degree at Madrid's
// latitude, so a degree-space shoelace would misreport area by about a quarter.
// Sign depends on winding, so the magnitude is taken.
function polygonAreaKm2(ring) {
  if (!Array.isArray(ring) || ring.length < POLYGON_MIN_VERTICES) return null;
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    total += (toRad(b.lon) - toRad(a.lon)) * (2 + Math.sin(toRad(a.lat)) + Math.sin(toRad(b.lat)));
  }
  const areaM2 = Math.abs((total * R * R) / 2);
  const areaKm2 = areaM2 / 1e6;
  return Number.isFinite(areaKm2) ? areaKm2 : null;
}

// Vertex-average centre. Used ONLY as a reference point for "nearest feature"
// distances and for naming the polygon's position — never as a stand-in for the
// polygon in a membership test, and it is not the centre of mass.
function polygonReferencePoint(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  const lat = ring.reduce((sum, v) => sum + v.lat, 0) / ring.length;
  const lon = ring.reduce((sum, v) => sum + v.lon, 0) / ring.length;
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

// The area a geometry covers, for the density denominator. A circle keeps its
// closed-form area; a polygon uses its spherical area. Both are km².
function geometryAreaKm2(geometry) {
  if (!geometry) return null;
  if (geometry.kind === ANALYSIS_GEOMETRY.CIRCLE) return circleAreaKm2(geometry.radiusM);
  if (geometry.kind === ANALYSIS_GEOMETRY.POLYGON) return polygonAreaKm2(geometry.ring);
  return null;
}

// The reference point for distance readouts: a circle's centre, a polygon's
// vertex average. Distances are always reported AS distances from this point and
// never used to decide membership.
function geometryReferencePoint(geometry) {
  if (!geometry) return null;
  if (geometry.kind === ANALYSIS_GEOMETRY.CIRCLE) return geometry.center;
  if (geometry.kind === ANALYSIS_GEOMETRY.POLYGON) return polygonReferencePoint(geometry.ring);
  return null;
}

// Descriptive-only statistics for the POI layers inside a lens: counts,
// category mix, and nearest features. Does not interpret counts as quality,
// pressure, or attractiveness.
function poiStatsInGeometry(points, geometry) {
  const reference = geometryReferencePoint(geometry);
  // Membership is decided by geometryContainsPoint — exactly. `d` is attached
  // AFTERWARDS, purely so "nearest feature" can be ordered and reported; it is
  // never a filter for a polygon, because distance from a reference point says
  // nothing about being inside a concave ring.
  const inside = (points || [])
    .filter((p) => geometryContainsPoint(geometry, p))
    .map((p) => ({ ...p, d: reference ? haversineMeters(reference, p) : null }));

  const count = (t) => inside.filter((p) => p.type === t).length;
  const museum = count("museum");
  const info = count("info");
  const stay = count("stay");
  const bike = count("bike");
  const rail = count("rail");
  const mobility = bike + rail;

  return {
    museum,
    info,
    stay,
    bike,
    rail,
    mobility,
    tourism: museum + info,
    total: museum + info + stay + mobility,
    nearest: [...inside].sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity)).slice(0, 5),
  };
}

// The circular entry point every existing call site uses, unchanged in meaning:
// a circle geometry is built and the same single membership predicate applied.
function poiStatsInLens(points, center, radiusM) {
  return poiStatsInGeometry(points, createCircleGeometry(center, radiusM));
}

function deltaOrDash(a, b, suffix = "") {
  if (a == null || b == null) return null;
  const d = b - a;
  const rounded = Number.isInteger(d) ? d : Math.round(d * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}${suffix}`;
}

// Observed pedestrian activity is a separate evidence stream, not a POI count.
// Each station carries an aggregated sum/count from Madrid's published
// permanent pedestrian-counter records. The lens recombines those sufficient
// statistics exactly for the stations that fall inside the lens.
function pedestrianStatsInGeometry(stations, geometry) {
  const reference = geometryReferencePoint(geometry);
  const inside = (stations || [])
    .filter((station) => geometryContainsPoint(geometry, station))
    .map((station) => ({ ...station, d: reference ? haversineMeters(reference, station) : null }));

  if (!inside.length) {
    return {
      evidence: "NONE",
      stationCount: 0,
      observationCount: 0,
      meanObserved: null,
      dateMin: null,
      dateMax: null,
    };
  }

  let weightedSum = 0;
  let observationCount = 0;
  const datesMin = [];
  const datesMax = [];
  for (const station of inside) {
    const n = Number(station.observationCount) || 0;
    const mean = Number(station.meanObserved);
    if (n > 0 && Number.isFinite(mean)) {
      weightedSum += mean * n;
      observationCount += n;
    }
    if (station.dateMin) datesMin.push(station.dateMin);
    if (station.dateMax) datesMax.push(station.dateMax);
  }

  return {
    evidence: observationCount > 0 ? "OBSERVED" : "NONE",
    stationCount: inside.length,
    observationCount,
    meanObserved: observationCount > 0 ? weightedSum / observationCount : null,
    dateMin: datesMin.length ? datesMin.sort()[0] : null,
    dateMax: datesMax.length ? datesMax.sort().at(-1) : null,
  };
}

function pedestrianStatsInLens(stations, center, radiusM) {
  return pedestrianStatsInGeometry(stations, createCircleGeometry(center, radiusM));
}

// Worst-case status across a set of layers:
// unavailable > snapshot (small curated sample) > published (deployment snapshot) > live.
// Used so a combined metric inherits the least-current / least-complete status
// of its contributing layers.
function combinedStatus(statusMap, names) {
  const statuses = names.map((n) => statusMap[n]).filter(Boolean);
  if (statuses.includes("unavailable")) return "unavailable";
  if (statuses.includes("snapshot")) return "snapshot";
  if (statuses.includes("published")) return "published";
  return "live";
}

// A comparison delta must never let an unavailable layer produce a numeric
// "0 vs 0", and must never let a partial snapshot sample masquerade as an
// exhaustive live comparison.
function comparisonDelta(status, a, b, suffix = "") {
  if (status === "unavailable") return "—";
  const d = deltaOrDash(a, b, suffix);
  if (d == null) return "—";
  if (status === "snapshot") return `${d} sample`;
  if (status === "published") return `${d} deploy`;
  return d;
}

// Category-mix shares for the "Category mix" card. A category on an
// unavailable layer never gets a fabricated 0% share (na: true instead), and
// the denominator only sums categories that are actually known. The overall
// label flags when the mix is a partial sample and/or missing a category.
function categoryMixState(counts, statuses) {
  const keys = Object.keys(counts);
  // "withheld" is a GEOGRAPHIC state (the Lens extends beyond the source's
  // extraction area): like "unavailable" it contributes no share and no
  // denominator, but it is reported separately and never as a 0%.
  const knownKeys = keys.filter((k) => statuses[k] !== "unavailable" && statuses[k] !== "withheld");
  const total = knownKeys.reduce((sum, k) => sum + counts[k], 0);

  const rows = {};
  for (const k of keys) {
    rows[k] = statuses[k] === "unavailable"
      ? { na: true }
      : statuses[k] === "withheld"
        ? { na: true, withheld: true }
        : { pct: total ? Math.round((counts[k] / total) * 100) : 0 };
  }

  const anySnapshot = knownKeys.some((k) => statuses[k] === "snapshot");
  const anyPublished = knownKeys.some((k) => statuses[k] === "published");
  const anyUnavailable = keys.some((k) => statuses[k] === "unavailable");
  const anyWithheld = keys.some((k) => statuses[k] === "withheld");
  let label = "";
  if (anySnapshot && anyUnavailable) label = "Sample mix · not exhaustive · some categories unavailable";
  else if (anySnapshot) label = "Sample mix · not exhaustive";
  else if (anyPublished && anyUnavailable) label = "Deployment snapshot · some categories unavailable";
  else if (anyPublished) label = "Deployment snapshot · not real-time";
  else if (anyUnavailable) label = "Some categories unavailable";
  if (anyWithheld) label = label ? `${label} · Mobility withheld (beyond extraction area)` : "Mobility withheld (beyond extraction area)";

  return { rows, label };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LENS_RADIUS,
    clampLensRadius,
    LENS_COMPARISON_RADIUS_MODE,
    radiusComparisonMode,
    createLensRadii,
    setLensRadiusState,
    initializeLensBRadius,
    circleAreaKm2,
    representedRate,
    formatLensRadius,
    haversineMeters,
    poiStatsInLens,
    poiStatsInGeometry,
    deltaOrDash,
    pedestrianStatsInLens,
    pedestrianStatsInGeometry,
    ANALYSIS_GEOMETRY,
    POLYGON_MIN_VERTICES,
    normalizePolygonRing,
    createCircleGeometry,
    createPolygonGeometry,
    pointInPolygonRing,
    geometryContainsPoint,
    polygonPerimeterM,
    polygonAreaKm2,
    polygonReferencePoint,
    geometryAreaKm2,
    geometryReferencePoint,
    combinedStatus,
    comparisonDelta,
    categoryMixState,
  };
}
