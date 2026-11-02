// UX-V1 #149 — cluster render/interaction cost, BASE vs PROD roots.
//   node perf.mjs --poi <runtime_poi.json> --root <dir> --out <json> [--runs 9]
// Loopback only, headless Chromium, synthetic flat tiles. Relative numbers on one
// machine under one load; NOT a device benchmark (see AC-P0-12 for that gate).
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { chromium } from "playwright";
const a = process.argv.slice(2), f = (n, d) => { const i = a.indexOf(`--${n}`); return i < 0 ? d : a[i + 1]; };
const ROOT = path.resolve(f("root")), POI = fs.readFileSync(f("poi")), OUT = f("out"), RUNS = +f("runs", 9);
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".geojson": "application/geo+json", ".png": "image/png", ".svg": "image/svg+xml" };
const srv = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, "http://x").pathname); const t = path.resolve(ROOT, p === "/" ? "index.html" : p.slice(1));
  fs.readFile(t, (e, c) => e ? r.writeHead(404).end() : r.writeHead(200, { "content-type": MIME[path.extname(t)] || "application/octet-stream" }).end(c)); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const b = await chromium.launch(); const res = [];
for (let i = 0; i < RUNS; i++) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  await p.route("**/*", (r) => { const u = new URL(r.request().url()); if (u.hostname !== "127.0.0.1") return r.abort();
    if (u.pathname.endsWith("/data/runtime_poi.json")) return r.fulfill({ contentType: "application/json", body: POI }); return r.continue(); });
  await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: "load" });
  await p.waitForFunction(() => typeof map !== "undefined" && document.querySelectorAll(".poi-cluster").length > 20); await p.waitForTimeout(1500);
  res.push(await p.evaluate(async () => {
    const t0 = performance.now(); rebuildDenseLayers(); const rebuildMs = performance.now() - t0;
    const nodes = document.querySelectorAll(".leaflet-marker-pane *").length, chips = document.querySelectorAll(".poi-cluster").length;
    const zoom = []; for (let k = 0; k < 3; k++) { const s = performance.now(); map.setView([40.415, -3.692], 15, { animate: false }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); map.setView([40.415, -3.692], 14, { animate: false }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); zoom.push((performance.now() - s) / 2); }
    let long = 0, frames = 0, last = performance.now(); const step = (n) => { frames++; if (n - last > 33) long++; last = n; };
    await new Promise((res2) => { let i = 0; const tick = (n) => { step(n); map.panBy([i % 2 ? -40 : 40, 0], { animate: false }); if (++i < 120) requestAnimationFrame(tick); else res2(); }; requestAnimationFrame(tick); });
    const hs = []; const el = document.querySelector(".poi-cluster-icon"); for (let k = 0; k < 20; k++) { const s = performance.now(); el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); getComputedStyle(el.firstChild).boxShadow; hs.push(performance.now() - s); el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); }
    return { rebuildMs, nodes, chips, zoomMsPerStep: zoom.reduce((x, y) => x + y) / zoom.length, panLongFramesPer120: long, hoverMs: hs.reduce((x, y) => x + y) / hs.length, heapMB: (performance.memory?.usedJSHeapSize || 0) / 1048576 };
  }));
  await ctx.close();
}
const med = (k) => { const s = res.map((r) => r[k]).sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2); };
const out = { root: ROOT, runs: RUNS, median: Object.fromEntries(Object.keys(res[0]).map((k) => [k, med(k)])), raw: res };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); console.error(JSON.stringify(out.median)); await b.close(); srv.close();
