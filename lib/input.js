// input.js — pointer gestures with keyboard fallbacks.
// Two exports:
//   holdTension(target, handlers) — pointer-down begins a tension cycle;
//     onUpdate(elapsedMs) fires each animation frame while held;
//     onRelease(totalMs) fires on pointer-up. Space-bar mirrors the gesture.
//   dragVector(target, handlers) — pointer-down captures an origin;
//     onUpdate({dx,dy}) fires on pointer-move; onRelease({dx,dy}) on pointer-up.
//     Arrow keys + Space mirror the gesture (Space releases).
// Both return a cleanup function that detaches every listener.

export function holdTension(target, { onStart, onUpdate, onRelease } = {}) {
  if (!target) throw new Error('holdTension: target required');
  let startTs = 0;
  let rafId = 0;
  let active = false;

  const tick = () => {
    if (!active) return;
    onUpdate?.(performance.now() - startTs);
    rafId = requestAnimationFrame(tick);
  };

  const begin = (ev) => {
    if (active) return;
    active = true;
    startTs = performance.now();
    onStart?.();
    rafId = requestAnimationFrame(tick);
    if (ev?.preventDefault) ev.preventDefault();
  };

  const end = (ev) => {
    if (!active) return;
    active = false;
    cancelAnimationFrame(rafId);
    const total = performance.now() - startTs;
    onRelease?.(total);
    if (ev?.preventDefault) ev.preventDefault();
  };

  const onKeyDown = (ev) => { if (ev.code === 'Space' && !ev.repeat) begin(ev); };
  const onKeyUp = (ev) => { if (ev.code === 'Space') end(ev); };

  target.addEventListener('pointerdown', begin);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  target.addEventListener('pointerleave', end);
  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);

  return () => {
    active = false;
    cancelAnimationFrame(rafId);
    target.removeEventListener('pointerdown', begin);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    target.removeEventListener('pointerleave', end);
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
  };
}

export function dragVector(target, { onStart, onUpdate, onRelease } = {}) {
  if (!target) throw new Error('dragVector: target required');
  let origin = null;
  let captured = null;
  // Keyboard simulation state.
  let kbActive = false;
  let kbDx = 0, kbDy = 0;

  const rectPoint = (ev) => {
    const r = target.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  const onDown = (ev) => {
    if (origin) return;
    origin = rectPoint(ev);
    captured = ev.pointerId;
    target.setPointerCapture?.(ev.pointerId);
    onStart?.({ x: origin.x, y: origin.y });
    ev.preventDefault?.();
  };

  const onMove = (ev) => {
    if (!origin || ev.pointerId !== captured) return;
    const p = rectPoint(ev);
    onUpdate?.({ dx: p.x - origin.x, dy: p.y - origin.y });
  };

  const onUp = (ev) => {
    if (!origin || ev.pointerId !== captured) return;
    const p = rectPoint(ev);
    const out = { dx: p.x - origin.x, dy: p.y - origin.y };
    origin = null;
    captured = null;
    onRelease?.(out);
  };

  const onKeyDown = (ev) => {
    if (ev.code === 'Space' && !kbActive) {
      kbActive = true; kbDx = 0; kbDy = 0;
      onStart?.({ x: 0, y: 0 });
      ev.preventDefault();
      return;
    }
    if (!kbActive) return;
    const STEP = 8;
    if (ev.code === 'ArrowLeft')  { kbDx -= STEP; onUpdate?.({ dx: kbDx, dy: kbDy }); ev.preventDefault(); }
    if (ev.code === 'ArrowRight') { kbDx += STEP; onUpdate?.({ dx: kbDx, dy: kbDy }); ev.preventDefault(); }
    if (ev.code === 'ArrowUp')    { kbDy -= STEP; onUpdate?.({ dx: kbDx, dy: kbDy }); ev.preventDefault(); }
    if (ev.code === 'ArrowDown')  { kbDy += STEP; onUpdate?.({ dx: kbDx, dy: kbDy }); ev.preventDefault(); }
    if (ev.code === 'Enter') {
      kbActive = false;
      onRelease?.({ dx: kbDx, dy: kbDy });
      ev.preventDefault();
    }
  };

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
  target.addEventListener('keydown', onKeyDown);

  return () => {
    origin = null;
    captured = null;
    kbActive = false;
    target.removeEventListener('pointerdown', onDown);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    target.removeEventListener('keydown', onKeyDown);
  };
}
