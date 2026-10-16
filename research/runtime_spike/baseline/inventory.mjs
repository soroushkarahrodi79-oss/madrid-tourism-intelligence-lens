// K12 — Baseline artifact inventory (DETERMINISTIC).
//
// Measures the real deployed data footprint on the current commit: per-artifact
// raw bytes, gzip (level 9 and level 6), brotli, geometry/record counts, and
// JSON parse time. Byte figures are hardware-independent; parse time is a
// CPU-only figure annotated with the host descriptor.
//
// Run:  node research/runtime_spike/baseline/inventory.mjs
// Out:  research/runtime_spike/results/baseline_inventory.json
//
// THROWAWAY research harness — not wired into production.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gzipBytes,
  gzip6Bytes,
  brotliBytes,
  countGeoJSON,
  timeIt,
  hostDescriptor,
} from "../lib/measure.mjs";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const DATA = path.join(ROOT, "data");

// Artifacts that matter to the spike, plus enough of the rest to total the
// deployed footprint honestly.
const SPATIAL = new Set([
  "geography/madrid_admin.geojson",
  "planning/madrid_ambitos.geojson",
]);

// Known tabular record arrays: [file, path-to-array]
const RECORD_ARRAYS = {
  "planning/madrid_urban_licences.json": (o) => o.records,
  "accommodation/madrid_vut_licences.json": (o) => o.records,
};

function walkDataFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDataFiles(full));
    else if (/\.(json|geojson|csv)$/.test(entry.name) && !/\.meta\.json$/.test(entry.name))
      out.push(full);
  }
  return out;
}

function domesticOriginsRecordCount(o) {
  // months[].published_origins[]
  if (!Array.isArray(o.months)) return null;
  return o.months.reduce(
    (acc, m) => acc + (Array.isArray(m.published_origins) ? m.published_origins.length : 0),
    0,
  );
}

const results = [];
let totalRaw = 0;
let totalGzip = 0;

for (const full of walkDataFiles(DATA).sort()) {
  const rel = path.relative(DATA, full).replaceAll(path.sep, "/");
  const buf = fs.readFileSync(full);
  totalRaw += buf.length;

  const entry = {
    file: rel,
    raw_bytes: buf.length,
    gzip9_bytes: gzipBytes(buf),
    gzip6_bytes: gzip6Bytes(buf),
    brotli_bytes: brotliBytes(buf),
  };
  totalGzip += entry.gzip9_bytes;
  entry.gzip9_ratio = Math.round((buf.length / entry.gzip9_bytes) * 10) / 10;

  // counts + parse time for JSON-family files
  if (/\.(json|geojson)$/.test(rel)) {
    const text = buf.toString("utf8");
    let obj;
    try {
      obj = JSON.parse(text);
      entry.parse_ms = timeIt(() => JSON.parse(text));
    } catch {
      obj = null;
    }
    if (obj) {
      if (SPATIAL.has(rel) || obj.type === "FeatureCollection") {
        entry.kind = "spatial";
        entry.geometry = countGeoJSON(obj);
      } else if (RECORD_ARRAYS[rel]) {
        entry.kind = "tabular";
        const arr = RECORD_ARRAYS[rel](obj);
        entry.records = Array.isArray(arr) ? arr.length : null;
      } else if (rel === "destination/madrid_domestic_origins.json") {
        entry.kind = "tabular";
        entry.records = domesticOriginsRecordCount(obj);
        entry.months = Array.isArray(obj.months) ? obj.months.length : null;
      } else {
        entry.kind = "other";
      }
    }
  }
  results.push(entry);
}

const out = {
  spike: "K12 runtime decision",
  measurement: "baseline_inventory",
  deterministic: "byte sizes and counts are hardware-independent; parse_ms is CPU-only",
  host: hostDescriptor(),
  totals: {
    file_count: results.length,
    raw_bytes: totalRaw,
    raw_MB: Math.round((totalRaw / 1024 ** 2) * 100) / 100,
    gzip9_bytes: totalGzip,
    gzip9_MB: Math.round((totalGzip / 1024 ** 2) * 100) / 100,
  },
  historical_baseline_42773bc: {
    note: "Recorded in issue #74 / Gate K §11 for comparison. NOT re-measured here.",
    admin_features: 153,
    admin_vertices: 31648,
    admin_geojson_MB: 2.53,
    poi_records: 1470,
    total_footprint_MB: 6.6,
  },
  artifacts: results,
};

const outPath = path.join(ROOT, "research/runtime_spike/results/baseline_inventory.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`baseline inventory → ${path.relative(ROOT, outPath)}`);
console.log(
  `total: ${out.totals.raw_MB} MB raw / ${out.totals.gzip9_MB} MB gzip across ${out.totals.file_count} files`,
);
for (const a of results.filter((r) => r.kind === "spatial" || r.records)) {
  console.log(
    `  ${a.file.padEnd(42)} raw ${(a.raw_bytes / 1024).toFixed(0)}KB gz ${(a.gzip9_bytes / 1024).toFixed(0)}KB br ${(a.brotli_bytes / 1024).toFixed(0)}KB ` +
      (a.geometry ? `· ${a.geometry.features}f/${a.geometry.vertices}v` : `· ${a.records} rec`),
  );
}
