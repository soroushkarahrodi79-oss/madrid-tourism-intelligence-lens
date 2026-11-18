// Historical orthophoto comparison — shareable VIEW state (UX-06, #199). Pure: no DOM,
// no Leaflet, no clock, so the whole round-trip is testable with `node --test`.
//
// This is a VISUAL view, not evidence. It travels under its own keys (hv, hc, hz, hp,
// hd), deliberately separate from the versioned evidence contract in
// js/evidence-url.js (`v=…`): the evidence parser ignores these keys, this parser
// ignores the evidence keys, and no export reads either from the other. A historical
// link carries only what is needed to reopen the picture: centre, zoom, the mosaic
// pair and the divider position.
//
// FAIL-SAFE, NEVER FAIL-SILENT. A link that names any historical key but is not fully
// valid restores NOTHING and reports a reason per dimension. It never clamps a centre,
// rounds a zoom or substitutes the default pair, so a reader is never shown a
// different view dressed up as the one they were sent. Links without any of these
// keys (every pre-UX-06 link) are untouched.

const HIST_URL_VERSION = 1;
// The only pair offered by the comparator: annual PNOA mosaics 2006 (left) and 2023 (right).
const HIST_URL_PAIR = "2006-2023";
// Same Madrid envelope as LENS_SPATIAL_BOUNDS in js/evidence-url.js (a test asserts equality).
const HIST_URL_BOUNDS = Object.freeze({ minLat: 40.0, maxLat: 40.9, minLon: -4.2, maxLon: -3.2 });
// The historical WMS layers are requested up to zoom 19 (see histSideLayer in js/app.js).
const HIST_URL_ZOOM = Object.freeze({ min: 10, max: 19 });
const HIST_URL_KEYS = Object.freeze(["hv", "hc", "hz", "hp", "hd"]);

const HIST_URL_REASON = Object.freeze({
  VERSION: "HIST_VERSION_UNSUPPORTED",
  MISSING: "HIST_MISSING",
  CENTRE: "HIST_INVALID_CENTRE",
  ZOOM: "HIST_INVALID_ZOOM",
  PAIR: "HIST_UNKNOWN_PAIR",
  DIVIDER: "HIST_INVALID_DIVIDER",
});

function histUrlParams(input) {
  if (input instanceof URLSearchParams) return input;
  const text = String(input ?? "");
  const query = text.includes("?") ? text.slice(text.indexOf("?") + 1).split("#")[0] : text.split("#")[0];
  return new URLSearchParams(query);
}

function hasHistoricalState(input) {
  try {
    const params = histUrlParams(input);
    return HIST_URL_KEYS.some((key) => params.has(key));
  } catch {
    return false;
  }
}

function histInBounds(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= HIST_URL_BOUNDS.minLat && lat <= HIST_URL_BOUNDS.maxLat
    && lon >= HIST_URL_BOUNDS.minLon && lon <= HIST_URL_BOUNDS.maxLon;
}

// state: { lat, lon, zoom, fraction (0..1) } -> canonical query string (fixed key order).
function serializeHistoricalState(state) {
  const params = new URLSearchParams();
  params.set("hv", String(HIST_URL_VERSION));
  params.set("hc", `${Number(state.lat).toFixed(5)},${Number(state.lon).toFixed(5)}`);
  params.set("hz", String(Math.round(state.zoom)));
  params.set("hp", HIST_URL_PAIR);
  params.set("hd", String(Math.round(state.fraction * 100)));
  return params.toString();
}

// A historical link carries ONLY the historical keys: no evidence, no polygons, no layers.
function buildHistoricalUrl(baseUrl, state) {
  const base = String(baseUrl).split("#")[0].split("?")[0];
  return `${base}?${serializeHistoricalState(state)}`;
}

// -> { present, ok, state, issues:[{ dimension, code, raw }] }
function parseHistoricalState(input) {
  let params;
  try { params = histUrlParams(input); } catch { return { present: false, ok: false, state: null, issues: [] }; }
  if (!HIST_URL_KEYS.some((key) => params.has(key))) return { present: false, ok: false, state: null, issues: [] };

  const issues = [];
  const issue = (dimension, code, raw) => issues.push({ dimension, code, raw: raw ?? null });

  const rawV = params.get("hv");
  if (rawV === null) issue("version", HIST_URL_REASON.MISSING, null);
  else if (rawV !== String(HIST_URL_VERSION)) issue("version", HIST_URL_REASON.VERSION, rawV);

  const state = {};
  const rawC = params.get("hc");
  if (rawC === null) issue("centre", HIST_URL_REASON.MISSING, null);
  else {
    const m = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(rawC);
    const lat = m ? Number(m[1]) : NaN;
    const lon = m ? Number(m[2]) : NaN;
    if (histInBounds(lat, lon)) { state.lat = lat; state.lon = lon; } else issue("centre", HIST_URL_REASON.CENTRE, rawC);
  }
  const rawZ = params.get("hz");
  if (rawZ === null) issue("zoom", HIST_URL_REASON.MISSING, null);
  else {
    const zoom = /^\d{1,2}$/.test(rawZ) ? Number(rawZ) : NaN;
    if (zoom >= HIST_URL_ZOOM.min && zoom <= HIST_URL_ZOOM.max) state.zoom = zoom; else issue("zoom", HIST_URL_REASON.ZOOM, rawZ);
  }
  const rawP = params.get("hp");
  if (rawP === null) issue("pair", HIST_URL_REASON.MISSING, null);
  else if (rawP === HIST_URL_PAIR) state.pair = rawP;
  else issue("pair", HIST_URL_REASON.PAIR, rawP);
  const rawD = params.get("hd");
  if (rawD === null) issue("divider", HIST_URL_REASON.MISSING, null);
  else {
    const pct = /^\d{1,3}$/.test(rawD) ? Number(rawD) : NaN;
    if (pct >= 0 && pct <= 100) state.fraction = pct / 100; else issue("divider", HIST_URL_REASON.DIVIDER, rawD);
  }

  return issues.length
    ? { present: true, ok: false, state: null, issues }
    : { present: true, ok: true, state, issues: [] };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HIST_URL_VERSION,
    HIST_URL_PAIR,
    HIST_URL_BOUNDS,
    HIST_URL_ZOOM,
    HIST_URL_KEYS,
    HIST_URL_REASON,
    hasHistoricalState,
    serializeHistoricalState,
    buildHistoricalUrl,
    parseHistoricalState,
  };
}
