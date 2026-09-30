// Destination Context: how hotel demand in the city of Madrid changes over time.
//
// THIS IS A CITY-LEVEL SERIES. IT IS NOT A LENS METRIC AND NOT A BARRIO FIGURE.
//
// Everything in this module describes the WHOLE MUNICIPALITY of Madrid for a
// calendar month. Nothing here takes a coordinate, a radius, a barrio or a Lens
// position as input, and nothing it returns may be distributed into a circle or
// an administrative area. Moving either Lens anywhere in Madrid cannot change a
// single value this module produces — that independence is structural, because
// the functions below have no parameter through which a position could arrive.
//
// It is also a SEPARATE ANALYTICAL OBJECT from the Area Profile. The Area
// Profile answers "where is this Lens, and what does the administrative record
// say about that whole barrio". This answers "what does the official hotel
// occupancy survey report for the city, month by month". They share a
// municipality code and nothing else: different universes, different periods,
// different publishers, different kinds of fact.
//
// Hotel demand is not total tourism demand. The survey covers hotel
// establishments only — not tourist apartments, not tourist dwellings (VUT),
// not campsites, not rural accommodation, not day visitors, not anyone in
// unpaid or private accommodation. The interpretation ceiling is stated in full
// in the committed sidecar and in docs/CLAIMS_AND_LIMITATIONS.md, and the one
// sentence that must survive every viewport is HOTEL_SCOPE_CAVEAT below.
//
// Everything here is pure: an artifact in, a view model out. No fetch, no DOM,
// no Leaflet, so it is unit-testable with plain `node --test`. The browser
// wiring in js/app.js renders the models this file returns.

// Whether the module has a usable artifact at all. Deliberately separate from
// "the artifact loaded but this period has no value", which is a null value on
// an available series rather than an unavailable module.
export const DESTINATION_STATE = {
  LOADING: "loading",
  UNAVAILABLE: "unavailable",
  AVAILABLE: "available",
};

// Why a same-month-previous-year comparison is or is not being shown. Each
// refusal is its own state so the interface can say which one happened rather
// than silently omitting a figure.
export const COMPARISON_STATE = {
  AVAILABLE: "available",
  // The month twelve months earlier is not in the series at all.
  NO_PRIOR_PERIOD: "no_prior_period",
  // It is in the series but the source published no value for it (suppressed).
  PRIOR_UNAVAILABLE: "prior_unavailable",
  // The current period has no published value.
  CURRENT_UNAVAILABLE: "current_unavailable",
  // The prior-year value is zero, so a percentage change is undefined. April
  // 2020 is a real published zero in this series, so this is not hypothetical.
  PRIOR_IS_ZERO: "prior_is_zero",
};

// The registry's evidence enum is internal vocabulary. The interface says what
// the evidence IS in plain language; the enum is preserved on the model so the
// semantics stay exact and machine-checkable.
export const EVIDENCE_TYPE = "OFFICIAL_STATISTICAL_SERIES";
export const EVIDENCE_LABEL = "Official statistics";

// The sentence that keeps this figure away from "tourism" wherever it appears.
export const HOTEL_SCOPE_CAVEAT =
  "Hotel establishments only — not all tourism, not all accommodation.";

// The scope reminder that keeps the citywide series away from the Lens.
export const CITY_SCOPE_CAVEAT = "Whole municipality of Madrid — not the Lens circle.";

// Said wherever a provisional figure is shown or compared. The current
// statistical year is published provisional and revised later, so a
// same-month-previous-year comparison routinely puts a provisional figure
// against a definitive one.
export const PROVISIONAL_CAVEAT =
  "Provisional: the source revises the current year's months later.";

export const MUNICIPALITY_NAME = "Madrid";
export const MUNICIPALITY_CODE = "28079";

// How many months the compact trend shows. Two years, so the same month in the
// previous year is visible in the shape rather than only in the comparison line.
export const TREND_MONTHS = 24;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const METRIC_LABELS = {
  travellers: { one: "traveller", many: "travellers" },
  overnight_stays: { one: "overnight stay", many: "overnight stays" },
};

