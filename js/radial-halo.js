// Radial Halo V3 — Quantitative Perimeter Bars.
//
// The halo turns the Lens circumference into a compact quantitative display:
// four fixed perimeter bars, each printing its own raw value, so the map alone
// answers WHAT / HOW MUCH / RELATIVELY HOW STRONG without the right-hand panel.
//
// Scientific contract (see docs/radial-halo-v3.md):
//   * BAR LENGTHS ARE COMPARABLE WITHIN THE SAME METRIC, NOT ACROSS METRICS.
//   * Each bar is a within-metric magnitude = clamp(rawValue / reference, 0..1),
//     where `reference` is a deterministic Madrid comparison universe for that
//     metric (p95 of per-feature local density in a fixed reference window for
//     counts; a data-derived robust Celsius band for UTCI).
//   * The SAME reference is used for Lens A and Lens B, so a larger valid raw
//     value never yields a shorter bar than a smaller one under the same metric.
//   * Raw values are always printed. Unavailable data is "N/A", never 0; a
//     genuine 0 stays a distinct zero state.
const HALO_METRICS = Object.freeze([
  Object.freeze({ id: "tourism", label: "Tourism POIs", slot: "north", unit: "POIs", kind: "count" }),
  Object.freeze({ id: "stays", label: "Hotels & stays", slot: "east", unit: "stays", kind: "count" }),
  Object.freeze({ id: "mobility", label: "Mobility nodes", slot: "south", unit: "nodes", kind: "count" }),
  Object.freeze({ id: "utci", label: "Mean UTCI", slot: "west", unit: "°C", kind: "temperature" }),
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

// Deterministic reference universe for the within-metric bar scale. For count
// metrics the reference is a DENSITY (records/km² or nodes/km²): the p95 of each
// feature's same-metric local density — its neighbour count inside a fixed
// reference window divided by that window's area. The UTCI band is a robust
// Celsius spread. Both are derived from the loaded dataset (see
// computeHaloReferenceScales / deriveHaloUtciBand) and are intentionally
// independent of the live Lens radius, so the bar's *scale semantics* never
// change merely because the geography changes.
//
// Because the bar encodes spatial density (rawCount / circleAreaKm2(radius))
// rather than a raw count, unequal Lens radii stay directly comparable: a larger
// window no longer buys a longer bar for free. The printed number is always the
// RAW COUNT; the bar length is the represented density relative to this
// reference. Lens A and Lens B share the reference, so bars never normalize
// independently. See docs/radial-halo-v3.md.
const HALO_REFERENCE_DEFAULTS = Object.freeze({ radiusM: 900, quantile: 0.95 });
const HALO_UTCI_FALLBACK_BAND = Object.freeze({ min: 26, max: 46 });

// Compact captions are identifiers only; they do not encode magnitude.
const HALO_COMPACT_LABELS = Object.freeze({
  tourism: "POI",
  stays: "STAY",
  mobility: "MOB",
  utci: "UTCI",
});
// Fixed clockwise positions keyed by canonical metric identity. Angles use SVG
// screen coordinates: 0° points right and positive angles turn clockwise.
const HALO_METRIC_SLOT_ANGLES = Object.freeze({
  tourism: -90, // 12 o'clock
  stays: -30, // 2 o'clock
  mobility: 90, // 6 o'clock
  utci: 180, // 9 o'clock
});
const HALO_RADIAL_GEOMETRY = Object.freeze({ RADIAL_GAP: 5, MAX_BAR_LENGTH: 44, BAR_THICKNESS: 4.5, LABEL_GAP: 7, CAPTION_GAP: 12, FULL_MIN_RADIUS_PX: 42, COMPACT_MIN_RADIUS_PX: 30 });
const HALO_LAYOUT = Object.freeze({ FULL_MIN_RADIUS_PX: HALO_RADIAL_GEOMETRY.FULL_MIN_RADIUS_PX, COMPACT_MIN_RADIUS_PX: HALO_RADIAL_GEOMETRY.COMPACT_MIN_RADIUS_PX });
// Compatibility surface for callers that only need rendering thresholds.
const HALO_VISUAL_GEOMETRY = HALO_RADIAL_GEOMETRY;

function getMetricSlotAngle(metricId) {
  return Object.hasOwn(HALO_METRIC_SLOT_ANGLES, metricId) ? HALO_METRIC_SLOT_ANGLES[metricId] : null;
}

function getRadialUnitVector(angleDegrees) {
  if (!validNumber(angleDegrees)) return null;
  const radians = angleDegrees * Math.PI / 180;
  return Object.freeze({ x: Math.cos(radians), y: Math.sin(radians) });
}

function getHaloBarGeometry({ center, renderedRadius, angle, magnitude, maxLength = HALO_RADIAL_GEOMETRY.MAX_BAR_LENGTH, radialGap = HALO_RADIAL_GEOMETRY.RADIAL_GAP, thickness = HALO_RADIAL_GEOMETRY.BAR_THICKNESS } = {}) {
  if (!center || !validNumber(center.x) || !validNumber(center.y) || !validNumber(renderedRadius) || renderedRadius < 0) return null;
  if (!validNumber(magnitude)) return null;
  if (!validNumber(maxLength) || maxLength < 0 || !validNumber(radialGap) || radialGap < 0 || !validNumber(thickness) || thickness <= 0) return null;
  const unit = getRadialUnitVector(angle);
  if (!unit) return null;
  const length = Math.max(0, Math.min(1, magnitude)) * maxLength;
  const originDistance = renderedRadius + radialGap;
  const origin = Object.freeze({ x: center.x + unit.x * originDistance, y: center.y + unit.y * originDistance });
  const endpoint = Object.freeze({ x: origin.x + unit.x * length, y: origin.y + unit.y * length });
  return Object.freeze({ center: Object.freeze({ x: center.x, y: center.y }), angle, unit, origin, endpoint, length, thickness });
}

function getHaloLabelGeometry({ endpoint, angle, gap = HALO_RADIAL_GEOMETRY.LABEL_GAP } = {}) {
  if (!endpoint || !validNumber(endpoint.x) || !validNumber(endpoint.y) || !validNumber(gap) || gap < 0) return null;
  const unit = getRadialUnitVector(angle);
  if (!unit) return null;
  const x = endpoint.x + unit.x * gap;
  const y = endpoint.y + unit.y * gap;
  const textAnchor = Math.abs(unit.x) < 0.35 ? "middle" : unit.x > 0 ? "start" : "end";
  return Object.freeze({ x, y, textAnchor });
}

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Compatibility anchors for pure callers. The live renderer places labels from
// the actual bar endpoint, so they move with the encoded magnitude.
function haloValueAnchorForSlot(slot, layout = "full") {
  const metricId = Object.keys(HALO_METRIC_SLOT_ANGLES).find((id) => id === slot || HALO_METRICS.find((metric) => metric.id === id)?.slot === slot);
  const angle = getMetricSlotAngle(metricId);
  if (angle == null) return null;
  const unit = getRadialUnitVector(angle);
  const track = HALO_RADIAL_GEOMETRY.MAX_BAR_LENGTH;
  return getHaloLabelGeometry({ endpoint: { x: unit.x * track, y: unit.y * track }, angle });
}

// Backward-compatible caption anchor helper (full layout only).
function haloLabelAnchorForSlot(slot, layout = "full") {
  if (layout !== "full") return null;
  const value = haloValueAnchorForSlot(slot, layout);
  if (!value) return null;
  const metricId = Object.keys(HALO_METRIC_SLOT_ANGLES).find((id) => id === slot || HALO_METRICS.find((metric) => metric.id === id)?.slot === slot);
  const unit = getRadialUnitVector(getMetricSlotAngle(metricId));
  return Object.freeze({ x: value.x + unit.x * 12, y: value.y + unit.y * 12, textAnchor: value.textAnchor });
}

// Footprints include the longest text so collision handling stays conservative.
function haloSlotFootprint(slot, layout = "full") {
  const metricId = HALO_METRICS.find((metric) => metric.slot === slot)?.id;
  const angle = getMetricSlotAngle(metricId);
  if (angle == null) return null;
  const unit = getRadialUnitVector(angle);
  const along = HALO_RADIAL_GEOMETRY.MAX_BAR_LENGTH
    + HALO_RADIAL_GEOMETRY.LABEL_GAP + HALO_RADIAL_GEOMETRY.CAPTION_GAP + 26;
  const across = layout === "compact" ? 14 : 18;
  const corners = [
    { along: -4, across: -across }, { along, across: -across },
    { along, across }, { along: -4, across },
  ].map(({ along: a, across: b }) => ({ x: unit.x * a - unit.y * b, y: unit.y * a + unit.x * b }));
  return {
    minX: Math.min(...corners.map(({ x }) => x)), maxX: Math.max(...corners.map(({ x }) => x)),
    minY: Math.min(...corners.map(({ y }) => y)), maxY: Math.max(...corners.map(({ y }) => y)),
  };
}

function haloFootprintsOverlap(pointA, footprintA, pointB, footprintB) {
  return pointA.x + footprintA.minX < pointB.x + footprintB.maxX
    && pointA.x + footprintA.maxX > pointB.x + footprintB.minX
    && pointA.y + footprintA.minY < pointB.y + footprintB.maxY
    && pointA.y + footprintA.maxY > pointB.y + footprintB.minY;
}

// --- Deterministic reference universe -------------------------------------

const HALO_EARTH_RADIUS_M = 6371000;
function haloRadians(value) {
  return (value * Math.PI) / 180;
}
function haloHaversineMeters(a, b) {
  const dLat = haloRadians(b.lat - a.lat);
  const dLon = haloRadians(b.lon - a.lon);
  const la1 = haloRadians(a.lat);
  const la2 = haloRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * HALO_EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Nearest-rank quantile on a copy; deterministic and dependency-free.
function haloQuantile(values, p) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return 0;
  const sorted = [...finite].sort((x, y) => x - y);
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
  return sorted[Math.min(sorted.length - 1, Math.round(clamped * (sorted.length - 1)))];
}
function haloPointMetric(type) {
  if (type === "museum" || type === "info") return "tourism";
  if (type === "stay") return "stays";
  if (type === "bike" || type === "rail") return "mobility";
  return null;
}
// Per-metric reference DENSITY (records/km² or nodes/km²): the p-quantile of each
// feature's same-metric local density — its neighbour count inside a fixed
// reference window divided by that window's area. Alignment-free (windows centre
// on real features) and deterministic given the points, radius and quantile. The
// neighbour count is floored at 1 so the reference density is always positive and
// a bar never divides by zero.
function computeHaloReferenceScales(points, options = {}) {
  const radiusM = Number.isFinite(options.radiusM) ? options.radiusM : HALO_REFERENCE_DEFAULTS.radiusM;
  const quantile = Number.isFinite(options.quantile) ? options.quantile : HALO_REFERENCE_DEFAULTS.quantile;
  const windowAreaKm2 = haloCircleAreaKm2(radiusM) || 1;
  const groups = { tourism: [], stays: [], mobility: [] };
  for (const point of points || []) {
    const lat = Number(point.lat);
    const lon = Number(point.lon ?? point.lng);
    const metric = haloPointMetric(point.type);
    if (metric && Number.isFinite(lat) && Number.isFinite(lon)) groups[metric].push({ lat, lon });
  }
  // Each metric value is a DENSITY in records/km², not a raw neighbour count.
  const scales = { radiusM, quantile };
  for (const metric of ["tourism", "stays", "mobility"]) {
    const features = groups[metric];
    const localDensities = features.map((centre) => {
      let count = 0;
      for (const other of features) if (haloHaversineMeters(centre, other) <= radiusM) count += 1;
      return Math.max(1, count) / windowAreaKm2;
    });
    const floorDensity = 1 / windowAreaKm2;
    scales[metric] = Math.max(floorDensity, haloQuantile(localDensities, quantile));
  }
  return Object.freeze(scales);
}
// Robust Celsius band for UTCI bars from the model-derived asset values.
function deriveHaloUtciBand(assets, options = {}) {
  const lower = Number.isFinite(options.lowerQuantile) ? options.lowerQuantile : 0.05;
  const upper = Number.isFinite(options.upperQuantile) ? options.upperQuantile : 0.95;
  const list = Array.isArray(assets) ? assets : Object.values(assets || {});
  const values = [];
  for (const asset of list) {
    const means = asset && asset.utci_mean_10m;
    if (means && typeof means === "object") {
      for (const key of Object.keys(means)) {
        const value = Number(means[key]);
        if (Number.isFinite(value)) values.push(value);
      }
    }
  }
  if (values.length < 2) return { ...HALO_UTCI_FALLBACK_BAND };
  const min = haloQuantile(values, lower);
  const max = haloQuantile(values, upper);
  if (!(max > min)) return { ...HALO_UTCI_FALLBACK_BAND };
  return Object.freeze({ min, max });
}

// --- Within-metric bar magnitude + value formatting ------------------------

// Represented spatial density of a count metric inside a Lens, records/km².
function haloDensity(rawCount, radiusM) {
  if (!validNumber(rawCount) || rawCount < 0) return null;
  const area = haloCircleAreaKm2(radiusM);
  if (area == null) return null;
  return rawCount / area;
}
// Count-metric bar magnitude: the represented density relative to the fixed
// metric reference density, clamped to [0, 1]. Because it is a density (not a
// raw count), the same raw count in a smaller Lens yields a longer bar, and two
// Lenses whose counts scale with their areas yield equal bars — so unequal radii
// stay directly comparable. The printed number remains the raw count.
function haloDensityMagnitude(rawCount, radiusM, referenceDensity) {
  const density = haloDensity(rawCount, radiusM);
  if (density == null) return null;
  if (!validNumber(referenceDensity) || referenceDensity <= 0) return null;
  const magnitude = density / referenceDensity;
  return magnitude < 0 ? 0 : magnitude > 1 ? 1 : magnitude;
}
function haloUtciMagnitude(mean, band) {
  if (!validNumber(mean) || !band || !validNumber(band.min) || !validNumber(band.max) || band.max <= band.min) return null;
  const magnitude = (mean - band.min) / (band.max - band.min);
  return magnitude < 0 ? 0 : magnitude > 1 ? 1 : magnitude;
}
function haloGroupThousands(integer) {
  const sign = integer < 0 ? "-" : "";
  const digits = String(Math.abs(integer));
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ",";
    grouped += digits[index];
  }
  return sign + grouped;
}
function formatHaloValue(metricId, rawValue) {
  if (!validNumber(rawValue)) return null;
  if (metricId === "utci") return `${rawValue.toFixed(1)}°C`;
  return haloGroupThousands(Math.round(rawValue));
}

// --- Comparison / panel analytical model ----------------------------------

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

function haloCircleAreaKm2(radiusM) {
  return Number.isFinite(radiusM) && radiusM > 0 ? Math.PI * Math.pow(radiusM / 1000, 2) : null;
}

function haloRepresentedRate(count, radiusM) {
  const area = haloCircleAreaKm2(radiusM);
  if (!validNumber(count) || count < 0 || area == null) return null;
  const value = count / area;
  return Number.isFinite(value) ? value : null;
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

// Pedestrian activity remains an analytical comparison for the right-hand panel
// only (it is observed activity evidence, not a POI count, and is deliberately
// absent from the four perimeter bars).
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
  if (!validA && !validB) {
    return {
      id: "no-evidence", stateA: "NO_EVIDENCE", stateB: "NO_EVIDENCE", aValue: null, bValue: null,
      aMagnitude: null, bMagnitude: null, delta: null,
      qualifier: "comparison withheld because neither lens has a HATI sample", comparable: false,
      aCoverage: null, bCoverage: null,
    };
  }
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

// --- Per-side bar attachment ----------------------------------------------

// Each perimeter bar is per-side and honest about that side alone: a side with
// a valid raw value always shows its own bar + number, regardless of whether
// the A/B *delta* is comparable. Cross-side comparability still governs the
// panel delta, never a lens's own bar.
function attachCountBars(state, metricId, references, radii) {
  const referenceDensity = references?.[metricId];
  const radiusA = radii?.A;
  const radiusB = radii?.B;
  state.aSideState = validNumber(state.aRawValue) ? "VALID" : "UNAVAILABLE";
  state.bSideState = validNumber(state.bRawValue) ? "VALID" : "UNAVAILABLE";
  // Bar = represented density relative to the shared metric reference density.
  state.aDensity = haloDensity(state.aRawValue, radiusA);
  state.bDensity = haloDensity(state.bRawValue, radiusB);
  state.aBarMagnitude = haloDensityMagnitude(state.aRawValue, radiusA, referenceDensity);
  state.bBarMagnitude = haloDensityMagnitude(state.bRawValue, radiusB, referenceDensity);
  // Saturated = density strictly above the reference (bar clamps at full length).
  state.aSaturated = validNumber(referenceDensity) && referenceDensity > 0 && state.aDensity != null && state.aDensity > referenceDensity;
  state.bSaturated = validNumber(referenceDensity) && referenceDensity > 0 && state.bDensity != null && state.bDensity > referenceDensity;
  // Printed number is always the RAW COUNT.
  state.aValueText = formatHaloValue(metricId, state.aRawValue);
  state.bValueText = formatHaloValue(metricId, state.bRawValue);
  state.aQualified = state.id === "valid-partial" || state.id === "valid-deployment";
  state.bQualified = state.aQualified;
  state.referenceDensity = validNumber(referenceDensity) ? referenceDensity : null;
  return state;
}

function utciSideState(evidenceState) {
  if (evidenceState === "VALID") return "VALID";
  if (evidenceState === "OFF") return "OFF";
  if (evidenceState === "NO_EVIDENCE") return "NO_EVIDENCE";
  return "UNAVAILABLE";
}
function attachUtciBars(state, band) {
  state.aSideState = utciSideState(state.stateA);
  state.bSideState = utciSideState(state.stateB);
  state.aBarMagnitude = state.aSideState === "VALID" ? haloUtciMagnitude(state.aValue, band) : null;
  state.bBarMagnitude = state.bSideState === "VALID" ? haloUtciMagnitude(state.bValue, band) : null;
  state.aValueText = state.aSideState === "VALID" ? formatHaloValue("utci", state.aValue) : null;
  state.bValueText = state.bSideState === "VALID" ? formatHaloValue("utci", state.bValue) : null;
  state.aQualified = false;
  state.bQualified = false;
  state.referenceBand = band ? { min: band.min, max: band.max } : null;
  return state;
}

function buildHaloComparison(input) {
  const radiusMode = input?.radiusMode || COMPARISON_RADIUS_MODE.EQUAL;
  const references = input?.references || null;
  const utciBand = input?.utciBand || null;
  const radii = input?.radii || null;
  const window = (metricName) => ({ radiusMode, radii, aoiState: input?.aoiState, metricName });
  const metrics = {
    tourism: attachCountBars(countState(input?.tourism?.a, input?.tourism?.b, window("tourism")), "tourism", references, radii),
    stays: attachCountBars(countState(input?.stays?.a, input?.stays?.b, window("stays")), "stays", references, radii),
    mobility: attachCountBars(countState(input?.mobility?.a, input?.mobility?.b, window("mobility")), "mobility", references, radii),
    utci: attachUtciBars(utciState(input?.utci || {}), utciBand),
  };
  return Object.freeze({ order: HALO_METRICS.map((metric) => metric.id), radiusMode, radii: input?.radii || null, aoiState: input?.aoiState || "not-required", references, utciBand, metrics: Object.freeze(metrics) });
}

function buildCountPairState(a, b, radiusMode = COMPARISON_RADIUS_MODE.EQUAL) {
  const state = countState(a, b);
  if (radiusMode !== COMPARISON_RADIUS_MODE.UNEQUAL) return state;
  return { ...state, id: state.comparable ? "mobility-withheld" : state.id, delta: null, comparable: false, qualifier: "Withheld · different window sizes" };
}

// --- Comparison Bridge presentation model ----------------------------------
//
// The Bridge is the FOCUSED reading of a single metric: Lens A's value, Lens B's
// value and ONE relationship — the observed B − A when the comparison is valid,
// or an explicit withheld reason when it is not. It is built from the SAME
// authoritative comparison state objects the panel table renders (the metric
// state from buildHaloComparison; the mobility pair state from
// buildCountPairState), so it invents no arithmetic of its own: the difference
// is state.delta, comparability is state.comparable, and the reason is derived
// from the state's own id/qualifier. One metric therefore has exactly one
// interpretation across the halo, the Bridge and the table.
//
// The model is INTENTIONALLY free of display language: it returns neutral codes
// (per-side evidence, a numeric delta, a reason code, a basis code) and the view
// layer localizes them. It never ranks, scores or judges a lens; a positive
// B − A is arithmetic direction only, never "better".
const BRIDGE_METRIC_IDS = Object.freeze(["tourism", "stays", "mobility", "utci"]);

// Per-side evidence for the Bridge: VALID (a real value), ZERO (a genuine
// observed zero — count metrics only), OFF (layer disabled) or N_A (unavailable
// / no evidence). OFF and N_A never collapse into a zero value.
function bridgeSideEvidence(metricId, state, which) {
  if (metricId === "utci") {
    const sideState = state[which === "A" ? "aSideState" : "bSideState"];
    if (sideState === "VALID") return "VALID";
    if (sideState === "OFF") return "OFF";
    return "N_A";
  }
  const raw = state[which === "A" ? "aRawValue" : "bRawValue"];
  if (!validNumber(raw) || raw < 0) return "N_A";
  return raw === 0 ? "ZERO" : "VALID";
}

// Maps a withheld state to a concise, neutral reason code the view localizes.
function bridgeWithheldReason(metricId, state) {
  if (metricId === "utci") {
    if (state.id === "off") return "layer-off";
    if (state.id === "incompatible") return "timesteps-differ";
    return "no-evidence";
  }
  if (state.id === "mobility-withheld") return "different-window-sizes";
  if (state.id === "aoi-withheld") {
    if (state.qualifier === "circle crosses Madrid AOI") return "aoi-crosses";
    if (state.qualifier === "circle outside Madrid AOI") return "aoi-outside";
    return "aoi-unavailable";
  }
  if (state.id === "off") return "layer-off";
  return "source-incompatible";
}

function bridgeSideModel(metricId, state, which, radiusMode) {
  const evidence = bridgeSideEvidence(metricId, state, which);
  // UTCI carries its value on aValue/bValue; count metrics on aRawValue/bRawValue
  // (the printed number is always the raw count, matching the halo glyph).
  const raw = metricId === "utci"
    ? (evidence === "VALID" ? state[which === "A" ? "aValue" : "bValue"] : null)
    : state[which === "A" ? "aRawValue" : "bRawValue"];
  const valueText = (evidence === "VALID" || evidence === "ZERO") ? formatHaloValue(metricId, raw) : null;
  // Represented density is surfaced only for count metrics whose cross-side
  // comparison the panel actually authorizes (tourism / stays under unequal
  // radii). Mobility never converts to density; UTCI is a Celsius band.
  let densityValue = null;
  if (metricId !== "utci" && radiusMode === COMPARISON_RADIUS_MODE.UNEQUAL && state.comparable) {
    const rate = state[which === "A" ? "aValue" : "bValue"];
    if (validNumber(rate)) densityValue = rate;
  }
  return Object.freeze({ evidence, rawValue: validNumber(raw) ? raw : null, valueText, densityValue });
}

// Build the Bridge view-model for one metric from its authoritative state. The
// `state` is exactly the object the table renders (buildHaloComparison metric or
// buildCountPairState for mobility), so Bridge and table can never disagree.
function buildComparisonBridgeModel({ metricId, state, radiusMode = COMPARISON_RADIUS_MODE.EQUAL, radii = null } = {}) {
  if (!BRIDGE_METRIC_IDS.includes(metricId) || !state) return null;
  const metric = HALO_METRICS.find((candidate) => candidate.id === metricId);
  const a = bridgeSideModel(metricId, state, "A", radiusMode);
  const b = bridgeSideModel(metricId, state, "B", radiusMode);
  // A difference exists only when the panel authorizes the comparison AND both
  // sides carry a real value: OFF / N_A never participate in a delta.
  const comparable = Boolean(state.comparable) && validNumber(state.delta)
    && a.evidence !== "OFF" && b.evidence !== "OFF" && a.evidence !== "N_A" && b.evidence !== "N_A";
  const deltaKind = !comparable ? null
    : metricId === "utci" ? "temperature"
    : radiusMode === COMPARISON_RADIUS_MODE.UNEQUAL ? "density" : "count";
  const basisCode = !comparable ? null
    : metricId === "utci" ? "celsius"
    : radiusMode === COMPARISON_RADIUS_MODE.UNEQUAL ? "density" : "raw-counts";
  return Object.freeze({
    metricId,
    kind: metric.kind,
    unitCode: metric.unit,
    radiusMode,
    a: Object.freeze({ ...a, radiusM: radii ? radii.A : null }),
    b: Object.freeze({ ...b, radiusM: radii ? radii.B : null }),
    relationship: Object.freeze({
      comparable,
      deltaValue: comparable ? state.delta : null,
      deltaKind,
      basisCode,
      withheldReasonCode: comparable ? null : bridgeWithheldReason(metricId, state),
    }),
  });
}

// --- Decision Insight presentation model -----------------------------------
//
// Decision Insight is the SYNTHESIS layer. The halo answers "what is locally
// present around each lens?" and the Bridge answers "what is the detailed
// comparison for THIS metric?"; Decision Insight answers "what are the main
// OBSERVED contrasts across the canonical comparison set?" in one pass, so a
// reader no longer has to hold four table rows, two unequal radii and the
// evidence limitations in their head and compose the reading themselves.
//
// It is a DERIVED layer, not a new analysis. Every item reads the authoritative
// Comparison Bridge model THROUGH — comparability is `relationship.comparable`,
// the difference IS `relationship.deltaValue`, the reason IS
// `relationship.withheldReasonCode` — and it performs no arithmetic of its own.
// Halo, Bridge, Insight and table therefore cannot develop different
// interpretations of one comparison state.
//
// It is deterministic and rule-based: NO runtime LLM, no generative service, no
// network call. The same comparison state always yields the same structured
// output, so every rendered sentence is traceable to an evidence state. The
// model returns CODES only; the view layer localizes them.
//
// What it is NOT: a score, a ranking, a winner selector, a composite index, a
// recommendation, a causal claim. A positive B − A is arithmetic direction and
// nothing else: it carries no quality, preference, ranking or success claim.
//
// Canonical order is FIXED and never sorted by magnitude: the four metrics have
// different units and meanings, so ordering by |delta| would falsely imply
// cross-metric comparability or importance. Pedestrian is deliberately absent
// (panel-only observational contract — see docs/DECISION_INSIGHT_V1.md).
const DECISION_INSIGHT_METRIC_IDS = BRIDGE_METRIC_IDS;
const DECISION_INSIGHT_GUARD_CODE = "descriptive-only";

// Per-metric descriptive state. The four stay SEMANTICALLY DISTINCT and never
// collapse into one generic "no data":
//   comparable  — the authoritative model authorizes a B − A difference
//   withheld    — both sides carry real values, but no direct comparison is
//                 authorized (different window sizes, AOI condition, …)
//   unavailable — at least one side has no evidence (N/A). NOT zero.
//   off         — the layer is intentionally disabled. NOT zero, NOT N/A.
function decisionInsightItemState(model) {
  if (model.relationship.comparable) return "comparable";
  if (model.a.evidence === "OFF" || model.b.evidence === "OFF") return "off";
  if (model.a.evidence === "N_A" || model.b.evidence === "N_A") return "unavailable";
  return "withheld";
}

// Arithmetic direction of B − A only.
function decisionInsightDirection(deltaValue) {
  if (!validNumber(deltaValue)) return null;
  if (deltaValue > 0) return "B_MINUS_A_POSITIVE";
  if (deltaValue < 0) return "B_MINUS_A_NEGATIVE";
  return "B_MINUS_A_ZERO";
}

// A side carries real observed evidence when it has a value — including a
// genuine observed ZERO, which is evidence, not absence.
function decisionInsightSideHasEvidence(evidence) {
  return evidence === "VALID" || evidence === "ZERO";
}

function decisionInsightItem(metricId, model) {
  if (!model) {
    return Object.freeze({
      metricId, state: "unavailable", direction: null, deltaValue: null, deltaKind: null,
      basisCode: null, unitCode: null, evidenceQualifier: null, withheldReasonCode: "no-evidence",
      aEvidence: "N_A", bEvidence: "N_A",
    });
  }
  const rel = model.relationship;
  const state = decisionInsightItemState(model);
  const comparable = state === "comparable";
  return Object.freeze({
    metricId,
    state,
    // Read THROUGH from the authoritative Bridge relationship, never recomputed.
    direction: comparable ? decisionInsightDirection(rel.deltaValue) : null,
    deltaValue: comparable ? rel.deltaValue : null,
    deltaKind: comparable ? rel.deltaKind : null,
    basisCode: comparable ? rel.basisCode : null,
    unitCode: model.unitCode,
    // UTCI is model-derived evidence, so a comparable Celsius difference always
    // carries that limitation with it. V1 adds no categorical interpretation.
    evidenceQualifier: comparable && model.kind === "temperature" ? "model-derived" : null,
    withheldReasonCode: comparable ? null : rel.withheldReasonCode,
    aEvidence: model.a.evidence,
    bEvidence: model.b.evidence,
  });
}

// Overall DESCRIPTIVE status, informational only. It describes what comparative
// evidence exists — never how "good" either lens is — and carries no number, so
// it can never be read as a confidence score.
//   available   — at least one metric has a valid comparable relationship
//   limited     — nothing is comparable, but at least one side carries a real
//                 observed value somewhere in the canonical set
//   unavailable — no canonical metric can provide comparative evidence at all
function decisionInsightStatus(items) {
  if (items.some((item) => item.state === "comparable")) return "available";
  const anyEvidence = items.some((item) =>
    decisionInsightSideHasEvidence(item.aEvidence) || decisionInsightSideHasEvidence(item.bEvidence));
  return anyEvidence ? "limited" : "unavailable";
}

// `metricModels` maps each canonical metric id to its buildComparisonBridgeModel
// output. The Insight consumes Bridge-level authoritative semantics; it never
// re-derives comparison rules from raw evidence.
function buildDecisionInsightModel({ metricModels, radiusMode = COMPARISON_RADIUS_MODE.EQUAL, radii = null } = {}) {
  if (!metricModels) return null;
  const items = DECISION_INSIGHT_METRIC_IDS.map((metricId) => decisionInsightItem(metricId, metricModels[metricId] || null));
  return Object.freeze({
    status: decisionInsightStatus(items),
    radiusMode,
    radii: radii ? Object.freeze({ A: radii.A, B: radii.B }) : null,
    items: Object.freeze(items),
    guardCode: DECISION_INSIGHT_GUARD_CODE,
  });
}

// --- Spatial Window Sensitivity V1 presentation model ----------------------
//
// SENSITIVITY ANALYSIS, NOT FORECASTING.
//
// Every other surface answers a question about ONE analytical window pair: the
// halo asks "what is locally present?", the Bridge "what is the detailed
// comparison for this metric?", Decision Insight "what are the observed
// contrasts across the canonical set?". This layer asks a question ABOUT THE
// METHOD instead:
//
//   "If I change the spatial windows used for this comparison, does the
//    analytical reading stay the same, change direction, change basis, become
//    non-comparable, or become comparable?"
//
// The user freezes the current configuration as the BASELINE window and then
// deliberately changes the Lens radii; the live configuration becomes the
// SCENARIO window. The model reports how the EXISTING comparison responded to
// that change of analytical window.
//
// WHAT THE SCENARIO IS: an alternative ANALYTICAL WINDOW CONFIGURATION over the
// same evidence. Changing a radius changes which geography — and therefore which
// records — each Lens includes. It does NOT change Madrid.
//
// WHAT THE SCENARIO IS NOT: a forecast, a prediction, a projection, a future
// state, a simulation, a policy scenario, an intervention estimate, a causal
// model, a recommendation, a score or an LLM-generated narrative. A different
// B − A under a different radius does not mean the destination changed; it means
// the interpretation is SENSITIVE TO THE CHOSEN SPATIAL WINDOW. See
// docs/SPATIAL_WINDOW_SENSITIVITY_V1.md.
//
// DERIVED, NEVER RE-DERIVED. The model compares two snapshots of the
// AUTHORITATIVE interpretation: each side is decisionInsightItem() over a
// buildComparisonBridgeModel() output — the very same objects the halo, the
// Bridge, Decision Insight and the table read. Comparability, the delta,
// density normalization, the Mobility unequal-window rule, the UTCI timestep
// contract and the AOI conditions are all read THROUGH. This layer compares
// interpretations; it never recreates them, so the scenario side can never
// become an independent fifth interpretation of the current state.
//
// It is deterministic and rule-based: NO runtime LLM, no generative service, no
// network call. It returns CODES only; the view layer localizes them.
const SPATIAL_SENSITIVITY_METRIC_IDS = BRIDGE_METRIC_IDS;
const SPATIAL_SENSITIVITY_GUARD_CODE = "window-sensitivity-only";

// Transition taxonomy — deliberately SMALL. Each code answers "what happened to
// the analytical reading?", never "what happened to Madrid?".
//
//   UNCHANGED_COMPARABLE    both windows comparable, same basis, same B − A sign
//   DIRECTION_CHANGED       both comparable, same basis, B − A sign changed
//   BASIS_CHANGED           both comparable, but the comparison BASIS differs
//                           (e.g. raw counts to represented-record density), so
//                           the two differences are not numerically comparable
//   BECAME_WITHHELD         baseline comparable, scenario not comparable
//   BECAME_COMPARABLE       baseline not comparable, scenario comparable
//   WITHHELD_UNCHANGED      neither comparable, equivalent authoritative reason
//   WITHHELD_REASON_CHANGED neither comparable, authoritative reason changed
//   EVIDENCE_CHANGED        the evidence contract itself differs between the two
//                           snapshots, so no window-sensitivity reading is valid
//
// EVIDENCE_CHANGED is a MODEL-LEVEL GUARD, not a normal V1 state: the UI policy
// invalidates the baseline as soon as the evidence configuration changes, so a
// surviving baseline always shares the scenario's evidence contract. The code
// exists so the pure model can never silently present an evidence-configuration
// difference as pure spatial sensitivity.
const SENSITIVITY_TRANSITION = Object.freeze({
  UNCHANGED_COMPARABLE: "UNCHANGED_COMPARABLE",
  DIRECTION_CHANGED: "DIRECTION_CHANGED",
  BASIS_CHANGED: "BASIS_CHANGED",
  BECAME_WITHHELD: "BECAME_WITHHELD",
  BECAME_COMPARABLE: "BECAME_COMPARABLE",
  WITHHELD_UNCHANGED: "WITHHELD_UNCHANGED",
  WITHHELD_REASON_CHANGED: "WITHHELD_REASON_CHANGED",
  EVIDENCE_CHANGED: "EVIDENCE_CHANGED",
});

// Overall summary — CATEGORICAL AND CONSERVATIVE. There is deliberately NO
// number: no robustness percentage, no confidence, no stability score, no
// sensitivity index, because the project defines no statistical robustness test
// and a number here would invite exactly that misreading.
//
//   STABLE   at least one metric is comparable in BOTH windows, and no metric
//            changed state, direction, basis or withheld reason
//   MIXED    at least one metric is comparable in both windows, and something
//            changed
//   LIMITED  no metric is comparable in both windows, so there is not enough
//            comparable evidence to read window sensitivity at all
//   EVIDENCE_CHANGED  the evidence contract differs (see above)
const SENSITIVITY_STATUS = Object.freeze({
  STABLE: "STABLE",
  MIXED: "MIXED",
  LIMITED: "LIMITED",
  EVIDENCE_CHANGED: "EVIDENCE_CHANGED",
});

// Deep-freeze a captured baseline so a later radius drag, lens move or refresh
// can never mutate it. The baseline is the HISTORICAL snapshot: if it could
// drift with the live state, the whole comparison would be meaningless.
function freezeSpatialSnapshot(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeSpatialSnapshot));
  const copy = {};
  for (const key of Object.keys(value)) copy[key] = freezeSpatialSnapshot(value[key]);
  return Object.freeze(copy);
}

