// UX-06 (#199): the historical-view URL contract is pure, strict and separate from the evidence contract.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const H = require("../js/historical-url.js");
const E = require("../js/evidence-url.js");

const GOOD = { lat: 40.3925, lon: -3.699, zoom: 17, fraction: 0.5 };

test("round trip: centre, zoom, pair and divider restore exactly, in canonical key order", () => {
  const url = H.buildHistoricalUrl("https://example.test/app/?x=1#h", GOOD);
  assert.equal(url, "https://example.test/app/?hv=1&hc=40.39250%2C-3.69900&hz=17&hp=2006-2023&hd=50");
  const parsed = H.parseHistoricalState(url);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state, { lat: 40.3925, lon: -3.699, zoom: 17, pair: "2006-2023", fraction: 0.5 });
});

test("links without historical keys (every older link) are not historical", () => {
  const evidence = "?v=1&m=PLACE&a=40.4168,-3.7038,500&ly=museum&lg=en";
  assert.equal(H.hasHistoricalState(evidence), false);
  assert.deepEqual(H.parseHistoricalState(evidence), { present: false, ok: false, state: null, issues: [] });
});

test("the evidence parser ignores historical keys and the historical link carries no evidence keys", () => {
  const query = H.buildHistoricalUrl("https://example.test/", GOOD).split("?")[1];
  const keys = [...new URLSearchParams(query).keys()];
  assert.deepEqual(keys, ["hv", "hc", "hz", "hp", "hd"]);
  const evidenceQuery = E.serializeEvidenceState({ mode: "PLACE" });
  for (const key of keys) assert.ok(!evidenceQuery.split("&").some((p) => p.startsWith(`${key}=`)));
  const evidence = E.parseEvidenceState(`?v=1&m=PLACE&${query}`);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.outcome, E.OUTCOME.EXACT, "historical keys never degrade or alter an evidence restore");
});

test("every invalid part is refused with its own reason; nothing is clamped or defaulted", () => {
  const base = "hv=1&hc=40.4435,-3.7106&hz=16&hp=2006-2023&hd=50";
  const cases = [
    [base.replace("hv=1", "hv=2"), "HIST_VERSION_UNSUPPORTED"],
    [base.replace("hv=1&", ""), "HIST_MISSING"],
    [base.replace("hc=40.4435,-3.7106", "hc=48.85,2.35"), "HIST_INVALID_CENTRE"],
    [base.replace("hc=40.4435,-3.7106", "hc=abc"), "HIST_INVALID_CENTRE"],
    [base.replace("hz=16", "hz=8"), "HIST_INVALID_ZOOM"],
    [base.replace("hz=16", "hz=20"), "HIST_INVALID_ZOOM"],
    [base.replace("hz=16", "hz=16.5"), "HIST_INVALID_ZOOM"],
    [base.replace("&hz=16", ""), "HIST_MISSING"],
    [base.replace("hp=2006-2023", "hp=2006-2019"), "HIST_UNKNOWN_PAIR"],
    [base.replace("&hp=2006-2023", ""), "HIST_MISSING"],
    [base.replace("hd=50", "hd=101"), "HIST_INVALID_DIVIDER"],
    [base.replace("hd=50", "hd=-1"), "HIST_INVALID_DIVIDER"],
    [base.replace("hd=50", "hd=5x"), "HIST_INVALID_DIVIDER"],
  ];
  for (const [query, code] of cases) {
    const r = H.parseHistoricalState(`?${query}`);
    assert.equal(r.present, true, query);
    assert.equal(r.ok, false, query);
    assert.equal(r.state, null, `${query}: no partial state is ever returned`);
    assert.ok(r.issues.some((i) => i.code === code), `${query} -> ${code}, got ${JSON.stringify(r.issues)}`);
  }
});

