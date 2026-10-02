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
const COMPARISON_RADIUS_MODE = Object.freeze({ EQUAL: "EQUAL_RADIUS", UNEQUAL: "UNEQUAL_RADIUS" });

// V2 keeps the analytical comparison model above deliberately separate from
// screen-space presentation. These constants describe the small, fixed map
// instrument only; they are never geographic measurements or data domains.
const HALO_COMPACT_LABELS = Object.freeze({
  tourism: "POI",
  stays: "STAY",
  pedestrian: "PED",
  utci: "UTCI",
});
const HALO_LAYOUT = Object.freeze({ FULL_MIN_RADIUS_PX: 42, COMPACT_MIN_RADIUS_PX: 30 });

function haloCircleAreaKm2(radiusM) {
  return Number.isFinite(radiusM) && radiusM > 0 ? Math.PI * Math.pow(radiusM / 1000, 2) : null;
}

function haloRepresentedRate(count, radiusM) {
  const area = haloCircleAreaKm2(radiusM);
  if (!validNumber(count) || count < 0 || area == null) return null;
  const value = count / area;
  return Number.isFinite(value) ? value : null;
}

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

function countState(a, b, window = {}) {
  const stateA = a?.sourceState;
  const stateB = b?.sourceState;
  const valueA = SOURCE_STATES.has(stateA) && validNumber(a?.value) && a.value >= 0 ? a.value : null;
  const valueB = SOURCE_STATES.has(stateB) && validNumber(b?.value) && b.value >= 0 ? b.value : null;
  const radiusMode = window.radiusMode || COMPARISON_RADIUS_MODE.EQUAL;
  const radiusA = window.radii?.A;
  const radiusB = window.radii?.B;
  if (!SOURCE_STATES.has(stateA) || !SOURCE_STATES.has(stateB)) {
    return {
      id: "unavailable", stateA: valueA == null ? "UNAVAILABLE" : "VALID", stateB: valueB == null ? "UNAVAILABLE" : "VALID",
      aValue: radiusMode === COMPARISON_RADIUS_MODE.EQUAL ? valueA : null, bValue: radiusMode === COMPARISON_RADIUS_MODE.EQUAL ? valueB : null, aRawValue: valueA, bRawValue: valueB, aMagnitude: null, bMagnitude: null,
      delta: null, qualifier: "source unavailable", comparable: false,
    };
  }
  if (stateA !== stateB || !validNumber(a?.value) || !validNumber(b?.value) || a.value < 0 || b.value < 0) {
    return {
      id: "incompatible", stateA: stateA === "unavailable" ? "UNAVAILABLE" : "INCOMPATIBLE",
      stateB: stateB === "unavailable" ? "UNAVAILABLE" : "INCOMPATIBLE",
      aValue: radiusMode === COMPARISON_RADIUS_MODE.EQUAL ? valueA : null, bValue: radiusMode === COMPARISON_RADIUS_MODE.EQUAL ? valueB : null, aRawValue: valueA, bRawValue: valueB,
      aMagnitude: null, bMagnitude: null, delta: null,
      qualifier: "source states differ or a value is unavailable", comparable: false,
    };
  }
  const qualifier = SOURCE_LABELS[stateA];
  if (radiusMode === COMPARISON_RADIUS_MODE.UNEQUAL) {
    if (window.aoiState !== "eligible") {
      const reason = window.aoiState === "unavailable" ? "Madrid AOI unavailable" : window.aoiState === "crosses" ? "circle crosses Madrid AOI" : "circle outside Madrid AOI";
      return { id: "aoi-withheld", stateA: "VALID", stateB: "VALID", aValue: null, bValue: null, aRawValue: a.value, bRawValue: b.value, aMagnitude: null, bMagnitude: null, delta: null, qualifier: reason, comparable: false, reason, aoiEligible: false };
    }
    const rateA = haloRepresentedRate(a.value, radiusA); const rateB = haloRepresentedRate(b.value, radiusB);
    if (rateA == null || rateB == null) return { id: "incompatible", stateA: "INCOMPATIBLE", stateB: "INCOMPATIBLE", aValue: null, bValue: null, aRawValue: a.value, bRawValue: b.value, aMagnitude: null, bMagnitude: null, delta: null, qualifier: "invalid circle area", comparable: false };
    const scale = positivePair(rateA, rateB);
    return { id: stateA === "snapshot" ? "valid-partial" : stateA === "published" ? "valid-deployment" : "valid", stateA: "VALID", stateB: "VALID", aValue: rateA, bValue: rateB, aRawValue: a.value, bRawValue: b.value, aMagnitude: scale.a, bMagnitude: scale.b, delta: rateB - rateA, qualifier: `${qualifier}; represented ${window.metricName === "stays" ? "catalogue records" : "records"}/km²`, comparable: true, aoiEligible: true };
  }
  const scale = positivePair(a.value, b.value);
  return {
    id: stateA === "snapshot" ? "valid-partial" : stateA === "published" ? "valid-deployment" : "valid",
    stateA: stateA === "snapshot" ? "VALID_PARTIAL" : stateA === "published" ? "VALID_DEPLOYMENT" : "VALID",
    stateB: stateA === "snapshot" ? "VALID_PARTIAL" : stateA === "published" ? "VALID_DEPLOYMENT" : "VALID",
    aValue: a.value, bValue: b.value, aRawValue: a.value, bRawValue: b.value, aMagnitude: scale.a, bMagnitude: scale.b,
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
    qualifier: `model-derived · ${timestepA} · 21 Aug 2023 · ${a.count} / ${b.count} samples${a.count !== b.count ? "; counts differ, summarizing different sampled assets/windows" : ""}`, comparable: true,
    aCoverage: `${a.count} model-derived samples`, bCoverage: `${b.count} model-derived samples`,
  };
}

