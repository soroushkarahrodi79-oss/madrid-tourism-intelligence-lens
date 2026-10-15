import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// K11 shareable evidence state (#73) browser contract.
//
// The contracts it defends in a real browser, through real interactions:
//
//   * A reading configured in one browser context (mode, Lens A/B centres and
//     radii, enabled layers, language, ámbito comparison) produces a share URL
//     that reconstructs the SAME reading in a fresh context.
//   * An unsupported `v` is REFUSED with a visible notice; it never restores a
//     different reading.
//   * An invalid value (radius out of range) restores partially with a visible,
//     dismissible notice, and does not adopt the bad value.
//   * Ordinary interaction (moving a Lens) uses replaceState: the back button is
//     not polluted with a history entry per move.
//   * Copy-link gives honest feedback and puts the canonical URL on the clipboard.
//   * Share and export are reachable at 360px.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// Two single-row ámbitos from the committed universe (as used by the K10 suite).
const CODE_A = "AOE.00.03";
const CODE_B = "AOE.00.06";

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(target, (error, content) => {
    if (error) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
// CI installs the matching Chromium and launches it directly; a local container
// may pre-bake a different build, so an optional executable path is honored. Unset
// in CI, so CI behaviour is identical to the other browser suites.
const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_EXECUTABLE_PATH || undefined });
const BASE = `http://127.0.0.1:${port}`;

async function openContext(url, { viewport = { width: 1366, height: 900 }, permissions = [] } = {}) {
  const context = await browser.newContext({ viewport, permissions });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  await page.waitForFunction(() => {
    const section = document.getElementById("planningAmbito");
    return section && section.dataset.state && section.dataset.state !== "loading";
  });
  page.context_ = context;
  return page;
}

// A fresh workspace with the regression seam on, in COMPARE mode.
async function newPage(opts) {
  const page = await openContext(`${BASE}/?haloRegressionTest=1`, opts);
  await page.evaluate(() => window.__HALO_REGRESSION__.enterMode("COMPARE"));
  return page;
}

// Open a share URL in a fresh context, with the seam param appended so the
// restored reading can be inspected, and wait until the K11 restore has run.
async function restorePage(shareQuery, opts) {
  const url = `${BASE}/${shareQuery}&haloRegressionTest=1`;
  const page = await openContext(url, opts);
  await page.waitForFunction(() => window.__HALO_REGRESSION__.k11Restored() === true);
  return page;
}

const close = (page) => page.context_.close();
const seam = (page, fn, arg) => page.evaluate(fn, arg);

test.after(async () => { await browser.close(); server.close(); });

// -------------------------------------------------------------- round-trip

test("a configured Lens reading round-trips into a fresh browser context", async () => {
  const page = await newPage();
  try {
    await seam(page, () => {
      window.__HALO_REGRESSION__.moveLens("A", 500, 360);
      window.__HALO_REGRESSION__.moveLens("B", 820, 420);
      window.__HALO_REGRESSION__.setRadius("A", 1200);
      window.__HALO_REGRESSION__.setRadius("B", 800);
      window.__HALO_REGRESSION__.recompute();
    });
    const source = await seam(page, () => window.__HALO_REGRESSION__.k11State());
    const url = await seam(page, () => window.__HALO_REGRESSION__.k11Url());
    assert.equal(source.mode, "COMPARE");
    assert.equal(source.lensBEnabled, true);
    assert.equal(source.lensA.radiusM, 1200);
    assert.equal(source.lensB.radiusM, 800);

    const query = url.slice(url.indexOf("?"));
    const restored = await restorePage(query);
    try {
      const target = await seam(restored, () => window.__HALO_REGRESSION__.k11State());
      assert.equal(target.mode, "COMPARE");
      assert.equal(target.lensBEnabled, true);
      assert.equal(target.lensA.radiusM, 1200);
      assert.equal(target.lensB.radiusM, 800);
      assert.ok(Math.abs(target.lensA.lat - source.lensA.lat) < 1e-4, "Lens A lat restored");
      assert.ok(Math.abs(target.lensA.lon - source.lensA.lon) < 1e-4, "Lens A lon restored");
      assert.ok(Math.abs(target.lensB.lat - source.lensB.lat) < 1e-4, "Lens B lat restored");
      const notice = await seam(restored, () => window.__HALO_REGRESSION__.k11NoticeState());
      assert.equal(notice.hidden, true, "a clean round-trip shows no notice");
    } finally {
      await close(restored);
    }
  } finally {
    await close(page);
  }
});

