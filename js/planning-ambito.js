// Planning-ámbito evidence: the pure model (K6, #68).
//
// THE ÁMBITO, THE BARRIO AND THE LENS CIRCLE ARE THREE DIFFERENT ANALYTICAL
// OBJECTS, AND THIS MODULE EXISTS TO KEEP THEM APART.
//
// An ámbito's published development state and its available buildability describe
// the WHOLE planning ámbito. They are never apportioned, area-weighted,
// population-weighted or otherwise distributed into a Lens circle, a barrio, a
// district or any sub-area — the same discipline js/area-profile.js applies to a
// barrio's registered residents, raised to the planning layer.
//
// Four things this module will not do, by construction rather than by convention:
//
//   1. **No overall stage.** Gate L §12 measured the four published phase columns
//      as multi-dimensional (empirically non-funnel), and the publisher documents
//      no ordering. `developmentState` returns FOUR independent phase records in
//      the publisher's own column order. There is no stage, stage number,
//      progression, percentage, completion, advancement, delay or timeline, and
//      no function here computes one. PHASE_FIELD_ORDER is a column order, not a
//      rank.
//   2. **No dwelling counts.** The source's `Nº Viviendas` columns are
//      residential buildability ÷ 100 with fractional values (Gate L §16); the
//      builder excludes them and nothing here can reconstruct one.
//   3. **No apportionment.** `ambitosIntersecting` answers membership only —
//      WHICH ámbitos a Lens circle touches. It returns no overlap area, no
//      overlapping fraction, no weight and no ámbito quantity, so there is no
//      numerator and no denominator through which a whole-ámbito figure could be
//      scaled to a circle. The quantity readers (`developmentState`,
//      `availableBuildability`) take an ámbito code and the artifact, and accept
//      no point, radius, circle or area parameter at all.
//   4. **Change detection is separate.** This K6 module reads one selected
//      edition per family. K7 lives in `js/ambito-change.js` and takes explicit
//      dated edition snapshots; no function here takes two editions.
//
// `No Necesita` is its own published state. It is never mapped to `Sin Iniciar`,
// to zero, to unavailable, to "complete", to "skipped" or to "no aplica": Gate L
// §13 found the publisher lists it as an expected value but never defines it, so
// its meaning is carried as UNRESOLVED and the verbatim label is authoritative.
// `PGOUM-85` / `PGOUM-97` are plan-of-origin markers occupying phase cells, not
// progress states and not errors, and survive verbatim.
//
// A blank published cell and a published `0` are different states and stay
// different. Missing never becomes zero, and nothing here falls back to `0`.
//
// Containment reuses `pointInGeometry` and `geometryIntersectsCircle` from
// js/geography.js. There is deliberately no second point-in-polygon or
// circle-intersection implementation in this file.
//
// Everything is pure: the committed artifacts in, frozen view models out. No
// DOM, no Leaflet, no fetch, no clock, no application state — so it is
// unit-testable with plain `node --test`. The browser wiring in js/app.js renders
// what this file returns.

import { geometryIntersectsCircle, pointInGeometry } from "./geography.js";

// ------------------------------------------------------------------ vocabularies

// How an ámbito lookup resolved. OUTSIDE_ALL_AMBITOS is an EXPLICIT state, never
// a null rendered as blank, never zero and never the nearest ámbito.
export const AMBITO_STATE = Object.freeze({
  LOADING: "loading",
  UNAVAILABLE: "unavailable",
  OUTSIDE_ALL_AMBITOS: "outside_all_ambitos",
  RESOLVED: "resolved",
});

// Whether the selected edition carries a row for this ámbito at all. An ámbito
// with geometry but no published row is an absence of evidence — the published
// annex "Ámbitos del PGOUM que no son objeto de seguimiento" names court
// annulment, instrument re-ordering, cession and historic colonies as reasons —
// and is never shown as zero.
export const AVAILABILITY = Object.freeze({
  PUBLISHED: "PUBLISHED",
  NOT_PUBLISHED_IN_EDITION: "NOT_PUBLISHED_IN_EDITION",
});

// The state of one published cell. NOT_PUBLISHED (a blank cell) and a PUBLISHED
// value of 0 are different facts.
export const VALUE_STATE = Object.freeze({
  PUBLISHED: "PUBLISHED",
  NOT_PUBLISHED: "NOT_PUBLISHED",
  NOT_PUBLISHED_NON_NUMERIC: "NOT_PUBLISHED_NON_NUMERIC",
});

