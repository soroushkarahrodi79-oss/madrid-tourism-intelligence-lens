/*
 * AC-P0-12 auto_compare — pure, unit-testable integrity guards.
 *
 * Extracted from auto_compare.mjs so the fail-closed logic (H1 hardware GPU, H2
 * sample sufficiency + PR/main comparability) can be tested with synthetic fail
 * conditions in tests/ac_p0_12_auto_compare.test.mjs without launching a browser.
 */
import { GPU_VENDOR, SOFTWARE_OR_GENERIC } from "./runner_core.mjs";

// H1 — a run is hardware-grade ONLY when a real GPU is POSITIVELY established:
// not a software/SwiftShader/llvmpipe renderer, not NO_WEBGL/unknown/missing, AND
// a recognised GPU vendor token is present. An unrecognised-but-non-software
// renderer is NOT accepted (hardware cannot be positively established) → the run
// is COMPARISON UNAVAILABLE, never published as hardware evidence.
export function isHardwareGpu(renderer, isSoftware) {
  const gl = String(renderer == null ? "" : renderer).trim();
  if (isSoftware === true) return false;
  if (!gl) return false;
  if (SOFTWARE_OR_GENERIC.test(gl)) return false;
  return GPU_VENDOR.test(gl);
}

export function hardwareCheck(prEnv, baseEnv) {
  const prOk = isHardwareGpu(prEnv && prEnv.gl_renderer, prEnv && prEnv.gl_is_software);
  const baseOk = isHardwareGpu(baseEnv && baseEnv.gl_renderer, baseEnv && baseEnv.gl_is_software);
  const ok = prOk && baseOk;
  return {
    ok,
    pr_renderer: prEnv && prEnv.gl_renderer,
    base_renderer: baseEnv && baseEnv.gl_renderer,
    pr_hardware: prOk,
    base_hardware: baseOk,
    reason: ok ? null : `hardware GPU not positively established (pr_hardware=${prOk}, base_hardware=${baseOk})`,
  };
}

// H2a — one pan capture is valid only if it is attributed, error-free and has at
// least `minSamples` POST-WARM active-pan frames.
export function validSample(s, minSamples = 48) {
  if (!s) return { ok: false, reason: "no capture" };
  if (s.error) return { ok: false, reason: `capture error: ${s.error}` };
  const pf = s.pan_frame_ms;
  if (!pf || typeof pf.n !== "number") return { ok: false, reason: "no pan_frame_ms" };
  if (pf.n < minSamples) return { ok: false, reason: `too few post-warm active-pan frames: ${pf.n} < ${minSamples}` };
  return { ok: true };
}

// H2b — PR and main arms must measure a COMPARABLE environment: same map pixel
// rectangle, zoom, devicePixelRatio and initial centre, and both data-ready.
export function comparableEnv(a, b, tol = {}) {
  const t = { px: 2, dpr: 0.01, centre: 1e-4, ...tol };
  const mm = [];
  if (!a || !b) return { ok: false, mismatches: ["missing env"] };
  if (Math.abs((a.map?.w ?? NaN) - (b.map?.w ?? NaN)) > t.px) mm.push(`map width ${a.map?.w} vs ${b.map?.w}`);
  if (Math.abs((a.map?.h ?? NaN) - (b.map?.h ?? NaN)) > t.px) mm.push(`map height ${a.map?.h} vs ${b.map?.h}`);
  if (a.zoom !== b.zoom) mm.push(`zoom ${a.zoom} vs ${b.zoom}`);
  if (Math.abs((a.dpr ?? NaN) - (b.dpr ?? NaN)) > t.dpr) mm.push(`dpr ${a.dpr} vs ${b.dpr}`);
  const ca = a.centre || {}, cb = b.centre || {};
  if (Math.abs((ca.lat ?? NaN) - (cb.lat ?? NaN)) > t.centre || Math.abs((ca.lon ?? NaN) - (cb.lon ?? NaN)) > t.centre) mm.push(`centre ${ca.lat},${ca.lon} vs ${cb.lat},${cb.lon}`);
  if (a.data_ready !== true || b.data_ready !== true) mm.push(`data_ready pr=${a.data_ready} main=${b.data_ready}`);
  return { ok: mm.length === 0, mismatches: mm };
}

// H2c — bounded positional drift: every measured pan must start within `tol`
// metres of the default centre (so successive pans don't wander onto different
// tiles/features). Returns the max drift seen.
export function driftCheck(startCentres, defaultCentre, tolDeg = 5e-3) {
  let maxDrift = 0;
  for (const c of startCentres) {
    const d = Math.max(Math.abs(c.lat - defaultCentre.lat), Math.abs(c.lon - defaultCentre.lon));
    if (d > maxDrift) maxDrift = d;
  }
  return { ok: maxDrift <= tolDeg, max_drift_deg: Math.round(maxDrift * 1e6) / 1e6, tol_deg: tolDeg };
}
