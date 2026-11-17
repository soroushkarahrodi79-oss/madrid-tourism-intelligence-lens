// Shareable evidence state — pure, versioned URL-state contract (K11, #73).
//
// This module owns the ONLY mapping between a reading of the workspace and a
// compact, human-inspectable URL. It is deliberately PURE: no DOM, no Leaflet,
// no globals, no clock, no `window`. The app (js/app.js) supplies the current
// reading as a plain object and applies a parsed reading through the existing
// controllers; this file never touches the page. That keeps the whole round-trip
// — serialize, parse, validate — testable with plain `node --test`.
//
// TWO KINDS OF REPRODUCIBILITY, kept distinct (gate §10.5):
//   * INTERFACE reproducibility — "open this link and see the same configuration"
//     (mode, lenses, layers, ámbitos, metric, reading, language). This is what the
//     `v=1` schema restores, exactly, per dimension.
//   * EVIDENCE-SNAPSHOT reproducibility — "and the numbers mean exactly what they
//     meant when the link was made". That cannot be guaranteed by a URL alone: the
//     committed artifacts behind the workspace can be redeployed. So the URL also
//     carries a `snapshot` identity, and a mismatch is surfaced as a WARNING, never
//     silently papered over. A restored interface with changed evidence is honest
//     only if it SAYS the evidence moved.
//
// WHAT IS AND IS NOT A DIMENSION. Every dimension below is REAL application state,
// verified against js/app.js. There is deliberately NO `edition` selector: the
// official edition is a property of the committed artifact, shown but never chosen
// by the user (index.html `#planningEdition` is a display-only paragraph with no
// handler), so inventing an edition key would fabricate a control that does not
// exist. The edition instead travels in the evidence SNAPSHOT identity and in the
// export bundle, where it belongs.
//
// FAIL-SAFE, NEVER FAIL-SILENT. An out-of-range radius, an unknown ámbito code, an
// unknown layer id, an unsupported metric or an unsupported `v` never clamp into a
// different-but-plausible reading. They produce a REASON CODE and either a stated
// refusal or a stated partial restore, so a reader is never shown a different
// analysis dressed up as the one they were sent.

// ------------------------------------------------------------------ constants

const URL_SCHEMA_VERSION = 1;

// The canonical operational layers, in a fixed order so serialization is
// deterministic. These are exactly the `data-layer` ids wired in index.html /
// js/app.js; a test asserts this list stays in sync with the real toggles.
const EVIDENCE_URL_LAYERS = Object.freeze([
  "museum",
  "info",
  "stay",
  "bike",
  "rail",
  "pedestrian",
  "park",
  "heat",
  "hospitality",
  "licences",
]);

// A generous envelope around the Madrid municipality. A Lens centre outside this
// box is not a Madrid reading and is refused for that dimension rather than
// dropped onto a default centre.
const LENS_SPATIAL_BOUNDS = Object.freeze({
  minLat: 40.0,
  maxLat: 40.9,
  minLon: -4.2,
  maxLon: -3.2,
});

// Lens radius bounds, mirrored from js/lens.js LENS_RADIUS. Kept as data here so
// the pure model needs no cross-module import; a test asserts the two agree. The
// step matters: the app snaps every radius to a 50 m increment, so a URL radius
// that is in range but off-step would be silently restored at a DIFFERENT radius.
// The parser treats an off-step radius as a stated partial restore instead.
const LENS_RADIUS_BOUNDS = Object.freeze({ minM: 100, maxM: 5000, stepM: 50 });

const URL_MODES = Object.freeze(["PLACE", "COMPARE", "CITY"]);
const COMPARE_SCOPES = Object.freeze(["LENS", "AMBITO"]);
const READINGS = Object.freeze(["citizen", "analyst"]);
const LANGUAGES = Object.freeze(["es", "en"]);
const ACTIVE_LENSES = Object.freeze(["A", "B"]);
const RADIUS_MODES = Object.freeze(["EQUAL_RADIUS", "UNEQUAL_RADIUS"]);

// The focusable/lockable metric vocabularies, partitioned by scope. In LENS scope
// the metric is one of the four Halo metrics (js/radial-halo.js HALO_METRICS); in
// AMBITO scope it is one of the nine planning metrics (js/ambito-comparison.js
// AMBITO_METRIC_IDS). A metric from the wrong scope is UNKNOWN_METRIC — it never
// silently survives a scope switch. Tests assert both lists match their sources.
const LENS_METRIC_IDS = Object.freeze(["tourism", "stays", "mobility", "utci"]);
const URL_AMBITO_METRIC_IDS = Object.freeze([
  "phase_planeamiento",
  "phase_gestion",
  "phase_urbanizacion_proyecto",
  "phase_urbanizacion_obras",
  "buildability_residential_collective",
  "buildability_residential_single_family",
  "buildability_tertiary",
  "buildability_industrial",
  "ambito_surface",
]);

