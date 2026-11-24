// Spatial command contract (Gate 1): pure validation and planning. The browser
// suite browser-tests/spatial-command.browser.mjs covers execution against the
// running app and equivalence with the manual Lens operations.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../js/spatial-command.js");
const { LENS_RADIUS } = require("../js/lens.js");
const { LENS_SPATIAL_BOUNDS } = require("../js/evidence-url.js");
const E = C.SPATIAL_COMMAND_ERROR;

const A0 = { lat: 40.4149, lon: -3.69 };
const B0 = { lat: 40.4224, lon: -3.7037 };
const SOL = { lat: 40.4169, lon: -3.7035 };

// A synthetic official universe. The planner only sees what a resolver returns,
// so these stand-ins are enough to exercise every branch; the real indices are
// exercised in the browser suite.
const AREAS = {
  "DISTRICT:16": { status: "OK", type: "DISTRICT", name: "Hortaleza", point: { lat: 40.47, lon: -3.64, method: "ENVELOPE_CENTRE" }, bounds: { south: 40.44, west: -3.68, north: 40.51, east: -3.6 } },
  "DISTRICT:05": { status: "OK", type: "DISTRICT", name: "Chamartín", point: { lat: 40.459, lon: -3.677, method: "WIDEST_INTERIOR_SPAN" }, bounds: { south: 40.44, west: -3.69, north: 40.47, east: -3.66 } },
  "BARRIO:012": { status: "OK", type: "BARRIO", name: "Embajadores", point: { lat: 40.408, lon: -3.701, method: "ENVELOPE_CENTRE" }, bounds: { south: 40.40, west: -3.71, north: 40.415, east: -3.69 } },
  "MUNICIPALITY:28079": { status: "OK", type: "MUNICIPALITY", name: "Madrid", point: null, bounds: { south: 40.31, west: -3.89, north: 40.64, east: -3.52 } },
  "AMBITO:NOPOINT": { status: "OK", type: "AMBITO", name: "No interior point", point: null, bounds: { south: 40.4, west: -3.7, north: 40.41, east: -3.69 } },
};
const resolveArea = (id) => AREAS[id] || { status: "NOT_FOUND" };

function context(overrides = {}) {
  const base = {
    mode: "PLACE",
    compareScope: "LENS",
    lensBEnabled: false,
    lensBInitialized: false,
    activeLens: "A",
    historicalComparisonActive: false,
    lenses: {
      A: { ...A0, radiusM: 900, geometry: "CIRCLE", editing: false },
      B: { ...B0, radiusM: 900, geometry: "CIRCLE", editing: false },
    },
    camera: { lat: 40.415, lon: -3.692, zoom: 14 },
    zoomRange: { min: 10, max: 19 },
    resolveArea,
  };
  const merged = { ...base, ...overrides };
  if (overrides.lenses) merged.lenses = { A: { ...base.lenses.A, ...overrides.lenses.A }, B: { ...base.lenses.B, ...overrides.lenses.B } };
  return merged;
}

const radius = (lens, radiusM) => ({ version: 1, action: "set_lens_radius", lens, radiusM });
const place = (lens, location) => ({ version: 1, action: "set_lens_location", lens, location });
const coords = (p) => ({ type: "coordinates", lat: p.lat, lon: p.lon });
const area = (id) => ({ type: "official_area", id });
const compare = (a, b) => ({ version: 1, action: "compare_locations", a, b });

function rejects(input, code, field, ctx = context()) {
  const result = C.prepareSpatialCommand(input, ctx);
  assert.equal(result.ok, false, `expected ${code} for ${JSON.stringify(input)}`);
  assert.equal(result.error.code, code);
  if (field !== undefined) assert.equal(result.error.field, field);
  return result;
}

// ------------------------------------------------------------- limits & scope

