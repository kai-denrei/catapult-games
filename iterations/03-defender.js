// 03-defender.js — Defender of the Crown (1986, Cinemaware, Amiga).
// Gesture preserved: analog pull-back tension. Hold to wind, release to fire.
// Launch angle is fixed by the catapult's geometry; the player aims by power only.
//
// Two INDEPENDENT games, side by side:
//   SIDE PROFILE  — the original siege: 6 shots, 3 ammo types, breach the wall.
//   SAXON CASTLE  — over-the-shoulder column-knock: 6 shots, boulder only,
//                   destroy any single vertical column (3 hits) to win.
//
// Each panel has its own state, controls, pull-back gesture and win/lose loop.
// One rAF loop drives both. mount(rootEl) is idempotent — a second call tears
// down all listeners and rebuilds cleanly.

import { attachCanvas } from '../lib/canvas.js';
import { holdTension } from '../lib/input.js';

// ---- Canvas dimensions (shared) -----------------------------------------
const W = 640;
const H = 400;

// ---- Side-view world (collision space for the SIDE game) ----------------
const GROUND_Y      = 360;
const WALL_BASE_Y   = 240;
const WALL_X        = 180;
const WALL_W        = 340;
const SIDE_COLS     = 12;
const SIDE_ROWS     = 3;
const SIDE_BRICK_W  = WALL_W / SIDE_COLS;
const SIDE_BRICK_H  = 26;
const WALL_TOP_Y    = WALL_BASE_Y - SIDE_ROWS * SIDE_BRICK_H;

const PIVOT_X       = 90;
const PIVOT_Y       = GROUND_Y - 18;
const ARM_LEN       = 70;
const ARM_REST_ANG  = -Math.PI / 2 - 0.35;
const ARM_PULL_MAX  = 0.95;
const PULL_FULL_MS  = 1500;
const LAUNCH_ANGLE  = (58 * Math.PI) / 180;

const V_MIN         = 200;
const V_MAX         = 560;
const GRAVITY       = 900;

// ---- Side game rules ----------------------------------------------------
const SIDE_MAX_SHOTS  = 6;
const GARRISON_MAX    = 100;
const FIRE_DAMAGE     = 22;
const DISEASE_DAMAGE_BY_INDEX = [70, 60, 48, 34, 22, 12];

// ---- Front game rules ---------------------------------------------------
const FRONT_MAX_SHOTS = 6;
const FRONT_COLS      = 8;
const FRONT_ROWS      = 4;
const HITS_TO_FELL    = 3;       // hits to punch through the single column (3 bricks deep)
// Sweet-spot aiming: a hit requires launchR to be within tolerance of SWEET_R.
const FRONT_SWEET_R   = 22;      // ideal pull-back radius (px) for a clean hit
const FRONT_SWEET_TOL = 7;       // ±7px tolerance window — wider now that the player has visible preview
// --- Front-view artillery ballistics (screen-space, no world units) ------
// Gravity in screen px/s^2. Tuned so a launchR=FRONT_SWEET_R shot peaks
// ~35-45px above the target column row and lands square on its mid-height.
const FRONT_GRAVITY    = 600;
// Initial launch speed (px/s) scales linearly with pullback radius. At
// launchR=22 (sweet) → ~396 px/s total launch speed; min launchR=6 → 108;
// max launchR=30 → 540. The target column sits ~96px above the launch
// point, so the shot needs serious upward velocity to reach it.
const FRONT_SPEED_PER_R = 18;
// Launch direction: mostly upward, slightly forward toward the target column.
// 87° from horizontal (i.e. nearly vertical) gives the characteristic
// high-angle artillery arc we want in OTS view — target is mostly UP.
const FRONT_LAUNCH_ANG = (87 * Math.PI) / 180;
// Safety cap on flight time, so a wildly overshooting shot doesn't hang.
const FRONT_FLIGHT_MAX_MS = 2200;
// Trajectory preview during pullback.
const PREVIEW_DOT_COUNT  = 14;       // dots along the predicted arc
const PREVIEW_DOT_R      = 2.2;      // dot radius (px)
const PREVIEW_TIME_STEP  = 0.08;     // seconds between sampled dots (~1.12s of arc coverage)

// ---- Color tokens -------------------------------------------------------
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

// =========================================================================
// MOUNT
// =========================================================================
export function mount(rootEl) {
  // Idempotency.
  rootEl.innerHTML = '';

  const T = readTokens(rootEl);

  // ---- DOM scaffolding --------------------------------------------------
  const stage = document.createElement('div');
  stage.className = 'iter-stage';
  stage.style.cssText = [
    'display:flex','flex-direction:row','flex-wrap:wrap',
    'gap:14px','justify-content:center','align-items:flex-start',
    'width:100%',
  ].join(';');
  rootEl.appendChild(stage);

  const sideRefs  = buildPanel(stage, T, 'iter-panel--side',  'SIDE PROFILE');
  const frontRefs = buildPanel(stage, T, 'iter-panel--front', 'SAXON CASTLE');

  // ---- Build the two games ----------------------------------------------
  const sideGame  = createSideGame(sideRefs, T);
  const frontGame = createFrontGame(frontRefs, T);

  // ---- Render loop (single rAF, both games ticked & drawn) --------------
  let raf = 0;
  let lastT = performance.now();

  function loop(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    sideGame.step(dt);
    frontGame.step(dt);
    sideGame.draw();
    frontGame.draw();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame((t) => { lastT = t; loop(t); });

  // ---- Cleanup ----------------------------------------------------------
  return function cleanup() {
    cancelAnimationFrame(raf);
    sideGame.cleanup();
    frontGame.cleanup();
    rootEl.innerHTML = '';
  };
}

// =========================================================================
// PANEL BUILDER — caption + canvas + controls container
// =========================================================================
function buildPanel(stage, T, modifier, caption) {
  const panel = document.createElement('div');
  panel.className = 'iter-panel ' + modifier;
  panel.style.cssText = [
    'display:flex','flex-direction:column','align-items:stretch','gap:6px',
    'flex:1 1 320px','min-width:280px','max-width:480px',
  ].join(';');

  const cap = document.createElement('div');
  cap.className = 'iter-cap mono';
  cap.textContent = caption;
  cap.style.cssText = [
    'font-family:ui-monospace,Menlo,Consolas,monospace','font-size:11px',
    'letter-spacing:0.12em','color:' + T.fgMuted,'text-transform:uppercase',
    'text-align:center',
  ].join(';');
  panel.appendChild(cap);

  // Canvas wrapper — separately so the canvas can size to it.
  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'width:100%;';
  panel.appendChild(canvasWrap);

  const attached = attachCanvas(canvasWrap, { width: W, height: H });
  const canvas = attached.canvas;
  const ctx = attached.ctx;
  canvas.style.display  = 'block';
  canvas.style.width    = '100%';
  canvas.style.height   = 'auto';
  canvas.style.maxWidth = '100%';
  canvas.style.cursor   = 'crosshair';
  canvas.style.outline  = 'none';

  // Controls row, beneath the canvas.
  const controls = document.createElement('div');
  controls.style.cssText = [
    'display:flex','gap:6px','align-items:center','justify-content:center',
    'flex-wrap:wrap','width:100%',
    'font-family:ui-monospace,Menlo,Consolas,monospace','font-size:12px',
    'padding:4px 0','color:' + T.fgMuted,
  ].join(';');
  panel.appendChild(controls);

  stage.appendChild(panel);
  return { panel, canvas, ctx, controls };
}

function mkButton(label, T) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = [
    'font:inherit','padding:4px 10px','background:' + T.bgElev,'color:' + T.fg,
    'border:1px solid ' + T.rule,'cursor:pointer','letter-spacing:0.04em',
  ].join(';');
  return b;
}

