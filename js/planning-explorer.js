// Planning-ámbito Explorer V1: pure discovery helpers.
//
// This module deliberately does not know about Leaflet, Lens state or map
// cameras. It searches the already-indexed committed official geometry and
// returns identity-only results. Rendering and any explicit map movement stay
// in js/app.js, separate from analytical calculations.

export const EXPLORER_RESULT_LIMIT = 6;

function folded(value) {
  return String(value || "").toLocaleLowerCase("es-ES");
}

/**
 * Search the committed official ámbito universe.
 *
 * A code result is exact: no trimming, case folding, suffix removal or fuzzy
 * fallback is permitted. Denomination matching is a separate convenience path
 * and is enabled only when the committed geometry actually carries a non-empty
 * denomination for an entry. Results never contain any planning quantity.
 */
export function searchPlanningAmbitos(index, query, limit = EXPLORER_RESULT_LIMIT) {
  if (!index || !Array.isArray(index.entries)) {
    return Object.freeze({ state: "unavailable", query: String(query || ""), results: Object.freeze([]) });
  }
  const raw = typeof query === "string" ? query : "";
  if (!raw) return Object.freeze({ state: "empty", query: raw, results: Object.freeze([]) });

  const exact = index.entries.find((entry) => entry.code === raw);
  if (exact) return Object.freeze({ state: "results", query: raw, results: Object.freeze([identity(exact)]) });

  const needle = folded(raw);
  const maximum = Number.isInteger(limit) && limit > 0 ? limit : EXPLORER_RESULT_LIMIT;
  const matches = index.entries
    .filter((entry) => typeof entry.denomination === "string" && entry.denomination.trim() && folded(entry.denomination).includes(needle))
    .slice(0, maximum)
    .map(identity);
  return Object.freeze({ state: matches.length ? "results" : "not_found", query: raw, results: Object.freeze(matches) });
}

function identity(entry) {
  return Object.freeze({ code: entry.code, denomination: entry.denomination || null });
}
