// F-02 — CRTM query reconciliation, run inside the deployment build.
//
// SCOPE. For ONE CRTM feature service and the ONE extraction query the builder
// already sends (scripts/build_runtime_poi.mjs `crtmStationQuery`), this module
// proves that the response the builder is about to publish is a complete, internally
// consistent answer to THAT query at THAT moment:
//
//   official count == OBJECTID list == GeoJSON features == independently
//   enumerated OBJECTIDs, no transfer limit reported, every geometry valid,
//   and the source was not edited while this was being checked.
//
// WHAT IT IS NOT. It does not widen, change or re-interpret the extraction
// rectangle, and it says nothing about the municipality or about the publisher's
// dataset being complete. The record it produces keeps the three claims apart:
//   - the geographic extraction contract (js/extraction-bounds.js) is unchanged;
//   - `retrieval` here is RETRIEVAL WITHIN THAT QUERY BOUNDARY only;
//   - `source_completeness` stays NOT_VERIFIED and `is_coverage_evidence` false.
//
// PREDICATES. The spatial predicate (where / geometry / geometryType / inSR /
// spatialRel) is read back from the very URL the builder issues, never retyped
// here, so the count and ID queries cannot drift from the feature query. The
// geometry must also equal the shared contract's envelope or the run fails.
//
// FAIL CLOSED. Any transport error, timeout, error body, malformed shape, count
// disagreement, duplicate ID, invalid geometry, reported transfer limit, OBJECTID
// set mismatch, missing edit timestamp or edit observed between the first and last
// request throws a ReconciliationError. The builder then reports the rail layer as
// unavailable, which the existing deployment-integrity gate refuses to publish.
//
// No dependency beyond the shared extraction contract. Network I/O is injected
// (`fetchJson`), so every outcome is testable deterministically.

import extraction from "../js/extraction-bounds.js";

export const RECONCILIATION_CONTRACT_VERSION = "1.0.0";
export const RECONCILIATION_SCOPE = "RETRIEVAL_WITHIN_QUERY_BOUNDARY";
export const RECONCILIATION_STATUS = Object.freeze({ RECONCILED: "RECONCILED", FAILED: "FAILED" });

export const FAILURE = Object.freeze({
  QUERY_PREDICATE: "QUERY_PREDICATE_NOT_THE_CONTRACT",
  REQUEST_FAILED: "REQUEST_FAILED",
  API_ERROR: "API_ERROR_BODY",
  MALFORMED: "MALFORMED_RESPONSE",
  COUNT_INVALID: "COUNT_NOT_A_NONNEGATIVE_INTEGER",
  ID_DUPLICATE: "DUPLICATE_OBJECT_IDS",
  COUNT_ID_MISMATCH: "COUNT_DOES_NOT_EQUAL_ID_COUNT",
  COUNT_FEATURE_MISMATCH: "COUNT_DOES_NOT_EQUAL_FEATURE_COUNT",
  GEOMETRY_INVALID: "INVALID_GEOMETRY",
  TRANSFER_LIMIT: "EXCEEDED_TRANSFER_LIMIT",
  OBJECT_ID_MISMATCH: "OBJECT_ID_SETS_DISAGREE",
  EDIT_TIMESTAMP_UNAVAILABLE: "SOURCE_EDIT_TIMESTAMP_UNAVAILABLE",
  EDITED_DURING_AUDIT: "SOURCE_CHANGED_DURING_RETRIEVAL",
});

export class ReconciliationError extends Error {
  constructor(code, message, evidence = null) {
    super(`CRTM_RECONCILIATION_FAILED[${code}]: ${message}`);
    this.name = "ReconciliationError";
    this.code = code;
    this.evidence = evidence;
  }
}

const PREDICATE_KEYS = ["where", "geometry", "geometryType", "inSR", "spatialRel"];
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isCount = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isOid = (v) => typeof v === "number" && Number.isInteger(v);

