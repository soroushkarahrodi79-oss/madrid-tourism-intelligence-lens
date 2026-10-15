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
  INVALID_READING: "INVALID_READING",
  INVALID_LANGUAGE: "INVALID_LANGUAGE",
  INVALID_ACTIVE_LENS: "INVALID_ACTIVE_LENS",
  INVALID_BASELINE: "INVALID_BASELINE",
  SNAPSHOT_MISMATCH: "SNAPSHOT_MISMATCH",
});

const OUTCOME = Object.freeze({ EXACT: "EXACT", PARTIAL: "PARTIAL", REFUSED: "REFUSED" });

// Canonical key order. Serialization always emits present keys in this order so a
// given reading maps to exactly ONE string (asserted by a determinism test).
const KEY_ORDER = Object.freeze([
  "v", "s", "m", "a", "b", "be", "al", "ly", "ts", "sk", "sc", "aa", "ab", "fm", "fl", "rd", "lg", "bl", "bk",
]);

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

// ------------------------------------------------------------------ serialize

// serializeEvidenceState(state) -> canonical query string (no leading "?").
// Emits only the keys that carry meaning for the given reading, in KEY_ORDER, so
// the same reading always yields the same string. It does NOT validate: the app
// passes its own live, already-valid state. Invalid input is still encoded
// faithfully (so a round-trip test can then assert the parser catches it).
function serializeEvidenceState(state = {}) {
  const out = new Map();
  out.set("v", String(URL_SCHEMA_VERSION));
  if (state.snapshotId != null && state.snapshotId !== "") out.set("s", String(state.snapshotId));
  out.set("m", String(state.mode ?? "PLACE"));

  if (state.lensA) out.set("a", encodeLens(state.lensA));
  if (state.lensB) out.set("b", encodeLens(state.lensB));
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
//   options: { snapshotId, knownAmbitoCodes, knownTimesteps, knownStayKinds }
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
  };
}
