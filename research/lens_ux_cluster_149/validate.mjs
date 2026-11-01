// UX-V1 #149 — rendered-imagery validation of cluster chips (before/after).
//
//   CARTO_BASEMAP_KEY=<key from env or secret store> node validate.mjs \
//     --poi <runtime_poi.json> --before <checkout of origin/main> --after <checkout under test> \
//     --shots <dir outside the repo> --out <metrics.json> [--basemaps satellite,light,dark]
//
// Differences from experiment.mjs (which used synthetic flat tiles and a
// max(border,halo,fill) blanket):
//   * Real tiles only. satellite = Esri World Imagery (live). light/dark = CARTO
//     light_all / dark_all, ONLY if CARTO_BASEMAP_KEY is set in the environment;
//     otherwise they are recorded NOT_MEASURED, never substituted. The key is read
//     from the environment, used only inside the page's tile URLs, and is never
//     written to any file, log, or screenshot metadata (the recorded host list is
//     hostnames only).
//   * Contrast is measured on RENDERED pixels (chips shown vs the same view with
//     chips hidden), per component, not combined: outer halo vs background,
//     border vs background, fill vs background, count text vs fill, glyph vs fill.
//     A "union" figure is reported but labelled as NOT a WCAG verdict.
//
// This measures pixels. It is not human validation.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { chromium, webkit } from "playwright";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
// --prod <url>: PRODUCTION MODE. Both sides load the live site untouched (its own runtime
// config, its own POI snapshot, its own CARTO key, which this script never reads, logs or
// stores). "after" differs only by Playwright route interception, inside this isolated
// browser session, of css/app.css and js/app.js answered from the local --after checkout.
const PROD = flag("prod", null);
const POI = PROD ? null : fs.readFileSync(flag("poi"));
const ROOTS = PROD ? { after: path.resolve(flag("after")) } : { before: path.resolve(flag("before")), after: path.resolve(flag("after")) };
const SHOTS = path.resolve(flag("shots"));
const OUT = flag("out");
const BASEMAPS = String(flag("basemaps", "satellite,light,dark")).split(",");
const KEY = process.env.CARTO_BASEMAP_KEY || "";
const ENGINE = flag("engine", "chromium");
// --variant V1|V2|V3: append research/lens_ux_cluster_149/edge_variants/<name>.css to the intercepted AFTER app.css
// (experiment only; production css/app.css is never edited by this flag). No flag = control (candidate B as shipped on the branch).
const VARIANT = flag("variant", "control");
const VARIANT_CSS = VARIANT === "control" ? "" : fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "edge_variants", `${VARIANT}.css`), "utf8");
const CROPS = flag("crops", null);
const MATRIX = flag("matrix", "full"); // full | quick
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".geojson": "application/geo+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
function serve(root) {
  const s = http.createServer((q, r) => {
    const p = decodeURIComponent(new URL(q.url, "http://x").pathname);
    const t = path.resolve(root, p === "/" ? "index.html" : p.slice(1));
    if (!t.startsWith(root)) { r.writeHead(403).end(); return; }
    fs.readFile(t, (e, c) => e ? r.writeHead(404).end() : r.writeHead(200, { "content-type": MIME[path.extname(t)] || "application/octet-stream" }).end(c));
  });
  return new Promise((res) => s.listen(0, "127.0.0.1", () => res(s)));
}
const servers = PROD ? {} : { before: await serve(ROOTS.before), after: await serve(ROOTS.after) };
// Any URL-embedded tile key that could reach an error string is masked; the key itself is never read here.
const scrub = (t) => String(t).replace(/([?&]key=)[^&\s"']+/gi, "$1[redacted]");
let browser = null; // a fresh browser per capture: one long-lived Chromium died after ~6 satellite captures on this machine

const SITES = {
  dense: { lat: 40.4168, lon: -3.7038, label: "Sol / Puerta del Sol" },
  park: { lat: 40.4153, lon: -3.6845, label: "Retiro" },
  sparse: { lat: 40.347, lon: -3.692, label: "Villaverde" },
};
const VIEWPORTS = { "1366x768": [1366, 768], "1440x900": [1440, 900], "1920x1080": [1920, 1080], "820x1180": [820, 1180], "390x844": [390, 844] };

async function open(which, { vp, appearance, basemap, site, zoom, lang = "en" }) {
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, colorScheme: appearance, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; const poiHash = { v: null };
  page.on("pageerror", (e) => errors.push(scrub(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(scrub(m.text())); });
  await page.addInitScript(([a, l]) => { try { localStorage.setItem("madrid-lens-appearance", a); localStorage.setItem("madrid-lens-language", l); } catch (_) { /* ignore */ } }, [appearance, lang]);
  if (PROD) {
    // Only these two responses are replaced, and only inside this browser context.
    if (which === "after") {
      await page.route(/\/css\/app\.css(\?|$)/, (r) => r.fulfill({ contentType: "text/css", body: fs.readFileSync(path.join(ROOTS.after, "css/app.css"), "utf8") + "\n" + VARIANT_CSS }));
      await page.route(/\/js\/app\.js(\?|$)/, (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(ROOTS.after, "js/app.js")) }));
    }
    page.on("response", async (r) => { if (/\/data\/runtime_poi\.json/.test(r.url())) { try { poiHash.v = createHash("sha256").update(await r.body()).digest("hex"); } catch (_) { /* ignore */ } } });
  } else {
    await page.route("**/js/runtime-config.js*", (r) => r.fulfill({ contentType: "text/javascript", body: `window.RUNTIME_CONFIG=${JSON.stringify({ CARTO_BASEMAP_KEY: KEY })};` }));
    await page.route("**/data/runtime_poi.json*", (r) => r.fulfill({ contentType: "application/json", body: POI }));
  }
  await page.goto(PROD || `http://127.0.0.1:${servers[which].address().port}/`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof map !== "undefined" && document.querySelector(".leaflet-container"), null, { timeout: 60000 });
  if (lang !== "en") { await page.evaluate((l) => { const s = document.getElementById("languageSelect"); s.value = l; s.dispatchEvent(new Event("change", { bubbles: true })); return 0; }, lang); }
  await page.evaluate((b) => { const s = document.getElementById("basemapSelect"); s.value = b; s.dispatchEvent(new Event("change", { bubbles: true })); return 0; }, basemap);
  await page.evaluate(([la, lo, z]) => { map.setView([la, lo], z, { animate: false }); return 0; }, [site.lat, site.lon, zoom]);
  // wait for tiles to settle
  await page.waitForFunction(() => { const t = [...document.querySelectorAll("img.leaflet-tile")]; return t.length > 0 && t.every((i) => i.complete); }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const tileInfo = await page.evaluate(() => {
    const t = [...document.querySelectorAll("img.leaflet-tile")]; const h = {};
    t.forEach((i) => { try { const x = new URL(i.src).host; h[x] = (h[x] || 0) + 1; } catch (_) { /* ignore */ } });
    // style path only (e.g. /rastertiles/light_all): the query string, which may carry a key, is never read into the record
    const sp = [...new Set(t.map((i) => { try { return new URL(i.src).pathname.split("/").slice(0, 3).join("/"); } catch (_) { return null; } }).filter(Boolean))];
    return { count: t.length, loaded: t.filter((i) => i.complete && i.naturalWidth > 0).length, hosts: h, stylePaths: sp, attribution: (document.querySelector(".leaflet-control-attribution") || {}).textContent };
  });
  return { page, ctx, errors, tileInfo, poiHash };
}

// Pixel analysis -------------------------------------------------------------
async function analyse(page, label) {
  const chips = await page.evaluate(() => [...document.querySelectorAll(".poi-cluster")].filter((c) => { const r = c.getBoundingClientRect(); if (!(r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight)) return false; const cx = r.left + r.width / 2, cy = r.top + r.height / 2, k = r.width * 0.3; /* top-most at centre and 4 inner points: excludes chips covered by panels/header/controls */ return [[0, 0], [k, 0], [-k, 0], [0, k], [0, -k]].every(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy)?.closest(".poi-cluster-icon") === c.closest(".poi-cluster-icon")); }).map((c) => {
    const r = c.getBoundingClientRect(), sp = c.querySelector("span").getBoundingClientRect(), s = getComputedStyle(c);
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2, spanTop: sp.top, spanH: sp.height, cls: [...c.classList].find((x) => x.startsWith("cluster-")),
      textColor: getComputedStyle(c.querySelector("span")).color, glyphColor: s.color, hasGlyph: getComputedStyle(c, "::before").content !== "none" && getComputedStyle(c, "::before").content !== "normal",
      outside: c.parentElement.classList.contains("outside-lens"), n: c.textContent.trim(),
      cid: (() => { const l = Object.values(map._layers).find((x) => x._icon && x._icon === c.closest(".poi-cluster-icon")); return l && l._cluster ? `${l._p.type}:${l._cluster.lat.toFixed(5)},${l._cluster.lon.toFixed(5)}:${l._cluster.count}` : null; })(),
      edgeCol: s.borderTopColor, fillCol: s.backgroundColor, op: parseFloat(getComputedStyle(c.parentElement).opacity) };
  }));
  const s1 = await page.screenshot({ type: "png" });
  await page.addStyleTag({ content: ".poi-cluster-icon{visibility:hidden!important}" });
  await page.waitForTimeout(150);
  const s2 = await page.screenshot({ type: "png" });
  await page.evaluate(() => { for (const s of [...document.querySelectorAll("style")]) if (/poi-cluster-icon\{visibility:hidden/.test(s.textContent)) s.remove(); });
  const stats = await page.evaluate(async ({ a, b, chips }) => {
    const load = async (b64) => { const i = new Image(); i.src = "data:image/png;base64," + b64; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(i, 0, 0); return g; };
    const G1 = await load(a), G2 = await load(b);
    const px = (g, x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= g.canvas.width || y >= g.canvas.height) return null; const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
    const CR = (p, q) => { const x = L(p), y = L(q); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); return m[1].split(/[,\s/]+/).filter(Boolean).map(Number).slice(0, 3); };
    const inOther = (x, y, i) => chips.some((c, j) => j !== i && Math.hypot(x - c.cx, y - c.cy) < c.r + 5);
    // Ideal 11x11 glyph masks, rasterised by the browser from the very SVG the CSS mask uses (same 11px antialiasing).
    const masks = {};
    for (const cls of ["cluster-stay", "cluster-bike"]) {
      const el = document.querySelector(".poi-cluster." + cls); if (!el) continue;
      const m = getComputedStyle(el).getPropertyValue("--cluster-glyph").match(/url\("(.*)"\)/); if (!m) continue;
      const img = new Image(); img.src = m[1]; try { await img.decode(); } catch (_) { continue; }
      const cv = document.createElement("canvas"); cv.width = 11; cv.height = 11; const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 11, 11);
      const d = g.getImageData(0, 0, 11, 11).data; masks[cls] = Array.from({ length: 121 }, (_, k) => d[k * 4 + 3] / 255);
    }
    const pearson = (a, b) => { const n = a.length; const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let k = 0; k < n; k++) { sab += (a[k] - ma) * (b[k] - mb); saa += (a[k] - ma) ** 2; sbb += (b[k] - mb) ** 2; } return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0; };
    const mk = () => ({ multiInk: [], multi: [], bgL: [], gOwn: [], gOther: [], gOK: [], haloB: [], borderB: [], halo: [], border: [], fill: [], haloVsBorder: [], count: [], glyphIdeal: [], glyphCover: [], glyphMax: [], union: [] });
    const perChip = []; const accs = { inLens: mk(), outsideLens: mk() }; const nchips = { inLens: 0, outsideLens: 0 }; let nOcc = 0;
    chips.forEach((c, i) => {
      const loc = { multi: [], halo: [], border: [], ink: [] };
      const acc = accs[c.outside ? "outsideLens" : "inLens"]; nchips[c.outside ? "outsideLens" : "inLens"]++;
      const ringH = [], ringB = [], ringHB = [], ringHBand = [], ringBBand = [], inkFlag = [];
      // Band sampling tolerates +-1px rasterisation/rounding error of a 1.5-2px ring: strongest pixel inside the component's own radial band.
      const band = (lo, hi, bgp) => { let m = 0; for (let rr = lo; rr <= hi + 1e-9; rr += 0.25) { const q = px(G1, c.cx + Math.cos(rad0) * (c.r + rr), c.cy + Math.sin(rad0) * (c.r + rr)); if (q) m = Math.max(m, CR(q, bgp)); } return m; };
      let rad0 = 0;
      for (let a = 0; a < 360; a += 10) {
        const rad = a * Math.PI / 180; rad0 = rad; const ux = Math.cos(rad), uy = Math.sin(rad);
        const at = (rr) => [c.cx + ux * rr, c.cy + uy * rr];
        if ([at(c.r + 4), at(c.r + 0.8), at(c.r - 1)].some(([x, y]) => inOther(x, y, i))) continue;
        const bg = px(G2, ...at(c.r + 4)), halo = px(G1, ...at(c.r + 0.8)), border = px(G1, ...at(c.r - 1));
        if (!bg || !halo || !border) continue;
        // Dash classification for out-of-Lens chips by RENDERED COLOUR, not by contrast: the border pixel is "ink" when it is closer
        // to the expected inked colour (op*edge + (1-op)*bg) than to the expected gap colour (op*fill-over-bg + (1-op)*bg).
        { const pc = (s2) => { const m2 = String(s2).match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { rgb: m2.slice(0, 3), a: m2.length > 3 ? m2[3] : 1 }; };
          const e = pc(c.edgeCol), f = pc(c.fillCol), op = c.op || 1;
          const inkC = [0, 1, 2].map((k) => op * (e.a * e.rgb[k] + (1 - e.a) * bg[k]) + (1 - op) * bg[k]);
          const gapC = [0, 1, 2].map((k) => op * (f.a * f.rgb[k] + (1 - f.a) * bg[k]) + (1 - op) * bg[k]);
          const d2 = (u, v2) => Math.hypot(u[0] - v2[0], u[1] - v2[1], u[2] - v2[2]);
          inkFlag.push(!c.outside || d2(border, inkC) < d2(border, gapC)); }
        { const hb = band(0.2, 1.3, bg), bb = band(-1.9, -0.4, bg); loc.multi.push(Math.max(hb, bb)); loc.halo.push(hb); loc.border.push(bb); loc.ink.push(inkFlag[inkFlag.length - 1]); acc.multi.push(Math.max(hb, bb)); if (inkFlag[inkFlag.length - 1]) acc.multiInk.push(Math.max(hb, bb)); acc.bgL.push(L(bg)); }
        ringHBand.push(band(0.2, 1.3, bg)); ringBBand.push(band(-1.9, -0.4, bg)); ringH.push(CR(halo, bg)); ringB.push(CR(border, bg)); ringHB.push(CR(halo, border));
      }
      // Out-of-Lens chips have a DASHED border (a deliberate structural cue): only the
      // inked half of the ring carries the border, so use the inked samples (>= chip median).
      const ink = (arr) => (c.outside ? arr.filter((_, k) => inkFlag[k]) : arr);
      { const pct = (a) => a.length ? +(100 * a.filter((x) => x < 3).length / a.length).toFixed(1) : null; const inkOnly = (a) => a.filter((_, k) => loc.ink[k]);
        perChip.push({ cid: c.cid, state: c.outside ? "outsideLens" : "inLens", cx: Math.round(c.cx), cy: Math.round(c.cy), samples: loc.multi.length, inkSamples: loc.ink.filter(Boolean).length,
          multi_below3_pct: pct(loc.multi), multi_ink_below3_pct: pct(inkOnly(loc.multi)), halo_below3_pct: pct(loc.halo), border_ink_below3_pct: pct(inkOnly(loc.border)), gap_fraction_pct: loc.ink.length ? +(100 * loc.ink.filter((x) => !x).length / loc.ink.length).toFixed(1) : null }); }
      acc.haloB.push(...ringHBand); acc.borderB.push(...ink(ringBBand)); acc.halo.push(...ringH); acc.border.push(...ink(ringB)); acc.haloVsBorder.push(...ringHB);
      for (let k = 0; k < ringH.length; k++) acc.union.push(Math.max(ringH[k], ringB[k] ?? 0));
      if (chips.some((o, j) => j !== i && Math.hypot(o.cx - c.cx, o.cy - c.cy) < o.r + c.r)) { nOcc++; return; } // content occluded by a neighbouring chip (pre-existing overlap)
      const fill = px(G1, c.cx - c.r * 0.62, c.cy); const bgc = px(G2, c.cx, c.cy);
      if (!fill) return;
      if (bgc) acc.fill.push(CR(fill, bgc));
      // rendered count: strongest-contrast pixel inside the count span vs the rendered fill
      let mxT = 0; for (let yy = c.spanTop; yy < c.spanTop + c.spanH; yy++) for (let xx = c.cx - 8; xx < c.cx + 8; xx++) { const p = px(G1, xx, yy); if (p) mxT = Math.max(mxT, CR(p, fill)); }
      acc.count.push(mxT);
      if (c.hasGlyph) {
        acc.glyphIdeal.push(CR(parse(c.glyphColor), fill));
        let hit = 0, tot = 0, mx = 0;
        for (let yy = c.spanTop - 11; yy < c.spanTop; yy++) for (let xx = c.cx - 5.5; xx < c.cx + 5.5; xx++) {
          const p = px(G1, xx, yy); if (!p) continue; const k = CR(p, fill); tot++; if (k >= 3) hit++; if (k > mx) mx = k;
        }
        acc.glyphCover.push(tot ? hit / tot : 0); acc.glyphMax.push(mx);
        // Shape recognition at the real rendered 11px size (screening, NOT human validation): correlate the rendered
        // glyph box (|dL| from the fill, best of +-1px alignment) with each category's ideal mask; correct if own > other.
        const lf = L(fill), own = masks[c.cls], oth = masks[c.cls === "cluster-stay" ? "cluster-bike" : "cluster-stay"];
        if (own && oth) {
          let bo = -1, bt = -1;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x0 = Math.round(c.cx - 5.5) + dx, y0 = Math.round(c.spanTop) - 11 + dy, v = [];
            for (let yy = 0; yy < 11; yy++) for (let xx = 0; xx < 11; xx++) { const p = px(G1, x0 + xx, y0 + yy); v.push(p ? Math.abs(L(p) - lf) : 0); }
            bo = Math.max(bo, pearson(v, own)); bt = Math.max(bt, pearson(v, oth));
          }
          acc.gOwn.push(bo); acc.gOther.push(bt); acc.gOK.push(bo > bt ? 1 : 0);
        }
      }
    });
    const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
    const sum = (arr) => ({ n: arr.length, min: q(arr, 0), p05: q(arr, 0.05), p50: q(arr, 0.5), pctBelow3: arr.length ? +(100 * arr.filter((x) => x < 3).length / arr.length).toFixed(1) : null, pctBelow4_5: arr.length ? +(100 * arr.filter((x) => x < 4.5).length / arr.length).toFixed(1) : null });
    // Single-ring feasibility: for a ring of relative luminance Lr, the fraction of the ACTUAL adjacent basemap samples it
    // clears at 3:1. best = the most favourable Lr; dual = one near-black ring AND one white ring (either clears).
    const feas = (bgL) => {
      if (!bgL.length) return null; const ok = (lr, b) => (Math.max(lr, b) + 0.05) / (Math.min(lr, b) + 0.05) >= 3;
      let best = 0, bestLr = 0; for (let lr = 0; lr <= 1.0001; lr += 0.01) { const f = bgL.filter((b) => ok(lr, b)).length / bgL.length; if (f > best) { best = f; bestLr = lr; } }
      return { samples: bgL.length, bg_luminance_p05_p50_p95: [q(bgL, 0.05), q(bgL, 0.5), q(bgL, 0.95)].map((x) => +x.toFixed(3)), best_single_ring_pct_cleared: +(100 * best).toFixed(1), best_ring_luminance: +bestLr.toFixed(2), black_ring_pct: +(100 * bgL.filter((b) => ok(0, b)).length / bgL.length).toFixed(1), white_ring_pct: +(100 * bgL.filter((b) => ok(1, b)).length / bgL.length).toFixed(1), black_or_white_pct: +(100 * bgL.filter((b) => ok(0, b) || ok(1, b)).length / bgL.length).toFixed(1) };
    };
    const mean = (a) => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(3) : null;
    const rep = (acc, n) => ({ chips: n, multi_tone_band_vs_bg_PROPOSED_CRITERION_NOT_AUTOPASS: sum(acc.multi), multi_tone_band_inked_samples_only: sum(acc.multiInk), bg_ring_feasibility: feas(acc.bgL), glyph_recognition_11px: { n: acc.gOK.length, own_mask_corr_mean: mean(acc.gOwn), other_mask_corr_mean: mean(acc.gOther), correct_pct: acc.gOK.length ? +(100 * acc.gOK.reduce((s, x) => s + x, 0) / acc.gOK.length).toFixed(1) : null }, halo_vs_bg: sum(acc.halo), halo_band_vs_bg: sum(acc.haloB), border_band_vs_bg: sum(acc.borderB), border_vs_bg: sum(acc.border), fill_vs_bg: sum(acc.fill), halo_vs_border: sum(acc.haloVsBorder),
      union_halo_or_border_vs_bg_NOT_A_WCAG_VERDICT: sum(acc.union), count_rendered_core_vs_fill: sum(acc.count), glyph_ideal_vs_fill: sum(acc.glyphIdeal),
      glyph_rendered_max_vs_fill: sum(acc.glyphMax), glyph_pixel_coverage_ge3_median_pct: acc.glyphCover.length ? +(100 * q(acc.glyphCover, 0.5)).toFixed(1) : null });
    return { perChip, chips: chips.length, chipsWithContentOccludedByNeighbour: nOcc, inLens: rep(accs.inLens, nchips.inLens), outsideLens: rep(accs.outsideLens, nchips.outsideLens) };
  }, { a: s1.toString("base64"), b: s2.toString("base64"), chips });
  return { stats, s1 };
}

