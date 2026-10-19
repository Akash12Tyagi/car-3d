/**
 * Monotone Hermite interpolation through timed keys.
 *
 * Tangents are the harmonic mean of the neighbouring slopes (zero where a
 * channel turns or holds), so no channel overshoots its keys: a camera never
 * dips below a key's height or swings past an angle and back. Both ends are at
 * rest. Channels listed in `log` are interpolated in log space (dolly
 * distances), which keeps perceived speed even.
 *
 * @param {Array<object>} keys  sorted by `t`; each key has every channel
 * @param {number} t
 * @param {string[]} channels
 * @param {{ log?: string[] }} [options]
 */
export function sampleMonotone(keys, t, channels, { log = [] } = {}) {
  const n = keys.length;
  const out = {};
  if (n === 1 || t <= keys[0].t) {
    for (const c of channels) out[c] = keys[0][c];
    return out;
  }
  if (t >= keys[n - 1].t) {
    for (const c of channels) out[c] = keys[n - 1][c];
    return out;
  }
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(n - 1, i + 2)];
  const span = k2.t - k1.t;
  const u = Math.min(1, Math.max(0, (t - k1.t) / span));
  const u2 = u * u;
  const u3 = u2 * u;
  for (const c of channels) {
    const isLog = log.includes(c);
    const v = (k) => (isLog ? Math.log(k[c]) : k[c]);
    const slope = (a, b) => (v(b) - v(a)) / (b.t - a.t);
    const tangent = (a, k, b) => {
      const s0 = slope(a, k);
      const s1 = slope(k, b);
      return s0 * s1 <= 0 ? 0 : (2 * s0 * s1) / (s0 + s1);
    };
    const m1 = i === 0 ? 0 : tangent(k0, k1, k2) * span;
    const m2 = i + 1 === n - 1 ? 0 : tangent(k1, k2, k3) * span;
    const y = (2 * u3 - 3 * u2 + 1) * v(k1) + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * v(k2) + (u3 - u2) * m2;
    out[c] = isLog ? Math.exp(y) : y;
  }
  return out;
}
