/* Optional, app-owned onboarding for the real Lens UI. It never calls map,
 * mode, layer, radius, evidence, or URL APIs: targets are visual associations
 * only, so a tour is safe over a live or shared reading. */
(function (root) {
  const STORAGE_KEY = "madrid-lens-tutorial-v1";
  const VERSION = "1";
  const COPY = {
    en: {
      help: "Guided tour", helpAria: "Open guided tour", inviteTitle: "New to Lens?",
      inviteBody: "Learn how to explore Madrid, compare places and understand official evidence in a quick two-minute tour.",
      start: "Start tour", later: "Not now", back: "Previous", next: "Next", skip: "Skip", close: "Close tour",
      progress: "{n} of 6", unavailable: "This entry is outside the current view or unavailable in this reading. The guide will not scroll or change it.",
      steps: [
        ["Understand the map", "Lens A is a movable analysis circle. It is not an official barrio, district or planning ámbito."],
        ["Explore a place", "Choose a location, move Lens A or adjust its radius to find observations inside this analysis window."],
        ["Discover the layers", "Use Layers to show operational, register, observed and context sources. OFF, zero, unavailable and withheld mean different things."],
        ["Compare A and B", "Compare independent Lens circles and radii. B − A is descriptive only when readings are compatible; it is not a ranking or causal claim."],
        ["Understand CITY", "CITY gives municipality-wide context. It is not automatically a measurement of your Lens circle."],
        ["Evidence & limits", "Open Evidence & limits to inspect source, date, scope, provenance, availability and interpretation limits. ZERO, OFF, N/A, UNAVAILABLE and WITHHELD stay distinct."]
      ],
      doneTitle: "You’re ready to explore Madrid with Lens!", doneBody: "Your current reading has not been changed.", doneStart: "Start exploring", replay: "Replay tutorial"
    },
    es: {
      help: "Guía", helpAria: "Abrir recorrido guiado", inviteTitle: "¿Primera vez en Lens?",
      inviteBody: "Aprende a explorar Madrid, comparar lugares y comprender las evidencias oficiales en un recorrido de unos 2 minutos.",
      start: "Empezar recorrido", later: "Ahora no", back: "Anterior", next: "Siguiente", skip: "Saltar", close: "Cerrar recorrido",
      progress: "{n} de 6", unavailable: "Esta entrada está fuera de la vista actual o no está disponible en esta lectura. La guía no la desplazará ni cambiará.",
      steps: [
        ["Entiende el mapa", "La Lente A es un círculo de análisis móvil. No es un barrio, distrito ni ámbito de planeamiento oficial."],
        ["Explora un lugar", "Elige una ubicación, mueve la Lente A o ajusta su radio para encontrar observaciones dentro de esta ventana de análisis."],
        ["Descubre las capas", "Usa Capas para mostrar fuentes operativas, de registro, observadas y de contexto. OFF, cero, no disponible y retenido significan cosas distintas."],
        ["Compara A y B", "Compara círculos y radios independientes. B − A solo es descriptivo con lecturas compatibles; no es una clasificación ni una afirmación causal."],
        ["Entiende CIUDAD", "CIUDAD aporta contexto de todo el municipio. No es automáticamente una medición de tu círculo Lens."],
        ["Evidencia y límites", "Abre Evidencia y límites para revisar fuente, fecha, alcance, procedencia, disponibilidad y límites de interpretación. CERO, OFF, N/A, NO DISPONIBLE y RETENIDO siguen siendo distintos."]
      ],
      doneTitle: "¡Ya puedes explorar Madrid con Lens!", doneBody: "Tu lectura actual no ha cambiado.", doneStart: "Empezar a explorar", replay: "Repetir recorrido"
    }
  };
  const TARGETS = ["#map", "#radiusSlider", null, "#modeCompareButton", "#modeCityButton", "[data-evidence-mode]"];
  let state = { step: 0, active: false, opener: null, highlighted: null, sessionHandled: false };

  function language() { return document.getElementById("languageSelect")?.value === "es" ? "es" : "en"; }
  function t() { return COPY[language()]; }
  function safeRead() { try { return root.localStorage.getItem(STORAGE_KEY); } catch (_) { return null; } }
  function safeWrite(value) { try { root.localStorage.setItem(STORAGE_KEY, value); } catch (_) {} }
  function isVisible(el) { if (!el) return false; const r = el.getBoundingClientRect(); const s = root.getComputedStyle(el); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < root.innerHeight && r.right > 0 && r.left < root.innerWidth && s.visibility !== "hidden" && s.display !== "none"; }
  function targetFor(step) {
    if (step === 2) return document.documentElement.clientWidth <= 560 ? document.getElementById("mobileLayersButton") : document.getElementById("layerRail");
    return document.querySelector(TARGETS[step]);
  }
  function removeHighlight() { if (state.highlighted) state.highlighted.classList.remove("tutorial-target"); state.highlighted = null; }
  function positionGuide(el, target) {
    const phone = root.matchMedia("(max-width: 560px)").matches;
    el.classList.toggle("tutorial-guide-bottom", phone);
    if (phone || !target) { el.style.removeProperty("left"); el.style.removeProperty("top"); return; }
    const r = target.getBoundingClientRect();
    const width = Math.min(360, root.innerWidth - 32);
    const left = Math.max(16, Math.min(root.innerWidth - width - 16, r.right + 14));
    // Long localized explanations can be taller than a compact tooltip. Keep
    // the action row inside the viewport rather than following an offscreen UI.
    const top = Math.max(86, Math.min(root.innerHeight - 360, r.top));
    el.style.left = `${left}px`; el.style.top = `${top}px`;
  }
  function destroySurface() { removeHighlight(); document.getElementById("tutorialInvite")?.remove(); document.getElementById("tutorialGuide")?.remove(); }
  function restoreFocus() { const el = state.opener; state.opener = null; if (el && el.isConnected) el.focus({ preventScroll: true }); }
  function finish(reason) {
    const complete = reason === "complete";
    if (complete) safeWrite(`${VERSION}:completed`);
    else if (safeRead() !== `${VERSION}:completed`) safeWrite(`${VERSION}:dismissed`);
    destroySurface(); state.active = false; state.sessionHandled = true; restoreFocus();
  }
  function renderInvite() {
    destroySurface(); const c = t();
    const el = document.createElement("section"); el.id = "tutorialInvite"; el.className = "tutorial-invite"; el.setAttribute("aria-label", c.inviteTitle);
    el.innerHTML = `<div><strong>${c.inviteTitle}</strong><p>${c.inviteBody}</p></div><div class="tutorial-actions"><button type="button" data-tutorial-start>${c.start}</button><button type="button" class="tutorial-quiet" data-tutorial-later>${c.later}</button></div>`;
    document.body.append(el); el.querySelector("[data-tutorial-start]").onclick = () => start(el.querySelector("[data-tutorial-start]")); el.querySelector("[data-tutorial-later]").onclick = () => finish("dismiss");
  }
  function renderGuide() {
    destroySurface(); const c = t(); const done = state.step >= 6; const target = done ? null : targetFor(state.step); const unavailable = !done && !isVisible(target);
    if (target && !unavailable) { target.classList.add("tutorial-target"); state.highlighted = target; }
    const title = done ? c.doneTitle : c.steps[state.step][0]; const body = done ? c.doneBody : c.steps[state.step][1];
    const el = document.createElement("section"); el.id = "tutorialGuide"; el.className = "tutorial-guide"; el.setAttribute("role", "region"); el.setAttribute("aria-label", c.help); el.tabIndex = -1;
    el.innerHTML = `<div class="tutorial-guide-top"><span class="tutorial-progress">${done ? "6 / 6" : c.progress.replace("{n}", state.step + 1)}</span><button type="button" class="tutorial-icon" data-tutorial-close aria-label="${c.close}">×</button></div><h2>${title}</h2><p>${body}</p>${unavailable ? `<p class="tutorial-fallback">${c.unavailable}</p>` : ""}<div class="tutorial-actions">${done ? `<button type="button" data-tutorial-finish>${c.doneStart}</button><button type="button" class="tutorial-quiet" data-tutorial-replay>${c.replay}</button>` : `<button type="button" class="tutorial-quiet" data-tutorial-back ${state.step === 0 ? "disabled" : ""}>${c.back}</button><button type="button" data-tutorial-next>${c.next}</button><button type="button" class="tutorial-link" data-tutorial-skip>${c.skip}</button>`}</div>`;
    document.body.append(el); positionGuide(el, target); el.querySelector("[data-tutorial-close]").onclick = () => finish("dismiss");
    if (done) { el.querySelector("[data-tutorial-finish]").onclick = () => finish("complete"); el.querySelector("[data-tutorial-replay]").onclick = () => { state.step = 0; renderGuide(); }; }
    else { el.querySelector("[data-tutorial-back]").onclick = () => { state.step--; renderGuide(); }; el.querySelector("[data-tutorial-next]").onclick = () => { state.step++; renderGuide(); }; el.querySelector("[data-tutorial-skip]").onclick = () => finish("dismiss"); }
    el.focus({ preventScroll: true });
  }
  function start(opener) { state.opener = opener || document.activeElement; state.step = 0; state.active = true; state.sessionHandled = true; renderGuide(); }
  function init() {
    const help = document.getElementById("tutorialHelpButton"); if (!help) return;
    help.addEventListener("click", () => start(help));
    document.getElementById("languageSelect")?.addEventListener("change", () => { if (state.active) renderGuide(); else { help.lastElementChild.textContent = t().help; help.setAttribute("aria-label", t().helpAria); } });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && (state.active || document.getElementById("tutorialInvite"))) { event.preventDefault(); finish("dismiss"); } });
    root.addEventListener("resize", () => { const guide = document.getElementById("tutorialGuide"); if (guide && state.active) positionGuide(guide, targetFor(state.step)); });
    const stored = safeRead(); const shared = /(?:\?|&)v=/.test(root.location.search);
    // Existing deterministic map-regression harnesses are not first visitors;
    // suppress the invitation there without changing any real URL behaviour.
    const regressionHarness = /(?:\?|&)haloRegressionTest=1(?:&|$)/.test(root.location.search);
    if (!stored && !shared && !regressionHarness && !state.sessionHandled) root.setTimeout(renderInvite, 700);
  }
  const api = { STORAGE_KEY, COPY, safeRead, safeWrite, targetFor, init, start };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MadridLensTutorial = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
