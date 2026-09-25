import assert from "node:assert/strict";
import test from "node:test";
import { loadAllLayers } from "../js/data.js";

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
    assert.equal(points.some((p) => p.type === "bike"), false);
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
