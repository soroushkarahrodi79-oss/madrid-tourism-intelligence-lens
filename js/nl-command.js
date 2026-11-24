// Natural-language spatial command parser — pure, deterministic (Lens command initiative, Gate 2).
//
// WHAT THIS IS. A small, closed-grammar translator from ONE short typed instruction
// (Spanish or English) to a `version: 1` command of js/spatial-command.js, or to an
// explicit refusal / clarification request. It exists so a person can type
// "Compara dos círculos de 500 metros en Barajas y Hortaleza", SEE the structured
// interpretation, and only then execute it through the existing Spatial Command Core.
//
// WHAT THIS IS NOT. No language model, no statistical model, no embedding, no
// network, no speech, no assistant and no free-form language understanding. It
// recognises a fixed set of sentence shapes with anchored regular expressions and
// refuses everything else (UNSUPPORTED_INSTRUCTION). It answers no analytical
// question and generates no sentence about evidence. docs/NATURAL_LANGUAGE_COMMAND_V1.md
// states the contract and docs/CLAIMS_AND_LIMITATIONS.md the product boundary.
//
// THIS MODULE IS PURE: no DOM, no Leaflet, no fetch, no clock, no `window`, no GIS
// operation. It never calls the Lens engine and never touches application state.
// Geography comes ONLY through the `search(query, limit)` function the application
// supplies (the unified geographic search, js/geo-search.js `searchGeoEntities`
// over the official indices). It adds no alias table: a name resolves only when it
// EXACTLY equals (case- and accent-folded) an official denomination in that index.
//
// FAIL-SAFE, NEVER FAIL-SILENT. Nothing is guessed:
//   * an unknown place is refused, never replaced by a "nearest" one;
//   * a name that more than one official entity carries is returned as a CHOICE,
//     never resolved to the first result;
//   * a radius is converted exactly (km -> m by decimal arithmetic) and then judged
//     by the contract's own validator — never rounded or clamped here;
//   * "Compara A y B" is incomplete and is returned as a clarification, never
//     silently read as a district comparison or as a circle comparison;
//   * leftover words after a recognised shape make the instruction UNSUPPORTED
//     instead of being ignored.

const NL_COMMAND_LIMITS = Object.freeze({ maxInputLength: 200, maxCandidates: 8, maxSuggestions: 5 });

const NL_COMMAND_STATUS = Object.freeze({
  READY: "ready", // a validated version-1 command exists; the person must still confirm it
  NEEDS_CHOICE: "needs_choice", // one or more places are shared by several official entities
  NEEDS_CLARIFICATION: "needs_clarification", // semantically incomplete; a supported reading is offered
  REJECTED: "rejected", // nothing was understood well enough to propose a command
});

// Stable reasons a caller (and the UI's localized messages) may branch on.
const NL_COMMAND_REASON = Object.freeze({
  EMPTY_INPUT: "EMPTY_INPUT",
  INPUT_TOO_LONG: "INPUT_TOO_LONG",
  UNSUPPORTED_INSTRUCTION: "UNSUPPORTED_INSTRUCTION",
  UNSUPPORTED_GEOMETRY: "UNSUPPORTED_GEOMETRY",
  UNKNOWN_ENTITY: "UNKNOWN_ENTITY",
  AMBIGUOUS_ENTITY: "AMBIGUOUS_ENTITY",
  GEOGRAPHY_NOT_READY: "GEOGRAPHY_NOT_READY",
  MISSING_PLACE: "MISSING_PLACE",
  MISSING_RADIUS: "MISSING_RADIUS",
  MISSING_UNIT: "MISSING_UNIT",
  MISSING_LENS: "MISSING_LENS",
  AMBIGUOUS_NUMBER: "AMBIGUOUS_NUMBER",
  INVALID_RADIUS: "INVALID_RADIUS",
  CONTRADICTORY_PARAMETERS: "CONTRADICTORY_PARAMETERS",
  COMPARE_KIND_UNSPECIFIED: "COMPARE_KIND_UNSPECIFIED",
  INVALID_COMMAND: "INVALID_COMMAND",
});

// ------------------------------------------------------------------ text helpers