// Capture an immutable BASELINE snapshot. It stores STRUCTURED MODEL STATE —
// the authoritative per-metric interpretation, the radii, the lens centres and
// the evidence-contract key — never rendered text: text is rendering, the model
// is truth, so the baseline reading is reproducible without reading old DOM.
function captureSpatialSensitivityBaseline({ metricModels, radii, centers, radiusMode, evidenceKey } = {}) {
  if (!metricModels) return null;
  const items = {};
  for (const metricId of SPATIAL_SENSITIVITY_METRIC_IDS) {
    // Snapshot the AUTHORITATIVE interpretation, not raw evidence: the baseline
    // reading can then be reproduced exactly as it was read at capture time.
    items[metricId] = decisionInsightItem(metricId, metricModels[metricId] || null);
  }
  return freezeSpatialSnapshot({
    radii: radii ? { A: radii.A, B: radii.B } : null,
    centers: centers ? { A: { lat: centers.A.lat, lon: centers.A.lon }, B: { lat: centers.B.lat, lon: centers.B.lon } } : null,
    radiusMode: radiusMode || null,
    evidenceKey: evidenceKey == null ? null : String(evidenceKey),
    items,
  });
}

// Has a Lens CENTRE moved materially since capture? Radius changes are the
// scenario; a centre change is a DIFFERENT PLACE, so comparing it as if it were
// radius sensitivity would be wrong and the UI invalidates the baseline instead.
// Map pan and zoom never move a centre and therefore never invalidate.
// The tolerance absorbs floating-point jitter only, not a deliberate move.
function spatialBaselineCenterChanged(baselineCenters, currentCenters, toleranceM = 1) {
  if (!baselineCenters || !currentCenters) return false;
  for (const which of ["A", "B"]) {
    const from = baselineCenters[which];
    const to = currentCenters[which];
    if (!from || !to) return true;
    if (haloHaversineMeters(from, to) > toleranceM) return true;
  }
  return false;
}