// What one published phase cell IS. Carries no order and no rank.
export const PHASE_KIND = Object.freeze({
  PHASE_VALUE: "PHASE_VALUE",
  PLAN_ORIGIN_MARKER: "PLAN_ORIGIN_MARKER",
  UNRESOLVED_MEANING: "UNRESOLVED_MEANING",
});

// Whether a phase value appears in the publisher's structure document.
export const PHASE_VOCABULARY = Object.freeze({
  SOURCE_DOCUMENTED: "SOURCE_DOCUMENTED",
  SOURCE_DOCUMENTED_SPELLING_VARIANT: "SOURCE_DOCUMENTED_SPELLING_VARIANT",
  SOURCE_OBSERVED_NOT_DOCUMENTED: "SOURCE_OBSERVED_NOT_DOCUMENTED",
});

export const BUILDABILITY_PUBLICATION = Object.freeze({
  SINGLE_PUBLISHED_ROW: "SINGLE_PUBLISHED_ROW",
  MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED: "MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED",
});

// The whole-ámbito analytical scope, and the circle∩ámbito membership scope.
// They are different scopes and no value ever carries both.
export const PLANNING_AMBITO_SCOPE = "PLANNING_AMBITO";
export const LENS_INTERSECT_AMBITO_SCOPE = "LENS_INTERSECT_AMBITO";

// The four published phase fields, in the PUBLISHER'S COLUMN ORDER. This is an
// order of presentation, not an order of progression: Gate L found the fields are
// multi-dimensional and no ordering is documented. Nothing indexes into it to
// derive a "current" or "furthest" phase.
export const PHASE_FIELD_ORDER = Object.freeze([
  "planeamiento",
  "gestion",
  "urbanizacion_proyecto",
  "urbanizacion_obras",
]);

// The documented use classes, in the publisher's column order.
export const USE_CLASS_ORDER = Object.freeze([
  "colectiva_residencial",
  "unifamiliar_residencial",
  "industrial",
  "terciario",
]);

export const BUILDABILITY_UNIT = "m² edificable";
export const SURFACE_UNIT = "m²";

// Stated once, carried on every object this module returns, and asserted by a
// structural test. The rule is enforced by the SHAPE of this API, not by this
// string: the membership reader exposes no quantity, and the quantity readers
// expose no geometry parameter.
export const APPORTIONMENT_POLICY = Object.freeze({
  policy: "NONE",
  statement:
    "An ámbito's published state and available buildability describe the whole planning " +
    "ámbito. No figure is apportioned, area-weighted, population-weighted or otherwise " +
    "distributed into a Lens circle, a barrio, a district or any sub-area, and no figure is " +
    "combined arithmetically with a value of another analytical scope.",
  lensIntersectionAnswers: "which ámbitos the circle touches",
  lensIntersectionDoesNotAnswer: "what share of an ámbito's quantities lies inside the circle",
});

// ----------------------------------------------------------------- freeze helper

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// Guard against a caller handing a quantity reader something circle-shaped. The
// readers take (code, artifact); a coordinate, radius or circle reaching them
// would be the first step of an apportionment, so it throws instead.
const CIRCLE_SHAPED_KEYS = Object.freeze(["radiusM", "radius", "lat", "lon", "latitude", "longitude", "centre", "center"]);

function assertNotCircleShaped(artifact, fname) {
  if (artifact === null || typeof artifact !== "object") return;
  for (const key of CIRCLE_SHAPED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(artifact, key)) {
      throw new TypeError(
        `${fname}: expected the ámbito state artifact, got an object carrying "${key}". ` +
          "Whole-ámbito quantities are never read through a circle, a centre or a radius: " +
          "there is no apportionment in this model."
      );
    }
  }
}

// --------------------------------------------------------------- normalised code

// The join key is the EXACT official code. There is no normalisation anywhere in
// this module: no case folding, no padding, no trimming of a `-RP` suffix. Gate L
// §21 established that `-RP` marks a distinct Revisión Parcial ámbito —
// `UZP.3.01` was annulled by court sentence while `UZPp.03.01-RP` is its active
// replacement — and measured that normalising codes REDUCES exact matches.
function exactCode(code) {
  return typeof code === "string" ? code : null;
}