/**
 * "2026-08" -> "August 2026". Written out rather than delegated to Intl so the
 * label is byte-identical on every platform the test matrix runs on.
 */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatPeriod(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ""));
  if (!match) return null;
  const [, year, month] = match;
  const name = MONTH_NAMES[Number(month) - 1];
  if (!name) return null;
  return `${name} ${year}`;
}

/** Compact form for a dense axis or a comparison line: "Aug 2026". */
export function formatPeriodCompact(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ""));
  if (!match) return null;
  const [, year, month] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name) return null;
  return `${name} ${year}`;
}

/** The same month one year earlier. Pure string arithmetic on the period key. */
export function previousYearPeriod(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ""));
  if (!match) return null;
  const [, year, month] = match;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return null;
  return `${Number(year) - 1}-${month}`;
}

/**
 * Group separators for a demand count, matching the rest of the application's
 * en-GB numeric convention so the whole product reads as one numeric system.
 */
export function formatCount(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value).toLocaleString("en-GB");
}

/**
 * The large headline figure, abbreviated only where a full count would not fit.
 * Overnight stays run to seven digits, and "1.7m" is legible where "1,708,606"
 * crowds a compact card. The exact value is always available in the trend table
 * and in the accessible summary, so nothing is hidden by the abbreviation.
 */
export function formatCompactCount(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 1000) return String(Math.round(value));
  if (value < 1000000) return `${Math.round(value / 1000).toLocaleString("en-GB")}k`;
  const millions = value / 1000000;
  const rounded = millions < 10 ? Math.round(millions * 10) / 10 : Math.round(millions);
  return `${rounded.toLocaleString("en-GB")}m`;
}

export function metricNoun(metric, count) {
  const noun = METRIC_LABELS[metric];
  if (!noun) return null;
  return count === 1 ? noun.one : noun.many;
}

/**
 * Format a year-over-year change.
 *
 * Signed, one decimal, and never dressed up: this module reports the observed
 * difference between two published figures and says nothing about whether it is
 * good, strong, weak or a trend.
 */
export function formatChangePercent(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0.0%";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}

/**
 * Index the committed artifact for period lookup.
 *
 * Returns null for an unusable artifact rather than an empty index, so a load
 * failure cannot quietly become "no demand" or a zero.
 */
export function createDestinationIndex(artifact) {
  if (!artifact || !Array.isArray(artifact.observations) || !artifact.observations.length) {
    return null;
  }
  const geography = artifact.geography || {};
  // A citywide series that is not about this municipality is not this module's
  // data. Refusing here is cheaper than mislabelling a chart.
  if (geography.municipality_code && geography.municipality_code !== MUNICIPALITY_CODE) {
    return null;
  }

  const byPeriod = new Map();
  const ordered = [];
  for (const observation of artifact.observations) {
    if (!observation || typeof observation.period !== "string") continue;
    if (byPeriod.has(observation.period)) continue; // never two rows for one month
    byPeriod.set(observation.period, observation);
    ordered.push(observation);
  }
  if (!ordered.length) return null;

  // The artifact is written in chronological order by its builder; sorting here
  // keeps the model correct even if that ever stops being true.
  ordered.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));

  const latest = ordered[ordered.length - 1];
  return {
    byPeriod,
    ordered,
    latest,
    geography: {
      municipalityCode: geography.municipality_code || null,
      municipalityName: geography.municipality_name || MUNICIPALITY_NAME,
      sourceTerm: geography.source_term || null,
      sourceValue: geography.source_value || null,
      level: geography.level || null,
    },
    metrics: artifact.metrics || {},
    sourcePeriod: artifact.source_period || {},
  };
}

/**
 * Same month, previous year.
 *
 * The default comparison for a seasonal series: August against August, never
 * August against July. A month-over-month fallback is deliberately absent — if
 * the prior year is missing the model abstains and says which side was missing,
 * because substituting a different comparison under the same label would make
 * the sentence in the interface untrue.
 */
