// Evidence scope & freshness — pure model (K2).
//
// Two machine-enforceable properties for every piece of evidence this product
// reads: WHAT GEOMETRY it describes (its analytical scope), and WHAT EACH DATE
// MEANS (its five-field freshness record). This module is the single place those
// two contracts are defined in code, so K4 can render the persistent scope /
// freshness rail without taking another methodological decision.
//
// It is deliberately PURE: no DOM, no Leaflet, no fetch, no app-state globals,
// no clock. Every function is a deterministic transform over its arguments. It
// does not read data/source_registry.json; the deployment validator does that
// and passes plain objects in. This module never infers a scope from coordinates
// or a source name, never defaults an unscoped value to LENS_CIRCLE, and never
// manufactures date precision.

// ----------------------------------------------------------- closed vocabularies

// Analytical scope — WHAT A VALUE MEANS, not merely how its coordinates are
// stored and not how a panel happens to render it. A municipality figure stays
// MUNICIPALITY even while a Lens is active; a barrio statistic stays
// OFFICIAL_BARRIO even when selected through a Lens centre. This is the integrity
// envelope's opposite number, never a synonym for it: `expected_spatial_scope`
// is a loose bounding box for build validation, `scope` is analytical meaning.
// The planning scopes are defined here because Gate K authorised the enum; no
// planning production evidence ships until Gate L closes.
const ANALYTICAL_SCOPES = Object.freeze([
  "LENS_CIRCLE",
  "OFFICIAL_BARRIO",
  "OFFICIAL_DISTRICT",
  "MUNICIPALITY",
  "POINT_OBSERVATION",
  "BOUNDED_STUDY_AREA",
  "PLANNING_AMBITO",
  "EXECUTION_UNIT",
  "DEVELOPMENT_STAGE_AREA",
  "PARCEL",
  "ADDRESS_POINT",
  "WORK_GEOMETRY",
  "LENS_INTERSECT_AMBITO",
]);

// Publisher-declared expected cadence. DECLARED_UNDEFINED and NONE_DECLARED are
// two different publisher facts and are never collapsed into one "UNKNOWN":
// DECLARED_UNDEFINED means the publisher wrote "Sin definir"; NONE_DECLARED means
// the publisher published no update-frequency statement at all.
const UPDATE_FREQUENCIES = Object.freeze([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "BIMONTHLY",
  "QUARTERLY",
  "SEMESTRAL",
  "ANNUAL",
  "IRREGULAR",
  "DECLARED_UNDEFINED",
  "NONE_DECLARED",
]);

// The publisher's own status of the evidence — never our opinion of its quality.
const SOURCE_STATES = Object.freeze([
  "DEFINITIVE",
  "PROVISIONAL",
  "WITHHELD_BY_PUBLISHER",
  "NOT_DECLARED_BY_PUBLISHER",
]);

// The five mandatory freshness fields, in reading order. observed_cadence is a
// sixth, optional field, published only where it defensibly differs from the
// declared cadence.
const FRESHNESS_FIELDS = Object.freeze([
  "reference_date",
  "published_at",
  "retrieved_at",
  "update_frequency",
  "source_state",
]);

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isAnalyticalScope(id) {
  return typeof id === "string" && ANALYTICAL_SCOPES.includes(id);
}

function isUpdateFrequency(value) {
  return typeof value === "string" && UPDATE_FREQUENCIES.includes(value);
}

function isSourceState(value) {
  return typeof value === "string" && SOURCE_STATES.includes(value);
}

// A reference date is an ISO month, an ISO calendar date, or an explicit null.
// Nothing else — a build time, a catalogue timestamp or a bare year is not one.
function isReferenceDate(value) {
  return value === null || (typeof value === "string" && (ISO_MONTH.test(value) || ISO_DATE.test(value)));
}

// -------------------------------------------------------------------- scopeOf

// scopeOf(value) returns the single analytical scope id a value declares, or
// THROWS. An unscoped value is a contract violation, never a default: this
// function will not return UNKNOWN, will not fall back to LENS_CIRCLE, will not
// read coordinates, and will not read a source name. A value earns a scope by
// carrying one, and only one, from the closed enum.
function scopeOf(value) {
  if (value === null || typeof value !== "object") {
    throw new TypeError("scopeOf: a scoped evidence value must be an object carrying a `scope`");
  }
  if (!Object.prototype.hasOwnProperty.call(value, "scope")) {
    throw new Error("scopeOf: value declares no analytical scope; an unscoped value is invalid");
  }
  const { scope } = value;
  if (!isAnalyticalScope(scope)) {
    throw new Error(
      `scopeOf: "${scope}" is not a declared analytical scope (one of ${ANALYTICAL_SCOPES.join(", ")})`
    );
  }
  return scope;
}

// ----------------------------------------------------------------- freshnessOf

// freshnessOf(source) returns the frozen five-field freshness record (plus
// observed_cadence when the source carries it), preserving explicit nulls. A
// missing property is a contract violation and throws; an explicit null is
// KNOWN ABSENCE and is kept, because a missing date the publisher never issued is
// a publishable fact, not a blank to be hidden or back-filled. The returned
// object is frozen so no renderer can mutate a reading.
function freshnessOf(source) {
  if (source === null || typeof source !== "object") {
    throw new TypeError("freshnessOf: source must be an object");
  }
  const record = {};
  for (const field of FRESHNESS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) {
      throw new Error(`freshnessOf: source "${source.id ?? "?"}" is missing mandatory freshness field "${field}"`);
    }
    record[field] = source[field];
  }
  // observed_cadence is optional; only carry it when the source actually declares
  // it, so "field absent" and "field present and null" stay distinguishable.
  if (Object.prototype.hasOwnProperty.call(source, "observed_cadence")) {
    record.observed_cadence = source.observed_cadence;
  }
  return Object.freeze(record);
}

