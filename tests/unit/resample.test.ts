import { describe, expect, it } from 'vitest';
import { resample } from '../../src/analysis/resample';

describe('analysis/resample', () => {
  it('longueur de sortie proportionnelle au ratio (48000 → 22050)', () => {
    const sourceRate = 48000;
    const targetRate = 22050;
    const durationSec = 1;
    const signal = new Float64Array(sourceRate * durationSec);
    const { signal: out } = resample(signal, sourceRate, targetRate);
    const expectedLength = Math.round(sourceRate * durationSec * (targetRate / sourceRate));
    expect(out.length).toBe(expectedLength);
  });

  it('préserve une sinusoïde à 1 kHz (amplitude et position temporelle)', () => {
    const sourceRate = 48000;
    const targetRate = 22050;
    const freq = 1000;
    const durationSec = 0.2;
    const n = Math.round(sourceRate * durationSec);
    const signal = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * freq * i) / sourceRate));
    const { signal: out, groupDelaySec } = resample(signal, sourceRate, targetRate);

    expect(groupDelaySec).toBe(0);

    // Comparaison au milieu du signal (hors bords, où le noyau est tronqué) :
    // même phase attendue à t = mid/sourceRate côté source et sortie.
    const midSec = durationSec / 2;
    const iSrc = Math.round(midSec * sourceRate);
    const iOut = Math.round(midSec * targetRate);
    expect(out[iOut]).toBeCloseTo(signal[iSrc]!, 1);
  });

  it('taux identique → copie exacte', () => {
    const signal = Float64Array.from([1, 2, 3, 4]);
    const { signal: out, groupDelaySec } = resample(signal, 22050, 22050);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
    expect(groupDelaySec).toBe(0);
  });
});
