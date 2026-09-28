// Pure accommodation filtering helpers. No DOM/Leaflet dependency.

function filterPoiPointsByStayKind(points, stayKind = "all") {
  if (!stayKind || stayKind === "all") return points;
  return points.filter((p) => p.type !== "stay" || p.stayKind === stayKind);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { filterPoiPointsByStayKind };
}
