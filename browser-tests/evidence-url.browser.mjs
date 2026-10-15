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

// ------------------------------------------------ PLACE / CITY values (Finding 1)

test("PLACE export transcribes the active-lens metric values with per-value provenance", async () => {
  const page = await newPage();
  try {
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("PLACE"));
    await seam(page, () => { window.__HALO_REGRESSION__.moveLens("A", 520, 360); window.__HALO_REGRESSION__.recompute(); });
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    assert.equal(reading.reading.mode, "PLACE");
    const ids = reading.values.map((v) => v.id);
    for (const id of ["tourism", "stays", "mobility"]) assert.ok(ids.includes(id), `PLACE value ${id} present`);
    // The primary lens metrics are LENS_CIRCLE; full coverage adds other scopes.
    const LENS_METRICS = ["tourism", "stays", "mobility", "utci", "pedestrian"];
    for (const value of reading.values) {
      if (LENS_METRICS.includes(value.id)) assert.equal(value.scope, "LENS_CIRCLE", `${value.id} is LENS_CIRCLE`);
      assert.ok(["LENS_CIRCLE", "OFFICIAL_BARRIO", "PLANNING_AMBITO", "ADDRESS_POINT", "MUNICIPALITY"].includes(value.scope), `${value.id} approved scope`);
      assert.ok(value.state, "value has a state");
      assert.ok(Array.isArray(value.provenance) && value.provenance.length, `${value.id} carries provenance`);
      for (const prov of value.provenance) {
        for (const field of ["reference_date", "published_at", "retrieved_at", "update_frequency", "source_state"]) {
          assert.ok(field in prov.freshness, `${prov.id} carries ${field}`);
        }
      }
    }
  } finally {
    await close(page);
  }
});

test("CITY export transcribes municipality values (hotel demand) with provenance", async () => {
  const page = await newPage();
  try {
    await page.waitForFunction(() => {
      const s = document.getElementById("destinationContext");
      return s && s.dataset.state === "available";
    });
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("CITY"));
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    assert.equal(reading.reading.mode, "CITY");
    assert.ok(reading.values.length >= 1, "CITY has value records");
    assert.ok(reading.values.every((v) => v.scope === "MUNICIPALITY"), "CITY values are municipality-scoped");
    assert.ok(reading.values.some((v) => v.provenance.some((p) => p.id === "hotel_demand")), "hotel demand transcribed");
  } finally {
    await close(page);
  }
});

// ---------------------------------------- export follows the visible mode (Finding 3)

test("switching COMPARE→PLACE drops the retained ámbito comparison from the export", async () => {
  const page = await newPage();
  try {
    // Build a K10 ámbito comparison in COMPARE (model retained in memory).
    await seam(page, () => window.__HALO_REGRESSION__.ambitoSetScope("AMBITO"));
    await seam(page, (code) => window.__HALO_REGRESSION__.ambitoSelect("A", code), CODE_A);
    await seam(page, (code) => window.__HALO_REGRESSION__.ambitoSelect("B", code), CODE_B);
    await page.waitForFunction(() => {
      const b = window.__HALO_REGRESSION__.k11Bundle();
      const r = JSON.parse(b.files.find((f) => f.name.startsWith("reading-")).text);
      return r.values.some((v) => v.scope === "PLANNING_AMBITO");
    });
    // Now switch to PLACE. The ámbito model is still in memory, but it is NOT visible.
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("PLACE"));
    await seam(page, () => window.__HALO_REGRESSION__.recompute());
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    assert.equal(reading.reading.mode, "PLACE");
    assert.ok(!reading.values.some((v) => v.scope === "PLANNING_AMBITO"), "no hidden ámbito values exported in PLACE");
    const geo = JSON.parse(bundle.files.find((f) => f.name.startsWith("geometry-")).text);
    assert.ok(!geo.features.some((f) => f.properties.geometry_kind === "official_boundary" && f.properties.scope === "PLANNING_AMBITO"), "no stale ámbito polygon exported in PLACE");
  } finally {
    await close(page);
  }
});

test("switching COMPARE/LENS→CITY drops the retained Lens comparison from the export", async () => {
  const page = await newPage();
  try {
    await page.waitForFunction(() => {
      const s = document.getElementById("destinationContext");
      return s && s.dataset.state === "available";
    });
    await seam(page, () => { window.__HALO_REGRESSION__.moveLens("A", 500, 360); window.__HALO_REGRESSION__.moveLens("B", 800, 420); window.__HALO_REGRESSION__.recompute(); });
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("CITY"));
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    assert.ok(!reading.values.some((v) => v.scope === "LENS_CIRCLE"), "no hidden Lens comparison values exported in CITY");
    const geo = JSON.parse(bundle.files.find((f) => f.name.startsWith("geometry-")).text);
    assert.ok(!geo.features.some((f) => f.properties.scope === "LENS_CIRCLE"), "no Lens circle geometry exported in CITY");
  } finally {
    await close(page);
  }
});

