// 03-defender.js — Defender of the Crown (1986, Cinemaware, Amiga).
// Gesture preserved: analog pull-back tension. Hold to wind, release to fire.
// Launch angle is fixed by the catapult's geometry; the player aims by power only.
//
// Two views, one simulation: SIDE PROFILE (left) and OVER THE SHOULDER (right).
// The over-the-shoulder framing is the iconic Cinemaware shot — POV from behind
// the trebuchet, looking past the swinging arm into the distance at the wall.
// Both canvases render the same shared state every frame; the gesture binds to
// the widget container so a hold on either canvas (or anywhere in the widget)
// drives the same pull-back.

import { attachCanvas } from '../lib/canvas.js';
import { holdTension } from '../lib/input.js';

// ---- Shared world (side-view coordinate system, also used for collisions) ---
const W = 640;
const H = 400;

const GROUND_Y      = 360;                 // foreground horizon (catapult sits on this)
const WALL_BASE_Y   = 240;                 // bottom edge of wall band
const WALL_X        = 180;                 // left edge of wall band
const WALL_W        = 340;                 // wall band width
const WALL_COLS     = 12;
const WALL_ROWS     = 3;
const BRICK_W       = WALL_W / WALL_COLS;
const BRICK_H       = 26;
const WALL_TOP_Y    = WALL_BASE_Y - WALL_ROWS * BRICK_H;

const PIVOT_X       = 90;                  // catapult pivot location (side view)
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

// Approx distance from catapult to wall in world units (used to map x->depth in front view).
const WALL_DEPTH_X  = WALL_X + WALL_W / 2 - PIVOT_X;

// Color tokens — read from CSS vars at mount, fall back to literals.
function readTokens(rootEl) {
  const cs = getComputedStyle(rootEl);
  const get = (name, fallback) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    bg:      get('--bg',       '#0d0e10'),
    bgElev:  get('--bg-elev',  '#15171a'),
    fg:      get('--fg',       '#e6e1d4'),
    fgMuted: get('--fg-muted', '#8a8275'),
    rule:    get('--rule',     '#2a2c30'),
    amber:   get('--amber',    '#d4a256'),
    teal:    get('--teal',     '#5fb5b0'),
    blood:   get('--blood',    '#8a3a32'),
  };
}

