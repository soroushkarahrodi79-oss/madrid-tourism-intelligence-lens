# UX-T1 Appearance implementation — visual proof

These captures are generated from the real local implementation by `capture.mjs`.
They use Chromium/Playwright, the repository's deterministic fallback data, the
deployed runtime basemap configuration proxied in memory (never stored), and live
basemap tiles (which are not version-pinned). They are browser emulation, not
real iPad/Safari hardware testing.

## What visibly changes

- Page, header, rail, analysis panel, cards and drawer move between near-black
  translucent surfaces and clean near-white surfaces.
- Text, metadata, controls, tables, focus rings, Leaflet chrome and scrollbars
  resolve to appearance-appropriate contrast.
- The selected Appearance value stays visible in every capture, including
  `System` after a live emulated OS change.

## What intentionally does not change

- Basemap choice, map camera, evidence values, geometry and computations.
- Lens A solid / Lens B dashed semantics, category assignments, HATI, planning
  meanings, `LENS_BASEMAP_STYLES`, providers, markers and SVG halo values.
