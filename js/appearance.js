// Appearance is deliberately independent from basemap, URL/share and evidence
// state. CSS sees only the concrete light/dark value; the control retains the
// user's light/dark/system preference.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MadridAppearance = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const STORAGE_KEY = "madrid-lens-appearance";
  const VALID_PREFERENCES = Object.freeze(["light", "dark", "system"]);

  function normalizePreference(value) {
    return VALID_PREFERENCES.includes(value) ? value : "system";
  }

  function resolveAppearance(preference, systemDark) {
    const normalized = normalizePreference(preference);
    return normalized === "system" ? (systemDark ? "dark" : "light") : normalized;
  }

  function safeRead(storage) {
    try { return normalizePreference(storage && storage.getItem(STORAGE_KEY)); }
    catch (_) { return "system"; }
  }

  function safeWrite(storage, preference) {
    try { if (storage) storage.setItem(STORAGE_KEY, normalizePreference(preference)); }
    catch (_) { /* Storage is optional; the active session still works. */ }
  }

  function init(options = {}) {
    const doc = options.document || (typeof document !== "undefined" ? document : null);
    const win = options.window || (typeof window !== "undefined" ? window : null);
    if (!doc || !win) return null;

    const rootElement = doc.documentElement;
    const select = options.select || doc.getElementById("appearanceSelect");
    let storage = options.storage;
    if (storage === undefined) {
      try { storage = win.localStorage; } catch (_) { storage = null; }
    }
    let media = options.media;
    if (!media) {
      try { media = win.matchMedia("(prefers-color-scheme: dark)"); }
      catch (_) { media = { matches: false }; }
    }
    let preference = normalizePreference(rootElement.dataset.appearancePreference || safeRead(storage));

    function apply(nextPreference, persist) {
      preference = normalizePreference(nextPreference);
      const resolved = resolveAppearance(preference, Boolean(media.matches));
      rootElement.dataset.appearance = resolved;
      rootElement.dataset.appearancePreference = preference;
      rootElement.style.colorScheme = resolved;
      if (select) select.value = preference;
      if (persist) safeWrite(storage, preference);
      rootElement.dispatchEvent(new win.CustomEvent("appearancechange", {
        detail: { preference, resolved }
      }));
      return resolved;
    }

    function onSystemChange() {
      if (preference === "system") apply("system", false);
    }

    if (select) select.addEventListener("change", (event) => apply(event.target.value, true));
    if (typeof media.addEventListener === "function") media.addEventListener("change", onSystemChange);
    else if (typeof media.addListener === "function") media.addListener(onSystemChange);

    apply(preference, false);
    return Object.freeze({
      get preference() { return preference; },
      get resolved() { return rootElement.dataset.appearance; },
      setPreference(next) { return apply(next, true); },
      destroy() {
        if (typeof media.removeEventListener === "function") media.removeEventListener("change", onSystemChange);
        else if (typeof media.removeListener === "function") media.removeListener(onSystemChange);
      }
    });
  }

  return Object.freeze({ STORAGE_KEY, VALID_PREFERENCES, normalizePreference, resolveAppearance, safeRead, safeWrite, init });
});
