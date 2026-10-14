#!/usr/bin/env node
// Deployment evidence-integrity gate.
//
//   SOURCE -> BUILD -> VALIDATE -> AUDIT MANIFEST -> DEPLOY
//
// Reads data/source_registry.json plus the artifacts the builders produced,
// writes a compact audit manifest describing THIS build, and exits non-zero when
// a source that blocks deployment is missing, invalid, or has collapsed. A
// non-zero exit is what keeps actions/deploy-pages from running, so GitHub Pages
// retains the previous good deployment instead of publishing degraded evidence.
//
// No dependencies: the checks are deterministic comparisons over parsed JSON, so
// a JSON Schema package would add a dependency without adding a rule.
//
// Usage:
//   node scripts/validate_deployment.mjs
//   node scripts/validate_deployment.mjs --data-dir <dir> --manifest-out <file>

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// The analytical-scope and freshness vocabulary is defined once, in the pure
// model, so the deployment gate and the renderer (K4) can never drift apart.
import {
  ANALYTICAL_SCOPES,
  UPDATE_FREQUENCIES,
  SOURCE_STATES,
  FRESHNESS_FIELDS,
  isReferenceDate,
  isUpdateFrequency,
  isSourceState,
} from "../js/evidence-scope.js";
import {
  CHANGE_OUTCOMES,
  CHANGE_OUTCOME,
  BUILDABILITY_STATE,
  auditEditionPair,
  auditLegacyGateLPair,
  classifyAmbitoEditionPair,
  compareBuildability,
  reconcileEditionPair,
} from "../js/ambito-change.js";

export const CONTRACT_VERSION = "1.0.0";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// retrieved_at is a point in time: an ISO datetime, or an ISO date where that is
// the only precision the evidence recorded (e.g. a research extraction logged as
// a day). It is never a bare year or a catalogue timestamp dressed up as one.
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;

// published_at is an ISO date or an explicit null — never inferred from a
// reference date, a catalogue record date or a file timestamp.
function isPublishedAt(value) {
  return value === null || (typeof value === "string" && ISO_DATE.test(value));
}

// retrieved_at is normally a mandatory ISO datetime. The one documented
// exception is a rebuilt-at-deploy layer that is currently unavailable (the
// opt-in pedestrian snapshot, not built in this checkout): it carries an
// explicit null, because no retrieval has happened, exactly as it already
// carries a null source_period. A null is NEVER accepted for a committed source
// or for an available layer.
function isRetrievedAt(value) {
  return typeof value === "string" && (ISO_DATETIME.test(value) || ISO_DATE.test(value));
}

// The five-field freshness contract plus the enumerated analytical scope, checked
// against the closed vocabularies in the pure model. Every failure here is a
// build error: a malformed freshness record or an undeclared scope is a registry
// defect, not a data-availability condition, so it blocks whatever the source's
// role. The only availability-sensitive rule is the retrieved_at carve-out below.
// `layerState` is the state the per-shape validator computed for this source in
// THIS build, and `effectiveRetrievedAt` is the retrieval timestamp that will
// actually ship for it: the built artifact's generatedAt for a rebuilt-at-deploy
// source, the committed registry value for a committed source.
function validateSourceFreshness(source, layerState, effectiveRetrievedAt, scopes, errors) {
  const label = source.display_name ?? source.id;

  // 1. Analytical scope: declared, and declared in the registry's analytical
  // scope enum. Distinct from expected_spatial_scope (the integrity envelope).
  const analytical = scopes?.analytical_scopes;
  if (!Object.prototype.hasOwnProperty.call(source, "scope")) {
    errors.push(`${label}: declares no analytical scope; every source must name exactly one`);
  } else if (!ANALYTICAL_SCOPES.includes(source.scope) || !analytical || !analytical[source.scope]) {
    errors.push(
      `${label}: analytical scope "${source.scope}" is not declared in spatial_scopes.analytical_scopes`
    );
  }

  // 2. All five freshness fields must be present as own properties. A missing
  // property is a contract violation, distinct from an explicit null.
  for (const field of FRESHNESS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) {
      errors.push(`${label}: missing mandatory freshness field "${field}"`);
    }
  }

  // 3. reference_date and published_at: ISO month/date or explicit null.
  if ("reference_date" in source && !isReferenceDate(source.reference_date)) {
    errors.push(`${label}: reference_date "${source.reference_date}" is not an ISO month, ISO date, or null`);
  }
  if ("published_at" in source && !isPublishedAt(source.published_at)) {
    errors.push(`${label}: published_at "${source.published_at}" is not an ISO date or null`);
  }

  // 4. retrieved_at. The value that ships is effectiveRetrievedAt: an available
  // source must record when it was obtained; an unavailable one may carry null
  // (the opt-in pedestrian snapshot not built in this checkout), but never a
  // malformed value.
  if (layerState === "available") {
    if (!isRetrievedAt(effectiveRetrievedAt)) {
      errors.push(
        `${label}: no usable retrieved_at; an available source must record when it was obtained ` +
          `(a rebuilt-at-deploy source takes it from the built artifact's generatedAt)`
      );
    }
  } else if (effectiveRetrievedAt !== null && !isRetrievedAt(effectiveRetrievedAt)) {
    errors.push(`${label}: retrieved_at "${effectiveRetrievedAt}" is not an ISO datetime or date`);
  }
  // Registry hygiene: a rebuilt-at-deploy source resolves retrieved_at at deploy
  // from its artifact, so its static registry value must be null — never a stale
  // committed date that would misreport a live-fetched layer's currency. A
  // committed source must carry a real ISO datetime/date in the registry.
  if (source.rebuilt_at_deploy === true) {
    if (source.retrieved_at !== null) {
      errors.push(
        `${label}: a rebuilt-at-deploy source must carry retrieved_at: null in the registry ` +
          `(it is resolved at deploy from the artifact generatedAt)`
      );
    }
  } else if (!isRetrievedAt(source.retrieved_at)) {
    errors.push(`${label}: retrieved_at "${source.retrieved_at}" is not an ISO datetime or date in the registry`);
  }

  // 5. Closed vocabularies for cadence and state.
  if ("update_frequency" in source && !isUpdateFrequency(source.update_frequency)) {
    errors.push(
      `${label}: update_frequency "${source.update_frequency}" is not one of ${UPDATE_FREQUENCIES.join(", ")}`
    );
  }
  if ("source_state" in source && !isSourceState(source.source_state)) {
    errors.push(`${label}: source_state "${source.source_state}" is not one of ${SOURCE_STATES.join(", ")}`);
  }
  // observed_cadence is optional, but if present must be in the cadence vocabulary.
  if ("observed_cadence" in source && !isUpdateFrequency(source.observed_cadence)) {
    errors.push(
      `${label}: observed_cadence "${source.observed_cadence}" is not one of ${UPDATE_FREQUENCIES.join(", ")}`
    );
  }

  // 6. Cadence must never overstate a committed artifact. A source whose evidence
  // is a committed snapshot (not fetched at deploy) cannot claim a DAILY cadence
  // as freshness: the publisher may update daily, but our bundled artifact is a
  // fixed snapshot, and cadence must never read as a currency badge.
  if (source.rebuilt_at_deploy === false && source.update_frequency === "DAILY") {
    errors.push(
      `${label}: declares update_frequency DAILY while shipping a committed snapshot ` +
        `(rebuilt_at_deploy is false). Publisher cadence is not artifact currency`
    );
  }
}

// ---------------------------------------------------------------- helpers

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function inScope(point, box) {
  return (
    point.lat >= box.lat_min &&
    point.lat <= box.lat_max &&
    point.lon >= box.lon_min &&
    point.lon <= box.lon_max
  );
}

// Coordinate problems are reported as one aggregated finding per layer rather
// than one per record, so a systemic failure (every coordinate unconverted, say)
// does not bury the report under hundreds of identical lines.
function checkCoordinates(records, box, label, errors) {
  const nonFinite = [];
  const outOfScope = [];
  for (const [i, r] of records.entries()) {
    if (!isFiniteNumber(r.lat) || !isFiniteNumber(r.lon)) {
      nonFinite.push(r.id ?? `index ${i}`);
      continue;
    }
    if (!inScope(r, box)) outOfScope.push(`${r.id ?? `index ${i}`} (${r.lat}, ${r.lon})`);
  }
  if (nonFinite.length) {
    errors.push(
      `${label}: ${nonFinite.length} record(s) have a non-finite coordinate, e.g. ${nonFinite
        .slice(0, 3)
        .join(", ")}`
    );
  }
  if (outOfScope.length) {
    errors.push(
      `${label}: ${outOfScope.length} record(s) fall outside the declared spatial scope, e.g. ${outOfScope
        .slice(0, 3)
        .join("; ")}`
    );
  }
  return { nonFinite: nonFinite.length, outOfScope: outOfScope.length };
}

function checkUniqueIds(records, label, errors) {
  const seen = new Set();
  const missing = [];
  const duplicated = new Set();
  for (const [i, r] of records.entries()) {
    if (!isNonEmptyString(r.id)) {
      missing.push(`index ${i}`);
      continue;
    }
    if (seen.has(r.id)) duplicated.add(r.id);
    seen.add(r.id);
  }
  if (missing.length) {
    errors.push(`${label}: ${missing.length} record(s) have no usable id, e.g. ${missing.slice(0, 3).join(", ")}`);
  }
  if (duplicated.size) {
    errors.push(
      `${label}: ${duplicated.size} duplicate id(s) where ids must be unique, e.g. ${[...duplicated]
        .slice(0, 3)
        .join(", ")}`
    );
  }
}

// ---------------------------------------------------------------- per-shape checks

