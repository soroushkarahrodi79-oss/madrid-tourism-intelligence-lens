# P1 small-screen UX — browser-emulation review artifacts

These captures compare the `origin/main` baseline at `0132697` with the P1 implementation at the three approved viewport sizes.

| Viewport | Before | After |
|---|---|---|
| 1440 × 900 | [before](before/1440x900.png) | [after](after/1440x900.png) |
| 834 × 1112 | [before](before/834x1112.png) | [after](after/834x1112.png) |
| 375 × 812 | [before](before/375x812.png) | [after — collapsed rail](after/375x812.png) |
| 375 × 812 | — | [after — compact Lens-circle summary](after/375x812-circle-summary.png) |

The captures were produced with Playwright Chromium browser emulation. They are not real-device results, human usability evidence, assistive-technology results, or a WCAG conformance assessment.

The 375 × 812 summary capture scrolls only the existing analysis-panel container to the new compact band; it does not change the Lens, map camera, layer state, evidence state, or mode.
