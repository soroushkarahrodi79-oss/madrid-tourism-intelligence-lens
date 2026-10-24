// Geographic extraction boundary of the CRTM rail layer (Metro M4 + Cercanías M5).
//
// SCOPE. This module is the single definition of the rectangle the deployment
// builder sends to the CRTM feature services (`esriGeometryEnvelope`) and of the
// pure, whole-circle test the browser uses to decide whether a Lens circle may
// carry a combined Mobility count. It is a classic script (browser global
// `LensExtractionBounds`) AND a CommonJS module, so the Node builder, the browser
// loader and the tests all read the same constants — they cannot drift apart.
//
// WHAT THE RECTANGLE IS. An EXTRACTION QUERY BOUNDARY: stations outside it were
// never requested, so their absence from a Lens circle that extends past it is an
// artefact of the query, not an observation.
//
// WHAT IT IS NOT. It is not proof of complete source coverage. A circle fully
// inside it is WITHIN_EXTRACTION_BOUNDS: that establishes only that the query
// covered the circle, never that the source returned every station. Completeness
// stays unverified. It is also unrelated to the `expected_spatial_scope`
// integrity envelopes of data/source_registry.json, which only sanity-check
// coordinates and are never coverage evidence.
//
// GEOMETRY. Spherical, with the same Earth radius and great-circle (haversine)
// distance the Lens uses to count records (js/lens.js), so "inside the circle"
// means the same thing here and there. The circle is a spherical cap; the
// rectangle is a lon/lat rectangle (two meridians, two parallels), which is how
// ArcGIS interprets an envelope in WGS84. Containment is solved exactly (cap
// extremes in latitude and longitude), not by sampling the perimeter and not by
// degree-to-metre factors.
(function () {
  const CONTRACT_VERSION = "1.0.0";
  const EARTH_RADIUS_M = 6371000;

  // The queried rectangle, WGS84 degrees. Changing it is a deliberate, versioned
  // change of the extraction contract (bump CONTRACT_VERSION).
  const RAIL_EXTRACTION_BOUNDS = Object.freeze({ west: -3.745, south: 40.385, east: -3.645, north: 40.455 });

  // Safety margin applied to every containment test: the circle must clear every
  // edge by at least this distance to be WITHIN. It is deliberately larger than
  // the 44 m overshoot already observed at the boundary (data/source_registry.json,
  // `central_madrid_area` note: Plaza Eliptica at 40.38460), because the service
  // reprojects the envelope and its effective footprint at the edge is not exactly
  // the lon/lat rectangle. A circle that comes closer than the margin is PARTIAL.
  const BOUNDARY_TOLERANCE_M = 100;

  const STATE = Object.freeze({
    WITHIN: "WITHIN_EXTRACTION_BOUNDS",
    PARTIAL: "PARTIAL_EXTRACTION_BOUNDS",
    OUTSIDE: "OUTSIDE_EXTRACTION_BOUNDS",
    UNKNOWN: "EXTRACTION_BOUNDS_UNKNOWN",
  });

  // The record written to data/runtime_poi.json (status.rail.extraction) and read
  // back by the browser, so the artefact states which rectangle it was built with.
  const RAIL_EXTRACTION_RECORD = Object.freeze({
    contract_version: CONTRACT_VERSION,
    kind: "QUERY_ENVELOPE",
    crs: "EPSG:4326",
    bounds: RAIL_EXTRACTION_BOUNDS,
    origin: "CENTRAL_MADRID_ENVELOPE: the esriGeometryEnvelope parameter sent to the CRTM M4_Red and M5_Red feature services by scripts/build_runtime_poi.mjs (and by the browser fallback in js/data.js). Defined once, in js/extraction-bounds.js.",
    is_coverage_evidence: false,
    completeness: "NOT_VERIFIED",
  });

  function isNum(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  const rad = (degrees) => (degrees * Math.PI) / 180;

  // A bounds object is usable only when it is a proper lon/lat rectangle.
  function normalizeBounds(bounds) {
    if (!bounds || typeof bounds !== "object") return null;
    const { west, south, east, north } = bounds;
    if (![west, south, east, north].every(isNum)) return null;
    if (!(west < east) || !(south < north)) return null;
    if (west < -180 || east > 180 || south < -90 || north > 90) return null;
    return Object.freeze({ west, south, east, north });
  }

  // "west,south,east,north": the value of the ArcGIS `geometry` query parameter.
  function envelopeParam(bounds = RAIL_EXTRACTION_BOUNDS) {
    const b = normalizeBounds(bounds);
    if (!b) throw new RangeError("invalid extraction bounds");
    return `${b.west},${b.south},${b.east},${b.north}`;
  }

  // The fields of an artefact's recorded extraction metadata that contradict (or
  // fail to state) the contract this build interprets. Every field the contract
  // fixes is checked, not only the rectangle: a record that states the right
  // numbers but claims coverage evidence, a verified completeness, another CRS or
  // another kind of boundary is NOT the contract and must fail closed. An empty
  // list is the only "matches".
  function recordMismatches(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return ["record"];
    const out = [];
    if (record.contract_version !== CONTRACT_VERSION) out.push("contract_version");
    if (record.kind !== RAIL_EXTRACTION_RECORD.kind) out.push("kind");
    if (record.crs !== RAIL_EXTRACTION_RECORD.crs) out.push("crs");
    const b = normalizeBounds(record.bounds);
    if (!b || b.west !== RAIL_EXTRACTION_BOUNDS.west || b.south !== RAIL_EXTRACTION_BOUNDS.south
      || b.east !== RAIL_EXTRACTION_BOUNDS.east || b.north !== RAIL_EXTRACTION_BOUNDS.north) out.push("bounds");
    if (record.is_coverage_evidence !== false) out.push("is_coverage_evidence");
    if (record.completeness !== RAIL_EXTRACTION_RECORD.completeness) out.push("completeness");
    return out;
  }

  // Does an artefact's recorded extraction metadata equal the contract this build
  // of the application interprets? Anything else (missing, malformed, different
  // version, rectangle, CRS, kind, coverage claim or completeness) is "not the
  // same contract" and must fail closed.
  function recordMatchesContract(record) {
    return recordMismatches(record).length === 0;
  }

  const ARTIFACT_EXTRACTION_STATUS = Object.freeze({
    RECORDED_MATCHES: "RECORDED_MATCHES_CONTRACT",
    RECORDED_CONTRADICTS: "RECORDED_CONTRADICTS_CONTRACT",
    NOT_RECORDED: "UNVERIFIED_NOT_RECORDED",
    NO_ARTIFACT: "UNVERIFIED_NO_DEPLOYMENT_ARTIFACT",
    LIVE_QUERY: "LIVE_QUERY_ISSUED_BY_THIS_BUILD",
  });

  // What the LOADED rail layer actually states about its own extraction, kept
  // apart from the contract the application expects. `recorded` is only ever the
  // metadata found in the artefact (never the expected contract copied in); it is
  // builder-declared, so even a match is not an independent check against the
  // service and says nothing about completeness. `layerState` is the layer's
  // provenance ("published" | "live" | anything else).
  function describeArtifactExtraction(record, layerState) {
    const S = ARTIFACT_EXTRACTION_STATUS;
    const base = { recorded: null, mismatchedFields: [] };
    if (layerState === "live") return Object.freeze({ ...base, status: S.LIVE_QUERY });
    if (layerState !== "published") return Object.freeze({ ...base, status: S.NO_ARTIFACT });
    if (!record || typeof record !== "object" || Array.isArray(record)) return Object.freeze({ ...base, status: S.NOT_RECORDED });
    const mismatchedFields = recordMismatches(record);
    const recorded = Object.freeze({
      contract_version: record.contract_version ?? null,
      kind: record.kind ?? null,
      crs: record.crs ?? null,
      bounds: record.bounds && typeof record.bounds === "object"
        ? { west: record.bounds.west ?? null, south: record.bounds.south ?? null, east: record.bounds.east ?? null, north: record.bounds.north ?? null }
        : null,
      is_coverage_evidence: record.is_coverage_evidence ?? null,
      completeness: record.completeness ?? null,
    });
    return Object.freeze({
      status: mismatchedFields.length ? S.RECORDED_CONTRADICTS : S.RECORDED_MATCHES,
      recorded,
      mismatchedFields,
    });
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Shortest distance (metres) from a point to the rectangle; 0 when inside.
  function distanceToRectangle(lat, lon, b) {
    const inLat = lat >= b.south && lat <= b.north;
    const inLon = lon >= b.west && lon <= b.east;
    if (inLat && inLon) return 0;
    let best = Infinity;
    // Corners.
    for (const cLat of [b.south, b.north]) {
      for (const cLon of [b.west, b.east]) best = Math.min(best, haversine(lat, lon, cLat, cLon));
    }
    // A parallel edge: the nearest point is on the point's own meridian when the
    // longitude is inside the edge (distance is monotonic in |dLon| otherwise, so
    // the corner is already covered).
    if (inLon) best = Math.min(best, Math.abs(rad(lat - (lat > b.north ? b.north : b.south))) * EARTH_RADIUS_M);
    // A meridian edge: foot of the perpendicular on the meridian great circle.
    for (const mLon of [b.west, b.east]) {
      const dLon = rad(lon - mLon);
      if (Math.abs(dLon) >= Math.PI / 2) continue;
      const footLat = (Math.atan(Math.tan(rad(lat)) / Math.cos(dLon)) * 180) / Math.PI;
      if (footLat >= b.south && footLat <= b.north) {
        best = Math.min(best, Math.asin(Math.min(1, Math.cos(rad(lat)) * Math.abs(Math.sin(dLon)))) * EARTH_RADIUS_M);
      }
    }
    return best;
  }

  // Is the spherical cap (centre, angular radius alpha) entirely inside the
  // rectangle? Exact: the cap spans latitudes [lat-alpha, lat+alpha] and, when it
  // contains no pole, longitudes lon ± asin(sin(alpha)/cos(lat)).
  function capInsideRectangle(lat, lon, alpha, b) {
    if (alpha <= 0 || alpha >= Math.PI / 2) return false;
    const latRad = rad(lat);
    if (alpha >= Math.PI / 2 - Math.abs(latRad)) return false; // cap reaches a pole
    if ((latRad - alpha) < rad(b.south) || (latRad + alpha) > rad(b.north)) return false;
    const sinRatio = Math.sin(alpha) / Math.cos(latRad);
    if (!(sinRatio < 1)) return false;
    const dLon = (Math.asin(sinRatio) * 180) / Math.PI;
    return (lon - dLon) >= b.west && (lon + dLon) <= b.east;
  }

  // The authoritative geographic-extraction eligibility of ONE Lens circle.
  //
  //   WITHIN_EXTRACTION_BOUNDS   the circle, grown by the safety margin, fits
  //                              inside the queried rectangle. Completeness of
  //                              the source is NOT established by this.
  //   PARTIAL_EXTRACTION_BOUNDS  the circle reaches the rectangle (allowing for
  //                              the margin) but is not safely inside it.
  //   OUTSIDE_EXTRACTION_BOUNDS  the circle, grown by the margin, does not touch
  //                              the rectangle.
  //   EXTRACTION_BOUNDS_UNKNOWN  the rectangle or the circle cannot be determined
  //                              reliably; fail closed.
  //
  // These are GEOGRAPHIC evidence states. They say nothing about source
  // availability, layer visibility, administrative scope or an observed zero.
  function eligibility(center, radiusM, bounds, options = {}) {
    const toleranceM = isNum(options.toleranceM) && options.toleranceM >= 0 ? options.toleranceM : BOUNDARY_TOLERANCE_M;
    const b = normalizeBounds(bounds);
    const lat = center && Number(center.lat);
    const lon = center && Number(center.lon ?? center.lng);
    const radius = Number(radiusM);
    const valid = b && isNum(lat) && isNum(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && isNum(radius) && radius > 0;
    const state = !valid
      ? STATE.UNKNOWN
      : capInsideRectangle(lat, lon, (radius + toleranceM) / EARTH_RADIUS_M, b)
        ? STATE.WITHIN
        : distanceToRectangle(lat, lon, b) > radius + toleranceM
          ? STATE.OUTSIDE
          : STATE.PARTIAL;
    return Object.freeze({
      state,
      contractVersion: CONTRACT_VERSION,
      toleranceM,
      bounds: valid ? b : null,
    });
  }

  // Eligibility of a Lens circle against the rail extraction contract, given the
  // rectangle the loaded artefact says it was built with (or null when the
  // artefact does not say). A rectangle that is not the contract this build
  // interprets is treated as unknown, never silently accepted.
  function railEligibility(center, radiusM, loadedRecord) {
    if (!recordMatchesContract(loadedRecord)) return eligibility(center, radiusM, null);
    return eligibility(center, radiusM, loadedRecord.bounds);
  }

  const MOBILITY_WITHHELD_REASON = "EXTRACTION_BOUNDS";

  // Applies the eligibility to the per-Lens statistics. Only a WITHIN circle keeps
  // its combined Mobility total. Otherwise the total — and the two components it
  // is made of, and the grand total that includes it — are removed from the
  // returned object, so no downstream renderer can recover the unsafe sum.
  // Nothing here touches the individual records or the map markers.
  function applyMobilitySafety(stats, eligibilityResult) {
    const result = eligibilityResult || eligibility(null, 0, null);
    const withheld = result.state !== STATE.WITHIN;
    const evidence = Object.freeze({
      extractionState: result.state,
      withheld,
      reason: withheld ? MOBILITY_WITHHELD_REASON : null,
      contractVersion: result.contractVersion,
      toleranceM: result.toleranceM,
    });
    if (!withheld) return Object.freeze({ ...stats, mobilityEvidence: evidence });
    return Object.freeze({ ...stats, mobility: null, bike: null, rail: null, total: null, mobilityEvidence: evidence });
  }

  const api = Object.freeze({
    CONTRACT_VERSION,
    EARTH_RADIUS_M,
    RAIL_EXTRACTION_BOUNDS,
    RAIL_EXTRACTION_RECORD,
    BOUNDARY_TOLERANCE_M,
    STATE,
    MOBILITY_WITHHELD_REASON,
    normalizeBounds,
    envelopeParam,
    recordMismatches,
    recordMatchesContract,
    ARTIFACT_EXTRACTION_STATUS,
    describeArtifactExtraction,
    eligibility,
    railEligibility,
    applyMobilitySafety,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.LensExtractionBounds = api;
})();
