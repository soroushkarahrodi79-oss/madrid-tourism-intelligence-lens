// AC-P0-12 device runner — executable regression for the runner's PURE functions
// (research/ac_p0_12/runner_core.mjs): the host gate that mirrors js/app.js, the
// fail-closed device-grade verdict, the freshness signature, scenario grading and
// the overall verdict assembly. Run by CI via `node --test`.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isLoopbackOrPrivateLanHost,
  membershipSignature,
  summarize,
  gradeScenario,
  deviceGradeFor,
  observedDeviceClass,
  detectAttestationConflict,
  buildReport,
} from "../research/ac_p0_12/runner_core.mjs";

const THRESHOLDS = {
  thresholds: {
    interaction_to_paint_ms: { good_p95: 100, acceptable_p95: 150 },
    pan_frame_ms: { good_p95: 16.7, acceptable_p95: 33.3 },
  },
};

// ── host gate: permitted dev/LAN hosts vs public hosts ───────────────────────
test("host gate: loopback and private-LAN hosts are permitted", () => {
  for (const h of ["localhost", "dev.localhost", "127.0.0.1", "127.5.6.7", "::1",
    "10.0.0.5", "192.168.1.20", "172.16.3.4", "172.31.255.1", "169.254.10.1",
    "fe80::1", "macbook.local", "[::1]"]) {
    assert.equal(isLoopbackOrPrivateLanHost(h), true, `${h} should be permitted`);
  }
});

test("host gate: public / non-RFC1918 hosts are refused (GitHub Pages etc.)", () => {
  for (const h of ["soroushkarahrodi79-oss.github.io", "example.com", "8.8.8.8",
    "172.15.0.1", "172.32.0.1", "11.0.0.1", "192.167.0.1", "203.0.113.5",
    "256.1.1.1", ""]) {
    assert.equal(isLoopbackOrPrivateLanHost(h), false, `${h} should be refused`);
  }
});

test("host gate mirrors js/app.js (identical predicate source present in both)", () => {
  const appJs = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(appJs, /function isLoopbackOrPrivateLanHost\(hostname\)/);
  // the distinctive RFC1918 branch must be present in the production copy too
  assert.match(appJs, /o\[0\] === 172 && o\[1\] >= 16 && o\[1\] <= 31/);
});

// ── freshness signature equals js/app.js' encoding ───────────────────────────
test("membershipSignature encodes code:containsCentre per entry + lang", () => {
  const canonical = { count: 2, touched: [
    { ambitoCode: "APE.00.01", containsCentre: true },
    { ambitoCode: "APR.06.03", containsCentre: false },
  ] };
  assert.equal(membershipSignature(canonical, "en"), "APE.00.01:1,APR.06.03:0|en");
  assert.equal(membershipSignature({ count: 0, touched: [] }, "es"), "|es");
});

// ── summarize ────────────────────────────────────────────────────────────────
test("summarize returns n/median/p95/max and drops non-finite", () => {
  const s = summarize([10, 20, 30, 40, 50, NaN, Infinity]);
  assert.equal(s.n, 5);
  assert.equal(s.min, 10);
  assert.equal(s.max, 50);
  assert.ok(s.p95 >= s.median);
});
test("summarize of empty → null", () => assert.equal(summarize([]), null));

// ── scenario grading ─────────────────────────────────────────────────────────
test("gradeScenario: itp within 150 + fresh + enough → pass", () => {
  const g = gradeScenario({
    interaction_to_paint_ms: { p95: 120, n: 48 },
    freshness: { fresh: true }, samples_ok: true,
  }, THRESHOLDS);
  assert.equal(g.pass, true);
  assert.equal(g.checks[0].is_good, false); // 120 > 100
});
test("gradeScenario: itp over 150 → fail", () => {
  const g = gradeScenario({ interaction_to_paint_ms: { p95: 160 }, samples_ok: true }, THRESHOLDS);
  assert.equal(g.pass, false);
});
test("gradeScenario: stale freshness fails even if metrics pass", () => {
  const g = gradeScenario({ pan_frame_ms: { p95: 20 }, freshness: { fresh: false }, samples_ok: true }, THRESHOLDS);
  assert.equal(g.pass, false);
  assert.equal(g.freshness_ok, false);
});
test("gradeScenario: too few samples fails", () => {
  const g = gradeScenario({ pan_frame_ms: { p95: 20 }, samples_ok: false }, THRESHOLDS);
  assert.equal(g.pass, false);
});
test("gradeScenario: pan within 33.3 passes; 16.7 flagged good", () => {
  const g = gradeScenario({ pan_frame_ms: { p95: 15 }, samples_ok: true }, THRESHOLDS);
  assert.equal(g.pass, true);
  assert.equal(g.checks[0].is_good, true);
});

