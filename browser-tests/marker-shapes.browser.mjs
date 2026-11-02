import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

// LENS_TEST_BROWSER=webkit runs the same contract in WebKit (Safari engine).
const engine = process.env.LENS_TEST_BROWSER === "webkit" ? webkit : chromium;

// #152 — non-colour category silhouettes on the five operational markers.
// Every figure here is a measurement of the app's own canvas alpha mask at the
// real rendered size. It shows AUTOMATED silhouette separation; it is neither
// human category recognition (#153) nor a measurement on real CARTO imagery.
// The silhouette mask ignores fill colour, so it is also the grayscale case.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".geojson": "application/geo+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const target = path.resolve(ROOT, p === "/" ? "index.html" : p.slice(1));
  if (!target.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (e, c) => { if (e) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(c); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const browser = await engine.launch({ headless: true });

const TYPES = ["museum", "info", "stay", "bike", "rail"];
const APPROVED = { bike: "circle", stay: "square", rail: "diamond", museum: "triangle", info: "plus" };

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof map !== "undefined" && typeof groups !== "undefined" && typeof createOperationalMarker === "function");
  return { page, ctx, errors };
}

// Replace every operational layer with one synthetic point per category, in a
// row 130 m south of the active lens centre (inside the lens, clear of its glyph).
async function plantRow(page) {
  await page.evaluate((types) => {
    const c = centerOf(active);
    map.setView(c, 17, { animate: false });
    types.forEach((t, i) => {
      groups[t].clearLayers();
      addMarker({ type: t, name: `Synthetic ${t}`, lat: c.lat - 0.0012, lon: c.lon + (i - 2) * 0.0004, ...(t === "stay" ? { stayKind: "hotel" } : {}) });
    });
    shadeMarkersOutsideActiveLens();
  }, TYPES);
  await page.waitForTimeout(600);
}

// Read each marker's 24x24 neighbourhood from the renderer canvas.
async function readMasks(page) {
  return page.evaluate((types) => {
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const out = {};
    for (const t of types) {
      let m = null;
      groups[t].eachLayer((l) => { if (l._p) m = l; });
      const r = m._renderer, cv = r._container, g = cv.getContext("2d", { willReadFrequently: true });
      const N = 24;
      const x0 = Math.round(m._point.x - r._bounds.min.x - N / 2), y0 = Math.round(m._point.y - r._bounds.min.y - N / 2);
      const px = g.getImageData(x0, y0, N, N).data;
      const col = rgb(LAYER_COLOR[t]), rim = rgb(MARKER_OUTLINE);
      const sil = [], fill = [], rimMask = [];
      for (let i = 0; i < N * N; i++) {
        const a = px[i * 4 + 3], c = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
        sil.push(a >= 128 ? 1 : 0);
        fill.push(a >= 100 && d(c, col) < 60 ? 1 : 0);
        rimMask.push(a >= 200 && d(c, rim) < 60 ? 1 : 0);
      }
      out[t] = {
        N, sil, fill, rim: rimMask,
        native: m.constructor === L.CircleMarker,
        shape: m.options.markerShape ? m.options.markerShape.name : "circle",
        style: { color: m.options.color, weight: m.options.weight, opacity: m.options.opacity },
      };
    }
    return out;
  }, TYPES);
}

const count = (a) => a.reduce((s, v) => s + v, 0);
function inradius(mask, N) {
  let m = mask, k = 0;
  while (count(m) > 0) {
    const o = new Array(N * N).fill(0);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      o[y * N + x] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => m[(y + dy) * N + x + dx]) ? 1 : 0;
    }
    m = o; k++;
  }
  return k;
}
// Fewest silhouette pixels that differ after the best +/-3 px alignment.
function minXor(a, b, N) {
  let best = Infinity;
  for (let sx = -3; sx <= 3; sx++) for (let sy = -3; sy <= 3; sy++) {
    let xor = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const xa = x + sx, ya = y + sy;
      const va = xa >= 0 && xa < N && ya >= 0 && ya < N ? a[ya * N + xa] : 0;
      if (va !== b[y * N + x]) xor++;
    }
    best = Math.min(best, xor);
  }
  return best;
}

