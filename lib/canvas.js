// canvas.js — DPI-aware canvas attachment.
// Returns { canvas, ctx, dpr }. Scales the 2D context once so callers can
// draw in CSS pixels and get crisp output on HiDPI displays.

export function attachCanvas(rootEl, { width, height } = {}) {
  if (!rootEl) throw new Error('attachCanvas: rootEl required');
  const w = Math.max(1, Math.floor(width || 640));
  const h = Math.max(1, Math.floor(height || 400));
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.setAttribute('tabindex', '0');

  const ctx = canvas.getContext('2d');
  // Scale once so all subsequent drawing is in CSS pixel units.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  rootEl.appendChild(canvas);
  return { canvas, ctx, dpr };
}
