import { describe, expect, it } from 'vitest';
import { bandBinRanges, bandFluxTracks } from '../../src/analysis/bands';
import { detectBandOnsets, REFRACTORY_SEC } from '../../src/analysis/onsets';
import { stft, WINDOW_SIZE, HOP } from '../../src/analysis/stft';

const SAMPLE_RATE = 22050;

function buildClicksSignal(atSecs: readonly number[], sampleRate: number, durationSec: number): Float64Array {
  const sig = new Float64Array(Math.round(durationSec * sampleRate));
  for (const t of atSecs) {
    sig[Math.round(t * sampleRate)] = 1.0;
  }
  return sig;
}

function detectOnBand(signal: Float64Array, band: 'sub' | 'bass' | 'lowmid' | 'mid' | 'himid' | 'high') {
  const frames = stft(signal);
  const ranges = bandBinRanges(SAMPLE_RATE, WINDOW_SIZE);
  const flux = bandFluxTracks(frames, ranges);
  return detectBandOnsets({
    band,
    range: ranges[band],
    frames,
    rawFlux: flux[band],
    rawSignal: signal,
    sampleRate: SAMPLE_RATE,
    windowSize: WINDOW_SIZE,
    hop: HOP,
  });
}

describe('analysis/onsets — detectBandOnsets (docs/04 Étape 4)', () => {
  it('signal synthétique à onsets connus → positions détectées à ±6ms (docs/11)', () => {
    const targets = [0.5, 1.0, 1.5, 2.0];
    const signal = buildClicksSignal(targets, SAMPLE_RATE, 2.5);
    const onsets = detectOnBand(signal, 'bass');

    expect(onsets.length).toBe(targets.length);
    onsets.forEach((onset, i) => {
      expect(Math.abs(onset.t - targets[i]!) * 1000).toBeLessThanOrEqual(6);
    });
  });

  it('force (strength) toujours dans [0,1], jamais NaN, même sur passage quasi silencieux', () => {
    // Un seul clic minuscule au milieu d'un long silence : le seuil tend vers
    // delta (plancher), max(seuil, delta) doit empêcher toute division par 0.
    const sig = new Float64Array(Math.round(3 * SAMPLE_RATE));
    sig[Math.round(1.5 * SAMPLE_RATE)] = 0.02;
    const onsets = detectOnBand(sig, 'high');
    for (const o of onsets) {
      expect(Number.isNaN(o.strength)).toBe(false);
      expect(o.strength).toBeGreaterThanOrEqual(0);
      expect(o.strength).toBeLessThanOrEqual(1);
    }
  });

  it('deux onsets plus rapprochés que la période réfractaire de la bande sont fusionnés en un seul', () => {
    const refractory = REFRACTORY_SEC.high; // 25ms — la plus courte
    const gapSec = refractory / 2;
    const signal = buildClicksSignal([1.0, 1.0 + gapSec], SAMPLE_RATE, 2);
    const onsets = detectOnBand(signal, 'high');
    expect(onsets.length).toBe(1);
  });

  it('deux onsets plus espacés que la période réfractaire sont détectés séparément', () => {
    const refractory = REFRACTORY_SEC.high;
    const gapSec = refractory * 3;
    const signal = buildClicksSignal([1.0, 1.0 + gapSec], SAMPLE_RATE, 2);
    const onsets = detectOnBand(signal, 'high');
    expect(onsets.length).toBe(2);
  });

  it('silence total → aucun onset', () => {
    const signal = new Float64Array(Math.round(1 * SAMPLE_RATE));
    const onsets = detectOnBand(signal, 'bass');
    expect(onsets.length).toBe(0);
  });
});