// ------------------------------------------------------------ oldestReferenceDate

// Normalise a reference date to a sortable lower-bound tuple WITHOUT changing the
// value itself. A month "2026-01" has the lower bound 2026-01-01 but keeps month
// precision; this is only ever used for comparison, never returned.
function lowerBound(referenceDate) {
  const isMonth = ISO_MONTH.test(referenceDate);
  const key = isMonth ? `${referenceDate}-01` : referenceDate;
  // precisionRank: month (0) sorts before day (1) on an identical lower bound,
  // so "2026-01" is reported in preference to "2026-01-01" rather than a day
  // being manufactured from a contributor that only stated a month.
  return { key, precisionRank: isMonth ? 0 : 1 };
}

// oldestReferenceDate(values) returns the oldest contributing reference date for
// the rail K4 renders, or null. The rules, deterministic and precision-preserving:
//
//   * If the input is empty, there is no contributing date -> null.
//   * If ANY contributor's reference_date is null, the set has no common date to
//     claim -> null. The rail must never present a shared "as of" date when one
//     contributor's period is unknown.
//   * Otherwise return the earliest date, AT ITS ORIGINAL PRECISION. A month is
//     compared at its first day but returned as a month; it is never promoted to
//     a calendar day. On an identical lower bound, the month-precision value is
//     returned in preference to the day-precision one.
//
// Each element may be an evidence object carrying `reference_date`, or a bare
// reference-date string, or null (an unknown-period contributor).
function oldestReferenceDate(values) {
  if (!Array.isArray(values)) {
    throw new TypeError("oldestReferenceDate: expected an array of values");
  }
  if (values.length === 0) return null;

  const dates = [];
  for (const value of values) {
    let referenceDate;
    if (value === null) {
      referenceDate = null;
    } else if (typeof value === "string") {
      referenceDate = value;
    } else if (typeof value === "object") {
      referenceDate = Object.prototype.hasOwnProperty.call(value, "reference_date") ? value.reference_date : undefined;
    } else {
      throw new TypeError("oldestReferenceDate: each value must be an object, a string, or null");
    }
    if (referenceDate === undefined) {
      throw new Error("oldestReferenceDate: a contributing value carries no reference_date");
    }
    if (!isReferenceDate(referenceDate)) {
      throw new Error(`oldestReferenceDate: "${referenceDate}" is not an ISO month, ISO date, or null`);
    }
    // One null contributor is decisive: the set cannot claim a common date.
    if (referenceDate === null) return null;
    dates.push(referenceDate);
  }

  let oldest = dates[0];
  let oldestBound = lowerBound(oldest);
  for (let i = 1; i < dates.length; i += 1) {
    const bound = lowerBound(dates[i]);
    if (
      bound.key < oldestBound.key ||
      (bound.key === oldestBound.key && bound.precisionRank < oldestBound.precisionRank)
    ) {
      oldest = dates[i];
      oldestBound = bound;
    }
  }
  return oldest;
}

// ------------------------------------------------------ crossScopeArithmeticAllowed

// Read either a scope id directly or an evidence object's declared scope.
function scopeOfArgument(operand) {
  if (isAnalyticalScope(operand)) return operand;
  return scopeOf(operand);
}

// A basis is "explicit and documented" when it is a non-empty string, or an
// object carrying a non-empty `reason`/`documented_basis` string. An empty
// string, true, or a bare {} is not a documented basis and does not authorise
// anything.
function isDocumentedBasis(basis) {
  if (typeof basis === "string") return basis.trim().length > 0;
  if (basis !== null && typeof basis === "object") {
    const reason = basis.reason ?? basis.documented_basis;
    return typeof reason === "string" && reason.trim().length > 0;
  }
  return false;
}

// crossScopeArithmeticAllowed(a, b, basis?) answers whether two values may be
// differenced, ratioed or otherwise combined.
//
//   * Same scope: eligible (true) — still subject to the caller's other evidence
//     contracts (periods, units, universes), which this function does not judge.
//   * Different scopes: FALSE, unless an explicit, documented basis is supplied.
//     Geometric overlap is NOT a basis: there is no area-weighting and no
//     apportionment here. A barrio count and a Lens-circle count, a municipality
//     figure and a barrio figure, a planning ámbito and a circle ∩ ámbito are all
//     refused without an argued basis.
function crossScopeArithmeticAllowed(a, b, basis) {
  const scopeA = scopeOfArgument(a);
  const scopeB = scopeOfArgument(b);
  if (scopeA === scopeB) return true;
  return isDocumentedBasis(basis);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ANALYTICAL_SCOPES,
    UPDATE_FREQUENCIES,
    SOURCE_STATES,
    FRESHNESS_FIELDS,
    isAnalyticalScope,
    isUpdateFrequency,
    isSourceState,
    isReferenceDate,
    scopeOf,
    freshnessOf,
    oldestReferenceDate,
    crossScopeArithmeticAllowed,
  };
}
