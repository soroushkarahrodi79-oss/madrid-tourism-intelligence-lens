// K12 device micro-gate — executable regression for the FAIL-CLOSED device-grade
// and completeness predicates (research/runtime_spike/device_harness/grade.mjs).
// Run by CI via `node --test`.

import test from "node:test";
import assert from "node:assert/strict";
import {
  deviceGradeOf,
  scenarioComplete,
  GPU_VENDOR,
  SOFTWARE_OR_GENERIC,
} from "../research/runtime_spike/device_harness/grade.mjs";

const realGpu = (gl) => ({
  env: { gl_renderer: gl, gl_is_software: false, userAgent: "Mozilla/5.0 Chrome/131" },
});
const deviceOpts = { label: "Dell XPS13 / Win11 / Chrome", channel: "chrome", headed: true };

test("real GPU + real channel + headed + label → device-grade", () => {
  const r = deviceGradeOf(realGpu("ANGLE (Intel, Intel(R) Iris(R) Xe, Direct3D11)"), deviceOpts);
  assert.equal(r.device_grade, true);
});

test("fails closed on SwiftShader even with chrome+headed+label", () => {
  const r = deviceGradeOf(
    { env: { gl_renderer: "ANGLE (Google, Vulkan SwiftShader driver)", gl_is_software: true, userAgent: "x" } },
    deviceOpts,
  );
  assert.equal(r.device_grade, false);
});

test("fails closed on NO_WEBGL", () => {
  const r = deviceGradeOf({ env: { gl_renderer: "NO_WEBGL", userAgent: "x" } }, deviceOpts);
  assert.equal(r.device_grade, false);
});

test("fails closed on a generic/vendorless renderer string", () => {
  const r = deviceGradeOf({ env: { gl_renderer: "WebKit WebGL", userAgent: "x" } }, deviceOpts);
  assert.equal(r.device_grade, false, "no GPU vendor token → unverified → not device-grade");
});

test("fails closed when headless (not --headed)", () => {
  const r = deviceGradeOf(realGpu("Apple GPU"), { ...deviceOpts, headed: false });
  assert.equal(r.device_grade, false);
});

test("fails closed on bundled chromium channel", () => {
  const r = deviceGradeOf(realGpu("Apple GPU"), { ...deviceOpts, channel: "chromium" });
  assert.equal(r.device_grade, false);
});

test("fails closed without a human label (label alone never upgrades)", () => {
  const r = deviceGradeOf(realGpu("Apple GPU"), { ...deviceOpts, label: "" });
  assert.equal(r.device_grade, false);
  const r2 = deviceGradeOf(realGpu("Apple GPU"), { ...deviceOpts, label: "CONTAINER (no GPU)" });
  assert.equal(r2.device_grade, false);
});

test("real iPad GPU token is accepted", () => {
  assert.match("Apple GPU", GPU_VENDOR);
  assert.doesNotMatch("Apple GPU", SOFTWARE_OR_GENERIC);
});

test("scenarioComplete requires metrics AND a readiness barrier", () => {
  const full = {
    interaction_to_paint_ms: { p95: 1 },
    pan_frame_ms: { p95: 1 },
    first_contentful_paint_ms: 100,
    readiness_barrier: "leaflet: ...",
  };
  assert.equal(scenarioComplete(full).ok, true);
  assert.equal(scenarioComplete({ ...full, readiness_barrier: null }).ok, false);
  assert.equal(scenarioComplete({ ...full, pan_frame_ms: null }).ok, false);
  assert.equal(scenarioComplete({ error: "timeout" }).ok, false);
});
