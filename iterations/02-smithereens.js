// 02-smithereens.js — Smithereens! (1982, Ed Averett, Magnavox Odyssey²)
// Gesture: real-time symmetric dueling. Arms sweep on their own clock; the
// player chooses a moment by holding Space (or the canvas) to lock the arm
// at its current angle, then releasing to fire. The opponent does the same
// on a jittered cadence. No turns. Walls take 3 hits, catapults take 1.
//
// Rendering: everything is drawn to a small 160x100 offscreen buffer in
// chunky integer pixels, then blitted to a 640x400 visible canvas. The
// iterations.css rule `image-rendering: pixelated` on .iter-02 canvas
// keeps the upscale crisp. Palette comes from page CSS custom properties
// (--bg, --fg-muted, --amber, --blood) so the widget stays in the museum.
//
// Audio: silent text taunts written into a side log. The spec permits
// Web Speech but warns it is brittle on Safari/iOS; a text log is robust
// and stays muted-by-default by construction.

import { attachCanvas } from '../lib/canvas.js';
import { mulberry32 } from '../lib/rng.js';

// --- Constants ------------------------------------------------------------
const VIEW_W = 640;
const VIEW_H = 400;
const BUF_W  = 160;       // chunky pixel buffer width
const BUF_H  = 100;       // chunky pixel buffer height
const SCALE  = VIEW_W / BUF_W;    // 4x — also matches VIEW_H / BUF_H

const GROUND_Y = 84;       // top of ground in buffer coords
const WALL_TOP = 64;       // top of wall in buffer coords (3 bricks tall)
const BRICK_H  = (GROUND_Y - WALL_TOP) / 3;

// Geometry: two catapults face each other across a horizontal gap.
const P_BASE_Y   = GROUND_Y - 2;       // where the catapult arm pivots
const PLAYER_X   = 26;
const ENEMY_X    = BUF_W - 26;
const WALL_W     = 14;
const PLAYER_WALL_X = PLAYER_X + 16;
const ENEMY_WALL_X  = ENEMY_X - 16 - WALL_W;

const ARM_LEN          = 10;       // pixel length of the catapult arm
const ARM_SWEEP_LO     = -Math.PI / 4;    // -45°
const ARM_SWEEP_HI     =  Math.PI / 4;    // +45°
const ARM_RATE         = 1.4;      // radians/sec — arm angular speed
// Reload throttle removed (round-2 fix). The gesture of waiting for the arm
// to swing back into the desired window is itself the rate-limiter — no need
// for an extra dead time. A token 120ms guard remains only to prevent a
// single key-release from registering as multiple fires within one frame.
const RELOAD_MS        = 120;      // anti-double-fire guard; not gameplay throttle
// ROCK_SPEED + GRAVITY tuning (round-2 fix): the inter-catapult distance is
// ENEMY_X - PLAYER_X = 108 buffer px. Max horizontal range at 45° is v^2/g.
// Old values (v=78, g=95) gave R ≈ 64 px — physically impossible to reach
// the enemy. New values (v=130, g=95) give R ≈ 178 px, ~65% headroom over
// the 108 px gap, so a well-aimed shot at the optimal arm-lock angle clearly
// reaches the enemy catapult, and slightly off-optimal shots still arrive.
const ROCK_SPEED       = 130;      // initial launch speed (buffer px / sec)
const GRAVITY          = 95;       // buffer px / sec^2
const HIT_FLASH_MS     = 220;

// AI cadence: pick a hold window each cycle; fire when arm is "near"
// the desired angle, with jitter so the duel feels alive (not metronomic).
const AI_MIN_GAP_MS    = 900;
const AI_MAX_GAP_MS    = 2200;

