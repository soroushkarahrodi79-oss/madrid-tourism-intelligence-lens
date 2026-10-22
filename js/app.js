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
  licence: "#c0794f",
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
const AREA_ASSET_VERSION = "20261015-1";
const moduleUrl = (name) => new URL(`${name}?v=${AREA_ASSET_VERSION}`, MODULE_BASE).href;

// K11 (#73): the evidence-snapshot identity carried in a shared link, so a reader
// is warned when the committed artifacts behind the workspace have moved since the
// link was made. The full restore runs later, in stages (see the K11 block at the
// end of this file); this only reads the language up front so the i18n layer
// initialises in the right language with no restore flash.
const K11_SNAPSHOT_ID = AREA_ASSET_VERSION;
// Capture the ORIGINAL shared query ONCE, before any replaceState commit can
// rewrite the address bar to the canonical form. Every restore phase parses this
// frozen string, never the live window.location.search — otherwise phase 1's own
// commit (and the boot loads after it) would erase the ámbito/baseline dimensions
// before phase 2 reads them.
const K11_ORIGINAL_SEARCH = (() => { try { return window.location.search; } catch (error) { return ""; } })();
// Discover can hand a visitor to the workspace with a language-only URL.
// This is NOT a versioned shared reading: do not try to restore evidence
// dimensions, and never let a plain lang= parameter override K11's v= state.
// Set both the document and its control before shell/i18n initialization so
// the first rendered interface uses the intended language without a flash.
if (!/[?&]v=/.test(K11_ORIGINAL_SEARCH)) {
  try {
    const entryLanguage = new URLSearchParams(K11_ORIGINAL_SEARCH).get("lang");
    if (entryLanguage === "es" || entryLanguage === "en") {
      document.documentElement.lang = entryLanguage;
      document.getElementById("languageSelect").value = entryLanguage;
    }
  } catch (error) {
    // Malformed language-only navigation keeps the default document language.
  }
}
// K11 (#73) runtime state — declared HERE, before the map and the renderers, so
// the per-surface export captures in those renderers can write to it during the
// very first render without a temporal-dead-zone error. Its user functions live
// in the K11 block at the end of the file (hoisted function declarations).
const k11 = { suppress: false, scheduled: false, refused: false, restored: false };
let k11InitialRestore = null;
try {
  if (typeof parseEvidenceState === "function" && /[?&]v=/.test(K11_ORIGINAL_SEARCH)) {
    k11InitialRestore = parseEvidenceState(K11_ORIGINAL_SEARCH, { snapshotId: K11_SNAPSHOT_ID });
    const initialLanguage = k11InitialRestore && k11InitialRestore.state && k11InitialRestore.state.language;
    if (initialLanguage) document.documentElement.setAttribute("lang", initialLanguage);
  }
} catch (error) {
  k11InitialRestore = null;
}

const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([40.415, -3.692], 14);
// Keep the legally required OSM/tile-provider credits visible; remove only
// Leaflet’s optional promotional prefix so attribution fits narrow screens.
map.attributionControl.setPrefix(false);

// Administrative reference geometry sits UNDER the POI markers: it is context
// for reading the map, never a data layer competing with the evidence on it.
map.createPane("adminPane");
map.getPane("adminPane").style.zIndex = "350";
map.getPane("adminPane").style.pointerEvents = "none";

// The thematic administrative fill sits above reference outlines but below the
// active-area and Lens panes. It is the only interactive polygon surface.
map.createPane("hospitalityPane");
map.getPane("hospitalityPane").style.zIndex = "365";

// The containing planning ámbito (K6, #68) has its own pane above the
// administrative reference lattice and below the thematic administrative fill,
// so the ámbito and the barrio stay visibly different geometries. Its hue is the
// reserved neutral planning family — never a Lens identity colour — and it never
// encodes a phase, an order or a judgement.
map.createPane("planningPane");
map.getPane("planningPane").style.zIndex = "360";
map.getPane("planningPane").style.pointerEvents = "none";
const PLANNING_STROKE = "#aeb8c4"; // --planning-neutral

// An explicitly selected explorer geometry is visually distinct from the
// dashed containing ámbito and the Lens circle. Only one polygon is drawn.
map.createPane("planningExplorerPane");
map.getPane("planningExplorerPane").style.zIndex = "457";
map.getPane("planningExplorerPane").style.pointerEvents = "none";

// Granted urban licences (K9, #71) render on their own canvas pane, above the
// administrative fill and below the active-area and Lens panes, so the licence
// points stay visibly separate from the Lens A/B identities and the ámbito
// polygon. Their hue is a reserved administrative neutral — never a Lens colour
// and never a phase/order/judgement encoding. The pane keeps pointer events so a
// point can be clicked for its granted-only popup.
map.createPane("licencePane");
// Above the default overlay pane (z 400, where the preferCanvas POI markers
// render) so the licence points receive clicks for their granted-only popup —
// a lower pane's canvas would sit under the POI canvas, which would swallow the
// click. Still below the active-area, Lens and halo panes.
map.getPane("licencePane").style.zIndex = "410";
const LICENCE_STROKE = "#c0794f"; // --licence-neutral
// The licence points are 3.5px canvas circles; their geometric clickable area
// (radius + weight/2 ≈ 4px) is far below any usable target, so a reader has to
// pixel-hunt to open a record's granted-only popup and usually hits empty map,
// which moves the Lens instead. Leaflet's _clickTolerance adds the renderer's
// `tolerance` on top of the geometry, so this extends the clickable area to
// ≈10px radius (≈20px diameter) WITHOUT enlarging the drawn point or changing
// identity/provenance. A direct or near hit opens the popup (Leaflet stops that
// click); a click beyond the tolerance still falls through to the map and moves
// the active Lens, so background click-to-move is preserved.
//
// But the help is GATED BY ZOOM. At city-overview zoom the ~11k points are a
// dense cloud (measured: in the densest central area even the bare 4px target
// already captures the majority of clicks), so a wide tolerance there would
// swallow the clicks used to pan/reposition the Lens and could open a
// neighbouring record instead of the one aimed at. Individual inspection only
// happens zoomed in, where points are sparse. So the tolerance applies at the
// default zoom and closer, and drops to 0 when zoomed further out — restoring
// baseline navigation at overview while keeping selection easy where it is used.
const LICENCE_CLICK_TOLERANCE = 6;
const LICENCE_TOLERANCE_MIN_ZOOM = 14; // the map's initial zoom; closer keeps the tolerance, further out drops it to 0
const licenceToleranceForZoom = (zoom) => (zoom >= LICENCE_TOLERANCE_MIN_ZOOM ? LICENCE_CLICK_TOLERANCE : 0);

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

// [K12-R1 TEST-ONLY — issue #97] Bounded Leaflet pan optimizations, gated to a
// loopback/private-LAN host AND an explicit ?k12opt= flag, so they are ABSENT in
// normal use and on the public deployment. Each flag is A/B-measured on Intel UHD
// 620 by research/ac_p0_12/auto_compare.mjs BEFORE any becomes a production default.
// It changes no scientific geometry, data visibility, accessibility or evidence
// semantics — only tile fetch/placement timing and tile pixel resolution.
const k12PanOpts = (() => {
  try {
    if (!isLoopbackOrPrivateLanHost(window.location.hostname)) return new Set();
    const q = new URLSearchParams(window.location.search).get("k12opt") || "";
    return new Set(q.split(",").map((s) => s.trim()).filter(Boolean));
  } catch (e) { return new Set(); }
})();
// `idle`: defer raster tile fetch/placement until the pan/zoom settles (Leaflet
// updateWhenIdle/updateWhenZooming) — fewer mid-pan tile DOM ops, no visual loss
// once settled.
function k12TileOptions(opts) {
  const o = { ...opts };
  if (k12PanOpts.has("idle")) { o.updateWhenIdle = true; o.updateWhenZooming = false; }
  return o;
}
// `noretina`: request 1× instead of 2× CARTO tiles at HiDPI — ~¼ the basemap pixels
// to composite (explicit visual-quality trade-off; only affects keyed CARTO tiles).
function k12CartoRetina() { return k12PanOpts.has("noretina") ? "" : "{r}"; }

function createOsmBasemap() {
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", k12TileOptions({
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }));
}

function createCartoBasemap(style) {
  if (!cartoBasemapKey) return createOsmBasemap();
  const url =
    `https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}${k12CartoRetina()}.png` +
    `?key=${encodeURIComponent(cartoBasemapKey)}`;
  return L.tileLayer(url, k12TileOptions({
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }));
}

function createSatelliteBasemap() {
  const imagery = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    k12TileOptions({
      maxZoom: 19,
      zIndex: 200,
      attribution:
        'Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    })
  );

  const transportation = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
    k12TileOptions({
      maxZoom: 19,
      zIndex: 300,
    })
  );

  const labels = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    k12TileOptions({
      maxZoom: 19,
      zIndex: 310,
    })
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
  // Granted urban licences are opt-in and administratively separate: off the map
  // until requested, never counted into the POI metrics.
  licences: L.layerGroup(),
};