function abstention(id, stateA, stateB, qualifier) {
  return { id, stateA, stateB, aValue: null, bValue: null, aMagnitude: null, bMagnitude: null, delta: null, qualifier, comparable: false };
}

function haloLayoutForRadius(radiusPx) {
  if (!validNumber(radiusPx) || radiusPx < HALO_LAYOUT.COMPACT_MIN_RADIUS_PX) return "hidden";
  return radiusPx < HALO_LAYOUT.FULL_MIN_RADIUS_PX ? "compact" : "full";
}

function haloVisualState(metric, state, which) {
  if (metric.id === "utci" && state.comparable) return "numeric";
  if (state.comparable) return state[which === "A" ? "aMagnitude" : "bMagnitude"] === 0 ? "zero" : "numeric";
  if (state.id === "aoi-withheld") return "withheld";
  const sideState = state[which === "A" ? "stateA" : "stateB"];
  if (sideState === "OFF") return "off";
  if (sideState === "UNAVAILABLE") return "unavailable";
  if (sideState === "NO_EVIDENCE") return "no-evidence";
  return "withheld";
}

function buildHaloGlyphSpec(metric, state, which, layout = "full") {
  const visualState = haloVisualState(metric, state, which);
  const statusLabel = {
    off: "OFF", unavailable: "NA", "no-evidence": "NO DATA", withheld: "WITHHELD",
  }[visualState];
  const spec = {
    metric: metric.id,
    slot: metric.slot,
    which,
    layout,
    label: HALO_COMPACT_LABELS[metric.id],
    visualState,
    type: metric.id === "utci" && visualState === "numeric" ? "temperature" : visualState === "numeric" ? "bar" : visualState === "zero" ? "zero" : "abstain",
    qualified: state.id === "valid-partial" || state.id === "valid-deployment",
  };
  if (visualState === "numeric" && metric.id !== "utci") spec.magnitude = state[which === "A" ? "aMagnitude" : "bMagnitude"];
  if (visualState === "numeric" && metric.id === "utci") spec.offsetPx = state[which === "A" ? "aOffsetPx" : "bOffsetPx"];
  if (statusLabel) spec.label = `${spec.label} · ${statusLabel}`;
  return Object.freeze(spec);
}

// The renderer may remove only the ambiguous slots. Keeping this tiny policy
// pure makes degradation deterministic without putting geometry rules into the
// analytical state model.
function resolveHaloSlotVisibility({ layout, blockedSlots = [] } = {}) {
  const blocked = new Set(blockedSlots);
  return Object.freeze(Object.fromEntries(HALO_METRICS.map((metric) => [metric.id, Object.freeze({
    visible: layout !== "hidden" && !blocked.has(metric.id),
    compact: layout === "compact",
  })])));
}

