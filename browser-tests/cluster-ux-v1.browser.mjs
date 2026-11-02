import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

// LENS_TEST_BROWSER=webkit runs the same contract in WebKit (Safari engine).
const engine = process.env.LENS_TEST_BROWSER === "webkit" ? webkit : chromium;

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
      layers[type].push({ id: `${type}-${i}-${k}`, name: `Fixture ${type} ${i}${k}`, lat: lat0 + k * 0.0006, lon: -3.72 + i * 0.012 + k * 0.0006, ...(type === "stay" ? { stayKind: i % 2 ? "hostel" : "hotel" } : {}) });
    }
  }
  // Identity-change fixture for the keyboard focus lifecycle: these 6 BiciMAD points are ONE cluster (count 6) at z14,
  // TWO clusters (3 + 3) at z15 and no cluster at z16 (verified against js/clustering.js).
  for (const [j, dx] of [[0, 0], [1, 0.0015]]) for (let k = 0; k < 3; k++) {
    layers.bike.push({ id: `split-${j}-${k}`, name: `Fixture split ${j}${k}`, lat: 40.43 + k * 0.0003, lon: -3.69 + dx + k * 0.0003 });
  }
  return { layers };
})());
const SPLIT_CENTRE = [40.4306, -3.68925]; // centroid of the 6 split points

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const target = path.resolve(ROOT, p === "/" ? "index.html" : p.slice(1));
  if (!target.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (e, c) => { if (e) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(c); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const browser = await engine.launch({ headless: true });

async function open(appearance, { reducedMotion = "no-preference", query = "", forcedColors = "none" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 }, colorScheme: appearance, reducedMotion, ...(forcedColors === "active" ? { forcedColors } : {}) });
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
  await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: "load" });
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

  // Flat-tile REGRESSION GUARD only. The "boundary" figure below is the best of three components (edge ring, halo,
  // fill) against a flat #ededed / #262626 stand-in: it is NOT a per-ring result, NOT a measurement on real
  // CARTO/Esri imagery and NOT a WCAG SC 1.4.11 verdict (see research/lens_ux_cluster_149 for real-tile measurements).
  test(`${appearance}: flat-tile regression guard — count >= 4.5:1 on its surface; best-of-components boundary >= 3:1 (not a WCAG verdict)`, async () => {
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
      for (const [bg, v] of Object.entries(row.boundary)) assert.ok(v >= 3, `${appearance}/${row.t} on ${bg} best-of-components guard ${v} (not a WCAG verdict)`);
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
  assert.equal(r.sum + r.singles, 30);
  assert.deepEqual(r.colours, { museum: "#9d72ff", info: "#c79cff", stay: "#3da8ff", bike: "#54e2b5", rail: "#ffd166", pedestrian: "#ff7aa2", park: "#70dea4", licence: "#c0794f" });
  await ctx.close();
});


test("Space activates a focused cluster like Enter", async () => {
  const { page, ctx } = await open("light");
  const before = await page.evaluate(() => map.getZoom());
  await page.focus(".poi-cluster-icon:has(.cluster-stay)");
  await page.keyboard.press("Space");
  await page.waitForFunction((z) => map.getZoom() > z, before);
  await ctx.close();
});

for (const appearance of ["light", "dark"]) {
  test(`${appearance}: hover, keyboard focus and out-of-Lens states keep the glyph, count and a visible cue`, async () => {
    const { page, ctx } = await open(appearance);
    const s = await page.evaluate(() => {
      const chip = document.querySelector(".poi-cluster-icon.outside-lens .poi-cluster.cluster-bike") || document.querySelector(".poi-cluster.cluster-bike");
      const icon = chip.parentElement;
      const st = getComputedStyle(chip);
      return { outside: icon.classList.contains("outside-lens"), borderStyle: st.borderTopStyle, opacity: getComputedStyle(icon).opacity, glyph: getComputedStyle(chip, "::before").content };
    });
    assert.equal(s.outside, true, "fixture must contain an out-of-Lens cluster");
    assert.equal(s.borderStyle, "dashed");
    assert.ok(parseFloat(s.opacity) >= 0.72);
    assert.notEqual(s.glyph, "none");
    const sel = ".poi-cluster-icon.outside-lens:has(.cluster-bike)";
    const idle = await page.evaluate((q) => getComputedStyle(document.querySelector(q + " .poi-cluster")).boxShadow, sel);
    await page.focus(sel);
    const focused = await page.evaluate((q) => { const c = getComputedStyle(document.querySelector(q + " .poi-cluster")); return { style: c.outlineStyle, width: c.outlineWidth }; }, sel);
    assert.notEqual(focused.style, "none", "focused cluster needs a visible outline");
    assert.ok(parseFloat(focused.width) >= 2);
    await page.hover(sel, { force: true });
    const hovered = await page.evaluate((q) => getComputedStyle(document.querySelector(q + " .poi-cluster")).boxShadow, sel);
    assert.notEqual(hovered, idle, "hover must change the chip");
    await ctx.close();
  });
}

