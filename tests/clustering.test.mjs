import assert from "node:assert/strict";
import test from "node:test";
import {
  projectToWorldPixel,
  clusterCellSizePx,
  shouldClusterDenseLayer,
  clusterPointsByPixelGrid,
} from "../js/clustering.js";

test("dense layers cluster below zoom 16 and expand at zoom 16+", () => {
  assert.equal(shouldClusterDenseLayer(14), true);
  assert.equal(shouldClusterDenseLayer(15), true);
  assert.equal(shouldClusterDenseLayer(16), false);
  assert.equal(clusterCellSizePx(16), 0);
});

test("nearby Madrid points are grouped at overview zoom", () => {
  const points = [
    { id: "a", lat: 40.415, lon: -3.692 },
    { id: "b", lat: 40.41505, lon: -3.69205 },
    { id: "c", lat: 40.41508, lon: -3.69202 },
  ];
  const clusters = clusterPointsByPixelGrid(points, 14);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 3);
});

test("widely separated Madrid points remain separate", () => {
  const points = [
    { id: "a", lat: 40.415, lon: -3.692 },
    { id: "b", lat: 40.455, lon: -3.645 },
  ];
  const clusters = clusterPointsByPixelGrid(points, 14);
  assert.equal(clusters.length, 2);
});

test("clustering preserves every source record exactly once", () => {
  const points = Array.from({ length: 25 }, (_, i) => ({
    id: String(i),
    lat: 40.40 + i * 0.001,
    lon: -3.72 + i * 0.001,
  }));
  const clusters = clusterPointsByPixelGrid(points, 13);
  const flattenedIds = clusters.flatMap((cluster) => cluster.points.map((p) => p.id)).sort();
  assert.deepEqual(flattenedIds, points.map((p) => p.id).sort());
  assert.equal(clusters.reduce((sum, cluster) => sum + cluster.count, 0), points.length);
});

test("mercator projection is deterministic for the same point and zoom", () => {
  const p = { lat: 40.415, lon: -3.692 };
  assert.deepEqual(projectToWorldPixel(p, 14), projectToWorldPixel(p, 14));
});