// Reason codes attached to every degraded or refused dimension. They are stable
// identifiers (not prose) so the UI can localise them and tests can assert them.
const REASON = Object.freeze({
  VERSION_MISSING: "VERSION_MISSING",
  VERSION_UNSUPPORTED: "VERSION_UNSUPPORTED",
  MALFORMED: "MALFORMED",
  INVALID_MODE: "INVALID_MODE",
  INVALID_COORDINATES: "INVALID_COORDINATES",
  INVALID_RADIUS: "INVALID_RADIUS",
  RADIUS_NOT_ON_STEP: "RADIUS_NOT_ON_STEP",
  INVALID_SCOPE: "INVALID_SCOPE",
  UNKNOWN_AMBITO: "UNKNOWN_AMBITO",
  UNKNOWN_LAYER: "UNKNOWN_LAYER",
  UNKNOWN_METRIC: "UNKNOWN_METRIC",
  INVALID_TIMESTEP: "INVALID_TIMESTEP",
  INVALID_STAY_KIND: "INVALID_STAY_KIND",
  INVALID_ORIGIN_MONTH: "INVALID_ORIGIN_MONTH",
  INVALID_LICENCE_WINDOW: "INVALID_LICENCE_WINDOW",
  UNKNOWN_HOSPITALITY_METRIC: "UNKNOWN_HOSPITALITY_METRIC",
  UNKNOWN_HOSPITALITY_BARRIO: "UNKNOWN_HOSPITALITY_BARRIO",
  INVALID_READING: "INVALID_READING",
  INVALID_LANGUAGE: "INVALID_LANGUAGE",
  INVALID_ACTIVE_LENS: "INVALID_ACTIVE_LENS",
  INVALID_BASELINE: "INVALID_BASELINE",
  SNAPSHOT_MISMATCH: "SNAPSHOT_MISMATCH",
  // #197: custom-polygon geometry per Lens. INVALID_GEOMETRY = present but not a
  // restorable ring; GEOMETRY_NOT_IN_LINK = the link was written without a
  // polygon that was too large to encode (so it cannot be an exact reading).
  INVALID_GEOMETRY: "INVALID_GEOMETRY",
  GEOMETRY_NOT_IN_LINK: "GEOMETRY_NOT_IN_LINK",
  // Session file (local JSON) only.
  SESSION_TOO_LARGE: "SESSION_TOO_LARGE",
  SESSION_NOT_JSON: "SESSION_NOT_JSON",
  SESSION_SCHEMA: "SESSION_SCHEMA",
  SESSION_VERSION: "SESSION_VERSION",
  SESSION_STRUCTURE: "SESSION_STRUCTURE",
  GEOMETRY_FINGERPRINT: "GEOMETRY_FINGERPRINT",
});

const OUTCOME = Object.freeze({ EXACT: "EXACT", PARTIAL: "PARTIAL", REFUSED: "REFUSED" });

// Canonical key order. Serialization always emits present keys in this order so a
// given reading maps to exactly ONE string (asserted by a determinism test).
const KEY_ORDER = Object.freeze([
  "v", "s", "m", "a", "b", "ga", "gb", "gx", "be", "al", "ly", "ts", "sk", "om", "lw", "hm", "hb", "sc", "aa", "ab", "fm", "fl", "rd", "lg", "bl", "bk",
]);

// An ISO calendar date, YYYY-MM-DD. Used by the licence grant-date window; the
// app validates against the real register extent, this only guards the shape.
const URL_ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// #197 — POLYGON LINK POLICY. A polygon travels in the URL only when it fits an
// explicit budget; otherwise the link says so (gx) and the local session file is
// the reproducible route. Vertex coordinates are written at 6 decimals (~0.11 m),
// so a LINK restore is geometrically equal only to that precision; the session
// file keeps full float precision. Both limits are tested constants.
const POLYGON_LINK_LIMITS = Object.freeze({ maxVertices: 24, maxQueryLength: 1900, decimals: 6 });
const POLYGON_MIN_VERTICES_URL = 3;
// Session file envelope. Bytes are approximated by string length (UTF-16 units),
// a safe lower bound for the check; a vertex cap bounds memory and compute.
const SESSION_SCHEMA = "madrid-lens-session";
const SESSION_VERSION = 1;
const SESSION_LIMITS = Object.freeze({ maxChars: 262144, maxVertices: 2000 });

// ------------------------------------------------------------------ helpers

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Coordinates render at 5 decimals (~1.1 m), enough to reproduce a Lens centre
// and stable across machines. toFixed gives a deterministic string; Number()
// strips it back for round-trip comparison.
function coordString(value) {
  return Number(value).toFixed(5);
}

function inBounds(lat, lon) {
  return (
    isFiniteNumber(lat) && isFiniteNumber(lon)
    && lat >= LENS_SPATIAL_BOUNDS.minLat && lat <= LENS_SPATIAL_BOUNDS.maxLat
    && lon >= LENS_SPATIAL_BOUNDS.minLon && lon <= LENS_SPATIAL_BOUNDS.maxLon
  );
}

function radiusInBounds(radiusM) {
  return isFiniteNumber(radiusM) && radiusM >= LENS_RADIUS_BOUNDS.minM && radiusM <= LENS_RADIUS_BOUNDS.maxM;
}

// On the app's 50 m step (100, 150, …, 5000). A radius in range but off-step would
// be snapped by the app to a different value, so it is never an EXACT restoration.
function radiusOnStep(radiusM) {
  return Number.isInteger(Math.round((radiusM - LENS_RADIUS_BOUNDS.minM) / LENS_RADIUS_BOUNDS.stepM))
    && Math.abs((radiusM - LENS_RADIUS_BOUNDS.minM) % LENS_RADIUS_BOUNDS.stepM) < 1e-9;
}

function encodeLens(lens) {
  if (!lens) return null;
  return `${coordString(lens.lat)},${coordString(lens.lon)},${Math.round(lens.radiusM)}`;
}

// Parse "lat,lon,r" into a validated lens, or an issue. Returns { lens } or
// { issue } so the caller records exactly why a dimension degraded.
function decodeLens(raw) {
  const parts = String(raw).split(",");
  if (parts.length !== 3) return { issue: REASON.MALFORMED };
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  const radiusM = Number(parts[2]);
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return { issue: REASON.INVALID_COORDINATES };
  if (!inBounds(lat, lon)) return { issue: REASON.INVALID_COORDINATES };
  if (!radiusInBounds(radiusM)) return { issue: REASON.INVALID_RADIUS, lat, lon };
  // In range but off the app's 50 m step: the app would snap it to a different
  // radius, so it is never an exact restoration — degrade, never silently round.
  if (!radiusOnStep(radiusM)) return { issue: REASON.RADIUS_NOT_ON_STEP, lat, lon };
  return { lens: { lat, lon, radiusM } };
}