test("ES: count and glyph are not clipped and chip geometry matches EN", async () => {
  const geo = {};
  for (const lang of ["en", "es"]) {
    const { page, ctx } = await open("light", { query: `?lang=${lang}` });
    geo[lang] = await page.evaluate(() => [...document.querySelectorAll(".poi-cluster")].map((c) => { const sp = c.querySelector("span"); return { w: c.offsetWidth, clipped: sp.scrollWidth > sp.clientWidth + 1 || sp.getBoundingClientRect().width > c.clientWidth }; }));
    assert.ok(geo[lang].length > 0);
    assert.ok(geo[lang].every((g) => !g.clipped), `${lang}: count clipped`);
    await ctx.close();
  }
  assert.deepEqual(geo.en.map((g) => g.w), geo.es.map((g) => g.w));
});

// i18n: cluster accessible names and tooltips follow the shell dictionary (K4), at first render AND on switch.
const NAME = {
  en: { bike: /^([0-9]+) BiciMAD, grouped[.] Activate to zoom in and reveal individual points[.]$/, stay: /^([0-9]+) Hotels & stays, grouped[.] Activate to zoom in and reveal individual points[.]$/, note: "Grouped for readability · zoom in to reveal individual points" },
  es: { bike: /^([0-9]+) BiciMAD, agrupados[.] Activa para acercar y ver los puntos individuales[.]$/, stay: /^([0-9]+) Hoteles y alojamientos, agrupados[.] Activa para acercar y ver los puntos individuales[.]$/, note: "Agrupados para facilitar la lectura · acerca el mapa para ver los puntos individuales" },
};
async function clusterNames(page) {
  return page.evaluate(() => {
    const pick = (t) => { const icon = document.querySelector(`.cluster-${t}`).parentElement; return { label: icon.getAttribute("aria-label"), count: icon.textContent.trim() }; };
    return { bike: pick("bike"), stay: pick("stay") };
  });
}
async function tooltipText(page, type) {
  await page.hover(`.poi-cluster-icon:has(.cluster-${type})`, { force: true });
  // The cluster tooltip is the one with a bold "<count> <category>" title and a second line (note).
  await page.waitForFunction(() => [...document.querySelectorAll(".leaflet-tooltip")].some((e) => e.querySelector("b") && e.querySelector("br") && /[0-9]/.test(e.querySelector("b").textContent)));
  const text = await page.evaluate(() => [...document.querySelectorAll(".leaflet-tooltip")].map((e) => e.innerText).join(" | "));
  await page.mouse.move(2, 2);
  return text;
}
for (const lang of ["en", "es"]) {
  test(`i18n: initial ${lang.toUpperCase()} render names and tooltips clusters in that language`, async () => {
    const { page, ctx, errors } = await open("light", { query: `?lang=${lang}` });
    const n = await clusterNames(page);
    assert.match(n.bike.label, NAME[lang].bike);
    assert.match(n.stay.label, NAME[lang].stay);
    const tip = await tooltipText(page, "bike");
    assert.ok(tip.includes(NAME[lang].note), `tooltip: ${tip}`);
    assert.ok(tip.includes("BiciMAD"));
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("i18n: switching language rewrites accessible names and tooltips in place (same markers, focus kept)", async () => {
  const { page, ctx, errors } = await open("light");
  await page.evaluate(() => { window.__iconBefore = document.querySelector(".cluster-bike").parentElement; });
  await page.focus(".poi-cluster-icon:has(.cluster-bike)");
  for (const lang of ["es", "en", "es"]) {
    await page.selectOption("#languageSelect", lang);
    await page.waitForFunction((l) => document.documentElement.lang === l, lang);
    const n = await clusterNames(page);
    assert.match(n.bike.label, NAME[lang].bike, `bike after → ${lang}`);
    assert.match(n.stay.label, NAME[lang].stay, `stay after → ${lang}`);
    const kept = await page.evaluate(() => ({ same: window.__iconBefore === document.querySelector(".cluster-bike").parentElement, focused: document.activeElement === window.__iconBefore }));
    assert.equal(kept.same, true, "markers must not be rebuilt by a language switch");
    assert.equal(kept.focused, true, "keyboard focus must survive a language switch");
    assert.ok((await tooltipText(page, "stay")).includes(NAME[lang].note));
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("i18n: accommodation sub-filter label is localised in the cluster name (ES) and rebuilt names stay localised", async () => {
  const { page, ctx } = await open("light", { query: "?lang=es" });
  await page.selectOption("#stayKindFilter", "hostel");
  await page.waitForFunction(() => /^[0-9]+ Albergues, agrupados/.test(document.querySelector(".cluster-stay")?.parentElement.getAttribute("aria-label") || ""));
  await page.selectOption("#stayKindFilter", "hotel");
  await page.waitForFunction(() => /^[0-9]+ Hoteles, agrupados/.test(document.querySelector(".cluster-stay")?.parentElement.getAttribute("aria-label") || ""));
  await page.selectOption("#languageSelect", "en");
  await page.waitForFunction(() => /^[0-9]+ Hotels, grouped/.test(document.querySelector(".cluster-stay")?.parentElement.getAttribute("aria-label") || ""));
  await ctx.close();
});

test("reduced motion: no chip transition", async () => {
  const { page, ctx } = await open("light", { reducedMotion: "reduce" });
  const t = await page.evaluate(() => getComputedStyle(document.querySelector(".poi-cluster")).transitionDuration);
  assert.ok(parseFloat(t) <= 0.001, `transition ${t}`);
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------------------------
// N1 — keyboard focus lifecycle. Activating a cluster zooms; every zoomend rebuilds the clusters, which destroys the
// focused marker. Focus must land on a meaningful SURVIVING target (nearest new cluster, else the map itself) and
// never on <body> or a detached node. Mouse behaviour is unchanged (no focus movement after a pointer click).
// ---------------------------------------------------------------------------------------------------------------
// A real Tab sequence (not element.focus()) until a cluster whose accessible name matches.
async function tabToCluster(page, matcher = /./) {
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return 0; });
  for (let i = 0; i < 160; i++) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => { const a = document.activeElement; return a && a.classList && a.classList.contains("poi-cluster-icon") ? a.getAttribute("aria-label") : null; });
    if (label && matcher.test(label)) return label;
  }
  throw new Error(`Tab never reached a cluster matching ${matcher}`);
}
async function focusState(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    return { isBody: a === document.body, connected: Boolean(a && a.isConnected && document.contains(a)), isCluster: Boolean(a && a.classList && a.classList.contains("poi-cluster-icon")),
      isMap: a === map.getContainer(), label: (a && a.getAttribute && a.getAttribute("aria-label")) || null, focusVisible: Boolean(a && a.matches && a.matches(":focus-visible")),
      clusters: document.querySelectorAll(".poi-cluster-icon").length, zoom: map.getZoom() };
  });
}
async function settleAtZoom(page, zoom) {
  await page.waitForFunction((z) => map.getZoom() === z, zoom);
  await page.waitForTimeout(600); // zoomend -> rebuildDenseLayers -> focus restoration
}
for (const key of ["Enter", "Space"]) {
  test(`N1: ${key} on a Tab-focused cluster zooms 14 → 15 and focus lands on a surviving cluster (identity changes 6 → 3)`, async () => {
    const { page, ctx } = await open("light");
    await page.evaluate(([la, lo]) => { map.setView([la, lo], 14, { animate: false }); return 0; }, SPLIT_CENTRE);
    await page.waitForFunction(() => [...document.querySelectorAll(".poi-cluster-icon")].some((i) => /^6 BiciMAD/.test(i.getAttribute("aria-label") || "")));
    await tabToCluster(page, /^6 BiciMAD/);
    await page.keyboard.press(key);
    await settleAtZoom(page, 15);
    const s = await focusState(page);
    assert.equal(s.isBody, false, "focus must not fall back to <body>");
    assert.equal(s.connected, true, "focus must never sit on a detached element");
    assert.equal(s.isCluster, true, "a surviving cluster exists near the activated one, so it must receive focus");
    assert.match(s.label, /^3 BiciMAD/, `cluster identity changed (6 → 3); got ${s.label}`);
    assert.equal(s.focusVisible, true, "keyboard modality must be preserved (focus ring visible)");
    await ctx.close();
  });
}

test("N1: Enter zooms 15 → 16 where clusters disappear: focus moves to the map, not <body> or a detached node", async () => {
  const { page, ctx } = await open("light");
  await page.evaluate(([la, lo]) => { map.setView([la, lo], 15, { animate: false }); return 0; }, SPLIT_CENTRE);
  await page.waitForFunction(() => [...document.querySelectorAll(".poi-cluster-icon")].some((i) => /^3 BiciMAD/.test(i.getAttribute("aria-label") || "")));
  await tabToCluster(page, /^3 BiciMAD/);
  await page.keyboard.press("Enter");
  await settleAtZoom(page, 16);
  const s = await focusState(page);
  assert.equal(s.clusters, 0, "clustering is off from z16");
  assert.equal(s.isBody, false, "focus must not fall back to <body>");
  assert.equal(s.connected, true, "focus must never sit on a detached element");
  assert.equal(s.isMap, true, "no cluster survives z16, so the map container is the meaningful target");
  await ctx.close();
});

test("N1: a programmatic or keyboard zoom while a cluster has keyboard focus also keeps focus on a surviving target", async () => {
  const { page, ctx } = await open("light");
  await tabToCluster(page);
  await page.evaluate(() => { map.zoomIn(1, { animate: false }); return 0; });
  await settleAtZoom(page, 15);
  const s = await focusState(page);
  assert.equal(s.isBody, false);
  assert.equal(s.connected, true);
  assert.ok(s.isCluster || s.isMap, "focus is on a cluster or the map");
  await ctx.close();
});

test("N1: a MOUSE click on a cluster still zooms and does not move focus to a cluster or the map afterwards", async () => {
  const { page, ctx } = await open("light");
  await page.evaluate(([la, lo]) => { map.setView([la, lo], 14, { animate: false }); return 0; }, SPLIT_CENTRE);
  await page.waitForFunction(() => [...document.querySelectorAll(".poi-cluster-icon")].some((i) => /^6 BiciMAD/.test(i.getAttribute("aria-label") || "")));
  await page.locator(".poi-cluster-icon", { hasText: "6" }).first().click();
  await settleAtZoom(page, 15);
  const s = await focusState(page);
  assert.equal(s.isCluster, false, "pointer activation must not re-target focus onto a cluster");
  assert.equal(s.isMap, false, "pointer activation must not re-target focus onto the map");
  assert.equal(s.connected, true);
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------------------------
// N2 — forced-colors (Windows High Contrast). The glyph is a CSS mask painted with a background colour, which the UA
// forces to Canvas, so it was invisible. Asserted on RENDERED PIXELS, not on computed styles. Chromium only:
// Playwright's WebKit does not emulate forced-colors.
// ---------------------------------------------------------------------------------------------------------------
const FORCED = { skip: engine === webkit ? "forced-colors emulation is Chromium-only" : false };
async function glyphInk(page) {
  // For one 38 px chip of each category: screenshot the chip, binarise the 11x11 glyph box above the count (pixels whose
  // luminance differs from the chip fill by > 0.25), and return the bit arrays.
  const boxes = await page.evaluate(() => {
    const pick = (t) => [...document.querySelectorAll(`.poi-cluster.cluster-${t}`)].find((c) => c.offsetWidth === 38 && c.getBoundingClientRect().left > 330 && c.getBoundingClientRect().right < 1190 && c.getBoundingClientRect().top > 60 && c.getBoundingClientRect().bottom < 840 && document.elementFromPoint(c.getBoundingClientRect().left + 19, c.getBoundingClientRect().top + 19)?.closest(".poi-cluster-icon") === c.parentElement);
    const out = {};
    for (const t of ["stay", "bike"]) { const c = pick(t); if (!c) { out[t] = null; continue; } const r = c.getBoundingClientRect(), s = c.querySelector("span").getBoundingClientRect(); out[t] = { x: r.left, y: r.top, w: r.width, spanTop: s.top }; }
    return out;
  });
  assert.ok(boxes.stay && boxes.bike, "fixture must expose one fully visible 38 px chip of each category");
  const res = {};
  for (const t of ["stay", "bike"]) {
    const b = boxes[t];
    const png = await page.screenshot({ type: "png", clip: { x: Math.floor(b.x) - 2, y: Math.floor(b.y) - 2, width: Math.ceil(b.w) + 4, height: Math.ceil(b.w) + 4 } });
    res[t] = await page.evaluate(async ({ b64, spanTopRel, cxRel }) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const L = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      const fillD = g.getImageData(Math.round(cxRel - 12), Math.round(img.height / 2), 1, 1).data, lf = L(fillD, 0);
      const bits = [];
      for (let yy = 0; yy < 11; yy++) for (let xx = 0; xx < 11; xx++) { const d = g.getImageData(Math.round(cxRel - 5.5) + xx, Math.round(spanTopRel) - 11 + yy, 1, 1).data; bits.push(Math.abs(L(d, 0) - lf) > 0.25 ? 1 : 0); }
      return bits;
    }, { b64: png.toString("base64"), spanTopRel: b.spanTop - (Math.floor(b.y) - 2), cxRel: b.w / 2 + 2 });
  }
  return res;
}
for (const scheme of ["light", "dark"]) {
  test(`N2: forced-colors active (${scheme}) — both category glyphs are VISIBLE in rendered pixels and differ from each other`, FORCED, async () => {
    const { page, ctx } = await open(scheme, { forcedColors: "active" });
    await page.addStyleTag({ content: ".leaflet-tooltip{display:none!important}" });
    const bits = await glyphInk(page);
    const n = (a) => a.reduce((s, x) => s + x, 0);
    assert.ok(n(bits.stay) >= 12, `stay glyph must paint visible pixels in forced-colors (got ${n(bits.stay)}/121)`);
    assert.ok(n(bits.bike) >= 12, `bike glyph must paint visible pixels in forced-colors (got ${n(bits.bike)}/121)`);
    const hamming = bits.stay.reduce((s, x, i) => s + (x !== bits.bike[i] ? 1 : 0), 0);
    assert.ok(hamming >= 20, `the two glyphs must remain distinguishable (Hamming distance ${hamming} of 121)`);
    await ctx.close();
  });
}

test("N2: forced-colors active — keyboard focus visibly changes the rendered pixels around the cluster", FORCED, async () => {
  const { page, ctx } = await open("light", { forcedColors: "active" });
  await page.addStyleTag({ content: ".leaflet-tooltip{display:none!important}" });
  await tabToCluster(page);
  const fv = await page.evaluate(() => { const a = document.activeElement; const r = a.querySelector(".poi-cluster").getBoundingClientRect(); return { focusVisible: a.matches(":focus-visible"), cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 }; });
  assert.equal(fv.focusVisible, true);
  const clip = { x: Math.round(fv.cx - fv.r - 16), y: Math.round(fv.cy - fv.r - 16), width: Math.round(2 * (fv.r + 16)), height: Math.round(2 * (fv.r + 16)) };
  const focused = await page.screenshot({ type: "png", clip });
  await page.evaluate(() => { document.activeElement.blur(); return 0; });
  const unfocused = await page.screenshot({ type: "png", clip });
  const changedPct = await page.evaluate(async ({ a, b, r, w }) => {
    const load = async (s) => { const i = new Image(); i.src = "data:image/png;base64," + s; await i.decode(); const cv = document.createElement("canvas"); cv.width = i.width; cv.height = i.height; const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(i, 0, 0); return g; };
    const F = await load(a), U = await load(b); const c = w / 2; let changed = 0, total = 0;
    for (let ang = 0; ang < 360; ang += 10) { const t = ang * Math.PI / 180; let dmax = 0;
      for (let rr = r + 1.5; rr <= r + 8; rr += 0.5) { const x = Math.round(c + Math.cos(t) * rr), y = Math.round(c + Math.sin(t) * rr); const f = F.getImageData(x, y, 1, 1).data, u = U.getImageData(x, y, 1, 1).data; dmax = Math.max(dmax, Math.hypot(f[0] - u[0], f[1] - u[1], f[2] - u[2])); }
      total++; if (dmax > 60) changed++; }
    return 100 * changed / total;
  }, { a: focused.toString("base64"), b: unfocused.toString("base64"), r: fv.r, w: clip.width });
  assert.ok(changedPct >= 80, `focus indicator must change pixels in >= 80 % of directions in forced-colors (got ${changedPct.toFixed(0)} %)`);
  await ctx.close();
});

test.after(async () => { await browser.close(); server.close(); });
