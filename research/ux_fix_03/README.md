# Territorial information compactness review

## Structure audit

These three elements answer different questions and remain separate in the DOM and in the visual hierarchy:

- `#placeCircleSummary` presents four readings measured inside the adjustable Lens Circle A. It has its own radius and evidence route, appears only at the existing narrow-screen breakpoint, and does not contain barrio or planning quantities. Its two-column narrow layout reserved label height in every reading and used generous card padding.
- `#areaProfile` identifies the official barrio polygon containing the Lens centre. Its residents and licensed-VUT figures each describe that whole barrio, with their own provenance and date semantics. The resident number used the display type token, the bordered figure used 12px padding, the identity row had 16px vertical margins, and the VUT context added another padded card. The district context was also truncated on one line.
- `#planningAmbito` identifies a distinct official planning geography. The exact denomination, code, edition, scope distinction, evidence state, and evidence route remain in this section. Before the change, its identity stacked a 14px distinction paragraph between the kind/code and edition rows, with 8px gaps; its scope and absence explanations also used larger padding and body type.
- `.section-head` is shared across the application. On coarse pointers, the global 44px minimum made the territorial evidence buttons 44px circles and forced taller heading rows. The territorial headings now keep a compact visible icon and the same 44px-or-larger touch target; other evidence controls are unaffected.

## Visual changes

- Brought the resident figure to the title token and tightened area identity, figure, and licensed-VUT spacing with the existing `--s-*` and `--t-*` tokens.
- Let long barrio context and codes wrap instead of truncating them.
- Kept all four Lens-circle states while reducing narrow summary card padding and heading gap.
- Tightened the planning identity rhythm and supporting text size. Its official identity, distinction, edition, scope, evidence state, and source controls remain visible.
- Kept the existing visual distinction between the blue Lens summary, unboxed administrative lead, and separated planning section.

No geometry, data, spatial computation, evidence interpretation, or left-panel styles changed.

## Screenshots

Each pair uses an 1180×820 iPad-landscape viewport. The top captures show the territorial lead; the planning captures scroll the same panel to the official planning section. The unavailable case is Spanish/Light; the other two are English/Dark.

| State | Before | After |
| --- | --- | --- |
| Available | [Top](screenshots/before/territorial-available-dark-en.png) · [Planning](screenshots/before/territorial-available-planning-dark-en.png) | [Top](screenshots/after/territorial-available-dark-en.png) · [Planning](screenshots/after/territorial-available-planning-dark-en.png) |
| Unavailable | [Top](screenshots/before/territorial-unavailable-light-es.png) · [Planning](screenshots/before/territorial-unavailable-planning-light-es.png) | [Top](screenshots/after/territorial-unavailable-light-es.png) · [Planning](screenshots/after/territorial-unavailable-planning-light-es.png) |
| No intersection | [Top](screenshots/before/territorial-no-intersection-dark-en.png) · [Planning](screenshots/before/territorial-no-intersection-planning-dark-en.png) | [Top](screenshots/after/territorial-no-intersection-dark-en.png) · [Planning](screenshots/after/territorial-no-intersection-planning-dark-en.png) |

`capture.mjs` serves the real application and committed artifacts. `--baseline` serves only `origin/main`'s stylesheet for the before captures; the after captures serve the branch stylesheet. The unavailable scenario returns HTTP 503 for the planning geometry artifact. The no-intersection scenario moves the Lens to a real location outside the official planning-geometry universe.

## Regression coverage

`browser-tests/territorial-compact.browser.mjs` covers desktop 1440×900, iPad landscape 1180×820, iPad portrait 820×1180, and mobile 390×844. Each viewport runs Light/Dark and EN/ES checks. It verifies containment, scope distinctions, preserved evidence routes, real missing and outside states, a long official planning name/code, coarse-pointer evidence activation and keyboard focus return, and independent mode scroll restoration.
