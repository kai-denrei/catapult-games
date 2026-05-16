---
project: CATAPULT
created: 2026-05-16
status: active
mode: solo
stale_threshold_days: 30
---

# CATAPULT — Index

## Brief
A single-page static site walking visitors through five eras of the catapult / artillery video game (1976 → 2009). Each era gets a brief marginalia note plus a playable miniature that preserves the era's defining input gesture. Hard constraints: vanilla ES modules, no build step, no frameworks, no physics engines, Canvas 2D only, must work via `file://`. Page weight under 200 KB, Lighthouse a11y ≥ 95. Belongs to the PWA catalog, same constraints apply.

## Active Roles
- [[arch]] — owner: Gerald
- [[dev]] — owner: Gerald
- [[pm]] — owner: Gerald
- [[ux]] — owner: Gerald
- [[qa]] — owner: Gerald
- [[devops]] — owner: Gerald

## Key Decisions
- v1 = green deliverable checklist from `CATAPULT.md` §Deliverable checklist. See [[pm]].
- Implementation phases: foundation (sequential) → iterations (parallel) → QA (sequential). See [[pm]] and `../IMPLEMENTATION_PLAN.md`.
- Agent dispatch executed: 7 Claude subagents (1 arch, 1 ux, 5 dev, 1 qa) shipped v1 in three phases on 2026-05-16. pm + devops stayed human. See [[pm]].
- v1 status (2026-05-16): all files in place, 131,782 bytes total (under original 200KB target), 9/9 JS syntax-clean, zero dead-ends violations. Outstanding: human playtest for winnable/losable + runtime console hygiene.

## Open Questions (cross-role)
- ~~`file://` modules in Chrome~~ — resolved: Chrome blocks; use Firefox or `python3 -m http.server`. Documented project-wide.
- ~~Lighthouse a11y ≥ 95~~ — resolved: target replaced by Gerald with "readable retro-gaming aesthetic"; Lighthouse number is informational only.
- ~~Iteration 05 rigid body in <200 lines~~ — resolved: cap lifted; shipped at 613 lines with PBD + sleep-on-low-energy.
