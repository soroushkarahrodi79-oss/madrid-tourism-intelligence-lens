// AC-P0-12 device runner — executable regression for the runner's PURE functions
// (research/ac_p0_12/runner_core.mjs). Covers the measurement-integrity
// corrections from independent review 5563658339:
//   R1 metric scoping (marker/radius→ITP only; pan→pan-frame only)
//   R2 complete-scenario gate (0/1/2/3 scenarios, missing metric, failed freshness)
//   R3 attribution predicates (genuine Lens/radius/map change)
//   R4 raw↔stats reproducibility (n === raw.length; recompute from raw)
//   R5 baseline mode (freshness N/A, not a gate verdict)
// Run by CI via `node --test`.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isLoopbackOrPrivateLanHost,
  membershipSignature,
  summarize,
  assertStatsMatchRaw,
  gradeScenario,
  deviceGradeFor,
  observedDeviceClass,
  detectAttestationConflict,
  buildReport,
  lensAnyMoved,
  mapMoved,
  dropWarm,
  REQUIRED_ACTUAL_SCENARIOS,
  INTERACTION_METRIC,
} from "../research/ac_p0_12/runner_core.mjs";

const THRESHOLDS = {
  thresholds: {
    interaction_to_paint_ms: { good_p95: 100, acceptable_p95: 150 },
    pan_frame_ms: { good_p95: 16.7, acceptable_p95: 33.3 },
  },
};
const appleEnv = { gl_renderer: "Apple GPU", gl_is_software: false, userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari", device_label: "iPad Air M2", observed_device_class: "tablet" };

// ── host gate (unchanged) ────────────────────────────────────────────────────
test("host gate: loopback and private-LAN hosts permitted; public refused", () => {
  for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.20", "172.16.3.4", "169.254.1.1", "fe80::1", "box.local"]) assert.equal(isLoopbackOrPrivateLanHost(h), true, h);
  for (const h of ["example.com", "8.8.8.8", "172.15.0.1", "172.32.0.1", "pages.github.io", ""]) assert.equal(isLoopbackOrPrivateLanHost(h), false, h);
});
test("host gate predicate present in js/app.js", () => {
  const appJs = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(appJs, /function isLoopbackOrPrivateLanHost\(hostname\)/);
  assert.match(appJs, /const haloRegressionLocal = isLoopbackOrPrivateLanHost\(window\.location\.hostname\);/);
});
test("js/app.js exposes the read-only mapView seam for pan attribution", () => {
  const appJs = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(appJs, /mapView\(\)\s*\{\s*const c = map\.getCenter\(\);/);
});

// ── R4 raw↔stats integrity ───────────────────────────────────────────────────
test("summarize stores raw that reproduces n/median/p95/max exactly", () => {
  const s = summarize([30, 10, 20, 50, 40]);
  assert.equal(s.n, 5);
  assert.equal(s.n, s.raw.length);
  assertStatsMatchRaw(s, "test");
  const re = summarize(s.raw);
  for (const k of ["n", "min", "median", "p95", "max"]) assert.equal(re[k], s[k]);
});
test("assertStatsMatchRaw throws when n !== raw.length (the 1604 vs 1603 bug)", () => {
  const s = summarize([1, 2, 3, 4]);
  s.n = 5; // simulate reporting one more than stored
  assert.throws(() => assertStatsMatchRaw(s, "bug"), /n=5 but raw.length=4/);
});
test("assertStatsMatchRaw throws when a statistic is edited away from raw", () => {
  const s = summarize([10, 20, 30, 40]);
  s.p95 = 999;
  assert.throws(() => assertStatsMatchRaw(s, "bug"), /p95/);
});
test("dropWarm removes exactly the first sample before stats", () => {
  assert.deepEqual(dropWarm([9, 1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(dropWarm([5]), [5]); // never drops the only sample
  assert.deepEqual(dropWarm([]), []);
});

// ── R3 attribution predicates ────────────────────────────────────────────────
test("lensAnyMoved: true only when a Lens centre actually moved", () => {
  const a = { A: { lat: 40.4, lon: -3.7 }, B: { lat: 40.4, lon: -3.7 } };
  assert.equal(lensAnyMoved(a, a), false);
  assert.equal(lensAnyMoved(a, { A: { lat: 40.4001, lon: -3.7 }, B: a.B }), true);
  assert.equal(lensAnyMoved(a, null), false);
});
test("mapMoved: true on a real centre or zoom change, false when idle", () => {
  const a = { lat: 40.4, lon: -3.7, zoom: 14 };
  assert.equal(mapMoved(a, { ...a }), false);
  assert.equal(mapMoved(a, { lat: 40.41, lon: -3.7, zoom: 14 }), true);
  assert.equal(mapMoved(a, { lat: 40.4, lon: -3.7, zoom: 15 }), true);
});

// ── R1 metric scoping ────────────────────────────────────────────────────────
test("INTERACTION_METRIC maps each interaction to exactly one scored metric", () => {
  assert.equal(INTERACTION_METRIC.marker_drag, "interaction_to_paint_ms");
  assert.equal(INTERACTION_METRIC.radius_slider, "interaction_to_paint_ms");
  assert.equal(INTERACTION_METRIC.pan, "pan_frame_ms");
});
test("marker_drag is graded on ITP only — a bad frame metric is NOT applied (the Windows FAIL cause)", () => {
  // Windows evidence: ITP p95 70.7 (<=150), whole-capture frame p95 66.4 (>33.3).
  const g = gradeScenario({
    interaction: "marker_drag",
    interaction_to_paint_ms: { p95: 70.7, n: 243, raw: [] },
    capture_frame_ms_diagnostic: { p95: 66.4, n: 1603 }, // diagnostic, must be ignored
    pan_frame_ms: null,
    freshness: { applicable: true, fresh: true },
  }, THRESHOLDS);
  assert.equal(g.scored_metric, "interaction_to_paint_ms");
  assert.equal(g.checks.length, 1);
  assert.equal(g.checks[0].metric, "interaction_to_paint_ms.p95");
  assert.equal(g.pass, true); // scoped correctly → marker drag passes on ITP
});
test("pan is graded on pan-frame only; ITP is never applied to a pan", () => {
  const g = gradeScenario({ interaction: "pan", pan_frame_ms: { p95: 20, n: 60 }, interaction_to_paint_ms: null, samples_ok: true }, THRESHOLDS);
  assert.equal(g.scored_metric, "pan_frame_ms");
  assert.equal(g.pass, true);
  const fail = gradeScenario({ interaction: "pan", pan_frame_ms: { p95: 40, n: 60 }, samples_ok: true }, THRESHOLDS);
  assert.equal(fail.pass, false); // 40 > 33.3
});
test("marker/radius require freshness; pan does not", () => {
  const stale = gradeScenario({ interaction: "marker_drag", interaction_to_paint_ms: { p95: 90 }, freshness: { applicable: true, fresh: false } }, THRESHOLDS);
  assert.equal(stale.pass, false);
  const panNA = gradeScenario({ interaction: "pan", pan_frame_ms: { p95: 20 }, freshness: { applicable: false, fresh: null } }, THRESHOLDS);
  assert.equal(panNA.freshness_required, false);
  assert.equal(panNA.pass, true);
});
test("baseline freshness N/A does not fail a marker/radius scenario (R5)", () => {
  const g = gradeScenario({ interaction: "marker_drag", interaction_to_paint_ms: { p95: 90 }, freshness: { applicable: false, fresh: null } }, THRESHOLDS);
  assert.equal(g.freshness_required, false);
  assert.equal(g.pass, true);
});
test("a missing scored metric is not a silent pass", () => {
  const g = gradeScenario({ interaction: "pan", pan_frame_ms: null }, THRESHOLDS);
  assert.equal(g.graded, false);
  assert.equal(g.pass, false);
});

// ── device-grade fail-closed ─────────────────────────────────────────────────
test("device-grade: Apple GPU + label + actual gesture + samples → device-grade", () => {
  assert.equal(deviceGradeFor(appleEnv, { label: "iPad Air M2", measurement_kind: "actual_gesture", samples_ok: true }).device_grade, true);
});
test("device-grade fails closed on software GPU / automated-only / missing label / conflict", () => {
  assert.equal(deviceGradeFor({ ...appleEnv, gl_renderer: "SwiftShader", gl_is_software: true }, { label: "x", measurement_kind: "actual_gesture", samples_ok: true }).device_grade, false);
  assert.equal(deviceGradeFor(appleEnv, { label: "iPad", measurement_kind: "automated_sequence", samples_ok: true }).device_grade, false);
  assert.equal(deviceGradeFor(appleEnv, { label: "", measurement_kind: "actual_gesture", samples_ok: true }).device_grade, false);
  assert.equal(deviceGradeFor(appleEnv, { label: "iPad", measurement_kind: "actual_gesture", samples_ok: true, attestation_conflict: true }).device_grade, false);
});
test("observed class + attestation conflict", () => {
  assert.equal(observedDeviceClass({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari", maxTouchPoints: 5 }), "tablet");
  assert.equal(detectAttestationConflict("phone", { userAgent: "Windows NT 10.0", maxTouchPoints: 0 }), true);
  assert.equal(detectAttestationConflict("tablet", { userAgent: "iPad; CPU OS 18", maxTouchPoints: 5 }), false);
});

// ── R2 complete-scenario gate: 0 / 1 / 2 / 3 scenarios ───────────────────────
function marker(overrides = {}) {
  return { scenario: "actual_gesture_marker_drag", measurement_kind: "actual_gesture", interaction: "marker_drag", interaction_to_paint_ms: { p95: 90, n: 48 }, freshness: { applicable: true, fresh: true }, samples_ok: true, ...overrides };
}
function radius(overrides = {}) {
  return { scenario: "actual_gesture_radius", measurement_kind: "actual_gesture", interaction: "radius_slider", interaction_to_paint_ms: { p95: 95, n: 48 }, freshness: { applicable: true, fresh: true }, samples_ok: true, ...overrides };
}
function pan(overrides = {}) {
  return { scenario: "actual_gesture_pan", measurement_kind: "actual_gesture", interaction: "pan", pan_frame_ms: { p95: 20, n: 60 }, freshness: { applicable: false, fresh: null }, samples_ok: true, ...overrides };
}
const rep = (scenarios, extra = {}) => buildReport({ env: appleEnv, thresholds: THRESHOLDS, deviceClass: "tablet", testCommit: "abc", scenarios, ...extra });

test("REQUIRED_ACTUAL_SCENARIOS is exactly the three gesture ids", () => {
  assert.deepEqual([...REQUIRED_ACTUAL_SCENARIOS], ["actual_gesture_marker_drag", "actual_gesture_radius", "actual_gesture_pan"]);
});
test("ZERO actual scenarios (automated only) → INCOMPLETE, never PASS", () => {
  const r = rep([{ scenario: "automated_marker_drag_r900", measurement_kind: "automated_sequence", interaction: "marker_drag", interaction_to_paint_ms: { p95: 90, n: 48 }, samples_ok: true }]);
  assert.match(r.verdict, /INCOMPLETE — MISSING/);
  assert.deepEqual(r.missing_actual_scenarios, REQUIRED_ACTUAL_SCENARIOS.slice());
});
test("ONE actual scenario → INCOMPLETE (the bug the review flagged: no PASS from one)", () => {
  const r = rep([marker()]);
  assert.match(r.verdict, /INCOMPLETE — MISSING/);
  assert.ok(r.missing_actual_scenarios.includes("actual_gesture_radius"));
  assert.ok(r.missing_actual_scenarios.includes("actual_gesture_pan"));
});
test("TWO actual scenarios → still INCOMPLETE", () => {
  const r = rep([marker(), radius()]);
  assert.match(r.verdict, /INCOMPLETE — MISSING/);
  assert.deepEqual(r.missing_actual_scenarios, ["actual_gesture_pan"]);
});
test("THREE device-grade scenarios within thresholds → PASS", () => {
  const r = rep([marker(), radius(), pan()]);
  assert.match(r.verdict, /^PASS/);
  assert.deepEqual(r.present_actual_scenarios, REQUIRED_ACTUAL_SCENARIOS.slice());
});
test("THREE but one over threshold → FAIL", () => {
  const r = rep([marker({ interaction_to_paint_ms: { p95: 200, n: 48 } }), radius(), pan()]);
  assert.match(r.verdict, /^FAIL/);
});
test("THREE but one NOT TESTED (error) → INCOMPLETE, not PASS", () => {
  const r = rep([marker(), radius(), pan({ error: "map-centre attribution unavailable (seam.mapView absent) — NOT TESTED", pan_frame_ms: null })]);
  assert.match(r.verdict, /INCOMPLETE — SCENARIO NOT TESTED/);
});
test("THREE but one under-sampled → INCOMPLETE", () => {
  const r = rep([marker(), radius(), pan({ samples_ok: false })]);
  assert.match(r.verdict, /INCOMPLETE — INSUFFICIENT SAMPLES/);
});
test("THREE but one missing its scored metric → INCOMPLETE", () => {
  const r = rep([marker(), radius(), pan({ pan_frame_ms: null })]);
  assert.match(r.verdict, /INCOMPLETE — METRIC MISSING/);
});
test("THREE but marker freshness STALE → FAIL", () => {
  const r = rep([marker({ freshness: { applicable: true, fresh: false } }), radius(), pan()]);
  assert.match(r.verdict, /^FAIL/);
});
test("declared phone but observed desktop → REFUSED even with three scenarios", () => {
  const r = buildReport({ env: { ...appleEnv, userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome", maxTouchPoints: 0, observed_device_class: "desktop" }, thresholds: THRESHOLDS, deviceClass: "phone", scenarios: [marker(), radius(), pan()] });
  assert.match(r.verdict, /REFUSED/);
});
test("software GPU → NOT DEVICE-GRADE even with three passing scenarios", () => {
  const r = buildReport({ env: { ...appleEnv, gl_renderer: "SwiftShader", gl_is_software: true }, thresholds: THRESHOLDS, deviceClass: "tablet", scenarios: [marker(), radius(), pan()] });
  assert.match(r.verdict, /NOT DEVICE-GRADE/);
});

// ── R5 baseline mode ─────────────────────────────────────────────────────────
test("baseline mode → BASELINE verdict, never an AC-P0-12 gate", () => {
  const r = rep([marker({ freshness: { applicable: false, fresh: null } }), radius({ freshness: { applicable: false, fresh: null } }), pan()], { baselineMode: true });
  assert.match(r.verdict, /^BASELINE \(main\)/);
  assert.equal(r.baseline_mode, true);
});
test("membershipSignature encodes code:containsCentre + lang (freshness basis)", () => {
  assert.equal(membershipSignature({ touched: [{ ambitoCode: "APE.00.01", containsCentre: true }, { ambitoCode: "APR.06.03", containsCentre: false }] }, "en"), "APE.00.01:1,APR.06.03:0|en");
});
