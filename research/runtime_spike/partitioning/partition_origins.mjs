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

const scenarios = {
  A_status_quo_full_upfront: {
    transfer_gzip9_bytes: fullMeasure.gzip9_bytes,
    transfer_brotli_bytes: fullMeasure.brotli_bytes,
    parse_median_ms: fullMeasure.parse_ms.median,
    description: "Current behaviour: whole artifact fetched and parsed before first paint.",
  },
  B_partitioned_lazy_latest_month: {
    transfer_gzip9_bytes: indexMeasure.gzip9_bytes + latest.gzip9_bytes,
    transfer_brotli_bytes: indexMeasure.brotli_bytes + latest.brotli_bytes,
    parse_median_ms:
      Math.round((indexMeasure.parse_ms.median + latest.parse_ms.median) * 1000) / 1000,
    description: "Fetch index + latest month only on first paint; others on demand.",
  },
  C_partitioned_eager_all: {
    transfer_gzip9_bytes: indexMeasure.gzip9_bytes + sum(monthFiles, "gzip9_bytes"),
    transfer_brotli_bytes: indexMeasure.brotli_bytes + sum(monthFiles, "brotli_bytes"),
    parse_total_median_ms:
      Math.round(
        (indexMeasure.parse_ms.median + sum(monthFiles, (x) => x.parse_ms.median)) * 1000,
      ) / 1000,
    description: "Fetch index + every month file (upper bound; shows partition overhead vs A).",
  },
};

// initial-load savings, B vs A
const savings = {
  transfer_gzip9: {
    status_quo_bytes: scenarios.A_status_quo_full_upfront.transfer_gzip9_bytes,
    partitioned_bytes: scenarios.B_partitioned_lazy_latest_month.transfer_gzip9_bytes,
    saved_bytes:
      scenarios.A_status_quo_full_upfront.transfer_gzip9_bytes -
      scenarios.B_partitioned_lazy_latest_month.transfer_gzip9_bytes,
    saved_pct: pct(
      scenarios.A_status_quo_full_upfront.transfer_gzip9_bytes,
      scenarios.B_partitioned_lazy_latest_month.transfer_gzip9_bytes,
    ),
  },
  parse: {
    status_quo_median_ms: scenarios.A_status_quo_full_upfront.parse_median_ms,
    partitioned_median_ms: scenarios.B_partitioned_lazy_latest_month.parse_median_ms,
    saved_pct: pct(
      scenarios.A_status_quo_full_upfront.parse_median_ms,
      scenarios.B_partitioned_lazy_latest_month.parse_median_ms,
    ),
  },
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
  initial_load_savings_B_vs_A: savings,
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
console.log(
  `A status-quo:  ${(scenarios.A_status_quo_full_upfront.transfer_gzip9_bytes / 1024).toFixed(1)} KB gzip, parse ${scenarios.A_status_quo_full_upfront.parse_median_ms} ms`,
);
console.log(
  `B lazy latest: ${(scenarios.B_partitioned_lazy_latest_month.transfer_gzip9_bytes / 1024).toFixed(1)} KB gzip, parse ${scenarios.B_partitioned_lazy_latest_month.parse_median_ms} ms`,
);
console.log(
  `  initial-load transfer saved: ${(savings.transfer_gzip9.saved_bytes / 1024).toFixed(1)} KB (${savings.transfer_gzip9.saved_pct}%) · parse saved ${savings.parse.saved_pct}%`,
);
console.log(
  `C eager all:   ${(scenarios.C_partitioned_eager_all.transfer_gzip9_bytes / 1024).toFixed(1)} KB gzip (overhead vs A: ${((scenarios.C_partitioned_eager_all.transfer_gzip9_bytes - fullMeasure.gzip9_bytes) / 1024).toFixed(1)} KB)`,
);
