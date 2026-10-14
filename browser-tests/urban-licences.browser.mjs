import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Granted urban licences (K9, #71) browser contract.
//
// Semantic DOM assertions against the REAL render path and the REAL committed
// artifact (data/planning/madrid_urban_licences.json). The contracts it defends
// in the browser:
//
//   * The layer is OFF by default and opt-in; its four states (OFF, UNAVAILABLE,
//     NO_MATCHES, AVAILABLE) are distinct DOM, never collapsed.
//   * Three licence families render as three separate figures; no rendered
//     element is a cross-family total.
//   * The grant-date window is bounded to the register's real extent — it cannot
//     be set outside it — and the applied window is always stated as dates.
//   * The resolved match rate and the granted-only / granted≠built ceilings
//     render inline, not drawer-only.
//   * A genuine zero inside the Lens (NO_MATCHES) is distinct from unavailable
//     and from OFF.
//   * The asserting surface uses none of the forbidden vocabulary (built,
//     approval rate, density, …) in either language; the denial copy may.
//   * The evidence drawer carries ADDRESS_POINT provenance for both the register
//     and the official callejero crosswalk, with current/historical matching.
//   * Per-record historical-only and address-text-disagreement provenance is
//     inspectable.
//   * The surface works at 390px without horizontal overflow.
//   * The browser makes NO runtime request to datos.madrid.es / geoportal.

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

const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "planning", "madrid_urban_licences.json"), "utf8"));

// Fixtures verified against the committed artifact.
const HISTORICAL_ID = "k9-00017"; // crosswalk_state NDP_FOUND_HISTORICAL_ONLY
const DISAGREEMENT_ID = "k9-00010"; // address_text_agrees === false
const EXTENT = artifact.date_extent; // { min: "2023-01-13", max: "2026-09-30" }

// A runtime request to an official source host is forbidden: K9 reads the
// committed artifact only. (Mirrors the planning K6 contract, for licence hosts.)
function isForbiddenLicenceRuntimeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const officialHost = ["datos.madrid.es", "geoportal.madrid.es", "sigma.madrid.es"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
  const href = url.href.toLowerCase();
  const licenceDataset = href.includes("640505") || href.includes("213605") || href.includes("licencias-urbanisticas");
  return officialHost || licenceDataset;
}

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

