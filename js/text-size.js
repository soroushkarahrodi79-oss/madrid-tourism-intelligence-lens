// Reading size is presentation-only: it sets one root multiplier that the
// rem-based K5 type tokens inherit. It is independent from appearance,
// basemap, analytical state and K11/URL state, and is never exported.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MadridTextSize = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const STORAGE_KEY = "madrid-lens-text-size";
  const VALID_PREFERENCES = Object.freeze(["normal", "comfortable", "large"]);
  const DEFAULT_PREFERENCE = "normal";

  function normalizePreference(value) {
    return VALID_PREFERENCES.includes(value) ? value : DEFAULT_PREFERENCE;
  }

  function safeRead(storage) {
    try { return normalizePreference(storage && storage.getItem(STORAGE_KEY)); }
    catch (_) { return DEFAULT_PREFERENCE; }
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
    const select = options.select || doc.getElementById("textSizeSelect");
    let storage = options.storage;
    if (storage === undefined) {
      try { storage = win.localStorage; } catch (_) { storage = null; }
    }
    let preference = normalizePreference(rootElement.dataset.textSize || safeRead(storage));

    function apply(next, persist) {
      preference = normalizePreference(next);
      rootElement.dataset.textSize = preference;
      if (select) select.value = preference;
      if (persist) safeWrite(storage, preference);
      return preference;
    }

    if (select) select.addEventListener("change", (event) => apply(event.target.value, true));
    apply(preference, false);
    return Object.freeze({
      get preference() { return preference; },
      setPreference(next) { return apply(next, true); }
    });
  }

  return Object.freeze({ STORAGE_KEY, VALID_PREFERENCES, normalizePreference, safeRead, safeWrite, init });
});
