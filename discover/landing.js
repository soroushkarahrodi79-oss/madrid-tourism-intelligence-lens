(() => {
  const legacySection = /^#(?:modos|evidencia|modesTitle|evidenceTitle|tab-(?:place|compare|city)|panel-(?:place|compare|city))$/;
  if (legacySection.test(location.hash)) {
    location.replace("methodology.html" + location.search + location.hash);
    return;
  }

  const languageKey = "madrid-lens-discover-lang";
  const buttons = [...document.querySelectorAll("[data-lang]")];
  const localized = [...document.querySelectorAll("[data-en]")].map(node => [node, node.textContent]);
  const labels = [...document.querySelectorAll("[data-label-en]")].map(node => [node, node.getAttribute("aria-label")]);
  const languages = document.getElementById("languages");
  const enter = document.querySelector("[data-primary-cta]");
  const methodology = document.getElementById("methodology");
  const isSupported = value => value === "es" || value === "en";

  function localize(lang) {
    document.documentElement.lang = lang;
    for (const [node, spanish] of localized) {
      node.textContent = lang === "en" ? node.dataset.en : spanish;
    }
    for (const [node, spanish] of labels) node.setAttribute("aria-label", lang === "en" ? node.dataset.labelEn : spanish);
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
    enter.href = "../?lang=" + lang;
    methodology.href = "methodology.html?lang=" + lang + "#evidencia";
  }

  let savedLanguage;
  try { savedLanguage = localStorage.getItem(languageKey); } catch (_) {}
  const requested = new URLSearchParams(location.search).get("lang");
  const initial = isSupported(requested) ? requested : savedLanguage;
  localize(isSupported(initial) ? initial : (navigator.language.toLowerCase().startsWith("en") ? "en" : "es"));
  languages.hidden = false;

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const lang = button.dataset.lang;
      try { localStorage.setItem(languageKey, lang); } catch (_) {}
      if (isSupported(requested)) {
        const current = new URL(location.href);
        current.searchParams.set("lang", lang);
        history.replaceState(history.state, "", current);
      }
      localize(lang);
    });
  }

  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const flightKey = "madrid-lens-discover-flight-v1";
  if (motion.matches || document.visibilityState !== "visible") return;
  try { if (sessionStorage.getItem(flightKey)) return; } catch (_) {}

  const flight = document.getElementById("flight");
  const earth = new Image();
  const iberia = new Image();
  earth.className = "earth";
  iberia.className = "iberia";
  earth.alt = iberia.alt = "";
  earth.src = "media/earth.webp";
  iberia.src = "media/iberia.webp";

  // Keep the static city when the plates fail to decode or arrive too late.
  const deadline = performance.now() + 500;
  Promise.all([earth.decode(), iberia.decode()]).then(() => {
    if (motion.matches || document.hidden || performance.now() > deadline) return;
    try { sessionStorage.setItem(flightKey, "1"); } catch (_) {}
    flight.append(earth, iberia);
    flight.classList.add("is-flying");
    const finish = () => {
      flight.classList.remove("is-flying");
      flight.replaceChildren();
      flight.removeEventListener("animationend", onEnd);
      motion.removeEventListener("change", onMotionChange);
    };
    const onEnd = event => { if (event.target === flight) finish(); };
    const onMotionChange = event => { if (event.matches) finish(); };
    flight.addEventListener("animationend", onEnd);
    motion.addEventListener("change", onMotionChange);
  }).catch(() => {});
})();
