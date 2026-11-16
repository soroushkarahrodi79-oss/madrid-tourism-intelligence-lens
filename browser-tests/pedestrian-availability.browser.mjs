// Regression cover for the Pedestrian Counters activation path (#187).
//
// WHAT FAILED. data/pedestrian_activity.json is built by CI
// (.github/workflows/deploy-pages.yml), so every plain checkout ships the
// committed `available: false` stub. The control was therefore `disabled` with a
// `title` tooltip as its only explanation — invisible on touch, and unreachable
// by keyboard because a disabled input is not focusable. The row looked identical
// to a working layer and silently refused to activate.
//
// Separately, the toggle was wired AFTER the required-artifact Promise.all and
// after the heavy `loadAllLayers` await, so any upstream failure left it in its
// markup state: enabled, with zero stations, able to switch on an empty layer.
//
// These tests pin the three properties that fix those: the unavailable state is
// VISIBLE and FOCUSABLE with a stated reason, activation is REFUSED rather than
// silently ineffective, and the control is settled INDEPENDENTLY of the POI
// pipeline. Real published data must still activate normally.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".geojson": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, data) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(data);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const port = server.address().port;

// Two stations inside the default Lens A circle (40.4149, -3.69, r 900 m), so an
// activated layer has
// something to report; the figures are fixture values, never published evidence.
const PUBLISHED_FIXTURE = Object.freeze({
  available: true,
  generatedAt: "2026-01-01T00:00:00Z",
  source: { dataset: "fixture", datasetUrl: "https://example.invalid", year: 2024 },
  scope: { latMin: 40.385, latMax: 40.455, lonMin: -3.745, lonMax: -3.645 },
  recordSemantics: "Fixture records; not published evidence.",
  stations: [
    { id: "F1", name: "Fixture counter one", lat: 40.4149, lon: -3.69, meanObserved: 800, observationCount: 1000, dateMin: "2024-01-01", dateMax: "2024-12-31" },
    { id: "F2", name: "Fixture counter two", lat: 40.4160, lon: -3.688, meanObserved: 1200, observationCount: 1000, dateMin: "2024-01-01", dateMax: "2024-12-31" },
  ],
  stationCount: 2,
  observationCount: 2000,
  dateMin: "2024-01-01",
  dateMax: "2024-12-31",
});

