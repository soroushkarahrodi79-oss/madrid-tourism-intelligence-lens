import assert from "node:assert/strict";
import test from "node:test";
import { loadAllLayers, parseCrtmStations, crtmStationQuery } from "../js/data.js";

const snapshotPOI = {
  museum: [{ id: "m1", name: "Test Museum", lat: 40.41, lon: -3.69 }],
  info: [],
  stay: [{ id: "s1", name: "Test Hotel", lat: 40.41, lon: -3.69 }],
  // no "bike" key: mirrors the real data/snapshot_poi.json, which carries no
  // BiciMAD fallback because exact station coordinates could not be verified
  // against the official EMT Madrid dataset.
};

test("loadAllLayers: falls back to 'unavailable' (never invented points) for a layer with no snapshot", async () => {
  const realFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("simulated network failure");
  };
  try {
    const { points, layerStatus } = await loadAllLayers(snapshotPOI);
    assert.equal(layerStatus.bikes, "unavailable");
    assert.equal(layerStatus.rail, "unavailable");
    assert.equal(points.some((p) => p.type === "bike"), false);
    assert.equal(points.some((p) => p.type === "rail"), false);
  } finally {
    global.fetch = realFetch;
  }
});

test("loadAllLayers: falls back to a labelled 'snapshot' for a layer that has curated fallback data", async () => {
  const realFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("simulated network failure");
  };
  try {
    const { points, layerStatus } = await loadAllLayers(snapshotPOI);
    assert.equal(layerStatus.museums, "snapshot");
    const museumPoints = points.filter((p) => p.type === "museum");
    assert.equal(museumPoints.length, 1);
    assert.equal(museumPoints[0].provenance, "snapshot");
  } finally {
    global.fetch = realFetch;
  }
});

test("loadAllLayers: an empty snapshot array for a defined layer (e.g. no tourist info curated) is also 'unavailable', not a fabricated zero-with-live badge", async () => {
  const realFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("simulated network failure");
  };
  try {
    const { layerStatus } = await loadAllLayers(snapshotPOI);
    assert.equal(layerStatus.info, "unavailable");
  } finally {
    global.fetch = realFetch;
  }
});


test("loadAllLayers: deployment snapshot is preferred over the small curated fallback when live fetch fails", async () => {
  const realFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("simulated network failure");
  };
  const runtimePOI = {
    layers: {
      museum: [
        { id: "pm1", name: "Published Museum 1", lat: 40.41, lon: -3.69 },
        { id: "pm2", name: "Published Museum 2", lat: 40.42, lon: -3.70 },
      ],
      bike: [{ id: "pb1", name: "Published BiciMAD", lat: 40.41, lon: -3.69 }],
      rail: [{ id: "pr1", name: "Sol", mode: "metro", lat: 40.4169, lon: -3.7035 }],
    },
  };
  try {
    const { points, layerStatus } = await loadAllLayers(snapshotPOI, runtimePOI);
    assert.equal(layerStatus.museums, "published");
    assert.equal(layerStatus.bikes, "published");
    assert.equal(layerStatus.rail, "published");
    assert.equal(points.filter((p) => p.type === "museum").length, 2);
    assert.equal(points.find((p) => p.type === "bike").provenance, "published");
  } finally {
    global.fetch = realFetch;
  }
});


test("loadAllLayers: packaged deployment/snapshot data returns immediately without calling third-party fetch", async () => {
  const realFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch should not be needed when packaged data exists");
  };

  const runtimePOI = {
    layers: {
      museum: [{ id: "pm1", name: "Published Museum", lat: 40.41, lon: -3.69 }],
      info: [{ id: "pi1", name: "Published Info", lat: 40.41, lon: -3.69 }],
      bike: [{ id: "pb1", name: "Published BiciMAD", lat: 40.41, lon: -3.69 }],
      rail: [{ id: "pr1", name: "Sol", mode: "metro", lat: 40.4169, lon: -3.7035 }],
    },
  };

  try {
    const { points, layerStatus } = await loadAllLayers(snapshotPOI, runtimePOI);
    assert.equal(fetchCalls, 0);
    assert.equal(layerStatus.museums, "published");
    assert.equal(layerStatus.info, "published");
    assert.equal(layerStatus.bikes, "published");
    assert.equal(layerStatus.rail, "published");
    assert.equal(layerStatus.stays, "snapshot");
    assert.equal(points.some((p) => p.type === "museum"), true);
    assert.equal(points.some((p) => p.type === "bike"), true);
    assert.equal(points.some((p) => p.type === "rail"), true);
    assert.equal(points.some((p) => p.type === "stay"), true);
  } finally {
    global.fetch = realFetch;
  }
});


test("parseCrtmStations: preserves mode, station name, lines and WGS84 point geometry", () => {
  const data = {
    features: [
      {
        geometry: { coordinates: [-3.7035, 40.4169] },
        properties: {
          IDESTACION: "M-001",
          DENOMINACION: "Sol",
          LINEAS: "1, 2, 3",
        },
      },
    ],
  };
  const points = parseCrtmStations(data, "metro");
  assert.equal(points.length, 1);
  assert.equal(points[0].type, "rail");
  assert.equal(points[0].mode, "metro");
  assert.equal(points[0].name, "Sol");
  assert.equal(points[0].lines, "1, 2, 3");
  assert.equal(points[0].lat, 40.4169);
  assert.equal(points[0].lon, -3.7035);
});

test("CRTM query is bounded to central Madrid and requests WGS84 GeoJSON", () => {
  const url = crtmStationQuery("https://example.test/query");
  assert.match(url, /geometry=-3\.745%2C40\.385%2C-3\.645%2C40\.455/);
  assert.match(url, /inSR=4326/);
  assert.match(url, /outSR=4326/);
  assert.match(url, /f=geojson/);
});