// Two differences may be subtracted ONLY when they mean the same thing. At
// minimum: both comparable, same metric, same deltaKind, same basisCode and the
// same evidence contract. Raw counts and represented-record density are NOT
// numerically comparable and are never unit-converted to force a comparison.
function spatialBasisCompatible(baselineItem, scenarioItem, evidenceCompatible) {
  return Boolean(evidenceCompatible)
    && baselineItem.state === "comparable" && scenarioItem.state === "comparable"
    && baselineItem.metricId === scenarioItem.metricId
    && baselineItem.deltaKind === scenarioItem.deltaKind
    && baselineItem.basisCode === scenarioItem.basisCode;
}

// Non-comparable states are EQUIVALENT only when both the descriptive state and
// the authoritative reason match, so "off" never reads as "unavailable" and a
// changed reason is always surfaced as a change.
function spatialWithheldEquivalent(baselineItem, scenarioItem) {
  return baselineItem.state === scenarioItem.state
    && baselineItem.withheldReasonCode === scenarioItem.withheldReasonCode;
}

function spatialTransitionCode(baselineItem, scenarioItem, evidenceCompatible) {
  if (!evidenceCompatible) return SENSITIVITY_TRANSITION.EVIDENCE_CHANGED;
  const baselineComparable = baselineItem.state === "comparable";
  const scenarioComparable = scenarioItem.state === "comparable";
  if (baselineComparable && scenarioComparable) {
    // Basis is checked BEFORE direction: when the basis differs the two signs
    // describe different quantities, so "direction changed" would be a false
    // reading of an incomparable pair.
    if (baselineItem.deltaKind !== scenarioItem.deltaKind || baselineItem.basisCode !== scenarioItem.basisCode) {
      return SENSITIVITY_TRANSITION.BASIS_CHANGED;
    }
    return baselineItem.direction === scenarioItem.direction
      ? SENSITIVITY_TRANSITION.UNCHANGED_COMPARABLE
      : SENSITIVITY_TRANSITION.DIRECTION_CHANGED;
  }
  if (baselineComparable && !scenarioComparable) return SENSITIVITY_TRANSITION.BECAME_WITHHELD;
  if (!baselineComparable && scenarioComparable) return SENSITIVITY_TRANSITION.BECAME_COMPARABLE;
  return spatialWithheldEquivalent(baselineItem, scenarioItem)
    ? SENSITIVITY_TRANSITION.WITHHELD_UNCHANGED
    : SENSITIVITY_TRANSITION.WITHHELD_REASON_CHANGED;
}