test("boundary values are valid (divider 0 and 100, zoom 9 and 19)", () => {
  for (const [zoom, pct] of [[9, 0], [10, 0], [19, 100]]) {
    const r = H.parseHistoricalState(`?hv=1&hc=40.4,-3.7&hz=${zoom}&hp=2006-2023&hd=${pct}`);
    assert.equal(r.ok, true);
    assert.equal(r.state.zoom, zoom);
    assert.equal(r.state.fraction, pct / 100);
  }
});

// Gate 2: the link frame is the official Comunidad de Madrid extent (IGN INSPIRE
// 34130000000: lat 39.884719–41.165845, lon −4.579076 to −3.052983) rounded outward.
const REGION_EXTENT = { minLat: 39.884719, maxLat: 41.165845, minLon: -4.579076, maxLon: -3.052983 };

test("Gate 2: bounds are the official Comunidad de Madrid extent rounded outward to 0.01°", () => {
  assert.deepEqual({ ...H.HIST_URL_BOUNDS }, { minLat: 39.88, maxLat: 41.17, minLon: -4.58, maxLon: -3.05 });
  const b = H.HIST_URL_BOUNDS;
  assert.ok(b.minLat <= REGION_EXTENT.minLat && b.maxLat >= REGION_EXTENT.maxLat, "the whole region's latitude span is inside");
  assert.ok(b.minLon <= REGION_EXTENT.minLon && b.maxLon >= REGION_EXTENT.maxLon, "the whole region's longitude span is inside");
  for (const k of ["minLat", "minLon"]) assert.ok(REGION_EXTENT[k] - b[k] < 0.01, `${k}: rounded by less than 0.01°`);
  for (const k of ["maxLat", "maxLon"]) assert.ok(b[k] - REGION_EXTENT[k] < 0.01, `${k}: rounded by less than 0.01°`);
});

test("Gate 2: the frame contains the earlier Madrid envelope, and the evidence contract's envelope is unchanged", () => {
  assert.deepEqual({ ...E.LENS_SPATIAL_BOUNDS }, { minLat: 40.0, maxLat: 40.9, minLon: -4.2, maxLon: -3.2 }, "analytical scope is not widened");
  const L = E.LENS_SPATIAL_BOUNDS;
  const b = H.HIST_URL_BOUNDS;
  assert.ok(b.minLat <= L.minLat && b.maxLat >= L.maxLat && b.minLon <= L.minLon && b.maxLon >= L.maxLon);
  // Every corner of the old envelope (the extreme links that could exist before Gate 2) still restores.
  for (const lat of [L.minLat, L.maxLat]) for (const lon of [L.minLon, L.maxLon]) {
    assert.equal(H.parseHistoricalState(`?hv=1&hc=${lat},${lon}&hz=15&hp=2006-2023&hd=50`).ok, true, `${lat},${lon}`);
  }
});

test("Gate 2: regional places round-trip exactly; centres beyond the frame are still refused, never clamped", () => {
  const places = {
    aranjuez: [40.03226, -3.60225], navalcarnero: [40.29501, -4.00356], smvaldeiglesias: [40.36546, -4.40161],
    chinchon: [40.13988, -3.42072], buitrago: [40.98502, -3.63816], rascafria: [40.90433, -3.87844],
    south: [39.895, -3.8], north: [41.155, -3.55], west: [40.217, -4.56], east: [40.1, -3.065],
  };
  for (const [name, [lat, lon]] of Object.entries(places)) {
    const url = H.buildHistoricalUrl("https://example.test/", { lat, lon, zoom: 16, fraction: 0.3, pair: "ams1956-2023" });
    const r = H.parseHistoricalState(url);
    assert.equal(r.ok, true, name);
    assert.deepEqual(r.state, { lat, lon, zoom: 16, pair: "ams1956-2023", fraction: 0.3 }, name);
  }
  for (const hc of ["39.86,-4.02", "41.18,-3.6", "40.4,-4.59", "40.4,-3.04", "41.65,-0.88"]) {
    const r = H.parseHistoricalState(`?hv=1&hc=${hc}&hz=15&hp=2006-2023&hd=50`);
    assert.equal(r.ok, false, hc);
    assert.equal(r.state, null, hc);
    assert.deepEqual(r.issues.map((i) => i.code), ["HIST_INVALID_CENTRE"], hc);
  }
});

