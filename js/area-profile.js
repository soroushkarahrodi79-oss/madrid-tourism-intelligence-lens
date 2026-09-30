// Area Profile: the administrative context of a Lens centre.
//
// THE CIRCLE AND THE ADMINISTRATIVE AREA ARE TWO DIFFERENT ANALYTICAL OBJECTS.
//
// The Lens circle measures what genuinely falls inside it. An administrative
// statistic belongs to the WHOLE official barrio. This module never mixes the
// two: it takes a coordinate's official containment plus the canonical barrio
// figures and produces a view model that says "the Lens centre is in barrio X;
// barrio X has Y registered residents at reference date P, and N licensed VUT
// units documented in a source extract whose own state is S". There is no areal
// interpolation, no share-of-barrio weighting, and no population, licence or
// unit count inside the circle.
//
// This module DOES compute one ratio: licensed VUT units per 1,000 registered
// residents, defined in the licensed-VUT section at the foot of this file. It
// is a descriptive comparison of two administrative facts about one whole
// barrio, kept honest by three rules the rest of this file enforces — it
// abstains rather than inventing a value when either side is missing, it is
// always published alongside the raw counts it divides, and the two sides keep
// their own separate periods. It is not a density, not a rate of anything and
// not a share of dwellings, because its denominator is registered residents
// rather than homes. It is not a tourism-pressure, saturation, carrying-capacity
// or composite score. Nothing here ranks, bands or scores an area, and no figure
// this module returns may be distributed into a Lens circle.
//
// Everything here is pure: geography, population and licence data in, a view
// model out. No fetch, no DOM, no Leaflet, so it is unit-testable with plain
// `node --test`. The browser wiring in js/app.js renders the models this file
// returns.

// Area resolution states. The area is one thing; whether a residential figure
// exists for it is a separate axis (see RESIDENTS_STATE) so a missing
// population can never be confused with a missing place.
export const AREA_STATE = {
  LOADING: "loading",
  UNAVAILABLE: "unavailable",
  OUTSIDE_MADRID: "outside_madrid",
  DISTRICT_ONLY: "district_only",
  RESOLVED: "resolved",
};

export const RESIDENTS_STATE = {
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
  // No barrio to carry a residential figure at all (outside Madrid, or the
  // geography itself could not be read). Deliberately distinct from
  // UNAVAILABLE, which means "this official area exists but has no value".
  NOT_APPLICABLE: "not_applicable",
};

// The registry's evidence enum is internal vocabulary. The interface says what
// the evidence IS in plain language; the enum is preserved on the model so the
// semantics stay exact and machine-checkable.
export const EVIDENCE_TYPE = "ADMINISTRATIVE_REGISTER";
export const EVIDENCE_LABEL = "Official register";

// The one sentence that keeps the two geometries apart wherever the figure is
// shown. It is deliberately short: a wall of methodology would not be read.
export const SCOPE_CAVEAT =
  "Whole official barrio — not the Lens circle.";

export const MUNICIPALITY_NAME = "Madrid";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-01-01" -> "1 Jan 2026". Written out rather than delegated to Intl so
// the label is byte-identical on every platform the test matrix runs on.
export function formatReferenceDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
  if (!match) return null;
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name) return null;
  return `${Number(day)} ${name} ${year}`;
}

// Group separators for a resident count. The application's numeric locale is
// en-GB throughout (observed pedestrian counts already use it), so the product
// reads 6,774 consistently rather than mixing conventions.
export function formatResidents(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value).toLocaleString("en-GB");
}

/**
 * Index the canonical population artifact for code-based lookup.
 *
 * The join is official code to official code, never a name: names are labels,
 * codes are identity. Returns null for an unusable artifact rather than an
 * empty index, so a load failure cannot quietly become "0 residents".
 */
export function createPopulationIndex(artifact) {
  if (!artifact || !Array.isArray(artifact.records)) return null;

  const barrio = new Map();
  const district = new Map();
  let municipality = null;

  for (const record of artifact.records) {
    if (!record || record.official_id == null) continue;
    const id = String(record.official_id);
    if (record.geography_level === "barrio") barrio.set(id, record);
    else if (record.geography_level === "district") district.set(id, record);
    else if (record.geography_level === "municipality") municipality = record;
  }

  const referenceDate = artifact.source_period && artifact.source_period.reference_date;
  return {
    barrio,
    district,
    municipality,
    period: {
      referenceDate: referenceDate || null,
      label: formatReferenceDate(referenceDate),
      sourceLabel: (artifact.source_period && artifact.source_period.label) || null,
      provisional: Boolean(artifact.source_period && artifact.source_period.provisional),
    },
  };
}

