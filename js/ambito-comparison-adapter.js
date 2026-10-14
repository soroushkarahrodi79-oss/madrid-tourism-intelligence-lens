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

// Collapse the two families' outcomes into the single governing K7 outcome for
// identity continuity: a continuous entity requires BOTH families (where present)
// to be NO_CHANGE or STATE_TRANSITION. Any other outcome, in either family, is the
// governing non-continuous reason (the first such outcome, S1 before S2).
export function governingContinuityOutcome(outcomes) {
  const continuous = (o) => o === null || o === "NO_CHANGE" || o === "STATE_TRANSITION";
  if (!continuous(outcomes.S1)) return outcomes.S1;
  if (!continuous(outcomes.S2)) return outcomes.S2;
  // Both continuous (or absent): report STATE_TRANSITION if either changed state,
  // else NO_CHANGE — both map to an established identity.
  if (outcomes.S1 === "STATE_TRANSITION" || outcomes.S2 === "STATE_TRANSITION") return "STATE_TRANSITION";
  return "NO_CHANGE";
}
