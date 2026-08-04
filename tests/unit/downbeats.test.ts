import { describe, expect, it } from 'vitest';
import { detectDownbeat } from '../../src/analysis/downbeats';

describe('analysis/downbeats — detectDownbeat (docs/05 §3)', () => {
  it('phase 2 nettement marquée (kick fort + onset + nouveauté) → détectée avec confiance élevée', () => {
    const beatCount = 16;
    const beatFrameIndices = Array.from({ length: beatCount }, (_, i) => i * 10);
    const n = beatCount * 10 + 1;
    const bass = new Float64Array(n);
    const onset = new Float64Array(n);
    const novelty = new Float64Array(n);

    for (let b = 0; b < beatCount; b++) {
      const frame = beatFrameIndices[b]!;
      const strong = b % 4 === 2;
      bass[frame] = strong ? 1.0 : 0.1;
      onset[frame] = strong ? 1.0 : 0.15;
      novelty[frame] = strong ? 1.0 : 0.1;
    }

    const result = detectDownbeat({ beatFrameIndices, bassEnergyTrack: bass, onsetStrengthTrack: onset, noveltyTrack: novelty });
    expect(result.phase).toBe(2);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('aucun beat → phase 0, confiance nulle, pas de plantage', () => {
    const result = detectDownbeat({
      beatFrameIndices: [],
      bassEnergyTrack: new Float64Array(0),
      onsetStrengthTrack: new Float64Array(0),
      noveltyTrack: new Float64Array(0),
    });
    expect(result.phase).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('scores identiques sur les 4 phases → confiance proche de 0 (aucune phase ne domine)', () => {
    const beatCount = 8;
    const beatFrameIndices = Array.from({ length: beatCount }, (_, i) => i * 5);
    const n = beatCount * 5 + 1;
    const bass = new Float64Array(n).fill(0.5);
    const onset = new Float64Array(n).fill(0.5);
    const novelty = new Float64Array(n).fill(0.5);

    const result = detectDownbeat({ beatFrameIndices, bassEnergyTrack: bass, onsetStrengthTrack: onset, noveltyTrack: novelty });
    expect(result.confidence).toBeLessThan(0.1);
  });
});
