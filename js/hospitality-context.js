// Pure production contract for Hospitality & Commercial Context v1.
//
// This module accepts only Gate F's exact admitted set. It has no coordinate,
// radius, Lens A/B or circle-population API: values are attached exclusively to
// municipality, district and CURRENT_131 barrio IDs already aggregated offline.

export const CONTRACT_VERSION = "1.0.0";
export const DEFAULT_INDICATOR_ID = "core_hospitality_premises_count";
export const CONDITIONAL_INDICATOR_ID = "core_hospitality_premises_per_1000_residents";
export const APPROVED_INDICATOR_IDS = Object.freeze([
  "source_included_premises_count",
  "core_hospitality_premises_count",
  "accommodation_class_premises_count",
  "core_hospitality_membership_share_of_populated_taxonomy_premises",
  "core_hospitality_premises_per_1000_residents",
]);

export const HOSPITALITY_DICTIONARIES = Object.freeze({
  es: Object.freeze({
    layerName: "Contexto de hostelería y actividad comercial",
    layerToggle: "Mostrar contexto de hostelería y actividad comercial",
    metricLabel: "Métrica",
    languageLabel: "Idioma",
    unavailable: "Datos no disponibles",
    municipality: "Municipio de Madrid",
    barrio: "Barrio",
    district: "Distrito",
    area: "Área",
    value: "Valor",
    reference: "Periodo de referencia",
    source: "Fuente",
    interpretation: "Interpretación",
    population: "Población",
    contextHeading: "Contexto administrativo",
    contextScope: "geografía oficial",
    premisesReference: "sep. 2026",
    sourceLabel: "Ayuntamiento de Madrid · Censo de Locales",
    methodologyLink: "Metodología completa",
    selectorHint: "Polígonos oficiales de barrio · no se calcula dentro del círculo Lens",
    hoverHint: "Seleccione un barrio para fijar este contexto administrativo.",
    municipalityHint: "Total del municipio; los registros sin barrio se conservan cuando corresponde.",
    countHint: "Recuento administrativo de locales documentados; no acredita funcionamiento actual.",
    sourceCountHint: "Locales documentados tras las exclusiones expresas de la fuente; no son negocios activos verificados.",
    accommodationHint: "Locales incluidos en el registro con al menos una actividad clasificada en la división 55. No equivale a plazas, capacidad ni stock de VUT.",
    membershipHint: "Porcentaje no exclusivo dentro de locales con taxonomía informada; incluye SIN ACTIVIDAD informado y no acredita funcionamiento.",
    conditionalHint: "Densidad administrativa respecto a población empadronada; no mide presión turística.",
    dualDate: "Locales: sep. 2026 · Padrón: 1 ene. 2026",
    populationReference: "Padrón · 1 ene. 2026",
    unitPremises: "locales",
    unitPercent: "%",
    unitPer1000: "locales por 1.000 residentes empadronados",
    source_included_premises_count: "Locales incluidos según el registro",
    core_hospitality_premises_count: "Locales con actividad documentada de hostelería",
    accommodation_class_premises_count: "Locales de clase alojamiento (división 55)",
    core_hospitality_membership_share_of_populated_taxonomy_premises:
      "Locales con actividad documentada de hostelería (%)",
    core_hospitality_premises_per_1000_residents:
      "Locales de hostelería documentados por 1.000 residentes empadronados",
  }),
  en: Object.freeze({
    layerName: "Hospitality & Commercial Context",
    layerToggle: "Show Hospitality & Commercial Context",
    metricLabel: "Metric",
    languageLabel: "Language",
    unavailable: "Data unavailable",
    municipality: "Madrid municipality",
    barrio: "Barrio",
    district: "District",
    area: "Area",
    value: "Value",
    reference: "Reference period",
    source: "Source",
    interpretation: "Interpretation",
    population: "Population",
    contextHeading: "Administrative context",
    contextScope: "official geography",
    premisesReference: "Sep 2026",
    sourceLabel: "Madrid City Council · Business Premises Census",
    methodologyLink: "Full methodology",
    selectorHint: "Official barrio polygons · not calculated inside the Lens circle",
    hoverHint: "Select a barrio to hold this administrative context.",
    municipalityHint: "Municipality total; records without a barrio remain included where applicable.",
    countHint: "Administrative count of documented premises; not evidence of current operation.",
    sourceCountHint: "Documented premises after the source's explicit exclusions; not verified active businesses.",
    accommodationHint: "Source-included premises with at least one Division 55 activity. This is not beds, capacity or licensed VUT stock.",
    membershipHint: "Non-exclusive membership among premises with populated taxonomy; populated SIN ACTIVIDAD remains included and does not verify operation.",
    conditionalHint: "Administrative density relative to registered residents; not a measure of tourism pressure.",
    dualDate: "Premises: Sep 2026 · Population register: 1 Jan 2026",
    populationReference: "Padrón · 1 Jan 2026",
    unitPremises: "premises",
    unitPercent: "%",
    unitPer1000: "premises per 1,000 registered residents",
    source_included_premises_count: "Source-included premises",
    core_hospitality_premises_count: "Documented hospitality-class premises",
    accommodation_class_premises_count: "Documented accommodation-class premises (Division 55)",
    core_hospitality_membership_share_of_populated_taxonomy_premises:
      "Premises with a documented core-hospitality activity (%)",
    core_hospitality_premises_per_1000_residents:
      "Documented hospitality-class premises per 1,000 registered residents",
  }),
});