async function openApp({ pedestrian = null, breakRequiredArtifact = false, locale = null, appearance = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem("madrid-lens-appearance", value), appearance);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message)));
  await page.route("**/*", (route) => {
    const hostname = new URL(route.request().url()).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" ? route.continue() : route.abort();
  });
  if (pedestrian) {
    await page.route("**/data/pedestrian_activity.json*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pedestrian) }));
  }
  if (breakRequiredArtifact) {
    await page.route("**/data/snapshot_poi.json*", (route) =>
      route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" }));
  }
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  if (locale) await page.locator("#languageSelect").selectOption(locale);
  await page.waitForFunction(() => {
    const row = document.querySelector('[data-layer-row="pedestrian"]');
    return Boolean(row && row.dataset.state);
  });
  return { context, page, pageErrors };
}

const readRow = (page) => page.evaluate(() => {
  const toggle = document.querySelector('[data-layer="pedestrian"]');
  const state = document.getElementById("pedestrianLayerState");
  return {
    disabledProperty: toggle.disabled,
    ariaDisabled: toggle.getAttribute("aria-disabled"),
    describedBy: toggle.getAttribute("aria-describedby"),
    accessibleName: toggle.getAttribute("aria-label"),
    rowState: document.querySelector('[data-layer-row="pedestrian"]').dataset.state,
    reasonHidden: state.hidden,
    reasonText: (state.textContent || "").trim(),
    reasonId: state.id,
    checked: toggle.checked,
    cardHidden: document.getElementById("pedestrianCard").hidden,
  };
});

test("a checkout without the deployment snapshot states why the layer is unavailable", async () => {
  const { context, page, pageErrors } = await openApp();
  const row = await readRow(page);
  assert.equal(row.rowState, "unavailable");
  // The reason must be VISIBLE, not a tooltip, and must be the element the
  // control's accessible description points at.
  assert.equal(row.reasonHidden, false);
  assert.equal(row.describedBy, row.reasonId);
  assert.match(row.reasonText, /Unavailable in this build/);
  assert.match(row.reasonText, /deployment time/);
  assert.ok(row.accessibleName, "the control keeps an accessible name");
  // `disabled` is what hid the reason from keyboard users; aria-disabled replaces it.
  assert.equal(row.disabledProperty, false);
  assert.equal(row.ariaDisabled, "true");
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("the unavailable control is reachable by keyboard and refuses activation", async () => {
  const { context, page } = await openApp();
  const reached = await page.evaluate(() => {
    const toggle = document.querySelector('[data-layer="pedestrian"]');
    toggle.focus();
    return document.activeElement === toggle;
  });
  assert.equal(reached, true, "an aria-disabled control stays in the tab order");
  // `force` is required and is itself part of the result: Playwright's own
  // actionability check already refuses the control as not enabled, which is the
  // behaviour assistive tooling sees. Forcing the click past that check proves the
  // application ALSO refuses it, rather than relying on the browser to.
  await page.locator('[data-layer-row="pedestrian"] .switch span').click({ force: true });
  const afterPointer = await readRow(page);
  assert.equal(afterPointer.checked, false);
  assert.equal(afterPointer.cardHidden, true);
  await page.keyboard.press("Space");
  const afterKeyboard = await readRow(page);
  assert.equal(afterKeyboard.checked, false, "Space on the refused control leaves it off");
  assert.equal(afterKeyboard.cardHidden, true);
  assert.equal(afterKeyboard.rowState, "unavailable");
  await context.close();
});

test("the unavailable reason is translated, not English-only", async () => {
  const { context, page } = await openApp({ locale: "es" });
  const row = await readRow(page);
  assert.equal(row.rowState, "unavailable");
  assert.match(row.reasonText, /No disponible en esta compilación/);
  assert.doesNotMatch(row.reasonText, /Unavailable in this build/);
  await context.close();
});

test("a published snapshot activates the layer and opens its reading", async () => {
  const { context, page, pageErrors } = await openApp({ pedestrian: PUBLISHED_FIXTURE });
  const before = await readRow(page);
  assert.equal(before.rowState, "available");
  assert.equal(before.ariaDisabled, "false");
  assert.equal(before.reasonHidden, true, "no refusal text is shown when evidence exists");
  await page.locator('[data-layer-row="pedestrian"] .switch span').click();
  const after = await readRow(page);
  assert.equal(after.checked, true);
  assert.equal(after.cardHidden, false, "switching the layer on opens the PLACE Detail reading");
  const reading = await page.evaluate(() => ({
    value: document.getElementById("pedestrianValue").textContent.trim(),
    foot: document.getElementById("pedestrianFoot").textContent.trim(),
  }));
  // Both fixture stations sit inside the default Lens A circle, so the weighted
  // mean of 800 and 1200 over equal observation counts is exactly 1000.
  assert.match(reading.value, /^1,000\b/);
  assert.match(reading.foot, /2 counters/);
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("a failed required artifact neither disables nor silently enables the layer", async () => {
  const { context, page, pageErrors } = await openApp({ pedestrian: PUBLISHED_FIXTURE, breakRequiredArtifact: true });
  const row = await readRow(page);
  // The pedestrian artifact is resolved independently of the POI pipeline, so a
  // broken required artifact must not decide whether this layer is offered.
  assert.equal(row.rowState, "available");
  assert.equal(row.ariaDisabled, "false");
  // ...and the upstream failure must be NAMED, not swallowed as an opaque parse error.
  assert.ok(
    pageErrors.some((message) => /required artifact data\/snapshot_poi\.json responded 404/.test(message)),
    `the boot failure must name the artifact and status, got: ${JSON.stringify(pageErrors)}`,
  );
  await context.close();
});

test("the refused control keeps a visible focus ring in every appearance", async () => {
  for (const appearance of ["light", "dark"]) {
    const { context, page } = await openApp({ appearance });
    const outline = await page.evaluate(() => {
      const toggle = document.querySelector('[data-layer="pedestrian"]');
      toggle.focus();
      const track = toggle.nextElementSibling;
      const style = getComputedStyle(track);
      return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
    });
    assert.notEqual(outline.style, "none", `${appearance}: the focused control must show an outline`);
    assert.ok(parseFloat(outline.width) >= 2, `${appearance}: focus outline must be at least 2px, got ${outline.width}`);
    await context.close();
  }
});

test.after(async () => {
  await browser.close();
  server.close();
});
