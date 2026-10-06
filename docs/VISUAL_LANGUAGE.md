# Visual language — K5

Status: binding product contract established by K5 (#67), after the K4
information architecture and the Gate L source audit. This document changes
presentation only. It does not change a metric, state, scope, date, rounding
rule, withholding rule or interpretation ceiling, and it does not ship planning
evidence.

## Direction: an urban instrument

The interface should read like a compact urban evidence instrument: measured,
legible, spatial and source-disciplined. The map remains the primary field. Dark
navy chrome and modest translucent surfaces may separate controls from the map,
but every visual choice must make scope, provenance and limits easier to read.
Hierarchy comes from role, spacing and structure rather than a collection of
near-identical type sizes.

### NOT THIS

- gaming UI;
- crypto dashboard;
- sci-fi control room;
- Apple demo clone;
- generic startup analytics;
- decorative glass everywhere.

## Type scale

There are exactly seven production type tokens. Every `font-size` declaration in
`css/app.css` references one of them; font shorthands cannot bypass the scale.
Breakpoints change layout, disclosure and wrapping, not individual type sizes.

| Token | Value | Role |
|---|---:|---|
| `--t-display` | 28px | Primary numeric or lead figure only |
| `--t-title` | 20px | Lead-answer headline |
| `--t-figure` | 16px | Supporting analytical figure |
| `--t-body` | 14px | Paragraphs, tables and substantive explanation |
| `--t-label` | 12px | Field names, units and controls |
| `--t-meta` | 11px | Dates, scope, source state and compact provenance |
| `--t-micro` | 10px | Lowest-priority metadata; absolute floor |

Nothing may render below 10px at any viewport. `MICRO` is a floor, not permission
to demote an important limitation. Interpretation ceilings use `BODY` in the
evidence drawer and substantive surfaces, or `META` only when placement is
genuinely compact.

## Spacing and radius

The four layout-spacing tokens follow the product's existing 4px rhythm:

| Token | Value | Typical use |
|---|---:|---|
| `--s-1` | 4px | tightly related items |
| `--s-2` | 8px | control and row gaps |
| `--s-3` | 12px | card padding |
| `--s-4` | 16px | section separation |

Spacing tokens describe recurring application layout rhythm: gaps, padding and
separation between semantic blocks. Choose a step by role (tight relation,
control/row, card surface, or section), preserving hierarchy when rounding.
Literal dimensions describe meaningful geometry: map and viewport positioning,
icon/marker size, stroke and track shape, safe-area offsets, resize handles and
SVG coordinates. Those measurements do not become spacing tokens just because
they are expressed in pixels.

The two radius tokens are the application surface language: `--r-small: 8px`
for controls, cards and grouped field surfaces, and `--r-large: 16px` for
primary panels, drawers and large floating chrome. An application card therefore
uses a surface token rather than retaining an arbitrary 13px corner. Literal
radii express independent geometry: 50% circles, 999px pills, switches/tracks,
markers, chart/halo marks, logos, scrollbars and provider-owned Leaflet shapes.
These categories are enumerated in the visual-language tests; a geometric
exception must be recognizable by its role, not by a historical pixel value.

The current spacing exceptions are deliberately narrow: Leaflet attribution and
tooltip padding is provider-control geometry, and the `sr-only` negative margin
clips visually hidden accessibility text. The strict test matches each
selector, property and value together; responsive rules receive no exception.
Radius exceptions are limited to circles/pills, logo corners, switch and track
shapes, Leaflet controls, scrollbar corners, resize-handle marks, bar/chart
marks, and the focus corner on the resize handle. Every retained pixel shape is
listed under its semantic category in the test allowlist; application-owned
cards, buttons, panels, controls and information surfaces use the two radius
tokens.

## Contrast

All project-authored text must meet WCAG AA against its effective rendered
background: 4.5:1 for normal text and 3:1 only for WCAG-large text. The browser
test composites every translucent ancestor over the product-owned map/body
fallback (`#08101a`) and tests the resulting foreground/background pair. It
audits every visible text node in PLACE, COMPARE, CITY and the evidence drawer at
360, 420, 560, 850, 1100 and 1440px. SVG internals, browser-native option
rendering and third-party Leaflet controls/tooltips are documented exclusions;
application-owned map cluster text remains included.

Contrast failures are fixed with the minimum foreground or surface adjustment.
They are never fixed by inventing a new font size or by turning the map-first UI
into opaque slabs. `backdrop-filter: blur(...)` remains optional enhancement;
the background colour supplies a complete flat fallback.

## Colour is category, never judgement

Colour may distinguish a documented category. It may not say good/bad,
ahead/behind, better/worse, fresh/stale, successful/failed, advanced/delayed or
otherwise evaluate phase, source age, change, sensitivity or scope. Freshness is
text and date, not a traffic light. A change is a signed observation, not a
performance colour. Every meaningful state also carries interpretable text,
glyph, stroke/dash, shape, label or pattern; colour alone is never sufficient.

Lens A (`--a`) and Lens B (`--b`) retain their reserved identities. Lens B also
retains its structural dashed distinction. The future planning family is
reserved separately as `--planning-neutral`, `--planning-origin` and
`--planning-unresolved`; none reuses either Lens hue. K5 renders no planning
geometry or planning surface.

## Gate L phase contract

Gate L established that the four published phase fields are multi-dimensional,
not one ordered stage sequence. Therefore `Sin Iniciar`, `En tramitación`, `En
Ejecución` and `Finalizado` may receive neutral categorical distinctions only.
They must not form light-to-dark, red/amber/green, cold-to-warm or increasing
saturation sequences and must not use ordinal numbers, progress arrows or
completion bars. A test-only greyscale fixture distinguishes them with label,
glyph and border structure. No fixture content is shipped in production.

`No Necesita` uses the separately reserved unresolved treatment and an explicit
label/outline. It is distinct from `Sin Iniciar`, but it does not mean skipped,
complete, irrelevant, successful or “not applicable”; Gate L did not establish
an official definition.

`PGOUM-85` and `PGOUM-97` use the reserved neutral origin-marker treatment,
including a distinct structural mark. They are source-observed plan/origin
markers and are never inserted into a phase sequence or promoted into an
invented semantic category.

## Interaction floor

Under `pointer: coarse`, every visible application-owned interactive element has
an effective target of at least 44×44px. This includes modes, scope/freshness
rail, selects, layer switches, Lens controls, sliders, reset, disclosures,
drawer controls, language selector, evidence routes and the HATI frame action.
A compact visual track may sit inside a larger hit area.

Every interactive element uses one `:focus-visible` language: a 2px light-blue
outline, 3px offset and a dark separation ring. The indicator exceeds the WCAG
3:1 non-text contrast requirement on the application chrome. Focus is tested as
rendered state, not only as stylesheet text.

## Motion and effects

K5 adds no animation. Existing non-essential transitions collapse to effectively
zero duration under `prefers-reduced-motion: reduce`; information and control
state remain unchanged.

Modest `backdrop-filter: blur(...)` may remain on chrome where it aids separation
and must degrade to the declared flat surface. Shaders, WebGL effects, distortion,
refraction, liquid glass, gradient meshes, animated backdrops and parallax are
outside the visual language. No visual effect may sit behind analytical text or
be necessary to understand it.

Gate K's rejected external libraries remain rejected:

- `liquid-logo` uses the PolyForm Shield licence rather than an open-source
  licence and is unsuitable as a product dependency;
- `shadergradient` has no licence file, so redistribution rights are unclear;
- `liquid-glass-js` had only one commit at review time and its central distortion
  effect conflicts with the prohibition on refracting content behind evidence.

No CSS framework, preprocessor, shader, icon, glass or animation library is
introduced. Inline SVG and text glyphs remain sufficient.
