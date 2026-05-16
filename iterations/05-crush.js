// 05-crush.js — Crush the Castle / Angry Birds (2009)
// Drag-back slingshot release; hand-rolled rigid body physics via
// Position-Based Dynamics (Verlet + distance constraints). Each block is
// 4 corner particles tied by 4 edge constraints + 2 diagonals; collisions
// resolve via SAT between oriented quads, with positional pushout + impulse.
//
// This iteration deliberately stops short of "best on the page." The stack
// topples plausibly. It is not a physics engine.

import { attachCanvas } from '../lib/canvas.js';
import { dragVector } from '../lib/input.js';
import { mulberry32 } from '../lib/rng.js';

const W = 640;
const H = 400;
const GROUND_Y = 370;
const SLING_X = 120;
const SLING_Y = 300;
const SLING_TOP = 270;          // where projectile sits before launch
const PROJECTILE_RADIUS = 9;
const PROJECTILES_PER_LEVEL = 3;

const GRAVITY = 1400;           // px / s^2
const SUBSTEPS = 4;
const CONSTRAINT_ITER = 6;      // PBD relaxation passes per substep
const DAMPING = 0.995;          // global velocity damping (per substep)
const SLEEP_SPEED = 0.15;       // below this px/substep, snap to rest
const GROUND_FRICTION = 0.7;
const RESTITUTION = 0.05;       // collision bounce (low → reads as stone)
const MAX_DRAG = 110;           // clamp drag magnitude (px)
const LAUNCH_GAIN = 6.5;        // px/s of velocity per px of drag

const COLORS = {
  bg:        '#15171a',
  ground:    '#2a2c30',
  rule:      '#2a2c30',
  fg:        '#e6e1d4',
  muted:     '#8a8275',
  amber:     '#d4a256',
  teal:      '#5fb5b0',
  blood:     '#8a3a32',
  wood:      '#6b5237',
  stone:     '#4a4d52',
  target:    '#d4a256',
  preview:   '#8a8275',
};

// ---------- math helpers ----------
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const perp = (a) => ({ x: -a.y, y: a.x });

// ---------- block factory ----------
// A block is a rectangle of (w x h) centered at (cx, cy), rotated by angle.
// Stored as 4 corner particles (top-left, top-right, bottom-right, bottom-left)
// in canvas coordinates (y grows downward).
function makeBlock(cx, cy, w, h, opts = {}) {
  const hw = w / 2, hh = h / 2;
  const corners = [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh },
  ];
  const particles = corners.map((c) => ({
    x: c.x, y: c.y, px: c.x, py: c.y,
  }));
  // Distance constraints: 4 edges + 2 diagonals (preserves rectangle shape).
  const pairs = [[0,1],[1,2],[2,3],[3,0],[0,2],[1,3]];
  const constraints = pairs.map(([i, j]) => {
    const dx = particles[i].x - particles[j].x;
    const dy = particles[i].y - particles[j].y;
    return { i, j, rest: Math.hypot(dx, dy) };
  });
  return {
    particles,
    constraints,
    w, h,
    invMass: opts.invMass ?? 1 / (w * h * 0.01),
    isTarget: !!opts.isTarget,
    isProjectile: !!opts.isProjectile,
    alive: true,
    color: opts.color || COLORS.stone,
  };
}

function blockCenter(b) {
  let x = 0, y = 0;
  for (const p of b.particles) { x += p.x; y += p.y; }
  return { x: x / 4, y: y / 4 };
}

function blockSpeed(b) {
  let s = 0;
  for (const p of b.particles) s = Math.max(s, Math.hypot(p.x - p.px, p.y - p.py));
  return s;
}

// ---------- PBD step ----------
function integrate(blocks, dt) {
  for (const b of blocks) {
    if (!b.alive) continue;
    for (const p of b.particles) {
      const vx = (p.x - p.px) * DAMPING;
      const vy = (p.y - p.py) * DAMPING;
      p.px = p.x; p.py = p.y;
      p.x += vx;
      p.y += vy + GRAVITY * dt * dt;
    }
  }
}

