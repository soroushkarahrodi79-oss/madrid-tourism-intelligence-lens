// Urban evidence questions — pure question model and answer presenter (M2).
//
// WHAT THIS IS. A closed menu of six questions, each bound to ONE shape of the
// existing Evidence Registry (js/evidence-registry.js, K13). Choosing a question
// builds that shape's parameters from an EXPLICIT analytical context (the active
// Lens, the finder selection, the applied licence window), runs
// `registry.query(shape, params)` and projects the registry's own frozen result
// into a presentation model.
//
// WHAT THIS IS NOT. It computes no spatial relation, no phase rule, no edition
// comparison and no licence count: every one of those is the registry's. It
// holds no model, no key and no network call, takes no free text and generates
// no prose about the world. The only strings it authors are the question
// wording, the labels, the "what this cannot show" limits and the explanation
// of each abstention reason — all static, all fixed per language. Every factual
// token on an answer is copied from the registry result, so the interface cannot
// change what a resolver established.
//
// A future language model may, at most, choose one of the QUESTIONS below from
// the user's words (docs/URBAN_EVIDENCE_QUESTIONS_V1.md §9). It would not touch
// anything on the path from `askQuestion` to `presentOutcome`.
//
// PURE: no DOM, no Leaflet, no fetch, no clock, no globals. The registry
// instance is passed in, so the same code runs in the browser and under
// `node --test` against the committed artifacts.

export const MODEL_VERSION = "m2-question-explorer-1";

// ---------------------------------------------------------------- the catalogue

// `subject` names the analytical object the question is ABOUT, shown on the
// button so the reader sees the scope before asking. `needs` lists the runtime
// dependencies whose readiness decides between "loading" and a real answer.
export const QUESTIONS = Object.freeze([
  Object.freeze({ id: "AMBITO_AT_POINT", shape: "AMBITO_AT_POINT", subject: "lensCentre", needs: Object.freeze(["planning"]) }),
  Object.freeze({ id: "AMBITO_PHASES", shape: "AMBITO_PHASES", subject: "ambito", needs: Object.freeze(["planning"]) }),
  Object.freeze({ id: "AMBITO_EDITION_DIFF", shape: "AMBITO_EDITION_DIFF", subject: "ambito", needs: Object.freeze(["planning", "editions"]) }),
  Object.freeze({ id: "AMBITOS_IN_LENS", shape: "AMBITOS_IN_LENS", subject: "lensCircle", needs: Object.freeze(["planning"]) }),
  Object.freeze({ id: "LICENCES_IN_LENS", shape: "LICENCES_IN_LENS", subject: "lensCircleDates", needs: Object.freeze(["licences"]) }),
  Object.freeze({ id: "SOURCE_PROVENANCE", shape: "SOURCE_PROVENANCE", subject: "lastAnswer", needs: Object.freeze([]) }),
]);

// Asks the product will not answer. Each is sent to the REAL registry, which
// refuses it before any resolver runs; the interface only shows that refusal.
// `shape` is a registered shape except for the one deliberately unregistered ask.
export const REFUSED_ASKS = Object.freeze([
  Object.freeze({ id: "dwellings", shape: "AMBITO_BUILDABILITY", flag: "wantsDwellingCount" }),
  Object.freeze({ id: "completion", shape: "AMBITO_PHASES", flag: "wantsCompletionDate" }),
  Object.freeze({ id: "ranking", shape: "AMBITOS_IN_LENS", flag: "wantsRanking" }),
  Object.freeze({ id: "cause", shape: "AMBITO_EDITION_DIFF", flag: "wantsCausalClaim" }),
  Object.freeze({ id: "legal", shape: "AMBITO_AT_POINT", flag: "wantsLegalInterpretation" }),
  Object.freeze({ id: "share", shape: "AMBITOS_IN_LENS", flag: "wantsApportionment" }),
  Object.freeze({ id: "pressure", shape: "TOURIST_PRESSURE", flag: null }),
]);

const QUESTION_BY_ID = new Map(QUESTIONS.map((question) => [question.id, question]));
const REFUSED_BY_ID = new Map(REFUSED_ASKS.map((ask) => [ask.id, ask]));

export function questionFor(id) {
  return QUESTION_BY_ID.get(id) || null;
}

// ------------------------------------------------------------- explicit context

const isObject = (value) => value !== null && typeof value === "object";
const isText = (value) => typeof value === "string" && value.trim().length > 0;

// The context key identifies everything an answer depends on. Two equal keys mean
// the answer on screen was computed for the context now in force; a different key
// means it was not, and the interface must say so or recompute. Language is not
// part of it: it changes wording, never facts.
export function contextKey(context) {
  const lens = isObject(context && context.lens) ? context.lens : {};
  const selection = isObject(context && context.selection) ? context.selection : null;
  const window = isObject(context && context.licenceWindow) ? context.licenceWindow : null;
  const readiness = isObject(context && context.readiness) ? context.readiness : {};
  return JSON.stringify([
    lens.which ?? null, lens.lon ?? null, lens.lat ?? null, lens.radiusM ?? null,
    selection ? [selection.type ?? null, selection.code ?? null] : null,
    window ? [window.from ?? null, window.to ?? null] : null,
    readiness.planning ?? null, readiness.licences ?? null, readiness.editions ?? null,
  ]);
}

function lensPoint(context) {
  const lens = isObject(context && context.lens) ? context.lens : {};
  return { lon: lens.lon, lat: lens.lat };
}

function lensCircle(context) {
  const lens = isObject(context && context.lens) ? context.lens : {};
  return { lon: lens.lon, lat: lens.lat, radiusM: lens.radiusM };
}

function readyState(context, dependency) {
  const readiness = isObject(context && context.readiness) ? context.readiness : {};
  return readiness[dependency] || "ready";
}

// --------------------------------------------------------------------- asking

