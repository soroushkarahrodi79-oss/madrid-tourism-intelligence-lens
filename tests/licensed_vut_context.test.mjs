// Licensed VUT context in the Area Profile.
//
// THE CONTRACTS THESE TESTS DEFEND, in order of how much damage breaking them
// would do:
//
//   1. The figure is GRANTED LICENCES, never operating dwellings. The source
//      carries no revocation, expiry or cessation field, so no wording in the
//      product may claim current operation.
//   2. The primary quantity is UNITS, the secondary is LICENCES, and neither is
//      ever given the other's name. One licence in this source covers up to 48
//      dwelling units.
//   3. The numerator's source state and the denominator's reference date are
//      DIFFERENT KINDS OF FACT and are never merged into one period. The HTTP
//      Last-Modified header never becomes a reference date.
//   4. Counts belong to the WHOLE OFFICIAL BARRIO. Nothing is distributed into
//      the Lens circle.
//   5. A failure is never a zero. A zero is only ever the artifact's own
//      published zero for that barrio.
//   6. It is descriptive. No ranking, no bands, no percentile, no score.
//
// Runs against the committed artifacts, so a bad regeneration or a broken join
// fails here on every push, on both Windows and Ubuntu. No network.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createGeographyIndex } from "../js/geography.js";
import {
  AREA_COMPARISON,
  AREA_STATE,
  RATIO_LABEL,
  RATIO_STATE,
  RESIDENTS_STATE,
  VUT_EVIDENCE_LABEL,
  VUT_EVIDENCE_TYPE,
  VUT_LICENCES_LABEL,
  VUT_OPERATION_CAVEAT,
  VUT_STATE,
  VUT_UNITS_LABEL,
  buildAreaProfile,
  buildVutContext,
  buildVutProvenanceLines,
  compareAreaProfiles,
  computeVutRatio,
  countedNoun,
  createPopulationIndex,
  createVutIndex,
  formatLicensedCount,
  formatSourceFileState,
  formatVutRatio,
} from "../js/area-profile.js";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
}

const GEO = readJson("../data/geography/madrid_admin.geojson");
const POPULATION = readJson("../data/population/madrid_population.json");
const VUT = readJson("../data/accommodation/madrid_vut_licences.json");
const VUT_META = readJson("../data/accommodation/madrid_vut_licences.meta.json");

const index = createGeographyIndex(GEO);
const population = createPopulationIndex(POPULATION);
const vut = createVutIndex(VUT);

const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const module_ = fs.readFileSync(new URL("../js/area-profile.js", import.meta.url), "utf8");

// Source with its own prose removed: full-line `//` comments, block comments and
// HTML comments. A vocabulary ban has to be scanned over what the product
// OUTPUTS, because a comment that forbids a word necessarily contains it - and
// the prohibitions in these files are written as full-line comments.
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const appOut = withoutComments(app);
const htmlOut = withoutComments(html);
const cssOut = withoutComments(css);
const moduleOut = withoutComments(module_);

// Landmarks, each comfortably inside its barrio rather than near a boundary.
const SOL = { lon: -3.7038, lat: 40.4169 }; // Puerta del Sol — barrio 016 "Sol", Centro
const PRADO = { lon: -3.6921, lat: 40.4138 }; // Museo del Prado — barrio 035, Retiro
const TOLEDO = { lon: -4.0273, lat: 39.8628 }; // a different province entirely

const profileAt = (point, lens = "A", { populationIndex = population, vutIndex = vut } = {}) =>
  buildAreaProfile({ lens, located: index.resolve(point.lon, point.lat), populationIndex, vutIndex });

const barrioRecords = VUT.records.filter((r) => r.geography_level === "barrio");
const residentsById = new Map(
  POPULATION.records.filter((r) => r.geography_level === "barrio").map((r) => [r.official_id, r.residents])
);

// ------------------------------------------------------------------ indexing

test("every canonical barrio is indexed exactly once", () => {
  const canonical = index.featuresByLevel("barrio").map((f) => f.properties.official_id);
  assert.equal(canonical.length, 131);
  assert.equal(vut.barrio.size, 131);
  for (const id of canonical) {
    assert.ok(vut.barrio.has(id), `barrio ${id} has no licensed-VUT record`);
  }
  // And nothing beyond the canonical division leaked into the barrio index.
  for (const id of vut.barrio.keys()) {
    assert.ok(canonical.includes(id), `${id} is indexed but is not a canonical barrio`);
  }
  assert.equal(vut.district.size, 21);
  assert.equal(vut.municipality.official_id, "28079");
});

test("the index is built by official code, never by name", () => {
  // The artifact carries no names at all, so a name-based join is impossible by
  // construction. This asserts that stays true.
  for (const record of VUT.records) {
    assert.deepEqual(
      Object.keys(record).sort(),
      ["geography_level", "official_id", "parent_id", "value_provenance", "vut_licences", "vut_units"],
      "a licence record carries codes and counts only"
    );
  }
});

test("an unusable artifact yields no index rather than an index of zeros", () => {
  for (const broken of [null, undefined, {}, { records: null }, { records: [] }, { records: "x" }]) {
    assert.equal(createVutIndex(broken), null, `${JSON.stringify(broken)} must not produce an index`);
  }
  // A district-and-municipality-only artifact is unusable too: this is a
  // barrio-level statistic and no aggregate may stand in for it.
  assert.equal(
    createVutIndex({ records: VUT.records.filter((r) => r.geography_level !== "barrio") }),
    null
  );
});

