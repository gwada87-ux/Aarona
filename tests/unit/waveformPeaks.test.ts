import { describe, expect, it } from 'vitest';
import { computeWaveformPeaks } from '../../src/analysis/waveformPeaks';

describe('analysis/waveformPeaks', () => {
  it('produit exactement bucketCount compartiments, min ≤ max partout', () => {
    const n = 100000;
    const signal = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 5 * i) / n));
    const peaks = computeWaveformPeaks(signal, 2048);
    expect(peaks.min.length).toBe(2048);
    expect(peaks.max.length).toBe(2048);
    for (let i = 0; i < 2048; i++) {
      expect(peaks.min[i]!).toBeLessThanOrEqual(peaks.max[i]!);
    }
  });

  it('capture les crêtes réelles (une seule impulsion dans un compartiment)', () => {
    const n = 20480; // 10 échantillons par compartiment à 2048 buckets
    const signal = new Float64Array(n);
    signal[5000] = 1.0;
    const peaks = computeWaveformPeaks(signal, 2048);
    const bucketOfSpike = Math.floor(5000 / (n / 2048));
    expect(peaks.max[bucketOfSpike]).toBe(1.0);
  });

  it('silence → min et max à 0 partout', () => {
    const peaks = computeWaveformPeaks(new Float64Array(4096), 2048);
    for (let i = 0; i < 2048; i++) {
      expect(peaks.min[i]).toBe(0);
      expect(peaks.max[i]).toBe(0);
    }
  });
});
