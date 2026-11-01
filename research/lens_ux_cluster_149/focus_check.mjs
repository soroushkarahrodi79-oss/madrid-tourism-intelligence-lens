// UX-V1 #149 — narrowly scoped focus-indicator check on REAL tiles (production page + route-intercepted
// css/app.css, js/app.js, js/shell-copy.js from this checkout; the deployed site is never modified).
//
//   node focus_check.mjs --prod <url> --after <checkout> --out <json> [--basemaps light,dark,satellite] [--shots dir]
//
// "Keyboard visibility" is measured, not inferred from CSS:
//   1. a real Tab sequence reaches a cluster and the focused element matches :focus-visible;
//   2. the RENDERED pixels change around the chip when it is focused (vs the same chip unfocused, same view), and the
//      changed pixels reach >= 3:1 against the adjacent unfocused colour.
// A computed `outline-style: solid` proves nothing by itself: it can be clipped, covered, or invisible on the tile.
// Two indicators exist on a focused cluster and are measured SEPARATELY, each isolated by a CSS override inside the test
// session only (tooltips are hidden in these screenshots so they cannot cover the ring; the tooltip is itself an extra cue):
//   A. the app-wide rule `:where(button,…,[role="button"]):focus-visible` on the marker element (square ring on its box);
//   B. this PR's chip outline `.poi-cluster-icon:focus .poi-cluster{outline:3px solid var(--map-cluster-edge);offset 3px}`.
// Both are SINGLE-tone rings, so a 95 % rule is infeasible on Esri (see feasibility.cjs). No key is read or recorded.
import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
const argv = process.argv.slice(2); const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const SHOTS = flag("shots", null);
const PROD = flag("prod"), AFTER = path.resolve(flag("after")), OUT = flag("out"); const BASEMAPS = String(flag("basemaps", "light,dark,satellite")).split(",");
const SCRUB = (t) => String(t).replace(/([?&]key=)[^&\s"']+/gi, "$1[redacted]");
const NAMES = { light: "CARTO Positron", dark: "CARTO Dark Matter", satellite: "Esri World Imagery" };
const results = { tool: "focus_check.mjs", mode: "production-interception", prod_url: PROD, measured_at: new Date().toISOString(), configs: [] };
const ISOLATE = { both: "", A: ".poi-cluster{outline:none!important}", B: ".poi-cluster-icon{outline:none!important}" };

async function one(basemap, appearance) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: appearance, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", (e) => errors.push(SCRUB(e)));
    await page.addInitScript((a) => { try { localStorage.setItem("madrid-lens-appearance", a); } catch (_) { /* ignore */ } }, appearance);
    for (const [re, f, t] of [[/\/css\/app\.css(\?|$)/, "css/app.css", "text/css"], [/\/js\/app\.js(\?|$)/, "js/app.js", "text/javascript"], [/\/js\/shell-copy\.js(\?|$)/, "js/shell-copy.js", "text/javascript"]])
      await page.route(re, (r) => r.fulfill({ contentType: t, body: fs.readFileSync(path.join(AFTER, f)) }));
    await page.goto(PROD, { waitUntil: "load" });
    await page.waitForFunction(() => typeof map !== "undefined" && document.querySelector(".leaflet-container"), null, { timeout: 60000 });
    await page.evaluate((b) => { const s = document.getElementById("basemapSelect"); s.value = b; s.dispatchEvent(new Event("change", { bubbles: true })); const c = centerOf("A"); map.setView([c.lat, c.lon], 14, { animate: false }); return 0; }, basemap);
    await page.waitForFunction(() => { const t = [...document.querySelectorAll("img.leaflet-tile")]; return t.length > 0 && t.every((i) => i.complete); }, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const tiles = await page.evaluate(() => { const t = [...document.querySelectorAll("img.leaflet-tile")]; const h = {}; t.forEach((i) => { try { const x = new URL(i.src).host; h[x] = (h[x] || 0) + 1; } catch (_) { /* ignore */ } }); return { count: t.length, loaded: t.filter((i) => i.complete && i.naturalWidth > 0).length, hosts: h }; });

    // 1) a real Tab sequence reaches a cluster
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); document.body.focus(); });
    let tabs = 0, reached = null;
    for (; tabs < 160; tabs++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => { const a = document.activeElement; return a && a.classList && a.classList.contains("poi-cluster-icon") ? { focusVisible: a.matches(":focus-visible"), tooltipShown: [...document.querySelectorAll(".leaflet-tooltip")].some((t) => t.querySelector("b") && t.querySelector("br")) } : null; });
      if (reached) { tabs++; break; }
    }
    const tabResult = reached ? { reachedByTab: true, tabPresses: tabs, ...reached } : { reachedByTab: false, tabPresses: tabs };
    await page.evaluate(() => document.activeElement && document.activeElement.blur());

    // 2) rendered focus indicators per chip
    const chips = await page.evaluate(() => [...document.querySelectorAll(".poi-cluster-icon")].map((icon, idx) => {
      const c = icon.querySelector(".poi-cluster"); const r = c.getBoundingClientRect();
      if (!(r.left >= 30 && r.top >= 30 && r.right <= innerWidth - 30 && r.bottom <= innerHeight - 30)) return null;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, k = r.width * 0.3;
      if (![[0, 0], [k, 0], [-k, 0], [0, k], [0, -k]].every(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy)?.closest(".poi-cluster-icon") === icon)) return null;
      const l = Object.values(map._layers).find((x) => x._icon === icon);
      return { idx, cx, cy, r: r.width / 2, outside: icon.classList.contains("outside-lens"), cid: l && l._cluster ? `${l._p.type}:${l._cluster.lat.toFixed(5)},${l._cluster.lon.toFixed(5)}:${l._cluster.count}` : null };
    }).filter(Boolean));
    const inL = chips.filter((c) => !c.outside).sort((a, b) => (a.cid > b.cid ? 1 : -1)), outL = chips.filter((c) => c.outside).sort((a, b) => (a.cid > b.cid ? 1 : -1)).slice(0, 12);
    const per = [];
    const styleTag = await page.addStyleTag({ content: ".leaflet-tooltip{display:none!important}" });
    for (const ch of [...inL, ...outL]) {
      const clip = { x: Math.round(ch.cx - ch.r - 16), y: Math.round(ch.cy - ch.r - 16), width: Math.round(2 * (ch.r + 16)), height: Math.round(2 * (ch.r + 16)) };
      await page.keyboard.press("Shift"); // keyboard modality so :focus-visible semantics apply to the programmatic focus
      const shots = {}; let info = null;
      await page.evaluate((idx) => document.querySelectorAll(".poi-cluster-icon")[idx].blur(), ch.idx);
      shots.unfocused = await page.screenshot({ type: "png", clip });
      for (const mode of ["both", "A", "B"]) {
        const tag = ISOLATE[mode] ? await page.addStyleTag({ content: ISOLATE[mode] }) : null;
        info = await page.evaluate((idx) => { const icon = document.querySelectorAll(".poi-cluster-icon")[idx]; icon.focus({ preventScroll: true }); const cs = getComputedStyle(icon.querySelector(".poi-cluster")), is = getComputedStyle(icon); return { focusVisible: icon.matches(":focus-visible"), A: `${is.outlineStyle} ${is.outlineWidth} off ${is.outlineOffset} ${is.outlineColor}`, B: `${cs.outlineStyle} ${cs.outlineWidth} off ${cs.outlineOffset} ${cs.outlineColor}` }; }, ch.idx);
        shots[mode] = await page.screenshot({ type: "png", clip });
        await page.evaluate((idx) => document.querySelectorAll(".poi-cluster-icon")[idx].blur(), ch.idx);
        if (tag) await tag.evaluate((el) => el.remove());
      }
      if (SHOTS && per.filter((q) => q.state === (ch.outside ? "outsideLens" : "inLens")).length === 0) {
        fs.mkdirSync(SHOTS, { recursive: true }); const nm = `${basemap}_${appearance}_${ch.outside ? "out" : "in"}`;
        for (const k of ["unfocused", "both", "A", "B"]) fs.writeFileSync(path.join(SHOTS, `${nm}_${k}.png`), shots[k]);
      }
      const others = chips.filter((o) => o.idx !== ch.idx).map((o) => ({ x: o.cx - clip.x, y: o.cy - clip.y, r: o.r }));
      const half = await page.evaluate((idx) => { const r = document.querySelectorAll(".poi-cluster-icon")[idx].getBoundingClientRect(); return r.width / 2; }, ch.idx);
      const offA = parseFloat((info.A.match(/off (-?[0-9.]+)px/) || [])[1] || 0), wA = parseFloat((info.A.match(/solid ([0-9.]+)px/) || [])[1] || 2);
      const m = await page.evaluate(async ({ s, c, others, half, offA, wA }) => {
        const load = async (b64) => { const i = new Image(); i.src = "data:image/png;base64," + b64; await i.decode(); const cv = document.createElement("canvas"); cv.width = i.width; cv.height = i.height; const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(i, 0, 0); return g; };
        const U = await load(s.unfocused), Fb = await load(s.both), Fa = await load(s.A), Fbo = await load(s.B);
        const px = (g, x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= g.canvas.width || y >= g.canvas.height) return null; const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
        const CR = (p, q) => { const x = L(p), y = L(q); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const cx = c.w / 2, cy = c.h / 2; const near = (x, y, pad) => others.some((o) => Math.hypot(x - o.x, y - o.y) < o.r + pad);
        const pct = (a) => a.length ? +(100 * a.filter((x) => x < 3).length / a.length).toFixed(1) : null;
        // B: circular chip outline, r+3..r+6 from the chip edge (mid r+4.5); strict = mid pixel, band = strongest in r+2.5..r+6.5
        const Bs = [], Bb = [], Bvis = [];
        for (let a = 0; a < 360; a += 10) { const t = a * Math.PI / 180, ux = Math.cos(t), uy = Math.sin(t); if ([c.r + 2.5, c.r + 4.5, c.r + 6.5].some((rr) => near(cx + ux * rr, cy + uy * rr, 3))) continue;
          const f = px(Fbo, cx + ux * (c.r + 4.5), cy + uy * (c.r + 4.5)), u = px(U, cx + ux * (c.r + 4.5), cy + uy * (c.r + 4.5)); if (!f || !u) continue; Bs.push(CR(f, u));
          let best = 0, dm = 0; for (let rr = c.r + 2.5; rr <= c.r + 6.5 + 1e-9; rr += 0.25) { const ff = px(Fbo, cx + ux * rr, cy + uy * rr), uu = px(U, cx + ux * rr, cy + uy * rr); if (ff && uu) { best = Math.max(best, CR(ff, uu)); dm = Math.max(dm, Math.hypot(ff[0] - uu[0], ff[1] - uu[1], ff[2] - uu[2])); } } Bb.push(best); Bvis.push(dm > 40 ? 1 : 0); }
        // A: square ring on the marker box: 4 sides x 5 offsets along the side, at the ring's mid-distance; band = +-1 px
        const As = [], Ab = [], Avis = []; const d0 = half + offA + wA / 2;
        for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const tt of [-10, -5, 0, 5, 10]) {
          const sx = nx ? 0 : tt, sy = ny ? 0 : tt; const X = (dd) => cx + nx * dd + sx, Y = (dd) => cy + ny * dd + sy; if (near(X(d0), Y(d0), 3)) continue;
          const f = px(Fa, X(d0), Y(d0)), u = px(U, X(d0), Y(d0)); if (!f || !u) continue; As.push(CR(f, u));
          let best = 0, dm = 0; for (let dd = d0 - 1.2; dd <= d0 + 1.2 + 1e-9; dd += 0.25) { const ff = px(Fa, X(dd), Y(dd)), uu = px(U, X(dd), Y(dd)); if (ff && uu) { best = Math.max(best, CR(ff, uu)); dm = Math.max(dm, Math.hypot(ff[0] - uu[0], ff[1] - uu[1], ff[2] - uu[2])); } } Ab.push(best); Avis.push(dm > 40 ? 1 : 0); }
        // combined, as a keyboard user sees it: per angle, is ANY pixel on the radial line r..r+12 changed vs unfocused by >=3:1 (not a per-ring pass)
        const Cb = []; for (let a = 0; a < 360; a += 10) { const t = a * Math.PI / 180, ux = Math.cos(t), uy = Math.sin(t); if ([c.r + 3, c.r + 6, c.r + 9].some((rr) => near(cx + ux * rr, cy + uy * rr, 3))) continue; let best = 0; for (let rr = c.r + 1.5; rr <= c.r + 12 + 1e-9; rr += 0.5) { const ff = px(Fb, cx + ux * rr, cy + uy * rr), uu = px(U, cx + ux * rr, cy + uy * rr); if (ff && uu) best = Math.max(best, CR(ff, uu)); } Cb.push(best); }
        const v = (a) => a.length ? +(100 * a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : null;
        return { B_chip_outline: { samples: Bs.length, strict_below3_pct: pct(Bs), band_below3_pct: pct(Bb), rendered_change_pct: v(Bvis) }, A_marker_box_ring: { samples: As.length, strict_below3_pct: pct(As), band_below3_pct: pct(Ab), rendered_change_pct: v(Avis) }, combined_any_pixel_below3_pct: pct(Cb), combined_samples: Cb.length };
      }, { s: Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, v.toString("base64")])), c: { w: clip.width, h: clip.height, r: ch.r }, others, half, offA, wA });
      per.push({ cid: ch.cid, state: ch.outside ? "outsideLens" : "inLens", focusVisible: info.focusVisible, A_css: info.A, B_css: info.B, ...m });
    }
    await styleTag.evaluate((el) => el.remove()); await ctx.close();
    return { basemap, basemapName: NAMES[basemap], appearance, tiles, tabResult, chips: per, errors };
  } finally { await browser.close().catch(() => {}); }
}
const mean = (a) => (a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : null);
for (const b of BASEMAPS) for (const a of ["light", "dark"]) {
  let r; for (let k = 1; k <= 3 && !r; k++) { try { r = await one(b, a); } catch (e) { console.error(`retry ${k} ${b}/${a}: ${String(e).split(/\r?\n/)[0]}`); } }
  if (!r) { results.configs.push({ basemap: b, appearance: a, failed: true }); continue; }
  results.configs.push(r); fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const f = (s) => { const c = r.chips.filter((x) => x.state === s); return `${s} n=${c.length} fv ${c.filter((x) => x.focusVisible).length}/${c.length} | A<3 ${mean(c.map((x) => x.A_marker_box_ring.strict_below3_pct))} (vis ${mean(c.map((x) => x.A_marker_box_ring.rendered_change_pct))}) B<3 ${mean(c.map((x) => x.B_chip_outline.strict_below3_pct))}/${mean(c.map((x) => x.B_chip_outline.band_below3_pct))} (vis ${mean(c.map((x) => x.B_chip_outline.rendered_change_pct))}) any<3 ${mean(c.map((x) => x.combined_any_pixel_below3_pct))}`; };
  console.error(`${NAMES[b]}/${a}: tab ${r.tabResult.reachedByTab} (${r.tabResult.tabPresses}, fv ${r.tabResult.focusVisible}, tip ${r.tabResult.tooltipShown}) | ${f("inLens")} | ${f("outsideLens")}`);
}
fs.writeFileSync(OUT, JSON.stringify(results, null, 1)); console.error("wrote", OUT);
