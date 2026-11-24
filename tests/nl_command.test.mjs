// Natural-language spatial command (Gate 2): pure parser, resolver and preview model,
// against the REAL committed official geography (the same artifacts and indices the
// geographic search uses). The browser suite browser-tests/nl-command.browser.mjs
// covers the visible interface, execution and equivalence with the manual controls.
//
// The corpus below is HAND-DESIGNED. It proves that the declared sentence shapes
// parse to the declared structured commands and that the declared invalid or
// ambiguous inputs are refused; it is NOT a measurement of accuracy on language in
// general, and no such claim is made anywhere.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

import { createGeographyIndex } from "../js/geography.js";
import { createPlanningIndex } from "../js/planning-ambito.js";
import { createGeoSearchIndex, foldText, interiorPointOf, searchGeoEntities } from "../js/geo-search.js";

const require = createRequire(import.meta.url);
const S = require("../js/spatial-command.js");
// nl-command.js reads validateSpatialCommand as a global in the browser (classic
// scripts); under node it falls back to require("./spatial-command.js").
const N = require("../js/nl-command.js");
const { NL_COMMAND_STATUS: ST, NL_COMMAND_REASON: R } = N;

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const ADMIN = read("data/geography/madrid_admin.geojson");
const AMBITO_GEOMETRY = read("data/planning/madrid_ambitos.geojson");
const AMBITO_STATE = read("data/planning/madrid_ambito_state.json");
const geography = createGeographyIndex(ADMIN);
const planning = createPlanningIndex({ geometry: AMBITO_GEOMETRY, state: AMBITO_STATE });
const index = createGeoSearchIndex({ geography, planning });
const search = (query, limit) => searchGeoEntities(index, query, limit);

const parse = (text) => N.parseNaturalCommand(text, { search });
const D21 = { type: "official_area", id: "DISTRICT:21" }; // Barajas
const D16 = { type: "official_area", id: "DISTRICT:16" }; // Hortaleza
const D05 = { type: "official_area", id: "DISTRICT:05" }; // Chamartín

// ------------------------------------------------------------------ A. intent
test("A. intent recognition — accepted shapes in Spanish and English", () => {
  const corpus = [
    ["Ve a Barajas.", "navigate_to_location", "es"],
    ["Muéstrame el distrito de Hortaleza.", "navigate_to_location", "es"],
    ["llévame a Chamartín", "navigate_to_location", "es"],
    ["por favor, ve a Barajas", "navigate_to_location", "es"],
    ["ENSEÑAME   HORTALEZA", "navigate_to_location", "es"],
    ["Go to Barajas.", "navigate_to_location", "en"],
    ["show me the Hortaleza district", "navigate_to_location", "en"],
    ["Navigate to Chamartín, please", "navigate_to_location", "en"],
    ["zoom to Barajas", "navigate_to_location", "en"],
    ["Coloca Lens A en Chamartín.", "set_lens_location", "es"],
    ["pon la lente b en Barajas", "set_lens_location", "es"],
    ["Centra Lens B en Hortaleza", "set_lens_location", "es"],
    ["Set Lens A to Hortaleza.", "set_lens_location", "en"],
    ["move lens b to Barajas", "set_lens_location", "en"],
    ["Cambia el radio de Lens B a 800 metros.", "set_lens_radius", "es"],
    ["pon el radio de lens a en 1,5 km", "set_lens_radius", "es"],
    ["Change the radius of Lens B to 750 meters.", "set_lens_radius", "en"],
    ["Set Lens A radius to 1 km", "set_lens_radius", "en"],
    ["Compara dos círculos de 500 metros en Barajas y Hortaleza.", "compare_locations", "es"],
    ["Compara un círculo de 500 metros en Barajas con otro de 1 km en Chamartín.", "compare_locations", "es"],
    ["Compare 500-meter circles in Barajas and Hortaleza.", "compare_locations", "en"],
    ["Compare a 500 m circle in Barajas with a 1 km circle in Chamartín", "compare_locations", "en"],
  ];
  for (const [text, action, language] of corpus) {
    const result = parse(text);
    assert.equal(result.status, ST.READY, `${text} -> ${result.status}/${result.reason}`);
    assert.equal(result.action, action, text);
    assert.equal(result.language, language, text);
  }
  assert.equal(corpus.length, 22);
});

