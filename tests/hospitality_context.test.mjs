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
  normalizedMetricValue,
  validateHospitalityArtifact,
  FILL_INDICATOR_IDS,
  quantileCuts,
  fillClass,
  hasValueFill,
  isSmallBase,
  populatedTaxonomyBase,
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
    (copy) => (copy.barrios["011"].official_name = ""),
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
  assert.equal(i18n.t("languageLabel"), "Idioma del contexto");
  assert.equal(
    i18n.t("core_hospitality_premises_count"),
    "Locales con actividad documentada de hostelería"
  );
  i18n.setLanguage("en");
  assert.equal(i18n.t("layerName"), "Hospitality & Commercial Context");
  assert.equal(i18n.t("languageLabel"), "Context language");
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

test("choropleth normalization is linear and does not hide a square-root transform", () => {
  const domain = { min: 0, max: 100 };
  assert.equal(normalizedMetricValue(0, domain), 0);
  assert.equal(normalizedMetricValue(25, domain), 0.25);
  assert.equal(normalizedMetricValue(50, domain), 0.5);
  assert.equal(normalizedMetricValue(100, domain), 1);
});

test("the language selector is the ONE document-language control (K4 policy, replaces the old hospitality-only scope)", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /id="hospitalityLanguageLabel"[^>]*>Idioma \/ Language<\/label>/);
  assert.match(appSource, /document\.documentElement\.setAttribute\("lang", language\)/);
  assert.match(
    appSource,
    /createI18n\([\s\S]*?document\.getElementById\("languageSelect"\)\.value/
  );
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

test("Hospitality selection preserves the primary Lens click interaction", () => {
  assert.match(
    appSource,
    /click\(event\) \{[\s\S]*?hospitalitySelectedBarrio = String\(feature\.properties\.official_id\);[\s\S]*?lenses\[active\]\.marker\.setLatLng\(event\.latlng\);[\s\S]*?refresh\(\);/
  );

  const mapClickBody = appSource.slice(
    appSource.indexOf('map.on("click"'),
    appSource.indexOf('map.on("zoomend"')
  );
  assert.match(mapClickBody, /lenses\[active\]\.marker\.setLatLng\(e\.latlng\);/);
  assert.match(mapClickBody, /refresh\(\);/);
  assert.doesNotMatch(mapClickBody, /hospitalityVisible|hospitalitySelectedBarrio|return;/);
});

test("existing accommodation catalogue remains a separate layer", () => {
  assert.match(html, /data-layer="stay"/);
  assert.match(html, /data-layer="hospitality"/);
  assert.notEqual(html.indexOf('data-layer="stay"'), html.indexOf('data-layer="hospitality"'));
  assert.doesNotMatch(appSource, /groups\.stay\s*=\s*.*hospitality|groups\.hospitality\s*=\s*groups\.stay/);
});

// Cartographic HOLD, lifted for exactly one indicator.
const SHARE_ID = "core_hospitality_membership_share_of_populated_taxonomy_premises";

test("only the membership share is fill-enabled; every other indicator yields no fill", () => {
  assert.deepEqual([...FILL_INDICATOR_IDS], [SHARE_ID]);
  const index = createHospitalityIndex(artifact);
  for (const id of APPROVED_INDICATOR_IDS) {
    assert.equal(hasValueFill(id), id === SHARE_ID, id);
    const breaks = quantileCuts(index, id);
    if (id !== SHARE_ID) assert.equal(breaks, null, id);
    for (const row of index.barrio.values()) {
      const cls = fillClass(id, row.indicators[id], id === SHARE_ID ? quantileCuts(index, SHARE_ID) : [1, 2, 3, 4]);
      if (id !== SHARE_ID) assert.equal(cls, null, id);
    }
  }
});

test("share classes are five quantile classes with ascending breaks covering all 131 barrios", () => {
  const index = createHospitalityIndex(artifact);
  const breaks = quantileCuts(index, SHARE_ID);
  assert.equal(breaks.length, 4);
  assert.deepEqual([...breaks], [...breaks].sort((a, b) => a - b));
  const counts = [0, 0, 0, 0, 0];
  for (const row of index.barrio.values()) counts[fillClass(SHARE_ID, row.indicators[SHARE_ID], breaks)] += 1;
  assert.equal(counts.reduce((a, b) => a + b, 0), 131);
  for (const n of counts) assert.ok(n >= 25 && n <= 28, `class size ${n}`);
  assert.equal(fillClass(SHARE_ID, null, breaks), null);
  assert.equal(fillClass(SHARE_ID, Number.NaN, breaks), null);
});

// The base shown in the small-base flag is recovered at runtime from the rounded
// share. It is only trusted because it reproduces the EXACT integer counts of the
// committed Gate F audit (source-included minus blank-taxonomy premises per barrio),
// computed from the same fingerprinted snapshot, in all 131 barrios.
test("recovered populated-taxonomy base equals the exact Gate F audit count in every barrio", () => {
  const audit = JSON.parse(
    fs.readFileSync(
      fileURLToPath(new URL("../research/hospitality_commercial_gate/results/gate_f_denominator_audit.json", import.meta.url)),
      "utf8"
    )
  );
  assert.equal(audit.snapshot_identity.premises.content_fingerprint_sha256, artifact.metadata.premises_sha256);
  assert.equal(audit.snapshot_identity.activities.content_fingerprint_sha256, artifact.metadata.activities_sha256);
  const index = createHospitalityIndex(artifact);
  const rows = audit.blank_taxonomy_effects.by_barrio;
  assert.equal(rows.length, 131);
  const small = [];
  for (const r of rows) {
    const row = index.barrio.get(r.barrio_id);
    const exact = r.source_included - r.blank_taxonomy;
    assert.equal(populatedTaxonomyBase(row), exact, r.barrio_id);
    if (isSmallBase(row)) small.push(r.barrio_id);
    assert.equal(isSmallBase(row), exact < 200, r.barrio_id);
  }
  assert.equal(small.length, 10);
});

test("administrative data is preserved while the fill is on hold", () => {
  const index = createHospitalityIndex(artifact);
  assert.equal(index.barrio.size, 131);
  for (const id of APPROVED_INDICATOR_IDS) {
    assert.ok(Number.isFinite(metricDomain(index, id).max), id);
  }
});

test("app routes every polygon fill through fillClass, never the raw normalizer", () => {
  assert.doesNotMatch(appSource, /module\??\.normalizedMetricValue\(/);
  assert.doesNotMatch(appSource, /VALUE_FILL_ENABLED|fillIntensity/);
  assert.match(appSource, /module\?\.fillClass\(hospitalityMetric, value, hospitalityFillBreaks\(\)\)/);
  assert.match(appSource, /fillOpacity: filled \? Math\.min\(0\.75, palette\.opacity \+ 0\.22\) : 0/);
});

test("hold notice exists in ES and EN and the HOLD doc states reactivation conditions", () => {
  assert.match(HOSPITALITY_DICTIONARIES.es.fillHold, /solo está habilitado/);
  assert.match(HOSPITALITY_DICTIONARIES.en.fillHold, /enabled only/);
  for (const key of ["mapBadge", "panelOnlyBadge", "legendTitle", "legendNote", "smallBase", "smallBaseNote", "smallBaseTooltip"]) {
    assert.ok(HOSPITALITY_DICTIONARIES.es[key] && HOSPITALITY_DICTIONARIES.en[key], key);
  }
  assert.match(html, /id="hospitalityScale"[^>]*\shidden/);
  const doc = fs.readFileSync(
    fileURLToPath(new URL("../docs/HOSPITALITY_CHOROPLETH_HOLD.md", import.meta.url)),
    "utf8"
  );
  for (const topic of ["denominator", "comparability", "Class breaks", "legend", "Misinterpretation", "Source limitations"]) {
    assert.match(doc, new RegExp(topic, "i"), topic);
  }
});
