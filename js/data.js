// Data loading: live-first with a labelled repository-snapshot fallback.
// Every point carries `provenance: "live" | "snapshot"` so the UI never
// blends a successful live fetch with static fallback data silently.

const LIVE_SOURCES = {
  museums: "https://datos.madrid.es/dataset/201132-0-museos/resource/201132-2-museos-json/download/201132-0-museos.json",
  info: "https://datos.madrid.es/dataset/201105-0-informacion-turismo/resource/201105-0-informacion-turismo-json/download/201105-0-informacion-turismo.json",
  bikes: "https://datos.emtmadrid.es/dataset/5fcc0945-2cbd-46c3-801a-6a83f4167c11/resource/105ce5df-793f-4e0a-a88e-5d3b3f024a5d/download/bikestationbicimad_geojson.json",
  overpass: "https://overpass.kumi.systems/api/interpreter",
};

function cleanText(v) {
  return String(v || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function coordsOfMadridRecord(r) {
  const loc = r.location || {};
  return [Number(loc.latitude ?? r.latitude), Number(loc.longitude ?? r.longitude)];
}

function parseMadridOpenData(data, type) {
  const arr = data["@graph"] || data.graph || [];
  return arr
    .map((r, i) => {
      const [lat, lon] = coordsOfMadridRecord(r);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `${type}-live-${i}`,
        type,
        name: cleanText(r.title || r.name || r.organization?.["organization-name"] || type),
        lat,
        lon,
        provenance: "live",
      };
    })
    .filter(Boolean);
}

function parseBiciMad(data) {
  return (data.features || [])
    .map((f, i) => {
      const c = f.geometry?.coordinates || [];
      const p = f.properties || {};
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `bike-live-${i}`,
        type: "bike",
        name: cleanText(p.name || p.address || `BiciMAD ${p.number || ""}`),
        lat,
        lon,
        provenance: "live",
      };
    })
    .filter(Boolean);
}

function parseOverpassStays(d) {
  return (d.elements || [])
    .map((e, i) => {
      const lat = Number(e.lat ?? e.center?.lat);
      const lon = Number(e.lon ?? e.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `stay-live-${e.type}-${e.id || i}`,
        type: "stay",
        name: cleanText(e.tags?.name || e.tags?.brand || "Tourist accommodation"),
        lat,
        lon,
        provenance: "live",
      };
    })
    .filter(Boolean);
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function snapshotFor(snapshotPOI, type) {
  return (snapshotPOI[type] || []).map((p) => ({ ...p, type, provenance: "snapshot" }));
}

// Loads every POI layer. Each result carries { points, layerStatus } where
// layerStatus is one of "live" | "snapshot" | "unavailable" per layer, for
// the UI to badge. "unavailable" means the live fetch failed AND no curated
// snapshot exists for that layer — the app never invents or approximates
// points to fill the gap; it reports the layer as unavailable instead.
async function loadAllLayers(snapshotPOI) {
  const layerStatus = {};
  const points = [];

  async function loadLayer(name, type, task) {
    try {
      const live = await task();
      if (!live.length) throw new Error("empty live response");
      points.push(...live);
      layerStatus[name] = "live";
    } catch (e) {
      const snap = snapshotFor(snapshotPOI, type);
      if (snap.length) {
        points.push(...snap);
        layerStatus[name] = "snapshot";
      } else {
        layerStatus[name] = "unavailable";
      }
    }
  }

  await Promise.all([
    loadLayer("museums", "museum", () =>
      fetchJSON(LIVE_SOURCES.museums).then((d) => parseMadridOpenData(d, "museum"))
    ),
    loadLayer("info", "info", () =>
      fetchJSON(LIVE_SOURCES.info).then((d) => parseMadridOpenData(d, "info"))
    ),
    loadLayer("bikes", "bike", () => fetchJSON(LIVE_SOURCES.bikes).then(parseBiciMad)),
    loadLayer("stays", "stay", async () => {
      const q =
        '[out:json][timeout:20];(nwr["tourism"~"hotel|hostel|guest_house|apartment"](40.385,-3.745,40.455,-3.645););out center tags;';
      const d = await fetchJSON(LIVE_SOURCES.overpass + "?data=" + encodeURIComponent(q));
      return parseOverpassStays(d);
    }),
  ]);

  return { points, layerStatus };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { loadAllLayers, snapshotFor };
}
