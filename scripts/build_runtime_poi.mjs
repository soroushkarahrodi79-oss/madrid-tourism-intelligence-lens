import fs from "node:fs/promises";

const SOURCES = {
  museums: "https://datos.madrid.es/dataset/201132-0-museos/resource/201132-2-museos-json/download/201132-2-museos-json.json",
  info: "https://datos.madrid.es/dataset/201105-0-informacion-turismo/resource/201105-0-informacion-turismo-json/download/201105-0-informacion-turismo-json.json",
  bikes: "https://datos.emtmadrid.es/dataset/5fcc0945-2cbd-46c3-801a-6a83f4167c11/resource/105ce5df-793f-4e0a-a88e-5d3b3f024a5d/download/bikestationbicimad_geojson.json",
  metroStations: "https://services5.arcgis.com/UxADft6QPcvFyDU1/arcgis/rest/services/M4_Red/FeatureServer/0/query",
  cercaniasStations: "https://services5.arcgis.com/UxADft6QPcvFyDU1/arcgis/rest/services/M5_Red/FeatureServer/0/query",
};

const CENTRAL_MADRID_ENVELOPE = "-3.745,40.385,-3.645,40.455";

function cleanText(v) {
  return String(v || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseMadridOpenData(data, type) {
  const arr = data["@graph"] || data.graph || [];
  return arr
    .map((r, i) => {
      const loc = r.location || {};
      const lat = Number(loc.latitude ?? r.latitude);
      const lon = Number(loc.longitude ?? r.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `${type}-published-${r.id || i}`,
        type,
        name: cleanText(r.title || r.name || r.organization?.["organization-name"] || type),
        lat,
        lon,
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
        id: `bike-published-${p.id || p.number || i}`,
        type: "bike",
        name: cleanText(p.name || p.address || `BiciMAD ${p.number || ""}`),
        lat,
        lon,
      };
    })
    .filter(Boolean);
}

function parseCrtmStations(data, mode) {
  return (data.features || [])
    .map((f, i) => {
      const c = f.geometry?.coordinates || [];
      const p = f.properties || {};
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const stationId = p.IDESTACION || p.CODIGOESTACION || p.OBJECTID || i;
      return {
        id: `rail-published-${mode}-${stationId}`,
        type: "rail",
        mode,
        name: cleanText(p.DENOMINACION || p.DENOMINACIONABREVIADA || `${mode} station`),
        lines: cleanText(p.LINEAS || ""),
        lat,
        lon,
      };
    })
    .filter(Boolean);
}

function crtmStationQuery(url) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "IDESTACION,CODIGOESTACION,DENOMINACION,DENOMINACIONABREVIADA,LINEAS",
    returnGeometry: "true",
    geometry: CENTRAL_MADRID_ENVELOPE,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    f: "geojson",
  });
  return `${url}?${params.toString()}`;
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "madrid-tourism-intelligence-lens/1.0 (+https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens)",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function tryLayer(name, loader) {
  try {
    const points = await loader();
    if (!points.length) throw new Error("empty response");
    return { name, points, ok: true, error: null };
  } catch (error) {
    console.warn(`[runtime-poi] ${name} unavailable: ${error.message}`);
    return { name, points: [], ok: false, error: error.message };
  }
}

const results = await Promise.all([
  tryLayer("museum", () => fetchJson(SOURCES.museums).then((d) => parseMadridOpenData(d, "museum"))),
  tryLayer("info", () => fetchJson(SOURCES.info).then((d) => parseMadridOpenData(d, "info"))),
  tryLayer("bike", () => fetchJson(SOURCES.bikes).then(parseBiciMad)),
  tryLayer("rail", async () => {
    const [metro, cercanias] = await Promise.all([
      fetchJson(crtmStationQuery(SOURCES.metroStations)).then((d) => parseCrtmStations(d, "metro")),
      fetchJson(crtmStationQuery(SOURCES.cercaniasStations)).then((d) => parseCrtmStations(d, "cercanias")),
    ]);
    return [...metro, ...cercanias];
  }),
]);

const output = {
  generatedAt: new Date().toISOString(),
  sourceMode: "deployment-snapshot",
  layers: Object.fromEntries(results.map((r) => [r.name, r.points])),
  status: Object.fromEntries(
    results.map((r) => [
      r.name,
      {
        ok: r.ok,
        count: r.points.length,
        error: r.error,
      },
    ])
  ),
  sources: SOURCES,
};

await fs.writeFile("data/runtime_poi.json", JSON.stringify(output, null, 2) + "\n");

for (const r of results) {
  console.log(`[runtime-poi] ${r.name}: ${r.ok ? r.points.length + " points" : "unavailable"}`);
}