// [K12-R1 TEST-ONLY — issue #97 / review 5571780753] `thin`: while the user is
// actively DRAGGING the map (not zoom, not a programmatic camera move, not a marker
// drag), hide only the POI CLUSTER ICONS so the ~195 DOM cluster markers are not
// re-laid-out/painted during the gesture, then restore them the instant the drag
// ends. The basemap, admin lattice and the Lens stay visible, so spatial orientation
// is preserved; the clusters fade back in on release. A FOCUSED cluster is never
// hidden (keyboard/screen-reader safety), and the simplification is removed on EVERY
// termination path (dragend, inertia/moveend, zoom, blur, tab-hide, pointer/touch
// cancel) so the map is never left in the k12-panning state. No evidence is ever
// permanently removed. Gated/test-only until A/B-measured and UX-approved; never a
// production default here.
if (k12PanOpts.has("thin")) {
  try {
    const st = document.createElement("style");
    st.textContent =
      ".k12-panning .poi-cluster-icon:not(:focus){display:none!important}" +
      ".k12-reappear .poi-cluster-icon{animation:k12ClusterFade .18s ease-out}" +
      "@keyframes k12ClusterFade{from{opacity:0}to{opacity:1}}" +
      "@media (prefers-reduced-motion:reduce){.k12-reappear .poi-cluster-icon{animation:none}}";
    document.head.appendChild(st);
    const container = () => map.getContainer();
    let reappearTimer = null;
    const thinOn = () => container().classList.add("k12-panning");
    const thinOff = () => {
      const c = container();
      if (!c.classList.contains("k12-panning")) return;
      c.classList.remove("k12-panning");
      c.classList.add("k12-reappear"); // smooth fade-in (post-drag; no perf cost during pan)
      clearTimeout(reappearTimer);
      reappearTimer = setTimeout(() => c.classList.remove("k12-reappear"), 240);
    };
    map.on("dragstart", thinOn); // user map drag only
    map.on("dragend", thinOff);
    map.on("moveend", thinOff); // inertia end / any settle
    map.on("zoomstart", thinOff); // a drag that becomes a zoom
    window.addEventListener("blur", thinOff); // window/app blur mid-drag
    document.addEventListener("visibilitychange", thinOff); // tab hidden mid-drag
    container().addEventListener("pointercancel", thinOff, true);
    container().addEventListener("touchcancel", thinOff, true);
    // Expose a read-only state probe for the acceptance tests (gated flag only).
    window.__K12_THIN__ = { active: () => container().classList.contains("k12-panning") };
  } catch (e) {}
}

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
// K4 shell state (modes, rail, drawer). Declared here, populated by the K4 block
// below, so refresh() can call renderScopeRail() without a temporal-dead-zone hazard.
const shell = {
  modes: null,
  i18n: null,
  registry: null,
  registryFailed: false,
  signature: "",
  reading: "citizen",
  drawerFilter: null,
  drawerOpener: null,
  modeScrollPositions: { PLACE: 0, COMPARE: 0, CITY: 0 },
};
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
// Authoritative comparison state objects the Comparison Bridge reads, captured
// by renderCompare() so the Bridge, the table and the halo all interpret one
// metric identically. mobility uses the panel pair-state (which withholds under
// unequal windows), never the halo's density state.
let lastBridgeStates = null;
let lastBridgeContext = null;
// Query-gated browser-regression ONLY: deterministic authoritative comparison
// evidence. Stays null in production (the gated __HALO_REGRESSION__ seam is the
// only writer), so renderCompare() uses live stats exactly as before. When set,
// renderCompare() feeds these {value, sourceState} pairs (and optional aoiState)
// into the SAME production builders and renderers, so tests can exercise the
// unequal-window Mobility contract without depending on the deploy-only
// data/runtime_poi.json artifact. It never adds a parallel render path.
let comparisonEvidenceOverride = null;

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
  const html = `<svg class="halo-glyph halo-${which.toLowerCase()} halo-slot-${metric.slot}" viewBox="0 0 220 140" width="220" height="140" data-metric="${metric.id}" role="button" tabindex="0" aria-pressed="false" aria-label="Lens ${which}, ${metric.label}; focus to compare this metric" style="--halo-thickness:${HALO_RADIAL_GEOMETRY.BAR_THICKNESS}px">
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
      pane: "haloPane", interactive: true, keyboard: false, bubblingMouseEvents: false,
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
  document.querySelectorAll(".comparetable tr[data-halo-metric]").forEach((row) => {
    const focused = Boolean(focusedHaloMetric && row.dataset.haloMetric === focusedHaloMetric);
    row.classList.toggle("halo-metric-row-focused", focused);
    if (focused) row.setAttribute("aria-current", "true"); else row.removeAttribute("aria-current");
    const button = row.querySelector(".cmp-metric-focus");
    if (button) button.setAttribute("aria-pressed", selectedHaloMetric === row.dataset.haloMetric ? "true" : "false");
  });
  document.querySelectorAll(".cb-picker-button[data-bridge-metric]").forEach((button) => {
    button.setAttribute("aria-pressed", selectedHaloMetric === button.dataset.bridgeMetric ? "true" : "false");
  });
  renderComparisonBridge();
  applyDecisionInsightFocus();
  applySpatialSensitivityFocus();
  window.dispatchEvent(new CustomEvent("halo:metricfocus", { detail: { metricId: focusedHaloMetric, lens: sourceLens || null, selected: Boolean(focusedHaloMetric && selectedHaloMetric === focusedHaloMetric) } }));
}

// --- Comparison Bridge -----------------------------------------------------
//
// The Bridge is the FOCUSED reading of one metric inside the Lens A ↔ Lens B
// panel: Lens A value, Lens B value, and the single observed B − A (or an
// explicit withheld reason). It reads buildComparisonBridgeModel() over the same
// authoritative state objects the table renders, so the two never disagree. It
// carries no score, rank or winner/loser language; a positive delta is only
// arithmetic direction.
//
// Localization is dictionary-backed through the shared createI18n mechanism, but
// the Bridge follows the DOCUMENT language so it stays coherent with the English
// comparison panel it lives in. The Spanish dictionary exists (and is exercised
// by the unit tests), ready if the document language ever changes.
const BRIDGE_DICTIONARIES = Object.freeze({
  en: Object.freeze({
    empty: "Focus a halo metric to compare Lens A and Lens B",
    lensA: "Lens A", lensB: "Lens B",
    observedDelta: "Observed B−A", difference: "Difference",
    comparable: "Comparable", withheld: "Withheld", locked: "Locked",
    na: "N/A", off: "OFF",
    pickerAria: "Metric to compare",
    "picker.tourism": "Tourism", "picker.stays": "Stays",
    "picker.mobility": "Mobility", "picker.utci": "UTCI",
    "metric.tourism": "Tourism POIs", "metric.stays": "Hotels & stays",
    "metric.mobility": "Mobility nodes", "metric.utci": "Mean UTCI",
    "unit.tourism": "POIs", "unit.stays": "stays", "unit.mobility": "nodes",
    "unit.density": "records/km²",
    "basis.raw-counts": "raw represented counts",
    "basis.density": "represented-record density",
    "basis.celsius": "model-derived Celsius",
    "reason.different-window-sizes": "different window sizes",
    "reason.aoi-crosses": "circle crosses Madrid AOI",
    "reason.aoi-outside": "circle outside Madrid AOI",
    "reason.aoi-unavailable": "AOI unavailable",
    "reason.source-incompatible": "source states incompatible",
    "reason.layer-off": "layer off",
    "reason.no-evidence": "evidence unavailable",
    "reason.timesteps-differ": "different timesteps",
    // --- Decision Insight V1 ---
    // The Insight shares this dictionary with the Bridge on purpose: a withheld
    // reason, a metric name and a unit resolve through the SAME key on both
    // surfaces, so their wording can never drift apart.
    "insight.title": "Decision Insight",
    "insight.status.available": "Observed contrasts",
    "insight.status.limited": "Limited comparable evidence",
    "insight.status.unavailable": "No comparable evidence",
    "insight.subtitle": "descriptive evidence only",
    "insight.guard.descriptive-only": "Observed comparison only · no ordering or recommendation",
    "insight.bMinusA": "B − A",
    "insight.qualifier.model-derived": "model-derived",
    "insight.unit.count.tourism": "records",
    "insight.unit.count.stays": "catalogue records",
    "insight.unit.count.mobility": "nodes",
    "insight.unit.density.tourism": "records/km²",
    "insight.unit.density.stays": "catalogue records/km²",
    // --- Spatial Window Sensitivity V1 ---
    // Shares this dictionary with the Bridge and the Insight on purpose: a
    // metric name, a unit and a withheld reason resolve through the SAME key on
    // every surface, so the baseline reading, the scenario reading and the
    // focused Bridge can never word the same state differently.
    //
    // The copy deliberately avoids forecast vocabulary. A scenario is an
    // ALTERNATIVE ANALYTICAL WINDOW, never a predicted, expected, projected or
    // future Madrid, and a transition is an observed sensitivity of the reading,
    // never an impact, effect or cause.
    "ss.title": "Spatial sensitivity",
    "ss.subtitle": "alternative analytical window",
    "ss.empty": "No baseline captured. Capture the current comparison, then change a Lens radius to see whether the reading holds.",
    "ss.capture": "Capture current comparison",
    "ss.recapture": "Capture current as new baseline",
    "ss.reset": "Reset baseline",
    "ss.baseline": "Baseline window",
    "ss.scenario": "Scenario window",
    "ss.readingBaseline": "Baseline",
    "ss.readingScenario": "Scenario",
    "ss.windowUnchanged": "Scenario window matches the baseline window",
    "ss.notice.center-changed": "Baseline invalidated · Lens location changed",
    "ss.notice.evidence-changed": "Baseline invalidated · evidence configuration changed",
    // "Stable under this window change" is deliberately NOT "robust": the
    // project defines no statistical robustness test, so the wording claims only
    // what was observed between these two selected windows.
    "ss.status.STABLE": "Stable under this window change",
    "ss.status.MIXED": "Sensitive to window choice",
    "ss.status.LIMITED": "Insufficient comparable evidence",
    "ss.status.EVIDENCE_CHANGED": "Evidence configuration changed",
    "ss.transition.UNCHANGED_COMPARABLE": "Relationship unchanged",
    "ss.transition.DIRECTION_CHANGED": "B − A direction changed",
    "ss.transition.BASIS_CHANGED": "Basis changed",
    "ss.transition.BECAME_WITHHELD": "Comparison became withheld",
    "ss.transition.BECAME_COMPARABLE": "Comparison became available",
    "ss.transition.WITHHELD_UNCHANGED": "Comparison withheld in both windows",
    "ss.transition.WITHHELD_REASON_CHANGED": "Withheld reason changed",
    "ss.transition.EVIDENCE_CHANGED": "Evidence configuration changed",
    "ss.changedBy": "Observed comparison changed by",
    "ss.noNumericChange": "numeric change withheld · different comparison bases",
    "ss.guard.window-sensitivity-only": "Alternative analytical window · not a forecast and not a causal effect",
    "ss.a11y.captured": "Baseline window captured.",
    "ss.a11y.reset": "Baseline removed. No baseline captured.",
  }),
  es: Object.freeze({
    empty: "Enfoca una métrica del halo para comparar la Lente A y la Lente B",
    lensA: "Lente A", lensB: "Lente B",
    observedDelta: "B−A observado", difference: "Diferencia",
    comparable: "Comparable", withheld: "Retenido", locked: "Fijado",
    na: "N/D", off: "APAG.",
    pickerAria: "Métrica que comparar",
    "picker.tourism": "Turismo", "picker.stays": "Estancias",
    "picker.mobility": "Movilidad", "picker.utci": "UTCI",
    "metric.tourism": "POI turísticos", "metric.stays": "Hoteles y alojamientos",
    "metric.mobility": "Nodos de movilidad", "metric.utci": "UTCI media",
    "unit.tourism": "POI", "unit.stays": "aloj.", "unit.mobility": "nodos",
    "unit.density": "registros/km²",
    "basis.raw-counts": "recuentos representados brutos",
    "basis.density": "densidad de registros representados",
    "basis.celsius": "grados Celsius derivados del modelo",
    "reason.different-window-sizes": "tamaños de ventana distintos",
    "reason.aoi-crosses": "el círculo cruza el AOI de Madrid",
    "reason.aoi-outside": "círculo fuera del AOI de Madrid",
    "reason.aoi-unavailable": "AOI no disponible",
    "reason.source-incompatible": "estados de fuente incompatibles",
    "reason.layer-off": "capa desactivada",
    "reason.no-evidence": "evidencia no disponible",
    "reason.timesteps-differ": "pasos de tiempo distintos",
    // --- Decision Insight V1 ---
    "insight.title": "Lectura de decisión",
    "insight.status.available": "Contrastes observados",
    "insight.status.limited": "Evidencia comparable limitada",
    "insight.status.unavailable": "Sin evidencia comparable",
    "insight.subtitle": "solo evidencia descriptiva",
    "insight.guard.descriptive-only": "Comparación observada · sin ordenación ni recomendación",
    "insight.bMinusA": "B − A",
    "insight.qualifier.model-derived": "derivado del modelo",
    "insight.unit.count.tourism": "registros",
    "insight.unit.count.stays": "registros de catálogo",
    "insight.unit.count.mobility": "nodos",
    "insight.unit.density.tourism": "registros/km²",
    "insight.unit.density.stays": "registros de catálogo/km²",
    // --- Spatial Window Sensitivity V1 ---
    "ss.title": "Sensibilidad espacial",
    "ss.subtitle": "ventana analítica alternativa",
    "ss.empty": "Sin línea base capturada. Captura la comparación actual y después cambia el radio de una lente para ver si la lectura se mantiene.",
    "ss.capture": "Capturar la comparación actual",
    "ss.recapture": "Capturar la actual como nueva línea base",
    "ss.reset": "Restablecer la línea base",
    "ss.baseline": "Ventana de línea base",
    "ss.scenario": "Ventana de escenario",
    "ss.readingBaseline": "Línea base",
    "ss.readingScenario": "Escenario",
    "ss.windowUnchanged": "La ventana del escenario coincide con la de la línea base",
    "ss.notice.center-changed": "Línea base invalidada · la ubicación de la lente cambió",
    "ss.notice.evidence-changed": "Línea base invalidada · la configuración de evidencia cambió",
    "ss.status.STABLE": "Estable ante este cambio de ventana",
    "ss.status.MIXED": "Sensible a la elección de ventana",
    "ss.status.LIMITED": "Evidencia comparable insuficiente",
    "ss.status.EVIDENCE_CHANGED": "La configuración de evidencia cambió",
    "ss.transition.UNCHANGED_COMPARABLE": "Relación sin cambios",
    "ss.transition.DIRECTION_CHANGED": "El signo de B − A cambió",
    "ss.transition.BASIS_CHANGED": "La base de comparación cambió",
    "ss.transition.BECAME_WITHHELD": "La comparación pasó a retenida",
    "ss.transition.BECAME_COMPARABLE": "La comparación pasó a disponible",
    "ss.transition.WITHHELD_UNCHANGED": "Comparación retenida en ambas ventanas",
    "ss.transition.WITHHELD_REASON_CHANGED": "El motivo de retención cambió",
    "ss.transition.EVIDENCE_CHANGED": "La configuración de evidencia cambió",
    "ss.changedBy": "La comparación observada cambió en",
    "ss.noNumericChange": "cambio numérico retenido · bases de comparación distintas",
    "ss.guard.window-sensitivity-only": "Ventana analítica alternativa · no es una previsión ni un efecto causal",
    "ss.a11y.captured": "Ventana de línea base capturada.",
    "ss.a11y.reset": "Línea base eliminada. Sin línea base capturada.",
  }),
});
let bridgeI18n = null;
function bridgeDocLanguage() {
  return String(document.documentElement.lang || "en").toLowerCase().split("-")[0];
}
function bridgeT(key) {
  if (bridgeI18n) return bridgeI18n.t(key);
  const lang = bridgeDocLanguage();
  const dict = BRIDGE_DICTIONARIES[lang] || BRIDGE_DICTIONARIES.en;
  return dict[key] ?? BRIDGE_DICTIONARIES.en[key] ?? key;
}
import(moduleUrl("i18n.js")).then((module) => {
  bridgeI18n = module.createI18n(BRIDGE_DICTIONARIES, bridgeDocLanguage());
  renderComparisonBridge();
  renderDecisionInsight();
  renderSpatialSensitivity();
}).catch(() => { /* fallback translator keeps the Bridge working */ });

function bridgeDeltaText(relationship) {
  const value = relationship.deltaValue;
  const sign = value > 0 ? "+" : "";
  if (relationship.deltaKind === "temperature") return `${sign}${value.toFixed(1)}°C`;
  if (relationship.deltaKind === "density") return `${sign}${value.toFixed(1)} ${bridgeT("unit.density")}`;
  return `${sign}${value}`;
}
function bridgeSideValueText(side) {
  if (side.evidence === "OFF") return bridgeT("off");
  if (side.evidence === "N_A") return bridgeT("na");
  return side.valueText;
}
// The single authoritative "Withheld · <reason>" text, from a withheldReasonCode.
// Both the Comparison Bridge qualifier and the table relationship cell use this,
// so one metric state yields one reason wherever it is shown.
function bridgeWithheldText(withheldReasonCode) {
  return `${bridgeT("withheld")} · ${bridgeT(`reason.${withheldReasonCode}`)}`;
}
function bridgeSideSubText(model, side) {
  if (model.kind === "temperature") return "";
  if (side.evidence !== "VALID" && side.evidence !== "ZERO") return "";
  const unit = bridgeT(`unit.${model.metricId}`);
  if (side.densityValue != null) return `${unit} · ${side.densityValue.toFixed(1)} ${bridgeT("unit.density")}`;
  return unit;
}
function bridgeRadiusText(side) {
  return side.radiusM != null ? `r ${formatLensRadius(side.radiusM)}` : "";
}
function renderComparisonBridge() {
  const host = document.getElementById("comparisonBridge");
  if (!host) return;
  const empty = document.getElementById("comparisonBridgeEmpty");
  const block = document.getElementById("comparisonBridgeMetric");
  const a11y = document.getElementById("comparisonBridgeA11y");
  const metricId = focusedHaloMetric;
  const picker = document.getElementById("comparisonBridgePicker");
  if (picker) picker.setAttribute("aria-label", bridgeT("pickerAria"));
  document.querySelectorAll(".cb-picker-button[data-bridge-metric]").forEach((button) => {
    button.textContent = bridgeT(`picker.${button.dataset.bridgeMetric}`);
    button.setAttribute("aria-pressed", selectedHaloMetric === button.dataset.bridgeMetric ? "true" : "false");
  });
  const state = metricId && lastBridgeStates ? lastBridgeStates[metricId] : null;
  const model = state && lastBridgeContext
    ? buildComparisonBridgeModel({ metricId, state, radiusMode: lastBridgeContext.radiusMode, radii: lastBridgeContext.radii })
    : null;
  if (!model) {
    empty.textContent = bridgeT("empty");
    empty.hidden = false;
    block.hidden = true;
    host.removeAttribute("data-locked");
    if (a11y) a11y.textContent = "";
    return;
  }
  empty.hidden = true;
  block.hidden = false;
  const locked = selectedHaloMetric === metricId;
  host.setAttribute("data-locked", locked ? "true" : "false");
  const lockEl = document.getElementById("cbLock");
  lockEl.textContent = bridgeT("locked");
  lockEl.hidden = !locked;
  document.getElementById("cbMetricName").textContent = bridgeT(`metric.${metricId}`);
  document.getElementById("cbLensALabel").textContent = bridgeT("lensA");
  document.getElementById("cbLensBLabel").textContent = bridgeT("lensB");
  document.getElementById("cbValueA").textContent = bridgeSideValueText(model.a);
  document.getElementById("cbValueB").textContent = bridgeSideValueText(model.b);
  document.getElementById("cbSubA").textContent = bridgeSideSubText(model, model.a);
  document.getElementById("cbSubB").textContent = bridgeSideSubText(model, model.b);
  document.getElementById("cbRadiusA").textContent = bridgeRadiusText(model.a);
  document.getElementById("cbRadiusB").textContent = bridgeRadiusText(model.b);
  const relLabel = document.getElementById("cbRelLabel");
  const relValue = document.getElementById("cbRelValue");
  const qualifier = document.getElementById("cbQualifier");
  const rel = model.relationship;
  let relValueText;
  let qualifierText;
  if (rel.comparable) {
    relLabel.textContent = bridgeT("observedDelta");
    relValueText = bridgeDeltaText(rel);
    relValue.textContent = relValueText;
    host.setAttribute("data-relationship", "comparable");
    qualifierText = `${bridgeT("comparable")} · ${bridgeT(`basis.${rel.basisCode}`)}`;
  } else {
    relLabel.textContent = bridgeT("difference");
    relValueText = bridgeT("withheld");
    relValue.textContent = relValueText;
    host.setAttribute("data-relationship", "withheld");
    qualifierText = bridgeWithheldText(rel.withheldReasonCode);
  }
  qualifier.textContent = qualifierText;
  if (a11y) {
    const sideSentence = (label, side, model2) => {
      const value = bridgeSideValueText(side);
      const sub = bridgeSideSubText(model2, side);
      const radius = bridgeRadiusText(side);
      return `${label} ${value}${sub ? `, ${sub}` : ""}${radius ? `, ${radius}` : ""}`;
    };
    a11y.textContent = `${bridgeT(`metric.${metricId}`)}${locked ? ` (${bridgeT("locked")})` : ""}. `
      + `${sideSentence(bridgeT("lensA"), model.a, model)}. `
      + `${sideSentence(bridgeT("lensB"), model.b, model)}. `
      + `${rel.comparable ? bridgeT("observedDelta") : bridgeT("difference")} ${relValueText}. ${qualifierText}.`;
  }
}

// P2: the Bridge is now directly operable on touch and keyboard without asking
// readers to discover a small halo mark or open the full comparison table first.
// The controls only route into the existing focus/lock function; every value and
// comparability decision still comes from the authoritative Bridge model.
for (const button of document.querySelectorAll(".cb-picker-button[data-bridge-metric]")) {
  const metricId = button.dataset.bridgeMetric;
  button.addEventListener("mouseenter", () => setHaloMetricFocus(metricId, null));
  button.addEventListener("mouseleave", () => setHaloMetricFocus(null, null));
  button.addEventListener("focus", () => setHaloMetricFocus(metricId, null));
  button.addEventListener("blur", () => setHaloMetricFocus(null, null));
  button.addEventListener("click", () => setHaloMetricFocus(metricId, null, true));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    selectedHaloMetric = null;
    setHaloMetricFocus(null, null);
  });
}

// --- Decision Insight ------------------------------------------------------
//
// Decision Insight is the deterministic SYNTHESIS of the canonical comparison
// set: four short analytical clauses answering "what are the main observed
// contrasts between these two windows?" without the reader reconciling four
// table rows, two radii and the evidence limitations themselves.
//
// It renders buildDecisionInsightModel() over the SAME authoritative Bridge
// models the focused Bridge reads, so Halo, Bridge, Insight and table always
// agree. NO analytical branching and NO arithmetic live in this view layer:
// these functions turn model codes into localized text and nothing else.
//
// There is NO runtime LLM, generative service or network call anywhere in this
// path — every line is a dictionary template filled from an evidence state, so
// each rendered sentence is traceable to exactly one authoritative state.
//
// The copy is deliberately neutral: a signed B − A is arithmetic direction only.
// No ranking, no winner, no score, no composite, no causal claim.

// The numeric difference, with the unit the metric's own basis requires. Count
// basis prints the metric's records/nodes; density basis prints the represented
// per-km² unit the panel authorizes; UTCI prints Celsius.
function decisionInsightDeltaText(item) {
  const value = item.deltaValue;
  const sign = value > 0 ? "+" : "";
  if (item.deltaKind === "temperature") return `${sign}${value.toFixed(1)}°C`;
  if (item.deltaKind === "density") return `${sign}${value.toFixed(1)} ${bridgeT(`insight.unit.density.${item.metricId}`)}`;
  return `${sign}${value} ${bridgeT(`insight.unit.count.${item.metricId}`)}`;
}

// One relationship clause per metric. The WITHHELD clause reuses the Bridge's
// single authoritative bridgeWithheldText(), so a withheld Insight line and the
// focused Bridge qualifier are literally the same string. OFF, N/A and WITHHELD
// stay semantically distinct and none of them is ever rendered as a zero.
function decisionInsightRelationshipText(item) {
  if (item.state === "comparable") {
    const qualifier = item.evidenceQualifier ? ` · ${bridgeT(`insight.qualifier.${item.evidenceQualifier}`)}` : "";
    return `${bridgeT("insight.bMinusA")} ${decisionInsightDeltaText(item)}${qualifier}`;
  }
  if (item.state === "off") return bridgeT("off");
  if (item.state === "unavailable") return `${bridgeT("na")} · ${bridgeT(`reason.${item.withheldReasonCode}`)}`;
  return bridgeWithheldText(item.withheldReasonCode);
}

// The four canonical Bridge models for the current comparison state. The Insight
// consumes Bridge-level semantics; it never re-derives comparison rules.
function buildBridgeMetricModels() {
  if (!lastBridgeStates || !lastBridgeContext) return null;
  const models = {};
  for (const metricId of BRIDGE_METRIC_IDS) {
    models[metricId] = buildComparisonBridgeModel({
      metricId, state: lastBridgeStates[metricId],
      radiusMode: lastBridgeContext.radiusMode, radii: lastBridgeContext.radii,
    });
  }
  return models;
}

// Metric focus gives the matching item SUBTLE emphasis. Nothing is ever hidden
// and the other items stay fully readable: the Insight is not a second metric
// selector. It is informational, so it adds no tab stop, no interactive control
// and no aria-live chatter on pointer hover — the Bridge already owns the
// focused-metric announcement.
function applyDecisionInsightFocus() {
  const list = document.getElementById("decisionInsightItems");
  if (!list) return;
  list.dataset.hasFocus = focusedHaloMetric ? "true" : "false";
  for (const item of list.querySelectorAll(".di-item")) {
    const focused = Boolean(focusedHaloMetric && item.dataset.metricId === focusedHaloMetric);
    item.dataset.focused = focused ? "true" : "false";
    if (focused) item.setAttribute("aria-current", "true"); else item.removeAttribute("aria-current");
  }
}

function renderDecisionInsight() {
  const host = document.getElementById("decisionInsight");
  if (!host) return;
  const model = buildDecisionInsightModel({
    metricModels: buildBridgeMetricModels(),
    radiusMode: lastBridgeContext?.radiusMode,
    radii: lastBridgeContext?.radii,
  });
  if (!model) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  // Informational status only: it describes what comparative evidence exists,
  // never how "good" a lens is, and carries no number.
  host.dataset.status = model.status;
  document.getElementById("decisionInsightHeading").textContent = bridgeT("insight.title");
  document.getElementById("decisionInsightStatus").textContent = `${bridgeT(`insight.status.${model.status}`)} · ${bridgeT("insight.subtitle")}`;
  // Keyed by the model's own guardCode, so the safeguard copy is traceable to
  // the model rather than hardcoded in the view.
  document.getElementById("decisionInsightGuard").textContent = bridgeT(`insight.guard.${model.guardCode}`);
  const list = document.getElementById("decisionInsightItems");
  list.textContent = "";
  // model.items is already in FIXED canonical order and is never sorted by
  // magnitude; this loop must not reorder it.
  for (const item of model.items) {
    const row = document.createElement("li");
    row.className = "di-item";
    row.dataset.metricId = item.metricId;
    row.dataset.state = item.state;
    // Arithmetic direction, exposed for traceability only. It is deliberately
    // NOT colour-coded: a sign is not success or failure.
    row.dataset.direction = item.direction || "none";
    const name = document.createElement("span");
    name.className = "di-metric";
    // Same dictionary key the Bridge and the table use for this metric.
    name.textContent = bridgeT(`metric.${item.metricId}`);
    const relationship = document.createElement("span");
    relationship.className = "di-rel";
    relationship.textContent = decisionInsightRelationshipText(item);
    row.append(name, relationship);
    list.append(row);
  }
  applyDecisionInsightFocus();
}

// --- Spatial Window Sensitivity --------------------------------------------
//
// A SENSITIVITY CHECK ON THE METHOD, not another view of the values.
//
// The user freezes the current configuration as the BASELINE window; the live
// configuration then becomes the SCENARIO window as they change Lens radii.
// This section reports how the EXISTING authoritative reading responded — stayed
// the same, changed B − A direction, changed comparison basis, became withheld
// or became available — for each canonical metric.
//
// Changing a radius changes which geography, and therefore which records, each
// Lens includes. It does NOT change Madrid. So nothing here is predicted,
// expected, projected or future, and no transition is an impact, an effect or a
// cause: a different reading under a different radius means the interpretation
// is SENSITIVE TO THE CHOSEN SPATIAL WINDOW. See
// docs/SPATIAL_WINDOW_SENSITIVITY_V1.md.
//
// V1 SCOPE IS RADII ONLY. A Lens CENTRE move is a different place, and an
// evidence-configuration change (HATI timestep, accommodation filter, source
// availability) is a different evidence universe; neither is radius
// sensitivity, so both INVALIDATE the baseline rather than being silently
// folded into it.
//
// The scenario side is rendered from the SAME authoritative Bridge models the
// Decision Insight reads, so it can never become an independent fifth
// interpretation of the current state. The baseline side is a frozen historical
// snapshot of structured MODEL state — never scraped DOM text.

// The captured baseline: an immutable structural snapshot, or null. Session/UI
// state only — there is deliberately no backend, no account and no storage
// infrastructure, so a page reload starts again with no baseline.
let spatialBaseline = null;
// Why a captured baseline was dropped ("center-changed" / "evidence-changed"),
// shown once until the user captures again. Null when there is nothing to say.
let spatialBaselineNotice = null;

// A fingerprint of the EVIDENCE CONTRACT behind the four canonical metrics. It
// changes when the evidence universe changes — not when a radius does — so the
// scenario layer can tell a spatial-window change apart from an
// evidence-configuration change. Lens radii and centres are deliberately ABSENT:
// the radius is the scenario, and the centre has its own invalidation rule.
function spatialEvidenceKey() {
  return [
    isHatiVisible() ? `hati:${timestep}` : "hati:off",
    `stay:${stayKindFilter}`,
    `tourismSource:${combinedStatus(layerStatus, ["museums", "info"])}`,
    `staySource:${combinedStatus(layerStatus, ["stays"])}`,
    `mobilitySource:${combinedStatus(layerStatus, ["bikes", "rail"])}`,
    // The gated regression seam substitutes the comparison evidence universe,
    // so switching it on or off is an evidence-configuration change too.
    `override:${comparisonEvidenceOverride ? "on" : "off"}`,
  ].join("|");
}

function spatialCurrentCenters() {
  return { A: centerOf("A"), B: centerOf("B") };
}

// Drop the baseline because it no longer describes the same analysis. This is
// not an error: it is the honest alternative to comparing two different places
// (or two different evidence universes) as if only the radius had changed.
function invalidateSpatialBaseline(reasonCode) {
  if (!spatialBaseline) return false;
  spatialBaseline = null;
  spatialBaselineNotice = reasonCode;
  return true;
}

// Guard run on every comparison render, BEFORE the model is built. V1 policy is
// INVALIDATE (not "mark incompatible") for both conditions, because a baseline
// that survived either change could be misread as pure radius sensitivity.
function enforceSpatialBaselineValidity() {
  if (!spatialBaseline) return;
  if (spatialBaselineCenterChanged(spatialBaseline.centers, spatialCurrentCenters())) {
    invalidateSpatialBaseline("center-changed");
    return;
  }
  if (spatialBaseline.evidenceKey !== spatialEvidenceKey()) invalidateSpatialBaseline("evidence-changed");
}

function spatialRadiiText(radii) {
  return radii
    ? `${bridgeT("lensA")} · ${formatLensRadius(radii.A)}  |  ${bridgeT("lensB")} · ${formatLensRadius(radii.B)}`
    : "";
}

// One side's reading, worded EXACTLY as the Bridge and the Insight word it: a
// comparable side reuses the Insight's own relationship clause, and a
// non-comparable side reuses the Bridge's single authoritative withheld text.
// OFF, N/A and WITHHELD therefore stay distinct here too, and none is ever
// rendered as a zero.
function spatialSideReadingText(side) {
  if (side.state === "comparable") return decisionInsightRelationshipText(side);
  if (side.state === "off") return bridgeT("off");
  if (side.state === "unavailable") return `${bridgeT("na")} · ${bridgeT(`reason.${side.withheldReasonCode}`)}`;
  return bridgeWithheldText(side.withheldReasonCode);
}

// The signed change in the OBSERVED comparison between the two windows, with the
// unit the shared basis requires. Only rendered where the model authorized it,
// and worded as an observation ("changed by"), never as an effect or a cause.
function spatialDeltaChangeText(item) {
  const value = item.deltaChange;
  const sign = value > 0 ? "+" : "";
  if (item.deltaChangeKind === "temperature") return `${sign}${value.toFixed(1)}°C`;
  if (item.deltaChangeKind === "density") return `${sign}${value.toFixed(1)} ${bridgeT(`insight.unit.density.${item.metricId}`)}`;
  return `${sign}${value} ${bridgeT(`insight.unit.count.${item.metricId}`)}`;
}

// The supporting line under a transition. BASIS_CHANGED names the two bases so
// the abstention is explainable ("raw represented counts → represented-record
// density") and explicitly says the numeric change is withheld; a compatible
// transition reports the observed change with correct units. Everything else
// adds nothing, because the transition label already said it.
function spatialTransitionDetailText(item) {
  if (item.transitionCode === "BASIS_CHANGED") {
    return `${bridgeT(`basis.${item.baseline.basisCode}`)} → ${bridgeT(`basis.${item.scenario.basisCode}`)} · ${bridgeT("ss.noNumericChange")}`;
  }
  // A zero change needs no sentence: the transition label already says the
  // relationship is unchanged, and the two readings are printed side by side,
  // so "changed by 0" would only add noise.
  if (item.deltaChange == null || item.deltaChange === 0) return "";
  const qualifier = item.scenario.evidenceQualifier ? ` · ${bridgeT(`insight.qualifier.${item.scenario.evidenceQualifier}`)}` : "";
  return `${bridgeT("ss.changedBy")} ${spatialDeltaChangeText(item)}${qualifier}`;
}

// Metric focus gives the matching item SUBTLE emphasis, reusing the existing
// shared focus state. Nothing is hidden and no item becomes interactive: this
// section is informational, not a second metric selector.
function applySpatialSensitivityFocus() {
  const list = document.getElementById("spatialSensitivityItems");
  if (!list) return;
  list.dataset.hasFocus = focusedHaloMetric ? "true" : "false";
  for (const item of list.querySelectorAll(".ss-item")) {
    const focused = Boolean(focusedHaloMetric && item.dataset.metricId === focusedHaloMetric);
    item.dataset.focused = focused ? "true" : "false";
    if (focused) item.setAttribute("aria-current", "true"); else item.removeAttribute("aria-current");
  }
}

// Announcements are DISCRETE ONLY. Capture, reset and invalidation are single
// user actions and are announced; the per-metric values stay visually live but
// are never announced, so dragging a radius slider cannot flood assistive
// technology with a stream of partial readings.
function announceSpatialSensitivity(message) {
  const region = document.getElementById("spatialSensitivityA11y");
  if (region) region.textContent = message;
}

function spatialSensitivityRow(item) {
  const row = document.createElement("li");
  row.className = "ss-item";
  row.dataset.metricId = item.metricId;
  row.dataset.transition = item.transitionCode;
  // Exposed as data for traceability only, and never styled: a sign is not
  // success or failure, and a transition is not good or bad news.
  row.dataset.baselineDirection = item.baseline.direction || "none";
  row.dataset.scenarioDirection = item.scenario.direction || "none";
  const name = document.createElement("span");
  name.className = "ss-metric";
  // The same dictionary key the halo, the Bridge, the Insight and the table use.
  name.textContent = bridgeT(`metric.${item.metricId}`);
  row.append(name);
  // BASELINE then SCENARIO, in that fixed reading order at every width.
  for (const [labelKey, side] of [["ss.readingBaseline", item.baseline], ["ss.readingScenario", item.scenario]]) {
    const reading = document.createElement("span");
    reading.className = "ss-reading";
    reading.dataset.side = labelKey === "ss.readingBaseline" ? "baseline" : "scenario";
    reading.dataset.comparable = side.comparable ? "true" : "false";
    const label = document.createElement("span");
    label.className = "ss-reading-label";
    label.textContent = bridgeT(labelKey);
    const value = document.createElement("span");
    value.className = "ss-reading-value";
    value.textContent = spatialSideReadingText(side);
    reading.append(label, value);
    row.append(reading);
  }
  const transition = document.createElement("span");
  transition.className = "ss-transition";
  transition.textContent = bridgeT(`ss.transition.${item.transitionCode}`);
  const detailText = spatialTransitionDetailText(item);
  if (detailText) {
    const detail = document.createElement("span");
    detail.className = "ss-transition-detail";
    detail.textContent = detailText;
    transition.append(detail);
  }
  row.append(transition);
  return row;
}

// The authoritative sensitivity model for the current state, or null when there
// is no baseline. The SCENARIO side is built from buildBridgeMetricModels() —
// the very models Decision Insight and the focused Bridge consume.
function buildSpatialSensitivityState() {
  if (!spatialBaseline) return null;
  const scenarioMetricModels = buildBridgeMetricModels();
  if (!scenarioMetricModels) return null;
  return buildSpatialSensitivityModel({
    baseline: spatialBaseline,
    scenarioMetricModels,
    scenarioRadii: lastBridgeContext?.radii || null,
    scenarioEvidenceKey: spatialEvidenceKey(),
  });
}

function renderSpatialSensitivity() {
  const host = document.getElementById("spatialSensitivity");
  if (!host) return;
  // K11 (#73): reset here; set to the frozen model below when a baseline exists.
  if (typeof k11 !== "undefined") k11.compareSensitivity = null;
  // The section is a COMPARISON of two window configurations, so it exists only
  // in compare mode: with one lens there is no A ↔ B reading to be sensitive.
  if (!bEnabled || !lastBridgeContext) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  document.getElementById("spatialSensitivityHeading").textContent = bridgeT("ss.title");
  document.getElementById("spatialSensitivityGuard").textContent = bridgeT(`ss.guard.${SPATIAL_SENSITIVITY_GUARD_CODE}`);
  const notice = document.getElementById("spatialSensitivityNotice");
  notice.textContent = spatialBaselineNotice ? bridgeT(`ss.notice.${spatialBaselineNotice}`) : "";
  notice.hidden = !spatialBaselineNotice;
  const empty = document.getElementById("spatialSensitivityEmpty");
  const windows = document.getElementById("spatialSensitivityWindows");
  const list = document.getElementById("spatialSensitivityItems");
  const capture = document.getElementById("spatialSensitivityCapture");
  const reset = document.getElementById("spatialSensitivityReset");
  const status = document.getElementById("spatialSensitivityStatus");
  const model = buildSpatialSensitivityState();
  list.textContent = "";
  if (!model) {
    host.dataset.status = "no-baseline";
    status.textContent = bridgeT("ss.subtitle");
    empty.textContent = bridgeT("ss.empty");
    empty.hidden = false;
    windows.hidden = true;
    // Cleared, not just hidden: a dropped baseline must leave no stale radii
    // behind that a later render could resurrect.
    document.getElementById("ssBaselineRadii").textContent = "";
    document.getElementById("ssScenarioRadii").textContent = "";
    capture.textContent = bridgeT("ss.capture");
    reset.hidden = true;
    applySpatialSensitivityFocus();
    return;
  }
  host.dataset.status = model.status;
  // K11 (#73): capture the frozen spatial-sensitivity model for the COMPARE export.
  if (typeof k11 !== "undefined") k11.compareSensitivity = model;
  empty.hidden = true;
  windows.hidden = false;
  // Categorical summary only — never a robustness percentage, confidence value,
  // stability score or sensitivity index.
  status.textContent = `${bridgeT(`ss.status.${model.status}`)} · ${bridgeT("ss.subtitle")}`;
  document.getElementById("ssBaselineLabel").textContent = bridgeT("ss.baseline");
  document.getElementById("ssScenarioLabel").textContent = bridgeT("ss.scenario");
  document.getElementById("ssBaselineRadii").textContent = spatialRadiiText(model.baseline.radii);
  document.getElementById("ssScenarioRadii").textContent = model.windowUnchanged
    ? `${spatialRadiiText(model.scenario.radii)} · ${bridgeT("ss.windowUnchanged")}`
    : spatialRadiiText(model.scenario.radii);
  // model.items is already in FIXED canonical order and is never sorted by
  // magnitude, change size, importance or availability; this loop must not
  // reorder it. There is no "top sensitivity".
  for (const item of model.items) list.append(spatialSensitivityRow(item));
  // Replacing the baseline must be EXPLICIT, never automatic after a radius
  // change: a silently moving baseline would destroy the whole comparison.
  capture.textContent = bridgeT("ss.recapture");
  reset.hidden = false;
  reset.textContent = bridgeT("ss.reset");
  applySpatialSensitivityFocus();
}

function captureSpatialBaseline() {
  const metricModels = buildBridgeMetricModels();
  if (!metricModels || !lastBridgeContext || !bEnabled) return;
  spatialBaseline = captureSpatialSensitivityBaseline({
    metricModels,
    radii: lastBridgeContext.radii,
    centers: spatialCurrentCenters(),
    radiusMode: lastBridgeContext.radiusMode,
    evidenceKey: spatialEvidenceKey(),
  });
  // A fresh capture answers whatever invalidated the previous baseline.
  spatialBaselineNotice = null;
  renderSpatialSensitivity();
  announceSpatialSensitivity(`${bridgeT("ss.a11y.captured")} ${spatialRadiiText(spatialBaseline.radii)}.`);
}

// Deterministic reset: it removes the stored baseline AND NOTHING ELSE. The
// lenses, the current radii, the active lens, the layers, the Comparison Bridge
// and Decision Insight are all left exactly as they are.
function resetSpatialBaseline() {
  spatialBaseline = null;
  spatialBaselineNotice = null;
  renderSpatialSensitivity();
  announceSpatialSensitivity(bridgeT("ss.a11y.reset"));
}

function setHaloLine(line, start, end) {
  line.setAttribute("x1", String(start[0])); line.setAttribute("y1", String(start[1]));
  line.setAttribute("x2", String(end[0])); line.setAttribute("y2", String(end[1]));
}

// Panel → halo: each canonical table row carries an accessible focus control.
// Hover / keyboard focus previews the metric; click (Enter / Space) locks or
// unlocks it; Escape clears the lock. Pedestrian has no halo mark and no control.
function bindComparisonMetricControls() {
  for (const button of document.querySelectorAll(".cmp-metric-focus")) {
    const metricId = button.closest("tr[data-halo-metric]")?.dataset.haloMetric;
    if (!metricId || button._bridgeBound) continue;
    button._bridgeBound = true;
    button.addEventListener("mouseenter", () => setHaloMetricFocus(metricId, null));
    button.addEventListener("mouseleave", () => setHaloMetricFocus(null, null));
    button.addEventListener("focus", () => setHaloMetricFocus(metricId, null));
    button.addEventListener("blur", () => setHaloMetricFocus(null, null));
    button.addEventListener("click", () => setHaloMetricFocus(metricId, null, true));
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        selectedHaloMetric = null;
        setHaloMetricFocus(null, null);
      }
    });
  }
}
bindComparisonMetricControls();

// Two explicit controls, both real buttons: capturing and replacing the
// baseline is always a deliberate act, and resetting removes only the stored
// baseline. Nothing here is pointer-only and nothing adds a tab stop beyond
// these two.
function bindSpatialSensitivityControls() {
  const capture = document.getElementById("spatialSensitivityCapture");
  const reset = document.getElementById("spatialSensitivityReset");
  if (capture) capture.addEventListener("click", captureSpatialBaseline);
  if (reset) reset.addEventListener("click", resetSpatialBaseline);
}
bindSpatialSensitivityControls();

function updateHaloGlyph(marker, state, layout = "full") {
  const nodes = marker._haloNodes;
  if (!nodes) cacheHaloNodes(marker);
  const cached = marker._haloNodes;
  if (!cached) return;
  const which = marker._haloLens;
  const metric = HALO_METRICS.find((candidate) => candidate.id === marker._haloMetric);
  const spec = buildHaloGlyphSpec(metric, state, which, layout);
  const trackLength = layout === "compact" ? HALO_COMPACT_TRACK_PX : HALO_FULL_TRACK_PX;
  // These are local SVG coordinates whose origin is already P0. Apply the
  // geographic radial gap once in haloPositionsFor(), never again in the glyph.
  const trackGeometry = getHaloBarGeometry({ center: HALO_SVG_CENTER, renderedRadius: 0, angle: spec.angle, magnitude: 1, maxLength: trackLength, radialGap: 0 });
  const fillGeometry = getHaloBarGeometry({ center: HALO_SVG_CENTER, renderedRadius: 0, angle: spec.angle, magnitude: spec.magnitude ?? 0, maxLength: trackLength, radialGap: 0 });
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
  // Text stays on a fixed rail beyond the full-length track. Only the fill
  // endpoint follows magnitude; zero and abstention labels use the same rail.
  const valueAnchor = getHaloLabelGeometry({ endpoint: trackGeometry.endpoint, angle: spec.angle, gap: HALO_RADIAL_GEOMETRY.LABEL_GAP });
  cached.value.setAttribute("x", String(valueAnchor.x));
  cached.value.setAttribute("y", String(valueAnchor.y));
  cached.value.setAttribute("text-anchor", valueAnchor.textAnchor);
  cached.value.style.display = spec.value ? "" : "none";

  // The short metric caption (lens letter + identity) rides one line out; it is
  // a full-layout convenience and is dropped in compact layout.
  const labelAnchor = getHaloLabelGeometry({ endpoint: { x: valueAnchor.x, y: valueAnchor.y }, angle: spec.angle, gap: HALO_RADIAL_GEOMETRY.CAPTION_GAP });
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

// True only for a loopback, RFC1918 private-LAN, link-local, or mDNS (.local)
// host — i.e. a developer machine or a device on the same private network, never
// a routable public host such as the GitHub Pages deployment. Pure and
// host-string-only. An identical, unit-tested copy lives in
// research/ac_p0_12/runner_core.mjs (isLoopbackOrPrivateLanHost); keep them in
// sync — the node test tests that copy, this classic script cannot be imported.
function isLoopbackOrPrivateLanHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1") return true; // IPv6 loopback
  if (h.startsWith("fe80:")) return true; // IPv6 link-local
  if (/\.local$/.test(h)) return true; // mDNS / Bonjour
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return false;
    if (o[0] === 127) return true; // 127.0.0.0/8 loopback
    if (o[0] === 10) return true; // 10.0.0.0/8
    if (o[0] === 192 && o[1] === 168) return true; // 192.168.0.0/16
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16.0.0/12
    if (o[0] === 169 && o[1] === 254) return true; // 169.254.0.0/16 link-local
    return false;
  }
  return false;
}

// Browser regression tests exercise the production Leaflet renderer with
// deterministic evidence and map geometry. The seam is opt-in by query string
// and is absent during normal use.
const haloRegressionRequested = new URLSearchParams(window.location.search).get("haloRegressionTest") === "1";
// The seam is reachable only from the developer's own machine. Loopback covers a
// laptop running the harness against itself; the private-LAN / mDNS / link-local
// cases additionally let a physically-attached iPad or iPhone — which reaches the
// laptop by its LAN IP, never "localhost" — drive the real app for the AC-P0-12
// device-validation runner (research/ac_p0_12/). The public GitHub Pages host is a
// routable domain, never a loopback or RFC1918 address, so it never matches; and
// the explicit ?haloRegressionTest=1 opt-in is still required on top of this, so
// the seam remains absent in all normal use regardless of host.
const haloRegressionLocal = isLoopbackOrPrivateLanHost(window.location.hostname);

// P0-a STAGING GATE (#95, owner-reviewed non-production integration route,
// PR #96 comments 6273771576 / 6274388935). OFF by default EVERYWHERE, including
// the public GitHub Pages deployment: with this flag false, every P0-a-added
// surface below (the promoted #planningMembership block, its scope-rail claim,
// the identity guard/coalescing scan it schedules, and the dragstart/dragend/
// slider-change hooks that drive it) is unreachable — no new computation runs,
// no new listener is installed, and the markup stays hidden — so the USER-VISIBLE
// Detail/rail behaviour is the same as pre-P0-a production (the implementation
// bytes necessarily differ; see docs/UX_I1_P0A_MEMBERSHIP.md §4a for exactly what
// this equivalence does and does not claim). The planning Detail list, its own
// scope-rail claim and its own membership query are untouched by this flag
// either way (they predate P0-a). ON requires BOTH a
// loopback/private-LAN host (same fail-closed predicate as K12's ?k12opt=) AND
// the explicit ?p0aStaging=1 query flag, so a public host can never activate it
// by query string alone — this is a staging-only gate, not a production default;
// activating P0-a for real users remains a separate, explicit owner decision.
const P0A_ENABLED = isLoopbackOrPrivateLanHost(window.location.hostname) && new URLSearchParams(window.location.search).get("p0aStaging") === "1";

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
    // K9 granted-urban-licence helpers. They drive and read the real layer
    // against the committed artifact (no injected fixture), so the browser
    // contract exercises the production load / state / count / map paths.
    async enableLicences() {
      setLayerVisible("licences", true);
      for (let i = 0; i < 400 && (licenceState === "idle" || licenceState === "loading"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      refresh();
      return licenceState;
    },
    disableLicences() {
      setLayerVisible("licences", false);
    },
    setLicenceWindow(from, to) {
      const fromEl = document.getElementById("licFrom");
      const toEl = document.getElementById("licTo");
      if (fromEl) fromEl.value = from == null ? "" : from;
      if (toEl) toEl.value = to == null ? "" : to;
      applyLicenceWindowFromInputs();
    },
    licenceSnapshot() {
      const section = document.getElementById("urbanLicences");
      return {
        state: section.dataset.licenceState,
        window: licenceWindow ? { from: licenceWindow.from, to: licenceWindow.to } : null,
        perFamily: licenceModel.index && isLicencesVisible() ? licenceView().perFamily : null,
        mapMarkers: groups.licences.getLayers().length,
        extent: licenceModel.index ? { min: licenceModel.index.dateExtent.min, max: licenceModel.index.dateExtent.max } : null,
        records: licenceModel.index ? licenceModel.index.records.length : 0,
      };
    },
    // The rendered popup HTML for one committed record, so a browser contract can
    // prove per-record provenance (current vs historical-only, address-text
    // disagreement) is inspectable without having to click a canvas point.
    licencePopup(id) {
      const record = licenceModel.index && licenceModel.index.records.find((r) => r.id === id);
      return record ? licencePopupHtml(record) : null;
    },
    // Hospitality seams (K11 #73 micro-gate): drive the metric + barrio controls
    // deterministically so a browser contract can prove the selection round-trips
    // without a brittle canvas click. They go through the real handlers.
    async enableHospitality() {
      setHospitalityVisible(true);
      for (let i = 0; i < 400 && hospitalityState === "loading"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return hospitalityState;
    },
    setHospitalityMetric(id) {
      const select = document.getElementById("hospitalityMetricSelect");
      if (select) { select.value = id; if (typeof select.onchange === "function") select.onchange({ target: select }); }
      return hospitalityMetric;
    },
    selectHospitalityBarrio(officialId) {
      hospitalitySelectedBarrio = officialId == null ? null : String(officialId);
      if (typeof applyHospitalityStyles === "function") applyHospitalityStyles();
      renderHospitalityContext();
      k11ScheduleUrlCommit();
      return hospitalitySelectedBarrio;
    },
    hospitalitySnapshot() {
      let sampleBarrio = null;
      try {
        if (hospitalityModel.index && hospitalityModel.index.barrio) {
          sampleBarrio = [...hospitalityModel.index.barrio.keys()][0] || null;
        }
      } catch (error) { sampleBarrio = null; }
      return {
        state: hospitalityState,
        visible: hospitalityVisible,
        metric: hospitalityMetric,
        barrio: hospitalitySelectedBarrio,
        areaName: document.getElementById("hospitalityAreaName")?.textContent?.trim() || null,
        value: document.getElementById("hospitalityValue")?.textContent?.trim() || null,
        unit: document.getElementById("hospitalityUnit")?.textContent?.trim() || null,
        sampleBarrio,
      };
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
    // Inject deterministic authoritative comparison evidence and re-run the REAL
    // renderCompare() path (builders, table, Bridge, halo). Pass null to clear.
    // Lets browser tests exercise evidence-dependent contracts (notably the
    // unequal-window Mobility rule) without the deploy-only runtime POI artifact.
    setComparisonOverride(override) {
      comparisonEvidenceOverride = override;
      renderCompare();
    },
    // Read-only view of the shared halo focus state, so Bridge regressions can
    // assert the panel ↔ halo synchronization without depending on whether a
    // given halo marker is currently on the map (it may be collision-suppressed
    // under a panel). setHaloMetricFocus toggles the class on every cached glyph,
    // so this count reflects the logical focus regardless of DOM attachment.
    focusState() {
      return { focused: focusedHaloMetric, selected: selectedHaloMetric };
    },
    // Read-only view of the rendered Decision Insight, so four-surface
    // coherence regressions can compare it against the Bridge, the halo and the
    // table without scraping layout. It reports what the DOM actually prints.
    decisionInsight() {
      const host = document.getElementById("decisionInsight");
      return {
        hidden: host.hasAttribute("hidden"),
        status: host.dataset.status || null,
        heading: document.getElementById("decisionInsightHeading").textContent.trim(),
        statusText: document.getElementById("decisionInsightStatus").textContent.trim(),
        guard: document.getElementById("decisionInsightGuard").textContent.trim(),
        items: [...document.querySelectorAll("#decisionInsightItems .di-item")].map((row) => ({
          metricId: row.dataset.metricId,
          state: row.dataset.state,
          direction: row.dataset.direction,
          focused: row.dataset.focused,
          ariaCurrent: row.getAttribute("aria-current"),
          metric: row.querySelector(".di-metric").textContent.trim(),
          relationship: row.querySelector(".di-rel").textContent.trim(),
        })),
      };
    },
    // The authoritative Insight MODEL for the current comparison state, so a
    // regression can assert the rendered text never drifts from the model and
    // that the model never drifts from the Bridge.
    decisionInsightModel() {
      return buildDecisionInsightModel({
        metricModels: buildBridgeMetricModels(),
        radiusMode: lastBridgeContext?.radiusMode,
        radii: lastBridgeContext?.radii,
      });
    },
    bridgeModel(metricId) {
      const models = buildBridgeMetricModels();
      return models ? models[metricId] : null;
    },
    // --- Spatial Window Sensitivity seam ---
    // Drives the REAL capture/reset controls and reports what the DOM actually
    // prints, so five-surface coherence regressions can compare the rendered
    // scenario side against the halo, the Bridge, the Insight and the table.
    captureSpatialBaseline() {
      document.getElementById("spatialSensitivityCapture").click();
    },
    resetSpatialBaseline() {
      document.getElementById("spatialSensitivityReset").click();
    },
    spatialSensitivity() {
      const host = document.getElementById("spatialSensitivity");
      const notice = document.getElementById("spatialSensitivityNotice");
      const reset = document.getElementById("spatialSensitivityReset");
      return {
        hidden: host.hasAttribute("hidden"),
        status: host.dataset.status || null,
        heading: document.getElementById("spatialSensitivityHeading").textContent.trim(),
        statusText: document.getElementById("spatialSensitivityStatus").textContent.trim(),
        guard: document.getElementById("spatialSensitivityGuard").textContent.trim(),
        emptyHidden: document.getElementById("spatialSensitivityEmpty").hasAttribute("hidden"),
        emptyText: document.getElementById("spatialSensitivityEmpty").textContent.trim(),
        noticeHidden: notice.hasAttribute("hidden"),
        noticeText: notice.textContent.trim(),
        windowsHidden: document.getElementById("spatialSensitivityWindows").hasAttribute("hidden"),
        baselineLabel: document.getElementById("ssBaselineLabel").textContent.trim(),
        baselineRadii: document.getElementById("ssBaselineRadii").textContent.trim(),
        scenarioLabel: document.getElementById("ssScenarioLabel").textContent.trim(),
        scenarioRadii: document.getElementById("ssScenarioRadii").textContent.trim(),
        captureLabel: document.getElementById("spatialSensitivityCapture").textContent.trim(),
        resetHidden: reset.hasAttribute("hidden"),
        resetLabel: reset.textContent.trim(),
        announcement: document.getElementById("spatialSensitivityA11y").textContent.trim(),
        items: [...document.querySelectorAll("#spatialSensitivityItems .ss-item")].map((row) => ({
          metricId: row.dataset.metricId,
          transition: row.dataset.transition,
          baselineDirection: row.dataset.baselineDirection,
          scenarioDirection: row.dataset.scenarioDirection,
          focused: row.dataset.focused,
          ariaCurrent: row.getAttribute("aria-current"),
          metric: row.querySelector(".ss-metric").textContent.trim(),
          baseline: row.querySelector('.ss-reading[data-side="baseline"] .ss-reading-value').textContent.trim(),
          baselineComparable: row.querySelector('.ss-reading[data-side="baseline"]').dataset.comparable,
          scenario: row.querySelector('.ss-reading[data-side="scenario"] .ss-reading-value').textContent.trim(),
          scenarioComparable: row.querySelector('.ss-reading[data-side="scenario"]').dataset.comparable,
          // The transition LABEL alone, read from its own text node, so a test
          // never conflates the conclusion with its supporting detail line.
          transitionText: row.querySelector(".ss-transition").firstChild.textContent.trim(),
          detail: row.querySelector(".ss-transition-detail")?.textContent.trim() || null,
        })),
      };
    },
    // The authoritative sensitivity MODEL for the current state, so a regression
    // can assert the rendered text never drifts from the model and that the
    // scenario side never drifts from the Bridge/Insight it is derived from.
    spatialSensitivityModel() {
      return buildSpatialSensitivityState();
    },
    spatialBaselineSnapshot() {
      return spatialBaseline;
    },
    // Drive the REAL accommodation-category transition. This exists because the
    // <select> is legitimately DISABLED whenever the packaged fallback carries
    // no accommodation type metadata — true of a clean CI checkout — so a test
    // that clicked the control would assert the deployment's data shape rather
    // than the invalidation contract. It calls the same setStayKindFilter()
    // production helper the real onchange handler calls, so the evidence-key
    // change, the layer rebuild and the re-render are the production ones; only
    // the disabled control is bypassed, never the state transition.
    setStayKindFilterForTest(kind) {
      setStayKindFilter(kind);
    },
    stayKindFilterValue() {
      return stayKindFilter;
    },
    // Both Lens centres, so an invalidation regression can prove the live
    // analytical geography was left untouched.
    lensCenters() {
      return { A: centerOf("A"), B: centerOf("B") };
    },
    // Read-only map centre + zoom. The AC-P0-12 device runner uses it to ATTRIBUTE
    // a frame-time sample to a genuine map pan (the Leaflet map centre actually
    // moved) rather than to any pointer event, and to scope pan-frame measurement
    // to the real pan interval. It only reads Leaflet state; it moves nothing and
    // runs no model, so it is safe to carry into a clean-`main` baseline worktree
    // as pure test instrumentation (it is not P0-a membership functionality).
    mapView() {
      const c = map.getCenter();
      return { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
    },
    // Move a Lens to a GEOGRAPHIC coordinate and recompute from real data. The
    // pixel-based moveLens() above depends on the current map view, which is the
    // wrong seam for a planning regression: an ámbito is a fixed place on the
    // ground, so the test has to be able to name it in degrees.
    moveLensToLatLng(which, lat, lon) {
      const latlng = L.latLng(Number(lat), Number(lon));
      lenses[which].marker.setLatLng(latlng);
      lenses[which].circle.setLatLng(latlng);
      refresh();
    },
    // Read-only view of the rendered planning-ámbito surface and of the model
    // behind it, so a regression can prove the DOM never drifts from the
    // evidence — and that the four published fields stay four, verbatim.
    planning() {
      const section = document.getElementById("planningAmbito");
      const phases = [...document.querySelectorAll("#planningPhases > li")].map((item) => ({
        kind: item.dataset.kind || null,
        field: item.querySelector(".planning-phase-field").textContent.trim(),
        value: item.querySelector(".planning-phase-value").textContent.trim(),
        note: item.querySelector(".planning-phase-note")?.textContent.trim() || null,
        borderStyle: getComputedStyle(item).borderLeftStyle,
      }));
      const uses = [...document.querySelectorAll("#planningBuildRows .planning-uses > li")].map((item) => ({
        valueState: item.dataset.valueState,
        label: item.querySelector(".planning-use-label").textContent.trim(),
        value: item.querySelector(".planning-use-value").textContent.trim(),
        unit: item.querySelector(".planning-use-unit")?.textContent.trim() || null,
      }));
      const containing = planningModel.index
        ? planningModel.index.ambitoContaining(centerOf(active).lon, centerOf(active).lat)
        : null;
      return {
        state: section.dataset.state || null,
        hidden: section.hasAttribute("hidden"),
        identityHidden: document.getElementById("planningIdentity").hasAttribute("hidden"),
        denomination: document.getElementById("planningDenomination").textContent.trim(),
        code: document.getElementById("planningCode").textContent.trim(),
        kindLabel: document.querySelector("#planningIdentity .planning-kind").textContent.trim(),
        distinction: document.querySelector("#planningIdentity .planning-distinction").textContent.trim(),
        edition: document.getElementById("planningEdition").textContent.trim(),
        outsideHidden: document.getElementById("planningOutside").hasAttribute("hidden"),
        outsideText: document.getElementById("planningOutside").textContent.trim(),
        phasesHidden: document.getElementById("planningPhasesBlock").hasAttribute("hidden"),
        phases,
        attributes: [...document.querySelectorAll("#planningAttributes dt")].map((dt, i) => ({
          label: dt.textContent.trim(),
          value: document.querySelectorAll("#planningAttributes dd")[i].textContent.trim(),
        })),
        buildHidden: document.getElementById("planningBuildBlock").hasAttribute("hidden"),
        buildScope: document.querySelector("#planningBuildBlock .planning-scope-note")?.textContent.trim() || null,
        uses,
        stateAbsent: document.getElementById("planningStateAbsent").hasAttribute("hidden")
          ? null
          : document.getElementById("planningStateAbsent").textContent.trim(),
        buildAbsent: document.getElementById("planningBuildAbsent").hasAttribute("hidden")
          ? null
          : document.getElementById("planningBuildAbsent").textContent.trim(),
        ceiling: document.querySelector("#planningAmbito .planning-ceiling").textContent.trim(),
        change: {
          visible: !document.getElementById("planningChange").hasAttribute("hidden"),
          dates: {
            previous: document.getElementById("planningChangePreviousDate").textContent.trim(),
            current: document.getElementById("planningChangeCurrentDate").textContent.trim(),
          },
          outcomes: [...document.querySelectorAll("#planningChangeOutcomes .planning-change-outcome")].map((item) => ({
            family: item.dataset.family,
            outcome: item.dataset.outcome,
            text: item.textContent.trim(),
          })),
          buildabilityState: planningModel.changeComparison?.buildability?.state || null,
          buildabilityText: document.getElementById("planningBuildComparison").textContent.trim(),
          citizenReading: planningModel.changeComparison
            ? planningModel.changeModule.projectAmbitoChangeReading(planningModel.changeComparison, "citizen")
            : null,
        },
        touched: [...document.querySelectorAll("#planningTouchedList > li")].map((item) => item.textContent.trim()),
        touchedCardHidden: document.getElementById("planningTouchedCard").hasAttribute("hidden"),
        // The promoted PLACE membership block (P0-a): its honest state, its count
        // line, its identity-only chips and the route to the full list.
        membership: (() => {
          const block = document.getElementById("planningMembership");
          const seeAll = document.getElementById("planningMembershipSeeAll");
          return {
            hidden: block.hidden,
            state: block.dataset.state || null,
            busy: block.getAttribute("aria-busy"),
            countText: document.getElementById("planningMembershipCount").textContent.trim(),
            chips: [...document.querySelectorAll("#planningMembershipChips > li")].map((li) => ({
              code: li.querySelector(".planning-touched-code")?.textContent.trim() || null,
              name: li.querySelector(".planning-membership-chip-name")?.textContent.trim() || null,
              containsCentre: Boolean(li.querySelector(".planning-touched-centre")),
              text: li.textContent.trim(),
            })),
            seeAllHidden: seeAll.hidden,
            seeAllText: seeAll.textContent.trim(),
          };
        })(),
        // The MODEL, so the test can assert the DOM against it rather than
        // against a hand-written expectation.
        model: containing
          ? {
              containing,
              developmentState: planningModel.index.developmentState(containing.ambitoCode),
              availableBuildability: planningModel.index.availableBuildability(containing.ambitoCode),
              membership: planningModel.index.ambitosIntersecting(
                centerOf(active).lon,
                centerOf(active).lat,
                radiusFor(active)
              ),
            }
          : null,
        mapLayerCode: planningLayer ? planningLayer.code : null,
        mapPane: planningLayer ? planningLayer.layer.options.pane : null,
      };
    },
    planningExplorerSnapshot() {
      const card = document.getElementById("planningExplorerCard");
      return {
        state: document.getElementById("planningExplorer")?.dataset.state || null,
        selectedCode: planningExplorer.selectedCode,
        selectedLayer: Boolean(planningExplorerLayer),
        cameraMoves: planningExplorer.cameraMoves,
        cardHidden: card?.hasAttribute("hidden") ?? true,
        results: [...document.querySelectorAll("#planningExplorerResults button")].map((button) => button.dataset.code),
      };
    },
    openPlaceDetailForTest() {
      const detail = document.getElementById("placeDetail");
      if (detail) detail.open = true;
      renderPlanningTouched();
      renderScopeRail();
    },
    // Drive the IDENTICAL coalescing path the real `dragstart`/`dragend` and the
    // slider `input`/`change` handlers take, so a regression can assert the honest
    // pending state during motion and the exact settle on release without having
    // to synthesise a flaky pointer drag. `begin` marks the Lens as moving (the
    // next refresh shows "updating"); `end` clears it and settles via refresh().
    beginPlanningMembershipInteraction,
    endPlanningMembershipInteraction,
    // The exact canonical membership the model returns right now, for the
    // freshness assertions (it is the same `ambitosIntersecting` the surface reads).
    planningMembershipNow() {
      if (planningState !== "ready" || !planningModel.index) return null;
      const centre = centerOf(active);
      return planningModel.index.ambitosIntersecting(centre.lon, centre.lat, radiusFor(active));
    },
    // A SIDE-EFFECT-FREE canonical membership query at an arbitrary point and
    // radius — it does not move the Lens or render. A boundary-crossing
    // regression uses it to search for a point just outside an ámbito whose
    // touched CODE SET is identical to a point just inside it, so the test can
    // then drive the real render at both and prove the centre mark is not stale.
    planningMembershipAt(lat, lon, radiusM) {
      if (planningState !== "ready" || !planningModel.index) return null;
      return planningModel.index.ambitosIntersecting(Number(lon), Number(lat), Number(radiusM));
    },
    // Drive the SHARED Bridge/Insight translator so both languages can be
    // asserted against the real render path. Test seam only: production keeps
    // following the document language, which this seam deliberately does NOT
    // touch — the document language is owned by the page, and the separate
    // hospitality context selector stays scoped to its own panel.
    setComparisonLanguage(language) {
      if (bridgeI18n) bridgeI18n.setLanguage(language);
      renderComparisonBridge();
      renderDecisionInsight();
      renderSpatialSensitivity();
    },
    // --- K10 ámbito comparison seam (test-only; drives the real render path) ---
    enterMode(mode) {
      shell.modes.setMode(mode);
    },
    ambitoSetScope(scope) {
      setCompareScope(scope);
    },
    ambitoSelect(slot, code) {
      const key = slot.toLowerCase();
      ambitoCompare[key] = isKnownAmbitoCode(code) ? code : null;
      const input = document.getElementById(slot === "A" || key === "a" ? "ambitoSelectA" : "ambitoSelectB");
      if (input) input.value = code || "";
      renderAmbitoCompare();
    },
    ambitoClickAt(lat, lon) {
      return handleAmbitoCompareMapClick({ lat, lng: lon });
    },
    ambitoFocus(metricId, lock = false) {
      ambitoFocusMetric(metricId, { lock });
    },
    // Page-pixel coordinate of a lat/lon on the rendered map, for real mouse
    // clicks in an end-to-end test (container point + the map's page offset).
    containerPointOf(lat, lon) {
      const point = map.latLngToContainerPoint([lat, lon]);
      const rect = map.getContainer().getBoundingClientRect();
      return { x: rect.left + point.x, y: rect.top + point.y };
    },
    lensLatLng(which) {
      const ll = lenses[which].marker.getLatLng();
      return { lat: ll.lat, lng: ll.lng };
    },
    setMapView(lat, lon, zoom) {
      map.setView([lat, lon], zoom, { animate: false, duration: 0 });
    },
    // A page pixel guaranteed to land on the open map tile layer (not the panel,
    // a control, a marker or a tooltip), biased to the left so it clears the
    // right-hand analysis panel. For real background-click tests.
    mapClickablePoint() {
      const rect = map.getContainer().getBoundingClientRect();
      const candidates = [[0.25, 0.55], [0.2, 0.4], [0.3, 0.62], [0.15, 0.5], [0.35, 0.45]];
      for (const [fx, fy] of candidates) {
        const x = Math.round(rect.left + rect.width * fx);
        const y = Math.round(rect.top + rect.height * fy);
        const el = document.elementFromPoint(x, y);
        if (el && el.closest(".leaflet-container") && !el.closest(".leaflet-marker-icon,.leaflet-tooltip,.leaflet-control,.leaflet-popup")) {
          return { x, y };
        }
      }
      return null;
    },
    ambitoState() {
      const compareLine = document.getElementById("compareLine");
      const read = (id) => (document.getElementById(id) ? document.getElementById(id).textContent.trim() : null);
      const hidden = (id) => (document.getElementById(id) ? document.getElementById(id).hasAttribute("hidden") : null);
      const idOf = (prefix) => ({
        code: read(`ambitoId${prefix}Code`),
        denom: read(`ambitoId${prefix}Denom`),
        date: read(`ambitoId${prefix}Date`),
      });
      return {
        scope: compareLine ? compareLine.dataset.compareScope : null,
        blockHidden: hidden("ambitoCompare"),
        bodyHidden: hidden("ambitoCompareBody"),
        refusalHidden: hidden("ambitoCompareRefusal"),
        refusalText: read("ambitoCompareRefusal"),
        radiusNote: read("ambitoRadiusNote"),
        scaleNote: read("ambitoScaleNote"),
        guard: read("ambitoCompareGuard"),
        a: idOf("A"),
        b: idOf("B"),
        categorical: [...document.querySelectorAll("#ambitoCatItems > li")].map((li) => ({
          metric: li.dataset.metric,
          relation: li.querySelector(".ambito-rel")?.dataset.relation || null,
          relationText: li.querySelector(".ambito-rel")?.textContent.trim() || null,
          values: li.querySelector(".ambito-cat-values")?.textContent.trim() || null,
        })),
        quantity: [...document.querySelectorAll("#ambitoQtyRows > tr")].map((tr) => {
          const cells = tr.querySelectorAll("td");
          const bars = [...tr.querySelectorAll(".ambito-bar-fill")].map((f) => f.style.width || null);
          return {
            metric: tr.dataset.metric,
            a: cells[0]?.textContent.trim() || null,
            b: cells[1]?.textContent.trim() || null,
            delta: cells[2]?.textContent.trim() || null,
            withheld: cells[2]?.classList.contains("ambito-withheld") || false,
            bars,
            metricMax: tr.querySelector(".ambito-bars")?.dataset.metricMax || null,
          };
        }),
        qtyDates: read("ambitoQtyDates"),
        insight: [...document.querySelectorAll("#ambitoInsightItems > li")].map((li) => ({
          metric: li.dataset.metric,
          state: li.dataset.state,
          reading: li.querySelector(".aii-reading")?.textContent.trim() || null,
        })),
        insightGuard: read("ambitoInsightGuard"),
        bridge: {
          emptyHidden: hidden("ambitoBridgeEmpty"),
          readingHidden: hidden("ambitoBridgeReading"),
          metric: read("ambitoBridgeMetric"),
          lockHidden: hidden("ambitoBridgeLock"),
          a: read("ambitoBridgeA"),
          b: read("ambitoBridgeB"),
          rel: read("ambitoBridgeRel"),
        },
        edition: [...document.querySelectorAll("#ambitoEditionItems > li")].map((li) => ({
          metric: li.dataset.metric,
          transition: li.dataset.transition,
          text: li.querySelector(".aei-transition")?.textContent.trim() || null,
        })),
        editionNote: hidden("ambitoEditionNote") ? null : read("ambitoEditionNote"),
        polygonCount: ambitoCompare.polygons ? ambitoCompare.polygons.filter((l) => l.getBounds).length : 0,
        // Per-slot official-polygon stroke style, A first then B, as drawn by
        // renderAmbitoComparePolygons: A solid (dashArray null), B dashed.
        polygonStyles: ambitoCompare.polygons
          ? ambitoCompare.polygons
              .filter((l) => l.getBounds)
              .map((group) => {
                const child = typeof group.getLayers === "function" ? group.getLayers()[0] : null;
                return { dashArray: (child && child.options ? child.options.dashArray : null) || null };
              })
          : [],
        circleBridgePresent: Boolean(document.getElementById("comparisonBridge")),
        circleTablePresent: Boolean(document.querySelector(".comparetable")),
      };
    },
    haloFocusedCount() {
      let count = 0;
      for (const which of ["A", "B"]) for (const marker of Object.values(comparisonHalos[which])) {
        if (marker._haloNodes?.svg?.classList.contains("halo-metric-focused")) count += 1;
      }
      return count;
    },
    // The raw value text a halo glyph is currently printing, read from the cached
    // node so Bridge/halo/table coherence can be checked even when the glyph is
    // collision-suppressed off the map.
    haloValueText(which, metricId) {
      const marker = comparisonHalos[which]?.[metricId];
      const text = marker?._haloNodes?.value?.textContent;
      return text == null ? null : text.trim();
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
    mapCenter() {
      const center = map.getCenter();
      return { lat: center.lat, lng: center.lng };
    },
    // K11 (#73) seam: read the live reading as the URL contract sees it, build the
    // canonical share URL, invoke the real copy path, and read the restore notice.
    k11State() { return k11CurrentState(); },
    k11Restored() { return Boolean(k11.restored); },
    k11Url() { return buildShareUrl(window.location.href, k11CurrentState()); },
    async k11Share() { return k11CopyShareLink(); },
    k11NoticeState() {
      const notice = document.getElementById("k11RestoreNotice");
      return {
        hidden: !notice || notice.hidden,
        title: document.getElementById("k11RestoreTitle")?.textContent || "",
        message: document.getElementById("k11RestoreMessage")?.textContent || "",
      };
    },
    k11Projection() { return k11BuildProjection(); },
    k11ExpectedSurfaces() {
      const mode = shell.modes ? shell.modes.currentMode() : "PLACE";
      return typeof surfaceKeysFor === "function" ? surfaceKeysFor(mode, currentFlags()) : [];
    },
    k11Bundle() {
      const projection = k11BuildProjection();
      return projection ? buildEvidenceBundle(projection, shell.registry, { now: new Date() }) : null;
    },
    k11Export() { return k11ExportEvidence(); },
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
  // The pedestrian reading lives in PLACE Detail: switching its layer on opens it.
  if (on) openPlaceDetail();
}

function setLayerVisible(name, on) {
  if (name === "hospitality") {
    setHospitalityVisible(on);
    renderRailGroupBadges();
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
  if (name === "licences") {
    syncLicencesUi(on);
    refresh();
  }
  renderRailGroupBadges();
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
  live: "LIVE",
  published: "DEPLOYMENT SNAPSHOT",
  snapshot: "SNAPSHOT SAMPLE",
  unavailable: "UNAVAILABLE",
};

function renderLayerSourceNote() {
  // Source status is operational metadata, not one new warning per layer.
  // Group equal states without erasing partial/unavailable distinctions; keep
  // the three interpretation ceilings one explicit disclosure away.
  const container = document.getElementById("layerSourceNote");
  const wasOpen = container.querySelector(".layer-source-disclosure")?.open ?? false;
  const labels = {
    museums: "Museums",
    info: "Tourist info",
    bikes: "BiciMAD",
    rail: "Metro & Cercanías",
    stays: "Hotels & stays",
  };
  const entries = Object.entries(layerStatus).filter(([key]) => Object.hasOwn(labels, key));
  const groups = new Map();
  for (const [name, status] of entries) {
    if (!groups.has(status)) groups.set(status, []);
    groups.get(status).push(labels[name]);
  }
  const statuses = entries.map(([, status]) => status);
  const all = (state) => statuses.length > 0 && statuses.every((status) => status === state);
  const preview = all("published") ? `${entries.length} layers · deployment snapshot`
    : all("live") ? `${entries.length} layers · live`
    : statuses.includes("unavailable") ? `${entries.length} layers · some unavailable`
    : statuses.includes("snapshot") ? `${entries.length} layers · partial sample`
    : `${entries.length} layers · mixed status`;

  const details = document.createElement("details");
  details.className = "layer-source-disclosure";
  details.open = wasOpen;
  const summary = document.createElement("summary");
  const heading = document.createElement("span");
  heading.className = "layer-source-heading";
  heading.textContent = "Sources & limits";
  const previewText = document.createElement("small");
  previewText.className = "layer-source-preview";
  previewText.textContent = preview;
  summary.append(heading, previewText);
  details.append(summary);

  const body = document.createElement("div");
  body.className = "layer-source-body";
  for (const status of ["published", "snapshot", "live", "unavailable"]) {
    const names = groups.get(status);
    if (!names?.length) continue;
    const group = document.createElement("section");
    group.className = "layer-source-group";
    group.dataset.status = status;
    const badge = document.createElement("strong");
    badge.className = "layer-source-status";
    badge.textContent = STATUS_LABEL[status];
    const namesList = document.createElement("ul");
    namesList.className = "layer-source-names";
    for (const name of names) {
      const item = document.createElement("li");
      item.textContent = name;
      namesList.append(item);
    }
    group.append(badge, namesList);
    const note = status === "published"
      ? "Deployment snapshots are generated from the public sources during the latest site deploy."
      : status === "snapshot"
        ? "Curated fallback counts are a partial sample, not a complete inventory."
        : null;
    if (note) {
      const explanation = document.createElement("p");
      explanation.textContent = note;
      group.append(explanation);
    }
    body.append(group);
  }

  function addContextStatus(label, status, warning) {
    const block = document.createElement("section");
    block.className = "layer-source-context";
    const title = document.createElement("span");
    title.className = "layer-source-context-label";
    title.textContent = label;
    const badge = document.createElement("strong");
    badge.className = "layer-source-status";
    badge.dataset.status = status;
    badge.textContent = STATUS_LABEL[status] ?? STATUS_LABEL.unavailable;
    const description = document.createElement("p");
    description.textContent = warning;
    block.append(title, badge, description);
    body.append(block);
  }
  addContextStatus("Observed pedestrian activity", pedestrianStatus,
    "Pedestrian counters are observed activity evidence, not tourist counts, and are excluded from POI/category-mix metrics.");
  addContextStatus("Principal parks (context)", parkStatus,
    "Park context is excluded from lens counts, category mix, nearest features and A/B comparisons.");
  const groupingNote = document.createElement("p");
  groupingNote.className = "layer-source-render-note";
  groupingNote.textContent = "Hotels & stays and BiciMAD are visually grouped below zoom 16; lens counts still use every record.";
  body.append(groupingNote);
  details.append(body);
  container.replaceChildren(details);
}

function renderHeatMetric(h) {
  const hv = document.getElementById("heatValue");
  const hf = document.getElementById("heatFoot");
  hv.style.color = "";

  if (!isHatiVisible()) {
    hv.textContent = "Off";
    hv.className = "metric-value abstain";
    hf.textContent = "enable HATI research evidence";
    return h;
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
  // K11 (#73): return the drawn projection so refresh() captures the SAME object
  // it rendered — the stats are computed once, never recomputed for the export.
  return h;
}

function renderPedestrianMetric(p) {
  const card = document.getElementById("pedestrianCard");
  const value = document.getElementById("pedestrianValue");
  const foot = document.getElementById("pedestrianFoot");
  if (!card || !value || !foot || !isPedestrianVisible()) return p;

  if (pedestrianStatus === "unavailable") {
    value.textContent = "No data";
    value.className = "activity-card-value abstain";
    foot.textContent = "deployment snapshot unavailable";
    return p;
  }

  if (p.evidence === "NONE") {
    value.textContent = "No sensor evidence";
    value.className = "activity-card-value abstain";
    foot.textContent = "no permanent pedestrian counter in lens";
    return p;
  }

  value.textContent = `${Math.round(p.meanObserved).toLocaleString("en-GB")} ${p.stationCount === 1 ? "ped/h" : "passages/hour"}`;
  value.className = "activity-card-value";
  foot.textContent = `${p.stationCount} counter${p.stationCount !== 1 ? "s" : ""} in current lens · ${formatLensRadius(radiusFor(active))} radius`;
  // K11 (#73): return the drawn projection so refresh() reuses it for the export
  // capture rather than recomputing pedestrianStatsFor(active) a second time.
  return p;
}

function renderMix(s) {
  const counts = { Museum: s.museum, Stay: s.stay, Bike: s.mobility, Info: s.info };
  const statuses = {
    Museum: layerStatus.museums,
    Stay: layerStatus.stays,
    Bike: combinedStatus(layerStatus, ["bikes", "rail"]),
    Info: layerStatus.info,
  };
  const mix = categoryMixState(counts, statuses);
  const { rows, label } = mix;
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
  // K11 (#73): return the frozen mix projection so refresh() can hand the SAME
  // object to the PLACE capture instead of computing categoryMixState twice.
  return mix;
}

function renderNearest(s) {
  document.getElementById("nearestList").innerHTML = s.nearest.length
    ? s.nearest
        .map(
          (p) =>
            `<li><i class="dot dot-${p.type} dot-inline"></i>${p.name}<em>${Math.round(p.d)} m</em></li>`
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
    // Spatial Sensitivity compares two A ↔ B window configurations, so turning
    // Lens B off removes the comparison the baseline described: the baseline is
    // dropped rather than kept against a reading that no longer exists.
    invalidateSpatialBaseline("evidence-changed");
    renderSpatialSensitivity();
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
  // Count-metric evidence inputs. In production these are the live stats; the
  // gated regression override (never set in production) may substitute
  // deterministic {value, sourceState} pairs so tests run the real builders
  // below against fixed evidence.
  const ov = comparisonEvidenceOverride;
  const tourismStatus = combinedStatus(layerStatus, ["museums", "info"]);
  const stayStatus = combinedStatus(layerStatus, ["stays"]);
  const liveMobilityStatus = combinedStatus(layerStatus, ["bikes", "rail"]);
  const tourismInput = ov?.tourism || { a: { value: a.tourism, sourceState: tourismStatus }, b: { value: b.tourism, sourceState: tourismStatus } };
  const stayInput = ov?.stays || { a: { value: a.stay, sourceState: stayStatus }, b: { value: b.stay, sourceState: stayStatus } };
  const mobilityInput = ov?.mobility || { a: { value: a.mobility, sourceState: liveMobilityStatus }, b: { value: b.mobility, sourceState: liveMobilityStatus } };
  const aoiState = ov?.aoiState ?? (radiusMode === "EQUAL_RADIUS" ? "not-required" : !aoiA || !aoiB || aoiA.state === "unavailable" || aoiB.state === "unavailable" ? "unavailable" : aoiA.eligible && aoiB.eligible ? "eligible" : aoiA.state === "outside" || aoiB.state === "outside" ? "outside" : "crosses");
  const comparison = buildHaloComparison({
    radiusMode, radii: { ...radii }, aoiState,
    references: getHaloReferences(), utciBand: getHaloUtciBand(),
    tourism: tourismInput,
    stays: stayInput,
    mobility: mobilityInput,
    // Same deterministic-override pattern as the three count metrics above: the
    // gated regression seam may substitute fixed UTCI evidence so tests exercise
    // the real utciState()/Bridge/Insight builders without depending on which
    // HATI samples happen to fall inside a lens. Null in production.
    utci: ov?.utci || { enabled: hatiOn, timestepA: timestep, timestepB: timestep, a: ha, b: hb },
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
  const mobilityStatus = mobilityInput.a.sourceState;
  const mobilityState = buildCountPairState(mobilityInput.a, mobilityInput.b, radiusMode);
  setComparisonRow("cmpMobility", mobilityState, "mobility");
  for (const side of ["A", "B"]) {
    const value = side === "A" ? mobilityState.aValue : mobilityState.bValue;
    document.getElementById(`cmpMobility${side}`).textContent = value == null ? "Unavailable" : `${value} nodes\nr ${formatLensRadius(radiusFor(side))}`;
  }
  // The Mobility relationship cell derives its withheld reason from the SAME
  // authoritative model the Comparison Bridge uses, so the two never disagree:
  // valid + unequal → "different window sizes"; unavailable/incompatible +
  // unequal → the evidence reason (which takes precedence over the window
  // mismatch, since no valid pair exists). Equal radii keep the existing numeric
  // / honest-unavailable cell.
  const mobilityView = buildComparisonBridgeModel({ metricId: "mobility", state: mobilityState, radiusMode, radii: { ...radii } });
  document.getElementById("cmpMobility").textContent = radiusMode === "UNEQUAL_RADIUS"
    ? bridgeWithheldText(mobilityView.relationship.withheldReasonCode)
    : comparisonDeltaCell(mobilityState, "mobility");
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
  // Capture the authoritative per-metric states for the Comparison Bridge. The
  // halo bar for mobility shows per-side density, but the panel (and therefore
  // the Bridge) withholds the mobility DELTA under unequal windows, so the
  // Bridge reads mobilityState — the same object the mobility table row uses.
  lastBridgeStates = { tourism: comparison.metrics.tourism, stays: comparison.metrics.stays, mobility: mobilityState, utci: comparison.metrics.utci };
  lastBridgeContext = { radiusMode, radii: { ...radii } };
  renderComparisonBridge();
  renderDecisionInsight();
  // Validity is enforced BEFORE the sensitivity model is built, so a baseline
  // whose lens centre or evidence configuration has changed is dropped rather
  // than compared as if only the radius had changed.
  enforceSpatialBaselineValidity();
  renderSpatialSensitivity();
  // Accessible Mobility relationship: same authoritative view-model as the Bridge and table.
  const mobilityRel = mobilityView.relationship;
  const mobilityAccessibleSentence = mobilityRel.comparable ? "" : `Mobility comparison ${bridgeT("withheld").toLowerCase()} · ${bridgeT(`reason.${mobilityRel.withheldReasonCode}`)}.`;
  const pointSummary = radiusMode === "EQUAL_RADIUS"
    ? `Tourism POIs raw counts ${a.tourism} and ${b.tourism}; stays raw counts ${a.stay} and ${b.stay}.`
    : `Tourism POIs raw counts ${a.tourism} and ${b.tourism}; stays raw counts ${a.stay} and ${b.stay}. ${comparison.metrics.tourism.comparable ? `Tourism rates ${comparison.metrics.tourism.aValue.toFixed(1)} and ${comparison.metrics.tourism.bValue.toFixed(1)} represented records per km²; delta ${comparison.metrics.tourism.delta.toFixed(1)}.` : comparison.metrics.tourism.qualifier}. ${comparison.metrics.stays.comparable ? `Stay rates ${comparison.metrics.stays.aValue.toFixed(1)} and ${comparison.metrics.stays.bValue.toFixed(1)} represented catalogue records per km²; delta ${comparison.metrics.stays.delta.toFixed(1)}.` : comparison.metrics.stays.qualifier} ${mobilityAccessibleSentence}`;
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
        group.lines.map((line) => `<span data-provenance-line>${line}</span>`).join("") +
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
  // K11 (#73): capture the active barrio's frozen profile (residents + VUT) for
  // the PLACE export transcript.
  if (typeof k11 !== "undefined") k11.placeArea = shown || null;
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
  // The rail names the resolved barrio and knows whether the VUT figure is shown.
  renderScopeRail();
}

function disableBoundaryControl() {
  const select = document.getElementById("boundarySelect");
  if (!select) return;
  select.disabled = true;
  select.title = "Administrative geography unavailable in this deployment";
}

// ============================ PLANNING ÁMBITO EVIDENCE (K6, #68) =============
//
// The official planning ámbito containing the active Lens centre, and what ONE
// dated official edition publishes about that WHOLE ámbito. The model and every
// rule live in js/planning-ambito.js; this section only loads the two committed
// artifacts, renders what the model returns, and draws the containing polygon.
//
// It never computes a quantity, never combines a planning figure with a Lens or
// barrio figure, and never asks the model for a share of an ámbito.

const planningModel = { module: null, explorerModule: null, index: null, changeModule: null, changePair: null, changeComparison: null };
let planningState = "loading";
let planningHint = null;
let lastPlanningRenderKey = null;
let planningLayer = null;
let planningRenderer = null;
let planningExplorerRenderer = null;
let planningExplorerLayer = null;
const planningExplorer = { query: "", results: [], selectedCode: null, cameraMoves: 0 };
// LENS_INTERSECT_AMBITO membership (UX-I1/P0-a, #95). Promoting the circle–ámbito
// scan into the always-visible PLACE planning section means it would otherwise run
// on every continuous `drag`/`oninput` event. Two guards keep that honest and cheap:
//   * an IDENTITY GUARD caches the last scan keyed on centre+radius, so a re-render
//     at an unchanged geometry (language switch, mode re-render, re-activation) reuses
//     the result and never re-scans; and
//   * COALESCING defers the scan while the Lens is actively moving — the surface shows
//     an explicit "updating" pending state, never a stale set — and settles to the
//     exact canonical membership on dragend, radius commit, map click and URL restore.
// `ambitosIntersecting` remains the ONLY membership computation; these are scheduling
// concerns and add no second geometry algorithm and no apportionment.
let planningMembershipCache = { key: null, result: null };
let planningMembershipInteracting = false;

async function loadPlanningContext() {
  let module;
  try {
    module = await import(moduleUrl("planning-ambito.js"));
  } catch (error) {
    planningState = "unavailable";
    console.warn("planning-ámbito module unavailable", error);
    renderPlanningContext();
    return;
  }
  planningModel.module = module;
  try {
    planningModel.explorerModule = await import(moduleUrl("planning-explorer.js"));
  } catch (error) {
    planningModel.explorerModule = null;
    console.warn("planning-ámbito explorer unavailable", error);
  }
  try {
    planningModel.changeModule = await import(moduleUrl("ambito-change.js"));
  } catch (error) {
    planningModel.changeModule = null;
    console.warn("planning-ámbito edition comparison unavailable", error);
  }

  // Settled, not all-or-nothing, and both artifacts are fetched ONCE: moving a
  // Lens performs an in-memory bounding-box scan and never a fetch. No official
  // planning service is contacted from the browser at any point.
  const [geometry, state] = await Promise.allSettled([
    fetchAreaJson("data/planning/madrid_ambitos.geojson"),
    fetchAreaJson("data/planning/madrid_ambito_state.json"),
  ]);
  const index = module.createPlanningIndex({
    geometry: settledValue(geometry),
    state: settledValue(state),
  });
  const stateArtifact = settledValue(state);
  planningModel.changePair = stateArtifact?.change_detection || null;
  if (!index) {
    planningState = "unavailable";
    console.warn("planning ámbito geometry unavailable", geometry.reason || "no ámbito features");
  } else {
    planningModel.index = index;
    planningState = "ready";
    if (state.status !== "fulfilled") {
      // The geometry resolves the place; the edition supplies the published
      // state. An absent edition leaves the identity standing and the states
      // explicitly not published, rather than losing the ámbito as well.
      console.warn("planning ámbito published state unavailable", state.reason);
    }
  }
  renderPlanningContext();
  renderPlanningExplorer();
  renderScopeRail();
  // A user may have opened the ámbito-comparison scope before the planning
  // artifacts finished loading; now that they are ready, populate and render.
  if (typeof refreshAmbitoCompareData === "function") refreshAmbitoCompareData();
}

function planningContaining() {
  if (planningState !== "ready" || !planningModel.index) return null;
  const centre = centerOf(active);
  const result = planningModel.index.ambitoContaining(centre.lon, centre.lat, planningHint);
  planningHint = result.ambitoCode;
  return result;
}

// "2026-01-01" -> "1 Jan 2026" / "1 ene. 2026". Localised through the shell
// dictionary so the planning surface follows the document language like the
// rest of K6's product-authored copy. Official VALUES are never localised.
function planningDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
  if (match) return `${Number(match[3])} ${shellT(`month.${Number(match[2])}`)} ${match[1]}`;
  const month = /^(\d{4})-(\d{2})$/.exec(String(isoDate || ""));
  if (month) return `${shellT(`month.${Number(month[2])}`)} ${month[1]}`;
  return null;
}

// Displayed figures are rounded; each published value is carried in full in the
// artifact and reachable through Evidence & limits. Buildability keeps two
// decimal places because the publisher states some figures to that precision;
// an ámbito surface is land area and reads in whole square metres. Neither rule
// invents precision and neither turns a missing value into a number.
function planningFigure(value, maximumFractionDigits) {
  if (!Number.isFinite(value)) return null;
  return value.toLocaleString("en-GB", { maximumFractionDigits });
}

function planningObservedDifference(value) {
  if (!Number.isFinite(value)) return null;
  const magnitude = Math.abs(value);
  if (magnitude === 0 || magnitude >= 0.005) return planningFigure(value, 2);
  // Keep a small but published non-zero difference from rounding to “0.00”.
  const fractionDigits = Math.min(15, Math.max(2, Math.ceil(-Math.log10(magnitude)) + 1));
  return planningFigure(value, fractionDigits);
}

function planningExplorerEditions() {
  return planningModel.explorerModule.planningEvidenceEditions(planningModel.index).map(({ family, referenceDate }) => [
    family === "developmentState" ? "planning.explorer.developmentEdition" : "planning.explorer.buildabilityEdition",
    planningDate(referenceDate),
  ]);
}

function appendPlanningPhaseRow(list, phase) {
  const { VALUE_STATE, PHASE_KIND, PHASE_VOCABULARY } = planningModel.module;
  const item = document.createElement("li");
  item.dataset.kind = phase.kind || "";
  const field = document.createElement("span");
  field.className = "planning-phase-field";
  field.textContent = shellT(`planning.phase.${phase.key}`);
  const value = document.createElement("span");
  value.className = "planning-phase-value";
  if (phase.kind === PHASE_KIND.UNRESOLVED_MEANING || phase.kind === PHASE_KIND.PLAN_ORIGIN_MARKER) {
    const mark = document.createElement("span");
    mark.className = "planning-phase-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = phase.kind === PHASE_KIND.UNRESOLVED_MEANING ? "?" : "§";
    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = `${shellT(phase.kind === PHASE_KIND.UNRESOLVED_MEANING ? "planning.glyph.unresolved" : "planning.glyph.marker")}: `;
    value.append(label, mark);
  }
  const verbatim = document.createElement("span");
  verbatim.dataset.verbatim = "";
  verbatim.textContent = phase.state === VALUE_STATE.PUBLISHED ? phase.sourceValue : "";
  if (phase.state !== VALUE_STATE.PUBLISHED) {
    verbatim.removeAttribute("data-verbatim");
    verbatim.textContent = shellT("planning.notPublished");
  }
  value.append(verbatim);
  item.append(field, value);
  const notes = [];
  if (phase.kind === PHASE_KIND.UNRESOLVED_MEANING) notes.push(shellT("planning.note.unresolved"));
  if (phase.kind === PHASE_KIND.PLAN_ORIGIN_MARKER) notes.push(shellT("planning.note.marker"));
  if (phase.vocabulary === PHASE_VOCABULARY.SOURCE_OBSERVED_NOT_DOCUMENTED) notes.push(shellT("planning.note.undocumented"));
  if (notes.length) {
    const note = document.createElement("p");
    note.className = "planning-phase-note";
    note.textContent = notes.join(" ");
    item.append(note);
  }
  list.append(item);
}

function renderPlanningExplorerEvidence(inspection) {
  const phases = document.getElementById("planningExplorerPhases"), phaseRows = document.getElementById("planningExplorerPhaseRows"), stateAbsent = document.getElementById("planningExplorerStateAbsent"), build = document.getElementById("planningExplorerBuild"), buildRows = document.getElementById("planningExplorerBuildRows"), buildAbsent = document.getElementById("planningExplorerBuildAbsent");
  if (!phases || !phaseRows || !stateAbsent || !build || !buildRows || !buildAbsent) return;
  phaseRows.replaceChildren(); buildRows.replaceChildren(); phases.hidden = true; stateAbsent.hidden = true; build.hidden = true; buildAbsent.hidden = true;
  const { AVAILABILITY } = planningModel.module;
  if (inspection.developmentState?.availability === AVAILABILITY.PUBLISHED) {
    phases.hidden = false;
    for (const phase of inspection.developmentState.phases) appendPlanningPhaseRow(phaseRows, phase);
  } else { stateAbsent.hidden = false; stateAbsent.textContent = `${shellT("planning.stateNotPublished")} ${shellT("planning.absenceNote")}`; }
  if (inspection.availableBuildability?.availability === AVAILABILITY.PUBLISHED) {
    build.hidden = false;
    if (inspection.availableBuildability.publication === planningModel.module.BUILDABILITY_PUBLICATION.MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED) {
      const note = document.createElement("p");
      note.className = "planning-block-note";
      note.textContent = shellT("planning.multipleRows");
      buildRows.append(note);
    }
    for (const row of inspection.availableBuildability.rows) {
      const wrap = document.createElement("div"), list = document.createElement("ul"); wrap.className = "planning-build-row"; list.className = "planning-uses";
      if (row.situacion) { const p = document.createElement("p"); p.className = "planning-situacion"; p.textContent = `${shellT("planning.situacionLabel")}: ${row.situacion}`; p.dataset.verbatim = ""; wrap.append(p); }
      for (const useClass of row.useClasses) {
        const item = document.createElement("li"), label = document.createElement("span"), value = document.createElement("span"); item.dataset.valueState = useClass.state;
        label.className = "planning-use-label"; label.textContent = shellT(`planning.use.${useClass.key}`);
        value.className = "planning-use-value"; value.textContent = useClass.state === planningModel.module.VALUE_STATE.PUBLISHED ? `${planningFigure(useClass.value, 2)} ${useClass.unit}` : shellT("planning.notPublished");
        item.append(label, value); list.append(item);
      }
      wrap.append(list); buildRows.append(wrap);
    }
  } else { buildAbsent.hidden = false; buildAbsent.textContent = `${shellT("planning.buildNotPublished")} ${shellT("planning.absenceNote")}`; }
}

function clearPlanningExplorer() {
  planningExplorer.query = "";
  planningExplorer.results = [];
  planningExplorer.selectedCode = null;
  const query = document.getElementById("planningExplorerQuery");
  if (query) query.value = "";
  renderPlanningExplorerPolygon();
  renderPlanningExplorer();
}

function selectPlanningExplorerAmbito(code) {
  if (planningState !== "ready" || !planningModel.index || !planningModel.index.featureFor(code)) return false;
  planningExplorer.selectedCode = code;
  renderPlanningExplorerPolygon();
  renderPlanningExplorer();
  return true;
}

function renderPlanningExplorer() {
  const host = document.getElementById("planningExplorer");
  const input = document.getElementById("planningExplorerQuery");
  const status = document.getElementById("planningExplorerStatus");
  const results = document.getElementById("planningExplorerResults");
  const card = document.getElementById("planningExplorerCard");
  if (!host || !input || !status || !results || !card) return;
  // Refreshes happen after Lens movement and language changes. If a result was
  // focused, restore that exact native button after its text is rebuilt; focus
  // never falls back to the document merely because labels changed.
  const focusedCode = document.activeElement?.matches?.("#planningExplorerResults button")
    ? document.activeElement.dataset.code
    : null;
  const ready = planningState === "ready" && planningModel.index && planningModel.explorerModule;
  host.dataset.state = ready ? "ready" : planningState;
  input.disabled = !ready;
  results.replaceChildren();
  card.hidden = true;
  if (!ready) {
    status.textContent = planningState === "loading" ? shellT("planning.explorer.loading") : shellT("planning.explorer.unavailable");
    return;
  }
  const search = planningModel.explorerModule.searchPlanningAmbitos(planningModel.index, planningExplorer.query);
  planningExplorer.results = search.results;
  status.textContent = search.state === "empty" ? shellT("planning.explorer.empty")
    : search.state === "not_found" ? shellT("planning.explorer.notFound") : "";
  for (const entry of search.results) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "planning-explorer-result";
    button.dataset.code = entry.code;
    button.setAttribute("aria-label", shellT("planning.explorer.result").replace("{code}", entry.code));
    const code = document.createElement("code");
    code.textContent = entry.code;
    const denomination = document.createElement("span");
    denomination.textContent = entry.denomination || entry.code;
    button.append(code, denomination);
    button.addEventListener("click", () => selectPlanningExplorerAmbito(entry.code));
    item.append(button);
    results.append(item);
  }
  if (focusedCode) {
    const replacement = [...results.querySelectorAll("button")].find((button) => button.dataset.code === focusedCode);
    if (replacement) replacement.focus({ preventScroll: true });
  }
  const inspection = planningExplorer.selectedCode && planningModel.explorerModule.planningInspection(planningModel.index, planningExplorer.selectedCode);
  if (!inspection) return;
  card.hidden = false;
  setText("planningExplorerCode", inspection.code);
  setText("planningExplorerDenomination", inspection.denomination || "");
  setText("planningExplorerScope", shellT("planning.explorer.scope"));
  const editions = inspection.editions.map(({ family, referenceDate }) => [family === "developmentState" ? "planning.explorer.developmentEdition" : "planning.explorer.buildabilityEdition", planningDate(referenceDate)]);
  setText("planningExplorerEdition", editions.length
    ? editions.map(([key, date]) => shellT(key).replace("{date}", date)).join(" · ")
    : shellT("planning.explorer.editionUnavailable"));
  renderPlanningExplorerEvidence(inspection);
}

function renderPlanningExplorerPolygon() {
  if (planningExplorerLayer) {
    map.removeLayer(planningExplorerLayer);
    planningExplorerLayer = null;
  }
  if (!planningExplorer.selectedCode || !planningModel.index) return;
  const feature = planningModel.index.featureFor(planningExplorer.selectedCode);
  if (!feature) return;
  if (!planningExplorerRenderer) planningExplorerRenderer = L.canvas({ pane: "planningExplorerPane", padding: 0.3 });
  planningExplorerLayer = L.geoJSON(feature, {
    pane: "planningExplorerPane", renderer: planningExplorerRenderer, interactive: false,
    style: () => ({ color: PLANNING_STROKE, weight: 3, opacity: 1, fill: true, fillColor: PLANNING_STROKE, fillOpacity: 0.14 }),
  }).addTo(map);
}

function showPlanningExplorerOnMap() {
  if (!planningExplorerLayer) return false;
  map.fitBounds(planningExplorerLayer.getBounds(), { padding: [32, 32], maxZoom: 15, animate: false });
  planningExplorer.cameraMoves += 1;
  return true;
}

function renderPlanningContext() {
  const section = document.getElementById("planningAmbito");
  if (!section) return;
  const containing = planningContaining();
  const key = [
    planningState,
    active,
    containing && containing.state,
    containing && containing.ambitoCode,
    document.documentElement.lang,
  ].join("|");

  renderPlanningPolygon(containing);
  renderPlanningExplorer();
  // Membership (LENS_INTERSECT_AMBITO) depends on the Lens position and radius,
  // not on which ámbito contains the centre, so both the promoted PLACE block
  // and the Detail full list are refreshed on every render — each guarded so the
  // 724-polygon scan runs at most once per changed geometry and never on a moving
  // Lens (see the membership block above).
  renderPlanningMembership();
  renderPlanningTouched();
  if (key === lastPlanningRenderKey) return;
  lastPlanningRenderKey = key;

  section.hidden = false;
  section.dataset.state = planningState === "ready" ? (containing ? containing.state : "unavailable") : planningState;

  const identity = document.getElementById("planningIdentity");
  const outside = document.getElementById("planningOutside");
  const phasesBlock = document.getElementById("planningPhasesBlock");
  const stateAbsent = document.getElementById("planningStateAbsent");
  const attributes = document.getElementById("planningAttributes");
  const buildBlock = document.getElementById("planningBuildBlock");
  const buildAbsent = document.getElementById("planningBuildAbsent");
  const citizen = document.getElementById("planningCitizen");
  const toggle = document.getElementById("planningSourceToggle");

  const resolved = containing && containing.state === planningModel.module.AMBITO_STATE.RESOLVED;
  identity.hidden = !resolved;
  phasesBlock.hidden = true;
  buildBlock.hidden = true;
  attributes.hidden = true;
  stateAbsent.hidden = true;
  buildAbsent.hidden = true;
  citizen.hidden = !resolved;
  toggle.hidden = false;

  if (!resolved) {
    // An explicit state in words, and the three absences stay three different
    // facts: still loading, unavailable in this deployment, and genuinely
    // outside every production ámbito. Never a blank, never a zero, never the
    // nearest ámbito.
    outside.hidden = false;
    if (planningState === "loading") outside.textContent = shellT("planning.loading");
    else if (planningState !== "ready" || !containing) outside.textContent = shellT("planning.unavailable");
    else outside.textContent = shellT("planning.outside");
    // The identity is cleared, not merely hidden: a stale official code left in
    // the DOM is a code attached to the wrong place, even unseen.
    setText("planningDenomination", "");
    setText("planningCode", "");
    setText("planningEdition", "");
    document.getElementById("planningPhases").replaceChildren();
    document.getElementById("planningBuildRows").replaceChildren();
    document.getElementById("planningAttributes").replaceChildren();
    renderPlanningChange(null);
    if (typeof k11 !== "undefined") k11.placePlanningModel = null;
    return;
  }
  outside.hidden = true;

  setText("planningDenomination", containing.denomination);
  setText("planningCode", containing.ambitoCode);

  const state = planningModel.index.developmentState(containing.ambitoCode);
  const buildability = planningModel.index.availableBuildability(containing.ambitoCode);
  const { AVAILABILITY, VALUE_STATE } = planningModel.module;

  // K11 (#73): capture the containing ámbito's planning figures for the PLACE
  // export by REUSING the authoritative comparison model on a single-ámbito
  // self-input — the published single-sided values (with correct S1/S2 family)
  // are read from each metric's `.a` side. No K6 internals are re-read here.
  if (typeof k11 !== "undefined") {
    try {
      const input = { scope: "PLANNING_AMBITO", ambitoCode: containing.ambitoCode, denomination: containing.denomination, developmentState: state, availableBuildability: buildability };
      k11.placePlanningModel = typeof buildAmbitoComparisonModel === "function" ? buildAmbitoComparisonModel(input, input) : null;
    } catch (error) {
      k11.placePlanningModel = null;
    }
  }

  // The edition reference date, next to the evidence it dates.
  const editionDate = planningDate(state.edition && state.edition.referenceDate);
  setText(
    "planningEdition",
    editionDate ? `${shellT("planning.editionLabel")} ${editionDate} · ${shellT("planning.editionSuffix")}` : ""
  );

  // ---- four independent published fields -----------------------------------
  if (state.availability === AVAILABILITY.PUBLISHED) {
    phasesBlock.hidden = false;
    const list = document.getElementById("planningPhases");
    list.replaceChildren();
    for (const phase of state.phases) appendPlanningPhaseRow(list, phase);

    // Characteristic use, published surface and the edition's district.
    attributes.replaceChildren();
    const addAttribute = (labelKey, text, verbatim) => {
      if (!text) return;
      const dt = document.createElement("dt");
      dt.textContent = shellT(labelKey);
      const dd = document.createElement("dd");
      if (verbatim) dd.dataset.verbatim = "";
      dd.textContent = text;
      attributes.append(dt, dd);
    };
    addAttribute("planning.useLabel", state.characteristicUse, true);
    const surface =
      state.surface && state.surface.state === VALUE_STATE.PUBLISHED
        ? planningFigure(state.surface.value, 0)
        : null;
    addAttribute("planning.surfaceLabel", surface ? `${surface} ${state.surface.unit}` : null, false);
    addAttribute(
      "planning.districtLabel",
      state.district && state.district.name ? `${state.district.name} (${state.district.code})` : null,
      true
    );
    attributes.hidden = attributes.childElementCount === 0;
  } else {
    stateAbsent.hidden = false;
    stateAbsent.textContent = `${shellT("planning.stateNotPublished")} ${shellT("planning.absenceNote")}`;
  }

  // ---- available buildability ----------------------------------------------
  if (buildability.availability === AVAILABILITY.PUBLISHED) {
    buildBlock.hidden = false;
    const rows = document.getElementById("planningBuildRows");
    rows.replaceChildren();
    if (buildability.publication === planningModel.module.BUILDABILITY_PUBLICATION.MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED) {
      const note = document.createElement("p");
      note.className = "planning-block-note";
      note.textContent = shellT("planning.multipleRows");
      rows.append(note);
    }
    for (const row of buildability.rows) {
      const wrap = document.createElement("div");
      wrap.className = "planning-build-row";
      if (row.situacion) {
        const situacion = document.createElement("p");
        situacion.className = "planning-situacion";
        const label = document.createElement("span");
        label.textContent = `${shellT("planning.situacionLabel")}: `;
        const verbatim = document.createElement("span");
        verbatim.dataset.verbatim = "";
        verbatim.textContent = row.situacion;
        situacion.append(label, verbatim);
        wrap.append(situacion);
      }
      const list = document.createElement("ul");
      list.className = "planning-uses";
      for (const useClass of row.useClasses) {
        const item = document.createElement("li");
        item.dataset.valueState = useClass.state;
        const label = document.createElement("span");
        label.className = "planning-use-label";
        label.textContent = shellT(`planning.use.${useClass.key}`);
        const figure = document.createElement("span");
        figure.className = "planning-use-figure";
        const value = document.createElement("span");
        value.className = "planning-use-value";
        if (useClass.state === VALUE_STATE.PUBLISHED) {
          // The value and its unit are rendered together, always. There is no
          // code path here that emits a bare number.
          value.textContent = planningFigure(useClass.value, 2);
          const unit = document.createElement("span");
          unit.className = "planning-use-unit";
          unit.dataset.verbatim = "";
          unit.textContent = useClass.unit;
          figure.append(value, unit);
        } else {
          // Not published. A distinct state, in words, and never a 0.
          value.textContent = shellT("planning.notPublished");
          figure.append(value);
        }
        item.append(label, figure);
        list.append(item);
      }
      wrap.append(list);
      rows.append(wrap);
    }
  } else {
    buildAbsent.hidden = false;
    buildAbsent.textContent = `${shellT("planning.buildNotPublished")} ${shellT("planning.absenceNote")}`;
  }
  renderPlanningChange(containing.ambitoCode);
}

function planningChangeLabel(outcome) {
  const keys = {
    NO_CHANGE: "planning.change.noChange",
    STATE_TRANSITION: "planning.change.state",
    NEW_AMBITO: "planning.change.new",
    ABSENT_FROM_EDITION: "planning.change.absent",
    MODIFIED_BY_INSTRUMENT: "planning.change.instrument",
    CAUSE_UNRESOLVED: "planning.change.unresolved",
    NON_COMPARABLE: "planning.change.nonComparable",
  };
  return shellT(keys[outcome] || "planning.change.nonComparable");
}

function planningChangeUiState(outcome) {
  return ({
    NO_CHANGE: "NO_CHANGE",
    STATE_TRANSITION: "PUBLISHED_STATE_CHANGED",
    NEW_AMBITO: "NEW_IN_EDITION",
    ABSENT_FROM_EDITION: "ABSENT_FROM_EDITION",
    MODIFIED_BY_INSTRUMENT: "MODIFIED_BY_PLANNING_INSTRUMENT",
    CAUSE_UNRESOLVED: "CAUSE_UNRESOLVED",
    NON_COMPARABLE: "NON_COMPARABLE",
  })[outcome] || "NON_COMPARABLE";
}

const PLANNING_CHANGE_MODEL_COPY = Object.freeze([
  ["Both named edition records are required.", "planning.change.reason.pairRecords"],
  ["The editions do not identify the same source family.", "planning.change.reason.familyMismatch"],
  ["Both source-stated reference dates are required.", "planning.change.reason.datesMissing"],
  ["The named editions must have distinct, ordered reference dates.", "planning.change.reason.datesOrder"],
  ["Both edition identities and full fingerprints are required.", "planning.change.reason.identityMissing"],
  ["The same edition cannot be supplied twice.", "planning.change.reason.sameEdition"],
  ["The editions belong to different or unspecified schema eras.", "planning.change.reason.eraMismatch"],
  ["Both edition record sets are required.", "planning.change.reason.recordsMissing"],
  ["Duplicate situation labels prevent a defensible one-to-one row correspondence.", "planning.change.reason.duplicateSituations"],
  ["A published row has no usable SITUACION DEL ÁMBITO identity.", "planning.change.reason.rowSituationMissing"],
  ["One or more published rows have no counterpart in the other edition.", "planning.change.reason.rowUnmatched"],
  ["A dated, applicable planning instrument event is documented for a compared field.", "planning.change.reason.instrumentDocumented"],
  ["An exact edition-scoped ámbito code is required.", "planning.change.reason.scopedCodeRequired"],
  ["Neither named edition publishes a record for this exact code.", "planning.change.reason.noRecordsForCode"],
  ["The exact code is present in the later named edition and absent from the earlier named edition.", "planning.change.reason.codeAppearsLater"],
  ["The exact code is present in the earlier named edition and absent from the later named edition.", "planning.change.reason.codeAbsentLater"],
  ["A phase record does not carry the four required published fields.", "planning.change.reason.phaseFieldsMissing"],
  ["A published row set is malformed and cannot be classified.", "planning.change.reason.rowSetMalformed"],
  ["The source family has no K7 classifier contract.", "planning.change.reason.noClassifierContract"],
  ["One or more published S1 phase values differ between the editions.", "planning.change.reason.phaseValuesDiffer"],
  ["The sole published S2 situation value differs between the editions.", "planning.change.reason.situationDiffers"],
  ["One or more published S2 rows has no defensible counterpart; the editions do not establish a planning event.", "planning.change.reason.s2Counterpart"],
  ["A substantive published note differs and the editions do not establish why.", "planning.change.reason.noteCauseUnknown"],
  ["No substantive difference was detected in the fields with a defensible comparison.", "planning.change.reason.noSubstantiveDifference"],
  ["An exact edition-scoped code is required.", "planning.change.reason.codeRequired"],
  ["Absent from the earlier edition and present in the later edition.", "planning.change.reason.laterOnly"],
  ["Present in the earlier edition and absent from the later edition.", "planning.change.reason.earlierOnly"],
  ["Duplicate situation labels prevent a defensible numeric row match.", "planning.change.reason.numericDuplicate"],
  ["A row lacks a usable published situation identity.", "planning.change.reason.numericSituationMissing"],
  ["One or more rows has no one-to-one counterpart; numeric comparison is withheld for those rows.", "planning.change.reason.numericUnmatched"],
  ["The edition pair is not comparable.", "planning.change.reason.pairNotComparable"],
  ["Both named editions must publish S2 rows for this exact code.", "planning.change.reason.buildabilityRowsMissing"],
  ["Both editions must publish numeric values for the same documented use class; blank is not zero.", "planning.change.reason.numericValuesRequired"],
  ["This published row has no defensible counterpart in the other edition.", "planning.change.reason.unmatchedRow"],
  ["At least one numeric comparison is withheld.", "planning.change.reason.someNumericWithheld"],
  ["Comparison may not be like-for-like across this planning instrument modification.", "planning.change.caveat"],
]);

function localizePlanningChangeModelCopy(value) {
  let text = String(value);
  text = text.replace(/Withheld across ([^;]+); the published values may not be like-for-like\./g, (_all, reference) =>
    shellT("planning.change.reason.instrumentNumeric").replace("{reference}", reference));
  for (const [english, key] of PLANNING_CHANGE_MODEL_COPY) text = text.replaceAll(english, shellT(key));
  return text;
}

function localizePlanningChangeAnalyst(value, key = null) {
  if (Array.isArray(value)) return value.map((entry) => localizePlanningChangeAnalyst(entry, key === "reasons" ? "reason" : key));
  if (value && typeof value === "object") {
    if (["absenceReason", "sourceVerbatim", "sourceEvidence", "situationVerbatim", "verbatimPhaseValues"].includes(key) || key?.endsWith("Verbatim")) return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      localizePlanningChangeAnalyst(child, key === "reasons" ? "reason" : childKey),
    ]));
  }
  if (typeof value !== "string") return value;
  if (key === "matchingBasis") return shellT("planning.change.matchingBasis");
  if (key === "basis" && value === "Exact code plus a unique, stable SITUACION DEL ÁMBITO value within each edition.") {
    return shellT("planning.change.matchingBasis");
  }
  if (key === "reason" || key === "modificationCaveat") return localizePlanningChangeModelCopy(value);
  return value;
}

function planningChangeText(parent, className, text, verbatim = false) {
  const node = document.createElement("p");
  if (className) node.className = className;
  if (verbatim) node.dataset.verbatim = "";
  node.textContent = verbatim ? text : localizePlanningChangeModelCopy(text);
  parent.append(node);
  return node;
}

function renderPlanningChange(exactCode) {
  const section = document.getElementById("planningChange");
  if (!section) return;
  const pair = planningModel.changePair;
  const module = planningModel.changeModule;
  if (!exactCode || !pair || !module || !pair.previous || !pair.current) {
    section.hidden = true;
    planningModel.changeComparison = null;
    if (typeof k11 !== "undefined") k11.placeChange = null;
    document.getElementById("planningChangeOutcomes").replaceChildren();
    document.getElementById("planningBuildComparison").replaceChildren();
    document.getElementById("planningChangeAnalystBody").replaceChildren();
    return;
  }
  const previous = { reference_date: pair.previous.reference_date, families: pair.previous.families };
  const current = { reference_date: pair.current.reference_date, families: pair.current.families };
  const comparison = module.buildAmbitoComparison({ previous, current, exactCode });
  const citizen = module.projectAmbitoChangeReading(comparison, "citizen");
  const analyst = module.projectAmbitoChangeReading(comparison, "analyst");
  planningModel.changeComparison = comparison;
  // K11 (#73): capture the SAME frozen K7 edition-change comparison the panel
  // renders, for the PLACE export (edition-change classifications + the
  // defensible buildability differences, each with its withholding reason). No
  // recomputation — the comparison object computed just above is reused.
  if (typeof k11 !== "undefined") {
    k11.placeChange = Object.freeze({
      exactCode,
      comparabilityVerdict: comparison.comparabilityVerdict,
      dates: comparison.dates,
      state: comparison.state,
      buildability: comparison.buildability,
    });
  }
  section.hidden = false;
  section.dataset.state = comparison.comparabilityVerdict;
  const previousDate = planningDate(comparison.dates.previous);
  const currentDate = planningDate(comparison.dates.current);
  setText("planningChangePreviousDate", previousDate || shellT("date.notPublished"));
  setText("planningChangeCurrentDate", currentDate || shellT("date.notPublished"));

  const outcomes = document.getElementById("planningChangeOutcomes");
  outcomes.replaceChildren();
  for (const [family, result] of Object.entries(comparison.state)) {
    const card = document.createElement("article");
    card.className = "planning-change-outcome";
    card.dataset.family = family;
    card.dataset.outcome = result.outcome;
    card.dataset.state = planningChangeUiState(result.outcome);
    const heading = document.createElement("h3");
    heading.textContent = `${family} · ${shellT(`planning.change.outcome.${family.toLowerCase()}`)}`;
    card.append(heading);
    const label = document.createElement("p");
    label.className = "planning-change-label";
    const datePair = `${previousDate || "—"} · ${currentDate || "—"}`;
    if (result.outcome === "NO_CHANGE") {
      label.textContent = planningChangeLabel(result.outcome)
        .replace("{previous}", previousDate || "—")
        .replace("{current}", currentDate || "—");
    } else {
      label.textContent = `${planningChangeLabel(result.outcome)} · ${datePair}`;
    }
    card.append(label);
    if (result.outcome === "STATE_TRANSITION") {
      const differences = result.evidence?.phaseDifferences || result.evidence?.situationDifferences || [];
      for (const difference of differences) {
        const row = document.createElement("div");
        row.className = "planning-change-values";
        const title = document.createElement("span");
        title.textContent = ["planeamiento", "gestion", "urbanizacion_proyecto", "urbanizacion_obras"].includes(difference.field)
          ? shellT(`planning.phase.${difference.field}`)
          : shellT("planning.change.situation");
        const before = document.createElement("span");
        before.dataset.verbatim = "";
        before.textContent = difference.previous ?? "";
        const after = document.createElement("span");
        after.dataset.verbatim = "";
        after.textContent = difference.current ?? "";
        const beforeLabel = document.createElement("small");
        beforeLabel.textContent = shellT("planning.change.previousValue");
        const afterLabel = document.createElement("small");
        afterLabel.textContent = shellT("planning.change.currentValue");
        row.append(title, beforeLabel, before, afterLabel, after);
        card.append(row);
      }
    } else if (result.outcome === "NEW_AMBITO" || result.outcome === "ABSENT_FROM_EDITION") {
      const memberDate = result.outcome === "NEW_AMBITO" ? currentDate : previousDate;
      planningChangeText(card, "planning-change-detail", `${result.outcome === "NEW_AMBITO" ? shellT("planning.change.current") : shellT("planning.change.previous")}: ${memberDate || "—"}`);
      if (result.evidence?.absenceReason) {
        planningChangeText(card, "planning-change-detail", String(result.evidence.absenceReason), true);
      } else if (result.outcome === "ABSENT_FROM_EDITION") {
        planningChangeText(card, "planning-change-detail", shellT("planning.change.absenceCauseUnknown"));
      }
    } else if (result.outcome === "MODIFIED_BY_INSTRUMENT") {
      planningChangeText(card, "planning-change-detail", `${shellT("planning.change.instrumentRef")}: ${result.instrument?.reference || ""}`);
      planningChangeText(card, "planning-change-caveat", result.modificationCaveat || shellT("planning.change.caveat"));
    } else if (result.outcome === "CAUSE_UNRESOLVED") {
      planningChangeText(card, "planning-change-detail", result.reason || shellT("planning.change.reasonUnknown"));
      for (const difference of result.evidence?.observations?.substantiveDifferences || []) {
        const row = document.createElement("div");
        row.className = "planning-change-values";
        const title = document.createElement("span");
        title.textContent = shellT("planning.change.reason");
        const beforeLabel = document.createElement("small");
        beforeLabel.textContent = `${shellT("planning.change.previousValue")} · ${previousDate || "—"}`;
        const before = document.createElement("span");
        before.dataset.verbatim = "";
        before.textContent = difference.previous ?? "";
        const afterLabel = document.createElement("small");
        afterLabel.textContent = `${shellT("planning.change.currentValue")} · ${currentDate || "—"}`;
        const after = document.createElement("span");
        after.dataset.verbatim = "";
        after.textContent = difference.current ?? "";
        row.append(title, beforeLabel, before, afterLabel, after);
        card.append(row);
      }
      const correspondence = result.evidence?.rowCorrespondence;
      if (correspondence) {
        if (correspondence.reason) planningChangeText(card, "planning-change-detail", correspondence.reason);
        planningChangeText(card, "planning-change-detail", `${shellT("planning.change.rowBasis")}: ${shellT("planning.change.matchingBasis")}`);
        for (const side of ["previous", "current"]) {
          for (const row of result.evidence?.situations?.[`unmatched${side === "previous" ? "Previous" : "Current"}`] || []) {
            const rowDate = side === "previous" ? previousDate : currentDate;
            planningChangeText(card, "planning-change-detail", `${rowDate} · ${row.situation ?? shellT("planning.notPublished")}`, true);
          }
        }
      }
    } else if (result.outcome === "NON_COMPARABLE") {
      planningChangeText(card, "planning-change-detail", result.reason || comparison.reason || shellT("planning.change.reasonUnknown"));
    }
    outcomes.append(card);
  }

  const build = document.getElementById("planningBuildComparison");
  build.replaceChildren();
  const numeric = comparison.buildability;
  build.dataset.state = numeric.state === "WITHHELD" ? "WITHHELD_BUILDABILITY_DIFFERENCE" : numeric.state;
  const numericHeading = document.createElement("h3");
  numericHeading.textContent = shellT("planning.change.numericTitle");
  build.append(numericHeading);
  const numericLabel = document.createElement("p");
  numericLabel.className = "planning-change-label";
  if (numeric.state === "NO_CHANGE") {
    numericLabel.textContent = shellT("planning.change.numericNoChange")
      .replace("{previous}", previousDate || "—")
      .replace("{current}", currentDate || "—");
  } else if (numeric.state === "OBSERVED_PUBLISHED_DIFFERENCE") {
    numericLabel.textContent = `${shellT("planning.change.observed")} · ${previousDate || "—"} · ${currentDate || "—"}`;
  } else {
    numericLabel.textContent = `${shellT("planning.change.withheld")} · ${previousDate || "—"} · ${currentDate || "—"}`;
  }
  build.append(numericLabel);
  if (numeric.reason) planningChangeText(build, "planning-change-detail", numeric.reason);
  for (const row of numeric.differences || []) {
    const wrap = document.createElement("article");
    wrap.className = "planning-change-numeric-row";
    if (row.situationVerbatim) {
      const situation = document.createElement("p");
      situation.className = "planning-situacion";
      const label = document.createElement("span");
      label.textContent = `${shellT("planning.change.situation")}: `;
      const value = document.createElement("span");
      value.dataset.verbatim = "";
      value.textContent = row.situationVerbatim.previous ?? row.situationVerbatim.current ?? "";
      situation.append(label, value);
      wrap.append(situation);
    }
    if (row.reason) planningChangeText(wrap, "planning-change-detail", row.reason);
    for (const cell of row.useClasses || []) {
      const detail = document.createElement("div");
      detail.className = "planning-change-cell";
      detail.dataset.state = cell.state;
      const title = document.createElement("strong");
      title.textContent = shellT(`planning.use.${cell.useClass}`);
      detail.append(title);
      if (cell.state === "WITHHELD") {
        planningChangeText(detail, "planning-change-detail", shellT("planning.change.withheld"));
        if (cell.reason) planningChangeText(detail, "planning-change-detail", cell.reason);
      } else {
        const values = document.createElement("div");
        values.className = "planning-change-numeric-values";
        const old = document.createElement("span");
        old.textContent = cell.previous?.value == null ? shellT("planning.notPublished") : `${planningFigure(cell.previous.value, 2)} ${cell.previous.unit}`;
        const currentValue = document.createElement("span");
        currentValue.textContent = cell.current?.value == null ? shellT("planning.notPublished") : `${planningFigure(cell.current.value, 2)} ${cell.current.unit}`;
        const oldSide = document.createElement("div");
        const oldLabel = document.createElement("small");
        oldLabel.textContent = `${shellT("planning.change.previousValue")} · ${previousDate || "—"}`;
        oldSide.append(oldLabel, old);
        const currentSide = document.createElement("div");
        const currentLabel = document.createElement("small");
        currentLabel.textContent = `${shellT("planning.change.currentValue")} · ${currentDate || "—"}`;
        currentSide.append(currentLabel, currentValue);
        values.append(oldSide, currentSide);
        detail.append(values);
        const stateLabel = document.createElement("p");
        stateLabel.className = "planning-change-detail";
        stateLabel.textContent = cell.state === "OBSERVED_PUBLISHED_DIFFERENCE"
          ? `${shellT("planning.change.observed")}: ${planningObservedDifference(cell.observedDifference)} m² edificable`
          : planningChangeLabel("NO_CHANGE").replace("{previous}", previousDate || "—").replace("{current}", currentDate || "—");
        detail.append(stateLabel);
      }
      wrap.append(detail);
    }
    build.append(wrap);
  }

  const analystBody = document.getElementById("planningChangeAnalystBody");
  analystBody.replaceChildren();
  const provenanceLabel = document.createElement("h3");
  provenanceLabel.textContent = shellT("planning.change.provenance");
  analystBody.append(provenanceLabel);
  const provenanceList = document.createElement("ul");
  provenanceList.className = "planning-change-provenance";
  for (const [side, labelKey, editionSet] of [
    ["previous", "planning.change.previousEdition", comparison.editions.previous],
    ["current", "planning.change.currentEdition", comparison.editions.current],
  ]) {
    const item = document.createElement("li");
    item.className = "planning-change-provenance-edition";
    const title = document.createElement("strong");
    title.textContent = `${shellT(labelKey)} · ${planningDate(comparison.dates[side]) || "—"}`;
    item.append(title);
    for (const family of ["S1", "S2"]) {
      const edition = editionSet[family];
      const record = document.createElement("p");
      record.textContent = `${family} · ${edition?.resource_id || "—"} · ${edition?.sha256 || "—"} · ${edition?.schema_era || "—"}`;
      item.append(record);
    }
    provenanceList.append(item);
  }
  analystBody.append(provenanceList);
  const details = document.createElement("pre");
  details.className = "planning-change-analyst-data";
  details.textContent = JSON.stringify(localizePlanningChangeAnalyst(analyst), null, 2);
  analystBody.append(details);
  // `citizen` is a projection of this exact comparison. The DOM uses its dates
  // and values above; retain the projection on the section for the browser seam.
  section.dataset.citizenReading = JSON.stringify(citizen);
}

// The ONE canonical membership computation, shared by the promoted PLACE block
// and the Detail full list. IDENTITY GUARD: the 724-polygon scan runs only when
// the active Lens centre or radius changed since the last evaluation; a re-render
// at the same geometry (a language switch, a mode re-render, a re-activation)
// reuses the cached frozen result and never re-scans. It is `ambitosIntersecting`
// and nothing else — no parallel geometry, no apportionment.
function evaluatePlanningMembership() {
  if (planningState !== "ready" || !planningModel.index) return null;
  const centre = centerOf(active);
  const radiusM = radiusFor(active);
  const key = `${active}|${centre.lon}|${centre.lat}|${radiusM}`;
  if (planningMembershipCache.key === key && planningMembershipCache.result) {
    return planningMembershipCache.result;
  }
  const result = planningModel.index.ambitosIntersecting(centre.lon, centre.lat, radiusM);
  planningMembershipCache = { key, result };
  return result;
}

// The Lens is actively moving: defer the membership scan and show an honest
// pending state, so a set that no longer matches the centre/radius is never
// displayed as current. refresh() renders the pending state; the matching
// end-call below settles to the exact canonical membership.
function beginPlanningMembershipInteraction() {
  planningMembershipInteracting = true;
}
function endPlanningMembershipInteraction() {
  if (!planningMembershipInteracting) return;
  planningMembershipInteracting = false;
  refresh();
}

// MEMBERSHIP, promoted into the always-visible PLACE planning section (P0-a).
// A count line, up to three identity-only chips and a route to the complete list
// in Detail. It carries NO quantity, share or proportion of any ámbito.
function renderPlanningMembership() {
  const block = document.getElementById("planningMembership");
  if (!block) return;
  const countLine = document.getElementById("planningMembershipCount");
  const chipList = document.getElementById("planningMembershipChips");
  const seeAll = document.getElementById("planningMembershipSeeAll");
  if (!P0A_ENABLED) {
    // STAGING GATE OFF: the promoted block never renders and never scans — the
    // 724-polygon evaluatePlanningMembership() is not called from here, so this
    // path costs nothing beyond these few DOM writes, matching pre-P0-a main.
    block.hidden = true;
    block.dataset.state = "";
    block.dataset.signature = "";
    block.removeAttribute("aria-busy");
    countLine.textContent = "";
    chipList.replaceChildren();
    seeAll.hidden = true;
    return;
  }
  const ready = planningState === "ready" && planningModel.index;
  block.hidden = !ready;
  if (!ready) {
    block.dataset.state = planningState === "loading" ? "loading" : "unavailable";
    block.dataset.signature = "";
    countLine.textContent = "";
    chipList.replaceChildren();
    seeAll.hidden = true;
    return;
  }
  if (planningMembershipInteracting) {
    // Honest pending state — never a stale count beside a moved Lens (AC-P0-12).
    block.dataset.state = "updating";
    block.dataset.signature = "";
    block.setAttribute("aria-busy", "true");
    countLine.textContent = shellT("planning.touchedUpdating");
    chipList.replaceChildren();
    seeAll.hidden = true;
    return;
  }
  block.removeAttribute("aria-busy");
  const membership = evaluatePlanningMembership();
  const count = membership ? membership.count : 0;
  // The signature encodes each touched ámbito's code AND its containsCentre bit,
  // so a Lens that crosses a polygon boundary while still intersecting the same
  // codes (its membership set unchanged but a containment flipped) forces a
  // re-render. Code-only signatures would early-return and leave a stale
  // "contains the Lens centre" mark contradicting the containment answer.
  const signature = `${membership ? membership.touched.map((entry) => `${entry.ambitoCode}:${entry.containsCentre ? 1 : 0}`).join(",") : ""}|${document.documentElement.lang}`;
  if (block.dataset.signature === signature) return;
  block.dataset.signature = signature;
  block.dataset.state = count === 0 ? "none" : "present";
  chipList.replaceChildren();
  seeAll.hidden = true;
  if (count === 0) {
    // The zero case reuses the existing, unchanged copy.
    countLine.textContent = shellT("planning.touchedNone");
    return;
  }
  countLine.textContent =
    count === 1
      ? shellT("planning.touchedCountOne")
      : shellT("planning.touchedCount").replace("{n}", String(count));
  // Up to three chips, each identity ONLY: official code + denomination (and the
  // containment mark when the circle centre also sits inside that ámbito). No
  // number is attached to any chip.
  for (const entry of membership.touched.slice(0, 3)) {
    chipList.append(planningMembershipChip(entry));
  }
  // The complete list — with its containment marks and the no-apportionment note
  // — stays in the existing Detail card. "See all {n}" opens and scrolls to it;
  // it is bounded disclosure/navigation only (no camera move, no Lens change).
  if (count > 3) {
    seeAll.hidden = false;
    seeAll.textContent = shellT("planning.touchedSeeAll").replace("{n}", String(count));
  }
}

function planningMembershipChip(entry) {
  const item = document.createElement("li");
  item.className = "planning-membership-chip";
  const code = document.createElement("span");
  code.className = "planning-touched-code";
  code.dataset.verbatim = "";
  code.textContent = entry.ambitoCode;
  const name = document.createElement("span");
  name.className = "planning-membership-chip-name";
  name.dataset.verbatim = "";
  name.textContent = entry.denomination || "";
  item.append(code, name);
  if (entry.containsCentre) {
    const centreMark = document.createElement("span");
    centreMark.className = "planning-touched-centre";
    centreMark.textContent = shellT("planning.touchedCentre");
    item.append(centreMark);
  }
  return item;
}

// LENS_INTERSECT_AMBITO — the Detail full list. It remains the complete list the
// promoted block's "See all" routes to, computed from the SAME shared evaluation
// (so no second scan), only while the Detail disclosure is open. MEMBERSHIP only:
// which ámbitos the circle touches, with no quantity attached.
function renderPlanningTouched() {
  const list = document.getElementById("planningTouchedList");
  const card = document.getElementById("planningTouchedCard");
  if (!list || !card) return;
  const detail = document.getElementById("placeDetail");
  const open = Boolean(detail && detail.open);
  card.hidden = !open;
  if (!open || planningState !== "ready" || !planningModel.index) {
    list.replaceChildren();
    list.dataset.signature = "";
    return;
  }
  if (planningMembershipInteracting) {
    // Mirror the promoted block's honest pending state while the Lens moves.
    list.dataset.signature = "";
    list.replaceChildren();
    const item = document.createElement("li");
    item.textContent = shellT("planning.touchedUpdating");
    list.append(item);
    return;
  }
  const membership = evaluatePlanningMembership();
  // Encode containsCentre per entry (see renderPlanningMembership): a boundary
  // crossing with an unchanged code set must still refresh the centre marks.
  const signature = `${membership.touched.map((entry) => `${entry.ambitoCode}:${entry.containsCentre ? 1 : 0}`).join(",")}|${document.documentElement.lang}`;
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;
  list.replaceChildren();
  if (membership.count === 0) {
    const item = document.createElement("li");
    item.textContent = shellT("planning.touchedNone");
    list.append(item);
    return;
  }
  for (const entry of membership.touched) {
    const item = document.createElement("li");
    const code = document.createElement("span");
    code.className = "planning-touched-code";
    code.dataset.verbatim = "";
    code.textContent = entry.ambitoCode;
    const name = document.createElement("span");
    name.dataset.verbatim = "";
    name.textContent = entry.denomination || "";
    item.append(code, name);
    if (entry.containsCentre) {
      const centreMark = document.createElement("span");
      centreMark.className = "planning-touched-centre";
      centreMark.textContent = shellT("planning.touchedCentre");
      item.append(centreMark);
    }
    list.append(item);
  }
}

// The containing ámbito on the map, on its own pane, in its own reserved
// neutral family. The stroke never encodes a phase and never reuses a Lens hue,
// and the layer is rebuilt only when the containing ámbito actually changes.
// Only the containing ámbito is drawn: 724 polygons at once would be wallpaper,
// not orientation.
function renderPlanningPolygon(containing) {
  const resolved =
    containing &&
    planningModel.module &&
    containing.state === planningModel.module.AMBITO_STATE.RESOLVED &&
    planningModel.index;
  if (!resolved) {
    if (planningLayer) {
      map.removeLayer(planningLayer.layer);
      if (planningLayer.label) map.removeLayer(planningLayer.label);
      planningLayer = null;
    }
    return;
  }
  if (planningLayer && planningLayer.code === containing.ambitoCode) return;
  if (planningLayer) {
    map.removeLayer(planningLayer.layer);
    if (planningLayer.label) map.removeLayer(planningLayer.label);
    planningLayer = null;
  }
  const feature = planningModel.index.featureFor(containing.ambitoCode);
  if (!feature) return;
  if (!planningRenderer) planningRenderer = L.canvas({ pane: "planningPane", padding: 0.3 });
  const layer = L.geoJSON(feature, {
    pane: "planningPane",
    renderer: planningRenderer,
    interactive: false,
    style: () => ({
      color: PLANNING_STROKE,
      weight: 2,
      opacity: 0.95,
      dashArray: "7 4",
      fill: true,
      fillColor: PLANNING_STROKE,
      fillOpacity: 0.07,
    }),
  }).addTo(map);
  const label = L.tooltip({
    permanent: true,
    direction: "center",
    className: "planning-ambito-label",
    interactive: false,
    opacity: 1,
  })
    .setLatLng(layer.getBounds().getCenter())
    .setContent(`${containing.ambitoCode}`)
    .addTo(map);
  planningLayer = { layer, label, code: containing.ambitoCode };
}

// ========================================================================= K9
// Granted urban licences (#71). An opt-in ADDRESS_POINT administrative register.
// The pure model and the committed, fingerprinted artifact live in
// js/urban-licences.js; this block loads the artifact once, renders the
// per-family figures / grant-date window / resolved coverage / inline ceiling,
// and draws the resolved points on their own neutral canvas pane. It computes NO
// cross-family total, NO density surface, NO barrio apportionment and NO approval
// rate, and it never calls an official service: it reads the committed file only.
//
// The expensive point layer is rebuilt only when the grant-date window or the
// document language changes — never on a Lens drag. Moving the Lens re-runs only
// the cheap in-memory per-family count, so enabling the layer does not regress
// interaction-to-paint on a drag.
const licenceModel = { module: null, index: null };
let licenceState = "idle"; // idle | loading | ready | unavailable
let licenceWindow = null; // { from, to } applied grant-date window (already clamped)
let licenceRenderer = null;
let lastLicenceLayerKey = null;

function licenceInterpolate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

function licenceNumber(value) {
  if (!Number.isFinite(value)) return "—";
  return Number(value).toLocaleString(shellLanguage() === "es" ? "es-ES" : "en-GB");
}

async function loadLicenceContext() {
  if (licenceState === "loading" || licenceState === "ready") return;
  licenceState = "loading";
  let module;
  try {
    module = await import(moduleUrl("urban-licences.js"));
  } catch (error) {
    licenceState = "unavailable";
    console.warn("urban-licences module unavailable", error);
    renderUrbanLicences();
    return;
  }
  licenceModel.module = module;

  let artifact = null;
  try {
    artifact = await fetchAreaJson("data/planning/madrid_urban_licences.json");
  } catch (error) {
    console.warn("urban-licences artifact unavailable", error);
  }
  const index = module.createLicenceIndex(artifact);
  if (!index) {
    licenceState = "unavailable";
  } else {
    licenceModel.index = index;
    licenceState = "ready";
    // Deterministic default window (trailing twelve months ending at the latest
    // grant date), clamped to the real extent — never "all time".
    const def = index.defaultWindow();
    licenceWindow = def.valid ? { from: def.from, to: def.to } : null;
    initLicenceWindowInputs();
  }
  renderUrbanLicences();
  renderScopeRail();
  // K11 (#73): once the register is ready, apply a shared grant-date window (if the
  // restore link carried one). Guarded + one-shot, so a manual enable is unaffected.
  if (typeof k11ApplyLicenceWindowRestore === "function") k11ApplyLicenceWindowRestore();
}

function isLicencesVisible() {
  return map.hasLayer(groups.licences);
}

function syncLicencesUi(on) {
  const toggle = document.querySelector('[data-layer="licences"]');
  if (toggle) {
    toggle.checked = on;
    toggle.setAttribute("aria-checked", String(on));
  }
  const section = document.getElementById("urbanLicences");
  if (section) section.hidden = !on;
  // Lazy load: the artifact is fetched only the first time the layer is enabled,
  // so it never delays the first map paint.
  if (on && licenceState === "idle") loadLicenceContext();
}

function initLicenceWindowInputs() {
  if (!licenceModel.index) return;
  const extent = licenceModel.index.dateExtent;
  const fromEl = document.getElementById("licFrom");
  const toEl = document.getElementById("licTo");
  if (!fromEl || !toEl) return;
  // The inputs carry the extent as min/max so the control itself cannot offer a
  // date outside the register; the model's clampWindow is the authority behind it.
  for (const input of [fromEl, toEl]) {
    input.min = extent.min;
    input.max = extent.max;
  }
  if (licenceWindow) {
    fromEl.value = licenceWindow.from;
    toEl.value = licenceWindow.to;
  }
}

function applyLicenceWindowFromInputs() {
  if (!licenceModel.index) return;
  const fromEl = document.getElementById("licFrom");
  const toEl = document.getElementById("licTo");
  // A blank input falls back to the extent bound; the model clamps before / after
  // / reversed / same-day. The clamped values are reflected back to the inputs so
  // the control can never display an out-of-range window.
  const clamped = licenceModel.index.clampWindow(fromEl.value || null, toEl.value || null);
  licenceWindow = clamped.valid ? { from: clamped.from, to: clamped.to } : null;
  if (licenceWindow) {
    fromEl.value = licenceWindow.from;
    toEl.value = licenceWindow.to;
  }
  renderUrbanLicences();
  renderScopeRail();
  // K11 (#73): the grant-date window shapes the displayed evidence, so a change
  // updates the canonical URL (replaceState, coalesced to one write per frame).
  if (typeof k11ScheduleUrlCommit === "function") k11ScheduleUrlCommit();
}

function licenceView() {
  if (!licenceModel.index) return null;
  const centre = centerOf(active);
  return licenceModel.index.view(
    { lat: centre.lat, lon: centre.lon, radiusM: radiusFor(active) },
    { enabled: isLicencesVisible(), families: null, window: licenceWindow }
  );
}

function renderLicenceResidual(residualTaxonomy) {
  const list = document.getElementById("licResidualList");
  if (!list) return;
  list.textContent = "";
  // Every residual class except the resolved count, with its own label. These are
  // withheld rows reported as coverage/residual evidence, never dropped.
  const classes = Object.keys(residualTaxonomy)
    .filter((key) => key !== "RESOLVED")
    .sort();
  for (const key of classes) {
    const li = document.createElement("li");
    const label = shellT(`lic.residual.${key}`);
    li.textContent = `${label === `lic.residual.${key}` ? key : label}: ${licenceNumber(residualTaxonomy[key])}`;
    list.appendChild(li);
  }
}

function renderUrbanLicences() {
  const section = document.getElementById("urbanLicences");
  if (!section) return;
  // K11 (#73, no-recomputation invariant): the in-lens per-family licence view is
  // computed ONCE below and captured from that same object. Reset to null here;
  // every early return (OFF, loading, unavailable) correctly leaves it null.
  if (typeof k11 !== "undefined") k11.placeLicences = null;
  const STATE = (licenceModel.module && licenceModel.module.LICENCE_LAYER_STATE) || {
    OFF: "OFF",
    UNAVAILABLE: "UNAVAILABLE",
    NO_MATCHES: "NO_MATCHES",
    AVAILABLE: "AVAILABLE",
  };
  const unavailableEl = document.getElementById("licUnavailable");
  const noMatchesEl = document.getElementById("licNoMatches");
  const bodyEl = document.getElementById("licBody");

  // OFF: the layer is disabled. The section is hidden and the state is OFF — an
  // explicit state, never confused with an observed zero or with unavailable.
  if (!isLicencesVisible()) {
    section.hidden = true;
    section.dataset.licenceState = STATE.OFF;
    syncLicenceMapLayer();
    return;
  }
  section.hidden = false;

  // Still loading the committed artifact: show nothing that could be read as a
  // zero or as unavailable. A not-yet-loaded index is NOT the UNAVAILABLE state —
  // that distinction is checked only once the load has settled.
  if (licenceState === "idle" || licenceState === "loading") {
    section.dataset.licenceState = STATE.OFF;
    if (unavailableEl) unavailableEl.hidden = true;
    if (noMatchesEl) noMatchesEl.hidden = true;
    if (bodyEl) bodyEl.hidden = true;
    return;
  }

  // UNAVAILABLE: the load settled but the committed artifact is missing or unusable.
  if (licenceState === "unavailable" || !licenceModel.index) {
    section.dataset.licenceState = STATE.UNAVAILABLE;
    if (unavailableEl) unavailableEl.hidden = false;
    if (noMatchesEl) noMatchesEl.hidden = true;
    if (bodyEl) bodyEl.hidden = true;
    syncLicenceMapLayer();
    return;
  }

  const view = licenceView();
  // K11 (#73): the single frozen view the panel renders is the one the export
  // transcribes — the per-family counts are a LENS_CIRCLE aggregate (see below).
  if (typeof k11 !== "undefined") k11.placeLicences = view;
  section.dataset.licenceState = view.state;
  if (unavailableEl) unavailableEl.hidden = true;

  // Grant-date window — always stated as explicit dates, never "recent".
  const win = view.window || licenceWindow;
  const appliedEl = document.getElementById("licWindowApplied");
  if (appliedEl && win) {
    appliedEl.textContent = licenceInterpolate(shellT("lic.windowApplied"), {
      from: planningDate(win.from),
      to: planningDate(win.to),
    });
  }
  const extent = licenceModel.index.dateExtent;
  const extentEl = document.getElementById("licWindowExtent");
  if (extentEl) {
    extentEl.textContent = licenceInterpolate(shellT("lic.windowExtent"), {
      min: planningDate(extent.min),
      max: planningDate(extent.max),
    });
  }
  const clampedEl = document.getElementById("licWindowClamped");
  if (clampedEl) clampedEl.hidden = !(view.window && view.window.clamped);

  // Per-family counts — three figures, never one total.
  setText("licCountBuilding", licenceNumber(view.perFamily.BUILDING_URBANISTIC_LICENCE_FAMILY));
  setText("licCountActivity", licenceNumber(view.perFamily.ACTIVITY_LICENCE_FAMILY));
  setText("licCountTemporary", licenceNumber(view.perFamily.TEMPORARY_ACTIVITY_FAMILY));

  // Resolved coverage — the match rate and resolved count, stated with the figures.
  const cov = view.coverage || {};
  const rate = Number.isFinite(cov.row_match_rate) ? (cov.row_match_rate * 100).toFixed(2) : "—";
  setText(
    "licCoverage",
    licenceInterpolate(shellT("lic.coverage"), {
      rate,
      resolved: licenceNumber(cov.resolved_rows),
      total: licenceNumber(cov.total_rows),
    })
  );

  // Unmatched / withheld — reported with its residual classes, never dropped.
  setText("licUnmatched", licenceInterpolate(shellT("lic.unmatched"), { unresolved: licenceNumber(cov.unresolved_rows) }));
  renderLicenceResidual(cov.residual_taxonomy || {});

  // NO_MATCHES (an observed zero for the resolved register) vs AVAILABLE.
  if (noMatchesEl) noMatchesEl.hidden = view.state !== STATE.NO_MATCHES;
  if (bodyEl) bodyEl.hidden = false;

  syncLicenceMapLayer();
}

// The map point layer. Rebuilt only when the window / language / availability
// changes — NOT on a Lens drag, so ~k points never re-render while dragging.
function syncLicenceMapLayer() {
  if (!licenceRenderer) licenceRenderer = L.canvas({ pane: "licencePane", padding: 0.5, tolerance: licenceToleranceForZoom(map.getZoom()) });
  const on = isLicencesVisible();
  if (!on || licenceState !== "ready" || !licenceModel.index) {
    if (lastLicenceLayerKey !== null) {
      groups.licences.clearLayers();
      lastLicenceLayerKey = null;
    }
    return;
  }
  const key = `${licenceWindow ? `${licenceWindow.from}..${licenceWindow.to}` : "all"}|${shellLanguage()}`;
  if (key === lastLicenceLayerKey) return;
  lastLicenceLayerKey = key;
  groups.licences.clearLayers();

  const from = licenceWindow && licenceWindow.from;
  const to = licenceWindow && licenceWindow.to;
  for (const record of licenceModel.index.records) {
    if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) continue;
    if (from && to && !(record.grant_date >= from && record.grant_date <= to)) continue;
    const marker = L.circleMarker([record.lat, record.lon], {
      pane: "licencePane",
      renderer: licenceRenderer,
      radius: 3.5,
      color: LICENCE_STROKE,
      weight: 1,
      opacity: 0.9,
      fillColor: LICENCE_STROKE,
      fillOpacity: 0.55,
    });
    marker.bindPopup(() => licencePopupHtml(record));
    marker.addTo(groups.licences);
  }
}

function licencePopupHtml(record) {
  const familyKey = {
    BUILDING_URBANISTIC_LICENCE_FAMILY: "lic.family.building",
    ACTIVITY_LICENCE_FAMILY: "lic.family.activity",
    TEMPORARY_ACTIVITY_FAMILY: "lic.family.temporary",
  }[record.family];
  const family = familyKey ? shellT(familyKey) : record.family;
  const granted = `${shellT("lic.popup.grantedOn")} ${planningDate(record.grant_date)}`;
  const notBuilt = shellT("lic.popup.notBuilt");
  // Official value (tipo) is carried verbatim; our labels localise around it.
  const tipo = record.tipo ? `<br><small>${escapeHtml(record.tipo)}</small>` : "";
  // Per-record provenance, kept distinct: current official callejero vs a
  // historical-only recovery (polygon-derived barrio). The address-text
  // disagreement flag is surfaced so an analyst can inspect it per record.
  const historical =
    record.resolution_provenance === "HISTORICAL_CALLEJERO" ||
    record.crosswalk_state === "NDP_FOUND_HISTORICAL_ONLY" ||
    record.barrio_provenance === "POLYGON_DERIVED_FROM_OFFICIAL_HISTORICAL_COORDINATE";
  const provenance = `<br><small>${escapeHtml(shellT(historical ? "lic.popup.historical" : "lic.popup.current"))}</small>`;
  const disagreement =
    record.address_text_agrees === false ? `<br><small>${escapeHtml(shellT("lic.popup.disagreement"))}</small>` : "";
  return `<b>${escapeHtml(family)}</b><br>${escapeHtml(granted)}${tipo}${provenance}${disagreement}<br><em>${escapeHtml(notBuilt)}</em>`;
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
              refresh(); // commits the URL (incl. the new barrio) via k11ScheduleUrlCommit
            }
            applyHospitalityStyles();
            renderHospitalityContext();
            k11ScheduleUrlCommit(); // ensure the selected barrio reaches the URL even without a lens move
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
  renderHospitalityScale();
  rebuildHospitalityLayer();
  renderHospitalityContext();
}

function renderHospitalityContext() {
  const host = document.getElementById("hospitalityContext");
  if (!host) return;
  // K11 (#73): reset here; set below when a value renders.
  if (typeof k11 !== "undefined") k11.placeHospitality = null;
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
  const hospitalityUnitText = conditionalReady ? hospitalityT(module.metricUnitKey(hospitalityMetric)) : "";
  const hospitalityDisplay = conditionalReady && Number.isFinite(value)
    ? module.formatMetricValue(hospitalityMetric, value, hospitalityModel.i18n.language)
    : null;
  setText("hospitalityUnit", hospitalityUnitText);
  // K11 (#73): capture the selected hospitality indicator exactly as displayed —
  // its value, its formatted display string and its actual unit (not null), and
  // the scope the selection implies (barrio when one is picked, else municipality).
  if (typeof k11 !== "undefined") {
    k11.placeHospitality = {
      metric: hospitalityMetric,
      value: conditionalReady && Number.isFinite(value) ? value : null,
      display: hospitalityDisplay,
      unit: hospitalityUnitText || null,
      scope: hospitalitySelectedBarrio ? "OFFICIAL_BARRIO" : "MUNICIPALITY",
    };
  }
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
  if (hospitalityVisible) openPlaceDetail();
  renderScopeRail();
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
    // K11 (#73): once hospitality is ready, restore a shared metric/barrio (if the
    // restore link carried one). Guarded + one-shot; a manual enable is unaffected.
    if (typeof k11ApplyHospitalityRestore === "function") k11ApplyHospitalityRestore();
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
  // K11 (#73): capture the destination-context metric values exactly as the card
  // renders them, for the CITY export transcript (read only when mode is CITY).
  if (typeof k11 !== "undefined") {
    k11.cityDestination = available
      ? Object.freeze({ metrics: model.metrics, period: model.period, hotelCaveat: model.hotelCaveat })
      : null;
  }
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
  host.innerHTML = lines.map((line) => `<span data-provenance-line>${line}</span>`).join("");
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
  // K11 (#73): capture the SAME frozen month-over-month model the panel renders —
  // the summary counts AND the displayed shared-origin rows (previous/current
  // tourist counts with the model's own absolute and percent change). One
  // computation (line above), reused; the export never recompares the months.
  if (typeof k11 !== "undefined") {
    k11.cityDynamics = ready ? {
      summary: model.summary,
      shared: model.shared,
      newlyPresent: model.newlyPresent,
      noLongerPresent: model.noLongerPresent,
      currentMonth: model.currentMonth,
      previousMonth: model.previousMonth,
    } : null;
  }
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
  // K11 (#73): capture the domestic-origin rows exactly as rendered, for the CITY
  // export transcript (read only when mode is CITY).
  if (typeof k11 !== "undefined") {
    k11.cityOrigins = model.state === module.ORIGIN_STATE.AVAILABLE
      ? Object.freeze({ month: model.month, origins: model.origins, scopeCaveat: module.ORIGIN_SCOPE_CAVEAT })
      : null;
  }
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
        // Outside/inside remains a structural distinction (dashed/solid), not
        // a low-contrast fade or a colour-only state. The reduced opacity stays
        // high enough for the cluster count to meet AA against the map chrome.
        m.setOpacity(inside ? 1 : 0.72);
        m.getElement()?.classList.toggle("outside-lens", !inside);
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
  // K11 (#73, no-recomputation invariant): heatStatsFor / pedestrianStatsFor /
  // categoryMixState are each evaluated ONCE here. The render functions return the
  // very projection they drew, so the PLACE capture below reuses those objects
  // instead of recomputing them. The export never recomputes a displayed figure.
  const heat = renderHeatMetric(heatStatsFor(active));
  renderCircleSummary();
  const pedestrian = renderPedestrianMetric(pedestrianStatsFor(active));
  const mix = renderMix(s);
  renderNearest(s);
  renderCompare();
  updateAreaContext();
  renderPlanningContext();
  renderUrbanLicences();
  shadeMarkersOutsideActiveLens();
  renderScopeRail();
  // K11 (#73): capture the active-lens PLACE metric values exactly as rendered.
  // The frozen projections computed just above are reused — not a second
  // computation — so the capture is a transcript. Read only in PLACE mode.
  if (typeof k11 !== "undefined") k11CapturePlaceReading(s, { heat, pedestrian, mix });
  k11ScheduleUrlCommit();
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
    // Leaving compare mode clears any locked/previewed metric so the Bridge
    // returns to its neutral state and does not resurface a stale selection.
    selectedHaloMetric = null;
    setHaloMetricFocus(null, null);
    activateLens("A");
    document.getElementById("lensBButton").textContent = "+ Enable Lens B";
  }
}

lenses.A.marker.on("drag", () => (active !== "A" ? activateLens("A") : refresh()));
lenses.B.marker.on("drag", () => (active !== "B" ? activateLens("B") : refresh()));
// Membership coalescing (P0-a, #95): the 724-polygon circle–ámbito scan is
// deferred while a Lens marker is being dragged (the surface shows an explicit
// pending state) and settles to the exact canonical set on release. Leaflet
// fires `drag` continuously but `dragstart`/`dragend` once each. STAGING GATE:
// these listeners are installed at all only when P0A_ENABLED — OFF means no
// extra per-drag handler exists, matching pre-P0-a main exactly.
if (P0A_ENABLED) {
  lenses.A.marker.on("dragstart", beginPlanningMembershipInteraction);
  lenses.B.marker.on("dragstart", beginPlanningMembershipInteraction);
  lenses.A.marker.on("dragend", endPlanningMembershipInteraction);
  lenses.B.marker.on("dragend", endPlanningMembershipInteraction);
}
map.on("click", (e) => {
  // In COMPARE + ámbito scope a map click SELECTS an official ámbito (A then B)
  // instead of moving a Lens; otherwise the Lens-move behaviour is unchanged.
  if (!handleAmbitoCompareMapClick(e.latlng)) {
    lenses[active].marker.setLatLng(e.latlng);
    refresh();
  }
});
map.on("zoomend", rebuildDenseLayers);
// Keep the licence click tolerance gated to the current zoom. Leaflet reads
// `renderer.options.tolerance` at click time, so updating it here is enough — the
// ~11k points are not re-drawn.
map.on("zoomend", () => {
  if (licenceRenderer) licenceRenderer.options.tolerance = licenceToleranceForZoom(map.getZoom());
});

document.getElementById("lensAButton").onclick = () => activateLens("A");
// Lens B is enabled THROUGH the COMPARE mode, which owns enableLensB/disableLensB.
document.getElementById("lensBButton").onclick = () => (bEnabled ? activateLens("B") : shell.modes.setMode("COMPARE"));
// The HATI layer control (not the navigation) enables the layer and frames the pilot.
document.getElementById("hatiFrameButton").onclick = () => {
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

// PLACE quick-jump (narrow screens). Scrolls the panel's internal scroll to the
// canonical compact Lens-circle projection or the Detail disclosure, so the core local evidence
// is reachable in one tap instead of several screens of scrolling. Pure
// navigation: it never changes a value, a mode, a layer or the reading order.
const placeJump = document.getElementById("placeJump");
if (placeJump) {
  placeJump.addEventListener("click", (event) => {
    const chip = event.target.closest(".place-jump-chip");
    if (!chip) return;
    const target =
      chip.dataset.jump === "detail"
        ? document.getElementById("placeDetail")
        : document.getElementById("placeCircleSummary");
    const panel = document.getElementById("analysisPanel");
    if (!target || !panel) return;
    const top =
      target.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 8;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  });
}
// "See all {n}" opens the existing Detail full list and scrolls to it. Bounded
// disclosure/navigation only: it moves no camera, rebinds no Lens and changes no
// mode or reading (AC-P0-2a is NOT MET by P0-a — a chip cannot safely open the
// containment-keyed whole-ámbito surface — so the route to the complete reading
// is the unchanged Detail card, not an improvised finder).
const planningMembershipSeeAll = document.getElementById("planningMembershipSeeAll");
if (P0A_ENABLED && planningMembershipSeeAll) {
  planningMembershipSeeAll.addEventListener("click", () => {
    const detail = document.getElementById("placeDetail");
    if (detail) detail.open = true;
    renderPlanningTouched();
    renderScopeRail();
    const card = document.getElementById("planningTouchedCard");
    const panel = document.getElementById("analysisPanel");
    if (!card || !panel || card.hidden) return;
    const top = card.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 8;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  });
}
const planningExplorerQuery = document.getElementById("planningExplorerQuery");
const planningExplorerClose = document.getElementById("planningExplorerClose");
const planningExplorerMap = document.getElementById("planningExplorerMap");
const planningExplorerEvidenceToggle = document.getElementById("planningExplorerEvidenceToggle");
if (planningExplorerQuery) {
  planningExplorerQuery.addEventListener("input", (event) => {
    planningExplorer.query = event.target.value;
    renderPlanningExplorer();
  });
  planningExplorerQuery.addEventListener("keydown", (event) => {
    const buttons = [...document.querySelectorAll("#planningExplorerResults button")];
    if (event.key === "ArrowDown" && buttons.length) { event.preventDefault(); buttons[0].focus(); }
    if (event.key === "Escape") { event.preventDefault(); clearPlanningExplorer(); planningExplorerQuery.focus(); }
  });
}
document.getElementById("planningExplorerResults")?.addEventListener("keydown", (event) => {
  const buttons = [...document.querySelectorAll("#planningExplorerResults button")];
  const current = buttons.indexOf(document.activeElement);
  if (event.key === "ArrowDown" && current >= 0 && buttons[current + 1]) { event.preventDefault(); buttons[current + 1].focus(); }
  if (event.key === "ArrowUp") { event.preventDefault(); if (current > 0) buttons[current - 1].focus(); else planningExplorerQuery?.focus(); }
  if (event.key === "Escape") { event.preventDefault(); clearPlanningExplorer(); planningExplorerQuery?.focus(); }
});
if (planningExplorerClose) planningExplorerClose.addEventListener("click", clearPlanningExplorer);
if (planningExplorerMap) planningExplorerMap.addEventListener("click", showPlanningExplorerOnMap);
if (planningExplorerEvidenceToggle) planningExplorerEvidenceToggle.addEventListener("click", () => {
  if (planningExplorer.selectedCode) openEvidenceDrawer({ opener: planningExplorerEvidenceToggle, scope: "PLANNING_AMBITO", ambitoCode: planningExplorer.selectedCode });
});

function renderRadiusLabels() {
  const text = formatLensRadius(radiusFor(active));
  document.getElementById("radiusText").textContent = text;
  const lensName = `Lens ${active}`;
  document.getElementById("radiusControlLabel").textContent = `${lensName} radius`;
  radiusSlider.setAttribute("aria-label", `${lensName} radius`);
  // The lens section states its own geometry, so "within the lens" can never be
  // read as the administrative area above it.
  document.getElementById("lensScopeHint").textContent = `${text} circle`;
  const summaryRadius = document.getElementById("placeCircleSummaryRadius");
  if (summaryRadius) summaryRadius.textContent = shellTemplate("place.circleSummaryRadius", { n: text });
}
const radiusSlider = document.getElementById("radiusSlider");
radiusSlider.min = LENS_RADIUS.minM;
radiusSlider.max = LENS_RADIUS.maxM;
radiusSlider.step = LENS_RADIUS.stepM;
radiusSlider.value = radiusFor(active);
radiusSlider.setAttribute("aria-label", "Lens A radius");
renderRadiusLabels();

radiusSlider.oninput = (e) => {
  // A slider drag fires `input` continuously and `change` once on release, so
  // membership defers while sliding and settles on commit (the same coalescing
  // as a marker drag). Keyboard adjustment fires both, so it settles at once.
  // STAGING GATE: the begin-interaction call is skipped entirely when
  // P0A_ENABLED is false, matching pre-P0-a main's oninput exactly.
  if (P0A_ENABLED) beginPlanningMembershipInteraction();
  setLensRadius(active, e.target.value);
  e.target.value = radiusFor(active);
  renderRadiusLabels();
  refresh();
};
if (P0A_ENABLED) radiusSlider.onchange = endPlanningMembershipInteraction;
document.getElementById("basemapSelect").onchange = (e) => setBasemap(e.target.value);
document.getElementById("boundarySelect").onchange = (e) => setBoundaryMode(e.target.value);
// Appearance is presentation-only and intentionally has no path into basemap,
// map camera, evidence state or URL restoration.
window.MadridAppearance?.init();
// ONE document language at a time (docs/INFORMATION_ARCHITECTURE_V2.md §Language):
// this control sets the document language and every dictionary-backed surface
// follows it — shell, Bridge/Insight/Sensitivity, hospitality and domestic origins.
document.getElementById("languageSelect").onchange = (event) => {
  const language = event.target.value;
  document.documentElement.setAttribute("lang", language);
  shell.i18n?.setLanguage(language);
  bridgeI18n?.setLanguage(language);
  hospitalityModel.i18n?.setLanguage(language);
  applyHospitalityCopy();
  originModel.i18n?.setLanguage(language);
  originModel.dynamicsI18n?.setLanguage(language);
  renderDomesticOrigins();
  renderComparisonBridge();
  renderDecisionInsight();
  renderSpatialSensitivity();
  renderAmbitoCompare();
  // The planning surface builds its product-authored copy from the shell
  // dictionary at render time, so a language switch re-renders it. Official
  // values inside it sit under data-verbatim and are never touched.
  lastPlanningRenderKey = null;
  renderPlanningContext();
  // The licence surface likewise builds its product-authored copy (coverage,
  // window, residual classes) at render time; force a layer rebuild so the map
  // popups also pick up the new language.
  lastLicenceLayerKey = null;
  renderUrbanLicences();
  restoreCopy();
  applyShellCopy();
  renderModeUi();
  if (document.getElementById("evidenceDrawer").open) renderDrawerBody();
  applyCopyLanguage();
  k11ApplyCopy();
  k11ScheduleUrlCommit();
};
document.getElementById("domesticOriginsMonth").onchange = (event) => { originMonth = event.target.value; renderDomesticOrigins(); k11ScheduleUrlCommit(); };
document.getElementById("hospitalityMetricSelect").onchange = (event) => {
  if (!hospitalityModel.module?.APPROVED_INDICATOR_IDS.includes(event.target.value)) return;
  hospitalityMetric = event.target.value;
  hospitalitySelectedBarrio = hospitalitySelectedBarrio || null;
  setText("hospitalityMetricSelectValue", hospitalityT(hospitalityMetric));
  applyHospitalityStyles();
  renderHospitalityContext();
  k11ScheduleUrlCommit();
};
document.getElementById("hospitalityClearSelection").onclick = () => {
  hospitalitySelectedBarrio = null;
  applyHospitalityStyles();
  renderHospitalityContext();
  k11ScheduleUrlCommit();
};
// The per-section "Source & interpretation" toggles are openers for the ONE
// evidence drawer, which holds the generated provenance lines at every breakpoint.
const areaSourceToggle = document.getElementById("areaSourceToggle");
areaSourceToggle.onclick = () => openEvidenceDrawer({ opener: areaSourceToggle, focusSection: "drawerAreaNotes" });
const planningSourceToggle = document.getElementById("planningSourceToggle");
planningSourceToggle.onclick = () => openEvidenceDrawer({ opener: planningSourceToggle, scope: "PLANNING_AMBITO" });
const licSourceToggle = document.getElementById("licSourceToggle");
if (licSourceToggle) licSourceToggle.onclick = () => openEvidenceDrawer({ opener: licSourceToggle, scope: "ADDRESS_POINT" });
const destinationSourceToggle = document.getElementById("destinationSourceToggle");
destinationSourceToggle.onclick = () => openEvidenceDrawer({ opener: destinationSourceToggle, focusSection: "drawerDestinationNotes" });
// THE accommodation-category state transition. Changing the category changes
// which stay records every downstream count is drawn from, so it is an EVIDENCE
// CONFIGURATION change: it feeds spatialEvidenceKey() and therefore invalidates
// a captured Spatial Sensitivity baseline (see docs/SPATIAL_WINDOW_SENSITIVITY_V1.md).
//
// It lives in one named helper so the real <select> handler and the gated
// regression seam drive the IDENTICAL transition. The seam must never be able to
// reach a shortcut the UI does not take, or a passing test would prove nothing
// about production.
//
// This helper deliberately does NOT touch the select's own disabled state: when
// the packaged fallback carries no accommodation type metadata, production
// correctly disables the control, and that availability rule stays untouched.
function setStayKindFilter(nextKind) {
  stayKindFilter = nextKind;
  rebuildDenseLayer("stay");
  refresh();
}
document.getElementById("stayKindFilter").onchange = (e) => {
  setStayKindFilter(e.target.value);
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
document.querySelectorAll("[data-layer]").forEach((x) => (x.onchange = () => {
  setLayerVisible(x.dataset.layer, x.checked);
  renderRailGroupBadges();
}));
syncHatiUi(false);
syncPedestrianUi(false);
syncHospitalityUi(false);
syncLicencesUi(false);
// The grant-date window inputs re-clamp through the model and re-render; the
// register's extent is bound as the inputs' min/max once the artifact loads.
for (const id of ["licFrom", "licTo"]) {
  const input = document.getElementById(id);
  if (input) input.addEventListener("change", applyLicenceWindowFromInputs);
}

// ===========================================================================
// INFORMATION ARCHITECTURE V2 (K4, #66): modes, scope & freshness rail, evidence
// drawer. The pure models live in js/modes.js, js/scope-rail.js and
// js/evidence-scope.js; this block only renders them and wires events. Nothing
// here computes an analytical value, and no mode button touches the camera, a
// dataset or a layer — a mode change only changes mode (plus the existing Lens B
// enable/disable path that COMPARE owns). See docs/INFORMATION_ARCHITECTURE_V2.md.
// ===========================================================================
function shellLanguage() {
  return String(document.documentElement.lang || "en").toLowerCase().split("-")[0] === "es" ? "es" : "en";
}

// P1 responsive rail: the five layer groups report the actual checked state of
// their ten existing switches. The map-display group reports its two settings,
// never a dataset count. Collapsing a group only changes disclosure state.
function shellTemplate(key, replacements = {}) {
  let value = shellT(key);
  for (const [token, replacement] of Object.entries(replacements)) {
    value = value.replace(`{${token}}`, String(replacement));
  }
  return value;
}

function renderRailGroupBadges() {
  for (const group of document.querySelectorAll(".rail-group")) {
    const badge = group.querySelector(".rail-group-badge");
    if (!badge) continue;
    if (badge.dataset.railSettings) {
      const count = Number(badge.dataset.railSettings);
      badge.textContent = shellTemplate("aside.groupBadgeSettings", { n: count });
      badge.removeAttribute("aria-label");
      continue;
    }
    const toggles = [...group.querySelectorAll("input[data-layer]")];
    const on = toggles.filter((toggle) => toggle.checked).length;
    const total = toggles.length;
    badge.textContent = shellTemplate("aside.groupBadge", { n: on, m: total });
    badge.setAttribute("aria-label", shellTemplate("aside.groupAria", { n: on, m: total }));
  }
}

// The whole layer rail is opt-in on phones, without hiding its ten toggles or
// changing their values. Tablets keep P1's six-group visible accordion.
const mobileRailMedia = window.matchMedia("(max-width: 560px)");
const mobileRailButton = document.getElementById("mobileLayersButton");
const mobileRail = document.getElementById("layerRail");
function setMobileRailOpen(requestedOpen, restoreFocus = false) {
  const visible = mobileRailMedia.matches && Boolean(requestedOpen);
  mobileRail.hidden = mobileRailMedia.matches && !visible;
  mobileRailButton.setAttribute("aria-expanded", String(visible));
  mobileRailButton.setAttribute("aria-label", shellT(visible ? "aside.closeLayers" : "aside.openLayers"));
  if (restoreFocus && mobileRailMedia.matches) mobileRailButton.focus({ preventScroll: true });
}
setMobileRailOpen(false);
mobileRailButton.addEventListener("click", () => setMobileRailOpen(mobileRail.hidden));
if (typeof mobileRailMedia.addEventListener === "function") {
  mobileRailMedia.addEventListener("change", () => setMobileRailOpen(false));
} else mobileRailMedia.addListener(() => setMobileRailOpen(false));
// Capture the first outside click. If it lands on the map, consume that click:
// dismissing the rail must never also select a new Lens centre.
document.addEventListener("click", (event) => {
  if (!mobileRailMedia.matches || mobileRail.hidden ||
      mobileRail.contains(event.target) || mobileRailButton.contains(event.target)) return;
  const onMap = Boolean(event.target.closest("#map"));
  setMobileRailOpen(false);
  if (onMap) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mobileRailMedia.matches && !mobileRail.hidden &&
      (mobileRail.contains(document.activeElement) || document.activeElement === mobileRailButton)) {
    // Do not intercept Escape from an open Evidence & limits dialog.
    if (!document.getElementById("evidenceDrawer").open) {
      event.preventDefault();
      setMobileRailOpen(false, true);
    }
  }
});

const narrowRailMedia = window.matchMedia("(max-width: 850px)");
function configureRailGroups(event = narrowRailMedia) {
  const narrow = event.matches;
  for (const group of document.querySelectorAll(".rail-group")) {
    const summary = group.querySelector(":scope > summary");
    if (narrow) {
      group.setAttribute("name", "rail");
      group.open = false;
      if (summary) summary.tabIndex = 0;
    } else {
      group.removeAttribute("name");
      group.open = true;
      if (summary) summary.tabIndex = -1;
    }
  }
}
configureRailGroups();
if (typeof narrowRailMedia.addEventListener === "function") narrowRailMedia.addEventListener("change", configureRailGroups);
else narrowRailMedia.addListener(configureRailGroups);
for (const summary of document.querySelectorAll(".rail-group > summary")) {
  summary.addEventListener("click", (event) => {
    if (!narrowRailMedia.matches) event.preventDefault();
  });
}

for (const link of document.querySelectorAll(".skip-link")) {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    if (target === mobileRail && mobileRailMedia.matches) setMobileRailOpen(true);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  });
}

// The compact band is a projection of the canonical four PLACE readings. It
// copies both the displayed value and its state/provenance line after those
// canonical nodes render, so zero, unavailable, OFF and abstention never merge.
function renderCircleSummary() {
  const readings = [
    ["tourismValue", "tourismFoot", "placeCircleTourismValue", "placeCircleTourismState"],
    ["stayValue", "stayFoot", "placeCircleStayValue", "placeCircleStayState"],
    ["mobilityValue", "mobilityFoot", "placeCircleMobilityValue", "placeCircleMobilityState"],
    ["heatValue", "heatFoot", "placeCircleHeatValue", "placeCircleHeatState"],
  ];
  for (const [sourceValueId, sourceStateId, targetValueId, targetStateId] of readings) {
    const sourceValue = document.getElementById(sourceValueId);
    const sourceState = document.getElementById(sourceStateId);
    const targetValue = document.getElementById(targetValueId);
    const targetState = document.getElementById(targetStateId);
    if (!sourceValue || !sourceState || !targetValue || !targetState) continue;
    targetValue.textContent = sourceValue.textContent;
    targetValue.classList.toggle("abstain", sourceValue.classList.contains("abstain"));
    targetState.textContent = sourceState.textContent;
  }
}
function shellT(key) {
  if (shell.i18n) return shell.i18n.t(key);
  const dictionary = SHELL_DICTIONARIES[shellLanguage()] || SHELL_DICTIONARIES.en;
  return dictionary[key] ?? SHELL_DICTIONARIES.en[key] ?? key;
}
import(moduleUrl("i18n.js")).then((module) => {
  shell.i18n = module.createI18n(SHELL_DICTIONARIES, shellLanguage());
  applyShellCopy();
  renderModeUi();
}).catch(() => { /* the direct dictionary lookup in shellT keeps the shell working */ });

// Static labels that tests pin as literal <span> text are bound by selector so the
// markup keeps its English source text; everything else carries data-i18n.
const SHELL_BINDINGS = [
  ["#areaProfile .section-head > span", "sec.area"],
  ["#modePlace > .section-head > span", "sec.withinLens"],
  ["#compareLine > .section-head > span", "sec.compare"],
  ["#compareLine > .section-head > small", "sec.circleOnly"],
  [".brand-sub", "brand.sub"],
];
function applyShellCopy() {
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = shellT(el.dataset.i18n);
  // Trusted, static dictionary HTML only (never source data or user input).
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = shellT(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll("[data-i18n-attr]")) {
    const [attribute, key] = el.dataset.i18nAttr.split(":");
    el.setAttribute(attribute, shellT(key));
  }
  for (const [selector, key] of SHELL_BINDINGS) {
    const el = document.querySelector(selector);
    if (el) el.textContent = shellT(key);
  }
  for (const button of document.querySelectorAll(".evidence-link")) {
    button.setAttribute("aria-label", `${shellT("rail.open")} ${shellT(button.dataset.evidenceName)}`);
  }
  renderRailGroupBadges();
  setMobileRailOpen(!mobileRail.hidden);
  renderRadiusLabels();
  renderCircleSummary();
  document.getElementById("hospitalityLanguageLabel").textContent = "Idioma / Language";
}

// ------------------------------------------------------------------- modes
const MODE_SECTIONS = { PLACE: "modePlace", COMPARE: "compareLine", CITY: "modeCity" };
const MODE_BUTTONS = { PLACE: "modePlaceButton", COMPARE: "modeCompareButton", CITY: "modeCityButton" };

function openPlaceDetail() {
  const detail = document.getElementById("placeDetail");
  if (detail) detail.open = true;
}

const placeDetailDisclosure = document.getElementById("placeDetail");
if (placeDetailDisclosure) {
  placeDetailDisclosure.addEventListener("toggle", () => {
    renderPlanningTouched();
    renderScopeRail();
  });
}

function currentFlags() {
  // STAGING GATE OFF: reproduce pre-P0-a main's own rail claim for this scope —
  // LENS_INTERSECT_AMBITO was only on screen while the Detail disclosure was open
  // (the membership query ran inside the closed #placeDetail, not in an
  // always-visible block). ON: P0-a (#95) promoted the reading out of Detail into
  // the always-visible planning section, so the rail names the scope as soon as
  // the surface renders, independent of Detail being open.
  const placeDetail = P0A_ENABLED ? null : document.getElementById("placeDetail");
  return {
    vut: !document.getElementById("areaVut").hidden,
    hospitality: hospitalityVisible,
    hati: isHatiVisible(),
    pedestrian: isPedestrianVisible(),
    // The ADDRESS_POINT licence surface is on screen only while its opt-in layer
    // is enabled, so the rail never claims a scope whose surface is not rendered.
    licences: isLicencesVisible(),
    planningMembership: P0A_ENABLED
      ? planningState === "ready"
      : planningState === "ready" && Boolean(placeDetail && placeDetail.open),
  };
}

function renderModeUi() {
  if (!shell.modes) return;
  const mode = shell.modes.currentMode();
  // Explorer selection belongs only to PLACE. Clearing it on mode exit keeps a
  // discovery highlight from becoming a third polygon in COMPARE.
  if (mode !== "PLACE" && planningExplorer.selectedCode) clearPlanningExplorer();
  const panel = document.getElementById("analysisPanel");
  panel.dataset.mode = mode;
  for (const name of MODES) {
    document.getElementById(MODE_SECTIONS[name]).hidden = name !== mode;
    const button = document.getElementById(MODE_BUTTONS[name]);
    button.setAttribute("aria-pressed", String(name === mode));
    if (name === mode) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
  document.getElementById("modeQuestion").textContent = shellT(`mode.q.${mode.toLowerCase()}`);
  for (const el of document.querySelectorAll("[data-controls-for]")) {
    el.hidden = !el.dataset.controlsFor.split(" ").includes(mode);
  }
  const origins = document.getElementById("domesticOrigins");
  document.getElementById("cityControls").hidden = mode !== "CITY" || !origins || origins.hidden;
  for (const el of document.querySelectorAll("[data-drawer-mode]")) {
    el.hidden = !el.dataset.drawerMode.split(" ").includes(mode);
  }
  // The Administrative-area block is the PLACE lead; in COMPARE it stays reachable
  // as the first thing in Detail, so each lens's barrio remains legible.
  const area = document.getElementById("areaProfile");
  const placeSection = document.getElementById("modePlace");
  const compareHost = document.getElementById("compareAreaHost");
  if (mode === "COMPARE") compareHost.appendChild(area);
  else if (area.parentElement !== placeSection) {
    // P1 compact projection remains the PLACE first reading after mode switches.
    // Never reinsert the whole-barrio lead ahead of the Lens-circle band.
    const band = document.getElementById("placeCircleSummary");
    placeSection.insertBefore(area, band ? band.nextSibling : placeSection.firstElementChild);
  }
  shell.signature = "";
  renderScopeRail();
}

// A mode change performs only the plan's Lens B path; the app supplies it so the
// pure controller never reaches into Leaflet.
shell.modes = createModeController({
  lensBEnabled: () => bEnabled,
  apply(plan) {
    if (plan.enableLensB) enableLensB();
    if (plan.disableLensB) disableLensB();
  },
});
shell.modes.subscribe((mode, plan) => {
  const panel = document.getElementById("analysisPanel");
  if (plan.changed) shell.modeScrollPositions[plan.from] = panel.scrollTop;
  renderModeUi();
  if (plan.changed) {
    panel.scrollTop = shell.modeScrollPositions[mode] || 0;
    document.getElementById("modeAnnouncer").textContent =
      `${shellT("mode.announce")}: ${shellT(`mode.${mode.toLowerCase()}`)}. ${shellT(`mode.q.${mode.toLowerCase()}`)}`;
  }
});
for (const button of document.querySelectorAll(".mode-btn")) {
  button.onclick = () => shell.modes.setMode(button.dataset.mode);
}

// -------------------------------------------------------------------- rail
fetchAreaJson("data/source_registry.json")
  .then((registry) => { shell.registry = registry; shell.signature = ""; renderScopeRail(); if (document.getElementById("evidenceDrawer").open) renderDrawerBody(); })
  .catch((error) => { shell.registryFailed = true; console.warn("source registry unavailable", error); shell.signature = ""; renderScopeRail(); });

function railInstances(mode) {
  const lensLabel = (which) => `${which} · ${formatLensRadius(radiusFor(which))}`;
  const shown = areaProfiles[active] || areaProfiles.A;
  const resolved = shown && AREA_STATE && shown.state === AREA_STATE.RESOLVED;
  return {
    LENS_CIRCLE: mode === "COMPARE" ? [lensLabel("A"), lensLabel("B")] : [lensLabel(active)],
    OFFICIAL_BARRIO: [resolved ? shown.headline : shellT("rail.locating")],
    MUNICIPALITY: ["Madrid"],
    // The rail states the real planning scope: the exact official code when an
    // ambito contains the centre, and the explicit absence when none does.
    PLANNING_AMBITO: [planningRailInstance()],
    LENS_INTERSECT_AMBITO: [lensLabel(active)],
  };
}

// What the rail prints for PLANNING_AMBITO: the exact official code when an
// ambito contains the active Lens centre, and an explicit absence otherwise.
// Never a blank and never a barrio name standing in for an ambito.
function planningRailInstance() {
  if (planningState === "loading") return shellT("rail.locating");
  if (planningState !== "ready" || !planningModel.module) return shellT("rail.unavailable");
  const containing = planningModel.index
    ? planningModel.index.ambitoContaining(centerOf(active).lon, centerOf(active).lat, planningHint)
    : null;
  if (containing && containing.state === planningModel.module.AMBITO_STATE.RESOLVED) return containing.ambitoCode;
  return shellT("planning.touchedNone");
}

function freshnessLine(model) {
  if (!model) return `${shellT("rail.reference")} · ${shellT(shell.registryFailed ? "rail.unavailable" : "date.loading")}`;
  const { referenceDate, sourceStates } = model.freshness;
  const date = referenceDate === null ? shellT("rail.notPublished") : referenceDate;
  const states = sourceStates.map((state) => shellT(`state.${state}`)).join(" / ");
  return `${shellT("rail.reference")} · ${date} · ${shellT("rail.state")} · ${states}`;
}

function renderScopeRail() {
  if (!shell.modes) return;
  const mode = shell.modes.currentMode();
  const flags = currentFlags();
  const instances = railInstances(mode);
  const model = shell.registry ? railModel({ mode, flags, registry: shell.registry, instances }) : null;
  const entries = model
    ? model.entries
    : [...new Set(surfaceKeysFor(mode, flags).map((key) => SURFACES[key].scope))].map((scope) => ({
        scope, glyph: SCOPE_GLYPHS[scope], instances: instances[scope] || [], surfaces: [],
      }));
  const line = freshnessLine(model);
  const signature = JSON.stringify([shellLanguage(), mode, entries.map((e) => [e.scope, e.instances]), line]);
  if (signature === shell.signature) return;
  shell.signature = signature;

  const list = document.getElementById("scopeRailList");
  // Data arrives asynchronously and re-renders the rail; keep keyboard focus on the
  // same entry so a reader tabbing through the rail is never dropped onto <body>.
  const focused = document.activeElement && list.contains(document.activeElement)
    ? [document.activeElement.dataset.scope, [...list.querySelectorAll("button")].indexOf(document.activeElement)]
    : null;
  list.textContent = "";
  for (const entry of entries) {
    const labels = entry.instances.length ? entry.instances : [null];
    for (const instance of labels) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scope-rail-item";
      button.dataset.scope = entry.scope;
      button.setAttribute("aria-haspopup", "dialog");
      const name = shellT(`scope.${entry.scope}`);
      button.setAttribute("aria-label", `${shellT("rail.open")} ${name}${instance ? ` ${instance}` : ""}`);
      const glyph = document.createElement("span");
      glyph.className = "scope-glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = entry.glyph;
      const label = document.createElement("span");
      label.className = "scope-name";
      label.textContent = name;
      button.append(glyph, label);
      if (instance) {
        const detail = document.createElement("span");
        detail.className = "scope-instance";
        detail.textContent = instance;
        button.append(detail);
      }
      button.onclick = () => openEvidenceDrawer({ opener: button, scope: entry.scope });
      item.append(button);
      list.append(item);
    }
  }
  if (focused) {
    const buttons = [...list.querySelectorAll("button")];
    (buttons.find((node, index) => node.dataset.scope === focused[0] && index === focused[1]) || buttons.find((node) => node.dataset.scope === focused[0]))?.focus();
  }
  const freshness = document.getElementById("scopeRailFreshness");
  freshness.textContent = line;
  freshness.title = shellT("rail.oldest");
  freshness.onclick = () => openEvidenceDrawer({ opener: freshness });
}

// ------------------------------------------------------------------ drawer
function drawerDateText(field, value) {
  if (value !== null && value !== undefined) return String(value);
  return shellT(field === "retrieved_at" ? "date.notRecorded" : "date.notPublished");
}

// `verbatim` marks registry/publisher text: never translated, and annotated with
// its real language ("en" for English registry prose) so assistive tech reads it right.
function drawerRow(list, label, value, verbatim = null) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  if (value instanceof Node) dd.append(value);
  else dd.textContent = value;
  if (verbatim !== null) {
    dd.dataset.verbatim = "";
    if (verbatim) dd.lang = verbatim;
  }
  list.append(dt, dd);
}

function renderDrawerBody() {
  const body = document.getElementById("evidenceDrawerBody");
  const filter = shell.drawerFilter || {};
  body.textContent = "";
  const filterLine = document.getElementById("evidenceDrawerFilter");
  filterLine.textContent = filter.scope
    ? `${shellT("drawer.filter.scope")}: ${shellT(`scope.${filter.scope}`)}`
    : shellT("drawer.filter.all");
  if (filter.ambitoCode) filterLine.textContent += ` · ${shellT("planning.explorer.datasetProvenance")} · ${shellT("planning.explorer.inspected")}: ${filter.ambitoCode}`;
  if (!shell.registry) {
    const note = document.createElement("p");
    note.textContent = shellT(shell.registryFailed ? "rail.unavailable" : "date.loading");
    body.append(note);
    return;
  }
  const mode = shell.modes.currentMode();
  let surfaces = surfaceKeysFor(mode, currentFlags());
  if (filter.prefix) surfaces = surfaces.filter((key) => key.startsWith(filter.prefix));
  const records = buildEvidenceRecords({ surfaces, registry: shell.registry, scope: filter.scope || null });
  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = shellT("drawer.empty");
    body.append(empty);
    return;
  }
  const analyst = shell.reading === "analyst";
  for (const frozen of records) {
    const record = projectReading(frozen, shell.reading);
    const card = document.createElement("section");
    card.className = "drawer-record";
    card.dataset.surface = record.surface;
    card.dataset.scope = record.scope;
    const heading = document.createElement("h3");
    const glyph = document.createElement("span");
    glyph.className = "scope-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = SCOPE_GLYPHS[record.scope];
    heading.append(glyph, document.createTextNode(shellT(`surface.${record.surface}`)));
    card.append(heading);
    const facts = document.createElement("dl");
    facts.className = "drawer-fields";
    drawerRow(facts, shellT("f.scope"), shellT(`scope.${record.scope}`));
    if (analyst && record.scopeDefinition) drawerRow(facts, shellT("f.scopeDefinition"), record.scopeDefinition, "en");
    drawerRow(facts, shellT("f.unit"), shellT(record.unit));
    drawerRow(facts, shellT("f.derivation"), shellT(record.derivation));
    card.append(facts);
    for (const source of record.sources) {
      const block = document.createElement("div");
      block.className = "drawer-source";
      block.dataset.source = source.id;
      const title = document.createElement("h4");
      title.textContent = source.displayName; // our label: localised; the authority beside it is verbatim
      block.append(title);
      const fields = document.createElement("dl");
      fields.className = "drawer-fields";
      drawerRow(fields, shellT("f.authority"), source.authority || shellT("date.notPublished"), source.authority ? "" : null);
      drawerRow(fields, shellT("f.reference"), drawerDateText("reference_date", source.freshness.reference_date));
      drawerRow(fields, shellT("f.published"), drawerDateText("published_at", source.freshness.published_at));
      drawerRow(fields, shellT("f.retrieved"), drawerDateText("retrieved_at", source.freshness.retrieved_at));
      drawerRow(fields, shellT("f.frequency"), shellT(`freq.${source.freshness.update_frequency}`));
      drawerRow(fields, shellT("f.state"), shellT(`state.${source.freshness.source_state}`));
      if (analyst) {
        if (source.freshness.observed_cadence) drawerRow(fields, shellT("f.cadence"), source.freshness.observed_cadence);
        const route = [source.datasetUrl, source.artifact, source.builder].filter(Boolean).join(" · ");
        if (route) drawerRow(fields, shellT("f.route"), route, "");
        if (source.periodSemantics) drawerRow(fields, shellT("f.period"), source.periodSemantics, "en");
        if (source.freshnessEvidence) drawerRow(fields, shellT("f.freshnessEvidence"), source.freshnessEvidence, "en");
      }
      block.append(fields);
      if (source.changeDetectionProvenance) {
        const provenance = source.changeDetectionProvenance;
        const provenanceSection = document.createElement("section");
        provenanceSection.className = "drawer-change-provenance";
        const provenanceHeading = document.createElement("h5");
        provenanceHeading.textContent = shellT("planning.change.provenance");
        provenanceSection.append(provenanceHeading);
        for (const [side, sideKey] of [["previous", "planning.change.previousEdition"], ["current", "planning.change.currentEdition"]]) {
          const sideBlock = document.createElement("div");
          sideBlock.className = "drawer-change-edition";
          const sideHeading = document.createElement("h6");
          const sideDate = provenance.editions?.[side]?.S1?.reference_date;
          sideHeading.textContent = `${shellT(sideKey)} · ${planningDate(sideDate) || "—"}`;
          sideBlock.append(sideHeading);
          const editions = provenance.editions?.[side] || {};
          for (const family of ["S1", "S2"]) {
            const edition = editions[family];
            if (!edition) continue;
            const editionTitle = document.createElement("p");
            editionTitle.textContent = `${family} · ${edition.resource_id || "—"}`;
            const editionFacts = document.createElement("dl");
            editionFacts.className = "drawer-fields";
            drawerRow(editionFacts, shellT("planning.change.fingerprint"), edition.sha256 || "—", "en");
            drawerRow(editionFacts, shellT("planning.change.schemaEra"), edition.schema_era || "—", "en");
            drawerRow(editionFacts, shellT("planning.change.source"), edition.resource_url || "—", "en");
            drawerRow(editionFacts, shellT("planning.change.retrieved"), edition.retrieved_at || "—", "en");
            sideBlock.append(editionTitle, editionFacts);
          }
          provenanceSection.append(sideBlock);
        }
        const absenceReference = provenance.absence_reason_reference;
        if (absenceReference) {
          const annexBlock = document.createElement("div");
          annexBlock.className = "drawer-change-edition";
          const annexHeading = document.createElement("h6");
          annexHeading.textContent = shellT("planning.change.absenceReasonSource");
          annexBlock.append(annexHeading);
          const annexFacts = document.createElement("dl");
          annexFacts.className = "drawer-fields";
          drawerRow(annexFacts, shellT("planning.change.source"), `${absenceReference.resource_id || "—"} · ${absenceReference.resource_url || "—"}`, "en");
          drawerRow(annexFacts, shellT("planning.change.absenceReasonSource"), absenceReference.title || "—", "es");
          annexBlock.append(annexFacts);
          provenanceSection.append(annexBlock);
        }
        block.append(provenanceSection);
      }
      // The ceiling is registry text carried VERBATIM, in both readings and in both
      // document languages: only our label around it is localised.
      const ceiling = document.createElement("p");
      ceiling.className = "drawer-ceiling";
      const label = document.createElement("b");
      label.textContent = shellT("f.ceiling");
      const ceilingText = document.createElement("span");
      ceilingText.lang = "en";
      ceilingText.dataset.verbatim = "";
      ceilingText.textContent = source.interpretationCeiling;
      ceiling.append(label, ceilingText);
      block.append(ceiling);
      card.append(block);
    }
    body.append(card);
  }
}

function openEvidenceDrawer({ opener = document.activeElement, scope = null, prefix = null, focusSection = null, ambitoCode = null } = {}) {
  const dialog = document.getElementById("evidenceDrawer");
  shell.drawerFilter = { scope, prefix, ambitoCode };
  shell.drawerOpener = opener;
  // The opener is remembered by IDENTITY as well as by node. An artifact that
  // finishes loading while the drawer is open re-renders the rail and detaches
  // the exact button that opened it (K6's planning artifacts are the first ones
  // large enough to land mid-interaction). Without a key, focus on close falls
  // wherever the engine happens to leave it — in practice, inside the dialog
  // that just closed.
  shell.drawerOpenerKey = opener
    ? {
        id: opener.id || null,
        scope: (opener.dataset && opener.dataset.scope) || null,
        prefix: (opener.dataset && opener.dataset.evidencePrefix) || null,
      }
    : null;
  renderDrawerBody();
  for (const button of dialog.querySelectorAll(".reading-btn")) {
    button.setAttribute("aria-pressed", String(button.dataset.reading === shell.reading));
  }
  if (!dialog.open) dialog.showModal();
  if (focusSection) document.getElementById(focusSection).scrollIntoView({ block: "start" });
  else dialog.scrollTop = 0;
}

const evidenceDrawer = document.getElementById("evidenceDrawer");
document.getElementById("evidenceDrawerClose").onclick = () => evidenceDrawer.close();
// Backdrop click closes; Escape is native <dialog> behaviour.
evidenceDrawer.addEventListener("click", (event) => { if (event.target === evidenceDrawer) evidenceDrawer.close(); });
// Focus returns to the opener — or, if a re-render replaced it, to the nearest
// equivalent control — so keyboard users never land on <body>.
// The nearest LIVE equivalent of a re-rendered opener: the same element by id,
// else the rail control for the same analytical scope, else the per-value
// evidence control for the same surface prefix, else the rail's freshness
// control. A keyboard reader is never dropped onto <body> or left inside the
// dialog that just closed.
function resolveDrawerOpener(key) {
  if (key) {
    if (key.id) {
      const byId = document.getElementById(key.id);
      if (byId) return byId;
    }
    if (key.scope) {
      const byScope = document.querySelector(`#scopeRailList .scope-rail-item[data-scope="${key.scope}"]`);
      if (byScope) return byScope;
    }
    if (key.prefix) {
      const byPrefix = document.querySelector(`.evidence-link[data-evidence-prefix="${key.prefix}"]`);
      if (byPrefix) return byPrefix;
    }
  }
  return document.getElementById("scopeRailFreshness");
}

