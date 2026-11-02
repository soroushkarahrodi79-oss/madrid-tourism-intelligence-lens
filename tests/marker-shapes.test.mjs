import assert from "node:assert/strict";
import test from "node:test";
import {
  OPERATIONAL_MARKER_SHAPES,
  MARKER_SHAPE_EXTENT,
  renderedMarkerRadius,
  markerShapeReach,
  markerShapeContains,
  traceMarkerShape,
  markerShapeClipPath,
} from "../js/marker-shapes.js";

// #152 — the approved category -> silhouette mapping. Changing one is a design
// decision, not a refactor, so the table is pinned here.
const APPROVED = { bike: "circle", stay: "square", rail: "diamond", museum: "triangle", info: "plus" };

const centroid = (pts) => {
  let a = 0, cx = 0, cy = 0;
  pts.forEach(([x, y], i) => { const [nx, ny] = pts[(i + 1) % pts.length]; const f = x * ny - nx * y; a += f; cx += (x + nx) * f; cy += (y + ny) * f; });
  return [cx / (3 * a), cy / (3 * a)];
};
const area = (pts) => Math.abs(pts.reduce((s, [x, y], i) => { const [nx, ny] = pts[(i + 1) % pts.length]; return s + (x * ny - nx * y); }, 0)) / 2;

test("the five operational categories map to five distinct approved silhouettes", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(OPERATIONAL_MARKER_SHAPES).map(([k, v]) => [k, v.name])), APPROVED);
  assert.equal(new Set(Object.values(APPROVED)).size, 5);
});

test("only BiciMAD keeps Leaflet's native circle; every other category has a polygon", () => {
  assert.equal(OPERATIONAL_MARKER_SHAPES.bike.points, null);
  for (const type of ["stay", "rail", "museum", "info"]) assert.ok(OPERATIONAL_MARKER_SHAPES[type].points.length >= 3, type);
});

test("polygons are centroid-centred, non-degenerate and fit the shared legend extent", () => {
  for (const [type, { points }] of Object.entries(OPERATIONAL_MARKER_SHAPES)) {
    if (!points) continue;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    assert.ok(area(points) > 1, `${type} has usable area`);
    assert.ok(Math.max(...xs.map(Math.abs), ...ys.map(Math.abs)) <= MARKER_SHAPE_EXTENT, `${type} stays inside the legend box`);
    // The area centroid sits on the data point (within 0.1 radius), so the symbol marks the location.
    const [cx, cy] = centroid(points);
    assert.ok(Math.abs(cx) <= 0.1 && Math.abs(cy) <= 0.1, `${type} centroid ${cx.toFixed(2)},${cy.toFixed(2)}`);
  }
});

test("shapes stay inside the existing marker footprint (radius 4 plus the outline half-weight)", () => {
  // Hit testing and canvas dirty-rect padding are still the circle's, so no
  // vertex may poke further out than the circle's own outer edge + 1 px.
  const r = renderedMarkerRadius(4.2);
  for (const [type, { points }] of Object.entries(OPERATIONAL_MARKER_SHAPES)) {
    if (!points) continue;
    const reach = Math.max(...points.map(([x, y]) => Math.hypot(x, y))) * r;
    assert.ok(reach <= r * 1.25 + 0.75 + 0.5, `${type} reach ${reach.toFixed(2)}px`);
  }
});

test("stroked reach covers every vertex plus its outline join, and exceeds the old circle for the triangle", () => {
  const r = renderedMarkerRadius(4.2);
  const weight = 1.5;
  const oldCircle = 4.2 + weight / 2; // Leaflet's inherited hit radius
  for (const [type, { points }] of Object.entries(OPERATIONAL_MARKER_SHAPES)) {
    if (!points) continue;
    const vertexMax = Math.max(...points.map(([x, y]) => Math.hypot(x, y))) * r;
    const reach = markerShapeReach(OPERATIONAL_MARKER_SHAPES[type], r, weight);
    assert.ok(reach >= vertexMax + weight / 2 - 1e-9, `${type} reach ${reach.toFixed(2)} covers vertex ${vertexMax.toFixed(2)} + half-weight`);
  }
  assert.ok(markerShapeReach(OPERATIONAL_MARKER_SHAPES.museum, r, weight) > oldCircle + 1, "triangle pokes well past the inherited circle");
  assert.equal(markerShapeReach(OPERATIONAL_MARKER_SHAPES.bike, r, weight), 0, "circle has no polygon reach (stays native)");
});

