// Registered unemployment (tasa absoluta de paro registrado) in the Area Profile.
//
// THE CONTRACT THESE TESTS DEFEND: the publisher's barrio rate is TRANSCRIBED for
// the WHOLE official barrio containing the Lens centre. It is never derived,
// ranked, banded, compared, interpolated into the Lens circle or presented as a
// tourism impact, and a missing value is a stated absence, never 0%.
//
// Runs against the committed artifacts: no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createGeographyIndex } from "../js/geography.js";
import { localizeCopyEs } from "../js/legacy-copy.js";
import {
  AREA_STATE,
  PARO_REASON,
  PARO_STATE,
  buildAreaProfile,
  buildUnemploymentContext,
  buildUnemploymentProvenanceLines,
  createPopulationIndex,
  createUnemploymentIndex,
  formatUnemploymentRate,
} from "../js/area-profile.js";
import { SHELL_DICTIONARIES } from "../js/shell-copy.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const readJson = (relative) => JSON.parse(read(relative));

const GEO = readJson("../data/geography/madrid_admin.geojson");
const ARTIFACT = readJson("../data/socioeconomic/madrid_registered_unemployment.json");
const META = readJson("../data/socioeconomic/madrid_registered_unemployment.meta.json");
const POPULATION = readJson("../data/population/madrid_population.json");
const REGISTRY = readJson("../data/source_registry.json");

const geographyIndex = createGeographyIndex(GEO);
const populationIndex = createPopulationIndex(POPULATION);
const index = createUnemploymentIndex(ARTIFACT);

// Palacio (011), Centro; a point well inside it.
const PALACIO = geographyIndex.resolve(-3.7142, 40.4155);

test("the committed artifact indexes all 131 canonical barrios by official code", () => {
  assert.equal(index.barrio.size, 131);
  assert.equal(PALACIO.barrio.official_id, "011");
  const ids = GEO.features.filter((f) => f.properties.geography_level === "barrio").map((f) => f.properties.official_id);
  for (const id of ids) assert.ok(index.barrio.has(id), `barrio ${id}`);
});

test("a resolved barrio carries the publisher's value unchanged, with unit and period", () => {
  const profile = buildAreaProfile({ lens: "A", located: PALACIO, populationIndex, unemploymentIndex: index });
  assert.equal(profile.state, AREA_STATE.RESOLVED);
  const paro = profile.paro;
  assert.equal(paro.state, PARO_STATE.AVAILABLE);
  assert.equal(paro.rate.value, 5.41);
  assert.deepEqual(paro.rate.display, { en: "5.41%", es: "5,41 %" });
  assert.equal(paro.period.year, "2026");
  assert.deepEqual(paro.period.label, { en: "Feb 2026", es: "feb 2026" });
  assert.equal(paro.evidenceType, "ADMINISTRATIVE_REGISTER");
  assert.match(paro.scopeCaveat, /Whole official barrio/);
  // The value is the source's, not anything computed from the residents figure.
  assert.equal(paro.rate.value, ARTIFACT.records.find((r) => r.official_id === "011").rate_percent);
});

test("no barrio, no barrio statistic: outside Madrid and district-only states carry no rate", () => {
  const outside = buildAreaProfile({ lens: "A", located: geographyIndex.resolve(-3.0, 41.5), populationIndex, unemploymentIndex: index });
  assert.equal(outside.paro.state, PARO_STATE.NOT_APPLICABLE);
  assert.equal(outside.paro.rate.value, null);
  const loading = buildAreaProfile({ lens: "A", located: null, populationIndex, unemploymentIndex: index });
  assert.equal(loading.paro.state, PARO_STATE.NOT_APPLICABLE);
  // No district or neighbouring fallback exists on the model.
  assert.equal(buildUnemploymentContext({ unemploymentIndex: index, barrio: null }).rate.value, null);
});