function residentsFor(populationIndex, barrio) {
  if (!barrio) {
    return { state: RESIDENTS_STATE.NOT_APPLICABLE, value: null, display: null, provenance: null };
  }
  const record = populationIndex && populationIndex.barrio.get(String(barrio.official_id));
  const value = record && Number(record.residents);
  if (!record || !Number.isFinite(value)) {
    // Never fall back to zero: an absent denominator is an absent denominator.
    return { state: RESIDENTS_STATE.UNAVAILABLE, value: null, display: null, provenance: null };
  }
  return {
    state: RESIDENTS_STATE.AVAILABLE,
    value,
    display: formatResidents(value),
    provenance: record.residents_provenance || null,
  };
}

/**
 * Build the Area Profile view model for one Lens.
 *
 * `located` is the result of geographyIndex.resolve(lon, lat), or null while
 * the canonical geography is still loading / after it failed to load (say so
 * with `state`). `populationIndex` is createPopulationIndex's output or null,
 * and `vutIndex` is createVutIndex's output or null. The three sources fail
 * independently: a place with no population figure is still a place, and a
 * place with no licence figure still reports its residents.
 */
export function buildAreaProfile({ lens, located, populationIndex, vutIndex = null, state = null } = {}) {
  const period = populationIndex ? populationIndex.period : { referenceDate: null, label: null };

  const base = {
    lens: lens || null,
    evidenceType: EVIDENCE_TYPE,
    evidenceLabel: EVIDENCE_LABEL,
    scopeCaveat: SCOPE_CAVEAT,
    period,
    barrioId: null,
    barrioName: null,
    districtId: null,
    districtName: null,
  };

  if (state === AREA_STATE.LOADING || (!located && state !== AREA_STATE.UNAVAILABLE)) {
    return {
      ...base,
      state: AREA_STATE.LOADING,
      headline: "Locating…",
      context: null,
      codes: null,
      note: "Reading the canonical Madrid administrative geography.",
      residents: { state: RESIDENTS_STATE.NOT_APPLICABLE, value: null, display: null, provenance: null },
      vut: buildVutContext({ vutIndex, barrio: null, residents: null }),
      key: "loading",
    };
  }

  if (state === AREA_STATE.UNAVAILABLE) {
    return {
      ...base,
      state: AREA_STATE.UNAVAILABLE,
      headline: "Administrative context unavailable",
      context: null,
      codes: null,
      note: "The canonical Madrid geography could not be loaded, so no official area is reported.",
      residents: { state: RESIDENTS_STATE.NOT_APPLICABLE, value: null, display: null, provenance: null },
      vut: buildVutContext({ vutIndex, barrio: null, residents: null }),
      key: "unavailable",
    };
  }

  if (!located.inside_municipality) {
    return {
      ...base,
      state: AREA_STATE.OUTSIDE_MADRID,
      headline: "Outside Madrid City",
      context: null,
      codes: null,
      note: "Outside the canonical Madrid City administrative geography.",
      residents: { state: RESIDENTS_STATE.NOT_APPLICABLE, value: null, display: null, provenance: null },
      vut: buildVutContext({ vutIndex, barrio: null, residents: null }),
      key: "outside",
    };
  }

  const district = located.district || null;
  const barrio = located.barrio || null;

  if (!barrio) {
    // Inside Madrid but not inside any barrio polygon: report exactly that
    // rather than inventing the nearest one.
    return {
      ...base,
      state: AREA_STATE.DISTRICT_ONLY,
      districtId: district ? district.official_id : null,
      districtName: district ? district.official_name : null,
      headline: district ? district.official_name : MUNICIPALITY_NAME,
      context: MUNICIPALITY_NAME,
      codes: district ? `District ${district.official_id}` : null,
      note: "No official barrio contains this point, so no barrio statistic applies.",
      residents: { state: RESIDENTS_STATE.UNAVAILABLE, value: null, display: null, provenance: null },
      vut: buildVutContext({ vutIndex, barrio: null, residents: null }),
      key: `district:${district ? district.official_id : "none"}`,
    };
  }

  const districtName = district ? district.official_name : barrio.parent_name;
  const districtId = district ? district.official_id : barrio.parent_id;
  const residents = residentsFor(populationIndex, barrio);
  // The licence block reads the residents model that was just computed, so the
  // ratio's denominator is exactly the figure shown above it in the interface.
  const vut = buildVutContext({ vutIndex, barrio, residents });

  return {
    ...base,
    state: AREA_STATE.RESOLVED,
    barrioId: barrio.official_id,
    barrioName: barrio.official_name,
    districtId,
    districtName,
    headline: barrio.official_name,
    context: `${districtName} · ${MUNICIPALITY_NAME}`,
    codes: `Barrio ${barrio.official_id} · District ${districtId}`,
    note:
      residents.state === RESIDENTS_STATE.AVAILABLE
        ? null
        : "Residential population unavailable for this administrative area.",
    residents,
    vut,
    key: `barrio:${barrio.official_id}:${residents.state}:${vut.state}:${vut.ratio.state}`,
  };
}