// ------------------------------------- CITY origins rendered-vs-export (Finding 1/3)

test("CITY origin rows: exported values match the rendered rows, across two months", async () => {
  const page = await newPage();
  try {
    await page.waitForFunction(() => document.getElementById("destinationContext")?.dataset.state === "available");
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("CITY"));
    await page.waitForFunction(() => document.querySelectorAll("#domesticOriginsRows tr").length > 0);

    const readRows = () => page.$$eval("#domesticOriginsRows tr", (rows) => rows.map((r) => ({
      code: r.querySelector(".muted")?.textContent?.trim(),
      count: r.querySelectorAll("td")[1]?.textContent?.trim(),
    })));
    const checkAgainstExport = async () => {
      const dom = await readRows();
      const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
      const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
      const exported = new Map(reading.values.filter((v) => v.id.startsWith("origin_")).map((v) => [v.id.replace("origin_", ""), v]));
      assert.ok(dom.length > 0, "origin rows rendered");
      for (const row of dom) {
        const value = exported.get(row.code);
        assert.ok(value, `exported value exists for origin ${row.code}`);
        assert.equal(value.display, row.count, `exported display matches the rendered count for ${row.code}`);
        assert.equal(value.state, "VALID");
        assert.ok(Number.isInteger(value.value), `${row.code} exports the integer source_reported_tourists, not null`);
        assert.ok(value.source_month, `${row.code} carries its source month`);
      }
    };

    await checkAgainstExport(); // default (latest) month
    const months = await page.$$eval("#domesticOriginsMonth option", (os) => os.map((o) => o.value).filter(Boolean));
    const current = await page.inputValue("#domesticOriginsMonth");
    const other = months.find((m) => m !== current);
    if (other) {
      await page.selectOption("#domesticOriginsMonth", other);
      await page.waitForFunction((m) => document.getElementById("domesticOriginsMonth").value === m, other);
      await checkAgainstExport(); // a non-default month
    }
  } finally {
    await close(page);
  }
});

// ------------------------------------------ per-mode disclosure coverage (Finding 3)

test("every displayed evidence surface is disclosed in the export, in every mode", async () => {
  const page = await newPage();
  try {
    for (const mode of ["PLACE", "COMPARE", "CITY"]) {
      await seam(page, (m) => window.__HALO_REGRESSION__.enterMode(m), mode);
      if (mode === "CITY") {
        await page.waitForFunction(() => document.getElementById("destinationContext")?.dataset.state === "available").catch(() => {});
      }
      const expected = await seam(page, () => window.__HALO_REGRESSION__.k11ExpectedSurfaces());
      const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
      const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
      const disclosed = new Set(reading.evidence_surfaces.map((s) => s.surface));
      for (const key of expected) {
        assert.ok(disclosed.has(key), `${mode}: displayed surface ${key} is disclosed in evidence_surfaces`);
      }
    }
  } finally {
    await close(page);
  }
});

// -------------------------------- origin-month URL round-trip, two months (Finding 2)

test("the domestic-origin month round-trips across browser contexts, for two months", async () => {
  const page = await newPage();
  try {
    await page.waitForFunction(() => document.getElementById("destinationContext")?.dataset.state === "available");
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("CITY"));
    await page.waitForFunction(() => document.querySelectorAll("#domesticOriginsMonth option").length > 0);
    const months = await page.$$eval("#domesticOriginsMonth option", (os) => os.map((o) => o.value).filter(Boolean));
    assert.ok(months.length >= 2, "at least two published months to test");

    for (const month of [months[0], months[months.length - 1]]) {
      await page.selectOption("#domesticOriginsMonth", month);
      await page.waitForFunction((m) => document.getElementById("domesticOriginsMonth").value === m, month);
      // the month change committed to the URL via replaceState
      const url = await seam(page, () => window.__HALO_REGRESSION__.k11Url());
      assert.ok(url.includes(`om=${month}`), `URL carries om=${month}`);
      const query = url.slice(url.indexOf("?"));

      const restored = await restorePage(`${query}`);
      try {
        await restored.waitForFunction(() => document.getElementById("destinationContext")?.dataset.state === "available").catch(() => {});
        const restoredMonth = await restored.inputValue("#domesticOriginsMonth");
        assert.equal(restoredMonth, month, `restored month is ${month}`);
        const notice = await seam(restored, () => window.__HALO_REGRESSION__.k11NoticeState());
        assert.equal(notice.hidden, true, "a valid known month restores with no notice");
      } finally {
        await close(restored);
      }
    }
  } finally {
    await close(page);
  }
});

