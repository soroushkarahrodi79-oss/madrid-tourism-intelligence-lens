import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  MODES,
  DEFAULT_MODE,
  REJECTED_MODES,
  isMode,
  planModeTransition,
  createModeController,
} from "../js/modes.js";
import {
  SCOPE_GLYPHS,
  SURFACES,
  CITIZEN_SOURCE_FIELDS,
  surfaceKeysFor,
  railModel,
  buildEvidenceRecords,
  projectReading,
} from "../js/scope-rail.js";
import { ANALYTICAL_SCOPES, FRESHNESS_FIELDS, scopeOf, crossScopeArithmeticAllowed } from "../js/evidence-scope.js";
import { SHELL_DICTIONARIES } from "../js/shell-copy.js";

// Information architecture V2 (K4, #66). Pure-model tests: modes, the scope &
// freshness rail, the evidence-drawer records, the two readings, the stylesheet
// guard and the language policy. No browser here; the browser contract lives in
// browser-tests/information-architecture.browser.mjs.

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("index.html");
const css = read("css/app.css");
const app = read("js/app.js");
const registry = JSON.parse(read("data/source_registry.json"));
const FLAGS_ALL = { vut: true, hospitality: true, hati: true, pedestrian: true };

// ------------------------------------------------------------------ A. modes

test("A: there are exactly three modes, PLACE is the default, and the rejected names are not modes", () => {
  assert.deepEqual([...MODES], ["PLACE", "COMPARE", "CITY"]);
  assert.equal(DEFAULT_MODE, "PLACE");
  for (const name of ["EXPLORE", "PLANNING", "EVIDENCE", "CHANGE"]) {
    assert.ok(REJECTED_MODES[name], `${name} has a recorded rejection reason`);
    assert.equal(isMode(name), false, `${name} must never be a mode`);
  }
  assert.equal(isMode("place"), false, "modes are exact, case-sensitive ids");
});