function vertexInBounds(v) {
  return Boolean(v) && inBounds(v.lat, v.lon);
}

function encodeRing(ring) {
  const d = POLYGON_LINK_LIMITS.decimals;
  return ring.map((v) => `${Number(v.lat).toFixed(d)},${Number(v.lon).toFixed(d)}`).join(";");
}

// "lat,lon;lat,lon;…" -> { ring } | { issue }. Order is preserved exactly; nothing
// is deduplicated, reordered or closed here.
function decodeRing(raw) {
  const parts = String(raw).split(";");
  if (parts.length < POLYGON_MIN_VERTICES_URL || parts.length > POLYGON_LINK_LIMITS.maxVertices) return { issue: REASON.INVALID_GEOMETRY };
  const ring = [];
  for (const part of parts) {
    const xy = part.split(",");
    if (xy.length !== 2 || xy[0].trim() === "" || xy[1].trim() === "") return { issue: REASON.INVALID_GEOMETRY };
    const lat = Number(xy[0]);
    const lon = Number(xy[1]);
    if (!inBounds(lat, lon)) return { issue: REASON.INVALID_GEOMETRY };
    ring.push({ lat, lon });
  }
  if (new Set(ring.map((v) => `${v.lat},${v.lon}`)).size < POLYGON_MIN_VERTICES_URL) return { issue: REASON.INVALID_GEOMETRY };
  return { ring };
}

function polygonRingOf(geometry) {
  return geometry && geometry.kind === "POLYGON" && Array.isArray(geometry.ring) ? geometry.ring : null;
}

// ------------------------------------------------------------------ serialize

// polygonLinkStatus(state) -> { polygonSides, encodable, reason }.
// encodable is false when any polygon side exceeds the vertex cap or the exact
// canonical query would exceed the length budget. All-or-nothing: a link never
// carries one polygon and silently drops the other.
function polygonLinkStatus(state = {}) {
  const sides = [];
  if (polygonRingOf(state.geometryA)) sides.push("A");
  if (polygonRingOf(state.geometryB)) sides.push("B");
  if (!sides.length) return { polygonSides: [], encodable: true, reason: null };
  const tooMany = sides.some((side) => polygonRingOf(side === "A" ? state.geometryA : state.geometryB).length > POLYGON_LINK_LIMITS.maxVertices);
  if (tooMany) return { polygonSides: sides, encodable: false, reason: "VERTEX_LIMIT" };
  if (buildQuery(state, true).length > POLYGON_LINK_LIMITS.maxQueryLength) return { polygonSides: sides, encodable: false, reason: "LENGTH_LIMIT" };
  return { polygonSides: sides, encodable: true, reason: null };
}

// serializeEvidenceState(state) -> canonical query string (no leading "?").
// Emits only the keys that carry meaning for the given reading, in KEY_ORDER, so
// the same reading always yields the same string. It does NOT validate: the app
// passes its own live, already-valid state. Invalid input is still encoded
// faithfully (so a round-trip test can then assert the parser catches it).
function serializeEvidenceState(state = {}) {
  return buildQuery(state, polygonLinkStatus(state).encodable);
}

function buildQuery(state, includeGeometry) {
  const out = new Map();
  out.set("v", String(URL_SCHEMA_VERSION));
  if (state.snapshotId != null && state.snapshotId !== "") out.set("s", String(state.snapshotId));
  out.set("m", String(state.mode ?? "PLACE"));

  if (state.lensA) out.set("a", encodeLens(state.lensA));
  if (state.lensB) out.set("b", encodeLens(state.lensB));
  // #197 polygons. A side with no polygon is a circle (absence = legacy meaning,
  // so every pre-#197 link restores unchanged). A polygon is written only inside
  // the explicit budget; otherwise gx names the omitted side(s) so a restore says
  // the link could not carry them instead of silently showing circles.
  if (includeGeometry) {
    if (polygonRingOf(state.geometryA)) out.set("ga", encodeRing(state.geometryA.ring));
    if (polygonRingOf(state.geometryB)) out.set("gb", encodeRing(state.geometryB.ring));
  } else {
    const omitted = (polygonRingOf(state.geometryA) ? "A" : "") + (polygonRingOf(state.geometryB) ? "B" : "");
    if (omitted) out.set("gx", omitted);
  }
  out.set("be", state.lensBEnabled ? "1" : "0");
  out.set("al", state.activeLens === "B" ? "B" : "A");

  const layers = Array.isArray(state.layers) ? state.layers : [];
  const orderedLayers = EVIDENCE_URL_LAYERS.filter((id) => layers.includes(id));
  // Preserve unknown ids too so the parser can REPORT them rather than the
  // serializer silently dropping them (a caller may round-trip a tampered value).
  const extraLayers = layers.filter((id) => !EVIDENCE_URL_LAYERS.includes(id));
  out.set("ly", [...orderedLayers, ...extraLayers].join("."));

  if (state.timestep != null && state.timestep !== "") out.set("ts", String(state.timestep));
  if (state.stayKind != null && state.stayKind !== "") out.set("sk", String(state.stayKind));
  if (state.originMonth != null && state.originMonth !== "") out.set("om", String(state.originMonth));

  // Licence grant-date window (sub-state of the licences layer): both bounds or
  // neither — a half-open window would restore a DIFFERENT reading than shared.
  if (state.licenceWindow && state.licenceWindow.from && state.licenceWindow.to) {
    out.set("lw", `${state.licenceWindow.from},${state.licenceWindow.to}`);
  }
  // Hospitality metric selection and selected official barrio (sub-state of the
  // hospitality layer). Visibility itself travels in `ly` (data-layer="hospitality").
  if (state.hospitalityMetric != null && state.hospitalityMetric !== "") out.set("hm", String(state.hospitalityMetric));
  if (state.hospitalityBarrio != null && state.hospitalityBarrio !== "") out.set("hb", String(state.hospitalityBarrio));

  out.set("sc", String(state.scope ?? "LENS"));
  if (state.scope === "AMBITO") {
    if (state.ambitoA) out.set("aa", String(state.ambitoA));
    if (state.ambitoB) out.set("ab", String(state.ambitoB));
  }

  if (state.metric && state.metric.id) {
    out.set("fm", String(state.metric.id));
    out.set("fl", state.metric.locked ? "1" : "0");
  }

  out.set("rd", String(state.reading ?? "citizen"));
  out.set("lg", String(state.language ?? "en"));

  if (state.baseline) {
    const b = state.baseline;
    out.set("bl", `${Math.round(b.radiusA)},${Math.round(b.radiusB)},${b.radiusMode ?? ""}`);
    if (b.evidenceKey != null) out.set("bk", String(b.evidenceKey));
  }

  const params = new URLSearchParams();
  for (const key of KEY_ORDER) if (out.has(key)) params.set(key, out.get(key));
  return params.toString();
}