test("a shared link with an unknown origin month states a partial restore", async () => {
  // Construct a CITY link carrying a month outside the published set.
  const page = await restorePage("?v=1&m=CITY&om=1999-01");
  try {
    await page.waitForFunction(() => document.getElementById("destinationContext")?.dataset.state === "available").catch(() => {});
    const notice = await seam(page, () => window.__HALO_REGRESSION__.k11NoticeState());
    assert.equal(notice.hidden, false, "unknown month is surfaced as a partial restore");
    // and the month was NOT silently adopted
    const selected = await page.inputValue("#domesticOriginsMonth");
    assert.notEqual(selected, "1999-01");
  } finally {
    await close(page);
  }
});

// ---------------------------------- full value coverage per mode (Finding 3 → closed)

test("PLACE export now emits residents, category-mix and (when resolved) planning value records", async () => {
  const page = await newPage();
  try {
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("PLACE"));
    await page.waitForFunction(() => {
      const s = document.getElementById("areaProfile");
      return s && s.dataset.state && s.dataset.state !== "loading";
    }).catch(() => {});
    await seam(page, () => window.__HALO_REGRESSION__.recompute());
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    const ids = reading.values.map((v) => v.id);
    assert.ok(ids.includes("residents"), "residents is a value record");
    assert.ok(ids.some((id) => id.startsWith("mix_")), "category-mix shares are value records");
    // Each new value still carries per-value provenance and an approved scope.
    for (const value of reading.values) {
      assert.ok(Array.isArray(value.provenance), `${value.id} carries provenance`);
      assert.ok(["LENS_CIRCLE", "OFFICIAL_BARRIO", "PLANNING_AMBITO", "ADDRESS_POINT", "MUNICIPALITY"].includes(value.scope), `${value.id} approved scope`);
    }
    // More than the five primary lens metrics are now transcribed.
    assert.ok(reading.values.length > 5, "PLACE value coverage extends beyond the primary panel");
  } finally {
    await close(page);
  }
});

test("CITY export now emits the month-over-month dynamics summary as value records", async () => {
  const page = await newPage();
  try {
    await page.waitForFunction(() => document.getElementById("destinationContext")?.dataset.state === "available").catch(() => {});
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("CITY"));
    await page.waitForFunction(() => {
      const b = window.__HALO_REGRESSION__.k11Bundle();
      if (!b) return false;
      const r = JSON.parse(b.files.find((f) => f.name.startsWith("reading-")).text);
      return r.values.some((v) => v.id.startsWith("dynamics_"));
    }).catch(() => {});
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    const dynamics = reading.values.filter((v) => v.id.startsWith("dynamics_"));
    assert.ok(dynamics.length >= 1, "domestic-origin dynamics transcribed as value records");
    assert.ok(dynamics.every((v) => v.scope === "MUNICIPALITY"), "dynamics are municipality-scoped");
  } finally {
    await close(page);
  }
});

// ============================================================================
// FINAL SCIENTIFIC EXPORT INTEGRITY GATE (#73) — rendered↔exported assertions
// ============================================================================

// Finding 1: an in-lens COUNT of address-point licence records is a spatial
// aggregate over the generated window. Its analytical scope is LENS_CIRCLE; the
// ADDRESS_POINT geometry of each underlying record stays the record identity, not
// the scope of the summed figure. This is the aggregate-vs-individual-point
// regression the review asked for.
test("PLACE licence counts export as a LENS_CIRCLE aggregate, retaining ADDRESS_POINT record identity", async () => {
  const page = await newPage();
  try {
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("PLACE"));
    await seam(page, ([la, lo]) => window.__HALO_REGRESSION__.moveLensToLatLng("A", la, lo), [40.4165, -3.7026]);
    await seam(page, () => window.__HALO_REGRESSION__.enableLicences());
    await page.waitForFunction(() => {
      const s = document.getElementById("urbanLicences");
      return s && s.dataset.licenceState && s.dataset.licenceState !== "OFF";
    }).catch(() => {});
    await seam(page, () => window.__HALO_REGRESSION__.recompute());
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    const licences = reading.values.filter((v) => v.id.startsWith("licences_"));
    assert.ok(licences.length >= 1, "licence aggregates are exported as value records");
    for (const v of licences) {
      assert.equal(v.scope, "LENS_CIRCLE", `${v.id}: an in-lens COUNT is scoped to the window, not the point`);
      assert.equal(v.aggregate_of, "ADDRESS_POINT", `${v.id}: retains the underlying record geometry identity`);
      assert.ok(v.provenance.some((p) => p.id === "urban_licences"), `${v.id}: underlying record/source identity retained in provenance`);
    }
    // The distinction is real: the aggregate is never mislabelled as a single
    // address-point observation.
    assert.ok(!licences.some((v) => v.scope === "ADDRESS_POINT"), "an aggregate count is never labelled as a point observation");
  } finally {
    await close(page);
  }
});

