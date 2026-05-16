---
role: qa
owner: Gerald
status: active
last-updated: 2026-05-16
---

# QA

## Scope
Verification against the CATAPULT.md §Deliverable checklist. Per-iteration playtest (winnable, losable, gesture preserved), accessibility, performance budget, console hygiene, and `file://` compatibility check.

## Decisions
| Date | Decision | Rationale | Linked roles |
|---|---|---|---|
| 2026-05-16 | Definition of done = every box in CATAPULT.md §Deliverable checklist green. Nothing more, nothing less. | Aligned with [[pm]] §v1 decision. Avoids both gold-plating and shortcuts. | [[pm]] |
| 2026-05-16 | Each iteration must be playtested for: (a) winnable in a normal session, (b) losable against the AI/opponent, (c) defining gesture present and load-bearing, (d) `mount(rootEl)` is idempotent (call twice, no duplicates, no listener leaks), (e) no console errors or warnings during normal play. | Five-point gate maps directly to checklist items. The idempotency check is the easiest to skip and the most likely to bite. | [[dev]] |
| 2026-05-16 | Verification matrix: open `index.html` via (a) `file://` direct, (b) `python3 -m http.server`, in (c) Chrome current, (d) Firefox current, (e) Safari current. Document any per-browser failures as Dead Ends. | The spec mandates both `file://` and static HTTP; Chrome's `file://` module behavior is the known risk. | [[arch]], [[devops]] |

## Dead Ends
<!-- APPEND ONLY. Never delete. -->
| Date | What was tried | Why it failed / was rejected |
|---|---|---|

## Lessons
<!-- Distilled principles from Dead Ends. Written to be read cold. -->

## Open Questions
- [ ] How to test idempotency of `mount(rootEl)` without a test runner? Likely an in-page debug toggle that calls mount twice and visually inspects, plus a manual listener-count check via DevTools. — owner: Gerald — since: 2026-05-16
- [ ] Lighthouse run target environment: against `file://`? Against `localhost`? Numbers can differ. — owner: Gerald — since: 2026-05-16

## Assumptions
- [assumption] Page weight budget (<200 KB excluding fonts) is measurable with `du -b` on the served files plus DevTools network panel — status: untested — since: 2026-05-16
- [assumption] Manual playtest is sufficient — no automated test framework needed since there's no build step to integrate it with — status: untested — since: 2026-05-16

## Dependencies
Blocked by: [[dev]] (iterations must exist to be tested), [[ux]] (page shell needed for end-to-end)
Feeds into: [[pm]] (sign-off on v1)

## Session Log
- 2026-05-16 INIT — five-point per-iteration gate, browser × transport verification matrix, definition-of-done = checklist recorded; open questions on idempotency tooling and Lighthouse environment seeded.
- 2026-05-16 PASS — full QA sweep on Phase 3 deliverables. Static: 9/9 JS files pass `node --check`, lineage.svg passes `xmllint`, all 5 iterations export `mount`, no CDN URLs, no `https://` imports, no `package.json`, all iteration imports go to `../lib/*` only. Page weight 131,782 bytes (~129 KB), well under 200 KB cap. Wiring: all 5 `widget-0N` mount targets present, all 5 modules imported and called from `index.html` `<script type="module">`, both stylesheets linked, `<object data="lineage.svg">` present, header reads `1972 — 2009`, all 5 sections include `<noscript>` fallbacks and aria-labels. Boot: `python3 -m http.server 8765` serves index/svg/modules with HTTP 200 and `Content-Type: text/javascript` on the .js files. Dead-ends scan: no editors, no audio/`speechSynthesis`/`new Audio` (02 uses silent text taunts as spec permits), no next/prev nav, no cross-iteration scoring, no auto-play/IntersectionObserver, no physics engine imported in 05 (PBD hand-rolled). Idempotency: 01/03/04 wipe `rootEl.innerHTML` at mount top and return a cleanup; 02 and 05 additionally stash a cleanup on `rootEl.__*Cleanup` and re-run it on remount — strongest of the five. Lib files: ballistics 28L, canvas 24L, rng 16L all under the 100-line guide; `input.js` is 136L (gentle smell, not a checklist failure). Lineage SVG `<title>` says `1976 to 2009` while page header is `1972 — 2009` — minor inconsistency (1972 refers to the cited FOCAL ancestor in 01's metadata strip; the SVG starts at the first node, 1976). UNVERIFIABLE without a manual playtest: per-iteration winnable/losable, no runtime console errors, Lighthouse a11y number. file:// behavior in Chrome (modules blocked) flagged for documentation; no Firefox installed on this machine, so the standard fallback verification path is Safari + Chrome only.