const results = { tool: "research/lens_ux_cluster_149/validate.mjs", measured_at: new Date().toISOString(), engine: ENGINE,
  carto_key_present: PROD ? "not read by this script (production page supplies its own)" : Boolean(KEY), poi_sha256: POI ? createHash("sha256").update(POI).digest("hex") : null, mode: PROD ? "production-interception" : "local", prod_url: PROD, rows: [], notMeasured: [] };
const run = async (which, cfg, opts = {}) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const firstLine = (e) => String(e).split(/\r?\n/)[0];
    try { return await runOnce(which, cfg, opts); } catch (e) { console.error(`retry ${attempt} ${which} ${cfg.siteKey} z${cfg.zoom}: ${firstLine(e)}`); if (attempt === 3) results.notMeasured.push({ ...cfg, site: undefined, which, reason: "capture failed 3x: " + firstLine(e) }); }
  }
};
const runOnce = async (which, cfg, { keepShot = true } = {}) => {
  browser = await (ENGINE === "webkit" ? webkit : chromium).launch();
  try { await runBody(which, cfg, { keepShot }); } finally { await browser.close().catch(() => {}); }
};
const runBody = async (which, cfg, { keepShot = true } = {}) => {
  if (!PROD && (cfg.basemap === "light" || cfg.basemap === "dark") && !KEY) { results.notMeasured.push({ ...cfg, which, reason: "CARTO_BASEMAP_KEY not provided in environment" }); return; }
  const { page, ctx, errors, tileInfo, poiHash } = await open(which, cfg);
  const { stats, s1 } = await analyse(page, `${which}`);
  const name = `${which}_${cfg.vp.join("x")}_${cfg.appearance}_${cfg.basemap}_${cfg.siteKey}_z${cfg.zoom}${cfg.lang && cfg.lang !== "en" ? "_" + cfg.lang : ""}.png`;
  let file = null, sha = null;
  if (CROPS && cfg.siteKey === "dense" && cfg.zoom === 14 && cfg.vp[0] === 1440) {
    fs.mkdirSync(CROPS, { recursive: true });
    await page.screenshot({ path: path.join(CROPS, `${VARIANT}_${cfg.basemap}_${cfg.appearance}.png`), clip: { x: 640, y: 330, width: 420, height: 260 } });
  }
  if (keepShot) { file = path.join(SHOTS, name); fs.writeFileSync(file, s1); sha = createHash("sha256").update(s1).digest("hex"); }
  results.rows.push({ which, variant: VARIANT, viewport: cfg.vp.join("x"), appearance: cfg.appearance, basemap: cfg.basemap, site: cfg.siteKey, zoom: cfg.zoom, lang: cfg.lang || "en", tiles: tileInfo, poiSha256: poiHash.v, errors, stats, screenshot: file, sha256: sha, deviceScaleFactor: 1, browser: ENGINE });
  console.error(`${which} ${name}: chips=${stats.chips} (in ${stats.inLens.chips}) tiles ${tileInfo.loaded}/${tileInfo.count} OUT: halo<3 ${stats.outsideLens.halo_vs_bg.pctBelow3}% border<3 ${stats.outsideLens.border_vs_bg.pctBelow3}% count p05 ${stats.outsideLens.count_rendered_core_vs_fill.p05} | IN: halo<3 ${stats.inLens.halo_vs_bg.pctBelow3}% border<3 ${stats.inLens.border_vs_bg.pctBelow3}% count p05 ${stats.inLens.count_rendered_core_vs_fill.p05}`);
  await ctx.close();
};