// ------------------------------------------------------------------- edition read

function editionRecord(artifact, family) {
  const edition = artifact && artifact.editions && artifact.editions[family];
  if (!edition) return null;
  return {
    family: edition.family,
    title: edition.title,
    datasetUrl: edition.dataset_url || null,
    snapshotIdentity: edition.snapshot_identity,
    schemaEra: edition.schema_era,
    referenceDate: edition.reference_date,
    referenceDateMonth: edition.reference_date_month,
    referenceDateMethod: edition.reference_date_method,
    referenceDateSourceColumn: edition.reference_date_source_column,
    publishedAt: edition.published_at ?? null,
    retrievedAt: edition.retrieved_at ?? null,
    updateFrequency: edition.update_frequency,
    observedCadence: edition.observed_cadence ?? null,
    sourceState: edition.source_state,
    license: edition.license,
    resourceId: edition.resource_id,
  };
}

// ====================================================================== lookups

/**
 * Which planning ámbito contains this point?
 *
 * `point` is `{ lon, lat }` in GeoJSON order (longitude first), stated explicitly
 * because Leaflet uses the opposite order. `ambitos` is the committed
 * `madrid_ambitos.geojson` FeatureCollection, or an index built by
 * `createPlanningIndex`.
 *
 * Returns a frozen record whose `state` is always explicit: RESOLVED with the
 * ámbito's exact official code and denomination, OUTSIDE_ALL_AMBITOS when no
 * production ámbito contains the point, or UNAVAILABLE when there is no usable
 * geometry. OUTSIDE_ALL_AMBITOS is never a blank, never zero and never the
 * nearest ámbito: the production universe does not cover the whole municipality,
 * and saying so is the honest answer.
 */
export function ambitoContaining(point, ambitos) {
  const lon = point && Number(point.lon);
  const lat = point && Number(point.lat);
  const features = featureListOf(ambitos);
  if (!features || features.length === 0) {
    return deepFreeze({
      scope: PLANNING_AMBITO_SCOPE,
      state: AMBITO_STATE.UNAVAILABLE,
      ambitoCode: null,
      denomination: null,
      apportionment: APPORTIONMENT_POLICY,
    });
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return deepFreeze({
      scope: PLANNING_AMBITO_SCOPE,
      state: AMBITO_STATE.UNAVAILABLE,
      ambitoCode: null,
      denomination: null,
      apportionment: APPORTIONMENT_POLICY,
    });
  }
  for (const entry of features) {
    if (outsideBox(lon, lat, entry.box)) continue;
    if (pointInGeometry(lon, lat, entry.geometry)) {
      return deepFreeze({
        scope: PLANNING_AMBITO_SCOPE,
        state: AMBITO_STATE.RESOLVED,
        ambitoCode: entry.code,
        denomination: entry.denomination,
        apportionment: APPORTIONMENT_POLICY,
      });
    }
  }
  return deepFreeze({
    scope: PLANNING_AMBITO_SCOPE,
    state: AMBITO_STATE.OUTSIDE_ALL_AMBITOS,
    ambitoCode: null,
    denomination: null,
    apportionment: APPORTIONMENT_POLICY,
    note:
      "No official planning ámbito of the production universe contains this point. The ámbito " +
      "universe does not cover the whole municipality.",
  });
}

/**
 * Which planning ámbitos does this Lens circle touch?
 *
 * `lensCircle` is `{ lon, lat, radiusM }`. The answer is MEMBERSHIP ONLY. The
 * returned record carries, per touched ámbito, its exact official code, its
 * denomination and whether it contains the circle's centre — and nothing else.
 *
 * It deliberately carries no overlap area, no overlapping fraction, no weight and
 * no ámbito quantity, so a caller has no numerator and no denominator with which
 * to scale a whole-ámbito figure to the circle. The question "what share of the
 * buildability lies inside the circle?" has no answer in this API because the
 * API does not compute one, and a structural test asserts it never will.
 */