export function mount(rootEl) {
  // Idempotency: nuke whatever was here.
  rootEl.innerHTML = '';

  const T = readTokens(rootEl);

  // ---- DOM scaffolding ----------------------------------------------------
  const wrap = document.createElement('div');
  wrap.className = 'defender-widget';
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;width:100%;';
  // The widget itself swallows the pull-back gesture — pointer-down on either
  // canvas (or the gap between them) winds the catapult.
  wrap.setAttribute('tabindex', '0');
  wrap.style.outline = 'none';
  rootEl.appendChild(wrap);

  // HUD strip above the stage.
  const hud = document.createElement('div');
  hud.style.cssText = [
    'display:flex','gap:14px','align-items:center','justify-content:space-between',
    'width:100%','max-width:720px','font-family:ui-monospace,Menlo,Consolas,monospace',
    'font-size:12px','color:' + T.fgMuted,'padding:4px 2px',
  ].join(';');
  wrap.appendChild(hud);

  const shotsEl    = document.createElement('span');
  const garrisonEl = document.createElement('span');
  const statusEl   = document.createElement('span');
  shotsEl.style.color = T.fg;
  garrisonEl.style.color = T.fg;
  statusEl.style.color  = T.amber;
  hud.append(shotsEl, garrisonEl, statusEl);

  // Stage: two canvases side-by-side, wraps on narrow screens.
  const stage = document.createElement('div');
  stage.style.cssText = [
    'display:flex','flex-direction:row','flex-wrap:wrap',
    'gap:14px','justify-content:center','align-items:flex-start',
    'width:100%','cursor:crosshair',
  ].join(';');
  wrap.appendChild(stage);

  // Each panel = caption + canvas, stacked vertically.
  const mkPanel = (caption) => {
    const panel = document.createElement('div');
    panel.style.cssText = [
      'display:flex','flex-direction:column','align-items:center','gap:6px',
      'flex:1 1 320px','min-width:280px','max-width:480px',
    ].join(';');
    const cap = document.createElement('div');
    cap.textContent = caption;
    cap.style.cssText = [
      'font-family:ui-monospace,Menlo,Consolas,monospace','font-size:11px',
      'letter-spacing:0.12em','color:' + T.fgMuted,'text-transform:uppercase',
    ].join(';');
    panel.appendChild(cap);
    return panel;
  };

  const sidePanel  = mkPanel('Side profile');
  const frontPanel = mkPanel('Over the shoulder');
  stage.append(sidePanel, frontPanel);

  // Both canvases: 640x400 internal, displayed responsively.
  const sideAttached  = attachCanvas(sidePanel,  { width: W, height: H });
  const frontAttached = attachCanvas(frontPanel, { width: W, height: H });
  const sideCanvas  = sideAttached.canvas;
  const sideCtx     = sideAttached.ctx;
  const frontCanvas = frontAttached.canvas;
  const frontCtx    = frontAttached.ctx;
  for (const c of [sideCanvas, frontCanvas]) {
    c.style.display    = 'block';
    c.style.width      = '100%';
    c.style.height     = 'auto';
    c.style.maxWidth   = '100%';
    c.style.cursor     = 'crosshair';
  }

  // Ammo selector + reset row, beneath the stage, applies to both views.
  const controls = document.createElement('div');
  controls.style.cssText = [
    'display:flex','gap:8px','align-items:center','justify-content:center',
    'flex-wrap:wrap','width:100%','max-width:720px',
    'font-family:ui-monospace,Menlo,Consolas,monospace','font-size:12px','padding:4px 0',
  ].join(';');
  wrap.appendChild(controls);

  const mkBtn = (label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = [
      'font:inherit','padding:4px 10px','background:' + T.bgElev,'color:' + T.fg,
      'border:1px solid ' + T.rule,'cursor:pointer','letter-spacing:0.04em',
    ].join(';');
    return b;
  };

  const btnBoulder = mkBtn('Boulder');
  const btnFire    = mkBtn('Greek fire');
  const btnDisease = mkBtn('Disease');
  const btnReset   = mkBtn('New siege');
  btnReset.style.marginLeft = '12px';
  btnReset.style.borderColor = T.teal;
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
      b.style.borderColor = (state.ammo === kind && !b.disabled) ? T.amber : T.rule;
    }
  }

  function refreshHud() {
    shotsEl.textContent    = 'shots: ' + (MAX_SHOTS - state.shotsFired) + ' / ' + MAX_SHOTS;
    garrisonEl.textContent = 'garrison: ' + Math.max(0, state.garrison);
    if (state.gameOver) {
      statusEl.textContent = state.won ? 'SIEGE WON' : 'SIEGE LOST';
      statusEl.style.color = state.won ? T.teal : T.blood;
    } else if (state.lastResult) {
      statusEl.textContent = state.lastResult;
      statusEl.style.color = T.amber;
    } else {
      statusEl.textContent = state.breached ? 'breach open' : 'breach the wall';
      statusEl.style.color = state.breached ? T.teal : T.fgMuted;
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
  // Bound to the WIDGET wrapper, not to a canvas, so a press on either view
  // (or in the gap between them) starts the same pull-back. Both canvases
  // and the wrap itself are focusable for the keyboard (Space) fallback.
  const cleanupTension = holdTension(wrap, {
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

  // ---- Step (pure simulation, view-agnostic) ------------------------------
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

  function ammoColor(kind) {
    if (kind === 'boulder') return T.fgMuted;
    if (kind === 'fire')    return T.amber;
    if (kind === 'disease') return T.teal;
    return T.fg;
  }

  // ---- Side-profile render (the original view) ----------------------------
  function drawSide(ctx) {
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
        ctx.fillStyle = (r + c) % 2 ? '#3a342c' : '#4a4135';
        ctx.fillRect(x + 1, y + 1, BRICK_W - 2, BRICK_H - 2);
        ctx.strokeStyle = '#15171a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, BRICK_W - 1, BRICK_H - 1);
      }
    }
    // Wall base line.
    ctx.strokeStyle = T.rule;
    ctx.beginPath();
    ctx.moveTo(WALL_X - 10, WALL_BASE_Y + 0.5);
    ctx.lineTo(WALL_X + WALL_W + 10, WALL_BASE_Y + 0.5);
    ctx.stroke();

    // Garrison badge above the wall.
    const badgeX = WALL_X + WALL_W - 70;
    const badgeY = WALL_TOP_Y - 28;
    ctx.fillStyle = T.bgElev;
    ctx.strokeStyle = T.blood;
    ctx.fillRect(badgeX, badgeY, 64, 20);
    ctx.strokeRect(badgeX + 0.5, badgeY + 0.5, 63, 19);
    ctx.fillStyle = T.fg;
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('GARR ' + Math.max(0, state.garrison), badgeX + 32, badgeY + 10);

    // Foreground ground band (catapult earth).
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = T.rule;
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
    ctx.fillStyle = T.bgElev;
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
    // Sling cup at tip.
    ctx.fillStyle = T.bgElev;
    ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI * 2); ctx.fill();
    if (!state.projectile && !state.gameOver) {
      ctx.fillStyle = ammoColor(state.ammo);
      ctx.beginPath(); ctx.arc(ax, ay, 4, 0, Math.PI * 2); ctx.fill();
    }

    // Pull-back power bar lower-left.
    const power = Math.min(1, state.arm.pullMs / PULL_FULL_MS);
    if (state.arm.pulling || power > 0.001) {
      const barX = 16, barY = H - 18, barW = 140, barH = 8;
      ctx.fillStyle = T.bgElev;
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = T.amber;
      ctx.fillRect(barX, barY, barW * power, barH);
      ctx.strokeStyle = T.rule;
      ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);
      ctx.fillStyle = T.fgMuted;
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
        ctx.strokeStyle = 'rgba(212,162,86,0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }

    // Frame.
    ctx.strokeStyle = T.amber;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Idle prompt.
    if (!state.projectile && !state.gameOver && !state.arm.pulling) {
      ctx.fillStyle = T.fgMuted;
      ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('hold mouse or SPACE — release to fire', W - 10, 8);
    }
    if (state.gameOver) {
      ctx.fillStyle = state.won ? T.teal : T.blood;
      ctx.font = 'bold 22px Iowan Old Style, Charter, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.won ? 'THE CROWN IS YOURS' : 'THE SIEGE BREAKS', W / 2, 80);
      ctx.fillStyle = T.fgMuted;
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('press "New siege" to play again', W / 2, 108);
    }
  }

  // ---- Over-the-shoulder render -------------------------------------------
  // Conceptual front view: viewer stands BEHIND the catapult. The arm rises
  // in the lower foreground; the wall sits at the horizon ~halfway up.
  // Foreshortening is faked: the arm is drawn as a thick stroke whose visible
  // length scales with the cosine of its world angle relative to the viewer
  // axis, so it appears "shorter" when extended toward/away from camera.
  // The projectile's world-x (distance toward the wall) is mapped to a depth
  // ratio used to (a) move the dot toward the vanishing point and (b) shrink
  // its radius. Bricks read as a small grid at the horizon.
  function drawFront(ctx) {
    // Background sky/ground split.
    const HORIZON = 230;       // y-line where wall sits in this view
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
    sky.addColorStop(0, '#1a1d24');
    sky.addColorStop(1, '#2a2128');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, HORIZON);
    ctx.fillStyle = '#1f1c19';
    ctx.fillRect(0, HORIZON, W, GROUND_Y - HORIZON);

    // Linear-perspective ground: two rails converging to a vanishing point
    // centered on the wall. Plus a few cross-ties to read as recession.
    const VPX = W / 2, VPY = HORIZON;
    ctx.strokeStyle = T.rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, GROUND_Y);  ctx.lineTo(VPX, VPY);
    ctx.moveTo(W - 40, GROUND_Y); ctx.lineTo(VPX, VPY);
    ctx.stroke();
    // Cross-ties (depth markers).
    for (const t of [0.25, 0.5, 0.75]) {
      const y = GROUND_Y + (VPY - GROUND_Y) * t;
      const left  = 40 + ((VPX - 40)       * t);
      const right = (W - 40) + ((VPX - (W - 40)) * t);
      ctx.strokeStyle = 'rgba(138,130,117,' + (0.18 - t * 0.12).toFixed(2) + ')';
      ctx.beginPath();
      ctx.moveTo(left, y); ctx.lineTo(right, y);
      ctx.stroke();
    }

    // Foreground ground band (just below the catapult).
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = T.rule;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 0.5); ctx.lineTo(W, GROUND_Y + 0.5);
    ctx.stroke();

    // --- The wall (distant) ------------------------------------------------
    // Wall band is 35% of canvas width, centered on the vanishing point.
    const fwallW = W * 0.35;
    const fwallX = VPX - fwallW / 2;
    const fbrickW = fwallW / WALL_COLS;
    const fbrickH = 14;                  // shorter than side view: distance compression
    const fwallTop = HORIZON - fbrickH * WALL_ROWS;
    for (let r = 0; r < WALL_ROWS; r++) {
      for (let c = 0; c < WALL_COLS; c++) {
        if (!state.bricks[r][c]) continue;
        const x = fwallX + c * fbrickW;
        const y = fwallTop + r * fbrickH;
        ctx.fillStyle = (r + c) % 2 ? '#3a342c' : '#4a4135';
        ctx.fillRect(x + 0.5, y + 0.5, fbrickW - 1, fbrickH - 1);
        ctx.strokeStyle = '#15171a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, fbrickW - 1, fbrickH - 1);
      }
    }
    // Wall base line.
    ctx.strokeStyle = T.rule;
    ctx.beginPath();
    ctx.moveTo(fwallX - 6, HORIZON + 0.5);
    ctx.lineTo(fwallX + fwallW + 6, HORIZON + 0.5);
    ctx.stroke();

    // Garrison badge above the wall.
    const gbX = fwallX + fwallW - 64;
    const gbY = fwallTop - 22;
    ctx.fillStyle = T.bgElev;
    ctx.strokeStyle = T.blood;
    ctx.fillRect(gbX, gbY, 60, 18);
    ctx.strokeRect(gbX + 0.5, gbY + 0.5, 59, 17);
    ctx.fillStyle = T.fg;
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('GARR ' + Math.max(0, state.garrison), gbX + 30, gbY + 9);

    // --- The catapult, from behind ----------------------------------------
    // Base: a trapezoidal silhouette in the lower foreground, viewed from
    // behind. Wider at the front (closer to viewer). Centered horizontally.
    const baseCX  = W / 2;
    const baseTop = GROUND_Y - 38;
    const baseHalfTop = 30;
    const baseHalfBot = 60;
    ctx.fillStyle = '#3a2f24';
    ctx.beginPath();
    ctx.moveTo(baseCX - baseHalfTop, baseTop);
    ctx.lineTo(baseCX + baseHalfTop, baseTop);
    ctx.lineTo(baseCX + baseHalfBot, GROUND_Y);
    ctx.lineTo(baseCX - baseHalfBot, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    // Wheels just visible on either side (axle ends).
    ctx.fillStyle = T.bgElev;
    ctx.beginPath(); ctx.arc(baseCX - baseHalfBot + 4, GROUND_Y - 6, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(baseCX + baseHalfBot - 4, GROUND_Y - 6, 7, 0, Math.PI * 2); ctx.fill();
    // Cross-beam at the top of the base (the axle the arm pivots on).
    ctx.strokeStyle = '#5a4a38';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(baseCX - baseHalfTop - 4, baseTop);
    ctx.lineTo(baseCX + baseHalfTop + 4, baseTop);
    ctx.stroke();

    // --- The arm (foreshortened) ------------------------------------------
    // World arm angle (in side-view space) is in [ARM_REST_ANG - ARM_PULL_MAX,
    // ARM_REST_ANG]. Map this to a foreshortening factor:
    //   pullT = 0 (rest, arm tilted forward toward the wall — away from camera)
    //   pullT = 1 (fully wound back, arm tilted toward camera)
    // We render the arm as a vertical-ish line rising from the pivot. Its
    // visible length scales with the projection: shorter when pointed away,
    // longer when pulled back toward us. We also bias the tip slightly down
    // (toward camera) when pulled back, to read as "leaning at us".
    const pullT = (ARM_REST_ANG - state.arm.angle) / ARM_PULL_MAX; // 0..1
    const ARM_BASE_LEN = 110;             // visible length at rest
    const ARM_REACH    = 40;              // extra length when pulled fully back
    const armVisLen = ARM_BASE_LEN + ARM_REACH * pullT;
    // When pulled back, tip leans toward camera (down-screen); at rest, leans
    // toward the wall (up-screen, toward horizon).
    const armLean   = (pullT - 0.4) * 28; // px, signed
    const armTipX = baseCX;
    const armTipY = baseTop - armVisLen + Math.max(0, armLean);
    ctx.strokeStyle = '#a88457';
    ctx.lineWidth = 8 + 4 * pullT;        // arm "swells" toward us as it pulls back
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(baseCX, baseTop);
    ctx.lineTo(armTipX, armTipY);
    ctx.stroke();
    // Sling cup at tip.
    ctx.fillStyle = T.bgElev;
    ctx.beginPath(); ctx.arc(armTipX, armTipY, 6 + 2 * pullT, 0, Math.PI * 2); ctx.fill();
    if (!state.projectile && !state.gameOver) {
      ctx.fillStyle = ammoColor(state.ammo);
      ctx.beginPath(); ctx.arc(armTipX, armTipY, 4 + 2 * pullT, 0, Math.PI * 2); ctx.fill();
    }

    // --- The projectile in flight, foreshortened --------------------------
    if (state.projectile) {
      const p = state.projectile;
      // Map world-x distance from pivot to depth ratio in [0,1] (0 = at us,
      // 1 = at wall). Clamp.
      const depth = Math.max(0, Math.min(1, (p.x - PIVOT_X) / WALL_DEPTH_X));
      // Lateral position: mostly stays near vanishing point. Tiny lateral
      // jitter to read as physical (we don't have a real lateral component;
      // the world is 2D). Keep it dead-center.
      const px = VPX;
      // Vertical: the side-view world y maps to a screen y between the
      // catapult tip (near camera) and the horizon (at wall). Above-wall
      // arc rises above HORIZON.
      // World y at launch ~= PIVOT_Y - ARM_LEN; world y at wall ~= WALL_TOP_Y..WALL_BASE_Y.
      // We use a simple linear interp from launch y to wall y by depth, then
      // overlay the arc rise: the higher the arc above wall_top, the higher
      // the dot floats above HORIZON.
      const launchScreenY = baseTop - 30;
      const wallScreenY   = HORIZON;
      const baseY = launchScreenY + (wallScreenY - launchScreenY) * depth;
      // Arc lift: how far above the side-view wall-top the projectile is.
      const arcLift = Math.max(0, (WALL_TOP_Y - p.y));   // px above wall top
      const py = baseY - arcLift * (0.45 + 0.35 * (1 - depth));
      // Radius: shrink with depth.
      const r0 = p.kind === 'boulder' ? 7 : 6;
      const r  = Math.max(1.5, r0 * (1 - 0.75 * depth));
      ctx.fillStyle = ammoColor(p.kind);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      if (p.kind === 'fire') {
        ctx.strokeStyle = 'rgba(212,162,86,0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Trail goes back toward the catapult tip (less depth = more visible).
        ctx.moveTo(px, py + 4 + 6 * (1 - depth));
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }

    // --- HUD overlays -----------------------------------------------------
    // Power bar mirrors the side view (for parity).
    const power = Math.min(1, state.arm.pullMs / PULL_FULL_MS);
    if (state.arm.pulling || power > 0.001) {
      const barX = 16, barY = H - 18, barW = 140, barH = 8;
      ctx.fillStyle = T.bgElev;
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = T.amber;
      ctx.fillRect(barX, barY, barW * power, barH);
      ctx.strokeStyle = T.rule;
      ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);
      ctx.fillStyle = T.fgMuted;
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('PULL', barX, barY - 4);
    }

    // Frame.
    ctx.strokeStyle = T.amber;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    if (!state.projectile && !state.gameOver && !state.arm.pulling) {
      ctx.fillStyle = T.fgMuted;
      ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('press anywhere — hold to wind', W - 10, 8);
    }
    if (state.gameOver) {
      ctx.fillStyle = state.won ? T.teal : T.blood;
      ctx.font = 'bold 22px Iowan Old Style, Charter, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.won ? 'THE CROWN IS YOURS' : 'THE SIEGE BREAKS', W / 2, 80);
      ctx.fillStyle = T.fgMuted;
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('press "New siege" to play again', W / 2, 108);
    }
  }

  // ---- Render loop --------------------------------------------------------
  let raf = 0;
  let lastT = performance.now();

  function loop(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    step(dt);
    drawSide(sideCtx);
    drawFront(frontCtx);
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