// ---- Urban Time Machine: verified coverage catalogue and the A/B pair contract ----
test("catalogue: only Gate-0-verified IGN layers, unique ids, chronological, no interpolated years", () => {
  const ids = H.HIST_COVERAGES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  assert.equal(new Set(H.HIST_COVERAGES.map((c) => c.label)).size, ids.length, "labels are unique");
  assert.deepEqual(H.HIST_COVERAGES.map((c) => c.layer), [
    "AMS_1956-1957", "OLISTAT", "SIGPAC", "PNOA2006", "PNOA2009", "pnoa10_2009", "PNOA2011",
    "pnoa10_2013", "PNOA2014", "pnoa10_2016", "PNOA2017", "PNOA2020", "PNOA2023",
  ]);
  for (let i = 1; i < H.HIST_COVERAGES.length; i += 1) {
    const [a, b] = [H.HIST_COVERAGES[i - 1], H.HIST_COVERAGES[i]];
    assert.ok(a.from < b.from || (a.from === b.from && a.to <= b.to), `${a.id} sorts before ${b.id}`);
  }
  for (const c of H.HIST_COVERAGES) {
    assert.ok(Object.isFrozen(c));
    assert.ok(c.from <= c.to && c.res_m > 0);
    assert.equal(c.when === "annual", c.from === c.to, `${c.id}: an annual mosaic has one year, an interval has two`);
    assert.match(c.id, /^[a-z0-9_]+$/, "an id never contains the pair separator");
  }
  // Layers that returned no imagery over Madrid in Gate 0 are never offered.
  for (const absent of ["PNOA2004", "PNOA2010", "PNOA2019", "PNOA2022", "PNOA2024", "Nacional_1981-1986", "Interministerial_1973-1986", "OrtoExpeditaLIDAR2024"]) {
    assert.ok(!H.HIST_COVERAGES.some((c) => c.layer === absent), `${absent} is not offered`);
  }
});

test("pair: the default is 2006-2023, so every link made before the catalogue keeps its meaning", () => {
  assert.equal(H.HIST_URL_PAIR, "2006-2023");
  assert.deepEqual(H.splitHistoricalPair("2006-2023"), { left: "2006", right: "2023" });
  assert.equal(H.parseHistoricalState("?hv=1&hc=40.4435,-3.7106&hz=16&hp=2006-2023&hd=50").ok, true);
});

test("pair: any two different verified dates round-trip, in either order", () => {
  for (const pair of ["ams1956-2023", "2023-ams1956", "sigpac-pnoa10_2016", "olistat-sigpac", "2009-pnoa10_2009"]) {
    const url = H.buildHistoricalUrl("https://example.test/", { ...GOOD, pair });
    const parsed = H.parseHistoricalState(url);
    assert.equal(parsed.ok, true, pair);
    assert.equal(parsed.state.pair, pair);
    const [left, right] = pair.split("-");
    assert.deepEqual(H.splitHistoricalPair(pair), { left, right });
  }
});

test("pair: unknown, repeated or malformed dates are refused, never substituted", () => {
  for (const pair of ["2006-2019", "2006-2006", "ams1956", "2006-2023-2020", "AMS1956-2023", "1956-2023", "2006_2023", ""]) {
    assert.equal(H.splitHistoricalPair(pair), null, pair);
    const parsed = H.parseHistoricalState(`?hv=1&hc=40.4435,-3.7106&hz=16&hp=${encodeURIComponent(pair)}&hd=50`);
    assert.equal(parsed.ok, false, pair);
    assert.deepEqual(parsed.issues.map((i) => i.code), ["HIST_UNKNOWN_PAIR"], pair);
  }
});

