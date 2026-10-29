// Urban Evidence Dossier V1 — pure frozen-record assembly and offline HTML.
//
// This module receives one already-resolved M2 outcome. It never queries a
// source, recomputes a value, reads the DOM, or infers a geographic relation.
// The browser adapter supplies the clock, canonical K11 URL, deployment identity
// and source-registry records. Both representations are rendered from the same
// validated dossier object.

export const DOSSIER_SCHEMA_VERSION = 1;

export const SUPPORTED_QUESTION_IDS = Object.freeze([
  "AMBITO_AT_POINT",
  "AMBITO_PHASES",
  "AMBITO_EDITION_DIFF",
  "AMBITOS_IN_LENS",
  "LICENCES_IN_LENS",
  "SOURCE_PROVENANCE",
]);

const EVIDENCE_FIELDS = Object.freeze([
  "value", "scope", "unit", "sourceId", "freshness", "ceiling", "derivation",
]);

// Same documented K11 source subset. Undefined metadata is omitted; explicit
// nulls are preserved. No date is borrowed from the export clock.
const SOURCE_FIELDS = Object.freeze([
  "id", "display_name", "authority", "scope", "dataset_url",
  "secondary_dataset_url", "retrieval_route", "artifact", "builder",
  "reference_date", "published_at", "retrieved_at", "update_frequency",
  "source_state", "source_period_semantics", "interpretation_ceiling",
  "license", "license_url", "attribution", "editions", "change_detection", "crs",
]);

const METHOD_KIND = Object.freeze({ SOURCE_FACT: "PUBLISHED_SOURCE_FACT" });

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = clone(item);
    return out;
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`buildEvidenceDossier: ${field} must be non-empty text`);
  return value;
}

function validateEvidence(result) {
  if (!isObject(result) || result.kind !== "EVIDENCE") throw new TypeError("buildEvidenceDossier: answered outcome must contain K13 EVIDENCE");
  for (const field of EVIDENCE_FIELDS) {
    if (!Object.hasOwn(result, field) || result[field] === undefined) throw new TypeError(`buildEvidenceDossier: evidence is missing ${field}`);
  }
  if (!isObject(result.freshness)) throw new TypeError("buildEvidenceDossier: evidence freshness must be an object");
  return Object.fromEntries(EVIDENCE_FIELDS.map((field) => [field, clone(result[field])]));
}

function sourceIdsFor(outcome) {
  const ids = [];
  const add = (id) => { if (typeof id === "string" && id && !ids.includes(id)) ids.push(id); };
  if (outcome.result && outcome.result.kind === "EVIDENCE") add(outcome.result.sourceId);
  for (const trace of outcome.trace || []) if (trace.result && trace.result.kind === "EVIDENCE") add(trace.result.sourceId);
  return ids;
}

function sourceSubset(source) {
  const out = {};
  for (const field of SOURCE_FIELDS) if (source[field] !== undefined) out[field] = clone(source[field]);
  // A dossier carries the edition identities needed to verify this one result,
  // not every ancillary K7 policy note. Keep the pair, comparability and complete
  // edition records (including full fingerprints) while leaving the full registry
  // to K11 and the committed source_registry.json.
  if (isObject(out.change_detection)) {
    const change = out.change_detection;
    out.change_detection = Object.fromEntries([
      "pair_id", "comparison_basis", "comparability_verdict",
      "oldest_contributor_reference_date", "editions",
    ].filter((field) => change[field] !== undefined).map((field) => [field, change[field]]));
  }
  return out;
}

