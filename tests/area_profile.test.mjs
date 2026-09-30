// Area Profile: the administrative context of a Lens centre.
//
// THE DECISIVE CONTRACT THESE TESTS DEFEND: the Lens circle and the official
// barrio are different analytical objects. A barrio's registered population
// belongs to the WHOLE barrio and is never distributed into, weighted by, or
// reported as the population of the circle. Everything else here — the lookup,
// the code-based join, the abstention states, the same-barrio comparison — is
// in service of keeping that distinction true in the interface.
//
// Runs against the committed canonical artifacts, so a bad regeneration or a
// broken join fails here on every push, on both Windows and Ubuntu. No network.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createGeographyIndex } from "../js/geography.js";
import {
  AREA_COMPARISON,
  AREA_STATE,
  EVIDENCE_LABEL,
  EVIDENCE_TYPE,
  RESIDENTS_STATE,
  buildAreaProfile,
  buildProvenanceLines,
  compareAreaProfiles,
  createPopulationIndex,
  formatReferenceDate,
  formatResidents,
} from "../js/area-profile.js";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
}

const GEO = readJson("../data/geography/madrid_admin.geojson");
const POPULATION = readJson("../data/population/madrid_population.json");
const POPULATION_META = readJson("../data/population/madrid_population.meta.json");
const GEO_META = readJson("../data/geography/madrid_admin.meta.json");

const index = createGeographyIndex(GEO);
const population = createPopulationIndex(POPULATION);

const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");

// Coordinates chosen from well-known Madrid landmarks, each comfortably inside
// its barrio rather than near a boundary, so these are stable expectations.
const PRADO = { lon: -3.6921, lat: 40.4138 }; // Museo del Prado
const SOL = { lon: -3.7038, lat: 40.4169 }; // Puerta del Sol
const BERNABEU = { lon: -3.6883, lat: 40.4531 };
const TOLEDO = { lon: -4.0273, lat: 39.8628 }; // a different province entirely
const ALCALA = { lon: -3.3641, lat: 40.482 }; // a different municipality nearby

const profileAt = (point, lens = "A") =>
  buildAreaProfile({
    lens,
    located: index.resolve(point.lon, point.lat),
    populationIndex: population,
  });

// ------------------------------------------------------------------ area lookup

test("a known coordinate resolves to its official barrio and district", () => {
  const located = index.resolve(PRADO.lon, PRADO.lat);
  assert.equal(located.barrio.official_id, "035");
  assert.equal(located.barrio.official_name, "Los Jerónimos");
  assert.equal(located.district.official_id, "03");
  assert.equal(located.district.official_name, "Retiro");
  assert.equal(located.inside_municipality, true);

  const sol = index.resolve(SOL.lon, SOL.lat);
  assert.equal(sol.district.official_name, "Centro");
  assert.equal(sol.barrio.parent_id, "01");
});

test("a coordinate outside the municipality resolves to no official area", () => {
  for (const point of [TOLEDO, ALCALA]) {
    const located = index.resolve(point.lon, point.lat);
    assert.equal(located.inside_municipality, false);
    assert.equal(located.barrio, null);
    assert.equal(located.district, null);
  }
});

test("resolve() is hierarchy-coherent: the district always owns the barrio", () => {
  // Two independent scans can disagree on a shared boundary; the profile must
  // never show a barrio beside a district it does not belong to.
  for (const feature of GEO.features) {
    if (feature.properties.geography_level !== "barrio") continue;
    const [lon, lat] = feature.geometry.type === "Polygon"
      ? feature.geometry.coordinates[0][0]
      : feature.geometry.coordinates[0][0][0];
    // Nudge inward from a vertex towards the ring's second point so the sample
    // is inside the polygon rather than exactly on a corner.
    const ring = feature.geometry.type === "Polygon"
      ? feature.geometry.coordinates[0]
      : feature.geometry.coordinates[0][0];
    const mid = { lon: (lon + ring[Math.floor(ring.length / 2)][0]) / 2, lat: (lat + ring[Math.floor(ring.length / 2)][1]) / 2 };
    const located = index.resolve(mid.lon, mid.lat);
    if (!located.barrio) continue;
    assert.ok(located.district, `barrio ${located.barrio.official_id} resolved without a district`);
    assert.equal(
      located.barrio.parent_id,
      located.district.official_id,
      `barrio ${located.barrio.official_id} was paired with district ${located.district.official_id}`
    );
  }
});

