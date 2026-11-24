// Gate 3 voice input: provider + push-to-talk lifecycle against a MOCK speech engine.
// These tests prove wiring, state handling and stale-callback safety. They do NOT
// measure recognition accuracy and are not a real-microphone validation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const { createSpeechProvider, createPushToTalk, VOICE_CODE, VOICE_STATE } = createRequire(import.meta.url)("../js/voice-input.js");

function fakeWindow({ availability = "available", honourLocal = true, hasAvailable = true } = {}) {
  const instances = [];
  class Recognition {
    constructor() { this.calls = []; this._local = false; instances.push(this); }
    get processLocally() { return honourLocal ? this._local : false; }
    set processLocally(v) { this._local = v; }
    start() { this.calls.push("start"); }
    stop() { this.calls.push("stop"); }
    abort() { this.calls.push("abort"); }
  }
  if (hasAvailable) Recognition.available = async (o) => { Recognition.lastAvailable = o; return availability; };
  Recognition.install = async () => true;
  return { win: { SpeechRecognition: Recognition }, instances, Recognition };
}
const finalEvent = (text) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
const interimEvent = (text) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: false })] });

function setup(opts) {
  const env = fakeWindow(opts);
  const events = [];
  const timers = new Map();
  let nextTimer = 1;
  const ptt = createPushToTalk({
    provider: createSpeechProvider(env.win),
    getLang: () => "es-ES",
    onChange: (d) => events.push(d),
    setTimer: (fn, ms) => { timers.set(nextTimer, { fn, ms }); return nextTimer++; },
    clearTimer: (id) => timers.delete(id),
  });
  return { ...env, ptt, events, timers };
}

test("capability: no SpeechRecognition or no available() means unsupported (no guessing)", async () => {
  assert.equal(await createSpeechProvider({}).availability("es-ES"), "unsupported");
  assert.equal(await createSpeechProvider(fakeWindow({ hasAvailable: false }).win).availability("es-ES"), "unsupported");
  const env = fakeWindow({ availability: "downloadable" });
  assert.equal(await createSpeechProvider(env.win).availability("en-US"), "downloadable");
  assert.deepEqual(env.Recognition.lastAvailable, { langs: ["en-US"], processLocally: true });
});

test("a missing pack never starts a recognizer and never falls back to remote", async () => {
  const s = setup({ availability: "downloadable" });
  await s.ptt.begin();
  assert.equal(s.instances.length, 0);
  assert.equal(s.events.at(-1).code, VOICE_CODE.PACK_MISSING);
  assert.equal(s.ptt.state, VOICE_STATE.IDLE);
});

test("start requires processLocally = true and refuses an engine that does not hold it", async () => {
  const ok = setup();
  await ok.ptt.begin();
  assert.equal(ok.instances[0].processLocally, true);
  assert.equal(ok.instances[0].interimResults, false);
  assert.equal(ok.instances[0].continuous, false);
  assert.equal(ok.instances[0].lang, "es-ES");
  const bad = setup({ honourLocal: false });
  await bad.ptt.begin();
  assert.equal(bad.events.at(-1).code, VOICE_CODE.LOCAL_NOT_ENFORCED);
  assert.equal(bad.instances[0].calls.includes("start"), false);
});

test("start/stop and a final transcript; interim text is never delivered", async () => {
  const s = setup();
  await s.ptt.begin();
  const rec = s.instances[0];
  assert.equal(s.ptt.state, VOICE_STATE.REQUESTING);
  rec.onaudiostart();
  assert.equal(s.ptt.state, VOICE_STATE.LISTENING);
  rec.onresult(interimEvent("ve a bar"));
  assert.equal(s.events.some((e) => e.transcript), false, "interim never surfaces");
  s.ptt.release();
  assert.deepEqual(rec.calls, ["start", "stop"]);
  assert.equal(s.ptt.state, VOICE_STATE.FINALIZING);
  rec.onresult(finalEvent("  Ve a   Barajas "));
  assert.equal(s.events.at(-1).transcript, "Ve a Barajas");
  assert.equal(s.ptt.state, VOICE_STATE.IDLE);
});