// buildShareUrl(baseUrl, state) -> full canonical URL. baseUrl is the page URL
// without a query/hash; the state becomes its query string. Any existing query or
// hash on baseUrl is dropped so a share link is always canonical.
function buildShareUrl(baseUrl, state) {
  const query = serializeEvidenceState(state);
  const base = String(baseUrl).split("#")[0].split("?")[0];
  return query ? `${base}?${query}` : base;
}

// ------------------------------------------------------------------ parse

function recordIssue(issues, dimension, code, raw) {
  issues.push({ dimension, code, raw: raw === undefined ? null : raw });
}

// parseEvidenceState(input, options) -> a structured restore result.
//
//   input:   a query string, a full URL, or a URLSearchParams.
//   options: { snapshotId, knownAmbitoCodes, knownTimesteps, knownStayKinds,
//              knownOriginMonths, knownLicenceExtent: {min,max},
//              knownHospitalityMetrics, knownHospitalityBarrios }
//            — the live vocabularies the pure model cannot know on its own. Each
//            is optional; when omitted, that dimension is accepted structurally
//            and left for the app to validate at apply time.
//
// Result:
//   {
//     ok,            // true unless the version is refused
//     outcome,       // EXACT | PARTIAL | REFUSED
//     version: { requested, supported },
//     state,         // the restored, validated reading (null when REFUSED)
//     issues,        // [{ dimension, code, raw }]
//     snapshot,      // { stored, current, status: MATCH | MISMATCH | UNKNOWN }
//   }
//
// REFUSED is reserved for a version we cannot safely interpret (missing or not
// `v=1`): restoring a different schema's meaning silently is worse than not
// restoring at all. Every other failure degrades its own dimension and leaves the
// rest of the reading intact — a stated PARTIAL restore.
function parseEvidenceState(input, options = {}) {
  const issues = [];
  let params;
  try {
    if (input instanceof URLSearchParams) {
      params = input;
    } else {
      const text = String(input ?? "");
      const query = text.includes("?") ? text.slice(text.indexOf("?") + 1).split("#")[0] : text.split("#")[0];
      params = new URLSearchParams(query);
    }
  } catch {
    return {
      ok: false,
      outcome: OUTCOME.REFUSED,
      version: { requested: null, supported: URL_SCHEMA_VERSION },
      state: null,
      issues: [{ dimension: "url", code: REASON.MALFORMED, raw: null }],
      snapshot: { stored: null, current: options.snapshotId ?? null, status: "UNKNOWN" },
    };
  }

  // ---- version gate (fail-closed) ----
  const rawVersion = params.get("v");
  if (rawVersion == null) {
    recordIssue(issues, "version", REASON.VERSION_MISSING, null);
    return refused(issues, { requested: null }, options.snapshotId);
  }
  const requested = Number(rawVersion);
  if (!Number.isInteger(requested) || requested !== URL_SCHEMA_VERSION) {
    recordIssue(issues, "version", REASON.VERSION_UNSUPPORTED, rawVersion);
    return refused(issues, { requested: Number.isFinite(requested) ? requested : rawVersion }, options.snapshotId);
  }

  const state = {};

  // ---- mode ----
  const rawMode = params.get("m");
  if (rawMode != null) {
    if (URL_MODES.includes(rawMode)) state.mode = rawMode;
    else recordIssue(issues, "mode", REASON.INVALID_MODE, rawMode);
  }

  // ---- lenses ----
  const rawA = params.get("a");
  if (rawA != null) {
    const res = decodeLens(rawA);
    if (res.lens) state.lensA = res.lens;
    else recordIssue(issues, "lensA", res.issue, rawA);
  }
  const rawB = params.get("b");
  if (rawB != null) {
    const res = decodeLens(rawB);
    if (res.lens) state.lensB = res.lens;
    else recordIssue(issues, "lensB", res.issue, rawB);
  }

  // ---- polygon geometry per Lens (#197). Absent = circle (legacy links). ----
  for (const [key, field] of [["ga", "geometryA"], ["gb", "geometryB"]]) {
    const raw = params.get(key);
    if (raw == null) continue;
    const res = decodeRing(raw);
    if (res.ring) state[field] = { kind: "POLYGON", ring: res.ring };
    else recordIssue(issues, field, res.issue, raw);
  }
  const rawGx = params.get("gx");
  if (rawGx != null && rawGx !== "") recordIssue(issues, "geometry", REASON.GEOMETRY_NOT_IN_LINK, rawGx);

  const rawBe = params.get("be");
  if (rawBe != null) state.lensBEnabled = rawBe === "1";

  const rawActive = params.get("al");
  if (rawActive != null) {
    if (ACTIVE_LENSES.includes(rawActive)) state.activeLens = rawActive;
    else recordIssue(issues, "activeLens", REASON.INVALID_ACTIVE_LENS, rawActive);
  }

  // ---- layers ----
  const rawLayers = params.get("ly");
  if (rawLayers != null) {
    const ids = rawLayers === "" ? [] : rawLayers.split(".");
    const known = [];
    for (const id of ids) {
      if (EVIDENCE_URL_LAYERS.includes(id)) known.push(id);
      else recordIssue(issues, "layers", REASON.UNKNOWN_LAYER, id);
    }
    // Keep canonical order and uniqueness so apply order is deterministic.
    state.layers = EVIDENCE_URL_LAYERS.filter((id) => known.includes(id));
  }

  // ---- heat timestep (sub-state of the heat layer) ----
  const rawTs = params.get("ts");
  if (rawTs != null) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rawTs)) recordIssue(issues, "timestep", REASON.INVALID_TIMESTEP, rawTs);
    else if (options.knownTimesteps && !options.knownTimesteps.includes(rawTs)) recordIssue(issues, "timestep", REASON.INVALID_TIMESTEP, rawTs);
    else state.timestep = rawTs;
  }

  // ---- stay-kind filter (sub-state of the stay layer) ----
  const rawSk = params.get("sk");
  if (rawSk != null) {
    if (options.knownStayKinds && !options.knownStayKinds.includes(rawSk)) recordIssue(issues, "stayKind", REASON.INVALID_STAY_KIND, rawSk);
    else state.stayKind = rawSk;
  }

  // ---- domestic-origin source month (CITY, a real user-selectable dimension) ----
  const rawOriginMonth = params.get("om");
  if (rawOriginMonth != null && rawOriginMonth !== "") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(rawOriginMonth)) {
      recordIssue(issues, "originMonth", REASON.INVALID_ORIGIN_MONTH, rawOriginMonth);
    } else if (options.knownOriginMonths && !options.knownOriginMonths.includes(rawOriginMonth)) {
      // A month not in the published set must not silently fall back to the latest.
      recordIssue(issues, "originMonth", REASON.INVALID_ORIGIN_MONTH, rawOriginMonth);
    } else {
      state.originMonth = rawOriginMonth;
    }
  }

  // ---- licence grant-date window (sub-state of the licences layer) ----
  // Format is guarded here; the real register extent is known only to the app,
  // which validates against it at apply time (knownLicenceExtent when supplied).
  // A window outside the extent, reversed, or half-open is a stated PARTIAL — it
  // never silently clamps to a different window than the one shared.
  const rawLw = params.get("lw");
  if (rawLw != null && rawLw !== "") {
    const parts = rawLw.split(",");
    const from = parts[0];
    const to = parts[1];
    if (parts.length !== 2 || !URL_ISO_DATE.test(from) || !URL_ISO_DATE.test(to) || from > to) {
      recordIssue(issues, "licenceWindow", REASON.INVALID_LICENCE_WINDOW, rawLw);
    } else if (options.knownLicenceExtent && (from < options.knownLicenceExtent.min || to > options.knownLicenceExtent.max)) {
      recordIssue(issues, "licenceWindow", REASON.INVALID_LICENCE_WINDOW, rawLw);
    } else {
      state.licenceWindow = { from, to };
    }
  }

  // ---- hospitality metric selection (sub-state of the hospitality layer) ----
  const rawHm = params.get("hm");
  if (rawHm != null && rawHm !== "") {
    if (options.knownHospitalityMetrics && !options.knownHospitalityMetrics.includes(rawHm)) {
      recordIssue(issues, "hospitalityMetric", REASON.UNKNOWN_HOSPITALITY_METRIC, rawHm);
    } else {
      state.hospitalityMetric = rawHm;
    }
  }

  // ---- hospitality selected official barrio ----
  const rawHb = params.get("hb");
  if (rawHb != null && rawHb !== "") {
    const knownBarrios = options.knownHospitalityBarrios
      ? (options.knownHospitalityBarrios instanceof Set ? options.knownHospitalityBarrios : new Set(options.knownHospitalityBarrios))
      : null;
    if (knownBarrios && !knownBarrios.has(rawHb)) {
      recordIssue(issues, "hospitalityBarrio", REASON.UNKNOWN_HOSPITALITY_BARRIO, rawHb);
    } else {
      state.hospitalityBarrio = rawHb;
    }
  }

  // ---- comparison scope ----
  const rawScope = params.get("sc");
  if (rawScope != null) {
    if (COMPARE_SCOPES.includes(rawScope)) state.scope = rawScope;
    else recordIssue(issues, "scope", REASON.INVALID_SCOPE, rawScope);
  }
  const effectiveScope = state.scope ?? null;

  // ---- ámbito codes (exact official codes only; never normalised) ----
  const knownCodes = options.knownAmbitoCodes
    ? (options.knownAmbitoCodes instanceof Set ? options.knownAmbitoCodes : new Set(options.knownAmbitoCodes))
    : null;
  for (const [key, field] of [["aa", "ambitoA"], ["ab", "ambitoB"]]) {
    const raw = params.get(key);
    if (raw == null || raw === "") continue;
    if (knownCodes && !knownCodes.has(raw)) {
      recordIssue(issues, field, REASON.UNKNOWN_AMBITO, raw);
    } else {
      state[field] = raw;
    }
  }

  // ---- focused / locked metric (scope-partitioned vocabulary) ----
  const rawMetric = params.get("fm");
  if (rawMetric != null && rawMetric !== "") {
    const vocabulary = effectiveScope === "AMBITO" ? URL_AMBITO_METRIC_IDS : LENS_METRIC_IDS;
    if (vocabulary.includes(rawMetric)) {
      state.metric = { id: rawMetric, locked: params.get("fl") === "1" };
    } else {
      recordIssue(issues, "metric", REASON.UNKNOWN_METRIC, rawMetric);
    }
  }

  // ---- reading preference ----
  const rawReading = params.get("rd");
  if (rawReading != null) {
    if (READINGS.includes(rawReading)) state.reading = rawReading;
    else recordIssue(issues, "reading", REASON.INVALID_READING, rawReading);
  }

  // ---- language ----
  const rawLang = params.get("lg");
  if (rawLang != null) {
    if (LANGUAGES.includes(rawLang)) state.language = rawLang;
    else recordIssue(issues, "language", REASON.INVALID_LANGUAGE, rawLang);
  }

  // ---- sensitivity baseline + its identity ----
  const rawBaseline = params.get("bl");
  if (rawBaseline != null && rawBaseline !== "") {
    const parts = rawBaseline.split(",");
    const radiusA = Number(parts[0]);
    const radiusB = Number(parts[1]);
    const radiusMode = parts[2] || null;
    if (parts.length !== 3 || !radiusInBounds(radiusA) || !radiusInBounds(radiusB)
        || !radiusOnStep(radiusA) || !radiusOnStep(radiusB) || !RADIUS_MODES.includes(radiusMode)) {
      recordIssue(issues, "baseline", REASON.INVALID_BASELINE, rawBaseline);
    } else {
      state.baseline = { radiusA, radiusB, radiusMode, evidenceKey: params.get("bk") ?? null };
    }
  }

  // ---- evidence-snapshot identity (warning axis, not a restore refusal) ----
  const storedSnapshot = params.get("s") ?? null;
  const currentSnapshot = options.snapshotId ?? null;
  let snapshotStatus = "UNKNOWN";
  if (storedSnapshot != null && currentSnapshot != null) {
    snapshotStatus = storedSnapshot === currentSnapshot ? "MATCH" : "MISMATCH";
    if (snapshotStatus === "MISMATCH") recordIssue(issues, "snapshot", REASON.SNAPSHOT_MISMATCH, storedSnapshot);
  }
  if (storedSnapshot != null) state.snapshotId = storedSnapshot;

  // A snapshot mismatch is an evidence-reproducibility warning, not an interface
  // degradation: the interface still restored exactly. So it does NOT make the
  // interface outcome PARTIAL on its own.
  const interfaceIssues = issues.filter((issue) => issue.code !== REASON.SNAPSHOT_MISMATCH);
  const outcome = interfaceIssues.length === 0 ? OUTCOME.EXACT : OUTCOME.PARTIAL;

  return {
    ok: true,
    outcome,
    version: { requested, supported: URL_SCHEMA_VERSION },
    state,
    issues,
    snapshot: { stored: storedSnapshot, current: currentSnapshot, status: snapshotStatus },
  };
}