export function ambitosIntersecting(lensCircle, ambitos) {
  const lon = lensCircle && Number(lensCircle.lon);
  const lat = lensCircle && Number(lensCircle.lat);
  const radiusM = lensCircle && Number(lensCircle.radiusM);
  const features = featureListOf(ambitos) || [];
  const touched = [];
  if (Number.isFinite(lon) && Number.isFinite(lat) && Number.isFinite(radiusM) && radiusM > 0) {
    for (const entry of features) {
      if (!geometryIntersectsCircle(lon, lat, radiusM, entry.geometry)) continue;
      touched.push({
        ambitoCode: entry.code,
        denomination: entry.denomination,
        containsCentre: pointInGeometry(lon, lat, entry.geometry),
      });
    }
    touched.sort((a, b) => a.ambitoCode.localeCompare(b.ambitoCode));
  }
  return deepFreeze({
    // The MEMBERSHIP scope. It is not PLANNING_AMBITO: a list of touched ámbitos
    // is a statement about the circle, while every quantity stays whole-ámbito.
    scope: LENS_INTERSECT_AMBITO_SCOPE,
    centre: { lon: Number.isFinite(lon) ? lon : null, lat: Number.isFinite(lat) ? lat : null },
    radiusM: Number.isFinite(radiusM) ? radiusM : null,
    touched,
    // A count of touched ámbitos — a property of the circle, not a share of any
    // ámbito's published quantities.
    count: touched.length,
    quantitiesProvided: false,
    apportionment: APPORTIONMENT_POLICY,
    ceiling:
      "Lists WHICH official planning ámbitos this Lens circle touches. It is not a share, " +
      "proportion or part of any ámbito's published development state, surface or available " +
      "buildability: those describe the whole ámbito and are read at ámbito scope only.",
  });
}

/**
 * The four independent published development-phase values for one ámbito.
 *
 * `code` is the exact official ámbito code; `artifact` is the committed
 * `madrid_ambito_state.json`. Takes no point, no radius and no circle — and
 * throws if handed something circle-shaped, because reading a whole-ámbito state
 * through a circle is the first step of an apportionment.
 *
 * `phases` is an array of exactly four records in the publisher's column order.
 * Each carries the publisher's `sourceValue` VERBATIM as the authoritative value,
 * plus product-side presentation metadata (`kind`, `vocabulary`, `documentedAs`)
 * that carries no rank. There is no fifth, summary or derived phase field.
 */
export function developmentState(code, artifact) {
  assertNotCircleShaped(artifact, "developmentState");
  const key = exactCode(code);
  const record = key && artifact && artifact.ambitos ? artifact.ambitos[key] : null;
  const edition = editionRecord(artifact, "development_state");
  if (!record || !record.development_state) {
    return deepFreeze({
      scope: PLANNING_AMBITO_SCOPE,
      ambitoCode: key,
      availability: AVAILABILITY.NOT_PUBLISHED_IN_EDITION,
      phases: [],
      edition,
      apportionment: APPORTIONMENT_POLICY,
      note:
        "No record for this ámbito code in the committed state artifact. An absence of published " +
        "evidence, not a zero and not a state.",
    });
  }
  const state = record.development_state;
  if (state.availability !== AVAILABILITY.PUBLISHED) {
    return deepFreeze({
      scope: PLANNING_AMBITO_SCOPE,
      ambitoCode: key,
      geometryDenomination: record.geometry_denomination ?? null,
      availability: AVAILABILITY.NOT_PUBLISHED_IN_EDITION,
      phases: [],
      edition,
      apportionment: APPORTIONMENT_POLICY,
      note: state.note || null,
    });
  }
  const phases = PHASE_FIELD_ORDER.map((field) => {
    const phase = state.phases && state.phases[field];
    if (!phase) {
      return {
        key: field,
        sourceColumn: null,
        sourceValue: null,
        state: VALUE_STATE.NOT_PUBLISHED,
        kind: null,
        vocabulary: null,
        documentedAs: null,
      };
    }
    return {
      key: field,
      sourceColumn: phase.source_column ?? null,
      // The publisher's string, verbatim. Authoritative.
      sourceValue: phase.source_value ?? null,
      state: phase.state,
      kind: phase.kind ?? null,
      vocabulary: phase.vocabulary ?? null,
      documentedAs: phase.documented_as ?? null,
    };
  });
  return deepFreeze({
    scope: PLANNING_AMBITO_SCOPE,
    ambitoCode: key,
    availability: AVAILABILITY.PUBLISHED,
    denomination: state.denomination ?? null,
    geometryDenomination: record.geometry_denomination ?? null,
    district: state.district ? { code: state.district.code ?? null, name: state.district.name ?? null } : null,
    characteristicUse: state.characteristic_use ?? null,
    surface: state.surface
      ? {
          state: state.surface.state,
          value: state.surface.state === VALUE_STATE.PUBLISHED ? state.surface.value : null,
          unit: state.surface.unit || SURFACE_UNIT,
          sourceColumn: state.surface.source_column ?? null,
        }
      : null,
    // FOUR INDEPENDENT FIELDS. No fifth field summarises them.
    phases,
    edition,
    apportionment: APPORTIONMENT_POLICY,
  });
}

