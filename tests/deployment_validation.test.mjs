import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateDeployment, readArtifacts } from "../scripts/validate_deployment.mjs";

const REAL_REGISTRY = JSON.parse(
  fs.readFileSync(new URL("../data/source_registry.json", import.meta.url), "utf8")
);

const GENERATED_AT = "2026-09-29T09:00:00.000Z";

// A Madrid coordinate that sits inside every scope the registry declares, so
// fixtures can share it and only the deliberate mutations move out of bounds.
const LAT = 40.42;
const LON = -3.7;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// The real registry, with collapse guardrails scaled down so fixtures can stay
// small. Rule behaviour is what these tests exercise; the real thresholds are
// asserted separately in "source registry is internally coherent".
function testRegistry() {
  const registry = clone(REAL_REGISTRY);
  for (const source of registry.sources) {
    if (source.integrity_guardrail) source.integrity_guardrail.min_count = 2;
    if (source.integrity_guardrail?.minimum_rows_per_published_month) source.integrity_guardrail.minimum_rows_per_published_month = 2;
    if (source.required_modes) {
      for (const rule of Object.values(source.required_modes.modes)) rule.min_count = 1;
    }
    // The pinned committed-snapshot totals describe the real artifact, so they
    // are re-aimed at the fixture's own totals here. The pin's behaviour is
    // asserted on its own below, and the real numbers are asserted in
    // "source registry is internally coherent".
    if (source.expected_source_totals) {
      source.expected_source_totals.licences = VUT_FIXTURE_TOTALS.licences;
      source.expected_source_totals.units = VUT_FIXTURE_TOTALS.units;
    }
    if (source.id === "hospitality_commercial_context") {
      source.expected_municipality_values = hospitalityArtifact().municipality["28079"].indicators;
    }
    // The series-length floor describes the real committed artifact, so it is
    // re-aimed at the fixture's own short series here. The floor's behaviour is
    // asserted on its own below, and the real number is asserted in
    // "source registry is internally coherent".
    if (source.expected_counts && source.expected_counts.months_minimum) {
      source.expected_counts.months_minimum = 2;
    }
  }
  return registry;
}

function poiRecords(prefix, count, extra = () => ({})) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `${prefix} ${i}`,
    lat: LAT,
    lon: LON,
    ...extra(i),
  }));
}

// A structurally complete synthetic geography: 1 municipality, 21 districts and
// 131 barrios, each a tiny valid square inside madrid_city_area, so the healthy
// build exercises the admin_geography validator with no warnings. The real
// artifact is checked separately in "the committed artifacts satisfy the real
// registry".
function squareAt(i) {
  const lon = LON + (i % 20) * 0.0005;
  const lat = LAT + (Math.floor(i / 20) % 20) * 0.0005;
  const d = 0.0002;
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon, lat],
        [lon + d, lat],
        [lon + d, lat + d],
        [lon, lat + d],
        [lon, lat],
      ],
    ],
  };
}

function geographyFeatureCollection() {
  const features = [
    {
      type: "Feature",
      properties: {
        geography_level: "municipality",
        official_id: "28079",
        official_name: "Madrid",
        parent_id: null,
        parent_name: null,
        geometry_provenance: "DERIVED_FROM_OFFICIAL_GEOMETRY",
      },
      geometry: squareAt(0),
    },
  ];
  const districtCodes = [];
  for (let d = 1; d <= 21; d += 1) {
    const code = String(d).padStart(2, "0");
    districtCodes.push(code);
    features.push({
      type: "Feature",
      properties: {
        geography_level: "district",
        official_id: code,
        official_name: `District ${code}`,
        parent_id: "28079",
        parent_name: "Madrid",
        geometry_provenance: "OFFICIAL_GEOMETRY",
      },
      geometry: squareAt(d),
    });
  }
  for (let b = 0; b < 131; b += 1) {
    const parent = districtCodes[b % districtCodes.length];
    features.push({
      type: "Feature",
      properties: {
        geography_level: "barrio",
        official_id: `${parent}${String(b).padStart(3, "0")}`,
        official_name: `Barrio ${b}`,
        parent_id: parent,
        parent_name: `District ${parent}`,
        geometry_provenance: "OFFICIAL_GEOMETRY",
      },
      geometry: squareAt(b),
    });
  }
  return { type: "FeatureCollection", name: "madrid_admin", features };
}

function geographyMeta() {
  return {
    contract_version: "1.0.0",
    source_version: {
      published_version_exposed: true,
      geometry_effective_date_exposed: false,
      datasets: {
        district: { published_version: "v3.2.1", catalog_metadata_modified: "2026-07-27" },
        barrio: { published_version: "v3.4.1", catalog_metadata_modified: "2026-07-27" },
      },
    },
    retrieved_at: GENERATED_AT,
  };
}

// A population artifact whose barrio ids and parents are taken from the geography
// fixture, so the join universe lines up exactly. District and municipality
// totals are derived from the barrio values.
function populationArtifact() {
  const geo = geographyFeatureCollection();
  const barrios = geo.features.filter((f) => f.properties.geography_level === "barrio");
  const districts = geo.features.filter((f) => f.properties.geography_level === "district");
  const muni = geo.features.find((f) => f.properties.geography_level === "municipality");

  const barrioRecords = barrios.map((b, i) => ({
    geography_level: "barrio",
    official_id: b.properties.official_id,
    parent_id: b.properties.parent_id,
    residents: 1000 + i,
    residents_provenance: "SOURCE_REPORTED",
  }));

  const byDistrict = new Map();
  let municipalityTotal = 0;
  for (const b of barrioRecords) {
    byDistrict.set(b.parent_id, (byDistrict.get(b.parent_id) ?? 0) + b.residents);
    municipalityTotal += b.residents;
  }

  const records = [
    {
      geography_level: "municipality",
      official_id: muni.properties.official_id,
      parent_id: null,
      residents: municipalityTotal,
      residents_provenance: "DERIVED_FROM_BARRIO_POPULATION",
    },
    ...districts.map((d) => ({
      geography_level: "district",
      official_id: d.properties.official_id,
      parent_id: d.properties.parent_id,
      residents: byDistrict.get(d.properties.official_id) ?? 0,
      residents_provenance: "DERIVED_FROM_BARRIO_POPULATION",
    })),
    ...barrioRecords,
  ];

  return {
    contract_version: "1.0.0",
    source_period: { reference_date: "2026-01-01", label: "1 de enero de 2026", type: "padron_annual_reference_date", provisional: false },
    counts: { municipality: 1, districts: 21, barrios: 131 },
    records,
  };
}

function populationMeta() {
  return {
    contract_version: "1.0.0",
    source_period: { reference_date: "2026-01-01", type: "padron_annual_reference_date" },
    geography_linkage: { barrio_geography_version: "v3.4.1", district_geography_version: "v3.2.1" },
    retrieved_at: GENERATED_AT,
  };
}

function hospitalityArtifact() {
  const geo = geographyFeatureCollection();
  const barrios = geo.features.filter((f) => f.properties.geography_level === "barrio");
  const districts = geo.features.filter((f) => f.properties.geography_level === "district");
  const indicatorIds = [
    "source_included_premises_count",
    "core_hospitality_premises_count",
    "accommodation_class_premises_count",
    "core_hospitality_membership_share_of_populated_taxonomy_premises",
    "core_hospitality_premises_per_1000_residents",
  ];
  const values = (factor) => ({
    [indicatorIds[0]]: 100 * factor,
    [indicatorIds[1]]: 20 * factor,
    [indicatorIds[2]]: 5 * factor,
    [indicatorIds[3]]: 25,
    [indicatorIds[4]]: 4.5,
  });
  return {
    contract_version: "1.0.0",
    metadata: {
      generated_at: GENERATED_AT,
      premises_nominal_period: "2026-09",
      premises_sha256: "4ca33fed004b836d685aa55961adeca89fdedb8f333f3adc0e8abb8f7a4b87c1",
      activities_nominal_period: "2026-09",
      activities_sha256: "ba9279d6d187105b57889d30b4fe335fe5a60f5fe9efbf47425f46068f0d91a2",
      geography_version: { era: "CURRENT_131", district: "v3.2.1", barrio: "v3.4.1" },
      population_reference_date: "2026-01-01",
      population_artifact_sha256: "e6bc8a209927d2acdfd1f0489638d7996b8fed809624093436beafd78cfa8e08",
      selectable_indicator_ids: indicatorIds,
      default_indicator_id: "core_hospitality_premises_count",
      interpretation_ceiling: ["no pressure claims"],
      conditional_indicator: {
        indicator_id: "core_hospitality_premises_per_1000_residents",
        premises_period: "Sep 2026",
        population_date: "2026-01-01",
        denominator_type: "registered residents / Padron reference-date stock",
        interpretation_ceiling: "Not tourism pressure.",
      },
    },
    municipality: {
      "28079": { official_name: "Madrid", parent_id: null, indicators: values(131) },
    },
    districts: Object.fromEntries(
      districts.map((feature) => [
        feature.properties.official_id,
        { official_name: feature.properties.official_name, parent_id: "28079", indicators: values(6) },
      ])
    ),
    barrios: Object.fromEntries(
      barrios.map((feature) => [
        feature.properties.official_id,
        {
          official_name: feature.properties.official_name,
          parent_id: feature.properties.parent_id,
          indicators: values(1),
        },
      ])
    ),
  };
}

// A licensed-VUT numerator whose barrio ids and parents come from the geography
// fixture, carrying TWO independent counts per barrio with units never fewer
// than licences, and derived district and municipality totals. Some barrios
// carry a real published zero, which is valid for this source and must not be
// confused with missing data.
function vutArtifact() {
  const geo = geographyFeatureCollection();
  const barrios = geo.features.filter((f) => f.properties.geography_level === "barrio");
  const districts = geo.features.filter((f) => f.properties.geography_level === "district");
  const muni = geo.features.find((f) => f.properties.geography_level === "municipality");

  const barrioRecords = barrios.map((b, i) => {
    const licences = i % 4; // every fourth barrio is a genuine zero
    return {
      geography_level: "barrio",
      official_id: b.properties.official_id,
      parent_id: b.properties.parent_id,
      vut_licences: licences,
      vut_units: licences + (i % 3), // one licence may contain several units
      value_provenance: "DERIVED_FROM_LICENCE_RECORDS",
    };
  });

  const sum = (records, field) => records.reduce((total, r) => total + r[field], 0);
  const byDistrict = new Map();
  for (const b of barrioRecords) {
    const bucket = byDistrict.get(b.parent_id) ?? [];
    bucket.push(b);
    byDistrict.set(b.parent_id, bucket);
  }

  const records = [
    {
      geography_level: "municipality",
      official_id: muni.properties.official_id,
      parent_id: null,
      vut_licences: sum(barrioRecords, "vut_licences"),
      vut_units: sum(barrioRecords, "vut_units"),
      value_provenance: "DERIVED_FROM_BARRIO_TOTALS",
    },
    ...districts.map((d) => {
      const bucket = byDistrict.get(d.properties.official_id) ?? [];
      return {
        geography_level: "district",
        official_id: d.properties.official_id,
        parent_id: d.properties.parent_id,
        vut_licences: sum(bucket, "vut_licences"),
        vut_units: sum(bucket, "vut_units"),
        value_provenance: "DERIVED_FROM_BARRIO_TOTALS",
      };
    }),
    ...barrioRecords,
  ];

  return {
    contract_version: "1.0.0",
    source_state: {
      xlsx_http_last_modified: "Mon, 07 Sep 2026 10:11:03 GMT",
      http_last_modified_is_not_a_reference_date:
        "This is the HTTP Last-Modified header observed on the resource file, not a publisher-declared reference date.",
      grant_date_span: { earliest_grant_date: "2019-03-06", latest_grant_date: "2026-09-02" },
    },
    counts: {
      licences: sum(barrioRecords, "vut_licences"),
      vut_units: sum(barrioRecords, "vut_units"),
      barrios_with_at_least_one_licence: barrioRecords.filter((b) => b.vut_licences > 0).length,
      barrios: barrioRecords.length,
    },
    records,
  };
}

