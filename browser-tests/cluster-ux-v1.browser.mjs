import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// UX-V1 (#149) — cluster chip contract. Measures computed styles of the real
// `.poi-cluster` chips against FLAT stand-in backgrounds (#ededed / #262626);
// it does NOT assess real CARTO or Esri imagery (see
// research/lens_ux_cluster_149 for the per-pixel measurement). It deliberately
// does NOT assert the issue's cluster:marker salience ratio, which is
// arithmetically unsatisfiable while the weakest marker is ~1.2:1 (#150).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".geojson": "application/geo+json", ".png": "image/png", ".svg": "image/svg+xml" };
const FIXTURE = JSON.stringify((() => {
  const layers = { stay: [], bike: [] };
  for (const [type, lat0] of [["stay", 40.4], ["bike", 40.412]]) {
    for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) {
      layers[type].push({ id: `${type}-${i}-${k}`, name: `Fixture ${type} ${i}${k}`, lat: lat0 + k * 0.0006, lon: -3.72 + i * 0.012 + k * 0.0006 });
    }
  }
  return { layers };
})());

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const target = path.resolve(ROOT, p === "/" ? "index.html" : p.slice(1));
  if (!target.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (e, c) => { if (e) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(c); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

async function open(appearance, { reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 }, colorScheme: appearance, reducedMotion });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript((a) => { try { localStorage.setItem("madrid-lens-appearance", a); } catch (_) { /* ignore */ } }, appearance);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname.endsWith("/data/runtime_poi.json")) return route.fulfill({ contentType: "application/json", body: FIXTURE });
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof map !== "undefined");
  await page.evaluate(() => { map.setView([40.408, -3.70], 14, { animate: false }); return 0; });
  await page.waitForFunction(() => document.querySelectorAll(".cluster-stay").length > 0 && document.querySelectorAll(".cluster-bike").length > 0);
  return { page, ctx, errors };
}

for (const appearance of ["light", "dark"]) {
  test(`${appearance}: stay and bike clusters differ in a non-colour property`, async () => {
    const { page, ctx, errors } = await open(appearance);
    const r = await page.evaluate(() => {
      const g = (t) => {
        const e = document.querySelector(`.poi-cluster.cluster-${t}`);
        const b = getComputedStyle(e, "::before");
        return { mask: b.maskImage || b.webkitMaskImage, w: b.width };
      };
      return { stay: g("stay"), bike: g("bike") };
    });
    assert.notEqual(r.stay.mask, "none");
    assert.notEqual(r.bike.mask, "none");
    assert.notEqual(r.stay.mask, r.bike.mask, "glyph masks must differ between categories");
    assert.equal(r.stay.w, r.bike.w);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test(`${appearance}: count >=4.5:1 on its surface; chip findable (>=3:1) on flat light and dark tiles`, async () => {
    const { page, ctx } = await open(appearance);
    const out = await page.evaluate(() => {
      const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
      const CR = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { rgb: v.slice(0, 3), a: v.length > 3 ? v[3] : 1 }; };
      const over = (c, bg) => [0, 1, 2].map((i) => c.a * c.rgb[i] + (1 - c.a) * bg[i]);
      const res = [];
      for (const t of ["stay", "bike"]) {
        const e = document.querySelector(`.poi-cluster.cluster-${t}`), s = getComputedStyle(e);
        const txt = parse(getComputedStyle(e.querySelector("span")).color), fill = parse(s.backgroundColor);
        const halo = parse(s.boxShadow.match(/rgba?\([^)]+\)/)[0]), edge = parse(s.borderTopColor);
        const row = { t, count: [], boundary: {} };
        for (const [name, bg] of [["light", [237, 237, 237]], ["dark", [38, 38, 38]]]) {
          const fc = over(fill, bg);
          row.count.push(CR(txt.rgb, fc));
          row.boundary[name] = Math.max(CR(over(edge, bg), bg), CR(over(halo, bg), bg), CR(fc, bg));
        }
        res.push(row);
      }
      return res;
    });
    for (const row of out) {
      for (const c of row.count) assert.ok(c >= 4.5, `${appearance}/${row.t} count ${c}`);
      for (const [bg, v] of Object.entries(row.boundary)) assert.ok(v >= 3, `${appearance}/${row.t} on ${bg} boundary ${v}`);
    }
    await ctx.close();
  });

  test(`${appearance}: no Dark-only literal in the cluster chip; chrome resolves through tokens`, async () => {
    const css = fs.readFileSync(path.join(ROOT, "css/app.css"), "utf8");
    const rules = css.split("\n").filter((l) => /^\.(poi-cluster|cluster-)/.test(l)).join("\n");
    assert.ok(!/rgba\(8,16,27/.test(rules), "the Dark panel literal must not return");
    assert.match(rules, /var\(--map-cluster-surface\)/);
    const { page, ctx } = await open(appearance);
    const surface = await page.evaluate(() => getComputedStyle(document.querySelector(".poi-cluster")).backgroundColor);
    if (appearance === "light") assert.equal(surface, "rgb(255, 255, 255)");
    else assert.notEqual(surface, "rgb(255, 255, 255)");
    await ctx.close();
  });
}

test("keyboard + click: accessible name, Enter and click zoom in", async () => {
  const { page, ctx } = await open("light");
  const info = await page.evaluate(() => {
    const icon = document.querySelector(".cluster-bike").parentElement;
    return { role: icon.getAttribute("role"), tab: icon.getAttribute("tabindex"), label: icon.getAttribute("aria-label"), count: icon.textContent.trim() };
  });
  assert.equal(info.role, "button");
  assert.equal(info.tab, "0");
  assert.match(info.label, new RegExp(`^${info.count} BiciMAD, grouped\\. Activate to zoom`));
  const before = await page.evaluate(() => map.getZoom());
  await page.focus(".poi-cluster-icon:has(.cluster-bike)");
  await page.keyboard.press("Enter");
  await page.waitForFunction((z) => map.getZoom() > z, before);
  await page.evaluate(() => { map.setView([40.408, -3.70], 14, { animate: false }); return 0; });
  await page.waitForFunction(() => document.querySelectorAll(".cluster-stay").length > 0);
  await page.click(".poi-cluster-icon:has(.cluster-stay)", { force: true });
  await page.waitForFunction((z) => map.getZoom() > z, 14);
  await ctx.close();
});

test("cluster counts equal the visible source records; layer colours untouched", async () => {
  const { page, ctx } = await open("light");
  const r = await page.evaluate(() => ({
    sum: [...document.querySelectorAll(".poi-cluster span")].reduce((s, e) => s + Number(e.textContent), 0),
    singles: Object.values(map._layers).filter((l) => l._p && !l._cluster && (l._p.type === "stay" || l._p.type === "bike")).length,
    colours: LAYER_COLOR,
  }));
  assert.equal(r.sum + r.singles, 24);
  assert.deepEqual(r.colours, { museum: "#9d72ff", info: "#c79cff", stay: "#3da8ff", bike: "#54e2b5", rail: "#ffd166", pedestrian: "#ff7aa2", park: "#70dea4", licence: "#c0794f" });
  await ctx.close();
});

test("reduced motion: no chip transition", async () => {
  const { page, ctx } = await open("light", { reducedMotion: "reduce" });
  const t = await page.evaluate(() => getComputedStyle(document.querySelector(".poi-cluster")).transitionDuration);
  assert.ok(parseFloat(t) <= 0.001, `transition ${t}`);
  await ctx.close();
});

test.after(async () => { await browser.close(); server.close(); });
