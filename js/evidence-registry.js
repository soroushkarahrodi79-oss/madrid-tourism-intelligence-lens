// Evidence Registry query contract — the pure, deterministic query layer (K13, #75).
//
// WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
//
// This module is an INSPECTABLE QUERY LAYER OVER REGISTERED EVIDENCE. It does one
// thing: it answers a CLOSED set of registered question shapes from the evidence
// the product already ships, and it ABSTAINS — as a first-class, correct result —
// whenever the evidence does not support the claim. It is the deterministic
// foundation that Gate K §15 requires to exist FIRST, so that any future assistant
// has nothing left to invent: the only roles the gate ever permits a language
// model are classifying the question (this module's `classifyIntent` seam) and
// phrasing an answer whose every factual token already came out of a resolver
// result here. It never computes a number, never chooses a date, never decides a
// scope, and never fills a gap.
//
// THIS MODULE INTRODUCES NO ASSISTANT. There is no language model, no model call,
// no API key, no network request, no embedding, no vector store, no conversational
// surface and no natural-language generation of any kind. `classifyIntent` is a
// deterministic keyword-and-pattern matcher and nothing else; a test asserts its
// output is consumed only as a shape selector and never as answer content, and a
// second test asserts no module in this layer performs a fetch or references a
// model endpoint, a key or a request string. Answers are assembled from the
// resolver's own frozen result; there is no free text here to put a claim into.
//
// IT IS PURE, exactly like js/evidence-scope.js and js/scope-rail.js on which it
// builds: no DOM, no Leaflet, no fetch, no clock, no app-state globals. It reads
// no file and opens no socket. The parsed source_registry.json is PASSED IN as a
// plain object, and the deterministic models (#68 planning, #69 edition change,
// #71 licences, #72 ámbito comparison, the area-profile and destination models)
// are PASSED IN as already-built instances. The registry never duplicates their
// analytical logic; a resolver RUNS the existing model and wraps its own result in
// the evidence-object contract with provenance attached. A model that was not
// wired in (its artifact did not load) makes its shape abstain with evidence, not
// crash.

const REGISTRY_SCOPE_API =
  typeof module !== "undefined" && module.exports
    ? require("./evidence-scope.js")
    : {
        ANALYTICAL_SCOPES,
        FRESHNESS_FIELDS,
        isAnalyticalScope,
        isReferenceDate,
        scopeOf,
        freshnessOf,
        crossScopeArithmeticAllowed,
      };

// ============================================================ closed vocabularies

// `derivation` on every evidence object is EITHER the literal SOURCE_FACT — a value
// the publisher published, read verbatim — OR a NAMED deterministic transformation
// this layer applied to source facts. Gate §15.3 requires every answer to state
// this distinction, so the set is closed and a resolver may not invent a name.
const DERIVATION = Object.freeze({
  // A value the source published, carried through unchanged.
  SOURCE_FACT: "SOURCE_FACT",
  // Which official planning ámbito contains a point (geometry containment only).
  POINT_IN_POLYGON: "POINT_IN_POLYGON",
  // WHICH ámbitos a Lens circle touches — a membership relation that carries NO
  // quantity, no overlap area and no apportioned share.
  CIRCLE_INTERSECT_POLYGON: "CIRCLE_INTERSECT_POLYGON",
  // A count of located records spatially included in a Lens circle, by family and
  // grant-date window. Never a barrio figure and never a density.
  IN_CIRCLE_FILTER: "IN_CIRCLE_FILTER",
  // The provenance of a registered source, read from the registry.
  REGISTRY_LOOKUP: "REGISTRY_LOOKUP",
  // An edition-to-edition classification of one ámbito's published state.
  EDITION_DIFF: "EDITION_DIFF",
  // A same-scope comparison of two evidence objects (never cross-scope).
  SAME_SCOPE_COMPARISON: "SAME_SCOPE_COMPARISON",
});
const DERIVATIONS = Object.freeze(Object.values(DERIVATION));

// The CLOSED set of registered question shapes. Adding a shape is a code change
// with tests, never a configuration value. Each shape names the §5 user question
// it serves, its analytical scope, the registry source(s) it reads, the
// deterministic derivation it applies, and the dependency it needs wired in. A
// shape whose dependency is absent at query time abstains with evidence.
const SHAPE = Object.freeze({
  AMBITO_AT_POINT: "AMBITO_AT_POINT",
  AMBITO_PHASES: "AMBITO_PHASES",
  AMBITO_BUILDABILITY: "AMBITO_BUILDABILITY",
  AMBITOS_IN_LENS: "AMBITOS_IN_LENS",
  AMBITO_EDITION_DIFF: "AMBITO_EDITION_DIFF",
  LICENCES_IN_LENS: "LICENCES_IN_LENS",
  AMBITO_COMPARE: "AMBITO_COMPARE",
  SOURCE_PROVENANCE: "SOURCE_PROVENANCE",
  AREA_PROFILE_AT_POINT: "AREA_PROFILE_AT_POINT",
  CITY_HOTEL_DEMAND: "CITY_HOTEL_DEMAND",
});
const REGISTERED_SHAPES = Object.freeze(Object.values(SHAPE));

