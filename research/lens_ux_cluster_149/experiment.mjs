// UX-V1 #149 — local, deterministic measurement of cluster-chip candidates.
//
//   node research/lens_ux_cluster_149/experiment.mjs --poi <runtime_poi.json> --out <file.json> \
//        [--cand BASE,A,B,C | PROD] [--shots <dir>]
//
// WHAT THIS IS: a local harness (loopback server, headless Chromium) that renders
// the real app code against real POI data and measures the cluster chips.
// BASE = the unmodified CSS shipped by the checkout; A/B/C = scratch candidates
// from candidates.css; PROD = the CSS currently in css/app.css, measured with the
// same code path (use after implementing).
//
// BASEMAP PROVENANCE, stated plainly because it bounds every number:
//   * "light" and "dark" basemaps are SYNTHETIC FLAT TILES (#ededed / #262626),
//     served for the CARTO URL pattern with a placeholder key. They are NOT
//     CARTO Positron / Dark Matter imagery (that needs the production key, which
//     this harness deliberately never reads). #ededed is the second most common
//     measured Positron colour (see the G0 palette); real Positron has detail.
//   * "satellite" is REAL Esri World Imagery fetched live. Its attribution must
//     travel with any capture (written to the metadata).
//
// Nothing here is human validation. Colour-vision simulations are screening only.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const POI = flag("poi", null);
const OUT = flag("out", null);
const SHOTS = flag("shots", null);
const CANDS = String(flag("cand", "BASE,A,B,C")).split(",");
const VIEWPORT = String(flag("viewport", "1440x900")).split("x").map(Number);
if (!POI || !OUT) { console.error("--poi and --out are required"); process.exit(2); }

const FLAT = { light: [237, 237, 237], dark: [38, 38, 38] };
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".geojson": "application/geo+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