test("A. intent recognition — unsupported instructions abstain without a command", () => {
  const corpus = [
    ["", R.EMPTY_INPUT],
    ["   ", R.EMPTY_INPUT],
    ["hola", R.UNSUPPORTED_INSTRUCTION],
    ["¿Cuántos hoteles hay en Barajas?", R.UNSUPPORTED_INSTRUCTION],
    ["What is the best district to open a hotel?", R.UNSUPPORTED_INSTRUCTION],
    ["borra todo", R.UNSUPPORTED_INSTRUCTION],
    ["activa la capa de licencias", R.UNSUPPORTED_INSTRUCTION],
    ["exporta el informe", R.UNSUPPORTED_INSTRUCTION],
    ["Ve a Barajas y coloca Lens A en Hortaleza", R.UNSUPPORTED_INSTRUCTION], // a compound instruction is never split
    ["Coloca Lens A en Chamartín con radio 500 metros", R.UNSUPPORTED_INSTRUCTION],
    ["Pon Lens B a 800 metros", R.UNSUPPORTED_INSTRUCTION], // a radius is not a place
    ["Lens A", R.UNSUPPORTED_INSTRUCTION],
    ["Compara los distritos de Barajas y Hortaleza", R.UNSUPPORTED_GEOMETRY],
    ["Compare the districts Barajas and Hortaleza", R.UNSUPPORTED_GEOMETRY],
    ["Compara la población de Barajas y Hortaleza", R.UNSUPPORTED_GEOMETRY],
    ["Compara los límites administrativos de Barajas y Hortaleza", R.UNSUPPORTED_GEOMETRY],
    ["x".repeat(201), R.INPUT_TOO_LONG],
  ];
  for (const [text, reason] of corpus) {
    const result = parse(text);
    assert.equal(result.status, ST.REJECTED, `${text.slice(0, 40)} -> ${result.status}`);
    assert.equal(result.reason, reason, text.slice(0, 40));
    assert.equal(result.command, undefined, "a refusal never carries a command");
  }
  assert.equal(parse(null).reason, R.EMPTY_INPUT);
  assert.equal(parse(42).reason, R.EMPTY_INPUT);
});

// ------------------------------------------------------------------ B. parameters
test("B. parameter extraction — radii, units, decimals and exact conversion", () => {
  const valid = [
    ["800 metros", 800], ["800 m", 800], ["800m", 800], ["1 km", 1000], ["1km", 1000], ["1,5 km", 1500], ["1.5 km", 1500],
    ["0,75 km", 750], ["0.9 kilómetros", 900], ["2 kilómetros", 2000], ["1 kilometre", 1000], ["1.25 kilometers", 1250],
    ["750 meters", 750], ["750 metres", 750], ["100 m", 100], ["5 km", 5000], ["1,2 km", 1200],
  ];
  for (const [text, metres] of valid) {
    const result = parse(`Cambia el radio de Lens B a ${text}`);
    assert.equal(result.status, ST.READY, text);
    assert.equal(result.command.radiusM, metres, text);
  }
  assert.equal(valid.length, 17);
});

test("B. parameter extraction — invalid, ambiguous and missing parameters are refused, never rounded", () => {
  const corpus = [
    ["Cambia el radio de Lens B a 120 metros", R.INVALID_RADIUS, "RADIUS_OFF_STEP"],
    ["Cambia el radio de Lens B a 725 m", R.INVALID_RADIUS, "RADIUS_OFF_STEP"],
    ["Cambia el radio de Lens B a 750,5 m", R.INVALID_RADIUS, "RADIUS_OFF_STEP"],
    ["Cambia el radio de Lens B a 50 m", R.INVALID_RADIUS, "RADIUS_OUT_OF_RANGE"],
    ["Cambia el radio de Lens B a 6000 m", R.INVALID_RADIUS, "RADIUS_OUT_OF_RANGE"],
    ["Cambia el radio de Lens B a 5,5 km", R.INVALID_RADIUS, "RADIUS_OUT_OF_RANGE"],
    ["Cambia el radio de Lens B a 0 metros", R.INVALID_RADIUS, "RADIUS_OUT_OF_RANGE"],
    ["Cambia el radio de Lens B a 1.500 m", R.AMBIGUOUS_NUMBER],
    ["Cambia el radio de Lens B a 1,250 km", R.AMBIGUOUS_NUMBER],
    ["Cambia el radio de Lens B a 800", R.MISSING_UNIT],
    ["Cambia el radio de Lens B", R.MISSING_RADIUS],
    ["Cambia el radio a 800 metros", R.MISSING_LENS],
    ["Cambia el radio de Lens A a 500 m y 800 m", R.CONTRADICTORY_PARAMETERS],
    ["Cambia el radio de Lens A y Lens B a 500 m", R.CONTRADICTORY_PARAMETERS],
    ["Compara dos círculos de 120 metros en Barajas y Hortaleza", R.INVALID_RADIUS, "RADIUS_OFF_STEP"],
    ["Compara dos círculos de 500 metros y 600 metros en Barajas y Hortaleza", R.UNSUPPORTED_INSTRUCTION], // radii not tied to places: abstain
    ["Compara dos círculos de 500 metros en Barajas y Barajas", R.CONTRADICTORY_PARAMETERS],
  ];
  for (const [text, reason, contractCode] of corpus) {
    const result = parse(text);
    assert.equal(result.status, ST.REJECTED, `${text} -> ${result.status}/${result.reason}`);
    assert.equal(result.reason, reason, text);
    if (contractCode) assert.equal(result.contractError.code, contractCode, text);
    assert.equal(result.command, undefined);
  }
  assert.equal(corpus.length, 17);
});