function refused(issues, version, snapshotId) {
  return {
    ok: false,
    outcome: OUTCOME.REFUSED,
    version: { requested: version.requested ?? null, supported: URL_SCHEMA_VERSION },
    state: null,
    issues,
    snapshot: { stored: null, current: snapshotId ?? null, status: "UNKNOWN" },
  };
}


// ------------------------------------------------------------ session file (#197)
//
// The LOCAL, backend-free reproduction route for A/B geometries that do not fit a
// link. It is a JSON transcript of the interface reading (NOT the QGIS evidence
// bundle) and keeps three things distinct:
//   * GEOMETRY EQUALITY — vertices and radii are stored at full float precision
//     in their exact order, and a fingerprint binds the geometries to the
//     readings that were computed from them. A file whose geometries do not match
//     its fingerprint is refused, so results can never be paired with a different
//     geometry.
//   * RESULT EQUIVALENCE — the stored readings are what THIS deployment computed.
//     After an import the app recomputes and compares (compareSessionReadings);
//     "same geometry" never claims "same numbers".
//   * SOURCE AVAILABILITY — the snapshot identity travels with the file; a
//     different deployment build is a stated warning, not a silent pass.

// 53-bit string hash (cyrb53). Integrity against accidental edits and
// geometry/readings mix-ups — NOT a security boundary.
function sessionHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

