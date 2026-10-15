// Documented evidence export — pure assembly of the five-file bundle (K11, #73).
//
// This module is a TRANSCRIBER, never a calculator. It is given a `projection`
// the app has already assembled by reading the frozen view-models that rendered
// the screen (the halo comparison model, the ámbito comparison model, the frozen
// evidence records, the live geometry), and it serialises that projection into
// the five files of the bundle. It computes NO analytical value: every number,
// state, withheld reason and ceiling in the output was put into the projection by
// the renderer's own frozen model. That is the structural guarantee behind Gate D
// (no recomputation) — a test asserts the output carries no value the projection
// did not already carry, and the module has no access to raw evidence to invent one.
//
// It is PURE: no DOM, no Blob, no download, no clock (the caller passes `now`).
// The app wrapper (js/app.js) owns assembling the projection and delivering the
// files; this file owns the contract and the honest serialisation, so the whole
// bundle is testable with plain `node --test`.
//
// THE FIVE FILES (issue #73):
//   reading.json     — the displayed reading: every shown value with its scope,
//                      unit, source ids, the five freshness fields and the
//                      verbatim interpretation ceiling; withheld deltas stay
//                      withheld with their reason; a published zero stays zero.
//   sources.json     — ONLY the registry entries for the contributing sources,
//                      with retrieval route, edition, snapshot fingerprint where
//                      the registry declares them, licence and attribution.
//   geometry.geojson — the geometries actually in the reading (Lens circles,
//                      ámbito polygons, barrio outline), EPSG:4326, scope-tagged.
//   README.txt       — the reading in plain text, retrieval date, licences, the
//                      ceilings and the limits of reproducibility.
//   state.url        — the canonical shareable URL for the SAME reading.

const EXPORT_CONTRACT_VERSION = 1;
const GEOJSON_CRS = "EPSG:4326";
const EXPORT_FRESHNESS_FIELDS = Object.freeze([
  "reference_date",
  "published_at",
  "retrieved_at",
  "update_frequency",
  "source_state",
]);

// The subset of a registry source entry that travels in sources.json. Every
// field is copied verbatim when the registry declares it and OMITTED when it does
// not — a missing licence or fingerprint is never fabricated.
const SOURCE_EXPORT_FIELDS = Object.freeze([
  "id",
  "display_name",
  "authority",
  "scope",
  "dataset_url",
  "secondary_dataset_url",
  "retrieval_route",
  "artifact",
  "builder",
  "reference_date",
  "published_at",
  "retrieved_at",
  "update_frequency",
  "source_state",
  "source_period_semantics",
  "interpretation_ceiling",
  "license",
  "license_url",
  "attribution",
  "editions",
  "change_detection",
  "crs",
]);

function isObject(value) {
  return value !== null && typeof value === "object";
}

// Every source id the reading actually contributes, collected from the provenance
// records and the per-value source references, de-duplicated in first-seen order.
function contributingSourceIds(projection) {
  const ids = [];
  const add = (id) => { if (id && !ids.includes(id)) ids.push(id); };
  for (const surface of projection.evidence || []) {
    for (const source of surface.sources || []) add(source.id);
  }
  for (const value of projection.values || []) {
    for (const id of value.source_ids || []) add(id);
  }
  return ids;
}

// reading.json — a verbatim transcript of the projection. It introduces no value:
// `evidence` and `values` are copied straight from the frozen models the app read.
function buildReadingObject(projection) {
  return {
    export_contract_version: EXPORT_CONTRACT_VERSION,
    generated_at: projection.meta.generated_at,
    reading: {
      mode: projection.meta.mode,
      comparison_scope: projection.meta.comparison_scope ?? null,
      reading_preference: projection.meta.reading,
      language: projection.meta.language,
    },
    evidence_snapshot: {
      // The deployment build identity, NOT a data fingerprint. A matching id
      // indicates the same deployment build but does not by itself prove the
      // underlying data is byte-for-byte unchanged; the authoritative per-artifact
      // identities (editions, snapshot fingerprints) are in sources.json.
      snapshot_id: projection.meta.snapshot_id,
      registry_contract_version: projection.meta.registry_contract_version ?? null,
      note: "Interface state reproduces exactly from state.url. snapshot_id is the deployment build this reading was exported from (a cache-busting asset version), not a cryptographic fingerprint of the data. A different snapshot_id means a different deployment build, which may have republished different values; an identical one indicates the same build only. The authoritative per-artifact identities are the editions and fingerprints in sources.json.",
    },
    state_url: projection.state_url,
    // The displayed values, each with its scope, unit, state, comparison basis,
    // withholding reason, and the provenance (five freshness fields + ceiling) of
    // every source behind it. Copied from the frozen model; nothing recomputed.
    values: (projection.values || []).map((value) => ({ ...value })),
    // The provenance of every evidence surface shown in the current reading.
    evidence_surfaces: (projection.evidence || []).map((surface) => ({ ...surface })),
  };
}

