# CATAPULT — Implementation Plan (v1)

> Working plan generated 2026-05-16 from `CATAPULT.md`.
> Decision log lives in `.deban/`. This file is the *plan*; `.deban/roles/pm.md` is the *record*.
> v1 = every box in `CATAPULT.md` §Deliverable checklist green. No additional success criteria.

---

## 1. Phasing

Three phases. Phase boundaries are gates: nothing in phase N+1 starts until phase N is signed off.

### Phase 1 — Foundation (sequential, ~1 day)

Builds the page shell and the contract surface that lets Phase 2 parallelize.

Deliverables:
- `index.html` with five empty `<section>` placeholders (one per iteration), header, lineage SVG slot, footer.
- `/styles/base.css` — color tokens, typography stack, layout grid, hairline rules.
- `/styles/iterations.css` — per-iteration scoping (`.iter-01 { … }`).
- `/lib/canvas.js` — `attachCanvas(rootEl,{width,height}) → {canvas,ctx,dpr}`.
- `/lib/ballistics.js` — `step(state, dt, env)`.
- `/lib/input.js` — `holdTension(target, handlers)`, `dragVector(target, handlers)`.
- `/lib/rng.js` — `mulberry32(seed)`.
- `/lib/README.md` — one-page lib usage examples (the contract document Phase 2 reads first).
- Lineage SVG (~700×140) drawn or sketched; can be refined during Phase 3.

Exit criteria:
- Open `index.html` via `file://` and via `python3 -m http.server` — both load without console errors and render the five (empty) sections.
- `lib/*.js` files each under 100 lines.
- `lib/README.md` shows at least one call site for every exported function.

### Phase 2 — Iterations (parallel, ~2 days wallclock)

Five iteration modules, one per agent, all coding against the frozen `lib/*` contracts and the gesture spec from `CATAPULT.md` §The five iterations. No cross-iteration state.

Per-iteration exit criteria (same five-point gate per `.deban/roles/qa.md`):
1. Winnable in a normal session.
2. Losable against the AI/opponent.
3. Defining gesture present and load-bearing.
4. `mount(rootEl)` is idempotent — second call doesn't duplicate canvas or leak listeners.
5. No console errors or warnings during normal play.

### Phase 3 — Polish & QA (sequential, ~0.5 day)

Wire-up verification, accessibility pass, marginalia copy, lineage SVG refinement, deliverable checklist sign-off.

Exit criteria: every box in `CATAPULT.md` §Deliverable checklist green.

---

## 2. Agent Dispatch Proposal

**8 Claude subagents** + Gerald as human pm/devops.

| # | Agent role | Phase | Deliverable | Sequencing |
|---|---|---|---|---|
| 1 | **arch** | 1 | `index.html` shell, `/lib/*.js` (4 files), `/lib/README.md` | First. Blocks all others. |
| 2 | **ux** | 1 | `/styles/base.css`, `/styles/iterations.css`, lineage SVG draft | Parallel with arch (no code conflict; arch owns `index.html` markup, ux owns CSS + SVG). |
| 3 | **dev/01** | 2 | `/iterations/01-artillery.js` — text-input ASCII ballistic duel | Parallel after Phase 1. |
| 4 | **dev/02** | 2 | `/iterations/02-smithereens.js` — real-time hold-and-release dueling | Parallel after Phase 1. |
| 5 | **dev/03** | 2 | `/iterations/03-defender.js` — fixed-angle pull-back siege | Parallel after Phase 1. |
| 6 | **dev/04** | 2 | `/iterations/04-scorched.js` — side-view turn-based with destructible terrain | Parallel after Phase 1. |
| 7 | **dev/05** | 2 | `/iterations/05-crush.js` — drag-slingshot rigid-body destruction | Parallel after Phase 1. **Highest risk** — see §4. |
| 8 | **qa** | 3 | Run the verification matrix; tick the deliverable checklist; file Dead Ends for any per-browser failures | Last. Blocks v1 sign-off. |

