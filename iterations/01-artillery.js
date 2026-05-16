// 01-artillery.js — Iteration 01 (Artillery, 1976, Mike Forman, Creative Computing).
//
// Gesture preserved: numeric input of angle and power, then submit and see result.
// The arc is plotted instantaneously after FIRE — there is no in-flight animation.
//
// Format: target practice. One user-controlled artillery on the left, one stationary
// target on the right. Each FIRE is one shell; the result log at the top tracks the
// sequence as `Shell N: HIT !` or `Shell N: FAIL X`. After three consecutive HITs
// the player earns a small "MARKSMAN" line. Re-roll generates a new heightmap, wind,
// target column, and clears the log.
//
// Rendering: ASCII into a <pre class="ascii-canvas"> styled by iterations.css.
// Physics: lib/ballistics.js step() sampled in a tight loop.
// Layout: mulberry32 heightmap, re-rollable via a button (seed += 1).

import { step } from '../lib/ballistics.js';
import { mulberry32 } from '../lib/rng.js';

// --- grid geometry (characters) ---
const COLS = 71;
const ROWS = 22;
const SKY = ' ';
const GROUND = '_';
const PEAK = '^';

// Trail glyph for in-flight samples; impact star for the endpoint.
const TRAIL = '.';
const HIT_MARK = '*';

// --- two distinct ASCII actors ---
// Player artillery: a small two-row catapult silhouette.
//   Row above ground: "/=>"   (arm + barrel)
//   Ground row:       "[#]"   (chassis sitting on the hill)
// The chassis row replaces the surface chars under it; the arm row sits in the sky.
const PLAYER_ARM    = ['/', '=', '>'];
const PLAYER_BASE   = ['[', '#', ']'];
const PLAYER_WIDTH  = 3;        // columns occupied
const PLAYER_MUZZLE_OFFSET = 2; // arm tip relative to anchor column (0..2)

// Target: a labelled bullseye, three columns wide.
//   "(@)"
const TARGET_GLYPHS = ['(', '@', ')'];
const TARGET_WIDTH  = 3;

// Hit tolerance in columns on either side of the target's hit-box edges.
// Hit-box spans the three target columns; tolerance widens the acceptance to ±1 col.
const HIT_TOLERANCE = 1;

// --- physics scale: 1 char-cell == 1 unit, ground is at y = ROWS - 1 ---
const DT = 0.05;
const MAX_STEPS = 600;
const GRAVITY = 22;
const POWER_SCALE = 0.55;

// --- shell log presentation ---
const MAX_LOG_ENTRIES = 6;       // entries shown on screen (oldest scrolls off)
const MARKSMAN_STREAK = 3;       // consecutive HITs that earn the MARKSMAN line