// 1x1 PNG encoder is overkill; a 256x256 flat PNG is built with node zlib.
import zlib from "node:zlib";
function flatPng(rgb) {
  const w = 256, row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: w }, () => row));
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const TILES = { light: flatPng(FLAT.light), dark: flatPng(FLAT.dark) };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const target = path.resolve(ROOT, p === "/" ? "index.html" : p.slice(1));
  if (!target.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (e, c) => {
    if (e) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(c);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE_URL = `http://127.0.0.1:${server.address().port}/`;
const poiBuf = fs.readFileSync(POI);

const browser = await chromium.launch();
const candidateCss = fs.readFileSync(path.join(HERE, "candidates.css"), "utf8");

async function openPage({ appearance, basemap, cand, view, locale = "en", size = VIEWPORT, reducedMotion = "no-preference" }) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, colorScheme: appearance, reducedMotion, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(([a, loc]) => {
    try { localStorage.setItem("madrid-lens-appearance", a); localStorage.setItem("madrid-lens-language", loc); localStorage.setItem("madrid-lens-tutorial", "done"); } catch (_) { /* ignore */ }
  }, [appearance, locale]);
  await page.route("**/js/runtime-config.js*", (r) => r.fulfill({ contentType: "text/javascript", body: 'window.RUNTIME_CONFIG={CARTO_BASEMAP_KEY:"SYNTHETIC-LOCAL-NOT-A-KEY"};' }));
  await page.route("**/data/runtime_poi.json*", (r) => r.fulfill({ contentType: "application/json", body: poiBuf }));
  await page.route(/basemaps\.cartocdn\.com\/rastertiles\/(light_all|dark_all)\//, (r) =>
    r.fulfill({ contentType: "image/png", body: /dark_all/.test(r.request().url()) ? TILES.dark : TILES.light }));
  await page.route(/tile\.openstreetmap\.org/, (r) => r.abort());
  await page.goto(BASE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof map !== "undefined" && document.querySelector(".leaflet-container"));
  if (cand !== "BASE" && cand !== "PROD") {
    await page.addStyleTag({ content: candidateCss });
    await page.evaluate((c) => { document.documentElement.dataset.cand = c; }, cand);
  }
  await page.evaluate(([b]) => { const s = document.getElementById("basemapSelect"); s.value = b; s.dispatchEvent(new Event("change", { bubbles: true })); }, [basemap]);
  await page.evaluate(([v]) => { map.setView([v.lat, v.lon], v.zoom, { animate: false }); return 0; }, [view]);
  await page.waitForFunction(() => document.querySelectorAll(".poi-cluster, .leaflet-interactive").length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(basemap === "satellite" ? 4000 : 1200);
  return { page, ctx, errors };
}

const DEFAULT_VIEW = { lat: 40.415, lon: -3.692, zoom: 14 };

// ---- in-page measurement ---------------------------------------------------
async function measure(page, shotDir, tag) {
  return await page.evaluate(async ({ FLATS }) => {
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
    const CR = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { rgb: v.slice(0, 3), a: v.length > 3 ? v[3] : 1 }; };
    const comp = (c, bg) => [0, 1, 2].map((i) => c.a * c.rgb[i] + (1 - c.a) * bg[i]);
    const chips = [...document.querySelectorAll(".poi-cluster")];
    const byType = {}; chips.forEach((c) => { const t = [...c.classList].find((x) => x.startsWith("cluster-")); byType[t] = (byType[t] || 0) + 1; });
    const mapRect = document.querySelector(".leaflet-container").getBoundingClientRect();
    let box = 0; chips.forEach((c) => { const b = c.getBoundingClientRect(); box += b.width * b.height; });
    const probe = (sel) => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e), b = getComputedStyle(e, "::before"), sp = getComputedStyle(e.querySelector("span"));
      return { backgroundColor: s.backgroundColor, color: s.color, borderColor: s.borderColor, borderStyle: s.borderStyle, borderWidth: s.borderWidth, borderRadius: s.borderRadius,
        boxShadow: s.boxShadow, width: s.width, height: s.height, fontSize: sp.fontSize, fontWeight: sp.fontWeight, flexDirection: s.flexDirection,
        pseudoContent: b.content, pseudoMask: b.maskImage || b.webkitMaskImage, pseudoWidth: b.width, spanColor: sp.color }; };
    const stay = probe(".poi-cluster.cluster-stay"), bike = probe(".poi-cluster.cluster-bike");
    const NONCOLOR = ["borderStyle", "borderWidth", "borderRadius", "width", "height", "fontSize", "fontWeight", "flexDirection", "pseudoContent", "pseudoMask", "pseudoWidth"];
    const nonColourDiff = stay && bike ? NONCOLOR.filter((p) => stay[p] !== bike[p]) : null;
    const allDiff = stay && bike ? Object.keys(stay).filter((p) => stay[p] !== bike[p]) : null;
    return { chips: chips.length, byType, coveragePctUpperBound: +(100 * box / (mapRect.width * mapRect.height)).toFixed(1), stay, bike, nonColourDiff, allDiff };
  }, { FLATS: null });
}