// askQuestion runs ONE registered shape through the registry and returns the
// registry's result untouched inside a frozen outcome record.
//
// status
//   "loading"   a dependency is still arriving. Not an answer and not a refusal.
//   "answered"  the registry returned evidence.
//   "abstained" the registry returned an abstention (reason kept verbatim).
//
// A dependency that is UNAVAILABLE is not special-cased here: the registry was
// built without that model, so it abstains by itself and that abstention is what
// the reader sees.
export function askQuestion(registry, questionId, context) {
  const question = QUESTION_BY_ID.get(questionId);
  if (!question) throw new Error(`askQuestion: "${questionId}" is not a question of this catalogue`);
  const key = contextKey(context);
  // The Lens the answer is computed for, frozen with the outcome so a held answer
  // keeps describing ITS Lens after the reader has moved on to another.
  const lens = Object.freeze({ ...(isObject(context && context.lens) ? context.lens : {}) });
  const base = { questionId, shape: question.shape, contextKey: key, lens, subject: null, params: null, result: null, trace: [] };
  for (const dependency of question.needs) {
    const state = readyState(context, dependency);
    if (state === "loading" || state === "idle") return Object.freeze({ ...base, status: "loading", waitingFor: dependency });
  }

  let params;
  let subject = null;
  const trace = [];
  switch (question.id) {
    case "AMBITO_AT_POINT":
      params = lensPoint(context);
      break;
    case "AMBITOS_IN_LENS":
      params = lensCircle(context);
      break;
    case "LICENCES_IN_LENS":
      // The grant-date window is the one the application validated and shows in
      // its own controls. Nothing here derives a window from a phrase.
      params = { ...lensCircle(context), window: isObject(context.licenceWindow) ? { from: context.licenceWindow.from, to: context.licenceWindow.to } : null };
      break;
    case "SOURCE_PROVENANCE":
      params = { sourceId: isText(context && context.evidenceSourceId) ? context.evidenceSourceId : undefined };
      break;
    default: {
      // AMBITO_PHASES / AMBITO_EDITION_DIFF: the subject is ONE whole ámbito.
      subject = resolveAmbitoSubject(registry, context, trace);
      params = subject.code ? { code: subject.code } : {};
    }
  }
  const result = registry.query(question.shape, params);
  return Object.freeze({
    ...base,
    status: result && result.kind === "EVIDENCE" ? "answered" : "abstained",
    params: Object.freeze({ ...params }),
    subject,
    trace: Object.freeze(trace),
    result,
  });
}

// The ámbito an ámbito-scoped question is about. Two explicit sources, in this
// order, and the one used is ALWAYS named on the answer:
//   1. the exact code of a planning ámbito selected in the place finder;
//   2. the ámbito that the registry says contains the active Lens centre.
// A selected barrio, district or municipality is never turned into an ámbito. If
// neither source establishes ONE ámbito, no code is passed and the registry
// itself abstains (AMBIGUOUS_SCOPE).
function resolveAmbitoSubject(registry, context, trace) {
  const selection = isObject(context && context.selection) ? context.selection : null;
  if (selection && selection.type === "AMBITO" && isText(selection.code)) {
    return Object.freeze({ origin: "SELECTION", code: selection.code, ignoredSelection: null });
  }
  const ignoredSelection = selection ? Object.freeze({ type: selection.type ?? null, name: selection.name ?? null }) : null;
  const atPoint = registry.query("AMBITO_AT_POINT", lensPoint(context));
  trace.push(Object.freeze({ shape: "AMBITO_AT_POINT", result: atPoint }));
  if (atPoint && atPoint.kind === "EVIDENCE" && isText(atPoint.value.ambitoCode)) {
    return Object.freeze({ origin: "LENS_CENTRE", code: atPoint.value.ambitoCode, ignoredSelection });
  }
  return Object.freeze({ origin: "NONE", code: null, ignoredSelection });
}

// A refused ask: same registry, same refusal path, no resolver reached.
export function askRefused(registry, askId, context) {
  const ask = REFUSED_BY_ID.get(askId);
  if (!ask) throw new Error(`askRefused: "${askId}" is not a refused ask of this catalogue`);
  const params = { ...lensCircle(context), code: isObject(context && context.selection) && context.selection.type === "AMBITO" ? context.selection.code : undefined };
  if (ask.flag) params[ask.flag] = true;
  const result = registry.query(ask.shape, params);
  return Object.freeze({
    status: result && result.kind === "EVIDENCE" ? "answered" : "abstained",
    questionId: `REFUSED:${ask.id}`, shape: ask.shape, contextKey: contextKey(context),
    lens: Object.freeze({ ...(isObject(context && context.lens) ? context.lens : {}) }),
    subject: null, params: Object.freeze({ ...params }), trace: Object.freeze([]), result,
  });
}

// ----------------------------------------------------------------------- copy

const SCOPE_LABELS = Object.freeze({
  PLANNING_AMBITO: { en: "One whole official planning ámbito", es: "Un ámbito de planeamiento oficial completo" },
  LENS_INTERSECT_AMBITO: { en: "Which ámbitos the Lens circle touches (membership only)", es: "Qué ámbitos toca el círculo de la Lente (solo pertenencia)" },
  ADDRESS_POINT: { en: "Located records inside the Lens circle", es: "Registros localizados dentro del círculo de la Lente" },
  LENS_CIRCLE: { en: "The Lens circle", es: "El círculo de la Lente" },
  OFFICIAL_BARRIO: { en: "One whole official barrio", es: "Un barrio oficial completo" },
  MUNICIPALITY: { en: "The whole municipality", es: "Todo el municipio" },
  POINT_OBSERVATION: { en: "A single located record", es: "Un único registro localizado" },
  BOUNDED_STUDY_AREA: { en: "A bounded study area", es: "Un área de estudio acotada" },
  OFFICIAL_DISTRICT: { en: "One whole official district", es: "Un distrito oficial completo" },
});

