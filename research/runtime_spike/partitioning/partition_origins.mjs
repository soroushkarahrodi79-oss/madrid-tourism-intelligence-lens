// K12 — §7 The actual payload problem: partition madrid_domestic_origins.json
// by source month (DETERMINISTIC transfer + parse analysis).
//
// Research experiment only. It does NOT modify data/ or any production builder.
// It reads the real artifact, simulates a by-month partition in memory, and
// measures what that would do to transferred bytes and parse time.
//
// Run:  node research/runtime_spike/partitioning/partition_origins.mjs
// Out:  research/runtime_spike/results/partitioning.json
//
// Byte figures are hardware-independent. parse_ms is CPU-only (host recorded).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipBytes, gzip6Bytes, brotliBytes, timeIt, hostDescriptor } from "../lib/measure.mjs";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const SRC = path.join(ROOT, "data/destination/madrid_domestic_origins.json");

const rawBuf = fs.readFileSync(SRC);
const full = JSON.parse(rawBuf.toString("utf8"));

// Shared header = everything except the per-month payload. A real partition
// would ship this once (an index) plus one file per month.
const { months, ...header } = full;

function sizeOf(obj) {
  const b = Buffer.from(JSON.stringify(obj), "utf8");
  return {
    raw_bytes: b.length,
    gzip9_bytes: gzipBytes(b),
    gzip6_bytes: gzip6Bytes(b),
    brotli_bytes: brotliBytes(b),
    parse_ms: timeIt(() => JSON.parse(b.toString("utf8")), { reps: 15, warmup: 3 }),
  };
}

// --- whole-file (status quo) ----------------------------------------------
const fullMeasure = {
  raw_bytes: rawBuf.length,
  gzip9_bytes: gzipBytes(rawBuf),
  gzip6_bytes: gzip6Bytes(rawBuf),
  brotli_bytes: brotliBytes(rawBuf),
  parse_ms: timeIt(() => JSON.parse(rawBuf.toString("utf8")), { reps: 15, warmup: 3 }),
};

// --- per-month partitions --------------------------------------------------
// Each month file carries the shared header + exactly one month, so it is
// independently valid and self-describing (same contract as the whole file).
const monthFiles = months.map((m) => {
  const partition = { ...header, months: [m] };
  return {
    source_month: m.source_month,
    origins: Array.isArray(m.published_origins) ? m.published_origins.length : 0,
    ...sizeOf(partition),
  };
});

// A tiny index file listing available months (what the app would fetch first).
const index = {
  ...header,
  available_months: months.map((m) => m.source_month),
};
const indexMeasure = sizeOf(index);

const sum = (arr, k) =>
  arr.reduce((a, x) => a + (typeof k === "function" ? k(x) : x[k]), 0);

// --- scenarios -------------------------------------------------------------
// A: status quo — one 3.5 MB fetch + one parse of everything, up front.
// B: partitioned, lazy — fetch index + the single latest month on first paint;
//    other months fetched only when the user selects them.
// C: partitioned, eager — index + all month files (upper bound; what a
//    "download everything anyway" client pays, to show partition overhead).
const latest = monthFiles[monthFiles.length - 1];

// The CITY "Monthly origin dynamics" feature compares a source month against
// its EXACT previous calendar month (js/domestic-origin-dynamics.js:
// NO_ADJACENT_PRIOR_MONTH / "no exact previous calendar month"). So a
// latest-month-only initial load does NOT support Dynamics; its
// equivalent-functionality initial load needs latest + previous month.
const previous = monthFiles[monthFiles.length - 2] || null;

const scenarios = {
  A_status_quo_full_upfront: {
    functionality: "all features, all 7 months",
    transfer_gzip9_bytes: fullMeasure.gzip9_bytes,
    transfer_brotli_bytes: fullMeasure.brotli_bytes,
    parse_median_ms: fullMeasure.parse_ms.median,
    description: "Current behaviour: whole artifact fetched and parsed before first paint.",
  },
  B1_partitioned_latest_month_only: {
    functionality: "PLACE/CITY single-month views ONLY — does NOT support month-over-month Dynamics",
    transfer_gzip9_bytes: indexMeasure.gzip9_bytes + latest.gzip9_bytes,
    transfer_brotli_bytes: indexMeasure.brotli_bytes + latest.brotli_bytes,
    parse_median_ms:
      Math.round((indexMeasure.parse_ms.median + latest.parse_ms.median) * 1000) / 1000,
    description: "Index + latest month only. NOT functionally equivalent to A for Dynamics.",
  },
  B2_partitioned_latest_plus_previous: {
    functionality: "adds the one adjacent month Dynamics' default view needs (latest vs previous)",
    transfer_gzip9_bytes:
      indexMeasure.gzip9_bytes + latest.gzip9_bytes + (previous ? previous.gzip9_bytes : 0),
    transfer_brotli_bytes:
      indexMeasure.brotli_bytes + latest.brotli_bytes + (previous ? previous.brotli_bytes : 0),
    parse_median_ms:
      Math.round(
        (indexMeasure.parse_ms.median +
          latest.parse_ms.median +
          (previous ? previous.parse_ms.median : 0)) *
          1000,
      ) / 1000,
    description:
      "Index + latest + previous month. The Dynamics-equivalent initial load; the honest " +
      "comparison for a general user-visible claim.",
  },
  C_partitioned_eager_all: {
    functionality: "all features, all months (upper bound)",
    transfer_gzip9_bytes: indexMeasure.gzip9_bytes + sum(monthFiles, "gzip9_bytes"),
    transfer_brotli_bytes: indexMeasure.brotli_bytes + sum(monthFiles, "brotli_bytes"),
    parse_total_median_ms:
      Math.round(
        (indexMeasure.parse_ms.median + sum(monthFiles, (x) => x.parse_ms.median)) * 1000,
      ) / 1000,
    description: "Fetch index + every month file (upper bound; shows partition overhead vs A).",
  },
};