test("A: the mode is application state, not a button class", () => {
  const controller = createModeController();
  assert.equal(controller.currentMode(), "PLACE");
  controller.setMode("CITY");
  assert.equal(controller.currentMode(), "CITY");
  assert.throws(() => controller.setMode("EXPLORE"), /not a mode/);
  assert.equal(controller.currentMode(), "CITY", "a rejected mode leaves the state untouched");
  assert.doesNotMatch(app, /classList\.contains\(["']active["']\)[^;]*mode/i, "no business logic reads an `active` class");
  assert.match(app, /shell\.modes = createModeController\(/);
});

test("A: a mode that fails to apply is never committed", () => {
  const controller = createModeController({
    lensBEnabled: () => false,
    apply() { throw new Error("lens B failed"); },
  });
  assert.throws(() => controller.setMode("COMPARE"), /lens B failed/);
  assert.equal(controller.currentMode(), "PLACE", "state never claims a mode whose side effects did not happen");
});

// ----------------------------------------------------------- B. transitions

test("B: every PLACE/COMPARE/CITY transition plans only the existing Lens B path", () => {
  for (const from of MODES) {
    for (const to of MODES) {
      for (const lensBEnabled of [false, true]) {
        const plan = planModeTransition(from, to, { lensBEnabled });
        assert.equal(plan.changed, from !== to);
        assert.equal(plan.enableLensB, from !== to && to === "COMPARE" && !lensBEnabled, `${from}→${to} B=${lensBEnabled}`);
        assert.equal(plan.disableLensB, from !== to && from === "COMPARE" && lensBEnabled, `${from}→${to} B=${lensBEnabled}`);
        assert.ok(Object.isFrozen(plan));
      }
    }
  }
});

test("B: entering COMPARE enables Lens B and leaving it runs the existing cleanup, via the controller", () => {
  const calls = [];
  let lensB = false;
  const controller = createModeController({
    lensBEnabled: () => lensB,
    apply(plan) {
      if (plan.enableLensB) { calls.push("enableLensB"); lensB = true; }
      if (plan.disableLensB) { calls.push("disableLensB"); lensB = false; }
    },
  });
  const seen = [];
  controller.subscribe((mode) => seen.push(mode));
  controller.setMode("COMPARE");
  controller.setMode("COMPARE"); // idempotent: no second enable
  controller.setMode("CITY");    // leaving COMPARE runs the cleanup
  controller.setMode("PLACE");
  assert.deepEqual(calls, ["enableLensB", "disableLensB"]);
  assert.deepEqual(seen, ["COMPARE", "COMPARE", "CITY", "PLACE"]);
});

test("B: the app routes Lens B through COMPARE and keeps the existing enable/disable bodies", () => {
  assert.match(app, /bEnabled \? activateLens\("B"\) : shell\.modes\.setMode\("COMPARE"\)/);
  assert.match(app, /if \(plan\.enableLensB\) enableLensB\(\);/);
  assert.match(app, /if \(plan\.disableLensB\) disableLensB\(\);/);
  // Leaving COMPARE still clears the focused/locked halo metric (existing contract).
  const disable = app.slice(app.indexOf("function disableLensB()"), app.indexOf("lenses.A.marker.on(\"drag\""));
  assert.match(disable, /selectedHaloMetric = null;/);
  assert.match(disable, /setHaloMetricFocus\(null, null\);/);
  assert.match(disable, /activateLens\("A"\);/);
});

// ------------------------------------------------------------ C. lens state

test("C: a transition plan never carries a Lens position or radius", () => {
  const plan = planModeTransition("PLACE", "COMPARE", { lensBEnabled: false });
  assert.equal(plan.preservesLensState, true);
  assert.deepEqual(Object.keys(plan).sort(), ["changed", "disableLensB", "enableLensB", "from", "preservesLensState", "to"]);
  const modeSource = read("js/modes.js");
  assert.doesNotMatch(modeSource.replace(/\/\/.*$/gm, ""), /radius|radii|setLatLng|marker|lenses/i, "modes.js cannot touch a Lens");
});

test("C: no mode button performs a camera, dataset or layer action", () => {
  assert.doesNotMatch(html, /id="navCompare"|id="navEvidence"|<div class="nav">/);
  assert.doesNotMatch(html, /<button class="active">Explore<\/button>/);
  assert.match(app, /button\.onclick = \(\) => shell\.modes\.setMode\(button\.dataset\.mode\);/);
  const modeHandlers = app.slice(app.indexOf("shell.modes = createModeController"), app.indexOf("// -------------------------------------------------------------------- rail"));
  assert.doesNotMatch(modeHandlers, /fitBounds|setLayerVisible|map\.(addLayer|removeLayer|setView|panTo)|setLatLng|setRadius/);
  // The HATI camera action lives on the HATI layer control, enabling first.
  const frame = app.slice(app.indexOf('getElementById("hatiFrameButton").onclick'));
  assert.ok(frame.indexOf('setLayerVisible("heat", true)') > -1 && frame.indexOf('setLayerVisible("heat", true)') < frame.indexOf("map.fitBounds("));
});

// --------------------------------------------------------- D. scope totality

test("D: every rendered surface resolves to exactly one scope via scopeOf, with a glyph and a label", () => {
  for (const [key, surface] of Object.entries(SURFACES)) {
    const scope = scopeOf(surface);
    assert.ok(ANALYTICAL_SCOPES.includes(scope), key);
    assert.ok(SCOPE_GLYPHS[scope], `${key}: glyph`);
    for (const language of ["en", "es"]) {
      assert.ok(SHELL_DICTIONARIES[language][`scope.${scope}`], `${key}: ${language} scope label`);
      assert.ok(SHELL_DICTIONARIES[language][`surface.${key}`], `${key}: ${language} surface label`);
      assert.ok(SHELL_DICTIONARIES[language][surface.unit], `${key}: ${language} unit`);
      assert.ok(SHELL_DICTIONARIES[language][surface.derivation], `${key}: ${language} derivation`);
    }
    assert.ok(MODES.includes(surface.mode), `${key}: mode`);
    assert.ok(surface.sources.length > 0);
    for (const id of surface.sources) {
      assert.ok(registry.sources.some((source) => source.id === id), `${key}: registry source ${id}`);
    }
  }
  assert.throws(() => scopeOf({}), /unscoped/);
});

test("D: scope glyphs are distinct, so a glyph never stands for two scopes", () => {
  const glyphs = Object.values(SCOPE_GLYPHS);
  assert.equal(new Set(glyphs).size, glyphs.length);
  assert.deepEqual(Object.keys(SCOPE_GLYPHS).sort(), [...ANALYTICAL_SCOPES].sort());
});

test("D: every evidence control in the markup resolves to at least one scoped surface", () => {
  const prefixes = [...html.matchAll(/data-evidence-prefix="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(prefixes.length >= 4);
  for (const prefix of prefixes) {
    assert.ok(Object.keys(SURFACES).some((key) => key.startsWith(prefix)), `prefix ${prefix} matches a surface`);
  }
  for (const mode of MODES) {
    assert.ok(surfaceKeysFor(mode, {}).length > 0, `${mode} has surfaces`);
    assert.match(html, new RegExp(`data-evidence-mode="${mode}"`), `${mode} has an Evidence & limits route`);
  }
});

// K4's rule here was "no planning evidence ships — K4 only creates the place for
// #68". K6 (#68) fills that place, so the rule becomes: planning evidence ships
// at exactly two scopes, and the scopes K4 reserved for LATER increments still
// ship nothing.
test("D: K6 ships planning evidence at exactly two scopes; the deferred planning scopes still ship nothing", () => {
  const planning = Object.entries(SURFACES).filter(([key]) => key.startsWith("place.planning."));
  assert.ok(planning.length >= 4, "the planning surfaces are declared");
  for (const [key, surface] of planning) {
    assert.ok(
      ["PLANNING_AMBITO", "LENS_INTERSECT_AMBITO"].includes(surface.scope),
      `${key} must be whole-ámbito evidence or the Lens∩ámbito membership reading`
    );
    assert.equal(surface.sources.length >= 1, true, key);
  }
  // Every whole-ámbito quantity is PLANNING_AMBITO. The membership reading is
  // the ONLY LENS_INTERSECT_AMBITO surface, and it carries no quantity: its
  // unit names a count of areas, never a share of their figures.
  const intersect = planning.filter(([, surface]) => surface.scope === "LENS_INTERSECT_AMBITO");
  assert.equal(intersect.length, 1);
  assert.equal(intersect[0][0], "place.planning.touched");
  assert.equal(intersect[0][1].derivation, "derive.ambitoMembership");

  // The scopes K4 defined for later increments are still unused: #68 ships the
  // ámbito layer only, not execution units, stage areas, parcels, address points
  // or public works.
  for (const surface of Object.values(SURFACES)) {
    assert.ok(
      !["EXECUTION_UNIT", "DEVELOPMENT_STAGE_AREA", "PARCEL", "ADDRESS_POINT", "WORK_GEOMETRY"].includes(surface.scope),
      `${surface.scope} is reserved for a later increment and ships no surface`
    );
  }
});

test("D: the planning surface derives no stage, no progress and no dwelling count", () => {
  const planningMarkup = html.slice(html.indexOf('id="planningAmbito"'), html.indexOf('id="placeDetail"'));
  assert.ok(planningMarkup.length > 1000, "the planning section was located");

  // A forbidden concept may appear in the DENIAL copy — a ceiling that says "no
  // number of homes is published" has to use the word. So the claim scan runs
  // over the markup with the designated denial elements removed: the block
  // notes, the ceiling and the citizen reading's "what it does not say" line.
  // Anything outside those is a surface that would be ASSERTING the concept.
  const claiming = planningMarkup
    .replace(/<p class="planning-block-note"[\s\S]*?<\/p>/g, "")
    .replace(/<p class="planning-ceiling"[\s\S]*?<\/p>/g, "")
    .replace(/<details id="planningCitizen"[\s\S]*?<\/details>/g, "");
  const forbidden = [
    /overall stage/i,
    /\bstage\b/i,
    /\bprogress/i,
    /\bavance\b/i,
    /fase actual/i,
    /porcentaje/i,
    /percent/i,
    /completion/i,
    /\bviviendas?\b/i,
    /\bdwellings?\b/i,
    /\bhomes?\b/i,
    /remaining to be built/i,
    /yet to be constructed/i,
    /timeline/i,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(claiming, pattern, `forbidden planning claim: ${pattern}`);
  }

  // Structurally, too: no progress element, no percentage, no ordinal numbering
  // of the four fields and no sequence arrow between them.
  assert.doesNotMatch(planningMarkup, /<progress|role="progressbar"|aria-valuenow/i);
  assert.doesNotMatch(planningMarkup, /[→➔⟶⇒]|&(?:r|R)arr;/);
  assert.doesNotMatch(planningMarkup, /%/);

  // `No Necesita` is never rendered as "no aplica" anywhere in the product.
  assert.doesNotMatch(html, /no aplica/i);

  // And the denial copy that the scan above excluded must actually be there, in
  // both languages, rather than simply absent.
  for (const language of ["en", "es"]) {
    assert.ok(SHELL_DICTIONARIES[language]["planning.ceiling"].length > 200, `${language} ceiling is stated in full`);
    assert.match(SHELL_DICTIONARIES[language]["planning.phasesNote"], /\S/);
  }
  assert.match(SHELL_DICTIONARIES.en["planning.ceiling"], /No overall stage, progress, percentage or timeline exists/);
  assert.match(SHELL_DICTIONARIES.en["planning.ceiling"], /No dwelling count is published or derivable/);
  assert.match(SHELL_DICTIONARIES.en["planning.note.unresolved"], /not defined in the audited documentation/);
  assert.match(SHELL_DICTIONARIES.en["planning.buildNote"], /Not what remains to be physically built/);
  assert.match(SHELL_DICTIONARIES.en["planning.touchedNote"], /No share, proportion or part/);
});

// ---------------------------------------------- E. same-scope comparison guard

test("E: COMPARE operates on Lens-circle readings only; a municipality value is never arithmetic with a Lens value", () => {
  for (const key of surfaceKeysFor("COMPARE", FLAGS_ALL)) assert.equal(SURFACES[key].scope, "LENS_CIRCLE", key);
  assert.equal(crossScopeArithmeticAllowed("LENS_CIRCLE", "LENS_CIRCLE"), true);
  assert.equal(crossScopeArithmeticAllowed("MUNICIPALITY", "LENS_CIRCLE"), false);
  assert.equal(crossScopeArithmeticAllowed("OFFICIAL_BARRIO", "LENS_CIRCLE"), false);
  assert.equal(crossScopeArithmeticAllowed({ scope: "MUNICIPALITY" }, { scope: "LENS_CIRCLE" }, { reason: "" }), false);
  // CITY evidence is never reachable from the PLACE or COMPARE surface sets.
  for (const mode of ["PLACE", "COMPARE"]) {
    assert.ok(!surfaceKeysFor(mode, FLAGS_ALL).some((key) => SURFACES[key].scope === "MUNICIPALITY"), mode);
  }
  assert.ok(surfaceKeysFor("CITY", FLAGS_ALL).every((key) => SURFACES[key].scope === "MUNICIPALITY"));
});

// ------------------------------------------------------ F/G. rail freshness

const rail = (mode, flags = {}, reg = registry) => railModel({ mode, flags, registry: reg, instances: {} });

test("F: the rail reports the OLDEST contributing reference date at its original precision", () => {
  const city = rail("CITY");
  const dates = city.freshness.contributors.map((id) => registry.sources.find((s) => s.id === id).reference_date);
  assert.ok(dates.every((date) => date !== null), "every CITY contributor publishes a reference date");
  assert.equal(city.freshness.referenceDate, [...dates].sort()[0], "the oldest of the contributors");
  assert.match(city.freshness.referenceDate, /^\d{4}-\d{2}$/, "month precision is preserved, never promoted to a day");
});

test("F: a synthetic registry proves the oldest date wins and precision is preserved", () => {
  const synthetic = {
    spatial_scopes: registry.spatial_scopes,
    sources: registry.sources.map((source) => ({
      ...source,
      reference_date: { hotel_demand: "2026-08", domestic_origin_context: "2026-07-15" }[source.id] ?? source.reference_date,
    })),
  };
  assert.equal(rail("CITY", {}, synthetic).freshness.referenceDate, "2026-07-15");
});

test("G: if ANY contributor has a null reference date the rail manufactures no common date", () => {
  const place = rail("PLACE");
  assert.equal(place.freshness.referenceDate, null);
  assert.ok(place.freshness.contributors.some((id) => registry.sources.find((s) => s.id === id).reference_date === null));
  const forcedNull = {
    spatial_scopes: registry.spatial_scopes,
    sources: registry.sources.map((source) => (source.id === "hotel_demand" ? { ...source, reference_date: null } : source)),
  };
  assert.equal(rail("CITY", {}, forcedNull).freshness.referenceDate, null);
});

test("G: the rail never turns a source state into a grade, score or colour", () => {
  const model = rail("PLACE", FLAGS_ALL);
  for (const state of model.freshness.sourceStates) assert.ok(["DEFINITIVE", "PROVISIONAL", "WITHHELD_BY_PUBLISHER", "NOT_DECLARED_BY_PUBLISHER"].includes(state));
  const railCss = css.slice(css.indexOf(".scope-rail{"), css.indexOf(".scope-glyph{"));
  assert.doesNotMatch(railCss, /#(?:[0-9a-f]{3}){1,2}\b(?=[^}]*)(?:.*(?:green|red|amber|yellow))/i);
  const k4 = app.slice(app.indexOf("INFORMATION ARCHITECTURE V2 (K4"), app.indexOf("const PANEL_SIZE_STORAGE_KEY"));
  assert.ok(k4.length > 1000, "the K4 block was located");
  assert.equal(/Updated today|\bfresh\b|\bstale\b|confidence score|quality grade|traffic.?light/i.test(k4), false, "no freshness grade or judgment wording in the K4 block");
  assert.match(k4, /railModel\(/);
});

test("F/G: the rail is derived from the surfaces on screen, one entry per distinct scope", () => {
  const place = rail("PLACE", {});
  // Three distinct scopes with no optional layer on: the barrio registers, the
  // Lens-circle counts, and K6's whole-ámbito planning evidence.
  assert.deepEqual(place.entries.map((e) => e.scope), ["OFFICIAL_BARRIO", "LENS_CIRCLE", "PLANNING_AMBITO"]);
  // The Lens∩ámbito membership scope appears only while its surface is on
  // screen, so the rail never names a scope nothing is rendering.
  assert.ok(!place.entries.some((e) => e.scope === "LENS_INTERSECT_AMBITO"));
  assert.ok(rail("PLACE", { planningDetail: true }).entries.some((e) => e.scope === "LENS_INTERSECT_AMBITO"));
  const placeAll = rail("PLACE", FLAGS_ALL);
  assert.ok(placeAll.entries.some((e) => e.scope === "BOUNDED_STUDY_AREA"));
  assert.ok(placeAll.entries.some((e) => e.scope === "POINT_OBSERVATION"));
  assert.deepEqual(rail("COMPARE", {}).entries.map((e) => e.scope), ["LENS_CIRCLE"]);
  assert.deepEqual(rail("CITY", {}).entries.map((e) => e.scope), ["MUNICIPALITY"]);
  assert.ok(Object.isFrozen(place) && Object.isFrozen(place.entries));
});

// ------------------------------------------------------ H. drawer completeness

test("H: every evidence record carries source, authority, scope, unit, the five freshness fields and the verbatim ceiling", () => {
  for (const mode of MODES) {
    const records = buildEvidenceRecords({ surfaces: surfaceKeysFor(mode, FLAGS_ALL), registry });
    assert.ok(records.length > 0);
    for (const record of records) {
      assert.ok(record.scope && record.unit && record.derivation, record.surface);
      assert.ok(record.sources.length > 0);
      for (const source of record.sources) {
        const original = registry.sources.find((entry) => entry.id === source.id);
        assert.ok(source.displayName && source.authority, `${record.surface}/${source.id}`);
        for (const field of FRESHNESS_FIELDS) {
          assert.ok(Object.prototype.hasOwnProperty.call(source.freshness, field), `${source.id}.${field}`);
          assert.deepEqual(source.freshness[field], original[field], `${source.id}.${field} is the registry value`);
        }
        assert.equal(source.interpretationCeiling, original.interpretation_ceiling, "the ceiling is verbatim");
        assert.ok(source.interpretationCeiling.length > 20);
      }
    }
  }
});

test("H: the drawer refuses to invent provenance for an unknown surface or an unregistered source", () => {
  assert.throws(() => buildEvidenceRecords({ surfaces: ["place.unknown"], registry }), /unknown surface/);
  const missing = { spatial_scopes: registry.spatial_scopes, sources: registry.sources.filter((source) => source.id !== "population") };
  assert.throws(() => buildEvidenceRecords({ surfaces: ["place.area.residents"], registry: missing }), /not in the registry/);
  assert.throws(() => railModel({ mode: "PLACE", flags: {}, registry: missing }), /not in the registry/);
});

test("H: the drawer can be filtered to one scope or one source", () => {
  const surfaces = surfaceKeysFor("PLACE", FLAGS_ALL);
  const barrio = buildEvidenceRecords({ surfaces, registry, scope: "OFFICIAL_BARRIO" });
  assert.ok(barrio.length > 0 && barrio.every((record) => record.scope === "OFFICIAL_BARRIO"));
  const hati = buildEvidenceRecords({ surfaces, registry, sourceId: "hati" });
  assert.ok(hati.length > 0 && hati.every((record) => record.sources.some((source) => source.id === "hati")));
});

// --------------------------------------------- I. citizen vs analyst readings

test("I: citizen and analyst readings are projections of ONE frozen record and differ only by omitted fields", () => {
  for (const mode of MODES) {
    for (const record of buildEvidenceRecords({ surfaces: surfaceKeysFor(mode, FLAGS_ALL), registry })) {
      assert.ok(Object.isFrozen(record) && Object.isFrozen(record.sources[0].freshness), "the model is deeply frozen");
      const analyst = projectReading(record, "analyst");
      const citizen = projectReading(record, "citizen");
      assert.equal(analyst, record, "the analyst reading is the record itself, unrecomputed");
      assert.equal(citizen.scope, analyst.scope);
      assert.equal(citizen.unit, analyst.unit);
      assert.equal(citizen.derivation, analyst.derivation);
      assert.equal(citizen.sources.length, analyst.sources.length, "no source merged or dropped");
      citizen.sources.forEach((source, index) => {
        const full = analyst.sources[index];
        assert.equal(source.id, full.id, "no reordering");
        for (const field of Object.keys(source)) {
          assert.deepEqual(source[field], field === "freshness" ? pick(full.freshness) : full[field], `${full.id}.${field} is unchanged`);
        }
        // Both readings state the five fields and the verbatim ceiling.
        assert.deepEqual(Object.keys(source.freshness), [...FRESHNESS_FIELDS]);
        assert.equal(source.interpretationCeiling, full.interpretationCeiling);
        assert.equal(source.freshness.source_state, full.freshness.source_state, "no state softened");
      });
      for (const field of CITIZEN_SOURCE_FIELDS) assert.ok(field in citizen.sources[0], field);
    }
  }
  assert.throws(() => projectReading({}, "expert"), /citizen" or "analyst/);
});
function pick(freshness) {
  return Object.fromEntries(FRESHNESS_FIELDS.map((field) => [field, freshness[field]]));
}

test("I: the app renders both readings from the same records and carries the ceiling in both", () => {
  assert.match(app, /projectReading\(frozen, shell\.reading\)/);
  assert.match(app, /ceilingText\.textContent = source\.interpretationCeiling;/);
  assert.match(app, /ceilingText\.lang = "en";/);
  assert.doesNotMatch(app.slice(app.indexOf("function renderDrawerBody"), app.indexOf("function openEvidenceDrawer")), /if \(analyst\)[^}]*interpretationCeiling/);
});

// -------------------------------------------------------- J. stylesheet guard

const PROVENANCE_SELECTORS = [
  "metric-foot", "source", "area-source-toggle", "area-source-details", "hospitality-methodology-link",
  "evidence-note", "layer-source-note", "activity-card-note", "scope-rail", "scope-rail-list", "scope-rail-item",
  "scope-rail-freshness", "evidence-route", "evidence-route-row", "evidence-link", "destination-ceiling",
  "destination-state", "area-period", "area-scope", "area-codes", "hospitality-interpretation", "hospitality-state",
  "drawer-ceiling", "drawer-notes", "panel-head", "mode-nav", "mode-btn", "compare-evidence", "mix", "detail-disclosure",
  "mode-section", "controls-region", "evidence-drawer",
];

function mediaBlocks(source) {
  const blocks = [];
  let index = source.indexOf("@media");
  while (index !== -1) {
    const open = source.indexOf("{", index);
    let depth = 1;
    let cursor = open + 1;
    while (depth > 0 && cursor < source.length) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    blocks.push({ query: source.slice(index, open).trim(), body: source.slice(open + 1, cursor - 1) });
    index = source.indexOf("@media", cursor);
  }
  return blocks;
}

test("J: no @media block hides a provenance-bearing selector", () => {
  const blocks = mediaBlocks(css);
  assert.ok(blocks.length >= 8, "the stylesheet's responsive blocks were parsed");
  const hidingPattern = /display\s*:\s*none|visibility\s*:\s*hidden|clip-path\s*:|height\s*:\s*0\b|font-size\s*:\s*0\b/;
  for (const block of blocks) {
    for (const [, selectors, declarations] of block.body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!hidingPattern.test(declarations)) continue;
      for (const token of PROVENANCE_SELECTORS) {
        assert.doesNotMatch(selectors, new RegExp(`\\.${token}(?![\\w-])`), `${block.query} hides .${token}: ${selectors.trim()} {${declarations}}`);
      }
      assert.doesNotMatch(selectors, /#scopeRail|#panelHead|#evidenceDrawer/, `${block.query} hides the rail or drawer`);
    }
  }
});

test("J: the old provenance-deleting rules are gone", () => {
  assert.doesNotMatch(css, /\.mix\{display:none\}|\.source\{display:none\}|\.area-source-toggle,\.area-source-details\{display:none\}/);
  assert.doesNotMatch(css, /\.evidence-note\{display:none\}|\.layer-source-note\{display:none\}|\.metric-foot\{display:none\}/);
  assert.doesNotMatch(css, /\.activity-card-note\{display:none\}|\.hospitality-methodology-link\{display:none\}/);
  assert.doesNotMatch(css, /\.nav\{|\.nav button/);
  // The rail is not hidden at any width: it sits in the sticky panel head.
  assert.match(css, /\.panel-head\{position:sticky/);
  assert.match(css, /@media\(pointer:coarse\)\{[\s\S]*?\.mode-btn[\s\S]*?min-height:44px/);
});

// ------------------------------------------------------------ structure rules

test("structure: controls are never between results and the panel keeps one reading order", () => {
  const controlsAt = html.indexOf('id="panelControls"');
  assert.ok(controlsAt > html.indexOf('id="modeCity"'), "controls come after every mode section");
  assert.ok(controlsAt > html.indexOf('id="compareLine"'));
  for (const id of ["radiusSlider", "timeSelect", "resetButton", "lensAButton", "lensBButton", "haloToggle", "domesticOriginsMonth"]) {
    assert.ok(html.indexOf(`id="${id}"`) > controlsAt, `${id} lives in the controls region`);
  }
  // Layer-scoped controls left the result flow for the aside.
  assert.ok(html.indexOf('id="hospitalityControls"') < html.indexOf('<section class="panel"'));
  assert.ok(html.indexOf('id="hatiFrameButton"') < html.indexOf('<section class="panel"'));
  // One Detail disclosure per result mode and one Evidence & limits route per mode.
  assert.equal((html.match(/<details id="(placeDetail|compareDetail)"/g) || []).length, 2);
  assert.equal((html.match(/class="evidence-route"/g) || []).length, 3);
  // At most four supporting figures.
  assert.equal((html.match(/<div class="metric">/g) || []).length, 4);
});

// ---------------------------------------------------------------- M. language

test("M: ES and EN shell dictionaries have identical keys, and no value is empty", () => {
  const en = Object.keys(SHELL_DICTIONARIES.en).sort();
  const es = Object.keys(SHELL_DICTIONARIES.es).sort();
  assert.deepEqual(es, en);
  for (const language of ["en", "es"]) for (const [key, value] of Object.entries(SHELL_DICTIONARIES[language])) assert.ok(value.length > 0, `${language}.${key}`);
});

test("M: every data-i18n key in the markup exists in both languages", () => {
  const keys = new Set();
  for (const match of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) keys.add(match[1]);
  for (const match of html.matchAll(/data-i18n-attr="[^:"]+:([^"]+)"/g)) keys.add(match[1]);
  for (const [, key] of app.matchAll(/\["[^"]+", "([a-zA-Z.]+)"\],/g)) keys.add(key);
  assert.ok(keys.size > 30);
  for (const key of keys) {
    assert.ok(key in SHELL_DICTIONARIES.en, `en.${key}`);
    assert.ok(key in SHELL_DICTIONARIES.es, `es.${key}`);
  }
});

test("M: ES and EN agree on the vocabularies the rail and drawer use", () => {
  for (const scope of ANALYTICAL_SCOPES) for (const language of ["en", "es"]) assert.ok(SHELL_DICTIONARIES[language][`scope.${scope}`]);
  for (const state of ["DEFINITIVE", "PROVISIONAL", "WITHHELD_BY_PUBLISHER", "NOT_DECLARED_BY_PUBLISHER"]) {
    for (const language of ["en", "es"]) assert.ok(SHELL_DICTIONARIES[language][`state.${state}`]);
  }
  for (const frequency of ["DAILY", "WEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMESTRAL", "ANNUAL", "IRREGULAR", "DECLARED_UNDEFINED", "NONE_DECLARED"]) {
    for (const language of ["en", "es"]) assert.ok(SHELL_DICTIONARIES[language][`freq.${frequency}`]);
  }
  // One language control, one document language, Spanish-first labelling of the control.
  assert.equal((html.match(/id="languageSelect"/g) || []).length, 1);
  assert.match(html, /<html lang="en">/);
});