// The CLOSED abstention vocabulary (gate §15.3). A refusal is a correct scientific
// result; it is NEVER a zero, never missing-but-estimable data, and never a
// nearest match. Every reason is independently reachable by a test.
const ABSTENTION_REASON = Object.freeze({
  // The requested shape is not in the closed registered set.
  UNREGISTERED_SHAPE: "UNREGISTERED_SHAPE",
  // The scope could not be resolved to exactly one object (no code, no point, or
  // a point/code that resolves to more than one candidate).
  AMBIGUOUS_SCOPE: "AMBIGUOUS_SCOPE",
  // The scope resolved, but the source holds no evidence for it (no ámbito at the
  // point; a code with no published state; a model not wired in).
  NO_EVIDENCE_FOR_SCOPE: "NO_EVIDENCE_FOR_SCOPE",
  // Two values of different analytical scope were asked to be combined without an
  // explicit, documented basis. Geometric overlap is not a basis.
  CROSS_SCOPE_WITHOUT_BASIS: "CROSS_SCOPE_WITHOUT_BASIS",
  // The requested object is outside the source's universe (an unknown source id,
  // an unknown ámbito code, a point outside the municipality).
  OUTSIDE_SOURCE_UNIVERSE: "OUTSIDE_SOURCE_UNIVERSE",
  // The requested period is outside the source's temporal coverage. A nearest
  // match is never substituted.
  OUTSIDE_TEMPORAL_COVERAGE: "OUTSIDE_TEMPORAL_COVERAGE",
  // The publisher declared the value withheld, or the deterministic model withheld
  // a comparison. The refusal carries that status; it is not a zero.
  WITHHELD_BY_PUBLISHER: "WITHHELD_BY_PUBLISHER",
  // The contract's interpretation ceiling forbids the requested KIND of claim —
  // a dwelling count, an apportionment, a completion date or projection, a
  // ranking or score, a causal claim, or a legal interpretation. The specific
  // clause is named in the abstention's `prohibition` field.
  CEILING_PROHIBITS: "CEILING_PROHIBITS",
});
const ABSTENTION_REASONS = Object.freeze(Object.values(ABSTENTION_REASON));

// The eight §4 prohibitions, enforced structurally. Each names the specific clause
// so a CEILING_PROHIBITS / CROSS_SCOPE_WITHOUT_BASIS abstention is self-describing
// and a prohibition test can assert the exact clause that fired.
const PROHIBITION = Object.freeze({
  // (1) Every factual token must trace to a resolver result. Enforced by
  // construction: makeEvidence refuses an object with no source id, and this layer
  // generates no free-text answer into which an untraceable token could be placed.
  UNTRACEABLE_TOKEN: "UNTRACEABLE_TOKEN",
  // (2) No cross-scope combination without an explicit documented basis.
  CROSS_SCOPE_COMBINATION: "CROSS_SCOPE_COMBINATION",
  // (3) No apportionment of a whole-object quantity to a part.
  WHOLE_TO_PART_APPORTIONMENT: "WHOLE_TO_PART_APPORTIONMENT",
  // (4) No dwelling or protected-dwelling count.
  DWELLING_COUNT: "DWELLING_COUNT",
  // (5) No completion date, timeline or projection.
  COMPLETION_OR_PROJECTION: "COMPLETION_OR_PROJECTION",
  // (6) No ranking, score, ordering or recommendation.
  RANKING_OR_RECOMMENDATION: "RANKING_OR_RECOMMENDATION",
  // (7) No causal claim.
  CAUSAL_CLAIM: "CAUSAL_CLAIM",
  // (8) No legal or regulatory interpretation.
  LEGAL_INTERPRETATION: "LEGAL_INTERPRETATION",
});
const PROHIBITIONS = Object.freeze(Object.values(PROHIBITION));

// Which closed reason each prohibition abstains with. Cross-scope has its own
// reason; the remaining ceiling clauses share CEILING_PROHIBITS and are told apart
// by the `prohibition` field.
const PROHIBITION_REASON = Object.freeze({
  [PROHIBITION.UNTRACEABLE_TOKEN]: ABSTENTION_REASON.CEILING_PROHIBITS,
  [PROHIBITION.CROSS_SCOPE_COMBINATION]: ABSTENTION_REASON.CROSS_SCOPE_WITHOUT_BASIS,
  [PROHIBITION.WHOLE_TO_PART_APPORTIONMENT]: ABSTENTION_REASON.CEILING_PROHIBITS,
  [PROHIBITION.DWELLING_COUNT]: ABSTENTION_REASON.CEILING_PROHIBITS,
  [PROHIBITION.COMPLETION_OR_PROJECTION]: ABSTENTION_REASON.CEILING_PROHIBITS,
  [PROHIBITION.RANKING_OR_RECOMMENDATION]: ABSTENTION_REASON.CEILING_PROHIBITS,
  [PROHIBITION.CAUSAL_CLAIM]: ABSTENTION_REASON.CEILING_PROHIBITS,
  [PROHIBITION.LEGAL_INTERPRETATION]: ABSTENTION_REASON.CEILING_PROHIBITS,
});

// ========================================================================= helpers

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// ===================================================== the evidence object contract

