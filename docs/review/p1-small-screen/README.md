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
