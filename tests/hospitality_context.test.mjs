import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPROVED_INDICATOR_IDS,
  CONDITIONAL_INDICATOR_ID,
  DEFAULT_INDICATOR_ID,
  HOSPITALITY_DICTIONARIES,
  createHospitalityIndex,
  formatMetricValue,
  metricDomain,
  validateHospitalityArtifact,
} from "../js/hospitality-context.js";
import { createI18n } from "../js/i18n.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const artifact = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("../data/hospitality-commercial-context.json", import.meta.url)), "utf8")
);
const html = fs.readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const appSource = fs.readFileSync(fileURLToPath(new URL("../js/app.js", import.meta.url)), "utf8");

test("production artifact exposes exactly the Gate F selectable allowlist", () => {
  assert.deepEqual(APPROVED_INDICATOR_IDS, [
    "source_included_premises_count",
    "core_hospitality_premises_count",
    "accommodation_class_premises_count",
    "core_hospitality_membership_share_of_populated_taxonomy_premises",
    "core_hospitality_premises_per_1000_residents",
  ]);
  assert.deepEqual(artifact.metadata.selectable_indicator_ids, APPROVED_INDICATOR_IDS);
  assert.equal(artifact.metadata.default_indicator_id, DEFAULT_INDICATOR_ID);
  assert.equal(DEFAULT_INDICATOR_ID, "core_hospitality_premises_count");
});

test("loader rejects version, metadata, geography, numeric and indicator corruption", () => {
  assert.deepEqual(validateHospitalityArtifact(artifact), { ok: true, errors: [] });
  assert.ok(createHospitalityIndex(artifact));

  const mutations = [
    (copy) => (copy.contract_version = "2.0.0"),
    (copy) => delete copy.metadata.conditional_indicator.population_date,
    (copy) => (copy.barrios["011"].indicators.core_hospitality_premises_count = Infinity),
    (copy) => (copy.barrios.bad = copy.barrios["011"]),
    (copy) => delete copy.barrios["011"].indicators.source_included_premises_count,
    (copy) => (copy.barrios["011"].indicators.premises_per_km2 = 3),
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(artifact);
    mutate(copy);
    assert.equal(validateHospitalityArtifact(copy).ok, false);
    assert.equal(createHospitalityIndex(copy), null);
  }
});

test("conditional indicator carries both dates, denominator type and interpretation ceiling", () => {
  const conditional = artifact.metadata.conditional_indicator;
  assert.equal(conditional.indicator_id, CONDITIONAL_INDICATOR_ID);
  assert.equal(conditional.premises_period, "Sep 2026");
  assert.equal(conditional.population_date, "2026-01-01");
  assert.match(conditional.denominator_type, /registered residents/i);
  assert.match(conditional.interpretation_ceiling, /Not tourism pressure/);
  assert.match(HOSPITALITY_DICTIONARIES.es.dualDate, /sep\. 2026.*1 ene\. 2026/);
  assert.match(HOSPITALITY_DICTIONARIES.en.dualDate, /Sep 2026.*1 Jan 2026/);
});

test("ES and EN labels are exact and formatting is locale-aware", () => {
  const i18n = createI18n(HOSPITALITY_DICTIONARIES, "es");
  assert.equal(i18n.t("layerName"), "Contexto de hostelería y actividad comercial");
  assert.equal(
    i18n.t("core_hospitality_premises_count"),
    "Locales con actividad documentada de hostelería"
  );
  i18n.setLanguage("en");
  assert.equal(i18n.t("layerName"), "Hospitality & Commercial Context");
  assert.equal(
    i18n.t("accommodation_class_premises_count"),
    "Documented accommodation-class premises (Division 55)"
  );
  assert.equal(formatMetricValue("source_included_premises_count", 184279, "en"), "184,279");
  assert.equal(
    formatMetricValue("core_hospitality_membership_share_of_populated_taxonomy_premises", 13.744573, "en"),
    "13.7%"
  );
});

test("artifact indexes all official units and yields a deterministic numeric domain", () => {
  const index = createHospitalityIndex(artifact);
  assert.equal(index.municipality.size, 1);
  assert.equal(index.district.size, 21);
  assert.equal(index.barrio.size, 131);
  const domain = metricDomain(index, DEFAULT_INDICATOR_ID);
  assert.ok(Number.isFinite(domain.min));
  assert.ok(Number.isFinite(domain.max));
  assert.ok(domain.max >= domain.min);
});

test("UI contains one layer, one selector and one existing-panel context section", () => {
  assert.equal((html.match(/id="hospitalityToggle"/g) || []).length, 1);
  assert.equal((html.match(/id="hospitalityMetricSelect"/g) || []).length, 1);
  assert.equal((html.match(/id="hospitalityContext"/g) || []).length, 1);
  assert.match(html, /id="hospitalityContext"[\s\S]*id="hospitalityValue"/);
  assert.match(appSource, /hospitalityMetric = "core_hospitality_premises_count"/);
  assert.match(appSource, /featuresByLevel\("barrio"\)/);
});

test("hospitality rendering stays out of radius and A/B comparison calculations", () => {
  const moduleSource = fs.readFileSync(`${ROOT}/js/hospitality-context.js`, "utf8");
  assert.doesNotMatch(moduleSource, /haversineMeters|poiStatsInLens|population.*circle/i);
  const compareBody = appSource.slice(
    appSource.indexOf("function renderCompare("),
    appSource.indexOf("// ---------------------------------------------------------------- area profile")
  );
  assert.doesNotMatch(compareBody, /hospitality/i);
  const radiusHandler = appSource.slice(
    appSource.indexOf("radiusSlider.oninput"),
    appSource.indexOf('document.getElementById("basemapSelect")')
  );
  assert.doesNotMatch(radiusHandler, /hospitality/i);
});

test("map clicks select a canonical barrio while Hospitality is active without moving a Lens", () => {
  assert.match(
    appSource,
    /if \(hospitalityVisible && hospitalityState === "ready" && geographyIndex\) \{[\s\S]*?geographyIndex\.barrioAt\(e\.latlng\.lng, e\.latlng\.lat\)[\s\S]*?hospitalitySelectedBarrio = String\(barrio\.official_id\)[\s\S]*?return;/
  );
  assert.match(appSource, /lenses\[active\]\.marker\.setLatLng\(e\.latlng\);/);
});

test("existing accommodation catalogue remains a separate layer", () => {
  assert.match(html, /data-layer="stay"/);
  assert.match(html, /data-layer="hospitality"/);
  assert.notEqual(html.indexOf('data-layer="stay"'), html.indexOf('data-layer="hospitality"'));
  assert.doesNotMatch(appSource, /groups\.stay\s*=\s*.*hospitality|groups\.hospitality\s*=\s*groups\.stay/);
});
