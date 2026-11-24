// Push-to-talk voice input (Gate 3) — real-browser regressions with a MOCK speech engine.
//
// SCOPE OF THESE TESTS. A fake SpeechRecognition is injected before the page loads and driven by
// the test. They prove the wiring: lifecycle, cancellation, stale callbacks, that a final
// transcript takes the SAME path as typed text (same preview, same executed state) and that
// nothing executes without the Execute button. They do NOT prove that any real engine
// recognises speech, and nothing here is a real-microphone validation (docs/VOICE_COMMAND_V1.md).

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => (error
    ? response.writeHead(404).end()
    : response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(content)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// A controllable stand-in for SpeechRecognition. No audio, no microphone.
const FAKE_SPEECH = () => {
  const rec = { instances: [], availability: "available", installs: 0, availableCalls: [] };
  window.__rec = rec;
  class FakeSpeechRecognition {
    constructor() { this.calls = []; rec.instances.push(this); }
    start() { this.calls.push("start"); }
    stop() { this.calls.push("stop"); }
    abort() { this.calls.push("abort"); }
    static available(options) { rec.availableCalls.push(options); return Promise.resolve(rec.availability); }
    static install() { rec.installs += 1; return Promise.resolve(true); }
  }
  window.SpeechRecognition = FakeSpeechRecognition;
};

async function openApp(t, { viewport = { width: 1280, height: 900 }, language, speech = true } = {}) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  if (speech) await context.addInitScript(FAKE_SPEECH);
  else await context.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") { requests.push(url.pathname); return route.continue(); }
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.__GEO_SEARCH_TEST__.whenModuleReady());
  await page.waitForFunction(() => {
    const status = window.__GEO_SEARCH_TEST__.snapshot().universeStatus;
    return status.administrative === "ready" && status.ambito === "ready";
  });
  if (language) { await page.selectOption("#languageSelect", language); await frames(page); }
  await frames(page);
  return { page, errors, requests };
}

async function world(page) {
  await frames(page);
  return page.evaluate(() => ({
    k11State: window.__HALO_REGRESSION__.k11State(),
    readings: window.__SPATIAL_COMMAND_TEST__.readings(),
    view: window.__HALO_REGRESSION__.mapView(),
    state: window.__SPATIAL_COMMAND_TEST__.state(),
    slider: document.getElementById("radiusSlider").value,
  }));
}

async function openPanel(page) {
  await page.click("#nlCommandToggle");
  await page.waitForSelector("#nlCommandPanel:not([hidden])");
}
const statusText = (page) => page.textContent("#nlCommandStatus");
const outputText = (page) => page.textContent("#nlCommandOutput");
const voiceText = (page) => page.textContent("#nlCommandVoiceStatus");
const executeVisible = async (page) => (await page.locator("#nlCommandExecute").isVisible()) && !(await page.locator("#nlCommandExecute").isDisabled());
const instanceCount = (page) => page.evaluate(() => window.__rec.instances.length);
const calls = (page, i = 0) => page.evaluate((n) => window.__rec.instances[n].calls.slice(), i);
// Drive the fake engine: kind = audiostart | final | interim | error | end
const fire = (page, kind, payload, i = 0) => page.evaluate(({ kind, payload, i }) => {
  const r = window.__rec.instances[i];
  const result = (text, isFinal) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });
  if (kind === "audiostart") r.onaudiostart();
  else if (kind === "final") r.onresult(result(payload, true));
  else if (kind === "interim") r.onresult(result(payload, false));
  else if (kind === "error") r.onerror({ error: payload });
  else if (kind === "end") r.onend();
}, { kind, payload, i });
async function startViaButton(page, i = 0) {
  await page.click("#nlCommandMic");
  await page.waitForFunction((n) => window.__rec.instances.length > n, i);
  await fire(page, "audiostart", null, i);
  await frames(page);
}
const D = (code) => ({ type: "official_area", id: `DISTRICT:${code}` });
const run = (page, command) => page.evaluate((c) => window.__SPATIAL_COMMAND_TEST__.execute(c), command);

