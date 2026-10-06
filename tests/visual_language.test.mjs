import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

const TYPE_TOKENS = Object.freeze({
  display: "28px",
  title: "20px",
  figure: "16px",
  body: "14px",
  label: "12px",
  meta: "11px",
  micro: "10px",
});

test("K5 stylesheet declares exactly the seven fixed type tokens", () => {
  const declarations = [...withoutComments.matchAll(/--t-([\w-]+)\s*:\s*([^;]+);/g)]
    .map((match) => [match[1], match[2].trim()]);
  assert.deepEqual(Object.fromEntries(declarations), TYPE_TOKENS);
});

test("K5 every production font-size declaration uses the type scale with zero exceptions", () => {
  const declarations = [...withoutComments.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((match) => match[1].trim());
  assert.ok(declarations.length > 100, "the whole production stylesheet was audited");
  for (const value of declarations) {
    assert.match(value, /^var\(--t-(?:display|title|figure|body|label|meta|micro)\)(?:\s*!important)?$/);
  }
  assert.doesNotMatch(withoutComments, /font\s*:[^;}]*\b\d+(?:\.\d+)?px\b/i, "font shorthand may not bypass the scale");
  assert.equal([...withoutComments.matchAll(/font-size\s*:\s*\d/gi)].length, 0, "literal font-size allowlist is empty");
});

test("K5 breakpoints change layout, never per-surface typography", () => {
  for (const block of mediaBlocks(withoutComments)) {
    assert.doesNotMatch(block.body, /font-size\s*:/, `${block.query} contains a per-surface font-size override`);
  }
});

test("K5 exposes exactly four spacing and two radius tokens", () => {
  const spacing = [...withoutComments.matchAll(/--s-([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
  const radii = [...withoutComments.matchAll(/--r-([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
  assert.deepEqual(spacing, [["1", "4px"], ["2", "8px"], ["3", "12px"], ["4", "16px"]]);
  assert.deepEqual(radii, [["small", "8px"], ["large", "16px"]]);
});

test("K5 spacing migration uses tokens across the application layout", () => {
  const declarations = cssDeclarations(withoutComments);
  const literalSpacing = declarations.filter(({ property, value }) =>
    /^(?:margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|gap|row-gap|column-gap)$/.test(property) && /-?\d+(?:\.\d+)?px\b/.test(value),
  );
  const geometry = /(?:^|[\s,])(?:#map|\.leaflet(?:-[\w-]+)?|\.logo(?::before|:after)?|\.marker(?:-[\w-]+)?|\.dot(?:-[\w-]+)?|\.bar(?:\s+i)?|\.switch(?:\s|$)|\.halo-[\w-]+|\.destination-spark|\.destination-compbar|\.panel-resize-handle(?::before|:after)?|\.sr-only|\.hospitality-scale|\.heat-scale|\.area-label|\.poi-cluster|\.badge|\.comparison-halo-icon|\.lens-boundary|\.admin-active-pane|\.live(?:\s|$)|\.cb-lock)(?:\b|:|\s|,)/i;
  const nonGeometry = literalSpacing.filter(({ selector }) => !geometry.test(selector));
  assert.ok(nonGeometry.length <= 86, `application layout literals regressed: ${nonGeometry.length}`);
  assert.ok(declarations.some(({ property, value }) => property === "padding" && /var\(--s-3\)/.test(value)), "surface padding uses the canonical scale");
});

test("K5 application surfaces use radius tokens; literal radii belong to documented geometry categories", () => {
  const literalRadii = cssDeclarations(withoutComments).filter(({ property, value }) =>
    property === "border-radius" && /\d+(?:\.\d+)?px\b/.test(value) && !/999px\b/.test(value),
  );
  const geometry = /(?:^|[\s,])(?:\.leaflet(?:-[\w-]+)?|\.logo(?::before|:after)?|\.marker(?:-[\w-]+)?|\.dot(?:-[\w-]+)?|\.bar(?:\s+i)?|\.switch(?:\s|$)|\.halo-[\w-]+|\.destination-compbar|\.panel-resize-handle(?::before|:after)?|\.sr-only|\.hospitality-scale|\.heat-scale|\.area-label|\.poi-cluster|\.badge|\.comparison-halo-icon|\.lens-boundary|\.admin-active-pane|\.cb-lock|\.live|\.panel::-webkit-scrollbar-thumb)(?:\b|:|\s|,)/i;
  const nonGeometry = literalRadii.filter(({ selector }) => !geometry.test(selector));
  assert.ok(nonGeometry.length <= 28, `application surface literal radii regressed: ${nonGeometry.length}`);
  for (const selector of [".panel", ".left", ".evidence-drawer", ".mode-nav", ".mode-btn", ".card", ".metric", ".controlbox", ".destination-metric"]) {
    const surface = cssDeclarations(withoutComments).filter((item) => item.selector.split(",").map((part) => part.trim()).includes(selector) && item.property === "border-radius");
    assert.ok(surface.some(({ value }) => /var\(--r-(?:small|large)\)/.test(value)), `${selector} must use a radius token`);
  }
});

test("K5 judgement-bearing concepts use no success, error or warning colour convention", () => {
  const forbidden = /\b(?:success|error|warning|danger|positive|negative|good|bad|stale|fresh|ahead|behind|delayed|complete)[\w-]*\b|var\(--(?:green|heat|activity)\)/i;
  for (const [, selectors, declarations] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:phase|freshness|change|edition(?:-age)?)/i.test(selectors)) continue;
    assert.doesNotMatch(declarations, forbidden, `judgement colour in ${selectors.trim()}`);
  }
  assert.doesNotMatch(withoutComments, /--planning-[\w-]*(?:success|error|warning|complete|progress|order)/i);
});

test("K5 reserves a neutral planning family without borrowing Lens A/B", () => {
  const value = (name) => new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(withoutComments)?.[1].trim().toLowerCase();
  const lens = new Set([value("a"), value("b")]);
  for (const token of ["planning-neutral", "planning-origin", "planning-unresolved"]) {
    assert.ok(value(token), `${token} exists`);
    assert.equal(lens.has(value(token)), false, `${token} does not reuse Lens A/B`);
  }
  assert.match(css, /separate from Lens A\/B and carries no order, progress or judgement/);
});

test("K5 static inline presentation moved to classes; only dynamic bar widths remain", () => {
  const styles = [...html.matchAll(/style="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(styles.length, 4);
  for (const style of styles) assert.match(style, /^width:0%$/);
  assert.doesNotMatch(html, /style="[^"]*(?:color|background|border-radius|font)/i);
});

test("K5 adds no rendering dependency", () => {
  assert.deepEqual(Object.keys(pkg.dependencies || {}), []);
  assert.deepEqual(Object.keys(pkg.devDependencies || {}), ["playwright"]);
});

function mediaBlocks(source) {
  const blocks = [];
  let index = source.indexOf("@media");
  while (index !== -1) {
    const open = source.indexOf("{", index);
    let depth = 1;
    let cursor = open + 1;
    while (depth && cursor < source.length) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    blocks.push({ query: source.slice(index, open).trim(), body: source.slice(open + 1, cursor - 1) });
    index = source.indexOf("@media", cursor);
  }
  return blocks;
}

function cssDeclarations(source) {
  const declarations = [];
  for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const declaration of body.split(";")) {
      const match = /^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(declaration);
      if (match) declarations.push({ selector: selector.trim(), property: match[1], value: match[2].trim() });
    }
  }
  return declarations;
}