evidenceDrawer.addEventListener("close", () => {
  let target = shell.drawerOpener;
  if (!target || !document.contains(target)) target = resolveDrawerOpener(shell.drawerOpenerKey);
  shell.drawerOpener = null;
  shell.drawerOpenerKey = null;
  if (!target || typeof target.focus !== "function") return;
  target.focus();
  // Again after the engine's own modal focus restoration, which can run after
  // this event: when its remembered target has been detached it leaves focus
  // inside the closed dialog, and the synchronous call above would be undone.
  requestAnimationFrame(() => {
    if (document.contains(target)) target.focus();
  });
});
for (const button of evidenceDrawer.querySelectorAll(".reading-btn")) {
  button.onclick = () => {
    shell.reading = button.dataset.reading;
    for (const other of evidenceDrawer.querySelectorAll(".reading-btn")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
    renderDrawerBody();
    k11ScheduleUrlCommit();
  };
}
for (const button of document.querySelectorAll(".evidence-route")) {
  button.onclick = () => openEvidenceDrawer({ opener: button });
}
for (const button of document.querySelectorAll(".evidence-link")) {
  button.onclick = () => openEvidenceDrawer({ opener: button, prefix: button.dataset.evidencePrefix });
}

// ---------------------------------------------------- product-authored copy
// Surfaces that predate the shared i18n layer build their English inside pure,
// tested models. js/legacy-copy.js maps each PRODUCT-AUTHORED phrase to Spanish;
// this applier is the single place that mapping meets the DOM, for visible text
// AND accessibility copy (aria-label, title, ...). English is the source text:
// every translated node remembers it, so switching back restores it exactly.
// Official / publisher values live under [data-verbatim] and are never touched.
const COPY_ATTRIBUTES = ["aria-label", "aria-description", "title", "placeholder", "alt"];
const copyState = { observer: null };

function copyRejects(el) {
  return el.closest("script,style,[data-verbatim]") !== null;
}
function localizeTextNode(node) {
  const parent = node.parentElement;
  // Map internals (cluster counts, POI names, halo numerals) are data, not UI copy.
  if (!parent || copyRejects(parent)) return;
  if (parent.closest(".leaflet-pane") && !parent.closest(".leaflet-tooltip,.leaflet-popup")) return;
  const current = node.nodeValue;
  if (node.__es !== undefined && current === node.__es) return;
  const translated = localizeCopyEs(current);
  if (translated !== current) { node.__en = current; node.__es = translated; node.nodeValue = translated; }
  else { delete node.__en; delete node.__es; }
  // A provenance line our catalogue left alone is publisher / registry wording: it
  // keeps its own language, and says so. (Sentences we author are translated.)
  if (parent.hasAttribute("data-provenance-line")) {
    if (translated === current && /[A-Za-z]{4}/.test(current)) parent.setAttribute("lang", "en");
    else parent.removeAttribute("lang");
  }
}
function localizeAttribute(el, name) {
  if (!el.hasAttribute(name) || copyRejects(el)) return;
  const current = el.getAttribute(name);
  const store = (el.__attr ||= {});
  if (store[name] && current === store[name].es) return;
  const translated = localizeCopyEs(current);
  if (translated !== current) { store[name] = { en: current, es: translated }; el.setAttribute(name, translated); }
  else delete store[name];
}
function localizeTree(root) {
  if (root.nodeType === 3) { localizeTextNode(root); return; }
  if (root.nodeType !== 1 || copyRejects(root)) return;
  for (const name of COPY_ATTRIBUTES) localizeAttribute(root, name);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.nodeType === 1 && copyRejects(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) localizeTextNode(node);
    else for (const name of COPY_ATTRIBUTES) localizeAttribute(node, name);
  }
}
function restoreCopy() {
  for (const line of document.querySelectorAll("[data-provenance-line][lang]")) line.removeAttribute("lang");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3 && node.__en !== undefined) {
      if (node.nodeValue === node.__es) node.nodeValue = node.__en;
      delete node.__en; delete node.__es;
    } else if (node.nodeType === 1 && node.__attr) {
      for (const [name, pair] of Object.entries(node.__attr)) {
        if (node.getAttribute(name) === pair.es) node.setAttribute(name, pair.en);
      }
      delete node.__attr;
    }
  }
}
function applyCopyLanguage() {
  copyState.observer?.disconnect();
  copyState.observer = null;
  if (shellLanguage() !== "es") { restoreCopy(); return; }
  localizeTree(document.body);
  copyState.observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach(localizeTree);
      else if (record.type === "characterData") localizeTextNode(record.target);
      else if (record.type === "attributes") localizeAttribute(record.target, record.attributeName);
    }
  });
  copyState.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: COPY_ATTRIBUTES });
}