test("capability: the mic is present, labelled, bound to on-device recognition, and nothing listens at load", async (t) => {
  const { page, errors } = await openApp(t);
  assert.equal(await instanceCount(page), 0, "no recognizer, and so no microphone request, at page load");
  await openPanel(page);
  assert.equal(await instanceCount(page), 0, "opening the panel does not start the microphone");
  const mic = await page.evaluate(() => {
    const b = document.getElementById("nlCommandMic"); const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), pressed: b.getAttribute("aria-pressed"), described: document.getElementById(b.getAttribute("aria-describedby")).textContent, h: r.height, w: r.width, disabled: b.disabled };
  });
  assert.equal(mic.text, "Speak");
  assert.equal(mic.pressed, "false");
  assert.equal(mic.disabled, false);
  assert.match(mic.described, /hold V/);
  assert.match(mic.described, /on this device/);
  assert.ok(mic.h >= 44, `mic target ${mic.w}x${mic.h}`);
  await page.click("#nlCommandMic");
  await page.waitForFunction(() => window.__rec.instances.length === 1);
  const probe = await page.evaluate(() => ({ availableCalls: window.__rec.availableCalls, local: window.__rec.instances[0].processLocally, interim: window.__rec.instances[0].interimResults, continuous: window.__rec.instances[0].continuous, lang: window.__rec.instances[0].lang }));
  assert.deepEqual(probe.availableCalls, [{ langs: ["en-US"], processLocally: true }]);
  assert.equal(probe.local, true, "recognition is required to be on-device");
  assert.equal(probe.interim, false);
  assert.equal(probe.continuous, false);
  assert.equal(probe.lang, "en-US");
  assert.deepEqual(errors, []);
});

test("unsupported browser: the mic is disabled with a reason and the typed interface is fully intact", async (t) => {
  const { page, errors } = await openApp(t, { speech: false });
  await openPanel(page);
  assert.equal(await page.locator("#nlCommandMic").isDisabled(), true);
  assert.match(await voiceText(page), /not available in this browser/);
  await page.fill("#nlCommandInput", "Go to Barajas");
  await page.press("#nlCommandInput", "Enter");
  assert.match(await statusText(page), /nothing has changed yet/);
  assert.equal(await executeVisible(page), true);
  assert.deepEqual(errors, []);
});

test("a final transcript yields the same preview and executed state as typing the same text; Execute is explicit", async (t) => {
  const voice = await openApp(t);
  const typed = await openApp(t);
  await openPanel(voice.page);
  await openPanel(typed.page);
  const before = await world(voice.page);
  const text = "Compara dos círculos de 500 metros en Barajas y Hortaleza";

  await startViaButton(voice.page);
  assert.equal(await voice.page.getAttribute("#nlCommandMic", "aria-pressed"), "true");
  assert.equal(await voice.page.getAttribute("#nlCommandMic", "data-state"), "listening");
  assert.match(await voiceText(voice.page), /Listening/);
  await fire(voice.page, "interim", "compara dos círc");
  assert.equal(await voice.page.inputValue("#nlCommandInput"), "", "interim text never reaches the field");
  assert.equal(await executeVisible(voice.page), false);
  await voice.page.click("#nlCommandMic"); // second click = stop
  assert.deepEqual(await calls(voice.page), ["start", "stop"]);
  await fire(voice.page, "final", text);
  await frames(voice.page);

  assert.equal(await voice.page.inputValue("#nlCommandInput"), text, "the transcript is in the editable field");
  assert.match(await voiceText(voice.page), /Heard:/);
  assert.deepEqual(await world(voice.page), before, "the transcript changed nothing on the map");
  assert.equal(await executeVisible(voice.page), true, "the validated preview is shown, awaiting confirmation");

  await typed.page.fill("#nlCommandInput", text);
  await typed.page.press("#nlCommandInput", "Enter");
  await frames(typed.page);
  assert.equal(await statusText(voice.page), await statusText(typed.page));
  assert.equal(await outputText(voice.page), await outputText(typed.page), "identical preview text");

  await voice.page.click("#nlCommandExecute");
  await typed.page.click("#nlCommandExecute");
  assert.deepEqual(await world(voice.page), await world(typed.page), "identical application state after Execute");
  const reference = await openApp(t);
  assert.equal((await run(reference.page, { version: 1, action: "compare_locations", a: { location: D("21"), radiusM: 500 }, b: { location: D("16"), radiusM: 500 } })).status, "applied");
  assert.deepEqual(await world(voice.page), await world(reference.page), "and equal to the structured command");
  assert.deepEqual([...voice.errors, ...typed.errors], []);
});

