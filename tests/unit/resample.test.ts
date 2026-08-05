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

/**
 * Régression Étape 19 : `resample()` a été réécrit en polyphase précalculé par phase (au lieu de
 * recalculer le noyau sinc/Blackman à chaque échantillon de sortie) pour éliminer l'essentiel du
 * coût (mesuré ~6,6 s sur 4 min de signal avant, docs/JOURNAL.md Étape 17/P15). Ce test compare
 * directement au calcul NAÏF d'origine (copié tel quel, jamais optimisé) pour prouver que le
 * résultat numérique n'a pas changé — pas seulement que les tests existants, plus tolérants,
 * passent toujours.
 */
describe('analysis/resample — régression vs implémentation naïve (Étape 19)', () => {
  const KERNEL_HALF_PERIODS = 8;

  function sincRef(x: number): number {
    if (x === 0) return 1;
    const px = Math.PI * x;
    return Math.sin(px) / px;
  }

  function blackmanRef(u: number): number {
    if (u <= -1 || u >= 1) return 0;
    return 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
  }

  function resampleNaive(signal: Float64Array, sourceRate: number, targetRate: number): Float64Array {
    const ratio = targetRate / sourceRate;
    const cutoff = Math.min(1, ratio);
    const support = KERNEL_HALF_PERIODS / cutoff;
    const nIn = signal.length;
    const outLength = Math.max(0, Math.round(nIn * ratio));
    const out = new Float64Array(outLength);
    for (let nOut = 0; nOut < outLength; nOut++) {
      const tIn = nOut / ratio;
      const lo = Math.max(0, Math.ceil(tIn - support));
      const hi = Math.min(nIn - 1, Math.floor(tIn + support));
      let acc = 0;
      for (let k = lo; k <= hi; k++) {
        const d = tIn - k;
        const w = blackmanRef(d / support);
        acc += signal[k]! * sincRef(cutoff * d) * cutoff * w;
      }
      out[nOut] = acc;
    }
    return out;
  }

  function pseudoRandomSignal(n: number, seed: number): Float64Array {
    let s = seed;
    const rand = (): number => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return (s / 0x7fffffff) * 2 - 1;
    };
    return Float64Array.from({ length: n }, () => rand());
  }

  it('48000 → 22050 Hz (ratio non entier) : identique à 1e-9 près sur un signal aléatoire', () => {
    const signal = pseudoRandomSignal(4000, 11);
    const expected = resampleNaive(signal, 48000, 22050);
    const { signal: actual } = resample(signal, 48000, 22050);
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i]!, 9);
  });

  it('44100 → 22050 Hz (ratio 2:1 exact) : identique à 1e-9 près', () => {
    const signal = pseudoRandomSignal(4000, 22);
    const expected = resampleNaive(signal, 44100, 22050);
    const { signal: actual } = resample(signal, 44100, 22050);
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i]!, 9);
  });
});