test("the drag hint is a performance hint only and never changes the answer", () => {
  const cold = index.resolve(PRADO.lon, PRADO.lat);
  const rightHint = index.resolve(PRADO.lon, PRADO.lat, "035");
  const wrongHint = index.resolve(PRADO.lon, PRADO.lat, "016");
  const absentHint = index.resolve(PRADO.lon, PRADO.lat, "nonexistent");

  for (const result of [rightHint, wrongHint, absentHint]) {
    assert.equal(result.barrio.official_id, cold.barrio.official_id);
    assert.equal(result.district.official_id, cold.district.official_id);
  }

  // A stale hint from a previous position must not stick once the lens leaves.
  const moved = index.resolve(SOL.lon, SOL.lat, "035");
  assert.equal(moved.barrio.official_id, index.resolve(SOL.lon, SOL.lat).barrio.official_id);
  assert.notEqual(moved.barrio.official_id, "035");
});

test("lookups are deterministic across repeated calls", () => {
  const first = JSON.stringify(index.resolve(PRADO.lon, PRADO.lat));
  for (let i = 0; i < 5; i += 1) {
    assert.equal(JSON.stringify(index.resolve(PRADO.lon, PRADO.lat)), first);
  }
});

test("canonical features are reachable by level and by official id", () => {
  assert.equal(index.featuresByLevel("barrio").length, 131);
  assert.equal(index.featuresByLevel("district").length, 21);
  assert.equal(index.featureById("barrio", "035").properties.official_name, "Los Jerónimos");
  assert.equal(index.featureById("barrio", "does-not-exist"), null);
});

// -------------------------------------------------------------- population join

test("the population joins to the geography by official code, for every barrio", () => {
  assert.equal(population.barrio.size, 131);
  assert.equal(population.district.size, 21);
  assert.equal(population.municipality.official_id, "28079");

  for (const feature of GEO.features) {
    if (feature.properties.geography_level !== "barrio") continue;
    const record = population.barrio.get(feature.properties.official_id);
    assert.ok(record, `barrio ${feature.properties.official_id} has no population record`);
    assert.equal(record.parent_id, feature.properties.parent_id, "the join must agree on the parent district");
    assert.ok(Number.isFinite(record.residents) && record.residents >= 0);
  }
});

test("the canonical barrio figure reaches the profile unchanged", () => {
  const profile = profileAt(PRADO);
  assert.equal(profile.state, AREA_STATE.RESOLVED);
  assert.equal(profile.barrioId, "035");
  assert.equal(profile.residents.state, RESIDENTS_STATE.AVAILABLE);
  assert.equal(profile.residents.value, POPULATION.records.find((r) => r.geography_level === "barrio" && r.official_id === "035").residents);
  assert.equal(profile.residents.display, "6,774");
  assert.equal(profile.residents.provenance, "SOURCE_REPORTED");
});

test("the reference period travels with the figure", () => {
  assert.equal(population.period.referenceDate, "2026-01-01");
  assert.equal(population.period.label, "1 Jan 2026");
  const profile = profileAt(PRADO);
  assert.equal(profile.period.referenceDate, "2026-01-01");
  assert.equal(profile.period.label, "1 Jan 2026");
  assert.equal(profile.evidenceType, EVIDENCE_TYPE);
  assert.equal(profile.evidenceType, "ADMINISTRATIVE_REGISTER");
  assert.equal(profile.evidenceLabel, EVIDENCE_LABEL);
});

