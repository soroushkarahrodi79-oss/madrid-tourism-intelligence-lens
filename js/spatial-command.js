// Spatial command contract — pure, versioned (Lens command initiative, Gate 1).
//
// WHAT THIS IS. A closed, structured command protocol for a small set of Lens
// operations the application ALREADY supports by hand: frame a place, place a
// Lens, set a Lens radius, and place both Lenses for a circle comparison. It is
// the deterministic core a future input modality could sit on top of.
//
// WHAT THIS IS NOT. There is no voice control, no natural-language parsing, no
// language model, no assistant and no input surface here or anywhere in Gate 1.
// A command is a plain object built by code; nothing in this file reads text a
// person typed or said. The no-assistant contract in docs/CLAIMS_AND_LIMITATIONS.md
// is unchanged.
//
// THIS MODULE IS PURE: no DOM, no Leaflet, no fetch, no clock, no `window`. It has
// two stages, and the app adapter (js/app.js) adds only the third:
//   1. validateSpatialCommand(input)          — structure, types, limits.
//   2. planSpatialCommand(command, context)   — preconditions against a plain
//      snapshot of the app, area resolution through a supplied resolver, and the
//      complete target state. Planning cannot mutate anything: it only reads.
//   3. (app.js) execute the plan through the app's own Lens controls.
//
// IT IS NOT A SECOND GIS ENGINE. It computes no distance, no containment, no
// indicator and no reading. Official geometry and the interior point a Lens is
// placed on come from the resolver the app supplies (the unified geographic
// search, js/geo-search.js); every reading is recomputed by the app afterwards.
//
// FAIL-SAFE, NEVER FAIL-SILENT. Nothing is coerced. A radius of "750", 120 or
// 6000, an unknown field, an unknown action, a non-finite coordinate or a point
// outside the Madrid window is REJECTED with a reason code, never snapped or
// clamped into a plausible-but-different command.

const SPATIAL_COMMAND_VERSION = 1;

const SPATIAL_COMMAND_ACTIONS = Object.freeze([
  "navigate_to_location",
  "set_lens_location",
  "set_lens_radius",
  "compare_locations",
]);

const SPATIAL_COMMAND_STATUS = Object.freeze({
  APPLIED: "applied",
  NO_CHANGE: "no_change",
  REJECTED: "rejected",
  FAILED: "failed",
});

// Every reason a command can be refused or fail. Stable strings: a caller may
// branch on them, so they are part of the contract.
const SPATIAL_COMMAND_ERROR = Object.freeze({
  // structure
  INVALID_COMMAND: "INVALID_COMMAND",
  MISSING_FIELD: "MISSING_FIELD",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  INVALID_TYPE: "INVALID_TYPE",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  UNKNOWN_ACTION: "UNKNOWN_ACTION",
  INVALID_LENS: "INVALID_LENS",
  INVALID_LOCATION_TYPE: "INVALID_LOCATION_TYPE",
  INVALID_COORDINATES: "INVALID_COORDINATES",
  COORDINATES_OUT_OF_BOUNDS: "COORDINATES_OUT_OF_BOUNDS",
  INVALID_AREA_ID: "INVALID_AREA_ID",
  INVALID_RADIUS: "INVALID_RADIUS",
  RADIUS_OUT_OF_RANGE: "RADIUS_OUT_OF_RANGE",
  RADIUS_OFF_STEP: "RADIUS_OFF_STEP",
  INVALID_ZOOM: "INVALID_ZOOM",
  UNSUPPORTED_FIELD_COMBINATION: "UNSUPPORTED_FIELD_COMBINATION",
  // application state
  ZOOM_OUT_OF_RANGE: "ZOOM_OUT_OF_RANGE",
  GEOGRAPHY_NOT_READY: "GEOGRAPHY_NOT_READY",
  AREA_NOT_FOUND: "AREA_NOT_FOUND",
  AREA_TYPE_NOT_SUPPORTED: "AREA_TYPE_NOT_SUPPORTED",
  AREA_INTERIOR_POINT_UNAVAILABLE: "AREA_INTERIOR_POINT_UNAVAILABLE",
  MODE_NOT_SUPPORTED: "MODE_NOT_SUPPORTED",
  LENS_B_NOT_ENABLED: "LENS_B_NOT_ENABLED",
  COMPARE_SCOPE_AMBITO: "COMPARE_SCOPE_AMBITO",
  HISTORICAL_COMPARISON_ACTIVE: "HISTORICAL_COMPARISON_ACTIVE",
  GEOMETRY_NOT_CIRCLE: "GEOMETRY_NOT_CIRCLE",
  GEOMETRY_EDIT_IN_PROGRESS: "GEOMETRY_EDIT_IN_PROGRESS",
  // execution
  EXECUTION_FAILED: "EXECUTION_FAILED",
  EXECUTION_STATE_MISMATCH: "EXECUTION_STATE_MISMATCH",
});

