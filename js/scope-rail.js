// Scope & freshness rail and evidence-drawer models — pure (K4, #66).
//
// Built ON TOP of the K2 contract in js/evidence-scope.js; it takes no
// methodological decision of its own. It answers two questions without a DOM:
//
//   railModel(...)          what do the CURRENTLY VISIBLE surfaces describe, and
//                           how old is the oldest contributing reference date?
//   buildEvidenceRecords()  for a set of surfaces, what are the source,
//                           authority, scope, unit, five freshness fields,
//                           retrieval route and verbatim interpretation ceiling?
//
// The ONLY provenance truth is data/source_registry.json, passed in as a plain
// object. Nothing here reads a clock, infers a scope from coordinates or a name,
// defaults an unscoped value, manufactures a date, or converts a source state
// into a grade. A surface earns its scope by declaring one in SURFACES below, and
// scopeOf() throws on anything outside the closed enum.

const EVIDENCE_SCOPE_API =
  typeof module !== "undefined" && module.exports
    ? require("./evidence-scope.js")
    : { ANALYTICAL_SCOPES, FRESHNESS_FIELDS, scopeOf, freshnessOf, oldestReferenceDate };

// Distinct glyph per analytical scope. A glyph never carries meaning alone: the
// rail always pairs it with a text label, and the glyph is aria-hidden.
const SCOPE_GLYPHS = Object.freeze({
  LENS_CIRCLE: "◎",
  OFFICIAL_BARRIO: "⬡",
  OFFICIAL_DISTRICT: "⬢",
  MUNICIPALITY: "▦",
  POINT_OBSERVATION: "⌖",
  BOUNDED_STUDY_AREA: "▭",
  PLANNING_AMBITO: "▣",
  EXECUTION_UNIT: "▤",
  DEVELOPMENT_STAGE_AREA: "▥",
  PARCEL: "▧",
  ADDRESS_POINT: "⌾",
  WORK_GEOMETRY: "▨",
  LENS_INTERSECT_AMBITO: "⊚",
});