// The fixture's own totals. The real registry pins the REAL committed
// snapshot's totals (1025 licences / 1483 units), which the fixtures cannot
// reproduce, so testRegistry() re-aims the pin at these and the pin itself is
// exercised by its own tests plus the real-artifact run at the end of the file.
const VUT_FIXTURE_TOTALS = (() => {
  const artifact = vutArtifact();
  return { licences: artifact.counts.licences, units: artifact.counts.vut_units };
})();

// The sidecar's MINIMUM provenance contract, as a healthy build carries it.
// Every field below is one the user-facing disclosure reads, so the fixture
// states them rather than relying on the real file: the tests that follow strip
// one field at a time to prove each is genuinely required to publish.
function vutMeta() {
  return {
    contract_version: "1.0.0",
    source: {
      dataset: "Viviendas de uso turistico con licencia",
      authority: "Ayuntamiento de Madrid - Agencia de Actividades",
    },
    unit_of_analysis: {
      vut_units: "SUM of the source column 'N VUT': tourist-dwelling units included in each licence.",
    },
    universe: {
      currency_caveat:
        "The source carries no revocation, expiry or cessation field, so the extract cannot establish " +
        "current operation and must never be called 'operating VUT'.",
    },
    source_period: {
      reference_date_published_by_source: false,
      effective_date_published_by_source: false,
      xlsx_http_last_modified: "Mon, 07 Sep 2026 10:11:03 GMT",
    },
    geography_linkage: { barrio_geography_version: "v3.4.1", district_geography_version: "v3.2.1" },
    interpretation_ceiling:
      "A count of granted activity licences and the units they contain. NOT operating dwellings, NOT " +
      "all accommodation, NOT a measure of tourism pressure.",
    retrieved_at: GENERATED_AT,
  };
}

// A small but structurally complete destination series: contiguous months, a
// published residence split, one real zero and one suppressed month, so the
// healthy build exercises the destination validator the way the real artifact
// does. The real file is checked separately in "the committed evidence
// artifacts satisfy the real registry".
const DESTINATION_FIXTURE_MONTHS = 6;

function destinationObservations() {
  const records = [];
  for (let i = 0; i < DESTINATION_FIXTURE_MONTHS; i += 1) {
    const period = `2026-${String(i + 1).padStart(2, "0")}`;
    // Month 3 is suppressed by the publisher; month 4 is a real published zero.
    if (i === 2) {
      records.push({
        period,
        year: 2026,
        month: i + 1,
        travellers: null,
        overnight_stays: null,
        travellers_residents_spain: null,
        travellers_residents_abroad: null,
        status: "definitive",
        source_notes: ["Dato no disponible"],
      });
      continue;
    }
    const spain = i === 3 ? 0 : 400 + i;
    const abroad = i === 3 ? 0 : 600 + i;
    records.push({
      period,
      year: 2026,
      month: i + 1,
      travellers: spain + abroad,
      overnight_stays: (spain + abroad) * 2,
      travellers_residents_spain: spain,
      travellers_residents_abroad: abroad,
      status: i >= DESTINATION_FIXTURE_MONTHS - 2 ? "provisional" : "definitive",
    });
  }
  return records;
}

function destinationArtifact() {
  const observations = destinationObservations();
  const last = observations[observations.length - 1];
  return {
    contract_version: "1.0.0",
    geography: {
      source_term: "Punto turistico",
      source_value: "Madrid",
      level: "municipality",
      municipality_code: "28079",
      municipality_name: "Madrid",
      scope_note: "The whole municipality of Madrid. It describes no barrio and no Lens circle.",
    },
    source_period: {
      granularity: "month",
      earliest: observations[0].period,
      latest: last.period,
      latest_status: last.status,
      count: observations.length,
      semantics: "Each observation describes the calendar month named by its period.",
    },
    metrics: {
      travellers: { series: "EOT42434", unit: "travellers", provenance: "SOURCE_REPORTED" },
      overnight_stays: { series: "EOT42540", unit: "overnight stays", provenance: "SOURCE_REPORTED" },
      travellers_residents_spain: { series: "EOT2743", unit: "travellers", provenance: "SOURCE_REPORTED" },
      travellers_residents_abroad: { series: "EOT2744", unit: "travellers", provenance: "SOURCE_REPORTED" },
    },
    schema_fingerprint: "f".repeat(64),
    observations,
  };
}

// The minimum provenance a publishable Destination Context sidecar must carry.
// Kept complete here so each regression test below can remove exactly one field
// and assert that its absence alone blocks the deployment.
function destinationMeta() {
  return {
    contract_version: "1.0.0",
    source: {
      authority: "Instituto Nacional de Estadistica (INE)",
      survey: "Encuesta de Ocupacion Hotelera (EOH)",
      statistical_operation: 238,
      api: "Tempus3 JSON API",
    },
    geography: {
      source_term: "Punto turistico",
      source_value: "Madrid",
      resolved_level: "municipality",
      municipality_code: "28079",
      hard_gate_1: "PASS",
    },
    survey_definitions: {
      viajeros:
        "Persons making one or more consecutive overnight stays in the same establishment. " +
        "Counted per establishment stay, so this is not a count of unique people.",
    },
    schema_fingerprint: "f".repeat(64),
    retrieved_at: GENERATED_AT,
    interpretation_ceiling: "Hotel-sector demand only. NOT total tourism demand.",
  };
}

function healthyArtifacts() {
  const layers = {
    museum: poiRecords("museum", 3),
    info: poiRecords("info", 3),
    bike: poiRecords("bike", 3),
    rail: poiRecords("rail", 4, (i) => ({ mode: i < 3 ? "metro" : "cercanias" })),
    stay: poiRecords("stay", 3, () => ({
      stayKind: "hotel",
      accommodationCategory: "Hoteles",
    })),
    park: poiRecords("park", 3),
  };

  const status = {};
  for (const [id, records] of Object.entries(layers)) {
    status[id] = { ok: true, count: records.length, error: null };
  }
  status.stay.source = "Madrid Destino / esmadrid.com";

  return {
    "runtime_poi.json": {
      generatedAt: GENERATED_AT,
      sourceMode: "deployment-snapshot",
      layers,
      status,
      sources: {},
    },
    "pedestrian_activity.json": {
      available: true,
      generatedAt: GENERATED_AT,
      source: {
        dataset: "Madrid Open Data — Aforos de peatones y bicicletas",
        datasetUrl: "https://datos.madrid.es/dataset/300321-0-aforos-peatones-bicicletas",
        resourceUrl: "https://datos.madrid.es/dataset/300321-0-aforos-peatones-bicicletas/resource/x.csv",
        year: 2024,
      },
      latestPublishedQuarterMayBeProvisional: true,
      stations: poiRecords("pedestrian", 3, () => ({
        observationCount: 100,
        meanObserved: 500.5,
        dateMin: "2024-01-01",
        dateMax: "2024-06-30",
      })),
      stationCount: 3,
      observationCount: 300,
      dateMin: "2024-01-01",
      dateMax: "2024-06-30",
      error: null,
    },
    "hati_assets.json": poiRecords("heat", 3, () => ({
      utci_mean_10m: { "12:00": 35.1, "15:00": 40.2, "18:00": 38.3 },
    })),
    "hati_provenance.json": {
      source_commit_sha: "f02f5f6b6c5645adde94ae658bccbf9829e727e2",
      study_date: "2023-08-21",
    },
    "snapshot_poi.json": {
      museum: poiRecords("snap-museum", 2),
      info: poiRecords("snap-info", 2),
    },
    "geography/madrid_admin.geojson": geographyFeatureCollection(),
    "geography/madrid_admin.meta.json": geographyMeta(),
    "population/madrid_population.json": populationArtifact(),
    "population/madrid_population.meta.json": populationMeta(),
    "accommodation/madrid_vut_licences.json": vutArtifact(),
    "accommodation/madrid_vut_licences.meta.json": vutMeta(),
    "destination/madrid_hotel_demand.json": destinationArtifact(),
    "destination/madrid_hotel_demand.meta.json": destinationMeta(),
    "destination/madrid_domestic_origins.json": { source: { authority: "INE", source_url: "https://www.ine.es/experimental/turismo_moviles/exp_tmov_interno_mun_2026.xlsx", workbook_year: 2026, retrieved_at: GENERATED_AT }, source_universe: { residence: "Residents in Spain", trip_condition: "Travel to a province different from the province of residence", same_province_travel_excluded: true }, geography: { level: "municipality", municipality_code: "28079" }, source_period: { latest: "2026-01", available_months: ["2026-01"] }, suppression: { rule: "more than 30 tourists", absent_is_not_zero: "never materialised as zero" }, source_schema: ["mes", "mun_orig_cod", "mun_orig", "dest_cod", "dest", "turistas", "prov_orig_cod", "prov_orig", "prov_dest_cod", "prov_dest"], schema_fingerprint: "a".repeat(64), months: [{ source_month: "2026-01", published_origins: [{ origin_municipality_code: "01001", origin_municipality_name: "A", origin_province_code: "01", origin_province_name: "A", source_reported_tourists: 40 }, { origin_municipality_code: "08019", origin_municipality_name: "B", origin_province_code: "08", origin_province_name: "B", source_reported_tourists: 50 }] }] },
    "destination/madrid_domestic_origins.meta.json": { source: { authority: "INE", source_url: "https://www.ine.es/experimental/turismo_moviles/exp_tmov_interno_mun_2026.xlsx", workbook_year: 2026, retrieved_at: GENERATED_AT }, source_universe: { residence: "Residents in Spain", trip_condition: "Travel to a province different from the province of residence", same_province_travel_excluded: true }, schema_fingerprint: "a".repeat(64), geography: { municipality_code: "28079", resolved_level: "municipality", destination_corroboration: { dest: "Madrid", prov_dest_cod: "28", prov_dest: "Madrid" } } },
    "hospitality-commercial-context.json": hospitalityArtifact(),
  };
}

function run(artifacts, registry = testRegistry(), extra = {}) {
  return validateDeployment({ registry, artifacts, generatedAt: GENERATED_AT, ...extra });
}