applyShellCopy();
renderModeUi();
applyCopyLanguage();

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
    analysisPanel.style.removeProperty("--analysis-panel-width");
    analysisPanel.style.removeProperty("--analysis-panel-height");
    return;
  }
  const next = clampPanelSize(width, height);
  analysisPanel.style.setProperty("--analysis-panel-width", `${Math.round(next.width)}px`);
  analysisPanel.style.setProperty("--analysis-panel-height", `${Math.round(next.height)}px`);
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
  analysisPanel.style.removeProperty("--analysis-panel-width");
  analysisPanel.style.removeProperty("--analysis-panel-height");
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
    analysisPanel.style.removeProperty("--analysis-panel-width");
    analysisPanel.style.removeProperty("--analysis-panel-height");
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

  // K11 (#73): the operational layers and the Lens surfaces are on screen, so the
  // interface dimensions of a shared reading can be restored now. The ámbito and
  // baseline dimensions wait for the planning index (phase 2, below).
  k11ApplyRestorePhase1();

  // Administrative context loads after the operational layers are on screen:
  // the canonical geography is ~2.5 MB and must never delay the first paint of
  // the map. It is parsed and indexed exactly once, then reused.
  loadAreaContext().finally(loadHospitalityContext);
  // The planning artifacts load on their own track, for the same reason: the
  // ambito evidence and the administrative registers are different publishers
  // with different universes, and one must never cost the other.
  // K11: the ámbito/baseline dimensions of a shared reading restore once the
  // planning index is ready (or has failed), so an ámbito code is never rejected
  // merely because its official geometry has not finished loading yet.
  loadPlanningContext().finally(() => k11ApplyRestorePhase2());
  // Started separately and never awaited together with the area context: the two
  // surfaces describe different things, from different publishers, and must fail
  // independently of each other.
  loadDestinationContext();
  // K11: the domestic-origin source month restores once its own artifact has
  // loaded (or failed) — independently of the planning track — so a shared CITY
  // month is validated against the real published set, never silently defaulted.
  loadDomesticOrigins().finally(() => k11ApplyOriginMonthRestore());
}

