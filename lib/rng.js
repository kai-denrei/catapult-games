// rng.js — mulberry32 seeded PRNG.
// Returns a function: () => float in [0, 1). Identical seeds yield identical
// sequences, so iteration layouts stay stable across reloads and can be
// re-rolled by changing the seed.

export function mulberry32(seed) {
  let a = (seed | 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