function savingVs(scenarioKey) {
  const s = scenarios[scenarioKey];
  return {
    scenario: scenarioKey,
    functionality: s.functionality,
    transfer_gzip9: {
      status_quo_bytes: scenarios.A_status_quo_full_upfront.transfer_gzip9_bytes,
      partitioned_bytes: s.transfer_gzip9_bytes,
      saved_bytes: scenarios.A_status_quo_full_upfront.transfer_gzip9_bytes - s.transfer_gzip9_bytes,
      saved_pct: pct(scenarios.A_status_quo_full_upfront.transfer_gzip9_bytes, s.transfer_gzip9_bytes),
    },
    parse: {
      status_quo_median_ms: scenarios.A_status_quo_full_upfront.parse_median_ms,
      partitioned_median_ms: s.parse_median_ms,
      saved_pct: pct(scenarios.A_status_quo_full_upfront.parse_median_ms, s.parse_median_ms),
    },
  };
}

// Reported SEPARATELY by equivalent-functionality scenario (review issue #5):
// the headline latest-only saving is NOT a general user-visible claim because it
// drops Dynamics; B2 is the honest figure for a feature-equivalent initial load.
const savings = {
  B1_latest_only_NOT_dynamics_equivalent: savingVs("B1_partitioned_latest_month_only"),
  B2_dynamics_equivalent: savingVs("B2_partitioned_latest_plus_previous"),
};

function pct(from, to) {
  if (!from) return null;
  return Math.round(((from - to) / from) * 1000) / 10;
}

const out = {
  spike: "K12 runtime decision",
  measurement: "domestic_origins_partitioning",
  deterministic: "transfer bytes hardware-independent; parse_ms CPU-only (host recorded)",
  host: hostDescriptor(),
  source_file: "data/destination/madrid_domestic_origins.json",
  whole_file: fullMeasure,
  index_file: indexMeasure,
  month_partitions: monthFiles,
  month_count: monthFiles.length,
  scenarios,
  initial_load_savings: savings,
  dynamics_adjacency_finding:
    "CITY Monthly origin dynamics compares a source month to its EXACT previous calendar month " +
    "(js/domestic-origin-dynamics.js). A latest-month-only initial load (B1) therefore breaks " +
    "Dynamics; the feature-equivalent initial load is B2 (latest + previous). The headline " +
    "latest-only saving must NOT be reported as a general user-visible performance claim.",
  caching_note:
    "Partitioned: a new monthly edition invalidates only that month's file + the tiny index; " +
    "status quo invalidates the whole multi-MB artifact on every update. Partition overhead = " +
    "header duplicated per month (see C vs A).",
  operational_complexity_note:
    "A partition would require the builder to emit N month files + an index, and the loader to " +
    "fetch lazily. This is a DATA-PIPELINE change (out of K12 scope) — reported as a finding only.",
};

const outPath = path.join(ROOT, "research/runtime_spike/results/partitioning.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`partitioning → ${path.relative(ROOT, outPath)}`);
console.log(`months: ${monthFiles.length}`);
const kb = (b) => (b / 1024).toFixed(1);
console.log(`A status-quo:        ${kb(scenarios.A_status_quo_full_upfront.transfer_gzip9_bytes)} KB gzip, parse ${scenarios.A_status_quo_full_upfront.parse_median_ms} ms`);
console.log(`B1 latest-only:      ${kb(scenarios.B1_partitioned_latest_month_only.transfer_gzip9_bytes)} KB gzip  [NOT Dynamics-equivalent] saved ${savings.B1_latest_only_NOT_dynamics_equivalent.transfer_gzip9.saved_pct}%`);
console.log(`B2 latest+previous:  ${kb(scenarios.B2_partitioned_latest_plus_previous.transfer_gzip9_bytes)} KB gzip  [Dynamics-equivalent]     saved ${savings.B2_dynamics_equivalent.transfer_gzip9.saved_pct}%`);
console.log(`C eager all:         ${kb(scenarios.C_partitioned_eager_all.transfer_gzip9_bytes)} KB gzip (overhead vs A: ${kb(scenarios.C_partitioned_eager_all.transfer_gzip9_bytes - fullMeasure.gzip9_bytes)} KB)`);
