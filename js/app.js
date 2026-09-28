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

const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([40.415, -3.692], 14);

const cartoBasemapKey = window.RUNTIME_CONFIG?.CARTO_BASEMAP_KEY || "";
let activeBasemap = null;
let activeBasemapName = "light";

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
let radius = 900;
let active = "A";
let bEnabled = false;
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
      radius,
      color: "#f7fbff",
      weight: 1.8,
      opacity: 0.95,
      fillColor: "#fff",
      fillOpacity: 0.055,
      dashArray: "5 8",
    }).addTo(map),
  },
  B: {
    marker: L.marker(defaults.B, { draggable: true, icon: markerIcon("b"), zIndexOffset: 1000 }),
    circle: L.circle(defaults.B, {
      radius,
      color: "#43d7ff",
      weight: 1.8,
      opacity: 0.95,
      fillColor: "#43d7ff",
      fillOpacity: 0.045,
      dashArray: "5 8",
    }),
  },
};

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

function setLayerVisible(name, on) {
  if (on) {
    if (!map.hasLayer(groups[name])) map.addLayer(groups[name]);
  } else if (map.hasLayer(groups[name])) {
    map.removeLayer(groups[name]);
  }

  if (name === "heat") {
    syncHatiUi(on);
    refresh();
  }
}

function centerOf(which) {
  const c = lenses[which].marker.getLatLng();
  return { lat: c.lat, lon: c.lng };
}

function statsFor(which) {
  return poiStatsInLens(visiblePoiPoints(), centerOf(which), radius);
}

function heatStatsFor(which) {
  return hatiStatsInLens(hatiAssets, timestep, centerOf(which), radius, haversineMeters);
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

function renderCompare() {
  if (!bEnabled) return;
  const a = statsFor("A");
  const b = statsFor("B");
  const hatiOn = isHatiVisible();
  const ha = hatiOn ? heatStatsFor("A") : null;
  const hb = hatiOn ? heatStatsFor("B") : null;
  document.getElementById("cmpPoi").textContent = comparisonDelta(
    combinedStatus(layerStatus, ["museums", "info"]),
    a.tourism,
    b.tourism
  );
  document.getElementById("cmpStay").textContent = comparisonDelta(
    combinedStatus(layerStatus, ["stays"]),
    a.stay,
    b.stay
  );
  document.getElementById("cmpMobility").textContent = comparisonDelta(
    combinedStatus(layerStatus, ["bikes", "rail"]),
    a.mobility,
    b.mobility
  );
  document.getElementById("cmpHeat").textContent =
    hatiOn && ha.evidence === "MODEL-DERIVED" && hb.evidence === "MODEL-DERIVED"
      ? deltaOrDash(ha.mean, hb.mean, "°")
      : "—";
  document.getElementById("cmpEvidence").textContent = hatiOn
    ? `${ha.evidence === "NONE" ? "A: none" : "A: ok"} / ${hb.evidence === "NONE" ? "B: none" : "B: ok"}`
    : "HATI off";
}

function shadeMarkersOutsideActiveLens() {
  const center = centerOf(active);
  Object.values(groups).forEach((g) =>
    g.eachLayer((m) => {
      if (!m._p) return;
      const d = haversineMeters(center, m._p);
      const inside = d <= radius;

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
  Object.values(lenses).forEach((x) => x.circle.setRadius(radius).setLatLng(x.marker.getLatLng()));
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
  renderMix(s);
  renderNearest(s);
  renderCompare();
  shadeMarkersOutsideActiveLens();
}

function activateLens(which) {
  active = which;
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
document.getElementById("radiusSlider").oninput = (e) => {
  radius = Number(e.target.value);
  document.getElementById("radiusText").textContent =
    radius >= 1000 ? (radius / 1000).toFixed(2) + " km" : radius + " m";
  refresh();
};
document.getElementById("basemapSelect").onchange = (e) => setBasemap(e.target.value);
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
  const [snapshotPOI, runtimePOI, hatiAssetsData, hatiProvenance] = await Promise.all([
    fetch("data/snapshot_poi.json").then((r) => r.json()),
    fetch("data/runtime_poi.json?v=20260928-18")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})),
    fetch("data/hati_assets.json").then((r) => r.json()),
    fetch("data/hati_provenance.json?v=20260928-11").then((r) => r.json()),
  ]);
  hatiAssets = hatiAssetsData;
  hatiStudyArea = hatiProvenance.study_area || null;
  drawHatiStudyArea();
  hatiAssets.forEach((a) => addMarker(hatiPointFor(a, timestep)));

  const { points, layerStatus: status } = await loadAllLayers(snapshotPOI, runtimePOI);
  poiPoints = points;
  layerStatus = status;

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
}

boot();
