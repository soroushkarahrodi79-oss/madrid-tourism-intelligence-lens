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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { haversineMeters, poiStatsInLens, deltaOrDash };
}