/**
 * Available buildability (`edificabilidad disponible`) for one ámbito, in m².
 *
 * `code` is the exact official ámbito code; `artifact` is the committed
 * `madrid_ambito_state.json`. Takes no point, no radius and no circle.
 *
 * Every figure carries its unit, and a figure with no unit cannot exist here
 * because the unit is attached in the same object as the value. A blank published
 * cell stays NOT_PUBLISHED with a null value; it never becomes zero, and a
 * published zero stays a real zero.
 *
 * Where the edition publishes more than one row for a code, every row is returned
 * separately with its own `situacion`. The rows are NEVER summed, averaged or
 * reconciled: an ámbito total across published rows is a derived quantity the
 * sources do not state, and this function returns no total of any kind.
 */
export function availableBuildability(code, artifact) {
  assertNotCircleShaped(artifact, "availableBuildability");
  const key = exactCode(code);
  const record = key && artifact && artifact.ambitos ? artifact.ambitos[key] : null;
  const edition = editionRecord(artifact, "available_buildability");
  const unavailable = (note) =>
    deepFreeze({
      scope: PLANNING_AMBITO_SCOPE,
      ambitoCode: key,
      availability: AVAILABILITY.NOT_PUBLISHED_IN_EDITION,
      unit: BUILDABILITY_UNIT,
      rows: [],
      rowCount: 0,
      publication: null,
      edition,
      apportionment: APPORTIONMENT_POLICY,
      note,
    });
  if (!record || !record.available_buildability) {
    return unavailable(
      "No record for this ámbito code in the committed state artifact. An absence of published " +
        "evidence, not zero available buildability."
    );
  }
  const buildability = record.available_buildability;
  if (buildability.availability !== AVAILABILITY.PUBLISHED) {
    return unavailable(buildability.note || null);
  }
  const rows = (buildability.rows || []).map((row) => ({
    situacion: row.situacion ?? null,
    district: { code: row.district_code ?? null, name: row.district_name ?? null },
    denomination: row.denomination ?? null,
    observaciones: row.observaciones ?? null,
    useClasses: USE_CLASS_ORDER.map((field) => {
      const cell = row.use_classes && row.use_classes[field];
      if (!cell) {
        return {
          key: field,
          sourceColumn: null,
          state: VALUE_STATE.NOT_PUBLISHED,
          value: null,
          unit: BUILDABILITY_UNIT,
        };
      }
      return {
        key: field,
        sourceColumn: cell.source_column ?? null,
        state: cell.state,
        // A value exists only in the PUBLISHED state. NOT_PUBLISHED keeps null:
        // missing never becomes zero, and a published 0 stays a real zero.
        value: cell.state === VALUE_STATE.PUBLISHED ? cell.value : null,
        unit: cell.unit || BUILDABILITY_UNIT,
        ...(cell.source_text ? { sourceText: cell.source_text } : {}),
      };
    }),
  }));
  return deepFreeze({
    scope: PLANNING_AMBITO_SCOPE,
    ambitoCode: key,
    availability: AVAILABILITY.PUBLISHED,
    unit: BUILDABILITY_UNIT,
    publication: buildability.publication,
    rowCount: buildability.row_count ?? rows.length,
    multiplicityCause: buildability.cause ?? null,
    multiplicityDetail: buildability.detail ?? null,
    rows,
    edition,
    apportionment: APPORTIONMENT_POLICY,
  });
}

// ======================================================================== index

function boundingBox(geometry) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === "number") {
      if (coords[0] < minLon) minLon = coords[0];
      if (coords[0] > maxLon) maxLon = coords[0];
      if (coords[1] < minLat) minLat = coords[1];
      if (coords[1] > maxLat) maxLat = coords[1];
      return;
    }
    for (const child of coords) walk(child);
  };
  walk(geometry.coordinates);
  return { minLon, minLat, maxLon, maxLat };
}