// sources.json — ONLY the contributing registry entries, each reduced to the
// documented export fields. Never the whole registry.
function buildSourcesObject(projection, registry) {
  const byId = new Map((registry.sources || []).map((source) => [source.id, source]));
  const out = [];
  for (const id of contributingSourceIds(projection)) {
    const source = byId.get(id);
    if (!source) {
      // A contributing id with no registry entry is reported, not hidden.
      out.push({ id, missing_from_registry: true });
      continue;
    }
    const entry = {};
    for (const field of SOURCE_EXPORT_FIELDS) {
      if (source[field] !== undefined) entry[field] = source[field];
    }
    out.push(entry);
  }
  return {
    export_contract_version: EXPORT_CONTRACT_VERSION,
    registry_contract_version: registry.contract_version || null,
    generated_at: projection.meta.generated_at,
    note: "Only the sources contributing to the exported reading are included, not the full registry.",
    sources: out,
  };
}

// geometry.geojson — a valid EPSG:4326 FeatureCollection. Each feature keeps the
// geometry the app actually used (an official polygon is never replaced by its
// bounding box) and is tagged with its analytical scope and identity. Lens
// circles are explicitly marked as generated analytical windows.
function buildGeometryObject(projection) {
  const features = (projection.geometry || []).map((item) => {
    const feature = isObject(item.feature) ? item.feature : {};
    const baseProps = isObject(feature.properties) ? feature.properties : {};
    return {
      type: "Feature",
      geometry: feature.geometry || feature.geojson || null,
      properties: {
        ...baseProps,
        scope: item.scope,
        role: item.role,
        identity: item.identity,
        geometry_kind: item.geometry_kind || null,
      },
    };
  });
  return {
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: `urn:ogc:def:crs:${GEOJSON_CRS.replace(":", "::")}` } },
    name: "madrid-urban-evidence-reading",
    features,
  };
}

function exportFreshnessLine(freshness) {
  if (!isObject(freshness)) return "reference date —; published —; retrieved —; frequency —; state —";
  const value = (key) => (freshness[key] == null ? "—" : String(freshness[key]));
  return `reference date ${value("reference_date")}; published ${value("published_at")}; retrieved ${value("retrieved_at")}; frequency ${value("update_frequency")}; publisher state ${value("source_state")}`;
}

