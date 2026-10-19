// AC-P0-12 auto_compare — regression tests for the harness-integrity guards
// (research/ac_p0_12/auto_compare_guards.mjs). Covers review 5564383172 (H1/H2/H3)
// AND review 5567748806 R1/R2 hardening: finite raw post-warm samples with
// independently-recomputed statistics and genuine movement; finite comparable
// fields incl. rendered layer/tile/marker counts; non-empty start-centre array;
// a strict, enforced drift tolerance. Run by CI.

import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../research/ac_p0_12/runner_core.mjs";
import {
  isHardwareGpu, hardwareCheck, validSample, comparableEnv, driftCheck, DRIFT_TOL_DEG, layersLabel,
} from "../research/ac_p0_12/auto_compare_guards.mjs";
import { readFileSync } from "node:fs";

const UHD620 = "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)";
// A genuine pan_frame_ms (raw-backed, stats recompute) of n samples.
const realPF = (n) => summarize(Array.from({ length: n }, (_, i) => 16.7 + (i % 5)));
const realSample = (n = 60) => ({ pan_frame_ms: realPF(n), active_pan_frames: n + 1 });

// ── H1: fail-closed hardware GPU ─────────────────────────────────────────────
test("H1 isHardwareGpu: recognised hardware accepted; software/generic/missing rejected", () => {
  assert.equal(isHardwareGpu(UHD620, false), true);
  assert.equal(isHardwareGpu("Apple GPU", false), true);
  for (const r of ["ANGLE (Google, Vulkan SwiftShader driver)", "llvmpipe (LLVM 15)", "Microsoft Basic Render Driver", "NO_WEBGL", "unknown", "", null, "Some Future Renderer 9000"]) assert.equal(isHardwareGpu(r, false), false, `${r}`);
  assert.equal(isHardwareGpu(UHD620, true), false); // gl_is_software overrides
});
test("H1 hardwareCheck: both hardware → ok; either software → UNAVAILABLE", () => {
  const hw = (gl, sw = false) => ({ gl_renderer: gl, gl_is_software: sw });
  assert.equal(hardwareCheck(hw(UHD620), hw(UHD620)).ok, true);
  assert.equal(hardwareCheck(hw(UHD620), hw("SwiftShader", true)).ok, false);
  assert.equal(hardwareCheck(hw("NO_WEBGL"), hw(UHD620)).ok, false);
});

// ── R1 H2a: sample validity — real raw, recomputed stats, genuine movement ───
test("H2 validSample: a genuine raw-backed ≥48-frame sample passes", () => {
  assert.equal(validSample(realSample(60), 48).ok, true);
  assert.equal(validSample(realSample(48), 48).ok, true);
});
test("R1 validSample REJECTS a fabricated {n:48} with no raw samples", () => {
  const r = validSample({ pan_frame_ms: { n: 48 } }, 48);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no raw samples/);
});
test("R1 validSample REJECTS n !== raw.length", () => {
  const pf = realPF(60); pf.n = 59;
  assert.equal(validSample({ pan_frame_ms: pf, active_pan_frames: 61 }, 48).ok, false);
});
test("R1 validSample REJECTS non-finite raw samples", () => {
  const pf = realPF(60); pf.raw = [...pf.raw.slice(0, -1), Infinity];
  const r = validSample({ pan_frame_ms: pf, active_pan_frames: 61 }, 48);
  assert.equal(r.ok, false);
  assert.match(r.reason, /non-finite|recompute/);
});
test("R1 validSample REJECTS statistics that do not recompute from raw", () => {
  const pf = realPF(60); pf.p95 = 9999; // tampered
  const r = validSample({ pan_frame_ms: pf, active_pan_frames: 61 }, 48);
  assert.equal(r.ok, false);
  assert.match(r.reason, /recompute/);
});
test("R1 validSample REJECTS non-finite p50/median", () => {
  const pf = realPF(60); pf.median = NaN;
  assert.equal(validSample({ pan_frame_ms: pf, active_pan_frames: 61 }, 48).ok, false);
});
test("H2 validSample REJECTS errored / too-few / missing captures", () => {
  assert.equal(validSample({ error: "map centre never moved" }, 48).ok, false);
  assert.equal(validSample({ pan_frame_ms: realPF(47), active_pan_frames: 48 }, 48).ok, false);
  assert.equal(validSample({ pan_frame_ms: null }, 48).ok, false);
  assert.equal(validSample(null, 48).ok, false);
});
test("R1 validSample REJECTS too-few genuine active-pan frames", () => {
  assert.equal(validSample({ pan_frame_ms: realPF(60), active_pan_frames: 10 }, 48).ok, false);
});

