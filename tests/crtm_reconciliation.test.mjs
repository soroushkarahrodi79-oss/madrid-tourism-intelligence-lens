import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import extraction from "../js/extraction-bounds.js";
import { crtmStationQuery } from "../js/data.js";
import {
  FAILURE,
  RECONCILIATION_CONTRACT_VERSION,
  ReconciliationError,
  buildRetrievalRecord,
  reconcileCrtmService,
} from "../scripts/crtm_reconciliation.mjs";
import { makeCrtmService } from "./support/crtm_mock_service.mjs";

// F-02 — automatic reconciliation of the CRTM extraction query inside the build.
//
// Every test is deterministic: network I/O is injected, time is injectable, and
// the builder integration runs the real script with fetch replaced. Nothing here
// reaches a CRTM server, so none of it is evidence about the live service — it
// proves that the safeguard accepts a consistent answer and refuses each way an
// inconsistent one can look.

const BASE_URL = "https://example.test/arcgis/rest/services/M4_Red/FeatureServer/0/query";
const QUERY_URL = crtmStationQuery(BASE_URL);
const FIXED = () => new Date("2026-10-24T12:00:00.000Z");

async function reconcile(options = {}, queryUrl = QUERY_URL) {
  const service = makeCrtmService(options);
  const outcome = await reconcileCrtmService({ mode: "metro", queryUrl, fetchJson: service.fetchJson, now: FIXED });
  return { ...outcome, service };
}

async function failure(options, queryUrl = QUERY_URL) {
  const service = makeCrtmService(options);
  try {
    await reconcileCrtmService({ mode: "metro", queryUrl, fetchJson: service.fetchJson, now: FIXED });
  } catch (error) {
    assert.ok(error instanceof ReconciliationError, `expected a ReconciliationError, got ${error}`);
    return error;
  }
  assert.fail("expected the reconciliation to fail closed");
}

const abortError = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

// ------------------------------------------------------------------ success

test("a consistent service reconciles and records the per-service retrieval evidence", async () => {
  const { geojson, evidence, service } = await reconcile({ n: 138 });
  assert.equal(evidence.status, "RECONCILED");
  assert.equal(evidence.failure_code, null);
  assert.equal(evidence.queried_count, 138);
  assert.equal(evidence.queried_count_recheck, 138);
  assert.equal(evidence.id_count, 138);
  assert.equal(evidence.unique_id_count, 138);
  assert.equal(evidence.returned_count, 138);
  assert.equal(evidence.enumerated_count, 138);
  assert.deepEqual(evidence.object_id_reconciliation, { ids_vs_enumeration: "RECONCILED", ids_vs_geojson: "RECONCILED" });
  assert.deepEqual(evidence.exceeded_transfer_limit, { ids: "NOT_REPORTED", features: "NOT_REPORTED", enumeration: "NOT_REPORTED" });
  assert.deepEqual(evidence.source_edit, { data_last_edit_date: "2026-09-01T00:00:00.000Z", stable_during_retrieval: true });
  assert.equal(evidence.retrieved_at, "2026-10-24T12:00:00.000Z");
  assert.equal(evidence.service_url, "https://example.test/arcgis/rest/services/M4_Red/FeatureServer/0");
  assert.equal(geojson.features.length, 138);
  assert.equal(service.calls.length, 7, "metadata, count, ids, features, enumeration, count again, metadata again");
});

test("the reconciled response is the response the builder published, fetched with the builder's own URL", async () => {
  const { service } = await reconcile();
  const featureCalls = service.calls.filter((c) => c.kind === "geojson");
  assert.equal(featureCalls.length, 1, "the features are retrieved once, not re-queried for the proof");
  assert.equal(featureCalls[0].url, QUERY_URL);
});

