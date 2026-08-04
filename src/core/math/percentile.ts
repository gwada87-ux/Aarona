/** Percentile par interpolation linéaire sur rang trié. `p` dans [0,1]. */
export function percentile(data: ArrayLike<number>, p: number): number {
  const n = data.length;
  if (n === 0) return 0;
  const sorted = Float64Array.from(data).sort();
  if (n === 1) return sorted[0]!;
  const pos = Math.min(1, Math.max(0, p)) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function median(data: ArrayLike<number>): number {
  return percentile(data, 0.5);
}