**Roles staying human (Gerald):**
- **pm** — keeps the "do not" list (`CATAPULT.md` §Dead ends) honored, signs off phase gates, kills scope creep.
- **devops** — runs `du -b` and Lighthouse locally; thin role for v1.

### Why 8 and not fewer or more

- **Why per-iteration agents (5, not 1 or 2):** the spec is explicit that each iteration has its own gesture, its own visual register, its own dead ends. There is no shared state across iterations. Five agents, five briefs from `CATAPULT.md` §The five iterations, parallel.
- **Why arch separate from dev:** the lib API has to be locked before the five dev agents can start. Coupling arch to one of the dev roles would create artificial sequencing.
- **Why ux separate from arch:** ux owns purely visual surfaces (CSS, SVG, typography, marginalia framing). Arch owns markup and module wiring. Both can run in parallel during Phase 1 without stepping on each other.
- **Why qa separate from dev:** independent verification is the point. A dev agent grading its own iteration is not QA.
- **Why pm and devops stay human:** pm decisions are taste calls (the "do not" list is judgment-heavy); devops is genuinely thin for a no-build static page.

### Alternatives considered

- **1 generalist agent (sequential):** rejected — sequential time is roughly 5× the parallel-iterations wallclock, with no upside.
- **4 agents (iterations grouped 1+2, 3+4, then 5):** rejected — the natural decomposition is per-iteration; grouping creates artificial ordering inside Phase 2 and hides which iteration broke when something fails.
- **More than 8 (e.g. split a11y from qa, split lineage SVG from ux):** rejected — neither sub-task carries enough work to justify its own agent.

### Coordination protocol

- The arch agent ships `lib/README.md` containing one call-site example per exported function. This is the contract document. Every dev agent's first action in Phase 2 is to read it.
- All five dev agents work against the same frozen lib API. If a defect is found, the affected dev agent files an issue against the arch agent rather than patching the lib in place.
- Each dev agent's PR is reviewed by Gerald (pm) before merge. The qa agent runs the verification matrix only after all five iterations are merged.

---

## 3. Per-Iteration Briefs (extract from CATAPULT.md)

Each dev agent is given the full `CATAPULT.md` plus a one-paragraph framing pulled from this section.

- **01 Artillery** — preserve *submit-and-see-result* as the entire interaction. ASCII rendered to canvas or `<pre>`. Two cannons, signed-integer wind, simple converging-aim AI. Plot full arc instantaneously after each shot. Do not animate the projectile in flight.
- **02 Smithereens!** — preserve *real-time symmetric dueling*. Both catapult arms cycle continuously; player holds Space to lock the arm at the current angle, releases to fire. Walls 3 hits, catapults 1 hit. Optional Web Speech taunts, muted by default. Do not make it turn-based.
- **03 Defender of the Crown** — preserve *analog pullback tension as power*. Pointer-down rotates the arm back at constant rate; release fires. Launch angle fixed by geometry — aim by power only. Six shots, three ammo types (boulder unlocks Greek fire and disease). Do not add a launch-angle slider.
- **04 Gorillas/Scorched Earth** — preserve *side-view turn-based duel with destructible terrain and wind compensation*. Procedural skyline, alternating turns, ballistic arc with wind-as-horizontal-acceleration, AI converges via last-shot feedback. Do not add weapon shops, multiple projectile types, or power-ups.
- **05 Crush the Castle / Angry Birds** — preserve *drag-back slingshot release*. Hand-rolled rigid body (PBD with distance constraints suggested). 3 projectiles per level, one level (max two). Do not import a physics engine. Do not let this be the best one.

---

## 4. Risk Register

Ranked by likelihood × blast radius. Each risk has a corresponding Open Question in `.deban/roles/pm.md`.

