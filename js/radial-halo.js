// Pure comparison model for the V1 map halo. The halo is supplementary and
// intentionally admits only four circle evidence families.
const HALO_METRICS = Object.freeze([
  Object.freeze({ id: "tourism", label: "Tourism POIs", slot: "north", unit: "represented records" }),
  Object.freeze({ id: "stays", label: "Stays", slot: "east", unit: "represented listings" }),
  Object.freeze({ id: "pedestrian", label: "Pedestrian activity", slot: "south", unit: "observed pedestrians/hour" }),
  Object.freeze({ id: "utci", label: "UTCI", slot: "west", unit: "°C" }),
]);

const SOURCE_STATES = new Set(["live", "published", "snapshot"]);
const SOURCE_LABELS = Object.freeze({
  live: "live source",
  published: "deployment snapshot",
  snapshot: "snapshot sample (not exhaustive)",
});
const DISPLAY_STATE = Object.freeze({
  VALID: "valid value",
  VALID_PARTIAL: "valid value · snapshot sample",
  VALID_DEPLOYMENT: "valid value · deployment snapshot",
  OFF: "off",
  UNAVAILABLE: "unavailable",
  NO_EVIDENCE: "no evidence",
  INCOMPATIBLE: "comparison withheld · incompatible evidence",
});
const UTCI_PX_PER_C = 2;

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function positivePair(a, b) {
  if (!validNumber(a) || !validNumber(b) || a < 0 || b < 0) return null;
  const max = Math.max(a, b);
  return {
    max,
    a: max === 0 ? 0 : a / max,
    b: max === 0 ? 0 : b / max,
  };
}

function normalizedCountPair(a, b) {
  return positivePair(a, b);
}

function difference(a, b) {
  return validNumber(a) && validNumber(b) ? b - a : null;
}

function countState(a, b) {
  const stateA = a?.sourceState;
  const stateB = b?.sourceState;
  const valueA = SOURCE_STATES.has(stateA) && validNumber(a?.value) && a.value >= 0 ? a.value : null;
  const valueB = SOURCE_STATES.has(stateB) && validNumber(b?.value) && b.value >= 0 ? b.value : null;
  if (!SOURCE_STATES.has(stateA) || !SOURCE_STATES.has(stateB)) {
    return {
      id: "unavailable", stateA: valueA == null ? "UNAVAILABLE" : "VALID", stateB: valueB == null ? "UNAVAILABLE" : "VALID",
      aValue: valueA, bValue: valueB, aMagnitude: null, bMagnitude: null,
      delta: null, qualifier: "source unavailable", comparable: false,
    };
  }
  if (stateA !== stateB || !validNumber(a?.value) || !validNumber(b?.value) || a.value < 0 || b.value < 0) {
    return {
      id: "incompatible", stateA: stateA === "unavailable" ? "UNAVAILABLE" : "INCOMPATIBLE",
      stateB: stateB === "unavailable" ? "UNAVAILABLE" : "INCOMPATIBLE",
      aValue: valueA, bValue: valueB,
      aMagnitude: null, bMagnitude: null, delta: null,
      qualifier: "source states differ or a value is unavailable", comparable: false,
    };
  }
  const scale = positivePair(a.value, b.value);
  const qualifier = SOURCE_LABELS[stateA];
  return {
    id: stateA === "snapshot" ? "valid-partial" : stateA === "published" ? "valid-deployment" : "valid",
    stateA: stateA === "snapshot" ? "VALID_PARTIAL" : stateA === "published" ? "VALID_DEPLOYMENT" : "VALID",
    stateB: stateA === "snapshot" ? "VALID_PARTIAL" : stateA === "published" ? "VALID_DEPLOYMENT" : "VALID",
    aValue: a.value, bValue: b.value, aMagnitude: scale.a, bMagnitude: scale.b,
    delta: b.value - a.value, qualifier, comparable: true,
  };
}