// makeEvidence({ value, scope, unit, sourceId, freshness, ceiling, derivation })
// returns a FROZEN, inspectable evidence object, or THROWS. Every field is
// mandatory; a missing field is a contract violation, never defaulted or
// back-filled. This is the only constructor of a factual answer in the layer, so
// it is the structural chokepoint for prohibition (1): an object with no traceable
// source id cannot be built, and nothing else in the layer emits a factual token.
//
//   value       the resolver's own result (a number, a frozen record, a membership
//               list). It is whatever the deterministic model returned; this layer
//               does not recompute it.
//   scope       one analytical scope id from the closed enum (js/evidence-scope.js).
//   unit        the unit/copy key for the value (never blank).
//   sourceId    the registered source the value traces to (never blank). For a
//               multi-source reading this is the primary source; contributors ride
//               along in `sources` on the resolver result, not here.
//   freshness   the five-field freshness record of the source, preserving explicit
//               nulls. Validated field-by-field; a missing field throws.
//   ceiling     the verbatim interpretation ceiling of the source (never softened).
//   derivation  SOURCE_FACT or a named transformation from DERIVATION.
function makeEvidence(fields) {
  if (!isObject(fields)) {
    throw new TypeError("makeEvidence: expected an object with the seven contract fields");
  }
  const { value, scope, unit, sourceId, freshness, ceiling, derivation } = fields;

  if (!("value" in fields)) {
    throw new Error("makeEvidence: `value` is mandatory; an evidence object never omits its value");
  }
  if (value === undefined) {
    throw new Error("makeEvidence: `value` must not be undefined (use null for an explicit known absence)");
  }
  if (!REGISTRY_SCOPE_API.isAnalyticalScope(scope)) {
    throw new Error(`makeEvidence: "${scope}" is not a declared analytical scope`);
  }
  if (!isNonEmptyString(unit)) {
    throw new Error("makeEvidence: `unit` is mandatory and must be a non-empty string");
  }
  // Prohibition (1), structural: a factual token with no traceable source is
  // refused at construction. There is no path to an answer that skips this.
  if (!isNonEmptyString(sourceId)) {
    throw new Error("makeEvidence: `sourceId` is mandatory; every factual token must trace to a registered source");
  }
  const validatedFreshness = validateFreshness(freshness);
  if (!isNonEmptyString(ceiling)) {
    throw new Error("makeEvidence: `ceiling` is mandatory; an evidence object always carries its interpretation ceiling");
  }
  if (!DERIVATIONS.includes(derivation)) {
    throw new Error(`makeEvidence: derivation "${derivation}" is not SOURCE_FACT or a named transformation (${DERIVATIONS.join(", ")})`);
  }

  return deepFreeze({
    kind: "EVIDENCE",
    value,
    scope,
    unit,
    sourceId,
    freshness: validatedFreshness,
    ceiling,
    derivation,
  });
}

// The five mandatory freshness fields must all be present (explicit null is a kept
// value, a missing key is a violation). observed_cadence rides along when present.
function validateFreshness(freshness) {
  if (!isObject(freshness)) {
    throw new TypeError("makeEvidence: `freshness` must be the five-field freshness record");
  }
  const record = {};
  for (const field of REGISTRY_SCOPE_API.FRESHNESS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(freshness, field)) {
      throw new Error(`makeEvidence: freshness is missing mandatory field "${field}"`);
    }
    record[field] = freshness[field];
  }
  if (Object.prototype.hasOwnProperty.call(freshness, "observed_cadence")) {
    record.observed_cadence = freshness.observed_cadence;
  }
  return record; // frozen by makeEvidence's deepFreeze of the whole object
}

function isEvidence(value) {
  return isObject(value) && value.kind === "EVIDENCE";
}

// ================================================================ abstention contract

// abstain(reason, detail?) is a FIRST-CLASS return value, never an exception and
// never a zero. The reason is from the closed vocabulary; detail carries the human
// context (which scope, which source, which window) and, for a prohibition, the
// specific §4 clause. The object is frozen and self-describing.
function abstain(reason, detail = {}) {
  if (!ABSTENTION_REASONS.includes(reason)) {
    throw new Error(`abstain: "${reason}" is not a declared abstention reason (${ABSTENTION_REASONS.join(", ")})`);
  }
  if (!isObject(detail)) {
    throw new TypeError("abstain: detail must be an object");
  }
  return deepFreeze({
    kind: "ABSTENTION",
    reason,
    shape: detail.shape ?? null,
    scope: detail.scope ?? null,
    prohibition: detail.prohibition ?? null,
    message: detail.message ?? null,
  });
}

function isAbstention(value) {
  return isObject(value) && value.kind === "ABSTENTION";
}

// prohibit(clause, detail?) refuses a §4-prohibited operation with the closed
// reason it maps to, tagging the specific clause so the refusal is self-describing
// and testable. It is the single place a prohibition becomes an abstention.
function prohibit(clause, detail = {}) {
  if (!PROHIBITIONS.includes(clause)) {
    throw new Error(`prohibit: "${clause}" is not a declared prohibition clause`);
  }
  return abstain(PROHIBITION_REASON[clause], { ...detail, prohibition: clause });
}

// =============================================================== prohibition screen

// A request may carry an explicit `intent` the caller derived (e.g. a param asking
// for a ranking or a completion date). This screen refuses the §4-prohibited
// intents BEFORE a resolver runs, so no resolver can be coaxed into a prohibited
// claim by a crafted parameter. It inspects declared booleans/strings on the
// request only; it never parses free prose for meaning (that is classifyIntent's
// job, and classifyIntent cannot select a prohibited shape because none exists).
const PROHIBITED_INTENT_FLAGS = Object.freeze({
  wantsDwellingCount: PROHIBITION.DWELLING_COUNT,
  wantsApportionment: PROHIBITION.WHOLE_TO_PART_APPORTIONMENT,
  wantsCompletionDate: PROHIBITION.COMPLETION_OR_PROJECTION,
  wantsProjection: PROHIBITION.COMPLETION_OR_PROJECTION,
  wantsRanking: PROHIBITION.RANKING_OR_RECOMMENDATION,
  wantsRecommendation: PROHIBITION.RANKING_OR_RECOMMENDATION,
  wantsCausalClaim: PROHIBITION.CAUSAL_CLAIM,
  wantsLegalInterpretation: PROHIBITION.LEGAL_INTERPRETATION,
});