export function compareToPreviousYear(index, metric, period = null) {
  const abstain = (state) => ({
    state,
    metric,
    period: period || (index && index.latest ? index.latest.period : null),
    priorPeriod: null,
    current: null,
    prior: null,
    changePercent: null,
    changeDisplay: null,
    priorStatus: null,
  });

  if (!index) return abstain(COMPARISON_STATE.NO_PRIOR_PERIOD);
  const currentPeriod = period || index.latest.period;
  const current = index.byPeriod.get(currentPeriod);
  if (!current) return abstain(COMPARISON_STATE.NO_PRIOR_PERIOD);

  const priorPeriod = previousYearPeriod(currentPeriod);
  const prior = priorPeriod ? index.byPeriod.get(priorPeriod) : null;

  const currentValue = current[metric];
  const priorValue = prior ? prior[metric] : undefined;

  const base = {
    metric,
    period: currentPeriod,
    priorPeriod: prior ? priorPeriod : null,
    current: Number.isFinite(currentValue) ? currentValue : null,
    prior: Number.isFinite(priorValue) ? priorValue : null,
    priorStatus: prior ? prior.status || null : null,
  };

  if (!Number.isFinite(currentValue)) {
    return { ...base, state: COMPARISON_STATE.CURRENT_UNAVAILABLE, changePercent: null, changeDisplay: null };
  }
  if (!prior) {
    return { ...base, state: COMPARISON_STATE.NO_PRIOR_PERIOD, changePercent: null, changeDisplay: null };
  }
  if (!Number.isFinite(priorValue)) {
    return { ...base, state: COMPARISON_STATE.PRIOR_UNAVAILABLE, changePercent: null, changeDisplay: null };
  }
  if (priorValue === 0) {
    // April 2020 is a real published zero in this series. A percentage change
    // from zero is undefined, and "+infinity%" is not a statement about Madrid.
    return { ...base, state: COMPARISON_STATE.PRIOR_IS_ZERO, changePercent: null, changeDisplay: null };
  }

  const changePercent = ((currentValue - priorValue) / priorValue) * 100;
  if (!Number.isFinite(changePercent)) {
    return { ...base, state: COMPARISON_STATE.PRIOR_IS_ZERO, changePercent: null, changeDisplay: null };
  }
  return {
    ...base,
    state: COMPARISON_STATE.AVAILABLE,
    changePercent,
    changeDisplay: formatChangePercent(changePercent),
  };
}

/**
 * Travellers by place of residence, as counts and shares.
 *
 * The source's own wording is kept: "residents in Spain" and "residents
 * abroad". These are NOT translated into "domestic tourists" and
 * "international tourists" — INE classifies by place of residence, not by
 * nationality and not by trip type, and the survey methodology does not support
 * the stronger reading.
 *
 * Abstains rather than inventing a split when either side is missing, and never
 * renormalises one side against a total it did not come from.
 */
export function buildComposition(index, period = null) {
  const absent = () => ({
    state: COMPARISON_STATE.CURRENT_UNAVAILABLE,
    period: period || (index && index.latest ? index.latest.period : null),
    spain: { value: null, display: null, share: null, shareDisplay: null },
    abroad: { value: null, display: null, share: null, shareDisplay: null },
  });

  if (!index) return absent();
  const currentPeriod = period || index.latest.period;
  const observation = index.byPeriod.get(currentPeriod);
  if (!observation) return absent();

  const spain = observation.travellers_residents_spain;
  const abroad = observation.travellers_residents_abroad;
  if (!Number.isFinite(spain) || !Number.isFinite(abroad)) return absent();

  const total = spain + abroad;
  if (total <= 0) {
    // A month in which no traveller was recorded has no composition to show.
    return {
      state: COMPARISON_STATE.PRIOR_IS_ZERO,
      period: currentPeriod,
      spain: { value: spain, display: formatCount(spain), share: null, shareDisplay: null },
      abroad: { value: abroad, display: formatCount(abroad), share: null, shareDisplay: null },
    };
  }

  const shareOf = (value) => {
    const share = (value / total) * 100;
    return { share, shareDisplay: `${Math.round(share)}%` };
  };
  const spainShare = shareOf(spain);
  const abroadShare = shareOf(abroad);

  return {
    state: COMPARISON_STATE.AVAILABLE,
    period: currentPeriod,
    // The composition's denominator is the two residence counts added together,
    // NOT the published travellers total: the published total and the sum of
    // its components differ by +/-1 in some months because the source rounds
    // each estimate independently, and a share must add to 100%.
    total,
    spain: { value: spain, display: formatCount(spain), ...spainShare },
    abroad: { value: abroad, display: formatCount(abroad), ...abroadShare },
  };
}