test("language and enabled layers round-trip", async () => {
  const page = await newPage();
  try {
    await page.selectOption("#languageSelect", "es");
    // Toggle the museum layer off through its real change handler (the layer
    // panel can be scrolled out of view at this viewport, so a raw click is flaky).
    await page.evaluate(() => {
      const cb = document.querySelector('[data-layer="museum"]');
      cb.checked = false;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const url = await seam(page, () => window.__HALO_REGRESSION__.k11Url());
    const query = url.slice(url.indexOf("?"));
    const restored = await restorePage(query);
    try {
      const lang = await restored.evaluate(() => document.documentElement.lang);
      assert.equal(lang, "es", "language restored");
      const museumChecked = await restored.isChecked('[data-layer="museum"]');
      assert.equal(museumChecked, false, "disabled layer restored off");
    } finally {
      await close(restored);
    }
  } finally {
    await close(page);
  }
});

test("a K10 ámbito comparison round-trips by exact official code", async () => {
  const page = await newPage();
  try {
    await seam(page, () => window.__HALO_REGRESSION__.ambitoSetScope("AMBITO"));
    await seam(page, (code) => window.__HALO_REGRESSION__.ambitoSelect("A", code), CODE_A);
    await seam(page, (code) => window.__HALO_REGRESSION__.ambitoSelect("B", code), CODE_B);
    const url = await seam(page, () => window.__HALO_REGRESSION__.k11Url());
    const query = url.slice(url.indexOf("?"));
    assert.ok(query.includes(`aa=${CODE_A}`) || query.includes(encodeURIComponent(CODE_A)), "code A in URL");

    const restored = await restorePage(query);
    try {
      const state = await seam(restored, () => window.__HALO_REGRESSION__.k11State());
      assert.equal(state.scope, "AMBITO");
      assert.equal(state.ambitoA, CODE_A);
      assert.equal(state.ambitoB, CODE_B);
    } finally {
      await close(restored);
    }
  } finally {
    await close(page);
  }
});

// ----------------------------------------------------------- refusal / partial

test("an unsupported version is refused with a visible notice and no different reading", async () => {
  const page = await restorePage("?v=99&m=CITY&a=40.4149,-3.69,1500");
  try {
    const notice = await seam(page, () => window.__HALO_REGRESSION__.k11NoticeState());
    assert.equal(notice.hidden, false, "refusal notice is shown");
    assert.ok(notice.title.length > 0);
    const state = await seam(page, () => window.__HALO_REGRESSION__.k11State());
    assert.notEqual(state.mode, "CITY", "the refused reading was NOT applied");
    assert.notEqual(state.lensA.radiusM, 1500, "the refused radius was NOT applied");
  } finally {
    await close(page);
  }
});

test("an out-of-range radius restores partially, states it, and is dismissible", async () => {
  const page = await restorePage("?v=1&m=COMPARE&a=40.4149,-3.69,99999");
  try {
    const notice = await seam(page, () => window.__HALO_REGRESSION__.k11NoticeState());
    assert.equal(notice.hidden, false, "partial-restore notice is shown");
    const state = await seam(page, () => window.__HALO_REGRESSION__.k11State());
    assert.notEqual(state.lensA.radiusM, 99999, "the invalid radius was not adopted");
    assert.equal(state.mode, "COMPARE", "the valid dimension still restored");
    await page.click("#k11RestoreDismiss");
    const after = await seam(page, () => window.__HALO_REGRESSION__.k11NoticeState());
    assert.equal(after.hidden, true, "notice is dismissible");
  } finally {
    await close(page);
  }
});

// -------------------------------------------------------------- history / copy

test("moving a Lens does not create browser-history entries", async () => {
  const page = await newPage();
  try {
    const before = await page.evaluate(() => history.length);
    await seam(page, () => {
      window.__HALO_REGRESSION__.moveLens("A", 480, 340);
      window.__HALO_REGRESSION__.moveLens("A", 560, 380);
      window.__HALO_REGRESSION__.moveLens("A", 640, 420);
    });
    // allow the coalesced replaceState to flush
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => history.length);
    assert.equal(after, before, "history length unchanged (replaceState, not pushState)");
    assert.match(await page.evaluate(() => location.search), /[?&]v=1/, "address bar carries the state");
  } finally {
    await close(page);
  }
});

test("copy-link reports success and writes the canonical URL to the clipboard", async () => {
  const page = await newPage({ permissions: ["clipboard-read", "clipboard-write"] });
  try {
    await page.evaluate(() => document.getElementById("evidenceDrawer").showModal());
    await page.click("#k11ShareBtn");
    await page.waitForFunction(() => document.getElementById("k11ShareStatus").textContent.trim().length > 0);
    const tone = await page.getAttribute("#k11ShareStatus", "data-tone");
    assert.equal(tone, "ok", "copy reported success");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /[?&]v=1/, "clipboard holds the canonical share URL");
  } finally {
    await close(page);
  }
});

