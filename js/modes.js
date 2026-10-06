// Application modes — pure state model (K4, #66).
//
// A mode is a USER INTENT, not a CSS tab: PLACE ("what does the evidence say
// about this place?"), COMPARE ("how do two Lens circles read against each
// other?") and CITY ("what is the municipality-wide context?"). This module owns
// the mode as explicit application state and the TRANSITION PLAN between modes.
// It is deliberately PURE: no DOM, no Leaflet, no globals, no clock. The app
// supplies an `apply` callback that performs the plan's side effects, so a mode
// change is testable without a browser and no button's `active` class is ever a
// source of truth.
//
// A mode change never moves a Lens, never changes a radius and never touches a
// dataset or a layer. The only analytical side effect a transition may request is
// the EXISTING Lens B enable/disable path, which COMPARE owns.

const MODES = Object.freeze(["PLACE", "COMPARE", "CITY"]);
const DEFAULT_MODE = "PLACE";

// Names that were considered and rejected, with the reason, so the decision is
// machine-checkable and not only prose. None of them may ever become a mode.
const REJECTED_MODES = Object.freeze({
  EXPLORE: "not a user intent - the absence of one; the old button was inert",
  PLANNING: "names a dataset family, not a question the reader asks",
  EVIDENCE: "freed for the evidence drawer; a camera action is not a mode",
  CHANGE: "never a mode - always a question about something already selected",
});

function isMode(value) {
  return typeof value === "string" && MODES.includes(value);
}

// planModeTransition(from, to, { lensBEnabled }) -> a frozen, side-effect-free
// plan. It states WHAT the app must do, never HOW:
//   * entering COMPARE with Lens B off  -> enableLensB   (existing activation path)
//   * leaving COMPARE with Lens B on    -> disableLensB  (existing cleanup path,
//                                          which clears the halo metric focus)
//   * every other transition            -> nothing
// `preservesLensState` is the invariant, stated as data: positions and radii are
// never part of a plan.
function planModeTransition(from, to, state = {}) {
  if (!isMode(from)) throw new Error(`planModeTransition: "${from}" is not a mode`);
  if (!isMode(to)) throw new Error(`planModeTransition: "${to}" is not a mode`);
  const lensBEnabled = Boolean(state.lensBEnabled);
  const changed = from !== to;
  return Object.freeze({
    from,
    to,
    changed,
    enableLensB: changed && to === "COMPARE" && !lensBEnabled,
    disableLensB: changed && from === "COMPARE" && lensBEnabled,
    preservesLensState: true,
  });
}

// createModeController({ apply, lensBEnabled }) -> the mode state.
//   currentMode()          the current mode
//   setMode(mode)          validate, plan, run apply(plan), then commit + notify
//   enterMode(mode, state) setMode with an explicit state snapshot (for callers
//                          that know Lens B's state better than the controller)
//   subscribe(listener)    listener(mode, plan) after every committed change
// `apply` receives the frozen plan; if it throws, the mode is NOT committed, so
// state can never claim a mode whose side effects did not happen.
function createModeController({ apply, lensBEnabled = () => false, initial = DEFAULT_MODE } = {}) {
  if (!isMode(initial)) throw new Error(`createModeController: "${initial}" is not a mode`);
  let mode = initial;
  const listeners = new Set();

  function enterMode(next, state = {}) {
    if (!isMode(next)) throw new Error(`setMode: "${next}" is not a mode`);
    const plan = planModeTransition(mode, next, { lensBEnabled: lensBEnabled(), ...state });
    if (typeof apply === "function") apply(plan);
    mode = next;
    for (const listener of listeners) listener(mode, plan);
    return plan;
  }

  return {
    currentMode: () => mode,
    setMode: (next) => enterMode(next),
    enterMode,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MODES,
    DEFAULT_MODE,
    REJECTED_MODES,
    isMode,
    planModeTransition,
    createModeController,
  };
}
