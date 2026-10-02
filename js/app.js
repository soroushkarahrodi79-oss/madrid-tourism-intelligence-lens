// App wiring: Leaflet map, lens markers, UI event handlers. Pure stats logic
// lives in lens.js / evidence.js; this file only renders their output.

const LAYER_COLOR = {
  museum: "#9d72ff",
  info: "#c79cff",
  stay: "#3da8ff",
  bike: "#54e2b5",
  rail: "#ffd166",
  pedestrian: "#ff7aa2",
  park: "#70dea4",
};
const LAYER_LABEL = {
  museum: "Museums",
  info: "Tourist info",
  stay: "Hotels & stays",
  bike: "BiciMAD",
  rail: "Metro & Cercanías",
  pedestrian: "Observed pedestrian activity",
  park: "Principal parks",
};
const DENSE_LAYER_TYPES = new Set(["stay", "bike"]);

// Dynamic import resolves against this script, so the administrative-context
// modules load identically however the page is served. They are ES modules
// (shared with `node --test`), while the rest of the app is classic scripts.
const MODULE_BASE = (document.currentScript && document.currentScript.src) || window.location.href;
const AREA_ASSET_VERSION = "20261002-43";
const moduleUrl = (name) => new URL(`${name}?v=${AREA_ASSET_VERSION}`, MODULE_BASE).href;

const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([40.415, -3.692], 14);

// Administrative reference geometry sits UNDER the POI markers: it is context
// for reading the map, never a data layer competing with the evidence on it.
map.createPane("adminPane");
map.getPane("adminPane").style.zIndex = "350";
map.getPane("adminPane").style.pointerEvents = "none";

// The thematic administrative fill sits above reference outlines but below the
// active-area and Lens panes. It is the only interactive polygon surface.
map.createPane("hospitalityPane");
map.getPane("hospitalityPane").style.zIndex = "365";

// The area containing a lens centre is the one administrative shape that has to
// stay readable, so it sits just below the lens itself — visible over the POIs,
// still subordinate to the circle.
map.createPane("adminActivePane");
map.getPane("adminActivePane").style.zIndex = "455";
map.getPane("adminActivePane").style.pointerEvents = "none";
map.getPane("adminActivePane").classList.add("admin-active-pane");

// Keep lens boundaries above vector POIs but below draggable lens handles and cluster markers.
map.createPane("lensPane");
map.getPane("lensPane").style.zIndex = "460";
map.getPane("lensPane").style.pointerEvents = "none";
map.createPane("haloPane");
map.getPane("haloPane").style.zIndex = "470";
map.getPane("haloPane").style.pointerEvents = "none";

const cartoBasemapKey = window.RUNTIME_CONFIG?.CARTO_BASEMAP_KEY || "";
let activeBasemap = null;
let activeBasemapName = "light";
let lensStyleController = null;
let adminStyleController = null;
let hospitalityStyleController = null;

function createOsmBasemap() {
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

function createCartoBasemap(style) {
  if (!cartoBasemapKey) return createOsmBasemap();
  const url =
    `https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png` +
    `?key=${encodeURIComponent(cartoBasemapKey)}`;
  return L.tileLayer(url, {
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  });
}

function createSatelliteBasemap() {
  const imagery = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      zIndex: 200,
      attribution:
        'Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }
  );

  const transportation = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      zIndex: 300,
    }
  );

  const labels = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      zIndex: 310,
    }
  );

  const hybrid = L.layerGroup([imagery, transportation, labels]);

  // Only a failure of the imagery base should trigger the global OSM fallback.
  // Reference overlays can fail independently without blanking the imagery.
  imagery.on("tileerror", (event) => hybrid.fire("tileerror", event));

  return hybrid;
}

function setBasemap(name) {
  const requested = ["light", "satellite", "dark"].includes(name) ? name : "light";
  if (activeBasemap && map.hasLayer(activeBasemap)) map.removeLayer(activeBasemap);

  const next =
    requested === "satellite"
      ? createSatelliteBasemap()
      : requested === "dark"
        ? createCartoBasemap("dark_all")
        : createCartoBasemap("light_all");

  activeBasemap = next;
  activeBasemapName = requested;
  if (lensStyleController) lensStyleController(requested);
  if (adminStyleController) adminStyleController(requested);
  if (hospitalityStyleController) hospitalityStyleController(requested);

  let fellBack = false;
  next.on("tileerror", () => {
    if (fellBack || activeBasemap !== next) return;
    fellBack = true;
    if (map.hasLayer(next)) map.removeLayer(next);
    activeBasemap = createOsmBasemap().addTo(map);
  });

  next.addTo(map);
}

setBasemap("light");

const groups = {
  museum: L.layerGroup().addTo(map),
  info: L.layerGroup().addTo(map),
  stay: L.layerGroup().addTo(map),
  bike: L.layerGroup().addTo(map),
  rail: L.layerGroup().addTo(map),
  // Observed pedestrian activity is opt-in and analytically separate from POI counts.
  pedestrian: L.layerGroup(),
  // Context layer is opt-in and intentionally excluded from lens analytics.
  park: L.layerGroup(),
  // Research evidence is opt-in: populate HATI but keep it off the map until requested.
  heat: L.layerGroup(),
};

let poiPoints = [];
let pedestrianStations = [];
let pedestrianStatus = "unavailable";
let pedestrianMeta = {};
let parkPoints = [];
let parkStatus = "unavailable";
let hatiAssets = [];
let hatiStudyArea = null;
let layerStatus = {};
let stayKindFilter = "all";
const radii = createLensRadii();
let active = "A";
let bEnabled = false;
let lensBHasBeenInitialized = false;
let timestep = "15:00";

const defaults = { A: [40.4149, -3.69], B: [40.4224, -3.7037] };

