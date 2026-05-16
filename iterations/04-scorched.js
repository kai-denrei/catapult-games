// 04-scorched.js — Iteration 04 (Gorillas / Scorched Earth, 1991).
//
// Gesture preserved: side-view turn-based duel with destructible terrain
// and wind compensation. Player 1 is human, Player 2 is AI; turns alternate.
//
// Visual:  Gorillas-style skyline of rectangular buildings, side-on.
//          A wind arrow + numeric readout above the controls.
// Physics: lib/ballistics.js step(), animated via requestAnimationFrame.
//          Gravity pulls down; wind is constant horizontal acceleration.
// Terrain: a per-pixel-column heightmap (groundY[x]). Impacts subtract a
//          circle from it (chord-height per column within the radius).
// AI:      converges on the player using two error channels — along-flight
//          distance maps to a power adjustment, vertical-at-target maps to
//          an angle adjustment. First shot is a sensible opener; later shots
//          add jitter so the AI never instantly locks on.

import { attachCanvas } from '../lib/canvas.js';
import { step } from '../lib/ballistics.js';
import { mulberry32 } from '../lib/rng.js';

// --- world geometry (CSS px) ---
const W = 640;
const H = 400;

// physics scale: 1 unit = 1 CSS pixel, 1 unit time = 1 second.
// Tuning note: with W=640 and gorillas at ~13%/87% of width, the inter-gorilla
// distance is ~474 px. Vacuum range at 45° is v^2 / g, so for max power 100
// to comfortably overshoot 474 px we need v_max^2 / g >= ~600, i.e. v_max ~440.
// POWER_SCALE 4.6 -> v_max = 460 px/s -> max range at 45° ~ 661 px (40% headroom).
const GRAVITY = 320;          // px/s^2 downward
const POWER_SCALE = 4.6;      // power 0..100 -> launch speed in px/s
const WIND_SCALE = 6;         // wind index (-10..+10) -> px/s^2 horizontal
const DT = 1 / 60;            // physics step (seconds); independent of frame rate
const MAX_FLIGHT = 12;        // seconds — hard cap so a stratospheric shot ends

// projectile + gorilla geometry
const BALL_R = 4;             // banana radius (px)
const GORILLA_W = 22;
const GORILLA_H = 26;

// skyline generation
const MIN_BUILDINGS = 8;
const MAX_BUILDINGS = 11;
const MIN_BLDG_H = 70;
const MAX_BLDG_H = 230;

// palette (matches /styles/base.css tokens)
const COL_BG       = '#15171a';
const COL_SKY_TOP  = '#0d0e10';
const COL_BLDG_A   = '#2a2c30';
const COL_BLDG_B   = '#23262a';
const COL_WINDOW   = '#d4a256';
const COL_WINDOW_DARK = '#3a3530';
const COL_FG       = '#e6e1d4';
const COL_MUTED    = '#8a8275';
const COL_AMBER    = '#d4a256';
const COL_TEAL     = '#5fb5b0';
const COL_BLOOD    = '#8a3a32';