// Facts a receipt states about what was executed. Never an analytical value.
const SPATIAL_COMMAND_NOTE = Object.freeze({
  // A Lens placed from an official area is a CIRCLE on a verified interior point
  // of that area — not the area, and no whole-area figure applies to it.
  LENS_CIRCLE_NOT_AREA: "LENS_CIRCLE_NOT_AREA",
  MODE_CHANGED: "MODE_CHANGED",
  ACTIVE_LENS_CHANGED: "ACTIVE_LENS_CHANGED",
  // Enabling Lens B for the first time starts it at Lens A's radius (the app's
  // own rule, js/lens.js initializeLensBRadius) when the command gives none.
  LENS_B_RADIUS_FROM_LENS_A: "LENS_B_RADIUS_FROM_LENS_A",
  // A moved centre invalidates a captured radius-sensitivity baseline (the app's
  // own rule); the command does not keep or fake it.
  CENTRE_MOVED: "CENTRE_MOVED",
});

const SPATIAL_COMMAND_LENSES = Object.freeze(["A", "B"]);
const SPATIAL_COMMAND_AREA_TYPES = Object.freeze(["MUNICIPALITY", "DISTRICT", "BARRIO", "AMBITO"]);
// The municipality has no interior point a Lens could honestly stand for; the
// manual "Analyze with Lens" action refuses it for the same reason.
const SPATIAL_COMMAND_LENS_AREA_TYPES = Object.freeze(["DISTRICT", "BARRIO", "AMBITO"]);
const SPATIAL_COMMAND_AREA_ID = /^(MUNICIPALITY|DISTRICT|BARRIO|AMBITO):[A-Za-z0-9][A-Za-z0-9./-]{0,39}$/;

// The camera framing of the manual "View on map" action (js/app.js
// showGeoSearchOnMap), so a framed area is framed identically.
const SPATIAL_COMMAND_FIT = Object.freeze({ paddingPx: 32, maxZoom: 15 });

// Limits are the app's OWN rules, read from the modules that define them, never
// restated: js/lens.js (radius) and js/evidence-url.js (the Madrid window a Lens
// centre may occupy). In the browser both are classic scripts loaded earlier.
const SPATIAL_COMMAND_RADIUS = typeof LENS_RADIUS !== "undefined" ? LENS_RADIUS : require("./lens.js").LENS_RADIUS;
const SPATIAL_COMMAND_BOUNDS = typeof LENS_SPATIAL_BOUNDS !== "undefined" ? LENS_SPATIAL_BOUNDS : require("./evidence-url.js").LENS_SPATIAL_BOUNDS;

// Exact field sets per action. Anything else is UNKNOWN_FIELD.
const SPATIAL_COMMAND_FIELDS = Object.freeze({
  navigate_to_location: Object.freeze({ required: ["version", "action", "location"], optional: ["zoom"] }),
  set_lens_location: Object.freeze({ required: ["version", "action", "lens", "location"], optional: [] }),
  set_lens_radius: Object.freeze({ required: ["version", "action", "lens", "radiusM"], optional: [] }),
  compare_locations: Object.freeze({ required: ["version", "action", "a", "b"], optional: [] }),
});
const SPATIAL_COMMAND_SIDE_FIELDS = Object.freeze({ required: ["location"], optional: ["radiusM"] });
const SPATIAL_COMMAND_LOCATION_FIELDS = Object.freeze({
  coordinates: Object.freeze({ required: ["type", "lat", "lon"], optional: [] }),
  official_area: Object.freeze({ required: ["type", "id"], optional: [] }),
});

