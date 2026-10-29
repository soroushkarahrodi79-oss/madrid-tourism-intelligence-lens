// Unified geographic search — pure discovery core (M1).
//
// ONE deterministic resolver over the geographic entity universes this project
// has ALREADY committed and already validated:
//
//   * official planning ámbitos  — data/planning/madrid_ambitos.geojson, through
//                                  the existing index from js/planning-ambito.js
//   * official barrios           — data/geography/madrid_admin.geojson, through
//   * official districts           the existing index from js/geography.js
//   * the municipality
//
// It introduces NO new data source, NO geocoder and NO second geometry parse. It
// is a lookup over indices the application already builds for its analytical
// work, so search can never disagree with the evidence surfaces about what an
// entity is or where it is.
//
// WHAT A RESULT IS
// ----------------
// A result is ENTITY DISCOVERY and nothing else: a type, an official identifier,
// an official denomination and — only where the authoritative source states it —
// a parent area. A result carries no quantity, no state, no date, no density and
// no score. Result ORDER reflects textual match quality only (how the query
// matched the text) and is never an analytical ranking, a recommendation or a
// statement that one area matters more than another.
//
// ENTITY TYPES STAY DISTINCT
// --------------------------
// A barrio, a district, a planning ámbito, the municipality and a Lens circle are
// different analytical entities. This module keeps the type on every result and
// never merges or substitutes one for another, even when two geometries overlap
// or two names coincide. It performs no whole-to-part transformation of any kind:
// it reports no overlap, no fraction and no apportioned value.
//
// This module is deliberately PURE: no DOM, no Leaflet, no fetch, no globals, no
// clock. `js/app.js` owns every side effect (camera movement, highlight drawing,
// Lens movement), so none of them can happen as a consequence of searching.

import { pointInGeometry } from "./geography.js";

export const GEO_SEARCH_RESULT_LIMIT = 8;

// Declared presentation order for results that tie on match quality AND on name.
// This is STABILITY ONLY — a deterministic tie-break so the same query always
// renders the same list. It is not importance, relevance or priority.
const TYPE_ORDER = Object.freeze(["MUNICIPALITY", "DISTRICT", "BARRIO", "AMBITO"]);

export const GEO_ENTITY_TYPES = TYPE_ORDER;

/**
 * Fold text for accent- and case-insensitive matching.
 *
 * Unicode NFD decomposition then removal of combining marks, then lower case.
 * "Pacífico" and "pacifico" fold to the same key, as do "Argüelles"/"arguelles"
 * and "VICÁLVARO"/"vicalvaro". Folding is used for MATCHING ONLY: every value
 * shown to a reader is the official value, carried verbatim and never folded,
 * stripped or re-cased.
 */
export function foldText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function entry({ type, code, name, parentId = null, parentName = null }) {
  const officialName = typeof name === "string" && name.trim() ? name : null;
  return Object.freeze({
    // Globally unique, stable across sessions and renders: the type plus the
    // source's own official identifier. Two entities of different types may
    // legitimately share a code (district "21" and barrio "211" do not, but the
    // type prefix makes that impossible to confuse in any case).
    id: `${type}:${code}`,
    type,
    code,
    name: officialName,
    parentId,
    parentName,
    foldedName: foldText(officialName),
    foldedCode: foldText(code),
  });
}

/**
 * Build the unified search index over indices the application already has.
 *
 * Both arguments are OPTIONAL and independent. A missing or unusable universe is
 * recorded in `coverage` as absent rather than silently treated as empty, so the
 * surface can say "planning ámbitos are not loaded" instead of "no results" —
 * an absence of a source is never reported as an absence of the entity.
 *
 * Pure: the geography and planning indices are READ, never mutated, and their
 * GeoJSON features are referenced, never copied or rewritten.
 */
export function createGeoSearchIndex({ geography = null, planning = null } = {}) {
  const entries = [];
  const coverage = { administrative: false, ambito: false };

  if (geography && typeof geography.featuresByLevel === "function") {
    const levels = [
      ["municipality", "MUNICIPALITY"],
      ["district", "DISTRICT"],
      ["barrio", "BARRIO"],
    ];
    let seen = 0;
    for (const [level, type] of levels) {
      for (const feature of geography.featuresByLevel(level) || []) {
        const properties = feature?.properties;
        if (!properties || properties.official_id == null) continue;
        entries.push(entry({
          type,
          code: String(properties.official_id),
          name: properties.official_name,
          parentId: properties.parent_id == null ? null : String(properties.parent_id),
          parentName: properties.parent_name ?? null,
        }));
        seen += 1;
      }
    }
    coverage.administrative = seen > 0;
  }

  if (planning && Array.isArray(planning.entries)) {
    let seen = 0;
    for (const record of planning.entries) {
      if (!record || !record.code) continue;
      entries.push(entry({ type: "AMBITO", code: String(record.code), name: record.denomination }));
      seen += 1;
    }
    coverage.ambito = seen > 0;
  }

  // Deterministic base order, so every tier below is stable before ranking.
  entries.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.id.localeCompare(b.id));

  // Names that more than one entity in the WHOLE index carries, after folding.
  // Any result whose name is in here is flagged ambiguous, so a surface can
  // never present it as a uniquely identified place on the strength of the name.
  const nameCounts = new Map();
  for (const item of entries) {
    if (!item.foldedName) continue;
    nameCounts.set(item.foldedName, (nameCounts.get(item.foldedName) || 0) + 1);
  }

  const byId = new Map(entries.map((item) => [item.id, item]));
  const counts = { total: entries.length };
  for (const type of TYPE_ORDER) counts[type] = entries.filter((item) => item.type === type).length;

  return Object.freeze({
    entries: Object.freeze(entries),
    counts: Object.freeze(counts),
    coverage: Object.freeze({ ...coverage }),
    ambiguousName(foldedName) {
      return (nameCounts.get(foldedName) || 0) > 1;
    },
    byId(id) {
      return byId.get(id) || null;
    },
  });
}