// ── device-grade fail-closed ─────────────────────────────────────────────────
const appleEnv = { gl_renderer: "Apple GPU", gl_is_software: false, userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari", device_label: "iPad Air M2" };
test("device-grade: Apple GPU + label + actual gesture + samples → device-grade", () => {
  const r = deviceGradeFor(appleEnv, { label: "iPad Air M2", measurement_kind: "actual_gesture", samples_ok: true });
  assert.equal(r.device_grade, true);
});
test("device-grade: software GPU fails closed", () => {
  const r = deviceGradeFor({ ...appleEnv, gl_renderer: "SwiftShader", gl_is_software: true }, { label: "x", measurement_kind: "actual_gesture", samples_ok: true });
  assert.equal(r.device_grade, false);
});
test("device-grade: automated-only fails closed (no actual gesture)", () => {
  const r = deviceGradeFor(appleEnv, { label: "iPad", measurement_kind: "automated_sequence", samples_ok: true });
  assert.equal(r.device_grade, false);
});
test("device-grade: missing label fails closed", () => {
  const r = deviceGradeFor(appleEnv, { label: "", measurement_kind: "actual_gesture", samples_ok: true });
  assert.equal(r.device_grade, false);
});
test("device-grade: attestation conflict fails closed", () => {
  const r = deviceGradeFor(appleEnv, { label: "iPad", measurement_kind: "actual_gesture", samples_ok: true, attestation_conflict: true });
  assert.equal(r.device_grade, false);
});

// ── observed class + conflict ────────────────────────────────────────────────
test("observedDeviceClass: iPad desktop-mode (Macintosh + touch) → tablet", () => {
  assert.equal(observedDeviceClass({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari", maxTouchPoints: 5 }), "tablet");
});
test("observedDeviceClass: Windows → desktop", () => {
  assert.equal(observedDeviceClass({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome", maxTouchPoints: 0 }), "desktop");
});
test("detectAttestationConflict: desktop observed vs phone claimed → conflict", () => {
  assert.equal(detectAttestationConflict("phone", { userAgent: "Windows NT 10.0", maxTouchPoints: 0 }), true);
});
test("detectAttestationConflict: tablet observed vs tablet claimed → no conflict", () => {
  assert.equal(detectAttestationConflict("tablet", { userAgent: "iPad; CPU OS 18", maxTouchPoints: 5 }), false);
});

// ── overall verdict assembly ─────────────────────────────────────────────────
function actualScenario(overrides = {}) {
  return {
    scenario: "actual_gesture_marker_drag", label: "Actual gesture · marker drag",
    measurement_kind: "actual_gesture", interaction: "marker_drag",
    interaction_to_paint_ms: { p95: 90, n: 48 }, pan_frame_ms: null,
    freshness: { fresh: true }, samples_ok: true, ...overrides,
  };
}
test("verdict: automated only → INCOMPLETE (never PASS from proxies)", () => {
  const rep = buildReport({
    env: appleEnv, thresholds: THRESHOLDS, deviceClass: "tablet", testCommit: "abc",
    scenarios: [{ scenario: "automated_marker_drag_r900", measurement_kind: "automated_sequence", interaction_to_paint_ms: { p95: 90, n: 48 }, samples_ok: true, freshness: { fresh: true } }],
  });
  assert.match(rep.verdict, /INCOMPLETE/);
});
test("verdict: device-grade actual gestures within thresholds → PASS", () => {
  const rep = buildReport({ env: appleEnv, thresholds: THRESHOLDS, deviceClass: "tablet", testCommit: "abc", scenarios: [actualScenario()] });
  assert.match(rep.verdict, /^PASS/);
});
test("verdict: actual gesture over threshold → FAIL", () => {
  const rep = buildReport({ env: appleEnv, thresholds: THRESHOLDS, deviceClass: "tablet", scenarios: [actualScenario({ interaction_to_paint_ms: { p95: 200, n: 48 } })] });
  assert.match(rep.verdict, /^FAIL/);
});
test("verdict: declared phone but observed desktop → REFUSED", () => {
  const rep = buildReport({ env: { ...appleEnv, userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome", maxTouchPoints: 0 }, thresholds: THRESHOLDS, deviceClass: "phone", scenarios: [actualScenario()] });
  assert.match(rep.verdict, /REFUSED/);
});
test("verdict: stale freshness on actual gesture → FAIL (not pass)", () => {
  const rep = buildReport({ env: appleEnv, thresholds: THRESHOLDS, deviceClass: "tablet", scenarios: [actualScenario({ freshness: { fresh: false } })] });
  assert.match(rep.verdict, /^FAIL/);
});