test("a missing population value abstains and never falls back to zero", () => {
  const withoutPrado = createPopulationIndex({
    ...POPULATION,
    records: POPULATION.records.filter((r) => !(r.geography_level === "barrio" && r.official_id === "035")),
  });
  const profile = buildAreaProfile({
    lens: "A",
    located: index.resolve(PRADO.lon, PRADO.lat),
    populationIndex: withoutPrado,
  });

  assert.equal(profile.state, AREA_STATE.RESOLVED, "the place is still known");
  assert.equal(profile.headline, "Los Jerónimos");
  assert.equal(profile.residents.state, RESIDENTS_STATE.UNAVAILABLE);
  assert.equal(profile.residents.value, null);
  assert.equal(profile.residents.display, null);
  assert.notEqual(profile.residents.value, 0);
  assert.match(profile.note, /unavailable/i);
});

test("an unusable population artifact yields no index rather than an empty one", () => {
  assert.equal(createPopulationIndex(null), null);
  assert.equal(createPopulationIndex({}), null);

  const profile = buildAreaProfile({
    lens: "A",
    located: index.resolve(PRADO.lon, PRADO.lat),
    populationIndex: null,
  });
  assert.equal(profile.residents.state, RESIDENTS_STATE.UNAVAILABLE);
  assert.equal(profile.residents.value, null);
});

// -------------------------------------------------------------- profile states

test("outside Madrid reports no area and no residential figure", () => {
  const profile = profileAt(TOLEDO);
  assert.equal(profile.state, AREA_STATE.OUTSIDE_MADRID);
  assert.equal(profile.headline, "Outside Madrid City");
  assert.match(profile.note, /Outside the canonical Madrid City administrative geography/);
  assert.equal(profile.residents.state, RESIDENTS_STATE.NOT_APPLICABLE);
  assert.equal(profile.residents.value, null);
  assert.equal(profile.barrioId, null);
});

test("an unavailable geography degrades to an explicit state, not an empty place", () => {
  const profile = buildAreaProfile({ lens: "A", located: null, populationIndex: population, state: AREA_STATE.UNAVAILABLE });
  assert.equal(profile.state, AREA_STATE.UNAVAILABLE);
  assert.match(profile.headline, /unavailable/i);
  assert.equal(profile.residents.state, RESIDENTS_STATE.NOT_APPLICABLE);
  assert.equal(profile.barrioId, null);
});

test("the loading state is explicit and carries no figure", () => {
  const profile = buildAreaProfile({ lens: "A", located: null, populationIndex: null });
  assert.equal(profile.state, AREA_STATE.LOADING);
  assert.equal(profile.residents.value, null);
});

test("inside Madrid but inside no barrio reports the district and abstains", () => {
  const district = GEO.features.find((f) => f.properties.geography_level === "district").properties;
  const profile = buildAreaProfile({
    lens: "A",
    located: { inside_municipality: true, district, barrio: null },
    populationIndex: population,
  });
  assert.equal(profile.state, AREA_STATE.DISTRICT_ONLY);
  assert.equal(profile.headline, district.official_name);
  assert.equal(profile.residents.state, RESIDENTS_STATE.UNAVAILABLE);
  assert.match(profile.note, /No official barrio/);
});

test("the profile states the scope of the figure in its own model", () => {
  const profile = profileAt(PRADO);
  assert.match(profile.scopeCaveat, /Whole official barrio/);
  assert.match(profile.scopeCaveat, /not the Lens circle/);
  assert.equal(profile.context, "Retiro · Madrid");
  assert.equal(profile.codes, "Barrio 035 · District 03");
});

// ------------------------------------------------------------------ comparison

test("two lens centres in the same barrio share ONE administrative statistic", () => {
  const a = profileAt(PRADO, "A");
  const b = profileAt({ lon: PRADO.lon + 0.0004, lat: PRADO.lat + 0.0002 }, "B");
  assert.equal(a.barrioId, b.barrioId, "fixture precondition: both centres in one barrio");

  const comparison = compareAreaProfiles(a, b);
  assert.equal(comparison.state, AREA_COMPARISON.SAME_BARRIO);
  assert.match(comparison.message, /Both Lens centres are in Los Jerónimos/);
  assert.match(comparison.message, /one barrio statistic, not two observations/);
  // The shared figure is stated once, never as a pair or as a difference.
  assert.equal(comparison.message.split("6,774").length - 1, 1);
  assert.doesNotMatch(comparison.message, /[+−-]\s*\d/);
});