test("radius and coordinate limits are the app's own rules, not a copy", () => {
  // Every radius the app accepts is accepted; the first off-step value is not.
  for (let r = LENS_RADIUS.minM; r <= LENS_RADIUS.maxM; r += LENS_RADIUS.stepM) {
    assert.equal(C.validateSpatialCommand(radius("A", r)).ok, true, `radius ${r}`);
  }
  rejects(radius("A", LENS_RADIUS.minM - LENS_RADIUS.stepM), E.RADIUS_OUT_OF_RANGE, "radiusM");
  rejects(radius("A", LENS_RADIUS.maxM + LENS_RADIUS.stepM), E.RADIUS_OUT_OF_RANGE, "radiusM");
  const b = LENS_SPATIAL_BOUNDS;
  assert.equal(C.validateSpatialCommand(place("A", coords({ lat: b.minLat, lon: b.minLon }))).ok, true);
  assert.equal(C.validateSpatialCommand(place("A", coords({ lat: b.maxLat, lon: b.maxLon }))).ok, true);
});

test("the action set is closed and exactly the four Gate 1 operations", () => {
  assert.deepEqual([...C.SPATIAL_COMMAND_ACTIONS], ["navigate_to_location", "set_lens_location", "set_lens_radius", "compare_locations"]);
  assert.ok(Object.isFrozen(C.SPATIAL_COMMAND_ACTIONS));
  for (const action of ["compare_administrative_areas", "compare_districts", "toggle_layer", "export_evidence", "eval", "constructor", "__proto__", "toString"]) {
    rejects({ version: 1, action }, E.UNKNOWN_ACTION, "action");
  }
});

// ---------------------------------------------------------------- valid input

test("valid commands of every action are accepted and normalized to new frozen objects", () => {
  const input = radius("B", 750);
  const v = C.validateSpatialCommand(input);
  assert.equal(v.ok, true);
  assert.deepEqual(v.command, { version: 1, action: "set_lens_radius", lens: "B", radiusM: 750 });
  assert.notEqual(v.command, input);
  assert.ok(Object.isFrozen(v.command));

  assert.equal(C.validateSpatialCommand(place("A", coords(SOL))).ok, true);
  assert.equal(C.validateSpatialCommand(place("B", area("AMBITO:APR.02.09"))).ok, true);
  assert.equal(C.validateSpatialCommand(place("B", area("AMBITO:UZP.1.01"))).ok, true);
  assert.equal(C.validateSpatialCommand({ version: 1, action: "navigate_to_location", location: coords(SOL), zoom: 15 }).ok, true);
  assert.equal(C.validateSpatialCommand({ version: 1, action: "navigate_to_location", location: area("MUNICIPALITY:28079") }).ok, true);
  const cmp = C.validateSpatialCommand(compare({ location: area("DISTRICT:16"), radiusM: 1000 }, { location: coords(SOL) }));
  assert.equal(cmp.ok, true);
  assert.deepEqual(cmp.command.b, { location: { type: "coordinates", lat: SOL.lat, lon: SOL.lon } });
});

// ------------------------------------------------------------- structure

test("non-object and malformed inputs are rejected as INVALID_COMMAND", () => {
  for (const input of [null, undefined, 1, "set_lens_radius", [], [radius("A", 900)], new Date(), new (class Command {})(), JSON.stringify(radius("A", 900))]) {
    rejects(input, E.INVALID_COMMAND, null);
  }
});

test("unsupported and mistyped versions are rejected, never coerced", () => {
  rejects({ action: "set_lens_radius", lens: "A", radiusM: 900 }, E.MISSING_FIELD, "version");
  rejects({ ...radius("A", 900), version: 2 }, E.UNSUPPORTED_VERSION, "version");
  rejects({ ...radius("A", 900), version: 0 }, E.UNSUPPORTED_VERSION, "version");
  rejects({ ...radius("A", 900), version: 1.5 }, E.UNSUPPORTED_VERSION, "version");
  rejects({ ...radius("A", 900), version: "1" }, E.INVALID_TYPE, "version");
  rejects({ ...radius("A", 900), version: null }, E.INVALID_TYPE, "version");
});