const COPY = Object.freeze({
  en: {
    title: "Explore questions",
    intro: "Each question is answered from the official evidence already loaded, with its source and its limits. A missing answer stays missing.",
    contextLens: "Lens {which} · {radius} · centre {lat}, {lon}",
    contextSelection: "Place selected in the finder: {name} ({type})",
    contextNoSelection: "No place selected in the finder.",
    subject: { lensCentre: "Lens centre", ambito: "Planning ámbito", lensCircle: "Lens circle", lensCircleDates: "Lens circle · licence dates", lastAnswer: "Latest answer" },
    questions: {
      AMBITO_AT_POINT: "Which official planning ámbito contains the Lens centre?",
      AMBITO_PHASES: "What does the official source publish about this ámbito's development state?",
      AMBITO_EDITION_DIFF: "What changed between the two available official editions?",
      AMBITOS_IN_LENS: "Which planning ámbitos does the Lens circle touch?",
      LICENCES_IN_LENS: "Which urban licences were granted inside the Lens, within the selected dates?",
      SOURCE_PROVENANCE: "Which source supports the latest answer?",
    },
    refusedTitle: "What this tool will not answer",
    refusedIntro: "These asks are refused by the evidence registry, not by this screen. Activate one to see the refusal.",
    refused: {
      dwellings: "How many homes will be built here?",
      completion: "When will construction be finished?",
      ranking: "Which of these areas is the best?",
      cause: "Why did the published state change?",
      legal: "Is this legal or permitted?",
      share: "What share of the ámbito lies inside the Lens?",
      pressure: "Is this area under too much tourist pressure?",
    },
    sections: { question: "Question", result: "Result", scope: "Scope", evidence: "Evidence", limits: "What this cannot show", verification: "Verification", context: "Analytical context" },
    status: { unavailable: "The source registry could not be loaded, so no question can be answered. This is a loading failure, not an answer.", answered: "Answer", abstained: "No answer — the evidence does not support one", loading: "Loading the official data…", stale: "The Lens or the dates changed — updating this answer…", staleHeld: "Out of date — this answer was computed for an earlier context." },
    reading: { label: "Reading", citizen: "Citizen", analyst: "Analyst" },
    verify: { shareNote: "Copy shareable link and Export evidence in Evidence & limits reproduce the Lens, radius, dates and reading. They do not include this question or its answer: after opening a shared link, ask the question again.", drawer: "Open Evidence & limits", source: "Which source supports this?", sourceRecord: "Source record (all five freshness fields)" },
    close: "Collapse",
    open: "Expand",
    notDeclared: "not declared by the publisher",
    notPublished: "not published",
    freshness: {
      reference_date: "Reference date", published_at: "Published", retrieved_at: "Retrieved by this project",
      update_frequency: "Update frequency", source_state: "Source state",
    },
    sourceFields: { name: "Source", authority: "Authority", dataset: "Dataset", artifact: "Committed file", period: "What the dates mean", ceiling: "Interpretation ceiling (verbatim)", derivation: "How the value was obtained", scopeId: "Scope" },
    derivation: {
      SOURCE_FACT: "Published by the source, carried through unchanged.",
      POINT_IN_POLYGON: "Computed: which official boundary contains one point.",
      CIRCLE_INTERSECT_POLYGON: "Computed: which official boundaries the circle touches. Membership only; no area, share or quantity.",
      IN_CIRCLE_FILTER: "Computed: located records counted inside the circle, by family and grant date.",
      REGISTRY_LOOKUP: "Read from the project's source registry.",
      EDITION_DIFF: "Computed: comparison of the values published in two official editions.",
      SAME_SCOPE_COMPARISON: "Computed: comparison of two objects of the same scope.",
      AREA_PROFILE_ASSEMBLY: "Assembled from a barrio identity and its published register.",
      DESTINATION_CONTEXT_ASSEMBLY: "Assembled from published municipal observations.",
    },
    detail: { registryMessage: "Registry message (verbatim, English)", reason: "Reason", clause: "Prohibited clause", trace: "How the subject was established" },
    abstention: {
      UNREGISTERED_SHAPE: { name: "Not a question this tool answers", text: "This question is not one of the registered question shapes, so it is refused rather than approximated." },
      AMBIGUOUS_SCOPE: { name: "The scope is not established", text: "The question needs exactly one place, point or source to be named, and the current context does not provide it." },
      NO_EVIDENCE_FOR_SCOPE: { name: "No evidence for this scope", text: "The scope is clear, but the source holds nothing for it, or the model needed to answer is not available. This is an absence of evidence, not a zero." },
      CROSS_SCOPE_WITHOUT_BASIS: { name: "Different scopes cannot be combined", text: "Values from different analytical scopes would have to be combined, and no documented basis exists for doing so." },
      OUTSIDE_SOURCE_UNIVERSE: { name: "Outside what the source covers", text: "The object is not in the source's universe: an unknown code or source, a place outside the published geography, or an ámbito that the boundary file holds but the dated editions do not list." },
      OUTSIDE_TEMPORAL_COVERAGE: { name: "Outside the dates the source covers", text: "The requested period lies outside the source's coverage. No nearest period is substituted." },
      WITHHELD_BY_PUBLISHER: { name: "Withheld by the publisher", text: "The publisher declared this value withheld, so it is not presented as a figure." },
      CEILING_PROHIBITS: { name: "Refused: beyond what the evidence permits", text: "The source's interpretation ceiling forbids this kind of claim. The refusal is a result, not a failure." },
    },
    prohibition: {
      UNTRACEABLE_TOKEN: "A factual statement with no registered source.",
      CROSS_SCOPE_COMBINATION: "Combining values of different scopes without a documented basis.",
      WHOLE_TO_PART_APPORTIONMENT: "Assigning a whole-area quantity to a part of it, such as the Lens circle.",
      DWELLING_COUNT: "Any count of dwellings. Only buildability in m² is published, and it is not a dwelling count.",
      COMPLETION_OR_PROJECTION: "A completion date, a timeline, a progress percentage or any projection.",
      RANKING_OR_RECOMMENDATION: "A ranking, score, ordering or recommendation of places.",
      CAUSAL_CLAIM: "A statement about why something happened.",
      LEGAL_INTERPRETATION: "A legal or regulatory interpretation.",
    },
    subjectOrigin: {
      SELECTION: "Planning ámbito {code}, selected in the place finder.",
      LENS_CENTRE: "Planning ámbito {code}, the one containing the centre of Lens {which}.",
      NONE: "No single planning ámbito is established: none is selected in the finder and none contains the Lens centre.",
      ignored: "The place selected in the finder is a {type}, not a planning ámbito, so it was not used.",
    },
    selectAmbito: "To ask this, select a planning ámbito in the place finder, or move the Lens centre inside one.",
    loadingNeeds: { planning: "The planning-ámbito artifacts are still loading.", licences: "The granted-licence register (about 5 MB) is being loaded for this question.", editions: "The two-edition comparison data is still loading." },
    answers: {
      ambitoAtPoint: "The centre of Lens {which} lies inside planning ámbito {code} — {name}.",
      phases: "The {date} official edition publishes four independent development fields for ámbito {code}.",
      edition: "Published values for ámbito {code} compared between the {previous} and {current} official editions.",
      inLens: { one: "Lens {which} touches 1 official planning ámbito.", many: "Lens {which} touches {count} official planning ámbitos.", none: "Lens {which} touches no official planning ámbito of the committed universe." },
      licences: "Located granted licences inside Lens {which} ({radius}), granted {from} – {to}.",
      licencesNone: "No located granted licence falls inside Lens {which} ({radius}) in {from} – {to}.",
      provenance: "{name} supports the latest answer.",
    },
    facts: {
      code: "Official code", denomination: "Official denomination", district: "District (as attributed by the edition)", use: "Characteristic use", surface: "Surface",
      phase: { planeamiento: "Planning instrument (Planeamiento)", gestion: "Land management (Gestión)", urbanizacion_proyecto: "Works design (Urbanización · Proyecto)", urbanizacion_obras: "Works (Urbanización · Obras)" },
      containsCentre: "contains the Lens centre",
      touched: "Ámbitos touched", count: "Number of ámbitos touched",
      family: { BUILDING_URBANISTIC_LICENCE_FAMILY: "Building and urbanistic licences", ACTIVITY_LICENCE_FAMILY: "Activity licences", TEMPORARY_ACTIVITY_FAMILY: "Temporary activity licences" },
      window: "Grant-date window", windowAdjusted: "The requested window was adjusted to the register's coverage.",
      datesHint: "These dates are the ones set in the Granted urban licences controls. To change them, switch on Granted urban licences in the layers panel and edit From and To; this answer then updates. Asking does not switch that layer on.",
      windowDefault: "No window was set, so the register's documented default was applied: the twelve months ending at its latest grant date.",
      unlocated: "Register rows that could not be located (in no count)",
      coverageStatement: "Register coverage",
      previousEdition: "Previous edition", currentEdition: "Current edition",
      s1: "Four published phase fields", s2: "Published situation and notes", buildability: "Available buildability (m²)",
      previousValue: "Previous", currentValue: "Current",
      reasonModel: "Model note (English)",
    },
    outcome: {
      NO_CHANGE: "No substantive published difference between the two editions",
      STATE_TRANSITION: "Published value changed between the editions",
      NEW_AMBITO: "Present only in the later edition",
      ABSENT_FROM_EDITION: "Present only in the earlier edition",
      MODIFIED_BY_INSTRUMENT: "Modified by a planning instrument",
      CAUSE_UNRESOLVED: "Difference found; the editions do not say why",
      NON_COMPARABLE: "Not comparable",
    },
    buildabilityState: { NO_CHANGE: "No substantive published difference", OBSERVED_PUBLISHED_DIFFERENCE: "Observed published difference (detail in the Planning ámbito panel)", WITHHELD: "Numeric comparison withheld" },
    limits: {
      AMBITO_AT_POINT: [
        "Says which ámbito contains the single point at the Lens centre. It says nothing about the rest of the circle.",
        "Containment is geometry only: not development state, buildability, construction or ownership.",
        "The ámbito universe does not cover the whole municipality.",
      ],
      AMBITO_PHASES: [
        "Describes the whole ámbito, never the Lens circle or a barrio.",
        "The four fields are independent. The publisher documents no order between them, so they are not one overall stage, and no progress, percentage, completion date or timeline is derived.",
        "A published phase is an administrative status, not evidence of what has been physically built.",
      ],
      AMBITO_EDITION_DIFF: [
        "Compares the published values of two dated official editions, nothing between or after them.",
        "A difference is not necessarily progress, and the editions do not by themselves say why it occurred.",
        "Describes published planning evidence, not physical change on the ground.",
      ],
      AMBITOS_IN_LENS: [
        "Lists which ámbitos the circle touches. It gives no area, share or quantity of any ámbito inside the circle.",
        "An ámbito's published figures describe the whole ámbito; they are never apportioned to the Lens.",
        "Touching the circle is not the same as being the Lens's subject area.",
      ],
      LICENCES_IN_LENS: [
        "A granted licence is an administrative grant, not proof that works began, were completed or that anything was occupied.",
        "Granted-only register: there are no refused or pending applications, so no approval rate exists.",
        "Counts are per family and are never added into one total. Rows that could not be located are in no count.",
        "A count inside the Lens circle is not a figure for the barrio or the district.",
      ],
      SOURCE_PROVENANCE: [
        "Identifies the source, its dates and its interpretation ceiling. It does not extend what the source can support.",
        "A date not declared by the publisher stays not declared.",
      ],
    },
  },
  es: {
    title: "Explorar preguntas",
    intro: "Cada pregunta se responde con la evidencia oficial ya cargada, con su fuente y sus límites. Una respuesta que falta sigue faltando.",
    contextLens: "Lente {which} · {radius} · centro {lat}, {lon}",
    contextSelection: "Lugar seleccionado en el buscador: {name} ({type})",
    contextNoSelection: "Ningún lugar seleccionado en el buscador.",
    subject: { lensCentre: "Centro de la Lente", ambito: "Ámbito de planeamiento", lensCircle: "Círculo de la Lente", lensCircleDates: "Círculo de la Lente · fechas de licencia", lastAnswer: "Última respuesta" },
    questions: {
      AMBITO_AT_POINT: "¿Qué ámbito de planeamiento oficial contiene el centro de la Lente?",
      AMBITO_PHASES: "¿Qué publica la fuente oficial sobre el estado de desarrollo de este ámbito?",
      AMBITO_EDITION_DIFF: "¿Qué cambió entre las dos ediciones oficiales disponibles?",
      AMBITOS_IN_LENS: "¿Qué ámbitos de planeamiento toca el círculo de la Lente?",
      LICENCES_IN_LENS: "¿Qué licencias urbanísticas se concedieron dentro de la Lente en las fechas seleccionadas?",
      SOURCE_PROVENANCE: "¿Qué fuente respalda la última respuesta?",
    },
    refusedTitle: "Lo que esta herramienta no responde",
    refusedIntro: "El registro de evidencia rechaza estas preguntas, no esta pantalla. Active una para ver el rechazo.",
    refused: {
      dwellings: "¿Cuántas viviendas se construirán aquí?",
      completion: "¿Cuándo terminará la construcción?",
      ranking: "¿Cuál de estas áreas es la mejor?",
      cause: "¿Por qué cambió el estado publicado?",
      legal: "¿Es legal o está permitido?",
      share: "¿Qué porción del ámbito queda dentro de la Lente?",
      pressure: "¿Soporta esta zona demasiada presión turística?",
    },
    sections: { question: "Pregunta", result: "Resultado", scope: "Alcance", evidence: "Evidencia", limits: "Lo que no permite concluir", verification: "Verificación", context: "Contexto analítico" },
    status: { unavailable: "No se pudo cargar el registro de fuentes, por lo que no se puede responder ninguna pregunta. Es un fallo de carga, no una respuesta.", answered: "Respuesta", abstained: "Sin respuesta: la evidencia no la respalda", loading: "Cargando los datos oficiales…", stale: "La Lente o las fechas cambiaron: actualizando esta respuesta…", staleHeld: "Desactualizada: esta respuesta se calculó para un contexto anterior." },
    reading: { label: "Lectura", citizen: "Ciudadana", analyst: "Analista" },
    verify: { shareNote: "Copiar enlace para compartir y Exportar evidencia, en Evidencia y límites, reproducen la Lente, el radio, las fechas y la lectura. No incluyen esta pregunta ni su respuesta: al abrir un enlace compartido, vuelva a hacer la pregunta.", drawer: "Abrir Evidencia y límites", source: "¿Qué fuente respalda esto?", sourceRecord: "Registro de la fuente (los cinco campos de vigencia)" },
    close: "Contraer",
    open: "Desplegar",
    notDeclared: "no declarada por el editor",
    notPublished: "no publicado",
    freshness: {
      reference_date: "Fecha de referencia", published_at: "Publicado", retrieved_at: "Recuperado por este proyecto",
      update_frequency: "Frecuencia de actualización", source_state: "Estado de la fuente",
    },
    sourceFields: { name: "Fuente", authority: "Autoridad", dataset: "Conjunto de datos", artifact: "Archivo incluido", period: "Qué significan las fechas", ceiling: "Techo de interpretación (literal)", derivation: "Cómo se obtuvo el valor", scopeId: "Alcance" },
    derivation: {
      SOURCE_FACT: "Publicado por la fuente, sin transformación.",
      POINT_IN_POLYGON: "Calculado: qué límite oficial contiene un punto.",
      CIRCLE_INTERSECT_POLYGON: "Calculado: qué límites oficiales toca el círculo. Solo pertenencia; sin área, porción ni cantidad.",
      IN_CIRCLE_FILTER: "Calculado: registros localizados contados dentro del círculo, por familia y fecha de concesión.",
      REGISTRY_LOOKUP: "Leído del registro de fuentes del proyecto.",
      EDITION_DIFF: "Calculado: comparación de los valores publicados en dos ediciones oficiales.",
      SAME_SCOPE_COMPARISON: "Calculado: comparación de dos objetos del mismo alcance.",
      AREA_PROFILE_ASSEMBLY: "Ensamblado a partir de la identidad de un barrio y su padrón publicado.",
      DESTINATION_CONTEXT_ASSEMBLY: "Ensamblado a partir de observaciones municipales publicadas.",
    },
    detail: { registryMessage: "Mensaje del registro (literal, en inglés)", reason: "Motivo", clause: "Cláusula prohibida", trace: "Cómo se estableció el sujeto" },
    abstention: {
      UNREGISTERED_SHAPE: { name: "No es una pregunta que esta herramienta responda", text: "Esta pregunta no es una de las formas de pregunta registradas, así que se rechaza en lugar de aproximarla." },
      AMBIGUOUS_SCOPE: { name: "El alcance no está establecido", text: "La pregunta necesita que se nombre exactamente un lugar, punto o fuente, y el contexto actual no lo proporciona." },
      NO_EVIDENCE_FOR_SCOPE: { name: "Sin evidencia para este alcance", text: "El alcance está claro, pero la fuente no contiene nada para él, o el modelo necesario no está disponible. Es una ausencia de evidencia, no un cero." },
      CROSS_SCOPE_WITHOUT_BASIS: { name: "No se pueden combinar alcances distintos", text: "Habría que combinar valores de alcances analíticos distintos y no existe una base documentada para hacerlo." },
      OUTSIDE_SOURCE_UNIVERSE: { name: "Fuera de lo que cubre la fuente", text: "El objeto no está en el universo de la fuente: un código o una fuente desconocidos, un lugar fuera de la geografía publicada, o un ámbito que el archivo de límites contiene pero las ediciones fechadas no listan." },
      OUTSIDE_TEMPORAL_COVERAGE: { name: "Fuera de las fechas que cubre la fuente", text: "El periodo solicitado queda fuera de la cobertura de la fuente. No se sustituye por el periodo más cercano." },
      WITHHELD_BY_PUBLISHER: { name: "Retenido por el editor", text: "El editor declaró retenido este valor, por lo que no se presenta como cifra." },
      CEILING_PROHIBITS: { name: "Rechazada: más allá de lo que permite la evidencia", text: "El techo de interpretación de la fuente prohíbe este tipo de afirmación. El rechazo es un resultado, no un fallo." },
    },
    prohibition: {
      UNTRACEABLE_TOKEN: "Una afirmación factual sin fuente registrada.",
      CROSS_SCOPE_COMBINATION: "Combinar valores de alcances distintos sin una base documentada.",
      WHOLE_TO_PART_APPORTIONMENT: "Asignar una cantidad de un área completa a una parte de ella, como el círculo de la Lente.",
      DWELLING_COUNT: "Cualquier recuento de viviendas. Solo se publica edificabilidad en m², que no es un recuento de viviendas.",
      COMPLETION_OR_PROJECTION: "Una fecha de finalización, un calendario, un porcentaje de avance o cualquier proyección.",
      RANKING_OR_RECOMMENDATION: "Una clasificación, puntuación, ordenación o recomendación de lugares.",
      CAUSAL_CLAIM: "Una afirmación sobre por qué ocurrió algo.",
      LEGAL_INTERPRETATION: "Una interpretación legal o normativa.",
    },
    subjectOrigin: {
      SELECTION: "Ámbito de planeamiento {code}, seleccionado en el buscador.",
      LENS_CENTRE: "Ámbito de planeamiento {code}, el que contiene el centro de la Lente {which}.",
      NONE: "No se establece un único ámbito: ninguno está seleccionado en el buscador y ninguno contiene el centro de la Lente.",
      ignored: "El lugar seleccionado en el buscador es un {type}, no un ámbito de planeamiento, por lo que no se usó.",
    },
    selectAmbito: "Para preguntar esto, seleccione un ámbito de planeamiento en el buscador o mueva el centro de la Lente dentro de uno.",
    loadingNeeds: { planning: "Los datos de ámbitos de planeamiento aún se están cargando.", licences: "Se está cargando el registro de licencias concedidas (unos 5 MB) para esta pregunta.", editions: "Los datos de comparación entre ediciones aún se están cargando." },
    answers: {
      ambitoAtPoint: "El centro de la Lente {which} está dentro del ámbito de planeamiento {code} — {name}.",
      phases: "La edición oficial de {date} publica cuatro campos de desarrollo independientes para el ámbito {code}.",
      edition: "Valores publicados del ámbito {code} comparados entre las ediciones oficiales de {previous} y {current}.",
      inLens: { one: "La Lente {which} toca 1 ámbito de planeamiento oficial.", many: "La Lente {which} toca {count} ámbitos de planeamiento oficiales.", none: "La Lente {which} no toca ningún ámbito de planeamiento oficial del universo incluido." },
      licences: "Licencias concedidas localizadas dentro de la Lente {which} ({radius}), concedidas del {from} al {to}.",
      licencesNone: "Ninguna licencia concedida localizada cae dentro de la Lente {which} ({radius}) del {from} al {to}.",
      provenance: "{name} respalda la última respuesta.",
    },
    facts: {
      code: "Código oficial", denomination: "Denominación oficial", district: "Distrito (según la edición)", use: "Uso característico", surface: "Superficie",
      phase: { planeamiento: "Instrumento de planeamiento (Planeamiento)", gestion: "Gestión del suelo (Gestión)", urbanizacion_proyecto: "Proyecto de obras (Urbanización · Proyecto)", urbanizacion_obras: "Obras (Urbanización · Obras)" },
      containsCentre: "contiene el centro de la Lente",
      touched: "Ámbitos tocados", count: "Número de ámbitos tocados",
      family: { BUILDING_URBANISTIC_LICENCE_FAMILY: "Licencias de edificación y urbanísticas", ACTIVITY_LICENCE_FAMILY: "Licencias de actividad", TEMPORARY_ACTIVITY_FAMILY: "Licencias de actividad temporal" },
      window: "Ventana de fechas de concesión", windowAdjusted: "La ventana solicitada se ajustó a la cobertura del registro.",
      datesHint: "Estas fechas son las fijadas en los controles de Licencias urbanísticas otorgadas. Para cambiarlas, active Licencias urbanísticas otorgadas en el panel de capas y edite Desde y Hasta; esta respuesta se actualizará. Preguntar no activa esa capa.",
      windowDefault: "No se fijó ninguna ventana, así que se aplicó la predeterminada documentada del registro: los doce meses que terminan en su última fecha de concesión.",
      unlocated: "Filas del registro sin localizar (en ningún recuento)",
      coverageStatement: "Cobertura del registro",
      previousEdition: "Edición anterior", currentEdition: "Edición actual",
      s1: "Cuatro campos de fase publicados", s2: "Situación y observaciones publicadas", buildability: "Edificabilidad disponible (m²)",
      previousValue: "Anterior", currentValue: "Actual",
      reasonModel: "Nota del modelo (en inglés)",
    },
    outcome: {
      NO_CHANGE: "Sin diferencia sustantiva publicada entre las dos ediciones",
      STATE_TRANSITION: "El valor publicado cambió entre las ediciones",
      NEW_AMBITO: "Presente solo en la edición posterior",
      ABSENT_FROM_EDITION: "Presente solo en la edición anterior",
      MODIFIED_BY_INSTRUMENT: "Modificado por un instrumento de planeamiento",
      CAUSE_UNRESOLVED: "Diferencia encontrada; las ediciones no indican por qué",
      NON_COMPARABLE: "No comparable",
    },
    buildabilityState: { NO_CHANGE: "Sin diferencia sustantiva publicada", OBSERVED_PUBLISHED_DIFFERENCE: "Diferencia publicada observada (detalle en el panel de ámbito de planeamiento)", WITHHELD: "Comparación numérica retenida" },
    limits: {
      AMBITO_AT_POINT: [
        "Indica qué ámbito contiene el punto único del centro de la Lente. No dice nada del resto del círculo.",
        "La contención es solo geometría: no es estado de desarrollo, edificabilidad, construcción ni propiedad.",
        "El universo de ámbitos no cubre todo el municipio.",
      ],
      AMBITO_PHASES: [
        "Describe el ámbito completo, nunca el círculo de la Lente ni un barrio.",
        "Los cuatro campos son independientes. El editor no documenta ningún orden entre ellos, por lo que no forman una etapa global y no se deriva ningún avance, porcentaje, fecha de finalización ni calendario.",
        "Una fase publicada es un estado administrativo, no evidencia de lo que se ha construido físicamente.",
      ],
      AMBITO_EDITION_DIFF: [
        "Compara los valores publicados de dos ediciones oficiales fechadas, nada entre ellas ni posterior.",
        "Una diferencia no es necesariamente avance, y las ediciones por sí solas no dicen por qué ocurrió.",
        "Describe evidencia de planeamiento publicada, no un cambio físico sobre el terreno.",
      ],
      AMBITOS_IN_LENS: [
        "Enumera qué ámbitos toca el círculo. No da área, porción ni cantidad de ningún ámbito dentro del círculo.",
        "Las cifras publicadas de un ámbito describen el ámbito completo; nunca se reparten a la Lente.",
        "Tocar el círculo no equivale a que ese ámbito sea el objeto de estudio de la Lente.",
      ],
      LICENCES_IN_LENS: [
        "Una licencia concedida es una concesión administrativa, no prueba de que las obras empezaran, terminaran o de que algo se ocupara.",
        "Registro solo de concedidas: no hay solicitudes denegadas ni pendientes, por lo que no existe tasa de aprobación.",
        "Los recuentos son por familia y nunca se suman en un total. Las filas sin localizar no están en ningún recuento.",
        "Un recuento dentro del círculo de la Lente no es una cifra del barrio ni del distrito.",
      ],
      SOURCE_PROVENANCE: [
        "Identifica la fuente, sus fechas y su techo de interpretación. No amplía lo que la fuente puede respaldar.",
        "Una fecha no declarada por el editor sigue siendo no declarada.",
      ],
    },
  },
});

