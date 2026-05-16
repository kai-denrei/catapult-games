// 01-artillery.js — Iteration 01 (Artillery, 1976, Mike Forman, Creative Computing).
//
// Gesture preserved: numeric input of angle and power, then submit and see result.
// The arc is plotted instantaneously after FIRE — there is no in-flight animation.
//
// Rendering: ASCII into a <pre class="ascii-canvas"> styled by iterations.css.
// Physics: lib/ballistics.js step() sampled in a tight loop.
// Layout: mulberry32 heightmap, re-rollable via a button (seed += 1).
//
// AI: converging-aim heuristic. The opponent remembers the signed miss of its last
// shot (along the line from itself to the player) and scales its power proportionally,
// with a small random angle jitter so it never instantly locks on.

import { step } from '../lib/ballistics.js';
import { mulberry32 } from '../lib/rng.js';

// --- grid geometry (characters) ---
const COLS = 71;        // odd so cannons sit symmetric around a centre
const ROWS = 22;
const SKY = ' ';
const GROUND = '_';
const PEAK = '^';
// Trails and impacts are intentionally distinct between shooter and AI so the
// player can tell whose arc is whose at a glance. See bug fix v2: "1976 fires
// two at once, confusing." Player gets the canonical period-trail of the era;
// the AI gets a lighter, raised glyph and a hash impact.
const TRAIL_YOU = '.';
const TRAIL_AI = '\'';
const HIT_YOU = '*';
const HIT_AI = '#';

// --- physics scale: 1 char-cell == 1 unit, ground is at y = ROWS - 1 ---
// gravity / wind / power are tuned so a power of 60 at 45° clears the field roughly.
const DT = 0.05;          // seconds per step — coarse on purpose, ASCII sampling
const MAX_STEPS = 600;    // hard cap so a bad shot can't loop forever
const GRAVITY = 22;       // cell/s^2
const POWER_SCALE = 0.55; // power 0..100 -> launch speed in cell/s