function errorText(result) {
  return result.errors.join(" | ");
}

// ------------------------------------------------------------------ baseline

test("a healthy deployment build passes and reports every layer available", () => {
  const result = run(healthyArtifacts());
  assert.equal(errorText(result), "");
  assert.equal(result.ok, true);
  assert.equal(result.manifest.build_state, "pass");
  assert.equal(result.manifest.totals.layers_unavailable, 0);
  assert.equal(result.manifest.totals.operational_layers_available, 5);
});

test("domestic-origin integrity is progress-aware for one or seven published months", () => {
  const oneMonth = healthyArtifacts();
  assert.equal(errorText(run(oneMonth)), "");

  const sevenMonths = healthyArtifacts();
  const origins = sevenMonths["destination/madrid_domestic_origins.json"];
  origins.months = Array.from({ length: 7 }, (_, index) => {
    const source_month = `2026-${String(index + 1).padStart(2, "0")}`;
    return { ...clone(origins.months[0]), source_month };
  });
  origins.source_period = {
    latest: "2026-07",
    available_months: origins.months.map((month) => month.source_month),
  };
  assert.equal(errorText(run(sevenMonths)), "");
});

test("domestic-origin guards fail a near-empty month without weakening Madrid, source-universe or suppression gates", () => {
  const truncated = healthyArtifacts();
  truncated["destination/madrid_domestic_origins.json"].months[0].published_origins.pop();
  assert.match(errorText(run(truncated)), /per-published-month extraction floor/);

  const suppressed = healthyArtifacts();
  suppressed["destination/madrid_domestic_origins.json"].months[0].published_origins[0].source_reported_tourists = 30;
  assert.match(errorText(run(suppressed)), /invalid, suppressed or duplicate origin row/);

  const wrongMadrid = healthyArtifacts();
  wrongMadrid["destination/madrid_domestic_origins.json"].geography.municipality_code = "28080";
  assert.match(errorText(run(wrongMadrid)), /strictly Madrid municipality 28079/);

  const wrongUniverse = healthyArtifacts();
  wrongUniverse["destination/madrid_domestic_origins.json"].source_universe.same_province_travel_excluded = false;
  assert.match(errorText(run(wrongUniverse)), /province-different source universe/);
});

// ------------------------------------------------------------------ structure

test("hospitality administrative records require non-empty official names", () => {
  const artifacts = healthyArtifacts();
  const hospitality = artifacts["hospitality-commercial-context.json"];
  const barrioId = Object.keys(hospitality.barrios)[0];
  hospitality.barrios[barrioId].official_name = "";

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), new RegExp(`Hospitality & Commercial Context: barrio ${barrioId} has no official_name`));
});

test("a missing critical layer fails the build", () => {
  const artifacts = healthyArtifacts();
  delete artifacts["runtime_poi.json"].layers.stay;
  delete artifacts["runtime_poi.json"].status.stay;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /registry declares layer "stay" but the build did not emit it/);
});

test("a missing required top-level field fails the build", () => {
  const artifacts = healthyArtifacts();
  delete artifacts["runtime_poi.json"].sourceMode;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /required top-level field "sourceMode" is missing/);
});

test("layer and status names must agree", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].status.ghost = { ok: true, count: 0, error: null };

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /layer and status names disagree.*in status only: ghost/);
});

test("a declared count that disagrees with the actual records fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].status.museum.count = 99;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /declared count 99 does not equal the actual 3 record/);
});

test("a critical layer reported not ok fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].status.bike = { ok: false, count: 0, error: "HTTP 503" };
  artifacts["runtime_poi.json"].layers.bike = [];

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /BiciMAD stations: build reported the layer as unavailable.*HTTP 503/);
});

test("a critical layer that is ok but empty fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].layers.museum = [];
  artifacts["runtime_poi.json"].status.museum.count = 0;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /Museums: build reported ok but produced zero records/);
});

// ------------------------------------------------------------------ identifiers

test("duplicate ids fail where ids must be unique", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].layers.museum[1].id = artifacts["runtime_poi.json"].layers.museum[0].id;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /Museums: 1 duplicate id\(s\)/);
});

test("an unusable id fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].layers.info[0].id = "";

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /Tourist information points: 1 record\(s\) have no usable id/);
});

// ------------------------------------------------------------------ coordinates

test("a non-finite coordinate fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].layers.bike[0].lat = null;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /non-finite coordinate/);
});

test("a coordinate outside Madrid fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].layers.museum[0].lat = 41.39;
  artifacts["runtime_poi.json"].layers.museum[0].lon = 2.17; // Barcelona

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /Museums: 1 record\(s\) fall outside the declared spatial scope/);
});

test("null-island coordinates fail the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].layers.rail[0].lat = 0;
  artifacts["runtime_poi.json"].layers.rail[0].lon = 0;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /fall outside the declared spatial scope/);
});

test("swapped latitude and longitude fail the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].layers.stay[0].lat = LON;
  artifacts["runtime_poi.json"].layers.stay[0].lon = LAT;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /fall outside the declared spatial scope/);
});

// ------------------------------------------------------------------ collapse guardrail

test("a catastrophic count collapse fails an operational layer", () => {
  const registry = testRegistry();
  const bike = registry.sources.find((s) => s.id === "bike");
  bike.integrity_guardrail.min_count = 250;
  bike.integrity_guardrail.baseline_count = 631;

  const artifacts = healthyArtifacts();
  // A truncated response: parseable, non-empty, analytically collapsed.
  artifacts["runtime_poi.json"].layers.bike = poiRecords("bike", 30);
  artifacts["runtime_poi.json"].status.bike.count = 30;

  const result = run(artifacts, registry);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /BiciMAD stations: 30 record\(s\) is below the integrity guardrail of 250/);
  assert.match(errorText(result), /ingestion-collapse guardrail, not an analytical threshold/);
});

test("a count above the guardrail passes, so legitimate source change is tolerated", () => {
  const registry = testRegistry();
  const bike = registry.sources.find((s) => s.id === "bike");
  bike.integrity_guardrail.min_count = 250;

  const artifacts = healthyArtifacts();
  // Well below the 631 baseline but comfortably above the floor.
  artifacts["runtime_poi.json"].layers.bike = poiRecords("bike", 300);
  artifacts["runtime_poi.json"].status.bike.count = 300;

  const result = run(artifacts, registry);
  assert.equal(errorText(result), "");
  assert.equal(result.ok, true);
});

test("a collapse in an optional context layer warns but does not block deployment", () => {
  const registry = testRegistry();
  const park = registry.sources.find((s) => s.id === "park");
  park.integrity_guardrail.min_count = 30;

  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].layers.park = poiRecords("park", 2);
  artifacts["runtime_poi.json"].status.park.count = 2;

  const result = run(artifacts, registry);
  assert.equal(result.ok, true);
  assert.equal(result.manifest.build_state, "pass");
  assert.match(result.warnings.join(" | "), /below the integrity guardrail of 30/);
});

// ------------------------------------------------------------------ rail modes

test("rail missing a required mode fails even when the combined count looks healthy", () => {
  const artifacts = healthyArtifacts();
  // Cercanias silently disappears; the combined layer still has records.
  artifacts["runtime_poi.json"].layers.rail = poiRecords("rail", 10, () => ({ mode: "metro" }));
  artifacts["runtime_poi.json"].status.rail.count = 10;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /required mode "cercanias" has 0 record\(s\)/);
  assert.match(errorText(result), /can stay healthy while one mode silently disappears/);
});

test("the manifest records the rail mode split for audit", () => {
  const result = run(healthyArtifacts());
  const rail = result.manifest.layers.find((l) => l.source_id === "rail");
  assert.match(rail.warnings.join(" "), /mode split: metro=3, cercanias=1/);
});

// ------------------------------------------------------------------ accommodation authority

test("a non-authoritative accommodation source fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"].status.stay.source = "OpenStreetMap via Overpass API";

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /does not identify an authoritative source/);
  assert.match(errorText(result), /must not be published as the Madrid Destino accommodation deployment artifact/);
});

test("an accommodation artifact with no source attribution fails the build", () => {
  const artifacts = healthyArtifacts();
  delete artifacts["runtime_poi.json"].status.stay.source;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /does not identify an authoritative source/);
});

test("accommodation taxonomy disappearing fails the build", () => {
  const artifacts = healthyArtifacts();
  for (const record of artifacts["runtime_poi.json"].layers.stay) {
    delete record.accommodationCategory;
  }

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /record\(s\) carry accommodationCategory/);
});

test("accommodation collapsing to unclassified fails the build", () => {
  const artifacts = healthyArtifacts();
  for (const record of artifacts["runtime_poi.json"].layers.stay) {
    record.stayKind = "other";
  }

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /classified as "other".*above the .*guardrail/s);
});

// ------------------------------------------------------------------ pedestrian

test("pedestrian available with zero observations fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["pedestrian_activity.json"].observationCount = 0;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /available but observationCount is 0/);
});

test("pedestrian stationCount disagreeing with the station list fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["pedestrian_activity.json"].stationCount = 99;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /declared stationCount 99 does not equal the actual 3 station/);
});

test("incoherent pedestrian date bounds fail the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["pedestrian_activity.json"].dateMin = "2024-12-31";
  artifacts["pedestrian_activity.json"].dateMax = "2024-01-01";

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /incoherent date bounds/);
});

test("pedestrian losing its dataset identity fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["pedestrian_activity.json"].source.datasetUrl = "https://example.com/some-other-dataset";
  artifacts["pedestrian_activity.json"].source.resourceUrl = "https://example.com/some-other-dataset.csv";

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /does not reference the municipal pedestrian-counter dataset/);
});

test("a pedestrian station shipped with no observations fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["pedestrian_activity.json"].stations[0].observationCount = 0;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /station\(s\) carry no observations but are shipped as evidence/);
});

test("an explicit pedestrian unavailable state is allowed and does not block deployment", () => {
  const artifacts = healthyArtifacts();
  artifacts["pedestrian_activity.json"] = {
    available: false,
    generatedAt: null,
    source: {
      datasetUrl: "https://datos.madrid.es/dataset/300321-0-aforos-peatones-bicicletas",
      resourceUrl: "https://datos.madrid.es/dataset/300321-0-aforos-peatones-bicicletas/resource/x.csv",
    },
    stations: [],
    stationCount: 0,
    observationCount: 0,
    dateMin: null,
    dateMax: null,
    error: "source unreachable",
  };

  const result = run(artifacts);
  assert.equal(result.ok, true);
  assert.equal(result.manifest.build_state, "pass");

  const pedestrian = result.manifest.layers.find((l) => l.source_id === "pedestrian");
  assert.equal(pedestrian.state, "unavailable");
  assert.equal(pedestrian.record_count, 0);
  assert.equal(pedestrian.source_period, null);
  assert.match(result.warnings.join(" | "), /unavailable in this build \(source unreachable\)/);
});