| # | Risk | Likelihood | Blast | Mitigation |
|---|---|---|---|---|
| R1 | **Iteration 05 physics blows the line budget.** Spec says <200 lines for hand-rolled PBD; realistic floor is 400–600 lines for plausible toppling. | High | Medium — page-weight budget tightens; per-iteration consistency suffers. | Time-box dev/05 to Phase 2's wallclock; if the physics isn't stable by then, reduce block stack to 5 blocks max and accept a relaxed line budget recorded as a Dead End. |
| R2 | **`file://` + ES modules fails in Chrome.** Chrome blocks `<script type="module">` from `file://` by default. Spec mandates both `file://` and HTTP. | High | High — would fail a deliverable checklist item directly. | Run the verification matrix early — at end of Phase 1, not Phase 3. If Chrome `file://` is broken, document the workaround (start a one-line server, or use Firefox) in marginalia or footer; do not hide the limitation. |
| R3 | **Lighthouse a11y < 95** because canvas content is opaque to screen readers. | Medium | Medium — would fail a deliverable checklist item. | Each iteration ships keyboard play and an `aria-label` describing the gesture and current state. Marginalia outside the canvas carries the bulk of accessible content. Re-run Lighthouse after every iteration merge, not only at the end. |
| R4 | **Page weight > 200 KB** when iterations 04 + 05 land. | Medium | Low — a budget miss is a checklist failure but easy to spot. | Track `du -b` at the end of each phase. If approaching budget, defer self-hosted fonts to system fallbacks. |
| R5 | **Iteration 03 and 04 each exceed 200 lines.** Defender's six-shots-three-ammo-with-gating logic and Scorched's AI+terrain+wind+turn-loop both push past the suggestive line budget in `CATAPULT.md` §End. | High | Low — the 200-line guide is a target, not a checklist item. | Treat 200 lines as a smell, not a wall. If exceeded, justify in a code comment and log the assumption invalidation in `.deban/roles/dev.md`. |

---

## 5. Schedule (rough)

Solo human review, parallel dev agents. Total wallclock estimate: **3–4 days**.

| Day | Activity |
|---|---|
| Day 1 | Phase 1: arch + ux agents. Sign off lib API + page shell. Run early `file://` verification (R2). |
| Day 2 | Phase 2 starts. Five dev agents dispatched. Gerald reviews PRs as they land. |
| Day 3 | Phase 2 finishes. dev/05 most likely tail. Gerald merges. |
| Day 4 | Phase 3: qa agent runs verification matrix and the deliverable checklist. Marginalia copy-edit. Lineage SVG refinement. Sign-off. |

This assumes nothing in the risk register fires hard. R1 or R2 firing adds a half-day each.

---

## 6. What This Plan Does Not Cover

- **Hosting / deployment.** The project belongs to the PWA catalog; hosting is a catalog-level concern. See `.deban/roles/devops.md` Open Question.
- **Service worker.** `CATAPULT.md` forbids SW telemetry but is silent on SW for offline. Treated as catalog-level, out of scope for this page in isolation.
- **Sound design.** Iteration 02's Web Speech taunts are optional in the spec and may be cut to silent text taunts. Decision deferred to dev/02.
- **Iteration 05 level pack.** Spec: "One level is enough. Two is generous. Resist the urge to build a level pack." Treated as a hard limit.
- **Cross-iteration scoring, achievements, share buttons, "next/previous" nav.** All explicitly forbidden in `CATAPULT.md` §Dead ends.

---

## 7. Sign-Off Gate

v1 ships when, and only when, the following are all true:

- [ ] All boxes in `CATAPULT.md` §Deliverable checklist green.
- [ ] No item from `CATAPULT.md` §Dead ends violated.
- [ ] qa agent has completed the verification matrix (file:// × HTTP × Chrome × Firefox × Safari).
- [ ] Page weight measured under 200 KB excluding fonts.
- [ ] Lighthouse a11y ≥ 95 measured on the served page.
- [ ] `.deban/` reflects current state (one final `/deban sync` before sign-off).
