// K12 runtime-decision spike — shared measurement helpers.
//
// THROWAWAY RESEARCH CODE. Nothing here is imported by index.html, css/ or js/.
// A guard test (tests/test_k12_spike_guards.py) asserts that isolation.
//
// Everything in this module is deterministic given the same inputs and the same
// machine. The BYTE measurements (raw / gzip / brotli / counts) are
// hardware-independent and reproducible anywhere. The TIME measurements
// (parse, query, generation) are CPU-bound and depend on the host; every caller
// that records a time also records the host descriptor so a reader can judge it.

import zlib from "node:zlib";
import os from "node:os";
import { execSync } from "node:child_process";

// --- byte sizes -----------------------------------------------------------

export function gzipBytes(buf) {
  // level 9 is the ceiling; GitHub Pages / Fastly serve a lower level, so this
  // is a *best-case* gzip figure. We also record level 6 (a common CDN default)
  // separately where it matters.
  return zlib.gzipSync(buf, { level: 9 }).length;
}

export function gzip6Bytes(buf) {
  return zlib.gzipSync(buf, { level: 6 }).length;
}

export function brotliBytes(buf) {
  return zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
}

// --- GeoJSON geometry counting --------------------------------------------

export function countGeoJSON(gj) {
  let features = 0;
  let vertices = 0;
  let rings = 0;
  const feats = gj.type === "FeatureCollection" ? gj.features : [gj];
  for (const feat of feats) {
    features++;
    const g = feat.geometry || feat;
    if (!g || !g.coordinates) continue;
    const walk = (a) => {
      if (typeof a[0] === "number") {
        vertices++;
      } else {
        if (typeof a[0]?.[0] === "number") rings++;
        a.forEach(walk);
      }
    };
    walk(g.coordinates);
  }
  return { features, vertices, rings };
}

// --- timing ----------------------------------------------------------------

// Run `fn` `reps` times after `warmup` discarded runs, return millisecond stats.
export function timeIt(fn, { reps = 9, warmup = 2 } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return stats(samples);
}

export function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length,
    min: round(s[0]),
    median: round(pct(50)),
    p95: round(pct(95)),
    max: round(s[s.length - 1]),
    mean: round(mean),
    raw_ms: s.map(round),
  };
}

const round = (x) => Math.round(x * 1000) / 1000;

// --- host descriptor -------------------------------------------------------

// Captured alongside every timing so a reader never mistakes a container CPU
// number for a device number.
export function hostDescriptor() {
  let cpuModel = "unknown";
  try {
    cpuModel = os.cpus()[0]?.model?.trim() || "unknown";
  } catch {}
  let gitSha = "unknown";
  try {
    gitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {}
  return {
    kind: "CONTAINER_CPU — not a device",
    note:
      "Timings below are CPU-bound work measured in a shared cloud Linux VM " +
      "with no GPU (software rasterisation). They are valid as RELATIVE, " +
      "CPU-only comparisons between approaches on the SAME host. They are NOT " +
      "mid-range-laptop or iPad numbers and must never be reported as such.",
    platform: os.platform(),
    arch: os.arch(),
    cpuModel,
    cpuCount: os.cpus()?.length ?? null,
    totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    nodeVersion: process.version,
    gitSha,
    measuredAt: new Date().toISOString(),
  };
}

// Deterministic, seedable PRNG (mulberry32) so synthetic geometry is identical
// on every run and on every machine.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
