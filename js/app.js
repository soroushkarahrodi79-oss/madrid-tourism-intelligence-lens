// App wiring: Leaflet map, lens markers, UI event handlers. Pure stats logic
// lives in lens.js / evidence.js; this file only renders their output.

const LAYER_COLOR = { museum: "#9d72ff", info: "#c79cff", stay: "#3da8ff", bike: "#54e2b5" };
const LAYER_LABEL = { museum: "Museums", info: "Tourist info", stay: "Hotels & stays", bike: "BiciMAD" };

const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([40.415, -3.692], 14);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
}).addTo(map);

const groups = {
  museum: L.layerGroup().addTo(map),
  info: L.layerGroup().addTo(map),
  stay: L.layerGroup().addTo(map),
  bike: L.layerGroup().addTo(map),
  heat: L.layerGroup().addTo(map),
};

let poiPoints = [];
let hatiAssets = [];
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
  const src = p.provenance === "snapshot" ? "snapshot sample (not exhaustive)" : "live source";
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

function rebuildHeatLayer() {
  groups.heat.clearLayers();
  hatiAssets.forEach((a) => addMarker(hatiPointFor(a, timestep)));
  refresh();
}

function setLayerVisible(name, on) {
  if (on) {
    if (!map.hasLayer(groups[name])) map.addLayer(groups[name]);
  } else if (map.hasLayer(groups[name])) {
    map.removeLayer(groups[name]);
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

const STATUS_LABEL = { live: "live", snapshot: "SNAPSHOT SAMPLE", unavailable: "UNAVAILABLE" };

function renderLayerSourceNote() {
  const lines = Object.entries(layerStatus).map(([name, status]) => {
    const label = { museums: "Museums", info: "Tourist info", bikes: "BiciMAD", stays: "Hotels & stays" }[name];
    return `${label}: <b>${STATUS_LABEL[status]}</b>`;
  });
  if (Object.values(layerStatus).some((s) => s === "snapshot")) {
    lines.push("Snapshot counts are a partial sample, not a complete inventory.");
  }
  document.getElementById("layerSourceNote").innerHTML = lines.join("<br>");
}

function renderHeatMetric(h) {
  const hv = document.getElementById("heatValue");
  const hf = document.getElementById("heatFoot");
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
  const ha = heatStatsFor("A");
  const hb = heatStatsFor("B");
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
    ha.evidence === "MODEL-DERIVED" && hb.evidence === "MODEL-DERIVED"
      ? deltaOrDash(ha.mean, hb.mean, "°")
      : "—";
  document.getElementById("cmpEvidence").textContent = `${ha.evidence === "NONE" ? "A: none" : "A: ok"} / ${
    hb.evidence === "NONE" ? "B: none" : "B: ok"
  }`;
}

function shadeMarkersOutsideActiveLens() {
  const center = centerOf(active);
  Object.values(groups).forEach((g) =>
    g.eachLayer((m) => {
      if (!m._p) return;
      const d = haversineMeters(center, m._p);
      const inside = d <= radius;
      const base = m._p.type === "bike" ? 0.72 : 0.86;
      m.setStyle({ opacity: inside ? 1 : 0.2, fillOpacity: inside ? base : 0.1, weight: inside ? 1.25 : 0.7 });
    })
  );
}

// Renders one of the count metrics (tourism POIs, stays, mobility), honoring
// the "unavailable" and "snapshot" states so a partial or missing layer is
// never presented as if it were a complete, verified count.
function renderCountMetric({ valueId, footId, value, status, liveFoot, snapshotFoot, unavailableFoot }) {
  const v = document.getElementById(valueId);
  const f = document.getElementById(footId);
  if (status === "unavailable") {
    v.textContent = "No data";
    v.className = "metric-value abstain";
    f.textContent = unavailableFoot;
  } else {
    v.textContent = value;
    v.className = "metric-value";
    f.textContent = status === "snapshot" ? snapshotFoot : liveFoot;
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
    snapshotFoot: "sample count, not exhaustive",
    unavailableFoot: "source unavailable",
  });
  renderCountMetric({
    valueId: "stayValue",
    footId: "stayFoot",
    value: s.stay,
    status: combinedStatus(layerStatus, ["stays"]),
    liveFoot: "within lens",
    snapshotFoot: "sample count, not exhaustive",
    unavailableFoot: "source unavailable",
  });
  renderCountMetric({
    valueId: "mobilityValue",
    footId: "mobilityFoot",
    value: s.bike,
    status: combinedStatus(layerStatus, ["bikes"]),
    liveFoot: "BiciMAD in lens",
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

document.getElementById("lensAButton").onclick = () => activateLens("A");
document.getElementById("lensBButton").onclick = () => (bEnabled ? activateLens("B") : enableLensB());
document.getElementById("navCompare").onclick = () => (bEnabled ? disableLensB() : enableLensB());
document.getElementById("navEvidence").onclick = () => {
  map.fitBounds(
    [
      [40.406, -3.696],
      [40.422, -3.676],
    ],
    { padding: [60, 60] }
  );
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

async function boot() {
  const [snapshotPOI, hatiAssetsData] = await Promise.all([
    fetch("data/snapshot_poi.json").then((r) => r.json()),
    fetch("data/hati_assets.json").then((r) => r.json()),
  ]);
  hatiAssets = hatiAssetsData;
  hatiAssets.forEach((a) => addMarker(hatiPointFor(a, timestep)));

  const { points, layerStatus: status } = await loadAllLayers(snapshotPOI);
  poiPoints = points;
  layerStatus = status;
  points.forEach(addMarker);

  const allLive = Object.values(status).every((s) => s === "live");
  const anyUnavailable = Object.values(status).some((s) => s === "unavailable");
  const badge = document.getElementById("liveBadge");
  badge.className = allLive ? "live" : "live mixed";
  badge.querySelector("span").textContent = allLive
    ? `${points.length} live records + HATI evidence`
    : `${points.length} records · some layers on a partial sample or unavailable${
        anyUnavailable ? " (see layer panel)" : ""
      }`;
  renderLayerSourceNote();
  refresh();
}

boot();