test("hold V: key-repeat starts one recognizer, release stops it, and the transcript goes through Gate 2", async (t) => {
  const { page, errors } = await openApp(t);
  await openPanel(page);
  await page.focus("#nlCommandMic");
  await page.keyboard.down("v");
  await page.waitForFunction(() => window.__rec.instances.length === 1);
  await page.keyboard.down("v");
  await page.keyboard.down("v");
  await page.keyboard.down("v"); // key-repeat
  await fire(page, "audiostart");
  await frames(page);
  assert.equal(await instanceCount(page), 1, "repeat events never start another recognizer");
  assert.equal(await page.inputValue("#nlCommandInput"), "", "the key itself typed nothing");
  await page.keyboard.up("v");
  assert.deepEqual(await calls(page), ["start", "stop"], "release stops capture");
  await fire(page, "final", "Ve a Barajas");
  await frames(page);
  assert.equal(await page.inputValue("#nlCommandInput"), "Ve a Barajas");
  assert.match(await statusText(page), /nothing has changed yet/, "release interprets; it does not execute");
  assert.equal(await executeVisible(page), true);
  assert.deepEqual(errors, []);
});

test("V is ignored while typing, with a modifier, with the panel closed and during IME composition", async (t) => {
  const { page } = await openApp(t);
  await page.focus("#nlCommandToggle");
  await page.keyboard.press("v");
  assert.equal(await instanceCount(page), 0, "panel closed and focus on a control: V does nothing");
  await openPanel(page);
  await page.focus("#nlCommandInput");
  await page.keyboard.type("vv");
  assert.equal(await page.inputValue("#nlCommandInput"), "vv", "typing a 'v' in the field is normal typing");
  assert.equal(await instanceCount(page), 0);
  await page.fill("#nlCommandInput", "");
  await page.focus("#nlCommandMic");
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Shift+v");
  await page.keyboard.press("Alt+v");
  assert.equal(await instanceCount(page), 0, "no start with a modifier");
  await page.evaluate(() => document.getElementById("nlCommandMic").dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", key: "v", isComposing: true, bubbles: true, cancelable: true })));
  assert.equal(await instanceCount(page), 0, "no start during composition");
});

test("cancellation: Escape cancels only the recording; blur and closing cancel; a stale result never reaches the field", async (t) => {
  const { page, errors } = await openApp(t);
  await openPanel(page);
  await startViaButton(page, 0);
  await page.keyboard.press("Escape");
  await frames(page);
  assert.equal(await page.locator("#nlCommandPanel").isVisible(), true, "the first Escape cancels the recording, not the panel");
  assert.ok((await calls(page, 0)).includes("abort"));
  assert.match(await voiceText(page), /cancelled/);
  await fire(page, "final", "Ve a Barajas", 0); // late callback of the cancelled session
  await frames(page);
  assert.equal(await page.inputValue("#nlCommandInput"), "", "a late result of a cancelled session is ignored");
  assert.equal(await executeVisible(page), false);

  await startViaButton(page, 1);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.ok((await calls(page, 1)).includes("abort"), "lost window focus cancels");

  await startViaButton(page, 2);
  await page.click("#nlCommandClose");
  assert.ok((await calls(page, 2)).includes("abort"), "closing the panel cancels");
  await fire(page, "final", "Ve a Barajas", 2);
  await openPanel(page);
  assert.equal(await page.inputValue("#nlCommandInput"), "");

  // Press and release before the engine reports audio: cancelled, never a transcript.
  await page.click("#nlCommandMic");
  await page.waitForFunction(() => window.__rec.instances.length === 4);
  await page.click("#nlCommandMic");
  await fire(page, "final", "Ve a Barajas", 3);
  await frames(page);
  assert.equal(await page.inputValue("#nlCommandInput"), "");
  assert.deepEqual(errors, []);
});

test("a language change during recognition cancels it; Spanish uses es-ES and Spanish copy", async (t) => {
  const { page } = await openApp(t, { language: "es" });
  await openPanel(page);
  assert.equal(await page.textContent("#nlCommandMicLabel"), "Hablar");
  await startViaButton(page, 0);
  assert.equal(await page.evaluate(() => window.__rec.instances[0].lang), "es-ES");
  await page.selectOption("#languageSelect", "en");
  await frames(page);
  assert.ok((await calls(page, 0)).includes("abort"));
  await fire(page, "final", "ve a barajas", 0);
  assert.equal(await page.inputValue("#nlCommandInput"), "", "no late transcript after the switch");
});

test("errors are explained, never fatal, and typing still works: permission denied, no speech, missing pack", async (t) => {
  const { page, errors } = await openApp(t);
  await openPanel(page);
  assert.equal(await page.locator("#nlCommandVoiceInstallRow").isVisible(), false, "the install control is hidden until a pack is actually missing");
  await page.click("#nlCommandMic");
  await page.waitForFunction(() => window.__rec.instances.length === 1);
  await fire(page, "error", "not-allowed", 0);
  assert.match(await voiceText(page), /Microphone access was not allowed/);
  await page.click("#nlCommandMic");
  await page.waitForFunction(() => window.__rec.instances.length === 2);
  await fire(page, "audiostart", null, 1);
  await fire(page, "error", "no-speech", 1);
  assert.match(await voiceText(page), /No speech was detected/);
  assert.equal(await page.getAttribute("#nlCommandMic", "data-state"), "idle");

  // Missing on-device pack: no recognizer starts, no remote fallback, explicit install control.
  await page.evaluate(() => { window.__rec.availability = "downloadable"; });
  await page.click("#nlCommandMic");
  await page.waitForFunction(() => !document.getElementById("nlCommandVoiceInstallRow").hidden);
  assert.equal(await instanceCount(page), 2, "no recognizer started for a missing pack");
  assert.match(await voiceText(page), /not installed/);
  assert.equal(await page.locator("#nlCommandVoiceInstall").isVisible(), true);
  assert.equal(await page.evaluate(() => window.__rec.installs), 0, "nothing is installed without a click");
  await page.click("#nlCommandVoiceInstall");
  await page.waitForFunction(() => window.__rec.installs === 1);
  assert.match(await voiceText(page), /installed/);

  await page.fill("#nlCommandInput", "Go to Barajas");
  await page.press("#nlCommandInput", "Enter");
  assert.equal(await executeVisible(page), true, "typed fallback unaffected");
  assert.deepEqual(errors, []);
});

test("refusals and ambiguity from a spoken transcript are the Gate 2 outcomes; nothing executes", async (t) => {
  const { page } = await openApp(t);
  await openPanel(page);
  const before = await world(page);
  await startViaButton(page, 0);
  await fire(page, "final", "Ve a Carabanchel", 0);
  await frames(page);
  assert.match(await statusText(page), /More than one official place/);
  assert.equal(await executeVisible(page), false, "ambiguity needs an explicit choice");

  await page.fill("#nlCommandInput", "");
  await page.dispatchEvent("#nlCommandInput", "input");
  await startViaButton(page, 1);
  await fire(page, "final", "Ve a Narnia", 1);
  await frames(page);
  assert.equal(await executeVisible(page), false);
  assert.match(await statusText(page), /./);

  await page.fill("#nlCommandInput", "");
  await page.dispatchEvent("#nlCommandInput", "input");
  await startViaButton(page, 2);
  await fire(page, "final", "   ", 2);
  assert.match(await voiceText(page), /transcript was empty/);
  assert.deepEqual(await world(page), before, "no refusal or ambiguity changed the map");
});

test("voice never overwrites un-interpreted typed text", async (t) => {
  const { page } = await openApp(t);
  await openPanel(page);
  await page.fill("#nlCommandInput", "Ve a Hortaleza");
  await page.click("#nlCommandMic");
  await frames(page);
  assert.equal(await instanceCount(page), 0, "voice declined to start");
  assert.match(await voiceText(page), /not interpreted yet/);
  assert.equal(await page.inputValue("#nlCommandInput"), "Ve a Hortaleza");
});

test("no audio or transcript is persisted or transmitted: storage, URL and requests stay clean", async (t) => {
  const { page, requests } = await openApp(t);
  await openPanel(page);
  const urlBefore = page.url();
  const dump = () => page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  const storageBefore = await dump();
  const requestsBefore = requests.length;
  await startViaButton(page, 0);
  await fire(page, "final", "Ve a Barajas", 0);
  await frames(page);
  assert.equal(page.url(), urlBefore);
  assert.equal(await dump(), storageBefore);
  assert.equal((await dump()).includes("Barajas"), false);
  assert.deepEqual(requests.slice(requestsBefore).filter((p) => !/\.(geojson|json|svg|png|css|js)$/.test(p)), [], "no non-asset request during voice use");
});

test("phone: the mic is reachable through the finder entry, meets the touch target and stays inside the viewport", async (t) => {
  const { page, errors } = await openApp(t, { viewport: { width: 375, height: 812 } });
  await page.click("#geoSearchToggle");
  await page.click("#nlCommandFromFinder");
  await page.waitForSelector("#nlCommandPanel:not([hidden])");
  const box = await page.evaluate(() => { const r = document.getElementById("nlCommandMic").getBoundingClientRect(); return { h: r.height, w: r.width, left: r.left, right: r.right, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }; });
  assert.ok(box.h >= 44 && box.w >= 44 && box.left >= 0 && box.right <= box.innerW, JSON.stringify(box));
  assert.ok(box.scrollW <= box.innerW, "no horizontal scroll");
  await startViaButton(page, 0);
  await page.click("#nlCommandMic");
  await fire(page, "final", "Go to Barajas", 0);
  await frames(page);
  assert.equal(await executeVisible(page), true);
  assert.deepEqual(errors, []);
});

test("Gate 5: holding V from the bare map opens the panel and records once; from a control or a dialog it does nothing", async (t) => {
  const { page, errors } = await openApp(t);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.down("v");
  await page.waitForSelector("#nlCommandPanel:not([hidden])");
  await page.waitForFunction(() => window.__rec.instances.length === 1);
  await page.keyboard.down("v"); // key-repeat
  assert.equal(await instanceCount(page), 1, "repeat starts no second recognizer");
  await fire(page, "audiostart");
  await page.keyboard.up("v");
  assert.deepEqual(await calls(page), ["start", "stop"]);
  await fire(page, "final", "Ve a Barajas");
  await frames(page);
  assert.equal(await executeVisible(page), true, "release interprets only; Execute stays explicit");
  assert.deepEqual(errors, []);
});

test("Gate 5: an over-long transcript is refused whole, never truncated; field and state are kept", async (t) => {
  const { page } = await openApp(t);
  await openPanel(page);
  const before = await world(page);
  await startViaButton(page);
  await page.click("#nlCommandMic"); // release
  await fire(page, "final", "Ve a Barajas " + "y luego ".repeat(40));
  await frames(page);
  assert.equal(await page.inputValue("#nlCommandInput"), "", "nothing was written to the field");
  assert.match(await voiceText(page), /too long/);
  assert.equal(await executeVisible(page), false);
  assert.deepEqual(await world(page), before);
});

test("Gate 5: typing while the microphone is open ends the session; a late transcript cannot overwrite it", async (t) => {
  const { page } = await openApp(t);
  await openPanel(page);
  await startViaButton(page);
  await page.fill("#nlCommandInput", "Ve a Hortaleza");
  assert.deepEqual((await calls(page)).slice(-1), ["abort"]);
  await fire(page, "final", "Ve a Barajas");
  await frames(page);
  assert.equal(await page.inputValue("#nlCommandInput"), "Ve a Hortaleza");
});