// Match KINDS, best textual match first. The kind is reported on every result
// so a surface can explain WHY something matched. It is deliberately not called a
// tier, level or band: it describes HOW the text matched and carries no severity,
// no score and no judgement about the place.
const MATCH = Object.freeze({
  EXACT_CODE: 0,
  EXACT_NAME: 1,
  CODE_PREFIX: 2,
  NAME_PREFIX: 3,
  NAME_CONTAINS: 4,
});
const MATCH_NAME = Object.freeze(["EXACT_CODE", "EXACT_NAME", "CODE_PREFIX", "NAME_PREFIX", "NAME_CONTAINS"]);

function matchKindFor(item, typed, folded) {
  // An exact official code is the strongest possible identification. `typed` is
  // the query with only surrounding whitespace removed — no case folding and no
  // accent folding — so a reader who types the canonical identifier matches it
  // character for character; the folded comparison then also accepts the same
  // code typed in another case.
  if (item.code === typed || (folded && item.foldedCode === folded)) return MATCH.EXACT_CODE;
  if (item.foldedName && item.foldedName === folded) return MATCH.EXACT_NAME;
  if (folded && item.foldedCode.startsWith(folded)) return MATCH.CODE_PREFIX;
  if (item.foldedName && item.foldedName.startsWith(folded)) return MATCH.NAME_PREFIX;
  if (item.foldedName && item.foldedName.includes(folded)) return MATCH.NAME_CONTAINS;
  return null;
}

/**
 * Resolve a query against the unified index.
 *
 * Deterministic in full: the same index and the same query always produce the
 * same results in the same order. Matching is textual only — there is no fuzzy
 * distance, no synonym list, no alias table and no spelling correction, because
 * none of those could be justified against an official register without
 * inventing an identity the source does not publish.
 *
 * Returns a frozen reading:
 *   state     "unavailable" (no universe loaded) | "empty" (no query) |
 *             "not_found"   (query matched nothing) | "results"
 *   results   up to `limit` frozen identity records, each with `match`,
 *             `ambiguous` and `truncated` context
 *   coverage  which universes the answer was computed over, so a "not_found"
 *             is always readable together with what was actually searched
 *   total     how many entities matched before the limit was applied
 */
export function searchGeoEntities(index, query, limit = GEO_SEARCH_RESULT_LIMIT) {
  const raw = typeof query === "string" ? query : "";
  const trimmed = raw.trim();
  const emptyCoverage = Object.freeze({ administrative: false, ambito: false });

  if (!index || !Array.isArray(index.entries) || index.entries.length === 0) {
    return Object.freeze({ state: "unavailable", query: raw, results: Object.freeze([]), coverage: index?.coverage ?? emptyCoverage, total: 0 });
  }
  if (!trimmed) {
    return Object.freeze({ state: "empty", query: raw, results: Object.freeze([]), coverage: index.coverage, total: 0 });
  }

  const folded = foldText(trimmed);
  const maximum = Number.isInteger(limit) && limit > 0 ? limit : GEO_SEARCH_RESULT_LIMIT;

  const matched = [];
  for (const item of index.entries) {
    const kind = matchKindFor(item, trimmed, folded);
    if (kind == null) continue;
    matched.push({ item, kind });
  }

  // Order: match kind, then the declared type order, then the stable id. Name
  // length, geometry size, population and every other magnitude are deliberately
  // NOT part of the ordering, so the list cannot read as a ranking of places.
  matched.sort((a, b) =>
    a.kind - b.kind ||
    TYPE_ORDER.indexOf(a.item.type) - TYPE_ORDER.indexOf(b.item.type) ||
    a.item.id.localeCompare(b.item.id));

  const results = matched.slice(0, maximum).map(({ item, kind }) => Object.freeze({
    id: item.id,
    type: item.type,
    code: item.code,
    name: item.name,
    parentId: item.parentId,
    parentName: item.parentName,
    match: MATCH_NAME[kind],
    // True when another entity in the index carries the same folded name. The
    // surface must then show the official code as the distinguishing identity and
    // must not present the result as uniquely identified by its name.
    ambiguous: Boolean(item.foldedName) && index.ambiguousName(item.foldedName),
  }));

  return Object.freeze({
    state: matched.length ? "results" : "not_found",
    query: raw,
    results: Object.freeze(results),
    coverage: index.coverage,
    total: matched.length,
    truncated: matched.length > results.length,
  });
}

