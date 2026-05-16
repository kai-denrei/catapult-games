---
role: devops
owner: Gerald
status: active
last-updated: 2026-05-16
---

# DevOps

## Scope
Local serving, Lighthouse runs, page-weight measurement, and (deferred to catalog level) any hosting concern. Intentionally thin: the project has no build step, no CI requirement, no dependency surface.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-16 | No CI pipeline for v1. Local verification only. | No build step means no artifact to test in CI; manual playtest is the integration test. Alternative: GitHub Actions with Playwright + Lighthouse — rejected for v1, revisit if the project moves into the PWA catalog with multiple sibling sites. | [[qa]], [[pm]] |
| 2026-05-16 | Local serve via `python3 -m http.server` from project root for HTTP-mode testing. No bundler dev server. | Zero install, matches the "no build" constraint, sufficient for verifying the HTTP transport leg of the verification matrix. | [[qa]] |
| 2026-05-16 | Page weight tracked with `du -b -- index.html styles/ lib/ iterations/` (excluding `fonts/`). Single command run at end of each phase. | Cheap, repeatable, tied directly to the <200 KB checklist item. | [[qa]], [[pm]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons
<!-- Distilled principles from Dead Ends. Written to be read cold. -->

## Open Questions
- [ ] Hosting target for v1 — is the project deployed anywhere, or only opened locally via `file://`? Spec is silent; the catalog framing implies eventual hosting but doesn't pin a target. — owner: Gerald — since: 2026-05-16
- [ ] If hosted, does the catalog use a service worker for offline? CATAPULT.md says "no service worker telemetry" but doesn't forbid SW outright. PWA framing suggests SW is in scope at catalog level, out of scope for this page in isolation. — owner: Gerald — since: 2026-05-16

## Assumptions
- [assumption] devops role can be left thin without harming v1 — status: untested — since: 2026-05-16

## Dependencies
Blocked by: nothing
Feeds into: [[qa]] (provides the HTTP serving environment for verification)

## Session Log
- 2026-05-16 INIT — no-CI-for-v1, local serve via python http.server, weight measurement via `du` recorded; hosting target and SW scope flagged as catalog-level open questions.
