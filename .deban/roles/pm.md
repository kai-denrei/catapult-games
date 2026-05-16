---
role: pm
owner: Gerald
status: active
last-updated: 2026-05-16
---

# Project Management

## Scope
Scope discipline, deliverable checklist tracking, agent dispatch and orchestration, and guarding against the "do not" list in CATAPULT.md §Dead ends. Owns the v1 definition of done.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-16 | v1 = the deliverable checklist in CATAPULT.md §Deliverable checklist, fully green. No additional success criteria. | The spec already lists the bar; expanding it is scope creep. Alternative: add "deployment to a public URL" as v1 — rejected, the project belongs to the static PWA catalog and deployment is a catalog-level concern, not v1. | [[qa]], [[devops]] |
| 2026-05-16 | Implementation organized in three phases: (1) foundation, sequential — page shell + lib APIs + lineage SVG; (2) iterations, parallel — five iteration modules; (3) polish & QA, sequential. Full plan in `../IMPLEMENTATION_PLAN.md`. | Phase 1 unlocks parallelism in Phase 2; Phase 3 verifies against the deliverable checklist. Alternative: flat dispatch of all 8 agents at once — rejected, the iteration agents need a frozen lib API to code against. | [[arch]], [[dev]], [[ux]], [[qa]] |
| 2026-05-16 | Agent dispatch proposal: 8 Claude subagents (1 arch, 1 ux, 5 dev — one per iteration, 1 qa). pm and devops remain human (Gerald). | Iterations are genuinely independent per the spec (no cross-iteration state, no shared scoring). Marginal cost of a subagent is low; coordination cost is paid up front in the lib API. Alternative A: single generalist agent — rejected, sequential time would be ~5× longer. Alternative B: 4 agents with iterations grouped — rejected, the natural decomposition is per-iteration; grouping creates artificial sequencing inside Phase 2. | [[arch]], [[dev]], [[ux]], [[qa]] |
| 2026-05-16 | The CATAPULT.md §Dead ends list is treated as a hard "do not" register. Any agent suggestion that violates it must be reverted with the violated rule cited. | These are anti-features that prior similar projects accreted; preserving them is half the value of the spec. | [[dev]], [[ux]] |
| 2026-05-16 | v1 dispatched and shipped via 8-agent fanout (arch + ux Phase 1, 5 dev Phase 2, qa Phase 3). Final page weight 131,782 bytes; all 9 JS files pass node --check; qa scan found zero §Dead-ends violations. Outstanding: human playtest of winnable/losable per iteration, runtime console check. | The agent decomposition held — iterations were truly independent and lib API didn't need post-hoc changes. Alternative (1 generalist sequential) would have been roughly 5× wallclock. | [[arch]], [[dev]], [[ux]], [[qa]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons
<!-- Distilled principles from Dead Ends. Written to be read cold. -->

## Open Questions
- [x] ~~Iteration 05's "hand-rolled rigid body physics fits in <200 lines"~~ — **[resolved 2026-05-16 by Gerald: cap lifted, 400-600 lines OK. Shipped at 613 lines.]**
- [x] ~~Page weight target of <200 KB excluding fonts~~ — **[resolved 2026-05-16 by Gerald: cap lifted, modern browsers handle it. Shipped at 131,782 bytes (~129 KB) — actually under the original cap.]**
- [x] ~~`file://` compatibility for `<script type="module">` is browser-dependent~~ — **[resolved 2026-05-16: Chrome's CORS-on-file rule cannot be authorized from inside the page. Workaround: Firefox for direct file://, or `python3 -m http.server` for Chrome/Safari. Documented in IMPLEMENTATION_PLAN.md §4 R2.]**
- [x] ~~Lighthouse a11y ≥ 95~~ — **[resolved 2026-05-16 by Gerald: replaced with "ensure a readable retro-gaming experience for the aesthetic". Lighthouse score is now informational, not a gate.]**
- [x] ~~"Each iteration is a 200-line module"~~ — **[resolved 2026-05-16 by Gerald: no cap. Iterations shipped at 358 / 665 / 488 / 684 / 613 lines.]**

## Assumptions
- [assumption] All five iterations are independent enough to be coded in parallel by separate agents without merge conflicts beyond the page shell — status: untested — since: 2026-05-16
- [assumption] Solo human review (Gerald) can keep up with five parallel dev agents without becoming the bottleneck — status: untested — since: 2026-05-16

## Dependencies
Blocked by: nothing
Feeds into: every other role — pm carries the deliverable checklist and the dispatch plan.

## Session Log
- 2026-05-16 V1-BUILT — three-phase dispatch executed; 7 agents (arch, ux, dev/01-05, qa) shipped without coordination defects; one dispatch typo (1976/1972) caught and fixed post-build; outstanding work = human playtest only.
- 2026-05-16 RESOLUTIONS — Gerald answered all five challenged assumptions: line caps lifted, page-weight cap lifted, file:// Chrome workaround set, a11y target replaced with retro-gaming readability, 200-line module cap removed. Authorized parallel agent dispatch.
- 2026-05-16 INIT — v1 definition pinned to deliverable checklist; three-phase plan + 8-agent dispatch recorded; five challenged assumptions about the brief seeded as Open Questions.
