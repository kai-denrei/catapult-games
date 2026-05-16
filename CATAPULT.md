# CATAPULT.md

> A static homage to the catapult game lineage. Five playable era-pieces on one page.
> Each iteration recreates the *mechanic*, not the art — small, honest, no pastiche.

---

## Role

You are building a single-page static site that walks the visitor through the evolution of the catapult/artillery video game, 1972 → 2009. Each era gets a short marginalia note and a playable miniature. The page is a museum wall, not an arcade. The widgets are minimal but complete: each must be winnable, losable, and capture the *defining input gesture* of its era.

This belongs to the PWA catalog. Same constraints apply.

---

## Constraints (hard)

- **Vanilla ES modules.** No build step, no bundler, no transpiler. Files served as-is.
- **No frameworks.** No React, Vue, Svelte, Alpine, htmx. No jQuery.
- **No physics engines.** No Box2D, Matter.js, p2, Planck, Rapier. Hand-rolled integrators only.
- **No external runtime dependencies.** Fonts via `@font-face` from `/fonts/` or system stack. No CDN scripts.
- **Single entry:** `index.html`. Everything else loaded via `<script type="module">`.
- **Works opened via `file://`** as well as static HTTP. Use relative paths.
- **Canvas 2D only.** No WebGL, no WebGPU. Pixel-honest.
- **Desktop-primary.** Mobile must not break, but pointer-precise input is the target.
- **No tracking, no analytics, no service worker telemetry.**

---

## File structure

```
/index.html
/styles/
  base.css            # tokens, typography, layout grid
  iterations.css      # per-iteration scoping
/lib/
  ballistics.js       # shared: gravity, wind, drag, trajectory sampling
  canvas.js           # shared: DPI, resize, clear helpers
  input.js            # shared: pointer drag, hold-tension, keyboard
  rng.js              # seeded PRNG so layouts are reproducible
/iterations/
  01-artillery.js     # text-input ballistic duel
  02-smithereens.js   # front-facing dual catapults, real-time
  03-defender.js      # front-view pull-back siege
  04-scorched.js      # side-view destructible-terrain duel
  05-crush.js         # drag-slingshot rigid-body destruction
/fonts/               # if self-hosted
```

Each `/iterations/NN-name.js` exports a single `mount(rootEl)` function. The rootEl is a `<section>` already in the DOM. The module is responsible for everything inside: canvas creation, controls, scoring text. No globals, no cross-iteration state.

---

## Page architecture

Single vertical scroll. Anchored navigation only if it adds value — likely a thin sticky right-side gutter listing the five years.

Structure:

1. **Header.** Title (`CATAPULT`), dates (`1972 — 2009`), three-sentence manifesto: this is a lineage, not a list; each entry preserves an input gesture; built in vanilla because the originals were too.
2. **Lineage diagram.** One SVG, ~700×140, showing the five iterations as nodes with arrows where direct inspiration is documented (Smithereens! → Defender via shared front-view siege framing; Crush the Castle → Angry Birds, etc.). Hand-drawn feel, monochrome plus single accent.
3. **Five iteration sections.** Each:
   - Year + title (large serif)
   - Original platform, designer, one-line provenance (small monospace)
   - 2–4 sentence marginalia in a left or right column
   - The playable widget (canvas ~640×400, centered)
   - Below: the *gesture being preserved*, named explicitly (e.g. "Analog pullback tension as power").
4. **Footer.** Sources, dead-ends acknowledgment, link to next stop in the catalog.

No SPA routing. No modal overlays. No "share" buttons.

---

## The five iterations

Each spec below states: what input gesture must be preserved, what the visual must communicate, and the minimum mechanic. Anything beyond the minimum is optional and should be justified.

### 01 — Artillery (1976, Mike Forman, *Creative Computing*)

**Gesture preserved:** numeric input of angle and power as the entire interaction.

**Visual:** ASCII rendered to canvas (monospace, drawn glyph-by-glyph) or to a `<pre>` styled to match the page. Two cannons as `<` and `>`, terrain as `_` and `^`, trajectories as `.` plotted at sampled timesteps. Hits leave `*`.

**Mechanic:**
- Two cannons, fixed positions, separated by a randomly generated 1D heightmap.
- Player enters angle (0–90) and power (0–100) into two text inputs, presses Enter or "FIRE".
- Wind is a signed integer shown at the top.
- Computer opponent uses a simple converging-aim heuristic, not perfect aim — must be beatable, must be capable of beating an inattentive player.
- First direct hit wins. Print result as plain text below the canvas.

**Do not** animate the projectile in flight. The era's gesture is *submit and see result*. Plot the full arc instantaneously after each shot.

---

### 02 — Smithereens! (1982, Ed Averett, Magnavox Odyssey²)

**Gesture preserved:** real-time symmetric dueling. No turns.