// ------------------------------------------------------------------ C. entities
test("C. entity resolution — exact official names only, accent- and case-insensitive", () => {
  for (const text of ["Ve a Barajas", "ve a BARAJAS", "ve a barajás", "Ve a  Barajas ."]) {
    assert.deepEqual(parse(text).command.location, D21, text);
  }
  assert.deepEqual(parse("ve a Chamartin").command.location, D05);
  assert.deepEqual(parse("Muéstrame el distrito de Hortaleza").command.location, D16);
  assert.deepEqual(parse("Show me the district of Hortaleza").command.location, D16);
  assert.deepEqual(parse("Go to Hortaleza district").command.location, D16);
  assert.deepEqual(parse("ve a Madrid").command.location, { type: "official_area", id: "MUNICIPALITY:28079" });
  // A denomination that begins with an article is matched as typed, then without it.
  assert.equal(parse("ve a El Pardo").command.location.id, "BARRIO:" + index.entries.find((e) => e.foldedName === "el pardo").code);
  assert.equal(parse("ve al Pardo").command.location.id, parse("ve a El Pardo").command.location.id);
});

test("C. entity resolution — informal and unknown names are unresolved, never mapped", () => {
  for (const text of ["Ve a Lavapiés", "Ve a Malasaña", "Go to Chueca", "Coloca Lens A en La Latina del sur", "ve a Narnia"]) {
    const result = parse(text);
    assert.equal(result.status, ST.REJECTED, text);
    assert.equal(result.reason, R.UNKNOWN_ENTITY, text);
  }
  // Suggestions exist only where the official index textually contains the input.
  assert.deepEqual(parse("Ve a Lavapiés").suggestions, []);
  assert.deepEqual(parse("Ve a Malasaña").suggestions, []);
  const partial = parse("Ve a Carabanc");
  assert.equal(partial.reason, R.UNKNOWN_ENTITY);
  assert.ok(partial.suggestions.some((s) => s.id === "DISTRICT:11"), "an official partial match is offered, not selected");
  assert.equal(partial.command, undefined);
});

test("C. entity resolution — a name shared by several official entities is a CHOICE, never the first result", () => {
  const result = parse("Ve a Carabanchel");
  assert.equal(result.status, ST.NEEDS_CHOICE);
  assert.equal(result.command, undefined, "no command exists before the person chooses");
  assert.deepEqual(result.slots[0].candidates.map((c) => c.id).sort(), ["AMBITO:UZI.0.10", "DISTRICT:11"]);
  assert.ok(result.slots[0].candidates.every((c) => c.type && c.code && c.name), "type, code and official name accompany each candidate");
  // Choosing resolves it; an id the parser did not offer changes nothing.
  assert.equal(N.chooseNaturalCommandCandidate(result, "location", "DISTRICT:99"), result);
  assert.equal(N.chooseNaturalCommandCandidate(result, "nowhere", "DISTRICT:11"), result);
  const chosen = N.chooseNaturalCommandCandidate(result, "location", "DISTRICT:11");
  assert.equal(chosen.status, ST.READY);
  assert.deepEqual(chosen.command.location, { type: "official_area", id: "DISTRICT:11" });
  // A type word in the sentence is the person's own disambiguation.
  assert.deepEqual(parse("Ve al distrito de Carabanchel").command.location, { type: "official_area", id: "DISTRICT:11" });
  assert.deepEqual(parse("Ve al ámbito Carabanchel").command.location, { type: "official_area", id: "AMBITO:UZI.0.10" });
  assert.equal(parse("Ve a Opañel").status, ST.NEEDS_CHOICE);
  // In a comparison only the shared name needs a choice; the other side is resolved.
  const compare = parse("Compara dos círculos de 500 metros en Carabanchel y Barajas");
  assert.equal(compare.status, ST.NEEDS_CHOICE);
  assert.deepEqual(compare.slots.map((s) => s.role), ["a"]);
  const done = N.chooseNaturalCommandCandidate(compare, "a", "DISTRICT:11");
  assert.equal(done.status, ST.READY);
  assert.deepEqual(done.command.a, { location: { type: "official_area", id: "DISTRICT:11" }, radiusM: 500 });
  assert.deepEqual(done.command.b, { location: D21, radiusM: 500 });
});

