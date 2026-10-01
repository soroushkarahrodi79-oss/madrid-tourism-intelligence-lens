// Small shared localization state. Feature modules provide dictionaries; this
// module owns language selection and fallback so they do not switch languages
// internally or read DOM controls directly.

export const SUPPORTED_LANGUAGES = Object.freeze(["es", "en"]);

export function normalizeLanguage(value) {
  const base = String(value || "").toLowerCase().split("-")[0];
  return SUPPORTED_LANGUAGES.includes(base) ? base : "es";
}

export function createI18n(dictionaries, initialLanguage = "es") {
  let language = normalizeLanguage(initialLanguage);
  const listeners = new Set();

  function translate(key) {
    const selected = dictionaries[language] || {};
    const fallback = dictionaries.es || {};
    return selected[key] ?? fallback[key] ?? key;
  }

  return {
    get language() {
      return language;
    },
    t: translate,
    setLanguage(next) {
      const normalized = normalizeLanguage(next);
      if (normalized === language) return;
      language = normalized;
      for (const listener of listeners) listener(language);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