test("one incoherent record costs that barrio its figure, not every barrio theirs", () => {
  const artifact = JSON.parse(JSON.stringify(VUT));
  const target = artifact.records.find((r) => r.geography_level === "barrio");
  target.vut_units = target.vut_licences - 1; // structurally impossible
  const damaged = createVutIndex(artifact);

  assert.ok(damaged, "the rest of the artifact is still usable");
  assert.equal(damaged.barrio.size, 130);
  assert.equal(damaged.barrio.has(target.official_id), false);

  // And the damaged barrio reports unavailable — never zero.
  const context = buildVutContext({
    vutIndex: damaged,
    barrio: { official_id: target.official_id },
    residents: { state: RESIDENTS_STATE.AVAILABLE, value: 10000 },
  });
  assert.equal(context.state, VUT_STATE.UNAVAILABLE);
  assert.equal(context.units.value, null);
  assert.notEqual(context.units.value, 0);
});

test("a non-integer or negative count is refused, not coerced", () => {
  for (const bad of [{ vut_units: 2.5 }, { vut_units: -1 }, { vut_units: "7" }, { vut_licences: null }]) {
    const artifact = {
      records: [
        {
          geography_level: "barrio",
          official_id: "011",
          parent_id: "01",
          vut_licences: 1,
          vut_units: 1,
          value_provenance: "DERIVED_FROM_LICENCE_RECORDS",
          ...bad,
        },
      ],
    };
    assert.equal(createVutIndex(artifact), null, `${JSON.stringify(bad)} must be refused`);
  }
});

// --------------------------------------------------------------- zero handling

test("a published zero is a real zero, and a failure never becomes one", () => {
  const zeros = barrioRecords.filter((r) => r.vut_units === 0);
  assert.ok(zeros.length > 0, "the committed extract genuinely reports zero for some barrios");

  const zeroBarrio = index
    .featuresByLevel("barrio")
    .find((f) => f.properties.official_id === zeros[0].official_id).properties;
  const context = buildVutContext({
    vutIndex: vut,
    barrio: zeroBarrio,
    residents: { state: RESIDENTS_STATE.AVAILABLE, value: residentsById.get(zeroBarrio.official_id) },
  });

  // A zero from the artifact is AVAILABLE and displays as a number.
  assert.equal(context.state, VUT_STATE.AVAILABLE);
  assert.equal(context.units.value, 0);
  assert.equal(context.units.display, "0");
  assert.equal(context.licences.value, 0);
  assert.equal(context.ratio.state, RATIO_STATE.AVAILABLE);
  assert.equal(context.ratio.value, 0);
  assert.equal(context.ratio.display, "0");

  // A missing artifact is UNAVAILABLE and displays nothing.
  const absent = buildVutContext({ vutIndex: null, barrio: zeroBarrio, residents: null });
  assert.equal(absent.state, VUT_STATE.UNAVAILABLE);
  assert.equal(absent.units.value, null);
  assert.equal(absent.units.display, null);
});

// ---------------------------------------------------------------------- ratio

test("the ratio is units over registered residents, times 1,000", () => {
  assert.equal(computeVutRatio(42, 23410).state, RATIO_STATE.AVAILABLE);
  assert.equal(computeVutRatio(42, 23410).value, (42 / 23410) * 1000);
  assert.equal(computeVutRatio(42, 23410).display, "1.8");

  // The worked example from the committed data: 48 units from ONE licence.
  const outlier = barrioRecords.find((r) => r.official_id === "095");
  assert.equal(outlier.vut_units, 48);
  assert.equal(outlier.vut_licences, 1);
  assert.equal(computeVutRatio(outlier.vut_units, residentsById.get("095")).display, "6.2");
});

test("the ratio abstains rather than producing NaN, Infinity or a fabricated zero", () => {
  for (const [units, residents, state] of [
    [null, 10000, RATIO_STATE.NO_NUMERATOR],
    [undefined, 10000, RATIO_STATE.NO_NUMERATOR],
    [Number.NaN, 10000, RATIO_STATE.NO_NUMERATOR],
    [-1, 10000, RATIO_STATE.NO_NUMERATOR],
    [42, null, RATIO_STATE.NO_DENOMINATOR],
    [42, undefined, RATIO_STATE.NO_DENOMINATOR],
    [42, Number.NaN, RATIO_STATE.NO_DENOMINATOR],
    [42, 0, RATIO_STATE.NO_DENOMINATOR],
    [42, -5, RATIO_STATE.NO_DENOMINATOR],
    [0, 0, RATIO_STATE.NO_DENOMINATOR],
  ]) {
    const result = computeVutRatio(units, residents);
    assert.equal(result.state, state, `${units} / ${residents}`);
    assert.equal(result.value, null);
    assert.equal(result.display, null);
    assert.notEqual(result.value, 0);
  }

  // Every committed barrio produces a finite ratio or an explicit abstention —
  // never a NaN or an Infinity reaching the interface.
  for (const record of barrioRecords) {
    const result = computeVutRatio(record.vut_units, residentsById.get(record.official_id));
    assert.equal(result.state, RATIO_STATE.AVAILABLE);
    assert.ok(Number.isFinite(result.value), `barrio ${record.official_id} produced ${result.value}`);
    assert.ok(result.display && !/NaN|Infinity/.test(result.display));
  }
});