function contextRecord(outcome, context, language) {
  const lens = outcome.lens || context.lens || {};
  const selection = isObject(context.selection) ? context.selection : null;
  const value = outcome.result && outcome.result.kind === "EVIDENCE" ? outcome.result.value : null;
  const valueCode = isObject(value) && typeof value.ambitoCode === "string" ? value.ambitoCode : null;
  const subject = isObject(outcome.subject) ? outcome.subject : null;
  return {
    lens: {
      id: lens.which ?? null,
      centre: { longitude: lens.lon ?? null, latitude: lens.lat ?? null },
      radius_m: lens.radiusM ?? null,
      kind: "GENERATED_ANALYTICAL_WINDOW",
    },
    selected_entity: selection ? {
      type: selection.type ?? null,
      code: selection.code ?? null,
      name: selection.name ?? null,
    } : null,
    planning_ambito: subject && subject.code ? {
      code: subject.code,
      subject_origin: subject.origin ?? null,
    } : valueCode ? { code: valueCode, subject_origin: "RESOLVER_RESULT" } : null,
    licence_date_window: outcome.questionId === "LICENCES_IN_LENS"
      ? clone(outcome.params && outcome.params.window !== undefined ? outcome.params.window : null)
      : null,
    scope_distinction: language === "es"
      ? "El círculo de una Lente, un barrio oficial, un distrito, un ámbito de planeamiento, el municipio y un registro administrativo localizado son objetos analíticos distintos y no son intercambiables."
      : "A Lens circle, official barrio, district, planning ámbito, municipality and located administrative record are distinct analytical objects and are not interchangeable.",
  };
}

function methodRecord(result, presentation) {
  if (!result || result.kind !== "EVIDENCE") return null;
  return {
    classification: result.derivation === "SOURCE_FACT" ? METHOD_KIND.SOURCE_FACT : "NAMED_DETERMINISTIC_TRANSFORMATION",
    derivation: result.derivation,
    description: presentation.evidence && presentation.evidence.derivationText
      ? presentation.evidence.derivationText
      : result.derivation,
    performed_at_export: false,
  };
}