function markerIcon(cls) {
  return L.divIcon({
    className: "",
    html: `<div class="marker-center marker-${cls}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

const lenses = {
  A: {
    marker: L.marker(defaults.A, { draggable: true, icon: markerIcon("a"), zIndexOffset: 1000 }).addTo(map),
    circle: L.circle(defaults.A, {
      radius: radii.A,
      pane: "lensPane",
      className: "lens-boundary lens-boundary-a",
      color: "#123b5f",
      weight: 3,
      opacity: 1,
      fillColor: "#3da8ff",
      fillOpacity: 0.1,
      dashArray: "10 8",
    }).addTo(map),
  },
  B: {
    marker: L.marker(defaults.B, { draggable: true, icon: markerIcon("b"), zIndexOffset: 1000 }),
    circle: L.circle(defaults.B, {
      radius: radii.B,
      pane: "lensPane",
      className: "lens-boundary lens-boundary-b",
      color: "#00768f",
      weight: 3,
      opacity: 1,
      fillColor: "#43d7ff",
      fillOpacity: 0.09,
      dashArray: "10 8",
    }),
  },
};

// Eight reusable Leaflet SVG markers form the screen-space halo. Each marker is
// anchored at its radial bar origin and recomputed from the live map projection.
const HALO_GLYPH_COLORS = Object.freeze({ A: "#f7fbff", B: "#43d7ff" });
const HALO_INNER_GAP_PX = HALO_RADIAL_GEOMETRY.RADIAL_GAP;
const HALO_FULL_TRACK_PX = HALO_RADIAL_GEOMETRY.MAX_BAR_LENGTH;
const HALO_COMPACT_TRACK_PX = HALO_FULL_TRACK_PX;
const HALO_SVG_CENTER = Object.freeze({ x: 110, y: 70 });
const HALO_ICON_SIZE = Object.freeze([220, 140]);
const HALO_MIN_SLOT_SEPARATION_PX = 40;
const comparisonHalos = { A: {}, B: {} };
let haloEnabled = true;
let lastHaloComparison = null;
let haloVisibilityReason = "";
let focusedHaloMetric = null;
let selectedHaloMetric = null;

// Deterministic reference DENSITIES for the perimeter bars, computed from the
// loaded dataset (not the live Lens radius) so a bar's scale semantics never
// change merely because the geography changes. The reference population is the
// SAME population the raw counts are drawn from — visiblePoiPoints() — so when an
// accommodation category filter narrows the represented stays, its reference
// density is recomputed from the same filtered population. Cached per filter key;
// tests and the regression seam may inject their own references instead.
const haloReferenceByFilter = new Map();
let haloUtciBand = null;
function getHaloReferences() {
  const key = stayKindFilter || "all";
  if (!haloReferenceByFilter.has(key)) {
    haloReferenceByFilter.set(key, computeHaloReferenceScales(visiblePoiPoints()));
  }
  return haloReferenceByFilter.get(key);
}
function getHaloUtciBand() {
  if (!haloUtciBand) haloUtciBand = deriveHaloUtciBand(hatiAssets);
  return haloUtciBand;
}

function haloIcon(which, metric) {
  const color = HALO_GLYPH_COLORS[which];
  const html = `<svg class="halo-glyph halo-${which.toLowerCase()} halo-slot-${metric.slot}" viewBox="0 0 220 140" width="220" height="140" data-metric="${metric.id}" role="button" tabindex="0" aria-pressed="false" aria-label="Lens ${which}, ${metric.label}; focus to compare this metric" style="--halo-color:${color};--halo-thickness:${HALO_RADIAL_GEOMETRY.BAR_THICKNESS}px">
    <line class="halo-track"/>
    <line class="halo-fill"/>
    <circle class="halo-zero" r="3.2"/>
    <g class="halo-abstain" style="display:none"><line class="halo-state-track"/><text class="halo-state-mark"></text></g>
    <circle class="halo-qualified-mark" r="2"/>
    <text class="halo-value"></text>
    <text class="halo-label"></text>
  </svg>`;
  return L.divIcon({ className: "comparison-halo-icon", html, iconSize: HALO_ICON_SIZE, iconAnchor: [HALO_SVG_CENTER.x, HALO_SVG_CENTER.y] });
}

for (const which of ["A", "B"]) {
  for (const metric of HALO_METRICS) {
    const marker = L.marker(lenses[which].marker.getLatLng(), {
      pane: "haloPane", interactive: true, keyboard: true, bubblingMouseEvents: false,
      title: `Lens ${which}, ${metric.label}`, icon: haloIcon(which, metric), zIndexOffset: 0,
    });
    marker._haloMetric = metric.id;
    marker._haloLens = which;
    marker.on("add", () => {
      cacheHaloNodes(marker);
      bindHaloMetricFocus(marker);
      if (lastHaloComparison) updateHaloGlyph(marker, lastHaloComparison.metrics[marker._haloMetric]);
    });
    marker.on("mouseover", () => setHaloMetricFocus(metric.id, which));
    marker.on("mouseout", () => setHaloMetricFocus(null, which));
    marker.on("click", () => setHaloMetricFocus(metric.id, which, true));
    marker.on("remove", () => setHaloMetricFocus(null, which));
    comparisonHalos[which][metric.id] = marker;
  }
}

function cacheHaloNodes(marker) {
  const root = marker.getElement?.();
  if (!root) return;
  marker._haloNodes = {
    svg: root.querySelector(".halo-glyph"),
    track: root.querySelector(".halo-track"),
    fill: root.querySelector(".halo-fill"),
    zero: root.querySelector(".halo-zero"),
    abstain: root.querySelector(".halo-abstain"),
    stateTrack: root.querySelector(".halo-state-track"),
    state: root.querySelector(".halo-state-mark"),
    qualifier: root.querySelector(".halo-qualified-mark"),
    value: root.querySelector(".halo-value"),
    label: root.querySelector(".halo-label"),
  };
}

function bindHaloMetricFocus(marker) {
  const svg = marker._haloNodes?.svg;
  if (!svg || svg._haloFocusBound) return;
  svg._haloFocusBound = true;
  svg.addEventListener("focus", () => setHaloMetricFocus(marker._haloMetric, marker._haloLens));
  svg.addEventListener("blur", () => setHaloMetricFocus(null, marker._haloLens));
  svg.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setHaloMetricFocus(marker._haloMetric, marker._haloLens, true);
    }
    if (event.key === "Escape") {
      selectedHaloMetric = null;
      setHaloMetricFocus(null, marker._haloLens);
    }
  });
}

function setHaloMetricFocus(metricId, sourceLens, selected = false) {
  if (selected && metricId) selectedHaloMetric = selectedHaloMetric === metricId ? null : metricId;
  focusedHaloMetric = metricId || selectedHaloMetric || null;
  for (const which of ["A", "B"]) for (const marker of Object.values(comparisonHalos[which])) {
    const svg = marker._haloNodes?.svg;
    if (!svg) continue;
    const focused = focusedHaloMetric && marker._haloMetric === focusedHaloMetric;
    svg.classList.toggle("halo-metric-focused", Boolean(focused));
    svg.classList.toggle("halo-metric-deemphasized", Boolean(focusedHaloMetric && !focused));
    svg.setAttribute("aria-pressed", selectedHaloMetric === marker._haloMetric ? "true" : "false");
  }
  document.querySelectorAll(".comparetable [data-halo-metric]").forEach((row) => {
    const focused = Boolean(focusedHaloMetric && row.dataset.haloMetric === focusedHaloMetric);
    row.classList.toggle("halo-metric-row-focused", focused);
    if (focused) row.setAttribute("aria-current", "true"); else row.removeAttribute("aria-current");
  });
  window.dispatchEvent(new CustomEvent("halo:metricfocus", { detail: { metricId: focusedHaloMetric, lens: sourceLens || null, selected: Boolean(focusedHaloMetric && selectedHaloMetric === focusedHaloMetric) } }));
}

function setHaloLine(line, start, end) {
  line.setAttribute("x1", String(start[0])); line.setAttribute("y1", String(start[1]));
  line.setAttribute("x2", String(end[0])); line.setAttribute("y2", String(end[1]));
}

function updateHaloGlyph(marker, state, layout = "full") {
  const nodes = marker._haloNodes;
  if (!nodes) cacheHaloNodes(marker);
  const cached = marker._haloNodes;
  if (!cached) return;
  const which = marker._haloLens;
  const metric = HALO_METRICS.find((candidate) => candidate.id === marker._haloMetric);
  const spec = buildHaloGlyphSpec(metric, state, which, layout);
  const trackLength = layout === "compact" ? HALO_COMPACT_TRACK_PX : HALO_FULL_TRACK_PX;
  const trackGeometry = getHaloBarGeometry({ center: HALO_SVG_CENTER, renderedRadius: 0, angle: spec.angle, magnitude: 1, maxLength: trackLength });
  const fillGeometry = getHaloBarGeometry({ center: HALO_SVG_CENTER, renderedRadius: 0, angle: spec.angle, magnitude: spec.magnitude ?? 0, maxLength: trackLength });
  const origin = [HALO_SVG_CENTER.x, HALO_SVG_CENTER.y];
  const outer = [trackGeometry.endpoint.x, trackGeometry.endpoint.y];
  const midpoint = [(origin[0] + outer[0]) / 2, (origin[1] + outer[1]) / 2];
  const isBar = spec.type === "bar";
  const isZero = spec.type === "zero";
  const isAbstain = spec.type === "abstain";
  cached.svg.classList.toggle("halo-compact", layout === "compact");
  cached.svg.classList.toggle("halo-active", which === active);
  cached.svg.classList.toggle("halo-inactive", which !== active);
  cached.svg.classList.toggle("halo-metric-focused", Boolean(focusedHaloMetric && focusedHaloMetric === metric.id));
  cached.svg.classList.toggle("halo-metric-deemphasized", Boolean(focusedHaloMetric && focusedHaloMetric !== metric.id));
  cached.svg.setAttribute("data-visual-state", spec.visualState);
  cached.svg.setAttribute("data-saturated", spec.saturated ? "true" : "false");
  cached.svg.setAttribute("aria-label", `Lens ${which}, ${metric.label}: ${spec.value || spec.visualState}. Radial bar length represents this metric against its own Madrid reference; compare this metric across lenses only.`);

  // The raw value (or N/A / OFF) is the primary mark and is always printed, so
  // the map alone answers "how much"; it stays visible in compact layout too.
  cached.value.textContent = spec.value || "";
  cached.value.setAttribute("class", `halo-value halo-value-${spec.visualState}`);
  const valueAnchor = getHaloLabelGeometry({ endpoint: isBar ? fillGeometry.endpoint : HALO_SVG_CENTER, angle: spec.angle, gap: HALO_RADIAL_GEOMETRY.LABEL_GAP });
  cached.value.setAttribute("x", String(valueAnchor.x));
  cached.value.setAttribute("y", String(valueAnchor.y));
  cached.value.setAttribute("text-anchor", valueAnchor.textAnchor);
  cached.value.style.display = spec.value ? "" : "none";

  // The short metric caption (lens letter + identity) rides one line out; it is
  // a full-layout convenience and is dropped in compact layout.
  const labelAnchor = getHaloLabelGeometry({ endpoint: { x: valueAnchor.x, y: valueAnchor.y }, angle: spec.angle, gap: 12 });
  cached.label.textContent = `${which}·${spec.label}`;
  cached.label.setAttribute("x", String(labelAnchor.x));
  cached.label.setAttribute("y", String(labelAnchor.y));
  cached.label.setAttribute("text-anchor", labelAnchor.textAnchor);
  cached.label.style.display = layout === "compact" ? "none" : "";

  setHaloLine(cached.track, origin, outer);
  setHaloLine(cached.stateTrack, origin, outer);
  cached.zero.setAttribute("cx", String(origin[0])); cached.zero.setAttribute("cy", String(origin[1]));
  cached.qualifier.setAttribute("cx", String(outer[0])); cached.qualifier.setAttribute("cy", String(outer[1]));
  cached.track.style.display = isBar ? "" : "none";
  cached.fill.style.display = isBar ? "" : "none";
  cached.zero.style.display = isZero ? "" : "none";
  cached.abstain.style.display = isAbstain ? "" : "none";
  cached.qualifier.style.display = spec.qualified && isBar ? "" : "none";
  if (isBar) setHaloLine(cached.fill, origin, [fillGeometry.endpoint.x, fillGeometry.endpoint.y]);
  else setHaloLine(cached.fill, origin, origin);
  if (isAbstain) {
    cached.state.textContent = spec.visualState === "no-evidence" ? "○" : spec.visualState === "off" ? "·" : spec.visualState === "unavailable" ? "∕" : "×";
    cached.state.setAttribute("x", String(midpoint[0])); cached.state.setAttribute("y", String(midpoint[1] + 4));
    cached.state.setAttribute("text-anchor", "middle");
    cached.abstain.setAttribute("class", `halo-abstain halo-state-${spec.visualState}`);
  }
}

function haloPositionsFor(which) {
  const centerLatLng = lenses[which].marker.getLatLng();
  const center = map.latLngToContainerPoint(centerLatLng);
  const projectedCenter = map.project(centerLatLng);
  const onePixelEast = map.unproject(projectedCenter.add([1, 0]));
  const metresPerPixel = map.distance(centerLatLng, onePixelEast);
  const radiusPx = metresPerPixel > 0 ? radiusFor(which) / metresPerPixel : 0;
  const positions = {};
  const geometries = {};
  for (const metric of HALO_METRICS) {
    const geometry = getHaloBarGeometry({ center, renderedRadius: radiusPx, angle: getMetricSlotAngle(metric.id), magnitude: 0 });
    geometries[metric.id] = geometry;
    positions[metric.id] = map.containerPointToLatLng([geometry.origin.x, geometry.origin.y]);
    comparisonHalos[which][metric.id].setLatLng(positions[metric.id]);
  }
  return { center, radiusPx, positions, geometries };
}

function haloGlyphIntersects(element, point, footprint) {
  if (!element || element.hidden) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const mapRect = map.getContainer().getBoundingClientRect();
  const x = mapRect.left + point.x;
  const y = mapRect.top + point.y;
  return x + footprint.maxX > rect.left && x + footprint.minX < rect.right && y + footprint.maxY > rect.top && y + footprint.minY < rect.bottom;
}

function updateHaloLayout() {
  const note = document.getElementById("haloVisibilityNote");
  // The halo renders Lens A whenever evidence exists, with or without Lens B.
  // Lens B is drawn only when Compare mode is active; both lenses keep their own
  // perimeter bars so neither disappears when the active lens is switched.
  const whichList = bEnabled ? ["A", "B"] : ["A"];
  const removeAll = () => { for (const which of ["A", "B"]) for (const marker of Object.values(comparisonHalos[which])) map.removeLayer(marker); };
  if (!lastHaloComparison) {
    removeAll();
    if (note) note.textContent = "";
    return;
  }
  if (!haloEnabled) {
    removeAll();
    if (note) note.textContent = bEnabled ? "Map halo off; the full comparison remains in this panel." : "Map halo off.";
    return;
  }
  // Lens B markers never linger on the map in single-lens mode.
  if (!bEnabled) for (const marker of Object.values(comparisonHalos.B)) map.removeLayer(marker);
  const sides = {};
  const layouts = {};
  const blocked = {};
  for (const which of whichList) {
    sides[which] = haloPositionsFor(which);
    layouts[which] = haloLayoutForRadius(sides[which].radiusPx);
    blocked[which] = new Map();
  }
  for (const which of whichList) {
    if (layouts[which] === "hidden") {
      for (const metric of HALO_METRICS) blocked[which].set(metric.id, "below the 30 px compact Halo threshold");
      continue;
    }
    for (const metric of HALO_METRICS) {
      const point = map.latLngToContainerPoint(sides[which].positions[metric.id]);
      const footprint = haloSlotFootprint(metric.slot, layouts[which]);
      for (const element of [document.querySelector(".panel"), document.querySelector(".left")]) {
        if (haloGlyphIntersects(element, point, footprint)) blocked[which].set(metric.id, "overlapped by a map control panel");
      }
    }
  }
  if (bEnabled && layouts.A !== "hidden" && layouts.B !== "hidden") {
    for (const metricA of HALO_METRICS) {
      for (const metricB of HALO_METRICS) {
        const aPoint = map.latLngToContainerPoint(sides.A.positions[metricA.id]);
        const bPoint = map.latLngToContainerPoint(sides.B.positions[metricB.id]);
        const aFootprint = haloSlotFootprint(metricA.slot, layouts.A);
        const bFootprint = haloSlotFootprint(metricB.slot, layouts.B);
        if (aPoint.distanceTo(bPoint) < HALO_MIN_SLOT_SEPARATION_PX || haloFootprintsOverlap(aPoint, aFootprint, bPoint, bFootprint)) {
          blocked.A.set(metricA.id, "ambiguous Lens A/B slot overlap");
          blocked.B.set(metricB.id, "ambiguous Lens A/B slot overlap");
        }
      }
    }
  }
  const mapSize = map.getSize();
  for (const which of whichList) {
    if (layouts[which] === "hidden") continue;
    for (const metric of HALO_METRICS) {
      const point = map.latLngToContainerPoint(sides[which].positions[metric.id]);
      const footprint = haloSlotFootprint(metric.slot, layouts[which]);
      if (point.x + footprint.minX < 0 || point.y + footprint.minY < 0 || point.x + footprint.maxX > mapSize.x || point.y + footprint.maxY > mapSize.y) {
        blocked[which].set(metric.id, "at the map edge");
      }
    }
  }
  for (const which of whichList) {
    const visibility = resolveHaloSlotVisibility({ layout: layouts[which], blockedSlots: [...blocked[which].keys()] });
    for (const metric of HALO_METRICS) {
      const marker = comparisonHalos[which][metric.id];
      updateHaloGlyph(marker, lastHaloComparison.metrics[metric.id], layouts[which]);
      if (!visibility[metric.id].visible) map.removeLayer(marker);
      else if (!map.hasLayer(marker)) marker.addTo(map);
    }
  }
  haloVisibilityReason = whichList.flatMap((which) => [...blocked[which].entries()].map(([metric, reason]) => `${which} ${metric}: ${reason}`)).join("; ");
  if (note) {
    const compactCue = whichList.filter((which) => layouts[which] === "compact").map((which) => `Lens ${which} compact bars`).join("; ");
    const tail = bEnabled ? "the full comparison stays in this panel" : "detail stays in this panel";
    note.textContent = haloVisibilityReason
      ? `Some map Halo slots are hidden (${haloVisibilityReason}); ${tail}.`
      : `${compactCue ? `${compactCue}. ` : ""}Map Halo shown. Bar length is each lens's value against a fixed Madrid reference for that metric; lengths compare within a metric only.`;
  }
}

// Single-lens halo: the four perimeter bars render for Lens A alone (Compare
// off). Bars are raw-value magnitudes against the fixed Madrid reference, so the
// same scale is used whether or not Lens B is present.
function updateHalo() {
  const a = statsFor("A");
  const hatiOn = isHatiVisible();
  const ha = hatiOn ? heatStatsFor("A") : null;
  const absentSide = { value: null, sourceState: "unavailable" };
  lastHaloComparison = buildHaloComparison({
    radiusMode: "EQUAL_RADIUS",
    radii: { ...radii },
    aoiState: "not-required",
    references: getHaloReferences(),
    utciBand: getHaloUtciBand(),
    tourism: { a: { value: a.tourism, sourceState: combinedStatus(layerStatus, ["museums", "info"]) }, b: absentSide },
    stays: { a: { value: a.stay, sourceState: combinedStatus(layerStatus, ["stays"]) }, b: absentSide },
    mobility: { a: { value: a.mobility, sourceState: combinedStatus(layerStatus, ["bikes", "rail"]) }, b: absentSide },
    utci: { enabled: hatiOn, timestepA: timestep, timestepB: timestep, a: ha, b: null },
  });
  document.getElementById("comparisonHaloSummary").textContent = accessibleComparisonSummary(lastHaloComparison);
  updateHaloLayout();
}

// Browser regression tests exercise the production Leaflet renderer with
// deterministic evidence and map geometry. The seam is opt-in by query string
// and is absent during normal use.
const haloRegressionRequested = new URLSearchParams(window.location.search).get("haloRegressionTest") === "1";
const haloRegressionLocal = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
if (haloRegressionRequested && haloRegressionLocal) {
  window.__HALO_REGRESSION__ = Object.freeze({
    fixture: Object.freeze({
      radiusMode: "EQUAL_RADIUS",
      radii: Object.freeze({ A: 900, B: 900 }),
      aoiState: "eligible",
      references: Object.freeze({ tourism: 8, stays: 8, mobility: 8 }),
      utciBand: Object.freeze({ min: 30, max: 46 }),
      tourism: Object.freeze({ a: Object.freeze({ value: 5, sourceState: "live" }), b: Object.freeze({ value: 10, sourceState: "live" }) }),
      stays: Object.freeze({ a: Object.freeze({ value: 2, sourceState: "live" }), b: Object.freeze({ value: 4, sourceState: "live" }) }),
      mobility: Object.freeze({ a: Object.freeze({ value: 3, sourceState: "live" }), b: Object.freeze({ value: 6, sourceState: "live" }) }),
      utci: Object.freeze({ enabled: false }),
    }),
    setComparison(input) {
      lastHaloComparison = buildHaloComparison(input);
      document.getElementById("comparisonHaloSummary").textContent = accessibleComparisonSummary(lastHaloComparison);
      updateHaloLayout();
      return lastHaloComparison;
    },
    setRadius(which, radiusM) {
      radii[which] = Number(radiusM);
      lenses[which].circle.setRadius(radii[which]);
      updateHaloLayout();
    },
    setCenterAtPoint(which, x, y) {
      const latlng = map.containerPointToLatLng([x, y]);
      lenses[which].marker.setLatLng(latlng);
      lenses[which].circle.setLatLng(latlng);
      updateHaloLayout();
    },
    // Move a lens AND recompute from real data (exercises the production path,
    // not an injected fixture) so value-update assertions are meaningful.
    moveLens(which, x, y) {
      const latlng = map.containerPointToLatLng([x, y]);
      lenses[which].marker.setLatLng(latlng);
      lenses[which].circle.setLatLng(latlng);
      refresh();
    },
    recompute() {
      refresh();
    },
    setZoom(zoom) {
      map.setZoom(Number(zoom), { animate: false });
    },
    setActive(which) {
      activateLens(which);
    },
    focusMetric(metricId, which = "A", selected = false) {
      setHaloMetricFocus(metricId, which, selected);
    },
    geometry(which, metric) {
      const projected = haloPositionsFor(which);
      const anchor = map.latLngToContainerPoint(projected.positions[metric]);
      const radial = projected.geometries[metric];
      return {
        center: { x: projected.center.x, y: projected.center.y },
        anchor: { x: anchor.x, y: anchor.y },
        radiusPx: projected.radiusPx,
        angle: radial.angle,
        unit: radial.unit,
        origin: radial.origin,
      };
    },
  });
}

const LENS_BASEMAP_STYLES = {
  light: {
    A: { color: "#123b5f", fillColor: "#3da8ff", fillOpacity: 0.10 },
    B: { color: "#00768f", fillColor: "#43d7ff", fillOpacity: 0.09 },
  },
  satellite: {
    A: { color: "#ffffff", fillColor: "#35a7ff", fillOpacity: 0.13 },
    B: { color: "#64f0ff", fillColor: "#43d7ff", fillOpacity: 0.12 },
  },
  dark: {
    A: { color: "#ffffff", fillColor: "#3da8ff", fillOpacity: 0.11 },
    B: { color: "#64f0ff", fillColor: "#43d7ff", fillOpacity: 0.10 },
  },
};

function applyLensBasemapStyle(name = activeBasemapName) {
  const palette = LENS_BASEMAP_STYLES[name] || LENS_BASEMAP_STYLES.light;
  for (const which of ["A", "B"]) {
    const isActive = which === active;
    // V3 hierarchy: the boundary organizes the bars but must not dominate them,
    // so the circumference is quieter than V2 (thinner, softer, finer dash). It
    // stays heavier than the administrative reference area yet far lighter than
    // the 9 px perimeter data bars, which are the dominant marks.
    lenses[which].circle.setStyle({
      ...palette[which],
      weight: isActive ? 2.6 : 1.9,
      opacity: isActive ? 0.7 : 0.5,
      dashArray: isActive ? "3 6" : "2 7",
    });
  }
}

lensStyleController = applyLensBasemapStyle;
applyLensBasemapStyle(activeBasemapName);

function tooltipFor(p) {
  if (p.type === "heat") {
    const badge = Number.isFinite(p.utci)
      ? `${p.utci.toFixed(1)}°C · ${p.utciCategory}`
      : "no data at this time";
    return `<b>${p.name}</b><br>HATI · ${HATI_STUDY_DATE} · model-derived<br>${badge}`;
  }
  const src =
    p.provenance === "live"
      ? "live source"
      : p.provenance === "published"
        ? "deployment snapshot"
        : "snapshot sample (not exhaustive)";
  if (p.type === "rail") {
    const mode = p.mode === "cercanias" ? "Cercanías" : "Metro";
    const lines = p.lines ? ` · ${p.lines}` : "";
    return `<b>${p.name}</b><br>${mode}${lines}<br>CRTM · ${src}`;
  }
  if (p.type === "stay") {
    const accommodationFamily = p.accommodationCategory || p.accommodationType || "Accommodation";
    const subcategory = p.accommodationSubcategory ? ` · ${p.accommodationSubcategory}` : "";
    return `<b>${p.name}</b><br>${accommodationFamily}${subcategory}<br>${LAYER_LABEL[p.type]} · ${src}`;
  }
  if (p.type === "pedestrian") {
    const mean = Number.isFinite(Number(p.meanObserved)) ? Math.round(Number(p.meanObserved)).toLocaleString("en-GB") : "—";
    const dates = p.dateMin && p.dateMax ? `${p.dateMin} → ${p.dateMax}` : "2024 published period";
    return `<b>${p.name}</b><br>Mean observed: ${mean} pedestrians / published hourly record<br>${Number(p.observationCount || 0).toLocaleString("en-GB")} records · ${dates}<br>Madrid permanent counter · not tourism-specific`;
  }
  if (p.type === "park") {
    return `<b>${p.name}</b><br>Principal municipal park / garden<br>Madrid Open Data · context only`;
  }
  return `<b>${p.name}</b><br>${LAYER_LABEL[p.type] || p.type} · ${src}`;
}

function addMarker(p) {
  let color = LAYER_COLOR[p.type];
  let r = p.type === "bike" ? 2.8 : 4.2;
  if (p.type === "heat") {
    color = utciCategoryColor(p.utci);
    r = 5.3;
  }
  const m = L.circleMarker([p.lat, p.lon], {
    radius: r,
    color,
    fillColor: color,
    weight: 1,
    opacity: 0.95,
    fillOpacity: 0.78,
  });
  m._p = p;
  m.bindTooltip(tooltipFor(p), { direction: "top", offset: [0, -4] });
  m.addTo(groups[p.type]);
  return m;
}

function addPedestrianActivityMarker(p) {
  const color = LAYER_COLOR.pedestrian;
  const m = L.circleMarker([p.lat, p.lon], {
    radius: 4.4,
    color,
    fillColor: color,
    weight: 1.2,
    opacity: 0.92,
    fillOpacity: 0.42,
  });
  // _p is used only for lens-focused visual shading; these records never enter poiPoints.
  m._p = p;
  m.bindTooltip(tooltipFor(p), { direction: "top", offset: [0, -4] });
  m.addTo(groups.pedestrian);
  return m;
}

function renderPedestrianActivity() {
  groups.pedestrian.clearLayers();
  pedestrianStations.forEach(addPedestrianActivityMarker);
}

function addParkContextMarker(p) {
  const color = LAYER_COLOR.park;
  const m = L.circleMarker([p.lat, p.lon], {
    radius: 3.6,
    color,
    fillColor: color,
    weight: 1,
    opacity: 0.8,
    fillOpacity: 0.22,
  });
  m._context = p;
  m.bindTooltip(tooltipFor(p), { direction: "top", offset: [0, -4] });
  m.addTo(groups.park);
  return m;
}

function renderParkContext() {
  groups.park.clearLayers();
  parkPoints.forEach(addParkContextMarker);
}

function addClusterMarker(type, cluster) {
  const count = cluster.count;
  const size = count >= 100 ? 46 : count >= 30 ? 42 : 38;
  const m = L.marker([cluster.lat, cluster.lon], {
    bubblingMouseEvents: false,
    keyboard: true,
    icon: L.divIcon({
      className: "poi-cluster-icon",
      html: `<div class="poi-cluster cluster-${type}"><span>${count}</span></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    }),
  });
  m._cluster = cluster;
  m._p = { type, lat: cluster.lat, lon: cluster.lon };
  const clusterLabel =
    type === "stay" && stayKindFilter !== "all" ? stayFilterLabel() : LAYER_LABEL[type];
  m.bindTooltip(
    `<b>${count} ${clusterLabel}</b><br>Grouped for readability · zoom in to reveal individual points`,
    { direction: "top", offset: [0, -8] }
  );
  m.on("click", () => {
    const nextZoom = Math.min(16, Math.max(map.getZoom() + 1, 15));
    map.setView([cluster.lat, cluster.lon], nextZoom, { animate: true });
  });
  m.addTo(groups[type]);
  return m;
}

function visiblePoiPoints() {
  return filterPoiPointsByStayKind(poiPoints, stayKindFilter);
}

function stayFilterLabel() {
  const select = document.getElementById("stayKindFilter");
  return select?.selectedOptions?.[0]?.dataset?.label || "All accommodation";
}

function rebuildDenseLayer(type) {
  const group = groups[type];
  group.clearLayers();
  const points = visiblePoiPoints().filter((p) => p.type === type);
  const zoom = map.getZoom();

  if (!shouldClusterDenseLayer(zoom)) {
    points.forEach(addMarker);
    return;
  }

  clusterPointsByPixelGrid(points, zoom).forEach((cluster) => {
    if (cluster.count === 1) addMarker(cluster.points[0]);
    else addClusterMarker(type, cluster);
  });
}

function rebuildDenseLayers() {
  DENSE_LAYER_TYPES.forEach(rebuildDenseLayer);
  shadeMarkersOutsideActiveLens();
}

function renderPoiLayers() {
  groups.museum.clearLayers();
  groups.info.clearLayers();
  visiblePoiPoints()
    .filter((p) => !DENSE_LAYER_TYPES.has(p.type))
    .forEach(addMarker);
  rebuildDenseLayers();
}

function drawHatiStudyArea() {
  if (!hatiStudyArea?.bounds) return;
  const { lat_min, lat_max, lon_min, lon_max } = hatiStudyArea.bounds;
  const area = L.rectangle(
    [
      [lat_min, lon_min],
      [lat_max, lon_max],
    ],
    {
      color: "#ffb04a",
      weight: 1.4,
      opacity: 0.72,
      fillColor: "#ffb04a",
      fillOpacity: 0.025,
      dashArray: "7 7",
      interactive: true,
    }
  );
  area.bindTooltip(
    "<b>HATI pilot study area</b><br>Prado–Retiro–Atocha · ≈3.5 km²<br>Boundary only — thermal evidence exists only at sampled points.",
    { sticky: true, direction: "top" }
  );
  area.addTo(groups.heat);
}

function rebuildHeatLayer() {
  groups.heat.clearLayers();
  drawHatiStudyArea();
  hatiAssets.forEach((a) => addMarker(hatiPointFor(a, timestep)));
  refresh();
}

function isHatiVisible() {
  return map.hasLayer(groups.heat);
}

function syncHatiUi(on) {
  const details = document.getElementById("hatiEvidenceDetails");
  const timeSelect = document.getElementById("timeSelect");
  const toggle = document.querySelector('[data-layer="heat"]');

  if (details) details.hidden = !on;
  if (timeSelect) {
    timeSelect.disabled = !on;
    timeSelect.title = on ? "HATI model time" : "Enable HATI research evidence to change model time";
  }
  if (toggle) {
    toggle.checked = on;
    toggle.setAttribute("aria-checked", String(on));
  }
}

function isPedestrianVisible() {
  return map.hasLayer(groups.pedestrian);
}

function syncPedestrianUi(on) {
  const card = document.getElementById("pedestrianCard");
  const toggle = document.querySelector('[data-layer="pedestrian"]');
  if (card) card.hidden = !on;
  if (toggle) {
    toggle.checked = on;
    toggle.setAttribute("aria-checked", String(on));
  }
}

function setLayerVisible(name, on) {
  if (name === "hospitality") {
    setHospitalityVisible(on);
    return;
  }
  if (on) {
    if (!map.hasLayer(groups[name])) map.addLayer(groups[name]);
  } else if (map.hasLayer(groups[name])) {
    map.removeLayer(groups[name]);
  }

  if (name === "heat") {
    syncHatiUi(on);
    refresh();
  }
  if (name === "pedestrian") {
    syncPedestrianUi(on);
    refresh();
  }
}

function centerOf(which) {
  const c = lenses[which].marker.getLatLng();
  return { lat: c.lat, lon: c.lng };
}

function radiusFor(which) { return radii[which]; }
function setLensRadius(which, value) { setLensRadiusState(radii, which, value); return radii[which]; }

function windowRelationship() {
  const distance = haversineMeters(centerOf("A"), centerOf("B"));
  const smaller = Math.min(radii.A, radii.B); const larger = Math.max(radii.A, radii.B);
  if (distance + smaller <= larger) return "Nested windows · records may be shared";
  if (distance < radii.A + radii.B) return "Overlapping windows · observations are not independent";
  return "";
}

function statsFor(which) {
  return poiStatsInLens(visiblePoiPoints(), centerOf(which), radiusFor(which));
}

function heatStatsFor(which) {
  return hatiStatsInLens(hatiAssets, timestep, centerOf(which), radiusFor(which), haversineMeters);
}

function pedestrianStatsFor(which) {
  return pedestrianStatsInLens(pedestrianStations, centerOf(which), radiusFor(which));
}

const STATUS_LABEL = {
  live: "live",
  published: "DEPLOYMENT SNAPSHOT",
  snapshot: "SNAPSHOT SAMPLE",
  unavailable: "UNAVAILABLE",
};

function renderLayerSourceNote() {
  const lines = Object.entries(layerStatus).map(([name, status]) => {
    const label = {
      museums: "Museums",
      info: "Tourist info",
      bikes: "BiciMAD",
      rail: "Metro & Cercanías",
      stays: "Hotels & stays",
    }[name];
    return `${label}: <b>${STATUS_LABEL[status]}</b>`;
  });
  if (Object.values(layerStatus).some((s) => s === "published")) {
    lines.push("Deployment snapshots are generated from the public sources during the latest site deploy.");
  }
  if (Object.values(layerStatus).some((s) => s === "snapshot")) {
    lines.push("Curated fallback counts are a partial sample, not a complete inventory.");
  }
  lines.push(`Observed pedestrian activity: <b>${STATUS_LABEL[pedestrianStatus]}</b>`);
  lines.push("Pedestrian counters are observed activity evidence, not tourist counts, and are excluded from POI/category-mix metrics.");
  lines.push(`Principal parks (context): <b>${STATUS_LABEL[parkStatus]}</b>`);
  lines.push("Park context is excluded from lens counts, category mix, nearest features and A/B comparisons.");
  lines.push("Hotels & stays and BiciMAD are visually grouped below zoom 16; lens counts still use every record.");
  document.getElementById("layerSourceNote").innerHTML = lines.join("<br>");
}

function renderHeatMetric(h) {
  const hv = document.getElementById("heatValue");
  const hf = document.getElementById("heatFoot");
  hv.style.color = "";

  if (!isHatiVisible()) {
    hv.textContent = "Off";
    hv.className = "metric-value abstain";
    hf.textContent = "enable HATI research evidence";
    return;
  }

  if (h.evidence === "NONE") {
    hv.textContent = "No evidence";
    hv.className = "metric-value abstain";
    hf.textContent = "no HATI samples in lens";
  } else {
    hv.textContent = h.mean.toFixed(1) + "°C";
    hv.className = "metric-value";
    hv.style.color = utciCategoryColor(h.mean);
    hf.textContent = `${h.count} HATI sample${h.count !== 1 ? "s" : ""} · ${timestep}`;
  }
}

function renderPedestrianMetric(p) {
  const card = document.getElementById("pedestrianCard");
  const value = document.getElementById("pedestrianValue");
  const foot = document.getElementById("pedestrianFoot");
  if (!card || !value || !foot || !isPedestrianVisible()) return;

  if (pedestrianStatus === "unavailable") {
    value.textContent = "No data";
    value.className = "activity-card-value abstain";
    foot.textContent = "deployment snapshot unavailable";
    return;
  }

  if (p.evidence === "NONE") {
    value.textContent = "No sensor evidence";
    value.className = "activity-card-value abstain";
    foot.textContent = "no permanent pedestrian counter in lens";
    return;
  }

  value.textContent = `${Math.round(p.meanObserved).toLocaleString("en-GB")} ${p.stationCount === 1 ? "ped/h" : "passages/hour"}`;
  value.className = "activity-card-value";
  foot.textContent = `${p.stationCount} counter${p.stationCount !== 1 ? "s" : ""} in current lens · ${formatLensRadius(radiusFor(active))} radius`;
}

function renderMix(s) {
  const counts = { Museum: s.museum, Stay: s.stay, Bike: s.mobility, Info: s.info };
  const statuses = {
    Museum: layerStatus.museums,
    Stay: layerStatus.stays,
    Bike: combinedStatus(layerStatus, ["bikes", "rail"]),
    Info: layerStatus.info,
  };
  const { rows, label } = categoryMixState(counts, statuses);
  Object.entries(rows).forEach(([k, row]) => {
    const bar = document.getElementById("bar" + k);
    const pctEl = document.getElementById("pct" + k);
    if (row.na) {
      bar.style.width = "0%";
      pctEl.textContent = "N/A";
    } else {
      bar.style.width = row.pct + "%";
      pctEl.textContent = row.pct + "%";
    }
  });
  document.getElementById("mixLabel").textContent = label;
}

function renderNearest(s) {
  document.getElementById("nearestList").innerHTML = s.nearest.length
    ? s.nearest
        .map(
          (p) =>
            `<li><i class="dot" style="display:inline-block;background:${LAYER_COLOR[p.type]};color:${LAYER_COLOR[p.type]};margin-right:5px"></i>${p.name}<em>${Math.round(p.d)} m</em></li>`
        )
        .join("")
    : "<li>No mapped points in lens.</li>";
}

function comparisonCell(value, metricId, stateCode) {
  if (value != null) {
    if (metricId === "utci") return `${value.toFixed(1)}°C`;
    if (metricId === "pedestrian") return `${value.toFixed(1)} observed pedestrians/hour`;
    return String(value);
  }
  return ({ OFF: "Off", UNAVAILABLE: "Unavailable", NO_EVIDENCE: "No evidence", INCOMPATIBLE: "Withheld" })[stateCode] || "—";
}

function comparisonDeltaCell(state, metricId) {
  if (!state.comparable) return state.id === "off" ? "Off" : state.id === "unavailable" ? "Unavailable" : "Withheld";
  if (metricId === "utci") return `${state.delta > 0 ? "+" : ""}${state.delta.toFixed(1)}°C`;
  if (metricId === "pedestrian") {
    const base = `${state.delta > 0 ? "+" : ""}${state.delta.toFixed(1)} observed pedestrians/hour`;
    return state.id === "valid-partial" ? `${base} · sample` : state.id === "valid-deployment" ? `${base} · deploy` : base;
  }
  const base = state.delta > 0 ? `+${state.delta}` : String(state.delta);
  return state.id === "valid-partial" ? `${base} · sample` : state.id === "valid-deployment" ? `${base} · deploy` : base;
}

function setComparisonRow(prefix, state, metricId) {
  const aCell = document.getElementById(`${prefix}A`);
  const bCell = document.getElementById(`${prefix}B`);
  aCell.textContent = comparisonCell(state.aValue, metricId, state.stateA);
  bCell.textContent = comparisonCell(state.bValue, metricId, state.stateB);
  aCell.title = [state.aCoverage, state.qualifierA, state.qualifier].filter(Boolean).join(". ");
  bCell.title = [state.bCoverage, state.qualifierB, state.qualifier].filter(Boolean).join(". ");
  document.getElementById(prefix).textContent = comparisonDeltaCell(state, metricId);
}

function renderCompare() {
  if (!bEnabled) {
    // Single-lens: the halo still renders Lens A's four perimeter bars.
    updateHalo();
    return;
  }
  const a = statsFor("A");
  const b = statsFor("B");
  const hatiOn = isHatiVisible();
  const pedestrianOn = isPedestrianVisible();
  const ha = hatiOn ? heatStatsFor("A") : null;
  const hb = hatiOn ? heatStatsFor("B") : null;
  const pa = pedestrianOn ? pedestrianStatsFor("A") : null;
  const pb = pedestrianOn ? pedestrianStatsFor("B") : null;
  const radiusMode = radiusComparisonMode(radii.A, radii.B);
  const aoiA = geographyIndex?.municipalityContainsCircle?.(centerOf("A").lon, centerOf("A").lat, radii.A);
  const aoiB = geographyIndex?.municipalityContainsCircle?.(centerOf("B").lon, centerOf("B").lat, radii.B);
  const aoiState = radiusMode === "EQUAL_RADIUS" ? "not-required" : !aoiA || !aoiB || aoiA.state === "unavailable" || aoiB.state === "unavailable" ? "unavailable" : aoiA.eligible && aoiB.eligible ? "eligible" : aoiA.state === "outside" || aoiB.state === "outside" ? "outside" : "crosses";
  const comparison = buildHaloComparison({
    radiusMode, radii: { ...radii }, aoiState,
    references: getHaloReferences(), utciBand: getHaloUtciBand(),
    tourism: {
      a: { value: a.tourism, sourceState: combinedStatus(layerStatus, ["museums", "info"]) },
      b: { value: b.tourism, sourceState: combinedStatus(layerStatus, ["museums", "info"]) },
    },
    stays: {
      a: { value: a.stay, sourceState: combinedStatus(layerStatus, ["stays"]) },
      b: { value: b.stay, sourceState: combinedStatus(layerStatus, ["stays"]) },
    },
    mobility: {
      a: { value: a.mobility, sourceState: combinedStatus(layerStatus, ["bikes", "rail"]) },
      b: { value: b.mobility, sourceState: combinedStatus(layerStatus, ["bikes", "rail"]) },
    },
    utci: { enabled: hatiOn, timestepA: timestep, timestepB: timestep, a: ha, b: hb },
  });
  // Pedestrian activity is a panel-only analytical comparison (not a halo bar).
  const pedestrianState = activityState({
    enabled: pedestrianOn, sourceState: pedestrianStatus,
    a: pa, b: pb, periodKey: pedestrianMeta?.source?.year != null ? String(pedestrianMeta.source.year) : null,
  });
  setComparisonRow("cmpPoi", comparison.metrics.tourism, "tourism");
  setComparisonRow("cmpStay", comparison.metrics.stays, "stays");
  for (const [prefix, state, name] of [["cmpPoi", comparison.metrics.tourism, "represented records"], ["cmpStay", comparison.metrics.stays, "represented catalogue records"]]) {
    const formatSide = (side) => {
      const raw = side === "A" ? state.aRawValue : state.bRawValue;
      if (raw == null) return "Unavailable";
      const rate = state.aoiEligible ? (side === "A" ? state.aValue : state.bValue) : null;
      const rawUnit = prefix === "cmpStay" ? "catalogue records" : "records";
      return `${raw} ${rawUnit}${rate == null ? "" : `\n${rate.toFixed(1)} ${name}/km²`}\nr ${formatLensRadius(radiusFor(side))}`;
    };
    document.getElementById(`${prefix}A`).textContent = formatSide("A");
    document.getElementById(`${prefix}B`).textContent = formatSide("B");
    const delta = document.getElementById(prefix);
    if (radiusMode === "UNEQUAL_RADIUS" && !state.comparable) delta.textContent = state.qualifier === "circle crosses Madrid AOI" ? "Withheld · circle crosses Madrid AOI" : state.qualifier === "circle outside Madrid AOI" ? "Withheld · circle outside Madrid AOI" : state.qualifier === "Madrid AOI unavailable" ? "Withheld · AOI unavailable" : "Withheld · source states incompatible";
    else if (radiusMode === "UNEQUAL_RADIUS") delta.textContent = `${state.delta > 0 ? "+" : ""}${state.delta.toFixed(1)} ${name}/km²`;
    else delta.textContent = comparisonDeltaCell(state, prefix === "cmpPoi" ? "tourism" : "stays");
  }
  const mobilityStatus = combinedStatus(layerStatus, ["bikes", "rail"]);
  const mobilityState = buildCountPairState(
    { value: a.mobility, sourceState: mobilityStatus },
    { value: b.mobility, sourceState: mobilityStatus }, radiusMode
  );
  setComparisonRow("cmpMobility", mobilityState, "mobility");
  for (const side of ["A", "B"]) {
    const value = side === "A" ? mobilityState.aValue : mobilityState.bValue;
    document.getElementById(`cmpMobility${side}`).textContent = value == null ? "Unavailable" : `${value} nodes\nr ${formatLensRadius(radiusFor(side))}`;
  }
  document.getElementById("cmpMobility").textContent = radiusMode === "UNEQUAL_RADIUS" ? "Withheld · different window sizes" : comparisonDeltaCell(mobilityState, "mobility");
  setComparisonRow("cmpPedestrian", pedestrianState, "pedestrian");
  setComparisonRow("cmpHeat", comparison.metrics.utci, "utci");
  const mobilityA = document.getElementById("cmpMobilityA");
  const mobilityB = document.getElementById("cmpMobilityB");
  if (mobilityStatus !== "unavailable") {
    mobilityA.title = mobilityStatus === "snapshot" ? "Snapshot sample; not exhaustive" : mobilityStatus === "published" ? "Deployment snapshot" : "Live source";
    mobilityB.title = mobilityA.title;
  }
  const pedestrianEvidence = pedestrianStatus === "unavailable"
    ? "Pedestrian source unavailable"
    : pedestrianOn
      ? `Pedestrian observations · A ${pa.stationCount} counters / ${pa.observationCount} observations · r ${formatLensRadius(radii.A)}${pa.dateMin && pa.dateMax ? ` (${pa.dateMin}–${pa.dateMax})` : ""}; B ${pb.stationCount} counters / ${pb.observationCount} observations · r ${formatLensRadius(radii.B)}${pb.dateMin && pb.dateMax ? ` (${pb.dateMin}–${pb.dateMax})` : ""}; observed pedestrians, not tourists.`
      : "Pedestrian layer off.";
  const radiusCue = document.getElementById("comparisonModeCue");
  const relationship = windowRelationship();
  const normalizedEligible = comparison.metrics.tourism.comparable && comparison.metrics.stays.comparable;
  const cue = radiusMode === "EQUAL_RADIUS" ? "Equal windows · raw represented counts" : normalizedEligible ? "Different windows · POI/stay comparator: represented records/km²" : "Different windows · POI/stay normalized comparison withheld";
  document.getElementById("comparisonRadiusReadout").textContent = `Lens A · ${formatLensRadius(radii.A)} | Lens B · ${formatLensRadius(radii.B)}`;
  const cueReason = radiusMode !== "UNEQUAL_RADIUS" ? "" : aoiState === "unavailable" ? "AOI unavailable" : aoiState === "outside" ? "circle outside Madrid AOI" : aoiState === "crosses" ? "circle crosses Madrid AOI" : !normalizedEligible ? "source evidence incompatible or unavailable" : "";
  radiusCue.textContent = [cue, cueReason, relationship].filter(Boolean).join(" · ");
  const radiusLine = `Lens A ${formatLensRadius(radii.A)}; Lens B ${formatLensRadius(radii.B)}.`;
  const hatiCoverage = hatiOn
    ? `HATI ${timestep} · 21 Aug 2023 · A ${ha.count} samples (r ${formatLensRadius(radii.A)}) / B ${hb.count} samples (r ${formatLensRadius(radii.B)})${ha.count !== hb.count ? "; sample counts differ, summarizing different sampled assets/windows" : ""}`
    : "HATI off";
  document.getElementById("cmpEvidence").textContent = `${radiusLine} ${hatiCoverage}. ${pedestrianEvidence}`;
  lastHaloComparison = comparison;
  const pointSummary = radiusMode === "EQUAL_RADIUS"
    ? `Tourism POIs raw counts ${a.tourism} and ${b.tourism}; stays raw counts ${a.stay} and ${b.stay}.`
    : `Tourism POIs raw counts ${a.tourism} and ${b.tourism}; stays raw counts ${a.stay} and ${b.stay}. ${comparison.metrics.tourism.comparable ? `Tourism rates ${comparison.metrics.tourism.aValue.toFixed(1)} and ${comparison.metrics.tourism.bValue.toFixed(1)} represented records per km²; delta ${comparison.metrics.tourism.delta.toFixed(1)}.` : comparison.metrics.tourism.qualifier}. ${comparison.metrics.stays.comparable ? `Stay rates ${comparison.metrics.stays.aValue.toFixed(1)} and ${comparison.metrics.stays.bValue.toFixed(1)} represented catalogue records per km²; delta ${comparison.metrics.stays.delta.toFixed(1)}.` : comparison.metrics.stays.qualifier} Mobility delta withheld · different window sizes.`;
  const nestedSummary = relationship ? `${relationship}.` : "Windows are disjoint.";
  document.getElementById("comparisonHaloSummary").textContent = `${accessibleComparisonSummary(comparison)} ${pointSummary} ${nestedSummary}`;
  updateHaloLayout();
}

map.on("zoomend resize", updateHaloLayout);
document.getElementById("haloToggle").addEventListener("change", (event) => {
  haloEnabled = event.target.checked;
  event.target.setAttribute("aria-checked", String(haloEnabled));
  updateHaloLayout();
});

// ---------------------------------------------------------------- area profile
//
// THE LENS CIRCLE AND THE ADMINISTRATIVE AREA ARE DIFFERENT ANALYTICAL OBJECTS.
//
// Everything below reports WHERE a lens centre is in Madrid's official
// administrative geography, and what the canonical Padron says about the whole
// barrio that contains it. No population is ever distributed into the circle,
// weighted by overlap, or combined with a lens count. The pure model lives in
// js/area-profile.js; this section only loads the artifacts, renders the model
// and draws the administrative reference geometry on the map.

const areaModel = { profile: null, geography: null }; // loaded ES modules
// The model's state vocabularies, bound once the module loads, so this file
// never re-spells a state string the model owns.
let AREA_STATE = null;
let RESIDENTS_STATE = null;
let AREA_COMPARISON = null;
let VUT_STATE = null;
let RATIO_STATE = null;
let geographyIndex = null;
let populationIndex = null;
let vutIndex = null;
let geographyMeta = null;
let populationMeta = null;
let vutMeta = null;
// Three independent runtime states, because the three artifacts fail
// independently in a browser. The canonical geography is the DEPENDENCY for
// resolving a place: without it there is no barrio, no district, no highlight
// and no boundary layer. The population and the licensed-VUT numerator are only
// VALUES attached to a barrio that has already been resolved, so losing either
// must cost its own figure and nothing else. (This is runtime degradation only.
// All three artifacts remain blocks_deployment: true — a build carrying a
// broken committed artifact is still withheld rather than published in a
// degraded state.)
let geographyState = "loading"; // loading | ready | unavailable
let populationState = "loading"; // loading | ready | unavailable
// The licensed-VUT numerator is a third independent runtime state. Like the
// population it is a VALUE attached to a barrio already resolved, so losing it
// costs the licensed-VUT block and nothing else: the place and the resident
// figure both stand. Losing the POPULATION costs the ratio but not the raw
// licensed counts, which is why these are three states and not two.
let vutState = "loading"; // loading | ready | unavailable
let boundaryMode = "off";
const areaProfiles = { A: null, B: null };
const areaHint = { A: null, B: null };
const boundaryLayers = { district: null, barrio: null };
const activeAreaLayers = { A: null, B: null };
let lastAreaRenderKey = null;

// Administrative geometry gets its own visual grammar, kept deliberately
// different from the lens: solid reference outlines and a barely-there fill,
// against the lens's dashed analytical circle, in neutral slate rather than the
// lens's blue — analytical geometry is coloured, reference geometry is not.
// Each basemap gets a stroke that survives it, because losing contrast on
// satellite and light is exactly the failure the lens had to be fixed for; on
// imagery legibility wins and the stroke goes white, where circle and outline
// still read as two different objects.
const ADMIN_BASEMAP_STYLES = {
  light: { stroke: "#2c3a48", fill: "#4a6076", lattice: "#3a4a5a", latticeOpacity: 0.6 },
  satellite: { stroke: "#ffffff", fill: "#ffffff", lattice: "#ffffff", latticeOpacity: 0.58 },
  dark: { stroke: "#ccd6df", fill: "#9fb3c4", lattice: "#9aa9b6", latticeOpacity: 0.6 },
};

function adminPalette(name = activeBasemapName) {
  return ADMIN_BASEMAP_STYLES[name] || ADMIN_BASEMAP_STYLES.light;
}

function activeAreaStyle(which, forceActive = false) {
  const palette = adminPalette();
  const isActive = forceActive || which === active;
  return {
    color: palette.stroke,
    // Lens A keeps a solid administrative outline and Lens B a fine dotted one,
    // so the two areas stay distinguishable without relying on colour alone.
    dashArray: which === "A" ? null : "2 4",
    weight: isActive ? 2.3 : 1.7,
    opacity: isActive ? 0.95 : 0.66,
    fillColor: palette.fill,
    fillOpacity: isActive ? 0.075 : 0.045,
    lineJoin: "round",
  };
}

function latticeStyle() {
  const palette = adminPalette();
  return {
    color: palette.lattice,
    weight: boundaryMode === "district" ? 1.5 : 1.1,
    opacity: palette.latticeOpacity,
    fill: false,
  };
}

function applyAdminBasemapStyle() {
  for (const which of ["A", "B"]) {
    const entry = activeAreaLayers[which];
    if (entry) entry.layer.setStyle(activeAreaStyle(which, entry.forceActive));
  }
  for (const level of ["district", "barrio"]) {
    if (boundaryLayers[level]) boundaryLayers[level].setStyle(latticeStyle());
  }
}

adminStyleController = applyAdminBasemapStyle;

// One canvas renderer per administrative pane, created once. Rebuilding Leaflet
// layers on every lens move is what would make dragging expensive, so the
// layers below are created once and only re-fed when the containing area
// actually changes.
let latticeRenderer = null;
let activeAreaRenderer = null;

function boundaryLayerFor(level) {
  if (boundaryLayers[level]) return boundaryLayers[level];
  if (!geographyIndex) return null;
  if (!latticeRenderer) latticeRenderer = L.canvas({ pane: "adminPane", padding: 0.3 });
  boundaryLayers[level] = L.geoJSON(
    { type: "FeatureCollection", features: geographyIndex.featuresByLevel(level) },
    { pane: "adminPane", renderer: latticeRenderer, interactive: false, style: latticeStyle }
  );
  return boundaryLayers[level];
}

function setBoundaryMode(mode) {
  boundaryMode = ["off", "district", "barrio"].includes(mode) ? mode : "off";
  for (const level of ["district", "barrio"]) {
    const wanted = boundaryMode === level;
    const layer = wanted ? boundaryLayerFor(level) : boundaryLayers[level];
    if (!layer) continue;
    if (wanted && !map.hasLayer(layer)) {
      layer.setStyle(latticeStyle());
      map.addLayer(layer);
    } else if (!wanted && map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }
}

function clearActiveAreaLayer(which) {
  const entry = activeAreaLayers[which];
  if (!entry) return;
  map.removeLayer(entry.layer);
  if (entry.label) map.removeLayer(entry.label);
  activeAreaLayers[which] = null;
}

// Redraws a lens's containing barrio only when that barrio actually changed.
// Dragging inside one barrio touches no Leaflet layer at all.
function renderActiveAreaFor(which, profile, { tag = which, forceActive = false } = {}) {
  const shouldShow =
    profile &&
    profile.state === AREA_STATE.RESOLVED &&
    (which === "A" || bEnabled) &&
    geographyIndex;
  const existing = activeAreaLayers[which];

  if (!shouldShow) {
    clearActiveAreaLayer(which);
    return;
  }
  if (existing && existing.barrioId === profile.barrioId && existing.tag === tag) {
    existing.forceActive = forceActive;
    existing.layer.setStyle(activeAreaStyle(which, forceActive));
    return;
  }

  clearActiveAreaLayer(which);
  const feature = geographyIndex.featureById("barrio", profile.barrioId);
  if (!feature) return;

  if (!activeAreaRenderer) activeAreaRenderer = L.canvas({ pane: "adminActivePane", padding: 0.3 });
  const layer = L.geoJSON(feature, {
    pane: "adminActivePane",
    renderer: activeAreaRenderer,
    interactive: false,
    style: () => activeAreaStyle(which, forceActive),
  }).addTo(map);

  // One label per highlighted area, never a sheet of 131 barrio names.
  const label = L.tooltip({
    permanent: true,
    direction: "center",
    className: `area-label area-label-${which.toLowerCase()}`,
    interactive: false,
    opacity: 1,
  })
    .setLatLng(layer.getBounds().getCenter())
    .setContent(`<b>${tag}</b>${profile.headline}`)
    .addTo(map);

  activeAreaLayers[which] = { layer, label, barrioId: profile.barrioId, tag, forceActive };
}

function areaProfileFor(which) {
  const { profile: model } = areaModel;
  if (!model) return null;
  // Only the geography gates the place. A resolved barrio with no population
  // record is an ordinary, already-modelled state: the place stands, and the
  // residents value abstains.
  if (geographyState !== "ready") {
    return model.buildAreaProfile({
      lens: which,
      located: null,
      populationIndex,
      vutIndex,
      state: geographyState === "unavailable" ? AREA_STATE.UNAVAILABLE : AREA_STATE.LOADING,
    });
  }
  const centre = centerOf(which);
  const located = geographyIndex.resolve(centre.lon, centre.lat, areaHint[which]);
  areaHint[which] = located.barrio ? located.barrio.official_id : null;
  return model.buildAreaProfile({ lens: which, located, populationIndex, vutIndex });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value == null ? "" : value;
}

function renderAreaProfile(profile) {
  const section = document.getElementById("areaProfile");
  if (!section || !profile) return;

  section.dataset.state = profile.state;
  section.dataset.residents = profile.residents.state;
  setText("areaHeadline", profile.headline);
  setText("areaContext", profile.context);
  setText("areaCodes", profile.codes);
  document.querySelector(".area-identity").hidden = !profile.context && !profile.codes;
  setText(
    "areaScopeHint",
    profile.state === AREA_STATE.RESOLVED
      ? "official barrio"
      : profile.state === AREA_STATE.DISTRICT_ONLY
        ? "official district"
        : ""
  );

  const value = document.getElementById("areaResidentsValue");
  const residents = profile.residents;
  if (residents.state === RESIDENTS_STATE.AVAILABLE) {
    value.textContent = residents.display;
    value.className = "area-value";
  } else {
    // Never a zero: an area with no published figure is not an empty area.
    value.textContent = residents.state === RESIDENTS_STATE.UNAVAILABLE ? "Unavailable" : "—";
    value.className = "area-value abstain";
  }

  const period = profile.period && profile.period.label;
  setText("areaPeriod", residents.state === RESIDENTS_STATE.AVAILABLE && period ? `Reference ${period}` : "");
  setText("areaScopeNote", profile.note || profile.scopeCaveat);
  renderVutContext(profile);
}

// The licensed-VUT block: a SECOND administrative figure for the SAME whole
// barrio, kept visually subordinate to the place identity and to the resident
// figure above it.
//
// Deliberately neutral at every value. There is no colour scale, no class
// break, no band, no rank, no percentile and no warning affordance: a barrio
// with many licensed units is not styled as a problem, because this figure
// describes documented administrative supply and nothing else. The two periods
// are never merged — the resident figure keeps its Padron reference date above,
// and this block states its own source-file state, which is not a reference
// date and does not pretend to be one.
function renderVutContext(profile) {
  const host = document.getElementById("areaVut");
  if (!host) return;
  const vut = profile.vut;
  const labels = areaModel.profile;

  // No whole barrio, no barrio statistic. Outside Madrid, a point inside no
  // barrio, and an unreadable geography all land here: the block is absent
  // rather than showing an empty figure, and nothing falls back to a district
  // total or a neighbouring barrio.
  if (!vut || vut.state === VUT_STATE.NOT_APPLICABLE) {
    host.hidden = true;
    host.dataset.state = VUT_STATE ? VUT_STATE.NOT_APPLICABLE : "not_applicable";
    host.dataset.ratio = "not_applicable";
    // Emptied, not merely hidden. A figure for the previous barrio left behind
    // in the document is a wrong number waiting for a stylesheet change to
    // reveal it, and this block sits inside the polite live region.
    setText("areaVutValue", "—");
    setText("areaVutUnit", "");
    document.getElementById("areaVutSecondary").innerHTML = "";
    setText("areaVutState", "");
    return;
  }
  host.hidden = false;
  host.dataset.state = vut.state;
  host.dataset.ratio = vut.ratio.state;

  const value = document.getElementById("areaVutValue");
  const available = vut.state === VUT_STATE.AVAILABLE;
  // Never a zero standing in for a failure: a zero here is only ever the
  // artifact's own published zero for this barrio.
  value.textContent = available ? vut.units.display : "Unavailable";
  value.className = available ? "area-vut-value" : "area-vut-value abstain";
  setText("areaVutUnit", available ? labels.countedNoun("units", vut.units.value) : "");

  // Licence COUNT is supporting evidence, never the headline: one licence in
  // this source covers up to 48 dwelling units, so the two figures are shown
  // with their own names and never substituted for one another.
  const secondary = document.getElementById("areaVutSecondary");
  if (!available) {
    secondary.innerHTML = "";
  } else {
    const parts = [`${vut.licences.display} ${labels.countedNoun("licences", vut.licences.value)}`];
    if (vut.ratio.state === RATIO_STATE.AVAILABLE) {
      // The screen-reader text names the quantity the ratio counts, which the
      // compact visual figure leaves to the line above it.
      parts.push(
        `${vut.ratio.display}<span class="sr-only"> ${labels.VUT_UNITS_LABEL}</span> ${labels.RATIO_LABEL}`
      );
    } else if (vut.ratio.state === RATIO_STATE.NO_DENOMINATOR) {
      parts.push("ratio unavailable without a resident figure");
    }
    secondary.innerHTML = parts.join(" · ");
  }

  setText("areaVutState", vutStateLine(vut, available, labels));
}

// The one line under the figure. It carries the word that keeps this indicator
// honest at every viewport, including the narrow ones where the full source
// disclosure is collapsed away: GRANTED. The file state is named as a file
// state, and the scope as the whole official barrio.
function vutStateLine(vut, available, labels) {
  if (!available) {
    if (vutState === "loading") return "Reading the licensed-VUT source.";
    if (vutState === "unavailable") return "Licensed-VUT source unavailable in this session.";
    return "Not covered by the committed licensed-VUT source.";
  }
  const fileState = vut.sourceState && vut.sourceState.fileStateCompact;
  return [
    labels.VUT_STATE_PREFIX,
    fileState ? `source file state ${fileState}` : null,
    "whole official barrio",
  ]
    .filter(Boolean)
    .join(" · ");
}

// The other lens's administrative area, as one compact line inside the profile
// rather than a second full card. Two lens centres in ONE barrio share ONE set
// of administrative-area statistics, and that is said in words: showing the
// same figures twice would imply two independent observations. Two centres in
// DIFFERENT barrios get two descriptive values side by side — no delta, no
// winner, no ranking and no percentage advantage between two places.
function renderOtherLensArea(a, b) {
  const host = document.getElementById("areaOther");
  if (!host) return;
  const other = active === "A" ? "B" : "A";
  const otherProfile = other === "A" ? a : b;
  // With no administrative context at all, the headline above already says so;
  // repeating it for the other lens would add a line and no information.
  const unresolvable = [AREA_STATE.UNAVAILABLE, AREA_STATE.LOADING];
  if (!bEnabled || !a || !b || !otherProfile || unresolvable.includes(otherProfile.state)) {
    host.innerHTML = "";
    return;
  }

  const comparison = areaModel.profile.compareAreaProfiles(a, b);
  const tag = `<span class="area-other-lens area-other-lens-${other.toLowerCase()}">Lens ${other}</span>`;

  if (comparison.state === AREA_COMPARISON.SAME_BARRIO) {
    host.innerHTML =
      `${tag}<span class="area-other-body">is in the same barrio — A · B share the same ` +
      `administrative-area statistics, not two observations.</span>`;
    return;
  }

  const residents =
    otherProfile.residents.state === RESIDENTS_STATE.AVAILABLE
      ? ` · ${otherProfile.residents.display} residents`
      : otherProfile.residents.state === RESIDENTS_STATE.NOT_APPLICABLE
        ? "" // no official area to carry a residential figure at all
        : " · residents unavailable";
  // The other barrio's licensed-VUT figure, as a plain descriptive value. It is
  // deliberately the unit count and not the licence count, and it is never set
  // against this lens's figure as a difference or a comparison verdict.
  const otherVut = otherProfile.vut;
  const vut =
    otherVut && otherVut.state === VUT_STATE.AVAILABLE
      ? ` · ${otherVut.units.display} ${areaModel.profile.countedNoun("units", otherVut.units.value)}`
      : otherVut && otherVut.state === VUT_STATE.UNAVAILABLE
        ? " · licensed VUT unavailable"
        : "";
  const context = otherProfile.context ? ` · ${otherProfile.districtName}` : "";
  host.innerHTML =
    `${tag}<span class="area-other-body"><b>${otherProfile.headline}</b>${context}${residents}${vut}</span>`;
}

// Progressive disclosure for both administrative figures. The two are shown as
// two NAMED GROUPS rather than one list, because the whole point is that the
// numerator and the denominator are different sources with different universes
// and different temporal semantics: one publishes a real reference date, the
// other publishes none at all. Collapsing them into a single block of lines is
// exactly the conflation the group headings prevent.
function renderAreaSourceDetails() {
  const host = document.getElementById("areaSourceDetails");
  const model = areaModel.profile;
  if (!host || !model) return;

  const groups = [
    {
      title: "Registered residents",
      lines: model.buildProvenanceLines({
        populationMeta,
        geographyMeta,
        period: populationIndex ? populationIndex.period : null,
      }),
    },
    {
      title: "Licensed VUT units",
      lines: model.buildVutProvenanceLines({
        vutMeta,
        sourceState: vutIndex ? vutIndex.sourceState : null,
      }),
    },
  ].filter((group) => group.lines.length > 0);

  host.innerHTML = groups
    .map(
      (group) =>
        `<div class="area-source-group"><h2 class="area-source-group-title">${group.title}</h2>` +
        group.lines.map((line) => `<span>${line}</span>`).join("") +
        `</div>`
    )
    .join("");
  // The affordance only appears once there is provenance behind it, so it can
  // never open onto an empty box while the artifacts are still loading, or when
  // the sidecar metadata itself could not be read.
  document.getElementById("areaSourceToggle").hidden = groups.length === 0;
}

function updateAreaContext() {
  if (!areaModel.profile) return;
  areaProfiles.A = areaProfileFor("A");
  areaProfiles.B = bEnabled ? areaProfileFor("B") : null;

  const shown = areaProfiles[active] || areaProfiles.A;
  const key = [
    active,
    bEnabled ? "b" : "a",
    shown && shown.key,
    areaProfiles.B && areaProfiles.B.key,
    activeBasemapName,
  ].join("|");

  // One barrio containing both lens centres is ONE administrative shape: it is
  // outlined and labelled once, for both, rather than drawn twice.
  const sharedArea = Boolean(
    areaProfiles.A &&
      areaProfiles.B &&
      areaProfiles.A.state === AREA_STATE.RESOLVED &&
      areaProfiles.A.barrioId === areaProfiles.B.barrioId
  );
  renderActiveAreaFor("A", areaProfiles.A, sharedArea ? { tag: "A·B", forceActive: true } : {});
  renderActiveAreaFor("B", sharedArea ? null : areaProfiles.B);

  // Dragging within one barrio changes nothing here, so the panel is not
  // rewritten on every pointer move.
  if (key === lastAreaRenderKey) return;
  lastAreaRenderKey = key;
  renderAreaProfile(shown);
  renderOtherLensArea(areaProfiles.A, areaProfiles.B);
}

function disableBoundaryControl() {
  const select = document.getElementById("boundarySelect");
  if (!select) return;
  select.disabled = true;
  select.title = "Administrative geography unavailable in this deployment";
}

function fetchAreaJson(url) {
  return fetch(`${url}?v=${AREA_ASSET_VERSION}`).then((response) => {
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  });
}

const settledValue = (result) => (result.status === "fulfilled" ? result.value : null);

async function loadAreaContext() {
  let profileModule;
  let geographyModule;
  try {
    [profileModule, geographyModule] = await Promise.all([
      import(moduleUrl("area-profile.js")),
      import(moduleUrl("geography.js")),
    ]);
  } catch (error) {
    // Without the modules nothing administrative can be modelled at all. The
    // Lens itself is untouched and keeps working.
    geographyState = "unavailable";
    populationState = "unavailable";
    vutState = "unavailable";
    disableBoundaryControl();
    console.warn("area context modules unavailable", error);
    return;
  }

  areaModel.profile = profileModule;
  areaModel.geography = geographyModule;
  ({ AREA_STATE, RESIDENTS_STATE, AREA_COMPARISON, VUT_STATE, RATIO_STATE } = profileModule);
  updateAreaContext();

  // Settled, not all-or-nothing. A failure of the population request must not
  // cost the place: the geography is the dependency for resolving a barrio,
  // while the population is a value attached to a barrio already resolved.
  // Both are awaited together so the profile never flashes "unavailable" at a
  // request that is merely still in flight.
  // All five committed artifacts are fetched ONCE, here, and the indices built
  // from them are reused for the rest of the session: moving a Lens performs a
  // code lookup against an in-memory Map and never a fetch, and no
  // administrative aggregate is ever recomputed in the browser.
  const [geojson, population, vut, geoMeta, popMeta, vutMetaResult] = await Promise.allSettled([
    fetchAreaJson("data/geography/madrid_admin.geojson"),
    fetchAreaJson("data/population/madrid_population.json"),
    fetchAreaJson("data/accommodation/madrid_vut_licences.json"),
    fetchAreaJson("data/geography/madrid_admin.meta.json"),
    fetchAreaJson("data/population/madrid_population.meta.json"),
    fetchAreaJson("data/accommodation/madrid_vut_licences.meta.json"),
  ]);

  // A payload that parses but carries no administrative division is not a
  // usable geography: resolving against it would report every coordinate as
  // outside Madrid, which is worse than saying the geography is unavailable.
  const index = geojson.status === "fulfilled" ? geographyModule.createGeographyIndex(geojson.value) : null;
  const hasDivision = Boolean(index && index.counts.barrio && index.counts.district && index.counts.municipality);
  if (hasDivision) {
    geographyIndex = index;
    geographyState = "ready";
  } else {
    geographyState = "unavailable";
    disableBoundaryControl();
    console.warn(
      "administrative geography unavailable",
      geojson.reason || "the artifact carries no administrative division"
    );
  }

  // createPopulationIndex returns null for an unusable artifact, so an absent
  // denominator stays absent: it never becomes an empty index reporting zero.
  populationIndex = profileModule.createPopulationIndex(settledValue(population));
  populationState = populationIndex ? "ready" : "unavailable";
  if (populationState === "unavailable") {
    console.warn("residential population unavailable", population.reason);
  }

  // createVutIndex returns null for an unusable artifact, so a failed request or
  // a malformed commit leaves the licensed-VUT block explicitly unavailable. It
  // never becomes an empty index reporting zero licensed units everywhere,
  // which would be a confident wrong answer rather than a visible absence.
  vutIndex = profileModule.createVutIndex(settledValue(vut));
  vutState = vutIndex ? "ready" : "unavailable";
  if (vutState === "unavailable") {
    console.warn("licensed VUT context unavailable", vut.reason);
  }

  geographyMeta = settledValue(geoMeta);
  populationMeta = settledValue(popMeta);
  vutMeta = settledValue(vutMetaResult);

  if (geographyState === "ready") {
    renderAreaSourceDetails();
    setBoundaryMode(document.getElementById("boundarySelect").value);
  }

  lastAreaRenderKey = null;
  updateAreaContext();
  renderCompare(); // AOI readiness changes only the unequal-radius normalization state.
}

// ------------------------------------------------ Hospitality & Commercial
// One administrative choropleth, one selected metric and one compact context
// card. This surface never receives a Lens coordinate or radius and never
// participates in A/B calculations; only canonical official IDs reach it.
const hospitalityModel = { module: null, i18n: null, index: null };
let hospitalityState = "loading"; // loading | ready | unavailable
let hospitalityVisible = false;
let hospitalityLayer = null;
let hospitalityRenderer = null;
let hospitalityMetric = "core_hospitality_premises_count";
let hospitalitySelectedBarrio = null;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function hospitalityT(key) {
  return hospitalityModel.i18n ? hospitalityModel.i18n.t(key) : key;
}

function hospitalityRecord() {
  if (!hospitalityModel.index) return null;
  if (hospitalitySelectedBarrio) {
    return hospitalityModel.index.barrio.get(hospitalitySelectedBarrio) || null;
  }
  return hospitalityModel.index.municipality.get("28079") || null;
}

function hospitalityPalette(name = activeBasemapName) {
  return {
    light: { stroke: "#4e3761", selected: "#15101a", opacity: 0.34 },
    satellite: { stroke: "#ffffff", selected: "#ffffff", opacity: 0.43 },
    dark: { stroke: "#ead8f5", selected: "#ffffff", opacity: 0.38 },
  }[name] || { stroke: "#4e3761", selected: "#15101a", opacity: 0.34 };
}

function hospitalityFeatureStyle(feature) {
  const module = hospitalityModel.module;
  const row = hospitalityModel.index?.barrio.get(String(feature?.properties?.official_id));
  const value = row?.indicators?.[hospitalityMetric];
  const domain = hospitalityModel.index ? module.metricDomain(hospitalityModel.index, hospitalityMetric) : null;
  const normalized = module?.normalizedMetricValue(value, domain);
  const palette = hospitalityPalette();
  const selected = String(feature?.properties?.official_id) === hospitalitySelectedBarrio;
  return {
    color: selected ? palette.selected : palette.stroke,
    weight: selected ? 2.6 : 0.8,
    opacity: selected ? 1 : 0.72,
    fillColor: normalized == null ? "#8794a2" : `hsl(276 78% ${80 - normalized * 38}%)`,
    fillOpacity: normalized == null ? 0.18 : palette.opacity,
    lineJoin: "round",
    className: selected ? "hospitality-barrio-selected" : "",
  };
}

function hospitalityTooltip(feature) {
  const module = hospitalityModel.module;
  const id = String(feature?.properties?.official_id || "");
  const row = hospitalityModel.index?.barrio.get(id);
  if (!row || !module) return hospitalityT("unavailable");
  const value = module.formatMetricValue(
    hospitalityMetric,
    row.indicators[hospitalityMetric],
    hospitalityModel.i18n.language
  );
  const unit = hospitalityT(module.metricUnitKey(hospitalityMetric));
  return (
    `<b>${escapeHtml(row.official_name)}</b><br>` +
    `${escapeHtml(hospitalityT(hospitalityMetric))}<br>` +
    `<strong>${escapeHtml(value)}</strong> ${escapeHtml(unit)}<br>` +
    `${escapeHtml(hospitalityT("premisesReference"))} · ${escapeHtml(hospitalityT("hoverHint"))}`
  );
}

function rebuildHospitalityLayer() {
  if (hospitalityLayer && map.hasLayer(hospitalityLayer)) map.removeLayer(hospitalityLayer);
  hospitalityLayer = null;
  if (!hospitalityVisible || hospitalityState !== "ready" || !geographyIndex) return;
  if (!hospitalityRenderer) hospitalityRenderer = L.canvas({ pane: "hospitalityPane", padding: 0.3 });
  hospitalityLayer = L.geoJSON(
    { type: "FeatureCollection", features: geographyIndex.featuresByLevel("barrio") },
    {
      pane: "hospitalityPane",
      renderer: hospitalityRenderer,
      style: hospitalityFeatureStyle,
      onEachFeature(feature, layer) {
        layer.bindTooltip(() => hospitalityTooltip(feature), { sticky: true, direction: "top" });
        layer.on({
          mouseover() {
            layer.setStyle({ weight: 2, opacity: 1 });
          },
          mouseout() {
            layer.setStyle(hospitalityFeatureStyle(feature));
          },
          click(event) {
            L.DomEvent.stopPropagation(event);
            hospitalitySelectedBarrio = String(feature.properties.official_id);
            if (event.latlng) {
              lenses[active].marker.setLatLng(event.latlng);
              refresh();
            }
            applyHospitalityStyles();
            renderHospitalityContext();
          },
        });
      },
    }
  ).addTo(map);
}

function applyHospitalityStyles() {
  if (hospitalityLayer) hospitalityLayer.setStyle(hospitalityFeatureStyle);
  renderHospitalityScale();
}

hospitalityStyleController = applyHospitalityStyles;

function renderHospitalityScale() {
  const scale = document.getElementById("hospitalityScale");
  if (!scale || !hospitalityModel.index || !hospitalityModel.module) return;
  const domain = hospitalityModel.module.metricDomain(hospitalityModel.index, hospitalityMetric);
  const language = hospitalityModel.i18n.language;
  scale.dataset.min = hospitalityModel.module.formatMetricValue(hospitalityMetric, domain?.min, language) || "—";
  scale.dataset.max = hospitalityModel.module.formatMetricValue(hospitalityMetric, domain?.max, language) || "—";
  scale.setAttribute(
    "aria-label",
    `${hospitalityT(hospitalityMetric)}: ${scale.dataset.min} – ${scale.dataset.max}`
  );
}

function applyHospitalityCopy() {
  const module = hospitalityModel.module;
  if (!module || !hospitalityModel.i18n) return;
  setText("hospitalityLanguageLabel", hospitalityT("languageLabel"));
  setText("hospitalityLayerName", hospitalityT("layerName"));
  setText("hospitalityMetricLabel", hospitalityT("metricLabel"));
  setText("hospitalityContextHeading", hospitalityT("contextHeading"));
  setText("hospitalityContextScope", hospitalityT("contextScope"));
  setText("hospitalityAreaLabel", hospitalityT("area"));
  setText("hospitalitySelectedMetricLabel", hospitalityT("metricLabel"));
  setText("hospitalityReferenceLabel", hospitalityT("reference"));
  setText("hospitalitySourceLabel", hospitalityT("source"));
  setText("hospitalityPopulationLabel", hospitalityT("population"));
  setText("hospitalitySelectorHint", hospitalityT("selectorHint"));
  setText("hospitalityMethodologyLink", hospitalityT("methodologyLink"));
  const toggle = document.getElementById("hospitalityToggle");
  toggle.setAttribute("aria-label", hospitalityT("layerToggle"));
  const select = document.getElementById("hospitalityMetricSelect");
  for (const option of select.options) option.textContent = hospitalityT(option.value);
  setText("hospitalityMetricSelectValue", hospitalityT(hospitalityMetric));
  rebuildHospitalityLayer();
  renderHospitalityContext();
}

function renderHospitalityContext() {
  const host = document.getElementById("hospitalityContext");
  if (!host) return;
  host.hidden = !hospitalityVisible;
  if (!hospitalityVisible) return;

  const module = hospitalityModel.module;
  const state = document.getElementById("hospitalityState");
  if (hospitalityState !== "ready" || !module || !hospitalityModel.index) {
    setText("hospitalityAreaName", hospitalityT("municipality"));
    setText("hospitalitySelectedMetric", hospitalityT(hospitalityMetric));
    setText("hospitalityValue", "—");
    setText("hospitalityUnit", "");
    setText("hospitalityInterpretation", "");
    setText("hospitalityReference", "");
    setText("hospitalitySource", "");
    state.textContent = hospitalityT("unavailable");
    return;
  }

  const record = hospitalityRecord();
  const value = record?.indicators?.[hospitalityMetric];
  const conditional = hospitalityMetric === module.CONDITIONAL_INDICATOR_ID;
  const conditionalMetadata = hospitalityModel.index.artifact.metadata.conditional_indicator;
  const conditionalReady =
    !conditional ||
    (conditionalMetadata?.premises_period === "Sep 2026" &&
      conditionalMetadata?.population_date === "2026-01-01" &&
      conditionalMetadata?.denominator_type &&
      conditionalMetadata?.interpretation_ceiling);

  setText(
    "hospitalityAreaName",
    hospitalitySelectedBarrio ? record?.official_name : hospitalityT("municipality")
  );
  setText("hospitalitySelectedMetric", hospitalityT(hospitalityMetric));
  setText(
    "hospitalityValue",
    conditionalReady
      ? module.formatMetricValue(hospitalityMetric, value, hospitalityModel.i18n.language)
      : "—"
  );
  setText("hospitalityUnit", conditionalReady ? hospitalityT(module.metricUnitKey(hospitalityMetric)) : "");
  setText("hospitalityReference", hospitalityT("premisesReference"));
  setText("hospitalitySource", hospitalityT("sourceLabel"));
  setText("hospitalityInterpretation", hospitalityT(module.interpretationKey(hospitalityMetric)));
  const populationRow = document.getElementById("hospitalityPopulationRow");
  const dualDate = document.getElementById("hospitalityDualDate");
  populationRow.hidden = !conditional;
  dualDate.hidden = !conditional;
  setText("hospitalityPopulation", conditional ? hospitalityT("populationReference") : "");
  setText("hospitalityDualDate", conditional ? hospitalityT("dualDate") : "");
  state.textContent = conditionalReady
    ? hospitalitySelectedBarrio
      ? ""
      : hospitalityT("municipalityHint")
    : hospitalityT("unavailable");
  document.getElementById("hospitalityClearSelection").hidden = !hospitalitySelectedBarrio;
}

function syncHospitalityUi(on) {
  hospitalityVisible = Boolean(on);
  const toggle = document.getElementById("hospitalityToggle");
  const controls = document.getElementById("hospitalityControls");
  toggle.checked = hospitalityVisible;
  toggle.setAttribute("aria-checked", String(hospitalityVisible));
  controls.hidden = !hospitalityVisible;
  rebuildHospitalityLayer();
  renderHospitalityContext();
}

function setHospitalityVisible(on) {
  syncHospitalityUi(on);
}

async function loadHospitalityContext() {
  try {
    const [module, i18nModule, artifact] = await Promise.all([
      import(moduleUrl("hospitality-context.js")),
      import(moduleUrl("i18n.js")),
      fetchAreaJson("data/hospitality-commercial-context.json"),
    ]);
    hospitalityModel.module = module;
    hospitalityModel.i18n = i18nModule.createI18n(
      module.HOSPITALITY_DICTIONARIES,
      document.getElementById("languageSelect").value
    );
    hospitalityMetric = module.DEFAULT_INDICATOR_ID;
    hospitalityModel.index = module.createHospitalityIndex(artifact);
    hospitalityState = hospitalityModel.index && geographyState === "ready" ? "ready" : "unavailable";

    const select = document.getElementById("hospitalityMetricSelect");
    select.replaceChildren(
      ...module.APPROVED_INDICATOR_IDS.map((id) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = hospitalityT(id);
        option.selected = id === hospitalityMetric;
        return option;
      })
    );
    select.disabled = hospitalityState !== "ready";
    applyHospitalityCopy();
    renderHospitalityScale();
    if (hospitalityState !== "ready") {
      console.warn("hospitality context unavailable: artifact or canonical geography failed validation");
    }
  } catch (error) {
    hospitalityState = "unavailable";
    document.getElementById("hospitalityMetricSelect").disabled = true;
    console.warn("hospitality context unavailable", error);
    renderHospitalityContext();
  }
}

// ---------------------------------------------------------------------------
// DESTINATION CONTEXT
//
// The citywide surface, and the only part of this panel that is NOT about the
// Lens. It renders ONCE, from loadDestinationContext, and is never called from
// refresh(), from updateAreaContext(), or from any lens/marker/radius handler.
// That is the whole mechanism by which dragging a Lens cannot change these
// numbers: there is no code path from a lens event to this renderer, and the
// pure model in js/destination-context.js has no parameter that could carry a
// position even if one were added by mistake.
//
// It also fails ON ITS OWN. Its module, artifact and sidecar are loaded in a
// separate function from the area context, with their own state variable, so a
// Destination Context failure costs the Destination Context block and nothing
// else: the Area Profile, the resident figure, licensed VUT, the Lens metrics
// and HATI all stand.
const destinationModel = { module: null, index: null, meta: null };
let destinationState = "loading"; // loading | ready | unavailable
const originModel = { module: null, index: null, i18n: null, dynamics: null, dynamicsI18n: null };
let originMonth = null;

function renderDestinationContext() {
  const section = document.getElementById("destinationContext");
  const module = destinationModel.module;
  if (!section || !module) return;

  const model = module.buildDestinationContext({
    index: destinationModel.index,
    state:
      destinationState === "ready"
        ? module.DESTINATION_STATE.AVAILABLE
        : destinationState === "loading"
          ? module.DESTINATION_STATE.LOADING
          : module.DESTINATION_STATE.UNAVAILABLE,
  });

  section.hidden = false;
  section.dataset.state = model.state;

  const available = model.state === module.DESTINATION_STATE.AVAILABLE;
  // The card shows the short name and keeps "whole municipality" beside it in
  // the section head; the accessible name carries the qualified form, and the
  // full source geography (the publisher's own term plus the code) is stated in
  // the source disclosure. Nothing is hidden, and the card stays uncluttered.
  const place = document.getElementById("destinationPlace");
  setText("destinationPlace", model.geography.municipalityName);
  if (place) {
    if (available && model.geography.label) place.setAttribute("aria-label", model.geography.label);
    else place.removeAttribute("aria-label");
  }
  setText("destinationScopeHint", available ? "whole municipality" : "");
  setText("destinationPeriod", available ? model.period.label : "—");

  const provisional = document.getElementById("destinationProvisional");
  if (provisional) provisional.hidden = !(available && model.period.provisional);

  const metricsHost = document.getElementById("destinationMetrics");
  if (metricsHost) {
    metricsHost.innerHTML = available
      ? model.metrics.map((metric) => destinationMetricMarkup(module, metric)).join("")
      : "";
  }

  const composition = document.getElementById("destinationComposition");
  if (composition) {
    composition.innerHTML = available ? destinationCompositionMarkup(module, model.composition) : "";
  }

  setText("destinationState", destinationStateLine(module, model, available));
  setText("destinationCeiling", model.hotelCaveat);
  renderDestinationSourceDetails(model);
}

// One metric card: the figure, the exact count under it, the comparison, and a
// sparkline. The comparison sentence comes from the model rather than being
// composed here, so the wording cannot drift from the state that produced it.
function destinationMetricMarkup(module, metric) {
  const value = metric.value === null
    ? `<div class="destination-metric-value abstain">Unavailable</div>`
    : `<div class="destination-metric-value">${metric.display}</div>` +
      `<div class="destination-metric-exact">${metric.exactDisplay} ${metric.unit}</div>`;

  return (
    `<div class="destination-metric" data-metric="${metric.key}">` +
    `<div class="destination-metric-head">${metric.label}</div>` +
    value +
    `<div class="destination-metric-change">${module.comparisonSentence(metric.comparison)}</div>` +
    destinationSparkline(module, metric) +
    `</div>`
  );
}

// A deliberately small inline SVG rather than a charting dependency: this is one
// polyline in a vanilla app. It draws only PUBLISHED points and breaks the line
// where the source published nothing, so the two months the publisher withheld
// in 2020 are a visible gap rather than a straight line asserting demand that
// was never measured. Neutral stroke, no fill, no axis, no colour semantics.
function destinationSparkline(module, metric) {
  const trend = metric.trend;
  if (!trend || trend.points.length < 2) return "";
  const values = trend.points.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (values.length < 2) return "";

  const width = 100;
  const height = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = trend.points.length > 1 ? width / (trend.points.length - 1) : 0;

  // Each contiguous run of published points becomes its own path.
  const runs = [];
  let current = [];
  trend.points.forEach((point, i) => {
    if (!Number.isFinite(point.value)) {
      if (current.length) runs.push(current);
      current = [];
      return;
    }
    const x = i * step;
    const y = height - 2 - ((point.value - min) / span) * (height - 4);
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length) runs.push(current);

  const paths = runs
    .filter((run) => run.length > 1)
    .map((run) => `<polyline class="destination-spark-line" points="${run.join(" ")}"/>`)
    .join("");
  const lastRun = runs[runs.length - 1];
  const lastPoint = lastRun && lastRun.length ? lastRun[lastRun.length - 1].split(",") : null;
  const dot = lastPoint
    ? `<circle class="destination-spark-dot" cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="1.7"/>`
    : "";

  // The graphic is meaningless to a screen reader without this, so the shape is
  // described in words rather than left as decoration.
  const summary = module.trendSummary(trend, metric.label);
  return (
    `<svg class="destination-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" ` +
    `role="img" aria-label="${summary}">${paths}${dot}</svg>`
  );
}

function destinationCompositionMarkup(module, composition) {
  if (!composition || composition.state !== module.COMPARISON_STATE.AVAILABLE) return "";
  // The source's own words. "Residents in Spain" is a place of residence, not a
  // nationality and not a "domestic tourist", and the label never says otherwise.
  return (
    `<div>Travellers by residence · ` +
    `Residents in Spain ${composition.spain.shareDisplay} · ` +
    `Residents abroad ${composition.abroad.shareDisplay}</div>` +
    `<div class="destination-compbar" role="img" aria-label="Of travellers in this month, ` +
    `${composition.spain.shareDisplay} were residents in Spain (${composition.spain.display}) and ` +
    `${composition.abroad.shareDisplay} were residents abroad (${composition.abroad.display}).">` +
    `<i class="spain" style="width:${composition.spain.share}%"></i>` +
    `<i class="abroad" style="width:${composition.abroad.share}%"></i>` +
    `</div>`
  );
}

function destinationStateLine(module, model, available) {
  if (!available) {
    if (destinationState === "loading") return "Reading the hotel-demand series.";
    return "Destination context unavailable in this session.";
  }
  return [model.scopeCaveat, model.provisionalCaveat].filter(Boolean).join(" ");
}

function renderDestinationSourceDetails(model) {
  const host = document.getElementById("destinationSourceDetails");
  const toggle = document.getElementById("destinationSourceToggle");
  const module = destinationModel.module;
  if (!host || !toggle || !module) return;

  const lines = destinationModel.meta
    ? module.buildDestinationProvenanceLines({ meta: destinationModel.meta, model })
    : [];
  host.innerHTML = lines.map((line) => `<span>${line}</span>`).join("");
  toggle.hidden = lines.length === 0;
}

async function loadDestinationContext() {
  let module;
  try {
    module = await import(moduleUrl("destination-context.js"));
  } catch (error) {
    destinationState = "unavailable";
    console.warn("destination context module unavailable", error);
    return;
  }
  destinationModel.module = module;
  renderDestinationContext();

  const [series, meta] = await Promise.allSettled([
    fetchAreaJson("data/destination/madrid_hotel_demand.json"),
    fetchAreaJson("data/destination/madrid_hotel_demand.meta.json"),
  ]);

  // createDestinationIndex returns null for an unusable artifact, so a failed
  // request or a malformed commit leaves the block explicitly unavailable. It
  // never becomes an empty index reporting zero travellers, which would be a
  // confident wrong answer rather than a visible absence.
  destinationModel.index = module.createDestinationIndex(settledValue(series));
  destinationState = destinationModel.index ? "ready" : "unavailable";
  if (destinationState === "unavailable") {
    console.warn("destination context unavailable", series.reason);
  }
  destinationModel.meta = settledValue(meta);
  renderDestinationContext();
}

// Domestic origins are a sibling statistical operation inside Destination
// Context. This loader is deliberately separate from Lens and area context;
// changing a position, radius, barrio or compare mode cannot call it.
function originT(key) { return originModel.i18n?.t(key) || key; }
function dynamicsT(key, values = {}) { return (originModel.dynamicsI18n?.t(key) || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? ""); }
function dynamicsCount(value) { return Number.isInteger(value) ? value.toLocaleString(document.documentElement.lang || "en-GB") : "—"; }
function dynamicsIdentity(row) { return `${escapeHtml(row.origin_municipality_name)} <span class="muted">${row.origin_municipality_code}</span>`; }
function dynamicsChange(row) {
  if (!Number.isFinite(row.absoluteChange) || !Number.isFinite(row.percentChange)) return "—";
  const count = `${row.absoluteChange > 0 ? "+" : ""}${dynamicsCount(row.absoluteChange)}`;
  const percent = `${row.percentChange > 0 ? "+" : ""}${row.percentChange.toFixed(1)}%`;
  return `${count} · ${percent}`;
}
function dynamicsStateLine(module, model) {
  if (model.state === module.DYNAMICS_STATE.UNAVAILABLE) return dynamicsT("unavailable");
  if (model.state === module.DYNAMICS_STATE.MONTH_UNAVAILABLE) return dynamicsT("monthUnavailable");
  if (model.state === module.DYNAMICS_STATE.NO_ADJACENT_PRIOR_MONTH) return dynamicsT("noPrior");
  if (model.state === module.DYNAMICS_STATE.CURRENT_MONTH_EMPTY) return dynamicsT("emptyCurrent");
  if (model.state === module.DYNAMICS_STATE.NO_SHARED_ORIGINS) return dynamicsT("noShared");
  return "";
}
function renderDomesticOriginDynamics() {
  const module = originModel.dynamics;
  if (!module || !originModel.dynamicsI18n) return;
  const model = module.compareDomesticOriginMonths(originModel.index, originMonth);
  const ready = Boolean(model.summary);
  setText("domesticOriginDynamicsHeading", dynamicsT("heading"));
  setText("domesticOriginDynamicsRelationship", model.currentMonth && model.previousMonth ? dynamicsT("relationship", { current: model.currentMonth, previous: model.previousMonth }) : "");
  const summary = document.getElementById("domesticOriginDynamicsSummary");
  if (summary) summary.innerHTML = ready ? [
    ["currentPublished", model.summary.currentPublishedOrigins], ["previousPublished", model.summary.previousPublishedOrigins], ["shared", model.summary.sharedOrigins], ["newlyPresent", model.summary.newlyPresentOrigins], ["noLongerPresent", model.summary.noLongerPresentOrigins],
  ].map(([label, value]) => `<div><span>${dynamicsT(label)}</span><b>${dynamicsCount(value)}</b></div>`).join("") : "";
  setText("domesticOriginDynamicsSharedHeading", dynamicsT("sharedHeading"));
  setText("domesticOriginDynamicsOrigin", dynamicsT("origin")); setText("domesticOriginDynamicsPrevious", dynamicsT("previous")); setText("domesticOriginDynamicsCurrent", dynamicsT("current")); setText("domesticOriginDynamicsChange", dynamicsT("observedChange"));
  const sharedRows = document.getElementById("domesticOriginDynamicsSharedRows");
  if (sharedRows) sharedRows.innerHTML = model.shared.map((row) => `<tr><td>${dynamicsIdentity(row)}</td><td>${dynamicsCount(row.previousCount)}</td><td>${dynamicsCount(row.currentCount)}</td><td>${dynamicsChange(row)}</td></tr>`).join("");
  const shared = document.getElementById("domesticOriginDynamicsShared"); if (shared) shared.hidden = !ready || model.shared.length === 0;
  setText("domesticOriginDynamicsNewlyPresent", `${dynamicsT("newlyPresent")} (${dynamicsCount(model.newlyPresent.length)})`);
  setText("domesticOriginDynamicsNoLongerPresent", `${dynamicsT("noLongerPresent")} (${dynamicsCount(model.noLongerPresent.length)})`);
  setText("domesticOriginDynamicsNewlyOrigin", dynamicsT("origin")); setText("domesticOriginDynamicsNoLongerOrigin", dynamicsT("origin")); setText("domesticOriginDynamicsCurrentPublished", dynamicsT("currentPublishedCount")); setText("domesticOriginDynamicsPreviousPublished", dynamicsT("previousPublishedCount"));
  const newlyRows = document.getElementById("domesticOriginDynamicsNewlyRows"); if (newlyRows) newlyRows.innerHTML = model.newlyPresent.map((row) => `<tr><td>${dynamicsIdentity(row)}</td><td>${dynamicsCount(row.currentCount)}</td></tr>`).join("");
  const noLongerRows = document.getElementById("domesticOriginDynamicsNoLongerRows"); if (noLongerRows) noLongerRows.innerHTML = model.noLongerPresent.map((row) => `<tr><td>${dynamicsIdentity(row)}</td><td>${dynamicsCount(row.previousCount)}</td></tr>`).join("");
  const transitions = document.getElementById("domesticOriginDynamicsTransitions"); if (transitions) transitions.hidden = !ready;
  setText("domesticOriginDynamicsState", dynamicsStateLine(module, model)); setText("domesticOriginDynamicsDisclosure", dynamicsT("disclosure"));
}
function renderDomesticOrigins() {
  const host = document.getElementById("domesticOrigins");
  if (!host || !originModel.module || !originModel.i18n) return;
  const module = originModel.module;
  const model = module.buildDomesticOriginContext({ index: originModel.index, month: originMonth });
  host.hidden = false;
  setText("domesticOriginsHeading", originT("heading")); setText("domesticOriginsOfficial", originT("official"));
  setText("domesticOriginsMonthLabel", originT("month")); setText("domesticOriginsScope", originT("municipality")); setText("domesticOriginsUniverse", originT("universe"));
  setText("domesticOriginsOrigin", originT("origin")); setText("domesticOriginsTourists", originT("tourists"));
  const select = document.getElementById("domesticOriginsMonth");
  if (select) { select.innerHTML = (model.availableMonths || []).slice().reverse().map((month) => `<option value="${month}">${month}</option>`).join(""); select.value = model.month || ""; select.disabled = model.state === module.ORIGIN_STATE.UNAVAILABLE; }
  const rows = document.getElementById("domesticOriginsRows");
  if (rows) rows.innerHTML = model.origins.map((row) => `<tr><td>${escapeHtml(row.origin_municipality_name)} <span class="muted">${row.origin_municipality_code}</span></td><td>${row.countDisplay}</td></tr>`).join("");
  setText("domesticOriginsState", model.state === module.ORIGIN_STATE.UNAVAILABLE ? originT("unavailable") : model.state === module.ORIGIN_STATE.MONTH_UNAVAILABLE ? originT("periodUnavailable") : module.ORIGIN_SCOPE_CAVEAT);
  setText("domesticOriginsCaveat", originT("caveat"));
  renderDomesticOriginDynamics();
}
async function loadDomesticOrigins() {
  try {
    const [module, dynamicsModule, i18nModule, artifact] = await Promise.all([import(moduleUrl("domestic-origin-context.js")), import(moduleUrl("domestic-origin-dynamics.js")), import(moduleUrl("i18n.js")), fetchAreaJson("data/destination/madrid_domestic_origins.json")]);
    originModel.module = module; originModel.dynamics = dynamicsModule; originModel.i18n = i18nModule.createI18n(module.ORIGIN_DICTIONARIES, document.getElementById("languageSelect").value); originModel.dynamicsI18n = i18nModule.createI18n(dynamicsModule.DYNAMICS_DICTIONARIES, document.getElementById("languageSelect").value); originModel.index = module.createDomesticOriginIndex(artifact); originMonth = originModel.index?.latest || null; renderDomesticOrigins();
  } catch (error) { console.warn("domestic origin context unavailable", error); if (originModel.module) renderDomesticOrigins(); }
}

function shadeMarkersOutsideActiveLens() {
  const center = centerOf(active);
  Object.values(groups).forEach((g) =>
    g.eachLayer((m) => {
      if (!m._p) return;
      const d = haversineMeters(center, m._p);
      const inside = d <= radiusFor(active);

      if (m._cluster && typeof m.setOpacity === "function") {
        m.setOpacity(inside ? 1 : 0.38);
        return;
      }

      if (typeof m.setStyle !== "function") return;
      const base = m._p.type === "bike" ? 0.72 : 0.86;
      m.setStyle({ opacity: inside ? 1 : 0.2, fillOpacity: inside ? base : 0.1, weight: inside ? 1.25 : 0.7 });
    })
  );
}

// Renders one of the count metrics (tourism POIs, stays, mobility), honoring
// the "unavailable" and "snapshot" states so a partial or missing layer is
// never presented as if it were a complete, verified count.
function renderCountMetric({ valueId, footId, value, status, liveFoot, publishedFoot, snapshotFoot, unavailableFoot }) {
  const v = document.getElementById(valueId);
  const f = document.getElementById(footId);
  if (status === "unavailable") {
    v.textContent = "No data";
    v.className = "metric-value abstain";
    f.textContent = unavailableFoot;
  } else {
    v.textContent = value;
    v.className = "metric-value";
    f.textContent =
      status === "snapshot" ? snapshotFoot : status === "published" ? publishedFoot : liveFoot;
  }
}

function refresh() {
  for (const which of ["A", "B"]) lenses[which].circle.setRadius(radiusFor(which)).setLatLng(lenses[which].marker.getLatLng());
  const s = statsFor(active);
  renderCountMetric({
    valueId: "tourismValue",
    footId: "tourismFoot",
    value: s.tourism,
    status: combinedStatus(layerStatus, ["museums", "info"]),
    liveFoot: "within lens",
    publishedFoot: "deployment snapshot",
    snapshotFoot: "sample count, not exhaustive",
    unavailableFoot: "source unavailable",
  });
  renderCountMetric({
    valueId: "stayValue",
    footId: "stayFoot",
    value: s.stay,
    status: combinedStatus(layerStatus, ["stays"]),
    liveFoot: `${stayFilterLabel()} · within lens`,
    publishedFoot: `${stayFilterLabel()} · deployment snapshot`,
    snapshotFoot: `${stayFilterLabel()} · sample, not exhaustive`,
    unavailableFoot: "source unavailable",
  });
  renderCountMetric({
    valueId: "mobilityValue",
    footId: "mobilityFoot",
    value: s.mobility,
    status: combinedStatus(layerStatus, ["bikes", "rail"]),
    liveFoot: "BiciMAD + rail stations in lens",
    publishedFoot: "BiciMAD + CRTM deployment snapshot",
    snapshotFoot: "partial mobility sample, not exhaustive",
    unavailableFoot: "some mobility sources unavailable",
  });
  renderHeatMetric(heatStatsFor(active));
  renderPedestrianMetric(pedestrianStatsFor(active));
  renderMix(s);
  renderNearest(s);
  renderCompare();
  updateAreaContext();
  shadeMarkersOutsideActiveLens();
}

function activateLens(which) {
  active = which;
  radiusSlider.value = radiusFor(which);
  renderRadiusLabels();
  applyLensBasemapStyle(activeBasemapName);
  document.getElementById("lensAButton").className = "lensbtn a" + (which === "A" ? " active" : "");
  document.getElementById("lensBButton").className = "lensbtn b" + (which === "B" ? " active" : "");
  document.getElementById("lensBButton").textContent = bEnabled
    ? which === "B"
      ? "Lens B · active"
      : "Lens B"
    : "+ Enable Lens B";
  document.getElementById("lensAButton").textContent = which === "A" ? "Lens A · active" : "Lens A";
  refresh();
}

function enableLensB() {
  if (!bEnabled) {
    if (!lensBHasBeenInitialized) { initializeLensBRadius(radii); lensBHasBeenInitialized = true; }
    lenses.B.circle.setRadius(radiusFor("B"));
    bEnabled = true;
    lenses.B.marker.addTo(map);
    lenses.B.circle.addTo(map);
    document.getElementById("compareLine").classList.add("show");
    document.getElementById("navCompare").classList.add("active");
    activateLens("B");
  } else {
    activateLens("B");
  }
}

function disableLensB() {
  if (bEnabled) {
    map.removeLayer(lenses.B.marker);
    map.removeLayer(lenses.B.circle);
    bEnabled = false;
    document.getElementById("compareLine").classList.remove("show");
    document.getElementById("navCompare").classList.remove("active");
    activateLens("A");
    document.getElementById("lensBButton").textContent = "+ Enable Lens B";
  }
}

lenses.A.marker.on("drag", () => (active !== "A" ? activateLens("A") : refresh()));
lenses.B.marker.on("drag", () => (active !== "B" ? activateLens("B") : refresh()));
map.on("click", (e) => {
  lenses[active].marker.setLatLng(e.latlng);
  refresh();
});
map.on("zoomend", rebuildDenseLayers);

document.getElementById("lensAButton").onclick = () => activateLens("A");
document.getElementById("lensBButton").onclick = () => (bEnabled ? activateLens("B") : enableLensB());
document.getElementById("navCompare").onclick = () => (bEnabled ? disableLensB() : enableLensB());
document.getElementById("navEvidence").onclick = () => {
  setLayerVisible("heat", true);
  const bounds = hatiStudyArea?.bounds
    ? [
        [hatiStudyArea.bounds.lat_min, hatiStudyArea.bounds.lon_min],
        [hatiStudyArea.bounds.lat_max, hatiStudyArea.bounds.lon_max],
      ]
    : [
        [40.404, -3.696],
        [40.421, -3.6775],
      ];
  map.fitBounds(bounds, { padding: [60, 60] });
  activateLens("A");
  lenses.A.marker.setLatLng([40.4149, -3.687]);
  refresh();
};
function renderRadiusLabels() {
  const text = formatLensRadius(radiusFor(active));
  document.getElementById("radiusText").textContent = text;
  const lensName = `Lens ${active}`;
  document.getElementById("radiusControlLabel").textContent = `${lensName} radius`;
  radiusSlider.setAttribute("aria-label", `${lensName} radius`);
  // The lens section states its own geometry, so "within the lens" can never be
  // read as the administrative area above it.
  document.getElementById("lensScopeHint").textContent = `${text} circle`;
}
const radiusSlider = document.getElementById("radiusSlider");
radiusSlider.min = LENS_RADIUS.minM;
radiusSlider.max = LENS_RADIUS.maxM;
radiusSlider.step = LENS_RADIUS.stepM;
radiusSlider.value = radiusFor(active);
radiusSlider.setAttribute("aria-label", "Lens A radius");
renderRadiusLabels();

radiusSlider.oninput = (e) => {
  setLensRadius(active, e.target.value);
  e.target.value = radiusFor(active);
  renderRadiusLabels();
  refresh();
};
document.getElementById("basemapSelect").onchange = (e) => setBasemap(e.target.value);
document.getElementById("boundarySelect").onchange = (e) => setBoundaryMode(e.target.value);
document.getElementById("languageSelect").onchange = (event) => {
  hospitalityModel.i18n?.setLanguage(event.target.value);
  applyHospitalityCopy();
  originModel.i18n?.setLanguage(event.target.value);
  originModel.dynamicsI18n?.setLanguage(event.target.value);
  renderDomesticOrigins();
};
document.getElementById("domesticOriginsMonth").onchange = (event) => { originMonth = event.target.value; renderDomesticOrigins(); };
document.getElementById("hospitalityMetricSelect").onchange = (event) => {
  if (!hospitalityModel.module?.APPROVED_INDICATOR_IDS.includes(event.target.value)) return;
  hospitalityMetric = event.target.value;
  hospitalitySelectedBarrio = hospitalitySelectedBarrio || null;
  setText("hospitalityMetricSelectValue", hospitalityT(hospitalityMetric));
  applyHospitalityStyles();
  renderHospitalityContext();
};
document.getElementById("hospitalityClearSelection").onclick = () => {
  hospitalitySelectedBarrio = null;
  applyHospitalityStyles();
  renderHospitalityContext();
};
const areaSourceToggle = document.getElementById("areaSourceToggle");
areaSourceToggle.onclick = () => {
  const details = document.getElementById("areaSourceDetails");
  const open = details.hidden;
  details.hidden = !open;
  areaSourceToggle.setAttribute("aria-expanded", String(open));
};
const destinationSourceToggle = document.getElementById("destinationSourceToggle");
destinationSourceToggle.onclick = () => {
  const details = document.getElementById("destinationSourceDetails");
  const open = details.hidden;
  details.hidden = !open;
  destinationSourceToggle.setAttribute("aria-expanded", String(open));
};
document.getElementById("stayKindFilter").onchange = (e) => {
  stayKindFilter = e.target.value;
  rebuildDenseLayer("stay");
  refresh();
};
document.getElementById("timeSelect").onchange = (e) => {
  timestep = e.target.value;
  rebuildHeatLayer();
};
document.getElementById("resetButton").onclick = () => {
  lenses[active].marker.setLatLng(defaults[active]);
  map.panTo(defaults[active]);
  refresh();
};
document.querySelectorAll("[data-layer]").forEach((x) => (x.onchange = () => setLayerVisible(x.dataset.layer, x.checked)));
syncHatiUi(false);
syncPedestrianUi(false);
syncHospitalityUi(false);

const PANEL_SIZE_STORAGE_KEY = "madrid-tourism-intelligence-lens:analysis-panel-size:v1";
const analysisPanel = document.querySelector(".panel");
const panelResizeHandle = document.getElementById("panelResizeHandle");

function panelResizeLimits() {
  const compact = window.innerWidth <= 1100;
  const minWidth = compact ? 340 : 390;
  const reservedLeft = compact ? 250 : 276;
  const maxWidth = Math.max(minWidth, Math.min(680, window.innerWidth - reservedLeft));
  const minHeight = 360;
  const top = analysisPanel.getBoundingClientRect().top;
  const maxHeight = Math.max(minHeight, window.innerHeight - top - 18);
  return { minWidth, maxWidth, minHeight, maxHeight };
}

function clampPanelSize(width, height) {
  const limits = panelResizeLimits();
  return {
    width: Math.min(limits.maxWidth, Math.max(limits.minWidth, width)),
    height: Math.min(limits.maxHeight, Math.max(limits.minHeight, height)),
  };
}

function applyPanelSize(width, height, persist = false) {
  if (window.innerWidth <= 850) {
    analysisPanel.style.removeProperty("width");
    analysisPanel.style.removeProperty("height");
    return;
  }
  const next = clampPanelSize(width, height);
  analysisPanel.style.width = `${Math.round(next.width)}px`;
  analysisPanel.style.height = `${Math.round(next.height)}px`;
  if (persist) {
    try {
      localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify(next));
    } catch (_) {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }
}

function restorePanelSize() {
  if (window.innerWidth <= 850) return;
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_SIZE_STORAGE_KEY) || "null");
    if (Number.isFinite(saved?.width) && Number.isFinite(saved?.height)) {
      applyPanelSize(saved.width, saved.height, false);
    }
  } catch (_) {
    // Keep the CSS default size when stored state is unavailable or invalid.
  }
}

function resetPanelSize() {
  analysisPanel.style.removeProperty("width");
  analysisPanel.style.removeProperty("height");
  try {
    localStorage.removeItem(PANEL_SIZE_STORAGE_KEY);
  } catch (_) {
    // The CSS default remains the reset state even without storage access.
  }
}

let panelResizeState = null;
panelResizeHandle.addEventListener("pointerdown", (event) => {
  if (window.innerWidth <= 850) return;
  event.preventDefault();
  const rect = analysisPanel.getBoundingClientRect();
  panelResizeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    width: rect.width,
    height: rect.height,
  };
  panelResizeHandle.setPointerCapture(event.pointerId);
  analysisPanel.classList.add("panel-resizing");
});