// Same folding as js/geo-search.js foldText (NFD, strip combining marks, lower
// case, collapse whitespace). Restated, not imported: that module is an ES module
// and this one is a classic script; the equivalence is asserted by a unit test.
function nlFold(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Folded text with sentence punctuation and quotes removed. Decimal separators
// (a "." or "," followed by a digit) and hyphens are kept.
function nlNormalize(raw) {
  let t = nlFold(raw);
  t = t.replace(/[‐-―−]/g, "-");
  t = t.replace(/[¿¡"“”„«»'’‘`´]/g, " ");
  t = t.replace(/[?!;()]+/g, " ");
  t = t.replace(/[.,:]+(?=\s|$)/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// Courtesy words that carry no instruction. Removed one at a time from either end.
const NL_COURTESY_PREFIX = /^(?:por favor|porfa|please|hey|oye|hola|puedes|podrias|podria|can you|could you|would you|quiero|quisiera|i want to|i would like to|i d like to)\s+/;
const NL_COURTESY_SUFFIX = /\s+(?:por favor|porfa|please|thanks|thank you|gracias)$/;

function nlStripCourtesy(t) {
  let out = t;
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(NL_COURTESY_PREFIX, "").replace(NL_COURTESY_SUFFIX, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

// ------------------------------------------------------------------ radius

const NL_RADIUS_SOURCE = "(\\d+(?:[.,]\\d+)?)\\s*-?\\s*(kilometros?|kilometres?|kilometers?|kms?|metros?|metres?|meters?|mts?|m)(?![a-z])";

// "1,5" / "1.5" -> exact metres. A separator followed by EXACTLY three digits is
// refused (AMBIGUOUS_NUMBER): "1.500 m" is 1500 in Spanish and 1.5 in English, and
// guessing either would silently change the radius.
function nlParseRadius(numberText, unitText) {
  const m = /^(\d+)(?:([.,])(\d+))?$/.exec(numberText);
  if (!m) return { error: NL_COMMAND_REASON.INVALID_RADIUS };
  const whole = m[1];
  const fraction = m[3];
  if (fraction !== undefined && fraction.length === 3) return { error: NL_COMMAND_REASON.AMBIGUOUS_NUMBER };
  if (unitText.charAt(0) === "k") {
    const f = fraction || "";
    const metres = f.length > 3 ? Number(whole + f.slice(0, 3) + "." + f.slice(3)) : Number(whole + f.padEnd(3, "0"));
    return { metres };
  }
  return { metres: fraction === undefined ? Number(whole) : Number(whole + "." + fraction) };
}

// -> { found: [{ index, end, metres }], error? } over the whole text.
function nlFindRadii(t) {
  const re = new RegExp(NL_RADIUS_SOURCE, "g");
  const found = [];
  let match;
  while ((match = re.exec(t)) !== null) {
    const parsed = nlParseRadius(match[1], match[2]);
    if (parsed.error) return { found, error: parsed.error };
    found.push({ index: match.index, end: match.index + match[0].length, metres: parsed.metres });
  }
  return { found };
}

// ------------------------------------------------------------------ place resolution

const NL_TYPE_HINTS = Object.freeze({
  distrito: "DISTRICT", district: "DISTRICT",
  barrio: "BARRIO",
  ambito: "AMBITO", "ambito de planeamiento": "AMBITO", "planning ambito": "AMBITO", "planning area": "AMBITO",
  municipio: "MUNICIPALITY",
});
const NL_HINT_WORDS = "ambito de planeamiento|planning ambito|planning area|distrito|district|barrio|ambito|municipio";
const NL_HINT_LEADING = new RegExp("^(?:(?:el|la|los|las|the)\\s+)?(" + NL_HINT_WORDS + ")\\s+(?:(de la|de los|de las|del|de|of the|of)\\s+)?(.+)$");
const NL_HINT_TRAILING = new RegExp("^(.+?)\\s+(distrito|district|barrio)$");
const NL_ARTICLE = /^(?:el|la|los|las|the)\s+(.+)$/;

// The folded phrase variants tried, in order, for one place phrase. The phrase AS
// TYPED always goes first, so an official denomination that begins with an article
// ("Las Tablas", "El Pardo") is matched before any article is dropped.
function nlPlaceVariants(phrase, contracted) {
  let typeHint = null;
  let core = phrase;
  let article = null;
  const leading = NL_HINT_LEADING.exec(phrase);
  if (leading) {
    typeHint = NL_TYPE_HINTS[leading[1]] || null;
    core = leading[3];
    const connector = leading[2] || "";
    if (connector === "del") article = "el";
    else if (connector === "de la") article = "la";
    else if (connector === "de los") article = "los";
    else if (connector === "de las") article = "las";
    else if (connector === "of the") article = "the";
  } else {
    const trailing = NL_HINT_TRAILING.exec(phrase);
    if (trailing) { typeHint = NL_TYPE_HINTS[trailing[2]] || null; core = trailing[1]; }
  }
  const variants = [];
  const push = (v) => { if (v && !variants.includes(v)) variants.push(v); };
  push(core);
  if (article) push(article + " " + core);
  if (contracted) push("el " + core);
  const stripped = NL_ARTICLE.exec(core);
  if (stripped) push(stripped[1]);
  return { typeHint, variants };
}

function nlCandidate(result) {
  return Object.freeze({ id: result.id, type: result.type, code: result.code, name: result.name, parentName: result.parentName || null });
}

// Resolve ONE place phrase through the supplied official search.
// -> { state: "resolved"|"ambiguous"|"unknown"|"unready", candidates, id?, suggestions? }
// Only an exact official denomination (or an exact official ámbito code) is
// accepted; partial matches are returned only as unknown-entity SUGGESTIONS the
// person may read, never as a resolution.
function nlResolvePlace(phrase, contracted, search) {
  const { typeHint, variants } = nlPlaceVariants(phrase, contracted);
  if (typeof search !== "function") return { state: "unready", candidates: [] };
  const limit = 50;
  // Which official universes can decide this phrase. An UNTYPED name may be carried by
  // an entity of any type (Carabanchel is a DISTRICT and an AMBITO), so uniqueness can be
  // asserted only when BOTH universes are loaded; a typed name needs only its own.
  const relevant = !typeHint ? ["administrative", "ambito"] : [typeHint === "AMBITO" ? "ambito" : "administrative"];
  for (const variant of variants) {
    const reading = search(variant, limit);
    // Not ready is never "unknown", and never "unique": absence of a source is not
    // absence of the entity that could make the name ambiguous.
    if (!reading || reading.state === "unavailable") return { state: "unready", candidates: [] };
    if (reading.coverage && !relevant.every((key) => reading.coverage[key])) return { state: "unready", candidates: [] };
    const exact = (reading.results || []).filter((r) => {
      if (typeHint && r.type !== typeHint) return false;
      if (r.match === "EXACT_NAME") return true;
      return r.match === "EXACT_CODE" && r.type === "AMBITO" && /[.]/.test(r.code);
    });
    if (exact.length === 1) return { state: "resolved", candidates: [nlCandidate(exact[0])], id: exact[0].id };
    if (exact.length > 1) return { state: "ambiguous", candidates: exact.slice(0, NL_COMMAND_LIMITS.maxCandidates).map(nlCandidate), id: null };
  }
  const suggestions = [];
  const probe = variants[variants.length - 1];
  if (probe && probe.length >= 3) {
    const reading = search(probe, limit);
    for (const r of (reading && reading.results) || []) {
      if (typeHint && r.type !== typeHint) continue;
      if (r.match === "NAME_PREFIX" || r.match === "NAME_CONTAINS") suggestions.push(nlCandidate(r));
      if (suggestions.length >= NL_COMMAND_LIMITS.maxSuggestions) break;
    }
  }
  return { state: "unknown", candidates: [], suggestions };
}

// ------------------------------------------------------------------ grammar

const NL_LENS = "\\b(?:lens|lente)[\\s-]+([ab])\\b";
const NL_LENS_GLOBAL = new RegExp(NL_LENS, "g");
const NL_RADIUS_WORD = /\b(?:radio|radius)\b/;

const NL_NAV_VERBS = "ve|vete|ir|ven|vamos|llevame|llevanos|muestrame|muestranos|muestra|mostrar|ensename|ensenar|navega|navegar|centra el mapa|centrate|enfoca|enfocar|abre|visualiza|ver|go to|go|show me|show|take me to|navigate to|navigate|zoom to|zoom into|zoom in on|pan to|center on|centre on|center the map on|centre the map on|focus on|view|display";
const NL_NAV = new RegExp("^(?:" + NL_NAV_VERBS + ")\\s+(?:(a|al|hacia|en|sobre)\\s+)?(.+)$");

const NL_LOC_VERBS = "coloca|colocar|pon|poner|situa|situar|mueve|mover|traslada|trasladar|lleva|llevar|ubica|ubicar|centra|centrar|establece|establecer|fija|fijar|desplaza|desplazar|cambia|cambiar|set|move|place|put|position|center|centre|locate|shift|relocate";
const NL_LOC = new RegExp("^(?:" + NL_LOC_VERBS + ")\\s+(?:(?:el|la|the)\\s+)?(?:(?:centro|centre|center)\\s+(?:de\\s+(?:(?:el|la)\\s+)?|of\\s+(?:the\\s+)?)?)?" + NL_LENS + "\\s+(?:(en|sobre|a|al|hacia|encima de|to|in|at|on|onto|over|into|around)\\s+)(.+)$");

const NL_SET_VERBS = "cambia|cambiar|pon|poner|ajusta|ajustar|establece|establecer|fija|fijar|define|definir|configura|configurar|modifica|modificar|change|set|adjust|update|make";
const NL_RADIUS_ALLOWED = new Set(["a", "al", "to", "en", "at", "de", "del", "of", "el", "la", "the", "con", "with", "un", "una", "an", "radio", "radius", "=", "es", "is", "as", "como", ...NL_SET_VERBS.split("|")]);

const NL_COMPARE_VERB = /^(?:compara|comparar|comparame|comparen|contrasta|contrastar|compare|comparing)\s+(.+)$/;
const NL_BOUNDARY_WORDS = /\b(?:distritos|barrios|ambitos|districts|neighbou?rhoods|limites|boundaries|areas administrativas|administrative|poblacion|population|hoteles|hotels)\b/;

// ------------------------------------------------------------------ drafts

function nlPlace(role, phrase, contracted, search) {
  const resolution = nlResolvePlace(phrase, contracted, search);
  return { role, phrase, contracted, state: resolution.state, candidates: resolution.candidates, id: resolution.id || null, suggestions: resolution.suggestions || [] };
}

function nlReject(reason, extra) {
  return Object.freeze({ status: NL_COMMAND_STATUS.REJECTED, reason, ...(extra || {}) });
}

function nlLocation(id) {
  return { type: "official_area", id };
}

function nlBuildCommand(draft) {
  if (draft.action === "navigate_to_location") return { version: 1, action: draft.action, location: nlLocation(draft.places[0].id) };
  if (draft.action === "set_lens_location") return { version: 1, action: draft.action, lens: draft.lens, location: nlLocation(draft.places[0].id) };
  if (draft.action === "set_lens_radius") return { version: 1, action: draft.action, lens: draft.lens, radiusM: draft.radiusM };
  const side = (index, key) => {
    const out = { location: nlLocation(draft.places[index].id) };
    if (draft.sides[key].radiusM !== undefined) out.radiusM = draft.sides[key].radiusM;
    return out;
  };
  return { version: 1, action: draft.action, a: side(0, "a"), b: side(1, "b") };
}

// Contract validator, read the same way spatial-command.js reads its own limits.
function nlValidate(command) {
  const validate = typeof validateSpatialCommand !== "undefined" ? validateSpatialCommand : require("./spatial-command.js").validateSpatialCommand;
  return validate(command);
}

const NL_CONTRACT_RADIUS_CODES = new Set(["INVALID_RADIUS", "RADIUS_OUT_OF_RANGE", "RADIUS_OFF_STEP"]);

// Turn a draft into a result. Pure; called again after every candidate choice.
function nlFinalize(draft) {
  const base = { language: draft.language, action: draft.action, draft };
  const places = draft.places;
  if (places.some((p) => p.state === "unready")) return nlReject(NL_COMMAND_REASON.GEOGRAPHY_NOT_READY, base);
  const unknown = places.find((p) => p.state === "unknown");
  if (unknown) return nlReject(NL_COMMAND_REASON.UNKNOWN_ENTITY, { ...base, role: unknown.role, phrase: unknown.phrase, suggestions: unknown.suggestions });
  const open = places.filter((p) => !p.id);
  if (open.length) {
    return Object.freeze({ ...base, status: NL_COMMAND_STATUS.NEEDS_CHOICE, reason: NL_COMMAND_REASON.AMBIGUOUS_ENTITY, slots: Object.freeze(open.map((p) => Object.freeze({ role: p.role, phrase: p.phrase, candidates: p.candidates }))) });
  }
  if (draft.action === "compare_locations") {
    const [a, b] = places;
    if (a.id === b.id && draft.sides.a.radiusM === draft.sides.b.radiusM) {
      return nlReject(NL_COMMAND_REASON.CONTRADICTORY_PARAMETERS, { ...base, detail: "SAME_PLACE_SAME_RADIUS" });
    }
  }
  const command = nlBuildCommand(draft);
  const validated = nlValidate(command);
  if (!validated.ok) {
    const code = validated.error.code;
    const reason = NL_CONTRACT_RADIUS_CODES.has(code) ? NL_COMMAND_REASON.INVALID_RADIUS : NL_COMMAND_REASON.INVALID_COMMAND;
    return nlReject(reason, { ...base, contractError: validated.error });
  }
  if (draft.needsKind) {
    return Object.freeze({ ...base, status: NL_COMMAND_STATUS.NEEDS_CLARIFICATION, reason: NL_COMMAND_REASON.COMPARE_KIND_UNSPECIFIED, proposal: validated.command });
  }
  return Object.freeze({ ...base, status: NL_COMMAND_STATUS.READY, command: validated.command });
}

// ------------------------------------------------------------------ the parser

function nlSplitPair(tail, connector) {
  // Every way of cutting `tail` at the connector, in order of position.
  const pairs = [];
  const re = new RegExp(connector, "g");
  let m;
  while ((m = re.exec(tail)) !== null) {
    const left = tail.slice(0, m.index).trim();
    const right = tail.slice(m.index + m[0].length).trim();
    if (left && right) pairs.push([left, right]);
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return pairs;
}

// Prefer the cut whose BOTH halves resolve to an official entity; otherwise the
// first cut. A name that itself contains the connector ("… y …") is therefore
// resolved without any alias, but only when the official index confirms it.
function nlResolvePair(pairs, search) {
  let first = null;
  for (const [left, right] of pairs) {
    const a = nlPlace("a", left, false, search);
    const b = nlPlace("b", right, false, search);
    if (!first) first = [a, b];
    const usable = (p) => p.state === "resolved" || p.state === "ambiguous";
    if (usable(a) && usable(b)) return [a, b];
  }
  return first;
}

function nlCompareDraft(language, phrases, sides, search, pairs, needsKind) {
  const places = pairs ? nlResolvePair(pairs, search) : [nlPlace("a", phrases[0], false, search), nlPlace("b", phrases[1], false, search)];
  const draft = { language, action: "compare_locations", lens: null, radiusM: undefined, places, sides: { a: { radiusM: sides.a }, b: { radiusM: sides.b } }, needsKind: Boolean(needsKind) };
  return nlFinalize(draft);
}

function nlParseCompare(body, search) {
  if (NL_BOUNDARY_WORDS.test(body)) return nlReject(NL_COMMAND_REASON.UNSUPPORTED_GEOMETRY);
  const radii = nlFindRadii(body);
  if (radii.error) return nlReject(radii.error);
  // Radii and circle words become placeholders, so each sentence shape is matched
  // once, whatever the radius or unit was.
  let reduced = body;
  for (let i = radii.found.length - 1; i >= 0; i -= 1) {
    const r = radii.found[i];
    reduced = reduced.slice(0, r.index) + "<R>" + reduced.slice(r.end);
  }
  reduced = reduced.replace(/\b(?:circulos|circulo|circles|circle)\b/g, "<C>").replace(/\s+/g, " ").trim();
  const hasCircle = reduced.includes("<C>");
  const language = /\b(?:in|at|and|with|circles?|around|two|against)\b/.test(body) ? "en" : "es";
  const JOIN_R = "(?:(?:de|of)\\s+|(?:con|with)(?:\\s+(?:un|a))?\\s+(?:radio|radius)(?:\\s+(?:de|of))?\\s+)?";
  const AT = "(?:en|in|at|around|centrados en|centered on|centred on|centered at)";

  // The English adjective form with one radius per circle:
  // "a 500 m circle in X with a 1 km circle in Y".
  const individualAdj = new RegExp(
    "^(?:(?:a|an|one)\\s+)?<R>\\s+<C>\\s+" + AT + "\\s+(.+?)\\s+(?:with|and|vs|versus|against)\\s+(?:(?:a|an|another|one)\\s+)?<R>\\s+<C>\\s+" + AT + "\\s+(.+)$",
  );
  let m = individualAdj.exec(reduced);
  if (m && radii.found.length === 2) {
    return nlCompareDraft(language, [m[1], m[2]], { a: radii.found[0].metres, b: radii.found[1].metres }, search);
  }

  // One circle per place, each with its own (optional) radius:
  // "un círculo de 500 metros en X con otro de 1 km en Y".
  const individual = new RegExp(
    "^(?:(?:un|a|an|one)\\s+)?<C>\\s+(?:" + JOIN_R + "(<R>)\\s+)?" + AT + "\\s+(.+?)\\s+(?:con|y|with|and|vs|versus|contra|against)\\s+(?:(?:otro|otra|another|a|an|one)\\s+)?(?:<C>\\s+)?(?:" + JOIN_R + "(<R>)\\s+)?(?:" + AT + "\\s+)(.+)$",
  );
  m = individual.exec(reduced);
  if (m && hasCircle) {
    const given = [m[1], m[3]].filter(Boolean).length;
    if (radii.found.length === given) {
      let next = 0;
      const sides = {};
      if (m[1]) sides.a = radii.found[next++].metres;
      if (m[3]) sides.b = radii.found[next++].metres;
      return nlCompareDraft(language, [m[2], m[4]], sides, search);
    }
  }

  // Circles of ONE shared radius, then both places:
  // "dos círculos de 500 metros en X y Y" / "500-meter circles in X and Y".
  const sharedHead = new RegExp(
    "^(?:(?:dos|2|two)\\s+)?(?:<R>\\s+<C>|<C>\\s+" + JOIN_R + "(?:<R>\\s+)?)(?:\\s*(?:cada uno|cada una|each)\\s+)?\\s*" + AT + "\\s+(.+)$",
  );
  m = sharedHead.exec(reduced);
  if (m && hasCircle) {
    if (radii.found.length > 1) return nlReject(NL_COMMAND_REASON.CONTRADICTORY_PARAMETERS, { language, detail: "SEVERAL_RADII" });
    const pairs = nlSplitPair(m[1], "\\s+(?:y|e|and)\\s+(?:(?:en|in|at)\\s+)?");
    if (!pairs.length) return nlReject(NL_COMMAND_REASON.MISSING_PLACE, { language });
    const sides = radii.found.length === 1 ? { a: radii.found[0].metres, b: radii.found[0].metres } : {};
    return nlCompareDraft(language, null, sides, search, pairs);
  }

  // "Compara X y Y": names two places and says nothing about WHAT is compared.
  if (!hasCircle && radii.found.length === 0) {
    const pairs = nlSplitPair(reduced.replace(/^(?:a|entre|between)\s+/, ""), "\\s+(?:y|e|con|and|with|vs|versus|contra|against)\\s+");
    if (pairs.length) return nlCompareDraft(language, null, {}, search, pairs, true);
  }
  return nlReject(NL_COMMAND_REASON.UNSUPPORTED_INSTRUCTION, { language });
}

function nlParseRadiusIntent(t) {
  const language = /\b(?:radius|change|set|adjust|update|make|of|to)\b/.test(t) ? "en" : "es";
  const lenses = [...t.matchAll(NL_LENS_GLOBAL)];
  if (new Set(lenses.map((l) => l[1])).size > 1) return nlReject(NL_COMMAND_REASON.CONTRADICTORY_PARAMETERS, { language, detail: "SEVERAL_LENSES" });
  const radii = nlFindRadii(t);
  if (radii.error) return nlReject(radii.error, { language });
  if (radii.found.length > 1) return nlReject(NL_COMMAND_REASON.CONTRADICTORY_PARAMETERS, { language, detail: "SEVERAL_RADII" });
  // Radii are cut out first (their indices refer to `t`), then the Lens tokens.
  let residual = t;
  for (let i = radii.found.length - 1; i >= 0; i -= 1) residual = residual.slice(0, radii.found[i].index) + " " + residual.slice(radii.found[i].end);
  residual = residual.replace(NL_LENS_GLOBAL, " ");
  // A bare number is tolerated here ONLY so the missing unit can be named; once a
  // radius with a unit exists, any other word or number is an unsupported extra.
  const leftover = residual.split(/\s+/).filter((w) => w && !NL_RADIUS_ALLOWED.has(w) && !(radii.found.length === 0 && /^\d+(?:[.,]\d+)?$/.test(w)));
  if (leftover.length) return nlReject(NL_COMMAND_REASON.UNSUPPORTED_INSTRUCTION, { language });
  if (lenses.length === 0) return nlReject(NL_COMMAND_REASON.MISSING_LENS, { language });
  if (radii.found.length === 0) {
    // A number left with no unit: the unit is never assumed.
    return nlReject(/\d/.test(residual) ? NL_COMMAND_REASON.MISSING_UNIT : NL_COMMAND_REASON.MISSING_RADIUS, { language });
  }
  const draft = { language, action: "set_lens_radius", lens: lenses[0][1].toUpperCase(), radiusM: radii.found[0].metres, places: [], sides: {}, needsKind: false };
  return nlFinalize(draft);
}

// parseNaturalCommand(text, { search }) -> frozen result (see NL_COMMAND_STATUS).
//   result.command   present only when status === "ready": a validated version-1
//                    command, still to be confirmed by the person.
//   result.draft     plain data from which chooseNaturalCommandCandidate() continues.
function parseNaturalCommand(text, options) {
  const search = options && options.search;
  if (typeof text !== "string") return nlReject(NL_COMMAND_REASON.EMPTY_INPUT);
  if (text.length > NL_COMMAND_LIMITS.maxInputLength) return nlReject(NL_COMMAND_REASON.INPUT_TOO_LONG);
  const t = nlStripCourtesy(nlNormalize(text));
  if (!t) return nlReject(NL_COMMAND_REASON.EMPTY_INPUT);

  const compare = NL_COMPARE_VERB.exec(t);
  if (compare) return nlParseCompare(compare[1], search);

  if (NL_RADIUS_WORD.test(t)) return nlParseRadiusIntent(t);

  const location = NL_LOC.exec(t);
  if (location) {
    const phrase = location[3];
    const english = /^(?:set|move|place|put|position|center|centre|locate|shift|relocate)\b/.test(t);
    // A radius belongs to the radius command, never inside a place phrase.
    if (nlFindRadii(phrase).found.length || /\d/.test(phrase)) return nlReject(NL_COMMAND_REASON.UNSUPPORTED_INSTRUCTION, { language: english ? "en" : "es" });
    const draft = {
      language: english ? "en" : "es",
      action: "set_lens_location", lens: location[1].toUpperCase(), radiusM: undefined,
      places: [nlPlace("location", phrase, location[2] === "al", search)], sides: {}, needsKind: false,
    };
    return nlFinalize(draft);
  }
  if (/\b(?:lens|lente)[\s-]+[ab]\b/.test(t)) return nlReject(NL_COMMAND_REASON.UNSUPPORTED_INSTRUCTION);

  const nav = NL_NAV.exec(t);
  if (nav) {
    const phrase = nav[2];
    if (nlFindRadii(phrase).found.length || /\d/.test(phrase)) return nlReject(NL_COMMAND_REASON.UNSUPPORTED_INSTRUCTION);
    const draft = {
      language: /^(?:go|show|take|navigate|zoom|pan|center|centre|focus|view|display)\b/.test(t) ? "en" : "es",
      action: "navigate_to_location", lens: null, radiusM: undefined,
      places: [nlPlace("location", phrase, nav[1] === "al", search)], sides: {}, needsKind: false,
    };
    return nlFinalize(draft);
  }
  return nlReject(NL_COMMAND_REASON.UNSUPPORTED_INSTRUCTION);
}

// The person picked one of a slot's candidates. Only an id the parser itself
// offered is accepted; anything else leaves the result unchanged.
function chooseNaturalCommandCandidate(result, role, id) {
  if (!result || result.status !== NL_COMMAND_STATUS.NEEDS_CHOICE) return result;
  const draft = result.draft;
  const slot = draft.places.find((p) => p.role === role);
  if (!slot || !slot.candidates.some((c) => c.id === id)) return result;
  const places = draft.places.map((p) => (p === slot ? { ...p, id, state: "resolved" } : p));
  return nlFinalize({ ...draft, places });
}

// Re-resolve every place of an interpretation against the index as it is NOW. True only
// if each place still means exactly what the person was shown: a unique name is still
// unique with the same id, and a name they chose between still offers the same candidates.
// A universe that loaded in between and made a name ambiguous (or removed it) fails here.
function revalidateNaturalCommandResult(result, search) {
  const draft = result && result.draft;
  if (!draft || !Array.isArray(draft.places)) return false;
  for (const place of draft.places) {
    const now = nlResolvePlace(place.phrase, place.contracted, search);
    if (now.state === "resolved") { if (now.id !== place.id) return false; continue; }
    if (now.state !== "ambiguous" || !place.id) return false;
    const same = now.candidates.length === place.candidates.length && now.candidates.every((c) => place.candidates.some((o) => o.id === c.id));
    if (!same) return false;
  }
  return true;
}

// The person explicitly adopted the supported reading offered for an incomplete
// comparison ("Compara A y B" -> two Lens CIRCLES). Nothing else can turn a
// clarification into a command.
function adoptNaturalCommandProposal(result) {
  if (!result || result.status !== NL_COMMAND_STATUS.NEEDS_CLARIFICATION || !result.proposal) return result;
  return Object.freeze({ ...result, status: NL_COMMAND_STATUS.READY, reason: null, command: result.proposal, adoptedProposal: true });
}

// ------------------------------------------------------------------ preview model

// Structured, language-neutral description of what executing a PLAN will do, for
// the interpretation preview. Everything comes from the plan the Spatial Command
// Core itself produced (resolved areas, target radii, notes), never from the typed
// text, so the preview cannot state something the engine will not do.
function describeNaturalCommandPlan(plan) {
  const lensRow = (which) => {
    const area = plan.resolved && plan.resolved[which] ? plan.resolved[which].area : null;
    return { lens: which, area: area ? { id: area.id, type: area.type, name: area.name } : null, radiusM: plan.target.lenses[which].radiusM };
  };
  const common = { action: plan.action, notes: [...plan.notes], changed: plan.changed };
  if (plan.action === "navigate_to_location") return { ...common, kind: "camera", location: plan.resolved.location };
  if (plan.action === "set_lens_location") return { ...common, kind: "lens", rows: [lensRow(plan.command.lens)], mode: plan.target.mode };
  if (plan.action === "set_lens_radius") return { ...common, kind: "lens", rows: [{ lens: plan.command.lens, area: null, radiusM: plan.command.radiusM }], mode: plan.target.mode };
  return { ...common, kind: "lens", rows: [lensRow("A"), lensRow("B")], mode: plan.target.mode };
}

// A fingerprint of everything an interpretation means once prepared. If it differs
// when the person confirms, the interpretation changed and must be confirmed again.
function naturalCommandFingerprint(prepared) {
  if (!prepared || !prepared.ok) return "error:" + (prepared && prepared.error ? prepared.error.code + ":" + (prepared.error.field || "") : "none");
  const plan = prepared.plan;
  return JSON.stringify({ command: plan.command, changed: plan.changed, notes: plan.notes, resolved: plan.resolved, target: plan.target });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    NL_COMMAND_LIMITS,
    NL_COMMAND_STATUS,
    NL_COMMAND_REASON,
    nlFold,
    parseNaturalCommand,
    chooseNaturalCommandCandidate,
    adoptNaturalCommandProposal,
    revalidateNaturalCommandResult,
    describeNaturalCommandPlan,
    naturalCommandFingerprint,
  };
}