test("share and export are reachable at 360px", async () => {
  const page = await newPage({ viewport: { width: 360, height: 740 } });
  try {
    await page.evaluate(() => document.getElementById("evidenceDrawer").showModal());
    assert.equal(await page.isVisible("#k11ShareBtn"), true, "share reachable at 360px");
    assert.equal(await page.isVisible("#k11ExportBtn"), true, "export reachable at 360px");
    const box = await page.locator("#k11ShareBtn").boundingBox();
    assert.ok(box && box.height >= 36, "share control has an adequate touch target");
  } finally {
    await close(page);
  }
});

// -------------------------------------------------------------- export bundle

test("export transcribes the frozen LENS comparison into the five-file bundle", async () => {
  const page = await newPage();
  try {
    await seam(page, () => {
      window.__HALO_REGRESSION__.moveLens("A", 500, 360);
      window.__HALO_REGRESSION__.moveLens("B", 820, 420);
      window.__HALO_REGRESSION__.recompute();
    });
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    assert.equal(bundle.files.length, 5, "five files");
    const names = bundle.files.map((f) => f.name.replace(/-\d{8}-\d{4}/, "")).sort();
    assert.deepEqual(names, ["README.txt", "geometry.geojson", "reading.json", "sources.json", "state.url"]);

    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    assert.ok(reading.values.length >= 1, "comparison values transcribed");
    for (const value of reading.values) {
      assert.ok(value.scope, "value has scope");
      assert.ok("unit" in value, "value has unit");
      assert.ok(value.state, "value has state");
      assert.ok(Array.isArray(value.source_ids), "value names its sources");
    }
    // every evidence surface carries the five freshness fields + ceiling
    for (const surface of reading.evidence_surfaces) {
      for (const source of surface.sources) {
        for (const field of ["reference_date", "published_at", "retrieved_at", "update_frequency", "source_state"]) {
          assert.ok(field in source.freshness, `${source.id} carries ${field}`);
        }
        assert.ok(source.interpretation_ceiling, `${source.id} carries its ceiling`);
      }
    }
    const geo = JSON.parse(bundle.files.find((f) => f.name.startsWith("geometry-")).text);
    assert.match(JSON.stringify(geo.crs), /4326/);
    const lens = geo.features.filter((f) => f.properties.scope === "LENS_CIRCLE");
    assert.ok(lens.length >= 1, "lens circle geometry present");
    assert.equal(lens[0].properties.geometry_kind, "generated_analytical_window");

    // state.url and reading.json agree
    const stateUrl = bundle.files.find((f) => f.name.startsWith("state-")).text.trim();
    assert.equal(stateUrl, reading.state_url);

    const sources = JSON.parse(bundle.files.find((f) => f.name.startsWith("sources-")).text);
    assert.ok(sources.sources.length >= 1 && sources.sources.length < 19, "only contributing sources");
  } finally {
    await close(page);
  }
});

test("the Export button runs the real delivery path and renders fallback links", async () => {
  const page = await newPage();
  try {
    const downloads = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await seam(page, () => { window.__HALO_REGRESSION__.moveLens("A", 500, 360); window.__HALO_REGRESSION__.recompute(); });
    await page.evaluate(() => document.getElementById("evidenceDrawer").showModal());
    await page.click("#k11ExportBtn");
    await page.waitForFunction(() => document.querySelectorAll("#k11ShareStatus .k11-export-link").length === 5);
    const tone = await page.getAttribute("#k11ShareStatus", "data-tone");
    assert.equal(tone, "ok", "delivery reported ok");
    const links = await page.$$eval("#k11ShareStatus .k11-export-link", (as) => as.map((a) => a.getAttribute("download")));
    assert.equal(links.length, 5, "a fallback link per file");
    assert.ok(links.some((n) => n.startsWith("reading-")), "reading file linked");
  } finally {
    await close(page);
  }
});

test("export transcribes the frozen ÁMBITO comparison with official polygons", async () => {
  const page = await newPage();
  try {
    await seam(page, () => window.__HALO_REGRESSION__.ambitoSetScope("AMBITO"));
    await seam(page, (code) => window.__HALO_REGRESSION__.ambitoSelect("A", code), CODE_A);
    await seam(page, (code) => window.__HALO_REGRESSION__.ambitoSelect("B", code), CODE_B);
    await page.waitForFunction(() => {
      const b = window.__HALO_REGRESSION__.k11Bundle();
      if (!b) return false;
      const r = JSON.parse(b.files.find((f) => f.name.startsWith("reading-")).text);
      return r.values.length >= 1;
    });
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    assert.ok(reading.values.every((v) => v.scope === "PLANNING_AMBITO"), "ámbito-scoped values");
    const geo = JSON.parse(bundle.files.find((f) => f.name.startsWith("geometry-")).text);
    const official = geo.features.filter((f) => f.properties.scope === "PLANNING_AMBITO");
    assert.ok(official.length >= 1, "official ámbito polygon(s) exported");
    assert.equal(official[0].properties.geometry_kind, "official_boundary");
    assert.notEqual(official[0].geometry.type, "Point");
  } finally {
    await close(page);
  }
});