// Genuinely partial indices: built from ONE universe only, so their coverage is what the
// application's ensureGeoSearchIndex() reports while the other artifact is still loading.
const adminOnly = createGeoSearchIndex({ geography });
const ambitoOnly = createGeoSearchIndex({ planning });
const partial = (idx) => (query, limit) => searchGeoEntities(idx, query, limit);

test("C. partial coverage — an untyped name is never asserted unique while a relevant universe is missing", () => {
  assert.deepEqual([adminOnly.coverage.administrative, adminOnly.coverage.ambito], [true, false]);
  assert.deepEqual([ambitoOnly.coverage.administrative, ambitoOnly.coverage.ambito], [false, true]);
  const run = (text, idx) => N.parseNaturalCommand(text, { search: partial(idx) });
  // Carabanchel is a DISTRICT and an AMBITO: with either universe missing the clash cannot be excluded.
  for (const [text, idx] of [["Ve a Carabanchel", adminOnly], ["Ve a Carabanchel", ambitoOnly], ["Go to Barajas", adminOnly], ["Ve a Lavapiés", adminOnly], ["Coloca Lens A en Carabanchel", adminOnly]]) {
    const r = run(text, idx);
    assert.equal(r.status, ST.REJECTED, text);
    assert.equal(r.reason, R.GEOGRAPHY_NOT_READY, text);
    assert.equal(r.command, undefined);
  }
  // Compare: one untyped side is enough to withhold the whole command.
  assert.equal(run("Compara dos círculos de 500 metros en Barajas y Hortaleza", adminOnly).reason, R.GEOGRAPHY_NOT_READY);
});

test("C. partial coverage — an explicit type resolves from its own universe alone", () => {
  const run = (text, idx) => N.parseNaturalCommand(text, { search: partial(idx) });
  assert.deepEqual(run("Ve al distrito de Carabanchel", adminOnly).command.location, { type: "official_area", id: "DISTRICT:11" });
  assert.deepEqual(run("Go to Carabanchel district", adminOnly).command.location, { type: "official_area", id: "DISTRICT:11" });
  assert.deepEqual(run("Ve al ámbito Carabanchel", ambitoOnly).command.location, { type: "official_area", id: "AMBITO:UZI.0.10" });
  // The OTHER type needs the universe that is not loaded.
  assert.equal(run("Ve al ámbito Carabanchel", adminOnly).reason, R.GEOGRAPHY_NOT_READY);
  assert.equal(run("Ve al distrito de Carabanchel", ambitoOnly).reason, R.GEOGRAPHY_NOT_READY);
  // A typed name absent from its (loaded) universe is genuinely unknown, not "not ready".
  assert.equal(run("Ve al distrito de Lavapiés", adminOnly).reason, R.UNKNOWN_ENTITY);
});

test("C. partial coverage — with both universes loaded the same instructions behave as specified", () => {
  assert.equal(parse("Ve a Carabanchel").status, ST.NEEDS_CHOICE);
  assert.equal(parse("Ve al distrito de Carabanchel").status, ST.READY);
  assert.equal(parse("Ve al ámbito Carabanchel").status, ST.READY);
  assert.equal(parse("Ve a Barajas").status, ST.READY);
  assert.equal(N.parseNaturalCommand("Ve a Barajas", { search: () => ({ state: "unavailable", results: [] }) }).reason, R.GEOGRAPHY_NOT_READY);
  assert.equal(N.parseNaturalCommand("Ve a Barajas", {}).reason, R.GEOGRAPHY_NOT_READY);
});