**Visual:** front-view-ish but flattened — two squat catapults facing each other across a horizontal gap, each behind a low brick wall, castles silhouetted behind them. Chunky 8×8 pixel blocks, four-color palette (background, stone, wood, accent).

**Mechanic:**
- Both catapults continuously cycle their arms through a fixed arc.
- Player holds a key (Space) to *hold the arm at the current angle*; release to fire at that angle.
- Computer opponent fires on its own rhythm.
- Rocks arc across, hit walls or catapults. Walls take 3 hits, catapults take 1.
- Optional: Web Speech API taunts after each shot, muted by default, single toggle button. If audio is too brittle on any platform, silent text taunts in a side log are acceptable.

**Do not** make it turn-based. Smithereens! is the only real-time entry in the lineage and that's the whole point.

---

### 03 — Defender of the Crown (1986, Cinemaware, Amiga)

**Gesture preserved:** analog pull-back tension. Hold to wind, release to fire. The body of the shot is in the duration of the press.

**Visual:** front-view, over the catapult's shoulder onto a distant castle wall. The catapult arm is in the lower foreground, the wall is the middle band, sky above. No background landscape complexity — the wall is the subject.

**Mechanic:**
- Six shots per siege.
- Three ammunition types: **boulder**, **Greek fire**, **disease**. Disease and Greek fire are disabled until at least one breach has been made by a boulder.
- Wall is a horizontal row of ~12 brick segments stacked 3 high. Boulders remove bricks. A breach = vertical gap from top to bottom in at least one column.
- Pull-back: pointer-down begins the arm rotating back at constant angular rate; pointer-up releases. Pullback angle maps linearly to launch velocity. Launch angle is fixed by the catapult's geometry; the player aims by *power* only, exactly as the original. (Defender's manual is explicit: aim high first, then lower.)
- Greek fire reduces a "garrison" counter shown as a numeric badge. Disease reduces it more if used early in the siege (track shot index).
- Win condition: garrison reduced to zero OR wall fully demolished within six shots.

**Do not** add a launch-angle slider. The fixed-angle, power-only input is the defining constraint and the whole reason the front-view perspective works.

---

### 04 — Gorillas / Scorched Earth (1991, lineage entry)

**Gesture preserved:** side-view turn-based duel with destructible terrain and wind compensation.

**Visual:** side-on. Two combatants on a procedurally generated skyline of rectangular buildings (Gorillas-style) or rolling hills (Scorched-style) — pick one, lean Gorillas for simplicity. Wind arrow at top.

**Mechanic:**
- Two players (or one player + AI), alternating turns.
- Each turn: enter angle (0–180) and power, fire. Projectile follows ballistic arc with wind as horizontal acceleration.
- Direct hit on opponent wins. Hits on terrain leave craters (subtract a circle from the heightmap).
- AI uses last-shot feedback to converge — over/short → adjust power; left/right → adjust angle.

**Do not** add weapon shops, multiple projectile types, or power-ups. That belongs to the Tank Wars/Scorched Earth elaboration and dilutes the era's pure ballistic gesture.

---

### 05 — Crush the Castle / Angry Birds (2009)

**Gesture preserved:** drag-back slingshot/trebuchet release. The aim vector is dragged out, the projectile launches along the inverse.

**Visual:** side-view. Sling on the left, a stack of rectangular blocks on the right with one or more targets (pigs, defenders — abstract, geometric). Trajectory preview as a row of small dots, fading.

**Mechanic:**
- Hand-rolled rigid body physics for the block stack. Position-based dynamics (Verlet integration with distance constraints) is sufficient and fits in <200 lines.
- Blocks have mass; collisions resolve via impulse along contact normals. Don't aim for realism; aim for *plausible toppling*.
- 3 projectiles per level. Eliminate all targets to win.
- One level is enough. Two is generous. Resist the urge to build a level pack.

**Do not** import a physics engine. Yes, even a small one. The constraint matters more than the polish.

---

## Aesthetic

Dark editorial. Museum-wall, not arcade.

**Color tokens** (define in `/styles/base.css` as CSS custom properties):

```
--bg:        #0d0e10   /* near-black, slight cool tint */
--bg-elev:   #15171a   /* canvas frames, card backgrounds */
--fg:        #e6e1d4   /* warm off-white body text */
--fg-muted:  #8a8275   /* marginalia, metadata */
--rule:      #2a2c30   /* hairline dividers */
--amber:     #d4a256   /* primary accent: years, key terms */
--teal:      #5fb5b0   /* secondary accent: links, interactive affordances */
--blood:     #8a3a32   /* hits, destruction state */
```

**Typography:**
- Body: a transitional or old-style serif. EB Garamond, Crimson Pro, or `Iowan Old Style, Charter, Georgia, serif` as a system fallback. ~17px, generous line-height (1.6).
- Headers: same family, heavier weight, tighter tracking. No display fonts.
- Metadata, year stamps, source attributions, in-game numerals: monospace. JetBrains Mono, IBM Plex Mono, or `ui-monospace, Menlo, Consolas, monospace`.
- All caps reserved for section labels and the page title only.

