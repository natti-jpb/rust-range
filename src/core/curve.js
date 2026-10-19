// AnimationCurve.Evaluate da Unity para chaves [time, value, inSlope, outSlope].
// Todas as curvas extraídas usam weightedMode 0 (Hermite cúbico) e pre/postInfinity = clamp.
export function evalCurve(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const [t0, v0, , o0] = keys[i];
  const [t1, v1, i1] = keys[i + 1];
  const dt = t1 - t0;
  const s = (t - t0) / dt;
  const s2 = s * s, s3 = s2 * s;
  const m0 = o0 * dt, m1 = i1 * dt;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * m1;
}
