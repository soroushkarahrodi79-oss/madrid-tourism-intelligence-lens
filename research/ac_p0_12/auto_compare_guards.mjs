/*
 * AC-P0-12 auto_compare — pure, unit-testable integrity guards.
 *
 * Extracted from auto_compare.mjs so the fail-closed logic (H1 hardware GPU, H2
 * sample sufficiency + PR/main comparability + drift) can be tested with synthetic
 * fail conditions in tests/ac_p0_12_auto_compare.test.mjs without launching a
 * browser. Hardened per review 5567748806 (R1/R2): real raw post-warm finite
 * samples with independently-recomputed statistics and genuine movement; finite
 * comparable fields incl. rendered layer/tile/marker counts; non-empty start-centre
 * array; a strict, enforced drift tolerance.
 */
import { GPU_VENDOR, SOFTWARE_OR_GENERIC, summarize, assertStatsMatchRaw } from "./runner_core.mjs";

const isFiniteNum = (x) => typeof x === "number" && Number.isFinite(x);

// Documented post-recenter drift tolerance (degrees). Re-centering targets < 5e-4;
// this gate enforces the tight bound the report claims, not a loose ~500 m.
export const DRIFT_TOL_DEG = 2e-4;

// H1 — a run is hardware-grade ONLY when a real GPU is POSITIVELY established:
// not software/SwiftShader/llvmpipe, not NO_WEBGL/unknown/missing, AND a recognised
// GPU vendor token is present.
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
  return { ok, pr_renderer: prEnv && prEnv.gl_renderer, base_renderer: baseEnv && baseEnv.gl_renderer, pr_hardware: prOk, base_hardware: baseOk, reason: ok ? null : `hardware GPU not positively established (pr_hardware=${prOk}, base_hardware=${baseOk})` };
}

// H2a — a pan capture is valid only when it is attributed, error-free, has a REAL
// post-warm raw sample array whose length equals n, all summary statistics are
// finite, the statistics INDEPENDENTLY RECOMPUTE from raw (no fabricated/sparse
// {n:48} shapes), and there was genuine map movement (active-pan frames).
export function validSample(s, minSamples = 48) {
  if (!s) return { ok: false, reason: "no capture" };
  if (s.error) return { ok: false, reason: `capture error: ${s.error}` };
  const pf = s.pan_frame_ms;
  if (!pf) return { ok: false, reason: "no pan_frame_ms" };
  if (!Array.isArray(pf.raw) || pf.raw.length === 0) return { ok: false, reason: "no raw samples" };
  if (pf.n !== pf.raw.length) return { ok: false, reason: `n (${pf.n}) !== raw.length (${pf.raw.length})` };
  if (!pf.raw.every(isFiniteNum)) return { ok: false, reason: "non-finite raw sample(s)" };
  for (const k of ["n", "min", "median", "p95", "max"]) if (!isFiniteNum(pf[k])) return { ok: false, reason: `non-finite ${k}` };
  try { assertStatsMatchRaw(pf, "validSample"); } catch (e) { return { ok: false, reason: `stats do not recompute from raw: ${String(e.message || e)}` }; }
  if (pf.n < minSamples) return { ok: false, reason: `too few post-warm active-pan frames: ${pf.n} < ${minSamples}` };
  // genuine movement: the pan scenario records active_pan_frames (pre-warm count).
  if (s.active_pan_frames != null && s.active_pan_frames < minSamples) return { ok: false, reason: `too few active-pan frames: ${s.active_pan_frames} < ${minSamples}` };
  return { ok: true };
}

// H2b — PR and main arms must measure a COMPARABLE environment: same map pixel
// rectangle, zoom, devicePixelRatio, initial centre, data-ready, AND equal rendered
// state (canvas/marker counts; tiles within a small tolerance). Missing/NaN fields
// are a MISMATCH, never silently comparable (Math.abs(NaN) pitfall closed).
export function comparableEnv(a, b, tol = {}) {
  const t = { px: 2, dpr: 0.01, centre: 1e-4, tiles: 2, ...tol };
  const mm = [];
  if (!a || !b) return { ok: false, mismatches: ["missing env"] };
  const num = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const cmp = (label, x, y, tolv) => {
    if (!isFiniteNum(x) || !isFiniteNum(y)) { mm.push(`${label} non-finite (${x} vs ${y})`); return; }
    if (Math.abs(x - y) > tolv) mm.push(`${label} ${x} vs ${y}`);
  };
  cmp("map width", num(a, "map.w"), num(b, "map.w"), t.px);
  cmp("map height", num(a, "map.h"), num(b, "map.h"), t.px);
  cmp("zoom", a.zoom, b.zoom, 0);
  cmp("dpr", a.dpr, b.dpr, t.dpr);
  cmp("centre lat", num(a, "centre.lat"), num(b, "centre.lat"), t.centre);
  cmp("centre lon", num(a, "centre.lon"), num(b, "centre.lon"), t.centre);
  if (a.data_ready !== true || b.data_ready !== true) mm.push(`data_ready pr=${a.data_ready} main=${b.data_ready}`);
  // rendered state equality (R2): canvas panes and overlay markers must match
  // exactly (same layers); loaded tiles within a small tolerance (load timing).
  if (a.render && b.render) {
    cmp("map canvases", a.render.canvases, b.render.canvases, 0);
    cmp("overlay markers", a.render.markers, b.render.markers, 0);
    cmp("svg paths", a.render.paths, b.render.paths, 0);
    cmp("loaded tiles", a.render.tiles, b.render.tiles, t.tiles);
  } else {
    mm.push("render-state counts missing on one arm");
  }
  return { ok: mm.length === 0, mismatches: mm, pr_render: a.render, main_render: b.render };
}

// H2c — bounded positional drift over a NON-EMPTY set of start centres; every
// measured pan must start within DRIFT_TOL_DEG of the default centre.
export function driftCheck(startCentres, defaultCentre, tolDeg = DRIFT_TOL_DEG) {
  if (!Array.isArray(startCentres) || startCentres.length === 0) return { ok: false, max_drift_deg: null, tol_deg: tolDeg, reason: "no start centres recorded" };
  let maxDrift = 0;
  for (const c of startCentres) {
    if (!c || !isFiniteNum(c.lat) || !isFiniteNum(c.lon)) return { ok: false, max_drift_deg: null, tol_deg: tolDeg, reason: "non-finite start centre" };
    const d = Math.max(Math.abs(c.lat - defaultCentre.lat), Math.abs(c.lon - defaultCentre.lon));
    if (d > maxDrift) maxDrift = d;
  }
  return { ok: maxDrift <= tolDeg, max_drift_deg: Math.round(maxDrift * 1e7) / 1e7, tol_deg: tolDeg };
}