panelResizeHandle.addEventListener("pointermove", (event) => {
  if (!panelResizeState || event.pointerId !== panelResizeState.pointerId) return;
  const width = panelResizeState.width + (panelResizeState.startX - event.clientX);
  const height = panelResizeState.height + (event.clientY - panelResizeState.startY);
  applyPanelSize(width, height, false);
});

function finishPanelResize(event) {
  if (!panelResizeState || event.pointerId !== panelResizeState.pointerId) return;
  const rect = analysisPanel.getBoundingClientRect();
  panelResizeState = null;
  analysisPanel.classList.remove("panel-resizing");
  applyPanelSize(rect.width, rect.height, true);
}

panelResizeHandle.addEventListener("pointerup", finishPanelResize);
panelResizeHandle.addEventListener("pointercancel", finishPanelResize);
panelResizeHandle.addEventListener("dblclick", resetPanelSize);
panelResizeHandle.addEventListener("keydown", (event) => {
  if (window.innerWidth <= 850) return;
  const step = event.shiftKey ? 48 : 24;
  const rect = analysisPanel.getBoundingClientRect();
  let width = rect.width;
  let height = rect.height;
  if (event.key === "ArrowLeft") width += step;
  else if (event.key === "ArrowRight") width -= step;
  else if (event.key === "ArrowDown") height += step;
  else if (event.key === "ArrowUp") height -= step;
  else if (event.key === "Home") {
    resetPanelSize();
    return;
  } else {
    return;
  }
  event.preventDefault();
  applyPanelSize(width, height, true);
});