export function copyFor(language) {
  return COPY[language === "es" ? "es" : "en"];
}

// ----------------------------------------------------------------- formatting

function interpolate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match));
}

const MONTHS = Object.freeze({
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."],
});

export function formatDate(value, language) {
  const text = String(value ?? "");
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const month = /^(\d{4})-(\d{2})$/.exec(text);
  const months = MONTHS[language === "es" ? "es" : "en"];
  if (day) return `${Number(day[3])} ${months[Number(day[2]) - 1]} ${day[1]}`;
  if (month) return `${months[Number(month[2]) - 1]} ${month[1]}`;
  return null;
}

function formatNumber(value, language, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value).toLocaleString(language === "es" ? "es-ES" : "en-GB", { maximumFractionDigits });
}

function formatRadius(radiusM) {
  if (!Number.isFinite(radiusM)) return "—";
  return radiusM >= 1000 && radiusM % 100 === 0 ? `${radiusM / 1000} km` : `${radiusM} m`;
}

function formatCoordinate(value) {
  return Number.isFinite(value) ? value.toFixed(5) : "—";
}

// ----------------------------------------------------------------- presenting

// presentOutcome(outcome, { language, reading, context }) → a plain presentation
// model. `facts`, `scope`, `evidence` and `limits` are IDENTICAL in the citizen
// and the analyst reading; the readings differ only in labels and in the extra
// `trace` rows the analyst reading adds. Every fact carries `id` and `value`
// copied from the registry result, so a test can compare the two sides.
export function presentOutcome(outcome, { language = "en", reading = "citizen", context = {}, registry = null } = {}) {
  const copy = copyFor(language);
  context = { ...context, lens: outcome.lens || context.lens };
  const analyst = reading === "analyst";
  const refused = String(outcome.questionId).startsWith("REFUSED:");
  const questionText = refused
    ? copy.refused[outcome.questionId.slice("REFUSED:".length)]
    : copy.questions[outcome.questionId];
  const model = {
    kind: outcome.status === "loading" ? "loading" : outcome.status === "unavailable" ? "unavailable" : outcome.status === "answered" ? "answer" : "abstention",
    questionId: outcome.questionId,
    shape: outcome.shape,
    question: questionText,
    reading: analyst ? "analyst" : "citizen",
    contextKey: outcome.contextKey,
    headline: null,
    hint: null,
    facts: [],
    scope: null,
    evidence: null,
    limits: [],
    abstention: null,
    subjectLines: [],
    verification: null,
    loadingNote: null,
    trace: [],
  };

  model.subjectLines = subjectLines(outcome, copy, context);

  if (outcome.status === "loading") {
    model.statusLabel = copy.status.loading;
    model.loadingNote = copy.loadingNeeds[outcome.waitingFor] || null;
    return deepFreeze(model);
  }
  if (outcome.status === "unavailable") {
    model.statusLabel = copy.status.unavailable;
    model.loadingNote = copy.status.unavailable;
    return deepFreeze(model);
  }

  const result = outcome.result;
  if (result.kind === "ABSTENTION") {
    model.statusLabel = copy.status.abstained;
    const known = copy.abstention[result.reason];
    model.abstention = {
      reason: result.reason,
      reasonName: known ? known.name : result.reason,
      explanation: known ? known.text : "",
      prohibition: result.prohibition,
      prohibitionText: result.prohibition ? copy.prohibition[result.prohibition] || null : null,
      registryMessage: result.message,
      shape: result.shape,
      guidance: outcome.questionId !== "SOURCE_PROVENANCE" && outcome.subject && outcome.subject.origin === "NONE" ? copy.selectAmbito : null,
    };
    model.headline = model.abstention.reasonName;
    model.scope = result.scope ? scopeBlock(result.scope, copy, language) : null;
    model.limits = refused ? [] : (copy.limits[outcome.questionId] || []);
    model.verification = { drawerScope: null, ambitoCode: null, canAskSource: false };
    if (analyst) model.trace = traceRows(outcome, copy);
    return deepFreeze(model);
  }

  model.statusLabel = copy.status.answered;
  const builder = BUILDERS[outcome.questionId];
  const built = builder(result, outcome, { copy, language, analyst, context });
  model.headline = built.headline;
  model.facts = built.facts;
  model.hint = built.hint || null;
  model.scope = scopeBlock(result.scope, copy, language, built.scopeInstance);
  model.evidence = evidenceBlock(result, copy, language, registry);
  model.limits = copy.limits[outcome.questionId] || [];
  model.verification = {
    drawerScope: result.scope,
    ambitoCode: outcome.subject && outcome.subject.code ? outcome.subject.code : null,
    canAskSource: outcome.questionId !== "SOURCE_PROVENANCE",
    sourceId: result.sourceId,
  };
  if (analyst) model.trace = traceRows(outcome, copy);
  return deepFreeze(model);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function subjectLines(outcome, copy, context) {
  const lines = [];
  const lens = isObject(context.lens) ? context.lens : {};
  if (outcome.subject) {
    lines.push(interpolate(copy.subjectOrigin[outcome.subject.origin], { code: outcome.subject.code ?? "", which: lens.which ?? "" }));
    if (outcome.subject.ignoredSelection) {
      lines.push(interpolate(copy.subjectOrigin.ignored, { type: outcome.subject.ignoredSelection.type ?? "" }));
    }
  }
  return lines;
}

function scopeBlock(scope, copy, language, instance = null) {
  const label = SCOPE_LABELS[scope] ? SCOPE_LABELS[scope][language === "es" ? "es" : "en"] : scope;
  return { id: scope, label, instance };
}

// The five freshness fields are ALWAYS present, each either the registry's value
// or an explicit "not declared"; nothing is blank and nothing is invented.
function evidenceBlock(result, copy, language, registry) {
  const source = registry && typeof registry.sourceProvenance === "function" ? registry.sourceProvenance(result.sourceId) : null;
  const fresh = result.freshness;
  const rows = ["reference_date", "published_at", "retrieved_at", "update_frequency", "source_state"].map((field) => {
    const raw = fresh[field];
    const isDate = field === "reference_date" || field === "published_at" || field === "retrieved_at";
    const shown = raw == null ? null : isDate ? formatDate(raw, language) || String(raw) : String(raw);
    return { field, label: copy.freshness[field], value: shown, raw: raw ?? null, declared: shown !== null && raw !== "NOT_DECLARED_BY_PUBLISHER" && raw !== "NONE_DECLARED" };
  });
  const referenceRow = rows[0];
  return {
    sourceId: result.sourceId,
    sourceName: source ? source.displayName : result.sourceId,
    authority: source ? source.authority : null,
    datasetUrl: source ? source.datasetUrl : null,
    derivation: result.derivation,
    derivationText: copy.derivation[result.derivation] || result.derivation,
    referenceDate: referenceRow.value || copy.notDeclared,
    referenceDeclared: referenceRow.value !== null,
    freshness: rows,
    ceiling: result.ceiling,
    unit: result.unit,
  };
}

function traceRows(outcome, copy) {
  const rows = [
    { label: "shape", value: outcome.shape },
    { label: "params", value: JSON.stringify(outcome.params) },
  ];
  for (const entry of outcome.trace) {
    const verdict = entry.result.kind === "EVIDENCE" ? "EVIDENCE" : `ABSTENTION ${entry.result.reason}`;
    rows.push({ label: copy.detail.trace, value: `${entry.shape} → ${verdict}` });
  }
  return rows;
}

// ------------------------------------------------------- per-question builders

const BUILDERS = {
  AMBITO_AT_POINT(result, outcome, { copy, language, context }) {
    const value = result.value;
    const which = (context.lens && context.lens.which) || "";
    return {
      headline: interpolate(copy.answers.ambitoAtPoint, { which, code: value.ambitoCode, name: value.denomination }),
      scopeInstance: interpolate(copy.contextLens, lensTokens(context, language)),
      facts: [
        { id: "ambito.code", label: copy.facts.code, value: value.ambitoCode, verbatim: true },
        { id: "ambito.denomination", label: copy.facts.denomination, value: value.denomination, verbatim: true },
      ],
    };
  },

  AMBITO_PHASES(result, outcome, { copy, language, analyst }) {
    const value = result.value;
    const facts = [
      { id: "ambito.code", label: copy.facts.code, value: value.ambitoCode, verbatim: true },
    ];
    if (value.denomination) facts.push({ id: "ambito.denomination", label: copy.facts.denomination, value: value.denomination, verbatim: true });
    if (value.district && value.district.name) facts.push({ id: "ambito.district", label: copy.facts.district, value: value.district.name, verbatim: true });
    if (value.characteristicUse) facts.push({ id: "ambito.use", label: copy.facts.use, value: value.characteristicUse, verbatim: true });
    if (value.surface) {
      const shown = value.surface.state === "PUBLISHED" && Number.isFinite(value.surface.value)
        ? `${formatNumber(value.surface.value, language, 0)} ${value.surface.unit}`
        : copy.notPublished;
      facts.push({ id: "ambito.surface", label: copy.facts.surface, value: shown, verbatim: false });
    }
    for (const phase of value.phases) {
      const published = phase.state === "PUBLISHED";
      const fact = {
        id: `phase.${phase.key}`,
        label: copy.facts.phase[phase.key] || phase.key,
        value: published ? phase.sourceValue : copy.notPublished,
        verbatim: published,
      };
      if (analyst) {
        fact.detail = [phase.sourceColumn, phase.kind, phase.vocabulary].filter(Boolean).join(" · ");
      }
      facts.push(fact);
    }
    const date = formatDate(result.freshness.reference_date, language) || copy.notDeclared;
    return {
      headline: interpolate(copy.answers.phases, { date, code: value.ambitoCode }),
      scopeInstance: value.ambitoCode,
      facts,
    };
  },

  AMBITO_EDITION_DIFF(result, outcome, { copy, language, analyst }) {
    const value = result.value;
    const previous = formatDate(value.dates.previous, language) || copy.notDeclared;
    const current = formatDate(value.dates.current, language) || copy.notDeclared;
    const facts = [
      { id: "ambito.code", label: copy.facts.code, value: value.exactCode, verbatim: true },
      { id: "edition.previous", label: copy.facts.previousEdition, value: previous, verbatim: false },
      { id: "edition.current", label: copy.facts.currentEdition, value: current, verbatim: false },
    ];
    for (const family of ["S1", "S2"]) {
      const entry = value.state[family];
      if (!entry) continue;
      const fact = {
        id: `change.${family}`,
        label: family === "S1" ? copy.facts.s1 : copy.facts.s2,
        value: copy.outcome[entry.outcome] || entry.outcome,
        verbatim: false,
        outcome: entry.outcome,
        changes: [],
      };
      const differences = (entry.evidence && (entry.evidence.phaseDifferences || entry.evidence.situationDifferences)) || [];
      for (const difference of differences) {
        fact.changes.push({
          field: copy.facts.phase[difference.field] || difference.field,
          previous: difference.previous ?? "",
          current: difference.current ?? "",
          previousLabel: copy.facts.previousValue,
          currentLabel: copy.facts.currentValue,
        });
      }
      if (entry.reason) fact.note = { label: copy.facts.reasonModel, text: String(entry.reason), lang: "en" };
      facts.push(fact);
    }
    facts.push({
      id: "change.buildability", label: copy.facts.buildability,
      value: copy.buildabilityState[value.buildability.state] || value.buildability.state, verbatim: false,
    });
    return {
      headline: interpolate(copy.answers.edition, { code: value.exactCode, previous, current }),
      scopeInstance: value.exactCode,
      facts,
    };
  },

  AMBITOS_IN_LENS(result, outcome, { copy, language, context }) {
    const value = result.value;
    const which = (context.lens && context.lens.which) || "";
    const headline = value.count === 0
      ? interpolate(copy.answers.inLens.none, { which })
      : value.count === 1
        ? interpolate(copy.answers.inLens.one, { which })
        : interpolate(copy.answers.inLens.many, { which, count: value.count });
    return {
      headline,
      scopeInstance: interpolate(copy.contextLens, lensTokens(context, language)),
      facts: [
        { id: "touched.count", label: copy.facts.count, value: String(value.count), verbatim: false },
        {
          id: "touched.list", label: copy.facts.touched, value: String(value.count), verbatim: false,
          items: value.touched.map((entry) => ({
            code: entry.ambitoCode, name: entry.denomination, containsCentre: entry.containsCentre === true,
            note: entry.containsCentre === true ? copy.facts.containsCentre : null,
          })),
        },
      ],
    };
  },

  LICENCES_IN_LENS(result, outcome, { copy, language, context }) {
    const value = result.value;
    const which = (context.lens && context.lens.which) || "";
    const radius = formatRadius(context.lens && context.lens.radiusM);
    const from = formatDate(value.window && value.window.from, language) || copy.notDeclared;
    const to = formatDate(value.window && value.window.to, language) || copy.notDeclared;
    const facts = [];
    const families = Object.keys(value.perFamily);
    for (const family of families) {
      facts.push({ id: `licences.${family}`, label: copy.facts.family[family] || family, value: formatNumber(value.perFamily[family], language, 0), verbatim: false });
    }
    facts.push({ id: "licences.window", label: copy.facts.window, value: `${from} – ${to}`, verbatim: false, note: windowNote(outcome, value, copy, language) });
    const coverage = value.coverage || null;
    if (coverage && Number.isFinite(coverage.unresolved_rows)) {
      facts.push({ id: "licences.unlocated", label: copy.facts.unlocated, value: `${formatNumber(coverage.unresolved_rows, language, 0)} / ${formatNumber(coverage.total_rows, language, 0)}`, verbatim: false });
    }
    if (coverage && coverage.coverage_statement) {
      facts.push({ id: "licences.coverage", label: copy.facts.coverageStatement, value: coverage.coverage_statement, verbatim: true, lang: "en" });
    }
    const none = value.state === "NO_MATCHES";
    return {
      headline: interpolate(none ? copy.answers.licencesNone : copy.answers.licences, { which, radius, from, to }),
      scopeInstance: interpolate(copy.contextLens, lensTokens(context, language)),
      facts,
      hint: copy.facts.datesHint,
    };
  },

  SOURCE_PROVENANCE(result, outcome, { copy, language }) {
    const value = result.value;
    const facts = [
      { id: "source.name", label: copy.sourceFields.name, value: value.displayName, verbatim: true },
      { id: "source.id", label: "id", value: value.id, verbatim: true },
    ];
    if (value.authority) facts.push({ id: "source.authority", label: copy.sourceFields.authority, value: value.authority, verbatim: true });
    if (value.datasetUrl) facts.push({ id: "source.dataset", label: copy.sourceFields.dataset, value: value.datasetUrl, verbatim: true, href: value.datasetUrl });
    if (value.artifact) facts.push({ id: "source.artifact", label: copy.sourceFields.artifact, value: value.artifact, verbatim: true });
    if (value.periodSemantics) facts.push({ id: "source.period", label: copy.sourceFields.period, value: String(value.periodSemantics), verbatim: true, lang: "en" });
    return {
      headline: interpolate(copy.answers.provenance, { name: value.displayName }),
      scopeInstance: value.id,
      facts,
    };
  },
};

function windowNote(outcome, value, copy, language) {
  if (outcome.params && outcome.params.window == null) return { label: null, text: copy.facts.windowDefault, lang: language };
  if (value.window && value.window.clamped) return { label: null, text: copy.facts.windowAdjusted, lang: language };
  return null;
}

function lensTokens(context, language) {
  const lens = isObject(context.lens) ? context.lens : {};
  return {
    which: lens.which ?? "",
    radius: formatRadius(lens.radiusM),
    lat: formatCoordinate(lens.lat),
    lon: formatCoordinate(lens.lon),
  };
}

export function describeContext(context, language) {
  const copy = copyFor(language);
  const lines = [interpolate(copy.contextLens, lensTokens(context, language))];
  const selection = isObject(context.selection) ? context.selection : null;
  lines.push(selection
    ? interpolate(copy.contextSelection, { name: selection.name ?? selection.code ?? "", type: selection.typeLabel ?? selection.type ?? "" })
    : copy.contextNoSelection);
  return lines;
}