test("C. a preview cannot silently become ambiguous between interpretation and execution", () => {
  // Typed on a partial index: ready. Then the other universe loads and the UNTYPED sentence is re-read.
  const typed = N.parseNaturalCommand("Ve al distrito de Carabanchel", { search: partial(adminOnly) });
  assert.equal(typed.status, ST.READY);
  assert.equal(N.revalidateNaturalCommandResult(typed, search), true, "an explicit type stays what it was shown to be");
  // A unique-looking name that later turns out to be shared: simulate by revalidating a result
  // produced under a search that hid the second entity, against the complete index.
  const hidden = (q, l) => { const r = searchGeoEntities(index, q, l); return { ...r, results: r.results.filter((x) => x.type === "DISTRICT") }; };
  const shown = N.parseNaturalCommand("Ve a Carabanchel", { search: hidden });
  assert.equal(shown.status, ST.READY, "premise: it looked unique");
  assert.equal(N.revalidateNaturalCommandResult(shown, search), false, "the complete index makes it ambiguous: not executable");
  // A choice the person made stays valid only while the candidates are the ones they chose from.
  const choice = N.chooseNaturalCommandCandidate(parse("Ve a Carabanchel"), "location", "DISTRICT:11");
  assert.equal(N.revalidateNaturalCommandResult(choice, search), true);
  assert.equal(N.revalidateNaturalCommandResult(choice, partial(adminOnly)), false, "a universe that went away withdraws the confirmation");
  assert.equal(N.revalidateNaturalCommandResult(null, search), false);
});

// ------------------------------------------------------------------ D. structured commands
test("D. structured command generation — exact version-1 objects", () => {
  const cmd = (text) => parse(text).command;
  assert.deepEqual(cmd("Ve a Barajas."), { version: 1, action: "navigate_to_location", location: D21 });
  assert.deepEqual(cmd("Go to Barajas."), { version: 1, action: "navigate_to_location", location: D21 });
  assert.deepEqual(cmd("Coloca Lens A en Chamartín."), { version: 1, action: "set_lens_location", lens: "A", location: D05 });
  assert.deepEqual(cmd("Set Lens A to Hortaleza."), { version: 1, action: "set_lens_location", lens: "A", location: D16 });
  assert.deepEqual(cmd("Cambia el radio de Lens B a 800 metros."), { version: 1, action: "set_lens_radius", lens: "B", radiusM: 800 });
  assert.deepEqual(cmd("Change the radius of Lens B to 750 meters."), { version: 1, action: "set_lens_radius", lens: "B", radiusM: 750 });
  const shared = { version: 1, action: "compare_locations", a: { location: D21, radiusM: 500 }, b: { location: D16, radiusM: 500 } };
  assert.deepEqual(cmd("Compara dos círculos de 500 metros en Barajas y Hortaleza."), shared);
  assert.deepEqual(cmd("Compare 500-meter circles in Barajas and Hortaleza."), shared);
  assert.deepEqual(cmd("Compare two circles of 500 meters in Barajas and Hortaleza"), shared);
  const individual = { version: 1, action: "compare_locations", a: { location: D21, radiusM: 500 }, b: { location: D05, radiusM: 1000 } };
  assert.deepEqual(cmd("Compara un círculo de 500 metros en Barajas con otro de 1 km en Chamartín."), individual);
  assert.deepEqual(cmd("Compare a 500 m circle in Barajas with a 1 km circle in Chamartín"), individual);
  assert.deepEqual(cmd("Compara dos círculos en Barajas y Hortaleza"), { version: 1, action: "compare_locations", a: { location: D21 }, b: { location: D16 } }, "an omitted radius stays omitted: the contract keeps each Lens's own");
  assert.deepEqual(cmd("Compara dos círculos de 500 metros en Barajas y en Hortaleza"), shared);
  // Same place twice at different radii is a legitimate radius comparison.
  assert.equal(cmd("Compara un círculo de 500 metros en Barajas con otro de 1 km en Barajas").b.radiusM, 1000);
  // Every produced command is accepted by the Gate 1 validator, unchanged.
  for (const c of [shared, individual]) assert.deepEqual(S.validateSpatialCommand(c).command, c);
});

test("D. 'Compara Barajas y Hortaleza' is incomplete: clarification, never a silent reading", () => {
  for (const text of ["Compara Barajas y Hortaleza", "Compara Barajas con Hortaleza.", "Compare Barajas and Hortaleza", "Compara entre Barajas y Hortaleza"]) {
    const result = parse(text);
    assert.equal(result.status, ST.NEEDS_CLARIFICATION, text);
    assert.equal(result.reason, R.COMPARE_KIND_UNSPECIFIED, text);
    assert.equal(result.command, undefined, "no executable command before the person adopts the supported reading");
    assert.equal(result.proposal.action, "compare_locations");
    assert.equal(result.proposal.a.radiusM, undefined);
  }
  const adopted = N.adoptNaturalCommandProposal(parse("Compara Barajas y Hortaleza"));
  assert.equal(adopted.status, ST.READY);
  assert.equal(adopted.adoptedProposal, true);
  assert.deepEqual(adopted.command.a.location, D21);
  // Adoption only applies to a clarification.
  const plain = parse("Ve a Barajas");
  assert.equal(N.adoptNaturalCommandProposal(plain), plain);
  // A place that is unknown or shared is dealt with BEFORE the kind question.
  assert.equal(parse("Compara Lavapiés y Hortaleza").reason, R.UNKNOWN_ENTITY);
  assert.equal(parse("Compara Carabanchel y Hortaleza").status, ST.NEEDS_CHOICE);
});