test("an unavailable pedestrian layer carrying numeric evidence fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["pedestrian_activity.json"].available = false;
  artifacts["pedestrian_activity.json"].error = "source unreachable";
  // stations, stationCount, observationCount and dates left populated.

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /An unavailable layer must not carry numeric evidence/);
  assert.match(errorText(result), /marked unavailable but declares a date range; no period may be fabricated/);
});

test("an unavailable pedestrian layer must state a reason", () => {
  const artifacts = healthyArtifacts();
  artifacts["pedestrian_activity.json"] = {
    available: false,
    stations: [],
    stationCount: 0,
    observationCount: 0,
    dateMin: null,
    dateMax: null,
    error: "",
  };

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /marked unavailable without stating a reason/);
});

test("a non-boolean pedestrian availability flag fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["pedestrian_activity.json"].available = "yes";

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /"available" must be an explicit boolean/);
});

// ------------------------------------------------------------------ committed evidence

test("HATI evidence shrinking below its locked pilot size fails the build", () => {
  const registry = testRegistry();
  registry.sources.find((s) => s.id === "hati").integrity_guardrail.min_count = 14;

  const artifacts = healthyArtifacts();
  artifacts["hati_assets.json"] = poiRecords("heat", 3, () => ({ utci_mean_10m: { "15:00": 40 } }));

  const result = run(artifacts, registry);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /below the locked pilot size of 14/);
});

test("HATI evidence without a pinned source commit fails the build", () => {
  const artifacts = healthyArtifacts();
  delete artifacts["hati_provenance.json"].source_commit_sha;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /no source_commit_sha, so the evidence is not traceable to a commit/);
});

test("an emptied packaged fallback fails the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["snapshot_poi.json"] = { museum: [], info: [] };

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /packaged last-resort fallback must not silently become empty/);
});

// ------------------------------------------------------------------ manifest contract

test("generated_at and source_period stay separate concepts", () => {
  const result = run(healthyArtifacts());

  for (const layer of result.manifest.layers) {
    if (layer.source_period) {
      assert.notEqual(layer.source_period.from, result.manifest.generated_at);
      assert.notEqual(layer.source_period.to, result.manifest.generated_at);
    }
  }

  // Sources that publish no period must report null rather than a build clock.
  for (const id of ["museum", "info", "bike", "rail", "stay", "park"]) {
    const layer = result.manifest.layers.find((l) => l.source_id === id);
    assert.equal(layer.source_period, null, `${id} must not claim a source period`);
    assert.equal(layer.source_period_known, false);
  }
});

test("pedestrian and HATI source periods come from the evidence, not the build", () => {
  const result = run(healthyArtifacts());

  const pedestrian = result.manifest.layers.find((l) => l.source_id === "pedestrian");
  assert.deepEqual(pedestrian.source_period, {
    from: "2024-01-01",
    to: "2024-06-30",
    type: "observed_record_range",
    provisional: true,
  });
  assert.equal(pedestrian.source_period_known, true);

  const hati = result.manifest.layers.find((l) => l.source_id === "hati");
  assert.equal(hati.source_period.from, "2023-08-21");
  assert.equal(hati.source_period.type, "modelled_pilot_day");
  assert.equal(hati.evidence_type, "MODEL-DERIVED");
});

test("the manifest carries authority, builder and interpretation ceiling for every layer", () => {
  const result = run(healthyArtifacts());

  for (const layer of result.manifest.layers) {
    assert.ok(layer.authority, `${layer.source_id} must record an authority`);
    assert.ok(layer.builder, `${layer.source_id} must record a builder`);
    assert.ok(layer.interpretation_ceiling, `${layer.source_id} must record an interpretation ceiling`);
    assert.ok(["available", "unavailable"].includes(layer.state));
  }
});

test("the manifest never carries a secret", () => {
  const result = run(healthyArtifacts());
  const serialised = JSON.stringify(result.manifest);
  assert.doesNotMatch(serialised, /CARTO_BASEMAP_KEY/i);
  assert.doesNotMatch(serialised, /\bsecret\b/i);
  assert.doesNotMatch(serialised, /\btoken\b/i);
  assert.doesNotMatch(serialised, /api[_-]?key/i);
});

test("a failed build still produces a manifest, so failures are auditable", () => {
  const artifacts = healthyArtifacts();
  delete artifacts["runtime_poi.json"].layers.museum;
  delete artifacts["runtime_poi.json"].status.museum;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.equal(result.manifest.build_state, "fail");
  assert.ok(result.manifest.validation.error_count > 0);
  assert.equal(result.manifest.layers.length, REAL_REGISTRY.sources.length);
});

test("a missing runtime_poi.json reports how to build it instead of crashing", () => {
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"] = null;

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /Run the deployment builders first/);
});

// ------------------------------------------------------------------ build-step outcome

test("a failed build step blocks deployment even when the artifacts look healthy", () => {
  // The decisive case: a build step can fail after writing complete-looking
  // artifacts. The artifacts must not be allowed to vouch for the build.
  const result = run(healthyArtifacts(), testRegistry(), { buildStepOutcome: "failure" });

  assert.equal(result.ok, false);
  assert.equal(result.manifest.build_state, "fail");
  assert.equal(result.manifest.build_step_outcome, "failure");
  assert.match(errorText(result), /the data build step reported "failure"/);
  assert.match(errorText(result), /must not be published from an incomplete or failed build/);
});

test("a failed build step still produces a manifest describing every layer", () => {
  // What makes a build failure auditable: the manifest exists and is complete.
  const artifacts = healthyArtifacts();
  artifacts["runtime_poi.json"] = null;

  const result = run(artifacts, testRegistry(), { buildStepOutcome: "failure" });

  assert.equal(result.manifest.build_state, "fail");
  assert.equal(result.manifest.build_step_outcome, "failure");
  assert.equal(result.manifest.layers.length, REAL_REGISTRY.sources.length);
  assert.ok(result.manifest.validation.error_count > 0);
  // The committed evidence is still reported, so the manifest shows what survived.
  assert.equal(result.manifest.layers.find((l) => l.source_id === "hati").state, "available");
});

test("a successful build step does not add an error of its own", () => {
  const result = run(healthyArtifacts(), testRegistry(), { buildStepOutcome: "success" });
  assert.equal(errorText(result), "");
  assert.equal(result.manifest.build_step_outcome, "success");
});

test("a skipped or cancelled build step blocks deployment", () => {
  for (const outcome of ["skipped", "cancelled"]) {
    const result = run(healthyArtifacts(), testRegistry(), { buildStepOutcome: outcome });
    assert.equal(result.ok, false, `outcome "${outcome}" must block`);
    assert.match(errorText(result), new RegExp(`build step reported "${outcome}"`));
  }
});

test("running outside the workflow records no build outcome and does not invent one", () => {
  const result = run(healthyArtifacts());
  assert.equal(result.manifest.build_step_outcome, null);
  assert.equal(result.ok, true);
});

// ------------------------------------------------------------------ provenance state

test("the manifest labels each layer's provenance state", () => {
  const result = run(healthyArtifacts());
  const stateOf = (id) => result.manifest.layers.find((l) => l.source_id === id).provenance_state;

  for (const id of ["museum", "info", "bike", "rail", "stay", "park", "pedestrian"]) {
    assert.equal(stateOf(id), "deployment_snapshot", `${id} is rebuilt at deploy time`);
  }
  assert.equal(stateOf("hati"), "committed_research_evidence");
  assert.equal(stateOf("snapshot_fallback"), "packaged_sample");
});

test("the geography carries no fabricated source period; its published version is surfaced", () => {
  const result = run(healthyArtifacts());
  const geography = result.manifest.layers.find((l) => l.source_id === "geography");

  // A catalogue metadata-modified date must never be turned into a geometry
  // vintage: the geography exposes no effective date, so it has no source period.
  assert.equal(geography.source_period, null);
  assert.equal(geography.source_period_known, false);
  assert.doesNotMatch(JSON.stringify(result.manifest), /administrative_geography_edition/);

  // The authoritative published dataset version is what identifies the edition.
  assert.ok(
    geography.warnings.some((w) => /published version:.*v3\.2\.1.*v3\.4\.1/.test(w)),
    "the manifest should surface the published district/barrio versions"
  );
});

test("the population layer carries a source-derived reference period and derived totals", () => {
  const result = run(healthyArtifacts());
  const population = result.manifest.layers.find((l) => l.source_id === "population");

  assert.equal(population.role, "reference");
  assert.equal(population.evidence_type, "ADMINISTRATIVE_REGISTER");
  assert.equal(population.blocks_deployment, true);
  assert.equal(population.state, "available");

  // The period is the source reference date, not the build clock.
  assert.equal(population.source_period_known, true);
  assert.equal(population.source_period.from, "2026-01-01");
  assert.equal(population.source_period.type, "padron_annual_reference_date");

  // The manifest states the geography version the population joins against.
  assert.ok(
    population.warnings.some((w) => /period 2026-01-01 joined to barrio geography v3\.4\.1/.test(w)),
    "the manifest should record the population period and the geography version it joins"
  );
});

test("a population artifact whose totals disagree with the barrio sums blocks the deployment", () => {
  const artifacts = healthyArtifacts();
  // Corrupt the municipality total so it no longer equals the barrio sum.
  const pop = artifacts["population/madrid_population.json"];
  pop.records.find((r) => r.geography_level === "municipality").residents += 1;
  const result = run(artifacts);
  // Now that the Area Profile publishes resident figures, an incoherent
  // denominator withholds the site instead of being noted in passing.
  assert.equal(result.ok, false);
  assert.match(errorText(result), /municipality total .* does not equal the sum of the barrios/);
});

test("a broken geography or population artifact cannot be published", () => {
  // The decisive consequence of the contract change: the Area Profile is a
  // user-facing feature, so its two reference artifacts are now publication
  // gates rather than test-suite-only contracts.
  const missingGeography = healthyArtifacts();
  missingGeography["geography/madrid_admin.geojson"] = null;
  const withoutGeography = run(missingGeography);
  assert.equal(withoutGeography.ok, false);
  assert.match(errorText(withoutGeography), /is missing or is not a GeoJSON FeatureCollection/);

  const missingPopulation = healthyArtifacts();
  missingPopulation["population/madrid_population.json"] = null;
  const withoutPopulation = run(missingPopulation);
  assert.equal(withoutPopulation.ok, false);
  assert.match(errorText(withoutPopulation), /is missing or has no records array/);

  // A barrio silently dropped from the geography is the quiet failure that
  // would otherwise publish a Lens that cannot name where it is.
  const truncated = healthyArtifacts();
  const geography = truncated["geography/madrid_admin.geojson"];
  const droppedBarrio = geography.features.find((f) => f.properties.geography_level === "barrio")
    .properties.official_id;
  geography.features = geography.features.filter(
    (f) => f.properties.official_id !== droppedBarrio
  );
  const withTruncatedGeography = run(truncated);
  assert.equal(withTruncatedGeography.ok, false);
  assert.match(errorText(withTruncatedGeography), /administrative division/);

  // And a barrio left without a resident count must not be published either.
  const gap = healthyArtifacts();
  gap["population/madrid_population.json"].records = gap[
    "population/madrid_population.json"
  ].records.filter((r) => !(r.geography_level === "barrio" && r.official_id === droppedBarrio));
  const withPopulationGap = run(gap);
  assert.equal(withPopulationGap.ok, false);
  assert.match(errorText(withPopulationGap), /has no population value|expected \d+ barrio/);
});