const SHA256 = /^[a-f0-9]{64}$/;
const IDS = {
  municipality: /^28079$/,
  district: /^\d{2}$/,
  barrio: /^\d{3}$/,
};

function finiteIndicatorRecord(record) {
  const indicators = record && record.indicators;
  return (
    indicators &&
    APPROVED_INDICATOR_IDS.every(
      (id) => Object.hasOwn(indicators, id) && Number.isFinite(indicators[id]) && indicators[id] >= 0
    ) &&
    Object.keys(indicators).every((id) => APPROVED_INDICATOR_IDS.includes(id))
  );
}

function validCollection(collection, level) {
  return (
    collection &&
    typeof collection === "object" &&
    Object.entries(collection).every(
      ([id, record]) => IDS[level].test(id) && finiteIndicatorRecord(record)
    )
  );
}

export function validateHospitalityArtifact(artifact) {
  const errors = [];
  if (!artifact || artifact.contract_version !== CONTRACT_VERSION) errors.push("unsupported contract version");
  const metadata = artifact && artifact.metadata;
  if (!metadata || typeof metadata !== "object") errors.push("missing metadata");
  else {
    if (metadata.premises_nominal_period !== "2026-09") errors.push("invalid premises period");
    if (metadata.activities_nominal_period !== "2026-09") errors.push("invalid activities period");
    if (!SHA256.test(metadata.premises_sha256 || "")) errors.push("invalid premises fingerprint");
    if (!SHA256.test(metadata.activities_sha256 || "")) errors.push("invalid activities fingerprint");
    if (!SHA256.test(metadata.population_artifact_sha256 || "")) errors.push("invalid population fingerprint");
    if (metadata.geography_version?.era !== "CURRENT_131") errors.push("invalid geography era");
    if (metadata.population_reference_date !== "2026-01-01") errors.push("invalid population date");
    if (metadata.default_indicator_id !== DEFAULT_INDICATOR_ID) errors.push("invalid default indicator");
    if (
      JSON.stringify(metadata.selectable_indicator_ids) !== JSON.stringify(APPROVED_INDICATOR_IDS)
    ) {
      errors.push("invalid indicator allowlist");
    }
    if (!Array.isArray(metadata.interpretation_ceiling) || !metadata.interpretation_ceiling.length) {
      errors.push("missing interpretation ceiling");
    }
    const conditional = metadata.conditional_indicator;
    if (
      conditional?.indicator_id !== CONDITIONAL_INDICATOR_ID ||
      conditional?.premises_period !== "Sep 2026" ||
      conditional?.population_date !== "2026-01-01" ||
      !String(conditional?.denominator_type || "").toLowerCase().includes("registered residents") ||
      !conditional?.interpretation_ceiling
    ) {
      errors.push("missing conditional population metadata");
    }
  }
  if (!validCollection(artifact?.municipality, "municipality")) errors.push("invalid municipality values");
  if (!validCollection(artifact?.districts, "district")) errors.push("invalid district values");
  if (!validCollection(artifact?.barrios, "barrio")) errors.push("invalid barrio values");
  if (Object.keys(artifact?.municipality || {}).length !== 1) errors.push("invalid municipality coverage");
  if (Object.keys(artifact?.districts || {}).length !== 21) errors.push("invalid district coverage");
  if (Object.keys(artifact?.barrios || {}).length !== 131) errors.push("invalid barrio coverage");
  return { ok: errors.length === 0, errors };
}

export function createHospitalityIndex(artifact) {
  const validation = validateHospitalityArtifact(artifact);
  if (!validation.ok) return null;
  return {
    artifact,
    municipality: new Map(Object.entries(artifact.municipality)),
    district: new Map(Object.entries(artifact.districts)),
    barrio: new Map(Object.entries(artifact.barrios)),
  };
}

export function metricUnitKey(indicatorId) {
  if (indicatorId === "core_hospitality_membership_share_of_populated_taxonomy_premises") {
    return "unitPercent";
  }
  if (indicatorId === CONDITIONAL_INDICATOR_ID) return "unitPer1000";
  return "unitPremises";
}

export function interpretationKey(indicatorId) {
  if (indicatorId === "source_included_premises_count") return "sourceCountHint";
  if (indicatorId === "accommodation_class_premises_count") return "accommodationHint";
  if (indicatorId === "core_hospitality_membership_share_of_populated_taxonomy_premises") {
    return "membershipHint";
  }
  if (indicatorId === CONDITIONAL_INDICATOR_ID) return "conditionalHint";
  return "countHint";
}

export function formatMetricValue(indicatorId, value, language = "es") {
  if (!Number.isFinite(value)) return null;
  const locale = language === "en" ? "en-GB" : "es-ES";
  if (indicatorId === "core_hospitality_membership_share_of_populated_taxonomy_premises") {
    return `${value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }
  if (indicatorId === CONDITIONAL_INDICATOR_ID) {
    return value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  }
  return Math.round(value).toLocaleString(locale);
}

export function metricDomain(index, indicatorId) {
  const values = [...index.barrio.values()]
    .map((row) => row.indicators[indicatorId])
    .filter(Number.isFinite);
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
}

export function normalizedMetricValue(value, domain) {
  if (!Number.isFinite(value) || !domain) return null;
  if (domain.max === domain.min) return 0.5;
  return Math.sqrt(Math.max(0, Math.min(1, (value - domain.min) / (domain.max - domain.min))));
}