function buildHaloComparison(input) {
  const radiusMode = input?.radiusMode || COMPARISON_RADIUS_MODE.EQUAL;
  const window = (metricName) => ({ radiusMode, radii: input?.radii, aoiState: input?.aoiState, metricName });
  const metrics = {
    tourism: countState(input?.tourism?.a, input?.tourism?.b, window("tourism")),
    stays: countState(input?.stays?.a, input?.stays?.b, window("stays")),
    pedestrian: activityState(input?.pedestrian || {}),
    utci: utciState(input?.utci || {}),
  };
  return Object.freeze({ order: HALO_METRICS.map((metric) => metric.id), radiusMode, radii: input?.radii || null, aoiState: input?.aoiState || "not-required", metrics: Object.freeze(metrics) });
}

function buildCountPairState(a, b, radiusMode = COMPARISON_RADIUS_MODE.EQUAL) {
  const state = countState(a, b);
  if (radiusMode !== COMPARISON_RADIUS_MODE.UNEQUAL) return state;
  return { ...state, id: state.comparable ? "mobility-withheld" : state.id, delta: null, comparable: false, qualifier: "Withheld · different window sizes" };
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
  const radiusCue = comparison.radii ? `Lens A radius ${comparison.radii.A} m; Lens B radius ${comparison.radii.B} m; ${comparison.radiusMode === COMPARISON_RADIUS_MODE.EQUAL ? "equal windows, raw represented counts" : `different windows; ${comparison.aoiState === "eligible" ? "represented-record rate per km²" : `POI and stay normalized comparison withheld: ${comparison.aoiState}`}`}.` : "";
  const lines = [`Comparison halo. ${radiusCue} Four fixed slots, clockwise from twelve o'clock: Tourism POIs, Stays, Pedestrian activity, UTCI.`];
  for (const metric of HALO_METRICS) {
    const state = comparison.metrics[metric.id];
    const aValue = comparison.radiusMode === COMPARISON_RADIUS_MODE.UNEQUAL && ["tourism", "stays"].includes(metric.id) ? state.aRawValue : state.aValue;
    const bValue = comparison.radiusMode === COMPARISON_RADIUS_MODE.UNEQUAL && ["tourism", "stays"].includes(metric.id) ? state.bRawValue : state.bValue;
    const a = formatValue(aValue, metric.id) || formatEvidenceState(state.stateA);
    const b = formatValue(bValue, metric.id) || formatEvidenceState(state.stateB);
    const coverage = [state.aCoverage && `Lens A coverage: ${state.aCoverage}`, state.bCoverage && `Lens B coverage: ${state.bCoverage}`]
      .filter(Boolean).join(". ");
    if (state.comparable) {
      const differenceText = comparison.radiusMode === COMPARISON_RADIUS_MODE.UNEQUAL && ["tourism", "stays"].includes(metric.id)
        ? `${state.delta > 0 ? "+" : ""}${state.delta.toFixed(1)} represented ${metric.id === "stays" ? "catalogue records" : "records"}/km²`
        : formatDifference(state.delta, metric.id);
      lines.push(`${metric.label}: Lens A ${a}, Lens B ${b}, difference ${differenceText}. ${coverage ? `${coverage}. ` : ""}${state.qualifier}.`);
    } else {
      lines.push(`${metric.label}: Lens A ${a}, Lens B ${b}; comparison withheld. ${coverage ? `${coverage}. ` : ""}${state.qualifier}.`);
    }
  }
  lines.push(`Lens A radius ${comparison.radii?.A ?? "unknown"} m; Lens B radius ${comparison.radii?.B ?? "unknown"} m. The full track uses the pair maximum for the active same-unit comparator only; this is a local display scale, not a benchmark. UTCI marks use a neutral local midpoint and two pixels per degree Celsius. No mark is a score or recommendation.`);
  return lines.join(" ");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HALO_METRICS, SOURCE_LABELS, DISPLAY_STATE, UTCI_PX_PER_C, COMPARISON_RADIUS_MODE, circleAreaKm2: haloCircleAreaKm2, representedRate: haloRepresentedRate,
    HALO_COMPACT_LABELS, HALO_LAYOUT, normalizedCountPair, positivePair, buildCountPairState, buildHaloComparison, accessibleComparisonSummary,
    haloLayoutForRadius, buildHaloGlyphSpec, resolveHaloSlotVisibility,
  };
}