// ----------------------------------------- committed licensed-VUT numerator
//
// The gate exists because the failure mode is a PLAUSIBLE WRONG NUMBER, not an
// empty panel: the interface reports these counts and a ratio derived from them.

test("a missing or malformed licensed-VUT artifact cannot be published", () => {
  for (const broken of [null, {}, { records: "not-an-array" }, { records: [] }]) {
    const artifacts = healthyArtifacts();
    artifacts["accommodation/madrid_vut_licences.json"] = broken;
    const result = run(artifacts);
    assert.equal(result.ok, false, `a ${JSON.stringify(broken)} artifact must block the build`);
  }

  const missing = healthyArtifacts();
  missing["accommodation/madrid_vut_licences.json"] = null;
  const result = run(missing);
  assert.match(errorText(result), /is missing or has no records array/);

  // The layer is reported unavailable in the manifest rather than reported as a
  // healthy layer holding zero licensed units.
  const layer = result.manifest.layers.find((l) => l.source_id === "vut_licences");
  assert.equal(layer.state, "unavailable");
  assert.equal(layer.record_count, 0);
});

test("a barrio with no licensed-VUT record cannot be published as a gap", () => {
  const artifacts = healthyArtifacts();
  const vut = artifacts["accommodation/madrid_vut_licences.json"];
  const dropped = vut.records.find((r) => r.geography_level === "barrio");
  vut.records = vut.records.filter((r) => r !== dropped);
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /has no licensed-VUT record|expected \d+ barrios? licence record/);
});

test("a licensed-VUT record outside the canonical geography cannot be published", () => {
  const artifacts = healthyArtifacts();
  const vut = artifacts["accommodation/madrid_vut_licences.json"];
  vut.records.find((r) => r.geography_level === "barrio").official_id = "999";
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /is not a canonical barrio/);
});

test("licence and unit counts must be coherent non-negative integers", () => {
  for (const [field, value, pattern] of [
    ["vut_units", -1, /invalid vut_units/],
    ["vut_units", 2.5, /invalid vut_units/],
    ["vut_units", "7", /invalid vut_units/],
    ["vut_licences", null, /invalid vut_licences/],
  ]) {
    const artifacts = healthyArtifacts();
    const vut = artifacts["accommodation/madrid_vut_licences.json"];
    vut.records.find((r) => r.geography_level === "barrio")[field] = value;
    const result = run(artifacts);
    assert.equal(result.ok, false, `${field}=${value} must block the build`);
    assert.match(errorText(result), pattern);
  }
});

test("more licences than units means the two columns were confused, and blocks", () => {
  // One licence contains one or more dwelling units, so units below licences is
  // structurally impossible and would silently rename the indicator.
  const artifacts = healthyArtifacts();
  const vut = artifacts["accommodation/madrid_vut_licences.json"];
  const barrio = vut.records.find((r) => r.geography_level === "barrio" && r.vut_licences > 0);
  barrio.vut_units = barrio.vut_licences - 1;
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /units can never be fewer than licences/);
});

test("licensed-VUT aggregates must be exact sums of the barrios, for both counts", () => {
  for (const field of ["vut_licences", "vut_units"]) {
    const districtBroken = healthyArtifacts();
    const districtRecord = districtBroken["accommodation/madrid_vut_licences.json"].records.find(
      (r) => r.geography_level === "district"
    );
    districtRecord[field] += 1;
    const district = run(districtBroken);
    assert.equal(district.ok, false);
    assert.match(errorText(district), new RegExp(`district .* ${field} total`));

    const muniBroken = healthyArtifacts();
    const muniRecord = muniBroken["accommodation/madrid_vut_licences.json"].records.find(
      (r) => r.geography_level === "municipality"
    );
    muniRecord[field] += 1;
    const municipality = run(muniBroken);
    assert.equal(municipality.ok, false);
    assert.match(errorText(municipality), new RegExp(`municipality ${field} total`));
  }
});

test("declared headline counts must agree with the licensed-VUT records", () => {
  const artifacts = healthyArtifacts();
  artifacts["accommodation/madrid_vut_licences.json"].counts.vut_units += 10;
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /declared \d+ unit\(s\) but the records sum to/);
});

test("a silent change to the committed snapshot's totals blocks the build", () => {
  // The pinned totals make a partial or accidental regeneration a visible
  // failure. A DELIBERATE refresh updates the artifact and the pin together.
  const artifacts = healthyArtifacts();
  const vut = artifacts["accommodation/madrid_vut_licences.json"];
  const barrio = vut.records.find((r) => r.geography_level === "barrio" && r.vut_licences > 0);
  const delta = barrio.vut_licences;
  barrio.vut_licences = 0;
  barrio.vut_units -= delta;
  // Re-derive the aggregates and the headline so ONLY the pin disagrees.
  for (const field of ["vut_licences", "vut_units"]) {
    const barrios = vut.records.filter((r) => r.geography_level === "barrio");
    for (const district of vut.records.filter((r) => r.geography_level === "district")) {
      district[field] = barrios
        .filter((b) => b.parent_id === district.official_id)
        .reduce((total, b) => total + b[field], 0);
    }
    const total = barrios.reduce((sum, b) => sum + b[field], 0);
    vut.records.find((r) => r.geography_level === "municipality")[field] = total;
    vut.counts[field === "vut_licences" ? "licences" : "vut_units"] = total;
  }

  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /but the registry pins/);
  assert.match(errorText(result), /update expected_source_totals in the same reviewed pull request/);
});

test("licensed-VUT provenance flags must stay derived, never source-reported", () => {
  const barrioFlag = healthyArtifacts();
  barrioFlag["accommodation/madrid_vut_licences.json"].records.find(
    (r) => r.geography_level === "barrio"
  ).value_provenance = "SOURCE_REPORTED";
  const barrio = run(barrioFlag);
  assert.equal(barrio.ok, false);
  assert.match(errorText(barrio), /must be flagged DERIVED_FROM_LICENCE_RECORDS/);

  const aggregateFlag = healthyArtifacts();
  aggregateFlag["accommodation/madrid_vut_licences.json"].records.find(
    (r) => r.geography_level === "district"
  ).value_provenance = "DERIVED_FROM_LICENCE_RECORDS";
  const aggregate = run(aggregateFlag);
  assert.equal(aggregate.ok, false);
  assert.match(errorText(aggregate), /must be flagged DERIVED_FROM_BARRIO_TOTALS/);
});

test("a population or a ratio appearing on a licence record blocks the build", () => {
  // Field creep here is a semantic failure, not untidiness: the numerator
  // artifact must never carry a denominator or a derived rate.
  for (const field of ["residents", "licensed_vut_per_1000_residents", "ratio"]) {
    const artifacts = healthyArtifacts();
    artifacts["accommodation/madrid_vut_licences.json"].records.find(
      (r) => r.geography_level === "barrio"
    )[field] = 1;
    const result = run(artifacts);
    assert.equal(result.ok, false, `${field} must not be admitted onto a licence record`);
    assert.match(errorText(result), new RegExp(`carries unexpected field\\(s\\): ${field}`));
  }
});

test("the licensed-VUT layer never acquires a source period, and says why", () => {
  const { manifest } = run(healthyArtifacts());
  const layer = manifest.layers.find((l) => l.source_id === "vut_licences");

  // The decisive assertion: the HTTP header is NOT promoted into a period.
  assert.equal(layer.source_period, null);
  assert.equal(layer.source_period_known, false);
  assert.match(layer.source_period_semantics, /declares NO reference date and NO effective date/);

  // It is reported as a file state, named as such, in the audit lines.
  const audit = layer.warnings.join(" | ");
  assert.match(audit, /source file state \(HTTP Last-Modified, not a reference date\)/);
  assert.match(audit, /licence grant dates span 2019-03-06 to 2026-09-02/);
  assert.match(audit, /the residential denominator keeps its own separate reference date/);

  // The denominator still carries its own real reference date, separately.
  const population = manifest.layers.find((l) => l.source_id === "population");
  assert.equal(population.source_period.from, "2026-01-01");
  assert.notEqual(population.source_period, layer.source_period);
});

test("an artifact that drops the not-a-reference-date disclaimer blocks the build", () => {
  const artifacts = healthyArtifacts();
  delete artifacts["accommodation/madrid_vut_licences.json"].source_state
    .http_last_modified_is_not_a_reference_date;
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /must never be published as a publisher-declared reference date/);
});

test("a sidecar claiming a publisher-declared reference or effective date blocks the build", () => {
  // The load-bearing pair. A sidecar that claimed either date would licence the
  // interface to print one for a source that declares neither.
  for (const flag of ["reference_date_published_by_source", "effective_date_published_by_source"]) {
    for (const claimed of [true, "2026-09-07", null, undefined]) {
      const artifacts = healthyArtifacts();
      artifacts["accommodation/madrid_vut_licences.meta.json"].source_period[flag] = claimed;
      const result = run(artifacts);
      assert.equal(result.ok, false, `${flag} = ${claimed} must block the build`);
      assert.match(errorText(result), new RegExp(`must record source_period\\.${flag} as false`));
      assert.match(errorText(result), /the project must not invent one/);
    }
  }
});

// ------------------------------- the licensed-VUT sidecar is a publication gate
//
// The sidecar carries the provenance the user-facing disclosure reads to say
// what the figure counts and what it does not mean. Publishing the indicator
// without it would put a number on screen that the product cannot qualify, so
// it blocks deployment exactly as a broken artifact does. It is NOT a warning.

test("a missing licensed-VUT sidecar blocks the build", () => {
  const artifacts = healthyArtifacts();
  artifacts["accommodation/madrid_vut_licences.meta.json"] = null;
  const result = run(artifacts);

  assert.equal(result.ok, false, "a missing sidecar must not be publishable");
  assert.match(errorText(result), /is missing or is not an object/);
  assert.match(errorText(result), /what it counts - and what it does not mean - is required to publish it/);

  // It is an ERROR, not a warning: the distinction is the whole point.
  assert.ok(
    !result.warnings.some((w) => /madrid_vut_licences\.meta\.json/.test(w)),
    "the missing sidecar must not be reported as a mere warning"
  );
});

test("a malformed licensed-VUT sidecar blocks the build", () => {
  for (const malformed of ["", "not json", 42, [], true]) {
    const artifacts = healthyArtifacts();
    artifacts["accommodation/madrid_vut_licences.meta.json"] = malformed;
    const result = run(artifacts);
    assert.equal(result.ok, false, `a ${JSON.stringify(malformed)} sidecar must block the build`);
    assert.match(errorText(result), /is missing or is not an object/);
  }
});