// Boundary contrast: render chips hidden to read the true background, then
// compare the chip's outward-facing edge colours against it, pixel by pixel.
async function boundaryContrast(page) {
  const chipInfo = await page.evaluate(() => [...document.querySelectorAll(".poi-cluster")].map((c) => {
    const r = c.getBoundingClientRect(), s = getComputedStyle(c);
    const sh = s.boxShadow; // first shadow = outer halo "color 0 0 0 1.5px" (candidates) or glow (base)
    const shadows = sh.split(/,(?![^(]*\))/).map((x) => x.trim());
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2, border: s.borderTopColor, bw: parseFloat(s.borderTopWidth), shadows, fill: s.backgroundColor,
      cls: [...c.classList].find((x) => x.startsWith("cluster-")) };
  }));
  await page.addStyleTag({ content: ".poi-cluster-icon{visibility:hidden!important}", });
  await page.waitForTimeout(150);
  const bgPng = await page.screenshot({ type: "png" });
  await page.evaluate(() => { for (const s of [...document.querySelectorAll("style")]) if (/poi-cluster-icon\{visibility:hidden/.test(s.textContent)) s.remove(); });
  const res = await page.evaluate(async ({ png, chipInfo }) => {
    const img = new Image(); img.src = "data:image/png;base64," + png; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
    const CR = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { rgb: v.slice(0, 3), a: v.length > 3 ? v[3] : 1 }; };
    const over = (c, bg) => [0, 1, 2].map((i) => c.a * c.rgb[i] + (1 - c.a) * bg[i]);
    const perChip = [];
    for (const ch of chipInfo) {
      // outward-facing layers, outermost first: hard box-shadow rings (spread>0, no blur), then the border.
      const layers = [];
      for (const sh of ch.shadows) { const m = sh.match(/(rgba?\([^)]+\))\s+0px\s+0px\s+(\d*\.?\d+)px\s+(\d*\.?\d+)px(?!\s*inset)/) ; if (m && parseFloat(m[2]) === 0 && parseFloat(m[3]) > 0 && !/inset/.test(sh)) layers.push({ c: parse(m[1]), w: parseFloat(m[3]) }); }
      layers.sort((a, b) => 0);
      const edgeW = ch.bw; const border = parse(ch.border);
      const ringW = layers.reduce((s, l) => s + l.w, 0);
      const samples = [];
      for (let a = 0; a < 360; a += 10) {
        const rad = a * Math.PI / 180, rr = ch.r + ringW + 2.5;
        const x = Math.round(ch.cx + Math.cos(rad) * rr), y = Math.round(ch.cy + Math.sin(rad) * rr);
        if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) continue;
        const d = g.getImageData(x, y, 1, 1).data; const bg = [d[0], d[1], d[2]];
        // outermost ring that actually has alpha; fall back to border
        let best = CR(over(border, bg), bg);
        let halo = null; if (layers.length) halo = CR(over(layers[0].c, bg), bg);
        const fl = parse(ch.fill); samples.push({ edge: best, halo, fill: CR(over(fl, bg), bg) });
      }
      perChip.push({ cls: ch.cls, fill_c: samples.map((s) => s.fill), edge: samples.map((s) => s.edge), halo: samples.map((s) => s.halo).filter((x) => x != null), fill: ch.fill, ringW, bw: edgeW });
    }
    return perChip;
  }, { png: bgPng.toString("base64"), chipInfo });
  return res;
}

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
function summarise(perChip) {
  // Boundary-detectability per sample = better of (border vs bg, halo vs bg); a viewer can find the shape via either.
  const per = []; for (const c of perChip) for (let i = 0; i < c.edge.length; i++) per.push(Math.max(c.edge[i], c.halo[i] ?? 0, c.fill_c[i]));
  return { samples: per.length, min: pct(per, 0), p05: pct(per, 0.05), p50: pct(per, 0.5), pctBelow3: +(100 * per.filter((x) => x < 3).length / Math.max(1, per.length)).toFixed(1) };
}

// ---- count/glyph vs chip surface (opaque-composited over the true background) ----
async function textContrast(page, bgRgb) {
  return await page.evaluate((bg) => {
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
    const CR = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { rgb: v.slice(0, 3), a: v.length > 3 ? v[3] : 1 }; };
    const out = {};
    for (const t of ["stay", "bike"]) {
      const e = document.querySelector(`.poi-cluster.cluster-${t}`); if (!e) continue;
      const s = getComputedStyle(e), fill = parse(s.backgroundColor), txt = parse(getComputedStyle(e.querySelector("span")).color);
      const fc = [0, 1, 2].map((i) => fill.a * fill.rgb[i] + (1 - fill.a) * bg[i]);
      // worst case over the translucent surface: bg varies, so evaluate on the supplied bg only (flat) — satellite handled separately.
      out[t] = { count: +CR(txt.rgb, fc).toFixed(2), surfaceAlpha: fill.a, surfaceRgb: fc.map(Math.round) };
    }
    return out;
  }, bgRgb);
}