// ------------------------------------------------------------------ helpers

function spatialCommandError(code, field, detail) {
  const error = { code, field: field || null };
  if (detail !== undefined) error.detail = detail;
  return Object.freeze({ ok: false, error: Object.freeze(error) });
}

function spatialCommandIsRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function spatialCommandOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// Exact key-set check. Required first (so a missing field is reported as such),
// then any extra key. Returns an error result or null.
function spatialCommandCheckFields(record, spec, path) {
  for (const key of spec.required) {
    if (!spatialCommandOwn(record, key) || record[key] === undefined) return spatialCommandError(SPATIAL_COMMAND_ERROR.MISSING_FIELD, path + key);
  }
  const allowed = new Set([...spec.required, ...spec.optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return spatialCommandError(SPATIAL_COMMAND_ERROR.UNKNOWN_FIELD, path + key);
  }
  return null;
}

function spatialCommandCheckRadius(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) return spatialCommandError(SPATIAL_COMMAND_ERROR.INVALID_RADIUS, field);
  const { minM, maxM, stepM } = SPATIAL_COMMAND_RADIUS;
  if (value < minM || value > maxM) return spatialCommandError(SPATIAL_COMMAND_ERROR.RADIUS_OUT_OF_RANGE, field, { minM, maxM });
  if ((value - minM) % stepM !== 0) return spatialCommandError(SPATIAL_COMMAND_ERROR.RADIUS_OFF_STEP, field, { stepM });
  return null;
}

function spatialCommandInBounds(lat, lon) {
  const b = SPATIAL_COMMAND_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

// -> { location } | { result: error }
function spatialCommandCheckLocation(value, path) {
  const parent = path.slice(0, -1);
  if (!spatialCommandIsRecord(value)) return { result: spatialCommandError(SPATIAL_COMMAND_ERROR.INVALID_TYPE, parent) };
  if (!spatialCommandOwn(value, "type") || value.type === undefined) return { result: spatialCommandError(SPATIAL_COMMAND_ERROR.MISSING_FIELD, path + "type") };
  const spec = typeof value.type === "string" && spatialCommandOwn(SPATIAL_COMMAND_LOCATION_FIELDS, value.type) ? SPATIAL_COMMAND_LOCATION_FIELDS[value.type] : null;
  if (!spec) return { result: spatialCommandError(SPATIAL_COMMAND_ERROR.INVALID_LOCATION_TYPE, path + "type") };
  const fieldError = spatialCommandCheckFields(value, spec, path);
  if (fieldError) return { result: fieldError };
  if (value.type === "coordinates") {
    for (const key of ["lat", "lon"]) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
        return { result: spatialCommandError(SPATIAL_COMMAND_ERROR.INVALID_COORDINATES, path + key) };
      }
    }
    if (!spatialCommandInBounds(value.lat, value.lon)) {
      return { result: spatialCommandError(SPATIAL_COMMAND_ERROR.COORDINATES_OUT_OF_BOUNDS, parent, { ...SPATIAL_COMMAND_BOUNDS }) };
    }
    return { location: Object.freeze({ type: "coordinates", lat: value.lat, lon: value.lon }) };
  }
  if (typeof value.id !== "string" || !SPATIAL_COMMAND_AREA_ID.test(value.id)) {
    return { result: spatialCommandError(SPATIAL_COMMAND_ERROR.INVALID_AREA_ID, path + "id") };
  }
  return { location: Object.freeze({ type: "official_area", id: value.id }) };
}

function spatialCommandCheckLens(value, field) {
  if (typeof value !== "string" || !SPATIAL_COMMAND_LENSES.includes(value)) return spatialCommandError(SPATIAL_COMMAND_ERROR.INVALID_LENS, field);
  return null;
}

// ------------------------------------------------------------------ stage 1