// The per-side reading, read THROUGH from the authoritative Insight item. No
// arithmetic and no comparison rule lives here.
function spatialSensitivitySide(item) {
  return {
    // Carried so the view can resolve this metric's unit through the SAME
    // dictionary key the Insight uses, and reuse the Insight's own relationship
    // clause verbatim rather than re-wording the reading.
    metricId: item.metricId,
    state: item.state,
    comparable: item.state === "comparable",
    direction: item.direction,
    deltaValue: item.deltaValue,
    deltaKind: item.deltaKind,
    basisCode: item.basisCode,
    withheldReasonCode: item.withheldReasonCode,
    evidenceQualifier: item.evidenceQualifier,
    aEvidence: item.aEvidence,
    bEvidence: item.bEvidence,
  };
}

function spatialSensitivityItem(metricId, baselineItem, scenarioItem, evidenceCompatible) {
  const transitionCode = spatialTransitionCode(baselineItem, scenarioItem, evidenceCompatible);
  const basisCompatible = spatialBasisCompatible(baselineItem, scenarioItem, evidenceCompatible);
  // The CHANGE IN THE OBSERVED COMPARISON under the alternative window — and
  // only where the two differences are semantically compatible. Any ambiguity
  // withholds it: a number that cannot be interpreted is worse than no number.
  //
  // This is an OBSERVED SENSITIVITY OF THE ANALYTICAL WINDOW. It is not an
  // impact, an effect, a causal change or a future change: the radius change did
  // not make records exist, it changed which geography is included.
  const deltaChange = basisCompatible ? scenarioItem.deltaValue - baselineItem.deltaValue : null;
  return {
    metricId,
    baseline: spatialSensitivitySide(baselineItem),
    scenario: spatialSensitivitySide(scenarioItem),
    transitionCode,
    basisCompatible,
    deltaChange,
    // Correct units always travel with the number, taken from the shared basis.
    deltaChangeKind: basisCompatible ? scenarioItem.deltaKind : null,
    deltaChangeBasisCode: basisCompatible ? scenarioItem.basisCode : null,
  };
}

