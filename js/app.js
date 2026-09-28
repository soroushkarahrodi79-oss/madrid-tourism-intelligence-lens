// App wiring: Leaflet map, lens markers, UI event handlers. Pure stats logic
// lives in lens.js / evidence.js; this file only renders their output.

const LAYER_COLOR = { museum: "#9d72ff", info: "#c79cff", stay: "#3da8ff", bike: "#54e2b5" };
const LAYER_LABEL = { museum: "Museums", info: "Tourist info", stay: "Hotels & stays", bike: "BiciMAD" };
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
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution:
        'Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }
  );
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
  // Research evidence is opt-in: populate HATI but keep it off the map until requested.
  heat: L.layerGroup(),
};

let poiPoints = [];
let hatiAssets = [];
let hatiStudyArea = null;
let layerStatus = {};
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
  m.bindTooltip(
    `<b>${count} ${LAYER_LABEL[type]}</b><br>Grouped for readability · zoom in to reveal individual points`,
    { direction: "top", offset: [0, -8] }
  );
  m.on("click", () => {
    const nextZoom = Math.min(16, Math.max(map.getZoom() + 1, 15));
    map.setView([cluster.lat, cluster.lon], nextZoom, { animate: true });
  });
  m.addTo(groups[type]);
  return m;
}

function rebuildDenseLayer(type) {
  const group = groups[type];
  group.clearLayers();
  const points = poiPoints.filter((p) => p.type === type);
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
  poiPoints
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
  return poiStatsInLens(poiPoints, centerOf(which), radius);
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
    const label = { museums: "Museums", info: "Tourist info", bikes: "BiciMAD", stays: "Hotels & stays" }[name];
    return `${label}: <b>${STATUS_LABEL[status]}</b>`;
  });
  if (Object.values(layerStatus).some((s) => s === "published")) {
    lines.push("Deployment snapshots are generated from the public sources during the latest site deploy.");
  }
  if (Object.values(layerStatus).some((s) => s === "snapshot")) {
    lines.push("Curated fallback counts are a partial sample, not a complete inventory.");
  }
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
  const counts = { Museum: s.museum, Stay: s.stay, Bike: s.bike, Info: s.info };
  const statuses = {
    Museum: layerStatus.museums,
    Stay: layerStatus.stays,
    Bike: layerStatus.bikes,
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
    combinedStatus(layerStatus, ["bikes"]),
    a.bike,
    b.bike
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
    liveFoot: "within lens",
    publishedFoot: "deployment snapshot",
    snapshotFoot: "sample count, not exhaustive",
    unavailableFoot: "source unavailable",
  });
  renderCountMetric({
    valueId: "mobilityValue",
    footId: "mobilityFoot",
    value: s.bike,
    status: combinedStatus(layerStatus, ["bikes"]),
    liveFoot: "BiciMAD in lens",
    publishedFoot: "BiciMAD deployment snapshot",
    snapshotFoot: "sample count, not exhaustive",
    unavailableFoot: "BiciMAD source unavailable",
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

async function boot() {
  const [snapshotPOI, runtimePOI, hatiAssetsData, hatiProvenance] = await Promise.all([
    fetch("data/snapshot_poi.json").then((r) => r.json()),
    fetch("data/runtime_poi.json?v=20260928-5")
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
