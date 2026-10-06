import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { LEGACY_COPY_ES, localizeCopy, localizeCopyEs, localizeMonths } from "../js/legacy-copy.js";
import { SHELL_DICTIONARIES } from "../js/shell-copy.js";
import * as area from "../js/area-profile.js";
import * as destination from "../js/destination-context.js";

// K4 language policy: one active document language; every PRODUCT-AUTHORED
// phrase localises; official / registry wording stays verbatim.

const registry = JSON.parse(fs.readFileSync(new URL("../data/source_registry.json", import.meta.url), "utf8"));
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

const placeholders = (text) => (text.match(/\{[a-z]\}/g) || []).sort().join("");

test("English is the source language and is never altered", () => {
  for (const [en] of LEGACY_COPY_ES) {
    assert.equal(localizeCopy(en, "en"), en);
    assert.equal(localizeCopy(en, "fr"), en, "only ES transforms; every other value is the source text");
  }
});

test("every catalogue entry has a real Spanish rendering with the same placeholders", () => {
  const seen = new Set();
  for (const [en, es] of LEGACY_COPY_ES) {
    assert.ok(typeof es === "string" && es.length > 0, en);
    assert.equal(placeholders(es), placeholders(en), `placeholders differ: ${en}`);
    assert.equal(seen.has(en), false, `duplicate source phrase: ${en}`);
    seen.add(en);
  }
});

test("Spanish rendering keeps every number, unit and symbol the English carried", () => {
  const samples = [
    ["3 HATI samples · 15:00", /3 muestras HATI · 15:00/],
    ["15 records\nr 900 m", /15 registros\nr 900 m/],
    ["+160 · deploy", /\+160 · desp\./],
    ["867,449 travellers", /867,449 viajeros/],
    ["2 licensed VUT units", /2 unidades VUT con licencia/],
    ["Reference 1 Jan 2026", /Referencia 1 ene 2026/],
    ["Observation period: August 2026", /Periodo de observación: agosto de 2026/],
    ["Barrio 035 · District 03", /Barrio 035 · Distrito 03/],
  ];
  for (const [en, expected] of samples) assert.match(localizeCopyEs(en), expected, en);
  assert.equal(localizeMonths("Retrieved 2026-09-29"), "Retrieved 2026-09-29", "ISO dates are untouched");
});

test("official and registry wording is verbatim: no registry ceiling or authority is ever rewritten", () => {
  for (const source of registry.sources) {
    for (const field of ["interpretation_ceiling", "authority", "source_period_semantics", "freshness_evidence"]) {
      if (typeof source[field] === "string") assert.equal(localizeCopyEs(source[field]), source[field], `${source.id}.${field}`);
    }
  }
  // Display names are OUR labels (not publisher wording) and do localise.
  for (const source of registry.sources) assert.notEqual(localizeCopyEs(source.display_name), source.display_name, `${source.id}.display_name has a Spanish rendering`);
  // Official names pass through untouched.
  for (const name of ["Los Jerónimos", "Universidad", "Madrid", "Ayuntamiento de Madrid - Subdireccion General de Estadistica", "Casón del Buen Retiro"]) {
    assert.equal(localizeCopyEs(name), name);
  }
});

test("project-authored model copy from the legacy modules is localised, with its meaning intact", () => {
  const labels = [area.EVIDENCE_LABEL, area.VUT_EVIDENCE_LABEL, area.VUT_STATE_PREFIX];
  for (const label of labels) assert.notEqual(localizeCopyEs(label), label, label);
  assert.match(localizeCopyEs(area.EVIDENCE_LABEL), /Registro oficial/);
  assert.match(localizeCopyEs("Whole official barrio — not the Lens circle."), /no el círculo de la Lente/);
  assert.match(localizeCopyEs(destination.HOTEL_SCOPE_CAVEAT), /no todo el turismo ni todo el alojamiento/);
  // The canonical licence caveat is a contract with the claims document: verbatim.
  assert.equal(localizeCopyEs(area.VUT_OPERATION_CAVEAT), area.VUT_OPERATION_CAVEAT);
});

test("the app applies the catalogue through ONE mechanism and marks verbatim evidence", () => {
  assert.match(app, /function applyCopyLanguage\(\)/);
  assert.match(app, /localizeCopyEs\(/);
  assert.equal((html.match(/id="languageSelect"/g) || []).length, 1, "one selector");
  assert.doesNotMatch(app, /if \(\(?shellLanguage\(\) === "es"\)?\)[^\n]*textContent/, "no per-render-site language branches");
  assert.match(app, /ceilingText\.lang = "en"/, "registry ceilings carry their real language");
  assert.match(app, /data-provenance-line/);
  assert.match(html, /<script src="js\/legacy-copy\.js/);
});

test("accessibility copy is part of the same policy", () => {
  for (const attribute of ["aria-label", "aria-description", "title", "placeholder", "alt"]) {
    assert.match(app, new RegExp(`"${attribute}"`), `${attribute} is localised`);
  }
  // Static aria-labels in the markup all have a Spanish rendering.
  const labels = [...html.matchAll(/(?:aria-label|title)="([^"]*[A-Za-z]{3}[^"]*)"/g)].map((match) => match[1]);
  const known = new Set(["Mostrar contexto de hostelería y actividad comercial"]);
  for (const label of labels) {
    if (known.has(label)) continue;
    assert.notEqual(localizeCopyEs(label), label, `no Spanish rendering for static label: ${label}`);
  }
  // Every K4 shell string has a Spanish twin (already tested for keys) and differs where it is words.
  const same = Object.keys(SHELL_DICTIONARIES.en).filter((key) => SHELL_DICTIONARIES.en[key] === SHELL_DICTIONARIES.es[key]);
  for (const key of same) assert.match(SHELL_DICTIONARIES.en[key], /^(Reference|—|BiciMAD|barrio|Provisional|Parcel|Semestral|Irregular|Municipio|.*\d.*)$|^[A-Z]+$/, `identical EN/ES string: ${key}`);
});
