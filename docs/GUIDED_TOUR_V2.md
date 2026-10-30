# Guided Tour V2 — M1 → M2 → M3

## Purpose and baseline

Guided Tour V2 updates the optional product tour after unified geographic search
(M1), registered urban-evidence questions (M2) and single-question evidence
dossiers (M3). Implementation started from `origin/main` at
`0e8b3a77112cb64376019c29aa4d00f284412b85`.

The tour remains a visual guide over the existing application. It does not move
the map or a Lens, change a radius, mode, layer, planning selection or licence
window, execute an Evidence Registry query, open the evidence drawer, create a
dossier, download a file or modify the canonical URL.

The opt-in `institutional-journey.js` Yeserías case study is separate and was not
changed.

## Audit of the previous six-step tour

The previous guide predated the current workflow:

- it had no M1 step and described choosing a location and moving the Lens as one
  activity, although selecting a search result, **View on map** and **Analyze with
  Lens** are three distinct actions;
- it did not explain the six registered M2 questions, deterministic K13 resolver
  or justified abstentions;
- it did not mention the contextual M3 dossier action or its HTML/JSON outputs;
- its final evidence step did not distinguish the K11 five-file workspace export
  and state URL from the M3 two-file frozen-question record;
- it omitted district and municipality from the geographic-scope explanation;
- it advertised a two-minute duration without measured usage evidence;
- its 360 px fixed card had no viewport-height limit or internal overflow, and the
  highlight ring used an unclipped target rectangle.

## The eight steps

1. **Understand the Lens.** The map is the target. Copy distinguishes generated
   Lens circles from official barrios, districts, planning ámbitos and the Madrid
   municipality.
2. **Find an official place — M1.** `#geoSearchToggle` is targeted. The guide
   distinguishes selection, camera-only **View on map** and explicit
   **Analyze with Lens**.
3. **Lens controls.** The visible `#radiusSlider` is preferred; the visible PLACE
   control is the fallback. An explicit **Show Lens controls** action may scroll
   the existing controls into view but changes no value.
4. **Layers and source types.** Desktop targets `#layerRail`; phone layouts target
   `#mobileLayersButton`. Copy preserves the distinction between administrative
   licences and completed construction and between missing, unavailable, withheld,
   OFF and published zero.
5. **Place, Compare and City.** The existing mode navigation is highlighted
   without switching mode. Copy states the compatibility condition for COMPARE
   and municipality scope of CITY.
6. **Urban evidence questions — M2.** A visible M2 title is preferred. When the
   finder is closed or M2 is not yet mounted, the real M1 finder trigger is the
   fallback. The optional **Show questions** action opens only the finder and
   scrolls its existing section; it never asks a question.
7. **Evidence dossier — M3.** A visible `.qx-action-dossier` is preferred. Without
   a completed supported answer, the visible question section or finder trigger is
   used honestly; no fake control or answer is created.
8. **Verify and reproduce — K11/K13.** The visible mode's Evidence & limits route
   is preferred, with the existing freshness entry as fallback. The copy states
   that K11 exports five workspace files and a versioned state URL, while M3
   exports HTML and JSON for one frozen question. A K11 URL restores neither the
   question nor its saved answer and is not a guarantee against future evidence
   changes.

The completion screen follows step 8 and is not counted as a ninth instruction.

## Preference compatibility

The storage key remains `madrid-lens-tutorial-v1` and the stored version remains
`1`. Existing `1:completed` and `1:dismissed` values suppress the first-visit
invitation exactly as before. A returning reader can always run the current
eight-step guide with `#tutorialHelpButton`.

Shared K11 links and `haloRegressionTest=1` harness pages continue to suppress the
invitation without suppressing manual replay.

## Responsive and accessibility behavior

- The guide is capped to the dynamic viewport height and becomes internally
  scrollable on short screens.
- Guide and highlight rectangles are clipped to the visible viewport and to
  scrolling/overflow ancestors.
- Placement and highlight update after resize or scroll without scrolling a
  target automatically.
- Buttons retain 44 px minimum targets and explicit focus-visible styling.
- Progress is a polite, atomic status and reports the real eight-step count.
- Escape, Skip, Close and completion return focus to the opener.
- Reduced motion and forced-colours rules are explicit.

Browser validation uses emulated viewports and engines. It is not physical-device
or screen-reader validation.

## Scientific and state regression

The browser suite freezes and compares, before and after the complete tour:

- mode;
- active Lens centre and both Lens radii;
- canonical Lens A/B URL coordinates;
- basemap and enabled layers;
- selected planning ámbito inputs;
- applied licence date window;
- canonical URL;
- Evidence Registry object and a registered provenance result;
- a previously completed M2 outcome;
- dossier module requests and Blob creation calls.

The before and after states are byte-for-byte equivalent in the test projection,
and M3 remains unrequested.

## Review evidence

Matched browser captures are committed under `docs/review/guided-tour-v2/`:

- `before/`: the previous Lens, phone-place and final Evidence & limits steps;
- `after/desktop-m1.png`: explicit M1 search action;
- `after/phone-m2.png`: M2 explanation with the honest finder action;
- `after/tablet-m3.png`: contextual M3 explanation without a fabricated answer;
- `after/desktop-k11-k13.png`: K11/M3 reproduction distinction.

## Initial-page payload

Measured byte-for-byte against the verified baseline with gzip level 9:

| File | Raw delta | Gzip delta |
|---|---:|---:|
| `index.html` | +14 B | +7 B |
| `css/app.css` | +869 B | +119 B |
| `js/tutorial.js` | +6,372 B | +2,035 B |
| **Total initial page** | **+7,255 B** | **+2,161 B** |

No framework, onboarding library, analytics service, backend, map dependency or
new runtime data source was added.

## Verification

Final local verification on the feature worktree:

- Node test suite: 1,203 passed, 0 failed;
- Python test suite: 501 passed, 8 expected skips, 0 failed;
- Guided Tour Chromium: 5 passed, 1 capture-only skip, 0 failed;
- Guided Tour WebKit: 5 passed, 1 capture-only skip, 0 failed;
- browser-shard inventory: 29 files assigned exactly once, 0 duplicates;
- `git diff --check`: clean.

The browser suites cover first visit, legacy preferences, shared links, manual
replay, completion, Back, Escape, Skip, language changes, resizing, short screens,
all specified viewports, Light/Dark, reduced motion, forced colours (Chromium),
finder loading and honest unavailable M2/M3 targets. Chromium and WebKit both
verify that the tour preserves an active reading and never invokes M3.

## Known limitations

- The tour describes the contextual M3 action when no answer exists; it does not
  manufacture the state required to display the button.
- The safe **Show questions** action can change only the open/scroll state of the
  finder. Closing that finder remains the reader's action.
- The guide does not open Evidence & limits because that would alter dialog and
  focus state; it highlights an available entry instead.
- Physical-device and screen-reader validation remain outstanding.