test("unknown fields are rejected at every level", () => {
  rejects({ ...radius("A", 900), unit: "m" }, E.UNKNOWN_FIELD, "unit");
  rejects({ ...radius("A", 900), extra: 1 }, E.UNKNOWN_FIELD, "extra");
  // An object literal with a replaced prototype is not a plain record at all.
  rejects({ ...radius("A", 900), __proto__: { injected: true } }, E.INVALID_COMMAND, null);
  rejects(place("A", { ...coords(SOL), zoom: 15 }), E.UNKNOWN_FIELD, "location.zoom");
  rejects(place("A", { ...area("DISTRICT:16"), name: "Hortaleza" }), E.UNKNOWN_FIELD, "location.name");
  rejects(compare({ location: coords(SOL), label: "x" }, { location: coords(B0) }), E.UNKNOWN_FIELD, "a.label");
  rejects({ ...place("A", coords(SOL)), radiusM: 500 }, E.UNKNOWN_FIELD, "radiusM");
  // A JSON-parsed "__proto__" key is an own property and is refused like any other.
  rejects(JSON.parse('{"version":1,"action":"set_lens_radius","lens":"A","radiusM":900,"__proto__":{"x":1}}'), E.UNKNOWN_FIELD, "__proto__");
});

test("missing parameters are reported by field", () => {
  rejects({ version: 1 }, E.MISSING_FIELD, "action");
  rejects({ version: 1, action: "set_lens_radius", lens: "A" }, E.MISSING_FIELD, "radiusM");
  rejects({ version: 1, action: "set_lens_radius", radiusM: 900 }, E.MISSING_FIELD, "lens");
  rejects({ version: 1, action: "set_lens_location", lens: "A" }, E.MISSING_FIELD, "location");
  rejects(place("A", { type: "coordinates", lat: SOL.lat }), E.MISSING_FIELD, "location.lon");
  rejects(place("A", { type: "official_area" }), E.MISSING_FIELD, "location.id");
  rejects(place("A", { lat: SOL.lat, lon: SOL.lon }), E.MISSING_FIELD, "location.type");
  rejects({ version: 1, action: "compare_locations", a: { location: coords(SOL) } }, E.MISSING_FIELD, "b");
  rejects(compare({ location: coords(SOL) }, { radiusM: 500 }), E.MISSING_FIELD, "b.location");
  rejects({ ...radius("A", 900), radiusM: undefined }, E.MISSING_FIELD, "radiusM");
});

test("invalid lens targets are rejected", () => {
  for (const lens of ["C", "a", "b", "", "AB", 0, 1, null, true, ["A"], { id: "A" }]) {
    rejects(radius(lens, 900), E.INVALID_LENS, "lens");
  }
});

test("invalid, non-finite and out-of-window coordinates are rejected", () => {
  for (const bad of [NaN, Infinity, -Infinity, "40.4", null, true, [40.4]]) {
    rejects(place("A", { type: "coordinates", lat: bad, lon: SOL.lon }), E.INVALID_COORDINATES, "location.lat");
    rejects(place("A", { type: "coordinates", lat: SOL.lat, lon: bad }), E.INVALID_COORDINATES, "location.lon");
  }
  // Swapped lat/lon, Null Island, and points just outside the Madrid window.
  rejects(place("A", coords({ lat: SOL.lon, lon: SOL.lat })), E.COORDINATES_OUT_OF_BOUNDS, "location");
  rejects(place("A", coords({ lat: 0, lon: 0 })), E.COORDINATES_OUT_OF_BOUNDS, "location");
  rejects(place("A", coords({ lat: LENS_SPATIAL_BOUNDS.maxLat + 1e-9, lon: SOL.lon })), E.COORDINATES_OUT_OF_BOUNDS, "location");
  rejects({ version: 1, action: "navigate_to_location", location: coords({ lat: 41.39, lon: 2.17 }) }, E.COORDINATES_OUT_OF_BOUNDS, "location");
  rejects(place("A", { type: "address", text: "Puerta del Sol" }), E.INVALID_LOCATION_TYPE, "location.type");
  rejects(place("A", { type: "place_name", name: "Lavapiés" }), E.INVALID_LOCATION_TYPE, "location.type");
  rejects(place("A", "Lavapiés"), E.INVALID_TYPE, "location");
});

test("invalid radii are rejected, never clamped or snapped", () => {
  for (const bad of [NaN, Infinity, "750", null, true, [750], { value: 750 }]) rejects(radius("A", bad), E.INVALID_RADIUS, "radiusM");
  rejects(radius("A", 0), E.RADIUS_OUT_OF_RANGE, "radiusM");
  rejects(radius("A", -500), E.RADIUS_OUT_OF_RANGE, "radiusM");
  rejects(radius("A", 50), E.RADIUS_OUT_OF_RANGE, "radiusM");
  rejects(radius("A", 5050), E.RADIUS_OUT_OF_RANGE, "radiusM");
  rejects(radius("A", 120), E.RADIUS_OFF_STEP, "radiusM");
  rejects(radius("A", 750.5), E.RADIUS_OFF_STEP, "radiusM");
  rejects(compare({ location: coords(SOL) }, { location: coords(B0), radiusM: 125 }), E.RADIUS_OFF_STEP, "b.radiusM");
});