async function newPage(viewport = { width: 1366, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const requests = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    requests.push(url);
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  return { page, requests };
}

const seamState = (page) => page.evaluate(() => document.getElementById("urbanLicences").dataset.licenceState);
const enableLicences = (page) => page.evaluate(() => window.__HALO_REGRESSION__.enableLicences());
const snapshot = (page) => page.evaluate(() => window.__HALO_REGRESSION__.licenceSnapshot());
const setWindow = (page, from, to) => page.evaluate(([f, t]) => window.__HALO_REGRESSION__.setLicenceWindow(f, t), [from, to]);
const moveLens = (page, lat, lon) => page.evaluate(([la, lo]) => window.__HALO_REGRESSION__.moveLensToLatLng("A", la, lo), [lat, lon]);

test("K9 1: layer is OFF by default — section hidden, no markers, toggle off", async () => {
  const { page } = await newPage();
  assert.equal(await seamState(page), "OFF");
  assert.equal(await page.locator("#urbanLicences").evaluate((n) => n.hidden), true);
  assert.equal(await page.locator('[data-layer="licences"]').evaluate((n) => n.checked), false);
  assert.equal(await page.locator('[data-layer="licences"]').getAttribute("aria-checked"), "false");
  const snap = await snapshot(page);
  assert.equal(snap.mapMarkers, 0);
  await page.context().close();
});

test("K9 2: opt-in enables the layer — AVAILABLE, section visible, markers drawn", async () => {
  const { page } = await newPage();
  const state = await enableLicences(page);
  assert.equal(state, "ready");
  assert.equal(await seamState(page), "AVAILABLE");
  assert.equal(await page.locator("#urbanLicences").evaluate((n) => n.hidden), false);
  assert.equal(await page.locator("#licBody").evaluate((n) => n.hidden), false);
  assert.equal(await page.locator('[data-layer="licences"]').getAttribute("aria-checked"), "true");
  const snap = await snapshot(page);
  assert.ok(snap.mapMarkers > 0, "resolved licence points render on the map");
  await page.context().close();
});

test("K9 3: three families render as three figures and no cross-family total", async () => {
  const { page } = await newPage();
  await enableLicences(page);
  const b = Number(await page.locator("#licCountBuilding").textContent());
  const a = Number(await page.locator("#licCountActivity").textContent());
  const t = Number(await page.locator("#licCountTemporary").textContent());
  assert.ok(Number.isFinite(b) && Number.isFinite(a) && Number.isFinite(t));
  // No rendered number in the section equals the cross-family sum: there is no
  // total figure anywhere on the surface.
  const total = b + a + t;
  const numbers = await page.locator("#urbanLicences").evaluate((root) =>
    [...root.querySelectorAll("*")]
      .filter((el) => el.children.length === 0)
      .map((el) => el.textContent.replace(/[.,\s]/g, ""))
      .filter((s) => /^\d+$/.test(s))
      .map(Number)
  );
  // The per-family counts themselves are allowed; the SUM must not appear as its
  // own figure (unless it coincidentally equals a family count, which for the
  // fixture it does not).
  if (![b, a, t].includes(total)) {
    assert.ok(!numbers.includes(total), `the cross-family total ${total} must not be rendered`);
  }
  await page.context().close();
});

test("K9 4: the grant-date window is bounded to the register and cannot exceed it", async () => {
  const { page } = await newPage();
  await enableLicences(page);
  // Inputs carry the extent as min/max.
  assert.equal(await page.locator("#licFrom").getAttribute("min"), EXTENT.min);
  assert.equal(await page.locator("#licFrom").getAttribute("max"), EXTENT.max);
  assert.equal(await page.locator("#licTo").getAttribute("max"), EXTENT.max);
  // A request beyond the extent clamps to the extent — never open-ended history.
  await setWindow(page, "2000-01-01", "2099-12-31");
  const snap = await snapshot(page);
  assert.equal(snap.window.from, EXTENT.min);
  assert.equal(snap.window.to, EXTENT.max);
  // The applied window is always stated as explicit dates (never "recent").
  const applied = await page.locator("#licWindowApplied").textContent();
  assert.match(applied, /\d{4}/);
  await page.context().close();
});

test("K9 5: temporal filtering changes the counts; a single empty day is NO_MATCHES", async () => {
  const { page } = await newPage();
  await enableLicences(page);
  const wide = await snapshot(page);
  await setWindow(page, EXTENT.min, EXTENT.min); // a single day
  const narrow = await snapshot(page);
  assert.equal(await seamState(page), "NO_MATCHES");
  assert.equal(narrow.perFamily.BUILDING_URBANISTIC_LICENCE_FAMILY, 0);
  assert.equal(narrow.perFamily.ACTIVITY_LICENCE_FAMILY, 0);
  assert.equal(narrow.perFamily.TEMPORARY_ACTIVITY_FAMILY, 0);
  assert.equal(await page.locator("#licNoMatches").evaluate((n) => n.hidden), false);
  // The default window had at least one family populated.
  const wideTotal =
    wide.perFamily.BUILDING_URBANISTIC_LICENCE_FAMILY +
    wide.perFamily.ACTIVITY_LICENCE_FAMILY +
    wide.perFamily.TEMPORARY_ACTIVITY_FAMILY;
  assert.ok(wideTotal > 0, "the default window shows some licences");
  await page.context().close();
});

test("K9 6: resolved coverage and the unmatched residual are disclosed with the figures", async () => {
  const { page } = await newPage();
  await enableLicences(page);
  const coverage = await page.locator("#licCoverage").textContent();
  assert.match(coverage, /97\.97/);
  assert.match(coverage, /11,265/);
  assert.match(coverage, /11,498/);
  const unmatched = await page.locator("#licUnmatched").textContent();
  assert.match(unmatched, /233/);
  // Residual classes are listed, not hidden.
  const residuals = await page.locator("#licResidualList li").count();
  assert.ok(residuals >= 3, "residual classes are enumerated");
  await page.context().close();
});

test("K9 7: the granted-only and granted≠built ceilings render inline", async () => {
  const { page } = await newPage();
  await enableLicences(page);
  const ceiling = await page.locator(".lic-ceiling").textContent();
  assert.match(ceiling, /not built|granted is not built/i);
  assert.match(ceiling, /no approval|approval.*rate/i);
  assert.match(ceiling, /never summed|cross-family/i);
  await page.context().close();
});

test("K9 8: OFF, NO_MATCHES and AVAILABLE are three distinct states", async () => {
  const { page } = await newPage();
  assert.equal(await seamState(page), "OFF");
  await enableLicences(page);
  assert.equal(await seamState(page), "AVAILABLE");
  await setWindow(page, EXTENT.min, EXTENT.min);
  assert.equal(await seamState(page), "NO_MATCHES");
  // UNAVAILABLE is a fourth, separate state reserved for a missing artifact; the
  // model and the markup both carry it (asserted structurally below).
  const hasUnavailableEl = await page.locator("#licUnavailable").count();
  assert.equal(hasUnavailableEl, 1);
  await page.context().close();
});

test("K9 9: the asserting surface uses no forbidden vocabulary (EN and ES)", async () => {
  // Words that would MISREAD the register. They may appear only in DENIAL copy
  // (the ceiling, citizen reading, provenance, no-matches and unmatched blocks),
  // which is removed before the scan.
  const forbidden = [
    /\bbuilt\b/i, /\bconstructed\b/i, /\bcompleted\b/i, /\boccupied\b/i,
    /\bapproval rate\b/i, /\brejection\b/i, /\bdenied\b/i, /\binvestment\b/i,
    /\bdensity\b/i, /\bheatmap\b/i, /\bchoropleth\b/i,
    /\bconstruida\b/i, /\bconstruido\b/i, /\bfinalizada\b/i, /\bocupada\b/i,
    /tasa de aprobaci/i, /\brechazada\b/i, /\bdenegada\b/i, /\binversi[óo]n\b/i,
    /\bdensidad\b/i, /mapa de calor/i,
  ];
  async function scanAssertingText(page) {
    return page.locator("#urbanLicences").evaluate((root) => {
      const clone = root.cloneNode(true);
      for (const sel of [".lic-ceiling", ".lic-citizen", ".lic-provenance", ".lic-nomatches", ".lic-unavailable", ".lic-unmatched"]) {
        for (const el of clone.querySelectorAll(sel)) el.remove();
      }
      return clone.textContent.replace(/\s+/g, " ");
    });
  }
  const { page } = await newPage();
  await enableLicences(page);
  for (const lang of ["en", "es"]) {
    await page.selectOption("#languageSelect", lang);
    await page.waitForFunction((l) => document.documentElement.lang === l, lang);
    const text = await scanAssertingText(page);
    for (const re of forbidden) {
      assert.ok(!re.test(text), `asserting surface (${lang}) must not contain ${re}`);
    }
  }
  await page.context().close();
});

test("K9 10: Spanish and English copy both render; official tipo stays verbatim", async () => {
  const { page } = await newPage();
  await enableLicences(page);
  await page.selectOption("#languageSelect", "es");
  await page.waitForFunction(() => document.documentElement.lang === "es");
  assert.match(await page.locator("#licSectionHeading").textContent(), /Licencias urbanísticas otorgadas/);
  assert.match(await page.locator("#licCoverage").textContent(), /Cartografiado/);
  // Official value is carried verbatim in both languages.
  const esPopup = await page.evaluate((id) => window.__HALO_REGRESSION__.licencePopup(id), DISAGREEMENT_ID);
  assert.match(esPopup, /Licencia urbanística residencial/);
  await page.selectOption("#languageSelect", "en");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  assert.match(await page.locator("#licSectionHeading").textContent(), /Granted urban licences/);
  await page.context().close();
});

test("K9 11: the evidence drawer carries ADDRESS_POINT provenance for both sources", async () => {
  const { page } = await newPage();
  await enableLicences(page);
  await page.click("#licSourceToggle");
  await page.waitForFunction(() => document.getElementById("evidenceDrawer").open === true);
  const scopes = await page.locator("#evidenceDrawer [data-scope]").evaluateAll((nodes) => nodes.map((n) => n.dataset.scope));
  assert.ok(scopes.includes("ADDRESS_POINT"), "the drawer shows the ADDRESS_POINT scope");
  const drawerText = await page.locator("#evidenceDrawer").textContent();
  assert.match(drawerText, /Granted urban licences/i);
  assert.match(drawerText, /callejero/i); // the official crosswalk source is present
  assert.match(drawerText, /granted|not.*built|approval/i); // the interpretation ceiling rides along
  await page.context().close();
});

test("K9 12: per-record historical-only and address-text-disagreement are inspectable", async () => {
  const { page } = await newPage();
  await enableLicences(page);
  const hist = await page.evaluate((id) => window.__HALO_REGRESSION__.licencePopup(id), HISTORICAL_ID);
  assert.match(hist, /Historical-only recovery|polygon-derived/i);
  assert.match(hist, /not evidence of construction/i);
  const dis = await page.evaluate((id) => window.__HALO_REGRESSION__.licencePopup(id), DISAGREEMENT_ID);
  assert.match(dis, /Address text disagrees|NDP identity/i);
  await page.context().close();
});

test("K9 13: the surface works at 390px without horizontal overflow", async () => {
  const { page } = await newPage({ width: 390, height: 844 });
  await enableLicences(page);
  await moveLens(page, 40.4165, -3.7026); // central Madrid
  assert.equal(await page.locator("#urbanLicences").evaluate((n) => n.hidden), false);
  // The three family figures are all present.
  for (const id of ["licCountBuilding", "licCountActivity", "licCountTemporary"]) {
    assert.equal(await page.locator(`#${id}`).count(), 1);
  }
  // No horizontal page overflow at 390px.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `no horizontal overflow at 390px (got ${overflow}px)`);
  await page.context().close();
});

test("K9 15: a licence point on the map is clickable and opens its granted-only popup", async () => {
  const { page } = await newPage();
  await enableLicences(page);
  await setWindow(page, EXTENT.min, EXTENT.max); // full extent so any record is rendered
  const rec = artifact.records[0];
  // Pan the real Leaflet map to the record and click its projected pixel. The
  // licence canvas pane must sit above the POI overlay canvas, or the POI canvas
  // would swallow the click and the bound popup would never open.
  const pix = await page.evaluate(({ lat, lon }) => {
    map.setView([lat, lon], 18, { animate: false });
    const p = map.latLngToContainerPoint([lat, lon]);
    const r = document.getElementById("map").getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, rec);
  await page.mouse.click(pix.x, pix.y);
  const popup = await page
    .locator(".leaflet-popup-content")
    .textContent({ timeout: 5000 })
    .catch(() => null);
  assert.ok(popup, "clicking a licence point opens a popup");
  assert.match(popup, /not evidence of construction|administrative grant/i);
});

test("K9 14: no runtime request to an official licence source host", async () => {
  const { page, requests } = await newPage();
  await enableLicences(page);
  await setWindow(page, "2024-01-01", "2026-09-30");
  await moveLens(page, 40.4165, -3.7026);
  const offending = requests.filter(isForbiddenLicenceRuntimeUrl);
  assert.deepEqual(offending, [], `no official-source request; saw ${offending.join(", ")}`);
  await page.context().close();
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});
