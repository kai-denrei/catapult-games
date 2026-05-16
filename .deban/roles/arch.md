---
role: arch
owner: Gerald
status: active
last-updated: 2026-05-16
---

# Architecture

## Scope
Module boundaries, shared library API contracts, file layout, page composition, and the `mount(rootEl)` discipline that keeps iterations self-contained. Owns the contract surfaces that all five iteration agents will code against.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-16 | File layout per CATAPULT.md §File structure (`/index.html`, `/styles/*`, `/lib/*`, `/iterations/NN-name.js`). | Single entry point keeps `file://` viable; flat folders avoid build-tool reach. Alternative: per-iteration folder with own CSS — rejected, would invite cross-iteration drift. | [[dev]] |
| 2026-05-16 | Each iteration exports a single `mount(rootEl)` that owns canvas creation, controls, and scoring. Idempotent: calling twice must not duplicate canvases or leak listeners. | Forces per-iteration encapsulation; matches CATAPULT.md §File structure and §Deliverable checklist. Alternative: a registry that the page invokes — rejected, adds shared state for no gain. | [[dev]], [[qa]] |
| 2026-05-16 | Shared lib API surface fixed up front: `ballistics.step(state, dt, env)`, `canvas.attachCanvas(rootEl,{width,height}) → {canvas,ctx,dpr}`, `input.holdTension(target,handlers)`, `input.dragVector(target,handlers)`, `rng.mulberry32(seed)`. | Locks the integration boundary so the five iteration agents can work in parallel without coordinating through code. Alternative: let each iteration roll its own helpers — rejected, would balloon page weight and create five subtly different implementations of the same thing. | [[dev]] |
| 2026-05-16 | Lib files capped at 100 lines each. | CATAPULT.md §Shared library expectations: "If one grows past that, you are over-engineering." Treated as a hard ceiling, not a target. | [[dev]], [[pm]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons
<!-- Distilled principles from Dead Ends. Written to be read cold. -->

## Open Questions
- [ ] Will Chrome serve `<script type="module">` from `file://` without a local HTTP server? Historically Chrome blocks `file://` module imports; Firefox is more permissive. — owner: Gerald — since: 2026-05-16
- [ ] Does the lib API need a sixth file (`audio.js`) for iteration 02's optional Web Speech taunts, or is inline scope sufficient? — owner: Gerald — since: 2026-05-16

## Assumptions
- [assumption] All five iterations can be coded in parallel against a frozen lib API without subsequent contract changes — status: untested — since: 2026-05-16
- [assumption] Canvas DPR handling can be solved once in `lib/canvas.js` and never revisited — status: untested — since: 2026-05-16

## Dependencies
Blocked by: nothing
Feeds into: [[dev]] (cannot start iteration code until lib API is locked), [[ux]] (page shell needs canvas frame styling decided)

## Session Log
- 2026-05-16 INIT — file layout, `mount(rootEl)` contract, lib API surface, 100-line lib cap recorded as decisions; two open questions and two assumptions seeded.
