"use strict";

// Gate 3 — push-to-talk voice INPUT for the typed map command (docs/VOICE_COMMAND_V1.md).
//
// This module turns speech into TEXT and nothing else. It never parses, resolves a
// place, previews or executes a command: a final transcript is handed to the host,
// which puts it in the Gate 2 command field and runs the existing deterministic
// pipeline (parser -> geographic resolver -> preview -> explicit Execute).
//
// Two small pieces, both replaceable independently:
//   createSpeechProvider(win)  the ONLY code that touches the Web Speech API. It
//                              requires ON-DEVICE recognition (processLocally = true)
//                              and refuses to listen otherwise. There is no remote
//                              fallback, no audio capture of its own, no storage.
//   createPushToTalk(options)  a small lifecycle: idle -> checking -> requesting ->
//                              listening -> finalizing -> idle, with every callback
//                              tied to a session id so a cancelled, expired or
//                              superseded session can never deliver a late result.

const VOICE_STATE = Object.freeze({
  IDLE: "idle",
  CHECKING: "checking",
  REQUESTING: "requesting",
  LISTENING: "listening",
  FINALIZING: "finalizing",
});

const VOICE_CODE = Object.freeze({
  UNSUPPORTED: "UNSUPPORTED",
  PACK_MISSING: "PACK_MISSING",
  PACK_DOWNLOADING: "PACK_DOWNLOADING",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  MIC_UNAVAILABLE: "MIC_UNAVAILABLE",
  NO_SPEECH: "NO_SPEECH",
  EMPTY: "EMPTY",
  FAILED: "FAILED",
  LOCAL_NOT_ENFORCED: "LOCAL_NOT_ENFORCED",
});

// One short instruction. Gate 2 limits a command to 200 characters; ten seconds is
// ample for that and bounds how long a microphone can stay open.
const VOICE_LIMITS = Object.freeze({ MAX_LISTEN_MS: 10000, FINALIZE_MS: 4000 });

function createSpeechProvider(win) {
  const Ctor = win && (win.SpeechRecognition || win.webkitSpeechRecognition);
  // Without the static capability probe local processing cannot be verified, so
  // the feature stays off rather than guessing.
  const supported = typeof Ctor === "function" && typeof Ctor.available === "function";

  return {
    supported,
    // Resolves "unsupported" | "unavailable" | "downloadable" | "downloading" | "available"
    // for ON-DEVICE recognition of `lang`. "available" does not prove transcription works.
    async availability(lang) {
      if (!supported) return "unsupported";
      try { return await Ctor.available({ langs: [lang], processLocally: true }); } catch (error) { return "unavailable"; }
    },
    // Must run inside a user gesture; the browser performs any download.
    async install(lang) {
      if (!supported || typeof Ctor.install !== "function") return false;
      try { return (await Ctor.install({ langs: [lang], processLocally: true })) === true; } catch (error) { return false; }
    },
    // Starts one recognition. Throws LOCAL_NOT_ENFORCED if the engine does not accept
    // processLocally = true, so audio is never silently sent to a service.
    listen(lang, handlers) {
      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.processLocally = true;
      if (rec.processLocally !== true) { const error = new Error("processLocally not enforced"); error.code = VOICE_CODE.LOCAL_NOT_ENFORCED; throw error; }
      rec.onaudiostart = () => handlers.onAudioStart();
      rec.onresult = (event) => {
        // Final results only; interim text is never surfaced.
        for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result && result.isFinal && result[0]) handlers.onFinal(String(result[0].transcript || ""));
        }
      };
      rec.onerror = (event) => handlers.onError(String((event && event.error) || ""));
      rec.onend = () => handlers.onEnd();
      rec.start();
      return {
        stop() { try { rec.stop(); } catch (error) { /* already ended */ } },
        abort() { try { rec.abort(); } catch (error) { /* already ended */ } },
      };
    },
  };
}