function ammoColor(kind, T) {
  if (kind === 'boulder') return T.fgMuted;
  if (kind === 'fire')    return T.amber;
  if (kind === 'disease') return T.teal;
  return T.fg;
}

// =========================================================================
// SIDE GAME — the original 1986 siege
// =========================================================================
function createSideGame(refs, T) {
  const { canvas, ctx, controls, panel } = refs;

  // ---- Controls ---------------------------------------------------------
  const btnBoulder = mkButton('Boulder', T);
  const btnFire    = mkButton('Greek fire', T);
  const btnDisease = mkButton('Disease', T);
  const btnReset   = mkButton('New siege', T);
  btnReset.style.marginLeft  = '8px';
  btnReset.style.borderColor = T.teal;
  controls.append(btnBoulder, btnFire, btnDisease, btnReset);

  // ---- Mobile power + fire panel (below the ammo selector) -------------
  // Pullback gesture still works on its own; this is an additive control
  // surface so mobile players can dial in a repeatable power instead of
  // estimating pull duration. FIRE launches at the slider value using the
  // same fire() path that release-of-pullback uses.
  let sidePowerValue = 50;             // 0..100, displayed in .ctrl-value
  const mobilePanel = document.createElement('div');
  mobilePanel.className = 'iter-controls';
  const powerRow = document.createElement('div');
  powerRow.className = 'ctrl-row';
  const powerLabel = document.createElement('label');
  powerLabel.className = 'ctrl-label';
  powerLabel.textContent = 'POWER';
  const sideStepDefs = [
    { step: -10, label: '−10' },   // unicode minus
    { step:  -5, label: '−5'  },
    { step:  +5, label: '+5'  },
    { step: +10, label: '+10' },
  ];
  const sideStepBtns = [];
  const sideValueEl = document.createElement('span');
  sideValueEl.className = 'ctrl-value';
  sideValueEl.setAttribute('data-power-value', '');
  sideValueEl.textContent = String(sidePowerValue);
  powerRow.appendChild(powerLabel);
  // Insert the negative steps before the value display, positive after.
  sideStepDefs.filter((d) => d.step < 0).forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctrl-step';
    b.dataset.step = String(d.step);
    b.textContent = d.label;
    b.setAttribute('aria-label', 'Decrease power by ' + Math.abs(d.step));
    powerRow.appendChild(b);
    sideStepBtns.push(b);
  });
  powerRow.appendChild(sideValueEl);
  sideStepDefs.filter((d) => d.step > 0).forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctrl-step';
    b.dataset.step = String(d.step);
    b.textContent = d.label;
    b.setAttribute('aria-label', 'Increase power by ' + d.step);
    powerRow.appendChild(b);
    sideStepBtns.push(b);
  });
  mobilePanel.appendChild(powerRow);

  const sideFireBtn = document.createElement('button');
  sideFireBtn.type = 'button';
  sideFireBtn.className = 'ctrl-fire';
  sideFireBtn.textContent = 'FIRE';
  sideFireBtn.setAttribute('aria-label', 'Fire at the displayed power');
  mobilePanel.appendChild(sideFireBtn);
  // Mount the mobile panel onto the panel (below the existing controls row).
  panel.appendChild(mobilePanel);

  function setSidePower(v) {
    sidePowerValue = Math.max(0, Math.min(100, Math.round(v)));
    sideValueEl.textContent = String(sidePowerValue);
  }
  const sideStepHandlers = sideStepBtns.map((b) => {
    const fn = () => setSidePower(sidePowerValue + Number(b.dataset.step));
    b.addEventListener('click', fn);
    return [b, fn];
  });
  const onSideFire = () => {
    if (state.gameOver || state.projectile || state.arm.pulling) return;
    const power = sidePowerValue / 100;
    const v = V_MIN + (V_MAX - V_MIN) * power;
    fire(v);
  };
  sideFireBtn.addEventListener('click', onSideFire);

  // ---- State ------------------------------------------------------------
  let state;
  function freshState() {
    return {
      shotsFired: 0,
      garrison:   GARRISON_MAX,
      ammo:       'boulder',
      bricks: Array.from({ length: SIDE_ROWS }, () =>
        Array.from({ length: SIDE_COLS }, () => true)),
      breached:   false,
      arm: { angle: ARM_REST_ANG, pulling: false, pullMs: 0 },
      projectile: null,
      lastResult: '',
      gameOver: false,
      won: false,
    };
  }

  function refreshControls() {
    btnFire.disabled    = !state.breached || state.gameOver || !!state.projectile;
    btnDisease.disabled = !state.breached || state.gameOver || !!state.projectile;
    btnBoulder.disabled = state.gameOver || !!state.projectile;
    const dim = (b) => { b.style.opacity = b.disabled ? '0.35' : '1'; };
    [btnBoulder, btnFire, btnDisease].forEach(dim);
    for (const [b, kind] of [[btnBoulder,'boulder'],[btnFire,'fire'],[btnDisease,'disease']]) {
      b.style.borderColor = (state.ammo === kind && !b.disabled) ? T.amber : T.rule;
    }
  }

  function selectAmmo(kind) {
    if (state.gameOver || state.projectile) return;
    if ((kind === 'fire' || kind === 'disease') && !state.breached) return;
    state.ammo = kind;
    refreshControls();
  }

  const onBoulder = () => selectAmmo('boulder');
  const onFire    = () => selectAmmo('fire');
  const onDisease = () => selectAmmo('disease');
  const onReset   = () => { state = freshState(); refreshControls(); };
  btnBoulder.addEventListener('click', onBoulder);
  btnFire.addEventListener('click',    onFire);
  btnDisease.addEventListener('click', onDisease);
  btnReset.addEventListener('click',   onReset);

  // ---- Pull-back gesture — bound to THIS canvas only --------------------
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
      state.arm.angle = ARM_REST_ANG - ARM_PULL_MAX * t;
    },
    onRelease: (ms) => {
      if (!state.arm.pulling) return;
      state.arm.pulling = false;
      if (state.gameOver || state.projectile) {
        state.arm.angle = ARM_REST_ANG;
        return;
      }
      const power = Math.min(1, ms / PULL_FULL_MS);
      const v     = V_MIN + (V_MAX - V_MIN) * power;
      fire(v);
      state.arm.angle = ARM_REST_ANG;
    },
  });

  function fire(v) {
    const launchX = PIVOT_X + Math.cos(ARM_REST_ANG) * ARM_LEN;
    const launchY = PIVOT_Y + Math.sin(ARM_REST_ANG) * ARM_LEN;
    const vx =  v * Math.cos(LAUNCH_ANGLE);
    const vy = -v * Math.sin(LAUNCH_ANGLE);
    state.projectile = {
      x: launchX, y: launchY, vx, vy,
      kind: state.ammo,
      shotIndex: state.shotsFired,
    };
    state.lastResult = '';
    refreshControls();
  }

  // ---- Collision helpers ------------------------------------------------
  function brickAt(x, y) {
    if (x < WALL_X || x >= WALL_X + WALL_W) return null;
    if (y < WALL_TOP_Y || y >= WALL_BASE_Y) return null;
    const col = Math.floor((x - WALL_X) / SIDE_BRICK_W);
    const row = Math.floor((y - WALL_TOP_Y) / SIDE_BRICK_H);
    if (col < 0 || col >= SIDE_COLS || row < 0 || row >= SIDE_ROWS) return null;
    return { col, row };
  }
  function recomputeBreach() {
    if (state.breached) return;
    for (let c = 0; c < SIDE_COLS; c++) {
      let empty = true;
      for (let r = 0; r < SIDE_ROWS; r++) {
        if (state.bricks[r][c]) { empty = false; break; }
      }
      if (empty) { state.breached = true; return; }
    }
  }
  function wallStanding() {
    for (let r = 0; r < SIDE_ROWS; r++)
      for (let c = 0; c < SIDE_COLS; c++)
        if (state.bricks[r][c]) return true;
    return false;
  }
  function applyImpact(p) {
    let removed = 0;
    if (p.kind === 'boulder') {
      const hit = brickAt(p.x, p.y);
      if (hit) {
        if (state.bricks[hit.row][hit.col]) { state.bricks[hit.row][hit.col] = false; removed++; }
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > 400) {
          const r2 = hit.row - 1;
          if (r2 >= 0 && state.bricks[r2][hit.col]) { state.bricks[r2][hit.col] = false; removed++; }
        }
      }
      recomputeBreach();
      state.lastResult = removed ? ('boulder: -' + removed + ' brick' + (removed>1?'s':'')) : 'boulder: glancing blow';
    } else if (p.kind === 'fire') {
      if (p.x >= WALL_X - 8 && p.x <= WALL_X + WALL_W + 8) {
        state.garrison -= FIRE_DAMAGE;
        state.lastResult = 'Greek fire: -' + FIRE_DAMAGE + ' garrison';
      } else state.lastResult = 'Greek fire: fell short';
    } else if (p.kind === 'disease') {
      if (p.x >= WALL_X - 8 && p.x <= WALL_X + WALL_W + 8) {
        const dmg = DISEASE_DAMAGE_BY_INDEX[p.shotIndex] ?? 10;
        state.garrison -= dmg;
        state.lastResult = 'disease: -' + dmg + ' garrison';
      } else state.lastResult = 'disease: fell short';
    }
  }
  function endShot() {
    state.shotsFired++;
    state.projectile = null;
    if (state.garrison <= 0) { state.gameOver = true; state.won = true; }
    else if (!wallStanding()) { state.gameOver = true; state.won = true; }
    else if (state.shotsFired >= SIDE_MAX_SHOTS) { state.gameOver = true; state.won = false; }
    refreshControls();
  }

  // ---- Step -------------------------------------------------------------
  function step(dt) {
    if (!state.projectile) return;
    const p = state.projectile;
    p.vy += GRAVITY * dt;
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
    if (p.x >= WALL_X && p.x <= WALL_X + WALL_W &&
        p.y >= WALL_TOP_Y && p.y <= WALL_BASE_Y) {
      const hit = brickAt(p.x, p.y);
      if (hit && state.bricks[hit.row][hit.col]) {
        applyImpact(p);
        endShot();
        return;
      }
    }
    if (p.y >= GROUND_Y || p.x > W + 20 || p.x < -20) {
      applyImpact(p);
      endShot();
      return;
    }
  }

  // ---- Draw -------------------------------------------------------------
  function draw() {
    // Sky.
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, '#1a1d24');
    sky.addColorStop(1, '#2a2128');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1f1c19';
    ctx.fillRect(0, WALL_BASE_Y, W, GROUND_Y - WALL_BASE_Y);

    // Bricks.
    for (let r = 0; r < SIDE_ROWS; r++) {
      for (let c = 0; c < SIDE_COLS; c++) {
        if (!state.bricks[r][c]) continue;
        const x = WALL_X + c * SIDE_BRICK_W;
        const y = WALL_TOP_Y + r * SIDE_BRICK_H;
        ctx.fillStyle = (r + c) % 2 ? '#3a342c' : '#4a4135';
        ctx.fillRect(x + 1, y + 1, SIDE_BRICK_W - 2, SIDE_BRICK_H - 2);
        ctx.strokeStyle = '#15171a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, SIDE_BRICK_W - 1, SIDE_BRICK_H - 1);
      }
    }
    ctx.strokeStyle = T.rule;
    ctx.beginPath();
    ctx.moveTo(WALL_X - 10, WALL_BASE_Y + 0.5);
    ctx.lineTo(WALL_X + WALL_W + 10, WALL_BASE_Y + 0.5);
    ctx.stroke();

    // Garrison badge.
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

    // Foreground ground.
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = T.rule;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 0.5); ctx.lineTo(W, GROUND_Y + 0.5);
    ctx.stroke();

    // Catapult base.
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

    // Arm.
    const ax = PIVOT_X + Math.cos(state.arm.angle) * ARM_LEN;
    const ay = PIVOT_Y + Math.sin(state.arm.angle) * ARM_LEN;
    ctx.strokeStyle = '#a88457';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(PIVOT_X, PIVOT_Y);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.fillStyle = T.bgElev;
    ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI * 2); ctx.fill();
    if (!state.projectile && !state.gameOver) {
      ctx.fillStyle = ammoColor(state.ammo, T);
      ctx.beginPath(); ctx.arc(ax, ay, 4, 0, Math.PI * 2); ctx.fill();
    }

    // Power bar.
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
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('PULL', barX, barY - 4);
    }

    // Projectile.
    if (state.projectile) {
      const p = state.projectile;
      ctx.fillStyle = ammoColor(p.kind, T);
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

    // Status line (top-left).
    ctx.fillStyle = T.fgMuted;
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('shots ' + (SIDE_MAX_SHOTS - state.shotsFired) + '/' + SIDE_MAX_SHOTS +
                 '    garr ' + Math.max(0, state.garrison), 10, 8);
    if (state.lastResult && !state.gameOver) {
      ctx.fillStyle = T.amber;
      ctx.fillText(state.lastResult, 10, 22);
    } else if (!state.gameOver) {
      ctx.fillStyle = state.breached ? T.teal : T.fgMuted;
      ctx.fillText(state.breached ? 'breach open' : 'breach the wall', 10, 22);
    }

    // Frame.
    ctx.strokeStyle = T.amber;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Idle prompt + game over.
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

  // ---- Boot -------------------------------------------------------------
  state = freshState();
  refreshControls();

  return {
    step,
    draw,
    cleanup: () => {
      cleanupTension();
      btnBoulder.removeEventListener('click', onBoulder);
      btnFire.removeEventListener('click', onFire);
      btnDisease.removeEventListener('click', onDisease);
      btnReset.removeEventListener('click', onReset);
      // Mobile control panel listeners.
      for (const [b, fn] of sideStepHandlers) b.removeEventListener('click', fn);
      sideFireBtn.removeEventListener('click', onSideFire);
    },
  };
}