// --- Taunt pool (silent text only; never spoken) --------------------------
const TAUNTS_HIT = [
  'Direct hit.', 'Smithereens.', 'Stones do the talking.',
  'Bullseye.', 'Cracked it.', 'Down a brick.',
];
const TAUNTS_MISS = [
  'Wide.', 'Long.', 'Short.', 'Off the parapet.', 'Air.', 'A wasted stone.',
];
const TAUNTS_WIN  = [ 'The walls are dust.', 'Castle taken.', 'Yours is the field.' ];
const TAUNTS_LOSE = [ 'Your engine is kindling.', 'They have your walls.', 'Smithereens, indeed.' ];

// =========================================================================
export function mount(rootEl) {
  if (!rootEl) return () => {};

  // Idempotency: if a prior mount stashed a cleanup on this root, run it
  // first. This makes mount(rootEl) safe to call twice even without the
  // caller running cleanup between calls — no leaked rAF, no double-bound
  // keyboard. The cleanup itself also wipes rootEl.innerHTML.
  if (typeof rootEl.__smithereensCleanup === 'function') {
    try { rootEl.__smithereensCleanup(); } catch (_) { /* ignore */ }
    rootEl.__smithereensCleanup = null;
  }
  rootEl.innerHTML = '';

  // ---- DOM scaffold ------------------------------------------------------
  const wrap = document.createElement('div');
  wrap.className = 'widget-inner';
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.alignItems = 'center';
  wrap.style.width = '100%';
  rootEl.appendChild(wrap);

  const canvasHost = document.createElement('div');
  canvasHost.style.position = 'relative';
  canvasHost.style.display = 'flex';
  canvasHost.style.justifyContent = 'center';
  canvasHost.style.width = '100%';
  wrap.appendChild(canvasHost);

  const { canvas, ctx } = attachCanvas(canvasHost, { width: VIEW_W, height: VIEW_H });
  canvas.setAttribute('aria-label',
    'Smithereens, 1982. Real-time catapult duel. Hold Space or click and hold to lock the arm; release to fire.');

  // Offscreen pixel buffer (chunky 160x100).
  const buf = document.createElement('canvas');
  buf.width  = BUF_W;
  buf.height = BUF_H;
  const bctx = buf.getContext('2d');

  // Resolve page palette tokens (fallbacks if styles missed).
  const css = getComputedStyle(rootEl);
  const cssVar = (name, fallback) =>
    (css.getPropertyValue(name).trim() || fallback);
  const COL = {
    bg:    cssVar('--bg',        '#0d0e10'),
    sky:   cssVar('--bg-elev',   '#15171a'),
    stone: cssVar('--fg-muted',  '#8a8275'),
    wood:  cssVar('--amber',     '#d4a256'),
    blood: cssVar('--blood',     '#8a3a32'),
    fg:    cssVar('--fg',        '#e6e1d4'),
    rule:  cssVar('--rule',      '#2a2c30'),
  };

  // ---- Controls + status (below the canvas) -----------------------------
  const controls = document.createElement('div');
  controls.className = 'widget-controls';
  controls.style.marginTop = '0.75rem';
  wrap.appendChild(controls);

  const beginBtn = document.createElement('button');
  beginBtn.type = 'button';
  beginBtn.textContent = 'Begin';
  beginBtn.setAttribute('aria-label', 'Begin Smithereens duel');
  controls.appendChild(beginBtn);

  const restartBtn = document.createElement('button');
  restartBtn.type = 'button';
  restartBtn.textContent = 'Restart';
  restartBtn.style.display = 'none';
  controls.appendChild(restartBtn);

  const hint = document.createElement('span');
  hint.style.color = 'var(--fg-muted)';
  hint.style.fontFamily = 'var(--mono)';
  hint.style.fontSize = '0.8rem';
  hint.textContent = 'Hold Space (or click) to lock the arm  ·  release to fire';
  controls.appendChild(hint);

  const status = document.createElement('p');
  status.className = 'widget-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Press Begin. Click the canvas first for keyboard control.';
  wrap.appendChild(status);

  // Side log of taunts (silent; spec says default-off audio, this avoids it).
  const log = document.createElement('ul');
  log.className = 'taunt-log';
  log.setAttribute('aria-live', 'polite');
  log.style.cssText =
    'list-style:none;padding:0;margin:0.75rem 0 0;font-family:var(--mono);' +
    'font-size:0.8rem;color:var(--fg-muted);max-height:5.5em;overflow:hidden;' +
    'text-align:center;line-height:1.5;min-height:1.5em;';
  wrap.appendChild(log);

  const pushTaunt = (who, text) => {
    const li = document.createElement('li');
    const tag = who === 'p' ? 'YOU' : (who === 'e' ? 'FOE' : '—');
    const tagColor = who === 'p' ? COL.wood : (who === 'e' ? COL.blood : COL.stone);
    li.innerHTML = `<span style="color:${tagColor}">${tag}</span>  ${text}`;
    log.insertBefore(li, log.firstChild);
    while (log.childElementCount > 3) log.removeChild(log.lastChild);
  };

  // ---- Game state -------------------------------------------------------
  const rand = mulberry32(1982);
  let state = null;
  let raf = 0;
  let lastT = 0;
  let running = false;
  let started = false;     // user has pressed Begin at least once
  let destroyed = false;

  function initState() {
    return {
      // Catapults: facing direction is +1 (player aims right) or -1 (enemy aims left)
      player: {
        x: PLAYER_X, dir: +1, hp: 1,
        // Arm phase (radians, current angle in sweep). Begins mid-sweep.
        armPhase: 0, armDir: +1,    // armDir flips at the limits
        locked: false, lockedAngle: 0,
        reloadUntil: 0,
        flashUntil: 0,
      },
      enemy: {
        x: ENEMY_X, dir: -1, hp: 1,
        armPhase: Math.PI / 8, armDir: -1,
        nextFireAt: 0,            // absolute time at which AI commits to fire
        targetAngle: 0,
        reloadUntil: 0,
        flashUntil: 0,
      },
      walls: {
        player: { x: PLAYER_WALL_X, hp: 3, flashUntil: 0 },
        enemy:  { x: ENEMY_WALL_X,  hp: 3, flashUntil: 0 },
      },
      rocks: [],         // {x, y, vx, vy, owner: 'p'|'e', spawnT}
      winner: null,      // null | 'p' | 'e'
      tStart: performance.now(),
    };
  }

  // ---- Firing logic -----------------------------------------------------
  function launch(owner, fromX, fromY, angle) {
    // angle is measured from horizontal-toward-the-opponent.
    // owner 'p' fires to the right (+x); 'e' fires to the left (-x).
    const dirSign = (owner === 'p') ? +1 : -1;
    const vx = Math.cos(angle) * ROCK_SPEED * dirSign;
    const vy = -Math.sin(angle) * ROCK_SPEED;   // negative y = up in buffer
    state.rocks.push({
      x: fromX, y: fromY, vx, vy, owner,
      spawnT: performance.now(),
    });
  }

  function fireFromPlayer() {
    const p = state.player;
    if (state.winner) return;
    if (performance.now() < p.reloadUntil) return;
    const angle = p.lockedAngle;
    // Launch from the tip of the arm.
    const fx = p.x + Math.cos(angle) * (ARM_LEN + 1) * p.dir;
    const fy = P_BASE_Y - Math.sin(angle) * (ARM_LEN + 1) - 4;
    launch('p', fx, fy, angle);
    p.reloadUntil = performance.now() + RELOAD_MS;
  }

  function fireFromEnemy() {
    const e = state.enemy;
    if (state.winner) return;
    if (performance.now() < e.reloadUntil) return;
    const angle = currentArmAngle(e);
    const fx = e.x + Math.cos(angle) * (ARM_LEN + 1) * e.dir;
    const fy = P_BASE_Y - Math.sin(angle) * (ARM_LEN + 1) - 4;
    launch('e', fx, fy, angle);
    e.reloadUntil = performance.now() + RELOAD_MS;
  }

  function currentArmAngle(cat) {
    // Map armPhase (always in [LO..HI]) directly to current angle.
    return cat.armPhase;
  }

  function updateArm(cat, dt) {
    if (cat.locked) return;
    cat.armPhase += ARM_RATE * cat.armDir * dt;
    if (cat.armPhase >= ARM_SWEEP_HI) {
      cat.armPhase = ARM_SWEEP_HI; cat.armDir = -1;
    } else if (cat.armPhase <= ARM_SWEEP_LO) {
      cat.armPhase = ARM_SWEEP_LO; cat.armDir = +1;
    }
  }

  // ---- Collisions -------------------------------------------------------
  // Wall hitbox MUST track remaining bricks. Bricks are drawn from the top
  // down (top brick is destroyed first; base is destroyed last). At hp=N,
  // the wall occupies the bottom N brick slots. With hp=0 the wall column
  // is empty and rocks must pass through to reach the catapult — otherwise
  // the phantom wall shields the catapult forever (Gerald's bug from v1).
  function wallTopY(wall) {
    // Top y of the highest *remaining* brick. If hp <= 0, return GROUND_Y
    // so the rect is empty (no hits).
    const hp = Math.max(0, wall.hp);
    if (hp <= 0) return GROUND_Y;
    // Remaining bricks occupy slots i = 0..hp-1 (0=base). Slot i's top is
    // at WALL_TOP + (3 - 1 - i) * BRICK_H = WALL_TOP + (2 - i) * BRICK_H.
    // Highest remaining slot is i = hp - 1, so its top y is:
    return WALL_TOP + (3 - hp) * BRICK_H;
  }

  function checkRockCollision(r) {
    // Off the bottom or off the sides -> miss.
    if (r.y >= GROUND_Y - 1) return { kind: 'ground' };
    if (r.x < -4 || r.x > BUF_W + 4) return { kind: 'oob' };

    // Friendly-fire rule (round-2 fix): a rock cannot collide with its
    // own side's wall or catapult. Player rocks ('p') pass through the
    // player wall and player catapult; enemy rocks ('e') pass through
    // the enemy wall and enemy catapult. This lets the player launch
    // without the arm scraping its own wall on low-angle shots, and
    // matches Gerald's round-2 directive ("player 1's shell cannot
    // destroy player 1's wall anymore").
    const ownSide = (who) => (who === 'player' ? 'p' : 'e');

    // Walls are vertical brick stacks. Hitbox shrinks as bricks are
    // destroyed: only the *remaining* bricks block rocks.
    const ww = state.walls;
    const hitsWall = (wall) => {
      if (wall.hp <= 0) return false;
      const top = wallTopY(wall);
      return r.x >= wall.x && r.x < wall.x + WALL_W &&
             r.y >= top && r.y < GROUND_Y;
    };

    if (r.owner !== ownSide('player') && hitsWall(ww.player)) {
      return { kind: 'wall', wall: ww.player, who: 'player' };
    }
    if (r.owner !== ownSide('enemy') && hitsWall(ww.enemy)) {
      return { kind: 'wall', wall: ww.enemy,  who: 'enemy'  };
    }

    // Catapults (small body). Hitbox is generous vertically so even small-
    // arc shots that just clear a downed wall still register on the body
    // and pivot/arm region.
    const inCatapult = (cat) => {
      const cx = cat.x, cy = P_BASE_Y;
      return Math.abs(r.x - cx) < 6 && r.y > cy - ARM_LEN && r.y < cy + 3;
    };
    if (r.owner !== ownSide('player') && inCatapult(state.player)) {
      return { kind: 'catapult', who: 'player' };
    }
    if (r.owner !== ownSide('enemy') && inCatapult(state.enemy)) {
      return { kind: 'catapult', who: 'enemy'  };
    }

    return null;
  }

  function resolveHit(r, hit) {
    const now = performance.now();
    if (hit.kind === 'wall') {
      // checkRockCollision now filters own-wall impacts, so any wall hit
      // here is by definition an enemy hit. No "own bricks" taunt needed.
      hit.wall.hp -= 1;
      hit.wall.flashUntil = now + HIT_FLASH_MS;
      pushTaunt(r.owner, pick(rand, TAUNTS_HIT));
    } else if (hit.kind === 'catapult') {
      // Likewise, only opponent-catapult hits reach here.
      if (hit.who === 'player' && r.owner === 'e') {
        state.player.hp = 0; state.player.flashUntil = now + HIT_FLASH_MS;
        state.winner = 'e';
        pushTaunt('e', pick(rand, TAUNTS_WIN));
      } else if (hit.who === 'enemy' && r.owner === 'p') {
        state.enemy.hp = 0; state.enemy.flashUntil = now + HIT_FLASH_MS;
        state.winner = 'p';
        pushTaunt('p', pick(rand, TAUNTS_WIN));
      }
    } else if (hit.kind === 'ground') {
      pushTaunt(r.owner, pick(rand, TAUNTS_MISS));
    }
  }

  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  // ---- AI cadence -------------------------------------------------------
  function scheduleNextEnemyShot(now) {
    const gap = AI_MIN_GAP_MS + rand() * (AI_MAX_GAP_MS - AI_MIN_GAP_MS);
    state.enemy.nextFireAt = now + gap;
    // Pick a target angle in the upper-half of the sweep (so it actually
    // clears walls most of the time). Bias toward middle of sweep.
    state.enemy.targetAngle = ARM_SWEEP_LO + (0.35 + rand() * 0.5) * (ARM_SWEEP_HI - ARM_SWEEP_LO);
  }

  function tickEnemyAI(now) {
    const e = state.enemy;
    if (state.winner) return;
    if (now >= e.nextFireAt && now >= e.reloadUntil) {
      // Fire when arm angle is within ~0.15 rad of the target. Otherwise
      // try again in a few frames. This gives a sense of the AI "waiting
      // for the right moment", which is the same gesture the player uses.
      if (Math.abs(e.armPhase - e.targetAngle) < 0.18) {
        fireFromEnemy();
        scheduleNextEnemyShot(now);
      }
      // Failsafe: if we've been waiting too long past nextFireAt, just shoot.
      else if (now - e.nextFireAt > 1200) {
        fireFromEnemy();
        scheduleNextEnemyShot(now);
      }
    }
  }

  // ---- Update loop ------------------------------------------------------
  function step(dt) {
    const now = performance.now();
    updateArm(state.player, dt);
    updateArm(state.enemy, dt);

    // Advance rocks (closed-form-ish Euler: vy += g*dt; pos += v*dt).
    for (let i = state.rocks.length - 1; i >= 0; i--) {
      const r = state.rocks[i];
      r.vy += GRAVITY * dt;
      r.x  += r.vx * dt;
      r.y  += r.vy * dt;
      const hit = checkRockCollision(r);
      if (hit) {
        resolveHit(r, hit);
        state.rocks.splice(i, 1);
      }
    }

    tickEnemyAI(now);

    // Win/lose by wall destruction: spec says first to destroy the
    // opposing catapult wins. But a wall at 0 hp also exposes the
    // catapult — no special handling needed; rocks pass through gaps.
    // We still update status text.
    if (state.winner) running = false;
  }

  // ---- Render -----------------------------------------------------------
  function clearBuf() {
    bctx.fillStyle = COL.sky;
    bctx.fillRect(0, 0, BUF_W, BUF_H);
    // Distant castle silhouettes — chunky, low-contrast.
    drawCastle(8, 30, +1);
    drawCastle(BUF_W - 8 - 28, 30, -1);
    // Ground band.
    bctx.fillStyle = COL.stone;
    bctx.fillRect(0, GROUND_Y, BUF_W, BUF_H - GROUND_Y);
    // Hairline ground top for crispness.
    bctx.fillStyle = COL.rule;
    bctx.fillRect(0, GROUND_Y - 1, BUF_W, 1);
  }

  function drawCastle(x, y, _facing) {
    // Three blocky merlons + a flag. Pure silhouette.
    bctx.fillStyle = COL.bg;
    bctx.fillRect(x,      y + 8, 28, 22);    // main body
    bctx.fillRect(x + 2,  y + 4, 4, 4);      // merlon
    bctx.fillRect(x + 12, y,     4, 8);      // taller merlon
    bctx.fillRect(x + 22, y + 4, 4, 4);      // merlon
    bctx.fillStyle = COL.wood;
    bctx.fillRect(x + 13, y - 4, 2, 4);      // flagpole
    bctx.fillRect(x + 14, y - 4, 4, 2);      // flag
  }

  function drawWall(wall, flashing) {
    const x = wall.x;
    const remaining = Math.max(0, wall.hp);
    // 3 bricks vertically — top brick goes first, then middle, then base.
    for (let i = 0; i < 3; i++) {
      const brickIdx = 2 - i;  // 2 = top, 0 = base
      const aliveCount = remaining;
      // Brick i (0=base) is alive if i < aliveCount.
      if (brickIdx >= 3 - aliveCount) {
        const by = WALL_TOP + i * BRICK_H;
        bctx.fillStyle = flashing ? COL.blood : COL.stone;
        bctx.fillRect(x, by, WALL_W, BRICK_H - 1);
        // Mortar lines (single dark column down the middle).
        bctx.fillStyle = COL.bg;
        bctx.fillRect(x + WALL_W / 2, by, 1, BRICK_H - 1);
        bctx.fillRect(x, by + BRICK_H - 1, WALL_W, 1);
      }
    }
  }

  function drawCatapult(cat, isPlayer) {
    const now = performance.now();
    const flashing = now < cat.flashUntil;
    const bodyColor = flashing ? COL.blood : COL.wood;

    // Base (chunky wood block).
    bctx.fillStyle = bodyColor;
    bctx.fillRect(cat.x - 5, P_BASE_Y, 10, 4);
    bctx.fillStyle = COL.bg;
    bctx.fillRect(cat.x - 5, P_BASE_Y + 3, 10, 1);

    // Wheels (two stone dots).
    bctx.fillStyle = COL.stone;
    bctx.fillRect(cat.x - 4, P_BASE_Y + 4, 2, 2);
    bctx.fillRect(cat.x + 2, P_BASE_Y + 4, 2, 2);

    if (cat.hp <= 0) return;

    // Arm: a line from pivot at (cat.x, P_BASE_Y - 1) out at `angle` in
    // the facing direction. We draw chunky 1-pixel steps so it stays in
    // the buffer's grain.
    const angle = currentArmAngle(cat);
    const dirSign = cat.dir;
    const px = cat.x;
    const py = P_BASE_Y - 1;
    bctx.fillStyle = bodyColor;
    for (let k = 0; k <= ARM_LEN; k++) {
      const ax = Math.round(px + Math.cos(angle) * k * dirSign);
      const ay = Math.round(py - Math.sin(angle) * k);
      bctx.fillRect(ax, ay, 1, 1);
    }
    // Bucket at tip (2x2 stone block).
    const tx = Math.round(px + Math.cos(angle) * ARM_LEN * dirSign);
    const ty = Math.round(py - Math.sin(angle) * ARM_LEN);
    bctx.fillStyle = COL.stone;
    bctx.fillRect(tx - 1, ty - 1, 2, 2);

    // Lock indicator: when locked, draw a small amber dot under the base
    // and a faint sight-line out along the arm so the player knows the
    // angle they will fire at.
    if (cat.locked && isPlayer) {
      bctx.fillStyle = COL.wood;
      bctx.fillRect(cat.x - 1, P_BASE_Y + 5, 2, 1);
      // Sight tick at projected mid-flight (small marker only).
      const sx = Math.round(px + Math.cos(angle) * (ARM_LEN + 5) * dirSign);
      const sy = Math.round(py - Math.sin(angle) * (ARM_LEN + 5));
      if (sx >= 0 && sx < BUF_W && sy >= 0 && sy < BUF_H) {
        bctx.fillRect(sx, sy, 1, 1);
      }
    }
  }

  function drawRocks() {
    bctx.fillStyle = COL.stone;
    for (const r of state.rocks) {
      const ix = Math.round(r.x), iy = Math.round(r.y);
      if (ix < 0 || ix >= BUF_W || iy < 0 || iy >= BUF_H) continue;
      bctx.fillRect(ix - 1, iy - 1, 2, 2);
    }
  }

  function drawHUD() {
    // HP bars: two short pips top-left/right, plus reload meter.
    // Each HP bar shows wall HP; an extra amber pip after it shows the
    // catapult HP (1 = alive). When a wall reaches 0, its pips go dark
    // and the amber catapult pip becomes the only thing standing — a
    // small visual signal that the catapult is now exposed.
    const wallMax = 3;
    // Player side (left).
    drawHPBar(2, 2, state.walls.player.hp, wallMax, COL.stone);
    bctx.fillStyle = state.player.hp > 0 ? COL.wood : COL.rule;
    bctx.fillRect(2 + wallMax * 4 + 1, 2, 3, 3);
    // Enemy side (right). Catapult pip first (leftmost), then wall pips.
    const enemyHpX = BUF_W - 2 - wallMax * 4;
    drawHPBar(enemyHpX, 2, state.walls.enemy.hp, wallMax, COL.stone);
    bctx.fillStyle = state.enemy.hp > 0 ? COL.blood : COL.rule;
    bctx.fillRect(enemyHpX - 4, 2, 3, 3);

    // Reload meter for the player (right under the bar).
    const now = performance.now();
    const rem = Math.max(0, state.player.reloadUntil - now);
    if (rem > 0) {
      const w = Math.round((rem / RELOAD_MS) * 10);
      bctx.fillStyle = COL.blood;
      bctx.fillRect(2, 7, w, 1);
    }

    // "Wall down — catapult exposed" cue: when the enemy wall hits 0,
    // draw a tiny amber tick over the enemy catapult so the player
    // immediately sees a clear path.
    if (state.walls.enemy.hp <= 0 && !state.winner) {
      bctx.fillStyle = COL.wood;
      bctx.fillRect(state.enemy.x - 1, WALL_TOP - 4, 3, 1);
    }
    if (state.walls.player.hp <= 0 && !state.winner) {
      bctx.fillStyle = COL.wood;
      bctx.fillRect(state.player.x - 1, WALL_TOP - 4, 3, 1);
    }
  }

  function drawHPBar(x, y, hp, max, color) {
    for (let i = 0; i < max; i++) {
      bctx.fillStyle = i < hp ? color : COL.rule;
      bctx.fillRect(x + i * 4, y, 3, 3);
    }
  }

  function render() {
    clearBuf();
    drawWall(state.walls.player, performance.now() < state.walls.player.flashUntil);
    drawWall(state.walls.enemy,  performance.now() < state.walls.enemy.flashUntil);
    drawCatapult(state.player, true);
    drawCatapult(state.enemy, false);
    drawRocks();
    drawHUD();

    // Blit buffer to visible canvas (upscaled, pixelated via CSS).
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = COL.sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.drawImage(buf, 0, 0, BUF_W, BUF_H, 0, 0, VIEW_W, VIEW_H);

    // End-of-game overlay text (drawn directly to the visible canvas at
    // human-readable size — the buffer is too chunky for prose).
    if (state.winner) {
      ctx.fillStyle = 'rgba(13,14,16,0.78)';
      ctx.fillRect(0, VIEW_H / 2 - 36, VIEW_W, 72);
      ctx.fillStyle = state.winner === 'p' ? COL.wood : COL.blood;
      ctx.font = '600 28px Iowan Old Style, Charter, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        state.winner === 'p' ? 'Smithereens.' : 'Your works are dust.',
        VIEW_W / 2, VIEW_H / 2 - 6
      );
      ctx.fillStyle = COL.fg;
      ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('Press Restart to duel again.', VIEW_W / 2, VIEW_H / 2 + 18);
    }
  }

  // ---- Frame loop -------------------------------------------------------
  function frame(ts) {
    if (destroyed) return;
    const dt = Math.min(0.05, (ts - lastT) / 1000 || 0);
    lastT = ts;
    if (running) step(dt);
    render();
    updateStatus();
    raf = requestAnimationFrame(frame);
  }

  function updateStatus() {
    if (!started) {
      status.textContent = 'Press Begin. Click the canvas first for keyboard control.';
      return;
    }
    if (state.winner === 'p') { status.textContent = 'You won. The enemy engine is matchsticks.'; return; }
    if (state.winner === 'e') { status.textContent = 'You lost. They reduced your catapult to smithereens.'; return; }
    const reloading = performance.now() < state.player.reloadUntil;
    const locked = state.player.locked;
    status.textContent = locked
      ? 'Locked. Release to fire.'
      : (reloading ? 'Reloading...' : 'Hold Space (or click) to lock the arm at the current angle.');
  }

  // ---- Input ------------------------------------------------------------
  // We roll our own press-and-hold instead of using lib/input.js's
  // holdTension, because that helper spawns its own internal rAF and we
  // already have one. Two animation loops would still work, but a single
  // owned loop keeps this iteration's idempotency story obvious.

  let spaceDown = false;
  let pointerDown = false;

  const onPointerDown = (ev) => {
    canvas.focus?.();
    if (!started) return;     // Begin must be pressed first
    if (state.winner) return;
    pointerDown = true;
    lockPlayerArm();
    ev.preventDefault?.();
  };
  const onPointerUp = (ev) => {
    if (!pointerDown) return;
    pointerDown = false;
    if (!spaceDown) releasePlayerArm();
    ev.preventDefault?.();
  };
  const onKeyDown = (ev) => {
    if (ev.code !== 'Space') return;
    if (!started || state.winner) return;
    if (ev.repeat) { ev.preventDefault(); return; }
    spaceDown = true;
    lockPlayerArm();
    ev.preventDefault();
  };
  const onKeyUp = (ev) => {
    if (ev.code !== 'Space') return;
    if (!spaceDown) return;
    spaceDown = false;
    if (!pointerDown) releasePlayerArm();
    ev.preventDefault();
  };

  function lockPlayerArm() {
    const p = state.player;
    if (p.locked) return;
    if (performance.now() < p.reloadUntil) return;
    p.locked = true;
    p.lockedAngle = currentArmAngle(p);
  }
  function releasePlayerArm() {
    const p = state.player;
    if (!p.locked) return;
    p.locked = false;
    fireFromPlayer();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);

  // ---- Begin / Restart --------------------------------------------------
  function startGame() {
    state = initState();
    scheduleNextEnemyShot(performance.now() + 800);   // brief grace period
    running = true;
    started = true;
    log.innerHTML = '';
    beginBtn.style.display = 'none';
    restartBtn.style.display = '';
    canvas.focus?.();
  }

  beginBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  // Initial render: draw an "idle" state so the canvas isn't blank
  // before the user clicks Begin. Use a placeholder state.
  state = initState();
  running = false;
  raf = requestAnimationFrame(frame);

  // ---- Cleanup ----------------------------------------------------------
  const cleanup = function cleanup() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    raf = 0;
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('pointerleave', onPointerUp);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('keyup', onKeyUp);
    if (rootEl.__smithereensCleanup === cleanup) {
      rootEl.__smithereensCleanup = null;
    }
    rootEl.innerHTML = '';
  };
  rootEl.__smithereensCleanup = cleanup;
  return cleanup;
}