// validateSpatialCommand(input) -> { ok: true, command } | { ok: false, error }
// `command` is a NEW frozen object holding only the contract's fields, so nothing
// the caller attached can travel further.
function validateSpatialCommand(input) {
  if (!spatialCommandIsRecord(input)) return spatialCommandError(SPATIAL_COMMAND_ERROR.INVALID_COMMAND, null);
  if (!spatialCommandOwn(input, "version") || input.version === undefined) return spatialCommandError(SPATIAL_COMMAND_ERROR.MISSING_FIELD, "version");
  if (typeof input.version !== "number") return spatialCommandError(SPATIAL_COMMAND_ERROR.INVALID_TYPE, "version");
  if (input.version !== SPATIAL_COMMAND_VERSION) return spatialCommandError(SPATIAL_COMMAND_ERROR.UNSUPPORTED_VERSION, "version", { supported: [SPATIAL_COMMAND_VERSION] });
  if (!spatialCommandOwn(input, "action") || input.action === undefined) return spatialCommandError(SPATIAL_COMMAND_ERROR.MISSING_FIELD, "action");
  if (typeof input.action !== "string" || !SPATIAL_COMMAND_ACTIONS.includes(input.action)) {
    return spatialCommandError(SPATIAL_COMMAND_ERROR.UNKNOWN_ACTION, "action");
  }
  const action = input.action;
  const fieldError = spatialCommandCheckFields(input, SPATIAL_COMMAND_FIELDS[action], "");
  if (fieldError) return fieldError;

  if (action === "navigate_to_location") {
    const loc = spatialCommandCheckLocation(input.location, "location.");
    if (loc.result) return loc.result;
    const command = { version: SPATIAL_COMMAND_VERSION, action, location: loc.location };
    if (spatialCommandOwn(input, "zoom") && input.zoom !== undefined) {
      if (loc.location.type !== "coordinates") return spatialCommandError(SPATIAL_COMMAND_ERROR.UNSUPPORTED_FIELD_COMBINATION, "zoom");
      if (typeof input.zoom !== "number" || !Number.isInteger(input.zoom)) return spatialCommandError(SPATIAL_COMMAND_ERROR.INVALID_ZOOM, "zoom");
      command.zoom = input.zoom;
    }
    return Object.freeze({ ok: true, command: Object.freeze(command) });
  }

  if (action === "set_lens_location") {
    const lensError = spatialCommandCheckLens(input.lens, "lens");
    if (lensError) return lensError;
    const loc = spatialCommandCheckLocation(input.location, "location.");
    if (loc.result) return loc.result;
    return Object.freeze({ ok: true, command: Object.freeze({ version: SPATIAL_COMMAND_VERSION, action, lens: input.lens, location: loc.location }) });
  }

  if (action === "set_lens_radius") {
    const lensError = spatialCommandCheckLens(input.lens, "lens");
    if (lensError) return lensError;
    const radiusError = spatialCommandCheckRadius(input.radiusM, "radiusM");
    if (radiusError) return radiusError;
    return Object.freeze({ ok: true, command: Object.freeze({ version: SPATIAL_COMMAND_VERSION, action, lens: input.lens, radiusM: input.radiusM }) });
  }

  // compare_locations — BOTH sides are fully validated before anything returns ok.
  const sides = {};
  for (const side of ["a", "b"]) {
    const value = input[side];
    if (!spatialCommandIsRecord(value)) return spatialCommandError(SPATIAL_COMMAND_ERROR.INVALID_TYPE, side);
    const sideError = spatialCommandCheckFields(value, SPATIAL_COMMAND_SIDE_FIELDS, side + ".");
    if (sideError) return sideError;
    const loc = spatialCommandCheckLocation(value.location, side + ".location.");
    if (loc.result) return loc.result;
    const normalized = { location: loc.location };
    if (spatialCommandOwn(value, "radiusM") && value.radiusM !== undefined) {
      const radiusError = spatialCommandCheckRadius(value.radiusM, side + ".radiusM");
      if (radiusError) return radiusError;
      normalized.radiusM = value.radiusM;
    }
    sides[side] = Object.freeze(normalized);
  }
  return Object.freeze({ ok: true, command: Object.freeze({ version: SPATIAL_COMMAND_VERSION, action, a: sides.a, b: sides.b }) });
}

// ------------------------------------------------------------------ stage 2