// ------------------------------------------------------------------ E. validation & preparation
const FEATURES = new Map();
for (const f of ADMIN.features) FEATURES.set(`${f.properties.geography_level.toUpperCase()}:${f.properties.official_id}`, f);
for (const f of AMBITO_GEOMETRY.features) FEATURES.set(`AMBITO:${f.properties.ambito_code}`, f);
function envelope(geometry) {
  let south = 90; let west = 180; let north = -90; let east = -180;
  const walk = (c) => { if (typeof c[0] === "number") { west = Math.min(west, c[0]); east = Math.max(east, c[0]); south = Math.min(south, c[1]); north = Math.max(north, c[1]); } else c.forEach(walk); };
  walk(geometry.coordinates);
  return { south, west, north, east };
}
const resolveArea = (id) => {
  const feature = FEATURES.get(id);
  const entry = index.byId(id);
  if (!feature || !entry) return { status: "NOT_FOUND" };
  return { status: "OK", type: entry.type, name: entry.name, point: entry.type === "MUNICIPALITY" ? null : interiorPointOf(feature.geometry), bounds: envelope(feature.geometry) };
};
function context(overrides = {}) {
  const lens = (lat, lon) => ({ lat, lon, radiusM: 900, geometry: "CIRCLE", editing: false });
  return {
    mode: "PLACE", compareScope: "LENS", lensBEnabled: false, lensBInitialized: false, activeLens: "A", historicalComparisonActive: false,
    lenses: { A: lens(40.4149, -3.69), B: lens(40.4224, -3.7037) },
    camera: { lat: 40.415, lon: -3.692, zoom: 14 }, zoomRange: { min: 10, max: 19 }, resolveArea, ...overrides,
  };
}

test("E. validation and preparation — accepted commands prepare against the current state, with the scope warning", () => {
  const compare = S.prepareSpatialCommand(parse("Compara dos círculos de 500 metros en Barajas y Hortaleza").command, context());
  assert.equal(compare.ok, true);
  assert.deepEqual(compare.plan.notes.includes("LENS_CIRCLE_NOT_AREA"), true, "the circle-not-area warning survives");
  assert.equal(compare.plan.target.lenses.A.radiusM, 500);
  assert.equal(compare.plan.target.mode, "COMPARE");
  const description = N.describeNaturalCommandPlan(compare.plan);
  assert.deepEqual(description.rows.map((r) => [r.lens, r.area.id, r.radiusM]), [["A", "DISTRICT:21", 500], ["B", "DISTRICT:16", 500]]);
  const nav = S.prepareSpatialCommand(parse("Ve a Barajas").command, context());
  assert.equal(nav.ok, true);
  assert.equal(N.describeNaturalCommandPlan(nav.plan).location.id, "DISTRICT:21");
  const lens = S.prepareSpatialCommand(parse("Coloca Lens A en Chamartín").command, context());
  assert.ok(lens.plan.notes.includes("LENS_CIRCLE_NOT_AREA"));
});

test("E. validation and preparation — state-dependent refusals come from the Gate 1 contract, not this parser", () => {
  const fail = (text, code, ctx = context()) => {
    const result = parse(text);
    assert.equal(result.status, ST.READY, text);
    const prepared = S.prepareSpatialCommand(result.command, ctx);
    assert.equal(prepared.ok, false, text);
    assert.equal(prepared.error.code, code, text);
  };
  fail("Cambia el radio de Lens B a 800 metros", "LENS_B_NOT_ENABLED"); // PLACE, B disabled
  fail("Coloca Lens B en Hortaleza", "LENS_B_NOT_ENABLED");
  fail("Coloca Lens A en Madrid", "AREA_TYPE_NOT_SUPPORTED"); // municipality is not a Lens location
  fail("Coloca Lens A en Hortaleza", "MODE_NOT_SUPPORTED", context({ mode: "CITY" }));
  fail("Coloca Lens A en Hortaleza", "GEOMETRY_NOT_CIRCLE", context({ lenses: { A: { geometry: "POLYGON" } } }));
  fail("Coloca Lens A en Hortaleza", "GEOMETRY_EDIT_IN_PROGRESS", context({ lenses: { A: { editing: true } } }));
  fail("Compara dos círculos de 500 metros en Barajas y Hortaleza", "COMPARE_SCOPE_AMBITO", context({ mode: "COMPARE", compareScope: "AMBITO" }));
  fail("Ve a Barajas", "HISTORICAL_COMPARISON_ACTIVE", context({ historicalComparisonActive: true }));
  fail("Ve a Barajas", "GEOGRAPHY_NOT_READY", context({ resolveArea: () => ({ status: "NOT_READY" }) }));
  // B enabled: the radius command is accepted.
  const ok = S.prepareSpatialCommand(parse("Cambia el radio de Lens B a 800 metros").command, context({ mode: "COMPARE", lensBEnabled: true }));
  assert.equal(ok.ok, true);
});

