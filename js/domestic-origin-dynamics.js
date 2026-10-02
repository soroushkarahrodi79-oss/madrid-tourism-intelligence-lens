// Domestic-origin month comparison. This is a pure transformation of the
// validated Domestic Origin index: absent rows remain absent, never zero.
export const DYNAMICS_STATE = {
  UNAVAILABLE: "unavailable",
  MONTH_UNAVAILABLE: "month_unavailable",
  NO_ADJACENT_PRIOR_MONTH: "no_adjacent_prior_month",
  CURRENT_MONTH_EMPTY: "current_month_empty",
  NO_SHARED_ORIGINS: "no_shared_origins",
  AVAILABLE: "available",
};

export const DYNAMICS_DISCLOSURE = "Changes in published presence do not necessarily mean an origin gained or lost tourists. Only crossings above 30 tourists are published, so municipalities may enter or leave the published set when they cross the publication threshold.";

export const DYNAMICS_DICTIONARIES = {
  en: {
    heading: "Monthly origin dynamics",
    relationship: "Current source month: {current} · Previous source month: {previous}",
    currentPublished: "Current published origins",
    previousPublished: "Previous published origins",
    shared: "Published in both months",
    newlyPresent: "Newly present in published set",
    noLongerPresent: "No longer present in published set",
    sharedHeading: "Largest observed changes among origins published in both months",
    origin: "Origin municipality",
    previous: "Previous",
    current: "Current",
    observedChange: "Observed count change",
    currentPublishedCount: "Current published count",
    previousPublishedCount: "Previous published count",
    noPrior: "No exact previous calendar month is available for this source month.",
    unavailable: "Monthly origin dynamics unavailable.",
    monthUnavailable: "The selected source month is unavailable.",
    emptyCurrent: "The current source month contains zero published origins.",
    noShared: "No origin municipalities were published in both source months.",
    disclosure: DYNAMICS_DISCLOSURE,
  },
  es: {
    heading: "Dinámica mensual de orígenes",
    relationship: "Mes de referencia actual: {current} · Mes de referencia anterior: {previous}",
    currentPublished: "Orígenes publicados actuales",
    previousPublished: "Orígenes publicados anteriores",
    shared: "Publicado en ambos meses",
    newlyPresent: "Nueva presencia en el conjunto publicado",
    noLongerPresent: "Ya no aparece en el conjunto publicado",
    sharedHeading: "Mayores variaciones observadas entre los orígenes publicados en ambos meses",
    origin: "Municipio de origen",
    previous: "Anterior",
    current: "Actual",
    observedChange: "Variación observada del recuento",
    currentPublishedCount: "Recuento publicado actual",
    previousPublishedCount: "Recuento publicado anterior",
    noPrior: "No hay un mes natural anterior exacto disponible para este mes de referencia.",
    unavailable: "Dinámica mensual de orígenes no disponible.",
    monthUnavailable: "El mes de referencia seleccionado no está disponible.",
    emptyCurrent: "El mes de referencia actual contiene cero orígenes publicados.",
    noShared: "No hay municipios de origen publicados en ambos meses de referencia.",
    disclosure: "Los cambios de presencia publicada no implican necesariamente que un origen haya ganado o perdido turistas. Solo se publican cruces con más de 30 turistas, por lo que un municipio puede entrar o salir del conjunto publicado al cruzar el umbral de publicación.",
  },
};

