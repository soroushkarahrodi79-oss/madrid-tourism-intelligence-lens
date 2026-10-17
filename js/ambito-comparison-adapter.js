// Ámbito-comparison input assembly (K10, #72) — the bridge between the committed
// K6/K7 artifacts and the pure comparison model in js/ambito-comparison.js.
//
// It does ONE job: turn the real evidence into the `a` / `b` inputs the model
// consumes, and derive edition continuity from the real K7 change-detection
// contract — never from a hand-set flag. It computes no comparison itself: the
// caller passes the assembled inputs to `buildAmbitoComparisonModel` /
// `buildAmbitoEditionSensitivity`. That separation lets this module import the
// K6 readers (js/planning-ambito.js) and the K7 classifier (js/ambito-change.js)
// as ES modules while the model stays a classic/CJS global, with no interop
// crossing.
//
// The previous-edition reader input is built by REUSING the same K6 readers over
// a reconstructed previous-edition artifact assembled from
// `change_detection.previous.families` — the records K7 already committed. No
// value, date, geometry or code is fabricated: the reconstruction only wraps the
// committed inner records in the container shape the readers expect.

import { developmentState, availableBuildability } from "./planning-ambito.js";

const PLANNING_AMBITO_SCOPE = "PLANNING_AMBITO";

function denominationFor(dev, fallback) {
  if (dev && dev.denomination) return dev.denomination;
  if (dev && dev.geometryDenomination) return dev.geometryDenomination;
  return fallback ?? null;
}

// Build the model input for one ámbito from the CURRENT committed state artifact.
// `index` is a createPlanningIndex(...) (K6); `code` is the exact official code.
export function buildCurrentAmbitoInput(code, index) {
  if (!index) return null;
  const dev = index.developmentState(code);
  const build = index.availableBuildability(code);
  return {
    scope: PLANNING_AMBITO_SCOPE,
    ambitoCode: code,
    denomination: denominationFor(dev, null),
    developmentState: dev,
    availableBuildability: build,
  };
}

// Reconstruct a previous-edition state artifact in the shape the K6 readers
// expect, from `change_detection.previous.families`. The committed inner records
// are wrapped — never altered — in the `{ availability, ... }` container the
// readers read. S1 records are the development-state inner object; S2 records are
// the array of published buildability rows.
export function reconstructPreviousStateArtifact(stateArtifact) {
  const previous = stateArtifact && stateArtifact.change_detection && stateArtifact.change_detection.previous;
  if (!previous || !previous.families) return null;
  const s1 = previous.families.S1 || null;
  const s2 = previous.families.S2 || null;
  const editionFromFamily = (family) =>
    family
      ? {
          family: family.family,
          title: family.title,
          dataset_url: family.dataset_url || null,
          snapshot_identity: family.snapshot_identity,
          schema_era: family.schema_era,
          reference_date: family.reference_date,
          reference_date_month: family.reference_date_month,
          published_at: family.published_at ?? null,
          retrieved_at: family.retrieved_at ?? null,
          update_frequency: family.update_frequency,
          observed_cadence: family.observed_cadence ?? null,
          source_state: family.source_state,
          license: family.license,
          resource_id: family.resource_id,
        }
      : null;

  const codes = new Set([
    ...Object.keys((s1 && s1.records) || {}),
    ...Object.keys((s2 && s2.records) || {}),
  ]);
  const ambitos = {};
  for (const code of codes) {
    const devRecord = s1 && s1.records ? s1.records[code] : null;
    const s2Rows = s2 && s2.records ? s2.records[code] : null;
    ambitos[code] = {
      ambito_code: code,
      geometry_denomination: (devRecord && devRecord.denomination) || null,
      development_state: devRecord ? { availability: "PUBLISHED", ...devRecord } : undefined,
      available_buildability: Array.isArray(s2Rows)
        ? { availability: "PUBLISHED", row_count: s2Rows.length, publication: s2Rows.length > 1 ? "MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED" : "SINGLE_PUBLISHED_ROW", rows: s2Rows }
        : undefined,
    };
  }
  return {
    scope: PLANNING_AMBITO_SCOPE,
    editions: { development_state: editionFromFamily(s1), available_buildability: editionFromFamily(s2) },
    ambitos,
  };
}

// The model input for one ámbito at the PREVIOUS committed edition.
export function buildPreviousAmbitoInput(code, previousArtifact) {
  if (!previousArtifact) return null;
  const dev = developmentState(code, previousArtifact);
  const build = availableBuildability(code, previousArtifact);
  return {
    scope: PLANNING_AMBITO_SCOPE,
    ambitoCode: code,
    denomination: denominationFor(dev, null),
    developmentState: dev,
    availableBuildability: build,
  };
}

function editionSelector(input) {
  return {
    development_state: input?.developmentState?.edition?.snapshotIdentity ?? null,
    available_buildability: input?.availableBuildability?.edition?.snapshotIdentity ?? null,
  };
}