export function buildEvidenceDossier(input) {
  if (!isObject(input)) throw new TypeError("buildEvidenceDossier: input must be an object");
  const { outcome, presentation, context, sourceRecords = [], identification = {} } = input;
  if (!isObject(outcome) || !SUPPORTED_QUESTION_IDS.includes(outcome.questionId)) {
    throw new TypeError("buildEvidenceDossier: outcome is not one of the six M2 question shapes");
  }
  if (outcome.shape !== outcome.questionId) throw new TypeError("buildEvidenceDossier: question id and registered shape differ");
  if (!isObject(context) || requireText(input.currentContextKey, "currentContextKey") !== outcome.contextKey) {
    throw new Error("DOSSIER_CONTEXT_STALE");
  }
  if (!isObject(presentation) || presentation.questionId !== outcome.questionId) {
    throw new TypeError("buildEvidenceDossier: presentation does not describe the frozen outcome");
  }
  if (!['answered', 'abstained'].includes(outcome.status)) {
    throw new Error("DOSSIER_OUTCOME_INCOMPLETE");
  }

  const answered = outcome.status === "answered";
  const evidence = answered ? validateEvidence(outcome.result) : null;
  if (!answered && (!isObject(outcome.result) || outcome.result.kind !== "ABSTENTION")) {
    throw new TypeError("buildEvidenceDossier: abstained outcome must preserve the K13 abstention");
  }

  if (identification.language !== undefined && !["es", "en"].includes(identification.language)) {
    throw new TypeError("buildEvidenceDossier: language must be es or en");
  }
  if (identification.reading !== undefined && !["citizen", "analyst"].includes(identification.reading)) {
    throw new TypeError("buildEvidenceDossier: reading must be citizen or analyst");
  }
  const sourceIds = sourceIdsFor(outcome);
  if (!Array.isArray(sourceRecords) || sourceRecords.some((source) => !isObject(source) || typeof source.id !== "string")) {
    throw new TypeError("buildEvidenceDossier: sourceRecords must contain registry records with ids");
  }
  const records = new Map(sourceRecords.map((source) => [source.id, source]));
  if (answered) for (const id of sourceIds) if (!records.has(id)) throw new Error(`DOSSIER_UNKNOWN_SOURCE:${id}`);
  const sources = sourceIds.filter((id) => records.has(id)).map((id) => sourceSubset(records.get(id)));
  const language = identification.language === "es" ? "es" : "en";
  const generatedAt = requireText(input.generatedAt, "generatedAt");
  const stateUrl = requireText(input.stateUrl, "stateUrl");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt) || new Date(generatedAt).toISOString() !== generatedAt) {
    throw new TypeError("buildEvidenceDossier: generatedAt must be an exact UTC ISO timestamp");
  }
  let parsedStateUrl;
  try { parsedStateUrl = new URL(stateUrl); } catch { throw new TypeError("buildEvidenceDossier: stateUrl must be an absolute URL"); }
  if (!["http:", "https:"].includes(parsedStateUrl.protocol) || parsedStateUrl.searchParams.get("v") !== "1") {
    throw new TypeError("buildEvidenceDossier: stateUrl must be a canonical K11 v1 URL");
  }
  const limitations = [];
  if (evidence) limitations.push({ kind: "SOURCE_CEILING", text: evidence.ceiling, verbatim: true, language: "en" });
  for (const text of presentation.limits || []) limitations.push({ kind: "METHODOLOGICAL_LIMIT", text, verbatim: false, language });

  const dossier = {
    dossier_schema_version: DOSSIER_SCHEMA_VERSION,
    generated_at: generatedAt,
    identification: {
      product: "Madrid Urban Evidence Lens",
      document_type: language === "es" ? "Dosier de evidencia urbana" : "Urban Evidence Dossier",
      document_characterization: language === "es"
        ? "Registro de evidencia montado automáticamente; no es un certificado oficial ni una investigación revisada por pares."
        : "Automatically assembled evidence record; not an official certificate or independently peer-reviewed research.",
      reading_language: language,
      reading_preference: identification.reading === "analyst" ? "analyst" : "citizen",
      question_explorer_model_version: identification.questionExplorerModelVersion ?? null,
      registry_contract_version: identification.registryContractVersion ?? null,
      deployment_build: {
        id: identification.deploymentBuildId ?? null,
        characterization: language === "es"
          ? "Identidad de compilación de despliegue usada para invalidar caché; no es una huella criptográfica de los datos ni prueba evidencia idéntica byte a byte."
          : "Deployment build identity used for cache-busting; not a cryptographic data fingerprint and not proof of byte-identical evidence.",
      },
    },
    question: {
      id: outcome.questionId,
      wording: presentation.question,
      registered_shape: outcome.shape,
      parameters: clone(outcome.params),
      subject: clone(outcome.subject),
      context_key: outcome.contextKey,
    },
    context: contextRecord(outcome, context, language),
    outcome: answered ? {
      status: "ANSWERED",
      evidence,
      abstention: null,
    } : {
      status: "ABSTAINED",
      evidence: null,
      abstention: clone(outcome.result),
    },
    sources,
    method: methodRecord(outcome.result, presentation),
    limitations,
    reproducibility: {
      canonical_k11_state_url: stateUrl,
      registered_question_shape: outcome.shape,
      question_parameters: clone(outcome.params),
      source_ids: sourceIds,
      dossier_schema_version: DOSSIER_SCHEMA_VERSION,
      restores: language === "es" ? "La URL K11 restaura el estado validado del espacio de trabajo incluido en el esquema URL v1." : "The K11 URL restores validated workspace state carried by URL schema v1.",
      does_not_restore: language === "es" ? "La URL K11 no restaura la pregunta M2 seleccionada ni esta respuesta guardada. El dosier conserva ese registro exportado." : "The K11 URL does not restore the selected M2 question or this saved answer. The dossier preserves that exported record.",
      future_evidence_warning: language === "es" ? "Volver a abrir Lens más adelante puede producir evidencia distinta si cambian los artefactos publicados. Una identidad de compilación coincidente no demuestra por sí sola evidencia idéntica byte a byte." : "Reopening Lens later may produce different evidence if published artifacts change. A matching deployment build id alone does not prove byte-identical evidence.",
      geometry_guidance: language === "es" ? "Use la exportación de evidencia K11 independiente, de cinco archivos, cuando necesite toda la geometría del espacio de trabajo o evidencia entre modos." : "Use the separate K11 five-file evidence export when complete workspace geometry or cross-mode evidence is required.",
    },
  };
  return deepFreeze(dossier);
}

