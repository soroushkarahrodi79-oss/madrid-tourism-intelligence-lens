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
  samplesSufficient,
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

// ── Defect 2: sample sufficiency judged on POST-WARM stored n ─────────────────
const nRaw = (k) => Array.from({ length: k }, (_, i) => 10 + i); // k distinct samples
test("samplesSufficient: 40 minimum — boundary 39/40/41 raw", () => {
  const r39 = samplesSufficient(nRaw(39), 40); // 38 after warm-up
  assert.equal(r39.n_post_warm, 38);
  assert.equal(r39.ok, false);
  const r40 = samplesSufficient(nRaw(40), 40); // 39 after warm-up — NOT sufficient
  assert.equal(r40.n_post_warm, 39);
  assert.equal(r40.ok, false);
  const r41 = samplesSufficient(nRaw(41), 40); // 40 after warm-up — sufficient
  assert.equal(r41.n_post_warm, 40);
  assert.equal(r41.ok, true);
});
test("samplesSufficient: default 48 target really needs 48 VALID (49 raw)", () => {
  assert.equal(samplesSufficient(nRaw(48), 48).ok, false); // 47 post-warm
  assert.equal(samplesSufficient(nRaw(48), 48).n_post_warm, 47);
  assert.equal(samplesSufficient(nRaw(49), 48).ok, true); // 48 post-warm
  assert.equal(samplesSufficient(nRaw(49), 48).n_post_warm, 48);
});
test("samplesSufficient: returned stat satisfies n === raw.length and reproduces", () => {
  const r = samplesSufficient(nRaw(50), 48);
  assert.equal(r.stat.n, r.stat.raw.length);
  assertStatsMatchRaw(r.stat, "boundary");
  const re = summarize(r.stat.raw);
  for (const k of ["n", "min", "median", "p95", "max"]) assert.equal(re[k], r.stat[k]);
});
test("samplesSufficient: empty / single sample → 0 post-warm, insufficient", () => {
  assert.equal(samplesSufficient([], 40).ok, false);
  assert.equal(samplesSufficient([5], 40).n_post_warm, 1); // single sample can't shed a warm frame
  assert.equal(samplesSufficient([5], 40).ok, false);
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
  assert.equal(stale.freshness_status, "stale");
  const panNA = gradeScenario({ interaction: "pan", pan_frame_ms: { p95: 20 }, freshness: { applicable: false, fresh: null } }, THRESHOLDS);
  assert.equal(panNA.freshness_required, false);
  assert.equal(panNA.freshness_status, "na_pan");
  assert.equal(panNA.pass, true);
});

// ── Defect 1: mandatory freshness in FEATURE mode ────────────────────────────
for (const [desc, freshness] of [["null", null], ["missing (undefined)", undefined], ["N/A applicable:false", { applicable: false, fresh: null }]]) {
  test(`feature mode marker: freshness ${desc} → NOT fresh, status 'missing', does NOT pass`, () => {
    const g = gradeScenario({ interaction: "marker_drag", interaction_to_paint_ms: { p95: 90 }, freshness }, THRESHOLDS); // baselineMode defaults false
    assert.equal(g.freshness_required, true);
    assert.equal(g.freshness_status, "missing");
    assert.equal(g.freshness_missing, true);
    assert.equal(g.pass, false);
  });
}
test("feature mode radius: stale freshness → status 'stale', fails (not 'missing')", () => {
  const g = gradeScenario({ interaction: "radius_slider", interaction_to_paint_ms: { p95: 90 }, freshness: { applicable: true, fresh: false } }, THRESHOLDS);
  assert.equal(g.freshness_status, "stale");
  assert.equal(g.freshness_missing, false);
  assert.equal(g.pass, false);
});
test("feature mode marker: applicable:true + fresh:true → passes", () => {
  const g = gradeScenario({ interaction: "marker_drag", interaction_to_paint_ms: { p95: 90 }, freshness: { applicable: true, fresh: true } }, THRESHOLDS);
  assert.equal(g.freshness_status, "fresh");
  assert.equal(g.pass, true);
});
test("BASELINE mode marker: N/A (null or applicable:false) is accepted, not required", () => {
  for (const f of [null, { applicable: false, fresh: null }]) {
    const g = gradeScenario({ interaction: "marker_drag", interaction_to_paint_ms: { p95: 90 }, freshness: f }, THRESHOLDS, { baselineMode: true });
    assert.equal(g.freshness_required, false);
    assert.equal(g.freshness_status, "na_baseline");
    assert.equal(g.pass, true);
  }
});
test("BASELINE mode marker: a present applicable+stale freshness still fails", () => {
  const g = gradeScenario({ interaction: "marker_drag", interaction_to_paint_ms: { p95: 90 }, freshness: { applicable: true, fresh: false } }, THRESHOLDS, { baselineMode: true });
  assert.equal(g.pass, false);
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
// Defect 1 at the three-scenario verdict level: absent/N/A freshness in feature mode
// → INCOMPLETE — FRESHNESS MISSING, never PASS.
for (const [desc, freshness] of [["null", null], ["missing", undefined], ["N/A", { applicable: false, fresh: null }]]) {
  test(`THREE but marker freshness ${desc} (feature mode) → INCOMPLETE — FRESHNESS MISSING, never PASS`, () => {
    const r = rep([marker({ freshness }), radius(), pan()]);
    assert.match(r.verdict, /INCOMPLETE — FRESHNESS MISSING/);
  });
}
test("THREE but radius freshness N/A (feature mode) → INCOMPLETE, never PASS", () => {
  const r = rep([marker(), radius({ freshness: { applicable: false, fresh: null } }), pan()]);
  assert.match(r.verdict, /INCOMPLETE — FRESHNESS MISSING/);
});
test("THREE all fresh (applicable+fresh) → PASS (control for the freshness gate)", () => {
  const r = rep([marker({ freshness: { applicable: true, fresh: true } }), radius({ freshness: { applicable: true, fresh: true } }), pan()]);
  assert.match(r.verdict, /^PASS/);
});
test("pan freshness N/A never blocks PASS (pan does not move the Lens)", () => {
  const r = rep([marker(), radius(), pan({ freshness: { applicable: false, fresh: null } })]);
  assert.match(r.verdict, /^PASS/);
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
