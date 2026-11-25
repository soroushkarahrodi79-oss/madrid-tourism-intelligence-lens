// Historical orthophoto comparison — shareable VIEW state (UX-06, #199). Pure: no DOM,
// no Leaflet, no clock, so the whole round-trip is testable with `node --test`.
//
// This is a VISUAL view, not evidence. It travels under its own keys (hv, hc, hz, hp,
// hd), deliberately separate from the versioned evidence contract in
// js/evidence-url.js (`v=…`): the evidence parser ignores these keys, this parser
// ignores the evidence keys, and no export reads either from the other. A historical
// link carries only what is needed to reopen the picture: centre, zoom, the mosaic
// pair (two verified coverages, see HIST_COVERAGES) and the divider position.
//
// FAIL-SAFE, NEVER FAIL-SILENT. A link that names any historical key but is not fully
// valid restores NOTHING and reports a reason per dimension. It never clamps a centre,
// rounds a zoom or substitutes the default pair, so a reader is never shown a
// different view dressed up as the one they were sent. Links without any of these
// keys (every pre-UX-06 link) are untouched.

const HIST_URL_VERSION = 1;

// ---- Verified coverages (Gate 0, Madrid Urban Time Machine; checked 2026-11-25) -------
// Every entry is a layer of the IGN historical WMS (https://www.ign.es/wms/pnoa-historico,
// service AccessConstraints "CC BY 4.0 scne.es"). An entry is admitted only if real GetMap
// images (not just HTTP 200) came back at all eight test points inside Madrid municipality
// (Sol, Madrid Río, Valdecarros, Los Berrocales, El Cañaveral, Chamartín, Barajas, Casa de
// Campo) and at Getafe; see docs/URBAN_TIME_MACHINE_GATE0.md. Layers that returned empty
// images in Madrid (PNOA 2004/05/07/08/10/12/13/15/16/18/19/21/22/24, Nacional 1981-86,
// Interministerial 1973-86, PNOA10 outside Madrid) are NOT offered.
//   when:   "annual" = PNOA annual mosaic, year only, no acquisition day;
//           "interval" = a flight over a documented multi-year interval;
//   res_m:  ground resolution at Madrid from the service's infoVuelos point query;
//   resConflict: the layer abstract states a different resolution (AMS: 1 m outside the
//           regions it lists), so the figure is shown with that caveat;
//   extent: "city" = PNOA10, footprint limited to the Madrid city area.
// The id is what a shared link carries (hp=<left>-<right>); annual PNOA ids are the year, so
// every link made before this catalogue ("2006-2023") keeps its exact meaning.
const HIST_COVERAGES = Object.freeze([
  { id: "ams1956", layer: "AMS_1956-1957", label: "1956–57", from: 1956, to: 1957, when: "interval", res_m: 0.5, resConflict: true, product: "Vuelo Americano, serie B (US Army Map Service)" },
  { id: "olistat", layer: "OLISTAT", label: "1997–98", from: 1997, to: 1998, when: "interval", res_m: 1, product: "Vuelo OLISTAT (Ministerio de Agricultura)" },
  { id: "sigpac", layer: "SIGPAC", label: "1997–2003", from: 1997, to: 2003, when: "interval", res_m: 0.5, product: "Vuelo SIGPAC (FEGA, Ministerio de Agricultura)" },
  { id: "2006", layer: "PNOA2006", label: "2006", from: 2006, to: 2006, when: "annual", res_m: 0.5, product: "PNOA 2006" },
  { id: "2009", layer: "PNOA2009", label: "2009", from: 2009, to: 2009, when: "annual", res_m: 0.5, product: "PNOA 2009" },
  { id: "pnoa10_2009", layer: "pnoa10_2009", label: "2009 · 10 cm", from: 2009, to: 2009, when: "annual", res_m: 0.1, extent: "city", product: "PNOA10 Madrid 2009" },
  { id: "2011", layer: "PNOA2011", label: "2011", from: 2011, to: 2011, when: "annual", res_m: 0.25, product: "PNOA 2011" },
  { id: "pnoa10_2013", layer: "pnoa10_2013", label: "2013 · 10 cm", from: 2013, to: 2013, when: "annual", res_m: 0.1, extent: "city", product: "PNOA10 Madrid 2013" },
  { id: "2014", layer: "PNOA2014", label: "2014", from: 2014, to: 2014, when: "annual", res_m: 0.25, product: "PNOA 2014" },
  { id: "pnoa10_2016", layer: "pnoa10_2016", label: "2016 · 10 cm", from: 2016, to: 2016, when: "annual", res_m: 0.1, extent: "city", product: "PNOA10 Madrid 2016" },
  { id: "2017", layer: "PNOA2017", label: "2017", from: 2017, to: 2017, when: "annual", res_m: 0.25, product: "PNOA 2017" },
  { id: "2020", layer: "PNOA2020", label: "2020", from: 2020, to: 2020, when: "annual", res_m: 0.25, product: "PNOA 2020" },
  { id: "2023", layer: "PNOA2023", label: "2023", from: 2023, to: 2023, when: "annual", res_m: 0.25, product: "PNOA 2023" },
].map((c) => Object.freeze(c)));
const HIST_COVERAGE_BY_ID = new Map(HIST_COVERAGES.map((c) => [c.id, c]));
const HIST_DEFAULT_PAIR = Object.freeze({ left: "2006", right: "2023" });

function histCoverage(id) {
  return HIST_COVERAGE_BY_ID.get(String(id)) || null;
}

// "<left>-<right>" -> { left, right } for two DIFFERENT verified coverages, else null.
function splitHistoricalPair(pair) {
  const m = /^([a-z0-9_]+)-([a-z0-9_]+)$/.exec(String(pair ?? ""));
  if (!m || m[1] === m[2] || !histCoverage(m[1]) || !histCoverage(m[2])) return null;
  return { left: m[1], right: m[2] };
}

function joinHistoricalPair(left, right) {
  return `${left}-${right}`;
}

// The pair the comparator opened with before the catalogue existed.
const HIST_URL_PAIR = joinHistoricalPair(HIST_DEFAULT_PAIR.left, HIST_DEFAULT_PAIR.right);
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

// state: { lat, lon, zoom, fraction (0..1), pair? } -> canonical query string (fixed key order).
// A missing pair is the default 2006-2023 pair.
function serializeHistoricalState(state) {
  const params = new URLSearchParams();
  params.set("hv", String(HIST_URL_VERSION));
  params.set("hc", `${Number(state.lat).toFixed(5)},${Number(state.lon).toFixed(5)}`);
  params.set("hz", String(Math.round(state.zoom)));
  params.set("hp", state.pair ?? HIST_URL_PAIR);
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
  else if (splitHistoricalPair(rawP)) state.pair = rawP;
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
    HIST_COVERAGES,
    HIST_DEFAULT_PAIR,
    histCoverage,
    splitHistoricalPair,
    joinHistoricalPair,
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