test("missing, unpublished, invalid and absent records are stated absences — never 0", () => {
  const records = [
    { official_id: "011", parent_id: "01", rate_percent: null, state: "MISSING_IN_SOURCE" },
    { official_id: "012", parent_id: "01", rate_percent: null, state: "NOT_PUBLISHED" },
    { official_id: "013", parent_id: "01", rate_percent: 250, state: "VALID" },
    { official_id: "014", parent_id: "01", rate_percent: "5.4", state: "VALID" },
    { official_id: "015", parent_id: "01", rate_percent: 4.5, state: "VALID" },
    { official_id: "016", parent_id: "01", rate_percent: 0, state: "VALID" },
  ];
  const idx = createUnemploymentIndex({ ...ARTIFACT, records });
  const read = (id) => buildUnemploymentContext({ unemploymentIndex: idx, barrio: { official_id: id } });
  assert.equal(read("011").reason, PARO_REASON.MISSING_IN_SOURCE);
  assert.equal(read("012").reason, PARO_REASON.NOT_PUBLISHED);
  assert.equal(read("013").reason, PARO_REASON.INVALID_VALUE);
  assert.equal(read("014").reason, PARO_REASON.INVALID_VALUE);
  assert.equal(read("099").reason, PARO_REASON.NO_RECORD);
  for (const id of ["011", "012", "013", "014", "099"]) {
    assert.equal(read(id).state, PARO_STATE.UNAVAILABLE);
    assert.equal(read(id).rate.value, null);
    assert.equal(read(id).rate.display, null);
  }
  assert.equal(read("015").rate.value, 4.5);
  // A published real zero is a value; it is the only way 0 can appear.
  assert.equal(read("016").state, PARO_STATE.AVAILABLE);
  assert.equal(read("016").rate.value, 0);
});

test("an unusable artifact becomes an explicit unavailable state, not an empty or zero index", () => {
  for (const broken of [null, {}, { records: "x" }, { ...ARTIFACT, records: [] }, { ...ARTIFACT, source_period: {} }]) {
    assert.equal(createUnemploymentIndex(broken), null);
  }
  const absent = buildUnemploymentContext({ unemploymentIndex: null, barrio: { official_id: "011" } });
  assert.equal(absent.state, PARO_STATE.UNAVAILABLE);
  assert.equal(absent.reason, PARO_REASON.ARTIFACT_UNAVAILABLE);
  assert.equal(absent.rate.value, null);
});

test("the model reports no spatial allocation, ranking, band or comparison field", () => {
  const paro = buildAreaProfile({ lens: "A", located: PALACIO, populationIndex, unemploymentIndex: index }).paro;
  const allowed = new Set(["evidenceType", "scopeCaveat", "period", "state", "reason", "rate"]);
  assert.deepEqual(new Set(Object.keys(paro)), allowed);
  assert.deepEqual(new Set(Object.keys(paro.rate)), new Set(["value", "display"]));
  const source = read("../js/area-profile.js");
  const model = source.slice(source.indexOf("registered unemployment (paro)"));
  for (const forbidden of [/\brank/i, /percentile/i, /\bband\b/i, /\bscore\b(?!\s*,)/i]) {
    // Mentions are allowed only inside the prohibitions the comment block states.
    const code = model.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
    assert.doesNotMatch(code, forbidden);
  }
  // The Lens radius/centre never reaches the model: it takes a barrio, not a circle.
  assert.doesNotMatch(buildUnemploymentContext.toString(), /radius|circle|lat|lon/i);
});

test("number format follows the document language: es uses a decimal comma", () => {
  assert.deepEqual(formatUnemploymentRate(3), { en: "3.00%", es: "3,00 %" });
  assert.equal(formatUnemploymentRate(NaN), null);
  assert.equal(formatUnemploymentRate(null), null);
});