// context — a plain READ-ONLY snapshot the app supplies:
//   mode               "PLACE" | "COMPARE" | "CITY"
//   compareScope       "LENS" | "AMBITO"
//   lensBEnabled       boolean
//   lensBInitialized   boolean (has Lens B ever been enabled in this page)
//   activeLens         "A" | "B"
//   historicalComparisonActive boolean
//   lenses             { A: { lat, lon, radiusM, geometry: "CIRCLE"|"POLYGON", editing }, B: {…} }
//   camera             { lat, lon, zoom }
//   zoomRange          { min, max }
//   resolveArea(id) -> { status: "OK", type, name, point: { lat, lon, method } | null,
//                        bounds: { south, west, north, east } }
//                    | { status: "NOT_READY" } | { status: "NOT_FOUND" }
//
// planSpatialCommand(command, context) -> { ok: true, plan } | { ok: false, error }
//   plan = { action, command, kind: "camera" | "lens", changed, notes, resolved, target }
function planSpatialCommand(command, context) {
  const ctx = context || {};
  if (ctx.historicalComparisonActive) return spatialCommandError(SPATIAL_COMMAND_ERROR.HISTORICAL_COMPARISON_ACTIVE, null);

  // -> { point, area, bounds } | { result: error }
  const resolveLocation = (location, path, forLens) => {
    if (location.type === "coordinates") {
      return { point: { lat: location.lat, lon: location.lon, method: "COORDINATES" }, area: null };
    }
    const type = location.id.slice(0, location.id.indexOf(":"));
    if (forLens && !SPATIAL_COMMAND_LENS_AREA_TYPES.includes(type)) {
      return { result: spatialCommandError(SPATIAL_COMMAND_ERROR.AREA_TYPE_NOT_SUPPORTED, path + "id") };
    }
    const resolved = typeof ctx.resolveArea === "function" ? ctx.resolveArea(location.id) : { status: "NOT_READY" };
    if (!resolved || resolved.status === "NOT_READY") return { result: spatialCommandError(SPATIAL_COMMAND_ERROR.GEOGRAPHY_NOT_READY, path + "id") };
    if (resolved.status !== "OK") return { result: spatialCommandError(SPATIAL_COMMAND_ERROR.AREA_NOT_FOUND, path + "id") };
    const area = Object.freeze({ id: location.id, type: resolved.type, name: resolved.name ?? null });
    if (!forLens) return { point: null, area, bounds: resolved.bounds };
    const p = resolved.point;
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !spatialCommandInBounds(p.lat, p.lon)) {
      return { result: spatialCommandError(SPATIAL_COMMAND_ERROR.AREA_INTERIOR_POINT_UNAVAILABLE, path + "id") };
    }
    return { point: { lat: p.lat, lon: p.lon, method: p.method || null }, area };
  };

  if (command.action === "navigate_to_location") {
    const loc = resolveLocation(command.location, "location.", false);
    if (loc.result) return loc.result;
    if (command.location.type === "official_area") {
      const bounds = loc.bounds;
      if (!bounds || ![bounds.south, bounds.west, bounds.north, bounds.east].every(Number.isFinite)) {
        return spatialCommandError(SPATIAL_COMMAND_ERROR.AREA_NOT_FOUND, "location.id");
      }
      return Object.freeze({ ok: true, plan: Object.freeze({
        action: command.action, command, kind: "camera", changed: true, notes: Object.freeze([]),
        resolved: Object.freeze({ location: loc.area }),
        target: Object.freeze({ camera: Object.freeze({
          fit: Object.freeze({ south: bounds.south, west: bounds.west, north: bounds.north, east: bounds.east }),
          paddingPx: SPATIAL_COMMAND_FIT.paddingPx,
          maxZoom: SPATIAL_COMMAND_FIT.maxZoom,
        }) }),
      }) });
    }
    const camera = ctx.camera || {};
    const zoom = command.zoom !== undefined ? command.zoom : camera.zoom;
    const range = ctx.zoomRange || {};
    if (!Number.isInteger(zoom) || !(zoom >= range.min && zoom <= range.max)) {
      return spatialCommandError(SPATIAL_COMMAND_ERROR.ZOOM_OUT_OF_RANGE, "zoom", { min: range.min, max: range.max });
    }
    const changed = !(camera.lat === command.location.lat && camera.lon === command.location.lon && camera.zoom === zoom);
    return Object.freeze({ ok: true, plan: Object.freeze({
      action: command.action, command, kind: "camera", changed, notes: Object.freeze([]),
      resolved: Object.freeze({ location: null }),
      target: Object.freeze({ camera: Object.freeze({ view: Object.freeze({ lat: command.location.lat, lon: command.location.lon, zoom }) }) }),
    }) });
  }

  // ----- Lens actions. Every precondition, for EVERY side, is checked before a
  // target is built, so a refusal on B can never leave A changed.
  const lenses = ctx.lenses || {};
  if (SPATIAL_COMMAND_LENSES.some((w) => lenses[w] && lenses[w].editing)) {
    return spatialCommandError(SPATIAL_COMMAND_ERROR.GEOMETRY_EDIT_IN_PROGRESS, null);
  }
  const compareScopeAmbito = ctx.mode === "COMPARE" && ctx.compareScope === "AMBITO";
  const lensOf = (w) => ({ lat: lenses[w] ? lenses[w].lat : null, lon: lenses[w] ? lenses[w].lon : null, radiusM: lenses[w] ? lenses[w].radiusM : null });
  const before = { mode: ctx.mode, activeLens: ctx.activeLens, lensBEnabled: Boolean(ctx.lensBEnabled), lenses: { A: lensOf("A"), B: lensOf("B") } };
  const after = { mode: before.mode, activeLens: before.activeLens, lensBEnabled: before.lensBEnabled, lenses: { A: { ...before.lenses.A }, B: { ...before.lenses.B } } };
  const notes = [];
  const resolved = {};
  const note = (code) => { if (!notes.includes(code)) notes.push(code); };

  if (command.action === "set_lens_location" || command.action === "set_lens_radius") {
    const which = command.lens;
    if (ctx.mode === "CITY") return spatialCommandError(SPATIAL_COMMAND_ERROR.MODE_NOT_SUPPORTED, null, { mode: ctx.mode });
    if (which === "B" && !ctx.lensBEnabled) return spatialCommandError(SPATIAL_COMMAND_ERROR.LENS_B_NOT_ENABLED, "lens");
    if (compareScopeAmbito) return spatialCommandError(SPATIAL_COMMAND_ERROR.COMPARE_SCOPE_AMBITO, null);
    if (!lenses[which] || lenses[which].geometry !== "CIRCLE") return spatialCommandError(SPATIAL_COMMAND_ERROR.GEOMETRY_NOT_CIRCLE, "lens");
    if (command.action === "set_lens_location") {
      const loc = resolveLocation(command.location, "location.", true);
      if (loc.result) return loc.result;
      after.lenses[which].lat = loc.point.lat;
      after.lenses[which].lon = loc.point.lon;
      resolved[which] = Object.freeze({ area: loc.area, point: Object.freeze(loc.point) });
      if (loc.area) note(SPATIAL_COMMAND_NOTE.LENS_CIRCLE_NOT_AREA);
    } else {
      after.lenses[which].radiusM = command.radiusM;
    }
    // Every manual Lens action (drag, map click, slider) acts on the ACTIVE Lens,
    // so acting on a Lens makes it active — exactly as by hand.
    after.activeLens = which;
  } else {
    // compare_locations: two Lens CIRCLES. Never a district or barrio comparison.
    if (compareScopeAmbito) return spatialCommandError(SPATIAL_COMMAND_ERROR.COMPARE_SCOPE_AMBITO, null);
    for (const w of SPATIAL_COMMAND_LENSES) {
      if (!lenses[w] || lenses[w].geometry !== "CIRCLE") return spatialCommandError(SPATIAL_COMMAND_ERROR.GEOMETRY_NOT_CIRCLE, w === "A" ? "a" : "b");
    }
    const points = {};
    for (const [side, which] of [["a", "A"], ["b", "B"]]) {
      const loc = resolveLocation(command[side].location, side + ".location.", true);
      if (loc.result) return loc.result;
      points[which] = loc;
    }
    // Only now, with BOTH sides resolved, is the target built.
    after.mode = "COMPARE";
    after.lensBEnabled = true;
    // Enabling B for the first time starts it at A's radius (js/lens.js).
    const firstEnable = !ctx.lensBEnabled && !ctx.lensBInitialized;
    const defaultRadiusB = firstEnable ? before.lenses.A.radiusM : before.lenses.B.radiusM;
    if (firstEnable && command.b.radiusM === undefined) note(SPATIAL_COMMAND_NOTE.LENS_B_RADIUS_FROM_LENS_A);
    for (const [side, which] of [["a", "A"], ["b", "B"]]) {
      after.lenses[which].lat = points[which].point.lat;
      after.lenses[which].lon = points[which].point.lon;
      const given = command[side].radiusM;
      after.lenses[which].radiusM = given !== undefined ? given : which === "A" ? before.lenses.A.radiusM : defaultRadiusB;
      resolved[which] = Object.freeze({ area: points[which].area, point: Object.freeze(points[which].point) });
      if (points[which].area) note(SPATIAL_COMMAND_NOTE.LENS_CIRCLE_NOT_AREA);
    }
    // The manual sequence (COMPARE, then Lens A, then Lens B) ends with B active.
    after.activeLens = "B";
  }

  if (after.mode !== before.mode) note(SPATIAL_COMMAND_NOTE.MODE_CHANGED);
  if (after.activeLens !== before.activeLens) note(SPATIAL_COMMAND_NOTE.ACTIVE_LENS_CHANGED);
  for (const w of SPATIAL_COMMAND_LENSES) {
    const moved = after.lenses[w].lat !== before.lenses[w].lat || after.lenses[w].lon !== before.lenses[w].lon;
    if (moved) note(SPATIAL_COMMAND_NOTE.CENTRE_MOVED);
  }
  const changed = JSON.stringify(after) !== JSON.stringify(before);
  return Object.freeze({ ok: true, plan: Object.freeze({
    action: command.action,
    command,
    kind: "lens",
    changed,
    notes: Object.freeze(changed ? notes : []),
    resolved: Object.freeze(resolved),
    target: Object.freeze({
      mode: after.mode,
      activeLens: after.activeLens,
      lensBEnabled: after.lensBEnabled,
      lenses: Object.freeze({ A: Object.freeze(after.lenses.A), B: Object.freeze(after.lenses.B) }),
    }),
  }) });
}

