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

export const CONTRACT_VERSION = "1.0.0";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
            `be published as the official accommodation deployment artifact.`
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

// ---------------------------------------------------------------- top level

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
      default:
        errors.push(`${source.display_name}: unknown shape "${source.shape}" in the source registry`);
        result = { record_count: 0, state: "unavailable", source_period: null, warnings: [] };
    }

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
      spatial_scope: source.expected_spatial_scope,
      record_count: result.record_count,
      state: result.state,
      // generated_at is when WE built; source_period is what the data describes.
      // They are deliberately separate, and source_period stays null when the
      // source publishes no period rather than being filled with the build time.
      source_period: result.source_period,
      source_period_known: result.source_period !== null,
      source_period_semantics: source.source_period_semantics,
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