export function mount(rootEl) {
  // Idempotency: wipe whatever is in the slot.
  rootEl.innerHTML = '';

  // --- DOM ---
  const log = el('p', 'widget-status');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-label', 'Shell result log');

  const status = el('p', 'widget-status');

  const screen = el('pre', 'ascii-canvas');
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
  rootEl.append(log, status, screen, controls, result);

  // --- game state ---
  let seed = 1976;
  let rng;
  let heights;          // ground row index per column (smaller = higher)
  let wind;             // signed integer, cells/s^2
  let playerX;          // anchor column of player chassis (left edge)
  let targetX;          // anchor column of target (left edge)
  let lastFrame;        // char[ROWS][COLS] of the last rendered frame (trails persist)
  let shellNumber;      // next shell number to fire (1-based)
  let shellLog;         // [{ n: int, hit: bool }, …] capped to MAX_LOG_ENTRIES
  let hitStreak;        // consecutive HITs

  function newRound() {
    rng = mulberry32(seed);
    wind = Math.floor(rng() * 11) - 5; // -5..+5
    heights = buildHeightmap(rng);

    // Player anchor: left edge of the chassis. Pull a few cols in from the wall.
    playerX = 3;
    // Target anchor: somewhere on the right third, varied per seed.
    const minTargetAnchor = Math.floor(COLS * 0.55);
    const maxTargetAnchor = COLS - TARGET_WIDTH - 2;
    targetX = minTargetAnchor + Math.floor(rng() * (maxTargetAnchor - minTargetAnchor + 1));

    // Flatten the ground under the player and target so the glyphs sit cleanly.
    flattenUnder(playerX, PLAYER_WIDTH);
    flattenUnder(targetX, TARGET_WIDTH);

    lastFrame = renderBase();
    shellNumber = 1;
    shellLog = [];
    hitStreak = 0;
    paint(lastFrame);

    status.textContent =
      `WIND: ${wind >= 0 ? '+' : ''}${wind}    SEED: ${seed}    ` +
      `Enter angle (0–90) and power (0–100), then FIRE.`;
    result.textContent = '';
    renderLog(null);
  }

  function flattenUnder(anchor, width) {
    // Pick the highest (smallest row index) ground cell under the span and apply
    // it across, so the actor sits on a level platform and hit-detection on the
    // target row is consistent.
    let top = ROWS - 2;
    for (let i = 0; i < width; i++) {
      const x = anchor + i;
      if (x < 0 || x >= COLS) continue;
      if (heights[x] < top) top = heights[x];
    }
    top = clamp(top, 5, ROWS - 2);
    for (let i = 0; i < width; i++) {
      const x = anchor + i;
      if (x < 0 || x >= COLS) continue;
      heights[x] = top;
    }
  }

  function buildHeightmap(rand) {
    const h = new Array(COLS);
    const baseRow = ROWS - 4;
    const amp = 5;
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
    const g = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) g[r] = new Array(COLS).fill(SKY);
    for (let x = 0; x < COLS; x++) {
      const top = heights[x];
      const isPeak =
        (x > 0 && x < COLS - 1) &&
        heights[x] < heights[x - 1] &&
        heights[x] < heights[x + 1];
      g[top][x] = isPeak ? PEAK : GROUND;
      for (let r = top + 1; r < ROWS; r++) g[r][x] = '#';
    }

    // Player artillery: chassis on the surface row, arm one row above.
    const pTop = heights[playerX];
    const pArmRow = pTop - 1;
    for (let i = 0; i < PLAYER_WIDTH; i++) {
      const x = playerX + i;
      if (x < 0 || x >= COLS) continue;
      g[pTop][x] = PLAYER_BASE[i];
      if (pArmRow >= 0) g[pArmRow][x] = PLAYER_ARM[i];
    }

    // Target: glyphs on the surface row of the target span.
    const tTop = heights[targetX];
    for (let i = 0; i < TARGET_WIDTH; i++) {
      const x = targetX + i;
      if (x < 0 || x >= COLS) continue;
      g[tTop][x] = TARGET_GLYPHS[i];
    }

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
  // Returns { trail, outcome: 'hit-target'|'hit-ground'|'offscreen', endX, endY }
  function simulate(originX, originY, angleDeg, power) {
    const a = (clamp(angleDeg, 0, 90) * Math.PI) / 180;
    const speed = clamp(power, 0, 100) * POWER_SCALE;
    const vx0 = Math.cos(a) * speed; // always firing right
    const vy0 = -Math.sin(a) * speed;
    // Start one cell ahead of the muzzle so we never collide with the player rig.
    let s = { x: originX + 1, y: originY, vx: vx0, vy: vy0 };
    const env = { gravity: GRAVITY, wind: wind, drag: 0 };
    const trail = [{ x: s.x, y: s.y }];
    let outcome = 'offscreen';
    let endX = s.x, endY = s.y;
    const tTop = heights[targetX];
    const tLeft = targetX - HIT_TOLERANCE;
    const tRight = targetX + TARGET_WIDTH - 1 + HIT_TOLERANCE;
    for (let i = 0; i < MAX_STEPS; i++) {
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
      // Target hit: projectile reaches the target's surface row (or below) within
      // the tolerance-widened column band.
      if (col >= tLeft && col <= tRight && row >= tTop) {
        outcome = 'hit-target';
        break;
      }
      // Terrain collision elsewhere.
      if (row >= heights[col]) {
        outcome = 'hit-ground';
        break;
      }
    }
    return { trail, outcome, endX, endY };
  }

  function drawTrail(grid, trail, outcome) {
    // Plot the trail glyph at every sampled point that fits in the field,
    // skipping non-sky cells so we don't overwrite terrain or actors.
    for (let i = 1; i < trail.length - 1; i++) {
      const c = Math.round(trail[i].x);
      const r = Math.round(trail[i].y);
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      if (grid[r][c] === SKY) grid[r][c] = TRAIL;
    }
    // Endpoint mark.
    const last = trail[trail.length - 1];
    const lc = Math.round(last.x);
    const lr = Math.round(last.y);
    if (lr >= 0 && lr < ROWS && lc >= 0 && lc < COLS) {
      grid[lr][lc] = HIT_MARK;
    }
    return outcome;
  }

  // --- shell log ---
  function renderLog(flashHit) {
    if (shellLog.length === 0) {
      log.textContent = 'Shell log: (no shells fired)';
      log.style.color = '';
      return;
    }
    const parts = shellLog.map(
      (e) => `Shell ${e.n}: ${e.hit ? 'HIT !' : 'FAIL X'}`
    );
    let line = parts.join('   ');
    if (hitStreak >= MARKSMAN_STREAK) {
      line += `   — MARKSMAN (${hitStreak} in a row)`;
    }
    log.textContent = line;
    // Briefly tint the log on a hit. We can't easily un-flash without a timer, so
    // we just toggle on every render: HIT shows amber, FAIL/empty resets.
    log.style.color = flashHit ? 'var(--amber, #d4a256)' : '';
  }

  function appendShell(n, hit) {
    shellLog.push({ n, hit });
    if (shellLog.length > MAX_LOG_ENTRIES) shellLog.shift(); // scroll oldest off
    hitStreak = hit ? hitStreak + 1 : 0;
  }

  // --- turn handler ---
  function fire() {
    const angle = Number(angleInput.value);
    const power = Number(powerInput.value);
    if (!Number.isFinite(angle) || !Number.isFinite(power)) {
      result.textContent = 'Enter numeric angle and power.';
      return;
    }
    const muzzleCol = playerX + PLAYER_MUZZLE_OFFSET;
    const muzzleRow = heights[playerX] - 1;
    const shot = simulate(muzzleCol, muzzleRow, angle, power);
    drawTrail(lastFrame, shot.trail, shot.outcome);
    paint(lastFrame);

    const hit = shot.outcome === 'hit-target';
    appendShell(shellNumber, hit);
    renderLog(hit);

    if (hit) {
      result.textContent = `Shell ${shellNumber}: HIT ! Direct strike on the target.`;
    } else {
      result.textContent = `Shell ${shellNumber}: FAIL X — ${describeMiss(shot)}.`;
    }
    shellNumber += 1;
  }

  function describeMiss(shot) {
    if (shot.outcome === 'offscreen') return 'lost off-screen';
    const targetCenter = targetX + (TARGET_WIDTH - 1) / 2;
    const dx = Math.round(shot.endX - targetCenter);
    if (dx === 0) return 'on line but blocked';
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