export function serializeEvidenceDossier(dossier) {
  validateDossier(dossier);
  return `${JSON.stringify(dossier, null, 2)}\n`;
}

function validateDossier(dossier) {
  if (!isObject(dossier) || dossier.dossier_schema_version !== DOSSIER_SCHEMA_VERSION) {
    throw new TypeError("Evidence dossier schema version is unsupported");
  }
  if (!isObject(dossier.question) || !SUPPORTED_QUESTION_IDS.includes(dossier.question.id)) {
    throw new TypeError("Evidence dossier question is unsupported");
  }
  if (!isObject(dossier.outcome) || !["ANSWERED", "ABSTAINED"].includes(dossier.outcome.status)) {
    throw new TypeError("Evidence dossier outcome is invalid");
  }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function json(value) {
  return esc(JSON.stringify(value, null, 2));
}

const COPY = Object.freeze({
  en: Object.freeze({
    title: "Urban Evidence Dossier", identification: "Identification", question: "Research question",
    context: "Geographic object and analytical window", result: "Evidence result", sources: "Source and temporal provenance",
    method: "Method and derivation", limits: "Interpretation limits", reproduce: "Reproduction and verification",
    attribution: "Attribution", field: "Field", value: "Recorded value", noSources: "No contributing source could be recorded for this abstention.",
    abstained: "The registry abstained. No factual value is asserted.", print: "Print or save as PDF using the browser print command.",
  }),
  es: Object.freeze({
    title: "Dosier de evidencia urbana", identification: "Identificación", question: "Pregunta de investigación",
    context: "Objeto geográfico y ventana analítica", result: "Resultado de evidencia", sources: "Fuente y procedencia temporal",
    method: "Método y derivación", limits: "Límites de interpretación", reproduce: "Reproducción y verificación",
    attribution: "Atribución", field: "Campo", value: "Valor registrado", noSources: "No se pudo registrar una fuente contribuyente para esta abstención.",
    abstained: "El registro se abstuvo. No se afirma ningún valor factual.", print: "Imprima o guarde como PDF mediante la función de impresión del navegador.",
  }),
});

function rows(object, labels = {}) {
  return Object.entries(object).map(([key, value]) => `<tr><th scope="row">${esc(labels[key] || key)}</th><td>${isObject(value) || Array.isArray(value) ? `<pre>${json(value)}</pre>` : esc(value === null ? "null" : value)}</td></tr>`).join("");
}

function table(object, c) {
  return `<div class="table-wrap"><table><thead><tr><th>${esc(c.field)}</th><th>${esc(c.value)}</th></tr></thead><tbody>${rows(object)}</tbody></table></div>`;
}

export function renderEvidenceDossierHtml(dossier) {
  validateDossier(dossier);
  const lang = dossier.identification.reading_language === "es" ? "es" : "en";
  const c = COPY[lang];
  const answered = dossier.outcome.status === "ANSWERED";
  const sourceHtml = dossier.sources.length ? dossier.sources.map((source) => {
    const title = source.display_name || source.id;
    return `<article class="source"><h3>${esc(title)}</h3>${table(source, c)}</article>`;
  }).join("") : `<p>${esc(c.noSources)}</p>`;
  const limitations = dossier.limitations.map((limit) => `<li${limit.verbatim ? ' class="verbatim" lang="en"' : ""}>${esc(limit.text)}</li>`).join("");
  const attributions = dossier.sources.filter((source) => source.attribution || source.license).map((source) =>
    `<li>${esc(source.attribution || source.authority || source.display_name || source.id)}${source.license ? ` — ${esc(source.license)}` : ""}</li>`).join("");
  const result = answered
    ? table(dossier.outcome.evidence, c)
    : `<p class="abstention"><strong>${esc(c.abstained)}</strong></p>${table(dossier.outcome.abstention, c)}`;
  const method = dossier.method ? table(dossier.method, c) : `<p>${esc(c.abstained)}</p>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.title)} — ${esc(dossier.question.id)}</title>
<style>
:root{color-scheme:light;--ink:#17212b;--muted:#56616d;--line:#c8d0d7;--paper:#fff;--accent:#174f78}*{box-sizing:border-box}html{font:11pt/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:#edf1f4}body{margin:0}main{max-width:960px;margin:32px auto;padding:48px 56px;background:var(--paper);box-shadow:0 2px 18px #24344220}header{border-bottom:3px solid var(--accent);padding-bottom:20px;margin-bottom:32px}h1{font:700 25pt/1.1 Georgia,serif;margin:0 0 8px}h2{font:700 15pt/1.2 Georgia,serif;color:var(--accent);margin:30px 0 12px;break-after:avoid}h3{font-size:11pt;margin:18px 0 8px;break-after:avoid}.eyebrow{letter-spacing:.11em;text-transform:uppercase;color:var(--accent);font-weight:700;font-size:9pt}.lede,.note{color:var(--muted)}.question{font:600 15pt/1.4 Georgia,serif}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin:8px 0 18px}th,td{vertical-align:top;text-align:left;border:1px solid var(--line);padding:8px 10px;overflow-wrap:anywhere}thead th{background:#eef3f7}tbody th{width:27%;font-weight:650;background:#f8fafb}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:9pt/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}.abstention{padding:12px;border:2px dashed var(--accent);background:#f8fafb}.verbatim{white-space:pre-wrap}.url{overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}footer{margin-top:36px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:9pt}@media(max-width:680px){main{margin:0;padding:28px 20px;box-shadow:none}h1{font-size:21pt}tbody th{width:38%}}@page{size:A4;margin:16mm 14mm}@media print{html{background:#fff}main{max-width:none;margin:0;padding:0;box-shadow:none}a{color:inherit;text-decoration:none}h2,h3,thead{break-after:avoid}li{break-inside:avoid}.table-wrap{overflow:visible}tr,.source,pre{break-inside:auto}footer{break-before:auto}}
</style>
</head>
<body><main>
<header><p class="eyebrow">Madrid Urban Evidence Lens · ${esc(c.title)}</p><h1>${esc(c.title)}</h1><p class="lede">${esc(dossier.identification.document_characterization)}</p><p class="note">${esc(c.print)}</p></header>
<section><h2>${esc(c.identification)}</h2>${table({ dossier_schema_version: dossier.dossier_schema_version, generated_at: dossier.generated_at, ...dossier.identification }, c)}</section>
<section><h2>${esc(c.question)}</h2><p class="question">${esc(dossier.question.wording)}</p>${table({ id: dossier.question.id, registered_shape: dossier.question.registered_shape, parameters: dossier.question.parameters, subject: dossier.question.subject }, c)}</section>
<section><h2>${esc(c.context)}</h2>${table(dossier.context, c)}</section>
<section><h2>${esc(c.result)}</h2>${result}</section>
<section><h2>${esc(c.sources)}</h2>${sourceHtml}</section>
<section><h2>${esc(c.method)}</h2>${method}</section>
<section><h2>${esc(c.limits)}</h2><ul>${limitations}</ul></section>
<section><h2>${esc(c.reproduce)}</h2>${table(dossier.reproducibility, c)}<p class="url"><a href="${esc(dossier.reproducibility.canonical_k11_state_url)}">${esc(dossier.reproducibility.canonical_k11_state_url)}</a></p></section>
<section><h2>${esc(c.attribution)}</h2>${attributions ? `<ul>${attributions}</ul>` : `<p>—</p>`}</section>
<footer>Madrid Urban Evidence Lens · dossier schema ${DOSSIER_SCHEMA_VERSION} · ${esc(dossier.generated_at)}</footer>
</main></body></html>\n`;
}

export function buildDossierFiles(dossier) {
  validateDossier(dossier);
  const stamp = dossier.generated_at.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const base = `madrid-evidence-dossier-${dossier.question.id.toLowerCase().replaceAll("_", "-")}-${stamp}`;
  return Object.freeze([
    Object.freeze({ name: `${base}.html`, mime: "text/html;charset=utf-8", text: renderEvidenceDossierHtml(dossier) }),
    Object.freeze({ name: `${base}.json`, mime: "application/json;charset=utf-8", text: serializeEvidenceDossier(dossier) }),
  ]);
}