test("a sidecar missing the dataset or the authority blocks the build", () => {
  for (const [path, mutate, pattern] of [
    ["source.dataset", (m) => delete m.source.dataset, /no usable source\.dataset/],
    ["source.authority", (m) => delete m.source.authority, /no usable source\.authority/],
    ["source", (m) => delete m.source, /no usable source\.dataset/],
    ["source.dataset (blank)", (m) => (m.source.dataset = "   "), /no usable source\.dataset/],
  ]) {
    const artifacts = healthyArtifacts();
    mutate(artifacts["accommodation/madrid_vut_licences.meta.json"]);
    const result = run(artifacts);
    assert.equal(result.ok, false, `${path} must be required`);
    assert.match(errorText(result), pattern);
  }
  // And the reason is stated, not just the field name.
  const artifacts = healthyArtifacts();
  delete artifacts["accommodation/madrid_vut_licences.meta.json"].source.authority;
  assert.match(errorText(run(artifacts)), /names the authority that publishes it/);
});

test("a sidecar missing the unit definition blocks the build", () => {
  // Without it the disclosure cannot say what one "unit" is - and a licence is
  // not a dwelling, which is the distinction this whole indicator turns on.
  for (const mutate of [
    (m) => delete m.unit_of_analysis.vut_units,
    (m) => delete m.unit_of_analysis,
    (m) => (m.unit_of_analysis.vut_units = ""),
  ]) {
    const artifacts = healthyArtifacts();
    mutate(artifacts["accommodation/madrid_vut_licences.meta.json"]);
    const result = run(artifacts);
    assert.equal(result.ok, false);
    assert.match(errorText(result), /no usable unit_of_analysis\.vut_units, which defines what one unit is/);
  }
});

test("a sidecar missing the currency or operation caveat blocks the build", () => {
  for (const mutate of [
    (m) => delete m.universe.currency_caveat,
    (m) => delete m.universe,
    (m) => (m.universe.currency_caveat = "  "),
  ]) {
    const artifacts = healthyArtifacts();
    mutate(artifacts["accommodation/madrid_vut_licences.meta.json"]);
    const result = run(artifacts);
    assert.equal(result.ok, false);
    assert.match(
      errorText(result),
      /no usable universe\.currency_caveat, which records that the extract cannot establish current operation/
    );
  }
});

test("a sidecar missing the interpretation ceiling blocks the build", () => {
  const artifacts = healthyArtifacts();
  delete artifacts["accommodation/madrid_vut_licences.meta.json"].interpretation_ceiling;
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /no usable interpretation_ceiling, which states what the figure is not/);
});

test("a sidecar without a usable geography linkage blocks the build", () => {
  for (const mutate of [
    (m) => delete m.geography_linkage.barrio_geography_version,
    (m) => delete m.geography_linkage,
    (m) => (m.geography_linkage.barrio_geography_version = ""),
  ]) {
    const artifacts = healthyArtifacts();
    mutate(artifacts["accommodation/madrid_vut_licences.meta.json"]);
    const result = run(artifacts);
    assert.equal(result.ok, false);
    assert.match(errorText(result), /no usable geography_linkage\.barrio_geography_version/);
  }
});

// ------------------------------------------- destination context provenance
//
// The sidecar is a DEPLOYMENT CONTRACT, not documentation that happens to sit
// beside the data. These figures are user-facing official statistics, so the
// provenance that states what they measure - and what they do not mean - is part
// of what makes publishing them defensible. Every failure below is an ERROR, not
// a warning, and runtime graceful degradation is a separate concern asserted
// elsewhere.

const DEST_META = "destination/madrid_hotel_demand.meta.json";

test("a missing destination sidecar blocks the build", () => {
  const artifacts = healthyArtifacts();
  artifacts[DEST_META] = null;
  const result = run(artifacts);

  assert.equal(result.ok, false, "a missing sidecar must not be publishable");
  assert.match(errorText(result), /is missing or is not an object/);
  assert.match(errorText(result), /what they measure - and what they do not mean - is required/);

  // It is an ERROR, not a warning: the distinction is the whole point.
  assert.ok(
    !result.warnings.some((w) => /madrid_hotel_demand\.meta\.json/.test(w)),
    "the missing sidecar must not be reported as a mere warning"
  );
});

test("a malformed destination sidecar blocks the build", () => {
  for (const malformed of ["", "not json", 42, [], true]) {
    const artifacts = healthyArtifacts();
    artifacts[DEST_META] = malformed;
    const result = run(artifacts);
    assert.equal(result.ok, false, `a ${JSON.stringify(malformed)} sidecar must block the build`);
    assert.match(errorText(result), /is missing or is not an object/);
  }
});

test("a destination sidecar missing any required provenance field blocks the build", () => {
  for (const [name, mutate, pattern] of [
    ["source.authority", (m) => delete m.source.authority, /no usable source\.authority/],
    ["source.survey", (m) => delete m.source.survey, /no usable source\.survey/],
    ["source.api", (m) => delete m.source.api, /no usable source\.api/],
    ["source (whole)", (m) => delete m.source, /no usable source\.authority/],
    ["source.authority blank", (m) => (m.source.authority = "   "), /no usable source\.authority/],
    [
      "geography.source_term",
      (m) => delete m.geography.source_term,
      /no usable geography\.source_term/,
    ],
    [
      "geography.source_value",
      (m) => delete m.geography.source_value,
      /no usable geography\.source_value/,
    ],
    [
      "survey_definitions.viajeros",
      (m) => delete m.survey_definitions.viajeros,
      /no usable survey_definitions\.viajeros/,
    ],
    [
      "survey_definitions (whole)",
      (m) => delete m.survey_definitions,
      /no usable survey_definitions\.viajeros/,
    ],
    [
      "interpretation_ceiling",
      (m) => delete m.interpretation_ceiling,
      /no usable interpretation_ceiling/,
    ],
    ["retrieved_at", (m) => delete m.retrieved_at, /no usable retrieved_at/],
    ["schema_fingerprint", (m) => delete m.schema_fingerprint, /no usable schema_fingerprint/],
  ]) {
    const artifacts = healthyArtifacts();
    mutate(artifacts[DEST_META]);
    const result = run(artifacts);
    assert.equal(result.ok, false, `a sidecar without ${name} must block the build`);
    assert.match(errorText(result), pattern, `missing ${name} must be reported by name`);
  }
});

test("a destination sidecar naming the wrong statistical operation blocks the build", () => {
  // THE central guard. Operations 238 and 239 publish series with identical
  // names through the same dimension, and the 239 values are roughly fifteen
  // times smaller. Provenance that names a different survey than the pinned one
  // means the artifact and its documentation disagree about which survey
  // produced the numbers.
  for (const wrong of [239, 180, "238", null, undefined]) {
    const artifacts = healthyArtifacts();
    artifacts[DEST_META].source.statistical_operation = wrong;
    const result = run(artifacts);
    assert.equal(result.ok, false, `operation ${JSON.stringify(wrong)} must block the build`);
    assert.match(errorText(result), /declares statistical operation/);
    assert.match(errorText(result), /the registry pins 238/);
  }

  // And the reason is spelled out, so a reviewer meeting this failure for the
  // first time learns what it is protecting against.
  const artifacts = healthyArtifacts();
  artifacts[DEST_META].source.statistical_operation = 239;
  assert.match(errorText(run(artifacts)), /Operation 239 publishes identically named series/);
});

test("the registry must pin an expected operation id for the destination series", () => {
  // Without the pin there is nothing to check the sidecar against, which would
  // silently disable the survey-identity guard.
  const registry = testRegistry();
  const source = registry.sources.find((s) => s.id === "hotel_demand");
  delete source.expected_operation_id;
  const result = run(healthyArtifacts(), registry);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /declares no expected_operation_id/);

  // The real registry carries it.
  assert.equal(REAL_REGISTRY.sources.find((s) => s.id === "hotel_demand").expected_operation_id, 238);
});

test("a destination sidecar with the wrong geography blocks the build", () => {
  for (const [name, mutate, pattern] of [
    [
      "a different municipality",
      (m) => (m.geography.municipality_code = "08019"),
      /records municipality "08019", but the registry declares 28079/,
    ],
    [
      "no municipality code",
      (m) => delete m.geography.municipality_code,
      /records municipality undefined, but the registry declares 28079/,
    ],
    [
      "a sub-municipal level",
      (m) => (m.geography.resolved_level = "barrio"),
      /records geography\.resolved_level "barrio", not "municipality"/,
    ],
    [
      "no resolved level",
      (m) => delete m.geography.resolved_level,
      /not "municipality"/,
    ],
    [
      "geography removed entirely",
      (m) => delete m.geography,
      /not "municipality"/,
    ],
  ]) {
    const artifacts = healthyArtifacts();
    mutate(artifacts[DEST_META]);
    const result = run(artifacts);
    assert.equal(result.ok, false, `${name} must block the build`);
    assert.match(errorText(result), pattern);
  }
});

test("a destination sidecar whose geography gate has not passed blocks the build", () => {
  for (const state of ["CONDITIONAL", "FAIL", "", undefined, "pass"]) {
    const artifacts = healthyArtifacts();
    artifacts[DEST_META].geography.hard_gate_1 = state;
    const result = run(artifacts);
    assert.equal(result.ok, false, `hard_gate_1 ${JSON.stringify(state)} must block the build`);
    assert.match(errorText(result), /records geography\.hard_gate_1 as/);
    assert.match(errorText(result), /would put an unverified claim in front of the reader/);
  }
});

test("a destination sidecar that does not describe the committed series blocks the build", () => {
  const artifacts = healthyArtifacts();
  artifacts[DEST_META].schema_fingerprint = "a".repeat(64);
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /schema fingerprints disagree/);
  assert.match(errorText(result), /the provenance does not describe the committed series/);

  // Reported once, not twice.
  const matches = result.errors.filter((e) => /fingerprints disagree/.test(e));
  assert.equal(matches.length, 1, "a fingerprint mismatch must be reported as a single failure");
});

test("a healthy destination sidecar publishes, and the real committed one passes", () => {
  // The fixture, complete, is publishable.
  assert.equal(run(healthyArtifacts()).ok, true);

  // And so is the real committed sidecar, against the real registry: the gate
  // above is only useful if it is satisfied by what this repository ships.
  const committedRegistry = {
    ...REAL_REGISTRY,
    sources: REAL_REGISTRY.sources.filter((s) => s.id === "hotel_demand"),
  };
  const { errors } = validateDeployment({
    registry: committedRegistry,
    artifacts: readArtifacts(fileURLToPath(new URL("../data/", import.meta.url))),
    generatedAt: GENERATED_AT,
  });
  assert.deepEqual(errors, [], `the committed destination sidecar must validate: ${errors.join(" | ")}`);
});

test("counts joined to a different barrio geography than the one shipped block the build", () => {
  // A numerator resolved against boundaries that have since moved is the
  // quiet mis-join this check exists to catch.
  const artifacts = healthyArtifacts();
  artifacts["accommodation/madrid_vut_licences.meta.json"].geography_linkage.barrio_geography_version = "v3.3.0";
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /resolved against barrio geography v3\.3\.0, but the committed geography ships v3\.4\.1/);
  assert.match(errorText(result), /Re-run the builder against the current geography/);

  // Agreement passes, and the audit line still reports the version.
  const healthy = run(healthyArtifacts());
  assert.deepEqual(healthy.errors, []);
  const layer = healthy.manifest.layers.find((l) => l.source_id === "vut_licences");
  assert.ok(layer.warnings.some((w) => /joined to barrio geography v3\.4\.1/.test(w)));
});