function isMonth(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function previousCalendarMonth(month) {
  if (!isMonth(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 1
    ? `${String(year - 1).padStart(4, "0")}-12`
    : `${String(year).padStart(4, "0")}-${String(monthNumber - 1).padStart(2, "0")}`;
}

function emptyModel(state, currentMonth = null, previousMonth = null) {
  return {
    state,
    currentMonth,
    previousMonth,
    summary: null,
    shared: [],
    newlyPresent: [],
    noLongerPresent: [],
  };
}

function countChange(current, previous) {
  const absoluteChange = current - previous;
  return {
    absoluteChange,
    percentChange: (absoluteChange / previous) * 100,
  };
}

function identity(origin) {
  return {
    origin_municipality_code: origin.origin_municipality_code,
    origin_municipality_name: origin.origin_municipality_name,
    origin_province_code: origin.origin_province_code,
    origin_province_name: origin.origin_province_name,
  };
}

// The only accepted input is the validated index plus the selected source
// month. Exact calendar adjacency is intentional: a missing month abstains
// rather than being silently replaced by the nearest older publication.
export function compareDomesticOriginMonths(index, currentMonth = null) {
  if (!index || !(index.byMonth instanceof Map) || !Array.isArray(index.months)) {
    return emptyModel(DYNAMICS_STATE.UNAVAILABLE);
  }

  const selected = currentMonth || index.latest;
  if (!isMonth(selected) || !index.byMonth.has(selected)) {
    return emptyModel(DYNAMICS_STATE.MONTH_UNAVAILABLE, selected);
  }

  const prior = previousCalendarMonth(selected);
  if (!prior || !index.byMonth.has(prior)) {
    return emptyModel(DYNAMICS_STATE.NO_ADJACENT_PRIOR_MONTH, selected, prior);
  }

  const currentOrigins = index.byMonth.get(selected);
  const previousOrigins = index.byMonth.get(prior);
  if (!Array.isArray(currentOrigins) || !Array.isArray(previousOrigins)) {
    return emptyModel(DYNAMICS_STATE.UNAVAILABLE, selected, prior);
  }

  const currentByCode = new Map(currentOrigins.map((origin) => [origin.origin_municipality_code, origin]));
  const previousByCode = new Map(previousOrigins.map((origin) => [origin.origin_municipality_code, origin]));
  const shared = [];
  const newlyPresent = [];
  const noLongerPresent = [];

  for (const origin of currentOrigins) {
    const previous = previousByCode.get(origin.origin_municipality_code);
    if (!previous) {
      newlyPresent.push({ ...identity(origin), previousCount: null, currentCount: origin.source_reported_tourists, absoluteChange: null, percentChange: null });
      continue;
    }
    const change = countChange(origin.source_reported_tourists, previous.source_reported_tourists);
    shared.push({ ...identity(origin), previousCount: previous.source_reported_tourists, currentCount: origin.source_reported_tourists, ...change });
  }
  for (const origin of previousOrigins) {
    if (!currentByCode.has(origin.origin_municipality_code)) {
      noLongerPresent.push({ ...identity(origin), previousCount: origin.source_reported_tourists, currentCount: null, absoluteChange: null, percentChange: null });
    }
  }

  shared.sort((a, b) => Math.abs(b.absoluteChange) - Math.abs(a.absoluteChange) || b.currentCount - a.currentCount || a.origin_municipality_name.localeCompare(b.origin_municipality_name));
  newlyPresent.sort((a, b) => b.currentCount - a.currentCount || a.origin_municipality_name.localeCompare(b.origin_municipality_name));
  noLongerPresent.sort((a, b) => b.previousCount - a.previousCount || a.origin_municipality_name.localeCompare(b.origin_municipality_name));

  const model = {
    state: DYNAMICS_STATE.AVAILABLE,
    currentMonth: selected,
    previousMonth: prior,
    summary: {
      currentPublishedOrigins: currentOrigins.length,
      previousPublishedOrigins: previousOrigins.length,
      sharedOrigins: shared.length,
      newlyPresentOrigins: newlyPresent.length,
      noLongerPresentOrigins: noLongerPresent.length,
    },
    shared,
    newlyPresent,
    noLongerPresent,
  };
  if (currentOrigins.length === 0) model.state = DYNAMICS_STATE.CURRENT_MONTH_EMPTY;
  else if (shared.length === 0) model.state = DYNAMICS_STATE.NO_SHARED_ORIGINS;
  return model;
}