// A transfer limit may be reported at the top level of an Esri JSON response or,
// for GeoJSON output, at the top level or inside `properties`. Absent means the
// response format did not say so — recorded as NOT_REPORTED, never as "false".
function transferLimit(body) {
  const flag = body?.exceededTransferLimit ?? body?.properties?.exceededTransferLimit;
  return flag === undefined || flag === null ? "NOT_REPORTED" : Boolean(flag);
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function validPoint(feature) {
  const g = feature?.geometry;
  if (!isObject(g) || g.type !== "Point" || !Array.isArray(g.coordinates) || g.coordinates.length < 2) return false;
  const [lon, lat] = g.coordinates;
  return typeof lon === "number" && typeof lat === "number"
    && Number.isFinite(lon) && Number.isFinite(lat)
    && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

/**
 * Reconcile one CRTM service against the builder's own feature query.
 *
 * @param {object}   args
 * @param {string}   args.mode      "metro" | "cercanias" (recorded, not interpreted).
 * @param {string}   args.queryUrl  The exact URL the builder sends for the features.
 * @param {Function} args.fetchJson (url) => Promise<parsed JSON>; throws on HTTP error/timeout.
 * @param {Function} [args.now]     () => Date; injectable clock.
 * @returns {Promise<{geojson: object, evidence: object}>} geojson is the very response that was reconciled.
 */
export async function reconcileCrtmService({ mode, queryUrl, fetchJson, now = () => new Date() }) {
  const startedAt = now().toISOString();
  const evidence = {
    mode,
    status: RECONCILIATION_STATUS.FAILED,
    failure_code: null,
    retrieved_at: startedAt,
    completed_at: null,
    service_url: null,
    query: null,
    queried_count: null,
    queried_count_recheck: null,
    id_count: null,
    unique_id_count: null,
    returned_count: null,
    enumerated_count: null,
    exceeded_transfer_limit: { ids: null, features: null, enumeration: null },
    object_id_reconciliation: { ids_vs_enumeration: null, ids_vs_geojson: null },
    source_edit: { data_last_edit_date: null, stable_during_retrieval: null },
  };
  const fail = (code, message) => {
    evidence.failure_code = code;
    evidence.completed_at = now().toISOString();
    throw new ReconciliationError(code, `${mode}: ${message}`, evidence);
  };
  const call = async (label, url) => {
    let body;
    try {
      body = await fetchJson(url);
    } catch (error) {
      return fail(FAILURE.REQUEST_FAILED, `${label} request failed (${error?.message ?? error})`);
    }
    if (!isObject(body)) return fail(FAILURE.MALFORMED, `${label} response is not a JSON object`);
    if (body.error !== undefined) {
      return fail(FAILURE.API_ERROR, `${label} response carries an error body (${JSON.stringify(body.error).slice(0, 160)})`);
    }
    return body;
  };

  // --- The predicate, taken from the builder's own URL ----------------------
  let parsed;
  try {
    parsed = new URL(queryUrl);
  } catch {
    return fail(FAILURE.QUERY_PREDICATE, "the feature query URL is not a valid URL");
  }
  const predicate = {};
  for (const key of PREDICATE_KEYS) {
    const value = parsed.searchParams.get(key);
    if (value === null || value === "") return fail(FAILURE.QUERY_PREDICATE, `the feature query has no "${key}" predicate`);
    predicate[key] = value;
  }
  if (predicate.geometry !== extraction.envelopeParam(extraction.RAIL_EXTRACTION_BOUNDS) || predicate.inSR !== "4326") {
    return fail(FAILURE.QUERY_PREDICATE, "the feature query geometry/CRS is not the shared extraction contract");
  }
  const layerUrl = `${parsed.origin}${parsed.pathname.replace(/\/query$/, "")}`;
  evidence.service_url = layerUrl;
  evidence.query = {
    extraction_contract_version: extraction.CONTRACT_VERSION,
    crs: extraction.RAIL_EXTRACTION_RECORD.crs,
    bounds: { ...extraction.RAIL_EXTRACTION_BOUNDS },
    where: predicate.where,
    geometry: predicate.geometry,
    geometry_type: predicate.geometryType,
    in_sr: predicate.inSR,
    spatial_rel: predicate.spatialRel,
  };
  const scoped = (extra) => `${layerUrl}/query?${new URLSearchParams({ ...predicate, ...extra }).toString()}`;

  // --- Layer metadata before: edit timestamp, OBJECTID field ---------------
  const readMeta = async (label) => {
    const meta = await call(label, `${layerUrl}?f=json`);
    const edited = meta.editingInfo?.dataLastEditDate;
    if (!isOid(edited) || edited <= 0) {
      return fail(FAILURE.EDIT_TIMESTAMP_UNAVAILABLE, `${label} does not expose editingInfo.dataLastEditDate, so an edit during retrieval cannot be ruled out`);
    }
    return { meta, edited };
  };
  const before = await readMeta("layer metadata (before)");
  const oidField = (Array.isArray(before.meta.fields) ? before.meta.fields.find((f) => f?.type === "esriFieldTypeOID")?.name : null)
    ?? before.meta.objectIdField;
  if (typeof oidField !== "string" || !oidField) {
    return fail(FAILURE.MALFORMED, "layer metadata does not name an OBJECTID field");
  }
  evidence.source_edit.data_last_edit_date = new Date(before.edited).toISOString();

  // --- Independent count and ID list ---------------------------------------
  const countBody = await call("returnCountOnly", scoped({ returnCountOnly: "true", f: "json" }));
  if (!isCount(countBody.count)) return fail(FAILURE.COUNT_INVALID, `returnCountOnly gave ${JSON.stringify(countBody.count)}`);
  evidence.queried_count = countBody.count;

  const idsBody = await call("returnIdsOnly", scoped({ returnIdsOnly: "true", f: "json" }));
  if (!Array.isArray(idsBody.objectIds) || !idsBody.objectIds.every(isOid)) {
    return fail(FAILURE.MALFORMED, "returnIdsOnly did not return an array of integer objectIds");
  }
  evidence.exceeded_transfer_limit.ids = transferLimit(idsBody);
  const idList = idsBody.objectIds;
  const idSet = new Set(idList);
  evidence.id_count = idList.length;
  evidence.unique_id_count = idSet.size;
  if (evidence.exceeded_transfer_limit.ids === true) return fail(FAILURE.TRANSFER_LIMIT, "the ID list reports exceededTransferLimit");
  if (idSet.size !== idList.length) return fail(FAILURE.ID_DUPLICATE, `${idList.length} IDs returned but only ${idSet.size} are unique`);
  if (idList.length !== countBody.count) return fail(FAILURE.COUNT_ID_MISMATCH, `count ${countBody.count} but ${idList.length} IDs`);

  // --- The exact feature response the builder will publish -----------------
  const geojson = await call("feature query", queryUrl);
  if (!Array.isArray(geojson.features)) return fail(FAILURE.MALFORMED, "feature response has no features array");
  evidence.returned_count = geojson.features.length;
  evidence.exceeded_transfer_limit.features = transferLimit(geojson);
  if (evidence.exceeded_transfer_limit.features === true) return fail(FAILURE.TRANSFER_LIMIT, "the feature response reports exceededTransferLimit");
  if (geojson.features.length !== countBody.count) {
    return fail(FAILURE.COUNT_FEATURE_MISMATCH, `count ${countBody.count} but ${geojson.features.length} GeoJSON features`);
  }
  const badGeometry = geojson.features.filter((f) => !validPoint(f)).length;
  if (badGeometry) return fail(FAILURE.GEOMETRY_INVALID, `${badGeometry} of ${geojson.features.length} features have no valid Point geometry`);

  // GeoJSON feature ids are the OBJECTIDs when the service exposes them.
  const geoIds = geojson.features.map((f) => f.id).filter((id) => id !== undefined && id !== null);
  if (geoIds.length === 0) {
    evidence.object_id_reconciliation.ids_vs_geojson = "NOT_EXPOSED";
  } else {
    if (geoIds.length !== geojson.features.length || !geoIds.every(isOid)) {
      return fail(FAILURE.MALFORMED, "GeoJSON feature ids are only partly present or not integers");
    }
    if (!sameSet(new Set(geoIds), idSet) || new Set(geoIds).size !== geoIds.length) {
      return fail(FAILURE.OBJECT_ID_MISMATCH, "GeoJSON feature ids differ from the returnIdsOnly set");
    }
    evidence.object_id_reconciliation.ids_vs_geojson = "RECONCILED";
  }

  // --- Independent enumeration of OBJECTIDs (Esri JSON, same predicate) ----
  // One request, no paging: if the service cannot return the whole set in one
  // response it reports exceededTransferLimit and the run fails closed.
  const enumBody = await call("OBJECTID enumeration", scoped({ outFields: oidField, returnGeometry: "false", f: "json" }));
  if (!Array.isArray(enumBody.features)) return fail(FAILURE.MALFORMED, "OBJECTID enumeration has no features array");
  evidence.exceeded_transfer_limit.enumeration = transferLimit(enumBody);
  if (evidence.exceeded_transfer_limit.enumeration === true) return fail(FAILURE.TRANSFER_LIMIT, "the OBJECTID enumeration reports exceededTransferLimit");
  const enumerated = enumBody.features.map((f) => f?.attributes?.[oidField]);
  if (!enumerated.every(isOid)) return fail(FAILURE.MALFORMED, "OBJECTID enumeration contains a non-integer or missing OBJECTID");
  evidence.enumerated_count = enumerated.length;
  if (new Set(enumerated).size !== enumerated.length) return fail(FAILURE.ID_DUPLICATE, "the OBJECTID enumeration repeats an OBJECTID");
  if (!sameSet(new Set(enumerated), idSet)) return fail(FAILURE.OBJECT_ID_MISMATCH, "enumerated OBJECTIDs differ from the returnIdsOnly set");
  evidence.object_id_reconciliation.ids_vs_enumeration = "RECONCILED";

  // --- Nothing may have changed while the above ran ------------------------
  const recount = await call("returnCountOnly (recheck)", scoped({ returnCountOnly: "true", f: "json" }));
  if (!isCount(recount.count)) return fail(FAILURE.COUNT_INVALID, `recheck count gave ${JSON.stringify(recount.count)}`);
  evidence.queried_count_recheck = recount.count;
  const after = await readMeta("layer metadata (after)");
  if (recount.count !== countBody.count || after.edited !== before.edited) {
    evidence.source_edit.stable_during_retrieval = false;
    return fail(FAILURE.EDITED_DURING_AUDIT, `count ${countBody.count}->${recount.count}, dataLastEditDate ${before.edited}->${after.edited}`);
  }
  evidence.source_edit.stable_during_retrieval = true;

  evidence.status = RECONCILIATION_STATUS.RECONCILED;
  evidence.completed_at = now().toISOString();
  return { geojson, evidence };
}

/** The wrapper recorded at `status.rail.retrieval` in runtime_poi.json. */
export function buildRetrievalRecord(services, now = () => new Date()) {
  const entries = Object.values(services);
  const reconciled = entries.length > 0 && entries.every((s) => s?.status === RECONCILIATION_STATUS.RECONCILED);
  return {
    contract_version: RECONCILIATION_CONTRACT_VERSION,
    scope: RECONCILIATION_SCOPE,
    status: reconciled ? RECONCILIATION_STATUS.RECONCILED : RECONCILIATION_STATUS.FAILED,
    recorded_at: now().toISOString(),
    extraction_contract_version: extraction.CONTRACT_VERSION,
    is_coverage_evidence: false,
    source_completeness: "NOT_VERIFIED",
    claim: "Each service's answer to the extraction query was internally consistent and stable while retrieved. It does not establish municipal coverage or that the publisher's dataset is complete.",
    services,
  };
}
