# `/lib` — shared primitives

Four tiny ES modules. Each iteration imports what it needs and nothing else.

## Rules of engagement (read first)

- **Do not modify any file in `/lib/`.** These are frozen contracts for Phase 2.
- If you find a gap or bug, work around it inside your iteration and file an issue against the arch agent. Patching `/lib/` in a per-iteration PR breaks the contract every other iteration is coded against.
- All exports are pure ES modules, no default exports. Import by name.
- All paths are relative; iterations live one directory up from `/lib/`, so `../lib/canvas.js`.

---

## `canvas.js` — `attachCanvas(rootEl, opts)`

Creates a `<canvas>` inside `rootEl`, scales it for `devicePixelRatio`, returns the canvas + context. The 2D context is pre-scaled, so you draw in CSS pixels.

```js
import { attachCanvas } from '../lib/canvas.js';

export function mount(rootEl) {
  const { canvas, ctx, dpr } = attachCanvas(rootEl, { width: 640, height: 400 });
  ctx.fillStyle = '#d4a256';
  ctx.fillRect(10, 10, 100, 20);   // 100×20 CSS px, sharp on retina.

  return () => { canvas.remove(); };
}
```

Notes:
- `canvas.width / canvas.height` are in device pixels; `canvas.style.width / height` are in CSS pixels. Use `getBoundingClientRect()` for input math, not the raw `canvas.width`.
- `tabindex="0"` is set so the canvas can receive keyboard events when focused.

---

## `ballistics.js` — `step(state, dt, env)`

Single Euler-ish step. Returns a NEW state — do not mutate the input. `y` grows downward (canvas convention).

```js
import { step } from '../lib/ballistics.js';

let s = { x: 50, y: 350, vx: 220, vy: -380 };  // launch up-and-right
const env = { gravity: 600, wind: -40, drag: 0 };
const trail = [s];

for (let i = 0; i < 240; i++) {
  s = step(s, 1 / 60, env);
  trail.push(s);
  if (s.y > 400) break;          // hit ground
}
// Plot trail[].x, trail[].y as dots (iteration 01) or animate (iteration 04).
```

Notes:
- Use the same `dt` you advance your animation loop with. `1 / 60` for a 60 Hz loop is fine; `performance.now()` deltas are better.
- For iteration 01 ("plot full arc instantaneously"), iterate this in a tight loop without `requestAnimationFrame`.
- `drag = 0` for pure ballistic; set `0.05`–`0.2` for visibly air-braked shots.

---

## `input.js` — two gestures

### `holdTension(target, handlers)`

Pointer-down begins; `onUpdate(elapsedMs)` fires on each animation frame while held; `onRelease(totalMs)` fires on pointer-up. Space-bar mirrors the gesture for keyboard play. Returns a cleanup function.

```js
import { holdTension } from '../lib/input.js';

const cleanup = holdTension(canvas, {
  onStart:   ()    => { armAngle = 0; },
  onUpdate:  (ms)  => { armAngle = Math.min(Math.PI / 2, ms / 1000); /* redraw */ },
  onRelease: (ms)  => {
    const power = Math.min(1, ms / 1500);   // 1.5s = full pull
    fire(power);
  },
});

// later, on unmount:
cleanup();
```

### `dragVector(target, handlers)`

Pointer-down captures origin; `onUpdate({dx, dy})` fires on pointer-move; `onRelease({dx, dy})` fires on pointer-up. Arrow keys nudge the vector; Space starts a keyboard session; Enter releases. Returns a cleanup function.

```js
import { dragVector } from '../lib/input.js';

const cleanup = dragVector(canvas, {
  onStart:   ({x, y}) => { slingX = x; slingY = y; },
  onUpdate:  ({dx, dy}) => { previewTrajectory(-dx, -dy); },
  onRelease: ({dx, dy}) => { launch(-dx * 2, -dy * 2); },  // inverse of drag
});
```

Notes:
- Both functions throw if `target` is falsy. Always pass the canvas (after `attachCanvas`) or another focusable element.
- The cleanup function MUST be called from your iteration's unmount path. Idempotency depends on it.

---

## `rng.js` — `mulberry32(seed)`

Returns a function returning `[0, 1)`. Same seed → same sequence.

```js
import { mulberry32 } from '../lib/rng.js';

const rand = mulberry32(1976);
const wind = Math.floor(rand() * 21) - 10;     // -10 .. +10
const heights = Array.from({ length: 32 }, () => 0.3 + rand() * 0.4);
```

Notes:
- Each iteration picks its own seed (year of release is a nice convention: 1976, 1982, 1986, 1991, 2009).
- A "Re-roll" button is just `seed = (seed + 1) | 0` and a re-mount.

---

## Idempotency reminder

Every `mount(rootEl)` MUST be safe to call twice. The standard pattern:

```js
export function mount(rootEl) {
  rootEl.innerHTML = '';                       // wipe previous mount
  const { canvas } = attachCanvas(rootEl, {...});
  const cleanupInput = holdTension(canvas, {...});
  let raf = 0;
  const loop = () => { /* ... */; raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    cleanupInput();
    rootEl.innerHTML = '';
  };
}
```

If you skip the `rootEl.innerHTML = ''` at the top, a second mount will append a second canvas next to the first. The deliverable checklist forbids this.