boot();

// ===================================================================== K10 ====
// Ámbito comparison in COMPARE (#72). A SECOND comparison scope that reads the
// one authoritative state from js/ambito-comparison.js (classic-script globals)
// and the committed K6/K7 evidence via the ESM adapter. It never touches the
// Lens-circle surfaces, handlers, dragging, halo or licence popups: the circle
// surfaces and this block are gated by `#compareLine[data-compare-scope]` and
// never both show, so an ámbito comparison can never be mistaken for a Lens one.
const ambitoCompare = {
  scope: "LENS",
  a: null,
  b: null,
  pending: "A",
  adapter: null,
  prevArtifact: null,
  polygons: null,
  populated: false,
};

function ambitoT(key) {
  if (typeof AMBITO_COMPARISON_DICTIONARIES === "undefined") return key;
  const dict = AMBITO_COMPARISON_DICTIONARIES[shellLanguage()] || AMBITO_COMPARISON_DICTIONARIES.en;
  return dict[key] ?? AMBITO_COMPARISON_DICTIONARIES.en[key] ?? key;
}
function ambitoNum(value) {
  return Number(value).toLocaleString(shellLanguage() === "es" ? "es-ES" : "en-GB");
}
function ambitoSideText(side) {
  if (side.state === "PUBLISHED") return ambitoNum(side.value);
  const es = shellLanguage() === "es";
  if (side.state === "MULTIPLE_ROWS_NOT_COMBINED") return es ? "varias filas" : "multiple rows";
  if (side.state === "NOT_PUBLISHED_IN_EDITION") return es ? "no en la edición" : "not in edition";
  return es ? "no publicado" : "not published";
}

