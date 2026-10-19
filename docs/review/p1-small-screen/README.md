# P1 small-screen UX — browser-emulation review artifacts

These captures compare the `origin/main` baseline at `0132697` with the P1 implementation at the three approved viewport sizes.

| Viewport | Before | After |
|---|---|---|
| 1440 × 900 | [before](before/1440x900.png) | [after](after/1440x900.png) |
| 834 × 1112 | [before](before/834x1112.png) | [after](after/834x1112.png) |
| 375 × 812 | [before](before/375x812.png) | [after — collapsed rail](after/375x812.png) |
| 375 × 812 | — | [original P1 capture — compact Lens-circle summary (pre-correction)](after/375x812-circle-summary.png) |

The captures were produced with Playwright Chromium browser emulation. They are not real-device results, human usability evidence, assistive-technology results, or a WCAG conformance assessment.

The 375 × 812 summary capture scrolls only the existing analysis-panel container to the new compact band; it does not change the Lens, map camera, layer state, evidence state, or mode.

## Follow-up correction on PR #100

The images above are an archived **original P1 implementation** comparison from commit
`b4deede`, not fresh captures of the corrected branch. In particular the original
375×812 summary image shows four cramped columns; the correction uses two columns
at widths ≤420 px and improves evidence-state text contrast. The other original
captures remain a useful before/after baseline but must not be passed off as
post-correction render evidence.

**Visual review gate remains open:** refresh the 375×812 and 420 px captures from
the corrected commit (and check 834×1112), then perform a real iPhone Safari
review before considering mobile UX validated. Passing GitHub browser emulation
is not proof of real-device usability, human comprehension, or WCAG conformance.

## Phone map-first refinement (20 October 2026)

The owner selected **map-first on phones (≤560 px)** after reviewing the real
375 px Chromium emulation locally. The persistent six-group rail is now hidden
on initial phone load behind a 44 px **Layers / Capas** button, and can be
opened unchanged on demand. The keyboard skip-link must open it before focus.
Outside taps and Escape close it without moving the Lens or clearing toggles.
The compact PLACE quick-jump now leads to the new canonical four-reading band
instead of bypassing it for the deeper original metrics. Tablets/desktop keep
the existing always-visible rail. On touch pointers the attribution's external
source links no longer inherit the application's 44 px sizing (fixes the
overgrown Leaflet/OpenStreetMap credit block); all source credits stay present.

**Intentional acceptance tradeoff:** AC-P1-1's original requirement that all
six group headings be visible immediately on a 375×812 phone is superseded by
the owner-authorized map-first entry. The six headings must remain visible
when the Layers control is opened, and the always-visible map must gain
unobstructed area. No claim of satisfying the original unmodified AC-P1-1
is made. The P1 browser test is adapted to test this explicit opt-in path.

The old PNGs above still describe earlier commits. Fresh browser screenshots,
physical Safari, human usability and assistive-technology validation remain
separate sign-off gates. No source, HATI, data builder, scope, score, algorithm,
geometry, Lens camera behaviour or public-production gate is changed.

**Outside-map dismissal safety:** the first click on the map while the mobile
rail is open is consumed after closing that rail, so it cannot also select a
different Lens centre. A second deliberate map click retains normal behavior.
This is an interaction guard, not a change to the map renderer or camera API.