function satisfyConstraints(blocks) {
  for (const b of blocks) {
    if (!b.alive) continue;
    for (const c of b.constraints) {
      const a = b.particles[c.i];
      const d = b.particles[c.j];
      const dx = d.x - a.x;
      const dy = d.y - a.y;
      const dist = Math.hypot(dx, dy) || 1e-6;
      const diff = (dist - c.rest) / dist * 0.5;
      const ox = dx * diff, oy = dy * diff;
      a.x += ox; a.y += oy;
      d.x -= ox; d.y -= oy;
    }
  }
}

function groundConstraint(blocks) {
  for (const b of blocks) {
    if (!b.alive) continue;
    for (const p of b.particles) {
      if (p.y > GROUND_Y) {
        const vx = p.x - p.px;
        p.y = GROUND_Y;
        // friction along ground tangent: damp horizontal velocity.
        p.px = p.x - vx * GROUND_FRICTION;
        p.py = p.y;
      }
      // Side walls (soft).
      if (p.x < 4) { p.x = 4; p.px = p.x; }
      if (p.x > W - 4) { p.x = W - 4; p.px = p.x; }
    }
  }
}

// ---------- SAT collision between two oriented quads ----------
// Returns { normal, depth } in world space (normal points from B → A),
// or null if no overlap. Particles are pushed apart along the normal.
function sat(a, b) {
  const polys = [a.particles, b.particles];
  let minOverlap = Infinity;
  let bestAxis = null;
  for (let pi = 0; pi < 2; pi++) {
    const poly = polys[pi];
    for (let i = 0; i < 4; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % 4];
      const edge = sub(p2, p1);
      const axis = norm(perp(edge));
      // project both polygons onto axis.
      let aMin = Infinity, aMax = -Infinity;
      let bMin = Infinity, bMax = -Infinity;
      for (const p of a.particles) {
        const d = dot(p, axis);
        if (d < aMin) aMin = d;
        if (d > aMax) aMax = d;
      }
      for (const p of b.particles) {
        const d = dot(p, axis);
        if (d < bMin) bMin = d;
        if (d > bMax) bMax = d;
      }
      const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (overlap <= 0) return null;
      if (overlap < minOverlap) {
        minOverlap = overlap;
        // ensure axis points from b → a
        const ca = (aMin + aMax) * 0.5;
        const cb = (bMin + bMax) * 0.5;
        bestAxis = ca < cb ? { x: -axis.x, y: -axis.y } : axis;
      }
    }
  }
  return { normal: bestAxis, depth: minOverlap };
}

function resolveCollisions(blocks) {
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      if (!b.alive) continue;
      // Cheap AABB reject.
      const ab = aabb(a), bb = aabb(b);
      if (ab.maxX < bb.minX || ab.minX > bb.maxX) continue;
      if (ab.maxY < bb.minY || ab.minY > bb.maxY) continue;
      const hit = sat(a, b);
      if (!hit) continue;
      const totalInv = a.invMass + b.invMass;
      if (totalInv === 0) continue;
      const aShare = a.invMass / totalInv;
      const bShare = b.invMass / totalInv;
      const push = scale(hit.normal, hit.depth);
      // Move A along +normal, B along -normal, weighted by inverse mass.
      for (const p of a.particles) {
        p.x += push.x * aShare;
        p.y += push.y * aShare;
      }
      for (const p of b.particles) {
        p.x -= push.x * bShare;
        p.y -= push.y * bShare;
      }
      // Approximate impulse: damp relative velocity along the normal so
      // collisions read as stone, not rubber. (Restitution is tiny.)
      const aVel = blockVel(a);
      const bVel = blockVel(b);
      const rel = sub(aVel, bVel);
      const vn = dot(rel, hit.normal);
      if (vn < 0) {
        const dv = -(1 + RESTITUTION) * vn;
        const ja = dv * aShare;
        const jb = dv * bShare;
        // Convert back into prev-position shifts.
        for (const p of a.particles) { p.px -= hit.normal.x * ja; p.py -= hit.normal.y * ja; }
        for (const p of b.particles) { p.px += hit.normal.x * jb; p.py += hit.normal.y * jb; }
        // Mark targets hit with sufficient impact.
        const impact = Math.abs(vn);
        if (a.isTarget && impact > 2.0) a.alive = false;
        if (b.isTarget && impact > 2.0) b.alive = false;
      }
    }
  }
}

