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
    if (source.required_modes) {
      for (const rule of Object.values(source.required_modes.modes)) rule.min_count = 1;
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
    source_vintage: {
      per_feature_edition_exposed: false,
      datasets: {
        district: { metadata_modified: "2026-07-27" },
        barrio: { metadata_modified: "2026-07-27" },
      },
    },
    retrieved_at: GENERATED_AT,
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

// ------------------------------------------------------------------ structure

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
  assert.match(errorText(result), /must not be published as the official accommodation deployment artifact/);
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
      ["operational", "context", "observed_evidence", "research_evidence", "packaged_fallback", "reference"].includes(
        source.role
      ),
      `${source.id} has an unknown role`
    );
    assert.ok(
      ["deployment_snapshot", "committed_research_evidence", "packaged_sample", "committed_reference_geography"].includes(
        source.provenance_state
      ),
      `${source.id} must declare a known provenance_state`
    );
    assert.equal(
      source.provenance_state === "deployment_snapshot",
      source.rebuilt_at_deploy === true,
      `${source.id}: provenance_state and rebuilt_at_deploy disagree`
    );
    assert.ok(
      REAL_REGISTRY.spatial_scopes[source.expected_spatial_scope],
      `${source.id} references undefined scope ${source.expected_spatial_scope}`
    );

    if (source.shape === "admin_geography") {
      // The administrative geography has an exact-count contract, not a
      // collapse floor: it must ship exactly the official number of districts
      // and barrios, so a min_count guardrail would be the wrong instrument.
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

test("exactly the layers that feed operational lens metrics block deployment", () => {
  const blocking = REAL_REGISTRY.sources.filter((s) => s.blocks_deployment).map((s) => s.id).sort();
  assert.deepEqual(blocking, ["bike", "hati", "info", "museum", "rail", "snapshot_fallback", "stay"]);

  const nonBlocking = REAL_REGISTRY.sources.filter((s) => !s.blocks_deployment).map((s) => s.id).sort();
  assert.deepEqual(nonBlocking, ["geography", "park", "pedestrian"]);

  for (const id of ["park", "pedestrian"]) {
    assert.equal(REAL_REGISTRY.sources.find((s) => s.id === id).unavailable_is_allowed, true);
  }

  // Geography is non-blocking for a different reason: the application does not
  // yet consume it, so a build is not withheld over it, but it is committed and
  // must always be present (never an allowed unavailable state). Its structural
  // integrity is enforced by the test suites, and it must flip to blocking once
  // a user-facing feature depends on it.
  const geography = REAL_REGISTRY.sources.find((s) => s.id === "geography");
  assert.equal(geography.unavailable_is_allowed, false);
  assert.ok(geography.blocks_deployment_note, "geography must document why it does not block yet");
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
    ["geography", "hati", "snapshot_fallback"],
    "the set of committed, non-rebuilt sources changed; update this test deliberately"
  );

  const { errors } = validateDeployment({
    registry: committedRegistry,
    artifacts: readArtifacts(fileURLToPath(new URL("../data/", import.meta.url))),
    generatedAt: GENERATED_AT,
  });

  assert.deepEqual(errors, [], `committed artifacts must validate: ${errors.join(" | ")}`);
});