function screenProhibitedIntent(shape, params) {
  if (!isObject(params)) return null;
  for (const [flag, clause] of Object.entries(PROHIBITED_INTENT_FLAGS)) {
    if (params[flag] === true) {
      return prohibit(clause, { shape, message: `the request asks for ${clause}, which the contract prohibits` });
    }
  }
  return null;
}

// ===================================================================== source lookup

function registrySourceMap(registry) {
  if (!isObject(registry) || !Array.isArray(registry.sources)) {
    throw new TypeError("evidence-registry: registry must be the parsed source_registry.json (an object with a `sources` array)");
  }
  return new Map(registry.sources.map((source) => [source.id, source]));
}

function analyticalScopeDefinitions(registry) {
  return (registry.spatial_scopes && registry.spatial_scopes.analytical_scopes) || {};
}

// sourceProvenance(registry, sourceId, { freshnessOverride }) returns the FROZEN
// provenance descriptor for one registered source — the single assembly that the
// evidence drawer (js/scope-rail.js) and the export bundle (js/evidence-export.js)
// both read through, so SOURCE_PROVENANCE has exactly one definition. It returns
// null for an unknown id (callers decide whether that is OUTSIDE_SOURCE_UNIVERSE or
// a reported-missing export row). Every field is copied verbatim from the registry;
// nothing is composed or softened.
function sourceProvenance(registry, sourceId, options = {}) {
  const map = registrySourceMap(registry);
  const source = map.get(sourceId);
  if (!source) return null;
  const baseFreshness = REGISTRY_SCOPE_API.freshnessOf(source);
  const freshness = options.freshnessOverride
    ? { ...baseFreshness, ...options.freshnessOverride }
    : baseFreshness;
  return deepFreeze({
    id: source.id,
    scope: source.scope,
    displayName: source.display_name || source.id,
    authority: source.authority || null,
    datasetUrl: source.dataset_url || null,
    secondaryDatasetUrl: source.secondary_dataset_url || null,
    artifact: source.artifact || null,
    builder: source.builder || null,
    freshness,
    freshnessEvidence: source.freshness_evidence || null,
    periodSemantics: source.source_period_semantics || null,
    interpretationCeiling: source.interpretation_ceiling,
    changeDetectionProvenance: source.change_detection || null,
  });
}

// =========================================================== deterministic resolvers
//
// Each resolver receives (params, deps, ctx) and returns an EVIDENCE object or an
// ABSTENTION. The resolution order is identical for all of them and is enforced by
// `resolve` below, not by the resolver: shape validation, prohibition screen, then
// the resolver runs scope resolution, the ceiling check, the existing model lookup,
// and returns provenance with the result or abstains. A resolver never reaches the
// network, never reads a clock, and never computes a value the model did not
// return.

function evidenceFromSource(ctx, { value, scope, unit, sourceId, derivation, freshnessOverride }) {
  const prov = ctx.sourceProvenance(sourceId, freshnessOverride ? { freshnessOverride } : {});
  if (!prov) {
    return abstain(ABSTENTION_REASON.OUTSIDE_SOURCE_UNIVERSE, {
      message: `source "${sourceId}" is not in the registry`,
    });
  }
  // A VALUE whose publisher declared it withheld is not presented as a figure; the
  // refusal carries that status. (The provenance of a withheld source is still
  // disclosable — that path is SOURCE_PROVENANCE, which does not come through here.)
  if (prov.freshness && prov.freshness.source_state === "WITHHELD_BY_PUBLISHER") {
    return abstain(ABSTENTION_REASON.WITHHELD_BY_PUBLISHER, {
      scope,
      message: `the publisher withheld "${sourceId}"`,
    });
  }
  return makeEvidence({
    value,
    scope,
    unit,
    sourceId,
    freshness: prov.freshness,
    ceiling: prov.interpretationCeiling,
    derivation,
  });
}

// --- SOURCE_PROVENANCE ------------------------------------------------------------
// Q13-direct: what supports a value, when it was updated, what it does not permit.
function resolveSourceProvenance(params, deps, ctx) {
  const sourceId = params && params.sourceId;
  if (!isNonEmptyString(sourceId)) {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape: SHAPE.SOURCE_PROVENANCE,
      message: "a source id is required to resolve provenance",
    });
  }
  const prov = ctx.sourceProvenance(sourceId);
  if (!prov) {
    return abstain(ABSTENTION_REASON.OUTSIDE_SOURCE_UNIVERSE, {
      shape: SHAPE.SOURCE_PROVENANCE,
      message: `source "${sourceId}" is not a registered source`,
    });
  }
  // The value of a SOURCE_PROVENANCE answer IS the provenance descriptor; it is a
  // registry fact, so derivation is REGISTRY_LOOKUP, not SOURCE_FACT (which is a
  // published measurement).
  return makeEvidence({
    value: prov,
    scope: prov.scope,
    unit: "provenance",
    sourceId: prov.id,
    freshness: prov.freshness,
    ceiling: prov.interpretationCeiling,
    derivation: DERIVATION.REGISTRY_LOOKUP,
  });
}