/**
 * How two Area Profiles relate.
 *
 * The decisive case is SAME_BARRIO: both Lens centres then point at ONE
 * administrative statistic, and the interface must not imply two independent
 * population observations. No delta between two barrio populations is produced
 * here — this module reports where the Lenses are, it does not compare places.
 */
export const AREA_COMPARISON = {
  SAME_BARRIO: "same_barrio",
  SAME_DISTRICT: "same_district",
  DIFFERENT_DISTRICT: "different_district",
  PARTIAL: "partial",
  NONE: "none",
};

export function compareAreaProfiles(a, b) {
  if (!a || !b) return { state: AREA_COMPARISON.NONE, message: null };

  const aResolved = a.state === AREA_STATE.RESOLVED;
  const bResolved = b.state === AREA_STATE.RESOLVED;

  if (!aResolved || !bResolved) {
    const outside = [a, b].filter((p) => p.state === AREA_STATE.OUTSIDE_MADRID).length;
    return {
      state: AREA_COMPARISON.PARTIAL,
      message:
        outside === 2
          ? "Both Lens centres are outside Madrid City."
          : outside === 1
            ? "One Lens centre is outside Madrid City, so the two areas are not comparable."
            : "An administrative area is unavailable for one of the Lenses.",
    };
  }

  if (a.barrioId === b.barrioId) {
    const shared =
      a.residents.state === RESIDENTS_STATE.AVAILABLE
        ? `${a.residents.display} registered residents — one barrio statistic, not two observations.`
        : "One barrio statistic, not two observations.";
    return {
      state: AREA_COMPARISON.SAME_BARRIO,
      message: `Both Lens centres are in ${a.headline}. ${shared}`,
    };
  }

  if (a.districtId === b.districtId) {
    return {
      state: AREA_COMPARISON.SAME_DISTRICT,
      message: `Two barrios of ${a.districtName}.`,
    };
  }

  return {
    state: AREA_COMPARISON.DIFFERENT_DISTRICT,
    message: `${a.districtName} and ${b.districtName}.`,
  };
}

// The opening `count` sentences of a metadata paragraph, so a long committed
// field can be surfaced concisely without being rewritten or dumped whole.
// Returns null when there is nothing usable, because an absent field is left
// out of the disclosure rather than replaced with an invented sentence.
function firstSentences(text, count) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const matches = trimmed.match(/[^.]+\./g);
  if (!matches) return trimmed;
  return matches
    .slice(0, count)
    .map((sentence) => sentence.trim())
    .join(" ");
}

/**
 * The provenance lines shown behind the info affordance.
 *
 * Every line is read from the committed sidecar metadata — dataset, authority,
 * period, geography versions and the artifact's own interpretation ceiling — so
 * the disclosure cannot drift from the artifacts and contains no restatement of
 * them. Whatever is genuinely unknown is simply left out, and a call with no
 * metadata at all returns no lines rather than an invented one.
 */
