// Madrid municipality domestic-origin context. Pure artifact -> model only:
// no map, coordinates, Lens radius, barrio or district inputs can reach it.
export const ORIGIN_STATE = { UNAVAILABLE: "unavailable", MONTH_UNAVAILABLE: "month_unavailable", AVAILABLE: "available" };
export const ORIGIN_SCOPE_CAVEAT = "Madrid municipality — not the Lens circle.";
export const ORIGIN_UNIVERSE_CAVEAT = "Published origin municipalities for residents travelling to Madrid from another Spanish province.";
export const ORIGIN_SUPPRESSION_CAVEAT = "Origins may be outside the source universe, including travel within Madrid province; within it, only crossings with more than 30 tourists are published. Missing origins are not zero; this is not a complete domestic-tourism distribution.";
export const ORIGIN_DICTIONARIES = {
  en: { heading: "Domestic origins", official: "Official statistics", month: "Source month", municipality: "Madrid municipality · 28079", universe: ORIGIN_UNIVERSE_CAVEAT, origin: "Origin municipality", tourists: "Source-reported tourists", chartTitle: "Top published origins · {month}", chartCount: "Showing {shown} of {total} published origin municipalities, ranked by source-reported tourists.", chartScale: "Bars start at zero; length is relative to the largest bar shown. This is not the full origin universe, and unpublished origins are not zero.", unavailable: "Domestic-origin context unavailable.", periodUnavailable: "No published origin context for this month.", caveat: ORIGIN_SUPPRESSION_CAVEAT },
  es: { heading: "Orígenes nacionales", official: "Estadísticas oficiales", month: "Mes de referencia", municipality: "Municipio de Madrid · 28079", universe: "Municipios de origen publicados de residentes que viajan a Madrid desde otra provincia española.", origin: "Municipio de origen", tourists: "Turistas comunicados por la fuente", chartTitle: "Principales orígenes publicados · {month}", chartCount: "Se muestran {shown} de {total} municipios de origen publicados, ordenados por turistas comunicados por la fuente.", chartScale: "Las barras parten de cero; su longitud es relativa a la barra mayor mostrada. No es el universo completo de orígenes y los orígenes no publicados no son cero.", unavailable: "Contexto de orígenes nacionales no disponible.", periodUnavailable: "No hay contexto de orígenes publicado para este mes.", caveat: "Algunos orígenes pueden quedar fuera del universo, incluido el viaje dentro de la provincia de Madrid; dentro de él, solo se publican cruces con más de 30 turistas. Los orígenes ausentes no son cero; no es una distribución completa del turismo nacional." },
};
export function formatOriginCount(value) { return Number.isInteger(value) && value >= 0 ? value.toLocaleString("en-GB") : null; }
export function createDomesticOriginIndex(artifact) {
  if (!artifact || artifact.geography?.municipality_code !== "28079" || artifact.source_universe?.same_province_travel_excluded !== true || !Array.isArray(artifact.months) || !artifact.months.length) return null;
  const byMonth=new Map();
  for (const month of artifact.months) {
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month.source_month) || !Array.isArray(month.published_origins) || byMonth.has(month.source_month)) return null;
    const seen=new Set(); const origins=[];
    for (const origin of month.published_origins) {
      if (!origin || ["barrio", "district", "lat", "lon", "geometry", "international"].some((key) => key in origin) || !/^\d{5}$/.test(origin.origin_municipality_code || "") || !/^\d{2}$/.test(origin.origin_province_code || "") || !Number.isInteger(origin.source_reported_tourists) || origin.source_reported_tourists <= 30 || seen.has(origin.origin_municipality_code)) return null;
      seen.add(origin.origin_municipality_code); origins.push({...origin});
    }
    byMonth.set(month.source_month, origins);
  }
  const months=[...byMonth.keys()].sort(); return { byMonth, months, latest: artifact.source_period?.latest && byMonth.has(artifact.source_period.latest) ? artifact.source_period.latest : months.at(-1), source: artifact.source || {} };
}
export function buildDomesticOriginContext({ index, month = null } = {}) {
  if (!index) return { state: ORIGIN_STATE.UNAVAILABLE, month: null, origins: [], scopeCaveat: ORIGIN_SCOPE_CAVEAT, suppressionCaveat: ORIGIN_SUPPRESSION_CAVEAT };
  const selected=month || index.latest;
  if (!index.byMonth.has(selected)) return { state: ORIGIN_STATE.MONTH_UNAVAILABLE, month:selected, origins:[], availableMonths:index.months, scopeCaveat:ORIGIN_SCOPE_CAVEAT, suppressionCaveat:ORIGIN_SUPPRESSION_CAVEAT };
  const origins=index.byMonth.get(selected).slice().sort((a,b)=>b.source_reported_tourists-a.source_reported_tourists || a.origin_municipality_name.localeCompare(b.origin_municipality_name) || a.origin_municipality_code.localeCompare(b.origin_municipality_code)).map((origin)=>({...origin,countDisplay:formatOriginCount(origin.source_reported_tourists)}));
  return { state:ORIGIN_STATE.AVAILABLE, month:selected, origins, availableMonths:index.months, scopeCaveat:ORIGIN_SCOPE_CAVEAT, suppressionCaveat:ORIGIN_SUPPRESSION_CAVEAT };
}
export const ORIGIN_CHART_LIMIT = 10;
// Top-N view of the already validated, sorted model. Bar length is count / largest
// shown count on a zero baseline; no total, share or "Other" is ever derived.
export function buildDomesticOriginRanking(model, limit = ORIGIN_CHART_LIMIT) {
  if (!model || model.state !== ORIGIN_STATE.AVAILABLE || !model.origins.length) return { bars: [], shown: 0, total: 0, month: model?.month ?? null };
  const bars = model.origins.slice(0, limit); const max = bars[0].source_reported_tourists;
  return { month: model.month, shown: bars.length, total: model.origins.length, bars: bars.map((origin) => ({ code: origin.origin_municipality_code, name: origin.origin_municipality_name, count: origin.source_reported_tourists, countDisplay: origin.countDisplay, widthPercent: origin.source_reported_tourists / max * 100 })) };
}