function spatialSensitivityStatus(items, evidenceCompatible) {
  if (!evidenceCompatible) return SENSITIVITY_STATUS.EVIDENCE_CHANGED;
  const bothComparable = items.filter((item) => item.baseline.comparable && item.scenario.comparable);
  // Without a single metric comparable in BOTH windows there is nothing whose
  // stability could be assessed, so the summary abstains rather than implying
  // a stable reading from absent evidence.
  if (bothComparable.length === 0) return SENSITIVITY_STATUS.LIMITED;
  const unchanged = items.every((item) =>
    item.transitionCode === SENSITIVITY_TRANSITION.UNCHANGED_COMPARABLE
    || item.transitionCode === SENSITIVITY_TRANSITION.WITHHELD_UNCHANGED);
  return unchanged ? SENSITIVITY_STATUS.STABLE : SENSITIVITY_STATUS.MIXED;
}

// Compare a captured BASELINE snapshot against the CURRENT (scenario) Bridge
// models. `scenarioMetricModels` maps each canonical metric id to its
// buildComparisonBridgeModel output — exactly what Decision Insight consumes —
// so the scenario side of this model and the rendered Decision Insight are the
// same interpretation by construction.
//
// Canonical order is FIXED (tourism, stays, mobility, utci) and is NEVER sorted
// by magnitude, absolute change, importance or availability: the four metrics
// have different units and meanings, so any ordering would falsely imply
// cross-metric comparability. There is no "top sensitivity".
function buildSpatialSensitivityModel({
  baseline = null, baselineMetricModels = null, scenarioMetricModels = null,
  baselineRadii = null, scenarioRadii = null,
  baselineEvidenceKey = null, scenarioEvidenceKey = null,
} = {}) {
  // Accept either a captured baseline snapshot or raw baseline Bridge models.
  const baselineSnapshot = baseline
    || (baselineMetricModels
      ? captureSpatialSensitivityBaseline({ metricModels: baselineMetricModels, radii: baselineRadii, radiusMode: null, evidenceKey: baselineEvidenceKey })
      : null);
  if (!baselineSnapshot || !scenarioMetricModels) return null;
  const effectiveBaselineKey = baselineEvidenceKey == null ? baselineSnapshot.evidenceKey : String(baselineEvidenceKey);
  const effectiveScenarioKey = scenarioEvidenceKey == null ? null : String(scenarioEvidenceKey);
  // Unknown keys on both sides mean the caller does not track an evidence
  // contract; only a KNOWN DIFFERENCE marks the snapshots incompatible.
  const evidenceCompatible = effectiveBaselineKey == null || effectiveScenarioKey == null
    ? true
    : effectiveBaselineKey === effectiveScenarioKey;
  const items = SPATIAL_SENSITIVITY_METRIC_IDS.map((metricId) => {
    const baselineItem = baselineSnapshot.items[metricId] || decisionInsightItem(metricId, null);
    const scenarioItem = decisionInsightItem(metricId, scenarioMetricModels[metricId] || null);
    return freezeSpatialSnapshot(spatialSensitivityItem(metricId, baselineItem, scenarioItem, evidenceCompatible));
  });
  const effectiveScenarioRadii = scenarioRadii || null;
  return Object.freeze({
    status: spatialSensitivityStatus(items, evidenceCompatible),
    evidenceCompatible,
    baseline: Object.freeze({
      radii: baselineSnapshot.radii ? Object.freeze({ A: baselineSnapshot.radii.A, B: baselineSnapshot.radii.B }) : null,
      radiusMode: baselineSnapshot.radiusMode,
    }),
    scenario: Object.freeze({
      radii: effectiveScenarioRadii ? Object.freeze({ A: effectiveScenarioRadii.A, B: effectiveScenarioRadii.B }) : null,
      radiusMode: scenarioMetricModels.tourism ? scenarioMetricModels.tourism.radiusMode : null,
    }),
    // True when the scenario window is identical to the captured baseline
    // window, so the view can say so instead of implying a change was made.
    windowUnchanged: Boolean(baselineSnapshot.radii && effectiveScenarioRadii
      && baselineSnapshot.radii.A === effectiveScenarioRadii.A
      && baselineSnapshot.radii.B === effectiveScenarioRadii.B),
    items: Object.freeze(items),
    guardCode: SPATIAL_SENSITIVITY_GUARD_CODE,
  });
}

