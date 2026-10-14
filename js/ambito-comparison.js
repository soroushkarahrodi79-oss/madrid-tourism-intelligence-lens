// Canonical PLANNING_AMBITO comparison — the pure model (K10, #72).
//
// TWO OFFICIAL PLANNING ÁMBITOS, READ SIDE BY SIDE. This module is the single
// authoritative comparison state for ámbito-scope COMPARE. Every surface — the
// Comparison Bridge, Decision Insight, the comparison table and the sensitivity
// panel — reads THIS object; none recomputes a value of its own. That is the
// "one interpretation invariant" the circle-scope stack already enforces, raised
// to the planning scope.
//
// It reuses the discipline of the circle comparison surfaces without reusing
// their arithmetic:
//
//   1. **Categorical never becomes ordinal.** The four published development
//      phases are a vocabulary, not a scale. A phase comparison reports the two
//      verbatim states and whether they are the SAME or DIFFERENT — never a
//      numeric difference, never a direction, never an implied ordering of the
//      five values. `No Necesita` against `Sin Iniciar` is DIFFERENT, not
//      "behind". A categorical metric object carries no delta key of any kind,
//      by construction, and a test enumerates every categorical object to prove
//      it.
//   2. **Quantities use their published unit.** Available buildability and the
//      ámbito surface are compared in m², as a B − A difference that is
//      arithmetic direction ONLY — it never means B is "better". No quantity is
//      ever inferred from polygon overlap or geometry area.
//   3. **0 / unavailable / withheld stay distinct.** A published `0` is a real
//      value that participates in a difference; a blank cell is NOT_PUBLISHED and
//      never becomes `0`; a comparison that is not like-for-like is WITHHELD with
//      its reason, exactly as the mobility delta is withheld under unequal
//      windows today.
//   4. **Cross-scope is refused, never coerced.** An ámbito compared against a
//      Lens circle is refused with a stated reason through the same
//      `crossScopeArithmeticAllowed` mechanism (#64); no code path approximates
//      it.
//   5. **Different editions are withheld by default.** Two ámbitos read from
//      different official editions are not like-for-like; every metric is
//      withheld CROSS_EDITION unless an explicit documented basis is supplied.
//      A MODIFIED_BY_INSTRUMENT pair is withheld, never compared.
//
// Radius sensitivity does not apply here: an ámbito's geometry is fixed and
// official and the reader cannot change it. The model states that
// non-applicability explicitly rather than hiding it or retaining a stale
// Lens baseline. Edition sensitivity replaces it: does the A ↔ B relationship
// hold under the previous official edition? — the varied parameter is the
// edition, not the radius.
//
// Everything is pure: committed-artifact-derived evidence in, frozen view models
// out. No DOM, no Leaflet, no fetch, no clock, no application state. The browser
// wiring in js/app.js renders what this file returns.

// --------------------------------------------------- cross-scope mechanism (#64)
//
// crossScopeArithmeticAllowed lives in js/evidence-scope.js. In the browser it is
// a top-level binding of that earlier classic script; in Node it is required.
// Resolved defensively so this module loads in both environments, and so a bare
// same-scope fallback still refuses a cross-scope pair if the shared helper is
// somehow unavailable.
const __ambitoScopeDeps = (function resolveScopeDeps() {
  if (typeof module !== "undefined" && module.exports) {
    try {
      return require("./evidence-scope.js");
    } catch (_err) {
      /* fall through to the inline rule */
    }
  }
  if (typeof crossScopeArithmeticAllowed === "function") {
    return { crossScopeArithmeticAllowed };
  }
  return null;
})();

function scopesComparable(scopeA, scopeB) {
  if (__ambitoScopeDeps && typeof __ambitoScopeDeps.crossScopeArithmeticAllowed === "function") {
    // No documented basis is ever supplied for an ámbito↔circle pair: geometric
    // overlap is explicitly not a basis, so a different scope is always refused.
    return __ambitoScopeDeps.crossScopeArithmeticAllowed(scopeA, scopeB) === true;
  }
  return scopeA === scopeB;
}

// ------------------------------------------------------------------ vocabularies

const PLANNING_AMBITO_SCOPE = "PLANNING_AMBITO";

// The nine canonical metrics, in FIXED canonical order. The order is the
// publisher's reading order (four phases, then buildability by use class, then
// surface) and carries NO rank: it is never sorted by magnitude, never reordered
// by availability, and the four phases never form a composite. A test permutes
// the input and asserts the output order is unchanged.
const AMBITO_METRIC_IDS = Object.freeze([
  "phase_planeamiento",
  "phase_gestion",
  "phase_urbanizacion_proyecto",
  "phase_urbanizacion_obras",
  "buildability_residential_collective",
  "buildability_residential_single_family",
  "buildability_tertiary",
  "buildability_industrial",
  "ambito_surface",
]);