**Layout:**
- Max content width ~720px for prose, but iteration canvases can break out wider.
- Generous vertical rhythm. Sections separated by hairline rules and ~6rem padding.
- Marginalia as `<aside>` floated or in a side column, smaller, muted.

**Canvas styling:** thin amber 1px frame, slight inset shadow. Each iteration's canvas should feel like a framed plate in a book, not a UI panel.

---

## Shared library expectations

- `lib/ballistics.js` exports `step(state, dt, env)` returning new state. `env` = `{ gravity, wind, drag }`. Used by 01, 04. Iterations 02, 03 use simpler closed-form arcs.
- `lib/canvas.js` exports `attachCanvas(rootEl, { width, height })` returning `{ canvas, ctx, dpr }`, handling devicePixelRatio scaling once.
- `lib/input.js` exports `holdTension(target, { onStart, onUpdate, onRelease })` for the Defender pullback gesture, and `dragVector(target, { onStart, onUpdate, onRelease })` for Crush. Both return cleanup functions.
- `lib/rng.js` exports a seeded PRNG (mulberry32 is fine). Each iteration uses its own seed so layouts are stable across reloads but can be re-rolled with a button.

Keep these libraries under 100 lines each. If one grows past that, you are over-engineering.

---

## Dead ends

Things prior attempts in this lineage (or in similar homage projects) have done that you should not:

- **Don't write level editors.** The page is a wall, not a sandbox.
- **Don't add scoring across iterations.** No meta-score, no badges, no completion percentage. Each widget is self-contained.
- **Don't auto-play any iteration on scroll.** Each starts on a single click of an explicit "Begin" affordance.
- **Don't add sound on by default.** Mute toggle, off-state on first visit.
- **Don't pastiche the original art.** No fake CRT scanlines on the 1976 entry, no fake Amiga dithering on the 1986 entry. Honor each era through the *mechanic* and the typography. The art is uniformly minimal across the page.
- **Don't try to be funny.** Pigs, gorillas, and Cinemaware's medieval melodrama are present in the source material — quote them in the marginalia, don't re-perform them.
- **Don't add a "next" / "previous" navigation between iterations.** Scrolling is the navigation.
- **Don't make iteration 05 the best one.** It will be tempting because the physics is the most fun to write. Resist. The page is a lineage, and the 1976 entry deserves equal typographic and conceptual weight.
- **Don't lazy-load iteration modules.** All five fit in a few KB. Single page load, everything available.

---

## Deliverable checklist

Before declaring done:

- [ ] `index.html` opens directly via `file://` and renders all five iterations playable
- [ ] No `npm install` step exists or is needed
- [ ] No imports from any URL beginning with `https://`
- [ ] Each iteration's `mount(rootEl)` is idempotent — calling it twice does not duplicate canvases or leak listeners
- [ ] All five iterations are winnable and losable
- [ ] Each iteration's defining gesture is preserved as specified above
- [ ] Marginalia for each iteration cites at minimum: year, original platform, designer or studio
- [ ] Page renders cleanly with JavaScript disabled down to the marginalia and lineage diagram (graceful degradation; widgets show "requires JavaScript" placeholder)
- [ ] No console errors or warnings on load or during play
- [ ] Total page weight under 200 KB excluding optional self-hosted fonts
- [ ] Lighthouse accessibility score ≥ 95 (contrast, focus order, keyboard play where possible)

---

## Provenance notes (for the marginalia copy)

Cite sparingly, in the metadata strip under each title:

- **01:** *Artillery*, Mike Forman, BASIC, *Creative Computing* 1976. Direct ancestor: War 3 / Artillery 3, FOCAL, c.1972.
- **02:** *Smithereens!*, Ed Averett, Magnavox Odyssey², 1982. The only real-time entry. Note its front-view-castle framing as the visual precedent for Defender.
- **03:** *Defender of the Crown*, Kellyn Beeck, Cinemaware, Amiga 1986; ported MS-DOS / Atari ST / Mac / C64 1987. The Cinemaware "interactive movie" frame.
- **04:** *Gorillas* (QBasic, IBM, 1991) and *Scorched Earth* (Wendell Hicken, 1991). The modern archetype of the side-view duel; basis for Worms et al.
- **05:** *Crush the Castle*, Joey Betz / Armor Games, Flash, April 2009. *Angry Birds*, Rovio, December 2009 — Rovio cited Crush the Castle directly. The rotation of Defender's pullback through 90° onto a side-view stage.

---

## End

When in doubt, less. Each widget is a 200-line module, not a 2000-line module. The page is a sentence about a fifty-year lineage; do not turn it into a paragraph.
