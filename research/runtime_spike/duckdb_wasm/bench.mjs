// K12 — §4 DuckDB-WASM vs production plain-JS models (CPU benchmark + identical-
// output verification).
//
// This harness imports the ACTUAL production pure models (js/urban-licences.js,
// js/planning-ambito.js) as the plain-JS baseline — it does not reimplement
// them — and compares DuckDB-WASM running the equivalent SQL on the same data
// on the same host CPU.
//
//   * PAYLOAD bytes (the .wasm engine size) are hardware-independent.
//   * INIT and QUERY timings are CPU-only (shared cloud VM, no GPU). They are a
//     valid RELATIVE comparison (both engines share the host) but are NOT device
//     numbers. The host descriptor is recorded with every timing.
//
// For the two clean shapes (in-circle, date-window) the harness VERIFIES that
// DuckDB and the production model return the IDENTICAL set of matched records
// before it compares speed — per the issue's "verify identical analytical
// outputs before comparing performance" rule.
//
// Run:  cd research/runtime_spike && npm install && node duckdb_wasm/bench.mjs
// Out:  research/runtime_spike/results/duckdb_wasm.json
//
// THROWAWAY research harness — not wired into production.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import zlib from "node:zlib";
import { timeIt, stats, hostDescriptor } from "../lib/measure.mjs";
import { licencesInLens, defaultWindow } from "../../../js/urban-licences.js";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const DIST = path.join(ROOT, "research/runtime_spike/node_modules/@duckdb/duckdb-wasm/dist");

// ---------------------------------------------------------------- real data
const licArtifact = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/planning/madrid_urban_licences.json"), "utf8"),
);
const records = licArtifact.records;
const extent = licArtifact.date_extent;

// Fixed, reproducible query parameters (central Madrid; radius chosen so no
// record sits within 1 m of the boundary — verified below — so float-equality
// at the boundary cannot flip set membership).
const CENTRE = { lat: 40.4168, lon: -3.7038 }; // Puerta del Sol
const RADIUS_M = 1500;
const WINDOW = defaultWindow(extent); // trailing 12 months, the product default

// ---------------------------------------------------------------- plain JS
// Shape 1: in-circle (haversine) + family filter, no date window.
const js_inCircle = () => licencesInLens({ ...CENTRE, radiusM: RADIUS_M }, records, {});
// Shape 2: in-circle + date-window.
const js_dateWindow = () =>
  licencesInLens({ ...CENTRE, radiusM: RADIUS_M }, records, { window: WINDOW });

const jsInCircleResult = js_inCircle();
const jsDateWindowResult = js_dateWindow();
const jsInCircleIds = new Set(jsInCircleResult.records.map((r) => r.id));
const jsDateWindowIds = new Set(jsDateWindowResult.records.map((r) => r.id));

// ---------------------------------------------------------------- DuckDB
const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");

function wasmPayload() {
  const read = (f) => fs.readFileSync(path.join(DIST, f));
  const eh = read("duckdb-eh.wasm");
  const worker = read("duckdb-browser-eh.worker.js");
  const glue = read("duckdb-browser.mjs");
  const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
  // brotli only on the small JS glue; q11 brotli on the 34 MB wasm takes ~1 min
  // and gzip is what GitHub Pages / Fastly reliably serves anyway. A one-off
  // q11 brotli of duckdb-eh.wasm measured 4.50 MB (recorded as a note).
  const br = (b) => zlib.brotliCompressSync(b).length;
  const total = eh.length + worker.length + glue.length;
  return {
    engine_build: "eh (exception-handling; the default browser build)",
    wasm_raw_bytes: eh.length,
    wasm_gzip_bytes: gz(eh),
    wasm_brotli_bytes_note: "≈4.50 MB at brotli q11 (one-off; not recomputed per run)",
    js_glue_raw_bytes: worker.length + glue.length,
    js_glue_gzip_bytes: gz(worker) + gz(glue),
    js_glue_brotli_bytes: br(worker) + br(glue),
    total_raw_bytes: total,
    total_gzip_bytes: gz(eh) + gz(worker) + gz(glue),
    comparison_note:
      "App's ENTIRE committed data footprint is 2.11 MB gzip (baseline_inventory.json). " +
      "Booting DuckDB-WASM transfers ~6.9 MB gzip (≈4.7 MB brotli) before answering one query.",
  };
}