test("two lens centres in different barrios name both places", () => {
  const a = profileAt(PRADO, "A");
  const b = profileAt(SOL, "B");
  const comparison = compareAreaProfiles(a, b);
  assert.equal(comparison.state, AREA_COMPARISON.DIFFERENT_DISTRICT);
  assert.match(comparison.message, /Retiro/);
  assert.match(comparison.message, /Centro/);
});

test("two barrios of one district are reported as such", () => {
  const barrios = GEO.features.filter((f) => f.properties.geography_level === "barrio");
  const first = barrios.find((f) => f.properties.parent_id === "01");
  const second = barrios.find((f) => f.properties.parent_id === "01" && f.properties.official_id !== first.properties.official_id);
  const make = (properties, lens) =>
    buildAreaProfile({
      lens,
      located: { inside_municipality: true, district: { official_id: "01", official_name: "Centro" }, barrio: properties },
      populationIndex: population,
    });
  const comparison = compareAreaProfiles(make(first.properties, "A"), make(second.properties, "B"));
  assert.equal(comparison.state, AREA_COMPARISON.SAME_DISTRICT);
  assert.match(comparison.message, /Two barrios of Centro/);
});

test("one lens outside Madrid makes the pair non-comparable, explicitly", () => {
  const comparison = compareAreaProfiles(profileAt(PRADO, "A"), profileAt(TOLEDO, "B"));
  assert.equal(comparison.state, AREA_COMPARISON.PARTIAL);
  assert.match(comparison.message, /outside Madrid City/);

  const both = compareAreaProfiles(profileAt(TOLEDO, "A"), profileAt(ALCALA, "B"));
  assert.equal(both.state, AREA_COMPARISON.PARTIAL);
  assert.match(both.message, /Both Lens centres are outside Madrid City/);
});

test("the comparison never produces a population delta between two barrios", () => {
  const comparison = compareAreaProfiles(profileAt(PRADO, "A"), profileAt(BERNABEU, "B"));
  assert.doesNotMatch(comparison.message, /\d/);
});

// ------------------------------------------------------------------ formatting

test("numbers and dates use one product convention", () => {
  assert.equal(formatResidents(6774), "6,774");
  assert.equal(formatResidents(3497277), "3,497,277");
  assert.equal(formatResidents(null), null);
  assert.equal(formatResidents(Number.NaN), null);

  assert.equal(formatReferenceDate("2026-01-01"), "1 Jan 2026");
  assert.equal(formatReferenceDate("2024-12-31"), "31 Dec 2024");
  assert.equal(formatReferenceDate("not-a-date"), null);
  assert.equal(formatReferenceDate(null), null);
});

test("every provenance line is read from the committed metadata", () => {
  const lines = buildProvenanceLines({
    populationMeta: POPULATION_META,
    geographyMeta: GEO_META,
    period: population.period,
  });
  const text = lines.join(" | ");
  assert.match(text, /Padron Municipal de habitantes/);
  assert.match(text, /Subdireccion General de Estadistica/);
  assert.match(text, /Reference date 1 Jan 2026/);
  assert.match(text, /Barrio geography v3\.4\.1/);
  assert.match(text, /district geography v3\.2\.1/);

  // The interpretation ceiling is the artifact's own, surfaced concisely rather
  // than restated in this file or dumped whole into the panel.
  const ceiling = lines[lines.length - 1];
  assert.ok(POPULATION_META.interpretation_ceiling.startsWith(ceiling.split(". ")[0]));
  assert.match(ceiling, /NOT people physically present/);
  assert.match(ceiling, /NOT tourists/);
  assert.ok(
    ceiling.length < POPULATION_META.interpretation_ceiling.length / 2,
    "the panel must not carry the whole metadata paragraph"
  );

  // Every value in the disclosure comes from a sidecar, not from this codebase:
  // changing a sidecar changes the panel.
  const edited = {
    ...POPULATION_META,
    source: { ...POPULATION_META.source, underlying_register: "Test register", authority: "Test authority" },
    interpretation_ceiling: "A test ceiling. A second test sentence. A third that must not appear.",
  };
  const rewritten = buildProvenanceLines({
    populationMeta: edited,
    geographyMeta: { source_version: { datasets: { barrio: { published_version: "vX" }, district: { published_version: "vY" } } } },
    period: { label: "9 Sep 9999" },
  });
  assert.deepEqual(rewritten, [
    "Test register · Test authority",
    "Reference date 9 Sep 9999",
    "Barrio geography vX · district geography vY",
    "A test ceiling. A second test sentence.",
  ]);
});