function outsideBox(lon, lat, box) {
  return lon < box.minLon || lon > box.maxLon || lat < box.minLat || lat > box.maxLat;
}

// Accept either a raw FeatureCollection or an index built by createPlanningIndex,
// so the free functions above work with both and no caller has to choose.
function featureListOf(ambitos) {
  if (!ambitos) return null;
  if (Array.isArray(ambitos.entries)) return ambitos.entries;
  const features = ambitos.features;
  if (!Array.isArray(features)) return null;
  return features
    .filter((feature) => feature && feature.geometry && feature.properties)
    .map((feature) => ({
      code: feature.properties.ambito_code,
      denomination: feature.properties.ambito_denomination ?? null,
      geometry: feature.geometry,
      feature,
      box: boundingBox(feature.geometry),
    }));
}

/**
 * Build a lookup index over the two committed planning artifacts.
 *
 * A performance wrapper, not a second model: every answer is produced by the pure
 * functions above. Bounding boxes are precomputed once so dragging a Lens scans
 * boxes rather than rings, and the containing-ámbito hint reuses the previous
 * answer first. The hint is a performance hint only, never a semantic one: a miss
 * falls through to the ordinary scan and the result is identical either way.
 *
 * Returns null for an unusable geometry artifact, so an absent ámbito layer stays
 * absent rather than becoming an index that reports every point as outside.
 */
export function createPlanningIndex({ geometry, state } = {}) {
  const entries = featureListOf(geometry);
  if (!entries || entries.length === 0) return null;
  entries.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const stateArtifact = state && typeof state === "object" && state.ambitos ? state : null;

  return {
    entries,
    counts: {
      ambitos: entries.length,
      withPublishedState: stateArtifact
        ? Object.values(stateArtifact.ambitos).filter(
            (record) => record.development_state && record.development_state.availability === AVAILABILITY.PUBLISHED
          ).length
        : 0,
      withPublishedBuildability: stateArtifact
        ? Object.values(stateArtifact.ambitos).filter(
            (record) =>
              record.available_buildability &&
              record.available_buildability.availability === AVAILABILITY.PUBLISHED
          ).length
        : 0,
    },
    editions: deepFreeze({
      developmentState: editionRecord(stateArtifact, "development_state"),
      availableBuildability: editionRecord(stateArtifact, "available_buildability"),
    }),

    ambitoContaining(lon, lat, hintCode = null) {
      if (hintCode != null) {
        const hinted = byCode.get(hintCode);
        if (hinted && !outsideBox(lon, lat, hinted.box) && pointInGeometry(lon, lat, hinted.geometry)) {
          return ambitoContaining({ lon, lat }, { entries: [hinted] });
        }
      }
      return ambitoContaining({ lon, lat }, this);
    },

    ambitosIntersecting(lon, lat, radiusM) {
      return ambitosIntersecting({ lon, lat, radiusM }, this);
    },

    developmentState(code) {
      return developmentState(code, stateArtifact);
    },

    availableBuildability(code) {
      return availableBuildability(code, stateArtifact);
    },

    // The artifact's own GeoJSON feature, for the map layer. The object belongs to
    // the artifact and must not be mutated.
    featureFor(code) {
      const entry = byCode.get(code);
      return entry ? entry.feature : null;
    },
  };
}

/**
 * Browser convenience: fetch both committed artifacts and build the index.
 *
 * Kept separate from the pure core so tests never need the network, and pointed
 * at COMMITTED repository paths only. No official planning service is ever
 * requested from the browser.
 */
export async function loadPlanningIndex(
  geometryUrl = "data/planning/madrid_ambitos.geojson",
  stateUrl = "data/planning/madrid_ambito_state.json"
) {
  if (typeof fetch !== "function") {
    throw new Error("loadPlanningIndex requires fetch; pass data to createPlanningIndex instead");
  }
  const [geometryResponse, stateResponse] = await Promise.all([fetch(geometryUrl), fetch(stateUrl)]);
  if (!geometryResponse.ok) throw new Error(`planning: failed to load ${geometryUrl} (${geometryResponse.status})`);
  if (!stateResponse.ok) throw new Error(`planning: failed to load ${stateUrl} (${stateResponse.status})`);
  const [geometry, state] = await Promise.all([geometryResponse.json(), stateResponse.json()]);
  return createPlanningIndex({ geometry, state });
}