export function buildProvenanceLines({ populationMeta, geographyMeta, period } = {}) {
  const lines = [];

  const dataset = populationMeta && populationMeta.source && populationMeta.source.underlying_register;
  const authority = populationMeta && populationMeta.source && populationMeta.source.authority;
  if (dataset && authority) lines.push(`${dataset} · ${authority}`);
  else if (dataset) lines.push(dataset);
  else if (authority) lines.push(authority);

  const referenceLabel = period && (period.label || period.referenceDate);
  if (referenceLabel) lines.push(`Reference date ${referenceLabel}`);

  const barrioVersion =
    geographyMeta &&
    geographyMeta.source_version &&
    geographyMeta.source_version.datasets &&
    geographyMeta.source_version.datasets.barrio &&
    geographyMeta.source_version.datasets.barrio.published_version;
  const districtVersion =
    geographyMeta &&
    geographyMeta.source_version &&
    geographyMeta.source_version.datasets &&
    geographyMeta.source_version.datasets.district &&
    geographyMeta.source_version.datasets.district.published_version;
  if (barrioVersion && districtVersion) {
    lines.push(`Barrio geography ${barrioVersion} · district geography ${districtVersion}`);
  }

  // The interpretation ceiling, taken from the artifact's own words rather than
  // restated here: the opening sentences say what the figure is and what it is
  // not, which is exactly what a reader opening this disclosure needs. The rest
  // of the paragraph (join mechanics, prohibited derivations) belongs to the
  // sidecar and the documentation, not to a panel.
  const ceiling = firstSentences(populationMeta && populationMeta.interpretation_ceiling, 2);
  if (ceiling) lines.push(ceiling);

  return lines;
}

// ------------------------------------------------------- licensed VUT context
//
// A SECOND, INDEPENDENT ADMINISTRATIVE FIGURE FOR THE SAME WHOLE BARRIO.
//
// The numerator is a count of granted urban-planning activity licences, and of
// the tourist-dwelling units those licences contain. It is NOT a count of
// dwellings in operation: the source carries no revocation, expiry or cessation
// field, so nothing here may say "active", "operating" or "current". It is NOT
// all tourist dwellings, NOT all accommodation, and NOT a measure of pressure,
// saturation or capacity of any kind.
//
// The denominator is the same Padron figure the residents block already shows.
// The two have DIFFERENT temporal semantics and are never given one shared
// period: the Padron publishes a real reference date (1 January 2026), while
// this source publishes no reference or effective date at all and can only be
// described by the HTTP Last-Modified state of the resource file that was
// fetched. Those are different kinds of fact and this module keeps them apart.
//
// Like everything above, the counts belong to the WHOLE OFFICIAL BARRIO and are
// never distributed into, weighted by, or reported for the Lens circle.

// A licence record is a different kind of administrative object from a
// population register entry: a granted act, not an enumerated universe. The
// registry vocabulary distinguishes the two so neither inherits the other's
// interpretation ceiling.
export const VUT_EVIDENCE_TYPE = "ADMINISTRATIVE_LICENSE";
export const VUT_EVIDENCE_LABEL = "Administrative licence";

export const VUT_STATE = {
  AVAILABLE: "available",
  // This official area exists but the committed artifact carries no usable
  // record for it (absent, or present but incoherent). Never a zero.
  UNAVAILABLE: "unavailable",
  // There is no whole barrio to carry the figure at all: outside Madrid, no
  // barrio contains the point, or the geography itself could not be read.
  NOT_APPLICABLE: "not_applicable",
};

// The ratio abstains for two materially different reasons and the interface
// says which, because "we have no licence data" and "we have no denominator"
// are different facts about different sources.
export const RATIO_STATE = {
  AVAILABLE: "available",
  NO_NUMERATOR: "no_numerator",
  NO_DENOMINATOR: "no_denominator",
};

// What the ratio is, spelled out wherever it appears. Written once here so no
// caller can shorten it into "VUT per resident" or a bare index number.
export const RATIO_LABEL = "per 1,000 registered residents";

export const VUT_UNITS_LABEL = "licensed VUT units";
export const VUT_LICENCES_LABEL = "activity licences";

// English count agreement. A product this careful about what a number means
// must not print "1 activity licences", and the singular forms live here rather
// than in the DOM layer so the wording has one owner. The RATIO always takes the
// plural, because "per 1,000" is plural whatever the figure.
const COUNTED_NOUNS = {
  units: { one: "licensed VUT unit", many: VUT_UNITS_LABEL },
  licences: { one: "activity licence", many: VUT_LICENCES_LABEL },
};

export function countedNoun(kind, count) {
  const noun = COUNTED_NOUNS[kind];
  if (!noun) return null;
  return count === 1 ? noun.one : noun.many;
}

// The scope reminder carried on the licensed-VUT row itself. "Granted" is doing
// load-bearing work: it is the one word that keeps the figure away from
// "operating", and it stays visible at every viewport, including the ones where
// the full disclosure is collapsed away.
export const VUT_STATE_PREFIX = "Granted licences";