test("the sidecar gate does not weaken when only one field is wrong", () => {
  // Each field is independently required: fixing one does not excuse another.
  const artifacts = healthyArtifacts();
  const meta = artifacts["accommodation/madrid_vut_licences.meta.json"];
  delete meta.interpretation_ceiling;
  delete meta.unit_of_analysis;
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /interpretation_ceiling/);
  assert.match(errorText(result), /unit_of_analysis\.vut_units/);
});

test("the REAL committed licensed-VUT sidecar satisfies the gate", () => {
  // Runs the real registry's real rules against the real committed files, so a
  // future edit that strips required provenance fails here rather than on the
  // deploy runner.
  const committedRegistry = {
    ...REAL_REGISTRY,
    sources: REAL_REGISTRY.sources.filter((s) => s.id === "vut_licences" || s.id === "geography"),
  };
  const { errors, warnings, manifest } = validateDeployment({
    registry: committedRegistry,
    artifacts: readArtifacts(fileURLToPath(new URL("../data/", import.meta.url))),
    generatedAt: GENERATED_AT,
  });

  assert.deepEqual(errors, [], `the committed sidecar must satisfy the gate: ${errors.join(" | ")}`);
  assert.deepEqual(warnings, [], `and must do so without warnings: ${warnings.join(" | ")}`);

  const layer = manifest.layers.find((l) => l.source_id === "vut_licences");
  assert.equal(layer.state, "available");
  // Still no invented period, and the real geography version is reported.
  assert.equal(layer.source_period, null);
  assert.equal(layer.source_period_known, false);
  assert.ok(layer.warnings.some((w) => /joined to barrio geography v3\.4\.1/.test(w)));
});

test("an incoherent licence grant-date span blocks the build", () => {
  const artifacts = healthyArtifacts();
  const span = artifacts["accommodation/madrid_vut_licences.json"].source_state.grant_date_span;
  span.earliest_grant_date = "2026-09-02";
  span.latest_grant_date = "2019-03-06";
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /grant-date span is incoherent/);
});

test("a real published zero in the licensed-VUT artifact is valid and publishable", () => {
  // The one documented exception to "missing is not zero", and it must not be
  // mistaken for a broken artifact: the fixture deliberately contains zeros.
  const artifacts = healthyArtifacts();
  const vut = artifacts["accommodation/madrid_vut_licences.json"];
  const zeros = vut.records.filter((r) => r.geography_level === "barrio" && r.vut_units === 0);
  assert.ok(zeros.length > 0, "fixture precondition: some barrios carry a published zero");

  const result = run(artifacts);
  assert.deepEqual(result.errors, []);
  const layer = result.manifest.layers.find((l) => l.source_id === "vut_licences");
  assert.equal(layer.state, "available");
});

test("the manifest cannot present the packaged fallback as authoritative Madrid evidence", () => {
  const result = run(healthyArtifacts());
  const fallback = result.manifest.layers.find((l) => l.source_id === "snapshot_fallback");

  // Not a deployment snapshot, and not attributed to an official authority.
  assert.equal(fallback.provenance_state, "packaged_sample");
  assert.equal(fallback.rebuilt_at_deploy, false);
  assert.match(fallback.authority, /^MIXED/);
  assert.doesNotMatch(fallback.authority, /Madrid Destino \/ esmadrid\.com$/);

  // It must say where its records really come from, and say it is a sample.
  assert.equal(fallback.provenance_reference, "data/snapshot_provenance.json");
  assert.match(fallback.authority, /OpenStreetMap/);
  assert.match(fallback.interpretation_ceiling, /non-exhaustive/i);
  assert.match(fallback.interpretation_ceiling, /SNAPSHOT SAMPLE/);
  assert.match(fallback.interpretation_ceiling, /NOT official Madrid Destino accommodation evidence/);

  // Only a mixed-provenance layer needs the pointer; the rest stay null.
  const stay = result.manifest.layers.find((l) => l.source_id === "stay");
  assert.equal(stay.provenance_reference, null);
  assert.equal(stay.provenance_state, "deployment_snapshot");
});

// ------------------------------------------------------------------ real registry

test("source registry is internally coherent", () => {
  const ids = REAL_REGISTRY.sources.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "source ids must be unique");

  for (const source of REAL_REGISTRY.sources) {
    assert.ok(source.display_name, `${source.id} needs a display_name`);
    assert.ok(source.authority, `${source.id} needs an authority`);
    assert.ok(source.artifact, `${source.id} needs an artifact`);
    assert.ok(source.builder, `${source.id} needs a builder`);
    assert.ok(source.interpretation_ceiling, `${source.id} needs an interpretation_ceiling`);
    assert.ok(source.source_period_semantics, `${source.id} needs source_period_semantics`);
    assert.equal(typeof source.blocks_deployment, "boolean", `${source.id} must declare blocks_deployment`);
    assert.ok(
      [
        "operational",
        "context",
        "observed_evidence",
        "research_evidence",
        "packaged_fallback",
        "reference",
        // A committed administrative indicator the interface reports for a whole
        // official area. Distinct from "reference" (join material such as the
        // geography and the denominator) and from "context" (cartographic
        // context that is never a numerator).
        "administrative_context",
        // A citywide official statistical series shown on its own surface.
        // Distinct from "administrative_context" (an administrative fact about
        // one official AREA the Lens is in) because it is a survey ESTIMATE for
        // the whole municipality and is attached to no sub-municipal geography
        // at all.
        "destination_context",
      ].includes(source.role),
      `${source.id} has an unknown role`
    );
    assert.ok(
      [
        "deployment_snapshot",
        "committed_research_evidence",
        "packaged_sample",
        "committed_reference_geography",
        "committed_reference_evidence",
        "committed_administrative_snapshot",
        "committed_fingerprinted_administrative_snapshot",
        "committed_statistical_snapshot",
      ].includes(source.provenance_state),
      `${source.id} must declare a known provenance_state`
    );
    assert.equal(
      source.provenance_state === "deployment_snapshot",
      source.rebuilt_at_deploy === true,
      `${source.id}: provenance_state and rebuilt_at_deploy disagree`
    );
    // Every source that HAS a geometry must declare which envelope its records
    // are expected to fall in. A source may declare null instead, but only by
    // explaining why a spatial envelope would be meaningless for it - which is
    // true of a citywide statistical series carrying no coordinates at all.
    if (source.expected_spatial_scope === null) {
      assert.ok(
        source.spatial_scope_note,
        `${source.id} declares no spatial scope and must explain why`
      );
    } else {
      assert.ok(
        REAL_REGISTRY.spatial_scopes[source.expected_spatial_scope],
        `${source.id} references undefined scope ${source.expected_spatial_scope}`
      );
    }

    if (source.shape === "destination_demand_series") {
      // A monthly series has neither an exact administrative-count contract nor
      // a record-collapse floor: its integrity guardrail is a minimum series
      // LENGTH, because the failure it guards against is a truncated download.
      const counts = source.expected_counts;
      assert.ok(counts, `${source.id} needs expected_counts`);
      assert.ok(counts.months_minimum > 0, `${source.id} needs a months_minimum floor`);
      assert.ok(
        counts.months_minimum <= counts.baseline_months,
        `${source.id} floor ${counts.months_minimum} must not exceed its baseline ${counts.baseline_months}`
      );
      assert.ok(counts.calibrated_on, `${source.id} guardrail needs a calibration date`);
      assert.ok(counts.note, `${source.id} guardrail needs a stated rationale`);
    } else if (source.shape === "destination_domestic_origins") {
      const guard = source.integrity_guardrail;
      assert.ok(guard, `${source.id} needs an integrity_guardrail`);
      assert.ok(guard.rationale, `${source.id} guardrail needs a stated rationale`);
      assert.ok(guard.calibrated_on, `${source.id} guardrail needs a calibration date`);
      assert.ok(guard.minimum_rows_per_published_month > 0, `${source.id} needs a per-published-month floor`);
      assert.ok(guard.baseline_months > 0, `${source.id} needs a baseline month count`);
      assert.ok(guard.baseline_rows_per_published_month >= guard.minimum_rows_per_published_month, `${source.id} per-month floor must not exceed its calibrated baseline`);
    } else if (["admin_geography", "admin_population", "admin_licence_counts", "admin_hospitality_context"].includes(source.shape)) {
      // The administrative geography, the population denominator and the
      // licensed-VUT numerator have an exact-count contract, not a collapse
      // floor: they cover exactly the official number of districts and barrios,
      // so a min_count guardrail would be the wrong instrument.
      const counts = source.expected_counts;
      assert.ok(counts, `${source.id} needs expected_counts`);
      assert.equal(counts.districts, 21, `${source.id} must expect 21 districts`);
      assert.equal(counts.barrios, 131, `${source.id} must expect 131 barrios`);
    } else {
      const guard = source.integrity_guardrail;
      assert.ok(guard, `${source.id} needs an integrity_guardrail`);
      assert.ok(guard.rationale, `${source.id} guardrail needs a stated rationale`);
      assert.ok(guard.calibrated_on, `${source.id} guardrail needs a calibration date`);
      assert.ok(
        guard.min_count <= guard.baseline_count,
        `${source.id} guardrail floor ${guard.min_count} must not exceed its baseline ${guard.baseline_count}`
      );
    }
  }

  for (const scope of Object.values(REAL_REGISTRY.spatial_scopes)) {
    assert.ok(scope.lat_min < scope.lat_max && scope.lon_min < scope.lon_max);
    assert.ok(scope.note, "each scope must explain what it is for");
  }

  assert.match(REAL_REGISTRY.guardrail_note, /not a tourism indicator/i);
});