// --- Glyph spec ------------------------------------------------------------

function haloVisualState(metric, state, which) {
  const sideState = state[which === "A" ? "aSideState" : "bSideState"];
  if (sideState === "VALID") {
    if (metric.kind === "temperature") return "numeric";
    const raw = state[which === "A" ? "aRawValue" : "bRawValue"];
    return raw === 0 ? "zero" : "numeric";
  }
  if (sideState === "OFF") return "off";
  if (sideState === "NO_EVIDENCE") return "no-evidence";
  return "unavailable";
}

function buildHaloGlyphSpec(metric, state, which, layout = "full") {
  const visualState = haloVisualState(metric, state, which);
  const magnitude = state[which === "A" ? "aBarMagnitude" : "bBarMagnitude"];
  const valueText = state[which === "A" ? "aValueText" : "bValueText"];
  const qualified = Boolean(state[which === "A" ? "aQualified" : "bQualified"]);
  const saturated = Boolean(state[which === "A" ? "aSaturated" : "bSaturated"]);
  const type = visualState === "numeric" ? "bar" : visualState === "zero" ? "zero" : "abstain";
  const statusText = visualState === "off" ? "OFF" : visualState === "numeric" || visualState === "zero" ? valueText : "N/A";
  const spec = {
    metric: metric.id,
    slot: metric.slot,
    angle: getMetricSlotAngle(metric.id),
    which,
    layout,
    label: HALO_COMPACT_LABELS[metric.id],
    value: statusText,
    unit: metric.unit,
    valueAnchor: haloValueAnchorForSlot(metric.slot, layout),
    labelAnchor: haloLabelAnchorForSlot(metric.slot, layout),
    visualState,
    type,
    qualified: qualified && type === "bar",
    // Density at or above the reference; the bar is clamped full, the raw number
    // still carries the real magnitude.
    saturated: saturated && type === "bar",
  };
  if (type === "bar") spec.magnitude = magnitude == null ? 0 : magnitude;
  else if (type === "zero") spec.magnitude = 0;
  return Object.freeze(spec);
}