// --- AMBITO_AT_POINT --------------------------------------------------------------
// Q: which official planning ámbito contains this point?
function resolveAmbitoAtPoint(params, deps, ctx) {
  const index = deps.planningIndex;
  if (!index || typeof index.ambitoContaining !== "function") {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AMBITO_AT_POINT,
      scope: "PLANNING_AMBITO",
      message: "the planning ámbito model is not available",
    });
  }
  const { lon, lat } = pointOf(params);
  if (lon === null || lat === null) {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape: SHAPE.AMBITO_AT_POINT,
      message: "a single lon/lat point is required",
    });
  }
  const containing = index.ambitoContaining(lon, lat, params.hintCode ?? null);
  const resolvedState = deps.planningModule && deps.planningModule.AMBITO_STATE
    ? deps.planningModule.AMBITO_STATE.RESOLVED
    : "RESOLVED";
  if (!containing || containing.state !== resolvedState || !containing.ambitoCode) {
    // No ámbito contains the point. This is a known absence, not a nearest match.
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AMBITO_AT_POINT,
      scope: "PLANNING_AMBITO",
      message: "no planning ámbito contains this point",
    });
  }
  return evidenceFromSource(ctx, {
    value: containing,
    scope: "PLANNING_AMBITO",
    unit: "unit.ambitoIdentity",
    sourceId: "planning_ambito_geometry",
    derivation: DERIVATION.POINT_IN_POLYGON,
  });
}

// --- AMBITO_PHASES ----------------------------------------------------------------
// Q: what is the published four-phase development state of this ámbito?
function resolveAmbitoPhases(params, deps, ctx) {
  return resolveAmbitoStateField(params, deps, ctx, {
    shape: SHAPE.AMBITO_PHASES,
    method: "developmentState",
    unit: "unit.phaseState",
  });
}

// --- AMBITO_BUILDABILITY ----------------------------------------------------------
// Q: what available buildability (m² edificable) is published for this ámbito?
function resolveAmbitoBuildability(params, deps, ctx) {
  return resolveAmbitoStateField(params, deps, ctx, {
    shape: SHAPE.AMBITO_BUILDABILITY,
    method: "availableBuildability",
    unit: "unit.buildability",
  });
}

function resolveAmbitoStateField(params, deps, ctx, { shape, method, unit }) {
  const index = deps.planningIndex;
  if (!index || typeof index[method] !== "function") {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape, scope: "PLANNING_AMBITO", message: "the planning ámbito state model is not available",
    });
  }
  const code = params && params.code;
  if (!isNonEmptyString(code)) {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape, message: "an exact official ámbito code is required",
    });
  }
  const record = index[method](code);
  const published = deps.planningModule && deps.planningModule.AVAILABILITY
    ? deps.planningModule.AVAILABILITY.PUBLISHED
    : "PUBLISHED";
  const availability = record && record.availability;
  if (availability === published) {
    return evidenceFromSource(ctx, {
      value: record, scope: "PLANNING_AMBITO", unit, sourceId: "planning_ambito_state",
      derivation: DERIVATION.SOURCE_FACT,
    });
  }
  // Not published for this code. Distinguish an UNKNOWN code (outside the ámbito
  // universe) from a KNOWN ámbito whose field is simply blank (missing is not zero).
  const known = typeof index.featureFor === "function" ? Boolean(index.featureFor(code)) : null;
  if (known === false) {
    return abstain(ABSTENTION_REASON.OUTSIDE_SOURCE_UNIVERSE, {
      shape, scope: "PLANNING_AMBITO", message: `ámbito code "${code}" is not in the published universe`,
    });
  }
  return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
    shape, scope: "PLANNING_AMBITO", message: `ámbito "${code}" has no published ${method}`,
  });
}

// --- AMBITOS_IN_LENS --------------------------------------------------------------
// Q: WHICH official ámbitos does this Lens circle touch? (membership only — no
// quantity, no overlap area, no apportioned share.)
function resolveAmbitosInLens(params, deps, ctx) {
  const index = deps.planningIndex;
  if (!index || typeof index.ambitosIntersecting !== "function") {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AMBITOS_IN_LENS, scope: "LENS_INTERSECT_AMBITO", message: "the planning ámbito model is not available",
    });
  }
  const { lon, lat } = pointOf(params);
  const radiusM = Number(params.radiusM);
  if (lon === null || lat === null || !Number.isFinite(radiusM) || radiusM <= 0) {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape: SHAPE.AMBITOS_IN_LENS, message: "a Lens centre (lon/lat) and a positive radius are required",
    });
  }
  const membership = index.ambitosIntersecting(lon, lat, radiusM);
  // The membership relation carries no quantity by construction; the resolver adds
  // none. Zero touched ámbitos is a real zero-membership answer, not an abstention.
  return evidenceFromSource(ctx, {
    value: membership,
    scope: "LENS_INTERSECT_AMBITO",
    unit: "unit.touchedAmbitos",
    sourceId: "planning_ambito_geometry",
    derivation: DERIVATION.CIRCLE_INTERSECT_POLYGON,
  });
}