test("count, ID and enumeration queries carry exactly the extraction predicate of the feature query", async () => {
  const { service, evidence } = await reconcile();
  const feature = new URL(QUERY_URL).searchParams;
  for (const call of service.calls.filter((c) => c.kind !== "meta")) {
    const params = new URL(call.url).searchParams;
    for (const key of ["where", "geometry", "geometryType", "inSR", "spatialRel"]) {
      assert.equal(params.get(key), feature.get(key), `${call.kind} ${key}`);
    }
  }
  assert.equal(evidence.query.geometry, extraction.envelopeParam());
  assert.equal(evidence.query.extraction_contract_version, extraction.CONTRACT_VERSION);
  assert.equal(evidence.query.crs, "EPSG:4326");
  assert.deepEqual(evidence.query.bounds, extraction.RAIL_EXTRACTION_BOUNDS);
});

test("the builder's own query function and the shared browser one send the same predicate", () => {
  const builder = fs.readFileSync(new URL("../scripts/build_runtime_poi.mjs", import.meta.url), "utf8");
  const source = builder.match(/function crtmStationQuery\(url\) \{[\s\S]*?\n\}/)[0];
  const builderQuery = new Function("CENTRAL_MADRID_ENVELOPE", `${source}; return crtmStationQuery;`)(extraction.envelopeParam(extraction.RAIL_EXTRACTION_BOUNDS));
  const sorted = (u) => [...new URL(u).searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(sorted(builderQuery(BASE_URL)), sorted(crtmStationQuery(BASE_URL)));
  // The builder hands THAT function's URL to the reconciler and publishes what it returns.
  assert.match(builder, /reconcileCrtmService\(\{ mode, queryUrl: crtmStationQuery\(url\), fetchJson \}\)/);
  assert.match(builder, /reconciledCrtmResponse\(SOURCES\.metroStations, "metro"\)\.then\(\(d\) => parseCrtmStations\(d, "metro"\)\)/);
  assert.match(builder, /reconciledCrtmResponse\(SOURCES\.cercaniasStations, "cercanias"\)\.then\(\(d\) => parseCrtmStations\(d, "cercanias"\)\)/);
  assert.doesNotMatch(builder, /fetchJson\(crtmStationQuery\(/, "no CRTM feature response may bypass the reconciler");
});

test("GeoJSON that does not expose OBJECTIDs still reconciles against the independent enumeration", async () => {
  const { evidence } = await reconcile({
    hooks: { geojson: (body) => ({ ...body, features: body.features.map(({ id, ...rest }) => rest) }) },
  });
  assert.equal(evidence.status, "RECONCILED");
  assert.equal(evidence.object_id_reconciliation.ids_vs_geojson, "NOT_EXPOSED");
  assert.equal(evidence.object_id_reconciliation.ids_vs_enumeration, "RECONCILED");
});

test("an explicit exceededTransferLimit=false is recorded as false, absence as NOT_REPORTED", async () => {
  const { evidence } = await reconcile({
    hooks: { geojson: (body) => ({ ...body, properties: { exceededTransferLimit: false } }), ids: (b) => ({ ...b, exceededTransferLimit: false }) },
  });
  assert.equal(evidence.exceeded_transfer_limit.features, false);
  assert.equal(evidence.exceeded_transfer_limit.ids, false);
  assert.equal(evidence.exceeded_transfer_limit.enumeration, "NOT_REPORTED");
});

// ----------------------------------------------------------- count mismatches

test("count above the ID list fails closed", async () => {
  const error = await failure({ hooks: { count: (b) => ({ ...b, count: 139 }) } });
  assert.equal(error.code, FAILURE.COUNT_ID_MISMATCH);
  assert.match(error.message, /^CRTM_RECONCILIATION_FAILED\[COUNT_DOES_NOT_EQUAL_ID_COUNT\]/);
  assert.equal(error.evidence.status, "FAILED");
  assert.equal(error.evidence.failure_code, FAILURE.COUNT_ID_MISMATCH);
  assert.equal(error.evidence.queried_count, 139, "the evidence keeps what was observed");
});

test("count and IDs agreeing but fewer GeoJSON features than the count fails closed", async () => {
  const error = await failure({ hooks: { geojson: (b) => ({ ...b, features: b.features.slice(0, 137) }) } });
  assert.equal(error.code, FAILURE.COUNT_FEATURE_MISMATCH);
  assert.equal(error.evidence.returned_count, 137);
});

test("more GeoJSON features than the count fails closed", async () => {
  const error = await failure({ hooks: { geojson: (b) => ({ ...b, features: [...b.features, { ...b.features[0], id: 9999 }] }) } });
  assert.equal(error.code, FAILURE.COUNT_FEATURE_MISMATCH);
});

test("a count that is not a nonnegative integer fails closed", async () => {
  for (const bad of [-1, 1.5, "138", null, undefined, NaN]) {
    const error = await failure({ hooks: { count: (b) => ({ ...b, count: bad }) } });
    assert.equal(error.code, FAILURE.COUNT_INVALID, `count ${String(bad)}`);
  }
});

// ----------------------------------------------------------------- duplicates

test("duplicate OBJECTIDs in the ID list fail closed even when the count equals the list length", async () => {
  const error = await failure({ hooks: { ids: (b) => ({ ...b, objectIds: [...b.objectIds.slice(0, 137), b.objectIds[0]] }) } });
  assert.equal(error.code, FAILURE.ID_DUPLICATE);
  assert.equal(error.evidence.id_count, 138);
  assert.equal(error.evidence.unique_id_count, 137);
});

test("duplicate OBJECTIDs in the independent enumeration fail closed", async () => {
  const error = await failure({
    hooks: { enum: (b) => ({ ...b, features: [...b.features.slice(0, 137), b.features[0]] }) },
  });
  assert.equal(error.code, FAILURE.ID_DUPLICATE);
});

test("duplicate GeoJSON feature ids with the right set size are refused", async () => {
  const error = await failure({
    hooks: { geojson: (b) => ({ ...b, features: b.features.map((f, i) => (i === 1 ? { ...f, id: 1 } : f)) }) },
  });
  assert.equal(error.code, FAILURE.OBJECT_ID_MISMATCH);
});

// ------------------------------------------------------------ partial responses

test("a reported exceededTransferLimit on any response fails closed", async () => {
  const cases = {
    geojson: { geojson: (b) => ({ ...b, exceededTransferLimit: true }) },
    "geojson properties": { geojson: (b) => ({ ...b, properties: { exceededTransferLimit: true } }) },
    ids: { ids: (b) => ({ ...b, exceededTransferLimit: true }) },
    enumeration: { enum: (b) => ({ ...b, exceededTransferLimit: true }) },
  };
  for (const [label, hooks] of Object.entries(cases)) {
    const error = await failure({ hooks });
    assert.equal(error.code, FAILURE.TRANSFER_LIMIT, label);
  }
});

test("a truncated response is refused whether or not the service says so", async () => {
  // Silent truncation: no flag, 100 of 138 features.
  const silent = await failure({ hooks: { geojson: (b) => ({ ...b, features: b.features.slice(0, 100) }) } });
  assert.equal(silent.code, FAILURE.COUNT_FEATURE_MISMATCH);
  // Declared truncation with the count already matching the short list.
  const declared = await failure({
    hooks: {
      count: (b) => ({ ...b, count: 100 }),
      ids: (b) => ({ ...b, objectIds: b.objectIds.slice(0, 100) }),
      geojson: (b) => ({ ...b, features: b.features.slice(0, 100), exceededTransferLimit: true }),
    },
  });
  assert.equal(declared.code, FAILURE.TRANSFER_LIMIT);
});

test("an enumeration missing one OBJECTID is refused although the aggregate counts all agree", async () => {
  const error = await failure({
    hooks: { enum: (b) => ({ ...b, features: [...b.features.slice(0, 137), { attributes: { OBJECTID: 9999 } }] }) },
  });
  assert.equal(error.code, FAILURE.OBJECT_ID_MISMATCH);
  assert.equal(error.evidence.enumerated_count, 138);
});

test("GeoJSON feature ids that name other OBJECTIDs are refused although the counts agree", async () => {
  const error = await failure({
    hooks: { geojson: (b) => ({ ...b, features: b.features.map((f, i) => (i === 0 ? { ...f, id: 9999 } : f)) }) },
  });
  assert.equal(error.code, FAILURE.OBJECT_ID_MISMATCH);
});

test("GeoJSON feature ids present on only some features are refused", async () => {
  const error = await failure({
    hooks: { geojson: (b) => ({ ...b, features: b.features.map(({ id, ...rest }, i) => (i === 0 ? rest : { id, ...rest })) }) },
  });
  assert.equal(error.code, FAILURE.MALFORMED);
});

// ------------------------------------------------------------------- geometry

test("every returned feature must carry a valid Point geometry", async () => {
  const bad = {
    "null geometry": null,
    "null coordinate": { type: "Point", coordinates: [null, 40.4] },
    "string coordinate": { type: "Point", coordinates: ["-3.7", 40.4] },
    "missing latitude": { type: "Point", coordinates: [-3.7] },
    "longitude out of range": { type: "Point", coordinates: [-200, 40.4] },
    "latitude out of range": { type: "Point", coordinates: [-3.7, 91] },
    "not a point": { type: "LineString", coordinates: [[-3.7, 40.4], [-3.71, 40.41]] },
    "no coordinates": { type: "Point" },
  };
  for (const [label, geometry] of Object.entries(bad)) {
    const error = await failure({
      hooks: { geojson: (b) => ({ ...b, features: b.features.map((f, i) => (i === 5 ? { ...f, geometry } : f)) }) },
    });
    assert.equal(error.code, FAILURE.GEOMETRY_INVALID, label);
    assert.match(error.message, /1 of 138/);
  }
});

// -------------------------------------------------------------------- timeouts

test("a timeout or transport failure at ANY of the seven requests fails closed", async () => {
  const stages = [["meta", 1], ["count", 1], ["ids", 1], ["geojson", 1], ["enum", 1], ["count", 2], ["meta", 2]];
  for (const [kind, nth] of stages) {
    const error = await failure({ hooks: { [kind]: (b, n) => { if (n === nth) throw abortError(); return b; } } });
    assert.equal(error.code, FAILURE.REQUEST_FAILED, `${kind} #${nth}`);
    assert.match(error.message, /This operation was aborted/);
    assert.equal(error.evidence.status, "FAILED");
  }
});

test("an HTTP error surfaced by fetchJson (non-2xx) fails closed", async () => {
  const error = await failure({ hooks: { count: () => { throw new Error("HTTP 503 for https://example.test"); } } });
  assert.equal(error.code, FAILURE.REQUEST_FAILED);
  assert.match(error.message, /HTTP 503/);
});

// ------------------------------------------------------------------- malformed

test("a 200 response carrying an ArcGIS error body fails closed", async () => {
  for (const kind of ["meta", "count", "ids", "geojson", "enum"]) {
    const error = await failure({ hooks: { [kind]: () => ({ error: { code: 400, message: "Unable to complete operation." } }) } });
    assert.equal(error.code, FAILURE.API_ERROR, kind);
  }
});

test("responses that are not JSON objects fail closed", async () => {
  for (const kind of ["meta", "count", "ids", "geojson", "enum"]) {
    for (const body of [null, "<html>", [], 42]) {
      const error = await failure({ hooks: { [kind]: () => body } });
      assert.equal(error.code, FAILURE.MALFORMED, `${kind} ${JSON.stringify(body)}`);
    }
  }
});

test("structurally wrong bodies fail closed", async () => {
  const cases = [
    ["ids is null", { ids: (b) => ({ ...b, objectIds: null }) }],
    ["ids missing", { ids: () => ({ objectIdFieldName: "OBJECTID" }) }],
    ["ids contain a string", { ids: (b) => ({ ...b, objectIds: b.objectIds.map((x, i) => (i === 0 ? "1" : x)) }) }],
    ["features is an object", { geojson: (b) => ({ ...b, features: {} }) }],
    ["features missing", { geojson: () => ({ type: "FeatureCollection" }) }],
    ["enumeration missing", { enum: () => ({}) }],
    ["enumeration lacks the OBJECTID attribute", { enum: (b) => ({ ...b, features: b.features.map(() => ({ attributes: {} })) }) }],
    ["metadata names no OBJECTID field", { meta: (b) => ({ ...b, fields: [{ name: "IDESTACION", type: "esriFieldTypeString" }] }) }],
  ];
  for (const [label, hooks] of cases) {
    const error = await failure({ hooks });
    assert.equal(error.code, FAILURE.MALFORMED, label);
  }
});

test("a truncated JSON document (parse failure inside fetchJson) fails closed", async () => {
  const error = await failure({ hooks: { geojson: () => { throw new SyntaxError("Unexpected end of JSON input"); } } });
  assert.equal(error.code, FAILURE.REQUEST_FAILED);
});

// ------------------------------------------------------- mid-audit source change

test("an edit timestamp that moves between the first and last request fails closed", async () => {
  const error = await failure({
    hooks: { meta: (b, n) => (n === 2 ? { ...b, editingInfo: { ...b.editingInfo, dataLastEditDate: b.editingInfo.dataLastEditDate + 60_000 } } : b) },
  });
  assert.equal(error.code, FAILURE.EDITED_DURING_AUDIT);
  assert.equal(error.evidence.source_edit.stable_during_retrieval, false);
});

test("a count that moves between the first and the recheck fails closed even if the timestamp did not", async () => {
  const error = await failure({ hooks: { count: (b, n) => (n === 2 ? { ...b, count: b.count + 1 } : b) } });
  assert.equal(error.code, FAILURE.EDITED_DURING_AUDIT);
  assert.equal(error.evidence.queried_count, 138);
  assert.equal(error.evidence.queried_count_recheck, 139);
});

test("a source that exposes no edit timestamp cannot be shown stable and fails closed", async () => {
  for (const meta of [
    (b) => ({ ...b, editingInfo: undefined }),
    (b) => ({ ...b, editingInfo: {} }),
    (b) => ({ ...b, editingInfo: { dataLastEditDate: "2026-09-01" } }),
    (b) => ({ ...b, editingInfo: { dataLastEditDate: 0 } }),
  ]) {
    const error = await failure({ hooks: { meta } });
    assert.equal(error.code, FAILURE.EDIT_TIMESTAMP_UNAVAILABLE);
  }
  const lost = await failure({ hooks: { meta: (b, n) => (n === 2 ? { ...b, editingInfo: undefined } : b) } });
  assert.equal(lost.code, FAILURE.EDIT_TIMESTAMP_UNAVAILABLE, "the timestamp must still be exposed after retrieval");
});

// ------------------------------------------------------------- query contract

test("a query whose geometry is not the shared extraction contract is refused before any request", async () => {
  const widened = new URL(QUERY_URL);
  widened.searchParams.set("geometry", "-3.80,40.35,-3.60,40.50");
  const service = makeCrtmService();
  await assert.rejects(
    reconcileCrtmService({ mode: "metro", queryUrl: widened.toString(), fetchJson: service.fetchJson, now: FIXED }),
    (error) => error.code === FAILURE.QUERY_PREDICATE,
  );
  assert.equal(service.calls.length, 0, "nothing is queried for a query that is not the contract");
});

test("a query missing any predicate, or not in WGS84, or not a URL, is refused", async () => {
  for (const key of ["where", "geometry", "geometryType", "inSR", "spatialRel"]) {
    const u = new URL(QUERY_URL);
    u.searchParams.delete(key);
    assert.equal((await failure({}, u.toString())).code, FAILURE.QUERY_PREDICATE, key);
  }
  const other = new URL(QUERY_URL);
  other.searchParams.set("inSR", "102100");
  assert.equal((await failure({}, other.toString())).code, FAILURE.QUERY_PREDICATE);
  assert.equal((await failure({}, "not a url")).code, FAILURE.QUERY_PREDICATE);
});

// ----------------------------------------------------------------- the record

test("the retrieval record keeps retrieval apart from coverage and completeness", async () => {
  const metro = (await reconcile({ n: 138 })).evidence;
  const cercanias = (await reconcile({ mode: "cercanias", n: 10 })).evidence;
  const record = buildRetrievalRecord({ metro, cercanias }, FIXED);
  assert.equal(record.contract_version, RECONCILIATION_CONTRACT_VERSION);
  assert.equal(record.scope, "RETRIEVAL_WITHIN_QUERY_BOUNDARY");
  assert.equal(record.status, "RECONCILED");
  assert.equal(record.is_coverage_evidence, false);
  assert.equal(record.source_completeness, "NOT_VERIFIED");
  assert.equal(record.extraction_contract_version, extraction.CONTRACT_VERSION);
  assert.match(record.claim, /does not establish municipal coverage/);
  assert.equal(extraction.RAIL_EXTRACTION_RECORD.completeness, "NOT_VERIFIED", "the extraction contract is untouched");
  assert.equal(extraction.RAIL_EXTRACTION_RECORD.is_coverage_evidence, false);
});

test("one failed service makes the whole record FAILED, and no service list makes it FAILED too", async () => {
  const ok = (await reconcile()).evidence;
  const bad = (await failure({ hooks: { count: (b) => ({ ...b, count: 1 }) } })).evidence;
  assert.equal(buildRetrievalRecord({ metro: ok, cercanias: bad }, FIXED).status, "FAILED");
  assert.equal(buildRetrievalRecord({}, FIXED).status, "FAILED");
  assert.equal(buildRetrievalRecord({ metro: ok }, FIXED).status, "RECONCILED");
});

// ------------------------------------------------- the real builder, offline

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function runBuilder(scenario) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lens-f02-"));
  fs.mkdirSync(path.join(cwd, "data"));
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(path.join(ROOT, "tests/support/stub_fetch_preload.mjs")).href, path.join(ROOT, "scripts/build_runtime_poi.mjs")],
      { cwd, env: { ...process.env, CRTM_STUB: JSON.stringify(scenario) }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `builder must always finish: ${result.stderr}`);
    return JSON.parse(fs.readFileSync(path.join(cwd, "data/runtime_poi.json"), "utf8"));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test("builder integration: a consistent answer is published with its reconciliation record", () => {
  const out = runBuilder({});
  assert.equal(out.status.rail.ok, true);
  assert.equal(out.status.rail.count, 148);
  assert.equal(out.layers.rail.length, 148);
  assert.deepEqual(out.status.rail.extraction, extraction.RAIL_EXTRACTION_RECORD, "the extraction contract record is unchanged");
  const retrieval = out.status.rail.retrieval;
  assert.equal(retrieval.status, "RECONCILED");
  assert.equal(retrieval.services.metro.returned_count, 138);
  assert.equal(retrieval.services.cercanias.returned_count, 10);
  assert.equal(retrieval.services.metro.queried_count, 138);
  assert.equal(retrieval.source_completeness, "NOT_VERIFIED");
  assert.equal(retrieval.is_coverage_evidence, false);
  assert.equal(out.layers.rail.filter((r) => r.mode === "metro").length, 138);
});

test("builder integration: a mismatch in one service fails the rail layer and withholds every rail record", () => {
  const out = runBuilder({ metro: "count_mismatch" });
  assert.equal(out.status.rail.ok, false);
  assert.match(out.status.rail.error, /CRTM_RECONCILIATION_FAILED\[COUNT_DOES_NOT_EQUAL_ID_COUNT\]/);
  assert.deepEqual(out.layers.rail, [], "a layer that could not be reconciled publishes no records, not a partial set");
  assert.equal(out.status.rail.retrieval.status, "FAILED");
  assert.equal(out.status.rail.retrieval.services.metro.status, "FAILED");
  assert.equal(out.status.rail.retrieval.services.cercanias.status, "RECONCILED", "the other service's evidence is still recorded");
});

test("builder integration: a timeout and a mid-retrieval edit each fail the rail layer", () => {
  const timeout = runBuilder({ cercanias: "timeout" });
  assert.equal(timeout.status.rail.ok, false);
  assert.match(timeout.status.rail.error, /REQUEST_FAILED/);
  const edited = runBuilder({ metro: "edited" });
  assert.equal(edited.status.rail.ok, false);
  assert.match(edited.status.rail.error, /SOURCE_CHANGED_DURING_RETRIEVAL/);
});
