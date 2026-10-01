// Destination Context: citywide hotel demand over time.
//
// THE CONTRACTS THESE TESTS DEFEND, in order of how much damage breaking them
// would do:
//
//   1. The figures come from the HOTEL survey. The publisher's tourist-point
//      dimension also serves statistical operation 239 (tourist apartments),
//      whose series carry IDENTICAL names and values roughly fifteen times
//      smaller. Series are pinned by code and verified by operation, never
//      matched by name.
//   2. The geography is the WHOLE MUNICIPALITY 28079, and the interface says so.
//      This was the acceptance criterion the whole surface was gated on.
//   3. Hotel demand is NEVER presented as total tourism demand, total
//      accommodation, or visitors to Madrid.
//   4. Nothing is allocated to a barrio, a district or a Lens circle, and no
//      value can change when a Lens moves.
//   5. The comparison is SAME MONTH, PREVIOUS YEAR. There is no month-over-month
//      fallback hiding behind that label, and a zero prior year does not become
//      an infinite percentage.
//   6. A suppressed month is null, never zero, and is never interpolated across.
//   7. Nothing evaluates the figures: no success, failure, boom, crisis, strong,
//      weak, or performance language anywhere in the product's output.
//
// Runs against the committed artifact, so a bad regeneration fails here on every
// push, on both Windows and Ubuntu. No network.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CITY_SCOPE_CAVEAT,
  COMPARISON_STATE,
  DESTINATION_STATE,
  EVIDENCE_LABEL,
  EVIDENCE_TYPE,
  HOTEL_SCOPE_CAVEAT,
  MUNICIPALITY_CODE,
  TREND_MONTHS,
  buildComposition,
  buildDestinationContext,
  buildDestinationProvenanceLines,
  buildTrend,
  compareToPreviousYear,
  comparisonSentence,
  createDestinationIndex,
  formatChangePercent,
  formatCompactCount,
  formatCount,
  formatPeriod,
  formatPeriodCompact,
  metricNoun,
  previousYearPeriod,
  trendSummary,
} from "../js/destination-context.js";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
}

const ARTIFACT = readJson("../data/destination/madrid_hotel_demand.json");
const META = readJson("../data/destination/madrid_hotel_demand.meta.json");
const REGISTRY = readJson("../data/source_registry.json");

const index = createDestinationIndex(ARTIFACT);
const model = buildDestinationContext({ index });

const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const module_ = fs.readFileSync(new URL("../js/destination-context.js", import.meta.url), "utf8");
const builder = fs.readFileSync(new URL("../scripts/build_destination_context.py", import.meta.url), "utf8");

// Source with its own prose removed. A vocabulary ban has to be scanned over
// what the product OUTPUTS, because a comment that forbids a word necessarily
// contains it - and the prohibitions in these files are written as comments.
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/"""[\s\S]*?"""/g, " ")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("#");
    })
    .join("\n");
}

const appOut = withoutComments(app);
const htmlOut = withoutComments(html);
const cssOut = withoutComments(css);
const moduleOut = withoutComments(module_);
const builderOut = withoutComments(builder);

const registryEntry = REGISTRY.sources.find((s) => s.id === "hotel_demand");