test("absent metadata yields no provenance line rather than an invented one", () => {
  assert.deepEqual(buildProvenanceLines({}), []);
  assert.deepEqual(buildProvenanceLines(), []);

  const geographyOnly = buildProvenanceLines({ geographyMeta: GEO_META });
  assert.deepEqual(geographyOnly, ["Barrio geography v3.4.1 · district geography v3.2.1"]);
});

// -------------------------------------------------------- interface integration

test("the panel separates the administrative area from the lens circle", () => {
  assert.match(html, /<section id="areaProfile" class="area"/);
  assert.match(html, /<span>Administrative area<\/span>/);
  assert.match(html, /<span>Within the Lens<\/span>/);
  assert.match(html, /id="lensScopeHint"/);
  assert.match(html, /id="areaScopeNote"/);
  // The area section precedes the lens metrics: where first, then what is here.
  assert.ok(html.indexOf('id="areaProfile"') < html.indexOf('class="metrics"'));
});

test("the lens section states its own geometry so the two are never conflated", () => {
  assert.match(app, /lensScopeHint"\)\.textContent = `\$\{text\} circle`/);
});

test("the interface says 'official register', not the internal enum", () => {
  assert.match(html, /Official register/);
  assert.doesNotMatch(html, /ADMINISTRATIVE_REGISTER/);
  assert.doesNotMatch(css, /ADMINISTRATIVE_REGISTER/);
});

test("the administrative boundary control is one selector, defaulting to off", () => {
  assert.match(html, /<select id="boundarySelect"/);
  assert.match(html, /<option value="off" selected>/);
  assert.match(html, /<option value="district">/);
  assert.match(html, /<option value="barrio">/);
  assert.match(html, /aria-label="Administrative boundaries"/);
  assert.match(app, /function setBoundaryMode\(mode\)/);
  assert.match(app, /let boundaryMode = "off"/);
});

test("administrative geometry renders below the lens and adapts to every basemap", () => {
  assert.match(app, /map\.createPane\("adminPane"\)/);
  assert.match(app, /map\.getPane\("adminPane"\)\.style\.zIndex = "350"/);
  assert.match(app, /map\.getPane\("adminActivePane"\)\.style\.zIndex = "455"/);
  assert.match(app, /const ADMIN_BASEMAP_STYLES = \{/);
  for (const basemap of ["light", "satellite", "dark"]) {
    assert.match(app, new RegExp(`${basemap}: \\{ stroke: "#`), `${basemap} needs its own administrative stroke`);
  }
  assert.match(app, /if \(adminStyleController\) adminStyleController\(requested\)/);
  // The lens stays visually dominant: a heavier stroke than the reference area.
  assert.match(app, /weight: isActive \? 3\.4 : 2\.7/);
  assert.match(app, /weight: isActive \? 2\.3 : 1\.7/);
  assert.match(css, /\.admin-active-pane\{filter:drop-shadow/);
});

test("lens A and lens B areas differ without relying on colour alone", () => {
  assert.match(app, /dashArray: which === "A" \? null : "2 4"/);
  assert.match(app, /setContent\(`<b>\$\{tag\}<\/b>\$\{profile\.headline\}`\)/);
  assert.match(css, /\.area-label-b\{border-color/);
});

test("the map is never covered in 131 barrio labels", () => {
  // Exactly one label per highlighted area, and at most two areas exist.
  const labels = app.match(/className: `area-label area-label-/g) || [];
  assert.equal(labels.length, 1);
  assert.match(app, /renderActiveAreaFor\("A", areaProfiles\.A/);
  assert.match(app, /renderActiveAreaFor\("B", sharedArea \? null : areaProfiles\.B\)/);
});

test("one barrio holding both lens centres is drawn and labelled once", () => {
  // Two outlines on one shape, or two labels at one point, would read as two
  // areas and imply two independent statistics.
  assert.match(app, /const sharedArea = Boolean\(/);
  assert.match(app, /areaProfiles\.A\.barrioId === areaProfiles\.B\.barrioId/);
  assert.match(app, /sharedArea \? \{ tag: "A·B", forceActive: true \} : \{\}/);
  assert.match(app, /renderActiveAreaFor\("B", sharedArea \? null : areaProfiles\.B\)/);
});

test("the other lens's area is one line in the profile, not a second card", () => {
  assert.match(html, /<div id="areaOther" class="area-other"><\/div>/);
  assert.match(app, /function renderOtherLensArea\(a, b\)/);
  assert.match(app, /is in the same barrio — A · B share the same/);
  assert.match(app, /administrative-area statistics, not two observations\./);
  // The comparison grid stays what it always was: circle measurements.
  assert.match(html, /<small>circle measurements only<\/small>/);
  assert.doesNotMatch(html, /id="compareAreas"/);
});

test("the canonical artifacts are loaded once and reused, not refetched on drag", () => {
  assert.match(app, /async function loadAreaContext\(\)/);
  assert.match(app, /loadAreaContext\(\);/);
  // The only fetches of the canonical artifacts happen inside the loader.
  const loaderBody = app.match(/async function loadAreaContext\(\) \{([\s\S]*?)^\}/m)[1];
  const geographyFetches = app.match(/data\/geography\/madrid_admin\.geojson/g) || [];
  assert.equal(geographyFetches.length, 1);
  assert.match(loaderBody, /data\/geography\/madrid_admin\.geojson/);
  assert.match(loaderBody, /createGeographyIndex\(geojson\.value\)/);

  // Dragging inside one barrio must not rewrite the panel or rebuild a layer.
  assert.match(app, /if \(key === lastAreaRenderKey\) return;/);
  assert.match(app, /if \(existing && existing\.barrioId === profile\.barrioId && existing\.tag === tag\)/);
  assert.match(app, /areaHint\[which\]/);
});

// -------------------------------------------------- partial runtime failure
//
// The two canonical artifacts fail independently in a browser. The geography is
// the DEPENDENCY for resolving a place; the population is only a VALUE attached
// to a barrio already resolved. Losing the population must therefore cost the
// resident figure and nothing else.

test("the runtime tracks the geography and the population separately", () => {
  assert.match(app, /let geographyState = "loading"/);
  assert.match(app, /let populationState = "loading"/);
  assert.doesNotMatch(app, /areaContextState/, "the single all-or-nothing state must be gone");

  // Settled, so one rejected request cannot reject the other's result.
  const loaderBody = app.match(/async function loadAreaContext\(\) \{([\s\S]*?)^\}/m)[1];
  assert.match(loaderBody, /Promise\.allSettled\(\[/);
  assert.doesNotMatch(loaderBody, /Promise\.all\(\[\s*fetchAreaJson/);

  // Only the geography gates the place, and only the geography disables the
  // boundary control.
  assert.match(app, /if \(geographyState !== "ready"\) \{/);
  assert.match(loaderBody, /geographyState = "unavailable";\s*\n\s*disableBoundaryControl\(\);/);
  const populationBranch = loaderBody.match(/if \(populationState === "unavailable"\) \{([\s\S]*?)\n  \}/)[1];
  assert.doesNotMatch(populationBranch, /disableBoundaryControl|geographyState/);
});

test("geography available + population unavailable keeps the place and abstains on residents", () => {
  // Exactly the partial-failure case: the population request failed, so there
  // is no population index at all, while the geography resolved normally.
  const profile = buildAreaProfile({
    lens: "A",
    located: index.resolve(PRADO.lon, PRADO.lat),
    populationIndex: null,
  });

  // The place survives in full.
  assert.equal(profile.state, AREA_STATE.RESOLVED);
  assert.equal(profile.headline, "Los Jerónimos");
  assert.equal(profile.context, "Retiro · Madrid");
  assert.equal(profile.codes, "Barrio 035 · District 03");
  assert.equal(profile.barrioId, "035");
  assert.equal(profile.districtId, "03");

  // Only the figure abstains — never a zero, never a fabricated period, and
  // never the generic "administrative context unavailable" headline.
  assert.equal(profile.residents.state, RESIDENTS_STATE.UNAVAILABLE);
  assert.equal(profile.residents.value, null);
  assert.equal(profile.residents.display, null);
  assert.notEqual(profile.residents.value, 0);
  assert.equal(profile.period.referenceDate, null);
  assert.equal(profile.period.label, null);
  assert.match(profile.note, /Residential population unavailable for this administrative area\./);
  assert.doesNotMatch(profile.headline, /unavailable/i);

  // The containing barrio is still a real shape, so the highlight and the
  // boundary layers still have something to draw.
  assert.ok(index.featureById("barrio", profile.barrioId));
  assert.equal(index.featuresByLevel("barrio").length, 131);

  // And a resolved place with no figure must still render as a place: the
  // highlight is drawn for the resolved state, which this profile has.
  assert.match(app, /profile\.state === AREA_STATE\.RESOLVED &&/);
});

test("an unavailable geography never infers an area from the population alone", () => {
  // The population index is perfectly healthy here; it must still produce no
  // place, because a resident count carries no geometry of its own.
  const profile = buildAreaProfile({
    lens: "A",
    located: null,
    populationIndex: population,
    state: AREA_STATE.UNAVAILABLE,
  });

  assert.equal(profile.state, AREA_STATE.UNAVAILABLE);
  assert.equal(profile.barrioId, null);
  assert.equal(profile.districtId, null);
  assert.equal(profile.context, null);
  assert.equal(profile.codes, null);
  assert.equal(profile.residents.state, RESIDENTS_STATE.NOT_APPLICABLE);
  assert.equal(profile.residents.value, null);

  // No municipality-wide or district figure may stand in for a barrio's.
  assert.notEqual(profile.residents.value, population.municipality.residents);
});

test("the two artifacts degrade at runtime without weakening the deployment gate", () => {
  // Runtime graceful degradation and deployment integrity are separate
  // concerns: a browser may lose one artifact, a published build may not ship
  // a broken one.
  const registry = readJson("../data/source_registry.json");
  for (const id of ["geography", "population"]) {
    const source = registry.sources.find((s) => s.id === id);
    assert.equal(source.blocks_deployment, true, `${id} must still block deployment`);
    assert.equal(source.unavailable_is_allowed, false);
  }
});

test("the population is never interpolated into the lens", () => {
  // No code path may multiply a resident count by an overlap, an area or a
  // radius, and no lens metric may read the population index.
  assert.doesNotMatch(app, /residents\s*[*/]/);
  assert.doesNotMatch(app, /populationIndex[\s\S]{0,80}radius/);
  assert.doesNotMatch(app, /radius[\s\S]{0,80}residents/);
  const statsBody = app.match(/function statsFor\(which\) \{([\s\S]*?)^\}/m)[1];
  assert.doesNotMatch(statsBody, /population|residents|barrio/i);
});

test("the interface carries no pressure, density or composite score", () => {
  // The Area Profile now shows ONE descriptive ratio — licensed VUT units per
  // 1,000 registered residents — and it is named in full wherever it appears
  // (asserted in tests/licensed_vut_context.test.mjs). Everything below stays
  // forbidden: these are interpretations the sources cannot support, and no
  // feature may reintroduce them.
  const forbidden = [
    /residents?\s*per\s*(km|hectare|hotel)/i,
    /tourism\s*pressure/i,
    /tourist\s*pressure/i,
    /accommodation\s*pressure/i,
    /neighbourhood\s*pressure/i,
    /overtourism/i,
    /saturation/i,
    /carrying\s*capacity/i,
    /tourism\s*(density|intensity)/i,
    /intensity\s*score/i,
    /composite\s*score/i,
    /displacement/i,
    /hotspot/i,
    /accommodation[\s\S]{0,20}\/[\s\S]{0,20}residents/i,
  ];
  for (const source of [app, html, css]) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `forbidden analytical claim: ${pattern}`);
    }
  }
});