function activityState({ enabled, sourceState, a, b, periodKey }) {
  if (sourceState === "unavailable" || !SOURCE_STATES.has(sourceState)) {
    return abstention("unavailable", "UNAVAILABLE", "UNAVAILABLE", "source unavailable");
  }
  if (!enabled) return abstention("off", "OFF", "OFF", "layer off");
  const observed = (side) => side?.evidence === "OBSERVED" && validNumber(side.meanObserved) && side.meanObserved >= 0 && side.observationCount > 0;
  const hasA = observed(a);
  const hasB = observed(b);
  if (!hasA || !hasB) {
    return {
      id: "no-evidence", stateA: hasA ? "VALID" : "NO_EVIDENCE", stateB: hasB ? "VALID" : "NO_EVIDENCE",
      aValue: hasA ? a.meanObserved : null, bValue: hasB ? b.meanObserved : null,
      aMagnitude: null, bMagnitude: null, delta: null,
      qualifier: "comparison withheld because one or both lenses have no observed counters", comparable: false,
      aCoverage: hasA ? coverageText(a) : null, bCoverage: hasB ? coverageText(b) : null,
    };
  }
  if (periodKey == null || !Number.isFinite(periodKey.length) || periodKey.length === 0) {
    return abstention("incompatible", "INCOMPATIBLE", "INCOMPATIBLE", "pedestrian source period unavailable");
  }
  const scale = positivePair(a.meanObserved, b.meanObserved);
  const id = sourceState === "snapshot" ? "valid-partial" : sourceState === "published" ? "valid-deployment" : "valid";
  const evidenceState = id === "valid-partial" ? "VALID_PARTIAL" : id === "valid-deployment" ? "VALID_DEPLOYMENT" : "VALID";
  return {
    id, stateA: evidenceState, stateB: evidenceState, aValue: a.meanObserved, bValue: b.meanObserved,
    aMagnitude: scale.a, bMagnitude: scale.b, delta: b.meanObserved - a.meanObserved,
    qualifier: `${SOURCE_LABELS[sourceState]}; ${periodKey}; ${a.stationCount} / ${b.stationCount} counters`, comparable: true,
    aCoverage: coverageText(a), bCoverage: coverageText(b),
  };
}

function coverageText(side) {
  const dates = side.dateMin && side.dateMax ? `, ${side.dateMin} to ${side.dateMax}` : "";
  return `${side.stationCount} counter${side.stationCount === 1 ? "" : "s"}, ${side.observationCount} observations${dates}`;
}

function utciState({ enabled, timestepA, timestepB, a, b }) {
  if (!enabled) return abstention("off", "OFF", "OFF", "HATI layer off");
  const validA = a?.evidence === "MODEL-DERIVED" && validNumber(a.mean) && a.count > 0;
  const validB = b?.evidence === "MODEL-DERIVED" && validNumber(b.mean) && b.count > 0;
  if (!validA || !validB) {
    return {
      id: "no-evidence", stateA: validA ? "VALID" : "NO_EVIDENCE", stateB: validB ? "VALID" : "NO_EVIDENCE",
      aValue: validA ? a.mean : null, bValue: validB ? b.mean : null,
      aMagnitude: null, bMagnitude: null, delta: null,
      qualifier: "comparison withheld because one or both lenses have no HATI sample", comparable: false,
      aCoverage: validA ? `${a.count} model-derived samples` : null,
      bCoverage: validB ? `${b.count} model-derived samples` : null,
    };
  }
  if (timestepA !== timestepB) {
    return abstention("incompatible", "INCOMPATIBLE", "INCOMPATIBLE", "HATI timesteps differ");
  }
  const midpoint = (a.mean + b.mean) / 2;
  return {
    id: "valid-utci", stateA: "VALID", stateB: "VALID", aValue: a.mean, bValue: b.mean,
    aOffsetPx: (a.mean - midpoint) * UTCI_PX_PER_C,
    bOffsetPx: (b.mean - midpoint) * UTCI_PX_PER_C,
    midpoint, pixelsPerC: UTCI_PX_PER_C, delta: b.mean - a.mean,
    qualifier: `model-derived · ${timestepA} · 21 Aug 2023 · ${a.count} / ${b.count} samples`, comparable: true,
    aCoverage: `${a.count} model-derived samples`, bCoverage: `${b.count} model-derived samples`,
  };
}

