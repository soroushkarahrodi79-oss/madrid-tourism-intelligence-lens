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
  // A barrio identity resolved by geometry and assembled with its registered
  // population/licence context. The assembled object is not one publisher row.
  AREA_PROFILE_ASSEMBLY: "AREA_PROFILE_ASSEMBLY",
  // Published hotel observations plus deterministic comparisons, shares,
  // ranges and display projections from the destination model.
  DESTINATION_CONTEXT_ASSEMBLY: "DESTINATION_CONTEXT_ASSEMBLY",
});
const DERIVATIONS = Object.freeze(Object.values(DERIVATION));

// The registry file itself, as an artifact path relative to `data/`. SOURCE_PROVENANCE
// answers ARE registry records, so this — not the data artifact a source describes —
// is the file its `applied` record must send a verifier to.
const REGISTRY_ARTIFACT = "source_registry.json";

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
  // construction: makeEvidence refuses an object with no source id, while every
  // public resolver authenticates that id through sourceProvenance.
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
// back-filled. This is the structural constructor for a factual answer: it can
// require a non-empty source identity, but it deliberately has no registry input
// and therefore cannot authenticate that identity or its dates. Public query
// authenticity is enforced by evidenceFromSource/sourceProvenance before this
// constructor is reached.
//
//   value       the resolver's own result (a number, a frozen record, a membership
//               list). It is whatever the deterministic model returned; this layer
//               does not recompute it.
//   scope       one analytical scope id from the closed enum (js/evidence-scope.js).
//   unit        the unit/copy key for the value (never blank).
//   sourceId    a non-empty source identity. Public resolvers prove that it is
//               registered before construction. For a multi-source reading this
//               is the primary source; contributors ride in `sources` on the value.
//   freshness   the five-field freshness record of the source, preserving explicit
//               nulls. Validated field-by-field; a missing field throws.
//   ceiling     the verbatim interpretation ceiling of the source (never softened).
//   derivation  SOURCE_FACT or a named transformation from DERIVATION.
//
// `applied` is the ONE optional field, and it is shape-specific (#179, Phase 0):
// the RESOLVED INPUTS that produced this value, recorded so a third party can
// re-derive the value from the committed artifact and the published model alone,
// with no application state. It is never defaulted, never inferred and never
// invented: a resolver either records what it actually used, or omits the field
// entirely. Its absence therefore means "this shape does not yet declare its
// derivation inputs", which is honest; a present-but-guessed record would not be.
// The seven fields above stay mandatory and unchanged whether `applied` is present
// or not, so a shape that does not supply it is unaffected.
//
// An `applied` record names the file(s) to re-derive from in exactly ONE of two
// ways, never both and never neither:
//
//   artifact    a single declared repository path, for a value that re-derives
//               from one committed artifact.
//   artifacts   an ORDERED list of {sourceId, artifact, reader?}, for a value
//               assembled from several. The order is the order the derivation
//               consumes them, so a verifier reproduces the assembly rather than
//               guessing it, and the list is complete: a reading that consulted a
//               file it does not list would be describing a derivation that does
//               not reproduce it.
//
// The two are mutually exclusive on purpose. A single `artifact` on a multi-source
// reading would present one input as the whole basis — the precise mistake this
// field exists to prevent — so the structure itself tells a verifier which kind of
// re-derivation it is looking at.
function makeEvidence(fields) {
  if (!isObject(fields)) {
    throw new TypeError("makeEvidence: expected an object with the seven contract fields");
  }
  const { value, scope, unit, sourceId, freshness, ceiling, derivation, applied } = fields;

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
  // Structural half of prohibition (1): a blank identity is refused here. The
  // public query path separately proves the identity exists in the registry.
  if (!isNonEmptyString(sourceId)) {
    throw new Error("makeEvidence: `sourceId` is mandatory; every factual token must carry a source identity");
  }
  const validatedFreshness = validateFreshness(freshness);
  if (!isNonEmptyString(ceiling)) {
    throw new Error("makeEvidence: `ceiling` is mandatory; an evidence object always carries its interpretation ceiling");
  }
  if (!DERIVATIONS.includes(derivation)) {
    throw new Error(`makeEvidence: derivation "${derivation}" is not SOURCE_FACT or a named transformation (${DERIVATIONS.join(", ")})`);
  }
  // An `applied` record is a map of named resolved inputs. An array is refused
  // because a positional list would make a derivation re-readable only by code
  // that already knows the order — the opposite of what the field is for.
  if (applied !== undefined && (!isObject(applied) || Array.isArray(applied))) {
    throw new TypeError("makeEvidence: `applied`, when present, must be an object of named resolved inputs");
  }
  if (applied !== undefined) validateAppliedArtifacts(applied);

  const evidence = {
    kind: "EVIDENCE",
    value,
    scope,
    unit,
    sourceId,
    freshness: validatedFreshness,
    ceiling,
    derivation,
  };
  if (applied !== undefined) evidence.applied = applied;
  return deepFreeze(evidence);
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

// An `applied` record names the file(s) to re-derive from in exactly ONE of two
// ways. Neither is defaultable: a record that names no artifact cannot be verified
// at all, and one that named both a single file and a list would leave a verifier
// to choose which is the real basis.
function validateAppliedArtifacts(applied) {
  const one = Object.prototype.hasOwnProperty.call(applied, "artifact");
  const many = Object.prototype.hasOwnProperty.call(applied, "artifacts");
  if (one && many) {
    throw new Error("makeEvidence: `applied` carries both `artifact` and `artifacts`; a reading re-derives from one committed file or from an ordered set, never both");
  }
  if (!one && !many) {
    throw new Error("makeEvidence: `applied` must carry `artifact` or `artifacts`; a record that names no committed file cannot be re-derived");
  }
  if (one) {
    if (!isNonEmptyString(applied.artifact)) {
      throw new Error("makeEvidence: `applied.artifact` must be the declared repository path of the committed file");
    }
    return;
  }
  if (!Array.isArray(applied.artifacts) || applied.artifacts.length === 0) {
    throw new Error("makeEvidence: `applied.artifacts` must be a non-empty ordered list of the contributing artifacts");
  }
  const seen = new Set();
  for (const entry of applied.artifacts) {
    if (!isObject(entry) || Array.isArray(entry)) {
      throw new Error("makeEvidence: each `applied.artifacts` entry must be an object naming its sourceId and artifact");
    }
    if (!isNonEmptyString(entry.sourceId) || !isNonEmptyString(entry.artifact)) {
      throw new Error("makeEvidence: each `applied.artifacts` entry must name both its sourceId and its declared repository path");
    }
    // A repeated source would make the order say two different things about when
    // that file was read, and no registered derivation consults one source twice.
    if (seen.has(entry.sourceId)) {
      throw new Error(`makeEvidence: \`applied.artifacts\` lists source "${entry.sourceId}" twice`);
    }
    seen.add(entry.sourceId);
  }
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
  // A freshness override exists for ONE documented reason: the K7 comparison
  // surface reports the OLDEST contributing edition's reference date in place of
  // the source's own. Only `reference_date` may be overridden, and only with the
  // registered oldest-contributor date; every other freshness field is read
  // verbatim from the registry and can never be rewritten by a caller. Any other
  // field, malformed date, or unregistered ISO date is rejected.
  let freshness = baseFreshness;
  const override = options.freshnessOverride;
  if (override != null) {
    if (!isObject(override)) {
      throw new TypeError("sourceProvenance: freshnessOverride must be an object");
    }
    const keys = Object.keys(override);
    const illegal = keys.filter((k) => k !== "reference_date");
    if (illegal.length) {
      throw new Error(`sourceProvenance: only reference_date may be overridden, not ${illegal.join(", ")}`);
    }
    if ("reference_date" in override) {
      if (!REGISTRY_SCOPE_API.isReferenceDate(override.reference_date)) {
        throw new Error("sourceProvenance: an overridden reference_date must be an ISO month, ISO date, or null");
      }
      const allowed = source.change_detection && source.change_detection.oldest_contributor_reference_date;
      const editionDates = [];
      const editionSides = source.change_detection && source.change_detection.editions;
      for (const side of Object.values(editionSides || {})) {
        for (const edition of Object.values(side || {})) {
          if (edition && edition.reference_date) editionDates.push(edition.reference_date);
        }
      }
      if (!allowed || override.reference_date !== allowed || !editionDates.includes(allowed)) {
        throw new Error("sourceProvenance: reference_date override is not a registered contributing-edition date");
      }
      freshness = { ...baseFreshness, reference_date: override.reference_date };
    }
  }
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

function evidenceFromSource(ctx, { value, scope, unit, sourceId, derivation, freshnessOverride, appliedInputs, appliedArtifacts }) {
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
  // The `applied` record is composed HERE, never in the resolver, so its two
  // non-negotiable members cannot drift from the evidence they describe:
  // `derivation` is the very name that goes on the evidence object, and
  // `artifact` is the registry's OWN declared path for the source — a resolver
  // cannot name a different file than the one its source declares. A resolver
  // supplies only the inputs it actually used.
  //
  // `artifact` is a declared REPOSITORY PATH relative to `data/`, not a byte
  // fingerprint: it says which file to re-derive from, never that the file is
  // unchanged. Artifact identity by checksum is Phase 1 work (#179), and
  // `urban_licences` carries no `sha256` in data/source_registry.json today.
  //
  // A reading ASSEMBLED from several registered sources passes `appliedArtifacts`
  // instead: an ordered list of the contributing sources, in the order the
  // derivation consumed them. Each one's path is resolved THROUGH the registry
  // here, exactly as the single-artifact case is, so a resolver can no more name
  // a file for a contributor than it can for its own source.
  let applied;
  if (appliedInputs !== undefined) {
    if (!isObject(appliedInputs) || Array.isArray(appliedInputs)) {
      throw new TypeError("evidenceFromSource: `appliedInputs`, when present, must be an object of named resolved inputs");
    }
    if (appliedArtifacts === undefined) {
      applied = { ...appliedInputs, derivation, artifact: prov.artifact };
    } else {
      if (!Array.isArray(appliedArtifacts) || appliedArtifacts.length === 0) {
        throw new TypeError("evidenceFromSource: `appliedArtifacts`, when present, must be a non-empty ordered list of contributing sources");
      }
      const artifacts = [];
      for (const entry of appliedArtifacts) {
        const contributorId = isObject(entry) ? entry.sourceId : entry;
        const contributor = ctx.sourceProvenance(contributorId);
        if (!contributor) {
          return abstain(ABSTENTION_REASON.OUTSIDE_SOURCE_UNIVERSE, {
            scope,
            message: `contributing source "${contributorId}" is not in the registry`,
          });
        }
        artifacts.push({
          sourceId: contributor.id,
          artifact: contributor.artifact,
          ...(isObject(entry) && isNonEmptyString(entry.reader) ? { reader: entry.reader } : {}),
        });
      }
      // The reading's own declared source must be among the files it lists. A
      // record that left it out would describe an assembly that does not include
      // the basis the evidence object itself claims.
      if (!artifacts.some((item) => item.sourceId === sourceId)) {
        throw new Error(`evidenceFromSource: \`appliedArtifacts\` does not include the reading's own source "${sourceId}"`);
      }
      applied = { ...appliedInputs, derivation, artifacts };
    }
  }

  return makeEvidence({
    value,
    scope,
    unit,
    sourceId,
    freshness: prov.freshness,
    ceiling: prov.interpretationCeiling,
    derivation,
    ...(applied !== undefined ? { applied } : {}),
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
    // Composed here rather than by evidenceFromSource, and deliberately NOT
    // `prov.artifact`: the value of this shape is the registry record itself, so the
    // file to re-derive from is the REGISTRY, not the data artifact the source
    // describes. Naming `prov.artifact` here would send a verifier to a file that
    // does not contain this answer.
    applied: deepFreeze({
      sourceId,
      derivation: DERIVATION.REGISTRY_LOOKUP,
      artifact: REGISTRY_ARTIFACT,
      reader: "sourceProvenance",
    }),
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
  const hintCode = params.hintCode ?? null;
  const containing = index.ambitoContaining(lon, lat, hintCode);
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
    // `hintCode` is recorded even though it is only a short-circuit, because it can
    // change WHICH polygon answers where polygons overlap: a re-derivation that
    // dropped it would not be re-running the same containment test. `reader` names
    // the exported pure function that re-derives this, so the record says not only
    // which inputs but which published operation consumed them.
    appliedInputs: { centre: { lon, lat }, hintCode, reader: "ambitoContaining" },
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
      // `method` is the name of BOTH the index reader used here and the exported
      // pure reader `developmentState(code, artifact)` / `availableBuildability(code,
      // artifact)`, so a third party re-derives this from the state artifact alone,
      // without building an index. AMBITO_PHASES and AMBITO_BUILDABILITY share this
      // resolver and differ only in that reader, so it must be in the record.
      appliedInputs: { code, reader: method },
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
    appliedInputs: { centre: { lon, lat }, radiusM, reader: "ambitosIntersecting" },
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
  // The edition classifier (#69) returns a comparison for ANY string, including a
  // code in neither edition (every family CAUSE_UNRESOLVED). That is not evidence.
  // Require the code to be a real ámbito in the published universe first, so a
  // bogus code is OUTSIDE_SOURCE_UNIVERSE rather than a fabricated "diff".
  const codeKnown = deps.ambitoEditionCodeKnown;
  if (typeof codeKnown !== "function") {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AMBITO_EDITION_DIFF, scope: "PLANNING_AMBITO",
      message: "the authoritative two-edition code universe is not available",
    });
  }
  if (!codeKnown(code)) {
    return abstain(ABSTENTION_REASON.OUTSIDE_SOURCE_UNIVERSE, {
      shape: SHAPE.AMBITO_EDITION_DIFF, scope: "PLANNING_AMBITO",
      message: `ámbito code "${code}" is not in the published universe`,
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
  if (!comparison || !comparison.state) {
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
    // ONE artifact, not several: both editions of this diff live in the same
    // committed state file, under `change_detection.previous` and `.current`.
    // The two reference dates are read back off the model's OWN result, so the
    // record names the editions actually compared rather than the pair the
    // caller's deps happened to be wired with.
    appliedInputs: {
      code,
      editions: { previous: comparison.dates.previous, current: comparison.dates.current },
      reader: "buildAmbitoComparison",
    },
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
  // A window that is present but is not a pair of real ISO calendar dates is not a
  // scope this shape can resolve. Left to the model it would be read as "no
  // bound" and silently widened to the whole register (M2 finding F1), so it is
  // refused here instead. An ABSENT window is unchanged: the model's documented
  // default is applied and disclosed on the result's `window`.
  if (params.window != null && !isIsoWindow(params.window)) {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape: SHAPE.LICENCES_IN_LENS, scope: "ADDRESS_POINT",
      message: "the grant-date window must carry `from` and `to` as ISO calendar dates (YYYY-MM-DD)",
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
    // THE EFFECTIVE INPUTS, read back off the model's OWN result — never the
    // requested ones. The model clamps a requested grant-date window to the
    // register extent, substitutes its documented default window when none was
    // requested, and resolves an absent family filter to the full family set.
    // Recording the request instead would describe a derivation that does not
    // reproduce this value, which is precisely the failure this field exists to
    // prevent. `families` is therefore the resolved list the model reports, not
    // the caller's `null`: a named list re-derives unambiguously, a `null` only
    // re-derives for a reader who already knows the model's default.
    appliedInputs: {
      centre: { lon, lat },
      radiusM,
      families: [...view.familiesShown],
      window: { from: view.window.from, to: view.window.to, clamped: view.window.clamped },
    },
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
  // Scope resolution BEFORE the model runs, and the scientific scope rule is not
  // negotiable by a caller. Each input must declare a valid analytical scope, both
  // must be the same scope, and for this registered shape both must be
  // PLANNING_AMBITO. A free-text `basis` can NEVER license a cross-scope
  // comparison here — the registered shape forbids it outright, and geometric
  // overlap is not a basis.
  const scopeA = scopeOfInput(a);
  const scopeB = scopeOfInput(b);
  if (!scopeA || !scopeB) {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape: SHAPE.AMBITO_COMPARE,
      message: "each comparison input must declare a valid analytical scope",
    });
  }
  if (scopeA !== scopeB) {
    return prohibit(PROHIBITION.CROSS_SCOPE_COMBINATION, {
      shape: SHAPE.AMBITO_COMPARE,
      message: `cannot compare a ${scopeA} value with a ${scopeB} value`,
    });
  }
  if (scopeA !== "PLANNING_AMBITO") {
    return abstain(ABSTENTION_REASON.AMBIGUOUS_SCOPE, {
      shape: SHAPE.AMBITO_COMPARE, scope: scopeA,
      message: `AMBITO_COMPARE compares PLANNING_AMBITO objects only; got ${scopeA}`,
    });
  }
  const canonicalInputFor = deps.ambitoComparisonInputFor;
  if (typeof canonicalInputFor !== "function") {
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.AMBITO_COMPARE, scope: "PLANNING_AMBITO",
      message: "the canonical ámbito comparison adapter is not available",
    });
  }
  const resolveSide = (side) => {
    const allowed = new Set(["scope", "code", "ambitoCode", "edition"]);
    if (Object.keys(side).some((key) => !allowed.has(key))) {
      return { error: ABSTENTION_REASON.AMBIGUOUS_SCOPE, code: null };
    }
    if (isNonEmptyString(side.code) && isNonEmptyString(side.ambitoCode) && side.code !== side.ambitoCode) {
      return { error: ABSTENTION_REASON.AMBIGUOUS_SCOPE, code: null };
    }
    const code = side.code ?? side.ambitoCode;
    if (!isNonEmptyString(code)) return { error: ABSTENTION_REASON.AMBIGUOUS_SCOPE, code: null };
    if (side.edition != null && (!isObject(side.edition) || Array.isArray(side.edition))) {
      return { error: ABSTENTION_REASON.AMBIGUOUS_SCOPE, code };
    }
    const canonical = canonicalInputFor(code, side.edition ?? null);
    if (!canonical) {
      return { error: side.edition == null ? ABSTENTION_REASON.OUTSIDE_SOURCE_UNIVERSE : ABSTENTION_REASON.OUTSIDE_TEMPORAL_COVERAGE, code };
    }
    return { canonical, code };
  };
  const resolvedA = resolveSide(a);
  const resolvedB = resolveSide(b);
  const failed = resolvedA.error ? resolvedA : (resolvedB.error ? resolvedB : null);
  if (failed) {
    return abstain(failed.error, {
      shape: SHAPE.AMBITO_COMPARE, scope: "PLANNING_AMBITO",
      message: failed.error === ABSTENTION_REASON.OUTSIDE_TEMPORAL_COVERAGE
        ? `the requested committed edition is unavailable for "${failed.code}"`
        : failed.code ? `ámbito code "${failed.code}" is not in the canonical comparison evidence` : "each side requires an exact official ámbito code",
    });
  }
  let model;
  try {
    model = compare(resolvedA.canonical, resolvedB.canonical);
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
    // TWO artifacts, in consumption order: the canonical comparison input of each
    // side is resolved through an index built from the geometry, then read against
    // the committed state editions.
    //
    // The per-side edition identities come off the model's OWN `editionBasis`, so
    // the record says which edition each side was actually read at — the thing
    // that decides whether the two sides are like-for-like. A caller may request
    // no edition at all and still get a specific one, so recording the request
    // would describe a comparison that does not reproduce. When the model refused
    // the pair it establishes no basis, and the record says null rather than
    // reaching into an absent one.
    appliedInputs: {
      a: { code: resolvedA.code, editions: sideEditionIdentities(model, "a") },
      b: { code: resolvedB.code, editions: sideEditionIdentities(model, "b") },
      reader: "buildAmbitoComparisonModel",
    },
    appliedArtifacts: [
      { sourceId: "planning_ambito_geometry", reader: "createPlanningIndex" },
      { sourceId: "planning_ambito_state", reader: "createCanonicalAmbitoComparisonInputResolver" },
    ],
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
  const contributingSourceIds = ["geography", "population"];
  if (profile.vut && profile.vut.state === "available") contributingSourceIds.push("vut_licences");
  for (const sourceId of contributingSourceIds) {
    if (!ctx.sourceProvenance(sourceId)) {
      return abstain(ABSTENTION_REASON.OUTSIDE_SOURCE_UNIVERSE, {
        shape: SHAPE.AREA_PROFILE_AT_POINT, scope: "OFFICIAL_BARRIO",
        message: `area-profile contributor "${sourceId}" is not in the registry`,
      });
    }
  }
  return evidenceFromSource(ctx, {
    value: { ...profile, sources: contributingSourceIds },
    scope: "OFFICIAL_BARRIO",
    unit: "unit.residents",
    sourceId: "population",
    derivation: DERIVATION.AREA_PROFILE_ASSEMBLY,
    // TWO artifacts, or three when the VUT register resolved. `barrioId` is the
    // join key the population lookup actually used, read off the profile the
    // model returned: the point only locates the barrio, and it is the barrio
    // code that selects the figure.
    appliedInputs: {
      centre: { lon, lat },
      barrioId: profile.barrioId ?? null,
      reader: "buildAreaProfile",
    },
    // The SAME list that goes on `value.sources`, in the order the assembly
    // consumes them — locate the point in the geography, then read the register(s)
    // for the barrio it resolved. Deriving both from one list is deliberate: a
    // record that could disagree with the value's own declared contributors would
    // be worse than no record.
    appliedArtifacts: contributingSourceIds.map((id) => ({
      sourceId: id,
      reader: AREA_PROFILE_READERS[id],
    })),
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
  // This shape serves the LATEST published municipal figure — the one the
  // destination model was built for. Its period is model.period.key. When a caller
  // pins a specific period we must never return a DIFFERENT month's figures under
  // that label:
  //   * outside the published series bounds → OUTSIDE_TEMPORAL_COVERAGE (not a
  //     nearest match);
  //   * in coverage but not the served (latest) period → the model holds no
  //     evidence object for that earlier month, so abstain rather than silently
  //     returning the latest month's figures.
  const servedPeriod = model.period && model.period.key;
  if (isNonEmptyString(params && params.period) && params.period !== servedPeriod) {
    if (isObject(model.coverage)) {
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
    return abstain(ABSTENTION_REASON.NO_EVIDENCE_FOR_SCOPE, {
      shape: SHAPE.CITY_HOTEL_DEMAND, scope: "MUNICIPALITY",
      message: `this shape serves the latest published period (${servedPeriod ?? "unknown"}); "${params.period}" is not resolvable here`,
    });
  }
  return evidenceFromSource(ctx, {
    value: model,
    scope: "MUNICIPALITY",
    unit: "unit.hotelDemand",
    sourceId: "hotel_demand",
    derivation: DERIVATION.DESTINATION_CONTEXT_ASSEMBLY,
    // ONE artifact: the published municipal series. The period recorded is the
    // SERVED one the model was built for, never `params.period` — a caller may
    // pass the served period or nothing at all, and both re-derive the same way.
    appliedInputs: {
      period: servedPeriod ?? null,
      reader: "buildDestinationContext",
    },
  });
}

// ----- applied-record helpers -----

// The exported pure reader that turns each area-profile contributor's committed
// artifact into the index the assembly consumes. Naming them keeps `applied` a
// re-derivation recipe rather than a list of filenames.
const AREA_PROFILE_READERS = Object.freeze({
  geography: "createGeographyIndex",
  population: "createPopulationIndex",
  vut_licences: "createVutIndex",
});

// The edition identity each comparison side was actually read at, per source
// family, taken off the model's own basis. Null when the model established no
// basis at all — it refused the pair — because an identity is then not a fact
// about this reading.
function sideEditionIdentities(model, side) {
  const basis = model && model.editionBasis;
  if (!isObject(basis)) return null;
  return {
    development_state: isObject(basis.development_state) ? basis.development_state[side] : null,
    available_buildability: isObject(basis.available_buildability) ? basis.available_buildability[side] : null,
  };
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

function isCalendarDate(value) {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}

function isIsoWindow(window) {
  return isObject(window) && isCalendarDate(window.from) && isCalendarDate(window.to);
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
