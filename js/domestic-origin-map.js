// Madrid domestic-origin map. Pure model only: it joins the already validated,
// ranked published origins (domestic-origin-context.js) to IGN municipality
// reference points. domestic-origin-context.js itself still never sees a
// coordinate. No flow line, total, share, "Other" bucket or unpublished origin is
// ever derived here.
export const MAP_STATE = { UNAVAILABLE: "unavailable", AVAILABLE: "available" };
export const MAP_LIMITS = [10, 25];
export const MAP_DEFAULT_LIMIT = 10;
export const MAP_MAX_RADIUS_PX = 24;
export const MADRID_MUNICIPALITY_CODE = "28079";
// Integrity envelope (Spain incl. Canary Islands); catches swapped or mis-scaled
// coordinates, it is not an analytical boundary.
const LON_RANGE = [-19, 5];
const LAT_RANGE = [27, 44.5];
export const MAP_DICTIONARIES = {
  en: { limitLabel: "Origins shown", limitOption: "Top {n}", mapTitle: "Map of top published origins · {month}", mapCount: "Showing {placed} of the {shown} highest published origin municipalities on the map.", mapScale: "Circle area is proportional to source-reported tourists, relative to the largest circle shown, from a zero baseline. Each circle sits at the municipality's IGN reference point inside its main population nucleus, not at the centre of its territory. The map shows no flows, routes or shares; unpublished origins are not zero.", mapAria: "Map of the {shown} highest published origin municipalities for {month}. The ranked chart and the table on this page give the same values.", destination: "Madrid (destination)", unplaced: "Not placed on the map (no reference point): {list}.", attribution: "Municipality reference points © Instituto Geográfico Nacional (IGN-CNIG), NGMEP {edition}.", unavailable: "Origin map unavailable." },
  es: { limitLabel: "Orígenes mostrados", limitOption: "Top {n}", mapTitle: "Mapa de principales orígenes publicados · {month}", mapCount: "Se muestran en el mapa {placed} de los {shown} municipios de origen publicados con más turistas.", mapScale: "El área de cada círculo es proporcional a los turistas comunicados por la fuente, relativa al círculo mayor mostrado y desde una base cero. Cada círculo se sitúa en el punto de referencia del IGN del municipio, dentro de su núcleo de población principal, no en el centro de su término. El mapa no muestra flujos, rutas ni cuotas; los orígenes no publicados no son cero.", mapAria: "Mapa de los {shown} municipios de origen publicados con más turistas en {month}. El gráfico ordenado y la tabla de esta página contienen los mismos valores.", destination: "Madrid (destino)", unplaced: "Sin colocar en el mapa (sin punto de referencia): {list}.", attribution: "Puntos de referencia municipales © Instituto Geográfico Nacional (IGN-CNIG), NGMEP {edition}.", unavailable: "Mapa de orígenes no disponible." },
};
const inRange = (value, [min, max]) => Number.isFinite(value) && value >= min && value <= max;
export function createMunicipalityPointIndex(artifact) {
  const points = artifact?.points;
  if (!points || typeof points !== "object" || Array.isArray(points) || artifact.coordinates?.order !== "[longitude, latitude]" || !/^\d{4}-\d{2}$/.test(artifact.source?.edition || "")) return null;
  const byCode = new Map();
  for (const [code, point] of Object.entries(points)) {
    if (!/^\d{5}$/.test(code) || !Array.isArray(point) || point.length !== 2 || !inRange(point[0], LON_RANGE) || !inRange(point[1], LAT_RANGE)) return null;
    byCode.set(code, { lon: point[0], lat: point[1] });
  }
  if (!byCode.size || byCode.size !== artifact.record_count || !byCode.has(MADRID_MUNICIPALITY_CODE)) return null;
  return { byCode, edition: artifact.source.edition, source: artifact.source };
}
// `model` is the AVAILABLE output of buildDomesticOriginContext (sorted, validated).
export function buildDomesticOriginMapModel({ model, pointIndex, limit = MAP_DEFAULT_LIMIT } = {}) {
  const empty = { state: MAP_STATE.UNAVAILABLE, month: model?.month ?? null, limit, shown: 0, total: 0, points: [], unplaced: [], destination: null, edition: null };
  if (!pointIndex || !model || model.state !== "available" || !model.origins.length || !MAP_LIMITS.includes(limit)) return empty;
  const top = model.origins.slice(0, limit); const max = top[0].source_reported_tourists;
  const points = []; const unplaced = [];
  top.forEach((origin, index) => {
    const base = { position: index + 1, code: origin.origin_municipality_code, name: origin.origin_municipality_name, count: origin.source_reported_tourists, countDisplay: origin.countDisplay };
    const at = pointIndex.byCode.get(base.code);
    if (at) points.push({ ...base, lat: at.lat, lon: at.lon, radiusPx: MAP_MAX_RADIUS_PX * Math.sqrt(base.count / max) });
    else unplaced.push(base);
  });
  const madrid = pointIndex.byCode.get(MADRID_MUNICIPALITY_CODE);
  return { state: MAP_STATE.AVAILABLE, month: model.month, limit, shown: top.length, total: model.origins.length, points, unplaced, destination: { code: MADRID_MUNICIPALITY_CODE, lat: madrid.lat, lon: madrid.lon }, edition: pointIndex.edition };
}
