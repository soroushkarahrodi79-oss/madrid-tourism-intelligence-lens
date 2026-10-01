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
  // Committed Gate F Hospitality & Commercial aggregate (not rebuilt at deploy).
  "hospitality-commercial-context.json",
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