test("the ratio uses units, never the licence count", () => {
  // The barrio where the two differ most: 48 units, 1 licence. A ratio built on
  // licences would be 48 times smaller, and would be a different indicator.
  const residents = residentsById.get("095");
  const fromUnits = computeVutRatio(48, residents).value;
  const fromLicences = computeVutRatio(1, residents).value;
  assert.notEqual(fromUnits, fromLicences);

  const profile = buildAreaProfile({
    lens: "A",
    located: index.resolve(-3.7, 40.42),
    populationIndex: population,
    vutIndex: vut,
  });
  const expected = computeVutRatio(profile.vut.units.value, profile.residents.value).value;
  assert.equal(profile.vut.ratio.value, expected);
  assert.notEqual(
    profile.vut.ratio.value,
    computeVutRatio(profile.vut.licences.value, profile.residents.value).value
  );
});

test("ratio formatting is concise without printing a false zero", () => {
  assert.equal(formatVutRatio(0), "0", "a real zero is a plain zero, not 0.0");
  assert.equal(formatVutRatio(6.23), "6.2");
  assert.equal(formatVutRatio(1.664), "1.7");
  assert.equal(formatVutRatio(2), "2", "an integer-valued ratio is not padded with .0");
  assert.equal(formatVutRatio(2.04), "2");
  assert.equal(formatVutRatio(0.05), "0.1");

  // The case that matters: a barrio with genuine licensed units must never
  // print a figure that reads as zero.
  assert.equal(formatVutRatio(0.026), "<0.1");
  assert.equal(formatVutRatio(0.0499), "<0.1");

  assert.equal(formatVutRatio(null), null);
  assert.equal(formatVutRatio(Number.NaN), null);
  assert.equal(formatVutRatio(Number.POSITIVE_INFINITY), null);
  assert.equal(formatVutRatio(-1), null);

  // Six committed barrios hold one to three units among tens of thousands of
  // residents. Each must say it is small, not say it is nothing.
  const tiny = barrioRecords.filter((r) => {
    const value = computeVutRatio(r.vut_units, residentsById.get(r.official_id)).value;
    return r.vut_units > 0 && value < 0.05;
  });
  assert.ok(tiny.length > 0, "fixture precondition: some barrios round below 0.1");
  for (const record of tiny) {
    const display = computeVutRatio(record.vut_units, residentsById.get(record.official_id)).display;
    assert.equal(display, "<0.1");
    assert.notEqual(display, "0");
    assert.notEqual(display, "0.0");
  }
});

test("counts are formatted with one product convention", () => {
  assert.equal(formatLicensedCount(42), "42");
  assert.equal(formatLicensedCount(1483), "1,483");
  assert.equal(formatLicensedCount(0), "0");
  assert.equal(formatLicensedCount(2.5), null);
  assert.equal(formatLicensedCount(-1), null);
  assert.equal(formatLicensedCount(null), null);
});

// -------------------------------------------------------------------- semantics

test("licences and units stay separate figures with separate names", () => {
  const profile = profileAt(SOL);
  assert.equal(profile.barrioId, "016");
  assert.equal(profile.vut.units.value, 14);
  assert.equal(profile.vut.licences.value, 8);
  assert.notEqual(profile.vut.units.value, profile.vut.licences.value);

  // The labels are distinct and neither can be mistaken for the other.
  assert.equal(VUT_UNITS_LABEL, "licensed VUT units");
  assert.equal(VUT_LICENCES_LABEL, "activity licences");
  assert.notEqual(VUT_UNITS_LABEL, VUT_LICENCES_LABEL);

  // Across the whole committed extract, units are never fewer than licences.
  for (const record of VUT.records) {
    assert.ok(
      record.vut_units >= record.vut_licences,
      `${record.geography_level} ${record.official_id}: ${record.vut_units} units for ${record.vut_licences} licences`
    );
  }
  assert.equal(VUT.counts.licences, 1025);
  assert.equal(VUT.counts.vut_units, 1483);
});

test("nothing in the product calls a licence a dwelling, or a licence operating", () => {
  for (const [name, source] of [["app.js", appOut], ["index.html", htmlOut], ["app.css", cssOut]]) {
    for (const pattern of [
      /active\s+VUT/i,
      /operating\s+VUT/i,
      /current\s+tourist\s+dwelling/i,
      /airbnb/i,
      /\blegal\b/i,
      /licensed\s+dwellings?\b/i,
      /\d+\s*(?:licences?|licenses?)\s*(?:tourist\s*)?dwellings?/i,
    ]) {
      assert.doesNotMatch(source, pattern, `${name} must not contain ${pattern}`);
    }
  }

  // The module states the ceiling explicitly, in its own words, so the rule is
  // documented where the logic lives rather than only in a test.
  assert.match(module_, /NOT a count of[\s\S]{0,8}dwellings in operation/);
  assert.match(module_, /no revocation, expiry or cessation field/);
  assert.match(module_, /WHOLE OFFICIAL BARRIO/);
});

test("the evidence family is a licence, not a register", () => {
  assert.equal(VUT_EVIDENCE_TYPE, "ADMINISTRATIVE_LICENSE");
  assert.equal(VUT_EVIDENCE_LABEL, "Administrative licence");
  assert.equal(profileAt(SOL).vut.evidenceType, VUT_EVIDENCE_TYPE);

  // The interface shows the plain-language label, never the internal enum.
  assert.match(html, /Administrative licence/);
  assert.doesNotMatch(html, /ADMINISTRATIVE_LICENSE/);
  assert.doesNotMatch(css, /ADMINISTRATIVE_LICENSE/);
  assert.doesNotMatch(app, /ADMINISTRATIVE_LICENSE/);
});

