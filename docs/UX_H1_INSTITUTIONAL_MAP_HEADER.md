# UX-H1 — Institutional map header

## Design contract

The map header is a single, compact application surface. It identifies the Lens
and territorial context on the left, and contains only user preferences and the
optional guided tour on the right. Map display controls stay in the existing
layer rail; analytical controls, evidence state, map interactions and Leaflet
controls are untouched.

| Existing element | Stable selector / dependency | Accessibility requirement | After |
| --- | --- | --- | --- |
| Product identity | `.brand`, `.logo`, `.brand-title`, `.brand-sub` | Name remains textual and visible; long title truncates only at compact widths | One quiet identity region inside the shared header surface |
| Appearance | `#appearanceSelect`, `js/app.js` appearance controller | Native select, label and visible focus ring | Kept in the preference group with a 44px target |
| Language | `#languageSelect`, i18n controller | Native select keeps its existing associated label | Kept as the sole language selector with a 44px target |
| Guided tour | `#tutorialHelpButton`, `js/tutorial.js` | Button name and keyboard behavior remain unchanged | Kept as the distinct help action with a 44px target |
| Basemap, boundaries, layers | `#layerRail`, `#basemapSelect`, `#boundarySelect`, layer switches | Existing rail labels, switches and touch targets remain authoritative | Not duplicated in the header |
| Leaflet zoom and attribution | Leaflet-owned controls | Focusable controls and legal attribution remain visible | No markup or behavior changes |

## Acceptance matrix

| Check | Before | After acceptance |
| --- | --- | --- |
| Header composition | Separate floating identity and preference islands | One token-based surface with a clear identity / preference separator |
| Keyboard order | Brand, appearance, language, tour | Same interactive order; focus ring remains visible |
| Small screens | Two header rows with a compact help button | Same controls, no horizontal page overflow, no duplicate map controls |
| Appearance and language | Existing Light/Dark/System and EN/ES implementation | Untouched controllers and IDs |
| Evidence / map behavior | Existing Leaflet, rail, clusters, attribution and Lens interactions | Untouched; browser checks exercise controls alongside capture |

## Verification and rollback

The `browser-tests/header-ux-h1.browser.mjs` capture test records before and
after reference images at the eight requested viewports in GitHub Actions. The
workflow uploads them as the `ux-h1-map-header-screenshots` artifact, avoiding
large binary files in the repository. Rollback is one commit: revert the
UX-H1 commit; no data, map-state, translation or dependency migration is
involved.
