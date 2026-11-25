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
    [base.replace("hz=16", "hz=9"), "HIST_INVALID_ZOOM"],
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

test("boundary values are valid (divider 0 and 100, zoom 10 and 19)", () => {
  for (const [zoom, pct] of [[10, 0], [19, 100]]) {
    const r = H.parseHistoricalState(`?hv=1&hc=40.4,-3.7&hz=${zoom}&hp=2006-2023&hd=${pct}`);
    assert.equal(r.ok, true);
    assert.equal(r.state.zoom, zoom);
    assert.equal(r.state.fraction, pct / 100);
  }
});

test("bounds equal the evidence contract's Madrid envelope", () => {
  assert.deepEqual({ ...H.HIST_URL_BOUNDS }, { ...E.LENS_SPATIAL_BOUNDS });
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