export function mount(rootEl) {
  // Idempotency: wipe whatever is in the slot (the <noscript> fallback or a
  // previous mount of this module).
  rootEl.innerHTML = '';

  // --- DOM ---
  const status = el('p', 'widget-status');
  const screen = el('pre', 'ascii-canvas');
  screen.setAttribute('aria-live', 'polite');
  screen.setAttribute('aria-label', 'Artillery field, ASCII rendered');

  const controls = el('div', 'widget-controls');

  const angleLabel = el('label', null, 'ANGLE ');
  const angleInput = el('input');
  angleInput.type = 'number';
  angleInput.min = '0';
  angleInput.max = '90';
  angleInput.step = '1';
  angleInput.value = '45';
  angleInput.id = uniqueId('artillery-angle');
  angleLabel.htmlFor = angleInput.id;
  angleLabel.appendChild(angleInput);

  const powerLabel = el('label', null, 'POWER ');
  const powerInput = el('input');
  powerInput.type = 'number';
  powerInput.min = '0';
  powerInput.max = '100';
  powerInput.step = '1';
  powerInput.value = '60';
  powerInput.id = uniqueId('artillery-power');
  powerLabel.htmlFor = powerInput.id;
  powerLabel.appendChild(powerInput);

  const fireBtn = el('button', null, 'FIRE');
  fireBtn.type = 'button';

  const rerollBtn = el('button', null, 'Re-roll');
  rerollBtn.type = 'button';

  const result = el('p', 'widget-status');

  controls.append(angleLabel, powerLabel, fireBtn, rerollBtn);
  rootEl.append(status, screen, controls, result);

  // --- game state ---
  let seed = 1976;
  let rng;
  let heights;         // ground row index per column (smaller = higher)
  let wind;            // signed integer, cells/s^2
  let playerX;         // column of player cannon
  let aiX;             // column of ai cannon
  let lastFrame;       // char[ROWS][COLS] of the last rendered frame (trails persist within a round)
  let gameOver;        // true if someone has won this round
  // AI memory
  let aiLastMiss;      // signed miss in player-ward direction (cells). null until first shot.
  let aiLastPower;
  let aiLastAngle;

  function newRound() {
    rng = mulberry32(seed);
    wind = Math.floor(rng() * 11) - 5; // -5..+5
    heights = buildHeightmap(rng);
    playerX = 3;
    aiX = COLS - 4;
    // ensure cannons sit on visible ground (not negative)
    heights[playerX] = clamp(heights[playerX], 4, ROWS - 2);
    heights[aiX] = clamp(heights[aiX], 4, ROWS - 2);
    lastFrame = renderBase();
    gameOver = false;
    aiLastMiss = null;
    aiLastPower = 55;
    aiLastAngle = 50;
    paint(lastFrame);
    status.textContent =
      `WIND: ${wind >= 0 ? '+' : ''}${wind}    SEED: ${seed}    ` +
      `YOU: ${TRAIL_YOU}/${HIT_YOU}    AI: ${TRAIL_AI}/${HIT_AI}    ` +
      `Enter angle (0–90) and power (0–100), then FIRE.`;
    result.textContent = '';
  }

  function buildHeightmap(rand) {
    // Smooth 1D noise: sum of a couple of sine-ish waves plus per-column jitter.
    // Output is ground-row index per column. Lower row index = taller hill.
    const h = new Array(COLS);
    const baseRow = ROWS - 4;       // average ground line near the bottom
    const amp = 5;                  // max hill height in rows
    const phase1 = rand() * Math.PI * 2;
    const phase2 = rand() * Math.PI * 2;
    const freq1 = 1.2 + rand() * 1.6;
    const freq2 = 2.4 + rand() * 2.0;
    for (let x = 0; x < COLS; x++) {
      const t = x / COLS;
      const wave =
        Math.sin(t * Math.PI * freq1 + phase1) * 0.6 +
        Math.sin(t * Math.PI * freq2 + phase2) * 0.4;
      const jitter = (rand() - 0.5) * 0.6;
      const rowOffset = Math.round((wave + jitter) * amp);
      h[x] = clamp(baseRow - rowOffset, 5, ROWS - 2);
    }
    return h;
  }

  function renderBase() {
    // Build a fresh ROWS×COLS grid containing only the terrain + cannons.
    const g = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) g[r] = new Array(COLS).fill(SKY);
    for (let x = 0; x < COLS; x++) {
      const top = heights[x];
      // surface character: peak if it's a local max, else underscore
      const isPeak =
        (x > 0 && x < COLS - 1) &&
        heights[x] < heights[x - 1] &&
        heights[x] < heights[x + 1];
      g[top][x] = isPeak ? PEAK : GROUND;
      for (let r = top + 1; r < ROWS; r++) g[r][x] = '#';
    }
    // Cannons sit one row above the ground.
    const pRow = heights[playerX] - 1;
    const aRow = heights[aiX] - 1;
    if (pRow >= 0) g[pRow][playerX] = '<';
    if (aRow >= 0) g[aRow][aiX] = '>';
    return g;
  }

  function paint(grid) {
    let s = '';
    for (let r = 0; r < ROWS; r++) {
      s += grid[r].join('') + (r < ROWS - 1 ? '\n' : '');
    }
    screen.textContent = s;
  }

  // --- shot simulation ---
  // direction: +1 = firing rightward (player), -1 = firing leftward (ai).
  // angle: degrees 0..90 above horizontal.
  // power: 0..100.
  // Returns { trail: [{x,y}], outcome: 'hit-player'|'hit-ai'|'hit-ground'|'offscreen', endX, endY }
  function simulate(originX, originY, direction, angleDeg, power) {
    const a = (clamp(angleDeg, 0, 90) * Math.PI) / 180;
    const speed = clamp(power, 0, 100) * POWER_SCALE;
    const vx0 = Math.cos(a) * speed * direction;
    const vy0 = -Math.sin(a) * speed; // up == negative y in canvas/grid convention
    // Start one cell ahead of the cannon mouth so we never "hit ourselves".
    let s = { x: originX + direction, y: originY, vx: vx0, vy: vy0 };
    const env = { gravity: GRAVITY, wind: wind, drag: 0 };
    const trail = [{ x: s.x, y: s.y }];
    let outcome = 'offscreen';
    let endX = s.x, endY = s.y;
    for (let i = 0; i < MAX_STEPS; i++) {
      const prev = s;
      s = step(s, DT, env);
      trail.push({ x: s.x, y: s.y });
      const col = Math.round(s.x);
      const row = Math.round(s.y);
      endX = s.x;
      endY = s.y;
      if (col < 0 || col >= COLS) {
        outcome = 'offscreen';
        break;
      }
      if (row >= ROWS) {
        outcome = 'hit-ground';
        break;
      }
      if (row < 0) {
        // still climbing above the screen — keep flying, just don't draw
        continue;
      }
      // Player cannon collision (only if this isn't the shooter)
      if (direction !== 1 && col === playerX && row >= heights[playerX] - 1) {
        outcome = 'hit-player';
        break;
      }
      if (direction !== -1 && col === aiX && row >= heights[aiX] - 1) {
        outcome = 'hit-ai';
        break;
      }
      // Terrain collision: projectile entered or passed below the ground line.
      if (row >= heights[col]) {
        outcome = 'hit-ground';
        break;
      }
      // Suppress: if prev step was below ground due to off-screen-top wrap-around,
      // we'd never get here because the row<0 branch continues. No-op.
      void prev;
    }
    return { trail, outcome, endX, endY };
  }

  function drawTrail(grid, trail, outcome, side) {
    // side: 'you' or 'ai' — picks the glyph set so the two arcs are legible.
    const trailGlyph = side === 'ai' ? TRAIL_AI : TRAIL_YOU;
    const hitGlyph = side === 'ai' ? HIT_AI : HIT_YOU;
    // Plot the trail glyph at every sampled point that fits in the field,
    // skipping the muzzle cell so the cannon glyph remains visible.
    for (let i = 1; i < trail.length - 1; i++) {
      const c = Math.round(trail[i].x);
      const r = Math.round(trail[i].y);
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      const cur = grid[r][c];
      if (cur === SKY) grid[r][c] = trailGlyph;
    }
    // Endpoint mark.
    const last = trail[trail.length - 1];
    const lc = Math.round(last.x);
    const lr = Math.round(last.y);
    if (lr >= 0 && lr < ROWS && lc >= 0 && lc < COLS) {
      grid[lr][lc] = hitGlyph;
    }
    return outcome;
  }

  // --- AI ---
  function aiShoot() {
    // First shot: a sensible opening guess biased toward the player.
    // Subsequent shots: adjust power using last miss along the player-ward axis.
    let angle, power;
    const jitter = () => (Math.random() - 0.5);
    if (aiLastMiss === null) {
      angle = 45 + jitter() * 8;
      power = 55 + jitter() * 8;
    } else {
      // AI fires LEFT toward the player. aiLastMiss = endX - playerX:
      //   endX > playerX → projectile fell SHORT (didn't reach player) → +miss → need MORE power
      //   endX < playerX → projectile OVERSHOT past the player → -miss → need LESS power
      // So adjustment adds when short, subtracts when long.
      const adjust = aiLastMiss * 0.9;
      power = clamp(aiLastPower + adjust + jitter() * 4, 15, 95);
      angle = clamp(aiLastAngle + jitter() * 6, 25, 75);
    }
    const originY = heights[aiX] - 1;
    const shot = simulate(aiX, originY, -1, angle, power);
    aiLastAngle = angle;
    aiLastPower = power;
    aiLastMiss = shot.endX - playerX;
    drawTrail(lastFrame, shot.trail, shot.outcome, 'ai');
    return shot;
  }

  // --- turn handler ---
  function fire() {
    if (gameOver) {
      newRound();
      return;
    }
    const angle = Number(angleInput.value);
    const power = Number(powerInput.value);
    if (!Number.isFinite(angle) || !Number.isFinite(power)) {
      result.textContent = 'Enter numeric angle and power.';
      return;
    }
    const originY = heights[playerX] - 1;
    const playerShot = simulate(playerX, originY, +1, angle, power);
    drawTrail(lastFrame, playerShot.trail, playerShot.outcome, 'you');

    if (playerShot.outcome === 'hit-ai') {
      paint(lastFrame);
      result.textContent = `YOU (${TRAIL_YOU}/${HIT_YOU}): DIRECT HIT. You win. Press FIRE for a new round.`;
      gameOver = true;
      return;
    }

    // AI responds.
    const aiShot = aiShoot();
    paint(lastFrame);

    if (aiShot.outcome === 'hit-player') {
      result.textContent =
        `YOU (${TRAIL_YOU}/${HIT_YOU}): ${describeMiss(playerShot, aiX)}.  |  ` +
        `AI (${TRAIL_AI}/${HIT_AI}, a${Math.round(aiLastAngle)} p${Math.round(aiLastPower)}): DIRECT HIT. You lose. Press FIRE for a new round.`;
      gameOver = true;
      return;
    }

    const yourMiss = describeMiss(playerShot, aiX);
    const aiMiss = describeMiss(aiShot, playerX);
    result.textContent =
      `YOU (${TRAIL_YOU}/${HIT_YOU}): ${yourMiss}.  |  ` +
      `AI (${TRAIL_AI}/${HIT_AI}, a${Math.round(aiLastAngle)} p${Math.round(aiLastPower)}): ${aiMiss}.`;
  }

  function describeMiss(shot, targetX) {
    if (shot.outcome === 'offscreen') return 'lost off-screen';
    const dx = Math.round(shot.endX - targetX);
    if (dx === 0) return 'on target but blocked';
    if (dx > 0) return `${dx} long`;
    return `${-dx} short`;
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
    seed = (seed + 1) | 0;
    newRound();
  }

  fireBtn.addEventListener('click', onFire);
  rerollBtn.addEventListener('click', onReroll);
  angleInput.addEventListener('keydown', onKey);
  powerInput.addEventListener('keydown', onKey);

  newRound();

  // --- cleanup ---
  return function cleanup() {
    fireBtn.removeEventListener('click', onFire);
    rerollBtn.removeEventListener('click', onReroll);
    angleInput.removeEventListener('keydown', onKey);
    powerInput.removeEventListener('keydown', onKey);
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

let _uid = 0;
function uniqueId(prefix) { _uid += 1; return `${prefix}-${_uid}`; }
