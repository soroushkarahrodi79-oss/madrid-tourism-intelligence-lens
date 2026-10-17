# Post-K13 P0/P1 design assets

Static annotated wireframes for the UX-D1 design gate (issue #93). They belong to
[`docs/POST_K13_P0_P1_DESIGN_PROTOTYPE.md`](../../POST_K13_P0_P1_DESIGN_PROTOTYPE.md) and are not
readable on their own — the specification carries the reasoning, the evidence and the acceptance
criteria.

**These are sketches. Nothing here is implemented, rendered in the product, measured on a device
or tried by a person.** Every file states this in its own footer.

| File | Breakpoint | Increment | Shows |
|---|---|---|---|
| [`01-p0-current-desktop-default.svg`](01-p0-current-desktop-default.svg) | desktop 1440 × 900 | baseline | The shipped PLACE cold start, and the three mechanical causes (C1 containing-only renderer, C2 answer behind a closed disclosure, C3 narrower question) of the planning-ámbito discovery failure. Carries the model-derived correction to the audit's geographic premise, with its evidentiary scope marked. |
| [`02-p0-concept-a-desktop.svg`](02-p0-concept-a-desktop.svg) | desktop 1440 × 900 | **P0-a (GO)** + **P0-b1 (conditional)** | The membership answer promoted into the planning section (P0-a), shown together with the "All planning ámbitos" lattice (P0-b1). These are **separately gated** in the specification — the sketch shows both at once. |
| [`03-p0-concept-b-phone.svg`](03-p0-concept-b-phone.svg) | phone 375 × 812 | **P0-b2 (HOLD)** | The ámbito finder, in three states: entry point, the bounded `<dialog>`, and the view after a user-initiated locate with its way back. **On HOLD** — built only if P0-a fails O3 or the human study shows users cannot reach a named ámbito. Numeric distances have been removed from this sketch (see §6.3). |
| [`04-p1-rail-tablet.svg`](04-p1-rail-tablet.svg) | tablet 834 × 1112 | **P1 (GO)** | Today's 1,912 px stack beside the proposed six collapsed groups and one expanded group, with the height budget, the group composition and the `n of m on` badge rule. |
| [`05-p1-phone-reading-order.svg`](05-p1-phone-reading-order.svg) | phone 375 × 812 | **P1 (GO)** | Today's fourth-place Lens figures beside the proposed compact circle summary, with the six rules the summary must obey and the root cause of the 30 px quick-jump chip. |
| [`06-keyboard-focus-path.svg`](06-keyboard-focus-path.svg) | — | P1 | The current tab order through up to 196 focusable Leaflet markers, the proposed two skip links, and an explicit statement of what is and is not claimed about accessibility. |
| [`07-state-inventory.svg`](07-state-inventory.svg) | — | all | The seven planning-ámbito states, what the map draws and what the panel says in each, with source authority and the implications that must never be drawn. States 5 and 6 arise only if P0-b1 ships. |

Colours follow the product's own tokens from `css/app.css`, including `--planning-neutral`
(`#aeb8c4`), which is reserved there for planning geometry, and `--licence-neutral` (`#c0794f`)
for the K9 administrative register.

## Reading the numbers in these sketches

- Figures drawn inside panels (for example `41 / 63 / 24`) are **layout placeholders, not evidence
  readings**.
- Numbers derived from a committed artifact or the shipped model — the 724-ámbito universe, the 9
  touched ámbitos, the 91/229/235 viewport-rectangle counts — are author-reported model execution.
  The artifact identity and the reproduction command are in §1 and §2.4 of the specification.
- The **51 m** figure is a nearest-***vertex*** distance and therefore an **upper bound** on the
  distance to the ámbito boundary. It is an argument inside the document and never reaches the
  interface.
- A vertex inside a theoretical viewport rectangle is **not** a rendered, unoccluded or
  discoverable polygon. Real-browser verification at all three widths is AC-P0-13.
- No numeric distance or "nearest" ordering appears in any proposed interface unless a verified
  point-to-segment algorithm and its fixtures exist (§6.3, AC-P0-15).
