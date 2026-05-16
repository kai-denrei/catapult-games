// 03-defender.js — Defender of the Crown (1986, Cinemaware, Amiga).
// Gesture preserved: analog pull-back tension. Hold to wind, release to fire.
// Launch angle is fixed by the catapult's geometry; the player aims by power only.

import { attachCanvas } from '../lib/canvas.js';
import { holdTension } from '../lib/input.js';

const W = 640;
const H = 400;

// World tuning. All units are CSS pixels and seconds.
const GROUND_Y      = 360;                 // foreground horizon (catapult sits on this)
const WALL_BASE_Y   = 240;                 // bottom edge of wall band
const WALL_X        = 180;                 // left edge of wall band
const WALL_W        = 340;                 // wall band width
const WALL_COLS     = 12;
const WALL_ROWS     = 3;
const BRICK_W       = WALL_W / WALL_COLS;
const BRICK_H       = 26;
const WALL_TOP_Y    = WALL_BASE_Y - WALL_ROWS * BRICK_H;

const PIVOT_X       = 90;                  // catapult pivot location
const PIVOT_Y       = GROUND_Y - 18;
const ARM_LEN       = 70;
const ARM_REST_ANG  = -Math.PI / 2 - 0.35; // arm starts up-and-slightly-back (cocked-ready)
const ARM_PULL_MAX  = 0.95;                // additional radians the arm rotates back while held
const PULL_FULL_MS  = 1500;                // hold this long for max power
const LAUNCH_ANGLE  = (58 * Math.PI) / 180;// FIXED: degrees above horizontal at release

const V_MIN         = 200;                 // px/s at zero pull
const V_MAX         = 560;                 // px/s at full pull
const GRAVITY       = 900;                 // px/s^2

const MAX_SHOTS     = 6;
const GARRISON_MAX  = 100;
const FIRE_DAMAGE   = 22;                  // Greek fire base damage to garrison
// Disease damage scales with how early it is used. Index 0 = first shot.
const DISEASE_DAMAGE_BY_INDEX = [70, 60, 48, 34, 22, 12];

