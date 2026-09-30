// Area Profile: the administrative context of a Lens centre.
//
// THE CIRCLE AND THE ADMINISTRATIVE AREA ARE TWO DIFFERENT ANALYTICAL OBJECTS.
//
// The Lens circle measures what genuinely falls inside it. A barrio population
// belongs to the WHOLE official barrio. This module never mixes the two: it
// takes a coordinate's official containment plus the canonical Padron figures
// and produces a view model that says "the Lens centre is in barrio X, and
// barrio X has Y registered residents at reference date Z". There is no areal
// interpolation, no share-of-barrio weighting, no population inside the circle,
// and no indicator, ratio, density or composite score of any kind.
//
// Everything here is pure: geography/population data in, a view model out. No
// fetch, no DOM, no Leaflet, so it is unit-testable with plain `node --test`.
// The browser wiring in js/app.js renders the models this file returns.

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
 * with `state`). `populationIndex` is createPopulationIndex's output or null.
 */
export function buildAreaProfile({ lens, located, populationIndex, state = null } = {}) {
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
      key: `district:${district ? district.official_id : "none"}`,
    };
  }

  const districtName = district ? district.official_name : barrio.parent_name;
  const districtId = district ? district.official_id : barrio.parent_id;
  const residents = residentsFor(populationIndex, barrio);

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
    key: `barrio:${barrio.official_id}:${residents.state}`,
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