// prepareSpatialCommand(input, context) — stages 1 and 2 in one call. Pure.
function prepareSpatialCommand(input, context) {
  const validated = validateSpatialCommand(input);
  if (!validated.ok) return validated;
  return planSpatialCommand(validated.command, context);
}

// The execution receipt. It records WHAT was executed and the resulting Lens /
// camera state as read back from the application afterwards. It never carries a
// reading, a count or any other analytical value.
function buildSpatialCommandReceipt({ input, prepared, status, error = null, state = null, rolledBack } = {}) {
  const plan = prepared && prepared.ok ? prepared.plan : null;
  let action = null;
  if (plan) action = plan.action;
  else if (spatialCommandIsRecord(input) && typeof input.action === "string" && SPATIAL_COMMAND_ACTIONS.includes(input.action)) action = input.action;
  const receipt = {
    version: SPATIAL_COMMAND_VERSION,
    action,
    status,
    command: plan ? plan.command : null,
    resolved: plan ? plan.resolved : null,
    error: error || (prepared && !prepared.ok ? prepared.error : null),
    notes: plan && status === SPATIAL_COMMAND_STATUS.APPLIED ? plan.notes : Object.freeze([]),
    state,
  };
  if (rolledBack !== undefined) receipt.rolledBack = rolledBack;
  return Object.freeze(receipt);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SPATIAL_COMMAND_VERSION,
    SPATIAL_COMMAND_ACTIONS,
    SPATIAL_COMMAND_STATUS,
    SPATIAL_COMMAND_ERROR,
    SPATIAL_COMMAND_NOTE,
    SPATIAL_COMMAND_AREA_TYPES,
    SPATIAL_COMMAND_LENS_AREA_TYPES,
    SPATIAL_COMMAND_FIT,
    validateSpatialCommand,
    planSpatialCommand,
    prepareSpatialCommand,
    buildSpatialCommandReceipt,
  };
}
