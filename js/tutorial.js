/* Optional, app-owned onboarding for the real Lens UI. It describes and
 * highlights existing controls only. The guide never changes map, mode, Lens,
 * radius, layer, evidence, registry, dossier or canonical-URL state. */
(function (root) {
  const STORAGE_KEY = "madrid-lens-tutorial-v1";
  // Keep V1 preferences valid: gaining two instructional steps must not invite
  // returning readers again. Manual replay always opens the latest copy below.
  const VERSION = "1";
  const STEP_COUNT = 8;
  const COPY = {
    en: {
      help: "Guided tour", helpAria: "Open guided tour", inviteTitle: "New to Lens?",
      inviteBody: "See how to find official places, ask registered evidence questions and verify a reading. The tour is optional and self-paced.",
      start: "Start tour", later: "Not now", back: "Previous", next: "Next", skip: "Skip", close: "Close tour",
      progress: "Step {n} of 8", progressDone: "Tour complete", unavailable: "This control is not visible in the current layout or reading. The tour will not change the workspace to make it appear.",
      navigation: { controls: "Show Lens controls", questions: "Show questions" },
      steps: [
        ["Understand the Lens", "A Lens is a generated analysis circle. Official barrios, districts, planning ámbitos and the Madrid municipality are different geographic objects; a value for one is never transferred to another."],
        ["Find an official place", "Search M1 by official code or name. Selecting a result identifies its boundary but does not move the Lens. View on map moves only the camera; Analyze with Lens explicitly moves the active Lens, whose circle still is not the whole official area."],
        ["Use the Lens controls", "Lens A and Lens B have explicit centres and independent radii. Move a marker or change a radius only when you choose; this tour changes neither."],
        ["Read layers and source types", "Layers separate operational, register, observed, context and research sources. Granted licences are administrative records, not completed construction. Missing, unavailable, withheld, OFF and a published zero are different states."],
        ["Keep Place, Compare and City distinct", "PLACE keeps Lens and official-area evidence separately scoped. COMPARE is valid only for compatible scopes and metrics. CITY is municipality-wide context, not a Lens reading. Planning states do not prove physical construction progress."],
        ["Ask registered evidence questions", "M2 sits inside Find a place, not in a global panel. Its six-question menu resolves through K13 and may return a justified abstention. There is no chatbot, unrestricted question box or AI-generated answer."],
        ["Create one evidence dossier", "After a supported M2 question completes, a contextual action can export that frozen answer. The standalone HTML is readable offline and printable; JSON preserves the machine-readable record. The tour never runs a question or creates a dossier."],
        ["Verify and reproduce", "Evidence & limits shows provenance, scope, dates and ceilings. K11 separately exports exactly five workspace files, including state.url; M3 exports two files for one frozen question. The K11 URL restores neither that question nor its answer, and future deployments may publish different evidence."]
      ],
      doneTitle: "You’re ready to explore Madrid with Lens!", doneBody: "Your current workspace reading has not been changed.", doneStart: "Start exploring", replay: "Replay tutorial"
    },
    es: {
      help: "Guía", helpAria: "Abrir recorrido guiado", inviteTitle: "¿Primera vez en Lens?",
      inviteBody: "Descubre cómo encontrar lugares oficiales, formular preguntas de evidencia registradas y verificar una lectura. El recorrido es opcional y avanza a tu ritmo.",
      start: "Empezar recorrido", later: "Ahora no", back: "Anterior", next: "Siguiente", skip: "Saltar", close: "Cerrar recorrido",
      progress: "Paso {n} de 8", progressDone: "Recorrido completado", unavailable: "Este control no está visible en la disposición o lectura actual. El recorrido no cambiará el espacio de trabajo para hacerlo aparecer.",
      navigation: { controls: "Mostrar controles Lens", questions: "Mostrar preguntas" },
      steps: [
        ["Comprende la Lente", "Una Lente es un círculo de análisis generado. Los barrios, distritos, ámbitos de planeamiento y el municipio de Madrid son objetos geográficos distintos; un valor de uno nunca se traslada a otro."],
        ["Encuentra un lugar oficial", "Busca en M1 por código o nombre oficial. Seleccionar un resultado identifica su límite, pero no mueve la Lente. Ver en el mapa sólo mueve la cámara; Analizar con Lens mueve explícitamente la Lente activa, cuyo círculo sigue sin ser el área oficial completa."],
        ["Usa los controles de la Lente", "Las Lentes A y B tienen centros explícitos y radios independientes. Mueve un marcador o cambia un radio sólo cuando lo decidas; este recorrido no modifica ninguno."],
        ["Lee las capas y tipos de fuente", "Las capas separan fuentes operativas, de registro, observadas, de contexto y de investigación. Las licencias concedidas son registros administrativos, no obra terminada. Ausente, no disponible, retenido, OFF y cero publicado son estados distintos."],
        ["Distingue Lugar, Comparar y Ciudad", "LUGAR mantiene separados los alcances de la Lente y del área oficial. COMPARAR sólo es válido con alcances y métricas compatibles. CIUDAD es contexto municipal, no una lectura de la Lente. Los estados de planeamiento no prueban avance físico de obra."],
        ["Formula preguntas de evidencia registradas", "M2 está dentro de Buscar un lugar, no en un panel global. Su menú de seis preguntas resuelve mediante K13 y puede devolver una abstención justificada. No hay chatbot, pregunta libre ni respuesta generada por IA."],
        ["Crea un dosier de evidencia", "Tras completar una pregunta M2 compatible, una acción contextual puede exportar esa respuesta congelada. El HTML independiente se lee sin conexión y se imprime; el JSON conserva el registro legible por máquina. El recorrido no ejecuta preguntas ni crea dosieres."],
        ["Verifica y reproduce", "Evidencia y límites muestra procedencia, alcance, fechas y límites. K11 exporta por separado exactamente cinco archivos del espacio de trabajo, incluido state.url; M3 exporta dos archivos de una pregunta congelada. La URL K11 no restaura esa pregunta ni su respuesta y un despliegue futuro puede publicar evidencia distinta."]
      ],
      doneTitle: "¡Ya puedes explorar Madrid con Lens!", doneBody: "Tu lectura actual del espacio de trabajo no ha cambiado.", doneStart: "Empezar a explorar", replay: "Repetir recorrido"
    }
  };

  function byId(id) { return document.getElementById(id); }
  function clippedRect(el) {
    if (!el) return null;
    const style = root.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || el.hidden) return null;
    const source = el.getBoundingClientRect();
    let left = Math.max(0, source.left); let top = Math.max(0, source.top);
    let right = Math.min(root.innerWidth, source.right); let bottom = Math.min(root.innerHeight, source.bottom);
    for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const parentStyle = root.getComputedStyle(parent);
      const clipsX = /(auto|scroll|hidden|clip)/.test(parentStyle.overflowX);
      const clipsY = /(auto|scroll|hidden|clip)/.test(parentStyle.overflowY);
      if (!clipsX && !clipsY) continue;
      const rect = parent.getBoundingClientRect();
      if (clipsX) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
      if (clipsY) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
    }
    return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
  }
  function isVisible(el) { return Boolean(clippedRect(el)); }
  function firstVisible(...candidates) { return candidates.find(isVisible) || null; }
  function questionTarget() { return firstVisible(byId("qxTitle"), byId("questionExplorer"), byId("geoSearchToggle")); }
  function dossierTarget() { return firstVisible(document.querySelector("#qxAnswer .qx-action-dossier"), byId("qxTitle"), byId("questionExplorer"), byId("geoSearchToggle")); }
  function evidenceTarget() {
    const mode = byId("analysisPanel")?.dataset.mode || "PLACE";
    return firstVisible(document.querySelector(`[data-evidence-mode="${mode}"]`), byId("scopeRailFreshness"));
  }

  const STEPS = Object.freeze([
    Object.freeze({ id: "lens", target: () => firstVisible(byId("map")) }),
    Object.freeze({ id: "search", target: () => firstVisible(byId("geoSearchToggle")) }),
    Object.freeze({ id: "controls", target: () => firstVisible(byId("radiusSlider"), byId("modePlaceButton")), navigate: "controls" }),
    Object.freeze({ id: "layers", target: () => root.matchMedia("(max-width: 560px)").matches ? firstVisible(byId("mobileLayersButton"), byId("layerRail")) : firstVisible(byId("layerRail"), byId("mobileLayersButton")) }),
    Object.freeze({ id: "modes", target: () => firstVisible(byId("modeNav"), byId("analysisPanel")) }),
    Object.freeze({ id: "questions", target: questionTarget, navigate: "questions" }),
    Object.freeze({ id: "dossier", target: dossierTarget, navigate: "questions" }),
    Object.freeze({ id: "verify", target: evidenceTarget }),
  ]);

  let state = { step: 0, active: false, opener: null, highlight: null, sessionHandled: false, placementFrame: null, navigationFrame: null, navigationTimeout: null, navigationToken: 0 };

  function language() { return byId("languageSelect")?.value === "es" ? "es" : "en"; }
  function t() { return COPY[language()]; }
  function safeRead() { try { return root.localStorage.getItem(STORAGE_KEY); } catch (_) { return null; } }
  function safeWrite(value) { try { root.localStorage.setItem(STORAGE_KEY, value); } catch (_) {} }
  function targetFor(step) { return STEPS[step]?.target() || null; }
  function removeHighlight() { state.highlight?.remove(); state.highlight = null; }
  function showHighlight(target) {
    const rect = clippedRect(target); if (!rect) return;
    const ring = document.createElement("div");
    ring.id = "tutorialHighlight"; ring.setAttribute("aria-hidden", "true");
    ring.style.left = `${rect.left}px`; ring.style.top = `${rect.top}px`; ring.style.width = `${rect.width}px`; ring.style.height = `${rect.height}px`;
    document.body.append(ring); state.highlight = ring;
  }
  function positionGuide(el, target) {
    const phone = root.matchMedia("(max-width: 560px)").matches;
    el.classList.toggle("tutorial-guide-bottom", phone);
    if (phone) { el.style.removeProperty("left"); el.style.removeProperty("top"); return; }
    const margin = 16; const gap = 14; const rect = clippedRect(target);
    const width = Math.min(360, root.innerWidth - margin * 2);
    const height = Math.min(el.scrollHeight, root.innerHeight - margin * 2);
    let left = root.innerWidth - width - margin; let top = Math.max(margin, (root.innerHeight - height) / 2);
    if (rect) {
      if (rect.right + gap + width <= root.innerWidth - margin) left = rect.right + gap;
      else if (rect.left - gap - width >= margin) left = rect.left - gap - width;
      top = Math.max(margin, Math.min(root.innerHeight - height - margin, rect.top));
    }
    el.style.left = `${Math.round(left)}px`; el.style.top = `${Math.round(top)}px`;
  }
  function refreshPlacement() {
    if (!state.active) return;
    const guide = byId("tutorialGuide"); if (!guide) return;
    const target = state.step < STEP_COUNT ? targetFor(state.step) : null;
    removeHighlight(); if (target && isVisible(target)) showHighlight(target);
    positionGuide(guide, target);
  }
  function schedulePlacement() {
    if (!state.active || state.placementFrame) return;
    state.placementFrame = root.requestAnimationFrame(() => { state.placementFrame = null; refreshPlacement(); });
  }
  function cancelNavigation() {
    if (state.navigationFrame !== null) root.cancelAnimationFrame(state.navigationFrame);
    if (state.navigationTimeout !== null) root.clearTimeout(state.navigationTimeout);
    state.navigationFrame = null; state.navigationTimeout = null; state.navigationToken += 1;
  }
  function destroySurface() {
    cancelNavigation();
    if (state.placementFrame) root.cancelAnimationFrame(state.placementFrame);
    state.placementFrame = null; removeHighlight(); byId("tutorialInvite")?.remove(); byId("tutorialGuide")?.remove();
  }
  function restoreFocus() { const el = state.opener; state.opener = null; (el?.isConnected ? el : byId("tutorialHelpButton"))?.focus({ preventScroll: true }); }
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
  function translateInvite() {
    const el = byId("tutorialInvite"); if (!el) return;
    const c = t(); el.setAttribute("aria-label", c.inviteTitle); el.querySelector("strong").textContent = c.inviteTitle; el.querySelector("p").textContent = c.inviteBody;
    el.querySelector("[data-tutorial-start]").textContent = c.start; el.querySelector("[data-tutorial-later]").textContent = c.later;
  }
  function navigationFor(step, target) {
    const key = STEPS[step]?.navigate; if (!key) return null;
    if (key === "controls" && target?.id === "radiusSlider") return null;
    // A details child can retain a layout box while its disclosure is closed.
    // Treat M2 as already reachable only when the real disclosure is open;
    // otherwise retain the tour's explicit, non-state-changing reveal action.
    if (key === "questions" && target && target.id !== "geoSearchToggle" && isVisible(target) && byId("geoSearchQuestions")?.open) return null;
    return { key, label: t().navigation[key] };
  }
  function navigate(step) {
    cancelNavigation();
    const token = state.navigationToken;
    const current = () => state.active && state.step === step && state.navigationToken === token;
    const key = STEPS[step]?.navigate;
    if (key === "controls") {
      const controls = byId("panelControls") || byId("radiusSlider"); controls?.scrollIntoView({ block: "nearest", behavior: "auto" });
      state.navigationTimeout = root.setTimeout(() => {
        state.navigationTimeout = null; if (current()) renderGuide();
      }, 0); return;
    }
    if (key === "questions") {
      const panel = byId("geoSearchPanel"); const toggle = byId("geoSearchToggle");
      const inline = panel?.dataset.presentation === "inline";
      // M1 has one search surface with two presentations.  Desktop already
      // exposes its field, so reveal M2 through its real disclosure; compact
      // layouts retain the existing opener.  Neither path changes the reading.
      if (inline) {
        const disclosure = byId("geoSearchQuestions");
        if (disclosure && !disclosure.open) disclosure.open = true;
      } else if (panel?.hidden && toggle) toggle.click();
      let attempts = 0;
      const reveal = () => {
        state.navigationFrame = null; if (!current()) return;
        const questions = byId("questionExplorer");
        const disclosure = byId("geoSearchQuestions");
        const accessible = inline ? Boolean(disclosure?.open && questions && !questions.hidden) : Boolean(questions && !questions.hidden);
        if (accessible) { questions.scrollIntoView({ block: "nearest", behavior: "auto" }); renderGuide(); return; }
        if (++attempts < 120) state.navigationFrame = root.requestAnimationFrame(reveal); else renderGuide();
      };
      state.navigationFrame = root.requestAnimationFrame(reveal);
    }
  }
  function renderGuide() {
    destroySurface(); const c = t(); const done = state.step >= STEP_COUNT; const target = done ? null : targetFor(state.step); const unavailable = !done && !isVisible(target);
    if (target && !unavailable) showHighlight(target);
    const title = done ? c.doneTitle : c.steps[state.step][0]; const body = done ? c.doneBody : c.steps[state.step][1];
    const navigation = done ? null : navigationFor(state.step, target);
    const el = document.createElement("section"); el.id = "tutorialGuide"; el.className = "tutorial-guide"; el.setAttribute("role", "region"); el.setAttribute("aria-label", c.help); el.tabIndex = -1;
    const nav = navigation ? `<button type="button" class="tutorial-link" data-tutorial-navigate>${navigation.label}</button>` : "";
    el.innerHTML = `<div class="tutorial-guide-top"><span class="tutorial-progress" role="status" aria-live="polite" aria-atomic="true">${done ? c.progressDone : c.progress.replace("{n}", state.step + 1)}</span><button type="button" class="tutorial-icon" data-tutorial-close aria-label="${c.close}">×</button></div><h2>${title}</h2><p>${body}</p>${unavailable ? `<p class="tutorial-fallback">${c.unavailable}</p>` : ""}<div class="tutorial-actions">${done ? `<button type="button" data-tutorial-finish>${c.doneStart}</button><button type="button" class="tutorial-quiet" data-tutorial-replay>${c.replay}</button>` : `<button type="button" class="tutorial-quiet" data-tutorial-back ${state.step === 0 ? "disabled" : ""}>${c.back}</button><button type="button" data-tutorial-next>${c.next}</button>${nav}<button type="button" class="tutorial-link" data-tutorial-skip>${c.skip}</button>`}</div>`;
    document.body.append(el); positionGuide(el, target); el.querySelector("[data-tutorial-close]").onclick = () => finish("dismiss");
    if (done) {
      el.querySelector("[data-tutorial-finish]").onclick = () => finish("complete"); el.querySelector("[data-tutorial-replay]").onclick = () => { state.step = 0; renderGuide(); };
    } else {
      el.querySelector("[data-tutorial-back]").onclick = () => { state.step--; renderGuide(); };
      el.querySelector("[data-tutorial-next]").onclick = () => { state.step++; renderGuide(); };
      el.querySelector("[data-tutorial-skip]").onclick = () => finish("dismiss");
      el.querySelector("[data-tutorial-navigate]")?.addEventListener("click", () => navigate(state.step));
    }
    el.focus({ preventScroll: true });
  }
  function start(opener) { state.opener = opener || document.activeElement; state.step = 0; state.active = true; state.sessionHandled = true; renderGuide(); }
  function init() {
    const help = byId("tutorialHelpButton"); if (!help) return;
    help.addEventListener("click", () => start(help));
    byId("languageSelect")?.addEventListener("change", () => { if (state.active) renderGuide(); else { translateInvite(); help.lastElementChild.textContent = t().help; help.setAttribute("aria-label", t().helpAria); } });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && (state.active || byId("tutorialInvite"))) { event.preventDefault(); finish("dismiss"); } });
    root.addEventListener("resize", schedulePlacement); document.addEventListener("scroll", schedulePlacement, true);
    const stored = safeRead(); const shared = /(?:\?|&)v=/.test(root.location.search);
    // Deterministic regression harnesses are not first visitors. Suppression is
    // invitation-only; the manual Guided tour button remains available.
    const regressionHarness = /(?:\?|&)haloRegressionTest=1(?:&|$)/.test(root.location.search);
    const ready = () => document.readyState === "complete" && Boolean(document.querySelector("#map .leaflet-pane")) && Boolean(byId("analysisPanel")?.dataset.mode);
    const offerWhenReady = () => { if (state.active || state.sessionHandled) return; if (ready()) renderInvite(); else root.requestAnimationFrame(offerWhenReady); };
    if (!stored && !shared && !regressionHarness && !state.sessionHandled) root.requestAnimationFrame(offerWhenReady);
  }
  const api = { STORAGE_KEY, VERSION, STEP_COUNT, COPY, STEPS, safeRead, safeWrite, isVisible, targetFor, init, start };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MadridLensTutorial = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