function blockVel(b) {
  let vx = 0, vy = 0;
  for (const p of b.particles) { vx += p.x - p.px; vy += p.y - p.py; }
  return { x: vx / 4, y: vy / 4 };
}

function aabb(b) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of b.particles) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function sleepLowEnergy(blocks) {
  for (const b of blocks) {
    if (!b.alive) continue;
    const ab = aabb(b);
    if (ab.maxY < GROUND_Y - 1) continue; // only sleep grounded contacts
    if (blockSpeed(b) < SLEEP_SPEED) {
      for (const p of b.particles) { p.px = p.x; p.py = p.y; }
    }
  }
}

// ---------- level layout ----------
function buildLevel(seed) {
  const rand = mulberry32(seed);
  const blocks = [];
  // Castle floor anchor at x ~ 460, on the ground.
  const baseX = 470;
  const wide = 56, tall = 18;
  const stone = COLORS.stone;
  const wood = COLORS.wood;

  // Two pillars + lintel (Stonehenge cell).
  blocks.push(makeBlock(baseX - 36, GROUND_Y - tall * 2 - 8, tall, tall * 4, { color: stone }));
  blocks.push(makeBlock(baseX + 36, GROUND_Y - tall * 2 - 8, tall, tall * 4, { color: stone }));
  blocks.push(makeBlock(baseX,       GROUND_Y - tall * 4 - 16 - tall / 2, wide * 1.8, tall, { color: wood }));

  // Second-tier pillars on top of the lintel.
  const top = GROUND_Y - tall * 4 - 16 - tall;
  blocks.push(makeBlock(baseX - 22, top - tall * 1.5, tall * 0.9, tall * 3, { color: stone }));
  blocks.push(makeBlock(baseX + 22, top - tall * 1.5, tall * 0.9, tall * 3, { color: stone }));

  // Capstone.
  blocks.push(makeBlock(baseX, top - tall * 3 - tall / 2, wide * 1.1, tall, { color: wood }));

  // Targets — two small dark blocks tucked between pillars.
  const t1 = makeBlock(baseX - 18, GROUND_Y - 9, 14, 14, { isTarget: true, color: COLORS.blood });
  const t2 = makeBlock(baseX + 18, GROUND_Y - 9, 14, 14, { isTarget: true, color: COLORS.blood });
  blocks.push(t1, t2);

  // Add tiny RNG jitter to particle positions so the stack settles
  // deterministically but not artificially perfectly.
  for (const b of blocks) {
    for (const p of b.particles) {
      const jx = (rand() - 0.5) * 0.3;
      const jy = (rand() - 0.5) * 0.3;
      p.x += jx; p.px += jx;
      p.y += jy; p.py += jy;
    }
  }
  return blocks;
}

// ---------- projectile preview ----------
function previewArc(vx, vy) {
  const pts = [];
  let x = SLING_X, y = SLING_TOP;
  let dt = 1 / 30;
  for (let i = 0; i < 26; i++) {
    pts.push({ x, y });
    x += vx * dt;
    y += vy * dt;
    vy += GRAVITY * dt;
    if (y > GROUND_Y) break;
    if (x > W) break;
  }
  return pts;
}