test("E. preparation is a pure read: it never mutates the context or the command", () => {
  const ctx = context();
  const before = JSON.stringify({ ...ctx, resolveArea: undefined });
  const result = parse("Compara dos círculos de 500 metros en Barajas y Hortaleza");
  const commandBefore = JSON.stringify(result.command);
  S.prepareSpatialCommand(result.command, ctx);
  assert.equal(JSON.stringify({ ...ctx, resolveArea: undefined }), before);
  assert.equal(JSON.stringify(result.command), commandBefore);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.command));
});

test("E. the fingerprint changes exactly when the prepared meaning changes", () => {
  const command = parse("Cambia el radio de Lens B a 800 metros").command;
  const base = S.prepareSpatialCommand(command, context({ mode: "COMPARE", lensBEnabled: true }));
  const same = S.prepareSpatialCommand(command, context({ mode: "COMPARE", lensBEnabled: true }));
  assert.equal(N.naturalCommandFingerprint(base), N.naturalCommandFingerprint(same));
  const moved = S.prepareSpatialCommand(command, context({ mode: "COMPARE", lensBEnabled: true, activeLens: "B" }));
  assert.notEqual(N.naturalCommandFingerprint(base), N.naturalCommandFingerprint(moved), "the active-lens note changes the meaning");
  const disabled = S.prepareSpatialCommand(command, context());
  assert.notEqual(N.naturalCommandFingerprint(base), N.naturalCommandFingerprint(disabled));
  assert.match(N.naturalCommandFingerprint(disabled), /^error:LENS_B_NOT_ENABLED/);
});

// ------------------------------------------------------------------ robustness
test("robustness — bounded input, no pathological backtracking, no throw, no unvalidated command", () => {
  // Pathological shapes at the length limit finish quickly.
  const shapes = ["y ".repeat(100), "a".repeat(200), "compara " + "circulo ".repeat(24), "compara " + "500 m ".repeat(30), "ve a " + "de ".repeat(60), "coloca lens a en " + "y ".repeat(90), " ".repeat(200) + "x"];
  for (const text of shapes) {
    const started = process.hrtime.bigint();
    parse(text.slice(0, 200));
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 250, `${text.slice(0, 20)}… took ${ms.toFixed(1)} ms`);
  }
  // Deterministic fuzz over the grammar's own vocabulary and noise.
  let seed = 20261124;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const words = ["compara", "compare", "ve", "go", "to", "a", "en", "in", "y", "and", "con", "with", "lens", "A", "B", "radio", "radius", "de", "of", "círculo", "circles", "500", "1,5", "km", "m", "metros", "Barajas", "Hortaleza", "Carabanchel", "distrito", "el", "la", "Madrid", "xyz", "1.500", "-", "0", "99999999999999999999", "__proto__", "constructor", "<script>", "\u0000"];
  const statuses = new Set(Object.values(ST));
  let ready = 0;
  const runs = 3000;
  for (let i = 0; i < runs; i += 1) {
    const length = 1 + Math.floor(rand() * 12);
    const text = Array.from({ length }, () => words[Math.floor(rand() * words.length)]).join(" ");
    const result = parse(text);
    assert.ok(statuses.has(result.status), text);
    if (result.status === ST.READY) {
      ready += 1;
      assert.equal(S.validateSpatialCommand(result.command).ok, true, `ready but invalid: ${text}`);
    } else {
      assert.equal(result.command, undefined, text);
    }
  }
  assert.ok(ready > 0 && ready < runs);
});