// The renderer may remove only the ambiguous slots. Keeping this tiny policy
// pure makes degradation deterministic.
function resolveHaloSlotVisibility({ layout, blockedSlots = [] } = {}) {
  const blocked = new Set(blockedSlots);
  return Object.freeze(Object.fromEntries(HALO_METRICS.map((metric) => [metric.id, Object.freeze({
    visible: layout !== "hidden" && !blocked.has(metric.id),
    compact: layout === "compact",
  })])));
}

// --- Formatting + accessibility -------------------------------------------

function formatValue(value, id) {
  if (!validNumber(value)) return null;
  if (id === "tourism") return `${value} POIs`;
  if (id === "stays") return `${value} stays`;
  if (id === "mobility") return `${value} nodes`;
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

// Screen-reader equivalent of the four perimeter bars. Describes each lens's
// own raw value and makes the within-metric-only comparability explicit.
function accessibleComparisonSummary(comparison) {
  const radiusCue = comparison.radii ? `Lens A radius ${comparison.radii.A} m; Lens B radius ${comparison.radii.B} m.` : "";
  const lines = [`Comparison halo. ${radiusCue} Fixed radial slots: Tourism POIs at twelve o'clock, Hotels & stays at two, Mobility nodes at six, Mean UTCI at nine. Every bar starts just outside its own Lens circumference and points outward; the same metric keeps the same angle on Lens A and Lens B. The printed number is the raw value inside the lens; for the three count metrics the bar length is that lens's represented spatial density (records per square kilometre) relative to a fixed Madrid reference density, so unequal radii stay comparable. UTCI's bar is its position in a model-derived Celsius band. Bar lengths are comparable within the same metric only, never across metrics.`];
  for (const metric of HALO_METRICS) {
    const state = comparison.metrics[metric.id];
    const a = state.aValueText ? `${state.aValueText} ${metric.unit}`.replace("°C °C", "°C") : formatEvidenceState(state.stateA);
    const b = state.bValueText ? `${state.bValueText} ${metric.unit}`.replace("°C °C", "°C") : formatEvidenceState(state.stateB);
    const barNote = metric.kind === "count"
      ? `bar: represented ${metric.id === "stays" ? "stay" : metric.id === "mobility" ? "mobility node" : "POI"} density vs Madrid reference${state.aSaturated || state.bSaturated ? ` (${[state.aSaturated && "Lens A", state.bSaturated && "Lens B"].filter(Boolean).join(" and ")} at or above reference)` : ""}`
      : "bar: position in model-derived Celsius band";
    const coverage = [state.aCoverage && `Lens A coverage: ${state.aCoverage}`, state.bCoverage && `Lens B coverage: ${state.bCoverage}`]
      .filter(Boolean).join(". ");
    if (state.comparable) {
      const differenceText = comparison.radiusMode === COMPARISON_RADIUS_MODE.UNEQUAL && ["tourism", "stays", "mobility"].includes(metric.id)
        ? `${state.delta > 0 ? "+" : ""}${state.delta.toFixed(1)} represented ${metric.id === "stays" ? "catalogue records" : "records"}/km²`
        : formatDifference(state.delta, metric.id);
      lines.push(`${metric.label}: Lens A ${a}, Lens B ${b}, difference ${differenceText}; ${barNote}. ${coverage ? `${coverage}. ` : ""}${state.qualifier}.`);
    } else {
      lines.push(`${metric.label}: Lens A ${a}, Lens B ${b}; direct comparison withheld; ${barNote}. ${coverage ? `${coverage}. ` : ""}${state.qualifier}.`);
    }
  }
  lines.push(`Reference density is the Madrid ${comparison.references ? `p${Math.round((comparison.references.quantile ?? 0.95) * 100)} local density in a ${comparison.references.radiusM ?? 900} metre window` : "p95 local density"} per count metric, shared by Lens A and Lens B, and a model-derived Celsius band for UTCI. Values above the reference density saturate the bar while the raw value keeps the real magnitude. Unavailable data reads N/A, never zero; a genuine zero stays a distinct zero state. No bar is a score or recommendation.`);
  return lines.join(" ");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HALO_METRICS, SOURCE_LABELS, DISPLAY_STATE, UTCI_PX_PER_C, COMPARISON_RADIUS_MODE,
    HALO_REFERENCE_DEFAULTS, HALO_UTCI_FALLBACK_BAND,
    circleAreaKm2: haloCircleAreaKm2, representedRate: haloRepresentedRate,
    HALO_COMPACT_LABELS, HALO_LAYOUT, HALO_VISUAL_GEOMETRY, HALO_METRIC_SLOT_ANGLES, HALO_RADIAL_GEOMETRY,
    getMetricSlotAngle, getRadialUnitVector, getHaloBarGeometry, getHaloLabelGeometry,
    normalizedCountPair, positivePair, buildCountPairState, buildHaloComparison, accessibleComparisonSummary,
    BRIDGE_METRIC_IDS, buildComparisonBridgeModel, bridgeSideEvidence, bridgeWithheldReason,
    DECISION_INSIGHT_METRIC_IDS, DECISION_INSIGHT_GUARD_CODE, buildDecisionInsightModel,
    decisionInsightItemState, decisionInsightDirection, decisionInsightStatus,
    SPATIAL_SENSITIVITY_METRIC_IDS, SPATIAL_SENSITIVITY_GUARD_CODE,
    SENSITIVITY_TRANSITION, SENSITIVITY_STATUS,
    buildSpatialSensitivityModel, captureSpatialSensitivityBaseline,
    spatialBaselineCenterChanged, spatialBasisCompatible, spatialSensitivityStatus,
    computeHaloReferenceScales, deriveHaloUtciBand, haloDensity, haloDensityMagnitude, haloUtciMagnitude, formatHaloValue, haloQuantile, haloHaversineMeters,
    activityState, utciState, countState,
    haloLayoutForRadius, haloLabelAnchorForSlot, haloValueAnchorForSlot, haloSlotFootprint, haloFootprintsOverlap, buildHaloGlyphSpec, resolveHaloSlotVisibility,
  };
}