test("ES/EN labels exist, differ, and keep the official name; provenance names the period and ceiling", () => {
  for (const key of [
    "area.paro.title", "area.paro.badge", "area.paro.unit", "area.paro.state", "area.paro.note", "area.paro.unavailable",
    "area.paro.missing", "area.paro.notPublished", "area.paro.loading", "area.paro.sourceUnavailable",
    "surface.place.area.paro", "unit.paro",
  ]) {
    assert.ok(SHELL_DICTIONARIES.en[key], `en.${key}`);
    assert.ok(SHELL_DICTIONARIES.es[key], `es.${key}`);
    assert.notEqual(SHELL_DICTIONARIES.en[key], SHELL_DICTIONARIES.es[key], key);
  }
  assert.match(SHELL_DICTIONARIES.en["area.paro.state"], /tasa absoluta de paro registrado/);
  assert.match(SHELL_DICTIONARIES.es["area.paro.state"], /tasa absoluta de paro registrado/);
  for (const language of ["en", "es"]) {
    assert.match(SHELL_DICTIONARIES[language]["area.paro.note"], /(Lens|Lente) circle|círculo de la Lente/);
    assert.match(SHELL_DICTIONARIES[language]["area.paro.note"], /turístic|tourism/);
  }

  const lines = buildUnemploymentProvenanceLines({ meta: META, period: index.period });
  assert.ok(lines.length >= 3);
  assert.ok(lines.some((line) => /Edition 2026: SEPE registered unemployment of Feb 2026/.test(line)));
  assert.ok(lines.some((line) => /not an independently verified date/.test(line)));
  assert.ok(lines.some((line) => /NOT a tourism impact/.test(line)));
  const period = lines.find((line) => /^Edition 2026/.test(line));
  assert.match(localizeCopyEs(period), /^Edición 2026: paro registrado del SEPE de feb 2026/);
  assert.deepEqual(buildUnemploymentProvenanceLines({}), []);
});

test("the markup, rail and K11 export carry the indicator with its provenance and scope", () => {
  const html = read("../index.html");
  const app = read("../js/app.js");
  const rail = read("../js/scope-rail.js");
  assert.match(html, /id="areaParo"[^>]*hidden/);
  for (const id of ["areaParoValue", "areaParoUnit", "areaParoState", "areaParoNote"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /data-i18n="area\.paro\.title"/);
  // Fetched once with the other area artifacts; failure is its own independent state.
  assert.match(app, /data\/socioeconomic\/madrid_registered_unemployment\.json/);
  assert.match(app, /data\/socioeconomic\/madrid_registered_unemployment\.meta\.json/);
  assert.match(app, /unemploymentIndex = profileModule\.createUnemploymentIndex/);
  // K11: the visible value is transcribed into the evidence export with its scope and withholding reason.
  assert.match(app, /id: "registered_unemployment_rate"[\s\S]{0,200}scope: "OFFICIAL_BARRIO"/);
  assert.match(app, /withheld_reason: paroAvailable \? undefined : \(paro\.reason \|\| null\)/);
  // The scope rail declares the visible surface at barrio scope, shown only while the block is.
  assert.match(rail, /"place\.area\.paro": \{[^}]*scope: "OFFICIAL_BARRIO"[^}]*sources: \["registered_unemployment_rate", "geography"\][^}]*when: "paro"/);
  assert.match(app, /paro: !document\.getElementById\("areaParo"\)\.hidden/);
});

test("the registry source is blocking, barrio-scoped, CC BY 4.0 and states what the rate is not", () => {
  const source = REGISTRY.sources.find((s) => s.id === "registered_unemployment_rate");
  assert.ok(source);
  assert.equal(source.scope, "OFFICIAL_BARRIO");
  assert.equal(source.blocks_deployment, true);
  assert.equal(source.rebuilt_at_deploy, false);
  assert.equal(source.license, "CC BY 4.0");
  assert.equal(source.dataset_url, "https://datos.madrid.es/dataset/300087-0-indicadores-distritos");
  assert.equal(source.reference_date, `${ARTIFACT.source_period.reference_year}-02`);
  for (const phrase of ["NOT the EPA unemployment rate", "NOT a tourism impact", "never ranked"]) {
    assert.ok(source.interpretation_ceiling.includes(phrase), phrase);
  }
});
