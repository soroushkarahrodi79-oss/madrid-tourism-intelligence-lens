/* Institutional Decision Journey V1 — a bounded, real-evidence route through
 * the existing PLACE → COMPARE → EVIDENCE mechanics. It owns no analytical
 * values: every action delegates to the production controls and every figure
 * remains rendered by the existing evidence models. */
(function (root) {
  "use strict";

  const CASE_ID = "yeserias";
  // The app canonicalises the address bar (replaceState) and drops ?journey= at an
  // unpredictable moment, so the request is taken from the loader's flag, not from
  // the live URL which this script may only see after that rewrite.
  const AUTOSTART = typeof document !== "undefined" && document.currentScript?.dataset.autostart === "1";
  const CASE = Object.freeze({
    primary: Object.freeze({ code: "APE.02.20", name: "CÁRCEL DE YESERÍAS", lat: 40.395543, lon: -3.691757, radiusM: 900 }),
    comparator: Object.freeze({ code: "APE.02.12", name: "C/ BOLÍVAR Y C/ COBRE" }),
  });
  const COPY = Object.freeze({
    en: Object.freeze({
      eyebrow: "Institutional case · Arganzuela", exit: "Exit case study", back: "Back", next: "Next", finish: "Finish", evidence: "Open Evidence & limits",
      steps: Object.freeze([
        Object.freeze({ title: "What do official records document at Yeserías?", body: "Start at a real point inside APE.02.20 CÁRCEL DE YESERÍAS. PLACE identifies its official barrio and planning context while the map keeps the 900 m Lens circle visible.", scope: "Keep the scopes separate: the planning values describe the whole ámbito; Lens counts describe the circle; barrio figures describe the whole barrio." }),
        Object.freeze({ title: "Examine the published evidence", body: "Read the four independent planning phase values, the documented available buildability and the granted urban-licence records located inside the Lens for the visible date window.", scope: "Granted is not built. Licence families remain separate, and address-point records inside the circle are not quantities for the planning ámbito." }),
        Object.freeze({ title: "Compare two compatible planning ámbitos", body: "COMPARE now contrasts APE.02.20 with nearby APE.02.12. Both are residential ámbitos in Arganzuela with published evidence from the same editions; Lens shows same/different phases and only valid B − A quantities.", scope: "This is a descriptive comparison of official records. It does not rank either place, explain causes or establish physical development." }),
        Object.freeze({ title: "Verify and reproduce the reading", body: "Open Evidence & limits to inspect the authoritative source, scope, units, reference dates and interpretation ceilings. The same drawer provides the versioned share link and evidence export.", scope: "The case establishes what the named official publications and resolved register subset document—nothing about completion, impact, need or a preferred planning decision." }),
      ]),
    }),
    es: Object.freeze({
      eyebrow: "Caso institucional · Arganzuela", exit: "Salir del caso", back: "Anterior", next: "Siguiente", finish: "Finalizar", evidence: "Abrir Evidencia y límites",
      steps: Object.freeze([
        Object.freeze({ title: "¿Qué documentan los registros oficiales en Yeserías?", body: "Partimos de un punto real dentro de APE.02.20 CÁRCEL DE YESERÍAS. PLACE identifica su contexto administrativo y urbanístico mientras el mapa mantiene visible el círculo Lens de 900 m.", scope: "Mantén separados los ámbitos: los valores de planeamiento describen el ámbito completo; los recuentos Lens, el círculo; y las cifras de barrio, el barrio completo." }),
        Object.freeze({ title: "Examina la evidencia publicada", body: "Lee las cuatro fases independientes, la edificabilidad disponible documentada y las licencias urbanísticas concedidas localizadas dentro del círculo para la ventana de fechas visible.", scope: "Concedida no significa construida. Las familias de licencias permanecen separadas y los puntos dentro del círculo no son cantidades del ámbito de planeamiento." }),
        Object.freeze({ title: "Compara dos ámbitos compatibles", body: "COMPARE contrasta ahora APE.02.20 con el cercano APE.02.12. Ambos son ámbitos residenciales de Arganzuela con evidencia publicada en las mismas ediciones; Lens muestra fases iguales o distintas y solo diferencias B − A válidas.", scope: "Es una comparación descriptiva de registros oficiales. No clasifica los lugares, explica causas ni demuestra desarrollo físico." }),
        Object.freeze({ title: "Verifica y reproduce la lectura", body: "Abre Evidencia y límites para comprobar fuente, alcance, unidades, fechas de referencia y techos de interpretación. El mismo cajón ofrece el enlace versionado y la exportación de evidencia.", scope: "El caso establece lo que documentan las publicaciones oficiales nombradas y el subconjunto resuelto del registro; no establece terminación, impacto, necesidad ni una decisión preferente." }),
      ]),
    }),
  });

  let state = { active: false, step: 0, licencesAutoEnabled: false, licencesUserOverride: false, licenceMutation: false, opener: null };
  const byId = (id) => document.getElementById(id);
  // Shared-reading restore sets <html lang> before it restores the visible
  // select, so read the document language to avoid an English first frame.
  const language = () => document.documentElement.lang === "es" ? "es" : "en";
  const text = () => COPY[language()];
  const pause = (ms) => new Promise((resolve) => root.setTimeout(resolve, ms));
  async function waitFor(test, attempts = 80) { for (let i = 0; i < attempts; i += 1) { if (test()) return true; await pause(50); } return false; }
  function click(id) { byId(id)?.click(); }
  function scrollTo(id) { const el = byId(id); if (el) el.scrollIntoView({ block: "start", behavior: root.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
  function ensureUi() {
    let host = byId("institutionalJourney");
    if (!host) { host = document.createElement("section"); host.id = "institutionalJourney"; host.hidden = true; byId("panelHead")?.insertAdjacentElement("afterend", host); }
    if (host.dataset.mounted === "true") return host;
    host.className = "institutional-journey"; host.setAttribute("aria-labelledby", "institutionalJourneyTitle"); host.dataset.mounted = "true";
    host.innerHTML = '<div class="institutional-journey-head"><div><span id="institutionalJourneyEyebrow" class="institutional-journey-eyebrow"></span><span id="institutionalJourneyProgress" class="institutional-journey-progress" aria-live="polite"></span></div><button id="institutionalJourneyClose" class="institutional-journey-close" type="button">×</button></div><h2 id="institutionalJourneyTitle"></h2><p id="institutionalJourneyBody"></p><p id="institutionalJourneyScope" class="institutional-journey-scope"></p><div class="institutional-journey-actions"><button id="institutionalJourneyBack" type="button" class="institutional-journey-secondary"></button><button id="institutionalJourneyEvidence" type="button" class="institutional-journey-secondary" hidden></button><button id="institutionalJourneyNext" type="button" class="institutional-journey-primary"></button></div>';
    byId("institutionalJourneyBack").addEventListener("click", () => go(state.step - 1));
    byId("institutionalJourneyNext").addEventListener("click", () => state.step === 3 ? exit() : go(state.step + 1));
    byId("institutionalJourneyEvidence").addEventListener("click", openEvidence);
    byId("institutionalJourneyClose").addEventListener("click", exit);
    return host;
  }

  // Only manage a layer that the journey itself enabled. A user's manual
  // intervention transfers control to them, even if the initial state was OFF.
  function setJourneyLicences(enabled) {
    const toggle = document.querySelector('[data-layer="licences"]');
    if (!toggle || state.licencesUserOverride) return;
    if (enabled && !toggle.checked) {
      state.licenceMutation = true;
      try { toggle.click(); } finally { state.licenceMutation = false; }
      state.licencesAutoEnabled = toggle.checked;
    } else if (!enabled && state.licencesAutoEnabled) {
      if (toggle.checked) {
        state.licenceMutation = true;
        try { toggle.click(); } finally { state.licenceMutation = false; }
      }
      state.licencesAutoEnabled = false;
    }
  }

  async function applyStep(step) {
    if (step <= 1) {
      click("modePlaceButton");
      if (step === 1) {
        setJourneyLicences(true);
        scrollTo("planningAmbito");
      } else {
        setJourneyLicences(false);
        scrollTo("areaProfile");
      }
      return;
    }
    // Remove only journey-owned point clutter; keep independently enabled
    // administrative layers untouched, including when navigating Back.
    setJourneyLicences(false);
    click("modeCompareButton");
    click("compareScopeAmbito");
    await waitFor(() => byId("ambitoCodeDatalist")?.children.length > 0);
    for (const [id, value] of [["ambitoSelectA", CASE.primary.code], ["ambitoSelectB", CASE.comparator.code]]) {
      const input = byId(id); if (!input) continue; input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await waitFor(() => !byId("ambitoCompareBody")?.hidden);
    scrollTo(step === 2 ? "ambitoCompare" : "institutionalJourney");
  }

  function render() {
    const host = byId("institutionalJourney"); if (!host) return;
    const c = text(), s = c.steps[state.step];
    host.hidden = !state.active; host.dataset.step = String(state.step + 1);
    byId("institutionalJourneyEyebrow").textContent = c.eyebrow;
    byId("institutionalJourneyProgress").textContent = `${state.step + 1} / ${c.steps.length}`;
    byId("institutionalJourneyTitle").textContent = s.title;
    byId("institutionalJourneyBody").textContent = s.body;
    byId("institutionalJourneyScope").textContent = s.scope;
    const back = byId("institutionalJourneyBack"); back.textContent = c.back; back.disabled = state.step === 0;
    const next = byId("institutionalJourneyNext"); next.textContent = state.step === c.steps.length - 1 ? c.finish : c.next;
    const evidence = byId("institutionalJourneyEvidence"); evidence.textContent = c.evidence; evidence.hidden = state.step !== c.steps.length - 1; evidence.classList.toggle("institutional-journey-evidence", !evidence.hidden);
    const close = byId("institutionalJourneyClose"); close.setAttribute("aria-label", c.exit); close.title = c.exit;
  }

  async function go(step) { state.step = Math.max(0, Math.min(3, step)); render(); await applyStep(state.step); }
  function closeDrawer() { const drawer = byId("evidenceDrawer"); if (drawer?.open) drawer.close(); }
  async function exit() {
    closeDrawer(); click("modePlaceButton"); click("compareScopeLens");
    setJourneyLicences(false);
    state.active = false; render(); state.opener?.focus?.({ preventScroll: true });
  }
  function openEvidence() { const route = document.querySelector('[data-evidence-mode="COMPARE"]'); route?.click(); }
  function start(opener) { ensureUi(); state = { active: true, step: 0, licencesAutoEnabled: false, licencesUserOverride: false, licenceMutation: false, opener: opener || document.activeElement }; render(); applyStep(0); }
  function init() {
    const host = ensureUi(); if (!host) return;
    byId("languageSelect")?.addEventListener("change", render);
    document.querySelector('[data-layer="licences"]')?.addEventListener("change", () => {
      if (state.active && !state.licenceMutation) {
        state.licencesUserOverride = true;
        state.licencesAutoEnabled = false;
      }
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.active && !byId("evidenceDrawer")?.open) { event.preventDefault(); exit(); } });
    if (AUTOSTART || new URLSearchParams(root.location.search).get("journey") === CASE_ID) { ensureUi(); start(host); }
  }

  const api = { CASE_ID, CASE, COPY, init, start };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MadridInstitutionalJourney = api;
  if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init(); }
})(typeof window !== "undefined" ? window : globalThis);