// Canonical text of the geometry pair. String(number) round-trips exactly through
// JSON, so a faithful save/load reproduces the identical text.
function geometryFingerprint(geometries = {}) {
  const side = (g) => {
    if (!g) return "none";
    if (g.kind === "POLYGON") return `P|${(g.ring || []).map((v) => `${v.lat},${v.lon}`).join(";")}`;
    if (g.kind === "CIRCLE") return `C|${g.center && g.center.lat},${g.center && g.center.lon},${g.radiusM}`;
    return "invalid";
  };
  return sessionHash(`A:${side(geometries.A)}#B:${side(geometries.B)}`);
}

function buildSessionFile(input = {}) {
  const { state = {}, geometries = {}, readings = null, evidence = [], limitations = [], meta = {} } = input;
  const fingerprint = geometryFingerprint(geometries);
  const lens = (l) => (l ? { lat: l.lat, lon: l.lon, radiusM: l.radiusM } : null);
  const file = {
    schema: SESSION_SCHEMA,
    version: SESSION_VERSION,
    generated_at: meta.generatedAt ?? null,
    snapshot_id: meta.snapshotId ?? null,
    app_version: meta.appVersion ?? null,
    state: {
      mode: state.mode ?? "PLACE",
      scope: "LENS",
      activeLens: state.activeLens === "B" ? "B" : "A",
      lensBEnabled: Boolean(state.lensBEnabled),
      lensA: lens(state.lensA),
      lensB: lens(state.lensB),
      layers: Array.isArray(state.layers) ? [...state.layers] : [],
      reading: state.reading ?? "citizen",
      language: state.language ?? "en",
    },
    units: { coordinates: "EPSG:4326 degrees (lat, lon)", radiusM: "metres", areaKm2: "square kilometres", perimeterM: "metres" },
    geometries: { A: geometries.A ?? null, B: geometries.B ?? null },
    geometry_fingerprint: fingerprint,
    readings: readings ? { geometry_fingerprint: fingerprint, ...readings } : null,
    evidence,
    limitations,
  };
  if (state.timestep != null && state.timestep !== "") file.state.timestep = state.timestep;
  if (state.stayKind != null && state.stayKind !== "") file.state.stayKind = state.stayKind;
  return file;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validSessionLens(l) {
  return isPlainObject(l) && inBounds(l.lat, l.lon) && radiusInBounds(l.radiusM) && radiusOnStep(l.radiusM);
}

// Validate one stored geometry. Returns the normalised geometry or null.
function validSessionGeometry(g, createPolygon) {
  if (!isPlainObject(g)) return null;
  if (g.kind === "CIRCLE") {
    const c = g.center;
    if (!isPlainObject(c) || !inBounds(c.lat, c.lon) || !radiusInBounds(g.radiusM) || !radiusOnStep(g.radiusM)) return null;
    return { kind: "CIRCLE", center: { lat: c.lat, lon: c.lon }, radiusM: g.radiusM };
  }
  if (g.kind === "POLYGON") {
    if (!Array.isArray(g.ring) || g.ring.length < POLYGON_MIN_VERTICES_URL || g.ring.length > SESSION_LIMITS.maxVertices) return null;
    const ring = [];
    for (const v of g.ring) {
      if (!isPlainObject(v) || !vertexInBounds(v)) return null;
      ring.push({ lat: v.lat, lon: v.lon });
    }
    if (new Set(ring.map((v) => `${v.lat},${v.lon}`)).size < POLYGON_MIN_VERTICES_URL) return null;
    // Authoritative validity (the app's own ring rules) when the caller supplies
    // it; the pure module cannot import js/lens.js.
    if (typeof createPolygon === "function" && !createPolygon(ring)) return null;
    return { kind: "POLYGON", ring };
  }
  return null;
}

// Dimensions whose failure makes the file unfit to reproduce the comparison. They
// REFUSE the import; peripheral dimensions degrade to a stated PARTIAL.
const SESSION_CORE_DIMENSIONS = Object.freeze(["mode", "activeLens", "scope", "lensBEnabled", "lensA", "lensB", "geometryA", "geometryB", "geometries"]);

// parseSessionFile(text, { snapshotId, createPolygon }) -> {
//   ok, outcome, issues, state, geometries, readings, evidence, limitations, snapshot }
// Pure and side-effect free: the caller applies the result only when ok, so a
// failed import leaves the previous workspace untouched.
function parseSessionFile(text, options = {}) {
  const issues = [];
  const fail = (code, dimension = "session", raw = null) => {
    issues.push({ dimension, code, raw });
    return {
      ok: false, outcome: OUTCOME.REFUSED, issues, state: null, geometries: null, readings: null,
      evidence: [], limitations: [], snapshot: { stored: null, current: options.snapshotId ?? null, status: "UNKNOWN" },
    };
  };
  if (typeof text !== "string") return fail(REASON.SESSION_NOT_JSON);
  if (text.length > SESSION_LIMITS.maxChars) return fail(REASON.SESSION_TOO_LARGE);
  let doc;
  try { doc = JSON.parse(text); } catch { return fail(REASON.SESSION_NOT_JSON); }
  if (!isPlainObject(doc) || doc.schema !== SESSION_SCHEMA) return fail(REASON.SESSION_SCHEMA);
  if (doc.version !== SESSION_VERSION) return fail(REASON.SESSION_VERSION, "version", doc.version);
  const st = doc.state;
  if (!isPlainObject(st) || !isPlainObject(doc.geometries)) return fail(REASON.SESSION_STRUCTURE);

  // ---- core: mode, scope, active lens, B flag, lens circles, geometries ----
  if (st.mode !== "PLACE" && st.mode !== "COMPARE") return fail(REASON.INVALID_MODE, "mode", st.mode);
  if (st.scope !== "LENS") return fail(REASON.INVALID_SCOPE, "scope", st.scope);
  if (!ACTIVE_LENSES.includes(st.activeLens)) return fail(REASON.INVALID_ACTIVE_LENS, "activeLens", st.activeLens);
  if (typeof st.lensBEnabled !== "boolean") return fail(REASON.SESSION_STRUCTURE, "lensBEnabled");
  if (!validSessionLens(st.lensA)) return fail(REASON.INVALID_COORDINATES, "lensA");
  if (!validSessionLens(st.lensB)) return fail(REASON.INVALID_COORDINATES, "lensB");
  const geometries = {};
  for (const side of ACTIVE_LENSES) {
    const g = validSessionGeometry(doc.geometries[side], options.createPolygon);
    if (!g) return fail(REASON.INVALID_GEOMETRY, side === "A" ? "geometryA" : "geometryB");
    geometries[side] = g;
  }
  // A circle side must be the very circle in state: one source of truth.
  for (const [side, lens] of [["A", st.lensA], ["B", st.lensB]]) {
    const g = geometries[side];
    if (g.kind === "CIRCLE" && (g.center.lat !== lens.lat || g.center.lon !== lens.lon || g.radiusM !== lens.radiusM)) {
      return fail(REASON.SESSION_STRUCTURE, side === "A" ? "geometryA" : "geometryB");
    }
  }
  // Results must belong to THESE geometries.
  if (doc.geometry_fingerprint !== geometryFingerprint(geometries)) return fail(REASON.GEOMETRY_FINGERPRINT, "geometries");
  let readings = null;
  if (doc.readings != null) {
    const r = doc.readings;
    const okEntries = isPlainObject(r) && r.geometry_fingerprint === doc.geometry_fingerprint
      && ACTIVE_LENSES.every((side) => isPlainObject(r[side])
        && Object.values(r[side]).every((e) => isPlainObject(e) && (e.value === null || isFiniteNumber(e.value)) && typeof e.status === "string"));
    if (!okEntries) return fail(REASON.GEOMETRY_FINGERPRINT, "readings");
    readings = { A: r.A, B: r.B };
  }
  if (doc.evidence != null && !Array.isArray(doc.evidence)) return fail(REASON.SESSION_STRUCTURE, "evidence");
  if (doc.limitations != null && !Array.isArray(doc.limitations)) return fail(REASON.SESSION_STRUCTURE, "limitations");

  // ---- peripheral dimensions: reuse the URL parser's own validation ----
  const probe = parseEvidenceState(serializeEvidenceState({
    mode: st.mode, scope: "LENS", activeLens: st.activeLens, lensBEnabled: st.lensBEnabled,
    layers: Array.isArray(st.layers) ? st.layers : [], reading: st.reading, language: st.language,
    timestep: st.timestep, stayKind: st.stayKind,
  }), { snapshotId: options.snapshotId ?? null, knownTimesteps: options.knownTimesteps, knownStayKinds: options.knownStayKinds });
  if (!probe.ok) return fail(REASON.SESSION_STRUCTURE, "state");
  for (const issue of probe.issues) {
    if (issue.code === REASON.SNAPSHOT_MISMATCH) continue;
    if (SESSION_CORE_DIMENSIONS.includes(issue.dimension)) return fail(issue.code, issue.dimension, issue.raw);
    issues.push(issue);
  }
  const state = {
    ...probe.state,
    mode: st.mode, scope: "LENS", activeLens: st.activeLens, lensBEnabled: st.lensBEnabled,
    lensA: { lat: st.lensA.lat, lon: st.lensA.lon, radiusM: st.lensA.radiusM },
    lensB: { lat: st.lensB.lat, lon: st.lensB.lon, radiusM: st.lensB.radiusM },
  };
  delete state.snapshotId;
  for (const [side, field] of [["A", "geometryA"], ["B", "geometryB"]]) {
    if (geometries[side].kind === "POLYGON") state[field] = { kind: "POLYGON", ring: geometries[side].ring };
  }

  const stored = typeof doc.snapshot_id === "string" ? doc.snapshot_id : null;
  const current = options.snapshotId ?? null;
  const status = stored != null && current != null ? (stored === current ? "MATCH" : "MISMATCH") : "UNKNOWN";
  if (status === "MISMATCH") issues.push({ dimension: "snapshot", code: REASON.SNAPSHOT_MISMATCH, raw: stored });
  const peripheral = issues.filter((i) => i.code !== REASON.SNAPSHOT_MISMATCH);
  return {
    ok: true,
    outcome: peripheral.length ? OUTCOME.PARTIAL : OUTCOME.EXACT,
    issues, state, geometries, readings,
    evidence: doc.evidence ?? [], limitations: doc.limitations ?? [],
    snapshot: { stored, current, status },
  };
}

// compareSessionReadings(stored, current) -> { equivalent, comparable, differences[] }.
// Geometry equality is already established by the fingerprint; this answers the
// separate question "do the recomputed numbers match what was exported?".
function compareSessionReadings(stored, current) {
  const differences = [];
  if (!stored || !current) return { equivalent: false, comparable: false, differences };
  for (const side of ACTIVE_LENSES) {
    const keys = new Set([...Object.keys(stored[side] || {}), ...Object.keys(current[side] || {})]);
    for (const key of keys) {
      const a = (stored[side] || {})[key];
      const b = (current[side] || {})[key];
      if (!a || !b || a.value !== b.value || a.status !== b.status) differences.push({ side, metric: key, stored: a ?? null, current: b ?? null });
    }
  }
  return { equivalent: differences.length === 0, comparable: true, differences };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    URL_SCHEMA_VERSION,
    EVIDENCE_URL_LAYERS,
    LENS_SPATIAL_BOUNDS,
    LENS_RADIUS_BOUNDS,
    MODES: URL_MODES,
    COMPARE_SCOPES,
    READINGS,
    LANGUAGES,
    ACTIVE_LENSES,
    RADIUS_MODES,
    LENS_METRIC_IDS,
    AMBITO_METRIC_IDS: URL_AMBITO_METRIC_IDS,
    REASON,
    OUTCOME,
    serializeEvidenceState,
    buildShareUrl,
    parseEvidenceState,
    POLYGON_LINK_LIMITS,
    SESSION_SCHEMA,
    SESSION_VERSION,
    SESSION_LIMITS,
    polygonLinkStatus,
    geometryFingerprint,
    buildSessionFile,
    parseSessionFile,
    compareSessionReadings,
  };
}