// The body of a named top-level function, by brace matching. A lazy regex would
// happily run past the closing brace and match something in a later function,
// which would make the Lens-independence checks below pass for the wrong reason.
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const open = source.indexOf("{", start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

// ------------------------------------------------------------------ artifact

test("the artifact is a monthly series with unique, chronological periods", () => {
  assert.ok(Array.isArray(ARTIFACT.observations));
  assert.ok(ARTIFACT.observations.length >= 90, "series is implausibly short");

  const seen = new Set();
  let previous = null;
  for (const observation of ARTIFACT.observations) {
    assert.match(observation.period, /^\d{4}-(0[1-9]|1[0-2])$/, `bad period ${observation.period}`);
    assert.ok(!seen.has(observation.period), `duplicate observation for ${observation.period}`);
    seen.add(observation.period);
    if (previous) assert.ok(observation.period > previous, `out of order at ${observation.period}`);
    previous = observation.period;
    assert.equal(observation.year, Number(observation.period.slice(0, 4)));
    assert.equal(observation.month, Number(observation.period.slice(5)));
  }
});

test("the series is contiguous: every month between the endpoints is present", () => {
  const periods = ARTIFACT.observations.map((o) => o.period);
  let [year, month] = periods[0].split("-").map(Number);
  for (const period of periods) {
    assert.equal(period, `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
});

test("every value is a non-negative finite integer or an explicit null", () => {
  for (const observation of ARTIFACT.observations) {
    for (const metric of Object.keys(ARTIFACT.metrics)) {
      const value = observation[metric];
      if (value === null) continue;
      assert.equal(typeof value, "number", `${observation.period} ${metric} is not a number`);
      assert.ok(Number.isFinite(value), `${observation.period} ${metric} is not finite`);
      assert.ok(Number.isInteger(value), `${observation.period} ${metric} is not an integer count`);
      assert.ok(value >= 0, `${observation.period} ${metric} is negative`);
    }
  }
});

test("every observation declares definitive or provisional status", () => {
  for (const observation of ARTIFACT.observations) {
    assert.ok(
      observation.status === "definitive" || observation.status === "provisional",
      `${observation.period} has status ${observation.status}`
    );
  }
});

test("the declared latest period and status are the series' own last observation", () => {
  const last = ARTIFACT.observations[ARTIFACT.observations.length - 1];
  assert.equal(ARTIFACT.source_period.latest, last.period);
  assert.equal(ARTIFACT.source_period.latest_status, last.status);
  assert.equal(ARTIFACT.source_period.earliest, ARTIFACT.observations[0].period);
  assert.equal(ARTIFACT.source_period.count, ARTIFACT.observations.length);
  assert.equal(ARTIFACT.source_period.granularity, "month");
});

test("a suppressed month is null, never zero, and keeps the publisher's note", () => {
  const suppressed = ARTIFACT.observations.filter((o) => o.travellers === null);
  assert.ok(suppressed.length > 0, "the committed series should still carry the 2020 suppressions");
  for (const observation of suppressed) {
    // Every metric abstains together: a half-published month would invite a
    // composition computed against a total that was never published.
    for (const metric of Object.keys(ARTIFACT.metrics)) {
      assert.equal(observation[metric], null, `${observation.period} ${metric} should be null`);
    }
    assert.ok(
      Array.isArray(observation.source_notes) && observation.source_notes.length > 0,
      `${observation.period} is suppressed but carries no source note`
    );
  }
});

test("a real published zero is kept distinct from a suppression", () => {
  // April 2020: hotels closed under the state of alarm and the publisher issued
  // an actual 0. May and June 2020 are nulls. Collapsing the two would either
  // invent demand or invent its absence.
  const april = ARTIFACT.observations.find((o) => o.period === "2020-04");
  assert.ok(april, "2020-04 should be in the series");
  assert.equal(april.travellers, 0);
  assert.equal(april.overnight_stays, 0);
  assert.notEqual(april.travellers, null);
});

test("residence components agree with the published total within the publisher's rounding", () => {
  for (const observation of ARTIFACT.observations) {
    const { travellers, travellers_residents_spain: spain, travellers_residents_abroad: abroad } = observation;
    if (travellers === null || spain === null || abroad === null) continue;
    assert.ok(
      Math.abs(spain + abroad - travellers) <= 1,
      `${observation.period}: ${spain} + ${abroad} vs published ${travellers}`
    );
  }
});

// ----------------------------------------------------- survey identity (trap 1)

test("every metric is pinned to the operation-238 series the registry declares", () => {
  assert.ok(registryEntry, "the registry must carry a hotel_demand entry");
  for (const [metric, code] of Object.entries(registryEntry.series_codes)) {
    if (metric === "note") continue;
    assert.equal(
      ARTIFACT.metrics[metric].series,
      code,
      `metric ${metric} must be built from the pinned series ${code}`
    );
  }
});

test("the builder selects series by code and verifies the statistical operation", () => {
  // The guard against the identically named tourist-apartment series. If this
  // verification is ever removed, a name collision could publish the wrong
  // survey's figures under a correct-looking label.
  assert.match(builderOut, /FK_Operacion/);
  assert.match(builderOut, /OPERATION_ID\s*=\s*238/);
  assert.ok(
    /if operation != OPERATION_ID:/.test(builderOut),
    "the builder must reject a series that has left operation 238"
  );
  // And the artifact must not carry a derived total.
  for (const definition of Object.values(ARTIFACT.metrics)) {
    assert.equal(definition.provenance, "SOURCE_REPORTED");
  }
});

test("the sidecar records the name-collision hazard that makes code pinning necessary", () => {
  const hazard = META.name_collision_hazard;
  assert.ok(hazard, "the sidecar must document why codes are used instead of names");
  assert.match(hazard.why_codes_not_names, /239/);
  assert.match(hazard.observed_example, /EOT2743/);
  assert.match(hazard.observed_example, /EOT9411/);
});

test("the sidecar records that totals are published, never derived by addition", () => {
  assert.ok(META.totals_are_published_not_derived);
  assert.match(META.totals_are_published_not_derived.why, /rounds each estimate independently/i);
});

// ------------------------------------------------------------------ geography

test("the artifact geography is the whole municipality 28079", () => {
  assert.equal(ARTIFACT.geography.municipality_code, MUNICIPALITY_CODE);
  assert.equal(ARTIFACT.geography.level, "municipality");
  assert.equal(ARTIFACT.geography.source_term, "Punto turístico");
  assert.equal(ARTIFACT.geography.source_value, "Madrid");
});

test("the tourist point is the same municipality the canonical geography uses", () => {
  const geography = readJson("../data/geography/madrid_admin.geojson");
  const municipality = geography.features.find(
    (f) => f.properties.geography_level === "municipality"
  );
  assert.equal(municipality.properties.official_id, ARTIFACT.geography.municipality_code);
});

test("Hard Gate 1 evidence is recorded in the sidecar, quoting the publisher", () => {
  assert.equal(META.geography.hard_gate_1, "PASS");
  const evidence = META.geography.evidence.join(" ");
  // The definition that settles it, in the publisher's own words.
  assert.match(evidence, /Municipio donde la concentración de la oferta turística es significativa/);
  // And the separate definition that stops a tourist point being read as a
  // multi-municipality aggregate.
  assert.match(evidence, /Conjunto de municipios/);
  assert.match(evidence, /28079/);
});

test("the geography is qualified at every level the reader can reach", () => {
  // Three levels, and each is asserted for what it ACTUALLY carries rather than
  // for what would be convenient to claim:
  //
  //   compact card  the short name "Madrid", with "whole municipality" beside it
  //                 in the section head - enough to say which kind of place this
  //                 is, without crowding the figure
  //   accessible    the fully qualified label, so assistive technology hears the
  //   name          municipality code the visible card leaves to the disclosure
  //   disclosure    the exact source geography: the publisher's own term, its
  //                 value, and the municipality code
  assert.equal(model.geography.municipalityName, "Madrid");
  assert.equal(model.geography.label, "Madrid · municipality 28079");
  assert.match(model.geography.sourceGeographyLine, /Punto turístico/);
  assert.match(model.geography.sourceGeographyLine, /municipality code 28079/);

  // The compact card renders the short name and the scope hint; the qualified
  // label is applied as the accessible name, not as visible text.
  assert.match(appOut, /setText\("destinationPlace", model\.geography\.municipalityName\)/);
  assert.match(appOut, /place\.setAttribute\("aria-label", model\.geography\.label\)/);
  assert.match(appOut, /setText\("destinationScopeHint", available \? "whole municipality"/);

  // The registry's geography semantics must carry the municipal equivalence too,
  // because the deployment gate reads it.
  assert.equal(registryEntry.expected_municipality_code, "28079");
  assert.match(registryEntry.geography_semantics, /MUNICIPALITY/);
});

// --------------------------------------------------------------- model states

test("an unusable artifact yields an unavailable model, never a zero", () => {
  for (const bad of [null, undefined, {}, { observations: [] }, { observations: null }]) {
    assert.equal(createDestinationIndex(bad), null);
  }
  const unavailable = buildDestinationContext({ index: null });
  assert.equal(unavailable.state, DESTINATION_STATE.UNAVAILABLE);
  assert.equal(unavailable.metrics.length, 0);
  assert.equal(unavailable.period, null);
  // The ceiling survives even when the figures do not.
  assert.equal(unavailable.hotelCaveat, HOTEL_SCOPE_CAVEAT);
  assert.equal(unavailable.scopeCaveat, CITY_SCOPE_CAVEAT);
});

test("a series for a different municipality is refused rather than relabelled", () => {
  const foreign = JSON.parse(JSON.stringify(ARTIFACT));
  foreign.geography.municipality_code = "08019"; // Barcelona
  assert.equal(createDestinationIndex(foreign), null);
});

test("the loading state is distinct from the unavailable state", () => {
  const loading = buildDestinationContext({ index: null, state: DESTINATION_STATE.LOADING });
  assert.equal(loading.state, DESTINATION_STATE.LOADING);
  assert.notEqual(loading.state, DESTINATION_STATE.UNAVAILABLE);
});

test("the available model reports the latest published month and its status", () => {
  assert.equal(model.state, DESTINATION_STATE.AVAILABLE);
  const last = ARTIFACT.observations[ARTIFACT.observations.length - 1];
  assert.equal(model.period.key, last.period);
  assert.equal(model.period.label, formatPeriod(last.period));
  assert.equal(model.period.provisional, last.status === "provisional");
  assert.equal(model.evidenceType, EVIDENCE_TYPE);
  assert.equal(model.evidenceLabel, EVIDENCE_LABEL);
});

test("the model exposes exactly the two headline metrics chosen for V1", () => {
  assert.deepEqual(
    model.metrics.map((m) => m.key),
    ["travellers", "overnight_stays"]
  );
  for (const metric of model.metrics) {
    assert.ok(Number.isFinite(metric.value));
    assert.ok(metric.display);
    assert.ok(metric.exactDisplay);
    assert.ok(metric.unit);
  }
});

// ----------------------------------------------------------------- comparison

test("the comparison is the same month one year earlier", () => {
  assert.equal(previousYearPeriod("2026-08"), "2025-08");
  assert.equal(previousYearPeriod("2026-01"), "2025-01");
  assert.equal(previousYearPeriod("not-a-period"), null);

  const comparison = compareToPreviousYear(index, "travellers", "2026-08");
  assert.equal(comparison.state, COMPARISON_STATE.AVAILABLE);
  assert.equal(comparison.period, "2026-08");
  assert.equal(comparison.priorPeriod, "2025-08");
});

test("the year-over-year percentage is computed from the two published figures", () => {
  const comparison = compareToPreviousYear(index, "travellers", "2026-08");
  const current = index.byPeriod.get("2026-08").travellers;
  const prior = index.byPeriod.get("2025-08").travellers;
  assert.equal(comparison.current, current);
  assert.equal(comparison.prior, prior);
  const expected = ((current - prior) / prior) * 100;
  assert.ok(Math.abs(comparison.changePercent - expected) < 1e-9);
});

test("there is no month-over-month fallback hiding behind the year-over-year label", () => {
  // 2018-01 is the first month in the series, so no prior year exists. The model
  // must abstain rather than quietly compare against 2017-12 or 2018-02.
  const comparison = compareToPreviousYear(index, "travellers", "2018-01");
  assert.equal(comparison.state, COMPARISON_STATE.NO_PRIOR_PERIOD);
  assert.equal(comparison.changePercent, null);
  assert.equal(comparison.changeDisplay, null);
  assert.equal(comparison.priorPeriod, null);
  assert.doesNotMatch(comparisonSentence(comparison), /2017-12|Dec 2017|Feb 2018/);
});

test("a suppressed prior year abstains and says which side was missing", () => {
  // 2021-05 against 2020-05, which the publisher suppressed.
  const comparison = compareToPreviousYear(index, "travellers", "2021-05");
  assert.equal(comparison.state, COMPARISON_STATE.PRIOR_UNAVAILABLE);
  assert.equal(comparison.changePercent, null);
  assert.match(comparisonSentence(comparison), /published no figure for May 2020/i);
});

test("a suppressed current month abstains", () => {
  const comparison = compareToPreviousYear(index, "travellers", "2020-05");
  assert.equal(comparison.state, COMPARISON_STATE.CURRENT_UNAVAILABLE);
  assert.equal(comparison.changePercent, null);
});

test("a zero prior year never becomes an infinite or NaN percentage", () => {
  // 2021-04 against 2020-04, which is a real published zero.
  const comparison = compareToPreviousYear(index, "travellers", "2021-04");
  assert.equal(comparison.state, COMPARISON_STATE.PRIOR_IS_ZERO);
  assert.equal(comparison.changePercent, null);
  assert.equal(comparison.changeDisplay, null);
  assert.match(comparisonSentence(comparison), /zero/i);
});

test("no comparison in the committed series produces a non-finite number", () => {
  for (const observation of ARTIFACT.observations) {
    for (const metric of ["travellers", "overnight_stays"]) {
      const comparison = compareToPreviousYear(index, metric, observation.period);
      if (comparison.changePercent !== null) {
        assert.ok(
          Number.isFinite(comparison.changePercent),
          `${observation.period} ${metric} produced ${comparison.changePercent}`
        );
      }
    }
  }
});

test("the change is formatted as a signed percentage with no evaluative wording", () => {
  assert.equal(formatChangePercent(10.89), "+10.9%");
  assert.equal(formatChangePercent(-7.24), "−7.2%");
  assert.equal(formatChangePercent(0), "0.0%");
  assert.equal(formatChangePercent(Number.NaN), null);
  assert.equal(formatChangePercent(Number.POSITIVE_INFINITY), null);

  const sentence = comparisonSentence(compareToPreviousYear(index, "travellers", "2026-08"));
  assert.match(sentence, /vs Aug 2025$/);
});

// ---------------------------------------------------------------- composition

test("composition uses the publisher's residence wording, not tourist categories", () => {
  const composition = buildComposition(index, "2026-08");
  assert.equal(composition.state, COMPARISON_STATE.AVAILABLE);
  assert.equal(composition.spain.value, index.byPeriod.get("2026-08").travellers_residents_spain);
  assert.equal(composition.abroad.value, index.byPeriod.get("2026-08").travellers_residents_abroad);
  assert.equal(Math.round(composition.spain.share + composition.abroad.share), 100);
});

test("composition abstains when either side is missing", () => {
  const composition = buildComposition(index, "2020-05");
  assert.equal(composition.state, COMPARISON_STATE.CURRENT_UNAVAILABLE);
  assert.equal(composition.spain.value, null);
  assert.equal(composition.abroad.value, null);
});

test("composition shares are taken against the sum of the components", () => {
  // Not against the published total: the two differ by +/-1 in some months
  // because the publisher rounds each estimate independently, and a displayed
  // share must add to 100 per cent.
  const composition = buildComposition(index, "2026-08");
  assert.equal(composition.total, composition.spain.value + composition.abroad.value);
});

// ---------------------------------------------------------------------- trend

test("the trend is a bounded window of raw published points", () => {
  const trend = buildTrend(index, "travellers");
  assert.equal(trend.months, TREND_MONTHS);
  assert.equal(trend.points.length, TREND_MONTHS);
  const tail = ARTIFACT.observations.slice(-TREND_MONTHS);
  assert.deepEqual(
    trend.points.map((p) => p.period),
    tail.map((o) => o.period)
  );
  // Raw, not smoothed, indexed or rebased.
  assert.deepEqual(
    trend.points.map((p) => p.value),
    tail.map((o) => o.travellers)
  );
});

test("a gap in the trend stays a gap and is reported as one", () => {
  const covid = buildTrend(index, "travellers", 104).points.filter((p) => p.period.startsWith("2020-"));
  const may = covid.find((p) => p.period === "2020-05");
  assert.equal(may.value, null, "a suppressed month must not be interpolated");
  const withGap = buildTrend(index, "travellers", 104);
  assert.equal(withGap.hasGaps, true);
});

test("the trend graphic carries an accessible summary naming the range and gaps", () => {
  const summary = trendSummary(buildTrend(index, "travellers"), "Travellers");
  assert.match(summary, /Travellers, monthly/);
  assert.match(summary, /Lowest/);
  assert.match(summary, /highest/i);

  const gapped = trendSummary(buildTrend(index, "travellers", 104), "Travellers");
  assert.match(gapped, /No figure published for/);
});

// ----------------------------------------------------------------- formatting

test("counts use the application's en-GB numeric convention", () => {
  assert.equal(formatCount(867449), "867,449");
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(null), null);
  assert.equal(formatCount(-1), null);
});

test("the compact headline never misstates the magnitude", () => {
  assert.equal(formatCompactCount(867449), "867k");
  assert.equal(formatCompactCount(1708606), "1.7m");
  assert.equal(formatCompactCount(999), "999");
  assert.equal(formatCompactCount(null), null);
});

test("periods are spelled out identically on every platform", () => {
  assert.equal(formatPeriod("2026-08"), "August 2026");
  assert.equal(formatPeriodCompact("2026-08"), "Aug 2026");
  assert.equal(formatPeriod("2026-13"), null);
  assert.equal(formatPeriod("nonsense"), null);
});

test("metric nouns agree with their count", () => {
  assert.equal(metricNoun("travellers", 1), "traveller");
  assert.equal(metricNoun("travellers", 2), "travellers");
  assert.equal(metricNoun("overnight_stays", 1), "overnight stay");
});

// ------------------------------------------------- independence from the Lens

test("the model cannot receive a Lens position", () => {
  // Structural, not behavioural: none of the exported entry points takes a
  // coordinate, a radius, a barrio or a lens. If someone adds such a parameter,
  // this fails before any wiring could use it.
  for (const fn of [buildDestinationContext, createDestinationIndex, buildComposition, buildTrend]) {
    const signature = fn.toString().slice(0, fn.toString().indexOf(")") + 1);
    for (const forbidden of ["lat", "lon", "radius", "lens", "barrio", "center", "centre"]) {
      assert.doesNotMatch(
        signature.toLowerCase(),
        new RegExp(`\\b${forbidden}\\b`),
        `${fn.name} takes a ${forbidden} parameter, so it could react to Lens position`
      );
    }
  }
});

test("the same model is produced no matter what else is happening", () => {
  // Repeated construction from the same index is byte-identical: there is no
  // hidden dependence on time, order or any ambient state.
  const a = JSON.stringify(buildDestinationContext({ index }));
  const b = JSON.stringify(buildDestinationContext({ index: createDestinationIndex(ARTIFACT) }));
  assert.equal(a, b);
});

test("the destination renderer is never called from a lens or refresh path", () => {
  // The wiring guarantee behind Lens independence: renderDestinationContext is
  // invoked only from its own loader and from itself.
  const callSites = appOut.match(/renderDestinationContext\(\)/g) || [];
  assert.ok(callSites.length >= 1);

  // No lens-driven code path may reach the citywide renderer.
  for (const name of ["refresh", "updateAreaContext", "renderAreaProfile", "setBoundaryMode"]) {
    const body = functionBody(appOut, name);
    assert.ok(body, `${name}() should exist in app.js`);
    assert.ok(
      !body.includes("renderDestinationContext"),
      `${name}() must not re-render the citywide surface`
    );
    assert.ok(
      !body.includes("destinationModel"),
      `${name}() must not touch the citywide model`
    );
  }
});

test("destination context loads and fails independently of the area context", () => {
  assert.match(appOut, /let destinationState = "loading"/);
  assert.match(appOut, /async function loadDestinationContext\(\)/);
  // Started separately, not awaited together with the area artifacts.
  assert.match(
    appOut,
    /loadAreaContext\(\)(?:\.finally\(loadHospitalityContext\))?;[\s\S]*?loadDestinationContext\(\);/
  );
  // And its failure must not touch the other surfaces' state variables.
  const loader = appOut.slice(
    appOut.indexOf("async function loadDestinationContext"),
    appOut.indexOf("function shadeMarkersOutsideActiveLens")
  );
  for (const foreign of ["geographyState", "populationState", "vutState", "areaProfiles"]) {
    assert.ok(!loader.includes(foreign), `the destination loader must not touch ${foreign}`);
  }
});

// -------------------------------------------------------------- semantic bans

test("hotel demand is never presented as total tourism demand", () => {
  const ceiling = `${META.interpretation_ceiling} ${registryEntry.interpretation_ceiling}`;
  assert.match(ceiling, /NOT total tourism demand/i);
  assert.match(ceiling, /NOT all accommodation/i);

  // And the product's own visible copy carries the boundary.
  assert.equal(HOTEL_SCOPE_CAVEAT, "Hotel establishments only — not all tourism, not all accommodation.");
  assert.ok(htmlOut.includes("Hotel establishments only"));

  // A DENIAL is not a claim. "not all tourism" is exactly the wording this
  // module is required to carry, so the denials are removed before scanning for
  // the affirmative claims they deny - otherwise the correct copy would trip the
  // ban that exists to protect it.
  const withoutDenials = (source) =>
    source
      .replace(/\bnot\s+(all|total)\s+tourism\b/gi, " ")
      .replace(/\bnot\s+all\s+accommodation\b/gi, " ")
      .replace(/\bNOT\s+total\s+tourism\s+demand\b/gi, " ");

  for (const [name, source] of [["app.js", appOut], ["index.html", htmlOut], ["module", moduleOut]]) {
    const scanned = withoutDenials(source);
    // No wording that would turn a hotel figure into a claim about tourism or
    // visitors as a whole.
    for (const banned of [
      /\btourists in (this|the) (barrio|lens|area)\b/i,
      /\btotal tourism demand\b/i,
      /\ball tourism\b/i,
      /\ball visitors\b/i,
      /\bvisitor pressure\b/i,
      /\bovertourism\b/i,
      /\btourism pressure\b/i,
      /\bcarrying capacity\b/i,
      /\btourism intensity\b/i,
    ]) {
      assert.doesNotMatch(scanned, banned, `${name} contains banned wording ${banned}`);
    }
  }

  // And the denial itself must genuinely still be present in the shipped page,
  // so stripping it above cannot mask its removal.
  assert.ok(/not all tourism/i.test(htmlOut));
});

test("no evaluative or causal language describes the figures", () => {
  for (const [name, source] of [
    ["app.js", appOut],
    ["index.html", htmlOut],
    ["css", cssOut],
    ["module", moduleOut],
    ["builder", builderOut],
  ]) {
    for (const banned of [
      /\bstrong performance\b/i,
      /\bweak demand\b/i,
      /\btourism boom\b/i,
      /\btourism crisis\b/i,
      /\bunderperform/i,
      /\boutperform/i,
      /\bsuccess(ful)?\b/i,
      /\bfailure\b/i,
      /\bbooming\b/i,
      /\bslump\b/i,
      /\bsurge\b/i,
      /\brecord[- ]breaking\b/i,
    ]) {
      assert.doesNotMatch(source, banned, `${name} contains evaluative wording ${banned}`);
    }
  }
});

test("nothing allocates the citywide figure to a barrio, district or circle", () => {
  // The artifact carries no sub-municipal identifier at all, so an allocation is
  // impossible by construction. This asserts that stays true.
  for (const observation of ARTIFACT.observations) {
    const keys = Object.keys(observation);
    for (const forbidden of ["barrio", "district", "official_id", "lat", "lon", "geometry"]) {
      assert.ok(!keys.includes(forbidden), `an observation carries ${forbidden}`);
    }
  }
  assert.equal(ARTIFACT.geography.level, "municipality");
  assert.match(ARTIFACT.geography.scope_note, /no barrio/i);
  assert.match(registryEntry.interpretation_ceiling, /never be distributed into a district, a barrio or a Lens circle/i);
});

test("the citywide scope caveat is visible wherever the figure is", () => {
  assert.equal(CITY_SCOPE_CAVEAT, "Whole municipality of Madrid — not the Lens circle.");
  assert.equal(model.scopeCaveat, CITY_SCOPE_CAVEAT);
});

test("provisional status is disclosed rather than hidden", () => {
  const last = ARTIFACT.observations[ARTIFACT.observations.length - 1];
  if (last.status === "provisional") {
    assert.ok(model.provisionalCaveat, "a provisional headline must carry its caveat");
    assert.match(model.provisionalCaveat, /revises/i);
  }
  assert.ok(htmlOut.includes("destinationProvisional"));
  // The sidecar must explain that a YoY comparison mixes the two statuses.
  assert.match(META.temporal_contract.provisional_semantics, /provisional figure against a definitive one/i);
});

test("the period an observation describes is kept separate from retrieval", () => {
  assert.match(ARTIFACT.source_period.semantics, /not the publication date and not the retrieval date/i);
  assert.ok(META.retrieved_at);
  assert.equal(ARTIFACT.source_period.latest.length, 7, "the observation period is a month, not a timestamp");
  assert.deepEqual(META.temporal_contract.four_dates_never_merged.length, 4);
});

// ------------------------------------------------------------------ provenance

test("the disclosure states the source geography and the interpretation ceiling", () => {
  const lines = buildDestinationProvenanceLines({ meta: META, model });
  const joined = lines.join(" ");
  assert.match(joined, /Encuesta de Ocupación Hotelera/);
  assert.match(joined, /Source geography:/);
  assert.match(joined, /municipality code 28079/);
  assert.match(joined, /Observation period: August 2026/);
  // The ceiling is last and never omitted.
  assert.equal(lines[lines.length - 1], HOTEL_SCOPE_CAVEAT);
});

test("the disclosure degrades to something honest without the sidecar", () => {
  const lines = buildDestinationProvenanceLines({ meta: null, model });
  assert.ok(lines.includes(HOTEL_SCOPE_CAVEAT));
  assert.ok(lines.includes(EVIDENCE_LABEL));
});

test("the travellers definition warns that it is not a count of unique people", () => {
  assert.match(META.survey_definitions.viajeros, /not a count of unique people/i);
  assert.match(registryEntry.interpretation_ceiling, /counted twice/i);
});

// ------------------------------------------------------------------ deployment

test("the registry declares the layer blocking with an independent runtime failure", () => {
  assert.equal(registryEntry.blocks_deployment, true);
  assert.equal(registryEntry.evidence_type, "OFFICIAL_STATISTICAL_SERIES");
  assert.equal(registryEntry.role, "destination_context");
  assert.equal(registryEntry.shape, "destination_demand_series");
  assert.equal(registryEntry.rebuilt_at_deploy, false);
  assert.equal(registryEntry.artifact, "destination/madrid_hotel_demand.json");
  assert.equal(registryEntry.builder, "scripts/build_destination_context.py");
  assert.match(registryEntry.blocks_deployment_note, /leaving the Area Profile, the Lens metrics, VUT and HATI untouched/i);
});

test("this source declares no spatial envelope, and says why", () => {
  // Every other source is located records or an administrative area. This one is
  // a single citywide number with no coordinates, so a bounding box would imply
  // a geometry the source does not have.
  assert.equal(registryEntry.expected_spatial_scope, null);
  assert.match(registryEntry.spatial_scope_note, /no coordinates/i);
});

test("the artifact and sidecar agree on the schema fingerprint", () => {
  assert.ok(ARTIFACT.schema_fingerprint);
  assert.equal(ARTIFACT.schema_fingerprint, META.schema_fingerprint);
  assert.match(ARTIFACT.schema_fingerprint, /^[0-9a-f]{64}$/);
});

test("the browser never calls the publisher's API at runtime", () => {
  // The architecture is source -> builder -> committed artifact -> static UI.
  // A runtime call would make the page depend on a third party's availability
  // and would bypass every validation gate in this repository.
  assert.doesNotMatch(appOut, /servicios\.ine\.es/);
  assert.doesNotMatch(moduleOut, /servicios\.ine\.es/);
  assert.doesNotMatch(htmlOut, /servicios\.ine\.es/);
  assert.match(appOut, /data\/destination\/madrid_hotel_demand\.json/);
});

test("the destination surface is cache-busted with the rest of the app", () => {
  assert.match(html, /js\/app\.js\?v=[\w.-]+/);
  assert.match(html, /css\/app\.css\?v=[\w.-]+/);
});