test("area ids must be typed official identifiers; names are not identifiers", () => {
  for (const id of ["Lavapiés", "Malasaña", "Hortaleza", "DISTRICT", "DISTRICT:", "district:16", "STREET:1", "DISTRICT:16;drop", "DISTRICT: 16", "AMBITO:" + "X".repeat(41), "", 16]) {
    rejects(place("A", area(id)), E.INVALID_AREA_ID, "location.id");
  }
});

test("zoom is only meaningful with coordinates and must be an integer in the map's range", () => {
  rejects({ version: 1, action: "navigate_to_location", location: area("DISTRICT:16"), zoom: 14 }, E.UNSUPPORTED_FIELD_COMBINATION, "zoom");
  rejects({ version: 1, action: "navigate_to_location", location: coords(SOL), zoom: 14.5 }, E.INVALID_ZOOM, "zoom");
  rejects({ version: 1, action: "navigate_to_location", location: coords(SOL), zoom: "14" }, E.INVALID_ZOOM, "zoom");
  rejects({ version: 1, action: "navigate_to_location", location: coords(SOL), zoom: 25 }, E.ZOOM_OUT_OF_RANGE, "zoom");
  rejects({ version: 1, action: "navigate_to_location", location: coords(SOL), zoom: 3 }, E.ZOOM_OUT_OF_RANGE, "zoom");
});

// ------------------------------------------------------------- planning

test("preparation never mutates its input or the context it reads", () => {
  const ctx = context({ lensBEnabled: true, mode: "COMPARE" });
  const ctxCopy = JSON.stringify(ctx);
  const inputs = [
    radius("B", 750),
    place("A", area("DISTRICT:16")),
    compare({ location: area("DISTRICT:16"), radiusM: 1000 }, { location: area("DISTRICT:05") }),
    compare({ location: area("DISTRICT:16") }, { location: area("Lavapiés") }),
    { version: 1, action: "navigate_to_location", location: coords(SOL), zoom: 16 },
  ];
  for (const input of inputs) {
    const inputCopy = JSON.stringify(input);
    C.prepareSpatialCommand(input, ctx);
    assert.equal(JSON.stringify(input), inputCopy);
    assert.equal(JSON.stringify(ctx), ctxCopy);
  }
});

test("set_lens_radius targets one Lens and activates it, as the slider does", () => {
  const ctx = context({ mode: "COMPARE", lensBEnabled: true, lensBInitialized: true, activeLens: "A" });
  const result = C.prepareSpatialCommand(radius("B", 750), ctx);
  assert.equal(result.ok, true);
  const { target, notes, changed } = result.plan;
  assert.equal(changed, true);
  assert.deepEqual(target.lenses.A, { ...A0, radiusM: 900 });
  assert.deepEqual(target.lenses.B, { ...B0, radiusM: 750 });
  assert.equal(target.activeLens, "B");
  assert.equal(target.mode, "COMPARE");
  assert.deepEqual([...notes], [C.SPATIAL_COMMAND_NOTE.ACTIVE_LENS_CHANGED]);
});

test("set_lens_location from coordinates passes them through exactly", () => {
  const result = C.prepareSpatialCommand(place("A", coords(SOL)), context());
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.target.lenses.A, { ...SOL, radiusM: 900 });
  assert.deepEqual(result.plan.target.lenses.B, { ...B0, radiusM: 900 });
  assert.equal(result.plan.resolved.A.area, null);
  assert.equal(result.plan.resolved.A.point.method, "COORDINATES");
  assert.ok(!result.plan.notes.includes(C.SPATIAL_COMMAND_NOTE.LENS_CIRCLE_NOT_AREA));
});