// The limitation the compact card cannot carry, stated in the product's own
// words exactly as SCOPE_CAVEAT is above. A test asserts the committed
// sidecar's own currency caveat says the same thing, so the two cannot drift
// apart, and this is deliberately NOT sliced out of that paragraph: the
// sidecar's sentence is written for an auditor, this one for a reader.
export const VUT_OPERATION_CAVEAT =
  "Granted licences only. The source carries no revocation, expiry or cessation field, " +
  "so this does not establish that the dwellings are currently operating.";

/**
 * Format an HTTP Last-Modified header as a file-state label.
 *
 * Deliberately NOT parsed with `new Date()`: this value describes the state of
 * a file and is never turned into a date object that could then be formatted,
 * compared or arithmetically combined with the Padron's real reference date.
 * Returns an exact-day label and a compact one, both null for anything that is
 * not an HTTP date, so an unparseable header is left out rather than guessed.
 */
export function formatSourceFileState(httpDate) {
  const match = /^[A-Za-z]{3},\s+(\d{2})\s+([A-Za-z]{3})\s+(\d{4})\b/.exec(String(httpDate || "").trim());
  if (!match) return null;
  const [, day, month, year] = match;
  if (!MONTHS.includes(month)) return null;
  return { label: `${Number(day)} ${month} ${year}`, compact: `${month} ${year}` };
}

// Group separators for a licence or unit count, matching the resident figure's
// convention so the two read as one numeric system.
export function formatLicensedCount(value) {
  if (!Number.isInteger(value) || value < 0) return null;
  return value.toLocaleString("en-GB");
}

/**
 * Format the descriptive ratio.
 *
 * One decimal is enough for a figure whose city-wide value is 0.42, and an
 * integer-valued ratio is not padded with a pointless ".0". The `<0.1` case is
 * the one that matters: six barrios hold one to three licensed units among tens
 * of thousands of residents, and rounding those to "0.0" would print a zero for
 * an area that genuinely has licensed units. A real zero prints "0"; a small
 * non-zero value says it is small.
 */