const METRIC_KIND = Object.freeze({ CATEGORICAL: "CATEGORICAL", QUANTITY: "QUANTITY" });

// The comparison basis per metric. Categorical phases compare by STATE_EQUALITY
// (same / different), quantities by an M2 difference. A basis is data so the
// sensitivity layer can check "did the basis change?" before any direction claim.
const COMPARISON_BASIS = Object.freeze({ STATE_EQUALITY: "STATE_EQUALITY", M2: "M2" });

// A categorical pair is SAME, DIFFERENT, or INDETERMINATE when a side carries no
// published state to compare. INDETERMINATE is never rendered as SAME.
const CATEGORICAL_RELATION = Object.freeze({
  SAME: "SAME",
  DIFFERENT: "DIFFERENT",
  INDETERMINATE: "INDETERMINATE",
});

// Why a quantity difference is withheld. Each is a first-class published state,
// never silently coerced into 0 or into a computed delta.
const WITHHELD_REASON = Object.freeze({
  CROSS_EDITION: "CROSS_EDITION",
  MODIFIED_BY_INSTRUMENT: "MODIFIED_BY_INSTRUMENT",
  MULTIPLE_ROWS_NOT_COMBINED: "MULTIPLE_ROWS_NOT_COMBINED",
  VALUE_NOT_PUBLISHED: "VALUE_NOT_PUBLISHED",
});

// The per-side value state for a quantity metric.
const QUANTITY_SIDE_STATE = Object.freeze({
  PUBLISHED: "PUBLISHED",
  NOT_PUBLISHED: "NOT_PUBLISHED",
  NOT_PUBLISHED_IN_EDITION: "NOT_PUBLISHED_IN_EDITION",
  MULTIPLE_ROWS_NOT_COMBINED: "MULTIPLE_ROWS_NOT_COMBINED",
});

// A hard refusal of the whole comparison — not a withholding of one metric.
const REFUSAL = Object.freeze({ CROSS_SCOPE: "CROSS_SCOPE" });