// Finding 2a: the VUT block shows three figures — units, the licence COUNT, and
// the units-per-1,000-residents ratio. All three must be transcribed, each with
// its actual unit, and the ratio's abstention reason must survive.
test("PLACE VUT export carries the licence count and the per-1,000-residents ratio exactly as displayed", async () => {
  const page = await newPage();
  try {
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("PLACE"));
    await seam(page, ([la, lo]) => window.__HALO_REGRESSION__.moveLensToLatLng("A", la, lo), [40.4165, -3.7026]);
    await page.waitForFunction(() => {
      const s = document.getElementById("areaVut");
      return s && s.dataset.state && s.dataset.state !== "loading";
    }).catch(() => {});
    await seam(page, () => window.__HALO_REGRESSION__.recompute());
    const vutState = await page.$eval("#areaVut", (n) => n.dataset.state).catch(() => null);
    const ratioState = await page.$eval("#areaVut", (n) => n.dataset.ratio).catch(() => null);
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    assert.equal(vutState, "available", "the chosen barrio publishes a VUT figure (otherwise pick another)");
    const ids = reading.values.map((v) => v.id);
    assert.ok(ids.includes("vut_units"), "units exported");
    assert.ok(ids.includes("vut_licences"), "the licence COUNT is exported alongside the units");
    const ratio = reading.values.find((v) => v.id === "vut_ratio");
    assert.ok(ratio, "the per-1,000-residents ratio is a value record");
    assert.equal(ratio.unit, "units per 1,000 residents", "the ratio carries its actual unit, not null");
    if (ratioState === "available") {
      assert.equal(ratio.state, "VALID");
      const rendered = await page.$eval("#areaVutSecondary", (n) => n.textContent).catch(() => "");
      assert.ok(ratio.display && rendered.includes(ratio.display), "exported ratio display matches the rendered secondary line");
    } else {
      assert.equal(ratio.state, "UNAVAILABLE");
      assert.ok(ratio.withheld_reason, "the ratio abstention reason (no_numerator / no_denominator) is carried, never a zero");
    }
  } finally {
    await close(page);
  }
});

// Finding 2c: the K7 edition-change reading under the ámbito — the per-family
// classification and the defensible buildability differences — is transcribed
// with its comparability verdict and every withholding reason. Two representative
// samples: an S1 state transition and an S2 cause-unresolved (non-comparable).
test("PLACE K7 edition-change classifications and buildability differences are transcribed with their reasons", async () => {
  const page = await newPage();
  try {
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("PLACE"));
    const samples = [
      { lat: 40.4001518625, lon: -3.719977745 }, // APE.02.27 — S1 STATE_TRANSITION
      { lat: 40.453697585, lon: -3.60379061 },   // APE.21.02 — S2 CAUSE_UNRESOLVED
      { lat: 40.39107073, lon: -3.68838488 },     // APE.02.12 — S2 buildability WITHHELD
    ];
    let asserted = 0;
    for (const s of samples) {
      await seam(page, ([la, lo]) => window.__HALO_REGRESSION__.moveLensToLatLng("A", la, lo), [s.lat, s.lon]);
      await page.waitForFunction(() => {
        const sec = document.getElementById("planningAmbito");
        return sec && sec.dataset.state && sec.dataset.state !== "loading";
      }).catch(() => {});
      await seam(page, () => window.__HALO_REGRESSION__.recompute());
      const shown = await page.$eval("#planningChange", (n) => !n.hidden).catch(() => false);
      if (!shown) continue;
      const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
      const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
      const changes = reading.values.filter((v) => v.id.startsWith("change_"));
      if (changes.length === 0) continue;
      asserted += 1;
      const comparability = reading.values.find((v) => v.id === "change_comparability");
      assert.ok(comparability && comparability.value, "the comparability verdict is transcribed");
      for (const v of changes) {
        assert.equal(v.scope, "PLANNING_AMBITO", `${v.id}: ámbito-scoped`);
        assert.ok(v.source_family === null || ["S1_DEVELOPMENT_STATE", "S2_AVAILABLE_BUILDABILITY"].includes(v.source_family), `${v.id}: names its S1/S2 family`);
      }
      // A withheld classification or buildability cell carries its reason and no
      // fabricated number (blank is never read as zero).
      for (const v of changes.filter((x) => x.state === "WITHHELD")) {
        assert.ok(v.withheld_reason, `${v.id}: a withheld change carries its reason`);
        assert.equal(v.a_value, null, `${v.id}: no fabricated previous value when withheld`);
        assert.equal(v.b_value, null, `${v.id}: no fabricated current value when withheld`);
      }
    }
    assert.ok(asserted >= 1, "at least one K7 sample rendered the change panel and was transcribed");
  } finally {
    await close(page);
  }
});

