# Voice command V1 (Gate 3) — push-to-talk input for the typed map command

Status: implemented; **real-microphone validation pending** (see §7).
Builds on `docs/SPATIAL_COMMAND_V1.md` (Gate 1) and `docs/NATURAL_LANGUAGE_COMMAND_V1.md` (Gate 2).

## 1. What this is

Voice is **another way to produce the command text**. The microphone transcribes one
short instruction into the existing Gate 2 field; from there everything is unchanged:

```
V key / Speak button -> push-to-talk controller -> on-device speech provider
 -> FINAL transcript -> #nlCommandInput -> parseNaturalCommand -> geographic resolver
 -> preview / ambiguity / refusal -> explicit Execute -> Spatial Command Core
```

A speech provider never executes anything. Nothing in `js/voice-input.js` parses, resolves a
place or touches the map. **Not an assistant:** no model, no generated sentence, no spoken
answer, no conversation, no scientific claim. Gate 2's AI-assistant prohibitions are unchanged.

## 2. Audio processing guarantees (what is enforced, what is not)

| Guarantee | How |
|---|---|
| Recognition is **on-device only** | `SpeechRecognition.processLocally = true` is set and read back; if the engine does not hold it, listening is refused (`LOCAL_NOT_ENFORCED`). Capability is probed with `SpeechRecognition.available({langs, processLocally: true})`; anything but `"available"` keeps voice off. |
| **No remote fallback** | There is no code path that sets `processLocally = false`. A missing pack gives a message and an install button, never a server. |
| No application-level transmission, storage or telemetry of audio | The app never opens a `MediaStream`, `MediaRecorder` or network request for audio. |
| Transcripts are not persisted | The transcript goes only into the visible input field. Nothing is written to `localStorage`, `sessionStorage`, URLs, logs or analytics. |
| No microphone at page load; no always-listening mode; no automatic restart | The microphone is started only by a key press or button click while the command panel is open. One session = one recognition, bounded at **10 s**, finalization bounded at 4 s. |
| Language pack download is a user action | `SpeechRecognition.install()` runs only from the "Install the speech pack" button click. |

**Limit of these guarantees:** they rest on the browser honouring `processLocally`. The page
cannot inspect where the browser actually processed audio, and `available()` reporting
`"available"` is not proof that transcription works. No deployment header is required: the
`on-device-speech-recognition` Permissions-Policy defaults to `self`, and this page is not embedded.

## 3. Interaction

- **Keyboard (desktop):** hold **V**, speak, release. Active only while the command panel is
  open; ignored inside inputs/textareas/selects/contenteditable, during IME composition and
  with any modifier; key-repeat is swallowed; one held key starts at most one recognizer.
  V was unused (existing shortcuts: `/`, `[`, `]`, Escape). Because opening the panel focuses
  its text field, V works once focus is outside the field (for example on the Speak button or the map).
- **Speak button (mouse, touch, switch/keyboard):** click to start, click again (now "Stop") to
  finish. This is the accessible alternative to holding a key. `aria-pressed` and a live status line track the real state.
- **Cancellation** (no result, no field change): Escape (cancels only the recording first), closing the panel,
  window blur, tab hidden, interface-language change, release before listening began.
- **Field policy:** a transcript replaces the field contents and is interpreted exactly like typed text
  (preview only). Un-interpreted typed text is never overwritten: voice declines to start and says so. Execution
  is never triggered by key release, by interim text or by the transcript; only the Execute button executes.

## 4. Lifecycle

`idle -> checking -> requesting -> listening -> finalizing -> idle` (errors/cancel return to `idle` with a
message). Every callback carries a session id; a cancelled, expired or superseded session cannot deliver a late
transcript. Interim results are disabled and ignored.

## 5. Languages

Speech language follows the interface language: Spanish `es-ES`, English `en-US`. No automatic language
detection, no Persian, no mixed-language recognition (Gate 4). The grammar is not widened to compensate for
recognition errors; the transcript is only whitespace-normalized, so numbers, place names and units are never reinterpreted.
A misrecognized word yields a refusal or an ambiguity prompt from Gate 2, never a guess.

## 6. Failure handling

Unsupported browser or no `available()` (button disabled, typed input unchanged) · pack missing/downloading
(message + install button) · permission denied · no microphone · no speech / empty transcript · recognition error.
Typed input is never affected.

## 7. Validation status

Automated tests use a **mock** `SpeechRecognition`; they prove wiring, lifecycle and equivalence with typing, not
recognition accuracy. Real-microphone validation is recorded in the Gate 3 PR and is **not** claimed here.

Manual owner check: in Chrome open the app, open **Command**, press **Speak** (grant the microphone, install the
pack if offered), say "Go to Barajas"; confirm the field shows the transcript, the preview appears, nothing changed
until **Execute**. Repeat in Spanish ("Ve a Barajas"). Try Escape mid-recording, and DevTools > Network to confirm no audio request.
