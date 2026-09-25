// Pure, deterministic lens geometry and statistics. No Leaflet/DOM
// dependency in this file so it can be unit-tested with plain Node.

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

// Descriptive-only statistics for the POI layers inside a lens: counts,
// category mix, and nearest features. Does not interpret counts as quality,
// pressure, or attractiveness.
function poiStatsInLens(points, center, radiusM) {
  const inside = points
    .map((p) => ({ ...p, d: haversineMeters(center, p) }))
    .filter((p) => p.d <= radiusM);

  const count = (t) => inside.filter((p) => p.type === t).length;
  const museum = count("museum");
  const info = count("info");
  const stay = count("stay");
  const bike = count("bike");

  return {
    museum,
    info,
    stay,
    bike,
    tourism: museum + info,
    total: museum + info + stay + bike,
    nearest: [...inside].sort((a, b) => a.d - b.d).slice(0, 5),
  };
}

function deltaOrDash(a, b, suffix = "") {
  if (a == null || b == null) return null;
  const d = b - a;
  const rounded = Number.isInteger(d) ? d : Math.round(d * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}${suffix}`;
}

// Worst-case status across a set of layers: unavailable > snapshot > live.
// Used so a combined metric (e.g. "Tourism POIs" = museums + info) inherits
// the least-trustworthy status of its contributing layers.
function combinedStatus(statusMap, names) {
  const statuses = names.map((n) => statusMap[n]).filter(Boolean);
  if (statuses.includes("unavailable")) return "unavailable";
  if (statuses.includes("snapshot")) return "snapshot";
  return "live";
}

// A comparison delta must never let an unavailable layer produce a numeric
// "0 vs 0", and must never let a partial snapshot sample masquerade as an
// exhaustive live comparison.
function comparisonDelta(status, a, b, suffix = "") {
  if (status === "unavailable") return "—";
  const d = deltaOrDash(a, b, suffix);
  if (d == null) return "—";
  return status === "snapshot" ? `${d} sample` : d;
}

// Category-mix shares for the "Category mix" card. A category on an
// unavailable layer never gets a fabricated 0% share (na: true instead), and
// the denominator only sums categories that are actually known. The overall
// label flags when the mix is a partial sample and/or missing a category.
function categoryMixState(counts, statuses) {
  const keys = Object.keys(counts);
  const knownKeys = keys.filter((k) => statuses[k] !== "unavailable");
  const total = knownKeys.reduce((sum, k) => sum + counts[k], 0);

  const rows = {};
  for (const k of keys) {
    rows[k] = statuses[k] === "unavailable" ? { na: true } : { pct: total ? Math.round((counts[k] / total) * 100) : 0 };
  }

  const anySnapshot = knownKeys.some((k) => statuses[k] === "snapshot");
  const anyUnavailable = keys.some((k) => statuses[k] === "unavailable");
  let label = "";
  if (anySnapshot && anyUnavailable) label = "Sample mix · not exhaustive · some categories unavailable";
  else if (anySnapshot) label = "Sample mix · not exhaustive";
  else if (anyUnavailable) label = "Some categories unavailable";

  return { rows, label };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    haversineMeters,
    poiStatsInLens,
    deltaOrDash,
    combinedStatus,
    comparisonDelta,
    categoryMixState,
  };
}