// ---------- mount ----------
export function mount(rootEl) {
  // Idempotency: if a prior mount is still live on this root, tear it down
  // before starting a new one. Prevents duplicate canvases and a second rAF
  // loop accumulating in the background.
  if (rootEl.__crushCleanup) {
    try { rootEl.__crushCleanup(); } catch (_) { /* swallow */ }
    rootEl.__crushCleanup = null;
  }
  rootEl.innerHTML = '';

  const { canvas, ctx } = attachCanvas(rootEl, { width: W, height: H });

  // HUD lives in DOM (text describing shots left, win/lose).
  const hud = document.createElement('p');
  hud.className = 'mono muted';
  hud.style.marginTop = '0.5rem';
  hud.style.minHeight = '1.4em';
  rootEl.appendChild(hud);

  const reroll = document.createElement('button');
  reroll.type = 'button';
  reroll.className = 'mono';
  reroll.textContent = 'Re-roll';
  reroll.style.marginLeft = '0.75rem';
  hud.appendChild(reroll);

  let seed = 2009;
  let blocks = buildLevel(seed);
  let projectile = null;       // active flying block
  let shotsLeft = PROJECTILES_PER_LEVEL;
  let aiming = false;
  let drag = { dx: 0, dy: 0 };
  let status = 'idle';         // 'idle' | 'flying' | 'won' | 'lost'
  let rafId = 0;
  let lastTs = 0;

  function targetsLeft() { return blocks.filter((b) => b.isTarget && b.alive).length; }

  function setStatus(s) {
    status = s;
    updateHud();
  }

  function updateHud() {
    const left = targetsLeft();
    let msg = '';
    if (status === 'won') msg = `Castle fallen. ${shotsLeft} of ${PROJECTILES_PER_LEVEL} stones spared.`;
    else if (status === 'lost') msg = `Out of stones. ${left} target${left===1?'':'s'} still standing.`;
    else msg = `Shots: ${shotsLeft}/${PROJECTILES_PER_LEVEL}   Targets: ${left}`;
    // Replace text node only — keep the button.
    while (hud.firstChild && hud.firstChild !== reroll) hud.removeChild(hud.firstChild);
    hud.insertBefore(document.createTextNode(msg + '  '), reroll);
  }

  function resetLevel(newSeed) {
    if (typeof newSeed === 'number') seed = newSeed;
    blocks = buildLevel(seed);
    projectile = null;
    shotsLeft = PROJECTILES_PER_LEVEL;
    setStatus('idle');
  }

  reroll.addEventListener('click', (e) => {
    e.preventDefault();
    resetLevel((seed + 1) | 0);
  });

  // Input — only allow drag when no projectile is in flight and shots remain.
  const cleanupInput = dragVector(canvas, {
    onStart: () => {
      if (projectile || shotsLeft <= 0 || status === 'won') return;
      aiming = true;
      drag = { dx: 0, dy: 0 };
    },
    onUpdate: ({ dx, dy }) => {
      if (!aiming) return;
      // Clamp drag magnitude.
      const m = Math.hypot(dx, dy);
      if (m > MAX_DRAG) {
        const k = MAX_DRAG / m;
        dx *= k; dy *= k;
      }
      drag = { dx, dy };
    },
    onRelease: ({ dx, dy }) => {
      if (!aiming) return;
      aiming = false;
      const m = Math.hypot(dx, dy);
      if (m < 6) { drag = { dx: 0, dy: 0 }; return; }
      const k = Math.min(MAX_DRAG, m) / m;
      const vx = -dx * k * LAUNCH_GAIN;
      const vy = -dy * k * LAUNCH_GAIN;
      // Spawn projectile as a small block at sling top.
      projectile = makeBlock(SLING_X, SLING_TOP, 16, 16, {
        isProjectile: true,
        color: COLORS.amber,
      });
      // Set initial velocity by offsetting prev positions.
      const sub_dt = 1 / 60 / SUBSTEPS;
      for (const p of projectile.particles) {
        p.px = p.x - vx * sub_dt;
        p.py = p.y - vy * sub_dt;
      }
      blocks.push(projectile);
      shotsLeft -= 1;
      setStatus('flying');
      drag = { dx: 0, dy: 0 };
    },
  });

  // ---------- main loop ----------
  function physicsStep(dt) {
    const sub_dt = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      integrate(blocks, sub_dt);
      for (let k = 0; k < CONSTRAINT_ITER; k++) {
        satisfyConstraints(blocks);
        resolveCollisions(blocks);
        groundConstraint(blocks);
      }
      sleepLowEnergy(blocks);
    }
    // Remove off-screen or fallen-target blocks.
    for (const b of blocks) {
      if (!b.alive) continue;
      const c = blockCenter(b);
      if (c.x < -40 || c.x > W + 40 || c.y > H + 40) {
        if (b.isTarget) b.alive = false;
        else if (b.isProjectile) b.alive = false;
      }
    }
    // Garbage-collect dead non-target blocks so the loop stays small.
    blocks = blocks.filter((b) => b.alive || b.isTarget);
    // Check win/lose.
    if (status === 'flying') {
      // Settled when projectile + all blocks are nearly still.
      const stillness = blocks.every((b) => !b.alive || blockSpeed(b) < SLEEP_SPEED * 1.5);
      if (targetsLeft() === 0) setStatus('won');
      else if (stillness) {
        // Projectile came to rest without finishing the job.
        if (shotsLeft <= 0) setStatus('lost');
        else { projectile = null; setStatus('idle'); }
      }
    }
  }

  function draw() {
    // Backdrop.
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    // Ground line.
    ctx.strokeStyle = COLORS.ground;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 0.5);
    ctx.lineTo(W, GROUND_Y + 0.5);
    ctx.stroke();

    // Sling — a Y of two posts with a band.
    ctx.strokeStyle = COLORS.fg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SLING_X, GROUND_Y);
    ctx.lineTo(SLING_X, SLING_Y);
    ctx.moveTo(SLING_X, SLING_Y);
    ctx.lineTo(SLING_X - 10, SLING_TOP);
    ctx.moveTo(SLING_X, SLING_Y);
    ctx.lineTo(SLING_X + 10, SLING_TOP);
    ctx.stroke();

    // Aiming pouch + trajectory preview.
    if (aiming) {
      const m = Math.hypot(drag.dx, drag.dy);
      const k = m > 0 ? Math.min(MAX_DRAG, m) / m : 0;
      const px = SLING_X + drag.dx * k;
      const py = SLING_TOP + drag.dy * k;
      ctx.strokeStyle = COLORS.amber;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(SLING_X - 10, SLING_TOP);
      ctx.lineTo(px, py);
      ctx.lineTo(SLING_X + 10, SLING_TOP);
      ctx.stroke();
      ctx.fillStyle = COLORS.amber;
      ctx.beginPath();
      ctx.arc(px, py, PROJECTILE_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // Preview arc.
      const vx = -drag.dx * k * LAUNCH_GAIN;
      const vy = -drag.dy * k * LAUNCH_GAIN;
      const pts = previewArc(vx, vy);
      for (let i = 0; i < pts.length; i++) {
        const t = i / pts.length;
        ctx.fillStyle = `rgba(138,130,117,${1 - t})`;
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (!projectile && status !== 'won' && status !== 'lost' && shotsLeft > 0) {
      // Idle pouch with stone resting on it.
      ctx.strokeStyle = COLORS.muted;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(SLING_X - 10, SLING_TOP);
      ctx.lineTo(SLING_X + 10, SLING_TOP);
      ctx.stroke();
      ctx.fillStyle = COLORS.amber;
      ctx.beginPath();
      ctx.arc(SLING_X, SLING_TOP, PROJECTILE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // Blocks.
    for (const b of blocks) {
      if (!b.alive) continue;
      ctx.beginPath();
      ctx.moveTo(b.particles[0].x, b.particles[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(b.particles[i].x, b.particles[i].y);
      ctx.closePath();
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = b.isTarget ? COLORS.amber : 'rgba(0,0,0,0.4)';
      ctx.stroke();
      if (b.isTarget) {
        // Mark targets with a small inner dot.
        const c = blockCenter(b);
        ctx.fillStyle = COLORS.amber;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Remaining stone indicator (top-left).
    ctx.fillStyle = COLORS.muted;
    for (let i = 0; i < shotsLeft - (projectile ? 0 : 0); i++) {
      ctx.beginPath();
      ctx.arc(20 + i * 16, 22, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Status overlay.
    if (status === 'won' || status === 'lost') {
      ctx.fillStyle = 'rgba(13,14,16,0.72)';
      ctx.fillRect(0, H / 2 - 28, W, 56);
      ctx.fillStyle = status === 'won' ? COLORS.amber : COLORS.muted;
      ctx.font = '18px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        status === 'won' ? 'CASTLE FALLEN' : 'OUT OF STONES',
        W / 2, H / 2 - 6,
      );
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = COLORS.muted;
      ctx.fillText('Press Re-roll to try a new layout.', W / 2, H / 2 + 14);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  function frame(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 1 / 30) dt = 1 / 30; // clamp after tab-switches
    physicsStep(dt);
    draw();
    rafId = requestAnimationFrame(frame);
  }

  updateHud();
  rafId = requestAnimationFrame(frame);

  const cleanup = function cleanup() {
    cancelAnimationFrame(rafId);
    cleanupInput();
    rootEl.innerHTML = '';
    if (rootEl.__crushCleanup === cleanup) rootEl.__crushCleanup = null;
  };
  rootEl.__crushCleanup = cleanup;
  return cleanup;
}