function validatePoiLayer(source, runtimePoi, scopes, errors, warnings) {
  const label = source.display_name;
  const blocking = source.blocks_deployment;
  // An optional layer's problems are warnings; a blocking layer's are errors.
  const sink = blocking ? errors : warnings;

  const layers = runtimePoi?.layers;
  const status = runtimePoi?.status;

  const records = layers?.[source.id];
  const layerStatus = status?.[source.id];

  if (!Array.isArray(records)) {
    sink.push(`${label}: layers.${source.id} is missing or is not an array`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  if (!layerStatus || typeof layerStatus !== "object") {
    sink.push(`${label}: status.${source.id} is missing, so the layer has no declared build state`);
    return { record_count: records.length, state: "unavailable", source_period: null, warnings: [] };
  }

  const layerWarnings = [];

  // Declared count must equal the actual array length.
  if (layerStatus.count !== records.length) {
    sink.push(
      `${label}: declared count ${layerStatus.count} does not equal the actual ${records.length} record(s) in layers.${source.id}`
    );
  }

  if (layerStatus.ok !== true) {
    const detail = layerStatus.error ? ` (builder reported: ${layerStatus.error})` : "";
    if (blocking) {
      errors.push(`${label}: build reported the layer as unavailable${detail}, and this layer blocks deployment`);
    } else {
      warnings.push(`${label}: unavailable in this build${detail}. Allowed: the app shows an explicit unavailable state.`);
    }
    return { record_count: records.length, state: "unavailable", source_period: null, warnings: layerWarnings };
  }

  if (records.length === 0) {
    sink.push(`${label}: build reported ok but produced zero records`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: layerWarnings };
  }

  const box = scopes[source.expected_spatial_scope];
  if (!box) {
    errors.push(`${label}: declares unknown spatial scope "${source.expected_spatial_scope}"`);
  } else {
    checkCoordinates(records, box, label, sink);
  }

  if (source.unique_ids) checkUniqueIds(records, label, sink);

  const unnamed = records.filter((r) => !isNonEmptyString(r.name)).length;
  if (unnamed) layerWarnings.push(`${unnamed} record(s) have no name`);

  // Collapse guardrail.
  const guard = source.integrity_guardrail;
  if (guard && records.length < guard.min_count) {
    const message =
      `${label}: ${records.length} record(s) is below the integrity guardrail of ${guard.min_count} ` +
      `(baseline ${guard.baseline_count} at ${guard.calibrated_on}). This is an ingestion-collapse guardrail, not an analytical threshold.`;
    sink.push(message);
  }

  // Rail: the combined layer must not look healthy while one mode disappeared.
  if (source.required_modes) {
    const field = source.required_modes.field;
    const counts = {};
    for (const r of records) counts[r[field]] = (counts[r[field]] ?? 0) + 1;
    for (const [mode, rule] of Object.entries(source.required_modes.modes)) {
      const n = counts[mode] ?? 0;
      if (n < rule.min_count) {
        sink.push(
          `${label}: required mode "${mode}" has ${n} record(s), below its floor of ${rule.min_count} ` +
            `(baseline ${rule.baseline_count}). A combined rail count can stay healthy while one mode silently disappears.`
        );
      }
    }
    layerWarnings.push(`mode split: ${Object.entries(counts).map(([m, n]) => `${m}=${n}`).join(", ")}`);
  }

  // Accommodation: the artifact must come from the authoritative builder.
  if (source.authoritative_builder) {
    const rule = source.authoritative_builder;
    const value = String(layerStatus[rule.status_field] ?? "");
    const ok = rule.must_include_any.some((m) => value.toLowerCase().includes(m.toLowerCase()));
    if (!ok) {
      sink.push(
        `${label}: status.${source.id}.${rule.status_field} is "${value}", which does not identify an authoritative ` +
          `source (expected one of: ${rule.must_include_any.join(", ")})`
      );
    }
    for (const forbidden of rule.must_not_include_any ?? []) {
      if (value.toLowerCase().includes(forbidden.toLowerCase())) {
        sink.push(
          `${label}: status.${source.id}.${rule.status_field} names "${forbidden}". A non-authoritative source must not ` +
            `be published as the Madrid Destino accommodation deployment artifact.`
        );
      }
    }
  }

  // Accommodation taxonomy: catch the classification block vanishing.
  if (source.taxonomy) {
    const t = source.taxonomy;
    const withCategory = records.filter((r) => isNonEmptyString(r[t.category_field])).length;
    const ratio = withCategory / records.length;
    if (ratio < t.min_present_ratio) {
      sink.push(
        `${label}: only ${withCategory}/${records.length} record(s) carry ${t.category_field} ` +
          `(${(ratio * 100).toFixed(1)}%), below the ${(t.min_present_ratio * 100).toFixed(0)}% guardrail. ` +
          `The source taxonomy may have changed or stopped being parsed.`
      );
    }
    const unclassified = records.filter((r) => r[t.kind_field] === t.unclassified_value).length;
    const unclassifiedRatio = unclassified / records.length;
    if (unclassifiedRatio > t.max_unclassified_ratio) {
      sink.push(
        `${label}: ${unclassified}/${records.length} record(s) classified as "${t.unclassified_value}" ` +
          `(${(unclassifiedRatio * 100).toFixed(1)}%), above the ${(t.max_unclassified_ratio * 100).toFixed(0)}% guardrail. ` +
          `A build where the taxonomy collapses to unclassified must not be published silently.`
      );
    }
    layerWarnings.push(
      `taxonomy: ${withCategory}/${records.length} with ${t.category_field}, ${unclassified} unclassified`
    );
  }

  // Scope observation that is reported, not enforced. The accommodation feed
  // covers the city of Madrid and its surroundings, so a record outside the
  // municipality is expected rather than wrong; filtering it would be an
  // analytical change. This is NOT evidence of regional coverage.
  if (source.warn_outside_scope) {
    const narrower = scopes[source.warn_outside_scope];
    if (narrower) {
      const outside = records.filter((r) => isFiniteNumber(r.lat) && isFiniteNumber(r.lon) && !inScope(r, narrower));
      if (outside.length) {
        layerWarnings.push(
          `${outside.length} record(s) fall outside ${source.warn_outside_scope}: this feed covers the city of Madrid ` +
            `and its surroundings, so it is not a strictly municipal register and is not a regional one either. ` +
            `Not filtered here.`
        );
      }
    }
  }

  return { record_count: records.length, state: "available", source_period: null, warnings: layerWarnings };
}

function validatePedestrian(source, artifact, scopes, errors, warnings) {
  const label = source.display_name;
  const layerWarnings = [];

  if (!artifact || typeof artifact !== "object") {
    errors.push(`${label}: ${source.artifact} is missing or unparseable`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: layerWarnings };
  }
  if (typeof artifact.available !== "boolean") {
    errors.push(`${label}: "available" must be an explicit boolean, so the evidence state is never ambiguous`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: layerWarnings };
  }

  const stations = Array.isArray(artifact.stations) ? artifact.stations : null;
  if (stations === null) {
    errors.push(`${label}: "stations" is missing or is not an array`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: layerWarnings };
  }

  // Internal incoherence is a hard failure whatever the role: the app renders
  // these numbers as observed evidence, so a broken one must not be published.
  if (!artifact.available) {
    if (stations.length !== 0) {
      errors.push(`${label}: marked unavailable but ships ${stations.length} station(s)`);
    }
    if (artifact.stationCount !== 0 || artifact.observationCount !== 0) {
      errors.push(
        `${label}: marked unavailable but declares stationCount=${artifact.stationCount}, ` +
          `observationCount=${artifact.observationCount}. An unavailable layer must not carry numeric evidence.`
      );
    }
    if (artifact.dateMin !== null || artifact.dateMax !== null) {
      errors.push(`${label}: marked unavailable but declares a date range; no period may be fabricated`);
    }
    if (!isNonEmptyString(artifact.error)) {
      errors.push(`${label}: marked unavailable without stating a reason in "error"`);
    }
    warnings.push(
      `${label}: unavailable in this build (${artifact.error ?? "no reason given"}). Allowed: this layer is opt-in, ` +
        `off by default, excluded from operational metrics, and the app shows "No data" rather than a number.`
    );
    return { record_count: 0, state: "unavailable", source_period: null, warnings: layerWarnings };
  }

  if (artifact.stationCount !== stations.length) {
    errors.push(
      `${label}: declared stationCount ${artifact.stationCount} does not equal the actual ${stations.length} station(s)`
    );
  }
  if (!isFiniteNumber(artifact.observationCount) || artifact.observationCount <= 0) {
    errors.push(
      `${label}: available but observationCount is ${artifact.observationCount}. An available observed layer must rest ` +
        `on at least one real observation.`
    );
  }
  if (stations.length === 0) {
    errors.push(`${label}: available but ships zero stations`);
  }

  // Period comes from the records' own dates, never from the build clock.
  let sourcePeriod = null;
  if (!ISO_DATE.test(String(artifact.dateMin)) || !ISO_DATE.test(String(artifact.dateMax))) {
    errors.push(
      `${label}: available but date bounds are not both ISO dates (dateMin=${artifact.dateMin}, dateMax=${artifact.dateMax})`
    );
  } else if (artifact.dateMin > artifact.dateMax) {
    errors.push(`${label}: incoherent date bounds, dateMin ${artifact.dateMin} is after dateMax ${artifact.dateMax}`);
  } else {
    sourcePeriod = {
      from: artifact.dateMin,
      to: artifact.dateMax,
      type: "observed_record_range",
      provisional: artifact.latestPublishedQuarterMayBeProvisional === true,
    };
  }

  const marker = source.required_dataset_marker;
  if (marker) {
    const identity = `${artifact.source?.datasetUrl ?? ""} ${artifact.source?.resourceUrl ?? ""}`;
    if (!identity.includes(marker)) {
      errors.push(
        `${label}: source identity does not reference the municipal pedestrian-counter dataset (expected "${marker}")`
      );
    }
  }

  const box = scopes[source.expected_spatial_scope];
  if (box) checkCoordinates(stations, box, label, errors);
  checkUniqueIds(stations, label, errors);

  const emptyStations = stations.filter((s) => !isFiniteNumber(s.observationCount) || s.observationCount <= 0);
  if (emptyStations.length) {
    errors.push(`${label}: ${emptyStations.length} station(s) carry no observations but are shipped as evidence`);
  }

  const guard = source.integrity_guardrail;
  if (guard && stations.length < guard.min_count) {
    warnings.push(
      `${label}: ${stations.length} station(s) is below the guardrail of ${guard.min_count} ` +
        `(baseline ${guard.baseline_count}). Reported, not blocking: this is optional opt-in evidence.`
    );
  }

  layerWarnings.push(`${artifact.observationCount} observation(s) across ${stations.length} counter(s)`);
  return { record_count: stations.length, state: "available", source_period: sourcePeriod, warnings: layerWarnings };
}

function validateHati(source, assets, provenance, scopes, errors) {
  const label = source.display_name;
  if (!Array.isArray(assets)) {
    errors.push(`${label}: ${source.artifact} is missing or is not an array`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  const guard = source.integrity_guardrail;
  if (guard && assets.length < guard.min_count) {
    errors.push(
      `${label}: ${assets.length} asset(s) is below the locked pilot size of ${guard.min_count}. ` +
        `This evidence is committed and bounded; a change to its size must not reach a deployment unnoticed.`
    );
  }
  const box = scopes[source.expected_spatial_scope];
  if (box) checkCoordinates(assets, box, label, errors);

  const withoutUtci = assets.filter((a) => !a.utci_mean_10m || typeof a.utci_mean_10m !== "object").length;
  if (withoutUtci) errors.push(`${label}: ${withoutUtci} asset(s) carry no utci_mean_10m block`);

  if (!isNonEmptyString(provenance?.source_commit_sha)) {
    errors.push(`${label}: hati_provenance.json has no source_commit_sha, so the evidence is not traceable to a commit`);
  }

  const studyDate = provenance?.study_date ?? null;
  return {
    record_count: assets.length,
    state: "available",
    source_period: studyDate ? { from: studyDate, to: studyDate, type: "modelled_pilot_day", provisional: false } : null,
    warnings: [`pinned source commit ${String(provenance?.source_commit_sha ?? "unknown").slice(0, 12)}`],
  };
}

function validateSnapshotFallback(source, artifact, scopes, errors) {
  const label = source.display_name;
  if (!artifact || typeof artifact !== "object") {
    errors.push(`${label}: ${source.artifact} is missing or unparseable`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  const records = Object.values(artifact).filter(Array.isArray).flat();
  const guard = source.integrity_guardrail;
  if (guard && records.length < guard.min_count) {
    errors.push(
      `${label}: ${records.length} record(s) is below the guardrail of ${guard.min_count}. ` +
        `The packaged last-resort fallback must not silently become empty.`
    );
  }
  const box = scopes[source.expected_spatial_scope];
  if (box) checkCoordinates(records, box, label, errors);
  checkUniqueIds(records, label, errors);
  return {
    record_count: records.length,
    state: "available",
    source_period: null,
    warnings: [`curated sample, deliberately not exhaustive`],
  };
}

function validateHospitalityContext(source, artifact, geography, errors, warnings) {
  const label = source.display_name;
  const sink = source.blocks_deployment ? errors : warnings;
  if (!artifact || artifact.contract_version !== source.contract_version) {
    sink.push(`${label}: missing artifact or unsupported contract version`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  const meta = artifact.metadata;
  const expectedIndicators = source.selectable_indicator_ids;
  if (JSON.stringify(meta?.selectable_indicator_ids) !== JSON.stringify(expectedIndicators)) {
    sink.push(`${label}: selectable indicators differ from the exact Gate F allowlist`);
  }
  if (meta?.default_indicator_id !== "core_hospitality_premises_count") {
    sink.push(`${label}: default indicator is not the approved core-hospitality count`);
  }
  if (
    meta?.premises_sha256 !== source.expected_fingerprints?.premises ||
    meta?.activities_sha256 !== source.expected_fingerprints?.activities
  ) {
    sink.push(`${label}: Locales/Actividades fingerprints do not match the approved Gate F snapshot`);
  }
  if (
    meta?.premises_nominal_period !== "2026-09" ||
    meta?.activities_nominal_period !== "2026-09" ||
    meta?.population_reference_date !== "2026-01-01" ||
    meta?.geography_version?.era !== "CURRENT_131"
  ) {
    sink.push(`${label}: period or CURRENT_131 metadata is invalid`);
  }
  const conditional = meta?.conditional_indicator;
  if (
    conditional?.indicator_id !== "core_hospitality_premises_per_1000_residents" ||
    conditional?.premises_period !== "Sep 2026" ||
    conditional?.population_date !== "2026-01-01" ||
    !String(conditional?.denominator_type ?? "").toLowerCase().includes("registered residents") ||
    !isNonEmptyString(conditional?.interpretation_ceiling)
  ) {
    sink.push(`${label}: conditional per-resident metadata is incomplete`);
  }

  const collections = [
    ["municipality", artifact.municipality, /^28079$/, 1],
    ["district", artifact.districts, /^\d{2}$/, 21],
    ["barrio", artifact.barrios, /^\d{3}(?:\d{2})?$/, 131],
  ];
  for (const [level, collection, idPattern, expectedCount] of collections) {
    const entries = collection && typeof collection === "object" ? Object.entries(collection) : [];
    if (entries.length !== expectedCount) sink.push(`${label}: expected ${expectedCount} ${level} record(s), found ${entries.length}`);
    for (const [id, record] of entries) {
      if (!idPattern.test(id)) sink.push(`${label}: malformed ${level} official id ${id}`);
      if (!isNonEmptyString(record?.official_name)) {
        sink.push(`${label}: ${level} ${id} has no official_name`);
      }
      const keys = Object.keys(record?.indicators ?? {});
      if (JSON.stringify(keys) !== JSON.stringify(expectedIndicators)) {
        sink.push(`${label}: ${level} ${id} has missing or unapproved indicators`);
        continue;
      }
      if (keys.some((key) => !isFiniteNumber(record.indicators[key]) || record.indicators[key] < 0)) {
        sink.push(`${label}: ${level} ${id} has a non-finite or negative indicator`);
      }
    }
  }
  const geoBarrioIds = new Set(
    (geography?.features ?? [])
      .filter((feature) => feature?.properties?.geography_level === "barrio")
      .map((feature) => String(feature.properties.official_id))
  );
  if (
    geoBarrioIds.size !== 131 ||
    Object.keys(artifact.barrios ?? {}).some((id) => !geoBarrioIds.has(id))
  ) {
    sink.push(`${label}: barrio keys do not join 1:1 to canonical geography`);
  }
  const totals = artifact.municipality?.["28079"]?.indicators;
  for (const [indicator, expected] of Object.entries(source.expected_municipality_values ?? {})) {
    if (totals?.[indicator] !== expected) {
      sink.push(`${label}: municipality ${indicator} is ${totals?.[indicator]}, expected ${expected}`);
    }
  }
  return {
    record_count: collections.reduce((sum, [, collection]) => sum + Object.keys(collection ?? {}).length, 0),
    state: sink.some((message) => message.startsWith(`${label}:`)) ? "unavailable" : "available",
    source_period: { from: "2026-09", to: "2026-09", type: "nominal_month", provisional: false },
    warnings: ["Administrative-area context only; one unresolved barrio assignment is preserved in higher-level totals."],
  };
}

// Canonical administrative geography (municipality, districts, barrios). This is
// a committed reference artifact, not a fetched deployment snapshot, so the checks
// here are the same structural contract the test suites enforce, restated at the
// deployment gate for the audit manifest. BLOCKING since the Area Profile feature
// began resolving Lens centres to official barrios and districts at runtime (see
// blocks_deployment_note in the registry): a broken geography would publish
// confident wrong place names, so the site is withheld rather than degraded. The
// sink below follows the registry flag, so the severity is declared in one place.
function validateAdminGeography(source, geojson, meta, scopes, errors, warnings) {
  const label = source.display_name;
  const sink = source.blocks_deployment ? errors : warnings;

  if (!geojson || typeof geojson !== "object" || !Array.isArray(geojson.features)) {
    sink.push(`${label}: ${source.artifact} is missing or is not a GeoJSON FeatureCollection`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }

  const levelField = source.level_field ?? "geography_level";
  const idField = source.id_field ?? "official_id";
  const parentField = source.hierarchy_field ?? "parent_id";
  const byLevel = { municipality: [], district: [], barrio: [] };
  for (const feature of geojson.features) {
    const level = feature?.properties?.[levelField];
    if (byLevel[level]) byLevel[level].push(feature);
  }

  // Counts: exactly the official administrative division, from the registry.
  const expected = source.expected_counts ?? {};
  const countChecks = [
    ["municipality", byLevel.municipality.length, expected.municipality],
    ["districts", byLevel.district.length, expected.districts],
    ["barrios", byLevel.barrio.length, expected.barrios],
  ];
  for (const [name, actual, want] of countChecks) {
    if (typeof want === "number" && actual !== want) {
      sink.push(
        `${label}: expected ${want} ${name}, found ${actual}. A change to Madrid's administrative division ` +
          `must not reach a deployment unnoticed.`
      );
    }
  }

  // Unique ids per level, and no missing id.
  const districtIds = new Set();
  for (const [level, feats] of Object.entries(byLevel)) {
    const seen = new Set();
    for (const f of feats) {
      const id = f.properties?.[idField];
      if (!isNonEmptyString(id)) {
        sink.push(`${label}: a ${level} feature has no ${idField}`);
        continue;
      }
      if (seen.has(id)) sink.push(`${label}: duplicate ${level} ${idField} "${id}"`);
      seen.add(id);
      if (level === "district") districtIds.add(id);
    }
  }

  // Hierarchy: every barrio references a known district; the municipality is the
  // districts' declared parent.
  const muniId = byLevel.municipality[0]?.properties?.[idField] ?? null;
  for (const b of byLevel.barrio) {
    const parent = b.properties?.[parentField];
    if (!districtIds.has(parent)) {
      sink.push(`${label}: barrio ${b.properties?.[idField]} references unknown district "${parent}"`);
    }
  }
  for (const d of byLevel.district) {
    if (muniId && d.properties?.[parentField] !== muniId) {
      sink.push(`${label}: district ${d.properties?.[idField]} does not declare the municipality as its parent`);
    }
  }

  // Names, geometry validity and plausibility.
  const box = scopes[source.expected_spatial_scope];
  let outOfScope = 0;
  let badGeometry = 0;
  let emptyName = 0;
  for (const f of geojson.features) {
    const p = f.properties ?? {};
    if (!isNonEmptyString(p.official_name)) emptyName += 1;
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !Array.isArray(g.coordinates)) {
      badGeometry += 1;
      continue;
    }
    if (box) {
      for (const [lon, lat] of iterCoords(g)) {
        if (!isFiniteNumber(lon) || !isFiniteNumber(lat) || !inScope({ lat, lon }, box)) {
          outOfScope += 1;
          break;
        }
      }
    }
  }
  if (emptyName) sink.push(`${label}: ${emptyName} feature(s) have an empty official_name`);
  if (badGeometry) sink.push(`${label}: ${badGeometry} feature(s) have missing or non-polygon geometry`);
  if (outOfScope) {
    sink.push(
      `${label}: ${outOfScope} feature(s) have coordinates outside ${source.expected_spatial_scope}, ` +
        `which would indicate a projection leak or swapped lat/lon`
    );
  }

  // The municipality boundary is derived, and must stay flagged as such.
  const muniProvenance = byLevel.municipality[0]?.properties?.geometry_provenance;
  if (byLevel.municipality.length && muniProvenance !== "DERIVED_FROM_OFFICIAL_GEOMETRY") {
    sink.push(
      `${label}: the municipality geometry_provenance is "${muniProvenance}", but it is derived ` +
        `from the district union and must be flagged DERIVED_FROM_OFFICIAL_GEOMETRY`
    );
  }

  // The geometry has no published effective/edition date, so the geography
  // carries NO source period. The catalogue's metadata-modified timestamp is not
  // a geometry vintage and must never be turned into one. The authoritative
  // published dataset version identifies the edition and is surfaced for the
  // audit instead.
  const sourcePeriod = null;
  const layerInfo = [
    `${byLevel.district.length} districts, ${byLevel.barrio.length} barrios, ${byLevel.municipality.length} municipality (derived)`,
  ];
  const versions = meta?.source_version?.datasets;
  if (versions && typeof versions === "object") {
    const parts = Object.entries(versions).map(([level, d]) => `${level} ${d?.published_version ?? "unknown"}`);
    layerInfo.push(`published version: ${parts.join(", ")}`);
  } else if (!meta || typeof meta !== "object") {
    warnings.push(`${label}: ${source.meta_artifact} is missing, so the geography's provenance metadata is unavailable`);
  } else {
    warnings.push(`${label}: ${source.meta_artifact} has no source_version.datasets, so the published dataset version is unknown`);
  }

  return {
    record_count: geojson.features.length,
    state: "available",
    source_period: sourcePeriod,
    warnings: layerInfo,
  };
}

// Yields [lon, lat] pairs from a Polygon/MultiPolygon geometry.
function* iterCoords(geometry) {
  const stack = [geometry.coordinates];
  while (stack.length) {
    const item = stack.pop();
    if (item.length && typeof item[0] === "number") {
      yield item;
    } else {
      for (const child of item) stack.push(child);
    }
  }
}

// Canonical residential population denominator (barrio, with derived district and
// municipality totals). Committed reference evidence joined to the canonical
// geography by official code. BLOCKING since the Area Profile feature began
// showing a barrio's registered residents, with its reference date, in the
// interface: the UI abstains when a single figure is absent, but an artifact that
// is already broken at build time must not reach the public site. The checks
// restate the denominator contract at the deployment gate and cross-check it
// against the committed geography so the manifest can be audited.
function validatePopulation(source, population, meta, geography, errors, warnings) {
  const label = source.display_name;
  const sink = source.blocks_deployment ? errors : warnings;

  if (!population || typeof population !== "object" || !Array.isArray(population.records)) {
    sink.push(`${label}: ${source.artifact} is missing or has no records array`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }

  // Period must be source-derived, never the build clock.
  const reference = population.source_period?.reference_date;
  let sourcePeriod = null;
  if (!ISO_DATE.test(String(reference))) {
    sink.push(`${label}: source_period.reference_date is not an ISO date (${reference})`);
  } else {
    sourcePeriod = {
      from: reference,
      to: reference,
      type: population.source_period?.type ?? "administrative_register_reference_date",
      provisional: population.source_period?.provisional === true,
    };
    const metaReference = meta?.source_period?.reference_date;
    if (metaReference && metaReference !== reference) {
      sink.push(
        `${label}: data reference date ${reference} disagrees with metadata reference date ${metaReference}`
      );
    }
  }

  const levelField = source.level_field ?? "geography_level";
  const idField = source.id_field ?? "official_id";
  const parentField = source.hierarchy_field ?? "parent_id";
  const valueField = source.value_field ?? "residents";

  const byLevel = { municipality: [], district: [], barrio: [] };
  const seen = new Set();
  for (const r of population.records) {
    const level = r?.[levelField];
    if (!byLevel[level]) {
      sink.push(`${label}: record has unknown geography_level "${level}"`);
      continue;
    }
    const key = `${level}:${r[idField]}`;
    if (seen.has(key)) sink.push(`${label}: duplicate ${level} ${idField} "${r[idField]}" for the period`);
    seen.add(key);
    const value = r[valueField];
    if (!Number.isInteger(value) || value < 0) {
      sink.push(`${label}: ${level} ${r[idField]} has an invalid ${valueField} (${value}); must be a non-negative integer`);
    }
    byLevel[level].push(r);
  }

  // Counts against the expected join universe.
  const expected = source.expected_counts ?? {};
  for (const [name, actual, want] of [
    ["municipality", byLevel.municipality.length, expected.municipality],
    ["districts", byLevel.district.length, expected.districts],
    ["barrios", byLevel.barrio.length, expected.barrios],
  ]) {
    if (typeof want === "number" && actual !== want) {
      sink.push(`${label}: expected ${want} ${name} population record(s), found ${actual}`);
    }
  }

  // Canonical join: cross-check against the committed geography.
  const canonicalBarrios = new Map();
  if (geography && Array.isArray(geography.features)) {
    for (const f of geography.features) {
      if (f.properties?.geography_level === "barrio") {
        canonicalBarrios.set(f.properties.official_id, f.properties.parent_id);
      }
    }
    const popBarrioIds = new Set(byLevel.barrio.map((b) => b[idField]));
    for (const b of byLevel.barrio) {
      const id = b[idField];
      if (!canonicalBarrios.has(id)) {
        sink.push(`${label}: barrio ${id} is not a canonical barrio`);
      } else if (canonicalBarrios.get(id) !== b[parentField]) {
        sink.push(
          `${label}: barrio ${id} declares parent ${b[parentField]} but canonical geography says ${canonicalBarrios.get(id)}`
        );
      }
    }
    for (const id of canonicalBarrios.keys()) {
      if (!popBarrioIds.has(id)) sink.push(`${label}: canonical barrio ${id} has no population value`);
    }
  } else {
    warnings.push(`${label}: canonical geography artifact unavailable, so the barrio join could not be cross-checked`);
  }

  // Aggregation: district totals equal their barrio sums; municipality equals the
  // 131-barrio sum. These are exact integer checks, never toleranced.
  const barrioSumByDistrict = new Map();
  let municipalityFromBarrios = 0;
  for (const b of byLevel.barrio) {
    const p = b[parentField];
    barrioSumByDistrict.set(p, (barrioSumByDistrict.get(p) ?? 0) + (b[valueField] ?? 0));
    municipalityFromBarrios += b[valueField] ?? 0;
  }
  for (const d of byLevel.district) {
    const expectedTotal = barrioSumByDistrict.get(d[idField]) ?? 0;
    if (d[valueField] !== expectedTotal) {
      sink.push(
        `${label}: district ${d[idField]} total ${d[valueField]} does not equal the sum of its barrios ${expectedTotal}`
      );
    }
  }
  const muni = byLevel.municipality[0];
  if (muni && muni[valueField] !== municipalityFromBarrios) {
    sink.push(
      `${label}: municipality total ${muni[valueField]} does not equal the sum of the barrios ${municipalityFromBarrios}`
    );
  }

  // Provenance flags: barrios source-reported, aggregates derived.
  for (const b of byLevel.barrio) {
    if (b.residents_provenance !== source.source_reported_value) {
      sink.push(`${label}: barrio ${b[idField]} must be flagged ${source.source_reported_value}`);
    }
  }
  for (const agg of [...byLevel.district, ...byLevel.municipality]) {
    if (agg.residents_provenance !== source.derived_provenance_value) {
      sink.push(`${label}: ${agg[levelField]} ${agg[idField]} total must be flagged ${source.derived_provenance_value}`);
    }
  }

  const barrioVersion = meta?.geography_linkage?.barrio_geography_version;
  return {
    record_count: population.records.length,
    state: "available",
    source_period: sourcePeriod,
    warnings: [
      `${byLevel.barrio.length} barrios, ${byLevel.district.length} districts; municipality ${muni?.[valueField] ?? "?"} residents`,
      `period ${reference ?? "?"} joined to barrio geography ${barrioVersion ?? "unknown"}`,
    ],
  };
}

// The licensed-VUT sidecar's minimum provenance contract.
//
// The sidecar is not optional documentation. The user-facing disclosure reads
// it to say what this figure counts, which authority published it, what a
// "unit" is, and what the number does NOT mean. A deployment that shipped the
// indicator without it would publish a figure the product cannot qualify, so a
// missing, malformed or incomplete sidecar blocks deployment exactly as a
// broken artifact does. This is the blocking sink, not a warning.
//
// Deliberately a SMALL contract: the PRESENCE and usability of the fields the
// disclosure consumes, plus the two period flags that keep this source from
// ever acquiring a reference date. No prose sentence is pattern-matched — that
// would make editorial wording a deployment gate without making the number one
// bit more trustworthy.
const LICENCE_META_FIELDS = [
  ["source.dataset", (m) => m.source?.dataset, "names the dataset the figure is read from"],
  ["source.authority", (m) => m.source?.authority, "names the authority that publishes it"],
  ["unit_of_analysis.vut_units", (m) => m.unit_of_analysis?.vut_units, "defines what one unit is"],
  [
    "universe.currency_caveat",
    (m) => m.universe?.currency_caveat,
    "records that the extract cannot establish current operation",
  ],
  ["interpretation_ceiling", (m) => m.interpretation_ceiling, "states what the figure is not"],
];

function validateLicenceMeta(source, meta, geographyMeta, sink) {
  const label = source.display_name;
  const file = source.meta_artifact;

  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    sink.push(
      `${label}: ${file} is missing or is not an object. This indicator is user-facing, so the ` +
        `provenance that explains what it counts - and what it does not mean - is required to publish it.`
    );
    return null;
  }

  for (const [path, read, why] of LICENCE_META_FIELDS) {
    if (!isNonEmptyString(read(meta))) {
      sink.push(`${label}: ${file} has no usable ${path}, which ${why}`);
    }
  }

  // The period flags are the load-bearing pair. This source declares neither a
  // reference nor an effective date; a sidecar that claimed either would licence
  // the interface to print one, which is the exact failure this project has
  // guarded against since Gate B.
  for (const flag of ["reference_date_published_by_source", "effective_date_published_by_source"]) {
    if (meta.source_period?.[flag] !== false) {
      sink.push(
        `${label}: ${file} must record source_period.${flag} as false; this source declares no such ` +
          `date and the project must not invent one`
      );
    }
  }

  // Geography linkage: which canonical barrio geography these counts were
  // resolved against. Without it an audit cannot state what the join was; with a
  // version that disagrees with the geography actually shipped, the counts may
  // be attached to boundaries that have since moved.
  const declared = meta.geography_linkage?.barrio_geography_version;
  if (!isNonEmptyString(declared)) {
    sink.push(
      `${label}: ${file} has no usable geography_linkage.barrio_geography_version, so the barrio ` +
        `geography these counts were resolved against cannot be established`
    );
    return null;
  }
  const canonical = geographyMeta?.source_version?.datasets?.barrio?.published_version;
  if (isNonEmptyString(canonical) && canonical !== declared) {
    sink.push(
      `${label}: resolved against barrio geography ${declared}, but the committed geography ships ` +
        `${canonical}. Re-run the builder against the current geography rather than publishing counts ` +
        `joined to a different administrative division.`
    );
  }
  return declared;
}

// Committed licensed tourist-dwelling (VUT) numerator: granted activity licences
// and the dwelling units they contain, per canonical barrio, with derived
// district and municipality totals. BLOCKING since the Area Profile began
// showing licensed VUT context: the interface now displays these counts and a
// descriptive per-1,000-registered-residents ratio derived from them.
//
// The failure mode this gate exists for is NOT an empty panel. It is a
// PLAUSIBLE-LOOKING WRONG NUMBER: a partial regeneration that drops barrios, an
// aggregate that no longer equals its parts, a licence count that has overtaken
// the unit count, or an artifact whose records were silently zeroed. The browser
// abstains when a runtime fetch fails, which is a different concern; a committed
// artifact that is already broken must not be published at all.
//
// It also refuses to let this source acquire a source period. The publisher
// declares no reference or effective date, so source_period stays null and the
// file's HTTP Last-Modified state is reported as file state in the audit lines,
// never promoted into a date the manifest could be read as endorsing.
function validateLicenceCounts(source, artifact, meta, geography, geographyMeta, errors, warnings) {
  const label = source.display_name;
  const sink = source.blocks_deployment ? errors : warnings;

  if (!artifact || typeof artifact !== "object" || !Array.isArray(artifact.records)) {
    sink.push(`${label}: ${source.artifact} is missing or has no records array`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }

  const levelField = source.level_field ?? "geography_level";
  const idField = source.id_field ?? "official_id";
  const parentField = source.hierarchy_field ?? "parent_id";
  const licenceField = source.count_fields?.licences ?? "vut_licences";
  const unitField = source.count_fields?.units ?? "vut_units";
  const provenance = source.provenance_values ?? {};

  // Field creep is a semantic risk here, not a tidiness one: a population, a
  // ratio or a rate appearing on a licence record is exactly the conflation the
  // whole feature is built to avoid.
  const allowedKeys = new Set([levelField, idField, parentField, licenceField, unitField, "value_provenance"]);

  const byLevel = { municipality: [], district: [], barrio: [] };
  const seen = new Set();
  for (const r of artifact.records) {
    const level = r?.[levelField];
    if (!byLevel[level]) {
      sink.push(`${label}: record has unknown geography_level "${level}"`);
      continue;
    }
    const key = `${level}:${r[idField]}`;
    if (seen.has(key)) sink.push(`${label}: duplicate ${level} ${idField} "${r[idField]}"`);
    seen.add(key);

    for (const field of [licenceField, unitField]) {
      const value = r[field];
      if (!Number.isInteger(value) || value < 0) {
        sink.push(
          `${label}: ${level} ${r[idField]} has an invalid ${field} (${value}); must be a non-negative integer`
        );
      }
    }
    // One licence can contain many dwelling units, so units are never fewer
    // than licences. The reverse would mean the two columns had been swapped or
    // one of them mis-summed, which would silently rename the indicator.
    if (
      Number.isInteger(r[licenceField]) &&
      Number.isInteger(r[unitField]) &&
      r[unitField] < r[licenceField]
    ) {
      sink.push(
        `${label}: ${level} ${r[idField]} reports ${r[unitField]} unit(s) for ${r[licenceField]} licence(s); ` +
          `a licence contains one or more units, so units can never be fewer than licences`
      );
    }

    const expectedProvenance = level === "barrio" ? provenance.barrio : provenance.aggregate;
    if (expectedProvenance && r.value_provenance !== expectedProvenance) {
      sink.push(`${label}: ${level} ${r[idField]} must be flagged ${expectedProvenance}`);
    }

    const unexpected = Object.keys(r).filter((k) => !allowedKeys.has(k));
    if (unexpected.length) {
      sink.push(`${label}: ${level} ${r[idField]} carries unexpected field(s): ${unexpected.join(", ")}`);
    }

    byLevel[level].push(r);
  }

  // Counts against the expected join universe.
  const expected = source.expected_counts ?? {};
  for (const [name, actual, want] of [
    ["municipality", byLevel.municipality.length, expected.municipality],
    ["districts", byLevel.district.length, expected.districts],
    ["barrios", byLevel.barrio.length, expected.barrios],
  ]) {
    if (typeof want === "number" && actual !== want) {
      sink.push(`${label}: expected ${want} ${name} licence record(s), found ${actual}`);
    }
  }

  // Canonical join: every barrio in the artifact is a canonical barrio, every
  // canonical barrio has a record, and the hierarchy agrees with the geography.
  // A barrio missing here would show as "unavailable" in a product that is
  // otherwise reporting figures confidently, so it blocks the build.
  if (geography && Array.isArray(geography.features)) {
    const canonical = new Map();
    for (const f of geography.features) {
      if (f.properties?.geography_level === "barrio") {
        canonical.set(f.properties.official_id, f.properties.parent_id);
      }
    }
    const present = new Set(byLevel.barrio.map((b) => b[idField]));
    for (const b of byLevel.barrio) {
      const id = b[idField];
      if (!canonical.has(id)) sink.push(`${label}: barrio ${id} is not a canonical barrio`);
      else if (canonical.get(id) !== b[parentField]) {
        sink.push(
          `${label}: barrio ${id} declares parent ${b[parentField]} but canonical geography says ${canonical.get(id)}`
        );
      }
    }
    for (const id of canonical.keys()) {
      if (!present.has(id)) sink.push(`${label}: canonical barrio ${id} has no licensed-VUT record`);
    }
  } else {
    warnings.push(`${label}: canonical geography artifact unavailable, so the barrio join could not be cross-checked`);
  }

  // Aggregation: exact integer sums for BOTH counts, never toleranced. The
  // district and municipality rows are declared derived, so they must be.
  const totals = {};
  for (const field of [licenceField, unitField]) {
    const byDistrict = new Map();
    let municipalitySum = 0;
    for (const b of byLevel.barrio) {
      const parent = b[parentField];
      byDistrict.set(parent, (byDistrict.get(parent) ?? 0) + (b[field] ?? 0));
      municipalitySum += b[field] ?? 0;
    }
    for (const d of byLevel.district) {
      const want = byDistrict.get(d[idField]) ?? 0;
      if (d[field] !== want) {
        sink.push(
          `${label}: district ${d[idField]} ${field} total ${d[field]} does not equal the sum of its barrios ${want}`
        );
      }
    }
    const muni = byLevel.municipality[0];
    if (muni && muni[field] !== municipalitySum) {
      sink.push(
        `${label}: municipality ${field} total ${muni[field]} does not equal the sum of the barrios ${municipalitySum}`
      );
    }
    totals[field] = municipalitySum;
  }

  // The artifact's own headline counts must agree with its records, and with the
  // totals pinned in the registry for THIS committed snapshot. The pin is what
  // makes a partial or accidental regeneration a visible diff; a deliberate
  // refresh updates both in one reviewed change.
  const counts = artifact.counts ?? {};
  if (counts.licences !== totals[licenceField]) {
    sink.push(
      `${label}: declared ${counts.licences} licence(s) but the records sum to ${totals[licenceField]}`
    );
  }
  if (counts.vut_units !== totals[unitField]) {
    sink.push(`${label}: declared ${counts.vut_units} unit(s) but the records sum to ${totals[unitField]}`);
  }
  const pinned = source.expected_source_totals ?? {};
  if (typeof pinned.licences === "number" && totals[licenceField] !== pinned.licences) {
    sink.push(
      `${label}: this committed snapshot holds ${totals[licenceField]} licence(s) but the registry pins ` +
        `${pinned.licences}. Refreshing the source is a deliberate change: re-run the builder and update ` +
        `expected_source_totals in the same reviewed pull request.`
    );
  }
  if (typeof pinned.units === "number" && totals[unitField] !== pinned.units) {
    sink.push(
      `${label}: this committed snapshot holds ${totals[unitField]} unit(s) but the registry pins ` +
        `${pinned.units}. Refreshing the source is a deliberate change: re-run the builder and update ` +
        `expected_source_totals in the same reviewed pull request.`
    );
  }

  // Provenance and source state. The HTTP header is required to be PRESENT and
  // required to be LABELLED as not a reference date: the disclaimer travelling
  // with the data is what stops a future consumer treating it as one.
  const state = artifact.source_state ?? {};
  const fileState = state.xlsx_http_last_modified;
  if (!isNonEmptyString(fileState)) {
    sink.push(`${label}: source_state.xlsx_http_last_modified is missing, so the source file state is unknown`);
  }
  if (!isNonEmptyString(state.http_last_modified_is_not_a_reference_date)) {
    sink.push(
      `${label}: the artifact must carry source_state.http_last_modified_is_not_a_reference_date, ` +
        `because an HTTP header must never be published as a publisher-declared reference date`
    );
  }
  const span = state.grant_date_span ?? {};
  const earliest = span.earliest_grant_date;
  const latest = span.latest_grant_date;
  if (!ISO_DATE.test(String(earliest)) || !ISO_DATE.test(String(latest))) {
    sink.push(`${label}: the licence grant-date span is not a pair of ISO dates (${earliest} to ${latest})`);
  } else if (earliest > latest) {
    sink.push(`${label}: the licence grant-date span is incoherent (${earliest} is after ${latest})`);
  }

  // BLOCKING, not a warning: see validateLicenceMeta above.
  const barrioGeographyVersion = validateLicenceMeta(source, meta, geographyMeta, sink);
  return {
    record_count: artifact.records.length,
    // NULL, deliberately: the publisher declares no reference or effective date,
    // so this layer has no period. The file state below is an audit line, not a
    // period, and the manifest's source_period_known stays false.
    source_period: null,
    state: "available",
    warnings: [
      `${byLevel.barrio.length} barrios, ${byLevel.district.length} districts; ` +
        `${totals[unitField]} licensed VUT units in ${totals[licenceField]} granted activity licences`,
      `source file state (HTTP Last-Modified, not a reference date): ${fileState ?? "unknown"}`,
      `licence grant dates span ${earliest ?? "?"} to ${latest ?? "?"}`,
      `joined to barrio geography ${barrioGeographyVersion ?? "unknown"}; ` +
        `the residential denominator keeps its own separate reference date`,
    ],
  };
}

// ================= PLANNING ÁMBITO EVIDENCE (K6, #68) ========================

// Canonical serialisation, byte-identical to the builders': sorted keys, compact
// separators, UTF-8. It is what makes the committed fingerprint a real integrity
// check rather than a recorded string — the validator RECOMPUTES it here and
// fails on a mismatch, so an artifact edited by hand, truncated by a bad merge or
// regenerated without its sidecar cannot reach a deployment.
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function countVertices(geometry) {
  let total = 0;
  const stack = [geometry.coordinates];
  while (stack.length) {
    const item = stack.pop();
    if (item.length && typeof item[0] === "number") total += 1;
    else for (const child of item) stack.push(child);
  }
  return total;
}

// Official planning-ámbito geometry. BLOCKING because the interface names the
// containing ámbito, with its exact official code, as a place.
//
// The failure mode this gate exists for is A CONFIDENT WRONG PLACE — or a
// plausible-looking "no ámbito here". Six specific ways that could happen:
//
//   1. A COLLAPSED or truncated geometry, which would report every coordinate as
//      outside every ámbito.
//   2. A PROJECTION LEAK: coordinates still in EPSG:25830, or lat/lon swapped,
//      which would silently move every boundary.
//   3. The MIXED UNIVERSE leaking in: a Norma Zonal grade or a non-developable
//      land class rendered as a planning ámbito.
//   4. An UNCLASSIFIED source record silently admitted to the production universe.
//   5. The geometry substituted from a route whose reuse basis was never
//      established — the Gate L MODIFY finding this gate must not let through.
//   6. A back-filled reference date, giving undated geometry a false vintage.
function validatePlanningGeometry(source, geojson, meta, scopes, errors, warnings) {
  const label = source.display_name;
  const sink = source.blocks_deployment ? errors : warnings;

  if (!geojson || typeof geojson !== "object" || !Array.isArray(geojson.features)) {
    sink.push(`${label}: ${source.artifact} is missing or is not a GeoJSON FeatureCollection`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  if (geojson.features.length === 0) {
    sink.push(`${label}: ${source.artifact} carries no features`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  const guardrail = source.integrity_guardrail ?? {};
  if (typeof guardrail.min_count === "number" && geojson.features.length < guardrail.min_count) {
    sink.push(
      `${label}: ${geojson.features.length} ámbito feature(s), below the ingestion guardrail ` +
        `of ${guardrail.min_count}. This is a collapse, not a change in the official universe.`
    );
  }

  const box = scopes[source.expected_spatial_scope];
  const seen = new Set();
  let badGeometry = 0;
  let emptyCode = 0;
  let emptyDenomination = 0;
  let outOfScope = 0;
  let collapsedRings = 0;
  let wrongClass = 0;
  let vertices = 0;
  for (const feature of geojson.features) {
    const properties = feature?.properties ?? {};
    const code = properties.ambito_code;
    if (!isNonEmptyString(code)) {
      emptyCode += 1;
    } else if (seen.has(code)) {
      sink.push(`${label}: duplicate ámbito_code "${code}" — the production universe keys on the exact official code`);
    } else {
      seen.add(code);
    }
    if (!isNonEmptyString(properties.ambito_denomination)) emptyDenomination += 1;
    // The mixed universe must not leak in: only the ámbito-like class ships.
    if (properties.source_record_class !== "PLANNING_AMBITO") wrongClass += 1;

    const geometry = feature?.geometry;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") || !Array.isArray(geometry.coordinates)) {
      badGeometry += 1;
      continue;
    }
    const featureVertices = countVertices(geometry);
    vertices += featureVertices;
    // A ring with fewer than four positions is not a closed polygon: it cannot
    // contain a point, so a containment answer built from it is meaningless.
    if (featureVertices < 4) collapsedRings += 1;
    if (box) {
      for (const [lon, lat] of iterCoords(geometry)) {
        if (!isFiniteNumber(lon) || !isFiniteNumber(lat) || !inScope({ lat, lon }, box)) {
          outOfScope += 1;
          break;
        }
      }
    }
  }
  if (emptyCode) sink.push(`${label}: ${emptyCode} feature(s) carry no ambito_code, so they cannot join an edition`);
  if (emptyDenomination) sink.push(`${label}: ${emptyDenomination} feature(s) carry no ambito_denomination`);
  if (wrongClass) {
    sink.push(
      `${label}: ${wrongClass} feature(s) are not classified PLANNING_AMBITO. The official layer is ` +
        `a mixed universe and only the ámbito-like class may ship as a planning ámbito.`
    );
  }
  if (badGeometry) sink.push(`${label}: ${badGeometry} feature(s) have missing or non-polygon geometry`);
  if (collapsedRings) {
    sink.push(
      `${label}: ${collapsedRings} feature(s) have fewer than four positions, so their geometry has ` +
        `collapsed and cannot answer containment`
    );
  }
  if (outOfScope) {
    sink.push(
      `${label}: ${outOfScope} feature(s) have coordinates outside ${source.expected_spatial_scope}, ` +
        `which would indicate a projection leak (EPSG:25830 not reprojected) or swapped lat/lon`
    );
  }

  // ---- the metadata sidecar is part of the feature, not an optional extra ----
  if (!meta || typeof meta !== "object") {
    sink.push(`${label}: ${source.meta_artifact} is missing, so the geometry's provenance cannot be stated`);
    return { record_count: geojson.features.length, state: "available", source_period: null, warnings: [] };
  }
  for (const [field, read, why] of PLANNING_GEOMETRY_META_FIELDS) {
    if (!read(meta)) sink.push(`${label}: ${source.meta_artifact} has no ${field}, which ${why}`);
  }
  // The fingerprint is RECOMPUTED, not trusted.
  const recomputed = sha256Hex(canonicalJson(geojson));
  if (meta.fingerprint?.value && meta.fingerprint.value !== recomputed) {
    sink.push(
      `${label}: the committed fingerprint ${String(meta.fingerprint.value).slice(0, 16)} does not match the ` +
        `artifact's recomputed ${recomputed.slice(0, 16)}. The artifact and its provenance record disagree.`
    );
  }
  // Route equivalence is the issue's STOP condition. An artifact whose builder
  // could not establish it must never reach a deployment.
  if (meta.route_equivalence?.equivalent !== true) {
    sink.push(
      `${label}: route equivalence is "${meta.route_equivalence?.verdict ?? "absent"}". The catalogued ` +
        `reuse route and the audited geometry were not proven to be the same authoritative geometry, ` +
        `so the reuse basis for the committed geometry is unresolved.`
    );
  }
  if (meta.crs?.source !== "EPSG:25830" || meta.crs?.target !== "EPSG:4326") {
    sink.push(`${label}: the recorded CRS transformation is not EPSG:25830 -> EPSG:4326`);
  }
  if (meta.crs?.verification?.within_tolerance !== true) {
    sink.push(
      `${label}: the EPSG:25830 -> EPSG:4326 transformation was not verified against the publisher's own ` +
        `server-side reprojection, so the committed coordinates are unchecked`
    );
  }
  if (meta.crs?.simplification !== "NONE") {
    sink.push(`${label}: the geometry records simplification "${meta.crs?.simplification}"; K6 ships unsimplified geometry`);
  }
  const unclassified = meta.universe?.excluded_by_class?.UNCLASSIFIED_SOURCE_RECORD?.count;
  if (unclassified !== 0) {
    sink.push(
      `${label}: ${unclassified} unclassified source record(s) were recorded. A record the builder could ` +
        `not classify is never silently admitted to or discarded from the production universe.`
    );
  }
  const included = meta.universe?.included_feature_count;
  if (included !== geojson.features.length) {
    sink.push(
      `${label}: the sidecar records ${included} included feature(s) but the artifact carries ` +
        `${geojson.features.length}`
    );
  }
  // The publisher declares no date for this geometry. A non-null reference date
  // here would mean a catalogue or header date had been promoted into one.
  if (meta.freshness?.reference_date !== null) {
    sink.push(
      `${label}: the sidecar records a reference_date for geometry the publisher dates nowhere. ` +
        `The null is known absence and is never back-filled.`
    );
  }
  if (source.reference_date !== null || source.published_at !== null) {
    sink.push(`${label}: the registry must carry explicit nulls for this undated geometry`);
  }
  if (source.scope !== "PLANNING_AMBITO") {
    sink.push(`${label}: registry scope is "${source.scope}", but each feature is one whole planning ámbito`);
  }

  const excluded = meta.universe?.excluded_by_class ?? {};
  return {
    record_count: geojson.features.length,
    state: "available",
    // No period: the publisher declares none, and the catalogue record's own
    // creation date is a metadata date, never the geometry's vintage.
    source_period: null,
    warnings: [
      `${geojson.features.length} planning ámbitos, ${vertices} vertices`,
      `excluded: ${Object.entries(excluded).map(([name, record]) => `${record.count} ${name}`).join(", ")}`,
      `reuse: ${meta.reuse?.basis ?? "unrecorded"}`,
    ],
  };
}

const PLANNING_GEOMETRY_META_FIELDS = [
  ["source.catalogue_record_url", (m) => m.source?.catalogue_record_url, "names the catalogue record that states the reuse conditions"],
  ["source.authority", (m) => m.source?.authority, "names the authority that publishes the geometry"],
  ["retrieval.request_url", (m) => m.retrieval?.request_url, "records the exact retrieval route"],
  ["retrieval.retrieved_at", (m) => m.retrieval?.retrieved_at, "separates when the geometry was fetched from any date the publisher states"],
  ["retrieval.response_sha256", (m) => m.retrieval?.response_sha256, "identifies the exact bytes the artifact was built from"],
  ["reuse.conditions_url", (m) => m.reuse?.conditions_url, "is the reuse basis itself, not an assumption from public reachability"],
  ["reuse.attribution", (m) => m.reuse?.attribution, "is an obligation of those reuse conditions"],
  ["freshness.source_state", (m) => m.freshness?.source_state, "records that the publisher declares no status"],
  ["crs.transformation", (m) => m.crs?.transformation, "states the transformation explicitly rather than leaving a CRS to be guessed"],
  ["universe.classification_rule", (m) => m.universe?.classification_rule, "states how the mixed universe was filtered"],
  ["fingerprint.value", (m) => m.fingerprint?.value, "is what makes a hand-edited or truncated artifact a visible failure"],
  ["interpretation_ceiling", (m) => m.interpretation_ceiling, "states what the geometry is not"],
];

// Published ámbito development state and available buildability. BLOCKING
// because these are official figures published to the reader.
//
// The failure modes this gate exists for:
//
//   1. A SCALAR STAGE appearing — any key or field that collapses the four
//      independent published phase fields into one progression.
//   2. A DWELLING COUNT appearing — the source's Nº Viviendas proxy published as
//      a count of homes.
//   3. A BARE NUMBER — a buildability figure without its unit.
//   4. MISSING BECOMING ZERO — a blank published cell turned into a 0.
//   5. A CROSS-ERA edition parsed as if it were comparable four-phase evidence.
//   6. AN AGGREGATE TOTAL ROW entering a per-ámbito artifact, publishing a city
//      total as one place's figure.
//   7. A JOIN COLLAPSE, leaving the published states attached to the wrong places
//      or to nothing.
function validatePlanningChangeDetection(source, artifact, meta, errors) {
  const label = source.display_name;
  const k7 = artifact?.change_detection;
  const registryPair = source.change_detection;
  const metaPair = meta?.change_detection;
  const fail = (message) => errors.push(`${label}: K7 ${message}`);
  if (!k7 || !registryPair || !metaPair) {
    fail("is missing its artifact, registry provenance or metadata pair record");
    return { state: "unavailable", counts: null, divergences: null };
  }
  if (k7.pair_id !== "2025-07__2026-01" || registryPair.pair_id !== k7.pair_id || metaPair.pair_id !== k7.pair_id) {
    fail("comparison pair drifted from the pinned 2025-07__2026-01 editions");
  }
  if (k7.comparability_verdict !== "COMPARABLE_WITHIN_SCHEMA_ERA" || registryPair.comparability_verdict !== k7.comparability_verdict || metaPair.comparability_verdict !== k7.comparability_verdict) {
    fail("does not declare one comparable same-era pair");
  }
  const absenceReasonReference = k7.absence_reason_reference;
  if (!absenceReasonReference || absenceReasonReference.resource_id !== "203200-14-desarrollo-ambitos" ||
      !absenceReasonReference.resource_url ||
      canonicalJson(registryPair.absence_reason_reference) !== canonicalJson(absenceReasonReference) ||
      canonicalJson(metaPair.absence_reason_reference) !== canonicalJson(absenceReasonReference)) {
    fail("official absence-reason annex provenance is missing or inconsistent");
  }
  if (!k7.absence_reason_policy || registryPair.absence_reason_policy !== k7.absence_reason_policy || metaPair.absence_reason_policy !== k7.absence_reason_policy) {
    fail("absence-reason policy is missing or inconsistent");
  }
  const sides = [
    ["previous", "2025-07-01"],
    ["current", "2026-01-01"],
  ];
  const families = [
    ["S1", "S1_FOUR_PHASE_FLAT"],
    ["S2", "S2_SPLIT_RESIDENTIAL_FLAT"],
  ];
  const editionPairs = {};
  for (const [side, expectedDate] of sides) {
    const sideRecord = k7[side];
    if (!sideRecord || sideRecord.reference_date !== expectedDate || !sideRecord.families) {
      fail(`${side} edition is missing or has an unexpected source-stated reference date`);
      continue;
    }
    for (const [family, expectedEra] of families) {
      const edition = sideRecord.families[family];
      if (!edition) {
        fail(`${side} ${family} edition is missing`);
        continue;
      }
      if (edition.reference_date !== expectedDate) fail(`${side} ${family} reference date is missing or inconsistent`);
      if (!/^[a-f\d]{64}$/i.test(String(edition.sha256 || ""))) fail(`${side} ${family} full fingerprint is missing`);
      if (!edition.resource_id || !edition.resource_url || !edition.retrieved_at) fail(`${side} ${family} resource or retrieval provenance is missing`);
      if (!edition.schema_fingerprint || edition.schema_era !== expectedEra) fail(`${side} ${family} schema era or fingerprint is invalid`);
      if (!edition.snapshot_identity || !edition.records || typeof edition.records !== "object") fail(`${side} ${family} identity or records are missing`);
      const registryEdition = registryPair.editions?.[side]?.[family];
      const metadataEdition = metaPair.editions?.[side]?.[family];
      for (const candidate of [registryEdition, metadataEdition]) {
        if (!candidate) {
          fail(`${side} ${family} provenance record is missing from registry or metadata`);
          continue;
        }
        for (const key of ["reference_date", "resource_id", "sha256", "schema_era", "schema_fingerprint", "resource_url", "retrieved_at"]) {
          if (candidate[key] !== edition[key]) fail(`${side} ${family} ${key} drifts across its provenance records`);
        }
      }
    }
  }
  if (k7.previous?.reference_date === k7.current?.reference_date) fail("supplies the same reference date twice");
  if (registryPair.oldest_contributor_reference_date !== k7.previous?.reference_date) fail("K2 oldest-contributor date does not match the earlier K7 edition");
  for (const [family] of families) {
    const previous = k7.previous?.families?.[family];
    const current = k7.current?.families?.[family];
    if (!previous || !current) continue;
    if (previous.snapshot_identity === current.snapshot_identity || previous.sha256 === current.sha256) fail(`${family} supplies the same edition twice`);
    if (previous.schema_era !== current.schema_era) fail(`${family} presents a cross-era pair as comparable`);
    for (const [side, edition] of [["previous", previous], ["current", current]]) {
      if (family === "S1") {
        for (const [code, record] of Object.entries(edition.records || {})) {
          for (const [key, phase] of Object.entries(record.phases || {})) {
            if (!Object.prototype.hasOwnProperty.call(record.source_verbatim?.phase_values || {}, key) ||
                record.source_verbatim.phase_values[key] !== phase.source_value) {
              fail(`${side} S1 ${code} lost its verbatim ${key} value`);
            }
          }
        }
      } else {
        let rowCount = 0;
        for (const [code, rows] of Object.entries(edition.records || {})) {
          if (!Array.isArray(rows)) {
            fail(`${side} S2 ${code} rows were collapsed into a scalar record`);
            continue;
          }
          rowCount += rows.length;
          for (const row of rows) {
            for (const field of ["situacion", "observaciones"]) {
              if (!Object.prototype.hasOwnProperty.call(row.source_verbatim || {}, field) || row.source_verbatim[field] !== row[field]) {
                fail(`${side} S2 ${code} lost its verbatim ${field} value`);
              }
            }
          }
        }
        if (rowCount !== edition.published_row_count) fail(`${side} S2 published row multiplicity does not match the retained rows`);
      }
    }
    editionPairs[family] = { previous, current };
  }
  if (editionPairs.S1 && editionPairs.S2) {
    const s1Current = artifact.editions?.development_state;
    const s2Current = artifact.editions?.available_buildability;
    for (const [labelName, comparisonEdition, k6Edition] of [
      ["S1", editionPairs.S1.current, s1Current],
      ["S2", editionPairs.S2.current, s2Current],
    ]) {
      if (!k6Edition || comparisonEdition.snapshot_identity !== k6Edition.snapshot_identity || comparisonEdition.sha256 !== k6Edition.sha256) {
        fail(`${labelName} K7 current edition does not match the pinned K6 current edition`);
      }
    }
  }

  // The explicit S1 legacy/production benchmark remains exact. The old S2 first
  // row result is checked separately from the production all-rows classifier.
  const recomputed = {};
  for (const [family, editions] of Object.entries(editionPairs)) {
    const legacy = auditLegacyGateLPair(editions.previous, editions.current);
    const production = auditEditionPair(editions.previous, editions.current);
    const reconciliation = reconcileEditionPair(editions.previous, editions.current);
    if (legacy.comparabilityVerdict !== "COMPARABLE_WITHIN_SCHEMA_ERA" || production.comparabilityVerdict !== "COMPARABLE_WITHIN_SCHEMA_ERA") {
      fail(`${family} classifier did not return an explicit comparable pair`);
    }
    for (const record of [...legacy.records, ...production.records]) {
      if (!CHANGE_OUTCOMES.includes(record.outcome)) fail(`${family} classifier returned a null or unauthorized outcome for ${record.exactCode}`);
      if (record.outcome === "ABSENT_FROM_EDITION" &&
          !["SOURCE_DOCUMENTED", "CAUSE_UNRESOLVED"].includes(record.evidence?.causeStatus)) {
        fail(`${family} absent code ${record.exactCode} has no explicit source-reason or unresolved-cause state`);
      }
    }
    const stored = k7.audits?.families?.[family];
    if (!stored) {
      fail(`${family} derived audit and reconciliation report are missing`);
    } else {
      if (canonicalJson(stored.legacy_gate_l_audit?.counts) !== canonicalJson(legacy.counts)) fail(`${family} legacy audit counts do not reproduce from edition rows`);
      if (stored.legacy_gate_l_audit?.cosmetic_only_count !== legacy.cosmeticOnlyCount) fail(`${family} legacy cosmetic-only count does not reproduce from verbatim source strings`);
      if (canonicalJson(stored.production_row_preserving?.counts) !== canonicalJson(production.counts)) fail(`${family} row-preserving classifier counts do not reproduce from edition rows`);
      if (stored.production_row_preserving?.cosmetic_only_count !== production.cosmeticOnlyCount) fail(`${family} row-preserving cosmetic-only count does not reproduce`);
      if (stored.reconciliation?.exact_code_divergence_count !== reconciliation.divergenceCount ||
          canonicalJson(stored.reconciliation?.divergences) !== canonicalJson(reconciliation.divergences)) {
        fail(`${family} exact-code divergence report does not reproduce from the paired rows`);
      }
    }
    recomputed[family] = { legacy, production, reconciliation };
  }
  const s1 = recomputed.S1;
  if (s1) {
    const expected = { NO_CHANGE: 655, STATE_TRANSITION: 10, NEW_AMBITO: 2, ABSENT_FROM_EDITION: 0, MODIFIED_BY_INSTRUMENT: 0, CAUSE_UNRESOLVED: 0, NON_COMPARABLE: 0 };
    if (canonicalJson(s1.production.counts) !== canonicalJson(expected)) fail("S1 exact production benchmark does not match 655 NO_CHANGE, 10 STATE_TRANSITION and 2 NEW_AMBITO");
  }
  const s2 = recomputed.S2;
  if (s2) {
    const expectedLegacy = { NO_CHANGE: 220, STATE_TRANSITION: 9, NEW_AMBITO: 0, ABSENT_FROM_EDITION: 9, MODIFIED_BY_INSTRUMENT: 0, CAUSE_UNRESOLVED: 1, NON_COMPARABLE: 0 };
    if (canonicalJson(s2.legacy.counts) !== canonicalJson(expectedLegacy)) fail("legacy S2 audit no longer reproduces the Gate L baseline");
    if (s2.legacy.cosmeticOnlyCount !== 54) fail(`legacy S2 audit has ${s2.legacy.cosmeticOnlyCount} cosmetic-only observations, expected 54`);
    if (s2.production.comparabilityVerdict !== "COMPARABLE_WITHIN_SCHEMA_ERA") fail("S2 row-preserving production pair is not comparable");
    const explicitDivergences = new Set(s2.reconciliation.divergences.map((record) => record.exactCode));
    for (const code of ["UZPp.02.03-RP", "UZPp.02.04-RP"]) if (!explicitDivergences.has(code)) fail(`the exact-code reconciliation for ${code} is missing`);
    const current = editionPairs.S2?.current;
    if (current) {
      const currentRows = Object.values(current.records).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
      if (currentRows !== 239 || Object.keys(current.records).length !== 230 || current.published_row_count !== currentRows) fail("current S2 row multiplicity collapsed or drifted from 239 rows across 230 exact codes");
      const barajas = Object.entries(current.records).filter(([, rows]) => Array.isArray(rows) && rows.filter((row) => row.district_name === "BARAJAS" && ["20", "21"].includes(row.district_code)).length === 2);
      if (barajas.length !== 7) fail(`the Barajas district-code anomaly has ${barajas.length} duplicated exact codes, expected 7`);
      for (const [code, rows] of barajas) {
        const rowCodes = new Set(rows.map((row) => row.district_code));
        if (!rowCodes.has("20") || !rowCodes.has("21") || rows.some((row) => row.district_name !== "BARAJAS")) fail(`${code} Barajas source rows were corrected or dropped`);
        const result = classifyAmbitoEditionPair(editionPairs.S2.previous, current, code);
        const numeric = compareBuildability(editionPairs.S2.previous, current, code);
        if (result.outcome !== CHANGE_OUTCOME.CAUSE_UNRESOLVED || numeric.state !== BUILDABILITY_STATE.WITHHELD) fail(`${code} Barajas ambiguity was reconciled or given a numeric comparison`);
      }
    }
  }
  // A generated 2024-01 → 2025-01 S1 pair exercises the schema-era guard at
  // deployment validation time, independently of the current pinned pair.
  if (editionPairs.S1) {
    const code = Object.keys(editionPairs.S1.current.records)[0];
    const old = { ...editionPairs.S1.current, reference_date: "2024-01-01", snapshot_identity: "S1:2024-01:oldschema", sha256: "a".repeat(64), schema_era: "S1_SINGLE_STATE_PER_DISTRICT" };
    const newer = { ...editionPairs.S1.current, reference_date: "2025-01-01", snapshot_identity: "S1:2025-01:newschema", sha256: "b".repeat(64) };
    if (classifyAmbitoEditionPair(old, newer, code).outcome !== CHANGE_OUTCOME.NON_COMPARABLE) fail("cross-era 2024-01 → 2025-01 guard did not abstain");
  }
  return {
    state: "available",
    counts: Object.fromEntries(Object.entries(recomputed).map(([family, values]) => [family, values.production.counts])),
    divergences: recomputed.S2?.reconciliation.divergenceCount ?? null,
  };
}

function validatePlanningState(source, artifact, meta, geometry, errors, warnings) {
  const label = source.display_name;
  const sink = source.blocks_deployment ? errors : warnings;

  if (!artifact || typeof artifact !== "object" || !artifact.ambitos || typeof artifact.ambitos !== "object") {
    sink.push(`${label}: ${source.artifact} is missing or carries no ámbitos object`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  const codes = Object.keys(artifact.ambitos);
  if (codes.length === 0) {
    sink.push(`${label}: ${source.artifact} carries no ámbito records`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  if (artifact.scope !== source.scope) {
    sink.push(`${label}: artifact scope "${artifact.scope}" does not match the registry scope "${source.scope}"`);
  }

  // ---- four independent fields, four use classes ----------------------------
  const phaseFields = Array.isArray(artifact.phase_fields) ? artifact.phase_fields : [];
  if (phaseFields.length !== 4) {
    sink.push(`${label}: ${phaseFields.length} phase field(s) declared; the published contract is exactly four`);
  }
  const registryPhases = source.published_fields?.phase_fields ?? [];
  if (JSON.stringify(phaseFields.map((field) => field.source_column)) !== JSON.stringify(registryPhases)) {
    sink.push(`${label}: the artifact's phase source columns differ from the registry's pinned list`);
  }
  const useClasses = Array.isArray(artifact.use_classes) ? artifact.use_classes : [];
  if (JSON.stringify(useClasses.map((entry) => entry.source_column)) !== JSON.stringify(source.published_fields?.use_classes ?? [])) {
    sink.push(`${label}: the artifact's buildability use classes differ from the registry's pinned list`);
  }

  // ---- no scalar stage, no dwelling count, anywhere in the artifact ----------
  const forbiddenKey = /stage|progress|percent|completion|advance|delay|timeline|viviend|dwelling|\bhomes?\b|housing/i;
  const offendingKeys = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKey.test(key)) offendingKeys.add(key);
      walk(child);
    }
  };
  walk(artifact);
  if (offendingKeys.size) {
    sink.push(
      `${label}: forbidden key(s) ${[...offendingKeys].join(", ")} in the published artifact. The four phase ` +
        `fields never collapse into a stage, progression or percentage, and no dwelling count may be published.`
    );
  }
  for (const column of source.published_fields?.excluded_columns ?? []) {
    if (JSON.stringify(artifact).includes(column)) {
      sink.push(`${label}: the excluded dwelling-proxy column "${column}" appears in the published artifact`);
    }
  }

  // ---- editions: current era, stated reference date, one edition each --------
  const editions = artifact.editions ?? {};
  for (const [family, expectedEra] of [
    ["development_state", "S1_FOUR_PHASE_FLAT"],
    ["available_buildability", "S2_SPLIT_RESIDENTIAL_FLAT"],
  ]) {
    const edition = editions[family];
    if (!edition) {
      sink.push(`${label}: no ${family} edition recorded in the artifact`);
      continue;
    }
    if (!ISO_DATE.test(String(edition.reference_date))) {
      sink.push(
        `${label}: the ${family} edition states no ISO reference date. Edition selection reads the date the ` +
          `edition states about itself, and a missing one is never replaced by a resource id or a build clock.`
      );
    }
    if (edition.schema_era !== expectedEra) {
      sink.push(
        `${label}: the ${family} edition is schema era "${edition.schema_era}", not the current comparable ` +
          `era "${expectedEra}". A superseded era is not equivalent four-phase evidence.`
      );
    }
    const pinned = source.editions?.[family];
    if (pinned && pinned.snapshot_identity !== edition.snapshot_identity) {
      sink.push(
        `${label}: the ${family} snapshot identity "${edition.snapshot_identity}" does not match the registry's ` +
          `pinned "${pinned.snapshot_identity}". A silent edition change must not reach a deployment.`
      );
    }
    if (pinned && pinned.sha256 !== edition.sha256) {
      sink.push(`${label}: the ${family} edition fingerprint does not match the registry's pinned value`);
    }
  }
  if (editions.development_state?.reference_date !== source.reference_date) {
    sink.push(
      `${label}: the registry reference_date "${source.reference_date}" does not match the selected edition's ` +
        `stated "${editions.development_state?.reference_date}"`
    );
  }
  const changeDetection = validatePlanningChangeDetection(source, artifact, meta, errors);

  // ---- per-record contract --------------------------------------------------
  let totalRows = 0;
  let publishedState = 0;
  let publishedBuildability = 0;
  let aggregateRows = 0;
  let bareNumbers = 0;
  let missingBecameZero = 0;
  let phaseCountWrong = 0;
  let emptyPhaseValue = 0;
  const phaseKeys = phaseFields.map((field) => field.key);
  const useKeys = useClasses.map((entry) => entry.key);
  for (const [code, record] of Object.entries(artifact.ambitos)) {
    // An aggregate row would publish a city total as one place's figure.
    if (/^total/i.test(code.trim())) aggregateRows += 1;
    if (record.ambito_code !== code) {
      sink.push(`${label}: record keyed "${code}" declares ambito_code "${record.ambito_code}"`);
    }
    const state = record.development_state ?? {};
    if (state.availability === "PUBLISHED") {
      publishedState += 1;
      const phases = state.phases ?? {};
      if (Object.keys(phases).length !== phaseKeys.length) phaseCountWrong += 1;
      for (const key of phaseKeys) {
        const phase = phases[key];
        if (!phase) {
          phaseCountWrong += 1;
          continue;
        }
        // The publisher's string is the authoritative value; a published phase
        // with no source value would be a state the publisher never issued.
        if (phase.state === "PUBLISHED" && !isNonEmptyString(phase.source_value)) emptyPhaseValue += 1;
      }
    }
    const buildability = record.available_buildability ?? {};
    if (buildability.availability === "PUBLISHED") {
      publishedBuildability += 1;
      for (const row of buildability.rows ?? []) {
        totalRows += 1;
        if (/^total/i.test(String(row.denomination ?? "").trim())) aggregateRows += 1;
        for (const key of useKeys) {
          const cell = (row.use_classes ?? {})[key];
          if (!cell) {
            bareNumbers += 1;
            continue;
          }
          // Every value carries its unit, in the same object. There is no shape
          // in this artifact that can hold a number without one.
          if (!isNonEmptyString(cell.unit)) bareNumbers += 1;
          if (cell.state === "PUBLISHED" && !isFiniteNumber(cell.value)) bareNumbers += 1;
          // Missing never becomes zero.
          if (cell.state !== "PUBLISHED" && cell.value !== null) missingBecameZero += 1;
        }
      }
    }
  }
  if (aggregateRows) sink.push(`${label}: ${aggregateRows} aggregate Total row(s) entered the per-ámbito artifact`);
  if (phaseCountWrong) sink.push(`${label}: ${phaseCountWrong} published record(s) do not carry exactly the four phase fields`);
  if (emptyPhaseValue) sink.push(`${label}: ${emptyPhaseValue} phase value(s) are marked PUBLISHED but carry no source value`);
  if (bareNumbers) sink.push(`${label}: ${bareNumbers} buildability cell(s) carry a value without its unit, or no value where one is published`);
  if (missingBecameZero) {
    sink.push(
      `${label}: ${missingBecameZero} unpublished buildability cell(s) carry a value. A blank published cell ` +
        `stays null: missing never becomes zero.`
    );
  }

  const guardrail = source.integrity_guardrail ?? {};
  if (typeof guardrail.min_development_state_rows === "number" && publishedState < guardrail.min_development_state_rows) {
    sink.push(`${label}: ${publishedState} published development-state record(s), below the guardrail of ${guardrail.min_development_state_rows}`);
  }
  if (typeof guardrail.min_buildability_rows === "number" && totalRows < guardrail.min_buildability_rows) {
    sink.push(`${label}: ${totalRows} published buildability row(s), below the guardrail of ${guardrail.min_buildability_rows}`);
  }

  // ---- the sidecar, the fingerprint and the joins ---------------------------
  if (!meta || typeof meta !== "object") {
    sink.push(`${label}: ${source.meta_artifact} is missing, so the editions' provenance cannot be stated`);
    return { record_count: codes.length, state: "available", source_period: source.reference_date ?? null, warnings: [] };
  }
  for (const [field, read, why] of PLANNING_STATE_META_FIELDS) {
    if (!read(meta)) sink.push(`${label}: ${source.meta_artifact} has no ${field}, which ${why}`);
  }
  const recomputed = sha256Hex(canonicalJson(artifact));
  if (meta.fingerprint?.value && meta.fingerprint.value !== recomputed) {
    sink.push(
      `${label}: the committed fingerprint ${String(meta.fingerprint.value).slice(0, 16)} does not match the ` +
        `artifact's recomputed ${recomputed.slice(0, 16)}`
    );
  }
  for (const [family, expected] of [
    ["S1", source.expected_joins?.development_state_matched],
    ["S2", source.expected_joins?.buildability_matched],
  ]) {
    const join = meta.joins?.[family];
    if (!join) {
      sink.push(`${label}: no ${family} join report in ${source.meta_artifact}; a join must be stated, not assumed`);
      continue;
    }
    if (join.matching !== "EXACT" || join.normalisation !== "NONE") {
      sink.push(
        `${label}: the ${family} join is "${join.matching}"/"${join.normalisation}". Codes join exactly and are ` +
          `never normalised: a -RP suffix marks a distinct Revisión Parcial ámbito.`
      );
    }
    if (typeof expected === "number" && join.matched < expected) {
      sink.push(
        `${label}: the ${family} join matched ${join.matched} of ${join.table_codes} published codes, below the ` +
          `registry's expected ${expected}. A join collapse would attach published states to the wrong places.`
      );
    }
    if (!Array.isArray(join.unmatched_in_table)) {
      sink.push(`${label}: the ${family} join does not list its unmatched records; nothing may disappear silently`);
    }
  }
  // The geometry universe is what the state artifact is keyed on, so a disagreement
  // means one of the two artifacts was regenerated without the other.
  const geometryCodes = Array.isArray(geometry?.features)
    ? geometry.features.map((feature) => feature?.properties?.ambito_code)
    : null;
  if (geometryCodes && geometryCodes.length !== codes.length) {
    sink.push(
      `${label}: ${codes.length} ámbito record(s) against ${geometryCodes.length} committed geometry feature(s). ` +
        `The two planning artifacts were not built from the same universe.`
    );
  }
  if (meta.buildability?.dwelling_proxy_exclusion?.published_in_artifact !== false) {
    sink.push(`${label}: the sidecar does not record the Nº Viviendas proxy columns as excluded from the artifact`);
  }

  return {
    record_count: codes.length,
    state: "available",
    source_period: editions.development_state?.reference_date ?? null,
    warnings: [
      `${publishedState} published development states, ${publishedBuildability} published buildability records (${totalRows} rows)`,
      `editions: ${editions.development_state?.snapshot_identity} + ${editions.available_buildability?.snapshot_identity}`,
      `K7 editions: 2025-07 → 2026-01; production S1 ${changeDetection.counts?.S1?.STATE_TRANSITION ?? "unavailable"} state transitions; S2 ${changeDetection.divergences ?? "unavailable"} legacy/production exact-code divergences`,
      `joins: S1 ${meta.joins?.S1?.matched}/${meta.joins?.S1?.table_codes}, S2 ${meta.joins?.S2?.matched}/${meta.joins?.S2?.table_codes}`,
    ],
  };
}

const PLANNING_STATE_META_FIELDS = [
  ["authority", (m) => m.authority, "names the authority that publishes the editions"],
  ["retrieval_route or families", (m) => m.families, "records which official families the figures come from"],
  ["edition_selection.rule", (m) => m.edition_selection?.rule, "states how 'latest' was chosen, which is the central protection against the non-chronological resource ids"],
  ["schema_assertion.mode", (m) => m.schema_assertion?.mode, "records that the parser fails closed on schema drift"],
  ["phase_vocabulary.no_scalar_stage", (m) => m.phase_vocabulary?.no_scalar_stage, "records that no overall stage is derived from the four fields"],
  ["phase_vocabulary.no_necesita.status", (m) => m.phase_vocabulary?.no_necesita?.status, "records that No Necesita has no official definition"],
  ["buildability.unit", (m) => m.buildability?.unit, "states the unit every figure carries"],
  ["buildability.dwelling_proxy_exclusion.reason", (m) => m.buildability?.dwelling_proxy_exclusion?.reason, "records why the Nº Viviendas columns are not a dwelling count"],
  ["aggregate_total_rows.rule", (m) => m.aggregate_total_rows?.rule, "records that an aggregate Total row never enters the artifact"],
  ["joins", (m) => m.joins, "states the exact-identifier join evidence"],
  ["fingerprint.value", (m) => m.fingerprint?.value, "is what makes a hand-edited or truncated artifact a visible failure"],
  ["interpretation_ceiling", (m) => m.interpretation_ceiling, "states what the figures are not"],
];

// ---------------------------------------------------------------- top level

// Committed Destination Context series: monthly hotel demand for the municipality
// of Madrid, from the official hotel occupancy survey. BLOCKING because these
// figures are published to the reader with a year-over-year comparison.
//
// The failure mode this gate exists for is a CONFIDENT WRONG NUMBER UNDER A
// CORRECT-LOOKING LABEL. Three specific ways that could happen, each checked
// below:
//
//   1. The figures come from the WRONG STATISTICAL OPERATION. The publisher's
//      tourist-point dimension also serves operation 239 (tourist apartments),
//      whose series have IDENTICAL names and values roughly fifteen times
//      smaller. The artifact must therefore carry the pinned operation-238
//      series codes the registry declares.
//   2. The GEOGRAPHY silently stops being the municipality. The whole module is
//      gated on the tourist point being municipality 28079; if the artifact says
//      anything else, the label in the interface becomes false.
//   3. A SUPPRESSED MONTH BECOMES A ZERO. The source publishes a real zero for
//      2020-04 and explicit nulls for 2020-05 and 2020-06. Collapsing those into
//      each other would either invent demand or invent its absence.
// The minimum provenance the user-facing disclosure is built from. Each entry is
// a field the interface actually reads or that an auditor needs to establish what
// the number is; a missing one means the figure would publish without the context
// that makes it honest.
//
// This is a SEMANTIC contract, not an editorial one. No prose sentence is
// pattern-matched: that would make wording a deployment gate without making the
// number one bit more trustworthy. Only presence, and the three identity values
// that must be exact, are checked.
const DESTINATION_META_FIELDS = [
  ["source.authority", (m) => m.source?.authority, "names the authority that publishes the statistic"],
  ["source.survey", (m) => m.source?.survey, "names the survey the figures come from"],
  ["source.api", (m) => m.source?.api, "records how the figures were retrieved"],
  ["geography.source_term", (m) => m.geography?.source_term, "names the publisher's own geographic unit"],
  ["geography.source_value", (m) => m.geography?.source_value, "names which unit of that kind this is"],
  [
    "survey_definitions.viajeros",
    (m) => m.survey_definitions?.viajeros,
    "defines what a traveller is, which is what stops the figure being read as unique people",
  ],
  ["interpretation_ceiling", (m) => m.interpretation_ceiling, "states what the figure is not"],
  ["retrieved_at", (m) => m.retrieved_at, "separates when this snapshot was taken from the period it describes"],
  ["schema_fingerprint", (m) => m.schema_fingerprint, "is what makes source schema drift a visible failure"],
];

// Provenance gate for the Destination Context sidecar.
//
// BLOCKING, like the licensed-VUT provenance gate, and for the same reason: this
// is a user-facing official statistic, so the disclosure that says what it
// measures - and what it does not mean - is part of what makes publishing it
// defensible. A figure whose provenance cannot be stated must not ship.
//
// The operation id gets its own exact check because operation identity is the
// central protection against the operation-239 name collision: operations 238
// and 239 publish series with IDENTICAL names through the same dimension, and
// the 239 values are roughly fifteen times smaller. A sidecar claiming a
// different operation than the registry pins means the artifact and its
// provenance disagree about WHICH SURVEY produced the numbers.
function validateDestinationMeta(source, artifact, meta, sink) {
  const label = source.display_name;
  const file = source.meta_artifact;

  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    sink.push(
      `${label}: ${file} is missing or is not an object. These figures are user-facing, so the ` +
        `provenance that states what they measure - and what they do not mean - is required to ` +
        `publish them.`
    );
    return;
  }

  for (const [path, read, why] of DESTINATION_META_FIELDS) {
    if (!isNonEmptyString(read(meta))) {
      sink.push(`${label}: ${file} has no usable ${path}, which ${why}`);
    }
  }

  // Statistical operation: the survey-identity contract, checked against the
  // registry's own pin rather than a literal repeated here.
  const expectedOperation = source.expected_operation_id;
  const declaredOperation = meta.source?.statistical_operation;
  if (isFiniteNumber(expectedOperation)) {
    if (declaredOperation !== expectedOperation) {
      sink.push(
        `${label}: ${file} declares statistical operation ${JSON.stringify(declaredOperation)}, but the ` +
          `registry pins ${expectedOperation}. Operation 239 publishes identically named series for ` +
          `tourist apartments; provenance that names a different survey than the pinned one must not ` +
          `be published.`
      );
    }
  } else {
    sink.push(
      `${label}: the registry declares no expected_operation_id, so the sidecar's statistical ` +
        `operation cannot be verified against anything`
    );
  }

  // Geography: the acceptance criterion the whole surface was gated on, checked
  // in the provenance as well as in the artifact so the two cannot drift apart.
  if (meta.geography?.resolved_level !== "municipality") {
    sink.push(
      `${label}: ${file} records geography.resolved_level ${JSON.stringify(meta.geography?.resolved_level)}, ` +
        `not "municipality". This series must never be documented as a sub-municipal figure.`
    );
  }
  const expectedCode = source.expected_municipality_code;
  if (isNonEmptyString(expectedCode) && meta.geography?.municipality_code !== expectedCode) {
    sink.push(
      `${label}: ${file} records municipality ${JSON.stringify(meta.geography?.municipality_code)}, but the ` +
        `registry declares ${expectedCode}`
    );
  }
  if (meta.geography?.hard_gate_1 !== "PASS") {
    sink.push(
      `${label}: ${file} records geography.hard_gate_1 as ${JSON.stringify(meta.geography?.hard_gate_1)}. ` +
        `The interface labels this figure as a municipality; publishing it without a settled geography ` +
        `would put an unverified claim in front of the reader.`
    );
  }

  // The fingerprint must tie the sidecar to the artifact it describes.
  if (
    isNonEmptyString(meta.schema_fingerprint) &&
    isNonEmptyString(artifact?.schema_fingerprint) &&
    meta.schema_fingerprint !== artifact.schema_fingerprint
  ) {
    sink.push(
      `${label}: artifact and sidecar schema fingerprints disagree, so the provenance does not ` +
        `describe the committed series`
    );
  }
}

function validateDestinationSeries(source, artifact, meta, errors, warnings) {
  const label = source.display_name;
  const sink = source.blocks_deployment ? errors : warnings;
  const localWarnings = [];

  if (!artifact || typeof artifact !== "object" || !Array.isArray(artifact.observations)) {
    sink.push(`${label}: ${source.artifact} is missing or has no observations array`);
    // The provenance gate still runs: a build missing both the series and its
    // documentation should report both, not just the first failure.
    validateDestinationMeta(source, artifact, meta, sink);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }

  validateDestinationMeta(source, artifact, meta, sink);

  // (2) Geography. The municipal equivalence is the acceptance criterion this
  // whole surface was gated on, so it is checked against the registry's own
  // declared code rather than against a literal repeated here.
  const expectedCode = source.expected_municipality_code;
  const actualCode = artifact.geography?.municipality_code;
  if (isNonEmptyString(expectedCode) && actualCode !== expectedCode) {
    sink.push(
      `${label}: artifact geography is municipality ${actualCode ?? "(absent)"}, but the registry ` +
        `declares ${expectedCode}. The interface labels this figure as a municipality; publishing a ` +
        `different geography under that label would make the label false.`
    );
  }
  if (artifact.geography?.level !== "municipality") {
    sink.push(
      `${label}: artifact geography level is ${artifact.geography?.level ?? "(absent)"}, not ` +
        `"municipality". This series must never be published as a sub-municipal figure.`
    );
  }

  // (1) Provenance of the series themselves.
  const declaredCodes = source.series_codes || {};
  for (const [metric, code] of Object.entries(declaredCodes)) {
    if (metric === "note") continue;
    const actual = artifact.metrics?.[metric]?.series;
    if (actual !== code) {
      sink.push(
        `${label}: metric "${metric}" is built from series ${actual ?? "(absent)"}, but the registry ` +
          `pins ${code}. Statistical operation 239 publishes identically named series for tourist ` +
          `apartments; a metric must not silently change which survey it reports.`
      );
    }
  }
  for (const [metric, definition] of Object.entries(artifact.metrics || {})) {
    if (definition?.provenance !== "SOURCE_REPORTED") {
      sink.push(
        `${label}: metric "${metric}" declares provenance ${definition?.provenance ?? "(absent)"}. ` +
          `Every published metric in this artifact is read from a source-published series; a derived ` +
          `total would disagree with the publisher's own figure.`
      );
    }
  }

  // Observations: ordering, uniqueness, period form, numeric sanity.
  const seen = new Set();
  let previous = null;
  let published = 0;
  let suppressed = 0;

  for (const observation of artifact.observations) {
    const period = observation?.period;
    if (typeof period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      sink.push(`${label}: observation has an unparseable monthly period ${JSON.stringify(period)}`);
      continue;
    }
    if (seen.has(period)) {
      sink.push(`${label}: duplicate observation for ${period}`);
      continue;
    }
    seen.add(period);
    if (previous && period <= previous) {
      sink.push(`${label}: observations are not in chronological order (${previous} then ${period})`);
    }
    previous = period;

    if (observation.status !== "definitive" && observation.status !== "provisional") {
      sink.push(
        `${label}: ${period} carries status ${JSON.stringify(observation.status)}, which is neither ` +
          `"definitive" nor "provisional"`
      );
    }

    for (const metric of Object.keys(artifact.metrics || {})) {
      const value = observation[metric];
      if (value === null) {
        // (3) A null is the publisher declining to publish. It must stay null.
        suppressed += 1;
        continue;
      }
      if (!isFiniteNumber(value)) {
        sink.push(`${label}: ${period} has a non-numeric ${metric} (${JSON.stringify(value)})`);
        continue;
      }
      if (value < 0) {
        sink.push(`${label}: ${period} has a negative ${metric} (${value}), which these counts cannot be`);
      }
      published += 1;
    }

    // A composition that exceeds its own headline would mean the two are not the
    // pair the interface presents them as.
    const spain = observation.travellers_residents_spain;
    const abroad = observation.travellers_residents_abroad;
    const travellers = observation.travellers;
    if (isFiniteNumber(spain) && isFiniteNumber(abroad) && isFiniteNumber(travellers)) {
      // The publisher rounds each estimate independently, so the components sum
      // to within +/-1 of the published total rather than exactly to it. A larger
      // divergence means these are no longer the same month's figures.
      if (Math.abs(spain + abroad - travellers) > 1) {
        sink.push(
          `${label}: ${period} residence components (${spain} + ${abroad}) diverge from the published ` +
            `travellers total (${travellers}) by more than the publisher's rounding tolerance of 1`
        );
      }
    }
  }

  const months = artifact.observations.length;
  const guardrail = source.expected_counts || {};
  if (isFiniteNumber(guardrail.months_minimum) && months < guardrail.months_minimum) {
    sink.push(
      `${label}: ${months} monthly observation(s), below the integrity floor of ` +
        `${guardrail.months_minimum}. Assume a truncated or changed response rather than a shorter series.`
    );
  }

  // The declared latest period must be the series' own last observation:
  // the interface prints it as the headline period.
  const declaredLatest = artifact.source_period?.latest;
  const observedLatest = previous;
  if (declaredLatest !== observedLatest) {
    sink.push(
      `${label}: source_period.latest is ${JSON.stringify(declaredLatest)} but the last observation is ` +
        `${JSON.stringify(observedLatest)}. The interface prints this period as the period of the figure.`
    );
  }
  const declaredStatus = artifact.source_period?.latest_status;
  const observedStatus = artifact.observations[artifact.observations.length - 1]?.status;
  if (declaredLatest === observedLatest && declaredStatus !== observedStatus) {
    sink.push(
      `${label}: source_period.latest_status is ${JSON.stringify(declaredStatus)} but ${observedLatest} ` +
        `is ${JSON.stringify(observedStatus)}`
    );
  }

  if (!isNonEmptyString(artifact.schema_fingerprint)) {
    sink.push(
      `${label}: the artifact carries no schema_fingerprint, so source schema drift could not be ` +
        `distinguished from a legitimate refresh`
    );
  }
  // The artifact/sidecar fingerprint agreement is checked once, in the
  // provenance gate above, so a mismatch is reported as one failure not two.

  if (suppressed > 0) {
    localWarnings.push(
      `${suppressed} metric value(s) are published as null by the source and are shown as ` +
        `unavailable rather than as zero`
    );
  }

  return {
    record_count: months,
    state: months > 0 ? "available" : "unavailable",
    // What the data DESCRIBE, never when we built. This source does expose a
    // period, so unlike the licence layer it carries one.
    source_period: isNonEmptyString(declaredLatest)
      ? { latest_month: declaredLatest, status: declaredStatus ?? null, earliest_month: artifact.source_period?.earliest ?? null }
      : null,
    warnings: localWarnings,
  };
}

// Published domestic municipality origins are a distinct statistical operation
// from hotel demand. The crucial guard here is that suppression stays absence:
// no missing crossing may arrive as a synthetic zero or residual category.
function validateDomesticOrigins(source, artifact, meta, errors, warnings) {
  const sink = source.blocks_deployment ? errors : warnings;
  if (!artifact || !Array.isArray(artifact.months) || !artifact.months.length) {
    sink.push(`${source.display_name}: ${source.artifact} is missing or has no monthly origin records`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) sink.push(`${source.display_name}: provenance sidecar is missing or invalid`);
  const expectedWorkbookUrl = Number.isInteger(artifact.source?.workbook_year) ? source.dataset_url_template?.replace("{year}", String(artifact.source.workbook_year)) : null;
  if (!isNonEmptyString(artifact.source?.authority) || artifact.source?.source_url !== expectedWorkbookUrl || !Number.isInteger(artifact.source?.workbook_year) || !isNonEmptyString(artifact.source?.retrieved_at)) sink.push(`${source.display_name}: artifact source provenance is incomplete or does not use the registered direct INE workbook`);
  if (meta?.source?.source_url !== artifact.source?.source_url || meta?.source?.workbook_year !== artifact.source?.workbook_year || meta?.source?.retrieved_at !== artifact.source?.retrieved_at) sink.push(`${source.display_name}: sidecar source provenance does not match the artifact`);
  if (artifact.source_universe?.same_province_travel_excluded !== true || meta?.source_universe?.same_province_travel_excluded !== true || !/different from the province of residence/i.test(artifact.source_universe?.trip_condition || "") || JSON.stringify(meta?.source_universe) !== JSON.stringify(artifact.source_universe)) sink.push(`${source.display_name}: province-different source universe is absent or weakened`);
  if (artifact.geography?.municipality_code !== source.expected_municipality_code || artifact.geography?.level !== "municipality") sink.push(`${source.display_name}: artifact is not strictly Madrid municipality ${source.expected_municipality_code}`);
  if (meta?.geography?.municipality_code !== source.expected_municipality_code || meta?.geography?.resolved_level !== "municipality") sink.push(`${source.display_name}: sidecar does not corroborate Madrid municipality ${source.expected_municipality_code}`);
  if (JSON.stringify(meta?.geography?.destination_corroboration) !== JSON.stringify({ dest: "Madrid", prov_dest_cod: "28", prov_dest: "Madrid" })) sink.push(`${source.display_name}: sidecar destination corroboration drifted`);
  if (JSON.stringify(artifact.source_schema) !== JSON.stringify(source.expected_source_schema)) sink.push(`${source.display_name}: exact INE source schema drifted`);
  if (!isNonEmptyString(artifact.schema_fingerprint) || artifact.schema_fingerprint !== meta?.schema_fingerprint) sink.push(`${source.display_name}: artifact and sidecar schema fingerprints disagree`);
  if (!/more than 30 tourists/i.test(artifact.suppression?.rule || "") || !/(not zero|never materialised as zero)/i.test(artifact.suppression?.absent_is_not_zero || "")) sink.push(`${source.display_name}: suppression contract is absent or permits missing origins to become zero`);
  let previous = null; let count = 0;
  const monthlyFloor = source.integrity_guardrail?.minimum_rows_per_published_month;
  for (const month of artifact.months) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month?.source_month || "") || (previous && month.source_month <= previous)) { sink.push(`${source.display_name}: monthly records are not strictly ordered`); continue; }
    previous = month.source_month;
    if (!Array.isArray(month.published_origins)) { sink.push(`${source.display_name}: ${month.source_month} has no published origins array`); continue; }
    const seen = new Set();
    for (const origin of month.published_origins) {
      const code = origin?.origin_municipality_code;
      if (!/^\d{5}$/.test(code || "") || !/^\d{2}$/.test(origin?.origin_province_code || "") || !isNonEmptyString(origin?.origin_municipality_name) || !isNonEmptyString(origin?.origin_province_name) || !Number.isInteger(origin?.source_reported_tourists) || origin.source_reported_tourists <= 30 || seen.has(code)) sink.push(`${source.display_name}: invalid, suppressed or duplicate origin row in ${month.source_month}`);
      if (origin && ["barrio", "district", "lat", "lon", "geometry", "international"].some((key) => key in origin)) sink.push(`${source.display_name}: origin row contains prohibited non-municipal or international field`);
      seen.add(code); count += 1;
    }
    if (Number.isInteger(monthlyFloor) && month.published_origins.length < monthlyFloor) sink.push(`${source.display_name}: ${month.source_month} has ${month.published_origins.length} published row(s), below the per-published-month extraction floor ${monthlyFloor}`);
  }
  if (artifact.source_period?.latest !== previous || JSON.stringify(artifact.source_period?.available_months) !== JSON.stringify(artifact.months.map((month) => month.source_month))) sink.push(`${source.display_name}: declared source months do not match the monthly records`);
  return { record_count: count, state: count ? "available" : "unavailable", source_period: artifact.source_period?.latest || null, warnings: [] };
}

// Committed official-callejero NDP crosswalk (K9, #71). BLOCKING: the licence
// layer's coordinates and barrios come from it, so a missing, truncated or
// collapsed crosswalk would publish a mislocated or empty evidence layer. The
// failure mode this gate exists for is a SILENT COLLAPSE — the historical route
// quietly stops being used, the match rate falls, or every row goes unresolved —
// not an empty panel. The floors are declared data in the registry's guardrails.
function validateCrosswalkReference(source, artifact, meta, scopes, errors, warnings) {
  const label = source.display_name;
  const sink = source.blocks_deployment ? errors : warnings;
  if (!artifact || typeof artifact !== "object" || !Array.isArray(artifact.records)) {
    sink.push(`${label}: ${source.artifact} is missing or has no records array`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  if (!meta || typeof meta !== "object" || !meta.coverage) {
    sink.push(`${label}: ${source.meta_artifact} is missing or has no coverage block`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  const cov = meta.coverage;
  const guard = source.integrity_guardrail ?? {};

  // Crosswalk source fingerprints must be present: the three official SHAs and the
  // artifact fingerprint. Their absence means provenance was lost.
  const srcs = meta.sources ?? {};
  for (const key of ["licence_register", "current_callejero", "historical_callejero"]) {
    const sha = srcs[key]?.observed_resource_state?.sha256;
    if (typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha)) {
      sink.push(`${label}: crosswalk source fingerprint for ${key} is missing or malformed`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(meta.fingerprint?.value ?? "")) {
    sink.push(`${label}: crosswalk artifact fingerprint is missing or malformed`);
  }

  // Residual reconciliation: every row carries exactly one state and the states
  // sum to the row count; resolved + unresolved = rows. No silent drop.
  const residualSum = Object.values(cov.residual_taxonomy ?? {}).reduce((a, b) => a + b, 0);
  if (!cov.residual_taxonomy_is_exhaustive || residualSum !== cov.licence_rows) {
    sink.push(`${label}: residual taxonomy (${residualSum}) does not reconcile with ${cov.licence_rows} rows`);
  }
  if (cov.resolved_rows + cov.unresolved_rows !== cov.licence_rows) {
    sink.push(`${label}: resolved (${cov.resolved_rows}) + unresolved (${cov.unresolved_rows}) != rows (${cov.licence_rows})`);
  }

  // Collapse guards (declared floors, not analytical thresholds).
  if (typeof guard.min_resolved_rows === "number" && cov.resolved_rows < guard.min_resolved_rows) {
    sink.push(`${label}: ${cov.resolved_rows} resolved rows is below the collapse floor ${guard.min_resolved_rows}`);
  }
  if (cov.resolved_rows === 0) sink.push(`${label}: every row is unresolved; the crosswalk has collapsed`);
  if (typeof guard.min_row_match_rate === "number" && cov.row_match_rate < guard.min_row_match_rate) {
    sink.push(
      `${label}: row match rate ${cov.row_match_rate} is below the floor ${guard.min_row_match_rate} ` +
        `(pinned Gate M ${guard.baseline?.row_match_rate}). Documented in the registry; catches material collapse.`
    );
  }
  // Historical-recovery guard: the historical route must stay present and working.
  if (typeof guard.min_historical_recovered === "number" && cov.historical_only_recovered_rows < guard.min_historical_recovered) {
    sink.push(
      `${label}: only ${cov.historical_only_recovered_rows} rows recovered via the historical callejero ` +
        `(floor ${guard.min_historical_recovered}, baseline ${guard.baseline?.historical_only_recovered_rows}). ` +
        `The historical route may have silently stopped being used.`
    );
  }

  // Resolved records carry a coordinate inside the integrity envelope.
  const box = scopes[source.expected_spatial_scope];
  const resolved = artifact.records.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  if (box) checkCoordinates(resolved, box, label, sink);

  return {
    record_count: artifact.records.length,
    state: "available",
    source_period: null,
    warnings: [
      `${cov.resolved_rows}/${cov.licence_rows} resolved (${cov.current_only_resolved_rows} current, ${cov.historical_only_recovered_rows} historical), match rate ${cov.row_match_rate}`,
    ],
  };
}

// Committed granted-urban-licence layer (K9, #71). BLOCKING. The failure mode is a
// PLAUSIBLE-LOOKING WRONG LAYER: the three families collapsing, an unseen TIPO
// silently mapped, the coverage denominator dropping the unresolved rows, the
// protection absence states merging, or a cross-family total appearing. It also
// refuses to let the layer acquire a reference date or an approval/rejection shape.
function validateUrbanLicences(source, artifact, meta, crosswalkMeta, errors, warnings) {
  const label = source.display_name;
  const sink = source.blocks_deployment ? errors : warnings;
  if (!artifact || typeof artifact !== "object" || !Array.isArray(artifact.records)) {
    sink.push(`${label}: ${source.artifact} is missing or has no records array`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  if (!meta || typeof meta !== "object" || !meta.coverage || !meta.tipo_taxonomy) {
    sink.push(`${label}: ${source.meta_artifact} is missing or incomplete`);
    return { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
  }
  if (artifact.granted_only !== true) {
    sink.push(`${label}: artifact is not flagged granted_only; the register must be a granted-only universe`);
  }
  const cov = artifact.coverage ?? {};
  const guard = source.integrity_guardrail ?? {};
  const families = ["BUILDING_URBANISTIC_LICENCE_FAMILY", "ACTIVITY_LICENCE_FAMILY", "TEMPORARY_ACTIVITY_FAMILY"];

  // Closed taxonomy: no unclassified TIPO may survive to the artifact.
  if (meta.tipo_taxonomy.unclassified_tipo_rows !== 0) {
    sink.push(`${label}: ${meta.tipo_taxonomy.unclassified_tipo_rows} unclassified TIPO row(s); the taxonomy must be closed`);
  }
  // Family counts must not collapse: each above its declared floor, none missing.
  const fc = meta.tipo_taxonomy.family_counts ?? {};
  for (const family of families) {
    const floor = guard.min_family_counts?.[family];
    if (!Number.isInteger(fc[family]) || fc[family] <= 0) {
      sink.push(`${label}: family ${family} has no positive count (${fc[family]})`);
    } else if (typeof floor === "number" && fc[family] < floor) {
      sink.push(`${label}: family ${family} count ${fc[family]} is below the collapse floor ${floor}`);
    }
  }

  // Coverage: resolved+unresolved reconcile with total; unresolved rows are never
  // silently dropped from the denominator; resolved count not collapsed; a window.
  if (cov.resolved_rows + cov.unresolved_rows !== cov.total_rows) {
    sink.push(`${label}: resolved (${cov.resolved_rows}) + unresolved (${cov.unresolved_rows}) != total (${cov.total_rows})`);
  }
  if (cov.resolved_rows !== artifact.records.length) {
    sink.push(`${label}: coverage resolved_rows ${cov.resolved_rows} != ${artifact.records.length} mapped records`);
  }
  if (typeof guard.min_resolved_rows === "number" && cov.resolved_rows < guard.min_resolved_rows) {
    sink.push(`${label}: ${cov.resolved_rows} resolved records is below the collapse floor ${guard.min_resolved_rows}`);
  }
  if (cov.resolved_rows === 0) sink.push(`${label}: every row is unresolved; the layer has collapsed`);
  if (typeof guard.min_row_match_rate === "number" && cov.row_match_rate < guard.min_row_match_rate) {
    sink.push(`${label}: row match rate ${cov.row_match_rate} is below the floor ${guard.min_row_match_rate}`);
  }
  if (typeof guard.min_historical_recovered === "number" && cov.historical_only_recovered_rows < guard.min_historical_recovered) {
    sink.push(`${label}: historical recovery (${cov.historical_only_recovered_rows}) below floor ${guard.min_historical_recovered}`);
  }

  // Date extent must be present and well-formed (the window clamp depends on it).
  const extent = artifact.date_extent ?? {};
  if (!ISO_DATE.test(String(extent.min)) || !ISO_DATE.test(String(extent.max)) || extent.min > extent.max) {
    sink.push(`${label}: date_extent is missing or incoherent (${extent.min}..${extent.max})`);
  }

  // The three NIVEL_PROTECCION absence states must stay present and distinct.
  const np = meta.nivel_proteccion?.counts ?? {};
  for (const state of ["EMPTY", "Sin Catalogar", "Sin protección"]) {
    if (!Number.isInteger(np[state])) {
      sink.push(`${label}: NIVEL_PROTECCION absence state "${state}" is missing; the three states must stay distinct`);
    }
  }

  // Structural: no approval/rejection denominator, no cross-family total.
  const blob = JSON.stringify(artifact).toLowerCase();
  for (const banned of ["approval_rate", "rejection_rate", "refusal_count", "success_rate", "total_urban_licences", "all_licence_total", "overall_licence_count"]) {
    if (blob.includes(banned)) sink.push(`${label}: artifact carries forbidden key/semantics "${banned}"`);
  }

  // Responsible declarations (dataset 133556) must never be an ingested source.
  if (JSON.stringify(meta.source ?? {}).includes("133556")) {
    sink.push(`${label}: dataset 133556 (responsible declarations) must not be a source of this layer`);
  }

  // Record field creep guard: a population, ratio, rate or personal field appearing
  // on a licence record is exactly the conflation this layer must avoid.
  const allowed = new Set([
    "id", "ndp", "family", "tipo", "grant_date", "norma_zonal", "nivel_proteccion",
    "lat", "lon", "coordinate_crs", "barrio_code", "district_code",
    "crosswalk_state", "resolution_provenance", "barrio_provenance", "address_text_agrees",
  ]);
  const seenIds = new Set();
  let fieldCreep = 0;
  for (const r of artifact.records) {
    for (const k of Object.keys(r)) if (!allowed.has(k)) fieldCreep += 1;
    if (seenIds.has(r.id)) sink.push(`${label}: duplicate record id ${r.id}`);
    seenIds.add(r.id);
    if (!families.includes(r.family)) sink.push(`${label}: record ${r.id} has unknown family ${r.family}`);
  }
  if (fieldCreep) sink.push(`${label}: ${fieldCreep} record field(s) outside the minimised allow-list`);

  // The licence layer must trace to the committed crosswalk's current+historical SHAs.
  const dep = meta.crosswalk_dependency ?? {};
  const xwFp = crosswalkMeta?.fingerprint?.value;
  if (xwFp && dep.fingerprint && dep.fingerprint !== xwFp) {
    sink.push(`${label}: declares crosswalk fingerprint ${String(dep.fingerprint).slice(0, 12)} but the committed crosswalk is ${String(xwFp).slice(0, 12)}`);
  }

  return {
    record_count: artifact.records.length,
    state: "available",
    source_period: null,
    warnings: [
      `${cov.resolved_rows}/${cov.total_rows} mapped; families ${families.map((f) => fc[f]).join("/")}; window extent ${extent.min}..${extent.max}`,
    ],
  };
}

function validateRuntimePoiStructure(runtimePoi, registry, errors) {
  // Only demanded when a registry source actually lives in this artifact, so a
  // registry scoped to committed evidence does not require a build artifact.
  const expected = registry.sources.filter((s) => s.artifact === "runtime_poi.json").map((s) => s.id);
  if (expected.length === 0) return;

  if (!runtimePoi || typeof runtimePoi !== "object") {
    errors.push(
      "runtime_poi.json is missing or unparseable. Run the deployment builders first " +
        "(node scripts/build_runtime_poi.mjs && python3 scripts/fill_stays_from_esmadrid.py)."
    );
    return;
  }
  for (const field of ["generatedAt", "sourceMode", "layers", "status"]) {
    if (!(field in runtimePoi)) errors.push(`runtime_poi.json: required top-level field "${field}" is missing`);
  }
  if (runtimePoi.layers && runtimePoi.status) {
    const layerKeys = Object.keys(runtimePoi.layers).sort();
    const statusKeys = Object.keys(runtimePoi.status).sort();
    const onlyLayers = layerKeys.filter((k) => !statusKeys.includes(k));
    const onlyStatus = statusKeys.filter((k) => !layerKeys.includes(k));
    if (onlyLayers.length || onlyStatus.length) {
      errors.push(
        `runtime_poi.json: layer and status names disagree` +
          (onlyLayers.length ? ` (in layers only: ${onlyLayers.join(", ")})` : "") +
          (onlyStatus.length ? ` (in status only: ${onlyStatus.join(", ")})` : "")
      );
    }
  }
  // Every registry source that lives in runtime_poi.json must be represented.
  const present = Object.keys(runtimePoi.layers ?? {});
  for (const id of expected) {
    if (!present.includes(id)) errors.push(`runtime_poi.json: registry declares layer "${id}" but the build did not emit it`);
  }
}

export function validateDeployment({
  registry,
  artifacts,
  generatedAt,
  commit = null,
  workflowRun = null,
  buildStepOutcome = null,
}) {
  const errors = [];
  const warnings = [];
  const scopes = registry.spatial_scopes;

  // The workflow runs this validator even when the build step failed, so that a
  // failed build still leaves an audit manifest. A non-successful build can
  // never be published, whatever the artifacts on disk happen to look like.
  if (buildStepOutcome !== null && buildStepOutcome !== "success") {
    errors.push(
      `the data build step reported "${buildStepOutcome}": a deployment must not be published from an ` +
        `incomplete or failed build, regardless of what the artifacts on disk contain`
    );
  }

  validateRuntimePoiStructure(artifacts["runtime_poi.json"], registry, errors);

  const layers = [];
  for (const source of registry.sources) {
    let result;
    switch (source.shape) {
      case "poi_layer":
        result = validatePoiLayer(source, artifacts["runtime_poi.json"], scopes, errors, warnings);
        break;
      case "pedestrian_activity":
        result = validatePedestrian(source, artifacts["pedestrian_activity.json"], scopes, errors, warnings);
        break;
      case "hati_evidence":
        result = validateHati(
          source,
          artifacts["hati_assets.json"],
          artifacts["hati_provenance.json"],
          scopes,
          errors
        );
        break;
      case "snapshot_fallback":
        result = validateSnapshotFallback(source, artifacts["snapshot_poi.json"], scopes, errors);
        break;
      case "admin_geography":
        result = validateAdminGeography(
          source,
          artifacts[source.artifact],
          artifacts[source.meta_artifact],
          scopes,
          errors,
          warnings
        );
        break;
      case "admin_population":
        result = validatePopulation(
          source,
          artifacts[source.artifact],
          artifacts[source.meta_artifact],
          artifacts["geography/madrid_admin.geojson"],
          errors,
          warnings
        );
        break;
      case "admin_licence_counts":
        result = validateLicenceCounts(
          source,
          artifacts[source.artifact],
          artifacts[source.meta_artifact],
          artifacts["geography/madrid_admin.geojson"],
          artifacts["geography/madrid_admin.meta.json"],
          errors,
          warnings
        );
        break;
      case "destination_demand_series":
        result = validateDestinationSeries(
          source,
          artifacts[source.artifact],
          artifacts[source.meta_artifact],
          errors,
          warnings
        );
        break;
      case "destination_domestic_origins":
        result = validateDomesticOrigins(source, artifacts[source.artifact], artifacts[source.meta_artifact], errors, warnings);
        break;
      case "planning_ambito_geometry":
        result = validatePlanningGeometry(
          source,
          artifacts[source.artifact],
          artifacts[source.meta_artifact],
          scopes,
          errors,
          warnings
        );
        break;
      case "planning_ambito_state":
        result = validatePlanningState(
          source,
          artifacts[source.artifact],
          artifacts[source.meta_artifact],
          artifacts["planning/madrid_ambitos.geojson"],
          errors,
          warnings
        );
        break;
      case "address_point_crosswalk":
        result = validateCrosswalkReference(
          source,
          artifacts[source.artifact],
          artifacts[source.meta_artifact],
          scopes,
          errors,
          warnings
        );
        break;
      case "address_point_licences":
        result = validateUrbanLicences(
          source,
          artifacts[source.artifact],
          artifacts[source.meta_artifact],
          artifacts["callejero/madrid_ndp_crosswalk.meta.json"],
          errors,
          warnings
        );
        break;
      case "admin_hospitality_context":
        result = validateHospitalityContext(
          source,
          artifacts[source.artifact],
          artifacts["geography/madrid_admin.geojson"],
          errors,
          warnings
        );
        break;
      default:
        errors.push(`${source.display_name}: unknown shape "${source.shape}" in the source registry`);
        result = { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
    }

    // The retrieval timestamp that actually ships: for a rebuilt-at-deploy source
    // it is the built artifact's own generatedAt (the real fetch), not a static
    // registry date; for a committed source it is the registry value.
    const effectiveRetrievedAt =
      source.rebuilt_at_deploy === true
        ? artifacts[source.artifact]?.generatedAt ?? null
        : source.retrieved_at ?? null;

    // K2 freshness + analytical-scope contract. Checked with the state THIS build
    // computed, so the retrieved_at null carve-out only ever applies to a
    // rebuilt-at-deploy layer that is genuinely unavailable here.
    validateSourceFreshness(source, result.state, effectiveRetrievedAt, scopes, errors);

    layers.push({
      source_id: source.id,
      display_name: source.display_name,
      authority: source.authority,
      dataset_url: source.dataset_url ?? null,
      builder: source.builder,
      artifact: source.artifact,
      rebuilt_at_deploy: source.rebuilt_at_deploy === true,
      // Distinguishes a freshly built deployment snapshot from the committed
      // packaged sample and from committed research evidence, so no consumer of
      // this manifest can mistake the curated fallback for current authoritative
      // evidence. provenance_reference points at the file that describes where a
      // mixed-provenance layer's records actually came from.
      provenance_state: source.provenance_state,
      provenance_reference: source.provenance_reference ?? null,
      role: source.role,
      blocks_deployment: source.blocks_deployment === true,
      evidence_type: source.evidence_type,
      // spatial_scope remains the integrity envelope (a loose bounding box for
      // build validation). analytical_scope is the distinct K2 concept: WHAT THE
      // VALUE MEANS geometrically. The two are carried side by side and never merged.
      spatial_scope: source.expected_spatial_scope,
      analytical_scope: source.scope ?? null,
      record_count: result.record_count,
      state: result.state,
      // generated_at is when WE built; source_period is what the data describes.
      // They are deliberately separate, and source_period stays null when the
      // source publishes no period rather than being filled with the build time.
      source_period: result.source_period,
      source_period_known: result.source_period !== null,
      source_period_semantics: source.source_period_semantics,
      // The five-field freshness contract (K2), carried verbatim from the registry
      // so a consumer reads reference date, publication date, retrieval date,
      // cadence and publisher state without collapsing any of them into "updated".
      // For a rebuilt-at-deploy source the registry retrieved_at records the
      // committed snapshot; a live deploy fetch supersedes it at build time.
      freshness: {
        reference_date: source.reference_date ?? null,
        published_at: source.published_at ?? null,
        retrieved_at: effectiveRetrievedAt,
        update_frequency: source.update_frequency ?? null,
        source_state: source.source_state ?? null,
        ...(Object.prototype.hasOwnProperty.call(source, "observed_cadence")
          ? { observed_cadence: source.observed_cadence }
          : {}),
      },
      interpretation_ceiling: source.interpretation_ceiling,
      warnings: result.warnings,
    });
  }

  const operational = layers.filter((l) => l.role === "operational");
  const manifest = {
    contract_version: CONTRACT_VERSION,
    registry_contract_version: registry.contract_version,
    generated_at: generatedAt,
    commit,
    workflow_run: workflowRun,
    // The outcome of the data-build step, as reported by the workflow. null when
    // the validator was run outside the workflow (for example locally).
    build_step_outcome: buildStepOutcome,
    build_state: errors.length === 0 ? "pass" : "fail",
    validation: {
      error_count: errors.length,
      warning_count: warnings.length,
      errors,
      warnings,
    },
    totals: {
      layers_declared: layers.length,
      layers_available: layers.filter((l) => l.state === "available").length,
      layers_unavailable: layers.filter((l) => l.state === "unavailable").length,
      operational_layers_available: operational.filter((l) => l.state === "available").length,
      operational_records: operational.reduce((sum, l) => sum + l.record_count, 0),
    },
    layers,
  };

  return { manifest, errors, warnings, ok: errors.length === 0 };
}

// ---------------------------------------------------------------- CLI

const ARTIFACT_FILES = [
  "runtime_poi.json",
  "pedestrian_activity.json",
  "hati_assets.json",
  "hati_provenance.json",
  "snapshot_poi.json",
  // Committed canonical administrative geography (not rebuilt at deploy).
  "geography/madrid_admin.geojson",
  "geography/madrid_admin.meta.json",
  // Committed residential population denominator (not rebuilt at deploy).
  "population/madrid_population.json",
  "population/madrid_population.meta.json",
  // Committed licensed tourist-dwelling numerator (not rebuilt at deploy).
  "accommodation/madrid_vut_licences.json",
  "accommodation/madrid_vut_licences.meta.json",
  // Committed city-level hotel-demand series (not rebuilt at deploy).
  "destination/madrid_hotel_demand.json",
  "destination/madrid_hotel_demand.meta.json",
  "destination/madrid_domestic_origins.json",
  "destination/madrid_domestic_origins.meta.json",
  // Committed Gate F Hospitality & Commercial aggregate (not rebuilt at deploy).
  "hospitality-commercial-context.json",
  // Committed official planning-ambito geometry and the dated edition snapshot
  // of development state and available buildability (not rebuilt at deploy).
  "planning/madrid_ambitos.geojson",
  "planning/madrid_ambitos.meta.json",
  "planning/madrid_ambito_state.json",
  "planning/madrid_ambito_state.meta.json",
  // Committed official-callejero NDP crosswalk and the granted-urban-licence layer
  // it resolves (K9, #71; not rebuilt at deploy).
  "callejero/madrid_ndp_crosswalk.json",
  "callejero/madrid_ndp_crosswalk.meta.json",
  "planning/madrid_urban_licences.json",
  "planning/madrid_urban_licences.meta.json",
];

export function readArtifacts(dataDir) {
  const artifacts = {};
  for (const name of ARTIFACT_FILES) {
    const file = path.join(dataDir, name);
    try {
      artifacts[name] = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      artifacts[name] = null;
    }
  }
  return artifacts;
}

function currentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const options = { dataDir: "data", manifestOut: null, registry: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--data-dir") options.dataDir = argv[++i];
    else if (argv[i] === "--manifest-out") options.manifestOut = argv[++i];
    else if (argv[i] === "--registry") options.registry = argv[++i];
  }
  options.registry ??= path.join(options.dataDir, "source_registry.json");
  options.manifestOut ??= path.join(options.dataDir, "deployment_manifest.json");
  return options;
}

function main(argv) {
  const options = parseArgs(argv);

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(options.registry, "utf8"));
  } catch (error) {
    console.error(`[validate-deployment] cannot read source registry ${options.registry}: ${error.message}`);
    return 2;
  }

  const { manifest, errors, warnings, ok } = validateDeployment({
    registry,
    artifacts: readArtifacts(options.dataDir),
    generatedAt: new Date().toISOString(),
    commit: currentCommit(),
    workflowRun: process.env.GITHUB_RUN_ID ?? null,
    buildStepOutcome: process.env.DEPLOYMENT_BUILD_OUTCOME || null,
  });

  // The manifest is written even on failure: a failed build is exactly when the
  // audit record is most useful.
  fs.writeFileSync(options.manifestOut, `${JSON.stringify(manifest, null, 2)}\n`);

  for (const layer of manifest.layers) {
    const flag = layer.state === "available" ? "ok " : "-- ";
    console.log(
      `[validate-deployment] ${flag}${layer.source_id.padEnd(18)} ${String(layer.record_count).padStart(5)} record(s)  ` +
        `${layer.role}${layer.blocks_deployment ? " (blocking)" : ""}`
    );
  }
  for (const warning of warnings) console.log(`[validate-deployment] warning: ${warning}`);
  for (const error of errors) console.error(`[validate-deployment] ERROR: ${error}`);

  console.log(
    `[validate-deployment] manifest written to ${options.manifestOut} — ` +
      `build_state=${manifest.build_state}, ${errors.length} error(s), ${warnings.length} warning(s)`
  );

  if (!ok) {
    console.error(
      "[validate-deployment] refusing to publish a degraded deployment. " +
        "GitHub Pages keeps the previous good deployment."
    );
  }
  return ok ? 0 : 1;
}

// Run as a CLI only when this file is the entry point; tests import the
// exported functions instead. Basename comparison keeps this correct on Windows,
// where import.meta.url pathnames carry a leading slash before the drive letter.
if (process.argv[1] && path.basename(process.argv[1]) === "validate_deployment.mjs") {
  process.exit(main(process.argv.slice(2)));
}