// README.txt — the human-readable reading, with the retrieval date, every
// contributing source's licence and attribution (CC BY 4.0 attributions travel
// with the data, as the licence requires), the verbatim ceilings, and the limits
// of reproducibility.
function buildReadmeText(projection, sourcesObject) {
  const meta = projection.meta;
  const lines = [];
  lines.push("MADRID URBAN EVIDENCE LENS — EXPORTED READING");
  lines.push("=".repeat(46));
  lines.push("");
  lines.push(`Generated: ${meta.generated_at}`);
  lines.push(`Mode: ${meta.mode}    Comparison scope: ${meta.comparison_scope ?? "—"}    Reading: ${meta.reading}    Language: ${meta.language}`);
  lines.push(`Evidence snapshot id: ${meta.snapshot_id}`);
  lines.push("");
  lines.push("This bundle is a transcript of one reading of the workspace. It contains");
  lines.push("only the evidence, geometry and sources shown on screen for this reading.");
  lines.push("No value here was recomputed at export time; each is the value the");
  lines.push("application rendered from its committed, frozen model.");
  lines.push("");

  lines.push("SHAREABLE STATE");
  lines.push("-".repeat(46));
  lines.push("Open this URL to reproduce the interface of this reading:");
  lines.push(`  ${projection.state_url}`);
  lines.push("The interface reproduces exactly. The numbers reproduce only while the");
  lines.push("committed snapshot id above is unchanged; a later deployment may publish");
  lines.push("different values, and the application will say so when it cannot reproduce");
  lines.push("the original exactly.");
  lines.push("");

  if ((projection.values || []).length) {
    lines.push("DISPLAYED VALUES");
    lines.push("-".repeat(46));
    for (const value of projection.values) {
      const unit = value.unit ? ` ${value.unit}` : "";
      let shown;
      if (value.state && value.state !== "PUBLISHED" && value.state !== "VALID") {
        shown = `${value.state}${value.withheld_reason ? ` (${value.withheld_reason})` : ""}`;
      } else if (value.display != null) {
        shown = `${value.display}${unit}`;
      } else {
        shown = "—";
      }
      lines.push(`• ${value.label} [${value.scope}]: ${shown}`);
      if (value.comparison_basis) lines.push(`    comparison basis: ${value.comparison_basis}`);
    }
    lines.push("");
  }

  lines.push("SOURCES, FRESHNESS, LICENCE AND INTERPRETATION CEILING");
  lines.push("-".repeat(46));
  for (const source of sourcesObject.sources) {
    if (source.missing_from_registry) {
      lines.push(`• ${source.id}: not found in the source registry.`);
      continue;
    }
    lines.push(`• ${source.display_name || source.id} (${source.id})`);
    if (source.authority) lines.push(`    publisher: ${source.authority}`);
    const route = [source.retrieval_route, source.dataset_url, source.artifact, source.builder].filter(Boolean).join(" · ");
    if (route) lines.push(`    retrieval: ${route}`);
    lines.push(`    freshness: ${exportFreshnessLine(source)}`);
    if (source.license) lines.push(`    licence: ${source.license}${source.license_url ? ` (${source.license_url})` : ""}`);
    if (source.attribution) lines.push(`    attribution: ${source.attribution}`);
    if (source.interpretation_ceiling) lines.push(`    interpretation ceiling: ${source.interpretation_ceiling}`);
    lines.push("");
  }

  const ccSources = sourcesObject.sources.filter((source) => /CC BY/i.test(String(source.license || "")));
  if (ccSources.length) {
    lines.push("ATTRIBUTION (required by CC BY 4.0)");
    lines.push("-".repeat(46));
    for (const source of ccSources) {
      lines.push(`• ${source.attribution || source.authority || source.display_name || source.id} — ${source.license}${source.license_url ? ` (${source.license_url})` : ""}`);
    }
    lines.push("");
  }

  lines.push("GEOMETRY");
  lines.push("-".repeat(46));
  lines.push(`geometry.geojson is ${GEOJSON_CRS}. Each feature is tagged with its analytical`);
  lines.push("scope and identity. Lens circles are GENERATED analytical windows, not");
  lines.push("official parcel or planning boundaries. Official ámbito polygons are the");
  lines.push("publisher's own geometry, never a bounding box, and carry the publisher's");
  lines.push("declared state (which may be NOT_DECLARED_BY_PUBLISHER).");
  lines.push("");

  lines.push("LIMITS OF REPRODUCIBILITY");
  lines.push("-".repeat(46));
  lines.push("• The URL restores the interface; it does not freeze the underlying data.");
  lines.push("• A withheld comparison is withheld here too, with its reason — it is not");
  lines.push("  a zero and not a missing value.");
  lines.push("• A published zero is a real zero; an unavailable or missing value is not.");
  lines.push("• No stage, rank, score or composite is published or derivable.");
  lines.push("");

  return lines.join("\n");
}

// Date-stamp the filenames so two exports are distinguishable. The stamp is the
// retrieval date (UTC) of the export.
function dateStamp(now) {
  const date = now instanceof Date ? now : new Date(now);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

// buildEvidenceBundle(projection, registry, { now }) -> the five files, each
// { name, mime, text }, plus the stamp and the contributing source ids. The
// caller delivers them (Blob + download in the browser).
function buildEvidenceBundle(projection, registry, options = {}) {
  if (!isObject(projection) || !isObject(projection.meta)) {
    throw new TypeError("buildEvidenceBundle: projection must be an object with a meta block");
  }
  if (!isObject(registry) || !Array.isArray(registry.sources)) {
    throw new TypeError("buildEvidenceBundle: registry must be the parsed source_registry.json");
  }
  const stamp = dateStamp(options.now || projection.meta.generated_at || Date.now());
  const reading = buildReadingObject(projection);
  const sources = buildSourcesObject(projection, registry);
  const geometry = buildGeometryObject(projection);
  const readme = buildReadmeText(projection, sources);

  const files = [
    { name: `reading-${stamp}.json`, mime: "application/json", text: JSON.stringify(reading, null, 2) },
    { name: `sources-${stamp}.json`, mime: "application/json", text: JSON.stringify(sources, null, 2) },
    { name: `geometry-${stamp}.geojson`, mime: "application/geo+json", text: JSON.stringify(geometry, null, 2) },
    { name: `README-${stamp}.txt`, mime: "text/plain", text: readme },
    { name: `state-${stamp}.url`, mime: "text/uri-list", text: `${projection.state_url}\n` },
  ];
  return { stamp, files, contributingSourceIds: contributingSourceIds(projection) };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    EXPORT_CONTRACT_VERSION,
    GEOJSON_CRS,
    FRESHNESS_FIELDS: EXPORT_FRESHNESS_FIELDS,
    SOURCE_EXPORT_FIELDS,
    contributingSourceIds,
    buildReadingObject,
    buildSourcesObject,
    buildGeometryObject,
    buildReadmeText,
    buildEvidenceBundle,
  };
}