const PART = flag("part", "vp:1440x900"); // vp:<WxH> | extra   (short foreground segments; never one multi-hour run)
const flush = () => { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n"); };
if (PART === "edge") {
  // Bounded edge experiment: AFTER only, 1440x900, Light appearance sites x (z12,z14) + Dark appearance Sol z14.
  for (const basemap of BASEMAPS) {
    for (const [siteKey, site] of Object.entries(SITES)) for (const zoom of [12, 14]) { await run("after", { vp: VIEWPORTS["1440x900"], appearance: "light", basemap, siteKey, site, zoom }); flush(); }
    await run("after", { vp: VIEWPORTS["1440x900"], appearance: "dark", basemap, siteKey: "dense", site: SITES.dense, zoom: 14 }); flush();
  }
} else if (PART.startsWith("vp:")) {
  const vpk = PART.slice(3);
  for (const basemap of BASEMAPS) for (const [siteKey, site] of Object.entries(SITES)) {
    for (const zoom of [12, 14]) for (const which of ["before", "after"]) { await run(which, { vp: VIEWPORTS[vpk], appearance: "light", basemap, siteKey, site, zoom }); flush(); }
    // z17: clustering is off at z>=16, so only the individual-marker view is captured (no chip stats exist).
    await run("after", { vp: VIEWPORTS[vpk], appearance: "light", basemap, siteKey, site, zoom: 17 }); flush();
  }
} else {
  const b0 = BASEMAPS[0];
  for (const zoom of [14]) for (const which of ["before", "after"]) { await run(which, { vp: VIEWPORTS["1440x900"], appearance: "dark", basemap: b0, siteKey: "dense", site: SITES.dense, zoom }); flush(); }
  for (const vpk of ["820x1180", "390x844"]) for (const which of ["before", "after"]) { await run(which, { vp: VIEWPORTS[vpk], appearance: "light", basemap: b0, siteKey: "dense", site: SITES.dense, zoom: 14 }); flush(); }
  await run("after", { vp: VIEWPORTS["1440x900"], appearance: "light", basemap: b0, siteKey: "dense", site: SITES.dense, zoom: 14, lang: "es" }); flush();
}
results.attribution = "Esri World Imagery: Tiles (c) Esri - Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community. CARTO basemaps (when measured): (c) OpenStreetMap contributors (c) CARTO. Captures are not committed.";
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
Object.values(servers).forEach((s) => s.close());
console.error("wrote", OUT, "rows", results.rows.length, "notMeasured", results.notMeasured.length);
