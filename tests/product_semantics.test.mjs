import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// K1 — Product boundary and semantic contract (issue #63).
// These assertions read the working-tree source text, the pattern
// deployment_validation.test.mjs uses for source-text invariants.

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const semantics = fs.readFileSync(
  new URL("../docs/PRODUCT_SEMANTICS.md", import.meta.url),
  "utf8"
);
const claims = fs.readFileSync(
  new URL("../docs/CLAIMS_AND_LIMITATIONS.md", import.meta.url),
  "utf8"
);

const PRODUCT_NAME = "Madrid Urban Evidence Lens";
const STRAPLINE = "Madrid · Urban development · Official evidence";

function first(re, source) {
  const m = source.match(re);
  return m ? m[1].trim() : null;
}

const pageTitle = first(/<title>([^<]*)<\/title>/, html);
const brandTitle = first(/<div class="brand-title">([^<]*)<\/div>/, html);
const brandSub = first(/<div class="brand-sub">([^<]*)<\/div>/, html);
const metaDescription = first(
  /<meta name="description" content="([^"]*)"/,
  html
);
const readmeH1 = first(/^#\s+(.+)$/m, readme);

test("product name is identical in <title> and the header brand block", () => {
  assert.equal(pageTitle, PRODUCT_NAME);
  assert.equal(brandTitle, PRODUCT_NAME);
  assert.equal(pageTitle, brandTitle);
});

test("the README H1 carries the same product name", () => {
  assert.equal(readmeH1, PRODUCT_NAME);
});

test("the old tourism-frame product name is gone from the product wording", () => {
  for (const text of [pageTitle, brandTitle, readmeH1, brandSub]) {
    assert.doesNotMatch(text, /Tourism Intelligence/i);
  }
  assert.doesNotMatch(brandSub, /Tourism . Mobility . Urban Climate/);
});

test("the strapline names development, official sources and the municipality", () => {
  assert.equal(brandSub, STRAPLINE);
  assert.match(brandSub, /Madrid/);
  assert.match(brandSub, /development/i);
  assert.match(brandSub, /evidence/i);
});

test("the strapline makes no forbidden claim (gate §16.1, §7)", () => {
  // The strapline must not imply real-time data, inference-as-intelligence,
  // AI, smart-city framing, prediction or recommendation.
  assert.doesNotMatch(
    brandSub,
    /real-?time|intelligence|\bAI\b|smart ?city|prediction|recommend/i
  );
});

test("the meta description reframes away from the tourism headline", () => {
  assert.ok(metaDescription, "meta description present");
  assert.doesNotMatch(metaDescription, /Tourism . Mobility . Urban Climate/);
  assert.doesNotMatch(metaDescription, /intelligence/i);
});

test("PRODUCT_SEMANTICS.md defines all seven terms as headings", () => {
  const terms = [
    "Evidence object",
    "Scope",
    "Edition",
    "Reading",
    "Interpretation ceiling",
    "Ámbito",
    "Instrument",
  ];
  for (const term of terms) {
    const heading = new RegExp(`^#{2,4}\\s+${term}\\s*$`, "m");
    assert.match(
      semantics,
      heading,
      `PRODUCT_SEMANTICS.md should define "${term}" as a heading`
    );
  }
});

test("PRODUCT_SEMANTICS.md copies the §3.3 boundary table verbatim", () => {
  assert.match(semantics, /\*\*Organising domain\*\*/);
  assert.match(semantics, /\*\*Retained documented domains\*\*/);
  assert.match(semantics, /\*\*Frozen, not extended\*\*/);
  assert.match(semantics, /\*\*Out of boundary\*\*/);
});

test("PRODUCT_SEMANTICS.md records the inert Explore nav and #66's mode system", () => {
  assert.match(semantics, /`Explore` button is inert/);
  assert.match(semantics, /PLACE \/ COMPARE \/ CITY/);
  assert.match(semantics, /#66/);
});

test("CLAIMS_AND_LIMITATIONS.md states both permanent urban ceilings", () => {
  assert.match(
    claims,
    /No dwelling or protected-dwelling counts from non-unit quantities/
  );
  assert.match(
    claims,
    /No apportionment of a whole-area quantity to a part of it/
  );
});