test("set_lens_location from an official area uses ONLY the resolver's verified interior point and says it is a circle", () => {
  const result = C.prepareSpatialCommand(place("A", area("BARRIO:012")), context());
  assert.equal(result.ok, true);
  assert.equal(result.plan.target.lenses.A.lat, AREAS["BARRIO:012"].point.lat);
  assert.equal(result.plan.target.lenses.A.lon, AREAS["BARRIO:012"].point.lon);
  assert.equal(result.plan.target.lenses.A.radiusM, 900, "placing a Lens never changes its radius");
  assert.deepEqual(result.plan.resolved.A.area, { id: "BARRIO:012", type: "BARRIO", name: "Embajadores" });
  assert.ok(result.plan.notes.includes(C.SPATIAL_COMMAND_NOTE.LENS_CIRCLE_NOT_AREA));
});

test("area resolution failures are distinct and never invent a location", () => {
  rejects(place("A", area("DISTRICT:99")), E.AREA_NOT_FOUND, "location.id");
  rejects(place("A", area("MUNICIPALITY:28079")), E.AREA_TYPE_NOT_SUPPORTED, "location.id");
  rejects(place("A", area("AMBITO:NOPOINT")), E.AREA_INTERIOR_POINT_UNAVAILABLE, "location.id");
  rejects(place("A", area("DISTRICT:16")), E.GEOGRAPHY_NOT_READY, "location.id", context({ resolveArea: () => ({ status: "NOT_READY" }) }));
  rejects(place("A", area("DISTRICT:16")), E.GEOGRAPHY_NOT_READY, "location.id", context({ resolveArea: undefined }));
  const outside = context({ resolveArea: () => ({ status: "OK", type: "DISTRICT", name: "x", point: { lat: 0, lon: 0 }, bounds: AREAS["DISTRICT:16"].bounds }) });
  rejects(place("A", area("DISTRICT:16")), E.AREA_INTERIOR_POINT_UNAVAILABLE, "location.id", outside);
});

test("unsupported application states refuse Lens commands", () => {
  rejects(radius("B", 750), E.LENS_B_NOT_ENABLED, "lens");
  rejects(place("B", coords(SOL)), E.LENS_B_NOT_ENABLED, "lens");
  rejects(radius("A", 750), E.MODE_NOT_SUPPORTED, null, context({ mode: "CITY" }));
  rejects(radius("A", 750), E.COMPARE_SCOPE_AMBITO, null, context({ mode: "COMPARE", lensBEnabled: true, compareScope: "AMBITO" }));
  rejects(compare({ location: coords(SOL) }, { location: coords(B0) }), E.COMPARE_SCOPE_AMBITO, null, context({ mode: "COMPARE", lensBEnabled: true, compareScope: "AMBITO" }));
  for (const input of [radius("A", 750), place("A", coords(SOL)), compare({ location: coords(SOL) }, { location: coords(B0) }), { version: 1, action: "navigate_to_location", location: coords(SOL) }]) {
    rejects(input, E.HISTORICAL_COMPARISON_ACTIVE, null, context({ historicalComparisonActive: true }));
  }
});

test("a confirmed polygon or an unfinished draft is never overwritten", () => {
  const polyA = context({ lenses: { A: { geometry: "POLYGON" } } });
  rejects(place("A", coords(SOL)), E.GEOMETRY_NOT_CIRCLE, "lens", polyA);
  rejects(radius("A", 500), E.GEOMETRY_NOT_CIRCLE, "lens", polyA);
  rejects(compare({ location: coords(SOL) }, { location: coords(B0) }), E.GEOMETRY_NOT_CIRCLE, "a", polyA);
  // Lens B's polygon blocks a comparison even while B is switched off.
  rejects(compare({ location: coords(SOL) }, { location: coords(B0) }), E.GEOMETRY_NOT_CIRCLE, "b", context({ lenses: { B: { geometry: "POLYGON" } } }));
  // A circle Lens may still be moved while the OTHER Lens holds a confirmed polygon.
  assert.equal(C.prepareSpatialCommand(place("A", coords(SOL)), context({ mode: "COMPARE", lensBEnabled: true, lenses: { B: { geometry: "POLYGON" } } })).ok, true);
  // Any draft or vertex edit in progress blocks every Lens command.
  rejects(radius("A", 500), E.GEOMETRY_EDIT_IN_PROGRESS, null, context({ lenses: { A: { editing: true } } }));
  rejects(place("A", coords(SOL)), E.GEOMETRY_EDIT_IN_PROGRESS, null, context({ lenses: { B: { editing: true } } }));
});

