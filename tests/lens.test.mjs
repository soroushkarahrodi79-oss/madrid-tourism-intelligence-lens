import assert from "node:assert/strict";
import test from "node:test";
import { haversineMeters, poiStatsInLens, deltaOrDash } from "../js/lens.js";

test("haversineMeters: zero distance for identical points", () => {
  const p = { lat: 40.4149, lon: -3.69 };
  assert.equal(haversineMeters(p, p), 0);
});

test("haversineMeters: known short distance is plausible", () => {
  const a = { lat: 40.4149, lon: -3.69 };
  const b = { lat: 40.4159, lon: -3.69 }; // ~111 m north
  const d = haversineMeters(a, b);
  assert.ok(d > 90 && d < 130, `expected ~111m, got ${d}`);
});

test("poiStatsInLens: deterministic across repeated calls", () => {
  const points = [
    { type: "museum", lat: 40.4149, lon: -3.69 },
    { type: "stay", lat: 40.4149, lon: -3.6905 },
    { type: "bike", lat: 40.5, lon: -3.9 }, // far away, excluded
  ];
  const center = { lat: 40.4149, lon: -3.69 };
  const s1 = poiStatsInLens(points, center, 500);
  const s2 = poiStatsInLens(points, center, 500);
  assert.deepEqual(s1, s2);
  assert.equal(s1.museum, 1);
  assert.equal(s1.stay, 1);
  assert.equal(s1.bike, 0);
  assert.equal(s1.total, 2);
});

test("poiStatsInLens: empty lens returns zeroed counts, not undefined", () => {
  const s = poiStatsInLens([], { lat: 0, lon: 0 }, 500);
  assert.equal(s.total, 0);
  assert.deepEqual(s.nearest, []);
});

test("deltaOrDash: null when either side lacks a value", () => {
  assert.equal(deltaOrDash(null, 5), null);
  assert.equal(deltaOrDash(5, null), null);
});

test("deltaOrDash: signed delta string when both sides have values", () => {
  assert.equal(deltaOrDash(10, 14), "+4");
  assert.equal(deltaOrDash(14, 10), "-4");
});