test("polygon containment includes the base vertex the old circle missed, and nothing far beyond", () => {
  const tri = OPERATIONAL_MARKER_SHAPES.museum;
  const r = 4, weight = 1.5;
  const [vx, vy] = tri.points[1]; // base-right vertex, ~5.49 px out
  const d = Math.hypot(vx, vy) * r;
  assert.ok(d > 4.2 + weight / 2, "vertex lies beyond the inherited circle");
  assert.equal(markerShapeContains(tri, r, weight, 0, (vx / Math.hypot(vx, vy)) * (d + 0.5), (vy / Math.hypot(vx, vy)) * (d + 0.5)), true, "inside the stroke and miter at the vertex");
  assert.equal(markerShapeContains(tri, r, weight, 0, (vx / Math.hypot(vx, vy)) * (d + weight / 2 + 2), (vy / Math.hypot(vx, vy)) * (d + weight / 2 + 2)), false, "2 px past the stroke is not a hit");
  assert.equal(markerShapeContains(tri, r, weight, 0, 0, 0), true, "centre");
  assert.equal(markerShapeContains(OPERATIONAL_MARKER_SHAPES.bike, r, weight, 0, 0, 0), false, "native circle has no polygon containment");
});

test("rendered radius follows Leaflet's whole-pixel rounding (4.2 -> 4, 2.8 -> 3)", () => {
  assert.equal(renderedMarkerRadius(4.2), 4);
  assert.equal(renderedMarkerRadius(2.8), 3);
  assert.equal(renderedMarkerRadius(0.2), 1);
});

test("traceMarkerShape draws a closed path at the data point, and declines for a circle", () => {
  const calls = [];
  const ctx = { beginPath: () => calls.push(["begin"]), moveTo: (x, y) => calls.push(["move", x, y]), lineTo: (x, y) => calls.push(["line", x, y]), closePath: () => calls.push(["close"]) };
  assert.equal(traceMarkerShape(ctx, OPERATIONAL_MARKER_SHAPES.stay, 100, 50, 4), true);
  assert.deepEqual(calls[0], ["begin"]);
  assert.equal(calls.filter((c) => c[0] === "move").length, 1);
  assert.equal(calls.filter((c) => c[0] === "line").length, 3);
  assert.deepEqual(calls.at(-1), ["close"]);
  assert.deepEqual(calls[1].slice(1), [100 - 0.88 * 4, 50 - 0.88 * 4]);

  const none = [];
  assert.equal(traceMarkerShape({ beginPath: () => none.push(1) }, OPERATIONAL_MARKER_SHAPES.bike, 0, 0, 3), false);
  assert.deepEqual(none, []);
});

test("legend clip-path is generated from the same table and stays inside the box", () => {
  assert.equal(markerShapeClipPath("bike"), "circle(40%)");
  assert.equal(markerShapeClipPath("unknown"), "");
  for (const type of ["stay", "rail", "museum", "info"]) {
    const css = markerShapeClipPath(type);
    const nums = [...css.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
    assert.equal(nums.length, OPERATIONAL_MARKER_SHAPES[type].points.length * 2, type);
    assert.ok(nums.every((n) => n >= 0 && n <= 100), `${type} within 0-100%`);
  }
  // The diamond touches all four edge midpoints at the same offsets the map polygon implies.
  assert.equal(markerShapeClipPath("rail"), "polygon(50% 2%,98% 50%,50% 98%,2% 50%)");
});