function ambitoCodeList() {
  if (planningState !== "ready" || !planningModel.index) return [];
  return planningModel.index.entries.map((entry) => entry.code);
}

// Is this an EXACT official code of the committed universe? Selection accepts
// only an exact code; anything else is treated as no selection (never coerced to
// a near match — the -RP discipline forbids normalisation).
function isKnownAmbitoCode(code) {
  if (!code) return false;
  if (!ambitoCompare.codeSet) ambitoCompare.codeSet = new Set(ambitoCodeList());
  return ambitoCompare.codeSet.has(code);
}

function populateAmbitoSelects() {
  if (ambitoCompare.populated) return;
  const codes = ambitoCodeList();
  if (codes.length === 0) return;
  ambitoCompare.codeSet = new Set(codes);
  const datalist = document.getElementById("ambitoCodeDatalist");
  if (!datalist) return;
  datalist.replaceChildren();
  for (const code of codes) {
    const opt = document.createElement("option");
    opt.value = code;
    datalist.append(opt);
  }
  ambitoCompare.populated = true;
}

function setCompareScope(scope) {
  ambitoCompare.scope = scope;
  const line = document.getElementById("compareLine");
  if (line) line.dataset.compareScope = scope;
  const lensBtn = document.getElementById("compareScopeLens");
  const ambBtn = document.getElementById("compareScopeAmbito");
  if (lensBtn) lensBtn.setAttribute("aria-pressed", String(scope === "LENS"));
  if (ambBtn) ambBtn.setAttribute("aria-pressed", String(scope === "AMBITO"));
  const block = document.getElementById("ambitoCompare");
  if (block) block.hidden = scope !== "AMBITO";
  if (scope === "AMBITO") {
    populateAmbitoSelects();
    // Switching INTO ámbito scope invalidates any lingering Lens-circle baseline, so a
    // captured circle baseline can never silently survive a scope switch.
    if (typeof resetSpatialBaseline === "function") resetSpatialBaseline();
    renderAmbitoCompare();
  } else {
    clearAmbitoComparePolygons();
  }
  k11ScheduleUrlCommit();
}

function handleAmbitoCompareMapClick(latlng) {
  if (!shell.modes || shell.modes.currentMode() !== "COMPARE") return false;
  if (ambitoCompare.scope !== "AMBITO") return false;
  if (planningState !== "ready" || !planningModel.index || !planningModel.module) return false;
  const res = planningModel.index.ambitoContaining(latlng.lng, latlng.lat);
  const hint = document.getElementById("ambitoPickHint");
  if (!res || res.state !== planningModel.module.AMBITO_STATE.RESOLVED) {
    if (hint) hint.textContent = shellLanguage() === "es"
      ? "Ese punto no está dentro de ningún ámbito oficial."
      : "That point is not inside any official ámbito.";
    return true; // consumed: the Lens is NOT moved in ámbito-select mode
  }
  const slot = ambitoCompare.pending;
  if (slot === "A") ambitoCompare.a = res.ambitoCode;
  else ambitoCompare.b = res.ambitoCode;
  const sel = document.getElementById(slot === "A" ? "ambitoSelectA" : "ambitoSelectB");
  if (sel) sel.value = res.ambitoCode;
  ambitoCompare.pending = slot === "A" ? "B" : "A";
  renderAmbitoCompare();
  return true;
}

async function ensureAmbitoAdapter() {
  if (ambitoCompare.adapter) return ambitoCompare.adapter;
  try {
    ambitoCompare.adapter = await import(moduleUrl("ambito-comparison-adapter.js"));
    if (planningModel.changePair) {
      ambitoCompare.prevArtifact = ambitoCompare.adapter.reconstructPreviousStateArtifact({
        change_detection: planningModel.changePair,
      });
    }
  } catch (error) {
    console.warn("ámbito comparison adapter unavailable", error);
    ambitoCompare.adapter = null;
  }
  return ambitoCompare.adapter;
}

function clearAmbitoComparePolygons() {
  if (ambitoCompare.polygons) {
    for (const layer of ambitoCompare.polygons) map.removeLayer(layer);
    ambitoCompare.polygons = null;
  }
}

function renderAmbitoComparePolygons() {
  clearAmbitoComparePolygons();
  if (ambitoCompare.scope !== "AMBITO" || planningState !== "ready" || !planningModel.index) return;
  const layers = [];
  const draw = (code, which) => {
    const feature = planningModel.index.featureFor(code);
    if (!feature) return;
    const isB = which === "B";
    const layer = L.geoJSON(feature, {
      pane: "planningPane",
      interactive: false,
      style: () => ({
        color: isB ? "#43d7ff" : "#9ccdff",
        weight: 3,
        opacity: 0.95,
        dashArray: isB ? "7 5" : null,
        fill: true,
        fillColor: isB ? "#43d7ff" : "#3da8ff",
        fillOpacity: 0.1,
      }),
    }).addTo(map);
    layers.push(layer);
    const label = L.tooltip({ permanent: true, direction: "center", className: "planning-ambito-label", interactive: false, opacity: 1 })
      .setLatLng(layer.getBounds().getCenter())
      .setContent(`${which} · ${code}`)
      .addTo(map);
    layers.push(label);
  };
  if (ambitoCompare.a) draw(ambitoCompare.a, "A");
  if (ambitoCompare.b) draw(ambitoCompare.b, "B");
  ambitoCompare.polygons = layers;
}

// The reference date of one metric side from ITS OWN source family — S1
// development-state for phase/surface, S2 available-buildability for buildability.
function ambitoSideDate(side, familyKey) {
  const date = side && side.edition && side.edition[familyKey] ? side.edition[familyKey].referenceDate : null;
  return date ? planningDate(date) : shellT("date.notPublished");
}

// A focusable metric control, reused by the categorical list and the quantity
// table so the Bridge reading can focus/lock any of the nine canonical metrics.
function ambitoMetricButton(metricId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ambito-metric-focus";
  button.dataset.ambitoMetric = metricId;
  button.setAttribute("aria-pressed", String(ambitoCompare.lockedMetric === metricId));
  button.textContent = ambitoT(`metric.${metricId}`);
  return button;
}

function renderAmbitoModel(model) {
  ambitoCompare.lastModel = model;
  const body = document.getElementById("ambitoCompareBody");
  const refusalEl = document.getElementById("ambitoCompareRefusal");
  if (!body || !refusalEl) return;
  // Cross-scope refusal: an ámbito and a Lens circle are different scopes.
  if (model.comparable === false) {
    refusalEl.hidden = false;
    refusalEl.textContent = ambitoT(`refusal.${model.refusal ? model.refusal.reasonCode : "cross-scope"}`);
    body.hidden = true;
    return;
  }
  refusalEl.hidden = true;
  body.hidden = false;

  // Identity: both source-family reference dates (S1 phases/surface, S2 build).
  const setId = (codeId, denomId, dateId, side) => {
    setText(codeId, side.ambitoCode || "—");
    setText(denomId, side.denomination || "");
    const s1 = ambitoSideDate(side, "developmentState");
    const s2 = ambitoSideDate(side, "availableBuildability");
    const es = shellLanguage() === "es";
    setText(dateId, es ? `fases ${s1} · edificabilidad ${s2}` : `phases ${s1} · buildability ${s2}`);
  };
  setId("ambitoIdACode", "ambitoIdADenom", "ambitoIdADate", model.a);
  setId("ambitoIdBCode", "ambitoIdBDenom", "ambitoIdBDate", model.b);

  const rows = ambitoComparisonRows(model);

  // Categorical phases: two verbatim states + SAME/DIFFERENT, no arrow/sign/delta.
  const catList = document.getElementById("ambitoCatItems");
  catList.replaceChildren();
  for (const metric of rows.filter((m) => m.kind === METRIC_KIND.CATEGORICAL)) {
    const li = document.createElement("li");
    li.className = "ambito-cat-item";
    li.dataset.metric = metric.id;
    const field = document.createElement("span");
    field.className = "ambito-cat-field";
    field.append(ambitoMetricButton(metric.id));
    const values = document.createElement("span");
    values.className = "ambito-cat-values";
    const aVal = document.createElement("b");
    aVal.dataset.verbatim = "";
    aVal.textContent = metric.a.sourceValue ?? "—";
    const bVal = document.createElement("b");
    bVal.dataset.verbatim = "";
    bVal.textContent = metric.b.sourceValue ?? "—";
    values.append(document.createTextNode("A "), aVal, document.createTextNode(" · B "), bVal);
    if (metric.relation === "INDETERMINATE" && metric.indeterminateReasonCode) {
      const reason = document.createElement("small");
      reason.className = "ambito-reason";
      reason.textContent = ambitoT(`withheld.${metric.indeterminateReasonCode}`);
      values.append(document.createTextNode(" · "), reason);
    }
    const rel = document.createElement("span");
    rel.className = "ambito-rel";
    rel.dataset.relation = metric.relation;
    rel.textContent = ambitoT(`relation.${metric.relation}`);
    li.append(field, rel, values);
    catList.append(li);
  }

  // Quantities: B − A in m² only when comparable; otherwise the withheld reason.
  // Each comparable row also shows a WITHIN-METRIC visual (two bars normalised to
  // that metric's own max). Each metric has its own reference: bars are never
  // shared across metrics, and categorical phases get no bar.
  const qtyRows = document.getElementById("ambitoQtyRows");
  qtyRows.replaceChildren();
  for (const metric of rows.filter((m) => m.kind === METRIC_KIND.QUANTITY)) {
    const tr = document.createElement("tr");
    tr.dataset.metric = metric.id;
    const name = document.createElement("th");
    name.scope = "row";
    name.append(ambitoMetricButton(metric.id));
    const aTd = document.createElement("td");
    aTd.textContent = ambitoSideText(metric.a);
    const bTd = document.createElement("td");
    bTd.textContent = ambitoSideText(metric.b);
    const dTd = document.createElement("td");
    const scaleTd = document.createElement("td");
    scaleTd.className = "ambito-scale-cell";
    if (metric.comparable) {
      const sign = metric.deltaValue > 0 ? "+" : "";
      dTd.textContent = `${sign}${ambitoNum(metric.deltaValue)}`;
      scaleTd.append(ambitoWithinMetricBars(metric));
    } else {
      dTd.className = "ambito-withheld";
      dTd.textContent = ambitoT(`withheld.${metric.withheldReasonCode}`);
      scaleTd.textContent = "—";
    }
    tr.append(name, aTd, bTd, dTd, scaleTd);
    qtyRows.append(tr);
  }
  setText("ambitoQtyDates", (shellLanguage() === "es" ? "Edición de edificabilidad: " : "Buildability edition: ") +
    ambitoSideDate(model.a, "availableBuildability"));

  // Decision Insight: descriptive per-metric contrasts, fixed canonical order.
  const insightItems = typeof ambitoDecisionInsightItems === "function" ? ambitoDecisionInsightItems(model) : [];
  const insightList = document.getElementById("ambitoInsightItems");
  if (insightList) {
    insightList.replaceChildren();
    for (const item of insightItems) {
      const li = document.createElement("li");
      li.className = "ambito-insight-item";
      li.dataset.metric = item.metricId;
      li.dataset.state = item.state;
      const name = document.createElement("span");
      name.className = "aii-metric";
      name.textContent = ambitoT(`metric.${item.metricId}`);
      const reading = document.createElement("span");
      reading.className = "aii-reading";
      reading.textContent = ambitoInsightReadingText(item);
      li.append(name, reading);
      insightList.append(li);
    }
  }
  setText("ambitoInsightGuard", ambitoT("guard.descriptive-only"));

  const guard = document.getElementById("ambitoCompareGuard");
  if (guard) guard.textContent = ambitoT("guard.descriptive-only");
  const radiusNote = document.getElementById("ambitoRadiusNote");
  if (radiusNote) radiusNote.textContent = ambitoT("radius.non_applicable");

  renderAmbitoBridge();
}

// Two within-metric bars (A, B) normalised to the metric's OWN max. No shared
// scale across metrics, none with any count metric (there are none in ámbito
// scope), and categorical phases never reach here. Dynamic widths are set on the
// element (not in the static HTML), as the sole permitted dynamic presentation.
function ambitoWithinMetricBars(metric) {
  const wrap = document.createElement("span");
  wrap.className = "ambito-bars";
  const aVal = Number(metric.a.value) || 0;
  const bVal = Number(metric.b.value) || 0;
  const max = Math.max(Math.abs(aVal), Math.abs(bVal));
  const pct = (v) => (max > 0 ? (Math.abs(v) / max) * 100 : 0);
  for (const [which, value] of [["a", aVal], ["b", bVal]]) {
    const track = document.createElement("span");
    track.className = `ambito-bar-track ac-${which}`;
    const fill = document.createElement("span");
    fill.className = "ambito-bar-fill";
    fill.style.width = `${pct(value)}%`;
    track.append(fill);
    wrap.append(track);
  }
  wrap.dataset.metricMax = String(max);
  return wrap;
}

function ambitoInsightReadingText(item) {
  if (item.kind === METRIC_KIND.CATEGORICAL) {
    const base = ambitoT(`relation.${item.relation}`);
    return item.reasonCode ? `${base} · ${ambitoT(`withheld.${item.reasonCode}`)}` : base;
  }
  if (item.state === "comparable") {
    const sign = item.deltaValue > 0 ? "+" : "";
    return `B − A ${sign}${ambitoNum(item.deltaValue)} ${item.unit}`;
  }
  return ambitoT(`withheld.${item.withheldReasonCode}`);
}