// =========================================================================
// FRONT GAME — Saxon castle, single-column knock-through
// =========================================================================
// Visual: small wheeled catapult low in the foreground (Defender-of-the-Crown
// scale — the machine is a stout little thing, the castle dominates). Boulder
// grows dramatically as you pull back (depth illusion: it's coming toward the
// camera). Release: arm whips forward and the boulder travels in a STRAIGHT
// LINE to the target column on the wall, shrinking dramatically as it
// recedes into the distance.
//
// Rules:
//   ONE target column on the gatehouse face, three bricks DEEP (depth, not
//   height). Each clean hit removes one depth-layer, revealing a darker brick
//   behind it. Three clean hits = punch-through = VICTORY.
//   Sweet-spot aiming: a shot is a CLEAN HIT only if launchR is within
//   FRONT_SWEET_TOL of FRONT_SWEET_R. Too short → falls short. Too long →
//   overshoots. The column is unaffected on misses.
//   6 shots total. If the column hasn't been broken through after 6, DEFEAT.
function createFrontGame(refs, T) {
  const { canvas, ctx, controls, panel } = refs;

  // ---- Layout constants (front view) -----------------------------------
  const HORIZON      = 230;
  const VPX          = W / 2;

  // Castle/gatehouse face — where the brick grid lives.
  const F_WALL_W     = W * 0.42;
  const F_WALL_X     = VPX - F_WALL_W / 2;
  const F_BRICK_W    = F_WALL_W / FRONT_COLS;
  const F_BRICK_H    = 16;
  const F_WALL_TOP   = HORIZON - F_BRICK_H * FRONT_ROWS;
  const F_WALL_BASE  = HORIZON;

  // The ONE target column lives in the centre of the gatehouse face.
  const TARGET_COL   = Math.floor(FRONT_COLS / 2);             // 4 (mid-right of centre)
  const TARGET_COL_X = F_WALL_X + TARGET_COL * F_BRICK_W;      // left edge of column
  const TARGET_COL_CX = TARGET_COL_X + F_BRICK_W / 2;          // centre x of column
  // Vertical band for the column — the brick stack within the wall.
  const TARGET_COL_Y_TOP = F_WALL_TOP;
  const TARGET_COL_Y_MID = F_WALL_TOP + (F_BRICK_H * FRONT_ROWS) / 2;

  // Catapult (foreground, viewed from behind). Small and stout — per spec,
  // the catapult sits in the lower 25-30% of the canvas, NOT dominating.
  const BASE_CX      = W / 2;
  const BASE_TOP_Y   = GROUND_Y - 18;     // top of wagon-bed (shallow)
  const BASE_HALF_T  = 22;                // top half-width  (~44 wide)
  const BASE_HALF_B  = 34;                // bottom half-width (~68 wide)

  // Beam arm — SHRUNK 4× per spec. Was 200px; now ~50px.
  // Proportional to the wagon (~68px wide). Reads as a stout beam, not a pole.
  const BEAM_LEN     = 50;
  const BEAM_WIDTH   = 4;
  // Rest pose: slight forward tilt. 0 = straight up. + = forward (toward wall).
  const BEAM_REST_RAD = 0.30;
  // Max pullback: arm rotates BACKWARD past vertical, toward the viewer.
  const BEAM_PULL_RAD = 1.05;             // total swing from rest at full pull

  // Boulder size animation at the bucket — dramatic depth illusion.
  // Rest = tiny; full pullback = the stone is up against the lens.
  const BOULDER_R_REST = 6;               // small ball at rest (~6px)
  const BOULDER_R_FULL = 30;              // looming stone at full pullback (~30px)

  // Boulder size while in flight: launch (near camera) → impact (far/tiny).
  const BOULDER_R_IMPACT = 2.5;           // a dot at impact (max foreshortening)

  // ---- Controls ---------------------------------------------------------
  const btnReset = mkButton('New siege', T);
  btnReset.style.borderColor = T.teal;
  controls.append(btnReset);

  // ---- Mobile power + fire panel ---------------------------------------
  // Slider value maps 1:1 to launchR (boulder pullback radius). Sweet-spot
  // is FRONT_SWEET_R (22), tolerance ±FRONT_SWEET_TOL (7). Range matches
  // BOULDER_R_REST..BOULDER_R_FULL (6..30) so the slider span covers every
  // shot the pullback gesture can produce. The trajectory preview reads
  // this value when idle, so users see the predicted arc move live as
  // they tap +/-.
  let frontPowerValue = FRONT_SWEET_R;
  const FRONT_POWER_MIN = BOULDER_R_REST;
  const FRONT_POWER_MAX = BOULDER_R_FULL;

  const mobilePanel = document.createElement('div');
  mobilePanel.className = 'iter-controls';
  const powerRow = document.createElement('div');
  powerRow.className = 'ctrl-row';
  const powerLabel = document.createElement('label');
  powerLabel.className = 'ctrl-label';
  powerLabel.textContent = 'POWER';
  const frontStepDefs = [
    { step: -5, label: '−5' },
    { step: -1, label: '−1' },
    { step: +1, label: '+1' },
    { step: +5, label: '+5' },
  ];
  const frontStepBtns = [];
  const frontValueEl = document.createElement('span');
  frontValueEl.className = 'ctrl-value';
  frontValueEl.setAttribute('data-power-value', '');
  frontValueEl.textContent = String(frontPowerValue);
  powerRow.appendChild(powerLabel);
  frontStepDefs.filter((d) => d.step < 0).forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctrl-step';
    b.dataset.step = String(d.step);
    b.textContent = d.label;
    b.setAttribute('aria-label', 'Decrease power by ' + Math.abs(d.step));
    powerRow.appendChild(b);
    frontStepBtns.push(b);
  });
  powerRow.appendChild(frontValueEl);
  frontStepDefs.filter((d) => d.step > 0).forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctrl-step';
    b.dataset.step = String(d.step);
    b.textContent = d.label;
    b.setAttribute('aria-label', 'Increase power by ' + d.step);
    powerRow.appendChild(b);
    frontStepBtns.push(b);
  });
  mobilePanel.appendChild(powerRow);

  const frontFireBtn = document.createElement('button');
  frontFireBtn.type = 'button';
  frontFireBtn.className = 'ctrl-fire';
  frontFireBtn.textContent = 'FIRE';
  frontFireBtn.setAttribute('aria-label', 'Fire at the displayed power');
  mobilePanel.appendChild(frontFireBtn);
  panel.appendChild(mobilePanel);

  function setFrontPower(v) {
    frontPowerValue = Math.max(FRONT_POWER_MIN, Math.min(FRONT_POWER_MAX, Math.round(v)));
    frontValueEl.textContent = String(frontPowerValue);
  }
  const frontStepHandlers = frontStepBtns.map((b) => {
    const fn = () => setFrontPower(frontPowerValue + Number(b.dataset.step));
    b.addEventListener('click', fn);
    return [b, fn];
  });
  const onFrontFire = () => {
    if (state.gameOver || state.projectile || state.arm.pulling) return;
    state.launchR = frontPowerValue;
    fire();
  };
  frontFireBtn.addEventListener('click', onFrontFire);

  // ---- State ------------------------------------------------------------
  let state;
  function freshState() {
    return {
      shotsFired: 0,
      // Depth remaining on the single target column. Starts at 3 (full depth).
      // Decrements on each clean hit. 0 = broken through (WIN).
      colDepth:   HITS_TO_FELL,
      arm:        { angle: BEAM_REST_RAD, pulling: false, pullMs: 0 },
      // Projectile in flight; uses screen-space (NOT world-space) coords now,
      // because the flight is a direct straight-line interpolation from arm tip
      // to target column on screen — no gravity, no arc.
      projectile: null,
      // Boulder size at the moment of release (drives the in-flight shrink).
      launchR:    BOULDER_R_REST,
      lastResult: '',
      // Visual flash on the column after a clean hit (decays per frame).
      hitFlash:   0,
      // Visual flash on the wall on a clean hit, plus a ground splash for
      // short misses, near horizon for overshoots.
      lastShotKind: 'idle',     // 'hit' | 'short' | 'over' | 'idle'
      gameOver:   false,
      won:        false,
    };
  }

  function refreshControls() {
    btnReset.style.opacity = '1';
  }

  const onReset = () => { state = freshState(); refreshControls(); };
  btnReset.addEventListener('click', onReset);

  // ---- Pull-back gesture — bound to THIS canvas only -------------------
  const cleanupTension = holdTension(canvas, {
    onStart: () => {
      if (state.gameOver || state.projectile) return;
      state.arm.pulling = true;
      state.arm.pullMs  = 0;
      state.arm.angle   = BEAM_REST_RAD;
    },
    onUpdate: (ms) => {
      if (!state.arm.pulling) return;
      const t = Math.min(1, ms / PULL_FULL_MS);
      state.arm.pullMs = ms;
      // Rotate BACKWARD past vertical toward the viewer.
      state.arm.angle  = BEAM_REST_RAD - BEAM_PULL_RAD * t;
    },
    onRelease: (ms) => {
      if (!state.arm.pulling) return;
      state.arm.pulling = false;
      if (state.gameOver || state.projectile) {
        state.arm.angle = BEAM_REST_RAD;
        return;
      }
      const power = Math.min(1, ms / PULL_FULL_MS);
      // Boulder launch size = current pullback size.
      state.launchR = BOULDER_R_REST + (BOULDER_R_FULL - BOULDER_R_REST) * power;
      fire();
      state.arm.angle = BEAM_REST_RAD;
    },
  });

  // ---- Launch geometry helpers -----------------------------------------
  // The arm tip in the rest pose — that's where the boulder leaves the cup
  // (we visually snap the arm back to rest at the moment of release).
  function launchPoint() {
    return {
      x: BASE_CX,
      y: BASE_TOP_Y - BEAM_LEN * Math.cos(BEAM_REST_RAD),
    };
  }
  // Initial velocity for a given pullback radius. The shot goes UP-and-
  // slightly-FORWARD (toward the target column), with magnitude proportional
  // to launchR. Returns { vx0, vy0 } in screen px/s (vy0 < 0 means upward).
  function launchVelocity(launchR) {
    const speed = launchR * FRONT_SPEED_PER_R;
    // Horizontal direction = sign of (target - launch). In our layout this
    // is positive (target column sits right of canvas centre), but keep the
    // formula general.
    const lp = launchPoint();
    const dir = Math.sign(TARGET_COL_CX - lp.x) || 1;
    const vx0 = dir * speed * Math.cos(FRONT_LAUNCH_ANG);
    const vy0 = -speed * Math.sin(FRONT_LAUNCH_ANG);
    return { vx0, vy0 };
  }

  // ---- Fire: spawn a real ballistic projectile (screen-space physics) ---
  function fire() {
    const lp = launchPoint();
    const { vx0, vy0 } = launchVelocity(state.launchR);
    state.projectile = {
      // Position + velocity (screen-space).
      x:  lp.x,
      y:  lp.y,
      vx: vx0,
      vy: vy0,
      // Launch reference for the depth-shrink (horizontal-progress proxy).
      x0: lp.x,
      r0: state.launchR,
      tMs: 0,
      // Current rendered size — updated in step from horizontal progress.
      pr: state.launchR,
      // Resolved on the frame the arc crosses a terminating plane.
      outcome: null,    // 'hit' | 'short' | 'over' (set in step)
      // Tracks whether the arc EVER passed above the wall top within the
      // column band — used to classify post-flight outcome as 'over'.
      sawAboveWall: false,
    };
    state.lastResult = '';
  }

  // Resolve the outcome of an in-flight projectile given the position it
  // crossed a terminating plane at. Used inside step().
  function resolveOutcome(p) {
    const colHalfHit = F_BRICK_W / 2 + 4;
    // Did we cross the wall plane at termination, within the column band?
    if (p.y >= TARGET_COL_Y_MID && p.y <= F_WALL_BASE + 4 &&
        Math.abs(p.x - TARGET_COL_CX) <= colHalfHit) {
      return 'hit';
    }
    // Overshoot: arc sailed above the wall within the column band at any
    // point during flight (tracked by p.sawAboveWall), OR the projectile
    // exited off the top of the canvas.
    if (p.sawAboveWall || p.y < F_WALL_TOP) {
      return 'over';
    }
    // Otherwise: fell short, or splashed wide of the column.
    return 'short';
  }

  function applyImpact(p) {
    if (p.outcome === 'hit') {
      state.colDepth = Math.max(0, state.colDepth - 1);
      const remaining = state.colDepth;
      const removedLayer = HITS_TO_FELL - remaining;          // 1..3
      state.hitFlash = 1.0;
      state.lastResult = 'clean hit — depth ' + remaining + '/' + HITS_TO_FELL;
      state.lastShotKind = 'hit';
      // (No-op kept for clarity: removedLayer can be used for SFX later.)
      void removedLayer;
    } else if (p.outcome === 'short') {
      state.lastResult = 'fell short';
      state.lastShotKind = 'short';
    } else {
      state.lastResult = 'overshot';
      state.lastShotKind = 'over';
    }
  }

  function endShot() {
    state.shotsFired++;
    state.projectile = null;
    // Win = column broken through.
    if (state.colDepth <= 0) {
      state.gameOver = true;
      state.won      = true;
      return;
    }
    if (state.shotsFired >= FRONT_MAX_SHOTS) {
      state.gameOver = true;
      state.won      = false;
    }
  }

  // ---- Step ------------------------------------------------------------
  function step(dt) {
    // Decay hit flash regardless of projectile state.
    if (state.hitFlash > 0) state.hitFlash = Math.max(0, state.hitFlash - dt * 2.2);
    if (!state.projectile) return;
    const p = state.projectile;

    // Integrate one frame of ballistics (semi-implicit Euler — matches the
    // formula used by the trajectory preview so flight follows the dots).
    p.vy += FRONT_GRAVITY * dt;
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
    p.tMs += dt * 1000;

    // Track whether the arc has sailed above the wall top inside the column
    // band — this is how we distinguish an overshoot from a short or wide.
    if (p.y < F_WALL_TOP &&
        Math.abs(p.x - TARGET_COL_CX) <= F_BRICK_W / 2 + 4) {
      p.sawAboveWall = true;
    }

    // Depth shrink driven by HORIZONTAL distance traveled (target-relative).
    // 0 at launch x → 1 at target column centre.
    const hSpan = TARGET_COL_CX - p.x0;
    const hProg = hSpan !== 0
      ? Math.min(1, Math.max(0, (p.x - p.x0) / hSpan))
      : Math.min(1, p.tMs / 800);
    p.pr = p.r0 + (BOULDER_R_IMPACT - p.r0) * hProg;

    // --- Termination tests --------------------------------------------
    // 1. Boulder crossed the wall plane on its way down within the column
    //    band → CLEAN HIT.
    if (p.vy > 0 &&
        p.y >= TARGET_COL_Y_MID &&
        Math.abs(p.x - TARGET_COL_CX) <= F_BRICK_W / 2 + 4) {
      p.outcome = 'hit';
      applyImpact(p);
      endShot();
      return;
    }
    // 2. Boulder hit the ground in the foreground (short, never reached wall).
    if (p.y >= GROUND_Y - 2) {
      p.outcome = resolveOutcome(p);
      applyImpact(p);
      endShot();
      return;
    }
    // 3. Boulder sailed off-screen above / to the sides → over/wide.
    if (p.x < -20 || p.x > W + 20 || p.y < -40) {
      p.outcome = resolveOutcome(p);
      applyImpact(p);
      endShot();
      return;
    }
    // 4. Safety timeout — should be unreachable but stops any pathological
    //    hang from a weird tuning.
    if (p.tMs > FRONT_FLIGHT_MAX_MS) {
      p.outcome = resolveOutcome(p);
      applyImpact(p);
      endShot();
      return;
    }
  }

  // ---- Draw helpers ----------------------------------------------------
  function drawCastleSilhouette(c) {
    // Stone-gray silhouette behind the wall — towers + central gatehouse.
    // Use fg-muted at low alpha so it reads as "distant".
    c.save();
    c.globalAlpha = 0.55;
    c.fillStyle = T.fgMuted;

    // Ground line for the castle (sits ON the horizon).
    const baseY = HORIZON;
    const groundLineY = HORIZON + 2;

    // Three round towers + central gatehouse. Tower dims:
    const towerW = 38;
    const towerH = 78;
    const gateW  = 88;
    const gateH  = 92;
    const merlonH = 6;

    // Tower positions (x = left edge): two flanking, one mid-left/right.
    // Layout: [L tower] [gap] [gatehouse centered] [gap] [R tower]
    const gateX = VPX - gateW / 2;
    const gateY = baseY - gateH;
    const lTowerX = gateX - 80;
    const rTowerX = gateX + gateW + 80 - towerW;
    const lTowerY = baseY - towerH;
    const rTowerY = baseY - towerH;

    // Outer wall (low curtain) connecting the towers.
    c.fillRect(lTowerX - 40, baseY - 28, (rTowerX + towerW + 40) - (lTowerX - 40), 28);

    // Towers — simple rectangle bodies.
    c.fillRect(lTowerX, lTowerY, towerW, towerH);
    c.fillRect(rTowerX, rTowerY, towerW, towerH);

    // Gatehouse — taller central block.
    c.fillRect(gateX, gateY, gateW, gateH);

    // Crenellations: small notch pattern on top of each silhouette element.
    const drawCrenellations = (x, y, w) => {
      // 5px merlons, 3px gaps.
      const mw = 6, gw = 4;
      const total = mw + gw;
      const count = Math.floor(w / total);
      // Pull merlons UP from y by merlonH; they're already part of fill, so
      // we need to CUT gaps — draw bg-elev rectangles over the top.
      c.fillStyle = T.bg;
      for (let i = 0; i < count; i++) {
        const mx = x + i * total + mw;
        c.fillRect(mx, y - merlonH, gw, merlonH + 1);
      }
      c.fillStyle = T.fgMuted;
    };
    // Need merlons drawn AS extruded shapes above the body. Simpler: extend
    // the body up by merlonH, then carve gaps. Already filled, so just carve.
    // Extend tops with merlons:
    c.fillRect(lTowerX, lTowerY - merlonH, towerW, merlonH);
    c.fillRect(rTowerX, rTowerY - merlonH, towerW, merlonH);
    c.fillRect(gateX,   gateY   - merlonH, gateW,   merlonH);
    drawCrenellations(lTowerX, lTowerY,        towerW);
    drawCrenellations(rTowerX, rTowerY,        towerW);
    drawCrenellations(gateX,   gateY,          gateW);
    // Curtain wall crenellations.
    drawCrenellations(lTowerX - 40, baseY - 28, (rTowerX + towerW + 40) - (lTowerX - 40));

    // Gate arch (subtle bg-colored notch at the gatehouse base).
    c.fillStyle = T.bg;
    const archW = 18, archH = 28;
    const archX = VPX - archW / 2;
    const archY = baseY - archH;
    c.fillRect(archX, archY, archW, archH);
    // Arch top — a half-circle.
    c.beginPath();
    c.arc(VPX, archY, archW / 2, Math.PI, 0);
    c.fill();

    // Flag poles on each tower.
    c.strokeStyle = T.fgMuted;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(lTowerX + towerW / 2, lTowerY - merlonH);
    c.lineTo(lTowerX + towerW / 2, lTowerY - merlonH - 14);
    c.moveTo(rTowerX + towerW / 2, rTowerY - merlonH);
    c.lineTo(rTowerX + towerW / 2, rTowerY - merlonH - 14);
    c.moveTo(VPX, gateY - merlonH);
    c.lineTo(VPX, gateY - merlonH - 18);
    c.stroke();
    // Pennants.
    c.fillStyle = T.blood;
    c.globalAlpha = 0.7;
    const drawPennant = (px, py) => {
      c.beginPath();
      c.moveTo(px, py); c.lineTo(px + 9, py + 2); c.lineTo(px, py + 5);
      c.closePath(); c.fill();
    };
    drawPennant(lTowerX + towerW / 2, lTowerY - merlonH - 14);
    drawPennant(rTowerX + towerW / 2, rTowerY - merlonH - 14);
    drawPennant(VPX,                  gateY   - merlonH - 18);

    // Ground line under castle.
    c.globalAlpha = 1;
    c.strokeStyle = T.rule;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, groundLineY + 0.5);
    c.lineTo(W, groundLineY + 0.5);
    c.stroke();
    c.restore();
  }

  function drawBeamArm(c, pivotX, pivotY, angleFromVert, beamLen, boulderR) {
    // OTS framing: camera sits directly behind the catapult. The beam swings
    // in the depth plane (forward = toward wall; back = toward camera).
    //   angleFromVert > 0 → tilted FORWARD (toward wall, away from camera)
    //   angleFromVert = 0 → straight up
    //   angleFromVert < 0 → tilted BACKWARD (toward viewer, over the gunner)
    //
    // Fake foreshortening on 2D canvas: rest pose stands the beam tall above
    // the catapult; pulling back rotates the tip DOWN-screen toward the
    // foreground so it visibly "leans back over the camera". Forward lean at
    // rest leaves the tip at roughly the natural up-projection.
    const dy = -beamLen * Math.cos(angleFromVert);            // vertical component
    const BACK_BIAS = 0.55;                                   // amount of backward swing applied as screen-y drop
    const backLean = Math.max(0, -angleFromVert);             // 0 at rest, grows as we wind back
    const tipX = pivotX;
    const tipY = pivotY + dy + backLean * beamLen * BACK_BIAS;

    // Beam — single thick stroke.
    c.strokeStyle = '#a88457';
    c.lineWidth = BEAM_WIDTH;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(pivotX, pivotY);
    c.lineTo(tipX, tipY);
    c.stroke();

    // Bucket / sling at the tip — a small open cup drawn as a half-circle
    // opening UPWARD (so the boulder visibly sits IN it). Since the beam in
    // this OTS view stays close to vertical at all times, an axis-aligned
    // upward-opening U-shape reads cleanly across the whole pullback range.
    const cupR = Math.max(7, boulderR * 0.85);
    c.strokeStyle = T.fgMuted;
    c.lineWidth = 2;
    c.beginPath();
    // Canvas angles: 0=right, PI=left, sweep clockwise default.
    // Arc 0 → PI clockwise goes through PI/2 (down) = lower half = U-shape.
    c.arc(tipX, tipY, cupR, 0, Math.PI, false);
    c.stroke();

    // Boulder sitting in the cup.
    c.fillStyle = T.fg;
    c.beginPath();
    c.arc(tipX, tipY, boulderR, 0, Math.PI * 2);
    c.fill();
    // Subtle outline so it reads as a stone, not a fill.
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = 1;
    c.stroke();
    return { tipX, tipY };
  }

  function drawScaleFigures(c) {
    // Two tiny silhouettes flanking the catapult base. Pure dots/sticks.
    c.fillStyle = T.fgMuted;
    c.strokeStyle = T.fgMuted;
    c.lineWidth = 1;
    const drawFigure = (x, y) => {
      // Head dot.
      c.beginPath();
      c.arc(x, y - 6, 1.6, 0, Math.PI * 2);
      c.fill();
      // Body line.
      c.beginPath();
      c.moveTo(x, y - 4);
      c.lineTo(x, y);
      c.stroke();
    };
    drawFigure(BASE_CX - BASE_HALF_B - 14, GROUND_Y - 1);
    drawFigure(BASE_CX + BASE_HALF_B + 14, GROUND_Y - 1);
  }

  function drawHitDots(c) {
    // Single 3-slot cluster under the target column. Slots fill with amber
    // for each clean hit, and the final slot turns blood when the column
    // is fully broken through.
    const dotR = 3;
    const rowY = F_WALL_BASE + 12;
    const cx   = TARGET_COL_CX;
    const hits = HITS_TO_FELL - state.colDepth;     // 0..3
    for (let slot = 0; slot < HITS_TO_FELL; slot++) {
      const dx = cx + (slot - 1) * 8;
      const filled = slot < hits;
      if (!filled) {
        c.fillStyle = T.rule;
      } else if (hits >= HITS_TO_FELL) {
        c.fillStyle = T.blood;
      } else {
        c.fillStyle = T.amber;
      }
      c.beginPath();
      c.arc(dx, rowY, dotR, 0, Math.PI * 2);
      c.fill();
    }
  }

  // ---- Draw ------------------------------------------------------------
  function draw() {
    // Sky.
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
    sky.addColorStop(0, '#1a1d24');
    sky.addColorStop(1, '#2a2128');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, HORIZON);
    ctx.fillStyle = '#1f1c19';
    ctx.fillRect(0, HORIZON, W, GROUND_Y - HORIZON);

    // Perspective rails to vanishing point on castle.
    ctx.strokeStyle = T.rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, GROUND_Y); ctx.lineTo(VPX, HORIZON);
    ctx.moveTo(W - 40, GROUND_Y); ctx.lineTo(VPX, HORIZON);
    ctx.stroke();
    for (const t of [0.25, 0.5, 0.75]) {
      const y = GROUND_Y + (HORIZON - GROUND_Y) * t;
      const left  = 40 + ((VPX - 40) * t);
      const right = (W - 40) + ((VPX - (W - 40)) * t);
      ctx.strokeStyle = 'rgba(138,130,117,' + (0.18 - t * 0.12).toFixed(2) + ')';
      ctx.beginPath();
      ctx.moveTo(left, y); ctx.lineTo(right, y);
      ctx.stroke();
    }

    // Castle silhouette (background).
    drawCastleSilhouette(ctx);

    // Bricks on the gatehouse face — the WALL we're attacking.
    // All non-target columns render normally. The TARGET column renders a
    // single front-facing brick whose colour/inset depends on remaining depth.
    for (let r = 0; r < FRONT_ROWS; r++) {
      for (let c = 0; c < FRONT_COLS; c++) {
        if (c === TARGET_COL) continue;             // drawn separately below
        const x = F_WALL_X + c * F_BRICK_W;
        const y = F_WALL_TOP + r * F_BRICK_H;
        ctx.fillStyle = (r + c) % 2 ? '#3a342c' : '#4a4135';
        ctx.fillRect(x + 0.5, y + 0.5, F_BRICK_W - 1, F_BRICK_H - 1);
        ctx.strokeStyle = '#15171a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, F_BRICK_W - 1, F_BRICK_H - 1);
      }
    }

    // --- Target column — single column, 3 bricks DEEP --------------------
    // colDepth 3 = full bright front face. 2 = darker, slightly inset (front
    // brick gone, next layer behind). 1 = even darker / smaller. 0 = sky
    // showing through (a notch in the wall).
    const colX = TARGET_COL_X;
    const colY = F_WALL_TOP;
    const colW = F_BRICK_W;
    const colH = F_BRICK_H * FRONT_ROWS;
    if (state.colDepth >= 1) {
      // Pick brightness + inset by remaining depth.
      const depthMap = {
        3: { fill: '#6a5b42', inset: 0 },         // bright front face
        2: { fill: '#4a4135', inset: 3 },         // recessed darker brick
        1: { fill: '#2e2820', inset: 6 },         // deepest darker brick
      };
      const dm = depthMap[state.colDepth];
      // Empty notch around the inset brick (the void where the front layer was).
      if (dm.inset > 0) {
        ctx.fillStyle = T.bg;
        ctx.fillRect(colX + 0.5, colY + 0.5, colW - 1, colH - 1);
      }
      // Inset brick (the next layer of the column showing through).
      ctx.fillStyle = dm.fill;
      ctx.fillRect(
        colX + dm.inset + 0.5,
        colY + dm.inset + 0.5,
        colW - 1 - dm.inset * 2,
        colH - 1 - dm.inset * 2
      );
      // Outline.
      ctx.strokeStyle = '#15171a';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        colX + dm.inset + 0.5,
        colY + dm.inset + 0.5,
        colW - 1 - dm.inset * 2,
        colH - 1 - dm.inset * 2
      );
      // Subtle horizontal mortar lines so the column reads as 4 stacked bricks.
      ctx.strokeStyle = 'rgba(21,23,26,0.7)';
      for (let r = 1; r < FRONT_ROWS; r++) {
        const ly = colY + r * F_BRICK_H + 0.5;
        ctx.beginPath();
        ctx.moveTo(colX + dm.inset, ly);
        ctx.lineTo(colX + colW - dm.inset, ly);
        ctx.stroke();
      }
      // Hit-flash overlay (blood pulse for ~0.5s after a clean hit).
      if (state.hitFlash > 0) {
        ctx.save();
        ctx.globalAlpha = state.hitFlash * 0.7;
        ctx.fillStyle = T.blood;
        ctx.fillRect(
          colX + dm.inset + 0.5,
          colY + dm.inset + 0.5,
          colW - 1 - dm.inset * 2,
          colH - 1 - dm.inset * 2
        );
        ctx.restore();
      }
    } else {
      // Column fully broken through — sky / void shows through.
      ctx.fillStyle = T.bg;
      ctx.fillRect(colX + 0.5, colY + 0.5, colW - 1, colH - 1);
      ctx.strokeStyle = T.blood;
      ctx.lineWidth = 1;
      ctx.strokeRect(colX + 0.5, colY + 0.5, colW - 1, colH - 1);
      // Daylight glow through the notch.
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = T.amber;
      ctx.fillRect(colX + 2, colY + 2, colW - 4, colH - 4);
      ctx.restore();
    }
    // Wall base line.
    ctx.strokeStyle = T.rule;
    ctx.beginPath();
    ctx.moveTo(F_WALL_X - 6, F_WALL_BASE + 0.5);
    ctx.lineTo(F_WALL_X + F_WALL_W + 6, F_WALL_BASE + 0.5);
    ctx.stroke();

    // Hit-dot HUD beneath the wall.
    drawHitDots(ctx);

    // Foreground ground band.
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = T.rule;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 0.5); ctx.lineTo(W, GROUND_Y + 0.5);
    ctx.stroke();

    // Small wheeled wagon base (trapezoidal body + two wheels).
    ctx.fillStyle = '#3a2f24';
    ctx.beginPath();
    ctx.moveTo(BASE_CX - BASE_HALF_T, BASE_TOP_Y);
    ctx.lineTo(BASE_CX + BASE_HALF_T, BASE_TOP_Y);
    ctx.lineTo(BASE_CX + BASE_HALF_B, GROUND_Y);
    ctx.lineTo(BASE_CX - BASE_HALF_B, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    // Wheels (visible circles at base edges).
    ctx.fillStyle = T.bgElev;
    ctx.strokeStyle = T.fgMuted;
    ctx.lineWidth = 1;
    const wheelR = 7;
    const wheelLX = BASE_CX - BASE_HALF_B + 2;
    const wheelRX = BASE_CX + BASE_HALF_B - 2;
    const wheelY  = GROUND_Y - 2;
    ctx.beginPath(); ctx.arc(wheelLX, wheelY, wheelR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(wheelRX, wheelY, wheelR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Wheel hubs.
    ctx.fillStyle = T.fgMuted;
    ctx.beginPath(); ctx.arc(wheelLX, wheelY, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(wheelRX, wheelY, 2, 0, Math.PI * 2); ctx.fill();

    // Scale figures (the human-scale touch from the screenshots).
    drawScaleFigures(ctx);

    // Pull-tension power factor (0..1).
    const pullT = Math.min(1, state.arm.pullMs / PULL_FULL_MS);

    // Optional faint tension arc behind the arm during wind-up.
    if (state.arm.pulling && pullT > 0.05) {
      ctx.save();
      ctx.strokeStyle = T.amber;
      ctx.globalAlpha = 0.18 + 0.22 * pullT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      // Arc behind the pivot, opening upward.
      ctx.arc(BASE_CX, BASE_TOP_Y, BEAM_LEN * 0.55, Math.PI + 0.2, Math.PI * 2 - 0.2);
      ctx.stroke();
      ctx.restore();
    }

    // Beam arm + boulder sitting in bucket (unless in flight or over).
    let armTipX = BASE_CX;
    let armTipY = BASE_TOP_Y - BEAM_LEN;
    if (!state.projectile && !state.gameOver) {
      const boulderR = BOULDER_R_REST + (BOULDER_R_FULL - BOULDER_R_REST) * pullT;
      const tip = drawBeamArm(ctx, BASE_CX, BASE_TOP_Y, state.arm.angle, BEAM_LEN, boulderR);
      armTipX = tip.tipX; armTipY = tip.tipY;
    } else {
      // Arm at rest, empty bucket.
      const tip = drawBeamArm(ctx, BASE_CX, BASE_TOP_Y, BEAM_REST_RAD, BEAM_LEN, 0);
      armTipX = tip.tipX; armTipY = tip.tipY;
    }

    // --- Trajectory preview (during pullback OR idle with slider) -------
    // A dotted amber arc showing where the boulder would land at the
    // current "would-be" pullback radius. While the player is actively
    // pulling, that radius derives from pull duration. While idle, it
    // derives from the mobile POWER slider, so tapping +/- moves the
    // predicted arc live before the user commits to FIRE. Integrated with
    // the SAME semi-implicit Euler used in flight, so the dots track the
    // actual boulder path tightly.
    const showPullPreview = state.arm.pulling && pullT > 0.02 &&
                            !state.projectile && !state.gameOver;
    const showIdlePreview = !state.arm.pulling && !state.projectile && !state.gameOver;
    if (showPullPreview || showIdlePreview) {
      const previewR = showPullPreview
        ? (BOULDER_R_REST + (BOULDER_R_FULL - BOULDER_R_REST) * pullT)
        : frontPowerValue;
      const lp = launchPoint();
      const { vx0, vy0 } = launchVelocity(previewR);
      // Sub-step the integrator so the dots match what step() will draw.
      const SUBSTEPS_PER_DOT = 6;
      const subDt = PREVIEW_TIME_STEP / SUBSTEPS_PER_DOT;
      let sx = lp.x, sy = lp.y, svx = vx0, svy = vy0;
      ctx.save();
      ctx.fillStyle = T.amber;
      let drewLanding = false;
      for (let i = 1; i <= PREVIEW_DOT_COUNT && !drewLanding; i++) {
        for (let s = 0; s < SUBSTEPS_PER_DOT; s++) {
          svy += FRONT_GRAVITY * subDt;
          sx  += svx * subDt;
          sy  += svy * subDt;
        }
        // Stop dotting once we cross the wall plane within the column band
        // → mark a brighter terminal dot as the visual landing prediction.
        if (svy > 0 && sy >= TARGET_COL_Y_MID &&
            Math.abs(sx - TARGET_COL_CX) <= F_BRICK_W / 2 + 4) {
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(sx, sy, PREVIEW_DOT_R + 0.9, 0, Math.PI * 2);
          ctx.fill();
          drewLanding = true;
          break;
        }
        // Splash terminal: hit ground or off-screen.
        if (sy >= GROUND_Y - 2 || sx < 0 || sx > W || sy < -10) {
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.arc(sx, sy, PREVIEW_DOT_R, 0, Math.PI * 2);
          ctx.fill();
          drewLanding = true;
          break;
        }
        // Normal dot — fade with distance along arc.
        const fade = 0.7 - 0.45 * (i / PREVIEW_DOT_COUNT);
        ctx.globalAlpha = Math.max(0.18, fade);
        ctx.beginPath();
        ctx.arc(sx, sy, PREVIEW_DOT_R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- Projectile in flight — ballistic arc with depth-shrink ---------
    if (state.projectile) {
      const p = state.projectile;
      ctx.fillStyle = T.fg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, p.pr), 0, Math.PI * 2);
      ctx.fill();
      if (p.pr > 4) {
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // --- HUD overlays ----------------------------------------------------
    // Shot counter top-left.
    const hitsSoFar = HITS_TO_FELL - state.colDepth;
    ctx.fillStyle = T.fg;
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const shotLabel = state.gameOver
      ? 'Shot ' + state.shotsFired + '/' + FRONT_MAX_SHOTS
      : 'Shot ' + Math.min(state.shotsFired + 1, FRONT_MAX_SHOTS) +
        '/' + FRONT_MAX_SHOTS;
    ctx.fillText(shotLabel + '   column ' + hitsSoFar + '/' + HITS_TO_FELL, 10, 8);
    if (state.lastResult && !state.gameOver) {
      ctx.fillStyle =
        state.lastShotKind === 'hit'  ? T.blood :
        state.lastShotKind === 'over' ? T.teal  :
        T.amber;
      ctx.fillText(state.lastResult, 10, 24);
    }

    // Power bar with sweet-spot band marked.
    if (state.arm.pulling || pullT > 0.001) {
      const barX = 16, barY = H - 18, barW = 140, barH = 8;
      ctx.fillStyle = T.bgElev;
      ctx.fillRect(barX, barY, barW, barH);
      // Sweet-spot band (the launchR power range that scores a clean hit).
      // launchR = BOULDER_R_REST + (FULL - REST) * power → solve for power:
      const sweetMin = (FRONT_SWEET_R - FRONT_SWEET_TOL - BOULDER_R_REST) /
                       (BOULDER_R_FULL - BOULDER_R_REST);
      const sweetMax = (FRONT_SWEET_R + FRONT_SWEET_TOL - BOULDER_R_REST) /
                       (BOULDER_R_FULL - BOULDER_R_REST);
      ctx.fillStyle = 'rgba(95,181,176,0.35)';     // teal band
      ctx.fillRect(barX + barW * sweetMin, barY,
                   barW * (sweetMax - sweetMin), barH);
      // Current power fill.
      ctx.fillStyle = T.amber;
      ctx.fillRect(barX, barY, barW * pullT, barH);
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

    // Idle prompt / game over.
    if (!state.projectile && !state.gameOver && !state.arm.pulling) {
      ctx.fillStyle = T.fgMuted;
      ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('hold — aim the dotted arc onto the column', W - 10, 8);
    }
    if (state.gameOver) {
      ctx.fillStyle = state.won ? T.amber : T.blood;
      ctx.font = 'bold 22px Iowan Old Style, Charter, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.won ? 'VICTORY' : 'THE SIEGE FAILS', W / 2, 80);
      ctx.fillStyle = T.fgMuted;
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      if (state.won) {
        ctx.fillText('the column is breached', W / 2, 108);
      } else {
        ctx.fillText('the column still stands after 6 shots', W / 2, 108);
      }
    }
  }

  // ---- Boot ------------------------------------------------------------
  state = freshState();
  refreshControls();

  return {
    step,
    draw,
    cleanup: () => {
      cleanupTension();
      btnReset.removeEventListener('click', onReset);
      for (const [b, fn] of frontStepHandlers) b.removeEventListener('click', fn);
      frontFireBtn.removeEventListener('click', onFrontFire);
    },
  };
}