// ---- Gate 3: zoom 9 for the whole-Comunidad view; playback order -----------------------------
test("Gate 3: zoom 9 (the whole-Comunidad framing) is shareable; 8 is refused; every 10–19 link is unchanged", () => {
  assert.deepEqual({ ...H.HIST_URL_ZOOM }, { min: 9, max: 19 });
  const region = "hv=1&hc=40.52500,-3.81500&hz=9&hp=2006-2023&hd=50";
  const r = H.parseHistoricalState(`?${region}`);
  assert.equal(r.ok, true);
  assert.equal(r.state.zoom, 9);
  assert.equal(H.parseHistoricalState(`?${H.serializeHistoricalState(r.state)}`).state.zoom, 9, "a zoom-9 view round-trips exactly");
  assert.deepEqual(H.parseHistoricalState("?hv=1&hc=40.525,-3.815&hz=8&hp=2006-2023&hd=50").issues.map((i) => i.code), ["HIST_INVALID_ZOOM"]);
  for (let zoom = 10; zoom <= 19; zoom += 1) {
    const old = H.parseHistoricalState(`?hv=1&hc=40.4435,-3.7106&hz=${zoom}&hp=2006-2023&hd=50`);
    assert.equal(old.ok, true, `hz=${zoom}`);
    assert.equal(old.state.zoom, zoom);
  }
});

test("Gate 3: the evidence contract's own limits are untouched by the historical zoom change", () => {
  assert.deepEqual({ ...E.LENS_SPATIAL_BOUNDS }, { minLat: 40.0, maxLat: 40.9, minLon: -4.2, maxLon: -3.2 });
});

test("Gate 3: the playback series follows the documented order (first year, last year, regional before 10 cm)", () => {
  const all = H.histSeries({ includeCity: true });
  assert.deepEqual(all, ["ams1956", "olistat", "sigpac", "2006", "2009", "pnoa10_2009", "2011", "pnoa10_2013", "2014", "pnoa10_2016", "2017", "2020", "2023"]);
  assert.deepEqual(all, H.HIST_COVERAGES.map((c) => c.id), "the catalogue is already in playback order");
  for (let i = 1; i < all.length; i += 1) {
    const a = H.histCoverage(all[i - 1]);
    const b = H.histCoverage(all[i]);
    assert.ok(a.from < b.from || (a.from === b.from && (a.to < b.to || (a.to === b.to && a.extent !== "city"))), `${a.id} before ${b.id}`);
  }
  // Overlapping intervals keep their original names; no acquisition day is invented.
  assert.equal(H.histCoverage("olistat").label, "1997–98");
  assert.equal(H.histCoverage("sigpac").label, "1997–2003");
});

test("Gate 3: by default the series keeps one family of resolutions (no 10 cm city frames)", () => {
  const regional = H.histSeries();
  assert.deepEqual(regional, ["ams1956", "olistat", "sigpac", "2006", "2009", "2011", "2014", "2017", "2020", "2023"]);
  assert.ok(regional.every((id) => H.histCoverage(id).extent !== "city" && H.histCoverage(id).res_m >= 0.25));
});

test("Gate 3: the reference date is never a frame; the successor is defined by catalogue order; the end is null", () => {
  const seq = H.histPlaySequence(H.histSeries(), "2006");
  assert.ok(!seq.includes("2006"));
  assert.equal(seq.length, 9);
  assert.equal(H.histPlayNextId(seq, "sigpac"), "2009", "the reference is skipped");
  assert.equal(H.histPlayNextId(seq, "pnoa10_2013"), "2014", "a 10 cm date picked by hand has a defined successor");
  assert.equal(H.histPlayNextId(seq, "2023"), null, "no loop: playback stops at the last date");
  assert.equal(H.histPlayNextId(seq, "ams1956"), "olistat");
});

test("Gate 3: frame actions — only fully available imagery lets the display time run", () => {
  for (const s of ["ok", "edge", "nocover"]) assert.equal(H.histFrameAction(s), "show", s);
  for (const s of ["loading", "idle", undefined]) assert.equal(H.histFrameAction(s), "wait", String(s));
  for (const s of ["error", "partial"]) assert.equal(H.histFrameAction(s), "halt", s);
});