// Finding 2b: every shared-origin row the dynamics table displays is transcribed
// with its previous/current published counts and the model's own absolute and
// percent change — for a NON-DEFAULT month — and a suppressed row (rendered "—")
// is WITHHELD in the export, never a fabricated number.
test("CITY dynamics shared-origin rows match the rendered table and preserve suppression, for a non-default month", async () => {
  const page = await newPage();
  try {
    await page.waitForFunction(() => document.getElementById("destinationContext")?.dataset.state === "available");
    await seam(page, () => window.__HALO_REGRESSION__.enterMode("CITY"));
    await page.waitForFunction(() => document.querySelectorAll("#domesticOriginsMonth option").length > 0);
    const months = await page.$$eval("#domesticOriginsMonth option", (os) => os.map((o) => o.value).filter(Boolean));
    const current = await page.inputValue("#domesticOriginsMonth");
    // A non-default month that still has an adjacent prior month to compare
    // against (never the earliest, never the current default).
    const candidate = months.find((m) => m !== current && m !== months[months.length - 1]) || months.find((m) => m !== current);
    await page.selectOption("#domesticOriginsMonth", candidate);
    await page.waitForFunction((m) => document.getElementById("domesticOriginsMonth").value === m, candidate);
    await page.waitForFunction(() => {
      const shared = document.getElementById("domesticOriginDynamicsShared");
      return shared && !shared.hidden;
    }).catch(() => {});
    // Wait until the rendered table and the captured projection agree, so any
    // late async re-render (destination/origins load settling) has quiesced. If
    // they never agree that is a real capture bug and this times out loudly.
    await page.waitForFunction(() => {
      const dom = document.querySelectorAll("#domesticOriginDynamicsSharedRows tr").length;
      const projection = window.__HALO_REGRESSION__.k11Projection();
      const shared = (projection && projection.values || []).filter((v) => v.id.startsWith("dynamics_sharedrow_")).length;
      return dom > 0 && dom === shared;
    });

    const domRows = await page.$$eval("#domesticOriginDynamicsSharedRows tr", (rows) => rows.map((r) => {
      const tds = [...r.querySelectorAll("td")];
      return {
        code: r.querySelector(".muted")?.textContent?.trim(),
        prev: tds[1]?.textContent?.trim(),
        curr: tds[2]?.textContent?.trim(),
        change: tds[3]?.textContent?.trim(),
      };
    }));
    const bundle = await seam(page, () => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    const shared = reading.values.filter((v) => v.id.startsWith("dynamics_sharedrow_"));
    assert.equal(shared.length, domRows.length, "one exported shared-origin value per rendered row");
    const byCode = new Map(shared.map((v) => [v.id.replace("dynamics_sharedrow_", ""), v]));
    for (const row of domRows) {
      const v = byCode.get(row.code);
      assert.ok(v, `exported shared value exists for ${row.code}`);
      if (row.change === "—") {
        assert.equal(v.state, "WITHHELD", `${row.code}: a suppressed/incomparable change is WITHHELD`);
        assert.equal(v.absolute_change, null, `${row.code}: no fabricated absolute change`);
        assert.equal(v.percent_change, null, `${row.code}: no fabricated percent change`);
      } else {
        assert.equal(v.state, "VALID", `${row.code}: a stated change is VALID`);
        assert.ok(Number.isFinite(v.absolute_change) && Number.isFinite(v.percent_change), `${row.code}: carries the model's own change`);
        assert.ok(v.display && v.display.includes("→"), `${row.code}: display transcribes prev → current`);
      }
    }
    assert.ok(reading.values.some((v) => v.id.startsWith("dynamics_sharedrow_")), "shared-origin rows exported for a non-default month");
  } finally {
    await close(page);
  }
});