/**
 * The compact trend series for one metric.
 *
 * Returns the raw published points, in order, with their own status and an
 * explicit null where the source published nothing. Nothing is interpolated,
 * smoothed, indexed or rebased, and a gap stays a gap: a line drawn straight
 * through May and June 2020 would assert two months of demand the source
 * declined to publish.
 */
export function buildTrend(index, metric, months = TREND_MONTHS) {
  if (!index) return { metric, points: [], months: 0, min: null, max: null };
  const slice = index.ordered.slice(-Math.max(1, months));
  const points = slice.map((observation) => ({
    period: observation.period,
    label: formatPeriodCompact(observation.period),
    value: Number.isFinite(observation[metric]) ? observation[metric] : null,
    status: observation.status || null,
  }));
  const values = points.map((p) => p.value).filter((v) => Number.isFinite(v));
  return {
    metric,
    points,
    months: points.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    // A trend with a hole in it must be describable as such rather than drawn
    // as if it were continuous.
    hasGaps: points.some((p) => p.value === null),
  };
}

/**
 * The whole Destination Context view model.
 *
 * Takes ONLY the artifact index and a runtime state. There is deliberately no
 * parameter for a coordinate, a radius, a barrio or a Lens: this module cannot
 * be made to react to Lens position, and the test suite asserts that the
 * function's signature stays that way.
 */
export function buildDestinationContext({ index, state = DESTINATION_STATE.AVAILABLE } = {}) {
  const unavailable = (why) => ({
    state: why,
    evidenceType: EVIDENCE_TYPE,
    evidenceLabel: EVIDENCE_LABEL,
    geography: {
      municipalityCode: MUNICIPALITY_CODE,
      municipalityName: MUNICIPALITY_NAME,
      label: `${MUNICIPALITY_NAME} · municipality ${MUNICIPALITY_CODE}`,
      sourceTerm: null,
      sourceValue: null,
    },
    period: null,
    metrics: [],
    composition: null,
    trend: null,
    scopeCaveat: CITY_SCOPE_CAVEAT,
    hotelCaveat: HOTEL_SCOPE_CAVEAT,
  });

  if (state === DESTINATION_STATE.LOADING) return unavailable(DESTINATION_STATE.LOADING);
  if (!index) return unavailable(DESTINATION_STATE.UNAVAILABLE);

  const latest = index.latest;
  const provisional = latest.status === "provisional";

  const metrics = ["travellers", "overnight_stays"].map((metric) => {
    const value = Number.isFinite(latest[metric]) ? latest[metric] : null;
    return {
      key: metric,
      label: metric === "travellers" ? "Travellers" : "Overnight stays",
      value,
      display: value === null ? null : formatCompactCount(value),
      exactDisplay: value === null ? null : formatCount(value),
      unit: metricNoun(metric, value === null ? 2 : value),
      comparison: compareToPreviousYear(index, metric),
      trend: buildTrend(index, metric),
    };
  });

  return {
    state: DESTINATION_STATE.AVAILABLE,
    evidenceType: EVIDENCE_TYPE,
    evidenceLabel: EVIDENCE_LABEL,
    geography: {
      municipalityCode: index.geography.municipalityCode,
      municipalityName: index.geography.municipalityName,
      // Both the plain meaning and the publisher's own term. The label never
      // says a bare "Madrid" without saying which Madrid it means.
      label: `${index.geography.municipalityName} · municipality ${index.geography.municipalityCode}`,
      sourceTerm: index.geography.sourceTerm,
      sourceValue: index.geography.sourceValue,
      sourceGeographyLine: index.geography.sourceTerm
        ? `Source geography: ${index.geography.sourceTerm} “${index.geography.sourceValue}”, ` +
          `which the publisher defines as a municipality and publishes under municipality code ` +
          `${index.geography.municipalityCode}.`
        : null,
    },
    period: {
      key: latest.period,
      label: formatPeriod(latest.period),
      compact: formatPeriodCompact(latest.period),
      status: latest.status || null,
      provisional,
      notes: Array.isArray(latest.source_notes) ? latest.source_notes : [],
    },
    metrics,
    composition: buildComposition(index),
    coverage: {
      earliest: index.ordered[0].period,
      latest: latest.period,
      months: index.ordered.length,
    },
    scopeCaveat: CITY_SCOPE_CAVEAT,
    hotelCaveat: HOTEL_SCOPE_CAVEAT,
    provisionalCaveat: provisional ? PROVISIONAL_CAVEAT : null,
  };
}

