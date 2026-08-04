import { describe, expect, it } from 'vitest';
import { frameCount, frameTimestamp, spectralFlux, stft, WINDOW_SIZE, HOP } from '../../src/analysis/stft';

describe('analysis/stft — frameCount / alignement', () => {
  it("produit le nombre de trames attendu pour un signal donné", () => {
    const n = WINDOW_SIZE + HOP * 10;
    const signal = new Float64Array(n);
    const frames = stft(signal);
    expect(frames.length).toBe(frameCount(n));
    expect(frames.length).toBe(11);
    expect(frames[0]!.length).toBe(WINDOW_SIZE / 2 + 1);
  });

  it('frameTimestamp place la trame 0 au centre de la première fenêtre', () => {
    const sampleRate = 22050;
    const t0 = frameTimestamp(0, { sampleRate });
    expect(t0).toBeCloseTo(WINDOW_SIZE / 2 / sampleRate, 9);
  });
});

/**
 * Test de Dirac — docs/04_AUDIO_ANALYSIS.md l.94-97, PORTÉ depuis
 * spike-analysis/dirac-test.mjs sur le code de production (analysis/stft.ts).
 * "Aucun autre travail DSP ne commence avant qu'il ne passe." Détecteur
 * minimal local (ancrage énergie + affinage ±6ms) — le vrai détecteur
 * multi-bandes de production vit dans analysis/onsets.ts et réutilise le
 * même principe (anchorToEnergyPeak / refine), validé ici en amont.
 */
function frameEnergy(frame: Float64Array): number {
  let e = 0;
  for (let k = 0; k < frame.length; k++) e += frame[k]!;
  return e;
}

function detectSingleOnset(
  signal: Float64Array,
  sampleRate: number,
  resamplerGroupDelaySec = 0,
): { coarseT: number; refinedT: number } {
  const frames = stft(signal);

  let bestI = 0;
  let bestV = -Infinity;
  for (let i = 0; i < frames.length; i++) {
    const e = frameEnergy(frames[i]!);
    if (e > bestV) {
      bestV = e;
      bestI = i;
    }
  }
  const coarseT = frameTimestamp(bestI, { sampleRate, resamplerGroupDelaySec });

  const searchCenterSec = coarseT + resamplerGroupDelaySec;
  const searchRadiusSamples = Math.round(0.006 * sampleRate);
  const centerSample = Math.round(searchCenterSec * sampleRate);
  const lo = Math.max(0, centerSample - searchRadiusSamples);
  const hi = Math.min(signal.length - 1, centerSample + searchRadiusSamples);

  let peakSample = centerSample;
  let peakAmp = -Infinity;
  for (let n = lo; n <= hi; n++) {
    const a = Math.abs(signal[n]!);
    if (a > peakAmp) {
      peakAmp = a;
      peakSample = n;
    }
  }
  const refinedT = peakSample / sampleRate - resamplerGroupDelaySec;
  return { coarseT, refinedT };
}

function buildSilenceWithImpulse(atSec: number, sampleRate: number, durationSec: number): Float64Array {
  const n = Math.round(durationSec * sampleRate);
  const sig = new Float64Array(n);
  sig[Math.round(atSec * sampleRate)] = 1.0;
  return sig;
}

describe('test de Dirac (docs/04 l.94-97) — obligatoire avant tout autre travail DSP', () => {
  const SAMPLE_RATE = 22050;
  const DURATION_S = 6;
  const TARGET_S = 3.0;
  const TOLERANCE_MS = 2;

  it('impulsion à t=3.000s, sans retard de groupe → détectée à ±2ms', () => {
    const sig = buildSilenceWithImpulse(TARGET_S, SAMPLE_RATE, DURATION_S);
    const { refinedT } = detectSingleOnset(sig, SAMPLE_RATE);
    expect(Math.abs(refinedT - TARGET_S) * 1000).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  it('impulsion avec retard de groupe de 5ms, compensé → détectée à ±2ms', () => {
    const groupDelaySec = 0.005;
    const sig = buildSilenceWithImpulse(TARGET_S + groupDelaySec, SAMPLE_RATE, DURATION_S);
    const { refinedT } = detectSingleOnset(sig, SAMPLE_RATE, groupDelaySec);
    expect(Math.abs(refinedT - TARGET_S) * 1000).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  it('témoin négatif : horodatage au bord gauche doit dépasser la tolérance (le test discrimine bien)', () => {
    const sig = buildSilenceWithImpulse(TARGET_S, SAMPLE_RATE, DURATION_S);
    const frames = stft(sig);
    const flux = spectralFlux(frames);
    let bestI = 1;
    let bestV = -Infinity;
    for (let i = 1; i < flux.length; i++) {
      if (flux[i]! > bestV) {
        bestV = flux[i]!;
        bestI = i;
      }
    }
    const wrongT = (bestI * HOP) / SAMPLE_RATE; // convention fausse : bord gauche
    const wrongErrMs = Math.abs(wrongT - TARGET_S) * 1000;
    expect(wrongErrMs).toBeGreaterThan(TOLERANCE_MS);
  });
});