// ---------------------------------------------------------------------------
// Verified interior point
// ---------------------------------------------------------------------------

function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function envelopeOf(geometry) {
  let minLon = Infinity; let minLat = Infinity; let maxLon = -Infinity; let maxLat = -Infinity;
  const walk = (coordinates) => {
    if (typeof coordinates[0] === "number") {
      if (coordinates[0] < minLon) minLon = coordinates[0];
      if (coordinates[0] > maxLon) maxLon = coordinates[0];
      if (coordinates[1] < minLat) minLat = coordinates[1];
      if (coordinates[1] > maxLat) maxLat = coordinates[1];
      return;
    }
    for (const child of coordinates) walk(child);
  };
  if (!geometry || !geometry.coordinates) return null;
  walk(geometry.coordinates);
  return Number.isFinite(minLon) ? { minLon, minLat, maxLon, maxLat } : null;
}

// Every longitude at which the horizontal line `lat` crosses a ring edge, for
// all rings of all polygons. The even-odd rule then pairs consecutive crossings
// into spans that lie INSIDE the geometry, holes included, because a hole's own
// edges contribute their crossings too.
function crossingsAt(geometry, lat) {
  const xs = [];
  for (const polygon of ringsOf(geometry)) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i += 1) {
        const [x1, y1] = ring[i - 1];
        const [x2, y2] = ring[i];
        if (y1 === y2) continue;
        if ((y1 > lat) === (y2 > lat)) continue;
        xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
  }
  return xs.sort((a, b) => a - b);
}

/**
 * A point that is VERIFIED to lie inside a Polygon / MultiPolygon, or null.
 *
 * A polygon's geometric centroid is NOT assumed to be inside it: for a concave,
 * ring-shaped, multi-part or crescent ámbito it frequently is not, and Madrid's
 * official planning geometry is entirely MultiPolygon. The method is instead:
 *
 *   1. try the envelope centre — cheap, and correct for most convex shapes;
 *   2. otherwise scan a fixed ladder of horizontal lines across the envelope and
 *      compute candidate span midpoints on each by the even-odd rule;
 *   3. verify candidates, widest span first, with the project's single
 *      containment implementation, `pointInGeometry`, and return the first that
 *      containment CONFIRMS.
 *
 * Step 3 verifies every candidate in turn rather than only the widest, because
 * the two rules disagree on one real shape in Madrid's official planning
 * geometry: 10 of the 724 ámbitos pack a second, DISJOINT ring into one polygon,
 * which `pointInPolygonRings` treats as a hole (its interior is therefore
 * outside the entity) while the even-odd scan reads it as inside. Containment is
 * the authority; the scan only proposes.
 *
 * Nothing is returned that containment does not confirm. When no candidate
 * verifies, this returns NULL and the caller must withhold the capability that
 * needed an interior point rather than fall back to a centroid, a bounding-box
 * centre or any other unverified coordinate.
 *
 * Deterministic: the ladder is fixed and candidates are ordered by span width
 * then by coordinate, so the same geometry always yields the same point.
 * Coordinates are GeoJSON order — longitude first, then latitude.
 */
export function interiorPointOf(geometry, ladder = 33) {
  const box = envelopeOf(geometry);
  if (!box) return null;

  const centre = { lon: (box.minLon + box.maxLon) / 2, lat: (box.minLat + box.maxLat) / 2 };
  if (pointInGeometry(centre.lon, centre.lat, geometry)) return Object.freeze({ ...centre, method: "ENVELOPE_CENTRE" });

  const steps = Number.isInteger(ladder) && ladder >= 3 ? ladder : 33;
  const height = box.maxLat - box.minLat;
  if (!(height > 0)) return null;

  const candidates = [];
  for (let i = 1; i < steps; i += 1) {
    const lat = box.minLat + (height * i) / steps;
    const xs = crossingsAt(geometry, lat);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const width = xs[k + 1] - xs[k];
      if (width <= 0) continue;
      candidates.push({ width, lon: (xs[k] + xs[k + 1]) / 2, lat });
    }
  }
  candidates.sort((a, b) => b.width - a.width || a.lat - b.lat || a.lon - b.lon);
  for (const candidate of candidates) {
    if (pointInGeometry(candidate.lon, candidate.lat, geometry)) {
      return Object.freeze({ lon: candidate.lon, lat: candidate.lat, method: "WIDEST_INTERIOR_SPAN" });
    }
  }
  return null;
}