function sameEditionSelector(a, b) {
  return Boolean(
    a && b &&
    a.development_state && a.development_state === b.development_state &&
    a.available_buildability && a.available_buildability === b.available_buildability
  );
}

// Canonical K13 resolver for one comparison side. The caller supplies only an
// exact official code and, optionally, the two source-family snapshot identities.
// Values, units and dates always come from the committed current/previous K6/K7
// artifacts; caller-owned comparison records are never accepted.
export function createCanonicalAmbitoComparisonInputResolver({ index, stateArtifact } = {}) {
  const previousArtifact = reconstructPreviousStateArtifact(stateArtifact);
  return (code, requestedEdition = null) => {
    if (typeof code !== "string" || !code.trim() || !index) return null;
    if (typeof index.featureFor !== "function" || !index.featureFor(code)) return null;
    const current = buildCurrentAmbitoInput(code, index);
    if (!requestedEdition) return current;
    if (!requestedEdition || typeof requestedEdition !== "object" || Array.isArray(requestedEdition)) return null;
    const keys = Object.keys(requestedEdition).sort();
    if (keys.join("|") !== "available_buildability|development_state") return null;
    if (sameEditionSelector(requestedEdition, editionSelector(current))) return current;
    const previous = buildPreviousAmbitoInput(code, previousArtifact);
    return sameEditionSelector(requestedEdition, editionSelector(previous)) ? previous : null;
  };
}

// Union of the exact codes carried by either family in either committed K7
// edition. This deliberately does not use current geometry: a genuine NEW_AMBITO
// or ABSENT_FROM_EDITION code exists in only one edition and must remain valid.
export function ambitoEditionContainsCode(code, stateArtifact) {
  if (typeof code !== "string" || !code.trim()) return false;
  const cd = stateArtifact?.change_detection;
  for (const side of [cd?.previous, cd?.current]) {
    for (const family of Object.values(side?.families || {})) {
      if (family?.records && Object.hasOwn(family.records, code)) return true;
    }
  }
  return false;
}

// Per-family K7 outcomes for one exact code across the committed previous→current
// editions, through the real K7 classifier. `changeModule` is the ambito-change
// module. Returns `{ S1, S2 }` outcome strings (or null when a family is absent).
export function editionOutcomes(code, stateArtifact, changeModule) {
  const cd = stateArtifact && stateArtifact.change_detection;
  if (!cd || !cd.previous || !cd.current || !changeModule) return { S1: null, S2: null };
  const previous = { reference_date: cd.previous.reference_date, families: cd.previous.families };
  const current = { reference_date: cd.current.reference_date, families: cd.current.families };
  const comparison = changeModule.buildAmbitoComparison({ previous, current, exactCode: code });
  const state = comparison && comparison.state ? comparison.state : {};
  return {
    S1: state.S1 ? state.S1.outcome : null,
    S2: state.S2 ? state.S2.outcome : null,
  };
}

// Collapse the two families' K7 outcomes into the single governing outcome for
// identity continuity. The contract FAILS CLOSED:
//
//   * A break in EITHER family governs (NEW_AMBITO / ABSENT_FROM_EDITION /
//     MODIFIED_BY_INSTRUMENT / CAUSE_UNRESOLVED / NON_COMPARABLE), even if the
//     other family looks continuous — an apparently valid record never bypasses a
//     break.
//   * Identity is established only when at least ONE family POSITIVELY carries it
//     (NO_CHANGE or STATE_TRANSITION). A null family outcome is NOT a positive
//     signal: it is absent/unavailable K7 evidence for that family (no row in the
//     compared editions, or the classifier was not run), so it can never on its
//     own establish NO_CHANGE.
//   * When no family gives a positive signal — every family null — the result is
//     `NO_EVIDENCE`, which maps to NOT established. This distinguishes genuinely
//     absent evidence from a documented inapplicable family: a code whose
//     buildability family (S2) legitimately has no row is still established when
//     S1 positively carries it, but a code with no K7 signal at all is withheld.
const CONTINUITY_BREAK = Object.freeze(
  new Set(["NEW_AMBITO", "ABSENT_FROM_EDITION", "MODIFIED_BY_INSTRUMENT", "CAUSE_UNRESOLVED", "NON_COMPARABLE"])
);
const CONTINUITY_POSITIVE = Object.freeze(new Set(["NO_CHANGE", "STATE_TRANSITION"]));

export function governingContinuityOutcome(outcomes) {
  const s1 = outcomes ? outcomes.S1 : null;
  const s2 = outcomes ? outcomes.S2 : null;
  if (CONTINUITY_BREAK.has(s1)) return s1;
  if (CONTINUITY_BREAK.has(s2)) return s2;
  if (CONTINUITY_POSITIVE.has(s1) || CONTINUITY_POSITIVE.has(s2)) {
    return s1 === "STATE_TRANSITION" || s2 === "STATE_TRANSITION" ? "STATE_TRANSITION" : "NO_CHANGE";
  }
  // No family positively carried the identity — absent / unavailable evidence.
  return "NO_EVIDENCE";
}
