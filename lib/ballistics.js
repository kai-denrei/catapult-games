// ballistics.js — single-step projectile integrator.
// state = { x, y, vx, vy }   (y grows downward in canvas space)
// env   = { gravity, wind, drag }
//   gravity : downward acceleration (px/s^2). Positive pulls projectile down.
//   wind    : horizontal acceleration (px/s^2). Signed; positive pushes right.
//   drag    : linear damping coefficient (1/s). 0 = vacuum.
// Returns a NEW state object — caller may keep the previous state for trails.
// dt is in seconds.

export function step(state, dt, env) {
  const gravity = env.gravity ?? 980;
  const wind = env.wind ?? 0;
  const drag = env.drag ?? 0;

  // Linear drag applied symmetrically to both velocity components.
  const damp = drag > 0 ? Math.max(0, 1 - drag * dt) : 1;

  const vx = (state.vx + wind * dt) * damp;
  const vy = (state.vy + gravity * dt) * damp;

  // Symplectic-ish: integrate position using the new velocity.
  return {
    x: state.x + vx * dt,
    y: state.y + vy * dt,
    vx,
    vy,
  };
}