// The categorical relation is computed on a cosmetic-insensitive key (case,
// accents and run-of-spaces), mirroring K7's cosmeticComparisonKey, so that
// `En  Tramitación` and `En Tramitación` read SAME while the verbatim strings
// are preserved for display. Substantive differences (`No Necesita` vs
// `Sin Iniciar`) remain DIFFERENT.
function phaseComparisonKey(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// The use-class field behind each quantity buildability metric. Surface is read
// from the development-state record, not from buildability.
const BUILDABILITY_METRIC_FIELD = Object.freeze({
  buildability_residential_collective: "colectiva_residencial",
  buildability_residential_single_family: "unifamiliar_residencial",
  buildability_tertiary: "terciario",
  buildability_industrial: "industrial",
});

const PHASE_METRIC_FIELD = Object.freeze({
  phase_planeamiento: "planeamiento",
  phase_gestion: "gestion",
  phase_urbanizacion_proyecto: "urbanizacion_proyecto",
  phase_urbanizacion_obras: "urbanizacion_obras",
});

const BUILDABILITY_UNIT = "m² edificable";
const SURFACE_UNIT = "m²";

// ----------------------------------------------------------------- freeze helper

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// --------------------------------------------------------- side evidence readers
//
// An "ámbito comparison input" is the frozen evidence the app assembles from the
// js/planning-ambito.js readers for one ámbito, at one edition:
//
//   {
//     scope: "PLANNING_AMBITO",
//     ambitoCode, denomination,
//     developmentState,          // output of developmentState(code, artifact)
//     availableBuildability,     // output of availableBuildability(code, artifact)
//     modifiedByInstrument,      // optional: a documented instrument barrier (K7)
//   }
//
// The two edition identities and reference dates are read from the readers' own
// `edition` records, so a cross-edition pair is detected from evidence, not from
// a flag the caller sets by hand.

function sideScope(input) {
  if (input && typeof input === "object" && typeof input.scope === "string") return input.scope;
  // A missing scope is treated as unknown, never defaulted to PLANNING_AMBITO.
  return null;
}

function editionIdentityOf(input, which) {
  const reader = which === "development_state" ? input.developmentState : input.availableBuildability;
  const edition = reader && reader.edition;
  return edition && typeof edition.snapshotIdentity === "string" ? edition.snapshotIdentity : null;
}

function referenceDateOf(input, which) {
  const reader = which === "development_state" ? input.developmentState : input.availableBuildability;
  const edition = reader && reader.edition;
  return edition && edition.referenceDate != null ? edition.referenceDate : null;
}

// The single published numeric row for a code, or null when the code publishes
// none or more than one row. More than one published row is deliberately NOT
// combined (never summed, averaged or reconciled): the sources state no single
// figure, so a quantity comparison across such a code is withheld.
function singlePublishedRow(reader) {
  if (!reader || reader.availability !== "PUBLISHED") return { state: "NOT_PUBLISHED_IN_EDITION", row: null };
  const rows = Array.isArray(reader.rows) ? reader.rows : [];
  if (rows.length === 0) return { state: "NOT_PUBLISHED_IN_EDITION", row: null };
  if (rows.length > 1) return { state: "MULTIPLE_ROWS_NOT_COMBINED", row: null };
  return { state: "SINGLE", row: rows[0] };
}

function useClassCell(row, field) {
  const cell = row && row.useClasses ? row.useClasses.find((c) => c.key === field) : null;
  return cell || null;
}

// A quantity side: its published-value state and the value (only in PUBLISHED).
function quantitySide(input, metricId) {
  if (metricId === "ambito_surface") {
    const dev = input.developmentState;
    if (!dev || dev.availability !== "PUBLISHED") return { state: QUANTITY_SIDE_STATE.NOT_PUBLISHED_IN_EDITION, value: null };
    const surface = dev.surface;
    if (!surface || surface.state !== "PUBLISHED") return { state: QUANTITY_SIDE_STATE.NOT_PUBLISHED, value: null };
    return { state: QUANTITY_SIDE_STATE.PUBLISHED, value: surface.value };
  }
  const field = BUILDABILITY_METRIC_FIELD[metricId];
  const { state, row } = singlePublishedRow(input.availableBuildability);
  if (state === "NOT_PUBLISHED_IN_EDITION") return { state: QUANTITY_SIDE_STATE.NOT_PUBLISHED_IN_EDITION, value: null };
  if (state === "MULTIPLE_ROWS_NOT_COMBINED") return { state: QUANTITY_SIDE_STATE.MULTIPLE_ROWS_NOT_COMBINED, value: null };
  const cell = useClassCell(row, field);
  if (!cell || cell.state !== "PUBLISHED") return { state: QUANTITY_SIDE_STATE.NOT_PUBLISHED, value: null };
  return { state: QUANTITY_SIDE_STATE.PUBLISHED, value: cell.value };
}

// A categorical side: its published verbatim value and presentation metadata.
function categoricalSide(input, field) {
  const dev = input.developmentState;
  if (!dev || dev.availability !== "PUBLISHED" || !Array.isArray(dev.phases)) {
    return { state: "NOT_PUBLISHED_IN_EDITION", sourceValue: null, kind: null, vocabulary: null };
  }
  const phase = dev.phases.find((p) => p.key === field);
  if (!phase || phase.state !== "PUBLISHED" || phase.sourceValue == null) {
    return { state: "NOT_PUBLISHED", sourceValue: null, kind: phase ? phase.kind : null, vocabulary: phase ? phase.vocabulary : null };
  }
  return {
    state: "PUBLISHED",
    sourceValue: phase.sourceValue,
    kind: phase.kind ?? null,
    vocabulary: phase.vocabulary ?? null,
  };
}

// ----------------------------------------------------------------- metric builders

function buildCategoricalMetric(metricId, a, b) {
  const field = PHASE_METRIC_FIELD[metricId];
  const aSide = categoricalSide(a, field);
  const bSide = categoricalSide(b, field);
  let relation;
  if (aSide.state !== "PUBLISHED" || bSide.state !== "PUBLISHED") {
    relation = CATEGORICAL_RELATION.INDETERMINATE;
  } else {
    relation = phaseComparisonKey(aSide.sourceValue) === phaseComparisonKey(bSide.sourceValue)
      ? CATEGORICAL_RELATION.SAME
      : CATEGORICAL_RELATION.DIFFERENT;
  }
  // A categorical metric carries NO delta, NO deltaValue, NO direction and NO
  // numeric field of any kind. This absence is the contract.
  return {
    id: metricId,
    kind: METRIC_KIND.CATEGORICAL,
    field,
    basis: COMPARISON_BASIS.STATE_EQUALITY,
    unit: null,
    a: aSide,
    b: bSide,
    relation,
  };
}

function buildQuantityMetric(metricId, a, b, editionBasis, instrumentBarrier) {
  const unit = metricId === "ambito_surface" ? SURFACE_UNIT : BUILDABILITY_UNIT;
  const editionKey = metricId === "ambito_surface" ? "development_state" : "available_buildability";
  const aSide = quantitySide(a, metricId);
  const bSide = quantitySide(b, metricId);

  const base = {
    id: metricId,
    kind: METRIC_KIND.QUANTITY,
    field: metricId === "ambito_surface" ? "surface" : BUILDABILITY_METRIC_FIELD[metricId],
    basis: COMPARISON_BASIS.M2,
    unit,
    a: aSide,
    b: bSide,
  };

  const withheld = (reasonCode) =>
    Object.assign(base, { comparable: false, deltaValue: null, deltaKind: null, withheldReasonCode: reasonCode });

  // A modification barrier (a documented instrument event between the compared
  // editions) forces withheld before any value is read: a MODIFIED_BY_INSTRUMENT
  // pair is not like-for-like.
  if (instrumentBarrier) return withheld(WITHHELD_REASON.MODIFIED_BY_INSTRUMENT);

  // Cross-edition: not like-for-like, withheld by default.
  if (!editionBasis.like_for_like[editionKey]) return withheld(WITHHELD_REASON.CROSS_EDITION);

  if (aSide.state === QUANTITY_SIDE_STATE.MULTIPLE_ROWS_NOT_COMBINED || bSide.state === QUANTITY_SIDE_STATE.MULTIPLE_ROWS_NOT_COMBINED) {
    return withheld(WITHHELD_REASON.MULTIPLE_ROWS_NOT_COMBINED);
  }
  if (aSide.state !== QUANTITY_SIDE_STATE.PUBLISHED || bSide.state !== QUANTITY_SIDE_STATE.PUBLISHED) {
    return withheld(WITHHELD_REASON.VALUE_NOT_PUBLISHED);
  }
  // Both PUBLISHED, like-for-like, no barrier: a real B − A difference in m².
  // A published 0 participates; the difference is arithmetic direction only.
  return Object.assign(base, {
    comparable: true,
    deltaValue: bSide.value - aSide.value,
    deltaKind: "M2_DIFFERENCE",
    withheldReasonCode: null,
  });
}

function sideSummary(input) {
  return {
    scope: sideScope(input),
    ambitoCode: input.ambitoCode ?? null,
    denomination: input.denomination ?? null,
    edition: {
      developmentState: {
        snapshotIdentity: editionIdentityOf(input, "development_state"),
        referenceDate: referenceDateOf(input, "development_state"),
      },
      availableBuildability: {
        snapshotIdentity: editionIdentityOf(input, "available_buildability"),
        referenceDate: referenceDateOf(input, "available_buildability"),
      },
    },
  };
}

/**
 * The authoritative PLANNING_AMBITO comparison for two selected ámbitos.
 *
 * `a` and `b` are ámbito comparison inputs (see the reader notes above). Returns
 * a frozen object that every comparison surface reads:
 *
 *   - `comparable: false` with a `refusal` ONLY when the two objects are of
 *     different analytical scope (ámbito vs Lens circle) — a hard refusal, never
 *     a withholding, with no fallback path.
 *   - otherwise `metrics`: the nine canonical metrics, in fixed order, each
 *     carrying its own kind, basis and unit. Categorical metrics carry a
 *     same/different relation and NO delta; quantity metrics carry a B − A
 *     difference when like-for-like, or a withheld reason.
 *
 * `options.documentedEditionBasis` (a non-empty string) permits a cross-edition
 * comparison; absent, a cross-edition pair withholds every metric CROSS_EDITION.
 */
function buildAmbitoComparisonModel(a, b, options = {}) {
  const scopeA = sideScope(a);
  const scopeB = sideScope(b);

  // Cross-scope refusal (#64). Both sides must be PLANNING_AMBITO. An ámbito vs a
  // Lens circle (or any other scope) is refused with a stated reason — never
  // approximated, never silently coerced.
  if (scopeA !== PLANNING_AMBITO_SCOPE || scopeB !== PLANNING_AMBITO_SCOPE || !scopesComparable(scopeA, scopeB)) {
    return deepFreeze({
      scope: PLANNING_AMBITO_SCOPE,
      comparable: false,
      refusal: {
        code: REFUSAL.CROSS_SCOPE,
        scopeA,
        scopeB,
        reasonCode: "cross-scope",
      },
      a: sideSummary(a || {}),
      b: sideSummary(b || {}),
      metrics: [],
      crossScopeArithmeticAllowed: false,
      interpretation: { oneAuthoritativeState: true },
    });
  }

  const documented =
    typeof options.documentedEditionBasis === "string" && options.documentedEditionBasis.trim().length > 0;

  const devSame = editionIdentityOf(a, "development_state") === editionIdentityOf(b, "development_state");
  const buildSame = editionIdentityOf(a, "available_buildability") === editionIdentityOf(b, "available_buildability");
  const editionBasis = {
    like_for_like: {
      development_state: devSame || documented,
      available_buildability: buildSame || documented,
    },
    development_state: { a: editionIdentityOf(a, "development_state"), b: editionIdentityOf(b, "development_state"), same: devSame },
    available_buildability: {
      a: editionIdentityOf(a, "available_buildability"),
      b: editionIdentityOf(b, "available_buildability"),
      same: buildSame,
    },
    documentedBasis: documented ? options.documentedEditionBasis.trim() : null,
  };

  const aBarrier = Boolean(a.modifiedByInstrument);
  const bBarrier = Boolean(b.modifiedByInstrument);
  const instrumentBarrier = aBarrier || bBarrier;

  const metrics = AMBITO_METRIC_IDS.map((metricId) => {
    if (metricId.startsWith("phase_")) {
      const metric = buildCategoricalMetric(metricId, a, b);
      // When the two phases come from different editions, a same/different
      // reading is not like-for-like: mark it INDETERMINATE with the reason,
      // rather than asserting equality across editions.
      if (!editionBasis.like_for_like.development_state) {
        metric.relation = CATEGORICAL_RELATION.INDETERMINATE;
        metric.indeterminateReasonCode = WITHHELD_REASON.CROSS_EDITION;
      } else if (instrumentBarrier) {
        metric.relation = CATEGORICAL_RELATION.INDETERMINATE;
        metric.indeterminateReasonCode = WITHHELD_REASON.MODIFIED_BY_INSTRUMENT;
      }
      return metric;
    }
    return buildQuantityMetric(metricId, a, b, editionBasis, instrumentBarrier);
  });

  return deepFreeze({
    scope: PLANNING_AMBITO_SCOPE,
    comparable: true,
    refusal: null,
    a: sideSummary(a),
    b: sideSummary(b),
    editionBasis,
    metrics,
    crossScopeArithmeticAllowed: true,
    interpretation: {
      oneAuthoritativeState: true,
      bSubtractASemantics: "arithmetic direction only; never 'better'",
    },
  });
}

// ======================================================= one-state projections
//
// Each projection READS the single authoritative model. None recomputes a
// relation or a delta: a test asserts the projected value is identical to the
// model's own.

function findMetric(model, metricId) {
  return model && Array.isArray(model.metrics) ? model.metrics.find((m) => m.id === metricId) || null : null;
}

// The focused Bridge reading for one metric: both ámbito identities, both edition
// reference dates and the metric's two values with its relation/delta/withheld.
function ambitoBridgeReading(model, metricId) {
  if (!model || model.comparable === false) {
    return deepFreeze({ available: false, refusal: model ? model.refusal : null });
  }
  const metric = findMetric(model, metricId);
  if (!metric) return deepFreeze({ available: false, refusal: null });
  const editionKey = metric.kind === METRIC_KIND.CATEGORICAL || metricId === "ambito_surface"
    ? "developmentState"
    : "availableBuildability";
  return deepFreeze({
    available: true,
    metricId,
    kind: metric.kind,
    basis: metric.basis,
    unit: metric.unit,
    a: { ambitoCode: model.a.ambitoCode, denomination: model.a.denomination, referenceDate: model.a.edition[editionKey].referenceDate, value: metric.a },
    b: { ambitoCode: model.b.ambitoCode, denomination: model.b.denomination, referenceDate: model.b.edition[editionKey].referenceDate, value: metric.b },
    relation: metric.kind === METRIC_KIND.CATEGORICAL ? metric.relation : null,
    deltaValue: metric.kind === METRIC_KIND.QUANTITY ? metric.deltaValue : null,
    comparable: metric.kind === METRIC_KIND.QUANTITY ? metric.comparable : null,
    withheldReasonCode: metric.kind === METRIC_KIND.QUANTITY ? metric.withheldReasonCode : (metric.indeterminateReasonCode ?? null),
  });
}

const AMBITO_DECISION_INSIGHT_GUARD_CODE = "descriptive-only";

// Decision Insight items, in the FIXED canonical metric order, each a descriptive
// contrast — never sorted by magnitude, never a composite, never a preferred
// ámbito, never a recommendation.
function ambitoDecisionInsightItems(model) {
  if (!model || model.comparable === false) return deepFreeze([]);
  return deepFreeze(
    model.metrics.map((metric) => {
      if (metric.kind === METRIC_KIND.CATEGORICAL) {
        return {
          metricId: metric.id,
          kind: metric.kind,
          state: metric.relation === CATEGORICAL_RELATION.INDETERMINATE ? "indeterminate" : "categorical",
          relation: metric.relation,
          aValue: metric.a.sourceValue,
          bValue: metric.b.sourceValue,
          reasonCode: metric.indeterminateReasonCode ?? null,
        };
      }
      return {
        metricId: metric.id,
        kind: metric.kind,
        state: metric.comparable ? "comparable" : "withheld",
        unit: metric.unit,
        deltaValue: metric.comparable ? metric.deltaValue : null,
        withheldReasonCode: metric.comparable ? null : metric.withheldReasonCode,
      };
    })
  );
}

// The comparison table rows ARE the authoritative metric array — one object, no
// second calculation path.
function ambitoComparisonRows(model) {
  if (!model || model.comparable === false) return deepFreeze([]);
  return model.metrics;
}

// Descriptive overall status without a score or number.
function ambitoComparisonStatus(model) {
  if (!model || model.comparable === false) return "refused";
  const anyComparable = model.metrics.some((m) => m.kind === METRIC_KIND.QUANTITY && m.comparable);
  const anyRelation = model.metrics.some((m) => m.kind === METRIC_KIND.CATEGORICAL && m.relation !== CATEGORICAL_RELATION.INDETERMINATE);
  if (anyComparable || anyRelation) return "available";
  return "limited";
}

// ======================================================= radius non-applicability
//
// Ámbito geometries are fixed and official; the reader cannot change them, so the
// radius-sensitivity surface does not apply in ámbito scope. This is an explicit
// published state, not a hidden panel — and critically, it retains no Lens
// baseline, so a scope switch cannot leave a stale circle baseline behind.
function ambitoRadiusSensitivityStatus() {
  return deepFreeze({
    applicable: false,
    reasonCode: "FIXED_OFFICIAL_GEOMETRY",
    retainsBaseline: false,
    statement:
      "Radius sensitivity does not apply to planning-ámbito comparison: an ámbito's geometry is " +
      "fixed and official and cannot be adjusted. No Lens baseline is retained in ámbito scope.",
  });
}

// ======================================================= edition sensitivity
//
// Does the A ↔ B relationship hold under the PREVIOUS official edition? The
// varied parameter is the edition, not the radius. `current` and `previous` are
// each a buildAmbitoComparisonModel — A and B both read at the current edition,
// and A and B both read at the previous edition. Each side keeps its own stated
// reference date. The transition vocabulary matches Spatial Window Sensitivity;
// the basis is checked BEFORE any direction claim.

const AMBITO_SENSITIVITY_TRANSITION = Object.freeze({
  // quantity
  UNCHANGED_COMPARABLE: "UNCHANGED_COMPARABLE",
  DIRECTION_CHANGED: "DIRECTION_CHANGED",
  BASIS_CHANGED: "BASIS_CHANGED",
  BECAME_WITHHELD: "BECAME_WITHHELD",
  BECAME_COMPARABLE: "BECAME_COMPARABLE",
  WITHHELD_UNCHANGED: "WITHHELD_UNCHANGED",
  WITHHELD_REASON_CHANGED: "WITHHELD_REASON_CHANGED",
  // categorical (no direction, ever)
  RELATION_UNCHANGED: "RELATION_UNCHANGED",
  RELATION_CHANGED: "RELATION_CHANGED",
  RELATION_INDETERMINATE: "RELATION_INDETERMINATE",
});

function sign(n) {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

function classifyQuantityTransition(prev, cur) {
  const prevComparable = prev && prev.comparable;
  const curComparable = cur && cur.comparable;
  if (prevComparable && curComparable) {
    // Basis check precedes direction: the bases always being M2 here, a direction
    // comparison is valid; if a future metric ever changed basis it would report
    // BASIS_CHANGED and withhold the numeric change.
    if (prev.basis !== cur.basis) {
      return { code: AMBITO_SENSITIVITY_TRANSITION.BASIS_CHANGED, deltaChange: null };
    }
    if (sign(prev.deltaValue) !== sign(cur.deltaValue)) {
      return { code: AMBITO_SENSITIVITY_TRANSITION.DIRECTION_CHANGED, deltaChange: null };
    }
    return { code: AMBITO_SENSITIVITY_TRANSITION.UNCHANGED_COMPARABLE, deltaChange: cur.deltaValue - prev.deltaValue };
  }
  if (prevComparable && !curComparable) return { code: AMBITO_SENSITIVITY_TRANSITION.BECAME_WITHHELD, deltaChange: null };
  if (!prevComparable && curComparable) return { code: AMBITO_SENSITIVITY_TRANSITION.BECAME_COMPARABLE, deltaChange: null };
  // Neither comparable: equivalent only when the reason matches.
  if (prev.withheldReasonCode === cur.withheldReasonCode) {
    return { code: AMBITO_SENSITIVITY_TRANSITION.WITHHELD_UNCHANGED, deltaChange: null };
  }
  return { code: AMBITO_SENSITIVITY_TRANSITION.WITHHELD_REASON_CHANGED, deltaChange: null };
}

function classifyCategoricalTransition(prev, cur) {
  const indet = CATEGORICAL_RELATION.INDETERMINATE;
  if (prev.relation === indet || cur.relation === indet) {
    return { code: AMBITO_SENSITIVITY_TRANSITION.RELATION_INDETERMINATE };
  }
  return prev.relation === cur.relation
    ? { code: AMBITO_SENSITIVITY_TRANSITION.RELATION_UNCHANGED }
    : { code: AMBITO_SENSITIVITY_TRANSITION.RELATION_CHANGED };
}

/**
 * Edition sensitivity of the A ↔ B comparison.
 *
 * Returns one transition per canonical metric, in fixed order, plus each side's
 * own edition reference date. A MODIFIED_BY_INSTRUMENT barrier on either edition
 * step withholds that metric rather than comparing it. If either comparison is a
 * cross-scope refusal, the whole sensitivity is `applicable: false`.
 */
function buildAmbitoEditionSensitivity(current, previous) {
  if (!current || !previous || current.comparable === false || previous.comparable === false) {
    return deepFreeze({ applicable: false, reasonCode: "COMPARISON_UNAVAILABLE", items: [] });
  }
  const items = AMBITO_METRIC_IDS.map((metricId) => {
    const cur = findMetric(current, metricId);
    const prev = findMetric(previous, metricId);
    const base = {
      metricId,
      kind: cur.kind,
      baselineReferenceDate: {
        a: previous.a.edition.developmentState.referenceDate,
        b: previous.b.edition.developmentState.referenceDate,
      },
      scenarioReferenceDate: {
        a: current.a.edition.developmentState.referenceDate,
        b: current.b.edition.developmentState.referenceDate,
      },
    };
    if (cur.kind === METRIC_KIND.CATEGORICAL) {
      return Object.assign(base, classifyCategoricalTransition(prev, cur), { baseline: prev.relation, scenario: cur.relation });
    }
    // A MODIFIED_BY_INSTRUMENT metric in either edition reading is already
    // withheld in that model; the transition then reports a withheld state.
    return Object.assign(base, classifyQuantityTransition(prev, cur), {
      baseline: { comparable: prev.comparable, deltaValue: prev.comparable ? prev.deltaValue : null, withheldReasonCode: prev.withheldReasonCode ?? null },
      scenario: { comparable: cur.comparable, deltaValue: cur.comparable ? cur.deltaValue : null, withheldReasonCode: cur.withheldReasonCode ?? null },
    });
  });
  return deepFreeze({
    applicable: true,
    variedParameter: "EDITION",
    guardCode: "edition-window-only",
    items,
  });
}

// ======================================================= localization (EN + ES)
//
// The model returns codes; the dictionaries turn them into copy. Both languages
// define every key, and a forbidden-vocabulary test scans both for ordering and
// recommendation language. Official and publisher-controlled strings (phase
// values, the code, the units) are verbatim and identical in both languages.

const AMBITO_COMPARISON_DICTIONARIES = Object.freeze({
  en: Object.freeze({
    "metric.phase_planeamiento": "Phase · Planeamiento",
    "metric.phase_gestion": "Phase · Gestión",
    "metric.phase_urbanizacion_proyecto": "Phase · Urbanización · Proyecto",
    "metric.phase_urbanizacion_obras": "Phase · Urbanización · Obras",
    "metric.buildability_residential_collective": "Available buildability · residential (collective)",
    "metric.buildability_residential_single_family": "Available buildability · residential (single-family)",
    "metric.buildability_tertiary": "Available buildability · tertiary",
    "metric.buildability_industrial": "Available buildability · industrial",
    "metric.ambito_surface": "Ámbito surface",
    "relation.SAME": "Same published state",
    "relation.DIFFERENT": "Different published state",
    "relation.INDETERMINATE": "Not comparable",
    "withheld.CROSS_EDITION": "Withheld · different editions",
    "withheld.MODIFIED_BY_INSTRUMENT": "Withheld · modified by instrument",
    "withheld.MULTIPLE_ROWS_NOT_COMBINED": "Withheld · multiple published rows, not combined",
    "withheld.VALUE_NOT_PUBLISHED": "Withheld · value not published on a side",
    "refusal.cross-scope": "Not compared · an ámbito and a Lens circle are different analytical scopes",
    "transition.UNCHANGED_COMPARABLE": "Relationship unchanged",
    "transition.DIRECTION_CHANGED": "B − A direction changed",
    "transition.BASIS_CHANGED": "Comparison basis changed",
    "transition.BECAME_WITHHELD": "Comparison became withheld",
    "transition.BECAME_COMPARABLE": "Comparison became available",
    "transition.WITHHELD_UNCHANGED": "Withheld in both editions",
    "transition.WITHHELD_REASON_CHANGED": "Withheld reason changed",
    "transition.RELATION_UNCHANGED": "Same/different reading unchanged",
    "transition.RELATION_CHANGED": "Same/different reading changed",
    "transition.RELATION_INDETERMINATE": "Not comparable in one edition",
    "radius.non_applicable": "Radius sensitivity does not apply to fixed official ámbito geometry",
    "guard.descriptive-only": "Observed comparison only · no ordering or recommendation",
    "guard.edition-window-only": "Alternative official edition · not a forecast and not a causal effect",
    "unit.m2_edificable": "m² edificable",
    "unit.m2": "m²",
  }),
  es: Object.freeze({
    "metric.phase_planeamiento": "Fase · Planeamiento",
    "metric.phase_gestion": "Fase · Gestión",
    "metric.phase_urbanizacion_proyecto": "Fase · Urbanización · Proyecto",
    "metric.phase_urbanizacion_obras": "Fase · Urbanización · Obras",
    "metric.buildability_residential_collective": "Edificabilidad disponible · residencial (colectiva)",
    "metric.buildability_residential_single_family": "Edificabilidad disponible · residencial (unifamiliar)",
    "metric.buildability_tertiary": "Edificabilidad disponible · terciario",
    "metric.buildability_industrial": "Edificabilidad disponible · industrial",
    "metric.ambito_surface": "Superficie del ámbito",
    "relation.SAME": "Mismo estado publicado",
    "relation.DIFFERENT": "Estado publicado distinto",
    "relation.INDETERMINATE": "No comparable",
    "withheld.CROSS_EDITION": "Retenido · ediciones distintas",
    "withheld.MODIFIED_BY_INSTRUMENT": "Retenido · modificado por instrumento",
    "withheld.MULTIPLE_ROWS_NOT_COMBINED": "Retenido · varias filas publicadas, no combinadas",
    "withheld.VALUE_NOT_PUBLISHED": "Retenido · valor no publicado en un lado",
    "refusal.cross-scope": "No comparado · un ámbito y un círculo Lens son ámbitos analíticos distintos",
    "transition.UNCHANGED_COMPARABLE": "Relación sin cambios",
    "transition.DIRECTION_CHANGED": "Dirección B − A cambiada",
    "transition.BASIS_CHANGED": "Base de comparación cambiada",
    "transition.BECAME_WITHHELD": "La comparación pasó a retenida",
    "transition.BECAME_COMPARABLE": "La comparación pasó a disponible",
    "transition.WITHHELD_UNCHANGED": "Retenida en ambas ediciones",
    "transition.WITHHELD_REASON_CHANGED": "Motivo de retención cambiado",
    "transition.RELATION_UNCHANGED": "Lectura igual/distinto sin cambios",
    "transition.RELATION_CHANGED": "Lectura igual/distinto cambiada",
    "transition.RELATION_INDETERMINATE": "No comparable en una edición",
    "radius.non_applicable": "La sensibilidad al radio no aplica a la geometría oficial fija del ámbito",
    "guard.descriptive-only": "Comparación observada · sin ordenación ni recomendación",
    "guard.edition-window-only": "Edición oficial alternativa · no es una previsión ni un efecto causal",
    "unit.m2_edificable": "m² edificable",
    "unit.m2": "m²",
  }),
});

// ------------------------------------------------------------------------ exports

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PLANNING_AMBITO_SCOPE,
    AMBITO_METRIC_IDS,
    METRIC_KIND,
    COMPARISON_BASIS,
    CATEGORICAL_RELATION,
    WITHHELD_REASON,
    QUANTITY_SIDE_STATE,
    REFUSAL,
    AMBITO_SENSITIVITY_TRANSITION,
    AMBITO_DECISION_INSIGHT_GUARD_CODE,
    AMBITO_COMPARISON_DICTIONARIES,
    phaseComparisonKey,
    buildAmbitoComparisonModel,
    ambitoBridgeReading,
    ambitoDecisionInsightItems,
    ambitoComparisonRows,
    ambitoComparisonStatus,
    ambitoRadiusSensitivityStatus,
    buildAmbitoEditionSensitivity,
  };
}
