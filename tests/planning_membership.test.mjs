import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { SHELL_DICTIONARIES } from "../js/shell-copy.js";
import { SURFACES, surfaceKeysFor, railModel } from "../js/scope-rail.js";

// UX-I1 / P0-a (#95): planning-ámbito MEMBERSHIP disclosure promoted into the
// always-visible PLACE planning section. Pure-model and markup contracts for the
// acceptance criteria that do not need a browser; the rendered states, viewport
// classes, EN/ES and interaction sequences are in
// browser-tests/planning-ambito.browser.mjs.

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("index.html");
const app = read("js/app.js");
const registry = JSON.parse(read("data/source_registry.json"));
const planningSection = html.slice(html.indexOf('id="planningAmbito"'), html.indexOf('id="placeDetail"'));

// --------------------------------------------------- AC-P0-11: containment copy

test("AC-P0-11: planning.outside containment copy is unchanged, byte for byte, in both languages", () => {
  assert.equal(
    SHELL_DICTIONARIES.en["planning.outside"],
    "No official planning ámbito contains the Lens centre. The ámbito universe does not cover the whole municipality, so this is an explicit absence of a containing ámbito — not a zero and not the nearest ámbito."
  );
  assert.equal(
    SHELL_DICTIONARIES.es["planning.outside"],
    "Ningún ámbito oficial de planeamiento contiene el centro de la Lente. El universo de ámbitos no cubre todo el municipio, así que esto es una ausencia explícita de ámbito contenedor: no es un cero ni es el ámbito más cercano."
  );
});

// --------------------------------------------------- AC-P0-10: new EN/ES copy

test("AC-P0-10: the new membership copy keys exist in both languages, non-empty, with the {n} placeholder where a count is shown", () => {
  const added = [
    "planning.touchedCount",
    "planning.touchedCountOne",
    "planning.touchedSeeAll",
    "planning.touchedUpdating",
  ];
  for (const key of added) {
    for (const lang of ["en", "es"]) {
      assert.ok(SHELL_DICTIONARIES[lang][key] && SHELL_DICTIONARIES[lang][key].trim().length > 0, `${lang}:${key}`);
    }
    // EN and ES are authored copy, not the same string.
    assert.notEqual(SHELL_DICTIONARIES.en[key], SHELL_DICTIONARIES.es[key], key);
  }
  // The count placeholder is literally {n} in the plural and see-all strings, and
  // absent from the singular (which hard-codes 1) and the zero case.
  for (const lang of ["en", "es"]) {
    assert.match(SHELL_DICTIONARIES[lang]["planning.touchedCount"], /\{n\}/, lang);
    assert.match(SHELL_DICTIONARIES[lang]["planning.touchedSeeAll"], /\{n\}/, lang);
    assert.doesNotMatch(SHELL_DICTIONARIES[lang]["planning.touchedCountOne"], /\{n\}/, lang);
    assert.match(SHELL_DICTIONARIES[lang]["planning.touchedCountOne"], /\b1\b/, lang);
  }
  // The zero case reuses the existing, unchanged string.
  assert.equal(SHELL_DICTIONARIES.en["planning.touchedNone"], "The Lens circle touches no official planning ámbito.");
});

// --------------------------------------------------- AC-P0-1: markup placement

test("AC-P0-1: the membership block lives inside the planning section, beneath containment and above the citizen reading", () => {
  const membershipAt = planningSection.indexOf('id="planningMembership"');
  const outsideAt = planningSection.indexOf('id="planningOutside"');
  const identityAt = planningSection.indexOf('id="planningIdentity"');
  const citizenAt = planningSection.indexOf('id="planningCitizen"');
  assert.ok(membershipAt > 0, "the membership block is in the planning section");
  // Containment (the resolved identity and the outside copy) comes first.
  assert.ok(membershipAt > outsideAt && outsideAt > 0, "membership is beneath the containment outside copy");
  assert.ok(membershipAt > identityAt && identityAt > 0, "membership is beneath the containing identity");
  // The ceiling and the citizen "What this means" disclosure come after it.
  assert.ok(citizenAt > membershipAt, "membership is above the citizen reading");
  // The three parts the increment ships: a count line, the chips and a route to
  // the complete list.
  for (const id of ["planningMembershipCount", "planningMembershipChips", "planningMembershipSeeAll"]) {
    assert.ok(planningSection.includes(`id="${id}"`), id);
  }
  // The count line is a polite live region so a promoted change is announced.
  assert.match(planningSection, /id="planningMembershipCount"[^>]*aria-live="polite"/);
});

// ------------------------------------------------ AC-P0-5: membership is only
//                                                   membership — no apportionment

test("AC-P0-5: the membership markup carries no quantity, share or percentage, and reuses the no-apportionment note", () => {
  // The block (minus its explanatory note, which the forbidden scan excludes
  // elsewhere) must not assert a percentage, an area or a forbidden claim.
  assert.doesNotMatch(planningSection, /%/);
  assert.doesNotMatch(planningSection, /[→➔⟶⇒]|&(?:r|R)arr;/);
  // The no-apportionment note is reused verbatim by key.
  assert.ok(planningSection.includes('data-i18n="planning.touchedNote"'));
  assert.match(SHELL_DICTIONARIES.en["planning.touchedNote"], /No share, proportion or part/);
  assert.match(SHELL_DICTIONARIES.es["planning.touchedNote"], /parte, proporción o porción|parte, proporción|porción/);
});

