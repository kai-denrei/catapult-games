---
role: ux
owner: Gerald
status: active
last-updated: 2026-05-16
---

# UX / Design

## Scope
Page composition, typography, color tokens, marginalia framing, lineage SVG, and the museum-wall feel. Owns everything visible that is not inside an iteration's canvas.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-16 | Color tokens fixed per CATAPULT.md §Aesthetic: `--bg #0d0e10`, `--bg-elev #15171a`, `--fg #e6e1d4`, `--fg-muted #8a8275`, `--rule #2a2c30`, `--amber #d4a256`, `--teal #5fb5b0`, `--blood #8a3a32`. Defined as CSS custom properties in `/styles/base.css`. | Dark editorial palette serves the museum-wall framing. Alternative: light mode toggle — rejected, not in spec, adds complexity. | [[arch]], [[dev]] |
| 2026-05-16 | Typography: serif body (EB Garamond / Crimson Pro / `Iowan Old Style, Charter, Georgia, serif` fallback), monospace metadata (JetBrains Mono / IBM Plex Mono / `ui-monospace, Menlo, Consolas, monospace` fallback). All caps reserved for section labels and the page title only. | Per CATAPULT.md §Aesthetic. System fallbacks chosen to keep zero-font load viable. Alternative: only system fonts, no `@font-face` — defer until weight measured. | [[dev]], [[devops]] |
| 2026-05-16 | Single vertical scroll, no SPA routing, no modal overlays, no per-iteration nav. Optional thin sticky right-side gutter listing the five years. | CATAPULT.md §Page architecture. Scrolling is the navigation. Alternative: anchored top nav — rejected unless the gutter proves insufficient. | [[arch]] |
| 2026-05-16 | Canvas frame: thin 1px amber border with slight inset shadow, "framed plate in a book" not "UI panel". Same treatment across all five iterations. | Uniform framing reinforces the lineage-as-wall metaphor and prevents per-iteration art drift. | [[dev]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons
<!-- Distilled principles from Dead Ends. Written to be read cold. -->

## Open Questions
- [ ] Lineage SVG style: the spec says "hand-drawn feel, monochrome plus single accent" at ~700×140. Need to choose between a literal hand-stroke aesthetic and a clean geometric version that merely *suggests* hand-drawn. Both can fail badly. — owner: Gerald — since: 2026-05-16
- [ ] Self-host fonts or system-fallback only? `@font-face` from `/fonts/` adds 100–200 KB easily and threatens the page-weight budget. — owner: Gerald — since: 2026-05-16

## Assumptions
- [assumption] Marginalia in 2–4 sentences per iteration reads as "museum wall label" rather than "blog post" — status: untested — since: 2026-05-16
- [assumption] A11y contrast ratios pass with the dark palette (foreground `#e6e1d4` on background `#0d0e10` should be ~14:1, well above AAA) — status: validated — since: 2026-05-16

## Dependencies
Blocked by: [[arch]] (page shell + canvas frame styling decisions need to land first)
Feeds into: [[dev]] (iteration canvases inherit the frame), [[qa]] (a11y and contrast pass)

## Session Log
- 2026-05-16 INIT — color tokens, typography stack, single-scroll architecture, uniform canvas frame recorded; lineage SVG style and font self-hosting flagged as open questions.