test("compare_locations validates BOTH sides before building any target", () => {
  // B fails at every stage: structure, value, resolution. A is valid each time.
  rejects(compare({ location: area("DISTRICT:16") }, { location: area("Lavapiés") }), E.INVALID_AREA_ID, "b.location.id");
  rejects(compare({ location: area("DISTRICT:16") }, { location: coords({ lat: 0, lon: 0 }) }), E.COORDINATES_OUT_OF_BOUNDS, "b.location");
  rejects(compare({ location: area("DISTRICT:16") }, { location: area("DISTRICT:99") }), E.AREA_NOT_FOUND, "b.location.id");
  rejects(compare({ location: area("DISTRICT:16") }, { location: area("MUNICIPALITY:28079") }), E.AREA_TYPE_NOT_SUPPORTED, "b.location.id");
  rejects(compare({ location: area("DISTRICT:16"), radiusM: 1000 }, { location: area("DISTRICT:05"), radiusM: 99 }), E.RADIUS_OUT_OF_RANGE, "b.radiusM");
  // A rejected result carries no plan or partial target at all.
  const r = C.prepareSpatialCommand(compare({ location: area("DISTRICT:16") }, { location: area("DISTRICT:99") }), context());
  assert.equal(r.plan, undefined);
});

test("compare_locations builds two circles in COMPARE, ending on Lens B, as the manual sequence does", () => {
  const result = C.prepareSpatialCommand(compare({ location: area("DISTRICT:16"), radiusM: 1000 }, { location: area("DISTRICT:05"), radiusM: 750 }), context());
  assert.equal(result.ok, true);
  const { target, notes } = result.plan;
  assert.equal(target.mode, "COMPARE");
  assert.equal(target.lensBEnabled, true);
  assert.equal(target.activeLens, "B");
  assert.deepEqual(target.lenses.A, { lat: AREAS["DISTRICT:16"].point.lat, lon: AREAS["DISTRICT:16"].point.lon, radiusM: 1000 });
  assert.deepEqual(target.lenses.B, { lat: AREAS["DISTRICT:05"].point.lat, lon: AREAS["DISTRICT:05"].point.lon, radiusM: 750 });
  for (const n of ["LENS_CIRCLE_NOT_AREA", "MODE_CHANGED", "ACTIVE_LENS_CHANGED", "CENTRE_MOVED"]) assert.ok(notes.includes(n), n);
  assert.ok(!notes.includes("LENS_B_RADIUS_FROM_LENS_A"));
});

test("compare_locations without radii keeps A's radius and follows the app's first-enable rule for B", () => {
  const first = C.prepareSpatialCommand(compare({ location: coords(SOL) }, { location: coords(B0) }), context({ lenses: { A: { radiusM: 1200 }, B: { radiusM: 900 } } }));
  assert.equal(first.plan.target.lenses.A.radiusM, 1200);
  assert.equal(first.plan.target.lenses.B.radiusM, 1200, "first enable: B starts at A's radius (initializeLensBRadius)");
  assert.ok(first.plan.notes.includes("LENS_B_RADIUS_FROM_LENS_A"));
  const later = C.prepareSpatialCommand(compare({ location: coords(SOL) }, { location: coords(B0) }), context({ lensBInitialized: true, lenses: { A: { radiusM: 1200 }, B: { radiusM: 600 } } }));
  assert.equal(later.plan.target.lenses.B.radiusM, 600, "B keeps its own radius once it has been initialised");
  assert.ok(!later.plan.notes.includes("LENS_B_RADIUS_FROM_LENS_A"));
});

test("a command equal to the current state plans no change", () => {
  const ctx = context({ mode: "COMPARE", lensBEnabled: true, lensBInitialized: true, activeLens: "B", lenses: { B: { radiusM: 750 } } });
  const same = C.prepareSpatialCommand(radius("B", 750), ctx);
  assert.equal(same.plan.changed, false);
  assert.deepEqual([...same.plan.notes], []);
  const sameView = C.prepareSpatialCommand({ version: 1, action: "navigate_to_location", location: coords({ lat: 40.415, lon: -3.692 }), zoom: 14 }, context());
  assert.equal(sameView.plan.changed, false);
});