// ---- category identity under grayscale / CVD (screening only) ------------------
const MATS = {
  grayscale: [[0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
async function categoryProbe(page, bg) {
  // Same count in both chips so any difference is category identity, not text.
  const png = await page.evaluate(async ({ bg }) => {
    document.querySelectorAll("#__fx").forEach((n) => n.remove());
    const wrap = document.createElement("div"); wrap.id = "__fx";
    wrap.style.cssText = `position:fixed;left:40px;top:40px;width:200px;height:80px;z-index:99999;background:rgb(${bg.join(",")});display:flex;gap:30px;align-items:center;justify-content:center`;
    wrap.innerHTML = ["stay", "bike"].map((t) => `<div class="poi-cluster-icon" style="width:38px;height:38px"><div class="poi-cluster cluster-${t}"><span>12</span></div></div>`).join("");
    document.body.appendChild(wrap);
    return true;
  }, { bg });
  const el = await page.$("#__fx");
  const buf = await el.screenshot({ type: "png" });
  const res = await page.evaluate(async ({ b64, MATS }) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const half = (i) => { const w = 38, x0 = i === 0 ? img.width / 2 - 15 - w : img.width / 2 + 15, y0 = img.height / 2 - w / 2; return g.getImageData(Math.round(x0), Math.round(y0), w, w).data; };
    const a = half(0), b = half(1);
    const out = {};
    const L = (v) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]); };
    const sim = (d, i, M) => { const lr = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; const l = [lr(d[i]), lr(d[i + 1]), lr(d[i + 2])]; return M.map((row) => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))); };
    for (const [name, M] of [["normal", null], ...Object.entries(MATS)]) {
      let sum = 0, n = 0, maxd = 0, big = 0;
      for (let i = 0; i < a.length; i += 4) {
        const pa = M ? sim(a, i, M) : [a[i], a[i + 1], a[i + 2]].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
        const pb = M ? sim(b, i, M) : [b[i], b[i + 1], b[i + 2]].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
        const la = 0.2126 * pa[0] + 0.7152 * pa[1] + 0.0722 * pa[2], lb = 0.2126 * pb[0] + 0.7152 * pb[1] + 0.0722 * pb[2];
        const d = Math.abs(la - lb); sum += d; n++; if (d > maxd) maxd = d; if (d > 0.15) big++;
      }
      // meanLumDiff: average relative-luminance difference over the 38x38 chip; pxBig: % of pixels differing by >0.15 luminance
      out[name] = { meanLumDiff: +(sum / n).toFixed(4), pctPixelsDiffering: +(100 * big / n).toFixed(1) };
    }
    return out;
  }, { b64: buf.toString("base64"), MATS });
  await page.evaluate(() => document.getElementById("__fx")?.remove());
  return res;
}

// ---- run -------------------------------------------------------------------------
const results = { tool: "research/lens_ux_cluster_149/experiment.mjs", measured_at: new Date().toISOString(),
  checkout_head: (await import("node:child_process")).execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
  poi_sha256: createHash("sha256").update(poiBuf).digest("hex"),
  viewport: VIEWPORT.join("x"), view: DEFAULT_VIEW,
  basemap_provenance: { light: "SYNTHETIC flat #ededed (NOT CARTO Positron)", dark: "SYNTHETIC flat #262626 (NOT CARTO Dark Matter)",
    satellite: "REAL Esri World Imagery, live fetch; attribution: Tiles (c) Esri - Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community" },
  configs: [] };

for (const cand of CANDS) for (const appearance of ["light", "dark"]) for (const basemap of ["light", "dark", "satellite"]) {
  const { page, ctx, errors } = await openPage({ appearance, basemap, cand, view: DEFAULT_VIEW });
  const m = await measure(page);
  const perChip = await boundaryContrast(page);
  const bgRgb = basemap === "satellite" ? [128, 128, 128] : FLAT[basemap];
  const text = await textContrast(page, bgRgb);
  const cat = await categoryProbe(page, bgRgb);
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${cand}_${appearance}_${basemap}_${VIEWPORT.join("x")}.png`) }); }
  const per = {}; for (const t of ["cluster-stay", "cluster-bike"]) per[t] = summarise(perChip.filter((c) => c.cls === t));
  results.configs.push({ cand, appearance, basemap, chips: m.chips, byType: m.byType, coveragePctUpperBound: m.coveragePctUpperBound,
    nonColourDifferingProps: m.nonColourDiff, allDifferingProps: m.allDiff, boundaryContrast: summarise(perChip), boundaryByType: per,
    countVsSurface: text, categoryScreen: cat, consoleErrors: errors,
    satelliteNote: basemap === "satellite" ? "count/surface figures use a mid-grey stand-in only for translucent surfaces; boundary figures are real per-pixel" : undefined });
  await ctx.close();
  console.error(`${cand} ${appearance}/${basemap}: chips=${m.chips} boundary p05=${summarise(perChip).p05} <3:${summarise(perChip).pctBelow3}% nonColour=[${m.nonColourDiff}]`);
}
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
await browser.close(); server.close();
console.error("wrote", OUT);