window.addEventListener("resize", () => {
  if (window.innerWidth <= 850) {
    analysisPanel.style.removeProperty("width");
    analysisPanel.style.removeProperty("height");
    return;
  }
  const rect = analysisPanel.getBoundingClientRect();
  applyPanelSize(rect.width, rect.height, false);
});
restorePanelSize();

async function boot() {
  const [snapshotPOI, runtimePOI, hatiAssetsData, hatiProvenance, pedestrianData] = await Promise.all([
    fetch("data/snapshot_poi.json").then((r) => r.json()),
    fetch("data/runtime_poi.json?v=20260928-18")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})),
    fetch("data/hati_assets.json").then((r) => r.json()),
    fetch("data/hati_provenance.json?v=20260928-11").then((r) => r.json()),
    fetch("data/pedestrian_activity.json?v=20260928-21", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { available: false, stations: [] }))
      .catch(() => ({ available: false, stations: [] })),
  ]);
  hatiAssets = hatiAssetsData;
  hatiStudyArea = hatiProvenance.study_area || null;
  drawHatiStudyArea();
  hatiAssets.forEach((a) => addMarker(hatiPointFor(a, timestep)));

  const { points, layerStatus: status } = await loadAllLayers(snapshotPOI, runtimePOI);
  poiPoints = points;
  layerStatus = status;

  pedestrianMeta = pedestrianData || {};
  pedestrianStations = Array.isArray(pedestrianData?.stations)
    ? pedestrianData.stations.map((p) => ({ ...p, type: "pedestrian", provenance: "published" }))
    : [];
  pedestrianStatus = pedestrianData?.available && pedestrianStations.length ? "published" : "unavailable";
  renderPedestrianActivity();

  const pedestrianToggle = document.querySelector('[data-layer="pedestrian"]');
  if (pedestrianToggle) {
    pedestrianToggle.disabled = pedestrianStatus === "unavailable";
    pedestrianToggle.title =
      pedestrianStatus === "unavailable"
        ? "Observed pedestrian activity unavailable in this deployment"
        : "Show Madrid permanent pedestrian counters and lens activity evidence";
  }

  parkPoints = (runtimePOI?.layers?.park || []).map((p) => ({
    ...p,
    type: "park",
    provenance: "published",
  }));
  parkStatus = parkPoints.length ? "published" : "unavailable";
  renderParkContext();

  const parkToggle = document.querySelector('[data-layer="park"]');
  if (parkToggle) {
    parkToggle.disabled = parkStatus === "unavailable";
    parkToggle.title =
      parkStatus === "unavailable"
        ? "Principal parks context unavailable in this deployment"
        : "Show principal municipal parks and gardens as context";
  }

  const stayFilter = document.getElementById("stayKindFilter");
  const stayKinds = new Map();
  points
    .filter((p) => p.type === "stay" && p.stayKind)
    .forEach((p) => stayKinds.set(p.stayKind, (stayKinds.get(p.stayKind) || 0) + 1));
  stayFilter.querySelectorAll("option[data-kind]").forEach((option) => {
    const count = stayKinds.get(option.dataset.kind) || 0;
    option.disabled = count === 0;
    option.textContent = `${option.dataset.label} · ${count}`;
  });
  stayFilter.disabled = stayKinds.size === 0;
  stayFilter.title = stayKinds.size
    ? "Filter the official accommodation layer by Madrid Destino category"
    : "Accommodation type metadata unavailable in the current fallback";

  renderPoiLayers();

  const allLive = Object.values(status).every((s) => s === "live");
  const anyUnavailable = Object.values(status).some((s) => s === "unavailable");
  const anyPublished = Object.values(status).some((s) => s === "published");
  const anySample = Object.values(status).some((s) => s === "snapshot");
  const badge = document.getElementById("liveBadge");
  badge.className = allLive ? "live" : "live mixed";
  badge.querySelector("span").textContent = allLive
    ? `${points.length} live records + HATI evidence`
    : `${points.length} records · ${[
        anyPublished ? "deployment snapshot" : "",
        anySample ? "partial fallback" : "",
        anyUnavailable ? "some unavailable" : "",
      ]
        .filter(Boolean)
        .join(" · ")} (see layer panel)`;
  renderLayerSourceNote();
  refresh();

  // Administrative context loads after the operational layers are on screen:
  // the canonical geography is ~2.5 MB and must never delay the first paint of
  // the map. It is parsed and indexed exactly once, then reused.
  loadAreaContext().finally(loadHospitalityContext);
  // Started separately and never awaited together with the area context: the two
  // surfaces describe different things, from different publishers, and must fail
  // independently of each other.
  loadDestinationContext();
  loadDomesticOrigins();
}

boot();
