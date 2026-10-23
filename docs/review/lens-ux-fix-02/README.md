# Lens UX Fix 02 — deployment metadata banner

This compares the unchanged ffbcf14 base (origin/main, including PR #128) with this branch. Screenshots were captured at the listed CSS viewport sizes with Playwright.

The checkout has no generated deployment-time runtime_poi.json; the application therefore uses its packaged curated fallback for these captures. The evidence drawer shows the resulting loaded map record total and explicitly identifies its layer scope. It is a local fallback count, not the production deployment total and not the count within a selected Lens circle.

## Target viewport comparison

| Viewport | Before | After |
| --- | --- | --- |
| Desktop · 1440 × 900 | ![Before at 1440 by 900](screenshots/before-1440x900.png) | ![After at 1440 by 900](screenshots/after-1440x900.png) |
| iPad landscape · 1180 × 820 | ![Before at 1180 by 820](screenshots/before-1180x820.png) | ![After at 1180 by 820](screenshots/after-1180x820.png) |
| Mobile · 390 × 844 | ![Before at 390 by 844](screenshots/before-390x844.png) | ![After at 390 by 844](screenshots/after-390x844.png) |

## Provenance access

The existing Evidence & limits drawer retains application version, geographic coverage, a dynamically generated count of loaded operational map records, and the explicit limitation that this is not the selected Lens-circle count. Source availability and curated-fallback completeness caveats remain in the layer panel.

![Evidence & limits with deployment metadata at 1440 by 900](screenshots/after-evidence-source-1440x900.png)