const ERROR_CODE = Object.freeze({
  "not-allowed": VOICE_CODE.PERMISSION_DENIED,
  "service-not-allowed": VOICE_CODE.PACK_MISSING,
  "language-not-supported": VOICE_CODE.PACK_MISSING,
  "audio-capture": VOICE_CODE.MIC_UNAVAILABLE,
  "no-speech": VOICE_CODE.NO_SPEECH,
});

// onChange receives { state, code?, transcript?, cancelled? } on every transition.
function createPushToTalk({ provider, getLang, onChange, maxListenMs = VOICE_LIMITS.MAX_LISTEN_MS, finalizeMs = VOICE_LIMITS.FINALIZE_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let state = VOICE_STATE.IDLE;
  let session = 0;
  let handle = null;
  let timer = null;

  const emit = (detail) => onChange({ state, ...detail });
  const clearTimers = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const settle = (detail) => { clearTimers(); handle = null; state = VOICE_STATE.IDLE; emit(detail); };
  const live = (id) => id === session && state !== VOICE_STATE.IDLE;

  function release() {
    if (state === VOICE_STATE.LISTENING) {
      state = VOICE_STATE.FINALIZING;
      clearTimers();
      const id = session;
      timer = setTimer(() => {
        if (!live(id)) return;
        const old = handle;
        session += 1;
        if (old) old.abort();
        settle({ code: VOICE_CODE.NO_SPEECH });
      }, finalizeMs);
      emit({});
      if (handle) handle.stop();
    } else if (state === VOICE_STATE.CHECKING || state === VOICE_STATE.REQUESTING) {
      cancel();
    }
  }

  function cancel() {
    if (state === VOICE_STATE.IDLE) return;
    session += 1; // every pending callback of the old session is now stale
    const old = handle;
    if (old) old.abort();
    settle({ cancelled: true });
  }

  async function begin() {
    if (state !== VOICE_STATE.IDLE) return;
    const id = (session += 1);
    state = VOICE_STATE.CHECKING;
    emit({});
    const lang = getLang();
    const availability = await provider.availability(lang);
    if (!live(id)) return;
    if (availability !== "available") {
      session += 1;
      const code = availability === "downloadable" ? VOICE_CODE.PACK_MISSING
        : availability === "downloading" ? VOICE_CODE.PACK_DOWNLOADING
        : VOICE_CODE.UNSUPPORTED;
      settle({ code, availability });
      return;
    }
    state = VOICE_STATE.REQUESTING;
    emit({});
    try {
      handle = provider.listen(lang, {
        onAudioStart() {
          if (!live(id) || state !== VOICE_STATE.REQUESTING) return;
          state = VOICE_STATE.LISTENING;
          timer = setTimer(() => { if (live(id)) release(); }, maxListenMs);
          emit({});
        },
        onFinal(text) {
          if (!live(id)) return;
          const transcript = String(text).replace(/\s+/g, " ").trim();
          session += 1;
          if (!transcript) { settle({ code: VOICE_CODE.EMPTY }); return; }
          settle({ transcript });
        },
        onError(error) {
          if (!live(id)) return;
          session += 1;
          if (error === "aborted") { settle({ cancelled: true }); return; }
          settle({ code: ERROR_CODE[error] || VOICE_CODE.FAILED });
        },
        onEnd() {
          // Ended with no final result and no error: nothing was heard.
          if (!live(id)) return;
          session += 1;
          settle({ code: VOICE_CODE.NO_SPEECH });
        },
      });
    } catch (error) {
      if (!live(id)) return;
      session += 1;
      settle({ code: error && error.code === VOICE_CODE.LOCAL_NOT_ENFORCED ? VOICE_CODE.LOCAL_NOT_ENFORCED : VOICE_CODE.FAILED });
    }
  }

  return { begin, release, cancel, get state() { return state; } };
}

if (typeof window !== "undefined") window.VoiceInput = { createSpeechProvider, createPushToTalk, VOICE_STATE, VOICE_CODE, VOICE_LIMITS };
if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSpeechProvider, createPushToTalk, VOICE_STATE, VOICE_CODE, VOICE_LIMITS };
}