function abstention(id, stateA, stateB, qualifier) {
  return { id, stateA, stateB, aValue: null, bValue: null, aMagnitude: null, bMagnitude: null, delta: null, qualifier, comparable: false };
}

function buildHaloComparison(input) {
  const metrics = {
    tourism: countState(input?.tourism?.a, input?.tourism?.b),
    stays: countState(input?.stays?.a, input?.stays?.b),
    pedestrian: activityState(input?.pedestrian || {}),
    utci: utciState(input?.utci || {}),
  };
  return Object.freeze({ order: HALO_METRICS.map((metric) => metric.id), metrics: Object.freeze(metrics) });
}

function buildCountPairState(a, b) {
  return countState(a, b);
}

function formatValue(value, id) {
  if (!validNumber(value)) return null;
  if (id === "tourism" || id === "stays") return `${value} ${id === "tourism" ? "represented records" : "represented listings"}`;
  if (id === "pedestrian") return `${value.toFixed(1)} observed pedestrians/hour`;
  return `${value.toFixed(1)}°C`;
}

function formatDifference(value, id) {
  if (!validNumber(value)) return null;
  const display = id === "utci" || id === "pedestrian" ? value.toFixed(1) : String(value);
  const signed = value > 0 ? `+${display}` : display;
  return id === "utci" ? `${signed}°C` : id === "pedestrian" ? `${signed} observed pedestrians/hour` : signed;
}

function formatEvidenceState(state) {
  return ({
    OFF: "off",
    UNAVAILABLE: "unavailable",
    NO_EVIDENCE: "no evidence",
    INCOMPATIBLE: "comparison withheld",
    VALID: "valid value",
    VALID_PARTIAL: "valid snapshot sample",
    VALID_DEPLOYMENT: "valid deployment snapshot",
  })[state] || "evidence state unknown";
}

function accessibleComparisonSummary(comparison) {
  const lines = ["Comparison halo. Four fixed slots, clockwise from twelve o'clock: Tourism POIs, Stays, Pedestrian activity, UTCI."];
  for (const metric of HALO_METRICS) {
    const state = comparison.metrics[metric.id];
    const a = formatValue(state.aValue, metric.id) || formatEvidenceState(state.stateA);
    const b = formatValue(state.bValue, metric.id) || formatEvidenceState(state.stateB);
    const coverage = [state.aCoverage && `Lens A coverage: ${state.aCoverage}`, state.bCoverage && `Lens B coverage: ${state.bCoverage}`]
      .filter(Boolean).join(". ");
    if (state.comparable) {
      lines.push(`${metric.label}: Lens A ${a}, Lens B ${b}, difference ${formatDifference(state.delta, metric.id)}. ${coverage ? `${coverage}. ` : ""}${state.qualifier}.`);
    } else {
      lines.push(`${metric.label}: Lens A ${a}, Lens B ${b}; comparison withheld. ${coverage ? `${coverage}. ` : ""}${state.qualifier}.`);
    }
  }
  lines.push("The full count track represents the largest valid value in this A/B comparison only; this is a local display scale, not a benchmark. UTCI marks use a neutral local midpoint and two pixels per degree Celsius. No mark is a score or recommendation.");
  return lines.join(" ");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HALO_METRICS, SOURCE_LABELS, DISPLAY_STATE, UTCI_PX_PER_C,
    normalizedCountPair, positivePair, buildCountPairState, buildHaloComparison, accessibleComparisonSummary,
  };
}