// The Comparison Bridge (ámbito scope): the focused reading of ONE metric, read
// from ambitoBridgeReading — the same authoritative state, never recomputed.
function renderAmbitoBridge() {
  const empty = document.getElementById("ambitoBridgeEmpty");
  const reading = document.getElementById("ambitoBridgeReading");
  const a11y = document.getElementById("ambitoBridgeA11y");
  if (!empty || !reading) return;
  const model = ambitoCompare.lastModel;
  const metricId = ambitoCompare.lockedMetric || ambitoCompare.focusedMetric;
  const locked = Boolean(ambitoCompare.lockedMetric);
  if (!model || model.comparable === false || !metricId || typeof ambitoBridgeReading !== "function") {
    empty.hidden = false;
    reading.hidden = true;
    for (const btn of document.querySelectorAll(".ambito-metric-focus")) btn.setAttribute("aria-pressed", "false");
    return;
  }
  const b = ambitoBridgeReading(model, metricId);
  if (!b.available) {
    empty.hidden = false;
    reading.hidden = true;
    return;
  }
  empty.hidden = true;
  reading.hidden = false;
  setText("ambitoBridgeMetric", ambitoT(`metric.${metricId}`));
  const lockEl = document.getElementById("ambitoBridgeLock");
  if (lockEl) lockEl.hidden = !locked;
  const sideText = (side) =>
    b.kind === METRIC_KIND.CATEGORICAL ? (side.value.sourceValue ?? "—") : ambitoSideText(side.value);
  setText("ambitoBridgeA", `A ${sideText(b.a)}`);
  setText("ambitoBridgeB", `B ${sideText(b.b)}`);
  const rel = document.getElementById("ambitoBridgeRel");
  const qual = document.getElementById("ambitoBridgeQualifier");
  if (b.kind === METRIC_KIND.CATEGORICAL) {
    if (rel) { rel.dataset.relation = b.relation; rel.textContent = ambitoT(`relation.${b.relation}`); }
    if (qual) qual.textContent = b.withheldReasonCode ? ambitoT(`withheld.${b.withheldReasonCode}`) : "";
  } else if (b.comparable) {
    const sign = b.deltaValue > 0 ? "+" : "";
    if (rel) { rel.dataset.relation = ""; rel.textContent = `B − A ${sign}${ambitoNum(b.deltaValue)} ${b.unit}`; }
    if (qual) qual.textContent = "";
  } else {
    if (rel) { rel.dataset.relation = ""; rel.textContent = ambitoT(`withheld.${b.withheldReasonCode}`); }
    if (qual) qual.textContent = "";
  }
  for (const btn of document.querySelectorAll(".ambito-metric-focus")) {
    btn.setAttribute("aria-pressed", String(locked && btn.dataset.ambitoMetric === metricId));
  }
  if (a11y) a11y.textContent = `${ambitoT(`metric.${metricId}`)}: ${document.getElementById("ambitoBridgeRel").textContent}`;
}

function renderAmbitoEdition(model, adapter) {
  const items = document.getElementById("ambitoEditionItems");
  const note = document.getElementById("ambitoEditionNote");
  if (!items) return;
  items.replaceChildren();
  if (note) note.hidden = true;
  const changeModule = planningModel.changeModule;
  if (!changeModule || !ambitoCompare.prevArtifact || typeof buildAmbitoEditionSensitivity !== "function") {
    if (note) { note.hidden = false; note.textContent = shellLanguage() === "es" ? "Sin edición anterior disponible." : "No previous edition available."; }
    return;
  }
  const prevA = adapter.buildPreviousAmbitoInput(ambitoCompare.a, ambitoCompare.prevArtifact);
  const prevB = adapter.buildPreviousAmbitoInput(ambitoCompare.b, ambitoCompare.prevArtifact);
  const prevModel = buildAmbitoComparisonModel(prevA, prevB);
  const stateArtifact = { change_detection: planningModel.changePair };
  const continuity = {
    a: editionContinuityFromOutcome(adapter.governingContinuityOutcome(adapter.editionOutcomes(ambitoCompare.a, stateArtifact, changeModule))),
    b: editionContinuityFromOutcome(adapter.governingContinuityOutcome(adapter.editionOutcomes(ambitoCompare.b, stateArtifact, changeModule))),
  };
  const sens = buildAmbitoEditionSensitivity(model, prevModel, continuity);
  if (!sens.applicable) {
    if (note) {
      note.hidden = false;
      const reason = sens.reasonCode === "IDENTITY_MISMATCH"
        ? (shellLanguage() === "es" ? "Identidad del ámbito no coincide entre ediciones." : "Ámbito identity does not match across editions.")
        : (shellLanguage() === "es" ? "Sensibilidad de edición no disponible." : "Edition sensitivity unavailable.");
      note.textContent = reason;
    }
    return;
  }
  for (const item of sens.items) {
    const li = document.createElement("li");
    li.className = "ambito-edition-item";
    li.dataset.metric = item.metricId;
    li.dataset.transition = item.code;
    const name = document.createElement("span");
    name.className = "aei-metric";
    name.textContent = ambitoT(`metric.${item.metricId}`);
    const trans = document.createElement("span");
    trans.className = "aei-transition";
    // the metric's own-family baseline→scenario reference dates, then the transition
    const baseline = item.baselineReferenceDate ? item.baselineReferenceDate.a : null;
    const scenario = item.scenarioReferenceDate ? item.scenarioReferenceDate.a : null;
    const dates = baseline && scenario ? `${planningDate(baseline)} → ${planningDate(scenario)} · ` : "";
    const reason = item.nonContinuousReason ? ` · ${ambitoT(`continuity.${item.nonContinuousReason}`)}` : "";
    trans.textContent = `${dates}${ambitoT(`transition.${item.code}`)}${reason}`;
    li.append(name, trans);
    items.append(li);
  }
}

// Focus / lock wiring for the ámbito Bridge. Hover or keyboard focus PREVIEWS a
// metric; click/Enter/Space LOCKS it; Escape clears. Mirrors the circle Bridge's
// focus architecture, on real <button> tab stops.
function ambitoFocusMetric(metricId, { lock = false } = {}) {
  if (lock) {
    ambitoCompare.lockedMetric = ambitoCompare.lockedMetric === metricId ? null : metricId;
  } else {
    ambitoCompare.focusedMetric = metricId;
  }
  renderAmbitoBridge();
}
function ambitoClearFocus() {
  ambitoCompare.focusedMetric = null;
  renderAmbitoBridge();
}

function renderAmbitoCompare() {
  if (ambitoCompare.scope !== "AMBITO") return;
  const body = document.getElementById("ambitoCompareBody");
  const refusalEl = document.getElementById("ambitoCompareRefusal");
  const radiusNote = document.getElementById("ambitoRadiusNote");
  if (radiusNote) radiusNote.textContent = ambitoT("radius.non_applicable");
  if (typeof buildAmbitoComparisonModel !== "function") return;
  if (!ambitoCompare.a || !ambitoCompare.b || planningState !== "ready" || !planningModel.index) {
    if (body) body.hidden = true;
    if (refusalEl) refusalEl.hidden = true;
    clearAmbitoComparePolygons();
    ambitoCompare.model = null; // K11: nothing comparable to transcribe
    return;
  }
  ensureAmbitoAdapter().then((adapter) => {
    if (!adapter || ambitoCompare.scope !== "AMBITO") return;
    const a = adapter.buildCurrentAmbitoInput(ambitoCompare.a, planningModel.index);
    const b = adapter.buildCurrentAmbitoInput(ambitoCompare.b, planningModel.index);
    const model = buildAmbitoComparisonModel(a, b);
    // K11: cache the authoritative frozen model so the export transcribes it
    // instead of rebuilding a second one.
    ambitoCompare.model = model;
    renderAmbitoModel(model);
    renderAmbitoComparePolygons();
    if (model.comparable !== false) renderAmbitoEdition(model, adapter);
  });
}

// Called after the planning artifacts finish loading, so a user who opened the
// ámbito scope before the data arrived gets the populated selects and a render.
function refreshAmbitoCompareData() {
  if (ambitoCompare.scope !== "AMBITO") return;
  populateAmbitoSelects();
  renderAmbitoCompare();
}

{
  const line = document.getElementById("compareLine");
  if (line && !line.dataset.compareScope) line.dataset.compareScope = "LENS";
  const lensBtn = document.getElementById("compareScopeLens");
  const ambBtn = document.getElementById("compareScopeAmbito");
  if (lensBtn) lensBtn.onclick = () => setCompareScope("LENS");
  if (ambBtn) ambBtn.onclick = () => setCompareScope("AMBITO");
  const selA = document.getElementById("ambitoSelectA");
  const selB = document.getElementById("ambitoSelectB");
  const onPick = (slot) => (event) => {
    const code = event.target.value.trim();
    ambitoCompare[slot] = isKnownAmbitoCode(code) ? code : null;
    renderAmbitoCompare();
    k11ScheduleUrlCommit();
  };
  if (selA) { selA.onchange = onPick("a"); selA.oninput = onPick("a"); }
  if (selB) { selB.onchange = onPick("b"); selB.oninput = onPick("b"); }

  // Bridge focus/lock, delegated on the ámbito body: hover/keyboard focus previews
  // a metric, click/Enter/Space locks it, Escape clears. Real <button> tab stops.
  const ambitoBody = document.getElementById("ambitoCompareBody");
  if (ambitoBody) {
    const metricOf = (event) => event.target.closest(".ambito-metric-focus")?.dataset.ambitoMetric || null;
    ambitoBody.addEventListener("pointerover", (event) => {
      const metric = metricOf(event);
      if (metric) ambitoFocusMetric(metric);
    });
    ambitoBody.addEventListener("focusin", (event) => {
      const metric = metricOf(event);
      if (metric) ambitoFocusMetric(metric);
    });
    ambitoBody.addEventListener("pointerout", (event) => {
      if (metricOf(event)) ambitoClearFocus();
    });
    ambitoBody.addEventListener("focusout", (event) => {
      if (metricOf(event)) ambitoClearFocus();
    });
    ambitoBody.addEventListener("click", (event) => {
      const metric = metricOf(event);
      if (metric) ambitoFocusMetric(metric, { lock: true });
    });
    ambitoBody.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && (ambitoCompare.lockedMetric || ambitoCompare.focusedMetric)) {
        ambitoCompare.lockedMetric = null;
        ambitoCompare.focusedMetric = null;
        renderAmbitoBridge();
      }
    });
  }

  // Leaving COMPARE clears the two official polygons so they never linger on the
  // map in PLACE or CITY. The Lens-circle surfaces are untouched.
  shell.modes.subscribe((mode) => {
    if (mode !== "COMPARE") clearAmbitoComparePolygons();
    else if (ambitoCompare.scope === "AMBITO") renderAmbitoComparePolygons();
  });
}

// ===================================================================== K11 ====
// Shareable evidence state & documented export (#73). This block is the ONLY
// bridge between the live application state and the pure, versioned URL contract
// in js/evidence-url.js. It reads the current reading into the contract's shape,
// commits a canonical URL with history.replaceState (never pushState, so Lens
// drags and ordinary interaction never pollute the back button), restores a
// shared reading in stages that respect the real initialisation order, and copies
// a share link with honest success/failure feedback. The export itself lives in
// js/evidence-export.js and is wired at the end of this block.

// Local copy, following the bridge/ámbito pattern (a surface-scoped dictionary
// rather than widening the shared shell dictionary and its tests).
const K11_COPY = Object.freeze({
  en: Object.freeze({
    "share.title": "Share & export this reading",
    "share.lede": "Copy a link that reproduces this exact reading, or export its evidence, geometry, sources and limits for QGIS, GeoLibre or a spreadsheet.",
    "share.copyBtn": "Copy shareable link",
    "share.exportBtn": "Export evidence",
    "notice.dismiss": "Dismiss notice",
    "share.copied": "Link copied — it reproduces this exact reading.",
    "share.copyFailed": "Could not copy automatically. Copy this link:",
    "export.ready": "Evidence exported. If your browser blocked a download, use the links below:",
    "export.empty": "Nothing to export yet — configure a reading first.",
    "export.failed": "Export could not be prepared.",
    "restore.partialTitle": "Partial restore",
    "restore.refusedTitle": "Link not restored",
    "restore.snapshotTitle": "Different deployment build",
    "restore.partialLede": "Some of this shared reading could not be restored:",
    "restore.refusedLede": "This link uses an unsupported format and was not restored, so you are seeing the default reading rather than a different one.",
    "restore.snapshotLede": "The interface was restored, but this link was made on a different deployment build, which may have republished different values — a number may no longer match the original.",
    "restore.baselineEvidence": "the sensitivity baseline (the evidence universe changed, so it cannot be reproduced exactly)",
    "reason.INVALID_RADIUS": "a Lens radius out of range",
    "reason.RADIUS_NOT_ON_STEP": "a Lens radius off the 50 m step (it would have been rounded)",
    "reason.INVALID_COORDINATES": "a Lens centre outside Madrid",
    "reason.UNKNOWN_AMBITO": "an unknown planning ámbito code",
    "reason.UNKNOWN_LAYER": "an unknown map layer",
    "reason.UNKNOWN_METRIC": "an unsupported metric",
    "reason.INVALID_MODE": "an unknown mode",
    "reason.INVALID_SCOPE": "an unknown comparison scope",
    "reason.INVALID_BASELINE": "an invalid sensitivity baseline",
    "reason.INVALID_TIMESTEP": "an invalid heat time",
    "reason.INVALID_STAY_KIND": "an unknown accommodation filter",
    "reason.INVALID_ORIGIN_MONTH": "a domestic-origin month not in the published set",
    "reason.ORIGIN_UNAVAILABLE": "the domestic-origin source month (its data is unavailable in this deployment)",
    "reason.INVALID_LICENCE_WINDOW": "a licence grant-date window outside the register (it would have been clamped to a different window)",
    "reason.UNKNOWN_HOSPITALITY_METRIC": "an unknown hospitality indicator",
    "reason.UNKNOWN_HOSPITALITY_BARRIO": "a hospitality barrio not in the published set",
    "reason.INVALID_READING": "an unknown reading preference",
    "reason.INVALID_LANGUAGE": "an unknown language",
    "reason.INVALID_ACTIVE_LENS": "an unknown active Lens",
    "reason.MALFORMED": "a malformed value",
  }),
  es: Object.freeze({
    "share.title": "Compartir y exportar esta lectura",
    "share.lede": "Copie un enlace que reproduzca esta lectura exacta, o exporte su evidencia, geometría, fuentes y límites para QGIS, GeoLibre o una hoja de cálculo.",
    "share.copyBtn": "Copiar enlace",
    "share.exportBtn": "Exportar evidencia",
    "notice.dismiss": "Descartar aviso",
    "share.copied": "Enlace copiado: reproduce esta lectura exacta.",
    "share.copyFailed": "No se pudo copiar automáticamente. Copie este enlace:",
    "export.ready": "Evidencia exportada. Si su navegador bloqueó alguna descarga, use los enlaces siguientes:",
    "export.empty": "Aún no hay nada que exportar: configure primero una lectura.",
    "export.failed": "No se pudo preparar la exportación.",
    "restore.partialTitle": "Restauración parcial",
    "restore.refusedTitle": "Enlace no restaurado",
    "restore.snapshotTitle": "Compilación de despliegue distinta",
    "restore.partialLede": "Parte de esta lectura compartida no se pudo restaurar:",
    "restore.refusedLede": "Este enlace usa un formato no admitido y no se restauró, por lo que ve la lectura por defecto y no otra distinta.",
    "restore.snapshotLede": "Se restauró la interfaz, pero este enlace se creó en una compilación de despliegue distinta, que puede haber republicado valores diferentes: algún número podría no coincidir con el original.",
    "restore.baselineEvidence": "la línea base de sensibilidad (cambió el universo de evidencia, por lo que no puede reproducirse exactamente)",
    "reason.INVALID_RADIUS": "un radio de Lente fuera de rango",
    "reason.RADIUS_NOT_ON_STEP": "un radio de Lente fuera del paso de 50 m (se habría redondeado)",
    "reason.INVALID_COORDINATES": "un centro de Lente fuera de Madrid",
    "reason.UNKNOWN_AMBITO": "un código de ámbito de planeamiento desconocido",
    "reason.UNKNOWN_LAYER": "una capa de mapa desconocida",
    "reason.UNKNOWN_METRIC": "una métrica no admitida",
    "reason.INVALID_MODE": "un modo desconocido",
    "reason.INVALID_SCOPE": "un ámbito de comparación desconocido",
    "reason.INVALID_BASELINE": "una línea base de sensibilidad no válida",
    "reason.INVALID_TIMESTEP": "una hora de calor no válida",
    "reason.INVALID_STAY_KIND": "un filtro de alojamiento desconocido",
    "reason.INVALID_ORIGIN_MONTH": "un mes de origen nacional que no está en el conjunto publicado",
    "reason.ORIGIN_UNAVAILABLE": "el mes de origen nacional (sus datos no están disponibles en este despliegue)",
    "reason.INVALID_LICENCE_WINDOW": "una ventana de fechas de licencia fuera del registro (se habría ajustado a una ventana distinta)",
    "reason.UNKNOWN_HOSPITALITY_METRIC": "un indicador de hostelería desconocido",
    "reason.UNKNOWN_HOSPITALITY_BARRIO": "un barrio de hostelería que no está en el conjunto publicado",
    "reason.INVALID_READING": "una preferencia de lectura desconocida",
    "reason.INVALID_LANGUAGE": "un idioma desconocido",
    "reason.INVALID_ACTIVE_LENS": "una Lente activa desconocida",
    "reason.MALFORMED": "un valor con formato incorrecto",
  }),
});
function k11T(key) {
  const dict = K11_COPY[shellLanguage()] || K11_COPY.en;
  return dict[key] ?? K11_COPY.en[key] ?? key;
}

// Localise the K11 controls (ES/EN) the same way the surface dictionaries do:
// one applier, called on init and on every language switch. Visible text and the
// dismiss accessible name both follow the document language.
function k11ApplyCopy() {
  const set = (id, key, attr) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (attr) el.setAttribute(attr, k11T(key));
    else el.textContent = k11T(key);
  };
  set("drawerShareTitle", "share.title");
  set("drawerShareLede", "share.lede");
  set("k11ShareBtn", "share.copyBtn");
  set("k11ExportBtn", "share.exportBtn");
  set("k11RestoreDismiss", "notice.dismiss", "aria-label");
}

// (k11 state object is declared early, near K11_ORIGINAL_SEARCH, so renderer
//  captures can reference it during the first render without a TDZ error.)

// Read the live reading into the pure contract's shape. This is the single source
// of truth for both the shared URL and (later) the export's state.url, so the two
// can never disagree.
function k11CurrentState() {
  const scope = (typeof ambitoCompare !== "undefined" && ambitoCompare.scope) || "LENS";
  let metric = null;
  if (scope === "AMBITO" && typeof ambitoCompare !== "undefined") {
    const id = ambitoCompare.lockedMetric || ambitoCompare.focusedMetric;
    if (id) metric = { id, locked: Boolean(ambitoCompare.lockedMetric) };
  } else {
    const id = selectedHaloMetric || focusedHaloMetric;
    if (id) metric = { id, locked: Boolean(selectedHaloMetric) };
  }
  const layers = [];
  for (const el of document.querySelectorAll("[data-layer]")) if (el.checked) layers.push(el.dataset.layer);
  const cA = centerOf("A");
  const cB = centerOf("B");
  const state = {
    snapshotId: K11_SNAPSHOT_ID,
    mode: shell.modes ? shell.modes.currentMode() : "PLACE",
    lensA: { lat: cA.lat, lon: cA.lon, radiusM: radii.A },
    lensB: { lat: cB.lat, lon: cB.lon, radiusM: radii.B },
    lensBEnabled: bEnabled,
    activeLens: active,
    layers,
    scope,
    reading: shell.reading,
    language: shellLanguage(),
  };
  if (isHatiVisible()) state.timestep = timestep;
  if (stayKindFilter && stayKindFilter !== "all") state.stayKind = stayKindFilter;
  if (typeof originMonth !== "undefined" && originMonth) state.originMonth = originMonth;
  // Licence grant-date window — carried only while the licences layer is on, since
  // the window only shapes evidence when the layer is shown. Both bounds or none.
  if (typeof isLicencesVisible === "function" && isLicencesVisible() && licenceWindow && licenceWindow.from && licenceWindow.to) {
    state.licenceWindow = { from: licenceWindow.from, to: licenceWindow.to };
  }
  // Hospitality metric + selected barrio — carried only while the hospitality
  // layer is on (its visibility itself travels in the layers list).
  if (typeof hospitalityVisible !== "undefined" && hospitalityVisible) {
    if (hospitalityMetric) state.hospitalityMetric = hospitalityMetric;
    if (hospitalitySelectedBarrio) state.hospitalityBarrio = hospitalitySelectedBarrio;
  }
  if (scope === "AMBITO" && typeof ambitoCompare !== "undefined") {
    if (ambitoCompare.a) state.ambitoA = ambitoCompare.a;
    if (ambitoCompare.b) state.ambitoB = ambitoCompare.b;
  }
  if (metric) state.metric = metric;
  if (typeof spatialBaseline !== "undefined" && spatialBaseline && spatialBaseline.radii) {
    state.baseline = {
      radiusA: spatialBaseline.radii.A,
      radiusB: spatialBaseline.radii.B,
      radiusMode: spatialBaseline.radiusMode,
      evidenceKey: spatialBaseline.evidenceKey,
    };
  }
  return state;
}

// Commit the canonical URL with replaceState. Coalesced to one write per frame so
// a drag (which calls refresh() continuously) never writes the address bar more
// than once a frame — and never with pushState, so the back button is untouched.
function k11ScheduleUrlCommit() {
  if (k11.suppress || k11.scheduled) return;
  k11.scheduled = true;
  const run = () => { k11.scheduled = false; k11CommitUrlState(); };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
}
function k11CommitUrlState() {
  if (k11.suppress) return;
  try {
    const url = buildShareUrl(window.location.href, k11CurrentState());
    window.history.replaceState(window.history.state, "", url);
  } catch (error) {
    /* a blocked history write is non-fatal: the Share button reads live state */
  }
}

// ----------------------------------------------------------------- clipboard
function k11ExecCopyFallback(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand && document.execCommand("copy");
    area.remove();
    return Boolean(ok);
  } catch (error) {
    return false;
  }
}
async function k11CopyShareLink() {
  const url = buildShareUrl(window.location.href, k11CurrentState());
  try { window.history.replaceState(window.history.state, "", url); } catch (error) { /* non-fatal */ }
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); ok = true; }
  } catch (error) { ok = false; }
  if (!ok) ok = k11ExecCopyFallback(url);
  const status = document.getElementById("k11ShareStatus");
  if (status) {
    status.dataset.tone = ok ? "ok" : "error";
    // On failure the URL is shown in full so the copy never silently fails.
    status.textContent = ok ? k11T("share.copied") : `${k11T("share.copyFailed")} ${url}`;
  }
  return ok;
}

// ------------------------------------------------------------------- restore
function k11HasSharedState() {
  return /[?&]v=/.test(K11_ORIGINAL_SEARCH);
}

function k11ApplyLensRestore(which, lens) {
  if (!lens) return;
  try {
    lenses[which].marker.setLatLng([lens.lat, lens.lon]);
    lenses[which].circle.setLatLng([lens.lat, lens.lon]);
    setLensRadius(which, lens.radiusM); // the app's standard clamp+step applies to all radii
    lenses[which].circle.setRadius(radiusFor(which));
    if (which === active && typeof radiusSlider !== "undefined") radiusSlider.value = radiusFor(which);
  } catch (error) { /* a single lens failure never aborts the whole restore */ }
}

function k11ApplyLayersRestore(layers) {
  const wanted = new Set(layers);
  for (const el of document.querySelectorAll("[data-layer]")) {
    if (el.disabled) continue; // a layer unavailable in this deployment is left off
    const on = wanted.has(el.dataset.layer);
    if (el.checked !== on) {
      el.checked = on;
      setLayerVisible(el.dataset.layer, on);
    }
  }
}

// Phase 1: interface dimensions that depend only on the map + operational layers.
function k11ApplyRestorePhase1() {
  if (!k11HasSharedState()) return;
  const result = k11InitialRestore || parseEvidenceState(K11_ORIGINAL_SEARCH, { snapshotId: K11_SNAPSHOT_ID });
  k11InitialRestore = result;
  if (!result.ok) { k11.refused = true; k11RenderNotice(result); return; }
  const s = result.state || {};
  k11.suppress = true;
  try {
    if (s.language && s.language !== shellLanguage()) {
      const sel = document.getElementById("languageSelect");
      if (sel) { sel.value = s.language; if (typeof sel.onchange === "function") sel.onchange({ target: sel }); }
    }
    if (s.mode && shell.modes) shell.modes.setMode(s.mode);
    if (s.lensBEnabled === true && !bEnabled) enableLensB();
    else if (s.lensBEnabled === false && bEnabled) disableLensB();
    k11ApplyLensRestore("A", s.lensA);
    k11ApplyLensRestore("B", s.lensB);
    if (s.activeLens && s.activeLens !== active) activateLens(s.activeLens);
    if (Array.isArray(s.layers)) k11ApplyLayersRestore(s.layers);
    if (s.timestep) {
      const sel = document.getElementById("timeSelect");
      if (sel) { sel.value = s.timestep; if (typeof sel.onchange === "function") sel.onchange({ target: sel }); }
    }
    if (s.stayKind) {
      const sel = document.getElementById("stayKindFilter");
      if (sel && !sel.disabled) { sel.value = s.stayKind; if (typeof sel.onchange === "function") sel.onchange({ target: sel }); }
    }
    if (s.reading) {
      shell.reading = s.reading;
      if (document.getElementById("evidenceDrawer").open) renderDrawerBody();
    }
    if (s.scope !== "AMBITO" && s.metric) {
      selectedHaloMetric = s.metric.locked ? s.metric.id : null;
      setHaloMetricFocus(s.metric.id, null, false);
    }
    refresh();
  } catch (error) {
    console.warn("K11 phase-1 restore incomplete", error);
  } finally {
    k11.suppress = false;
  }
}

// Phase 2: the ámbito comparison and the sensitivity baseline — they need the
// planning index (ámbito codes, geometry) and, for the baseline, the bridge
// models. Runs once planning has loaded OR failed, so an ámbito code is never
// rejected merely because its geometry was still loading.
function k11ApplyRestorePhase2() {
  if (!k11HasSharedState() || k11.refused) { k11.restored = true; return; }
  const options = { snapshotId: K11_SNAPSHOT_ID };
  try {
    const codes = typeof ambitoCodeList === "function" ? ambitoCodeList() : [];
    if (codes.length) options.knownAmbitoCodes = codes;
  } catch (error) { /* planning unavailable: ámbito codes stay unvalidated */ }
  const result = parseEvidenceState(K11_ORIGINAL_SEARCH, options);
  k11InitialRestore = result; // the authoritative result, with ámbito validation
  const s = (result.ok && result.state) || {};
  const finish = () => {
    k11.suppress = false;
    k11ApplyBaselineRestore(s, result);
    k11.restored = true;
    k11RenderNotice(result);
  };
  if (result.ok && s.scope === "AMBITO" && typeof setCompareScope === "function") {
    k11.suppress = true;
    const apply = () => {
      try {
        setCompareScope("AMBITO");
        if (s.ambitoA) { ambitoCompare.a = s.ambitoA; const sa = document.getElementById("ambitoSelectA"); if (sa) sa.value = s.ambitoA; }
        if (s.ambitoB) { ambitoCompare.b = s.ambitoB; const sb = document.getElementById("ambitoSelectB"); if (sb) sb.value = s.ambitoB; }
        if (s.metric) { ambitoCompare.lockedMetric = s.metric.locked ? s.metric.id : null; ambitoCompare.focusedMetric = s.metric.id; }
        renderAmbitoCompare();
        renderAmbitoComparePolygons();
      } catch (error) {
        console.warn("K11 phase-2 ámbito restore incomplete", error);
      } finally {
        finish();
      }
    };
    (typeof ensureAmbitoAdapter === "function" ? ensureAmbitoAdapter() : Promise.resolve()).then(apply, apply);
    return;
  }
  finish();
}

// The sensitivity baseline is reproduced by re-running the app's OWN capture at
// the baseline radii, then restoring the scenario (current) radii — never by
// fabricating a frozen interpretation. If the evidence universe has changed since
// the link was made (evidenceKey mismatch), the baseline cannot be reproduced
// exactly and is reported rather than faked.
function k11ApplyBaselineRestore(state, result) {
  const baseline = state && state.baseline;
  if (!baseline) return;
  if (!bEnabled || typeof captureSpatialBaseline !== "function" || typeof spatialEvidenceKey !== "function") return;
  try {
    const currentKey = spatialEvidenceKey();
    if (baseline.evidenceKey != null && baseline.evidenceKey !== currentKey) {
      k11.baselineUnreproducible = true;
      return;
    }
    const scenarioA = radii.A;
    const scenarioB = radii.B;
    k11.suppress = true;
    setLensRadius("A", baseline.radiusA);
    setLensRadius("B", baseline.radiusB);
    lenses.A.circle.setRadius(radiusFor("A"));
    lenses.B.circle.setRadius(radiusFor("B"));
    refresh();
    captureSpatialBaseline();
    setLensRadius("A", scenarioA);
    setLensRadius("B", scenarioB);
    lenses.A.circle.setRadius(radiusFor("A"));
    lenses.B.circle.setRadius(radiusFor("B"));
    if (typeof radiusSlider !== "undefined") radiusSlider.value = radiusFor(active);
    refresh();
  } catch (error) {
    console.warn("K11 baseline restore incomplete", error);
    k11.baselineUnreproducible = true;
  } finally {
    k11.suppress = false;
    k11CommitUrlState();
  }
}

// Restore the shared domestic-origin source month once its artifact has loaded.
// The month is validated against the real published set: an unknown month, a
// malformed one, or an unavailable artifact is a stated partial restore, never a
// silent fall-back to the latest month.
function k11ApplyOriginMonthRestore() {
  if (!k11HasSharedState() || k11.refused) return;
  if (!/[?&]om=/.test(K11_ORIGINAL_SEARCH)) return; // link carried no month
  const months = originModel && originModel.index && Array.isArray(originModel.index.months) ? originModel.index.months : null;
  const options = { snapshotId: K11_SNAPSHOT_ID };
  if (months) options.knownOriginMonths = months;
  const result = parseEvidenceState(K11_ORIGINAL_SEARCH, options);
  const month = result.state && result.state.originMonth;
  if (month && months && months.includes(month)) {
    k11.suppress = true;
    try {
      const select = document.getElementById("domesticOriginsMonth");
      originMonth = month;
      if (select) select.value = month;
      if (typeof renderDomesticOrigins === "function") renderDomesticOrigins();
    } catch (error) {
      console.warn("K11 origin-month restore incomplete", error);
    } finally {
      k11.suppress = false;
      k11CommitUrlState();
    }
    return;
  }
  // The month was in the link but could not be applied — unknown, malformed, or
  // the domestic-origin artifact is unavailable in this deployment.
  const issue = (result.issues || []).find((i) => i.dimension === "originMonth");
  k11.originMonthIssue = issue || { dimension: "originMonth", code: months ? "INVALID_ORIGIN_MONTH" : "ORIGIN_UNAVAILABLE" };
  k11RenderNotice(k11InitialRestore || result);
}

// Restore the shared licence grant-date window once the licences artifact has
// loaded. The window is validated against the real register extent: a window
// outside the extent, reversed, or that the model would clamp to a DIFFERENT
// window is a stated PARTIAL restore, never a silent substitution. Runs once.
function k11ApplyLicenceWindowRestore() {
  if (!k11HasSharedState() || k11.refused || k11.licenceWindowRestored) return;
  if (!/[?&]lw=/.test(K11_ORIGINAL_SEARCH)) return; // link carried no window
  if (!licenceModel.index) return; // artifact not ready yet; a later call will apply it
  k11.licenceWindowRestored = true;
  const extent = licenceModel.index.dateExtent;
  const result = parseEvidenceState(K11_ORIGINAL_SEARCH, {
    snapshotId: K11_SNAPSHOT_ID,
    knownLicenceExtent: extent ? { min: extent.min, max: extent.max } : undefined,
  });
  const requested = result.state && result.state.licenceWindow;
  if (requested && requested.from && requested.to) {
    const clamped = licenceModel.index.clampWindow(requested.from, requested.to);
    // The model clamped the shared window to a different one: the restored reading
    // is NOT the one that was shared, so report PARTIAL rather than apply silently.
    if (!clamped.valid || clamped.from !== requested.from || clamped.to !== requested.to) {
      k11.licenceWindowIssue = { dimension: "licenceWindow", code: "INVALID_LICENCE_WINDOW" };
    } else {
      k11.suppress = true;
      try {
        licenceWindow = { from: clamped.from, to: clamped.to };
        const fromEl = document.getElementById("licFrom");
        const toEl = document.getElementById("licTo");
        if (fromEl) fromEl.value = licenceWindow.from;
        if (toEl) toEl.value = licenceWindow.to;
        renderUrbanLicences();
      } catch (error) {
        console.warn("K11 licence-window restore incomplete", error);
      } finally {
        k11.suppress = false;
        k11CommitUrlState();
      }
    }
  } else {
    // Present in the link but malformed or out of extent (the pure parser rejected it).
    const issue = (result.issues || []).find((i) => i.dimension === "licenceWindow");
    if (issue) k11.licenceWindowIssue = issue;
  }
  if (k11.licenceWindowIssue) k11RenderNotice(k11InitialRestore || result);
}

// Restore the shared hospitality metric and selected official barrio once the
// hospitality artifact has loaded. The metric is validated against the approved
// indicator ids and the barrio against the loaded barrio index; an unknown metric
// or barrio is a stated PARTIAL restore, never silently dropped. Runs once.
function k11ApplyHospitalityRestore() {
  if (!k11HasSharedState() || k11.refused || k11.hospitalityRestored) return;
  if (!/[?&](hm|hb)=/.test(K11_ORIGINAL_SEARCH)) return; // link carried neither
  if (!hospitalityModel.module || hospitalityState !== "ready") return; // not ready yet
  k11.hospitalityRestored = true;
  const metrics = hospitalityModel.module.APPROVED_INDICATOR_IDS || null;
  let barrios = null;
  try {
    if (hospitalityModel.index && hospitalityModel.index.barrio && typeof hospitalityModel.index.barrio.keys === "function") {
      barrios = new Set(hospitalityModel.index.barrio.keys());
    }
  } catch (error) { barrios = null; }
  const result = parseEvidenceState(K11_ORIGINAL_SEARCH, {
    snapshotId: K11_SNAPSHOT_ID,
    knownHospitalityMetrics: metrics || undefined,
    knownHospitalityBarrios: barrios || undefined,
  });
  const s = (result.ok && result.state) || {};
  k11.suppress = true;
  try {
    if (s.hospitalityMetric && (!metrics || metrics.includes(s.hospitalityMetric))) {
      hospitalityMetric = s.hospitalityMetric;
      const select = document.getElementById("hospitalityMetricSelect");
      if (select) select.value = hospitalityMetric;
      setText("hospitalityMetricSelectValue", hospitalityT(hospitalityMetric));
    }
    if (s.hospitalityBarrio && (!barrios || barrios.has(s.hospitalityBarrio))) {
      hospitalitySelectedBarrio = s.hospitalityBarrio;
    }
    if (typeof applyHospitalityStyles === "function") applyHospitalityStyles();
    renderHospitalityContext();
  } catch (error) {
    console.warn("K11 hospitality restore incomplete", error);
  } finally {
    k11.suppress = false;
    k11CommitUrlState();
  }
  // Surface any dimension the link carried but the live vocabulary rejected.
  const metricIssue = (result.issues || []).find((i) => i.dimension === "hospitalityMetric");
  const barrioIssue = (result.issues || []).find((i) => i.dimension === "hospitalityBarrio");
  if (metricIssue) k11.hospitalityMetricIssue = metricIssue;
  if (barrioIssue) k11.hospitalityBarrioIssue = barrioIssue;
  if (metricIssue || barrioIssue) k11RenderNotice(k11InitialRestore || result);
}

// ------------------------------------------------------------------- notice
function k11RenderNotice(result) {
  const notice = document.getElementById("k11RestoreNotice");
  const title = document.getElementById("k11RestoreTitle");
  const message = document.getElementById("k11RestoreMessage");
  if (!notice || !title || !message) return;

  const snapshotMismatch = result.snapshot && result.snapshot.status === "MISMATCH";
  const interfaceIssues = (result.issues || []).filter((i) => i.code !== "SNAPSHOT_MISMATCH");
  if (k11.baselineUnreproducible) interfaceIssues.push({ dimension: "baseline", code: "BASELINE_EVIDENCE" });
  // Late-resolved, async restore issues (origin month) are merged in so the one
  // notice reflects everything that could not be restored.
  if (k11.originMonthIssue && !interfaceIssues.some((i) => i.dimension === "originMonth")) interfaceIssues.push(k11.originMonthIssue);
  if (k11.licenceWindowIssue && !interfaceIssues.some((i) => i.dimension === "licenceWindow")) interfaceIssues.push(k11.licenceWindowIssue);
  if (k11.hospitalityMetricIssue && !interfaceIssues.some((i) => i.dimension === "hospitalityMetric")) interfaceIssues.push(k11.hospitalityMetricIssue);
  if (k11.hospitalityBarrioIssue && !interfaceIssues.some((i) => i.dimension === "hospitalityBarrio")) interfaceIssues.push(k11.hospitalityBarrioIssue);

  let show = false;
  if (!result.ok) {
    title.textContent = k11T("restore.refusedTitle");
    message.textContent = k11T("restore.refusedLede");
    show = true;
  } else if (interfaceIssues.length) {
    title.textContent = k11T("restore.partialTitle");
    const parts = interfaceIssues.map((issue) =>
      issue.code === "BASELINE_EVIDENCE" ? k11T("restore.baselineEvidence") : k11T(`reason.${issue.code}`)
    );
    message.textContent = `${k11T("restore.partialLede")} ${parts.join("; ")}.`;
    show = true;
  } else if (snapshotMismatch) {
    title.textContent = k11T("restore.snapshotTitle");
    message.textContent = k11T("restore.snapshotLede");
    show = true;
  }
  notice.hidden = !show;
}