test("no_change drops operation notes but keeps the LENS_CIRCLE_NOT_AREA scope warning", () => {
  const area = { type: "official_area", id: "DISTRICT:16" };
  const point = AREAS["DISTRICT:16"].point;
  const ctx = context({ lenses: { A: { lat: point.lat, lon: point.lon } } });
  const again = C.prepareSpatialCommand({ version: 1, action: "set_lens_location", lens: "A", location: area }, ctx);
  assert.equal(again.plan.changed, false);
  assert.deepEqual([...again.plan.notes], [C.SPATIAL_COMMAND_NOTE.LENS_CIRCLE_NOT_AREA]);
  const receipt = C.buildSpatialCommandReceipt({ input: {}, prepared: again, status: C.SPATIAL_COMMAND_STATUS.NO_CHANGE, state: {} });
  assert.deepEqual([...receipt.notes], [C.SPATIAL_COMMAND_NOTE.LENS_CIRCLE_NOT_AREA]);
  // Coordinates carry no area claim, so nothing to warn about.
  const coordsAgain = C.prepareSpatialCommand(radius("A", 900), context());
  assert.deepEqual([...coordsAgain.plan.notes], []);
});

test("navigate_to_location moves only the camera, framing an area like 'View on map'", () => {
  const framed = C.prepareSpatialCommand({ version: 1, action: "navigate_to_location", location: area("MUNICIPALITY:28079") }, context());
  assert.equal(framed.ok, true);
  assert.equal(framed.plan.kind, "camera");
  assert.deepEqual(framed.plan.target.camera, { fit: AREAS["MUNICIPALITY:28079"].bounds, paddingPx: 32, maxZoom: 15 });
  assert.equal(framed.plan.target.lenses, undefined, "a camera plan carries no Lens target");
  const view = C.prepareSpatialCommand({ version: 1, action: "navigate_to_location", location: coords(SOL) }, context());
  assert.deepEqual(view.plan.target.camera, { view: { ...SOL, zoom: 14 } }, "zoom defaults to the current zoom");
  rejects({ version: 1, action: "navigate_to_location", location: area("DISTRICT:99") }, E.AREA_NOT_FOUND, "location.id");
});

test("receipts state what was executed and never carry a reading", () => {
  const prepared = C.prepareSpatialCommand(radius("A", 500), context());
  const state = { mode: "PLACE", activeLens: "A", lensBEnabled: false, lensA: { ...A0, radiusM: 500, geometry: "CIRCLE" }, lensB: null, camera: { lat: 40.415, lon: -3.692, zoom: 14 } };
  const receipt = C.buildSpatialCommandReceipt({ input: radius("A", 500), prepared, status: "applied", state });
  assert.deepEqual(Object.keys(receipt).sort(), ["action", "command", "error", "notes", "resolved", "state", "status", "version"]);
  assert.equal(receipt.error, null);
  const rejected = C.buildSpatialCommandReceipt({ input: radius("A", 120), prepared: C.prepareSpatialCommand(radius("A", 120), context()), status: "rejected", state });
  assert.equal(rejected.action, "set_lens_radius");
  assert.equal(rejected.command, null, "an invalid command is never echoed back as if it were normalized");
  assert.equal(rejected.error.code, E.RADIUS_OFF_STEP);
  const unknown = C.buildSpatialCommandReceipt({ input: { version: 1, action: "rm -rf" }, prepared: C.prepareSpatialCommand({ version: 1, action: "rm -rf" }, context()), status: "rejected" });
  assert.equal(unknown.action, null, "an unknown action string is never reflected into the receipt");
});

test("the contract module is pure and adds no assistant, network or input surface", () => {
  const src = fs.readFileSync(new URL("../js/spatial-command.js", import.meta.url), "utf8");
  const code = src.replace(/\/\/.*$/gm, "");
  for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bdocument\./, /\bwindow\./, /\bnavigator\./, /\beval\s*\(/, /new Function/, /localStorage|sessionStorage|indexedDB/, /SpeechRecognition|getUserMedia|MediaRecorder/, /\bL\./, /Date\.now|new Date/]) {
    assert.doesNotMatch(code, forbidden, String(forbidden));
  }
});