test("the module is pure, adds no network, model, speech or DOM surface, and folds like the official search", () => {
  const source = fs.readFileSync(new URL("../js/nl-command.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bdocument\./, /\bwindow\./, /\bnavigator\./, /\beval\s*\(/, /new Function/, /localStorage|sessionStorage|indexedDB/, /SpeechRecognition|getUserMedia|MediaRecorder|webkitSpeech/, /\bL\./, /Date\.now|new Date/, /import\s*\(/, /WebSocket|sendBeacon/]) {
    assert.doesNotMatch(source, forbidden, String(forbidden));
  }
  for (const sample of ["Pacífico", "ARGÜELLES", "  Vicálvaro  ", "Moncloa - Aravaca", "Opañel", "ÑU"]) {
    assert.equal(N.nlFold(sample), foldText(sample), sample);
  }
});

// ------------------------------------------------------------------ product contract
const doc = (name) => fs.readFileSync(new URL(`../docs/${name}`, import.meta.url), "utf8");

test("the product contract separates permitted deterministic controls from prohibited assistants", () => {
  const nl = doc("NATURAL_LANGUAGE_COMMAND_V1.md");
  const claims = doc("CLAIMS_AND_LIMITATIONS.md");
  // The new contract names both sides of the distinction.
  assert.match(nl, /Deterministic natural-language application controls/);
  for (const prohibited of [/AI-generated scientific answers/, /conversational assistant/, /external model calls/i, /Microphone, speech recognition/, /Unsupported analytical claims/]) assert.match(nl, prohibited);
  assert.match(nl, /It is not a\s+measurement of accuracy on natural language in general/);
  // The standing prohibitions are NOT weakened in the claims contract.
  assert.match(claims, /This product contains no AI assistant and no language model/);
  assert.match(claims, /no\s+LLM, no model call, no API key, no network request, no prompt, no embedding and\s+no vector store/);
  assert.match(claims, /Natural-language application controls are\s+permitted; AI-generated scientific answers, conversational assistants, external\s+model calls and unsupported analytical claims remain prohibited/);
  assert.match(claims, /No such assistant exists today, and none may be\s+built before this contract closes/);
  assert.match(doc("EVIDENCE_REGISTRY_QUERY_CONTRACT.md"), /does not read this layer and answers no question/);
  assert.match(doc("SPATIAL_COMMAND_V1.md"), /Update \(Gate 2\)/);
});

test("every supported example shown in the interface and the documentation parses as stated", () => {
  const { SHELL_DICTIONARIES } = require("../js/shell-copy.js");
  for (const language of ["en", "es"]) {
    const dictionary = SHELL_DICTIONARIES[language];
    for (let i = 1; i <= 4; i += 1) {
      const result = parse(dictionary[`cmd.example.${i}`]);
      assert.equal(result.status, ST.READY, `${language} example ${i}: ${dictionary[`cmd.example.${i}`]}`);
      assert.equal(result.action, ["navigate_to_location", "set_lens_location", "set_lens_radius", "compare_locations"][i - 1]);
    }
  }
  // Every key the interface can ask for exists in BOTH languages.
  const en = SHELL_DICTIONARIES.en;
  const es = SHELL_DICTIONARIES.es;
  const keys = Object.keys(en).filter((k) => k.startsWith("cmd."));
  assert.ok(keys.length > 60);
  for (const key of keys) assert.ok(es[key], `missing Spanish copy for ${key}`);
  for (const reason of Object.values(R)) {
    if (["AMBIGUOUS_ENTITY", "COMPARE_KIND_UNSPECIFIED"].includes(reason)) continue;
    assert.ok(en[`cmd.err.${reason}`], `no English message for ${reason}`);
    assert.ok(es[`cmd.err.${reason}`], `no Spanish message for ${reason}`);
  }
  for (const code of Object.values(S.SPATIAL_COMMAND_ERROR)) {
    // Codes a person can reach through this panel need a message; structural codes cannot occur (the parser builds the command).
    if (["MODE_NOT_SUPPORTED", "LENS_B_NOT_ENABLED", "COMPARE_SCOPE_AMBITO", "HISTORICAL_COMPARISON_ACTIVE", "GEOMETRY_NOT_CIRCLE", "GEOMETRY_EDIT_IN_PROGRESS", "AREA_TYPE_NOT_SUPPORTED", "AREA_INTERIOR_POINT_UNAVAILABLE", "AREA_NOT_FOUND", "ZOOM_OUT_OF_RANGE"].includes(code)) {
      assert.ok(en[`cmd.err.${code}`] && es[`cmd.err.${code}`], `no message for ${code}`);
    }
  }
  for (const note of Object.values(S.SPATIAL_COMMAND_NOTE)) assert.ok(en[`cmd.note.${note}`] && es[`cmd.note.${note}`], `no note copy for ${note}`);
});
