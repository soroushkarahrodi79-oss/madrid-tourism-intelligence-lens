// AC-P0-12 auto_compare — regression tests for the harness-integrity guards
// (research/ac_p0_12/auto_compare_guards.mjs), covering review 5564383172's
// H1 (fail-closed hardware GPU) and H2 (sample sufficiency + PR/main
// comparability + positional drift) with SYNTHETIC FAIL CONDITIONS. Run by CI.

import test from "node:test";
import assert from "node:assert/strict";
import {
  isHardwareGpu, hardwareCheck, validSample, comparableEnv, driftCheck,
} from "../research/ac_p0_12/auto_compare_guards.mjs";

const UHD620 = "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)";

// ── H1: fail-closed hardware GPU ─────────────────────────────────────────────
test("H1 isHardwareGpu: a recognised hardware GPU is accepted", () => {
  assert.equal(isHardwareGpu(UHD620, false), true);
  assert.equal(isHardwareGpu("Apple GPU", false), true);
  assert.equal(isHardwareGpu("ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11)", false), true);
});
test("H1 isHardwareGpu: software / generic / missing renderers are REJECTED (fail closed)", () => {
  for (const r of ["ANGLE (Google, Vulkan SwiftShader driver)", "llvmpipe (LLVM 15)", "Microsoft Basic Render Driver", "Mesa OffScreen", "NO_WEBGL", "unknown", "", null, undefined]) {
    assert.equal(isHardwareGpu(r, false), false, `${r} must be rejected`);
  }
});
test("H1 isHardwareGpu: gl_is_software=true overrides even a vendor-looking string", () => {
  assert.equal(isHardwareGpu(UHD620, true), false);
});
test("H1 isHardwareGpu: unrecognised-but-non-software renderer is NOT positively hardware", () => {
  assert.equal(isHardwareGpu("Some Future Renderer 9000", false), false);
});
test("H1 hardwareCheck: both arms hardware → ok; either software → UNAVAILABLE", () => {
  const hw = (gl, sw = false) => ({ gl_renderer: gl, gl_is_software: sw });
  assert.equal(hardwareCheck(hw(UHD620), hw(UHD620)).ok, true);
  const bad = hardwareCheck(hw(UHD620), hw("SwiftShader", true));
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /not positively established/);
  assert.equal(hardwareCheck(hw("NO_WEBGL"), hw(UHD620)).ok, false);
});

// ── H2a: sample sufficiency / validity ───────────────────────────────────────
test("H2 validSample: ≥48 post-warm frames, no error → ok", () => {
  assert.equal(validSample({ pan_frame_ms: { n: 48 } }, 48).ok, true);
  assert.equal(validSample({ pan_frame_ms: { n: 74 } }, 48).ok, true);
});
test("H2 validSample: errored / too-few / missing captures are rejected", () => {
  assert.equal(validSample({ error: "map centre never moved" }, 48).ok, false);
  assert.equal(validSample({ pan_frame_ms: { n: 47 } }, 48).ok, false);
  assert.equal(validSample({ pan_frame_ms: null }, 48).ok, false);
  assert.equal(validSample(null, 48).ok, false);
  assert.match(validSample({ pan_frame_ms: { n: 10 } }, 48).reason, /too few/);
});

// ── H2b: PR/main environment comparability ───────────────────────────────────
const E = (over = {}) => ({ map: { w: 1036, h: 650 }, zoom: 14, dpr: 2, centre: { lat: 40.415, lon: -3.692 }, data_ready: true, ...over });
test("H2 comparableEnv: identical envs are comparable", () => {
  assert.equal(comparableEnv(E(), E()).ok, true);
});
test("H2 comparableEnv: mismatched map area / zoom / dpr / centre / readiness fail closed", () => {
  assert.equal(comparableEnv(E(), E({ map: { w: 1036, h: 600 } })).ok, false);
  assert.equal(comparableEnv(E(), E({ zoom: 15 })).ok, false);
  assert.equal(comparableEnv(E(), E({ dpr: 1 })).ok, false);
  assert.equal(comparableEnv(E(), E({ centre: { lat: 40.5, lon: -3.692 } })).ok, false);
  const nr = comparableEnv(E(), E({ data_ready: false }));
  assert.equal(nr.ok, false);
  assert.ok(nr.mismatches.some((m) => /data_ready/.test(m)));
});
test("H2 comparableEnv: tiny sub-tolerance differences are allowed", () => {
  assert.equal(comparableEnv(E(), E({ map: { w: 1037, h: 650 }, centre: { lat: 40.41505, lon: -3.692 } })).ok, true);
});

// ── H2c: positional drift ────────────────────────────────────────────────────
const DEF = { lat: 40.415, lon: -3.692 };
test("H2 driftCheck: centres near default pass; far centres fail; reports max drift", () => {
  assert.equal(driftCheck([{ lat: 40.4151, lon: -3.6921 }, { lat: 40.4149, lon: -3.6919 }], DEF).ok, true);
  const bad = driftCheck([{ lat: 40.45, lon: -3.692 }], DEF);
  assert.equal(bad.ok, false);
  assert.ok(bad.max_drift_deg >= 0.03);
});