test("AC-P0-5: the only membership computation is the canonical ambitosIntersecting — no second geometry algorithm", () => {
  // The app reads membership exclusively through the shared evaluator, which
  // calls the pure-model index.ambitosIntersecting. No ad-hoc intersection,
  // overlap-area, ratio or apportionment math is introduced in the renderers.
  assert.match(app, /function evaluatePlanningMembership\(\)/);
  assert.match(app, /planningModel\.index\.ambitosIntersecting\(centre\.lon, centre\.lat, radiusM\)/);
  // No coverage ratio / overlap area is computed anywhere in the membership code.
  // Scan code only, with comment lines stripped, so denial prose ("no share…")
  // is not mistaken for a computation.
  const membershipCode = app
    .slice(app.indexOf("function evaluatePlanningMembership"), app.indexOf("function renderPlanningPolygon"))
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(membershipCode, /overlapArea|coverageRatio|apportion|\* *100|\/ *area/i);
});

// --------------------------------------- the scope the rail may now name in PLACE

test("the membership surface is gated by planningMembership and is the one LENS_INTERSECT_AMBITO surface", () => {
  const surface = SURFACES["place.planning.touched"];
  assert.equal(surface.when, "planningMembership");
  assert.equal(surface.scope, "LENS_INTERSECT_AMBITO");
  // With the flag set (planning loaded, PLACE showing) the rail names the scope;
  // without it (still loading / unavailable) it does not.
  const withFlag = railModel({ mode: "PLACE", flags: { planningMembership: true }, registry, instances: { LENS_INTERSECT_AMBITO: ["A · 900 m"], PLANNING_AMBITO: ["—"] } });
  assert.ok(withFlag.entries.some((e) => e.scope === "LENS_INTERSECT_AMBITO"));
  const withoutFlag = railModel({ mode: "PLACE", flags: {}, registry, instances: { PLANNING_AMBITO: ["—"] } });
  assert.ok(!withoutFlag.entries.some((e) => e.scope === "LENS_INTERSECT_AMBITO"));
});

// ------------------------------- the recomputation strategy is present in source

test("AC-P0-12: the recomputation strategy — identity guard, coalescing and honest pending state — is wired", () => {
  // Identity guard: a per-centre+radius cache guards the scan.
  assert.match(app, /planningMembershipCache = \{ key, result \}/);
  // Coalescing: begin/end on the real drag and slider commit paths.
  assert.match(app, /marker\.on\("dragstart", beginPlanningMembershipInteraction\)/);
  assert.match(app, /marker\.on\("dragend", endPlanningMembershipInteraction\)/);
  assert.match(app, /radiusSlider\.onchange = endPlanningMembershipInteraction/);
  // Honest pending state while moving, settle via refresh() on release.
  assert.match(app, /planning\.touchedUpdating/);
  assert.match(app, /function endPlanningMembershipInteraction\(\)[\s\S]*refresh\(\)/);
});

// ------------------------------------------- P0-a staging gate (#95, PR #96
//                                              comment 6273771576)

test("staging gate: P0A_ENABLED is fail-closed — the SAME loopback/private-LAN predicate K12's ?k12opt= already proves false for a public host, ANDed with the explicit query flag", () => {
  // The exact composition: a public host (isLoopbackOrPrivateLanHost === false,
  // proven in tests/ac_p0_12_runner.test.mjs and tests/radial_halo.test.mjs
  // against the kept-in-sync runner_core.mjs copy, e.g. "pages.github.io") can
  // never satisfy this AND regardless of what the query string carries.
  assert.match(
    app,
    /const P0A_ENABLED = isLoopbackOrPrivateLanHost\(window\.location\.hostname\) && new URLSearchParams\(window\.location\.search\)\.get\("p0aStaging"\) === "1";/
  );
});

test("staging gate OFF: every P0-a-added production surface is wrapped behind P0A_ENABLED — none of it runs unconditionally", () => {
  // The promoted block's renderer refuses to render/scan when the flag is off.
  assert.match(app, /function renderPlanningMembership\(\)[\s\S]{0,400}if \(!P0A_ENABLED\) \{/);
  // The coalescing listeners (marker dragstart/dragend) are installed only when
  // the flag is on — OFF means these handlers do not exist at all.
  assert.match(app, /if \(P0A_ENABLED\) \{\s*\n\s*lenses\.A\.marker\.on\("dragstart", beginPlanningMembershipInteraction\);/);
  // The radius-slider coalescing hooks are likewise conditional.
  assert.match(app, /if \(P0A_ENABLED\) beginPlanningMembershipInteraction\(\);/);
  assert.match(app, /if \(P0A_ENABLED\) radiusSlider\.onchange = endPlanningMembershipInteraction;/);
  // The "See all" listener only attaches when the flag is on.
  assert.match(app, /if \(P0A_ENABLED && planningMembershipSeeAll\)/);
  // The scope-rail claim reproduces the OLD planningDetail-gated semantics when
  // off, and the NEW always-on-while-ready semantics when on — never a single
  // unconditional value.
  assert.match(
    app,
    /planningMembership: P0A_ENABLED\s*\n\s*\? planningState === "ready"\s*\n\s*: planningState === "ready" && Boolean\(placeDetail && placeDetail\.open\),/
  );
});