// --- AMBITO_EDITION_DIFF ----------------------------------------------------------
// Q: how did this ámbito's published state change between two official editions?
function resolveAmbitoEditionDiff(params, deps, ctx) {
  const diff = deps.ambitoEditionDiff;
  if (typeof diff !== "function") {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AMBITO_EDITION_DIFF, scope: "PLANNING_AMBITO",
      message: "the edition-change model (#69) is not available",
    });
  }
  const code = params && params.code;
  if (!isNonEmptyString(code)) {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape: SHAPE.AMBITO_EDITION_DIFF, message: "an exact official ámbito code is required",
    });
  }
  let comparison;
  try {
    comparison = diff(code);
  } catch (error) {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AMBITO_EDITION_DIFF, scope: "PLANNING_AMBITO",
      message: `edition change could not be resolved for "${code}"`,
    });
  }
  if (!comparison) {
    return abstain(ABSTENTION_REASON.OUTSIDE_TEMPORAL_COVERAGE, {
      shape: SHAPE.AMBITO_EDITION_DIFF, scope: "PLANNING_AMBITO",
      message: `no two-edition coverage for "${code}"`,
    });
  }
  return evidenceFromSource(ctx, {
    value: comparison,
    scope: "PLANNING_AMBITO",
    unit: "unit.ambitoChange",
    sourceId: "planning_ambito_state",
    derivation: DERIVATION.EDITION_DIFF,
  });
}

// --- LICENCES_IN_LENS -------------------------------------------------------------
// Q: how many granted urban licences, by family, fall inside this Lens circle in a
// grant-date window? (located records in the circle — never a barrio figure.)
function resolveLicencesInLens(params, deps, ctx) {
  const index = deps.licenceIndex;
  if (!index || typeof index.view !== "function") {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.LICENCES_IN_LENS, scope: "ADDRESS_POINT",
      message: "the urban-licence model (#71) is not available",
    });
  }
  const { lon, lat } = pointOf(params);
  const radiusM = Number(params.radiusM);
  if (lon === null || lat === null || !Number.isFinite(radiusM) || radiusM <= 0) {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape: SHAPE.LICENCES_IN_LENS, message: "a Lens centre (lon/lat) and a positive radius are required",
    });
  }
  // A requested grant-date window entirely outside the register's extent is OUTSIDE
  // temporal coverage — refused, not clamped to a nearest match.
  if (params.window && index.dateExtent) {
    const outcome = windowCoverage(params.window, index.dateExtent);
    if (outcome === "OUTSIDE") {
      return abstain(ABSTENTION_REASON.OUTSIDE_TEMPORAL_COVERAGE, {
        shape: SHAPE.LICENCES_IN_LENS, scope: "ADDRESS_POINT",
        message: "the requested grant-date window is outside the register's coverage",
      });
    }
  }
  const view = index.view(
    { lon, lat, radiusM },
    { enabled: true, families: params.families ?? null, window: params.window ?? null }
  );
  return evidenceFromSource(ctx, {
    value: view,
    scope: "ADDRESS_POINT",
    unit: "unit.licences",
    sourceId: "urban_licences",
    derivation: DERIVATION.IN_CIRCLE_FILTER,
  });
}

// --- AMBITO_COMPARE ---------------------------------------------------------------
// Q: how do two ámbitos compare on a published metric? (same scope only.)
function resolveAmbitoCompare(params, deps, ctx) {
  const compare = deps.ambitoCompare;
  if (typeof compare !== "function") {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AMBITO_COMPARE, scope: "PLANNING_AMBITO",
      message: "the ámbito comparison model (#72) is not available",
    });
  }
  const { a, b } = params || {};
  if (!isObject(a) || !isObject(b)) {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape: SHAPE.AMBITO_COMPARE, message: "two comparison inputs (a, b) are required",
    });
  }
  // Cross-scope refusal: two values of different analytical scope are never
  // combined without a documented basis. Geometric overlap is not a basis.
  const scopeA = scopeOfInput(a);
  const scopeB = scopeOfInput(b);
  if (scopeA && scopeB && !REGISTRY_SCOPE_API.crossScopeArithmeticAllowed(scopeA, scopeB, params.basis)) {
    return prohibit(PROHIBITION.CROSS_SCOPE_COMBINATION, {
      shape: SHAPE.AMBITO_COMPARE,
      message: `cannot compare a ${scopeA} value with a ${scopeB} value without a documented basis`,
    });
  }
  let model;
  try {
    model = compare(a, b);
  } catch (error) {
    return abstain(ABSTENTION_REASON.CROSS_SCOPE_WITHOUT_BASIS, {
      shape: SHAPE.AMBITO_COMPARE, message: "the comparison was refused by the model",
    });
  }
  if (!model) {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AMBITO_COMPARE, scope: "PLANNING_AMBITO", message: "the comparison produced no model",
    });
  }
  return evidenceFromSource(ctx, {
    value: model,
    scope: "PLANNING_AMBITO",
    unit: "unit.ambitoCompare",
    sourceId: "planning_ambito_state",
    derivation: DERIVATION.SAME_SCOPE_COMPARISON,
  });
}

