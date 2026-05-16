---
role: dev
owner: Gerald
status: active
last-updated: 2026-05-16
---

# Development

## Scope
Implements the four shared library files and the five iteration modules. Owns code-level correctness of each `mount(rootEl)` against the gesture spec for its era.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-16 | Vanilla ES modules only. No bundler, transpiler, npm install, or framework. No physics engines, even small ones. | CATAPULT.md §Constraints. The constraint is the point — the originals were written without these, so the homage is too. Alternative: allow a single-file bundler for tree-shaking — rejected, "no build step" is load-bearing in the spec. | [[arch]], [[pm]] |
| 2026-05-16 | Canvas 2D only. No WebGL, no WebGPU. | CATAPULT.md §Constraints. Pixel-honest rendering matches the museum-wall aesthetic. Alternative: WebGL for iteration 05 toppling perf — rejected, would defeat the "hand-rolled" constraint. | [[arch]], [[ux]] |
| 2026-05-16 | Each `mount(rootEl)` returns a cleanup function that removes listeners and clears the canvas. | Required for the idempotency clause in the deliverable checklist. Pattern: `mount` calls `attachCanvas`, `holdTension`/`dragVector`, `requestAnimationFrame`; cleanup cancels the rAF and detaches. | [[arch]], [[qa]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons
<!-- Distilled principles from Dead Ends. Written to be read cold. -->

## Open Questions
- [x] ~~What's the right approach for iteration 05's stable block stack~~ — **[resolved 2026-05-16: PBD with Verlet + 6 constraints per block (4 edges + 2 diagonals) + 6 relaxation iterations × 4 substeps + sleep-on-low-energy. Shipped in 05-crush.js.]**
- [x] ~~Iteration 02 Web Speech taunts~~ — **[resolved 2026-05-16: cut Web Speech; ship silent text taunts in a side log. Audio is too brittle on Safari/iOS for default-off-by-construction confidence.]**

## Assumptions
- [assumption] ~~Each iteration module fits in ~200 lines of JavaScript~~ — **[invalidated 2026-05-16 by Gerald (cap lifted) and by build (358/665/488/684/613 lines).]** — status: invalidated — since: 2026-05-16
- [assumption] Iteration 04's AI converging-aim heuristic is sufficient — status: untested (pending playtest) — since: 2026-05-16
- [assumption] Iteration 05's PBD stack stability holds under high-energy impacts without visible deformation — status: untested (smoke test passed in Node; needs real playtest). Known: single-frame kite-shape flicker possible at MAX_DRAG. — since: 2026-05-16

## Dependencies
Blocked by: [[arch]] (lib API must be locked before iteration code starts)
Feeds into: [[qa]] (each iteration must be winnable, losable, idempotent)

## Session Log
- 2026-05-16 SHIPPED — all 5 iterations + 4 lib files written by parallel agents. Total iteration code ~2808 lines; lib total ~80 lines (excl. README). 9/9 node --check pass. Idempotent-mount pattern held across all 5 (02 and 05 added defensive `rootEl.__cleanup` stash for double-mount safety).
- 2026-05-16 INIT — hard constraints (vanilla ESM, canvas 2D, no physics engines) recorded; idempotent-mount pattern decided; open questions on iteration 05 physics approach and iteration 02 audio scope seeded.
