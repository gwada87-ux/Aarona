import { describe, expect, it } from 'vitest';
import { computeGridConfidence, computeOnsetDensityNorm, regimeFor } from '../../src/analysis/gridConfidence';

describe('analysis/gridConfidence (docs/05 §8)', () => {
  it('confiance haute (tempo/beats/densité solides) → régime événementiel', () => {
    const density = computeOnsetDensityNorm(200, 20); // 10 onsets/s
    const confidence = computeGridConfidence(0.9, 0.85, density);
    expect(confidence).toBeGreaterThanOrEqual(0.6);
    expect(regimeFor(confidence)).toBe('event');
  });

  it('confiance basse (morceau sans percussion nette) → régime continu', () => {
    const density = computeOnsetDensityNorm(5, 20); // quasi pas d'onsets
    const confidence = computeGridConfidence(0.2, 0.15, density);
    expect(confidence).toBeLessThan(0.6);
    expect(regimeFor(confidence)).toBe('continuous');
  });

  it('densité normalisée saturée à 1 au-delà de la référence (edge-04 Hyperpop)', () => {
    expect(computeOnsetDensityNorm(1600, 20)).toBe(1); // 80 onsets/s, largement au-dessus
    expect(computeOnsetDensityNorm(0, 20)).toBe(0);
  });

  it('durée nulle → densité 0, pas de division par zéro', () => {
    expect(computeOnsetDensityNorm(10, 0)).toBe(0);
  });

  it('confiance toujours bornée à [0,1] même avec des entrées hors plage', () => {
    expect(computeGridConfidence(2, 2, 2)).toBe(1);
    expect(computeGridConfidence(-1, -1, -1)).toBe(0);
  });
});