test("the evidence vocabulary distinguishes a register from a licence", () => {
  // The taxonomy is extended, not redesigned: each new family is added only
  // because an existing one would MISLABEL the source.
  //
  //   ADMINISTRATIVE_REGISTER  an enumerated administrative universe (the Padron)
  //   ADMINISTRATIVE_LICENSE   a granted administrative ACT, which is not a universe
  //   OBSERVED                 located records observed in the world
  //   MODEL-DERIVED            a model output, not a measurement
  //   REFERENCE                join material: geography and identifiers
  //   OFFICIAL_STATISTICAL_SERIES
  //                            a SAMPLE-BASED ESTIMATE produced by an official
  //                            statistical operation, carrying its own
  //                            provisional/definitive revision status and its
  //                            own statistical-confidentiality suppression. It
  //                            is not a register: nobody is enumerated, and the
  //                            publisher may withhold a value. It is not
  //                            OBSERVED: it is an estimate, not a record. It is
  //                            not MODEL-DERIVED: it comes from a statutory
  //                            survey of real establishments, not a simulation.
  const families = new Set(REAL_REGISTRY.sources.map((s) => s.evidence_type));
  assert.deepEqual(
    [...families].sort(),
    [
      "ADMINISTRATIVE_LICENSE",
      "ADMINISTRATIVE_REGISTER",
      "MODEL-DERIVED",
      "OBSERVED",
      "OFFICIAL_STATISTICAL_SERIES",
      "REFERENCE",
    ]
  );

  const hotel = REAL_REGISTRY.sources.find((s) => s.id === "hotel_demand");
  assert.equal(hotel.evidence_type, "OFFICIAL_STATISTICAL_SERIES");
  // The two properties that make it a different family from everything above:
  // a revision status per observation, and a publisher that may withhold.
  assert.match(hotel.source_period_semantics, /Definitivo or Provisional/);
  assert.match(hotel.zero_semantics, /NULL/);
  assert.equal(hotel.rebuilt_at_deploy, false);
  assert.equal(hotel.provenance_state, "committed_statistical_snapshot");
  assert.match(hotel.deployment_source_role, /COMMITTED STATISTICAL SNAPSHOT/);
  assert.match(hotel.deployment_source_role, /Nothing about this layer is live data/);

  const vut = REAL_REGISTRY.sources.find((s) => s.id === "vut_licences");
  const population = REAL_REGISTRY.sources.find((s) => s.id === "population");
  assert.equal(vut.evidence_type, "ADMINISTRATIVE_LICENSE");
  assert.equal(population.evidence_type, "ADMINISTRATIVE_REGISTER");
  assert.notEqual(vut.evidence_type, population.evidence_type);

  // The licence source is a committed snapshot, never presented as live data.
  assert.equal(vut.rebuilt_at_deploy, false);
  assert.equal(vut.provenance_state, "committed_administrative_snapshot");
  assert.match(vut.deployment_source_role, /COMMITTED ADMINISTRATIVE SNAPSHOT/);
  assert.match(vut.deployment_source_role, /does NOT mean the upstream source was re-fetched/);
  assert.match(vut.deployment_source_role, /Nothing about this layer is live data/);
});

test("the licensed-VUT registry entry states its ceiling and refuses the forbidden readings", () => {
  const vut = REAL_REGISTRY.sources.find((s) => s.id === "vut_licences");

  // What it IS.
  assert.match(vut.interpretation_ceiling, /GRANTED/);
  assert.match(vut.interpretation_ceiling, /tourist-dwelling units those licences include/);
  assert.match(vut.interpretation_ceiling, /a licence is NOT a dwelling/i);
  assert.match(vut.interpretation_ceiling, /WHOLE OFFICIAL BARRIO/);
  assert.match(vut.interpretation_ceiling, /never be spatially distributed into a circular/i);

  // What it is NOT. Each of these is a claim the source cannot support.
  for (const forbidden of [
    /does NOT establish that the dwellings are currently operating/i,
    /NOT all VUT/,
    /NOT all accommodation/,
    /NOT beds, rooms or places/,
    /NOT platform listings/,
    /legality of any platform listing/i,
    /NOT a measure of tourism pressure/i,
    /overtourism/i,
    /saturation/i,
    /carrying capacity/i,
    /displacement/i,
    /never ranked, banded, scored or mapped as a heat surface/i,
    /the denominator is registered residents, never homes or households/i,
  ]) {
    assert.match(vut.interpretation_ceiling, forbidden, `the ceiling must state: ${forbidden}`);
  }

  // The period contract, which is the delicate part: no invented reference date.
  assert.equal(vut.source_period_exposed_by_source, false);
  assert.match(vut.source_period_semantics, /declares NO reference date and NO effective date/);
  assert.match(vut.source_period_semantics, /NOT a publisher-declared publication, effective or reference date/);
  assert.match(vut.source_period_semantics, /never shown as one shared period/);

  // The zero is a real zero, and a failure is never degraded into one.
  assert.equal(vut.zero_is_a_real_zero, true);
  assert.match(vut.zero_semantics, /must never be degraded into a zero/);
});

test("the accommodation scope is named and described as city-and-surroundings, not regional", () => {
  const scopes = REAL_REGISTRY.spatial_scopes;

  // The old name invited reading this feed as a Comunidad de Madrid contract.
  assert.ok(!("madrid_region" in scopes), "no scope may be named madrid_region");

  const stay = REAL_REGISTRY.sources.find((s) => s.id === "stay");
  assert.equal(stay.expected_spatial_scope, "madrid_city_and_surroundings_feed_area");

  const scope = scopes[stay.expected_spatial_scope];
  assert.equal(scope.is_coverage_contract, false, "this box is an integrity envelope, not a coverage contract");
  assert.match(scope.note, /INTEGRITY ENVELOPE ONLY/);
  assert.match(scope.note, /la ciudad de Madrid y alrededores/);
  assert.match(scope.not_a_regional_dataset, /never be read as Comunidad de Madrid coverage/);
  assert.match(scope.not_a_regional_dataset, /must not inherit this feed as a proxy/);

  // The outlying records stay reported rather than filtered.
  assert.equal(stay.warn_outside_scope, "madrid_city_area");
  assert.match(scope.note, /deliberately NOT filtered/);

  // Nothing in the registry may call this source regional evidence.
  const serialised = JSON.stringify(REAL_REGISTRY);
  assert.doesNotMatch(serialised, /feed is regional/);
  assert.match(stay.interpretation_ceiling, /neither a strictly municipal register nor a Comunidad de Madrid one/);
});

test("the accommodation catalogue is not presented as an official register", () => {
  // Gate A (docs/ACCOMMODATION_NUMERATOR_AUDIT.md) established that this feed is
  // a Madrid Destino tourism-promotion catalogue, not an administrative
  // register. The deployed evidence contract must not overclaim it: no
  // "Official …" name and no "registered establishments" ceiling.
  const stay = REAL_REGISTRY.sources.find((s) => s.id === "stay");
  assert.doesNotMatch(stay.display_name, /^Official/i);
  assert.match(stay.display_name, /catalogue|listings/i);
  assert.doesNotMatch(stay.interpretation_ceiling, /registered establishment/i);
  assert.doesNotMatch(stay.interpretation_ceiling, /count of registered/i);
  assert.match(stay.interpretation_ceiling, /not a complete administrative register/i);
  // The Gate A correction relabels the presentation only; the evidence class is
  // unchanged pending a separate evidence-taxonomy analysis.
  assert.equal(stay.evidence_type, "OBSERVED");
});

test("the packaged fallback declares mixed provenance and points at its record", () => {
  const fallback = REAL_REGISTRY.sources.find((s) => s.id === "snapshot_fallback");

  assert.match(fallback.display_name, /multi-source/i);
  assert.match(fallback.authority, /^MIXED/);
  assert.match(fallback.authority, /NOT the same set of authorities/);
  assert.match(fallback.authority, /OpenStreetMap-derived/);
  assert.equal(fallback.provenance_reference, "data/snapshot_provenance.json");
  assert.equal(fallback.provenance_state, "packaged_sample");
  assert.match(fallback.interpretation_ceiling, /non-exhaustive/i);
  assert.match(fallback.interpretation_ceiling, /SNAPSHOT SAMPLE/);
  assert.match(fallback.source_period_semantics, /no source period of its own/);

  // The referenced file must actually carry the per-layer provenance claimed.
  const provenance = JSON.parse(
    fs.readFileSync(new URL("../data/snapshot_provenance.json", import.meta.url), "utf8")
  );
  assert.match(provenance.layers.accommodation.live_source, /OpenStreetMap/);
  assert.match(provenance.layers.museums.live_source, /Madrid Open Data/);
});

test("exactly the layers a user-facing feature depends on block deployment", () => {
  const blocking = REAL_REGISTRY.sources.filter((s) => s.blocks_deployment).map((s) => s.id).sort();
  assert.deepEqual(blocking, [
    "bike",
    "domestic_origin_context",
    "geography",
    "hati",
    "hospitality_commercial_context",
    "hotel_demand",
    "info",
    "museum",
    "population",
    "rail",
    "snapshot_fallback",
    "stay",
    "vut_licences",
  ]);

  const nonBlocking = REAL_REGISTRY.sources.filter((s) => !s.blocks_deployment).map((s) => s.id).sort();
  assert.deepEqual(nonBlocking, ["park", "pedestrian"]);

  for (const id of ["park", "pedestrian"]) {
    assert.equal(REAL_REGISTRY.sources.find((s) => s.id === id).unavailable_is_allowed, true);
  }

  // The geography and the population denominator became publication gates when
  // the Area Profile started naming the official barrio of a Lens centre and
  // reporting its registered residents. They are committed artifacts, so they
  // must always be present (never an allowed unavailable state), and the
  // registry has to record why the gate exists.
  for (const id of ["geography", "population", "vut_licences"]) {
    const source = REAL_REGISTRY.sources.find((s) => s.id === id);
    assert.equal(source.unavailable_is_allowed, false, `${id} must not allow an unavailable state`);
    assert.match(
      source.blocks_deployment_note,
      /BLOCKING since the Area Profile/,
      `${id} must document why it blocks`
    );
  }

  // Runtime graceful degradation and deployment integrity stay separate
  // concerns, and the registry has to say so for the layer the UI now reads.
  const vut = REAL_REGISTRY.sources.find((s) => s.id === "vut_licences");
  assert.match(vut.blocks_deployment_note, /plausible-looking zero/);
  assert.match(vut.blocks_deployment_note, /degrades gracefully when a runtime fetch fails/);

  // The destination series became a publication gate when the Destination
  // Context surface began publishing citywide figures with a year-over-year
  // comparison. Its runtime failure must be independent of every other surface.
  const hotel = REAL_REGISTRY.sources.find((s) => s.id === "hotel_demand");
  assert.equal(hotel.unavailable_is_allowed, false);
  assert.match(hotel.blocks_deployment_note, /BLOCKING because the Destination Context surface/);
  assert.match(hotel.blocks_deployment_note, /wrong statistical operation/);
  assert.match(
    hotel.blocks_deployment_note,
    /leaving the Area Profile, the Lens metrics, VUT and HATI untouched/
  );
});

test("the committed evidence artifacts satisfy the real registry", () => {
  // Scoped to the sources that are committed rather than fetched at deploy time,
  // because runtime_poi.json is a build artifact and is absent from a clean
  // checkout. This runs the real registry's real thresholds against the real
  // files, so a bad commit to HATI or the packaged fallback is caught here.
  const committedRegistry = {
    ...REAL_REGISTRY,
    sources: REAL_REGISTRY.sources.filter((s) => s.rebuilt_at_deploy === false),
  };
  assert.deepEqual(
    committedRegistry.sources.map((s) => s.id).sort(),
    ["domestic_origin_context", "geography", "hati", "hospitality_commercial_context", "hotel_demand", "population", "snapshot_fallback", "vut_licences"],
    "the set of committed, non-rebuilt sources changed; update this test deliberately"
  );

  const { errors } = validateDeployment({
    registry: committedRegistry,
    artifacts: readArtifacts(fileURLToPath(new URL("../data/", import.meta.url))),
    generatedAt: GENERATED_AT,
  });

  assert.deepEqual(errors, [], `committed artifacts must validate: ${errors.join(" | ")}`);
});
