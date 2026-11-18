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