// Every value the panel renders resolves to ONE analytical scope here. `scope` is
// the scope of the DISPLAYED VALUE (a count inside a Lens circle is LENS_CIRCLE
// even though its source records are points); `sources` are the registry ids that
// contribute to it. `unit` and `derivation` are copy keys, resolved by the
// caller's dictionary, so the drawer states them from one place rather than from
// hand-written card prose. `when` names an optional visibility flag.
//
// The planning surfaces are K6's (#68). They are PLANNING_AMBITO-scoped — every
// published state and quantity describes the WHOLE ámbito — except the Lens∩ámbito
// membership list, which is LENS_INTERSECT_AMBITO and carries no quantity at all.
// The two scopes are never merged and no value carries both.
const SURFACES = Object.freeze({
  "place.area.residents": { mode: "PLACE", scope: "OFFICIAL_BARRIO", sources: ["population", "geography"], unit: "unit.residents", derivation: "derive.published" },
  "place.area.vut": { mode: "PLACE", scope: "OFFICIAL_BARRIO", sources: ["vut_licences"], unit: "unit.vutUnits", derivation: "derive.published", when: "vut" },
  "place.metric.tourism": { mode: "PLACE", scope: "LENS_CIRCLE", sources: ["museum", "info"], unit: "unit.records", derivation: "derive.lensCount" },
  "place.metric.stays": { mode: "PLACE", scope: "LENS_CIRCLE", sources: ["stay"], unit: "unit.records", derivation: "derive.lensCount" },
  "place.metric.mobility": { mode: "PLACE", scope: "LENS_CIRCLE", sources: ["bike", "rail"], unit: "unit.records", derivation: "derive.lensCount" },
  "place.metric.utci": { mode: "PLACE", scope: "LENS_CIRCLE", sources: ["hati"], unit: "unit.celsius", derivation: "derive.lensMean", when: "hati" },
  "place.planning.ambito": { mode: "PLACE", scope: "PLANNING_AMBITO", sources: ["planning_ambito_geometry"], unit: "unit.ambitoIdentity", derivation: "derive.ambitoContainment" },
  "place.planning.phases": { mode: "PLACE", scope: "PLANNING_AMBITO", sources: ["planning_ambito_state"], unit: "unit.phaseState", derivation: "derive.published" },
  "place.planning.surface": { mode: "PLACE", scope: "PLANNING_AMBITO", sources: ["planning_ambito_state"], unit: "unit.squareMetres", derivation: "derive.published" },
  "place.planning.buildability": { mode: "PLACE", scope: "PLANNING_AMBITO", sources: ["planning_ambito_state"], unit: "unit.buildability", derivation: "derive.published" },
  "place.planning.touched": { mode: "PLACE", scope: "LENS_INTERSECT_AMBITO", sources: ["planning_ambito_geometry"], unit: "unit.touchedAmbitos", derivation: "derive.ambitoMembership", when: "planningDetail" },
  "place.detail.mix": { mode: "PLACE", scope: "LENS_CIRCLE", sources: ["museum", "info", "stay", "bike", "rail"], unit: "unit.share", derivation: "derive.lensShare" },
  "place.detail.nearest": { mode: "PLACE", scope: "LENS_CIRCLE", sources: ["museum", "info", "stay", "bike", "rail"], unit: "unit.metres", derivation: "derive.nearest" },
  "place.pedestrian": { mode: "PLACE", scope: "LENS_CIRCLE", sources: ["pedestrian"], unit: "unit.pedestrians", derivation: "derive.lensMean", when: "pedestrian" },
  "place.hospitality": { mode: "PLACE", scope: "OFFICIAL_BARRIO", sources: ["hospitality_commercial_context"], unit: "unit.hospitality", derivation: "derive.published", when: "hospitality" },
  "layer.hati": { mode: "PLACE", scope: "BOUNDED_STUDY_AREA", sources: ["hati"], unit: "unit.celsius", derivation: "derive.published", when: "hati" },
  "layer.pedestrian": { mode: "PLACE", scope: "POINT_OBSERVATION", sources: ["pedestrian"], unit: "unit.pedestrians", derivation: "derive.published", when: "pedestrian" },

  "compare.metric.tourism": { mode: "COMPARE", scope: "LENS_CIRCLE", sources: ["museum", "info"], unit: "unit.records", derivation: "derive.compare" },
  "compare.metric.stays": { mode: "COMPARE", scope: "LENS_CIRCLE", sources: ["stay"], unit: "unit.records", derivation: "derive.compare" },
  "compare.metric.mobility": { mode: "COMPARE", scope: "LENS_CIRCLE", sources: ["bike", "rail"], unit: "unit.records", derivation: "derive.compare" },
  "compare.metric.utci": { mode: "COMPARE", scope: "LENS_CIRCLE", sources: ["hati"], unit: "unit.celsius", derivation: "derive.compare", when: "hati" },
  "compare.pedestrian": { mode: "COMPARE", scope: "LENS_CIRCLE", sources: ["pedestrian"], unit: "unit.pedestrians", derivation: "derive.compare", when: "pedestrian" },

  "city.hotel_demand": { mode: "CITY", scope: "MUNICIPALITY", sources: ["hotel_demand"], unit: "unit.hotelDemand", derivation: "derive.published" },
  "city.domestic_origins": { mode: "CITY", scope: "MUNICIPALITY", sources: ["domestic_origin_context"], unit: "unit.tourists", derivation: "derive.published" },
  "city.domestic_dynamics": { mode: "CITY", scope: "MUNICIPALITY", sources: ["domestic_origin_context"], unit: "unit.tourists", derivation: "derive.dynamics" },
});

function surfaceKeysFor(mode, flags = {}) {
  return Object.keys(SURFACES).filter((key) => {
    const surface = SURFACES[key];
    return surface.mode === mode && (!surface.when || Boolean(flags[surface.when]));
  });
}

function registrySourceMap(registry) {
  if (!registry || !Array.isArray(registry.sources)) {
    throw new TypeError("registry must be the parsed source_registry.json (an object with a `sources` array)");
  }
  return new Map(registry.sources.map((source) => [source.id, source]));
}

function requireSource(map, id, surfaceKey) {
  const source = map.get(id);
  if (!source) {
    throw new Error(`surface "${surfaceKey}" names source "${id}", which is not in the registry`);
  }
  return source;
}