test("permission rejection, no speech, empty transcript and unexpected end map to codes", async () => {
  for (const [fire, code] of [
    [(r) => r.onerror({ error: "not-allowed" }), VOICE_CODE.PERMISSION_DENIED],
    [(r) => r.onerror({ error: "audio-capture" }), VOICE_CODE.MIC_UNAVAILABLE],
    [(r) => r.onerror({ error: "service-not-allowed" }), VOICE_CODE.PACK_MISSING],
    [(r) => r.onerror({ error: "no-speech" }), VOICE_CODE.NO_SPEECH],
    [(r) => r.onerror({ error: "network" }), VOICE_CODE.FAILED],
    [(r) => r.onresult(finalEvent("   ")), VOICE_CODE.EMPTY],
    [(r) => r.onend(), VOICE_CODE.NO_SPEECH],
  ]) {
    const s = setup();
    await s.ptt.begin();
    s.instances[0].onaudiostart();
    fire(s.instances[0]);
    assert.equal(s.events.at(-1).code, code);
    assert.equal(s.ptt.state, VOICE_STATE.IDLE);
  }
});

test("a second begin() while active starts no second recognizer (key-repeat / double click)", async () => {
  const s = setup();
  const first = s.ptt.begin();
  s.ptt.begin();
  s.ptt.begin();
  await first;
  assert.equal(s.instances.length, 1);
});

test("rapid press and release during the availability check cancels without starting", async () => {
  const s = setup();
  const p = s.ptt.begin();
  s.ptt.release();
  await p;
  assert.equal(s.instances.length, 0);
  assert.equal(s.events.at(-1).cancelled, true);
});

test("cancel aborts the engine and a late result, error or end cannot reach the host", async () => {
  const s = setup();
  await s.ptt.begin();
  const rec = s.instances[0];
  rec.onaudiostart();
  s.ptt.cancel();
  assert.equal(rec.calls.includes("abort"), true);
  const count = s.events.length;
  rec.onresult(finalEvent("coloca lens A en Hortaleza"));
  rec.onerror({ error: "no-speech" });
  rec.onend();
  rec.onaudiostart();
  assert.equal(s.events.length, count, "stale callbacks are ignored");
  assert.equal(s.events.some((e) => e.transcript), false);
});

test("a superseded session cannot deliver into the next one", async () => {
  const s = setup();
  await s.ptt.begin();
  const old = s.instances[0];
  old.onaudiostart();
  s.ptt.cancel();
  await s.ptt.begin();
  const next = s.instances[1];
  next.onaudiostart();
  old.onresult(finalEvent("viejo"));
  assert.equal(s.events.some((e) => e.transcript === "viejo"), false);
  next.onresult(finalEvent("nuevo"));
  assert.equal(s.events.at(-1).transcript, "nuevo");
});

test("listening is bounded: the maximum duration stops capture; finalization is bounded too", async () => {
  const s = setup();
  await s.ptt.begin();
  const rec = s.instances[0];
  rec.onaudiostart();
  const max = [...s.timers.values()][0];
  assert.equal(max.ms, 10000);
  max.fn();
  assert.equal(rec.calls.includes("stop"), true);
  assert.equal(s.ptt.state, VOICE_STATE.FINALIZING);
  [...s.timers.values()].at(-1).fn(); // the engine never answers
  assert.equal(rec.calls.includes("abort"), true);
  assert.equal(s.ptt.state, VOICE_STATE.IDLE);
  assert.equal(s.events.at(-1).code, VOICE_CODE.NO_SPEECH);
});

test("the module has no network, storage or capture surface of its own", () => {
  const src = readFileSync(new URL("../js/voice-input.js", import.meta.url), "utf8");
  for (const forbidden of [/fetch\(/, /XMLHttpRequest/, /WebSocket/, /localStorage/, /sessionStorage/, /indexedDB/, /MediaRecorder/, /getUserMedia/, /sendBeacon/, /processLocally\s*=\s*false/, /require\(/]) {
    assert.doesNotMatch(src, forbidden);
  }
});

test("Gate 5: every exit (final, error, end) releases the recognition handle", async () => {
  for (const finish of [(r) => r.onresult(finalEvent("ve a barajas")), (r) => r.onerror({ error: "audio-capture" }), (r) => r.onend()]) {
    const s = setup();
    await s.ptt.begin();
    s.instances[0].onaudiostart();
    finish(s.instances[0]);
    assert.equal(s.ptt.state, VOICE_STATE.IDLE);
    assert.ok(s.instances[0].calls.includes("abort"), "handle aborted on the terminal path");
  }
});