// ------------------------------------------------------------------- export
// The export is a TRANSCRIPT of the rendered reading. Every value it carries is
// read from the frozen model that drew the screen (lastHaloComparison for the
// Lens comparison, ambitoCompare.model for the ámbito comparison, the frozen
// evidence records for provenance). js/evidence-export.js serialises the bundle;
// nothing here recomputes an analytical value.

function k11Fmt(value) {
  if (value == null) return "—";
  return Number(value).toLocaleString(shellLanguage() === "es" ? "es-ES" : "en-GB");
}
function k11FmtDelta(value) {
  if (value == null) return "—";
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${k11Fmt(rounded)}`;
}

// A Lens circle as a GeoJSON Polygon ring in EPSG:4326 — a GENERATED analytical
// window, explicitly not an official boundary.
function k11CirclePolygon(lat, lon, radiusM, steps = 64) {
  const R = 6378137;
  const latRad = (lat * Math.PI) / 180;
  const ring = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(bearing)) / R;
    const dLon = (radiusM * Math.sin(bearing)) / (R * Math.cos(latRad));
    ring.push([
      Number((lon + (dLon * 180) / Math.PI).toFixed(6)),
      Number((lat + (dLat * 180) / Math.PI).toFixed(6)),
    ]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

const K11_LENS_METRIC_META = Object.freeze({
  tourism: { label: "Tourism POIs", unit: "POIs", sources: ["museum", "info"] },
  stays: { label: "Hotels & stays", unit: "stays", sources: ["stay"] },
  mobility: { label: "Mobility nodes", unit: "nodes", sources: ["bike", "rail"] },
  utci: { label: "Mean UTCI", unit: "°C", sources: ["hati"] },
});
const K11_AMBITO_SOURCE_IDS = Object.freeze(["planning_ambito_state", "planning_ambito_geometry"]);

// Per-value provenance (Finding 2): resolve a source id to the five freshness
// fields and the verbatim ceiling, straight from the committed registry — never
// fabricated. Attached to every exported value so each is independently
// interpretable without cross-referencing the surface list.
function k11SourceProvenance(id) {
  const source = (shell.registry && Array.isArray(shell.registry.sources) ? shell.registry.sources : []).find((candidate) => candidate.id === id);
  if (!source) return { id, missing_from_registry: true };
  return {
    id,
    display_name: source.display_name || id,
    authority: source.authority || null,
    freshness: {
      reference_date: source.reference_date ?? null,
      published_at: source.published_at ?? null,
      retrieved_at: source.retrieved_at ?? null,
      update_frequency: source.update_frequency ?? null,
      source_state: source.source_state ?? null,
    },
    interpretation_ceiling: source.interpretation_ceiling || null,
  };
}
function k11WithProvenance(value) {
  return { ...value, provenance: (value.source_ids || []).map(k11SourceProvenance) };
}

function k11LensValue(id, metric) {
  const meta = K11_LENS_METRIC_META[id] || { label: id, unit: null, sources: [] };
  const comparable = metric.comparable === true;
  const everythingNull = metric.aValue == null && metric.bValue == null && metric.aRawValue == null && metric.bRawValue == null;
  const state = comparable ? "VALID" : everythingNull ? "UNAVAILABLE" : "WITHHELD";
  return k11WithProvenance({
    id, label: meta.label, scope: "LENS_CIRCLE", unit: meta.unit, source_family: null,
    a_value: metric.aValue ?? null, b_value: metric.bValue ?? null, delta: metric.delta ?? null,
    display: comparable ? `A ${k11Fmt(metric.aValue)} · B ${k11Fmt(metric.bValue)} · Δ ${k11FmtDelta(metric.delta)}` : null,
    state,
    comparison_basis: comparable ? (metric.qualifier && /km²/.test(metric.qualifier) ? "REPRESENTED_DENSITY" : "RAW_COUNT") : null,
    withheld_reason: comparable ? undefined : metric.qualifier || null,
    source_ids: meta.sources,
  });
}

// The planning source FAMILY behind a metric: surface and the phase states are S1
// development-state evidence; the buildability use-classes are S2 available-
// buildability. Kept explicit so an exported planning value names its family.
function k11PlanningFamily(metricId) {
  return metricId === "ambito_surface" || String(metricId).startsWith("phase_")
    ? "S1_DEVELOPMENT_STATE"
    : "S2_AVAILABLE_BUILDABILITY";
}

function k11AmbitoValue(metric) {
  const label = typeof ambitoT === "function" ? ambitoT(`metric.${metric.id}`) : metric.id;
  const family = k11PlanningFamily(metric.id);
  if (metric.kind === "CATEGORICAL") {
    const published = metric.a.state === "PUBLISHED" && metric.b.state === "PUBLISHED";
    return k11WithProvenance({
      id: metric.id, label, scope: "PLANNING_AMBITO", unit: null, kind: "CATEGORICAL", source_family: family,
      a_state: metric.a.sourceValue ?? null, b_state: metric.b.sourceValue ?? null, relation: metric.relation,
      display: `${metric.a.sourceValue ?? "—"} / ${metric.b.sourceValue ?? "—"} · ${metric.relation}`,
      state: published ? "VALID" : "INDETERMINATE", comparison_basis: metric.basis, source_ids: K11_AMBITO_SOURCE_IDS,
    });
  }
  const comparable = metric.comparable !== false;
  return k11WithProvenance({
    id: metric.id, label, scope: "PLANNING_AMBITO", unit: metric.unit, kind: "QUANTITY", source_family: family,
    a_value: metric.a.value ?? null, b_value: metric.b.value ?? null,
    delta: comparable ? metric.deltaValue ?? null : null,
    display: comparable ? `B − A ${k11Fmt(metric.deltaValue)} ${metric.unit}` : null,
    state: comparable ? "VALID" : "WITHHELD",
    withheld_reason: comparable ? undefined : metric.withheldReasonCode || null,
    comparison_basis: metric.basis, source_ids: K11_AMBITO_SOURCE_IDS,
  });
}

// Capture the active-lens PLACE metric values exactly as refresh() rendered them.
// The stat functions are pure and read the same frozen layers the renderers used,
// so this is a transcript of the rendered reading, not a second computation.
function k11CapturePlaceReading(stats, frozen) {
  // No-recomputation invariant (#73): refresh() computes heat, pedestrian and the
  // category-mix projection once and passes them here. This capture performs NO
  // stat computation of its own — it transcribes the frozen objects the renderers
  // just drew from.
  const bundle = frozen || {};
  const heat = bundle.heat ?? null;
  const pedestrian = bundle.pedestrian ?? null;
  k11.placeReading = Object.freeze({
    which: active,
    tourism: { value: stats.tourism, status: combinedStatus(layerStatus, ["museums", "info"]) },
    stay: { value: stats.stay, status: combinedStatus(layerStatus, ["stays"]) },
    mobility: { value: stats.mobility, status: combinedStatus(layerStatus, ["bikes", "rail"]) },
    utci: { visible: isHatiVisible(), evidence: heat ? heat.evidence : "NONE", mean: heat && heat.evidence !== "NONE" ? heat.mean : null, count: heat ? heat.count : null, timestep },
    pedestrian: { visible: isPedestrianVisible(), status: pedestrianStatus, evidence: pedestrian ? pedestrian.evidence : "NONE", mean: pedestrian && pedestrian.evidence !== "NONE" ? pedestrian.meanObserved : null, stationCount: pedestrian ? pedestrian.stationCount : null },
  });
  // The category-mix projection (the SAME object renderMix() drew) and the nearest
  // features, for the PLACE export transcript.
  k11.placeMix = bundle.mix || null;
  k11.placeNearest = Array.isArray(stats.nearest) ? stats.nearest : null;
}

// PLACE single-lens metric values, from the frozen reading captured in refresh().
function k11PlaceValues(reading) {
  if (!reading) return [];
  const values = [];
  const countState = (status) => (status === "unavailable" ? "UNAVAILABLE" : "VALID");
  // Sources are declared LAST in each descriptor so no two-string array literal is
  // immediately followed by a comma (that shape is reserved for legacy-copy key maps).
  const simple = [
    { id: "tourism", label: "Tourism POIs", unit: "POIs", cell: reading.tourism, sources: ["museum", "info"] },
    { id: "stays", label: "Hotels & stays", unit: "stays", cell: reading.stay, sources: ["stay"] },
    { id: "mobility", label: "Mobility nodes", unit: "nodes", cell: reading.mobility, sources: ["bike", "rail"] },
  ];
  for (const descriptor of simple) {
    const { id, label, unit, cell, sources } = descriptor;
    const state = countState(cell.status);
    values.push(k11WithProvenance({
      id, label, scope: "LENS_CIRCLE", unit, source_family: null,
      value: state === "VALID" ? cell.value ?? null : null,
      display: state === "VALID" ? k11Fmt(cell.value) : null,
      state, source_ids: sources,
    }));
  }
  if (reading.utci && reading.utci.visible) {
    const u = reading.utci;
    const state = u.evidence === "NONE" ? "NO_EVIDENCE" : "VALID";
    values.push(k11WithProvenance({
      id: "utci", label: "Mean UTCI", scope: "LENS_CIRCLE", unit: "°C", source_family: null,
      value: state === "VALID" ? u.mean : null,
      display: state === "VALID" ? `${u.mean.toFixed(1)}°C` : null,
      state, timestep: u.timestep, source_ids: ["hati"],
    }));
  }
  if (reading.pedestrian && reading.pedestrian.visible) {
    const p = reading.pedestrian;
    const state = p.status === "unavailable" ? "UNAVAILABLE" : p.evidence === "NONE" ? "NO_EVIDENCE" : "VALID";
    values.push(k11WithProvenance({
      id: "pedestrian", label: "Observed pedestrian activity", scope: "LENS_CIRCLE", unit: "passages/hour", source_family: null,
      value: state === "VALID" ? Math.round(p.mean) : null,
      display: state === "VALID" ? `${Math.round(p.mean).toLocaleString("en-GB")}` : null,
      state, source_ids: ["pedestrian"],
    }));
  }
  // Residents + licensed-VUT (OFFICIAL_BARRIO), from the frozen area profile.
  const area = k11.placeArea;
  if (area && area.residents) {
    const r = area.residents;
    const available = r.state === "available" || r.state === "AVAILABLE";
    values.push(k11WithProvenance({
      id: "residents", label: "Registered residents", scope: "OFFICIAL_BARRIO", unit: "residents", source_family: null,
      value: available && Number.isFinite(r.value) ? r.value : null, display: available ? (r.display ?? null) : null,
      state: available ? "VALID" : "UNAVAILABLE", source_ids: "population geography".split(" "),
    }));
  }
  if (area && area.vut && area.vut.units) {
    const vut = area.vut;
    const vutAvailable = vut.state === "available" || vut.state === "AVAILABLE";
    values.push(k11WithProvenance({
      id: "vut_units", label: "Licensed holiday-let units", scope: "OFFICIAL_BARRIO", unit: "units", source_family: null,
      value: vutAvailable && Number.isFinite(vut.units.value) ? vut.units.value : null,
      display: vutAvailable ? (vut.units.display ?? null) : null,
      state: vutAvailable ? "VALID" : "UNAVAILABLE", source_ids: ["vut_licences"],
    }));
    // The licence COUNT is a second, named figure (one licence may cover many
    // units) — displayed alongside the units, so transcribed alongside them.
    if (vut.licences) {
      values.push(k11WithProvenance({
        id: "vut_licences", label: "Granted activity licences (VUT)", scope: "OFFICIAL_BARRIO", unit: "licences", source_family: null,
        value: vutAvailable && Number.isFinite(vut.licences.value) ? vut.licences.value : null,
        display: vutAvailable ? (vut.licences.display ?? null) : null,
        state: vutAvailable ? "VALID" : "UNAVAILABLE", source_ids: ["vut_licences"],
      }));
    }
    // The licensed-units-per-1,000-residents ratio, exactly as displayed. It
    // abstains for two materially different reasons the interface keeps distinct:
    // NO_DENOMINATOR (no resident figure) and NO_NUMERATOR — never a zero.
    if (vut.ratio) {
      const ratioAvailable = vut.ratio.state === "available" || vut.ratio.state === "AVAILABLE";
      values.push(k11WithProvenance({
        id: "vut_ratio", label: "Licensed VUT units per 1,000 residents", scope: "OFFICIAL_BARRIO",
        unit: "units per 1,000 residents", source_family: null,
        value: ratioAvailable && Number.isFinite(vut.ratio.value) ? vut.ratio.value : null,
        display: ratioAvailable ? (vut.ratio.display ?? null) : null,
        state: ratioAvailable ? "VALID" : "UNAVAILABLE",
        withheld_reason: ratioAvailable ? undefined : (vut.ratio.state || null),
        source_ids: "vut_licences population".split(" "),
      }));
    }
  }
  // Containing-ámbito planning figures (PLANNING_AMBITO), read single-sided from
  // the authoritative comparison model's `.a` side (S1/S2 named per metric).
  const planning = k11.placePlanningModel;
  if (planning && Array.isArray(planning.metrics)) {
    for (const metric of planning.metrics) {
      const side = metric.a || {};
      const family = k11PlanningFamily(metric.id);
      if (metric.kind === "CATEGORICAL") {
        const published = side.state === "PUBLISHED";
        values.push(k11WithProvenance({
          id: `place_${metric.id}`, label: typeof ambitoT === "function" ? ambitoT(`metric.${metric.id}`) : metric.id,
          scope: "PLANNING_AMBITO", unit: null, kind: "CATEGORICAL", source_family: family,
          value: side.sourceValue ?? null, display: side.sourceValue ?? null,
          state: published ? "VALID" : "NOT_PUBLISHED", source_ids: K11_AMBITO_SOURCE_IDS,
        }));
      } else {
        const published = side.state === "PUBLISHED";
        values.push(k11WithProvenance({
          id: `place_${metric.id}`, label: typeof ambitoT === "function" ? ambitoT(`metric.${metric.id}`) : metric.id,
          scope: "PLANNING_AMBITO", unit: metric.unit, kind: "QUANTITY", source_family: family,
          value: published && Number.isFinite(side.value) ? side.value : null,
          display: published && Number.isFinite(side.value) ? `${k11Fmt(side.value)} ${metric.unit}` : null,
          state: published ? "VALID" : (side.state || "NOT_PUBLISHED"), source_ids: K11_AMBITO_SOURCE_IDS,
        }));
      }
    }
  }
  // PLACE K7 (#73): the edition-change reading shown under the ámbito — the
  // per-family change classification and the defensible buildability
  // differences, each carrying its own withholding reason. Emitted only when the
  // change panel is actually shown (k11.placeChange non-null). Transcribed from
  // the frozen comparison; no numeric interpretation is invented here.
  const change = k11.placeChange;
  if (change) {
    const changeSources = typeof K11_AMBITO_SOURCE_IDS !== "undefined" ? K11_AMBITO_SOURCE_IDS : [];
    // The comparability verdict (a published classification, never a number).
    values.push(k11WithProvenance({
      id: "change_comparability", label: "Edition comparability", scope: "PLANNING_AMBITO", unit: null,
      kind: "CATEGORICAL", source_family: "S1_DEVELOPMENT_STATE",
      value: change.comparabilityVerdict ?? null, display: change.comparabilityVerdict ?? null,
      state: "VALID", compared_from: change.dates && change.dates.previous ? change.dates.previous : null,
      compared_to: change.dates && change.dates.current ? change.dates.current : null, source_ids: changeSources,
    }));
    // Per-family edition-change classification (NO_CHANGE, STATE_TRANSITION,
    // NEW_AMBITO, ABSENT_FROM_EDITION, MODIFIED_BY_INSTRUMENT, CAUSE_UNRESOLVED,
    // NON_COMPARABLE). An unresolved/non-comparable/absent outcome carries the
    // model's own reason as the withheld reason rather than a fabricated verdict.
    // The comparison keys families as "S1" (development state) and "S2"
    // (available buildability); map each to its export source-family vocabulary.
    const changeFamily = (family) => (family === "S1" ? "S1_DEVELOPMENT_STATE" : family === "S2" ? "S2_AVAILABLE_BUILDABILITY" : null);
    if (change.state && typeof change.state === "object") {
      for (const [family, result] of Object.entries(change.state)) {
        if (!result) continue;
        const withheld = ["CAUSE_UNRESOLVED", "NON_COMPARABLE", "ABSENT_FROM_EDITION"].includes(result.outcome);
        values.push(k11WithProvenance({
          id: `change_${String(family).toLowerCase()}`, label: `Edition change · ${family}`, scope: "PLANNING_AMBITO",
          unit: null, kind: "CATEGORICAL", source_family: changeFamily(family),
          value: result.outcome ?? null, display: result.outcome ?? null,
          state: result.outcome ? "VALID" : "INDETERMINATE",
          withheld_reason: withheld ? (result.reason || result.evidence?.absenceReason || null) : undefined,
          compared_from: change.dates && change.dates.previous ? change.dates.previous : null,
          compared_to: change.dates && change.dates.current ? change.dates.current : null, source_ids: changeSources,
        }));
      }
    }
    // Buildability (S2) numeric differences — the published previous/current
    // values per use-class, exactly as the panel shows them. Withheld cells carry
    // their reason and no numbers (blank is never read as zero).
    const build = change.buildability;
    if (build) {
      values.push(k11WithProvenance({
        id: "change_buildability_state", label: "Buildability difference", scope: "PLANNING_AMBITO", unit: null,
        kind: "CATEGORICAL", source_family: "S2_AVAILABLE_BUILDABILITY",
        value: build.state ?? null, display: build.state ?? null, state: "VALID",
        withheld_reason: build.state === "WITHHELD" ? (build.reason || null) : undefined, source_ids: changeSources,
      }));
      (build.differences || []).forEach((row, rowIndex) => {
        for (const cell of row.useClasses || []) {
          const withheldCell = cell.state === "WITHHELD";
          const unit = (cell.current && cell.current.unit) || (cell.previous && cell.previous.unit) || null;
          values.push(k11WithProvenance({
            id: `change_build_${rowIndex}_${cell.useClass}`, label: `Buildability change · ${cell.useClass}`,
            scope: "PLANNING_AMBITO", unit, kind: "QUANTITY", source_family: "S2_AVAILABLE_BUILDABILITY",
            a_value: !withheldCell && cell.previous && Number.isFinite(cell.previous.value) ? cell.previous.value : null,
            b_value: !withheldCell && cell.current && Number.isFinite(cell.current.value) ? cell.current.value : null,
            // The model's own published difference (newCell − oldCell); never a
            // figure computed here. Absent for withheld cells (blank ≠ zero).
            delta: !withheldCell && Number.isFinite(cell.observedDifference) ? cell.observedDifference : null,
            display: withheldCell ? null : `${cell.previous?.value ?? "—"} → ${cell.current?.value ?? "—"}${unit ? ` ${unit}` : ""}`,
            state: withheldCell ? "WITHHELD" : (cell.state === "NO_CHANGE" ? "NO_CHANGE" : "VALID"),
            withheld_reason: withheldCell ? (cell.reason || row.reason || null) : undefined,
            compared_from: change.dates && change.dates.previous ? change.dates.previous : null,
            compared_to: change.dates && change.dates.current ? change.dates.current : null, source_ids: changeSources,
          }));
        }
      });
    }
  }
  // Category mix shares (LENS_CIRCLE), from the frozen categoryMixState.
  if (k11.placeMix && k11.placeMix.rows) {
    const mixSources = { Museum: ["museum"], Info: ["info"], Stay: ["stay"], Bike: ["bike", "rail"] };
    for (const [key, row] of Object.entries(k11.placeMix.rows)) {
      values.push(k11WithProvenance({
        id: `mix_${key.toLowerCase()}`, label: `Category mix · ${key}`, scope: "LENS_CIRCLE", unit: "%", source_family: null,
        value: row.na ? null : (row.pct ?? null), display: row.na ? null : `${row.pct}%`,
        state: row.na ? "UNAVAILABLE" : "VALID", source_ids: mixSources[key] || [],
      }));
    }
  }
  // Nearest features (LENS_CIRCLE), distances in metres, from the frozen stats.
  if (Array.isArray(k11.placeNearest)) {
    k11.placeNearest.slice(0, 5).forEach((feature, index) => {
      const metres = Number.isFinite(feature.d) ? Math.round(feature.d) : null;
      values.push(k11WithProvenance({
        id: `nearest_${index + 1}`, label: `Nearest · ${feature.name || feature.type || index + 1}`, scope: "LENS_CIRCLE", unit: "m", source_family: null,
        value: metres, display: metres == null ? null : `${metres} m`, feature_type: feature.type || null,
        state: metres == null ? "UNAVAILABLE" : "VALID", source_ids: ["museum", "info", "stay", "bike", "rail"],
      }));
    });
  }
  // Granted licences per family — a COUNT of address-point records falling inside
  // the active Lens radius. The aggregate's analytical scope is therefore
  // LENS_CIRCLE (a spatial aggregate over the generated window), NOT ADDRESS_POINT:
  // ADDRESS_POINT is the geometry of each underlying record, which stays the
  // source/record identity (urban_licences + the callejero crosswalk), not the
  // scope of the summed figure. The distinction is asserted in the export tests.
  if (k11.placeLicences && k11.placeLicences.perFamily) {
    for (const [family, count] of Object.entries(k11.placeLicences.perFamily)) {
      values.push(k11WithProvenance({
        id: `licences_${family}`, label: `Granted licences · ${family}`, scope: "LENS_CIRCLE",
        aggregate_of: "ADDRESS_POINT", unit: "records", source_family: null,
        value: Number.isFinite(count) ? count : null, display: Number.isFinite(count) ? String(count) : null,
        state: Number.isFinite(count) ? "VALID" : "UNAVAILABLE", source_ids: ["urban_licences", "callejero_ndp_crosswalk"],
      }));
    }
  }
  // Hospitality / commercial context (its scope follows the selection).
  if (k11.placeHospitality) {
    const h = k11.placeHospitality;
    values.push(k11WithProvenance({
      id: `hospitality_${h.metric}`, label: `Hospitality · ${h.metric}`, scope: h.scope || "OFFICIAL_BARRIO",
      unit: h.unit || null, source_family: null,
      value: Number.isFinite(h.value) ? h.value : null,
      display: Number.isFinite(h.value) ? (h.display ?? String(h.value)) : null,
      state: Number.isFinite(h.value) ? "VALID" : "UNAVAILABLE", source_ids: ["hospitality_commercial_context"],
    }));
  }
  return values;
}

// CITY municipality values, from the frozen destination and domestic-origin
// models captured when those surfaces rendered.
function k11CityValues() {
  const values = [];
  const destination = k11.cityDestination;
  if (destination && Array.isArray(destination.metrics)) {
    for (const metric of destination.metrics) {
      values.push(k11WithProvenance({
        id: metric.key, label: metric.label, scope: "MUNICIPALITY", unit: metric.unit || null, source_family: null,
        value: metric.value ?? null, display: metric.value == null ? null : (metric.display ?? null),
        state: metric.value == null ? "UNAVAILABLE" : "VALID", source_ids: ["hotel_demand"],
      }));
    }
  }
  const origins = k11.cityOrigins;
  if (origins && Array.isArray(origins.origins)) {
    for (const row of origins.origins) {
      // The canonical published figure is source_reported_tourists (an integer
      // the publisher suppresses at or below 30, so every surviving row is a real
      // published count). Never read a non-existent `count` field. The source
      // month is carried so the figure is not detached from its period.
      const value = Number.isInteger(row.source_reported_tourists) ? row.source_reported_tourists : null;
      values.push(k11WithProvenance({
        id: `origin_${row.origin_municipality_code}`, label: row.origin_municipality_name, scope: "MUNICIPALITY",
        unit: "tourists", source_family: null, source_month: origins.month,
        value, display: row.countDisplay ?? null,
        state: value == null ? "UNAVAILABLE" : "VALID", source_ids: ["domestic_origin_context"],
      }));
    }
  }
  // Month-over-month dynamics summary counts (MUNICIPALITY), from the frozen model.
  const dynamics = k11.cityDynamics;
  if (dynamics && dynamics.summary) {
    const summary = dynamics.summary;
    const fields = [
      ["current_published_origins", "Published origins (current month)", summary.currentPublishedOrigins],
      ["previous_published_origins", "Published origins (previous month)", summary.previousPublishedOrigins],
      ["shared_origins", "Shared origins", summary.sharedOrigins],
      ["newly_present_origins", "Newly present origins", summary.newlyPresentOrigins],
      ["no_longer_present_origins", "No longer present origins", summary.noLongerPresentOrigins],
    ];
    for (const [id, label, count] of fields) {
      values.push(k11WithProvenance({
        id: `dynamics_${id}`, label, scope: "MUNICIPALITY", unit: "origins", source_family: null,
        value: Number.isFinite(count) ? count : null, display: Number.isFinite(count) ? String(count) : null,
        state: Number.isFinite(count) ? "VALID" : "UNAVAILABLE",
        source_month: dynamics.currentMonth || null, compared_month: dynamics.previousMonth || null,
        source_ids: ["domestic_origin_context"],
      }));
    }
    // Per shared-origin row, exactly as the shared-origins table displays it: the
    // previous-month and current-month published tourist counts, and the model's
    // own absolute and percent change. The publisher suppresses counts at or
    // below its threshold, so a row whose change the model could not state (a
    // non-finite absolute/percent) is WITHHELD with no fabricated number — never
    // a zero. Each figure names the month it belongs to.
    if (Array.isArray(dynamics.shared)) {
      for (const row of dynamics.shared) {
        const prev = Number.isInteger(row.previousCount) ? row.previousCount : null;
        const curr = Number.isInteger(row.currentCount) ? row.currentCount : null;
        const changeStated = Number.isFinite(row.absoluteChange) && Number.isFinite(row.percentChange);
        values.push(k11WithProvenance({
          // A distinct prefix from the `dynamics_shared_origins` SUMMARY count, so
          // a per-row filter never catches the summary field.
          id: `dynamics_sharedrow_${row.origin_municipality_code}`, label: `Shared origin · ${row.origin_municipality_name}`,
          scope: "MUNICIPALITY", unit: "tourists", source_family: null,
          previous_value: prev, current_value: curr,
          absolute_change: changeStated ? row.absoluteChange : null,
          percent_change: changeStated ? row.percentChange : null,
          display: changeStated ? `${row.previousCount} → ${row.currentCount} · ${row.absoluteChange > 0 ? "+" : ""}${row.absoluteChange} · ${row.percentChange > 0 ? "+" : ""}${row.percentChange.toFixed(1)}%` : null,
          state: changeStated ? "VALID" : "WITHHELD",
          withheld_reason: changeStated ? undefined : "SUPPRESSED_OR_INCOMPARABLE_PUBLISHED_COUNT",
          source_month: dynamics.currentMonth || null, compared_month: dynamics.previousMonth || null,
          source_ids: ["domestic_origin_context"],
        }));
      }
    }
    // Newly-present origins: published in the current month's set, absent from the
    // previous month's. Transcribe the single published current-month count and
    // the model's own classification. The previous side is genuinely absent from
    // the published set — recorded as null, NEVER a fabricated zero, and the real
    // arrival of visitors is NOT inferred from published-set membership.
    if (Array.isArray(dynamics.newlyPresent)) {
      for (const row of dynamics.newlyPresent) {
        const curr = Number.isInteger(row.currentCount) ? row.currentCount : null;
        values.push(k11WithProvenance({
          id: `dynamics_newrow_${row.origin_municipality_code}`, label: `Newly present origin · ${row.origin_municipality_name}`,
          scope: "MUNICIPALITY", unit: "tourists", classification: "NEWLY_PRESENT_IN_PUBLISHED_SET",
          previous_value: null, current_value: curr, value: curr,
          display: curr == null ? null : dynamicsCount(curr),
          state: curr == null ? "UNAVAILABLE" : "VALID",
          count_month: dynamics.currentMonth || null,
          source_month: dynamics.currentMonth || null, compared_month: dynamics.previousMonth || null,
          source_ids: ["domestic_origin_context"],
        }));
      }
    }
    // No-longer-present origins: published in the previous month's set, absent from
    // the current month's. Transcribe the single published previous-month count; the
    // current side is genuinely absent (null, never zero), and the real departure of
    // visitors is NOT inferred from published-set membership.
    if (Array.isArray(dynamics.noLongerPresent)) {
      for (const row of dynamics.noLongerPresent) {
        const prev = Number.isInteger(row.previousCount) ? row.previousCount : null;
        values.push(k11WithProvenance({
          id: `dynamics_gonerow_${row.origin_municipality_code}`, label: `No longer present origin · ${row.origin_municipality_name}`,
          scope: "MUNICIPALITY", unit: "tourists", classification: "NO_LONGER_PRESENT_IN_PUBLISHED_SET",
          previous_value: prev, current_value: null, value: prev,
          display: prev == null ? null : dynamicsCount(prev),
          state: prev == null ? "UNAVAILABLE" : "VALID",
          count_month: dynamics.previousMonth || null,
          source_month: dynamics.currentMonth || null, compared_month: dynamics.previousMonth || null,
          source_ids: ["domestic_origin_context"],
        }));
      }
    }
  }
  return values;
}

// COMPARE spatial-sensitivity items (LENS_CIRCLE), from the frozen sensitivity
// model. These are interpretive window-sensitivity readings: the observed change
// is carried where the model authorised a numeric one, otherwise the item keeps
// its transition label and a withheld/interpretive state — never a fabricated 0.
function k11SensitivityUnit(item) {
  // The same unit rule spatialDeltaChangeText() renders the delta with — read
  // from the frozen item, never recomputed. Temperature is °C; density and count
  // name the metric's own unit from the shared i18n dictionary.
  if (item.deltaChangeKind === "temperature") return "°C";
  if (item.deltaChangeKind === "density") return bridgeT(`insight.unit.density.${item.metricId}`);
  return bridgeT(`insight.unit.count.${item.metricId}`);
}
function k11SensitivityValues() {
  const model = k11.compareSensitivity;
  if (!model || !Array.isArray(model.items)) return [];
  const metricSources = { tourism: "museum info".split(" "), stays: ["stay"], mobility: "bike rail".split(" "), utci: ["hati"] };
  return model.items.map((item) => {
    const numeric = Number.isFinite(item.deltaChange);
    return k11WithProvenance({
      // The delta carries its actual unit when the model authorised a numeric
      // change; an interpretive (withheld) item carries no unit because it has no
      // number — only the transition label.
      id: `sensitivity_${item.metricId}`, label: `Window sensitivity · ${item.metricId}`, scope: "LENS_CIRCLE",
      unit: numeric ? k11SensitivityUnit(item) : null, source_family: null,
      transition: item.transitionCode || null,
      value: numeric ? item.deltaChange : null,
      display: numeric ? spatialDeltaChangeText(item) : (item.transitionCode || null),
      state: numeric ? "VALID" : "INTERPRETIVE", comparison_basis: "WINDOW_SENSITIVITY",
      source_ids: metricSources[item.metricId] || [],
    });
  });
}

function k11ActiveBarrioFeature() {
  try {
    if (geographyIndex && areaModel && areaModel.profile && areaModel.profile.barrioId) {
      return geographyIndex.featureById("barrio", areaModel.profile.barrioId);
    }
  } catch (error) { /* best effort */ }
  return null;
}

// Geometry is gated by the VISIBLE reading (Finding 3): only the geometries that
// belong to the reading on screen are exported.
//   PLACE  → the active Lens circle(s) + the containing barrio outline.
//   COMPARE/LENS → both Lens circles.
//   COMPARE/AMBITO → the two official ámbito polygons (not the Lens circles).
//   CITY → no Lens geometry; the reading is municipality-wide.
function k11LensCircleFeature(which) {
  const centre = centerOf(which);
  return {
    scope: "LENS_CIRCLE", role: which === "B" ? "lensB" : "lensA", identity: which,
    geometry_kind: "generated_analytical_window",
    feature: { type: "Feature", properties: { radius_m: radii[which] }, geometry: k11CirclePolygon(centre.lat, centre.lon, radii[which]) },
  };
}
function k11BuildGeometry(mode, scope) {
  const geometry = [];
  try {
    if (mode === "COMPARE" && scope === "AMBITO") {
      if (planningState === "ready" && planningModel.index) {
        for (const [code, role] of [[ambitoCompare.a, "ambitoA"], [ambitoCompare.b, "ambitoB"]]) {
          if (!code) continue;
          const feature = planningModel.index.featureFor(code);
          if (feature) geometry.push({ scope: "PLANNING_AMBITO", role, identity: code, geometry_kind: "official_boundary", feature });
        }
      }
      return geometry;
    }
    if (mode === "CITY") return geometry; // municipality-wide: no Lens geometry
    // PLACE and COMPARE/LENS: the Lens circle(s).
    geometry.push(k11LensCircleFeature("A"));
    if (bEnabled) geometry.push(k11LensCircleFeature("B"));
    if (mode === "PLACE") {
      const barrio = k11ActiveBarrioFeature();
      if (barrio) geometry.push({ scope: "OFFICIAL_BARRIO", role: "barrio", identity: (barrio.properties && (barrio.properties.NOMBRE || barrio.properties.nombre)) || barrio.id || "barrio", geometry_kind: "official_boundary", feature: barrio });
    }
  } catch (error) { console.warn("K11 geometry assembly incomplete", error); }
  return geometry;
}

// Build the projection for the CURRENTLY VISIBLE reading (Finding 3). The values
// are chosen by the live mode, never by a retained comparison scope: a stale K10
// selection left in memory while PLACE or CITY is on screen is never exported.
function k11BuildProjection() {
  if (!shell.registry) return null;
  const mode = shell.modes ? shell.modes.currentMode() : "PLACE";
  const scope = mode === "COMPARE" ? ((typeof ambitoCompare !== "undefined" && ambitoCompare.scope) || "LENS") : null;

  let evidence = [];
  try {
    const surfaces = surfaceKeysFor(mode, currentFlags());
    const records = buildEvidenceRecords({ surfaces, registry: shell.registry });
    evidence = records.map((record) => ({
      surface: record.surface, scope: record.scope, unit: record.unit, derivation: record.derivation,
      sources: record.sources.map((source) => ({
        id: source.id, display_name: source.displayName, authority: source.authority,
        dataset_url: source.datasetUrl, artifact: source.artifact, builder: source.builder,
        freshness: source.freshness, interpretation_ceiling: source.interpretationCeiling,
      })),
    }));
  } catch (error) { console.warn("K11 provenance assembly incomplete", error); }

  let values = [];
  if (mode === "COMPARE" && scope === "AMBITO") {
    const model = ambitoCompare.model;
    if (model && Array.isArray(model.metrics)) values = model.metrics.map(k11AmbitoValue);
    values = values.concat(k11SensitivityValues());
  } else if (mode === "COMPARE" && scope === "LENS") {
    if (bEnabled && typeof lastHaloComparison !== "undefined" && lastHaloComparison && lastHaloComparison.metrics) {
      for (const id of lastHaloComparison.order) {
        const metric = lastHaloComparison.metrics[id];
        if (metric) values.push(k11LensValue(id, metric));
      }
    }
    values = values.concat(k11SensitivityValues());
  } else if (mode === "PLACE") {
    values = k11PlaceValues(k11.placeReading);
  } else if (mode === "CITY") {
    values = k11CityValues();
  }

  return {
    meta: {
      mode, comparison_scope: scope, reading: shell.reading, language: shellLanguage(),
      generated_at: new Date().toISOString(),
      // The deployment build this reading was exported from — a cache-busting
      // asset version, NOT a cryptographic fingerprint of the data. The
      // authoritative per-artifact identities (editions, sha256) travel in
      // sources.json; this id only distinguishes deployment builds.
      snapshot_id: K11_SNAPSHOT_ID, app_version: AREA_ASSET_VERSION,
      registry_contract_version: (shell.registry && shell.registry.contract_version) || null,
    },
    state_url: buildShareUrl(window.location.href, k11CurrentState()),
    values,
    evidence,
    geometry: k11BuildGeometry(mode, scope),
  };
}

// Deliver the five files via standards-only browser APIs (Blob + <a download>),
// no zip dependency. Browsers may block several automatic downloads, so a
// clickable fallback link for every file is always rendered — delivery status is
// never advertised as complete when it may have been blocked.
function k11DeliverFiles(bundle) {
  const status = document.getElementById("k11ShareStatus");
  const created = [];
  for (const file of bundle.files) {
    const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
    created.push({ url, name: file.name });
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = file.name; anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
  if (status) {
    status.dataset.tone = "ok";
    status.textContent = `${k11T("export.ready")} `;
    for (const { url, name } of created) {
      const link = document.createElement("a");
      link.href = url; link.download = name; link.textContent = name; link.className = "k11-export-link";
      status.append(link, document.createTextNode("  "));
    }
  }
  // Keep the object URLs alive long enough for the fallback links, then release.
  setTimeout(() => { for (const { url } of created) URL.revokeObjectURL(url); }, 120000);
}

function k11ExportEvidence() {
  const status = document.getElementById("k11ShareStatus");
  try {
    const projection = k11BuildProjection();
    if (!projection || (projection.values.length === 0 && projection.evidence.length === 0)) {
      if (status) { status.dataset.tone = "error"; status.textContent = k11T("export.empty"); }
      return;
    }
    const bundle = buildEvidenceBundle(projection, shell.registry, { now: new Date() });
    k11DeliverFiles(bundle);
  } catch (error) {
    console.warn("K11 export failed", error);
    if (status) { status.dataset.tone = "error"; status.textContent = k11T("export.failed"); }
  }
}

// --------------------------------------------------------------- UI wiring
(() => {
  k11ApplyCopy();
  const shareBtn = document.getElementById("k11ShareBtn");
  if (shareBtn) shareBtn.addEventListener("click", () => { k11CopyShareLink(); });
  const dismiss = document.getElementById("k11RestoreDismiss");
  if (dismiss) dismiss.addEventListener("click", () => {
    const notice = document.getElementById("k11RestoreNotice");
    if (notice) notice.hidden = true;
  });
  const exportBtn = document.getElementById("k11ExportBtn");
  if (exportBtn) exportBtn.addEventListener("click", () => {
    if (typeof k11ExportEvidence === "function") k11ExportEvidence();
  });
})();