export function formatVutRatio(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return "0";
  if (value < 0.05) return "<0.1";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * licensed VUT units / registered residents x 1000, for one whole barrio.
 *
 * Abstains rather than producing a number whenever either side is absent, and
 * abstains on a zero denominator instead of returning Infinity. A zero
 * NUMERATOR is not an abstention: the committed artifact enumerates granted
 * licence records across the whole municipality, so zero units in a barrio is
 * a real published zero and 0 is the correct ratio.
 */
export function computeVutRatio(units, residents) {
  const abstain = (state) => ({ state, value: null, display: null });
  if (!Number.isFinite(units) || units < 0) return abstain(RATIO_STATE.NO_NUMERATOR);
  if (!Number.isFinite(residents) || residents <= 0) return abstain(RATIO_STATE.NO_DENOMINATOR);
  const value = (units / residents) * 1000;
  if (!Number.isFinite(value)) return abstain(RATIO_STATE.NO_DENOMINATOR);
  return { state: RATIO_STATE.AVAILABLE, value, display: formatVutRatio(value) };
}

/**
 * Index the committed licensed-VUT artifact for code-based lookup.
 *
 * Returns null for an unusable artifact rather than an empty index, so a load
 * failure or a malformed commit can never be read as "0 licensed units
 * everywhere". A record whose two counts are not coherent non-negative
 * integers, or whose units are fewer than its licences, is dropped rather than
 * admitted: one bad row costs that barrio its figure, not every barrio theirs.
 */
export function createVutIndex(artifact) {
  if (!artifact || !Array.isArray(artifact.records)) return null;

  const barrio = new Map();
  const district = new Map();
  let municipality = null;

  for (const record of artifact.records) {
    if (!record || record.official_id == null) continue;
    const { vut_units: units, vut_licences: licences } = record;
    if (!Number.isInteger(units) || !Number.isInteger(licences)) continue;
    if (units < 0 || licences < 0 || units < licences) continue;
    const id = String(record.official_id);
    if (record.geography_level === "barrio") barrio.set(id, record);
    else if (record.geography_level === "district") district.set(id, record);
    else if (record.geography_level === "municipality") municipality = record;
  }

  // No barrio record at all is an unusable artifact: the indicator is a
  // barrio-level statistic and nothing else may stand in for it.
  if (barrio.size === 0) return null;

  const state = artifact.source_state || {};
  const span = state.grant_date_span || null;
  const file = formatSourceFileState(state.xlsx_http_last_modified);

  return {
    barrio,
    district,
    municipality,
    counts: artifact.counts || null,
    // Deliberately "sourceState", not "period": this source declares no
    // reference or effective date, and the name of the field is the first place
    // that could start pretending otherwise.
    sourceState: {
      fileLastModified: state.xlsx_http_last_modified || null,
      fileStateLabel: file ? file.label : null,
      fileStateCompact: file ? file.compact : null,
      // Structural, not decorative: a consumer reading this model is told in
      // the data itself that the file state is not a publisher-declared date.
      publisherDeclaredReferenceDate: false,
      grantDateSpan:
        span && span.earliest_grant_date && span.latest_grant_date
          ? {
              earliest: span.earliest_grant_date,
              latest: span.latest_grant_date,
              earliestLabel: formatReferenceDate(span.earliest_grant_date),
              latestLabel: formatReferenceDate(span.latest_grant_date),
            }
          : null,
    },
  };
}

/**
 * Build the licensed-VUT block of the Area Profile for one whole barrio.
 *
 * `residents` is the residents model already computed for the same barrio, so
 * the ratio's denominator is exactly the figure the interface displays above
 * it — never a second, separately resolved population.
 */
export function buildVutContext({ vutIndex, barrio, residents } = {}) {
  const base = {
    evidenceType: VUT_EVIDENCE_TYPE,
    evidenceLabel: VUT_EVIDENCE_LABEL,
    scopeCaveat: SCOPE_CAVEAT,
    sourceState: vutIndex ? vutIndex.sourceState : null,
  };
  const absent = (state) => ({
    ...base,
    state,
    units: { value: null, display: null },
    licences: { value: null, display: null },
    ratio: { state: RATIO_STATE.NO_NUMERATOR, value: null, display: null },
    valueProvenance: null,
  });

  if (!barrio) return absent(VUT_STATE.NOT_APPLICABLE);

  const record = vutIndex && vutIndex.barrio.get(String(barrio.official_id));
  // No nearest-barrio fallback, no district total standing in for a barrio, and
  // no zero: an area the artifact does not usably cover has no figure.
  if (!record) return absent(VUT_STATE.UNAVAILABLE);

  const residentValue = residents && residents.state === RESIDENTS_STATE.AVAILABLE ? residents.value : null;

  return {
    ...base,
    state: VUT_STATE.AVAILABLE,
    units: { value: record.vut_units, display: formatLicensedCount(record.vut_units) },
    licences: { value: record.vut_licences, display: formatLicensedCount(record.vut_licences) },
    ratio: computeVutRatio(record.vut_units, residentValue),
    valueProvenance: record.value_provenance || null,
  };
}

/**
 * The provenance lines for the licensed-VUT numerator.
 *
 * Read from the committed sidecar, like the residential disclosure above, so
 * the panel cannot drift from the artifact. The period line is the one that
 * carries the weight: it names the HTTP header as what it is and states that
 * the source declares no reference date, because the compact card can only
 * afford "source file state: Sep 2026".
 */
export function buildVutProvenanceLines({ vutMeta, sourceState } = {}) {
  const lines = [];
  const source = (vutMeta && vutMeta.source) || {};

  if (source.dataset && source.authority) lines.push(`${source.dataset} · ${source.authority}`);
  else if (source.dataset) lines.push(source.dataset);
  else if (source.authority) lines.push(source.authority);

  const unit = vutMeta && vutMeta.unit_of_analysis && vutMeta.unit_of_analysis.vut_units;
  if (unit) lines.push(`${VUT_EVIDENCE_LABEL} · ${unit}`);
  else lines.push(VUT_EVIDENCE_LABEL);

  const fileState = sourceState && sourceState.fileStateLabel;
  if (fileState) {
    lines.push(
      `Source state: HTTP Last-Modified observed on the resource file, ${fileState}. ` +
        `The source declares no reference or effective date, so this is not one.`
    );
  }
  const span = sourceState && sourceState.grantDateSpan;
  if (span && span.earliestLabel && span.latestLabel) {
    lines.push(`Licence grant dates in this extract span ${span.earliestLabel} to ${span.latestLabel}.`);
  }

  const ceiling = firstSentences(vutMeta && vutMeta.interpretation_ceiling, 2);
  if (ceiling) lines.push(ceiling);

  // Last, and never omitted: the source's own silence about revocation is the
  // single most consequential thing a reader of this figure has to know.
  lines.push(VUT_OPERATION_CAVEAT);

  return lines;
}