// --- AREA_PROFILE_AT_POINT --------------------------------------------------------
// Q: which official barrio contains this point, and what does its register say?
function resolveAreaProfileAtPoint(params, deps, ctx) {
  const build = deps.areaProfileFor;
  if (typeof build !== "function") {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AREA_PROFILE_AT_POINT, scope: "OFFICIAL_BARRIO",
      message: "the area-profile model is not available",
    });
  }
  const { lon, lat } = pointOf(params);
  if (lon === null || lat === null) {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape: SHAPE.AREA_PROFILE_AT_POINT, message: "a single lon/lat point is required",
    });
  }
  const profile = build({ lon, lat });
  const states = deps.areaStates || { RESOLVED: "resolved", OUTSIDE_MADRID: "outside_madrid" };
  if (!profile) {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AREA_PROFILE_AT_POINT, scope: "OFFICIAL_BARRIO",
      message: "the area-profile model returned nothing",
    });
  }
  if (profile.state === states.OUTSIDE_MADRID) {
    // The point is outside the municipality — outside this source's universe,
    // not a barrio that happens to have no data.
    return abstain(ABSTENTION_REASON.OUTSIDE_SOURCE_UNIVERSE, {
      shape: SHAPE.AREA_PROFILE_AT_POINT, scope: "OFFICIAL_BARRIO",
      message: "the point is outside the Madrid municipal geography",
    });
  }
  if (profile.state !== states.RESOLVED) {
    // Inside Madrid but no barrio resolves (district-only), or the geography is
    // still loading / unavailable: no OFFICIAL_BARRIO evidence for this point.
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AREA_PROFILE_AT_POINT, scope: "OFFICIAL_BARRIO",
      message: "no official barrio resolves at this point",
    });
  }
  return evidenceFromSource(ctx, {
    value: profile,
    scope: "OFFICIAL_BARRIO",
    unit: "unit.residents",
    sourceId: "population",
    derivation: DERIVATION.SOURCE_FACT,
  });
}

// --- CITY_HOTEL_DEMAND ------------------------------------------------------------
// Q: what is the latest published municipal hotel-demand figure?
function resolveCityHotelDemand(params, deps, ctx) {
  const model = deps.destinationModel;
  if (!model || model.state === undefined) {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.CITY_HOTEL_DEMAND, scope: "MUNICIPALITY",
      message: "the destination-context model is not available",
    });
  }
  const available = deps.destinationStateAvailable || "available";
  if (model.state !== available) {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.CITY_HOTEL_DEMAND, scope: "MUNICIPALITY",
      message: "no hotel-demand figure is available",
    });
  }
  // A caller may request a specific period; a period outside the published series
  // bounds is refused, not snapped to the nearest published month. Period keys are
  // ISO months and compare lexicographically.
  if (isNonEmptyString(params && params.period) && isObject(model.coverage)) {
    const { earliest, latest } = model.coverage;
    if (
      (typeof earliest === "string" && params.period < earliest) ||
      (typeof latest === "string" && params.period > latest)
    ) {
      return abstain(ABSTENTION_REASON.OUTSIDE_TEMPORAL_COVERAGE, {
        shape: SHAPE.CITY_HOTEL_DEMAND, scope: "MUNICIPALITY",
        message: `period "${params.period}" is outside the published series`,
      });
    }
  }
  return evidenceFromSource(ctx, {
    value: model,
    scope: "MUNICIPALITY",
    unit: "unit.hotelDemand",
    sourceId: "hotel_demand",
    derivation: DERIVATION.SOURCE_FACT,
  });
}

// ----- shared scope helpers -----
function pointOf(params) {
  if (!isObject(params)) return { lon: null, lat: null };
  const lon = Number(params.lon);
  const lat = Number(params.lat);
  return {
    lon: Number.isFinite(lon) ? lon : null,
    lat: Number.isFinite(lat) ? lat : null,
  };
}

function scopeOfInput(input) {
  if (isObject(input) && REGISTRY_SCOPE_API.isAnalyticalScope(input.scope)) return input.scope;
  return null;
}

function windowCoverage(window, extent) {
  if (!isObject(window) || !isObject(extent)) return "UNKNOWN";
  const { from, to } = window;
  const { min, max } = extent;
  if (typeof from !== "string" || typeof to !== "string") return "UNKNOWN";
  if (typeof min !== "string" || typeof max !== "string") return "UNKNOWN";
  if (to < min || from > max) return "OUTSIDE";
  return "COVERED";
}

// The closed resolver table. A shape absent here is UNREGISTERED by construction.
const RESOLVERS = Object.freeze({
  [SHAPE.AMBITO_AT_POINT]: resolveAmbitoAtPoint,
  [SHAPE.AMBITO_PHASES]: resolveAmbitoPhases,
  [SHAPE.AMBITO_BUILDABILITY]: resolveAmbitoBuildability,
  [SHAPE.AMBITOS_IN_LENS]: resolveAmbitosInLens,
  [SHAPE.AMBITO_EDITION_DIFF]: resolveAmbitoEditionDiff,
  [SHAPE.LICENCES_IN_LENS]: resolveLicencesInLens,
  [SHAPE.AMBITO_COMPARE]: resolveAmbitoCompare,
  [SHAPE.SOURCE_PROVENANCE]: resolveSourceProvenance,
  [SHAPE.AREA_PROFILE_AT_POINT]: resolveAreaProfileAtPoint,
  [SHAPE.CITY_HOTEL_DEMAND]: resolveCityHotelDemand,
});

