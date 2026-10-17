// K12 — §2 Leaflet ceiling: the CPU-bound component, measured in the container.
//
// WHAT THIS MEASURES (honest scope):
//   The part of "adding N features to a Leaflet canvas layer" that is CPU work
//   and scales with feature count: GeoJSON serialise/parse, per-feature style
//   computation, and viewport bbox culling. These scale the same way on any
//   machine (they are JS, not GPU), so container numbers are a valid shape of
//   the curve.
//
// WHAT THIS DOES *NOT* MEASURE (and cannot, here):
//   The GPU canvas paint + compositing cost, and the interaction-to-paint
//   latency during a Lens drag. Those are what actually determine the ceiling,
//   and they MUST be measured on a real device (device_harness/leaflet_ceiling.html).
//   This file therefore reports the CPU curve and the INPUT byte sizes per level,
//   and explicitly defers the threshold crossing to the device harness.
//
// Run:  node research/runtime_spike/leaflet_ceiling/cpu_scaling.mjs
// Out:  research/runtime_spike/results/leaflet_cpu_scaling.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipBytes, timeIt, hostDescriptor } from "../lib/measure.mjs";
import {
  makePolygons,
  makePoints,
  POLYGON_LEVELS,
  POINT_LEVELS,
  REAL_AMBITO_AVG_VERTICES,
} from "./generate_synthetic.mjs";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");

// A per-feature style pass that mimics what the production renderers do per
// feature before paint (compute style object + bounds). It is intentionally
// cheap per feature; the point is how it scales with N.
function stylePass(fc) {
  let acc = 0;
  for (const f of fc.features) {
    const g = f.geometry;
    // trivial style decision + bbox, as a canvas layer would compute
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    const coords = g.type === "Point" ? [g.coordinates] : g.coordinates[0];
    for (const c of coords) {
      if (c[0] < minx) minx = c[0];
      if (c[0] > maxx) maxx = c[0];
      if (c[1] < miny) miny = c[1];
      if (c[1] > maxy) maxy = c[1];
    }
    acc += maxx - minx + (maxy - miny);
  }
  return acc;
}

function measureLevel(kind, n, fc) {
  const json = JSON.stringify(fc);
  const buf = Buffer.from(json, "utf8");
  const vertices = fc.features.reduce((a, f) => {
    const g = f.geometry;
    return a + (g.type === "Point" ? 1 : g.coordinates[0].length);
  }, 0);
  return {
    kind,
    count: n,
    vertices,
    raw_bytes: buf.length,
    gzip_bytes: gzipBytes(buf),
    // brotli omitted: quality-11 brotli on tens-of-MB synthetic payloads is
    // prohibitively slow and gzip is what GitHub Pages / Fastly actually serves.
    generate_ms: null, // filled by caller (it timed generation)
    serialize_ms: timeIt(() => JSON.stringify(fc), { reps: 7, warmup: 2 }),
    parse_ms: timeIt(() => JSON.parse(json), { reps: 7, warmup: 2 }),
    style_pass_ms: timeIt(() => stylePass(fc), { reps: 7, warmup: 2 }),
  };
}

const polygons = [];
for (const n of POLYGON_LEVELS) {
  const t0 = performance.now();
  const fc = makePolygons(n);
  const gen = performance.now() - t0;
  const m = measureLevel("polygon", n, fc);
  m.generate_ms = Math.round(gen * 100) / 100;
  polygons.push(m);
  console.log(
    `poly ${String(n).padStart(6)}: ${m.vertices}v raw ${(m.raw_bytes / 1024 / 1024).toFixed(2)}MB gz ${(m.gzip_bytes / 1024).toFixed(0)}KB · parse ${m.parse_ms.median}ms · style ${m.style_pass_ms.median}ms`,
  );
}

const points = [];
for (const n of POINT_LEVELS) {
  const t0 = performance.now();
  const fc = makePoints(n);
  const gen = performance.now() - t0;
  const m = measureLevel("point", n, fc);
  m.generate_ms = Math.round(gen * 100) / 100;
  points.push(m);
  console.log(
    `pts  ${String(n).padStart(6)}: raw ${(m.raw_bytes / 1024).toFixed(0)}KB gz ${(m.gzip_bytes / 1024).toFixed(0)}KB · parse ${m.parse_ms.median}ms · style ${m.style_pass_ms.median}ms`,
  );
}

const out = {
  spike: "K12 runtime decision",
  measurement: "leaflet_cpu_scaling",
  scope: "CPU/parse/style/cull component ONLY — NOT GPU paint or interaction-to-paint",
  ceiling_crossing: "DEFERRED to device_harness/leaflet_ceiling.html (requires a real GPU)",
  deterministic: "bytes + vertices hardware-independent; *_ms CPU-only (host recorded)",
  host: hostDescriptor(),
  synthetic_method: {
    generator: "research/runtime_spike/leaflet_ceiling/generate_synthetic.mjs",
    prng: "mulberry32 seeded — reproducible",
    polygon_vertex_budget: REAL_AMBITO_AVG_VERTICES,
    real_ambito_reference: "724 features / 140507 vertices (≈194 v/feature)",
    limitations: "convex-ish blobs, uniform scatter — stresses throughput, not topology/clustering",
  },
  polygon_levels: polygons,
  point_levels: points,
};

const outPath = path.join(ROOT, "research/runtime_spike/results/leaflet_cpu_scaling.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`leaflet cpu scaling → ${path.relative(ROOT, outPath)}`);