test("the figure is a whole-barrio statistic and is never put in the circle", () => {
  const profile = profileAt(SOL);
  assert.match(profile.vut.scopeCaveat, /Whole official barrio/);
  assert.match(profile.vut.scopeCaveat, /not the Lens circle/);
  assert.match(html, /whole official barrio/i);

  // No code path may divide, weight or scale a licensed count by a radius, an
  // area or an overlap, and no lens metric may read the licensed-VUT index.
  assert.doesNotMatch(app, /vut_units\s*[*/]/);
  assert.doesNotMatch(app, /vutIndex[\s\S]{0,80}radius/);
  assert.doesNotMatch(app, /radius[\s\S]{0,80}vut/i);
  const statsBody = app.match(/function statsFor\(which\) \{([\s\S]*?)^\}/m)[1];
  assert.doesNotMatch(statsBody, /vut|licence|licensed/i);

  // The pure module computes the ratio; the DOM layer never does arithmetic on
  // a licensed count of its own.
  assert.match(module_, /export function computeVutRatio/);
  const renderBody = app.match(/function renderVutContext\(profile\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(renderBody, /[*/]\s*1,?000/);
  assert.doesNotMatch(renderBody, /vut\.units\.value\s*[*/]/);
});

test("this is descriptive context: no rank, no band, no percentile, no score", () => {
  for (const [name, source] of [
    ["app.js", appOut],
    ["index.html", htmlOut],
    ["app.css", cssOut],
    ["area-profile.js", moduleOut],
  ]) {
    for (const pattern of [
      /percentile/i,
      /\brank(ing|ed)?\b/i,
      /class\s*break/i,
      /choropleth/i,
      /\bquantile\b/i,
      /\bdecile\b/i,
      /LOW.{0,3}MEDIUM.{0,3}HIGH/i,
    ]) {
      assert.doesNotMatch(source, pattern, `${name} must not contain ${pattern}`);
    }
  }
  // The view model exposes no comparative or ordinal field of any kind.
  const model = profileAt(SOL).vut;
  assert.deepEqual(
    Object.keys(model).sort(),
    ["evidenceLabel", "evidenceType", "licences", "ratio", "scopeCaveat", "sourceState", "state", "units", "valueProvenance"]
  );
});

// ---------------------------------------------------------------------- periods

test("the numerator's source state never becomes a reference date", () => {
  const state = vut.sourceState;
  assert.equal(state.fileLastModified, "Mon, 07 Sep 2026 10:11:03 GMT");
  assert.equal(state.fileStateLabel, "7 Sep 2026");
  assert.equal(state.fileStateCompact, "Sep 2026");
  assert.equal(state.publisherDeclaredReferenceDate, false);

  // There is no field on the model that a consumer could read as a period.
  assert.deepEqual(
    Object.keys(state).sort(),
    ["fileLastModified", "fileStateCompact", "fileStateLabel", "grantDateSpan", "publisherDeclaredReferenceDate"]
  );
  assert.ok(!("referenceDate" in state));
  assert.ok(!("period" in state));

  // The committed sidecar agrees: the publisher declares none.
  assert.equal(VUT_META.source_period.reference_date_published_by_source, false);
  assert.equal(VUT_META.source_period.effective_date_published_by_source, false);

  // And the interface says "source file state", never "reference".
  assert.match(app, /source file state \$\{fileState\}/);
  assert.doesNotMatch(app, /VUT reference date/i);
  assert.doesNotMatch(html, /VUT reference/i);
});

test("the two periods are exposed separately and never collapsed into one", () => {
  const profile = profileAt(SOL);

  // The denominator keeps its real Padron reference date.
  assert.equal(profile.period.referenceDate, "2026-01-01");
  assert.equal(profile.period.label, "1 Jan 2026");

  // The numerator carries a file state, and it is a different string.
  assert.equal(profile.vut.sourceState.fileStateLabel, "7 Sep 2026");
  assert.notEqual(profile.vut.sourceState.fileStateLabel, profile.period.label);

  // Nothing anywhere merges them into one label.
  for (const source of [app, html, css]) {
    assert.doesNotMatch(source, /VUT\s*&\s*population/i);
    assert.doesNotMatch(source, /VUT and population/i);
  }
  // The resident figure's own period line is still the Padron reference date.
  assert.match(app, /`Reference \$\{period\}`/);
});

test("an HTTP date is parsed as a file state, and anything else is left out", () => {
  assert.deepEqual(formatSourceFileState("Mon, 07 Sep 2026 10:11:03 GMT"), {
    label: "7 Sep 2026",
    compact: "Sep 2026",
  });
  assert.deepEqual(formatSourceFileState("Tue, 01 Jan 2019 00:00:00 GMT"), {
    label: "1 Jan 2019",
    compact: "Jan 2019",
  });
  for (const bad of ["2026-09-07", "not a date", "", null, undefined, "Mon, 07 Zzz 2026 10:11:03 GMT"]) {
    assert.equal(formatSourceFileState(bad), null, `${bad} must not become a file state`);
  }
});

test("the grant-date span is exposed as a property of the records", () => {
  const span = vut.sourceState.grantDateSpan;
  assert.equal(span.earliest, "2019-03-06");
  assert.equal(span.latest, "2026-09-02");
  assert.equal(span.earliestLabel, "6 Mar 2019");
  assert.equal(span.latestLabel, "2 Sep 2026");
});

// ------------------------------------------------------------------- comparison

test("two lens centres in one barrio share ONE administrative-area statistic", () => {
  const a = profileAt(SOL, "A");
  const b = profileAt({ lon: SOL.lon + 0.0003, lat: SOL.lat + 0.0002 }, "B");
  assert.equal(a.barrioId, b.barrioId, "fixture precondition: both centres in one barrio");

  // The same barrio yields the same figures, which is exactly why the interface
  // must state that they are shared rather than print them twice.
  assert.equal(a.vut.units.value, b.vut.units.value);
  assert.equal(a.vut.ratio.value, b.vut.ratio.value);

  assert.equal(compareAreaProfiles(a, b).state, AREA_COMPARISON.SAME_BARRIO);
  assert.match(app, /comparison\.state === AREA_COMPARISON\.SAME_BARRIO/);
  assert.match(app, /A · B share the same/);
  assert.match(app, /administrative-area statistics, not two observations\./);
});

test("two lens centres in different barrios get two independent descriptive values", () => {
  const a = profileAt(SOL, "A");
  const b = profileAt(PRADO, "B");
  assert.notEqual(a.barrioId, b.barrioId);
  assert.equal(a.vut.state, VUT_STATE.AVAILABLE);
  assert.equal(b.vut.state, VUT_STATE.AVAILABLE);

  // Two values, each belonging to its own barrio. No difference is computed
  // between them anywhere in the model or in the wiring.
  const comparison = compareAreaProfiles(a, b);
  assert.doesNotMatch(comparison.message, /\d/, "the comparison names places, never figures");
  assert.ok(!("delta" in comparison));
  assert.ok(!("winner" in comparison));
  assert.doesNotMatch(app, /vutDelta|deltaVut|ratioDelta/);

  // The other lens's figure is shown as a plain value on its own line.
  assert.match(app, /\$\{otherVut\.units\.display\} \$\{areaModel\.profile\.countedNoun\("units", otherVut\.units\.value\)\}/);
  // Scoped to the wiring that renders the pair, because a comparative verdict
  // could only be introduced there.
  const otherBody = app.match(/function renderOtherLensArea\(a, b\) \{([\s\S]*?)\n\}/)[1];
  for (const source of [otherBody, html]) {
    assert.doesNotMatch(source, /\bbetter\b/i);
    assert.doesNotMatch(source, /\bworse\b/i);
    assert.doesNotMatch(source, /percentage\s*advantage/i);
    assert.doesNotMatch(source, /\bwinner\b/i);
  }
});

// -------------------------------------------------------------- partial failure
//
// Three sources fail independently. One failed source must never erase
// unrelated valid evidence.

test("geography + population + VUT all available gives the full indicator", () => {
  const profile = profileAt(SOL);
  assert.equal(profile.state, AREA_STATE.RESOLVED);
  assert.equal(profile.residents.state, RESIDENTS_STATE.AVAILABLE);
  assert.equal(profile.vut.state, VUT_STATE.AVAILABLE);
  assert.equal(profile.vut.ratio.state, RATIO_STATE.AVAILABLE);
});

test("VUT unavailable costs the licensed-VUT block and nothing else", () => {
  const profile = profileAt(SOL, "A", { vutIndex: null });

  // The place and the resident figure both survive in full.
  assert.equal(profile.state, AREA_STATE.RESOLVED);
  assert.equal(profile.headline, "Sol");
  assert.equal(profile.residents.state, RESIDENTS_STATE.AVAILABLE);
  assert.equal(profile.residents.value, 8099);
  assert.equal(profile.period.label, "1 Jan 2026");

  // Only the licensed-VUT block abstains, and it never shows a zero.
  assert.equal(profile.vut.state, VUT_STATE.UNAVAILABLE);
  assert.equal(profile.vut.units.value, null);
  assert.equal(profile.vut.licences.value, null);
  assert.notEqual(profile.vut.units.value, 0);
  assert.equal(profile.vut.ratio.state, RATIO_STATE.NO_NUMERATOR);
});

test("population unavailable keeps the raw licensed counts and abstains on the ratio", () => {
  const profile = profileAt(SOL, "A", { populationIndex: null });

  // The place stands, and so do both raw licensed figures.
  assert.equal(profile.state, AREA_STATE.RESOLVED);
  assert.equal(profile.vut.state, VUT_STATE.AVAILABLE);
  assert.equal(profile.vut.units.value, 14);
  assert.equal(profile.vut.licences.value, 8);

  // The ratio, and only the ratio, abstains — and it says which side is missing.
  assert.equal(profile.residents.state, RESIDENTS_STATE.UNAVAILABLE);
  assert.equal(profile.vut.ratio.state, RATIO_STATE.NO_DENOMINATOR);
  assert.equal(profile.vut.ratio.value, null);
  assert.equal(profile.vut.ratio.display, null);
  assert.match(app, /ratio unavailable without a resident figure/);
});

test("geography unavailable resolves no administrative context at all", () => {
  const profile = buildAreaProfile({
    lens: "A",
    located: null,
    populationIndex: population,
    vutIndex: vut,
    state: AREA_STATE.UNAVAILABLE,
  });
  assert.equal(profile.state, AREA_STATE.UNAVAILABLE);
  assert.equal(profile.barrioId, null);
  assert.equal(profile.vut.state, VUT_STATE.NOT_APPLICABLE);
  assert.equal(profile.vut.units.value, null);

  // A healthy licence index carries no geometry of its own, so it can never
  // stand in for a place — nor may the municipality total stand in for a barrio.
  assert.notEqual(profile.vut.units.value, vut.municipality.vut_units);
});

test("outside Madrid there is no licensed-VUT indicator and no fallback", () => {
  const profile = profileAt(TOLEDO);
  assert.equal(profile.state, AREA_STATE.OUTSIDE_MADRID);
  assert.equal(profile.vut.state, VUT_STATE.NOT_APPLICABLE);
  assert.equal(profile.vut.units.value, null);
  assert.equal(profile.vut.ratio.state, RATIO_STATE.NO_NUMERATOR);

  // No nearest-barrio inference: nothing resolves a figure from a coordinate
  // that no official barrio contains.
  assert.doesNotMatch(app, /nearestBarrio|closestBarrio/i);
});

test("inside Madrid but inside no barrio reports no barrio statistic", () => {
  const district = GEO.features.find((f) => f.properties.geography_level === "district").properties;
  const profile = buildAreaProfile({
    lens: "A",
    located: { inside_municipality: true, district, barrio: null },
    populationIndex: population,
    vutIndex: vut,
  });
  assert.equal(profile.state, AREA_STATE.DISTRICT_ONLY);
  // The artifact HAS a district total; it is deliberately not used, because the
  // indicator is a whole-barrio statistic.
  assert.equal(profile.vut.state, VUT_STATE.NOT_APPLICABLE);
  assert.equal(profile.vut.units.value, null);
  assert.ok(vut.district.get(district.official_id), "a district total exists and is still not shown");
});

// ------------------------------------------------------------------- disclosure

test("the licensed-VUT disclosure is read from the committed sidecar", () => {
  const lines = buildVutProvenanceLines({ vutMeta: VUT_META, sourceState: vut.sourceState });
  const text = lines.join(" | ");

  assert.match(text, /Viviendas de uso turistico con licencia/);
  assert.match(text, /Agencia de Actividades/);
  assert.match(text, /Administrative licence/);
  assert.match(text, /number of tourist-dwelling units included in each activity licence/);
  assert.match(text, /HTTP Last-Modified observed on the resource file, 7 Sep 2026/);
  assert.match(text, /declares no reference or effective date, so this is not one/);
  assert.match(text, /grant dates in this extract span 6 Mar 2019 to 2 Sep 2026/);

  // The operation caveat is the product's own sentence, and the committed
  // sidecar has to say the same thing, so the two cannot drift apart.
  assert.match(text, /does not establish that the dwellings are currently operating/);
  assert.match(VUT_META.universe.currency_caveat, /no revocation, expiry or cessation field/);
  assert.match(VUT_META.universe.currency_caveat, /cannot establish current operation/);
  assert.match(VUT_META.universe.currency_caveat, /never be called 'operating VUT'/);

  // Concise, not the sidecar dumped into a panel: the ceiling is surfaced in the
  // artifact's own opening words, and what it opens with is what a reader of
  // this figure needs - what it counts, and what it is not.
  const ceilingLine = lines.find((line) => line.startsWith("A count of granted"));
  assert.ok(
    ceilingLine.length < VUT_META.interpretation_ceiling.length,
    "the ceiling is surfaced in part, not whole"
  );
  assert.match(ceilingLine, /NOT all tourist dwellings in operation/);
  assert.match(ceilingLine, /NOT a measure of tourism pressure/);
  assert.match(ceilingLine, /NOT a ratio of any kind/);
  assert.ok(
    text.length < JSON.stringify(VUT_META).length / 4,
    "the panel must not carry every metadata paragraph whole"
  );
  assert.ok(lines.length <= 6, `the disclosure is ${lines.length} lines; it must stay scannable`);

  // Every value comes from the sidecar: changing the sidecar changes the panel.
  const rewritten = buildVutProvenanceLines({
    vutMeta: {
      source: { dataset: "Test dataset", authority: "Test authority" },
      unit_of_analysis: { vut_units: "test unit definition" },
      interpretation_ceiling: "A test ceiling. A second sentence. A third that must not appear.",
    },
    sourceState: { fileStateLabel: null, grantDateSpan: null },
  });
  assert.deepEqual(rewritten, [
    "Test dataset · Test authority",
    "Administrative licence · test unit definition",
    "A test ceiling. A second sentence.",
    VUT_OPERATION_CAVEAT,
  ]);

  // Absent metadata invents no dataset, authority, date or ceiling. What
  // remains is only what is true of the source itself whatever the sidecar
  // says: it is licence evidence, and it does not establish operation.
  assert.deepEqual(buildVutProvenanceLines({}), ["Administrative licence", VUT_OPERATION_CAVEAT]);
  assert.deepEqual(buildVutProvenanceLines(), ["Administrative licence", VUT_OPERATION_CAVEAT]);
});

test("the disclosure keeps the numerator and the denominator in named groups", () => {
  assert.match(app, /title: "Registered residents"/);
  assert.match(app, /title: "Licensed VUT units"/);
  assert.match(app, /buildVutProvenanceLines\(\{/);
  assert.match(app, /area-source-group-title/);
  assert.match(css, /\.area-source-group-title\{/);
  // The affordance still only appears when there is provenance behind it.
  assert.match(app, /areaSourceToggle"\)\.hidden = groups\.length === 0/);
});

// --------------------------------------------------------- interface integration

test("the licensed-VUT block lives inside the administrative area section", () => {
  assert.match(html, /<div id="areaVut" class="area-vut" hidden>/);
  // Inside the Administrative area section, below the place identity and the
  // resident figure, and above the Within the Lens metrics.
  assert.ok(html.indexOf('id="areaProfile"') < html.indexOf('id="areaVut"'));
  assert.ok(html.indexOf('id="areaResidentsValue"') < html.indexOf('id="areaVut"'));
  assert.ok(html.indexOf('id="areaVut"') < html.indexOf('<span>Within the Lens</span>'));
  // Inside the polite live region, so a changed figure is announced.
  assert.ok(html.indexOf('id="areaLive"') < html.indexOf('id="areaVut"'));
  assert.ok(html.indexOf('id="areaVut"') < html.indexOf('id="areaSourceToggle"'));
});

test("the place identity stays visually primary and the figure stays subordinate", () => {
  const size = (selector) => {
    const match = new RegExp(`${selector}\\{[^}]*font-size:([\\d.]+)px`).exec(css);
    return match ? Number(match[1]) : null;
  };
  const residents = size("\\.area-value");
  const licensed = size("\\.area-vut-value");
  assert.ok(licensed < residents, `the licensed figure (${licensed}px) must be smaller than residents (${residents}px)`);
  assert.ok(licensed < Number(/\.title\{font-size:([\d.]+)px/.exec(css)[1]));

  // And the same ordering holds in the mobile drawer.
  const mobile = css.slice(css.indexOf("@media(max-width:850px)"));
  assert.ok(Number(/\.area-vut-value\{font-size:([\d.]+)px/.exec(mobile)[1]) < Number(/\.area-value\{font-size:([\d.]+)px/.exec(mobile)[1]));
});

test("the primary displayed figure is units and the secondary is licences", () => {
  // The big number is the unit count; the licence count is a supporting line.
  assert.match(app, /value\.textContent = available \? vut\.units\.display : "Unavailable"/);
  assert.match(html, /id="areaVutValue"[\s\S]{0,140}licensed VUT units/);
  assert.match(app, /parts = \[`\$\{vut\.licences\.display\} \$\{labels\.countedNoun\("licences", vut\.licences\.value\)\}`\]/);
  // The static label and the module constant say the same thing, so the figure
  // is named before the module loads and never named twice differently.
  assert.ok(html.includes(VUT_UNITS_LABEL), `index.html must carry the label "${VUT_UNITS_LABEL}"`);

  // Count agreement: this product never prints "1 activity licences". Several
  // committed barrios hold exactly one licence or exactly one unit.
  assert.equal(countedNoun("units", 1), "licensed VUT unit");
  assert.equal(countedNoun("units", 0), "licensed VUT units");
  assert.equal(countedNoun("units", 48), "licensed VUT units");
  assert.equal(countedNoun("licences", 1), "activity licence");
  assert.equal(countedNoun("licences", 0), "activity licences");
  assert.equal(countedNoun("licences", 8), "activity licences");
  assert.equal(countedNoun("nonsense", 1), null);
  assert.ok(
    barrioRecords.some((r) => r.vut_licences === 1),
    "fixture precondition: a barrio holds exactly one licence"
  );
  // The ratio keeps the plural, because "per 1,000" is plural at any value.
  assert.match(app, /class="sr-only"> \$\{labels\.VUT_UNITS_LABEL\}/);
});

test("the ratio is never displayed without its components", () => {
  // The ratio is built inside the same block that has already rendered the unit
  // count and the licence count, so it cannot appear on its own.
  const body = app.match(/function renderVutContext\(profile\) \{([\s\S]*?)\n\}/)[1];
  assert.ok(body.indexOf("vut.units.display") < body.indexOf("vut.ratio.display"));
  assert.match(body, /vut\.licences\.display/);
  assert.match(body, /RATIO_STATE\.AVAILABLE/);
  // And the ratio carries its full wording, never a bare index number.
  assert.equal(RATIO_LABEL, "per 1,000 registered residents");
  assert.match(app, /labels\.RATIO_LABEL/);
  assert.match(module_, /per 1,000 registered residents/);
});

test("the ratio is not conveyed by colour and carries no warning affordance", () => {
  // The block's styling is value-independent: there is no selector anywhere
  // that reacts to how large the figure is.
  const block = css.slice(css.indexOf(".area-vut{"), css.indexOf(".area-other{"));
  assert.doesNotMatch(block, /#[0-9a-f]*(?:ff[0-4]|e[0-9a-f]{2}[0-4])/i, "no alarm colour in the block");
  for (const alarm of [/--heat/, /--activity/, /red/i, /amber/i, /warn/i, /danger/i, /alert/i]) {
    assert.doesNotMatch(block, alarm, `the licensed-VUT block must not use ${alarm}`);
  }
  // Styling keys off availability only — never off a threshold.
  assert.match(css, /\.area-vut:not\(\[data-state="available"\]\)/);
  assert.doesNotMatch(app, /dataset\.(band|level|tier|severity)/);
  assert.match(app, /host\.dataset\.state = vut\.state/);
  assert.match(app, /host\.dataset\.ratio = vut\.ratio\.state/);
});

test("the granted-licence wording survives at every viewport", () => {
  // The full disclosure is collapsed away in the mobile drawer, so the one line
  // that keeps the figure honest has to be in the always-visible state line.
  assert.match(app, /function vutStateLine\(/);
  assert.match(module_, /export const VUT_STATE_PREFIX = "Granted licences"/);
  assert.match(app, /labels\.VUT_STATE_PREFIX/);
  assert.match(app, /"whole official barrio"/);
  const mobile = css.slice(css.indexOf("@media(max-width:850px)"));
  assert.match(mobile, /\.area-vut-state\{[^}]*font-size/);
  assert.doesNotMatch(mobile, /\.area-vut-state\{[^}]*display:none/);
  assert.doesNotMatch(mobile, /\.area-vut\{[^}]*display:none/);
});

test("the abstaining states are worded distinctly and never as a number", () => {
  const body = app.match(/function vutStateLine\(vut, available, labels\) \{([\s\S]*?)\n\}/)[1];
  assert.match(body, /Reading the licensed-VUT source\./);
  assert.match(body, /Licensed-VUT source unavailable in this session\./);
  assert.match(body, /Not covered by the committed licensed-VUT source\./);
  assert.doesNotMatch(body, /\b0\b/);
});

test("the screen reader is told what the ratio counts", () => {
  assert.match(app, /class="sr-only"> \$\{labels\.VUT_UNITS_LABEL\}/);
  assert.match(css, /\.sr-only\{position:absolute/);
  assert.match(css, /clip:rect\(0,0,0,0\)/);
});

test("the artifact is fetched once, in the one loader, and reused", () => {
  const fetches = app.match(/data\/accommodation\/madrid_vut_licences\.json/g) || [];
  assert.equal(fetches.length, 1, "the licensed-VUT artifact must be fetched exactly once");

  const loaderBody = app.match(/async function loadAreaContext\(\) \{([\s\S]*?)^\}/m)[1];
  assert.match(loaderBody, /data\/accommodation\/madrid_vut_licences\.json/);
  assert.match(loaderBody, /data\/accommodation\/madrid_vut_licences\.meta\.json/);
  assert.match(loaderBody, /createVutIndex\(settledValue\(vut\)\)/);
  assert.match(loaderBody, /Promise\.allSettled\(\[/);

  // Moving a lens performs a code lookup, never a fetch and never a re-aggregation.
  assert.doesNotMatch(app, /function updateAreaContext[\s\S]{0,600}fetch\(/);
  assert.doesNotMatch(app, /reduce\([\s\S]{0,60}vut_units/);
  assert.match(app, /if \(key === lastAreaRenderKey\) return;/);
  // The render key includes the licensed-VUT states, so a changed figure
  // repaints and an unchanged one does not.
  assert.match(module_, /key: `barrio:\$\{barrio\.official_id\}:\$\{residents\.state\}:\$\{vut\.state\}:\$\{vut\.ratio\.state\}`/);
});

test("the three runtime states are tracked independently", () => {
  assert.match(app, /let geographyState = "loading"/);
  assert.match(app, /let populationState = "loading"/);
  assert.match(app, /let vutState = "loading"/);

  // Losing the licensed-VUT source must not touch the geography, the boundary
  // control or the population.
  const loaderBody = app.match(/async function loadAreaContext\(\) \{([\s\S]*?)^\}/m)[1];
  const vutBranch = loaderBody.match(/if \(vutState === "unavailable"\) \{([\s\S]*?)\n  \}/)[1];
  assert.doesNotMatch(vutBranch, /disableBoundaryControl|geographyState|populationState/);
});

test("no choropleth, and no new map layer, is introduced", () => {
  // The indicator is a panel figure. Nothing paints it onto the map, because a
  // choropleth would import normalisation, class breaks and visual salience
  // that need their own design decision.
  assert.doesNotMatch(app, /choropleth/i);
  assert.doesNotMatch(app, /vut[\s\S]{0,40}(?:fillColor|setStyle|L\.geoJSON|addTo\(map\))/i);
  assert.doesNotMatch(app, /(?:fillColor|setStyle)[\s\S]{0,40}vut/i);
  assert.doesNotMatch(html, /choropleth/i);
  // And the administrative boundary control is unchanged: three options, off.
  assert.match(html, /<option value="off" selected>/);
  const options = html.match(/<select id="boundarySelect"[\s\S]*?<\/select>/)[0];
  assert.equal((options.match(/<option/g) || []).length, 3);
});

test("no global time control is introduced: each source keeps its own state", () => {
  assert.doesNotMatch(html, /id="yearSelect"|id="periodSelect"|id="dateSelect"/);
  // The only time selector remains HATI's own model-time control.
  const selects = html.match(/<select id="(\w+)"/g) || [];
  assert.deepEqual(selects.sort(), [
    '<select id="basemapSelect"',
    '<select id="boundarySelect"',
    '<select id="stayKindFilter"',
    '<select id="timeSelect"',
  ]);
});

test("this feature adds no other source and touches no existing layer", () => {
  for (const forbidden of [/dataestur/i, /inside\s*airbnb/i, /geoportal.*vegetation/i, /\bIGN\b/, /\bCNIG\b/, /heat\s*island/i]) {
    assert.doesNotMatch(app, forbidden, `no new source: ${forbidden}`);
    assert.doesNotMatch(html, forbidden, `no new source: ${forbidden}`);
  }
  // The Madrid Destino stay layer keeps its own separate identity and count.
  assert.match(app, /stay:/);
  assert.doesNotMatch(app, /stay[\s\S]{0,60}vut_units/i);
  assert.doesNotMatch(app, /vut[\s\S]{0,60}groups\.stay/i);
});