test("operational markers draw the approved silhouette; HATI/pedestrian/park stay plain circles", async () => {
  const { page, ctx, errors } = await open();
  await plantRow(page);
  const masks = await readMasks(page);
  for (const t of TYPES) {
    assert.equal(masks[t].shape, APPROVED[t], `${t} shape`);
    assert.equal(masks[t].native, t === "bike", `${t} is ${t === "bike" ? "" : "not "}a plain Leaflet circle`);
  }
  const plain = await page.evaluate(() => {
    addPedestrianActivityMarker({ type: "pedestrian", name: "p", lat: 40.4, lon: -3.7 });
    addParkContextMarker({ type: "park", name: "k", lat: 40.4, lon: -3.7 });
    addMarker({ type: "heat", name: "h", lat: 40.4, lon: -3.7, utci: 22 });
    const ctor = (g) => { let c = null; g.eachLayer((l) => { c = l.constructor === L.CircleMarker; }); return c; };
    return { pedestrian: ctor(groups.pedestrian), park: ctor(groups.park), heat: ctor(groups.heat) };
  });
  assert.deepEqual(plain, { pedestrian: true, park: true, heat: true });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("silhouettes are pairwise distinguishable at the real size, including the weak pairs", async () => {
  const { page, ctx } = await open();
  await plantRow(page);
  const masks = await readMasks(page);
  const N = masks.bike.N;
  for (let i = 0; i < TYPES.length; i++) {
    for (let j = i + 1; j < TYPES.length; j++) {
      const [a, b] = [TYPES[i], TYPES[j]];
      const x = minXor(masks[a].sil, masks[b].sil, N);
      // The weakest measured pair (BiciMAD circle vs diamond) differs by 12 px;
      // a floor of 10 catches a geometry regression without posing as a perception model.
      assert.ok(x >= 10, `${a}/${b} differ by only ${x} px after best alignment`);
    }
  }
  await ctx.close();
});

test("every shape keeps visible fill and the #150 dark outline", async () => {
  const { page, ctx } = await open();
  await plantRow(page);
  const masks = await readMasks(page);
  for (const t of TYPES) {
    const m = masks[t];
    assert.ok(count(m.fill) >= 12, `${t} fill ${count(m.fill)} px`);
    assert.ok(inradius(m.fill, m.N) >= 2, `${t} fill inradius`);
    assert.ok(count(m.rim) >= 20, `${t} outline ${count(m.rim)} px`);
    assert.deepEqual(m.style, { color: "#16222f", weight: 1.5, opacity: 1 }, `${t} keeps the #150 outline`);
  }
  await ctx.close();
});

test("tooltip, hit-testing and lens shading still work on a shaped marker", async () => {
  const { page, ctx, errors } = await open();
  await plantRow(page);
  const r = await page.evaluate(() => {
    let m = null;
    groups.museum.eachLayer((l) => { if (l._p) m = l; });
    const tip = m.getTooltip() && String(m.getTooltip().getContent());
    const centre = m._point;
    return { tip, hitCentre: m._containsPoint(centre), hitFar: m._containsPoint(centre.add([30, 0])), isInstance: m instanceof L.CircleMarker };
  });
  assert.match(r.tip, /Synthetic museum/);
  assert.equal(r.hitCentre, true);
  assert.equal(r.hitFar, false);
  assert.equal(r.isInstance, true);

  // Outside the active lens the marker is faded, but it must still be drawn as a triangle.
  const shaded = await page.evaluate(() => {
    const c = centerOf(active);
    const far = { type: "museum", name: "Far museum", lat: c.lat + 0.05, lon: c.lon };
    groups.museum.clearLayers();
    const m = addMarker(far);
    shadeMarkersOutsideActiveLens();
    map.setView([far.lat, far.lon], 17, { animate: false });
    return { opacity: m.options.opacity, weight: m.options.weight, fillOpacity: m.options.fillOpacity };
  });
  assert.deepEqual(shaded, { opacity: 0.2, weight: 0.7, fillOpacity: 0.1 });
  await page.waitForTimeout(600);
  const faded = await page.evaluate(() => {
    let m = null;
    groups.museum.eachLayer((l) => { m = l; });
    const r = m._renderer, g = r._container.getContext("2d", { willReadFrequently: true });
    const x0 = Math.round(m._point.x - r._bounds.min.x - 12), y0 = Math.round(m._point.y - r._bounds.min.y - 12);
    const px = g.getImageData(x0, y0, 24, 24).data;
    let n = 0, top = 0, bottom = 0;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (px[(y * 24 + x) * 4 + 3] >= 20) { n++; if (y < 12) top++; else bottom++; }
    return { n, top, bottom };
  });
  assert.ok(faded.n > 0, "faded marker is still drawn");
  assert.ok(faded.bottom > faded.top, "faded marker keeps the upward-triangle silhouette (wider at the base)");
  assert.deepEqual(errors, []);
  await ctx.close();
});

// Leaflet sizes the hit area and the partial-redraw rectangle from the circle. A polygon's
// vertices and stroke joins reach past it, so those must be covered for polygons only.
test("polygon hit area and bounds cover every visible pixel and extremity; BiciMAD stays native", async () => {
  const { page, ctx, errors } = await open();
  await plantRow(page);
  const r = await page.evaluate((types) => {
    const out = {};
    for (const t of types) {
      let m = null;
      groups[t].eachLayer((l) => { if (l._p) m = l; });
      const rd = m._renderer, g = rd._container.getContext("2d", { willReadFrequently: true });
      const N = 32, x0 = Math.round(m._point.x - rd._bounds.min.x - N / 2), y0 = Math.round(m._point.y - rd._bounds.min.y - N / 2);
      const px = g.getImageData(x0, y0, N, N).data;
      const b = m._pxBounds;
      let drawn = 0, unhit = 0, outsideBounds = 0, far = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const a = px[(y * N + x) * 4 + 3];
        if (a === 0) continue;
        // pixel centre in layer coordinates
        const p = L.point(x0 + x + 0.5 + rd._bounds.min.x, y0 + y + 0.5 + rd._bounds.min.y);
        drawn++;
        if (!b.contains(p)) outsideBounds++;
        if (a >= 128 && !m._containsPoint(p)) unhit++;
        far = Math.max(far, p.distanceTo(m._point));
      }
      // hit-area size against the circle Leaflet would have used
      let polyHits = 0, circleHits = 0;
      const native = m._radius + m._clickTolerance();
      for (let dy = -9; dy <= 9; dy += 0.25) for (let dx = -9; dx <= 9; dx += 0.25) {
        if (m._containsPoint(m._point.add([dx, dy]))) polyHits++;
        if (Math.hypot(dx, dy) <= native) circleHits++;
      }
      // just inside each vertex must hit; 2 px beyond the stroked vertex must not
      const shape = m.options.markerShape;
      let vertexMiss = 0, overreach = 0;
      if (shape && shape.points) {
        const rr = Math.max(Math.round(m._radius), 1), tol = m._clickTolerance() + 0.75;
        shape.points.forEach(([vx, vy]) => {
          const d = Math.hypot(vx, vy) * rr, ux = vx / Math.hypot(vx, vy), uy = vy / Math.hypot(vx, vy);
          if (!m._containsPoint(m._point.add([ux * (d - 0.3), uy * (d - 0.3)]))) vertexMiss++;
          if (m._containsPoint(m._point.add([ux * (d + tol + 2), uy * (d + tol + 2)]))) overreach++;
        });
      }
      out[t] = { native: m.constructor === L.CircleMarker, drawn, unhit, outsideBounds, far: +far.toFixed(2), halfBounds: b.getSize().x / 2, ratio: +(polyHits / circleHits).toFixed(2), vertexMiss, overreach };
    }
    return out;
  }, TYPES);
  for (const t of ["stay", "rail", "museum", "info"]) {
    assert.ok(r[t].drawn > 0, `${t} drawn`);
    assert.equal(r[t].unhit, 0, `${t}: every opaque pixel must be hit-testable`);
    assert.equal(r[t].outsideBounds, 0, `${t}: every drawn pixel must be inside the redraw bounds (far ${r[t].far}px, half-bounds ${r[t].halfBounds}px)`);
    assert.equal(r[t].vertexMiss, 0, `${t}: a point just inside each vertex must hit`);
    assert.equal(r[t].overreach, 0, `${t}: no hit target 2px beyond the stroked vertex`);
    assert.ok(r[t].ratio <= 1.5, `${t}: hit area ${r[t].ratio}x the old circle must stay proportionate`);
  }
  assert.equal(r.bike.native, true, "BiciMAD keeps native CircleMarker bounds and hit-testing");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a style change redraws a polygon without stale pixels at its extremities", async () => {
  const { page, ctx, errors } = await open();
  await plantRow(page);
  const r = await page.evaluate(async () => {
    const frames = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    // Leaflet repaints on the next animation frame; under load that can take longer, so wait for the
    // expected state (bounded). A stale extremity never clears, so a real defect still fails afterwards.
    const settle = async (m, done) => {
      const t0 = performance.now();
      for (;;) { await frames(); const s = read(m); if (done(s) || performance.now() - t0 > 2000) return s; }
    };
    const read = (m) => {
      const rd = m._renderer, g = rd._container.getContext("2d", { willReadFrequently: true });
      const N = 32, x0 = Math.round(m._point.x - rd._bounds.min.x - N / 2), y0 = Math.round(m._point.y - rd._bounds.min.y - N / 2);
      const px = g.getImageData(x0, y0, N, N).data;
      let maxAlpha = 0, n = 0;
      for (let i = 0; i < N * N; i++) { const a = px[i * 4 + 3]; if (a) n++; maxAlpha = Math.max(maxAlpha, a); }
      return { maxAlpha, n };
    };
    const out = {};
    for (const t of ["museum", "info", "rail", "stay"]) {
      let m = null;
      groups[t].eachLayer((l) => { if (l._p) m = l; });
      const before = await settle(m, (v) => v.maxAlpha === 255), halfBefore = m._pxBounds.getSize().x / 2;
      // the lens-shading style: faint and thinner outline
      m.setStyle({ opacity: 0.2, fillOpacity: 0.1, weight: 0.7 });
      const faded = await settle(m, (v) => v.n > 0 && v.maxAlpha <= 90), halfThin = m._pxBounds.getSize().x / 2;
      m.setStyle({ opacity: 1, fillOpacity: 0.86, weight: MARKER_OUTLINE_WEIGHT });
      const back = await settle(m, (v) => v.maxAlpha === 255);
      const rr = Math.max(Math.round(m._radius), 1), shape = m.options.markerShape;
      out[t] = {
        before, faded, back, halfBefore, halfThin, halfBack: m._pxBounds.getSize().x / 2,
        needBefore: markerShapeReach(shape, rr, MARKER_OUTLINE_WEIGHT), needThin: markerShapeReach(shape, rr, 0.7),
      };
    }
    return out;
  });
  for (const [t, v] of Object.entries(r)) {
    // 0.2 outline opacity on a transparent canvas is alpha ~51; a surviving full-opacity extremity would be 255.
    assert.ok(v.faded.maxAlpha <= 90, `${t}: stale opaque pixels left after fading (max alpha ${v.faded.maxAlpha})`);
    assert.ok(v.faded.n > 0, `${t}: faded marker still drawn`);
    assert.ok(v.halfBefore + 1e-6 >= v.needBefore && v.halfThin + 1e-6 >= v.needThin, `${t}: bounds after each style change cover the stroked reach (${v.halfBefore}/${v.needBefore.toFixed(2)}, ${v.halfThin}/${v.needThin.toFixed(2)})`);
    assert.ok(v.halfThin < v.halfBefore, `${t}: bounds follow the thinner outline (${v.halfBefore} -> ${v.halfThin})`);
    assert.equal(v.halfBack, v.halfBefore, `${t}: bounds restored with the outline`);
    assert.equal(v.back.n, v.before.n, `${t}: restoring the style redraws the identical silhouette`);
    assert.equal(v.back.maxAlpha, 255);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("without a canvas renderer the marker falls back to Leaflet's circle instead of drawing on a missing context", async () => {
  const { page, ctx, errors } = await open();
  const d = await page.evaluate(() => {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:0;top:0;width:200px;height:200px;visibility:hidden";
    document.body.append(el);
    const m2 = L.map(el, { preferCanvas: false }).setView([40.4, -3.7], 16);
    const mk = createOperationalMarker([40.4, -3.7], { radius: 4, color: "#16222f", fillColor: "#3da8ff", weight: 1.5, opacity: 1, fillOpacity: 0.78 }, "stay").addTo(m2);
    const pathData = mk._path && mk._path.getAttribute("d");
    m2.remove();
    el.remove();
    return pathData;
  });
  assert.match(d, /a/i, "SVG path is the native arc circle");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("rail legend dots carry the same silhouette as the map markers and keep colour, labels and toggles", async () => {
  const { page, ctx } = await open();
  const dots = await page.evaluate((types) => types.map((t) => {
    const dot = document.querySelector(`.layer-left > .dot-${t}`);
    const row = dot.closest(".layer");
    const toggle = row.querySelector(`input[data-layer="${t}"]`);
    const hex = LAYER_COLOR[t];
    const want = `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
    return {
      t,
      shape: dot.dataset.markerShape,
      clip: dot.style.clipPath.replace(/\s+/g, ""),
      expectedClip: markerShapeClipPath(t).replace(/\s+/g, ""),
      mapShape: OPERATIONAL_MARKER_SHAPES[t].name,
      fillOk: getComputedStyle(dot).backgroundColor === want,
      hasLabel: row.textContent.trim().length > 0,
      hasToggle: !!toggle,
    };
  }), TYPES);
  for (const d of dots) {
    assert.equal(d.shape, APPROVED[d.t], `${d.t} legend shape`);
    assert.equal(d.shape, d.mapShape, `${d.t} legend vs map table`);
    assert.equal(d.clip, d.expectedClip, `${d.t} clip-path`);
    assert.ok(d.fillOk, `${d.t} legend colour unchanged`);
    assert.ok(d.hasLabel && d.hasToggle, `${d.t} label and toggle intact`);
  }
  const untouched = await page.evaluate(() => ["pedestrian", "park", "licence", "heat"].map((t) => {
    const dot = document.querySelector(`.layer-left > .dot-${t}`);
    return dot ? !dot.classList.contains("dot-shaped") && dot.style.clipPath === "" : true;
  }));
  assert.deepEqual(untouched, [true, true, true, true], "unrelated legend dots are not reshaped");
  await ctx.close();
});

test.after(async () => { await browser.close(); server.close(); });