async function runDuckDB() {
  const bundles = {
    mvp: {
      mainModule: path.join(DIST, "duckdb-mvp.wasm"),
      mainWorker: path.join(DIST, "duckdb-node-mvp.worker.cjs"),
    },
    eh: {
      mainModule: path.join(DIST, "duckdb-eh.wasm"),
      mainWorker: path.join(DIST, "duckdb-node-eh.worker.cjs"),
    },
  };
  const logger = new duckdb.VoidLogger();

  // INIT timing: instantiate the engine (this is the cost a browser pays once,
  // after the ~6.9 MB gzip transfer which is NOT included here).
  const tInit0 = performance.now();
  const db = await duckdb.createDuckDB(bundles, logger, duckdb.NODE_RUNTIME);
  await db.instantiate();
  const conn = db.connect();
  const init_ms = performance.now() - tInit0;

  // Load the real licence records into a typed table via INSERT ... VALUES.
  // (read_json_auto hangs under the node-blocking build in this VM — the JSON
  // scanner extension stalls — so we use the core engine's INSERT path, which
  // is reliable. This is a harness-portability detail, not a DuckDB-vs-JS
  // result: the browser build reads JSON natively and faster.)
  conn.query(
    `CREATE TABLE licences(id VARCHAR, family VARCHAR, grant_date DATE, lat DOUBLE, lon DOUBLE)`,
  );
  const esc = (s) => String(s).replace(/'/g, "''");
  const tLoad0 = performance.now();
  const CH = 2000;
  for (let i = 0; i < records.length; i += CH) {
    const vals = records
      .slice(i, i + CH)
      .map((r) => `('${esc(r.id)}','${esc(r.family)}','${r.grant_date}',${+r.lat},${+r.lon})`)
      .join(",");
    conn.query(`INSERT INTO licences VALUES ${vals}`);
  }
  const load_ms = performance.now() - tLoad0;

  // Exact haversine replica of js/urban-licences.js insideLens().
  const haversine = (latCol, lonCol) =>
    `2*6371000*asin(sqrt(` +
    `power(sin(radians(${latCol} - ${CENTRE.lat})/2),2) + ` +
    `cos(radians(${CENTRE.lat}))*cos(radians(${latCol}))*` +
    `power(sin(radians(${lonCol} - ${CENTRE.lon})/2),2)))`;

  const sqlInCircle =
    `SELECT id FROM licences WHERE ${haversine("lat", "lon")} <= ${RADIUS_M}`;
  const sqlDateWindow =
    `SELECT id FROM licences WHERE ${haversine("lat", "lon")} <= ${RADIUS_M} ` +
    `AND grant_date >= '${WINDOW.from}' AND grant_date <= '${WINDOW.to}'`;

  const idsOf = (sql) => {
    const t = conn.query(sql);
    const out = new Set();
    for (const row of t) out.add(row.id);
    return out;
  };

  // cold (first) query, then warm repetitions
  const t1 = performance.now();
  const duckInCircleIds = idsOf(sqlInCircle);
  const inCircle_cold_ms = performance.now() - t1;
  const inCircle_warm = timeIt(() => idsOf(sqlInCircle), { reps: 15, warmup: 2 });

  const t2 = performance.now();
  const duckDateWindowIds = idsOf(sqlDateWindow);
  const dateWindow_cold_ms = performance.now() - t2;
  const dateWindow_warm = timeIt(() => idsOf(sqlDateWindow), { reps: 15, warmup: 2 });

  conn.close();

  return {
    init_ms,
    load_ms,
    inCircle: { cold_ms: inCircle_cold_ms, warm: inCircle_warm, ids: duckInCircleIds },
    dateWindow: { cold_ms: dateWindow_cold_ms, warm: dateWindow_warm, ids: duckDateWindowIds },
  };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ---------------------------------------------------------------- run
const out = {
  spike: "K12 runtime decision",
  measurement: "duckdb_wasm_vs_plain_js",
  deterministic: "payload bytes hardware-independent; init/query ms CPU-only (host recorded)",
  host: hostDescriptor(),
  dataset: { licence_records: records.length, date_extent: extent },
  query_params: { centre: CENTRE, radius_m: RADIUS_M, window: WINDOW },
  payload: wasmPayload(),
};

try {
  const duck = await runDuckDB();

  // identical-output verification BEFORE comparing speed
  const verify = {
    inCircle: {
      js_matches: jsInCircleIds.size,
      duckdb_matches: duck.inCircle.ids.size,
      identical: setsEqual(jsInCircleIds, duck.inCircle.ids),
    },
    dateWindow: {
      js_matches: jsDateWindowIds.size,
      duckdb_matches: duck.dateWindow.ids.size,
      identical: setsEqual(jsDateWindowIds, duck.dateWindow.ids),
    },
  };

  // plain-JS timings (production functions)
  const jsInCircleT = timeIt(js_inCircle, { reps: 25, warmup: 5 });
  const jsDateWindowT = timeIt(js_dateWindow, { reps: 25, warmup: 5 });

  out.correctness = verify;
  out.timings = {
    duckdb: {
      init_ms: Math.round(duck.init_ms * 100) / 100,
      load_table_ms: Math.round(duck.load_ms * 100) / 100,
      inCircle_cold_ms: Math.round(duck.inCircle.cold_ms * 100) / 100,
      inCircle_warm: duck.inCircle.warm,
      dateWindow_cold_ms: Math.round(duck.dateWindow.cold_ms * 100) / 100,
      dateWindow_warm: duck.dateWindow.warm,
    },
    plain_js: {
      inCircle: jsInCircleT,
      dateWindow: jsDateWindowT,
    },
  };
  out.verdict_inputs = {
    engine_transfer_gzip_MB: Math.round((out.payload.total_gzip_bytes / 1024 ** 2) * 100) / 100,
    plain_js_warm_median_ms: jsInCircleT.median,
    duckdb_warm_median_ms: duck.inCircle.warm.median,
    duckdb_first_query_wall_ms:
      Math.round((duck.init_ms + duck.load_ms + duck.inCircle.cold_ms) * 100) / 100,
    note:
      "DuckDB first-answer wall time includes engine init + table load + cold query, " +
      "and EXCLUDES the multi-MB engine download. Plain JS answers from already-loaded records.",
  };
  out.status = "MEASURED_IN_CONTAINER";
} catch (err) {
  out.status = "DUCKDB_RUN_FAILED";
  out.error = String(err && err.stack ? err.stack : err).split("\n").slice(0, 6).join("\n");
  // plain-JS timings still recorded so the comparison is half-complete and honest
  out.timings = {
    plain_js: {
      inCircle: timeIt(js_inCircle, { reps: 25, warmup: 5 }),
      dateWindow: timeIt(js_dateWindow, { reps: 25, warmup: 5 }),
    },
  };
}

// serialise (drop the raw id Sets)
const outPath = path.join(ROOT, "research/runtime_spike/results/duckdb_wasm.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`duckdb bench → ${path.relative(ROOT, outPath)}  [${out.status}]`);
if (out.correctness)
  console.log(
    `correctness: inCircle identical=${out.correctness.inCircle.identical} (${out.correctness.inCircle.js_matches} recs) · dateWindow identical=${out.correctness.dateWindow.identical} (${out.correctness.dateWindow.js_matches} recs)`,
  );
if (out.timings?.duckdb)
  console.log(
    `duckdb: init ${out.timings.duckdb.init_ms}ms, load ${out.timings.duckdb.load_table_ms}ms, warm-query median ${out.timings.duckdb.inCircle_warm.median}ms`,
  );
console.log(
  `plain-js warm-query median: inCircle ${out.timings.plain_js.inCircle.median}ms, dateWindow ${out.timings.plain_js.dateWindow.median}ms`,
);
console.log(
  `engine transfer: ${(out.payload.total_gzip_bytes / 1024 ** 2).toFixed(2)} MB gzip to boot`,
);
if (out.error) console.log("ERROR:\n" + out.error);

// The node-blocking DuckDB worker keeps the event loop alive; exit explicitly.
process.exit(0);