/**
 * The sentence a comparison is allowed to say.
 *
 * Reports the observed difference between two published figures and nothing
 * else: no evaluation, no cause, no adjective. Where the comparison abstains it
 * says which side was missing rather than falling back to a different
 * comparison under the same words.
 */
export function comparisonSentence(comparison) {
  if (!comparison) return null;
  const priorLabel = comparison.priorPeriod ? formatPeriodCompact(comparison.priorPeriod) : null;
  switch (comparison.state) {
    case COMPARISON_STATE.AVAILABLE:
      return `${comparison.changeDisplay} vs ${priorLabel}`;
    case COMPARISON_STATE.PRIOR_IS_ZERO:
      return `No comparison: the source published zero for ${priorLabel}`;
    case COMPARISON_STATE.PRIOR_UNAVAILABLE:
      return `No comparison: the source published no figure for ${priorLabel}`;
    case COMPARISON_STATE.CURRENT_UNAVAILABLE:
      return "No figure published for this month";
    case COMPARISON_STATE.NO_PRIOR_PERIOD:
    default:
      return "No comparison: the series does not reach back a year";
  }
}

/**
 * The accessible summary for the trend graphic.
 *
 * A sparkline is decorative to a screen reader unless the shape is described in
 * words, so this states the range, the endpoints and any gap, without
 * characterising the movement.
 */
export function trendSummary(trend, metricLabel) {
  if (!trend || !trend.points.length) return null;
  const published = trend.points.filter((p) => Number.isFinite(p.value));
  if (!published.length) return `${metricLabel}: no published figures in this period.`;

  const first = published[0];
  const last = published[published.length - 1];
  const parts = [
    `${metricLabel}, monthly, ${first.label} to ${last.label}:`,
    `from ${formatCount(first.value)} to ${formatCount(last.value)}.`,
    `Lowest ${formatCount(trend.min)}, highest ${formatCount(trend.max)}.`,
  ];
  if (trend.hasGaps) {
    const gaps = trend.points.filter((p) => p.value === null).map((p) => p.label);
    parts.push(`No figure published for ${gaps.join(", ")}.`);
  }
  return parts.join(" ");
}

/**
 * The provenance lines for the Destination Context disclosure.
 *
 * Read from the committed sidecar, like the Area Profile's disclosure, so the
 * panel cannot drift from the artifact. The geography line carries the weight:
 * it is the acceptance criterion this whole module was gated on.
 */
export function buildDestinationProvenanceLines({ meta, model } = {}) {
  const lines = [];
  const source = (meta && meta.source) || {};

  if (source.survey && source.authority) lines.push(`${source.survey} · ${source.authority}`);
  else if (source.authority) lines.push(source.authority);

  lines.push(EVIDENCE_LABEL);

  const geography = (meta && meta.geography) || {};
  if (geography.source_term && geography.source_value && geography.municipality_code) {
    lines.push(
      `Source geography: ${geography.source_term} “${geography.source_value}” — the publisher ` +
        `defines a ${geography.source_term.toLowerCase()} as a municipality and publishes this one ` +
        `under municipality code ${geography.municipality_code} (Madrid).`
    );
  }

  if (model && model.period && model.period.label) {
    lines.push(
      `Observation period: ${model.period.label}` +
        (model.period.provisional ? ", published as provisional and revised later." : ".")
    );
  }

  const definitions = (meta && meta.survey_definitions) || {};
  if (definitions.viajeros) lines.push(definitions.viajeros);

  if (meta && meta.retrieved_at) {
    lines.push(
      `Retrieved from the publisher on ${String(meta.retrieved_at).slice(0, 10)}. ` +
        `That is when this snapshot was built, not the period it describes.`
    );
  }

  // Last, and never omitted: the boundary between this survey and "tourism".
  lines.push(HOTEL_SCOPE_CAVEAT);
  return lines;
}