// ── R1/R2 H2b: comparability — finite fields + render-state counts ───────────
const R = { tiles: 15, canvases: 6, markers: 3, paths: 0 };
const E = (over = {}) => ({ map: { w: 1036, h: 650 }, zoom: 14, dpr: 2, centre: { lat: 40.415, lon: -3.692 }, data_ready: true, render: { ...R }, ...over });
test("H2 comparableEnv: identical envs comparable", () => {
  assert.equal(comparableEnv(E(), E()).ok, true);
});
test("R1 comparableEnv REJECTS missing/NaN numeric fields (Math.abs(NaN) pitfall closed)", () => {
  assert.equal(comparableEnv(E(), E({ map: { w: 1036, h: NaN } })).ok, false);
  assert.equal(comparableEnv(E(), E({ dpr: undefined })).ok, false);
  assert.equal(comparableEnv(E(), E({ centre: { lat: 40.415, lon: NaN } })).ok, false);
  assert.equal(comparableEnv(E(), E({ zoom: undefined })).ok, false);
});
test("H2 comparableEnv REJECTS mismatched map area / zoom / dpr / centre / readiness", () => {
  assert.equal(comparableEnv(E(), E({ map: { w: 1036, h: 600 } })).ok, false);
  assert.equal(comparableEnv(E(), E({ zoom: 15 })).ok, false);
  assert.equal(comparableEnv(E(), E({ dpr: 1 })).ok, false);
  assert.equal(comparableEnv(E(), E({ centre: { lat: 40.5, lon: -3.692 } })).ok, false);
  assert.equal(comparableEnv(E(), E({ data_ready: false })).ok, false);
});
test("R2 comparableEnv REQUIRES equal render-state (canvas/marker/path) counts", () => {
  assert.equal(comparableEnv(E(), E({ render: { ...R, canvases: 7 } })).ok, false);
  assert.equal(comparableEnv(E(), E({ render: { ...R, markers: 4 } })).ok, false);
  assert.equal(comparableEnv(E(), E({ render: { ...R, paths: 2 } })).ok, false);
});
test("R2 comparableEnv allows tiny tile-count timing differences, rejects large ones", () => {
  assert.equal(comparableEnv(E(), E({ render: { ...R, tiles: 16 } })).ok, true); // within tol
  assert.equal(comparableEnv(E(), E({ render: { ...R, tiles: 30 } })).ok, false);
});
test("R2 comparableEnv REJECTS when render-state counts are missing on one arm", () => {
  assert.equal(comparableEnv(E({ render: undefined }), E()).ok, false);
});

// ── R1 H2c: drift — non-empty, strict tolerance, finite centres ──────────────
const DEF = { lat: 40.415, lon: -3.692 };
test("H2 driftCheck: near-default centres within the strict tolerance pass", () => {
  assert.equal(driftCheck([{ lat: 40.41505, lon: -3.69195 }], DEF).ok, true);
});
test("R1 driftCheck REJECTS an EMPTY start-centre set (no silent pass)", () => {
  const r = driftCheck([], DEF);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no start centres/);
});
test("R1 driftCheck REJECTS non-finite start centres", () => {
  assert.equal(driftCheck([{ lat: NaN, lon: -3.692 }], DEF).ok, false);
});
test("R1 driftCheck enforces the documented strict tolerance (≈500 m is NOT allowed)", () => {
  assert.equal(DRIFT_TOL_DEG <= 2e-4, true);
  assert.equal(driftCheck([{ lat: 40.415 + 5e-3, lon: -3.692 }], DEF).ok, false); // ~500 m → fail
  assert.equal(driftCheck([{ lat: 40.415 + 1e-4, lon: -3.692 }], DEF).ok, true);
});

// ── R5: config.layers truthfully reflects the measured workload ──────────────
test("R5 layersLabel: OFF says DISABLED/not-shipped-default; ON says shipped default", () => {
  assert.match(layersLabel("off"), /DISABLED/);
  assert.match(layersLabel("off"), /NOT the shipped default/);
  assert.doesNotMatch(layersLabel("off"), /^default POI layers ON/);
  assert.match(layersLabel("on"), /default POI layers ON/);
});
test("R5 auto_compare emits layers_mode and derives config.layers from layersLabel (no stale 'default' when POIs off)", () => {
  const src = readFileSync(new URL("../research/ac_p0_12/auto_compare.mjs", import.meta.url), "utf8");
  assert.match(src, /layers_mode: layersMode, layers: layersLabel\(layersMode\)/);
  assert.doesNotMatch(src, /layers: "default \(no licences\/hospitality toggled\)"/);
});
