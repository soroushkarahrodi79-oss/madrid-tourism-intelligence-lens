# Discover V3 — institutional experience and product credibility

Audit and implementation date: 22 October 2026. Baseline: `origin/main` at `bd8de3f` (merge of PR #122). Branch: `codex/discover-v3-institutional`.

## Preflight

- `origin/main`, the published Discover route, the published Lens map, open work and the latest Actions runs were checked before editing. There were no open pull requests; open issues were #102 (appearance) and #114 (optional first-run tutorial). The final Test and Pages runs for the baseline were green.
- PR #113 supplied Discover V2 and its authenticated product capture. PR #116 supplied the optional, replayable tutorial without analytical-state mutation. PRs #119–#122 supplied the responsive map shell, comparison access, per-mode panel continuity and compact provenance disclosure. None of those components is duplicated here.
- The shipped `/discover/`, root map and language-aware root route returned HTTP 200. The map visibly exposes PLACE, COMPARE and CITY; the first-visit invitation is optional and Help can replay it.
- Existing Discover tests, screenshots, `research/ux_t1_appearance/manifest.json`, and the recommendations in `docs/review/ux-p2/README.md` were reviewed.

## Prioritized audit

| Priority | Finding | Evidence / decision |
|---|---|---|
| P0 | The first-screen sentence “cómo se transforma Madrid” implied longitudinal evidence broader than the product guarantees. The headline was memorable but did not name the analytical map or the user task quickly enough. | Removed the temporal claim. The first viewport now states the product, three analytical actions and intended institutional contexts. |
| P1 | The real product screenshot was present but readers had to infer what PLACE, COMPARE and CITY prove. Its 1,004,186-byte PNG was also downloaded on initial load. | Kept a real, existing audited capture; replaced it with the later UX P2 JPEG and added a concise capability/boundary reading beside it. No result or statistic was invented. |
| P1 | Discover linked to the map, but language was lost and the optional tutorial relationship was not explained. | Every Discover → Lens link now carries `?lang=es` or `?lang=en`. The final CTA gives three optional first-analysis steps and accurately describes the replayable tutorial. |
| P1 | Automated scanning found inherited text contrast failures in 18–21 nodes depending on viewport. | Darkened only affected editorial text tokens. The dependency-free automated audit now passes at 320, 390, 768, 1024 and 1440 px. This is not a WCAG conformance claim. |
| P2 | Discover depended on CDN-hosted GSAP + ScrollTrigger for optional motion. | The dependency remains pinned with SRI, `crossorigin`, `no-referrer`, a 3.8 s timeout and a native fallback. Blocking it or enabling reduced motion leaves content and interaction intact. Self-hosting or removal remains a release-policy decision. |

## Three implemented improvements

1. **Institutional first impression.** Reframed the hero around a concrete analytical task, removed unsupported change language, named research/teaching/public-management/tourism use contexts, and clarified the primary and explanatory CTAs in ES/EN.
2. **Credible product demonstration.** Reused the repository's audited UX P2 COMPARE capture, added a PLACE/COMPARE/CITY reading key and a visible demonstration boundary, linked capture conditions, improved contrast, and reduced the image payload without introducing a runtime library or external asset.
3. **Direct transition into Lens.** Localized all application links, set an explicit PLACE → location/radius → Evidence & limits starting path, and connected it to the existing optional tutorial without triggering it or changing map/analytical state.

No scientific model, source, dataset, calculation, planning scope, comparison contract, provenance ceiling, share/export URL contract or root-application file changed.

## Visual evidence

All images below are Playwright Chromium emulation on the local static tree, not physical-device captures.

| Surface | Before | After |
|---|---|---|
| Desktop hero, 1440×900 | [before](before/01-desktop-hero-1440.png) | [after](after/01-desktop-hero-1440.png) |
| Product proof, 1440×900 | [before](before/02-desktop-product-1440.png) | [after](after/02-desktop-product-1440.png) |
| Storytelling, 1440×900 | [before](before/03-desktop-story-1440.png) | [after](after/03-desktop-story-1440.png) |
| Final CTA, 1440×900 | [before](before/04-desktop-cta-1440.png) | [after](after/04-desktop-cta-1440.png) |
| Mobile hero, 390×844 | [before](before/05-mobile-hero-390.png) | [after](after/05-mobile-hero-390.png) |
| Mobile storytelling, 390×844 | [before](before/06-mobile-story-390.png) | [after](after/06-mobile-story-390.png) |
| Mobile CTA, 390×844 | [before](before/07-mobile-cta-390.png) | [after](after/07-mobile-cta-390.png) |

The reproducible capture runner is `scripts/discover-v3-capture.mjs`; raw measurements are stored in each evidence directory.

## Measurements

Local HTTP, Chromium 153, reduced motion, external requests blocked, one run per viewport:

| Metric | Before | After |
|---|---:|---:|
| Initial product-image encoded bytes | 1,004,186 | 374,896 |
| Image reduction | — | 629,290 bytes / 62.7% |
| CLS, 320/390/768/1024/1440 | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |
| Local FCP range | 176–404 ms | 180–252 ms |
| Local LCP range | 176–404 ms | 180–252 ms |
| Horizontal overflow | none | none |

These local timing samples are directional diagnostics, not field Core Web Vitals. The published route has no RUM and this work adds no tracking. Published Discover HTML was 55,690 bytes at the baseline. The optional GSAP files measured 72,214 and 43,380 bytes uncompressed over the network (115,594 bytes combined); their runtime cost is avoided for reduced motion and their absence is covered by tests.

## Verification

- Focused Discover Node/Chromium: **9 passed, 0 failed**. Includes project-subpath routing, Discover → Lens integration, ES/EN link localization, 320/390/768/1024/1440 responsive checks, keyboard A/B controls and tabs, reduced motion, optional-CDN blocking, product-image loading and no horizontal overflow.
- Dependency-free accessibility regression: accessible names, duplicate IDs, image alternatives and computed contrast at all five target widths: **passed**. Manual keyboard focus review in Chromium: **passed**.
- Full Node: **1,030 passed, 0 failed**.
- Python: **501 executed, OK; 8 skipped**.
- Full Playwright Chromium: **264 passed, 1 failed**. The only failure is the unchanged root application's appearance-switch performance budget under 4× CPU throttle (277.3 ms average). The exact test also fails on a clean `origin/main` checkout (250.5 ms average); no root application file changed in this PR.
- Published baseline routes: Discover and root Lens HTTP 200; real UI opened and inspected.
- `git diff --check`: clean.
- GitHub Actions: pending on the Draft PR head.

## Limits and remaining risks

- Chromium viewport/touch emulation is not a physical phone/tablet test. Safari/iOS, Firefox, real touch hardware, 200% zoom/reflow, a screen reader and institutional-user comprehension remain manual release checks.
- The automated accessibility audit is bounded and cannot establish WCAG conformance.
- LCP/CLS values are local laboratory samples. Published Core Web Vitals need field or controlled production-route measurement.
- GSAP/ScrollTrigger still rely on cdnjs despite fail-closed behavior and SRI. A hosting/privacy policy decision is still required.
- The product capture documents a real audited interface state; it is not live UI, not a current-data assertion and not scientific evidence supplied by the landing.
- CTA analytics were not added. Comprehension and conversion should be validated with academic/institutional users without introducing tracking by default.

## Verdict

**GO for Draft institutional review. HOLD for merge or release sign-off** until GitHub Actions are green and the manual physical-device, zoom/reflow, screen-reader and representative-user checks above are completed.
