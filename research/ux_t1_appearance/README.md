# UX-T1 Appearance implementation — visual proof

These captures are generated from the real local implementation by `capture.mjs`.
They use Chromium/Playwright and proxy the validated deployment's generated
`runtime_poi.json`, `deployment_manifest.json`, `pedestrian_activity.json`, and
runtime basemap configuration in memory. The manifest records the URL, byte size
and SHA-256 of every proxied asset without storing the runtime configuration or
other generated artifacts. Committed static evidence assets are served from the
implementation branch, and basemap tiles are live and not version-pinned.

The harness accepts the deployed data only when the deployment manifest is a
validation pass, its operational-record total matches the runtime POI artifact,
all runtime POI layers are available, and the pedestrian artifact is available.
If that verification fails, captures are explicitly labelled
`repository-fallback` with the limitation in the manifest; they are never
presented as production-realistic evidence.

Before each screenshot the harness waits for the 1,470-record deployment badge,
administrative and planning hydration, mode-specific content, a loaded tile,
fonts, and a stable application-state signature. These are browser-emulated
captures, not real iPad/Safari hardware testing.

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