export function mount(rootEl) {
  // Idempotency: wipe whatever is in the slot (the <noscript> fallback or
  // a previous mount of this module).
  rootEl.innerHTML = '';

  // --- DOM ---
  const status = el('p', 'widget-status');
  status.setAttribute('aria-live', 'polite');

  const { canvas, ctx } = attachCanvas(rootEl, { width: W, height: H });

  const controls = el('div', 'iter-controls');

  // ANGLE row: -5 -1 [input] +1 +5
  const angleRow = el('div', 'ctrl-row');
  const angleLabel = el('label', 'ctrl-label', 'ANGLE');
  const angleInput = el('input', 'ctrl-value-input');
  angleInput.type = 'number';
  angleInput.min = '0';
  angleInput.max = '180';
  angleInput.step = '1';
  angleInput.value = '50';
  angleInput.id = uniqueId('scorched-angle');
  angleLabel.htmlFor = angleInput.id;
  const angleMinus5 = stepBtn('−5', -5);
  const angleMinus1 = stepBtn('−1', -1);
  const anglePlus1  = stepBtn('+1', 1);
  const anglePlus5  = stepBtn('+5', 5);
  angleRow.append(angleLabel, angleMinus5, angleMinus1, angleInput, anglePlus1, anglePlus5);

  // POWER row: -5 -1 [input] +1 +5
  const powerRow = el('div', 'ctrl-row');
  const powerLabel = el('label', 'ctrl-label', 'POWER');
  const powerInput = el('input', 'ctrl-value-input');
  powerInput.type = 'number';
  powerInput.min = '0';
  powerInput.max = '100';
  powerInput.step = '1';
  powerInput.value = '70';
  powerInput.id = uniqueId('scorched-power');
  powerLabel.htmlFor = powerInput.id;
  const powerMinus5 = stepBtn('−5', -5);
  const powerMinus1 = stepBtn('−1', -1);
  const powerPlus1  = stepBtn('+1', 1);
  const powerPlus5  = stepBtn('+5', 5);
  powerRow.append(powerLabel, powerMinus5, powerMinus1, powerInput, powerPlus1, powerPlus5);

  const fireBtn = el('button', 'ctrl-fire', 'FIRE');
  fireBtn.type = 'button';

  const rerollBtn = el('button', null, 'Re-roll');
  rerollBtn.type = 'button';

  controls.append(angleRow, powerRow, fireBtn, rerollBtn);

  const result = el('p', 'widget-status');
  result.setAttribute('aria-live', 'polite');

  rootEl.append(status, canvas, controls, result);

  // Collect step buttons for cleanup wiring.
  const angleSteps = [angleMinus5, angleMinus1, anglePlus1, anglePlus5];
  const powerSteps = [powerMinus5, powerMinus1, powerPlus1, powerPlus5];

  function stepBtn(label, delta) {
    const b = el('button', 'ctrl-step', label);
    b.type = 'button';
    b.dataset.step = (delta > 0 ? '+' : '') + String(delta);
    return b;
  }

  // Nudge an input's value by delta, clamping to its min/max, and fire 'input'
  // so any existing/future listeners (and setControlsLocked logic) see the
  // change the same as keyboard typing.
  function nudge(input, delta) {
    if (input.disabled) return;
    const min = Number(input.min);
    const max = Number(input.max);
    const cur = Number(input.value);
    const base = Number.isFinite(cur) ? cur : (Number.isFinite(min) ? min : 0);
    const next = clamp(base + delta, min, max);
    if (next !== cur) {
      input.value = String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // --- game state ---
  let seed = 1991;
  let rng;
  let wind = 0;               // signed integer, -10..+10
  let groundY;                // Float32Array length W — y of ground per column (smaller = taller)
  let p1, p2;                 // { x, y, alive } — y is foot (resting on ground)
  let turn;                   // 0 = player, 1 = ai
  let inFlight = false;       // a projectile is currently animating
  let gameOver = false;
  let raf = 0;
  let lastShotTrail = [];     // current shot's trail, drawn each frame
  // AI memory (only used when it's the AI's turn to fire)
  // Note: AI angles are direction-RELATIVE (see launch() comment) — 0..90 forward,
  // 90..180 backward. So 50° = "high arc toward target" from the AI's frame,
  // which after the direction=-1 flip becomes a leftward shot in world space.
  let aiLastAngle = 50;
  let aiLastPower = 55;
  let aiLastTargetMissX = null;  // signed: + = landed past the player (overshoot along firing axis)
  let aiLastTargetMissY = null;  // signed: + = landed below the player's head (too low / steep)

  function newRound() {
    rng = mulberry32(seed);
    wind = Math.floor(rng() * 21) - 10;   // -10..+10
    groundY = buildSkyline(rng);
    // Place combatants on top of an outer-ish building so they get clear sky above them.
    const p1Col = Math.floor(W * 0.13);
    const p2Col = Math.floor(W * 0.87);
    p1 = { x: snapToFlatRoof(p1Col), y: 0, alive: true };
    p2 = { x: snapToFlatRoof(p2Col), y: 0, alive: true };
    p1.y = groundY[p1.x];
    p2.y = groundY[p2.x];
    turn = 0;
    inFlight = false;
    gameOver = false;
    lastShotTrail = [];
    aiLastAngle = 50;
    aiLastPower = 75;
    aiLastTargetMissX = null;
    aiLastTargetMissY = null;
    fireBtn.textContent = 'FIRE';
    angleInput.disabled = false;
    powerInput.disabled = false;
    status.textContent =
      `WIND ${formatWind(wind)}   SEED ${seed}   ` +
      `Player 1 (you, amber, left) vs Player 2 (AI, teal, right). ` +
      `Enter angle 0–180 (0=right, 90=up, 180=left) and power 0–100, then FIRE.`;
    result.textContent = '';
    draw();
  }

  // Find a column near targetCol that sits on the flat top of a building
  // (so the gorilla doesn't stand on a vertical wall pixel).
  function snapToFlatRoof(targetCol) {
    const halfW = Math.ceil(GORILLA_W / 2);
    let best = targetCol;
    let bestSpan = -1;
    for (let off = 0; off <= 60; off++) {
      for (const dir of [-1, +1]) {
        const c = targetCol + dir * off;
        if (c - halfW < 2 || c + halfW > W - 3) continue;
        const top = groundY[c];
        let flat = true;
        for (let dx = -halfW; dx <= halfW; dx++) {
          if (Math.abs(groundY[c + dx] - top) > 0.5) { flat = false; break; }
        }
        if (flat && off > bestSpan) {
          bestSpan = off;
          best = c;
          if (off === 0) return c;     // direct hit, stop scanning
        }
      }
      if (bestSpan >= 0) return best;
    }
    return best;
  }

  // Build a Gorillas-style skyline as a per-pixel ground heightmap.
  function buildSkyline(rand) {
    const g = new Float32Array(W);
    // We'll pack N buildings across W. Each building has a width and a top y.
    const nBuildings = MIN_BUILDINGS + Math.floor(rand() * (MAX_BUILDINGS - MIN_BUILDINGS + 1));
    const baseWidth = W / nBuildings;
    let x = 0;
    for (let i = 0; i < nBuildings; i++) {
      // Last building stretches to the right edge.
      const isLast = (i === nBuildings - 1);
      const widthJitter = (rand() - 0.5) * baseWidth * 0.4;
      let bw = Math.max(28, Math.floor(baseWidth + widthJitter));
      if (isLast || x + bw > W) bw = W - x;
      const bh = Math.floor(MIN_BLDG_H + rand() * (MAX_BLDG_H - MIN_BLDG_H));
      const topY = H - bh;
      for (let dx = 0; dx < bw && x + dx < W; dx++) {
        g[x + dx] = topY;
      }
      // Stash colour + window pattern info on the building array — but we
      // can't hang properties off the heightmap. Instead, derive look-up
      // deterministically at draw time using seedable rand-by-column.
      x += bw;
    }
    // Any leftover columns (shouldn't happen) get the rightmost height.
    if (x < W) {
      const last = x > 0 ? g[x - 1] : (H - 100);
      for (; x < W; x++) g[x] = last;
    }
    return g;
  }

  // --- crater: subtract a circle from the heightmap ---
  // For each column within radius, lower the surface by the chord-height of
  // the circle at that column offset. Gorillas-style chunky look is fine.
  function crater(cx, cy, r) {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(W - 1, Math.ceil(cx + r));
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d2 = r * r - dx * dx;
      if (d2 <= 0) continue;
      const chord = Math.sqrt(d2);          // half-chord, vertical
      const topOfHole = cy - chord;
      const botOfHole = cy + chord;
      // If the hole bottom doesn't reach this column's ground yet, skip.
      if (botOfHole <= groundY[x]) continue;
      // If the hole top is above the current ground, ground recedes downward
      // to whichever is lower of (current ground) and the bottom of the hole,
      // but if the top of the hole is still above ground, the new surface is
      // the bottom of the hole — i.e. ground has been carved straight through.
      const newTop = Math.max(groundY[x], botOfHole);
      // Clamp so we don't punch below the canvas.
      groundY[x] = Math.min(H, newTop);
    }
    // If a gorilla is standing on now-eroded ground, drop them onto the new surface.
    for (const g of [p1, p2]) {
      if (!g.alive) continue;
      const newY = groundY[g.x];
      if (newY > g.y) g.y = newY;
    }
  }

  // --- collision tests ---
  function hitGorilla(px, py, g) {
    if (!g.alive) return false;
    // Gorilla bounding box: centred on g.x, top at g.y - GORILLA_H, foot at g.y.
    const left = g.x - GORILLA_W / 2;
    const right = g.x + GORILLA_W / 2;
    const top = g.y - GORILLA_H;
    const bot = g.y;
    // Treat banana as a small disc — expand the box by BALL_R.
    return (
      px >= left - BALL_R && px <= right + BALL_R &&
      py >= top - BALL_R && py <= bot + BALL_R
    );
  }

  function hitGround(px, py) {
    const col = Math.floor(px);
    if (col < 0 || col >= W) return false;
    return py >= groundY[col];
  }

  // --- shot simulation: animated via RAF ---
  // direction: +1 firing rightward, -1 firing leftward.
  // angleDeg is 0..180; we interpret it as elevation across both quadrants:
  //   0   = horizontal toward enemy
  //   90  = straight up
  //   180 = horizontal away from enemy (a backfire — legal but rarely useful)
  // Internally we always convert to a (vx, vy) where vy is canvas-positive-down.
  function launch(shooter, direction, angleDeg, power, onDone) {
    const a = (clamp(angleDeg, 0, 180) * Math.PI) / 180;
    const speed = clamp(power, 0, 100) * POWER_SCALE;
    // Horizontal component: cos(a) * direction. At a=0, full forward; at a=180,
    // full backward (cos negative). Vertical: -sin(a) so high angles fire up.
    const vx0 = Math.cos(a) * speed * direction;
    const vy0 = -Math.sin(a) * speed;
    // Start one ball-radius above the shooter's head so we don't self-hit.
    const startX = shooter.x + direction * (GORILLA_W / 2 + BALL_R + 1);
    const startY = shooter.y - GORILLA_H - BALL_R - 1;
    let s = { x: startX, y: startY, vx: vx0, vy: vy0 };
    const env = { gravity: GRAVITY, wind: wind * WIND_SCALE, drag: 0 };

    inFlight = true;
    lastShotTrail = [{ x: s.x, y: s.y }];
    let elapsed = 0;
    let accumulator = 0;
    let lastTime = performance.now();
    const target = (shooter === p1) ? p2 : p1;

    function frame(now) {
      if (!inFlight) return;     // cleanup raced us
      const realDt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      accumulator += realDt;
      // Fixed-step physics so behaviour is identical across frame rates.
      while (accumulator >= DT) {
        accumulator -= DT;
        elapsed += DT;
        s = step(s, DT, env);
        lastShotTrail.push({ x: s.x, y: s.y });

        // Out-of-bounds horizontally: the shot is lost. (Going off the top is OK;
        // gravity will bring it down. We only end on side / bottom / hit.)
        if (s.x < -20 || s.x > W + 20) {
          finish('offscreen', s.x, s.y);
          return;
        }
        if (s.y > H + 40) {
          finish('offscreen', s.x, s.y);
          return;
        }
        // Hit checks: opponent first, then own (only if the ball has actually
        // left the shooter's box — startY/X buffer above handles the first step).
        if (hitGorilla(s.x, s.y, target)) {
          target.alive = false;
          finish('hit-target', s.x, s.y);
          return;
        }
        if (hitGorilla(s.x, s.y, shooter)) {
          shooter.alive = false;
          finish('hit-self', s.x, s.y);
          return;
        }
        if (hitGround(s.x, s.y)) {
          finish('hit-ground', s.x, s.y);
          return;
        }
        if (elapsed >= MAX_FLIGHT) {
          finish('offscreen', s.x, s.y);
          return;
        }
      }
      draw();
      raf = requestAnimationFrame(frame);
    }

    function finish(outcome, ex, ey) {
      inFlight = false;
      cancelAnimationFrame(raf);
      raf = 0;
      // Crater on terrain or self/target hits — gorilla hit also leaves a mark.
      if (outcome === 'hit-ground' || outcome === 'hit-target' || outcome === 'hit-self') {
        crater(ex, ey, 22);
      }
      draw();
      onDone({ outcome, endX: ex, endY: ey });
    }

    raf = requestAnimationFrame(frame);
  }

  // --- AI ---
  // Strategy: track the signed horizontal miss along the firing axis and
  // adjust POWER proportionally; nudge ANGLE only with small random jitter.
  // Power dominates landing distance for a given high-arc shot; angle jitter
  // lets the AI eventually find a path over (or around) any blocking building
  // without needing a height-aware solver. Convergence in 3–5 shots in the
  // typical case. Beatable, but capable of beating an inattentive player.
  function aiShoot(onDone) {
    let angle, power;
    const jitter = () => (Math.random() - 0.5);
    if (aiLastTargetMissX === null) {
      // Opening shot. launch() takes a direction-relative angle: 0 = horizontal
      // toward target, 90 = straight up, 180 = backward. AI uses direction = -1,
      // so 50° here means "high arc, forward (= leftward in world space)".
      // Power 75 at 50° gives projected range ~366 px on a ~474 px field —
      // lands somewhat short of P1; the feedback loop dials it in.
      angle = 50 + jitter() * 10;
      power = 75 + jitter() * 8;
    } else {
      const missX = aiLastTargetMissX;       // + = landed past player (toward AI's "forward")
      // Reduce power per pixel of overshoot. The factor was tuned by hand
      // so that a 100px miss becomes a ~10pt power correction.
      const dPower = clamp(missX * 0.10, -22, 22);
      power = clamp(aiLastPower - dPower + jitter() * 3, 15, 95);
      // Angle jitter is wider when the last shot was a clear off-screen or
      // off-by-a-lot miss — odds are a building blocked the path.
      const wide = Math.abs(missX) > 80 ? 12 : 4;
      angle = clamp(aiLastAngle + jitter() * wide, 25, 80);
    }
    aiLastAngle = angle;
    aiLastPower = power;
    launch(p2, -1, angle, power, (outcome) => {
      // Record signed miss along the firing axis (positive toward the player).
      // AI fires LEFTWARD, so "past the player" means endX < p1.x.
      aiLastTargetMissX = p1.x - outcome.endX;
      aiLastTargetMissY = outcome.endY - (p1.y - GORILLA_H / 2);
      onDone(outcome);
    });
  }

  // --- turn handler ---
  function fire() {
    if (gameOver) {
      seed = (seed + 1) | 0;     // small variety on "play again"
      newRound();
      return;
    }
    if (inFlight) return;
    const angle = Number(angleInput.value);
    const power = Number(powerInput.value);
    if (!Number.isFinite(angle) || !Number.isFinite(power)) {
      result.textContent = 'Enter numeric angle and power.';
      return;
    }
    // Player shoots.
    setControlsLocked(true);
    launch(p1, +1, angle, power, (outcome) => {
      if (!p2.alive) {
        endGame('You hit your opponent. Player 1 wins. Press FIRE for a new round.');
        return;
      }
      if (!p1.alive) {
        endGame('You hit yourself. Player 2 wins. Press FIRE for a new round.');
        return;
      }
      // AI replies.
      turn = 1;
      result.textContent = describeShot('Player 1', outcome, p2);
      // small pause for legibility
      setTimeout(() => {
        if (gameOver) return;
        aiShoot((aiOutcome) => {
          if (!p1.alive) {
            endGame(`Player 2 fires angle ${Math.round(aiLastAngle)}, power ${Math.round(aiLastPower)} — DIRECT HIT. Player 2 wins. Press FIRE for a new round.`);
            return;
          }
          if (!p2.alive) {
            endGame('Player 2 hit themselves. Player 1 wins by default. Press FIRE for a new round.');
            return;
          }
          turn = 0;
          result.textContent =
            describeShot('Player 1', outcome, p2) + '   ' +
            describeShot(`Player 2 (a${Math.round(aiLastAngle)} p${Math.round(aiLastPower)})`, aiOutcome, p1);
          setControlsLocked(false);
        });
      }, 250);
    });
  }

  function endGame(msg) {
    gameOver = true;
    inFlight = false;
    setControlsLocked(false);
    fireBtn.textContent = 'PLAY AGAIN';
    result.textContent = msg;
    draw();
  }

  function setControlsLocked(locked) {
    angleInput.disabled = locked;
    powerInput.disabled = locked;
    fireBtn.disabled = locked;
    for (const b of angleSteps) b.disabled = locked;
    for (const b of powerSteps) b.disabled = locked;
  }

  function describeShot(who, outcome, target) {
    if (outcome.outcome === 'hit-target') return `${who}: DIRECT HIT.`;
    if (outcome.outcome === 'hit-self') return `${who}: hit themselves.`;
    if (outcome.outcome === 'offscreen') return `${who}: lost off-screen.`;
    const dx = Math.round(outcome.endX - target.x);
    const horiz = dx === 0 ? 'on column'
                : dx > 0 ? `${dx}px right of target`
                         : `${-dx}px left of target`;
    return `${who}: hit ground, ${horiz}.`;
  }

  // --- rendering ---
  function draw() {
    // sky
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, COL_SKY_TOP);
    grad.addColorStop(1, COL_BG);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // wind banner (top strip)
    drawWindBanner();

    // skyline — fill ground beneath groundY for each column.
    drawSkyline();

    // gorillas
    if (p1.alive) drawGorilla(p1, COL_AMBER, 'L');
    else drawWreckage(p1, COL_AMBER);
    if (p2.alive) drawGorilla(p2, COL_TEAL, 'R');
    else drawWreckage(p2, COL_TEAL);

    // current shot trail + projectile
    if (lastShotTrail.length > 1) {
      ctx.strokeStyle = 'rgba(212, 162, 86, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lastShotTrail[0].x, lastShotTrail[0].y);
      for (let i = 1; i < lastShotTrail.length; i++) {
        ctx.lineTo(lastShotTrail[i].x, lastShotTrail[i].y);
      }
      ctx.stroke();
      if (inFlight) {
        const tip = lastShotTrail[lastShotTrail.length - 1];
        ctx.fillStyle = COL_AMBER;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, BALL_R, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // turn indicator
    ctx.fillStyle = COL_MUTED;
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    if (!gameOver) {
      ctx.fillText(turn === 0 ? 'TURN: PLAYER 1' : 'TURN: PLAYER 2', 8, 8);
    } else {
      ctx.fillStyle = COL_BLOOD;
      ctx.fillText('GAME OVER', 8, 8);
    }
  }

  function drawWindBanner() {
    // a thin band at the top — arrow length is proportional to |wind|.
    const cx = W / 2;
    const y = 22;
    ctx.fillStyle = COL_MUTED;
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText('WIND', cx - 80, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = COL_TEAL;
    ctx.fillText(formatWind(wind), cx + 80, y);

    // arrow
    const maxLen = 70;
    const len = Math.min(maxLen, Math.abs(wind) * (maxLen / 10));
    const dir = wind >= 0 ? 1 : -1;
    ctx.strokeStyle = COL_TEAL;
    ctx.fillStyle = COL_TEAL;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - len * dir * 0.5, y);
    ctx.lineTo(cx + len * dir * 0.5, y);
    ctx.stroke();
    if (len > 0) {
      const tipX = cx + len * dir * 0.5;
      ctx.beginPath();
      ctx.moveTo(tipX, y);
      ctx.lineTo(tipX - 6 * dir, y - 4);
      ctx.lineTo(tipX - 6 * dir, y + 4);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSkyline() {
    // Walk columns, identify spans of equal-ish ground (building roofs or
    // carved sub-roofs), and paint each span with an alternating colour and
    // a window pattern. Because we paint from the CURRENT groundY[x] down
    // to H per column, craters appear naturally as sky-coloured notches:
    // the carved columns simply form a new (shorter) span with a slightly
    // different shade. That mismatch is the Gorillas-style chunky bite.
    let x = 0;
    let bldgIndex = 0;
    while (x < W) {
      const top = groundY[x];
      let end = x + 1;
      while (end < W && Math.abs(groundY[end] - top) < 0.5) end++;
      const bw = end - x;
      const colour = (bldgIndex % 2 === 0) ? COL_BLDG_A : COL_BLDG_B;
      ctx.fillStyle = colour;
      ctx.fillRect(x, top, bw, H - top);
      drawWindows(x, top, bw, bldgIndex);
      x = end;
      bldgIndex++;
    }
  }

  function drawWindows(x0, top, bw, bldgIndex) {
    const winW = 6, winH = 8, gap = 5;
    const cols = Math.floor((bw - gap) / (winW + gap));
    const rows = Math.floor((H - top - gap) / (winH + gap));
    if (cols <= 0 || rows <= 0) return;
    // deterministic per-building random for which windows are lit
    const winRand = mulberry32(seed ^ (bldgIndex * 2654435761));
    const startX = x0 + Math.floor((bw - (cols * winW + (cols - 1) * gap)) / 2);
    for (let r = 0; r < rows; r++) {
      const wy = top + gap + r * (winH + gap);
      // Don't draw windows below the (possibly carved) groundY — they get
      // hidden behind the next building or carved away.
      for (let c = 0; c < cols; c++) {
        const wx = startX + c * (winW + gap);
        // hide windows where the column has been carved away
        if (groundY[Math.min(W - 1, wx + winW / 2)] < wy + winH) continue;
        const lit = winRand() < 0.18;
        ctx.fillStyle = lit ? COL_WINDOW : COL_WINDOW_DARK;
        ctx.fillRect(wx, wy, winW, winH);
      }
    }
  }

  function drawGorilla(g, colour, side) {
    const x = g.x;
    const y = g.y;
    const w = GORILLA_W;
    const h = GORILLA_H;
    ctx.fillStyle = colour;
    // body (rectangle)
    ctx.fillRect(x - w / 2, y - h, w, h);
    // head (smaller rectangle)
    ctx.fillStyle = '#0d0e10';
    ctx.fillRect(x - w / 2 + 4, y - h + 4, w - 8, 6);
    // eyes
    ctx.fillStyle = colour;
    ctx.fillRect(x - 5, y - h + 6, 2, 2);
    ctx.fillRect(x + 3, y - h + 6, 2, 2);
    // small label so player can tell who's who without reading the status line
    ctx.fillStyle = COL_MUTED;
    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    ctx.fillText(side === 'L' ? 'P1' : 'P2', x, y - h - 2);
  }

  function drawWreckage(g, colour) {
    // a dim cross where the gorilla used to be
    const x = g.x, y = g.y;
    ctx.strokeStyle = COL_BLOOD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 4); ctx.lineTo(x + 8, y - 12);
    ctx.moveTo(x - 8, y - 12); ctx.lineTo(x + 8, y - 4);
    ctx.stroke();
    void colour;
  }

  // --- listeners ---
  function onKey(e) {
    if (e.key === 'Enter' && (e.target === angleInput || e.target === powerInput)) {
      e.preventDefault();
      fire();
    }
  }
  function onFire() { fire(); }
  function onReroll() {
    if (inFlight) return;
    seed = (seed + 1) | 0;
    newRound();
  }

  // Per-button click handler factory — keep references so cleanup can detach.
  const stepHandlers = [];
  function wireSteps(input, buttons) {
    for (const btn of buttons) {
      const delta = Number(btn.dataset.step);
      const handler = () => nudge(input, delta);
      btn.addEventListener('click', handler);
      stepHandlers.push({ btn, handler });
    }
  }
  wireSteps(angleInput, angleSteps);
  wireSteps(powerInput, powerSteps);

  fireBtn.addEventListener('click', onFire);
  rerollBtn.addEventListener('click', onReroll);
  angleInput.addEventListener('keydown', onKey);
  powerInput.addEventListener('keydown', onKey);

  newRound();

  // --- cleanup ---
  return function cleanup() {
    inFlight = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    fireBtn.removeEventListener('click', onFire);
    rerollBtn.removeEventListener('click', onReroll);
    angleInput.removeEventListener('keydown', onKey);
    powerInput.removeEventListener('keydown', onKey);
    for (const { btn, handler } of stepHandlers) {
      btn.removeEventListener('click', handler);
    }
    rootEl.innerHTML = '';
  };
}

// --- helpers ---
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function formatWind(w) {
  if (w === 0) return '0 (calm)';
  const dir = w > 0 ? '→' : '←';
  return `${dir} ${Math.abs(w)}`;
}

let _uid = 0;
function uniqueId(prefix) { _uid += 1; return `${prefix}-${_uid}`; }
