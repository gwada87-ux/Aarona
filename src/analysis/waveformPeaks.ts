/**
 * Pics de waveform — analysis/waveformPeaks (docs/03_DATA_FLOW.md Étape 0,
 * "extraction des pics de waveform (2048 buckets) — pour la timeline UI").
 * Min/max par compartiment : représentation standard pour un rendu de forme
 * d'onde fidèle (contrairement à une simple moyenne, qui aplatit les crêtes).
 */

export interface WaveformPeaks {
  readonly min: Float32Array;
  readonly max: Float32Array;
  readonly bucketCount: number;
}

export function computeWaveformPeaks(signal: ArrayLike<number>, bucketCount = 2048): WaveformPeaks {
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  const samplesPerBucket = signal.length / bucketCount;

  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = Math.max(start + 1, Math.floor((b + 1) * samplesPerBucket));
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = start; i < end && i < signal.length; i++) {
      const v = signal[i]!;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn === Infinity) {
      mn = 0;
      mx = 0;
    }
    min[b] = mn;
    max[b] = mx;
  }

  return { min, max, bucketCount };
}
