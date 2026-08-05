import { describe, expect, it } from 'vitest';
import { extractBassContour, lowpassButterworth4, trackPitch } from '../../src/analysis/bassContour';

const SAMPLE_RATE = 22050;

function buildSine(freqHz: number, durationSec: number, sampleRate: number, amp = 0.8): Float64Array {
  const n = Math.round(durationSec * sampleRate);
  return Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freqHz * i) / sampleRate));
}

describe('analysis/bassContour', () => {
  it('lowpassButterworth4 atténue fortement un signal à 2kHz (largement au-dessus de 200Hz)', () => {
    const signal = buildSine(2000, 0.2, SAMPLE_RATE);
    const filtered = lowpassButterworth4(signal, SAMPLE_RATE);
    const inputRms = Math.sqrt(signal.reduce((s, v) => s + v * v, 0) / signal.length);
    // On ignore les ~50 premiers ms (établissement du filtre).
    const settled = filtered.subarray(Math.round(0.05 * SAMPLE_RATE));
    const outputRms = Math.sqrt(settled.reduce((s, v) => s + v * v, 0) / settled.length);
    expect(outputRms / inputRms).toBeLessThan(0.05);
  });

  it("lowpassButterworth4 laisse passer un signal à 60Hz (largement sous 200Hz)", () => {
    const signal = buildSine(60, 0.2, SAMPLE_RATE);
    const filtered = lowpassButterworth4(signal, SAMPLE_RATE);
    const inputRms = Math.sqrt(signal.reduce((s, v) => s + v * v, 0) / signal.length);
    const settled = filtered.subarray(Math.round(0.05 * SAMPLE_RATE));
    const outputRms = Math.sqrt(settled.reduce((s, v) => s + v * v, 0) / settled.length);
    expect(outputRms / inputRms).toBeGreaterThan(0.85);
  });

  it('trackPitch retrouve la fréquence fondamentale d’une sinusoïde à 60Hz', () => {
    const signal = buildSine(60, 1, SAMPLE_RATE);
    const frames = trackPitch(signal, SAMPLE_RATE);
    expect(frames.length).toBeGreaterThan(0);
    const mid = frames[Math.floor(frames.length / 2)]!;
    expect(mid.f0).toBeCloseTo(60, 0);
    // L'autocorrélation non normalisée par le nombre de paires perd un peu
    // d'énergie aux bords de fenêtre (paires non recouvrantes au lag) : une
    // sinusoïde parfaite ne donne pas exactement 1, mais reste nettement haute.
    expect(mid.confidence).toBeGreaterThan(0.7);
  });

  it('note tenue à 60Hz (≥80ms) → un segment, midi correct (docs/04 l.195)', () => {
    const signal = buildSine(60, 1, SAMPLE_RATE);
    const segments = extractBassContour(signal, SAMPLE_RATE);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    const seg = segments[0]!;
    const expectedMidi = 69 + 12 * Math.log2(60 / 440);
    expect(seg.midi).toBeCloseTo(expectedMidi, 0);
    expect(seg.dur).toBeGreaterThan(0.08);
  });

  it('changement net de hauteur (>40 cents) → segments distincts', () => {
    const durationSec = 0.5;
    const low = buildSine(40, durationSec, SAMPLE_RATE);
    const high = buildSine(80, durationSec, SAMPLE_RATE); // une octave plus haut, largement >40 cents
    const signal = new Float64Array(low.length + high.length);
    signal.set(low, 0);
    signal.set(high, low.length);

    const segments = extractBassContour(signal, SAMPLE_RATE);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0]!.midi).toBeLessThan(segments[segments.length - 1]!.midi);
  });

  it('silence total → aucun segment', () => {
    const segments = extractBassContour(new Float64Array(SAMPLE_RATE), SAMPLE_RATE);
    expect(segments.length).toBe(0);
  });
});

/**
 * Régression Étape 19 : `trackPitch` a été réécrit pour calculer l'autocorrélation par FFT
 * (Wiener-Khinchin) plutôt que par somme directe — la somme directe dominait le temps d'analyse
 * d'un morceau entier (~9,4 s sur 4 min, docs/JOURNAL.md Étape 17/P15). Ce test compare directement
 * à la somme directe d'origine (copiée telle quelle, jamais optimisée) pour prouver que le
 * résultat numérique n'a pas changé.
 */
describe('analysis/bassContour — trackPitch régression vs somme directe (Étape 19)', () => {
  const MIN_F0_HZ = 27.5;
  const MAX_F0_HZ = 200;
  const PITCH_WINDOW = 2048;
  const PITCH_HOP = 512;

  function trackPitchNaive(lowpassed: Float64Array, sampleRate: number) {
    const minLag = Math.max(1, Math.round(sampleRate / MAX_F0_HZ));
    const maxLag = Math.round(sampleRate / MIN_F0_HZ);
    const numFrames = Math.max(0, Math.floor((lowpassed.length - PITCH_WINDOW) / PITCH_HOP) + 1);
    const out: { t: number; f0: number; confidence: number }[] = [];
    for (let i = 0; i < numFrames; i++) {
      const start = i * PITCH_HOP;
      const seg = lowpassed.subarray(start, start + PITCH_WINDOW);
      let energy0 = 0;
      for (let n = 0; n < seg.length; n++) energy0 += seg[n]! * seg[n]!;
      let bestLag = minLag;
      let bestCorr = -Infinity;
      for (let lag = minLag; lag <= maxLag && lag < seg.length; lag++) {
        let sum = 0;
        for (let n = 0; n + lag < seg.length; n++) sum += seg[n]! * seg[n + lag]!;
        if (sum > bestCorr) {
          bestCorr = sum;
          bestLag = lag;
        }
      }
      const f0 = sampleRate / bestLag;
      const confidence = energy0 > 0 ? Math.max(0, Math.min(1, bestCorr / energy0)) : 0;
      const t = (start + PITCH_WINDOW / 2) / sampleRate;
      out.push({ t, f0, confidence });
    }
    return out;
  }

  it('signal composite (sinusoïde + bruit) : mêmes f0/confidence à 1e-6 près, image par image', () => {
    const n = SAMPLE_RATE * 2; // 2s, plusieurs images
    let seed = 3;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    const signal = Float64Array.from({ length: n }, (_, i) => 0.7 * Math.sin((2 * Math.PI * 55 * i) / SAMPLE_RATE) + 0.05 * rand());

    const expected = trackPitchNaive(signal, SAMPLE_RATE);
    const actual = trackPitch(signal, SAMPLE_RATE);

    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i]!.t).toBe(expected[i]!.t);
      expect(actual[i]!.f0).toBeCloseTo(expected[i]!.f0, 6);
      expect(actual[i]!.confidence).toBeCloseTo(expected[i]!.confidence, 6);
    }
  });
});
