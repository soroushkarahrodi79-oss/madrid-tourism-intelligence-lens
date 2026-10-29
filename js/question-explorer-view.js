// Urban evidence questions — the DOM view (M2).
//
// Renders the question list and the answer card for js/question-explorer.js. It
// owns no evidence and no rule: it asks the model for an outcome, asks the model
// to present it, and writes the presentation into the page with textContent only.
//
// STALENESS IS THE CENTRAL INVARIANT. An answer is bound to the analytical
// context it was computed for (`contextKey`). The application calls `notify()` on
// every change that could alter that context (a Lens move, a radius change, a
// Lens A/B switch, a finder selection, a licence window, an artifact arriving).
// The moment the key differs the card is marked out of date — synchronously, in
// the same task as the change — and a coalesced recompute follows once the
// context has settled. The card therefore never presents a figure as current for
// a context it was not computed for.
//
// The module touches nothing outside its host element except the live region it
// owns and the event handlers it installs on it.

const RECOMPUTE_DELAY_MS = 140;

export function mountQuestionExplorer({ host, model, bridge }) {
  if (!host) return null;

  const state = {
    current: null, // a question id, or "REFUSED:<id>"
    outcome: null,
    stale: false,
    collapsed: false,
    renderedSignature: null,
    evidenceSourceId: null, // the latest answered evidence, the subject of "which source supports…"
    timer: null,
    run: 0,
  };

  const q = (selector) => host.querySelector(selector);
  const language = () => bridge.language();
  const copy = () => model.copyFor(language());

  // ------------------------------------------------------------------ build
  host.replaceChildren();
  host.classList.add("qx");

  const head = el("div", "qx-head");
  const title = el("h3", "qx-title");
  title.id = "qxTitle";
  const collapse = el("button", "qx-collapse");
  collapse.type = "button";
  collapse.setAttribute("aria-controls", "qxBody");
  head.append(title, collapse);

  const body = el("div", "qx-body");
  body.id = "qxBody";
  const intro = el("p", "qx-intro");
  const contextBox = el("div", "qx-context");
  contextBox.id = "qxContext";

  const list = el("ul", "qx-list");
  list.id = "qxQuestions";
  for (const question of model.QUESTIONS) {
    const item = document.createElement("li");
    const button = el("button", "qx-q");
    button.type = "button";
    button.dataset.question = question.id;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-controls", "qxAnswer");
    button.append(el("span", "qx-q-subject"), el("span", "qx-q-text"));
    item.append(button);
    list.append(item);
  }

  const refused = el("details", "qx-refused");
  refused.id = "qxRefused";
  const refusedSummary = document.createElement("summary");
  refusedSummary.className = "qx-refused-summary";
  const refusedIntro = el("p", "qx-refused-intro");
  const refusedList = el("ul", "qx-list qx-list-refused");
  for (const ask of model.REFUSED_ASKS) {
    const item = document.createElement("li");
    const button = el("button", "qx-q qx-q-refused");
    button.type = "button";
    button.dataset.refused = ask.id;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-controls", "qxAnswer");
    button.append(el("span", "qx-q-text"));
    item.append(button);
    refusedList.append(item);
  }
  refused.append(refusedSummary, refusedIntro, refusedList);

  const live = el("p", "sr-only");
  live.id = "qxLive";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");

  const answer = el("article", "qx-answer");
  answer.id = "qxAnswer";
  answer.tabIndex = -1;
  answer.hidden = true;
  answer.setAttribute("aria-labelledby", "qxAnswerHeading");

  body.append(intro, contextBox, list, refused, live, answer);
  host.append(head, body);

  // ---------------------------------------------------------------- helpers
  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }
  function text(tag, className, value) {
    const node = el(tag, className);
    node.textContent = value;
    return node;
  }
  function verbatim(node, value, lang) {
    node.dataset.verbatim = "";
    if (lang) node.lang = lang;
    node.textContent = value;
    return node;
  }
  const visible = () => !host.closest("[hidden]");

  // ------------------------------------------------------------ static labels
  function renderLabels() {
    const c = copy();
    title.textContent = c.title;
    collapse.textContent = state.collapsed ? c.open : c.close;
    collapse.setAttribute("aria-expanded", String(!state.collapsed));
    body.hidden = state.collapsed;
    intro.textContent = c.intro;
    list.setAttribute("aria-label", c.title);
    for (const button of list.querySelectorAll(".qx-q")) {
      const question = model.questionFor(button.dataset.question);
      button.children[0].textContent = c.subject[question.subject];
      button.children[1].textContent = c.questions[question.id];
    }
    refusedSummary.textContent = c.refusedTitle;
    refusedIntro.textContent = c.refusedIntro;
    for (const button of refusedList.querySelectorAll(".qx-q")) {
      button.children[0].textContent = c.refused[button.dataset.refused];
    }
    const lines = model.describeContext(bridge.getContext(), language());
    contextBox.replaceChildren(...lines.map((line) => text("p", "qx-context-line", line)));
    contextBox.setAttribute("aria-label", c.sections.context);
    contextBox.setAttribute("role", "group");
  }

  function markPressed() {
    for (const button of host.querySelectorAll(".qx-q")) {
      const id = button.dataset.question || `REFUSED:${button.dataset.refused}`;
      button.setAttribute("aria-pressed", String(id === state.current));
    }
  }

  // --------------------------------------------------------------- answering
  function ask(id, { silent = false } = {}) {
    state.current = id;
    const run = ++state.run;
    clearTimeout(state.timer);
    const context = { ...bridge.getContext(), evidenceSourceId: state.evidenceSourceId };
    const registry = bridge.getRegistry();
    const refusedAsk = id.startsWith("REFUSED:");
    if (!refusedAsk) bridge.ensure(id);
    let outcome;
    if (!registry) {
      outcome = Object.freeze({
        status: bridge.registryFailed() ? "unavailable" : "loading", questionId: id, shape: refusedAsk ? null : model.questionFor(id).shape,
        contextKey: model.contextKey(context), lens: context.lens, waitingFor: "planning", subject: null, params: null, result: null, trace: [],
      });
    } else if (refusedAsk) {
      outcome = model.askRefused(registry, id.slice("REFUSED:".length), context);
    } else {
      outcome = model.askQuestion(registry, id, context);
    }
    if (run !== state.run) return;
    state.outcome = outcome;
    state.stale = false;
    if (outcome.status === "answered" && outcome.result && outcome.questionId !== "SOURCE_PROVENANCE" && !refusedAsk) {
      state.evidenceSourceId = outcome.result.sourceId;
    }
    markPressed();
    render({ announce: !silent });
    // An explicit ask brings its own answer into view inside the finder; a
    // recompute after a context change must not move anything.
    if (!silent && typeof answer.scrollIntoView === "function") answer.scrollIntoView({ block: "nearest" });
  }

  // The card is rebuilt from the outcome whenever the outcome, the language, the
  // reading or the staleness changes. Presentation is pure, so a language switch
  // or a reading switch never re-runs the registry.
  function render({ announce = false } = {}) {
    const context = bridge.getContext();
    renderLabels();
    markPressed();
    state.renderedSignature = signature();
    if (!state.outcome) {
      answer.hidden = true;
      answer.replaceChildren();
      return;
    }
    const c = copy();
    const presentation = model.presentOutcome(state.outcome, {
      language: language(), reading: bridge.reading(), context, registry: bridge.getRegistry(),
    });
    const keep = captureInteractionState();
    answer.hidden = false;
    answer.dataset.kind = presentation.kind;
    answer.dataset.stale = String(state.stale);
    answer.dataset.question = state.outcome.questionId;
    answer.setAttribute("aria-busy", String(state.stale || presentation.kind === "loading"));
    answer.replaceChildren(...buildAnswer(presentation, c));
    restoreInteractionState(keep);
    if (announce) {
      live.textContent = presentation.kind === "abstention"
        ? `${c.status.abstained}. ${presentation.abstention.reasonName}`
        : presentation.kind === "loading" || presentation.kind === "unavailable"
          ? presentation.statusLabel
          : `${c.status.answered}. ${presentation.headline}`;
    }
  }

  // Rebuilding the card must not cost the reader their place: the open disclosures
  // and the focused control survive a recompute, a language switch or a reading switch.
  function captureInteractionState() {
    const opened = [...answer.querySelectorAll("details")].map((node) => node.open);
    const focused = document.activeElement;
    let focus = null;
    if (focused && answer.contains(focused)) {
      if (focused.dataset.reading) focus = { selector: `.qx-reading-btn[data-reading="${focused.dataset.reading}"]` };
      else if (focused.classList.contains("qx-action-drawer")) focus = { selector: ".qx-action-drawer" };
      else if (focused.classList.contains("qx-action-source")) focus = { selector: ".qx-action-source" };
      else if (focused.classList.contains("qx-action-dossier")) focus = { selector: ".qx-action-dossier" };
      else if (focused.tagName === "SUMMARY") focus = { summary: [...answer.querySelectorAll("summary")].indexOf(focused) };
    }
    return { opened, focus };
  }

  function restoreInteractionState({ opened, focus }) {
    const details = [...answer.querySelectorAll("details")];
    opened.forEach((isOpen, index) => { if (details[index]) details[index].open = isOpen; });
    if (!focus) return;
    const target = focus.selector ? answer.querySelector(focus.selector) : answer.querySelectorAll("summary")[focus.summary];
    if (target) target.focus({ preventScroll: true });
  }

  function signature() {
    return [language(), bridge.reading(), state.stale, state.outcome ? state.outcome.contextKey : null, state.collapsed].join("|");
  }

  // ------------------------------------------------------------ answer card
  function buildAnswer(p, c) {
    const nodes = [];

    const header = el("div", "qx-answer-head");
    const heading = text("h4", "qx-answer-title", p.question);
    heading.id = "qxAnswerHeading";
    const badge = text("span", "qx-badge", state.stale ? c.status.staleHeld : p.statusLabel);
    badge.dataset.kind = p.kind;
    header.append(heading, badge);
    nodes.push(header);

    if (state.stale) {
      const stale = text("p", "qx-stale", c.status.stale);
      stale.setAttribute("role", "note");
      nodes.push(stale);
    }

    nodes.push(readingToggle(c));

    if (p.kind === "loading" || p.kind === "unavailable") {
      nodes.push(text("p", "qx-loading", p.loadingNote || c.status.loading));
      return nodes;
    }

    const result = section("result", c.sections.result);
    if (p.kind === "answer") {
      result.append(text("p", "qx-headline", p.headline));
      result.append(...subjectNotes(p));
      result.append(factList(p));
      if (p.hint) result.append(text("p", "qx-hint", p.hint));
    } else {
      result.append(abstentionBlock(p, c));
      result.append(...subjectNotes(p));
    }
    nodes.push(result);

    if (p.scope) {
      const scope = section("scope", c.sections.scope);
      scope.append(text("p", "qx-scope-label", p.scope.label));
      if (p.scope.instance) {
        const instance = el("p", "qx-scope-instance");
        verbatim(instance, p.scope.instance);
        scope.append(instance);
      }
      nodes.push(scope);
    }

    if (p.evidence) nodes.push(evidenceSection(p, c));

    if (p.limits.length) {
      const limits = section("limits", c.sections.limits);
      const ul = el("ul", "qx-limits");
      for (const line of p.limits) ul.append(text("li", "", line));
      limits.append(ul);
      nodes.push(limits);
    }

    nodes.push(verificationSection(p, c));

    if (p.trace.length) {
      const details = el("details", "qx-trace");
      details.append(text("summary", "", c.detail.trace));
      const dl = el("dl", "qx-facts");
      for (const row of p.trace) {
        dl.append(text("dt", "", row.label));
        dl.append(verbatim(el("dd"), row.value));
      }
      details.append(dl);
      nodes.push(details);
    }
    return nodes;
  }

  function section(kind, label) {
    const wrapper = el("section", `qx-section qx-section-${kind}`);
    wrapper.append(text("h5", "qx-section-title", label));
    return wrapper;
  }

  function readingToggle(c) {
    const group = el("div", "qx-reading");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", c.reading.label);
    for (const mode of ["citizen", "analyst"]) {
      const button = text("button", "qx-reading-btn", c.reading[mode]);
      button.type = "button";
      button.dataset.reading = mode;
      button.setAttribute("aria-pressed", String(bridge.reading() === mode));
      group.append(button);
    }
    return group;
  }

  function subjectNotes(p) {
    return p.subjectLines.map((line) => text("p", "qx-subject-note", line));
  }

  function factList(p) {
    const dl = el("dl", "qx-facts");
    for (const fact of p.facts) {
      const dt = text("dt", "", fact.label);
      const dd = el("dd");
      if (fact.verbatim) verbatim(dd, fact.value, fact.lang || null);
      else dd.textContent = fact.value;
      if (fact.href) {
        dd.textContent = "";
        const link = el("a");
        link.href = fact.href;
        link.rel = "noopener noreferrer";
        link.target = "_blank";
        verbatim(link, fact.value);
        dd.append(link);
      }
      if (fact.detail) dd.append(text("small", "qx-fact-detail", ` ${fact.detail}`));
      if (fact.note) {
        const note = text("small", "qx-fact-note", fact.note.label ? ` ${fact.note.label}: ${fact.note.text}` : ` ${fact.note.text}`);
        note.lang = fact.note.lang;
        dd.append(note);
      }
      if (fact.changes && fact.changes.length) dd.append(changeList(fact));
      if (fact.items) dd.append(itemList(fact));
      dl.append(dt, dd);
    }
    return dl;
  }

  function changeList(fact) {
    const ul = el("ul", "qx-changes");
    for (const change of fact.changes) {
      const li = el("li");
      li.append(text("span", "qx-change-field", `${change.field}: `));
      li.append(text("span", "qx-change-label", `${change.previousLabel} `));
      li.append(verbatim(el("span"), change.previous));
      li.append(text("span", "qx-change-label", ` → ${change.currentLabel} `));
      li.append(verbatim(el("span"), change.current));
      ul.append(li);
    }
    return ul;
  }

  function itemList(fact) {
    const wrapper = el("div", "qx-items");
    const ul = el("ul", "qx-item-list");
    const SHOWN = 6;
    const make = (item) => {
      const li = el("li");
      li.append(verbatim(el("code", "qx-item-code"), item.code), document.createTextNode(" "), verbatim(el("span", "qx-item-name"), item.name || ""));
      if (item.note) li.append(text("small", "qx-fact-note", ` · ${item.note}`));
      return li;
    };
    fact.items.slice(0, SHOWN).forEach((item) => ul.append(make(item)));
    wrapper.append(ul);
    if (fact.items.length > SHOWN) {
      const more = el("details", "qx-more");
      more.append(text("summary", "", `+${fact.items.length - SHOWN}`));
      const rest = el("ul", "qx-item-list");
      fact.items.slice(SHOWN).forEach((item) => rest.append(make(item)));
      more.append(rest);
      wrapper.append(more);
    }
    return wrapper;
  }

  function abstentionBlock(p, c) {
    const a = p.abstention;
    const box = el("div", "qx-abstention");
    box.append(text("p", "qx-abstention-name", a.reasonName));
    box.append(text("p", "qx-abstention-text", a.explanation));
    if (a.prohibitionText) box.append(text("p", "qx-abstention-clause", `${c.detail.clause}: ${a.prohibitionText}`));
    if (a.guidance) box.append(text("p", "qx-abstention-guidance", a.guidance));
    const codes = el("p", "qx-abstention-codes");
    codes.append(text("span", "", `${c.detail.reason}: `), verbatim(el("code", "qx-code"), a.reason));
    if (a.prohibition) codes.append(document.createTextNode(" · "), verbatim(el("code", "qx-code"), a.prohibition));
    box.append(codes);
    if (a.registryMessage) {
      const details = el("details", "qx-message");
      details.append(text("summary", "", c.detail.registryMessage));
      details.append(verbatim(el("p"), a.registryMessage, "en"));
      box.append(details);
    }
    return box;
  }

  function evidenceSection(p, c) {
    const e = p.evidence;
    const wrapper = section("evidence", c.sections.evidence);
    const name = el("p", "qx-source-name");
    verbatim(name, e.sourceName);
    wrapper.append(name);
    const reference = text("p", "qx-reference", `${c.freshness.reference_date}: ${e.referenceDate}`);
    reference.dataset.declared = String(e.referenceDeclared);
    wrapper.append(reference);
    wrapper.append(text("p", "qx-derivation", e.derivationText));

    const details = el("details", "qx-source-record");
    details.append(text("summary", "", c.verify.sourceRecord));
    const dl = el("dl", "qx-facts");
    if (e.authority) {
      dl.append(text("dt", "", c.sourceFields.authority), verbatim(el("dd"), e.authority));
    }
    for (const row of e.freshness) {
      const dd = el("dd");
      if (row.declared) dd.textContent = row.value;
      else dd.textContent = row.value && row.raw ? `${row.raw}` : c.notDeclared;
      dd.dataset.declared = String(row.declared);
      dl.append(text("dt", "", row.label), dd);
    }
    dl.append(text("dt", "", c.sourceFields.derivation), text("dd", "", `${e.derivation}`));
    dl.append(text("dt", "", c.sourceFields.ceiling), verbatim(el("dd"), e.ceiling, "en"));
    details.append(dl);
    wrapper.append(details);
    return wrapper;
  }

  function verificationSection(p, c) {
    const wrapper = section("verification", c.sections.verification);
    const row = el("div", "qx-actions");
    const drawer = text("button", "qx-action qx-action-drawer", c.verify.drawer);
    drawer.type = "button";
    drawer.setAttribute("aria-haspopup", "dialog");
    row.append(drawer);
    if (p.verification && p.verification.canAskSource && p.kind === "answer") {
      const source = text("button", "qx-action qx-action-source", c.verify.source);
      source.type = "button";
      row.append(source);
    }
    // A dossier is a frozen record of one completed, registered M2 outcome.
    // Loading/unavailable states and the deliberately refused catalogue are not
    // research events supported by Dossier V1. Stale outcomes stay visible but
    // cannot be exported until the existing recompute settles.
    const supported = model.QUESTIONS.some((question) => question.id === state.outcome.questionId);
    let dossierStatus = null;
    if (supported && (p.kind === "answer" || p.kind === "abstention")) {
      const dossier = text("button", "qx-action qx-action-dossier", c.verify.dossier);
      dossier.type = "button";
      dossier.disabled = state.stale;
      dossier.setAttribute("aria-describedby", "qxDossierStatus");
      row.append(dossier);
      dossierStatus = text("p", "qx-dossier-status", "");
      dossierStatus.id = "qxDossierStatus";
      dossierStatus.setAttribute("role", "status");
      dossierStatus.setAttribute("aria-live", "polite");
    }
    wrapper.append(row);
    if (dossierStatus) wrapper.append(dossierStatus);
    // Sharing and exporting reproduce the Lens, radius, dates and reading; the
    // question and its answer are not part of either, and the card says so.
    const note = text("p", "qx-share-note", c.verify.shareNote);
    note.id = "qxShareNote";
    drawer.setAttribute("aria-describedby", "qxShareNote");
    wrapper.append(note);
    return wrapper;
  }

  // ------------------------------------------------------------- notifications
  // Called by the application on every change that could alter the analytical
  // context. Cheap by construction: one key comparison on the hot path.
  function notify() {
    if (!state.outcome) {
      // Keep the context summary current even before a question is asked.
      if (visible()) renderContextOnly();
      return;
    }
    const key = model.contextKey(bridge.getContext());
    const contextChanged = state.outcome.contextKey !== key;
    if (contextChanged && state.outcome.status === "loading") {
      // A dependency that was still arriving has arrived (or the Lens moved while
      // it loaded). Nothing was ever shown as an answer, so nothing is stale.
      clearTimeout(state.timer);
      if (visible()) ask(state.current, { silent: true });
      return;
    }
    if (contextChanged) {
      if (!state.stale) {
        state.stale = true;
        render();
      }
      clearTimeout(state.timer);
      if (visible()) state.timer = setTimeout(() => ask(state.current, { silent: true }), RECOMPUTE_DELAY_MS);
      return;
    }
    if (state.stale) {
      // The context returned to the one the answer was computed for.
      state.stale = false;
      clearTimeout(state.timer);
      render();
      return;
    }
    if (signature() !== state.renderedSignature) render();
    else if (visible()) renderContextOnly();
  }

  function renderContextOnly() {
    const lines = model.describeContext(bridge.getContext(), language());
    const current = [...contextBox.children].map((node) => node.textContent).join("\n");
    if (current !== lines.join("\n")) contextBox.replaceChildren(...lines.map((line) => text("p", "qx-context-line", line)));
  }

  // ------------------------------------------------------------------ events
  host.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const questionButton = target.closest(".qx-q");
    if (questionButton && host.contains(questionButton)) {
      ask(questionButton.dataset.question || `REFUSED:${questionButton.dataset.refused}`);
      return;
    }
    const readingButton = target.closest(".qx-reading-btn");
    if (readingButton) {
      bridge.setReading(readingButton.dataset.reading);
      render();
      const again = answer.querySelector(`.qx-reading-btn[data-reading="${readingButton.dataset.reading}"]`);
      if (again) again.focus();
      return;
    }
    if (target.closest(".qx-action-drawer")) {
      const opener = target.closest(".qx-action-drawer");
      const outcome = state.outcome;
      const scope = outcome && outcome.result && outcome.result.kind === "EVIDENCE" ? outcome.result.scope : null;
      bridge.openDrawer({ opener, scope, ambitoCode: outcome && outcome.subject ? outcome.subject.code : null });
      return;
    }
    if (target.closest(".qx-action-source")) {
      ask("SOURCE_PROVENANCE");
      const next = host.querySelector('.qx-q[data-question="SOURCE_PROVENANCE"]');
      if (next) next.focus();
      return;
    }
    if (target.closest(".qx-action-dossier")) {
      const button = target.closest(".qx-action-dossier");
      const status = answer.querySelector(".qx-dossier-status");
      if (!state.stale && state.outcome && typeof bridge.createDossier === "function") {
        button.disabled = true;
        bridge.createDossier({ outcome: state.outcome, statusNode: status, button }).finally(() => {
          if (button.isConnected) button.disabled = state.stale;
        });
      }
      return;
    }
    if (target.closest(".qx-collapse")) {
      state.collapsed = !state.collapsed;
      renderLabels();
      collapse.focus();
    }
  });

  const observer = new MutationObserver(() => {
    if (signature() !== state.renderedSignature) render();
    else renderLabels();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  renderLabels();

  return {
    notify,
    rerender: () => render(),
    ask,
    snapshot: () => ({
      current: state.current,
      stale: state.stale,
      kind: state.outcome ? state.outcome.status : null,
      questionId: state.outcome ? state.outcome.questionId : null,
      contextKey: state.outcome ? state.outcome.contextKey : null,
      evidenceSourceId: state.evidenceSourceId,
      reason: state.outcome && state.outcome.result && state.outcome.result.kind === "ABSTENTION" ? state.outcome.result.reason : null,
      prohibition: state.outcome && state.outcome.result && state.outcome.result.kind === "ABSTENTION" ? state.outcome.result.prohibition : null,
    }),
    destroy() { observer.disconnect(); clearTimeout(state.timer); },
  };
}