// railModel({ mode, flags, registry, instances }) ->
//   entries    one per DISTINCT scope among the visible surfaces, in order of first
//              appearance, each carrying the display instances the app supplies
//              (e.g. ["A · 900 m", "B · 900 m"] for LENS_CIRCLE) and its surfaces
//   freshness  { referenceDate, contributors, sourceStates }
// `referenceDate` is oldestReferenceDate() over every contributing registry
// source: the oldest date at its original precision, or null if ANY contributor
// has no reference date. The rail never invents a common date. `sourceStates` is
// the DISTINCT publisher source states, in registry order; it is descriptive and
// never mapped to a colour, grade or score.
function railModel({ mode, flags = {}, registry, instances = {} }) {
  const map = registrySourceMap(registry);
  const keys = surfaceKeysFor(mode, flags);
  const entries = [];
  const contributorIds = [];

  for (const key of keys) {
    const surface = SURFACES[key];
    const scope = EVIDENCE_SCOPE_API.scopeOf(surface); // throws if undeclared / outside the enum
    let entry = entries.find((candidate) => candidate.scope === scope);
    if (!entry) {
      entry = { scope, glyph: SCOPE_GLYPHS[scope], instances: [...(instances[scope] || [])], surfaces: [] };
      entries.push(entry);
    }
    entry.surfaces.push(key);
    for (const id of surface.sources) if (!contributorIds.includes(id)) contributorIds.push(id);
  }

  const contributors = contributorIds.map((id) => requireSource(map, id, "rail"));
  const referenceDate = EVIDENCE_SCOPE_API.oldestReferenceDate(contributors);
  const sourceStates = [];
  for (const source of contributors) {
    if (!sourceStates.includes(source.source_state)) sourceStates.push(source.source_state);
  }
  return deepFreeze({
    mode,
    entries,
    freshness: { referenceDate, contributors: contributorIds, sourceStates },
  });
}

// buildEvidenceRecords({ surfaces, registry, scope?, sourceId? }) -> frozen
// records for the drawer, one per surface, optionally filtered to one scope or one
// source. Every field is read from the registry or the SURFACES table; nothing is
// composed or softened here, and the ceiling is carried verbatim.
function buildEvidenceRecords({ surfaces, registry, scope = null, sourceId = null }) {
  const map = registrySourceMap(registry);
  const definitions = (registry.spatial_scopes && registry.spatial_scopes.analytical_scopes) || {};
  const records = [];
  for (const key of surfaces) {
    const surface = SURFACES[key];
    if (!surface) throw new Error(`unknown surface "${key}"`);
    const surfaceScope = EVIDENCE_SCOPE_API.scopeOf(surface);
    if (scope && surfaceScope !== scope) continue;
    if (sourceId && !surface.sources.includes(sourceId)) continue;
    records.push({
      surface: key,
      scope: surfaceScope,
      scopeDefinition: (definitions[surfaceScope] && definitions[surfaceScope].definition) || null,
      unit: surface.unit,
      derivation: surface.derivation,
      sources: surface.sources.map((id) => {
        const source = requireSource(map, id, key);
        return {
          id,
          displayName: source.display_name || id,
          authority: source.authority || null,
          datasetUrl: source.dataset_url || null,
          artifact: source.artifact || null,
          builder: source.builder || null,
          freshness: EVIDENCE_SCOPE_API.freshnessOf(source),
          freshnessEvidence: source.freshness_evidence || null,
          periodSemantics: source.source_period_semantics || null,
          interpretationCeiling: source.interpretation_ceiling,
        };
      }),
    });
  }
  return deepFreeze(records);
}

// The citizen and analyst readings are two PROJECTIONS of one frozen record.
// A projection may OMIT a field. It may never change a value, merge or reorder
// states, soften a ceiling, or alter a unit; both readings carry the verbatim
// interpretation ceiling and all five freshness fields.
const CITIZEN_SOURCE_FIELDS = Object.freeze(["id", "displayName", "authority", "freshness", "interpretationCeiling"]);

function projectReading(record, reading) {
  if (reading !== "citizen" && reading !== "analyst") {
    throw new Error(`projectReading: reading must be "citizen" or "analyst", got "${reading}"`);
  }
  if (reading === "analyst") return record; // the whole frozen record, unchanged
  return deepFreeze({
    surface: record.surface,
    scope: record.scope,
    unit: record.unit,
    derivation: record.derivation,
    sources: record.sources.map((source) => {
      const picked = {};
      for (const field of CITIZEN_SOURCE_FIELDS) picked[field] = source[field];
      // The five freshness fields only; observed_cadence is an analyst detail.
      picked.freshness = pickFiveFreshnessFields(source.freshness);
      return picked;
    }),
  });
}

function pickFiveFreshnessFields(freshness) {
  const picked = {};
  for (const field of EVIDENCE_SCOPE_API.FRESHNESS_FIELDS) picked[field] = freshness[field];
  return picked;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCOPE_GLYPHS,
    SURFACES,
    CITIZEN_SOURCE_FIELDS,
    surfaceKeysFor,
    railModel,
    buildEvidenceRecords,
    projectReading,
  };
}