export function mount(rootEl) {
  // Idempotency: nuke whatever was here.
  rootEl.innerHTML = '';

  // ---- DOM scaffolding ----------------------------------------------------
  const wrap = document.createElement('div');
  wrap.className = 'defender-widget';
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';
  rootEl.appendChild(wrap);

  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;display:inline-block;';
  wrap.appendChild(stage);

  const { canvas, ctx } = attachCanvas(stage, { width: W, height: H });
  canvas.style.cursor = 'crosshair';
  canvas.style.display = 'block';

  // HUD strip above the canvas (drawn in DOM so it's accessible / selectable).
  const hud = document.createElement('div');
  hud.style.cssText = [
    'display:flex','gap:14px','align-items:center','justify-content:space-between',
    'width:' + W + 'px','font-family:ui-monospace,Menlo,Consolas,monospace',
    'font-size:12px','color:#8a8275','padding:4px 2px',
  ].join(';');
  wrap.insertBefore(hud, stage);

  const shotsEl    = document.createElement('span');
  const garrisonEl = document.createElement('span');
  const statusEl   = document.createElement('span');
  shotsEl.style.color = '#e6e1d4';
  garrisonEl.style.color = '#e6e1d4';
  statusEl.style.color  = '#d4a256';
  hud.append(shotsEl, garrisonEl, statusEl);

  // Ammo selector + reset row.
  const controls = document.createElement('div');
  controls.style.cssText = [
    'display:flex','gap:8px','align-items:center','justify-content:center',
    'width:' + W + 'px','font-family:ui-monospace,Menlo,Consolas,monospace',
    'font-size:12px','padding:4px 0',
  ].join(';');
  wrap.appendChild(controls);

  const mkBtn = (label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = [
      'font:inherit','padding:4px 10px','background:#15171a','color:#e6e1d4',
      'border:1px solid #2a2c30','cursor:pointer','letter-spacing:0.04em',
    ].join(';');
    return b;
  };

  const btnBoulder = mkBtn('Boulder');
  const btnFire    = mkBtn('Greek fire');
  const btnDisease = mkBtn('Disease');
  const btnReset   = mkBtn('New siege');
  btnReset.style.marginLeft = '12px';
  btnReset.style.borderColor = '#5fb5b0';
  controls.append(btnBoulder, btnFire, btnDisease, btnReset);

  // ---- Game state ---------------------------------------------------------
  let state;

  function freshState() {
    // Brick grid: bricks[row][col] = true if standing.
    const bricks = Array.from({ length: WALL_ROWS }, () =>
      Array.from({ length: WALL_COLS }, () => true));
    return {
      shotsFired: 0,
      garrison:   GARRISON_MAX,
      ammo:       'boulder',
      bricks,
      breached:   false,         // sticky: once true, fire/disease unlock
      arm: { angle: ARM_REST_ANG, pulling: false, pullMs: 0 },
      projectile: null,          // { x, y, vx, vy, kind } while in flight
      lastResult: '',            // ephemeral message under HUD
      gameOver: false,
      won: false,
    };
  }

  function refreshControls() {
    btnFire.disabled    = !state.breached || state.gameOver || state.projectile;
    btnDisease.disabled = !state.breached || state.gameOver || state.projectile;
    btnBoulder.disabled = state.gameOver || !!state.projectile;
    const dim = (b) => { b.style.opacity = b.disabled ? '0.35' : '1'; };
    [btnBoulder, btnFire, btnDisease].forEach(dim);
    // Highlight current selection.
    for (const [b, kind] of [[btnBoulder,'boulder'],[btnFire,'fire'],[btnDisease,'disease']]) {
      b.style.borderColor = (state.ammo === kind && !b.disabled) ? '#d4a256' : '#2a2c30';
    }
  }

  function refreshHud() {
    shotsEl.textContent    = 'shots: ' + (MAX_SHOTS - state.shotsFired) + ' / ' + MAX_SHOTS;
    garrisonEl.textContent = 'garrison: ' + Math.max(0, state.garrison);
    if (state.gameOver) {
      statusEl.textContent = state.won ? 'SIEGE WON' : 'SIEGE LOST';
      statusEl.style.color = state.won ? '#5fb5b0' : '#8a3a32';
    } else if (state.lastResult) {
      statusEl.textContent = state.lastResult;
      statusEl.style.color = '#d4a256';
    } else {
      statusEl.textContent = state.breached ? 'breach open' : 'breach the wall';
      statusEl.style.color = state.breached ? '#5fb5b0' : '#8a8275';
    }
  }

  function selectAmmo(kind) {
    if (state.gameOver || state.projectile) return;
    if ((kind === 'fire' || kind === 'disease') && !state.breached) return;
    state.ammo = kind;
    refreshControls();
  }

  btnBoulder.addEventListener('click', () => selectAmmo('boulder'));
  btnFire.addEventListener('click',    () => selectAmmo('fire'));
  btnDisease.addEventListener('click', () => selectAmmo('disease'));
  btnReset.addEventListener('click',   () => { state = freshState(); refreshControls(); refreshHud(); });

  // ---- Pull-back gesture --------------------------------------------------
  const cleanupTension = holdTension(canvas, {
    onStart: () => {
      if (state.gameOver || state.projectile) return;
      state.arm.pulling = true;
      state.arm.pullMs = 0;
      state.arm.angle = ARM_REST_ANG;
    },
    onUpdate: (ms) => {
      if (!state.arm.pulling) return;
      const t = Math.min(1, ms / PULL_FULL_MS);
      state.arm.pullMs = ms;
      // Arm rotates back (more negative / further from launch direction) as we wind.
      state.arm.angle = ARM_REST_ANG - ARM_PULL_MAX * t;
    },
    onRelease: (ms) => {
      if (!state.arm.pulling) return;
      state.arm.pulling = false;
      if (state.gameOver || state.projectile) {
        state.arm.angle = ARM_REST_ANG;
        return;
      }
      // Linear power mapping: pullback duration -> [V_MIN, V_MAX].
      const power = Math.min(1, ms / PULL_FULL_MS);
      const v     = V_MIN + (V_MAX - V_MIN) * power;
      fire(v);
      // Snap arm back to rest immediately; the catapult re-cocks for next shot.
      state.arm.angle = ARM_REST_ANG;
    },
  });

  function fire(v) {
    // Launch point = tip of the arm at rest angle (just after release).
    const launchX = PIVOT_X + Math.cos(ARM_REST_ANG) * ARM_LEN;
    const launchY = PIVOT_Y + Math.sin(ARM_REST_ANG) * ARM_LEN;
    // Fixed angle, positive vx (toward wall on the right).
    const vx =  v * Math.cos(LAUNCH_ANGLE);
    const vy = -v * Math.sin(LAUNCH_ANGLE);
    state.projectile = {
      x: launchX, y: launchY, vx, vy,
      kind: state.ammo,
      shotIndex: state.shotsFired,   // 0..MAX_SHOTS-1
    };
    state.lastResult = '';
    refreshControls();
  }

  // ---- Impact resolution --------------------------------------------------
  function brickAt(x, y) {
    if (x < WALL_X || x >= WALL_X + WALL_W) return null;
    if (y < WALL_TOP_Y || y >= WALL_BASE_Y) return null;
    const col = Math.floor((x - WALL_X) / BRICK_W);
    const row = Math.floor((y - WALL_TOP_Y) / BRICK_H);
    if (col < 0 || col >= WALL_COLS || row < 0 || row >= WALL_ROWS) return null;
    return { col, row };
  }

  function recomputeBreach() {
    if (state.breached) return;
    for (let c = 0; c < WALL_COLS; c++) {
      let empty = true;
      for (let r = 0; r < WALL_ROWS; r++) {
        if (state.bricks[r][c]) { empty = false; break; }
      }
      if (empty) { state.breached = true; return; }
    }
  }

  function wallStanding() {
    for (let r = 0; r < WALL_ROWS; r++)
      for (let c = 0; c < WALL_COLS; c++)
        if (state.bricks[r][c]) return true;
    return false;
  }

  function applyImpact(p) {
    let removed = 0;
    if (p.kind === 'boulder') {
      // Knock out the hit brick plus its immediate vertical neighbour if grazing.
      const hit = brickAt(p.x, p.y);
      if (hit) {
        if (state.bricks[hit.row][hit.col]) { state.bricks[hit.row][hit.col] = false; removed++; }
        // 50% chance a neighbour-by-position above also chips if the boulder is fast.
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > 400) {
          const r2 = hit.row - 1;
          if (r2 >= 0 && state.bricks[r2][hit.col]) { state.bricks[r2][hit.col] = false; removed++; }
        }
      }
      recomputeBreach();
      state.lastResult = removed ? ('boulder: -' + removed + ' brick' + (removed>1?'s':'')) : 'boulder: glancing blow';
    } else if (p.kind === 'fire') {
      // Greek fire ignites the garrison. Only effective if the shot enters the
      // wall band (i.e. the projectile got there at all).
      if (p.x >= WALL_X - 8 && p.x <= WALL_X + WALL_W + 8) {
        state.garrison -= FIRE_DAMAGE;
        state.lastResult = 'Greek fire: -' + FIRE_DAMAGE + ' garrison';
      } else {
        state.lastResult = 'Greek fire: fell short';
      }
    } else if (p.kind === 'disease') {
      if (p.x >= WALL_X - 8 && p.x <= WALL_X + WALL_W + 8) {
        const dmg = DISEASE_DAMAGE_BY_INDEX[p.shotIndex] ?? 10;
        state.garrison -= dmg;
        state.lastResult = 'disease: -' + dmg + ' garrison';
      } else {
        state.lastResult = 'disease: fell short';
      }
    }
  }

  function endShot() {
    state.shotsFired++;
    state.projectile = null;
    // Win conditions.
    if (state.garrison <= 0) { state.gameOver = true; state.won = true; }
    else if (!wallStanding()) { state.gameOver = true; state.won = true; }
    else if (state.shotsFired >= MAX_SHOTS) { state.gameOver = true; state.won = false; }
    refreshControls();
    refreshHud();
  }

  // ---- Render loop --------------------------------------------------------
  let raf = 0;
  let lastT = performance.now();

  function step(dt) {
    if (!state.projectile) return;
    const p = state.projectile;
    p.vy += GRAVITY * dt;
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;

    // Collision with wall band (test in mid-band).
    if (p.x >= WALL_X && p.x <= WALL_X + WALL_W &&
        p.y >= WALL_TOP_Y && p.y <= WALL_BASE_Y) {
      const hit = brickAt(p.x, p.y);
      if (hit && state.bricks[hit.row][hit.col]) {
        applyImpact(p);
        endShot();
        return;
      }
    }
    // Past the wall, off canvas, or ground.
    if (p.y >= GROUND_Y || p.x > W + 20 || p.x < -20) {
      applyImpact(p);   // may still credit fire/disease if it cleared
      endShot();
      return;
    }
  }

  function draw() {
    // Sky gradient (deep dusk).
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, '#1a1d24');
    sky.addColorStop(1, '#2a2128');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Distant ground plane (flat amber haze under the wall).
    ctx.fillStyle = '#1f1c19';
    ctx.fillRect(0, WALL_BASE_Y, W, GROUND_Y - WALL_BASE_Y);

    // Wall: bricks.
    for (let r = 0; r < WALL_ROWS; r++) {
      for (let c = 0; c < WALL_COLS; c++) {
        if (!state.bricks[r][c]) continue;
        const x = WALL_X + c * BRICK_W;
        const y = WALL_TOP_Y + r * BRICK_H;
        // Slight stagger of mortar shade per row for legibility.
        ctx.fillStyle = (r + c) % 2 ? '#3a342c' : '#4a4135';
        ctx.fillRect(x + 1, y + 1, BRICK_W - 2, BRICK_H - 2);
        ctx.strokeStyle = '#15171a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, BRICK_W - 1, BRICK_H - 1);
      }
    }
    // Wall base line.
    ctx.strokeStyle = '#2a2c30';
    ctx.beginPath();
    ctx.moveTo(WALL_X - 10, WALL_BASE_Y + 0.5);
    ctx.lineTo(WALL_X + WALL_W + 10, WALL_BASE_Y + 0.5);
    ctx.stroke();

    // Garrison badge above the wall.
    const badgeX = WALL_X + WALL_W - 70;
    const badgeY = WALL_TOP_Y - 28;
    ctx.fillStyle = '#15171a';
    ctx.strokeStyle = '#8a3a32';
    ctx.fillRect(badgeX, badgeY, 64, 20);
    ctx.strokeRect(badgeX + 0.5, badgeY + 0.5, 63, 19);
    ctx.fillStyle = '#e6e1d4';
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('GARR ' + Math.max(0, state.garrison), badgeX + 32, badgeY + 10);

    // Foreground ground band (catapult earth).
    ctx.fillStyle = '#0d0e10';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = '#2a2c30';
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 0.5);
    ctx.lineTo(W, GROUND_Y + 0.5);
    ctx.stroke();

    // Catapult base (wedge + wheels).
    ctx.fillStyle = '#3a2f24';
    ctx.beginPath();
    ctx.moveTo(PIVOT_X - 38, GROUND_Y);
    ctx.lineTo(PIVOT_X + 26, GROUND_Y);
    ctx.lineTo(PIVOT_X + 10, PIVOT_Y);
    ctx.lineTo(PIVOT_X - 22, PIVOT_Y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#15171a';
    ctx.beginPath(); ctx.arc(PIVOT_X - 26, GROUND_Y - 4, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(PIVOT_X + 14, GROUND_Y - 4, 7, 0, Math.PI * 2); ctx.fill();

    // Catapult arm.
    const ax = PIVOT_X + Math.cos(state.arm.angle) * ARM_LEN;
    const ay = PIVOT_Y + Math.sin(state.arm.angle) * ARM_LEN;
    ctx.strokeStyle = '#a88457';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(PIVOT_X, PIVOT_Y);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    // Sling cup at tip — only show ammo there when not yet fired (pre-release).
    ctx.fillStyle = '#15171a';
    ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI * 2); ctx.fill();
    if (!state.projectile && !state.gameOver) {
      ctx.fillStyle = ammoColor(state.ammo);
      ctx.beginPath(); ctx.arc(ax, ay, 4, 0, Math.PI * 2); ctx.fill();
    }

    // Pull-back tension indicator (arc + bar) — visual feedback for the gesture.
    const power = Math.min(1, state.arm.pullMs / PULL_FULL_MS);
    if (state.arm.pulling || power > 0.001) {
      // Power bar lower-left.
      const barX = 16, barY = H - 18, barW = 140, barH = 8;
      ctx.fillStyle = '#15171a';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#d4a256';
      ctx.fillRect(barX, barY, barW * power, barH);
      ctx.strokeStyle = '#2a2c30';
      ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);
      ctx.fillStyle = '#8a8275';
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('PULL', barX, barY - 4);
    }

    // Projectile.
    if (state.projectile) {
      const p = state.projectile;
      ctx.fillStyle = ammoColor(p.kind);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.kind === 'boulder' ? 6 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (p.kind === 'fire') {
        // Trailing flame: short fading streak behind the projectile.
        ctx.strokeStyle = 'rgba(212,162,86,0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }

    // Frame.
    ctx.strokeStyle = '#d4a256';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Idle prompt.
    if (!state.projectile && !state.gameOver && !state.arm.pulling) {
      ctx.fillStyle = '#8a8275';
      ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('hold mouse or SPACE on canvas — release to fire', W - 10, 8);
    }
    if (state.gameOver) {
      ctx.fillStyle = state.won ? '#5fb5b0' : '#8a3a32';
      ctx.font = 'bold 22px Iowan Old Style, Charter, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.won ? 'THE CROWN IS YOURS' : 'THE SIEGE BREAKS', W / 2, 80);
      ctx.fillStyle = '#8a8275';
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('press "New siege" to play again', W / 2, 108);
    }
  }

  function ammoColor(kind) {
    if (kind === 'boulder') return '#8a8275';
    if (kind === 'fire')    return '#d4a256';
    if (kind === 'disease') return '#5fb5b0';
    return '#e6e1d4';
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  // ---- Boot ---------------------------------------------------------------
  state = freshState();
  refreshControls();
  refreshHud();
  raf = requestAnimationFrame((t) => { lastT = t; loop(t); });

  // ---- Cleanup ------------------------------------------------------------
  return function cleanup() {
    cancelAnimationFrame(raf);
    cleanupTension();
    rootEl.innerHTML = '';
  };
}