// ================================================================= intent classifier
//
// classifyIntent(text) -> { shape, confidence } | abstain(UNREGISTERED_SHAPE).
//
// A DETERMINISTIC keyword-and-pattern matcher, and nothing else. It is the single
// seam where a language model could later sit, defined so that swapping it changes
// nothing downstream: it returns a REGISTERED SHAPE NAME and a confidence, never
// factual content, never a value, never a date, never a scope. It cannot select a
// shape outside the closed set (there is no entry for one), so it can never route
// to a prohibited operation. If a model ever occupies this seam it returns a shape
// name and nothing else, and every subsequent step stays deterministic.
//
// There is no network here, no key, no request string, no learned weights — only
// the patterns below, matched in a fixed order. The same text always yields the
// same shape.
const INTENT_PATTERNS = Object.freeze([
  // Order matters: the first matching, most specific pattern wins.
  { shape: SHAPE.SOURCE_PROVENANCE, patterns: [/\bprovenance\b/i, /\bwhat supports\b/i, /\bwhere does .* come from\b/i, /\bsource of\b/i, /\bwhen was .* updated\b/i] },
  { shape: SHAPE.AMBITO_EDITION_DIFF, patterns: [/\bedition\b/i, /\bchange(d)? between\b/i, /\bbetween editions\b/i, /\bwhat changed\b/i] },
  { shape: SHAPE.AMBITO_COMPARE, patterns: [/\bcompare\b/i, /\bcomparison\b/i, /\bversus\b/i, /\bvs\.?\b/i] },
  { shape: SHAPE.AMBITO_BUILDABILITY, patterns: [/\bbuildabilit/i, /\bedificab/i, /\bm² edificable\b/i] },
  { shape: SHAPE.AMBITO_PHASES, patterns: [/\bphase/i, /\bdevelopment state\b/i, /\bfase/i, /\bestado de desarrollo\b/i] },
  { shape: SHAPE.AMBITOS_IN_LENS, patterns: [/\bámbitos? (in|within|inside|touch)/i, /\bwhich ámbitos\b/i, /\bámbitos? (en|dentro)/i] },
  { shape: SHAPE.AMBITO_AT_POINT, patterns: [/\bwhich ámbito\b/i, /\bámbito (at|here|contains|containing)\b/i, /\bqué ámbito\b/i, /\bplanning ámbito\b/i] },
  { shape: SHAPE.LICENCES_IN_LENS, patterns: [/\blicen[cs]e/i, /\blicencias?\b/i, /\bvut\b/i] },
  { shape: SHAPE.AREA_PROFILE_AT_POINT, patterns: [/\bbarrio\b/i, /\bresidents?\b/i, /\bpopulation\b/i, /\bárea\b/i, /\bneighbourhood\b/i] },
  { shape: SHAPE.CITY_HOTEL_DEMAND, patterns: [/\bhotel demand\b/i, /\bhotel\b/i, /\boccupanc/i, /\bdemand\b/i, /\bpernoctac/i] },
]);

function classifyIntent(text) {
  if (!isNonEmptyString(text)) {
    return abstain(ABSTENTION_REASON.UNREGISTERED_SHAPE, { message: "empty question" });
  }
  for (const entry of INTENT_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        // Confidence is the fixed deterministic mark of a matched pattern. It is
        // NOT a probability from a model and is never used as content.
        return Object.freeze({ shape: entry.shape, confidence: 1 });
      }
    }
  }
  return abstain(ABSTENTION_REASON.UNREGISTERED_SHAPE, {
    message: "the question does not match any registered shape",
  });
}

// ===================================================================== the registry

// createEvidenceRegistry(deps) wires the registry JSON and the already-built
// deterministic models into a query instance. The instance exposes the closed
// shape set, `query(shape, params)` following the fixed resolution order,
// `classifyIntent`, and `sourceProvenance`. It is pure: it holds references to the
// injected objects and performs no I/O of its own.
function createEvidenceRegistry(deps = {}) {
  const registry = deps.registry;
  registrySourceMap(registry); // validate shape of the registry up front

  const ctx = {
    registry,
    sourceProvenance(sourceId, options) {
      return sourceProvenance(registry, sourceId, options || {});
    },
    scopeDefinitions: analyticalScopeDefinitions(registry),
  };

  function query(shape, params = {}) {
    // Resolution order, enforced here so no resolver can skip a step.
    // 1. shape validation.
    if (!REGISTERED_SHAPES.includes(shape) || !RESOLVERS[shape]) {
      return abstain(ABSTENTION_REASON.UNREGISTERED_SHAPE, { shape: shape ?? null, message: "unregistered question shape" });
    }
    // 2. prohibition screen (refuse a §4-prohibited intent before any lookup).
    const prohibited = screenProhibitedIntent(shape, params);
    if (prohibited) return prohibited;
    // 3. the resolver runs scope resolution, the ceiling check, the model lookup,
    //    and returns provenance with the result or abstains.
    return RESOLVERS[shape](params, deps, ctx);
  }

  return {
    shapes: REGISTERED_SHAPES,
    query,
    classifyIntent,
    sourceProvenance: ctx.sourceProvenance,
  };
}

// ======================================================================== the exports

const API = {
  // vocabularies
  DERIVATION,
  DERIVATIONS,
  SHAPE,
  REGISTERED_SHAPES,
  ABSTENTION_REASON,
  ABSTENTION_REASONS,
  PROHIBITION,
  PROHIBITIONS,
  PROHIBITION_REASON,
  // evidence object contract
  makeEvidence,
  isEvidence,
  // abstention contract
  abstain,
  isAbstention,
  prohibit,
  // provenance
  sourceProvenance,
  // classifier seam
  classifyIntent,
  // the registry
  createEvidenceRegistry,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
}
