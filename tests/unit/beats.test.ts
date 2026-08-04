import { describe, expect, it } from 'vitest';
import { bandFluxTracks, bandBinRanges } from '../../src/analysis/bands';
import { trackBeats } from '../../src/analysis/beats';
import { computeGlobalOdfPositive } from '../../src/analysis/tempo';
import { stft, WINDOW_SIZE, HOP } from '../../src/analysis/stft';

const SAMPLE_RATE = 22050;

function buildClickOdf(targets: readonly number[], durationSec: number): Float64Array {
  const signal = new Float64Array(Math.round(durationSec * SAMPLE_RATE));
  for (const t of targets) {
    const i = Math.round(t * SAMPLE_RATE);
    if (i < signal.length) signal[i] = 1;
  }
  const frames = stft(signal);
  const ranges = bandBinRanges(SAMPLE_RATE, WINDOW_SIZE);
  const flux = bandFluxTracks(frames, ranges);
  return computeGlobalOdfPositive(flux);
}

describe('analysis/beats — trackBeats (docs/05 §2)', () => {
  it('clic régulier → un beat détecté près de chaque clic, confiance élevée', () => {
    const bpm = 120;
    const period = 60 / bpm;
    const durationSec = 8;
    const targets: number[] = [];
    for (let t = 0.1; t < durationSec - 0.1; t += period) targets.push(t);

    const odf = buildClickOdf(targets, durationSec);
    const beats = trackBeats({ odf, bpm, tempoConfidence: 0.95, sampleRate: SAMPLE_RATE, hop: HOP, windowSize: WINDOW_SIZE });

    expect(beats.length).toBeGreaterThanOrEqual(targets.length - 1);
    // Chaque clic a un beat détecté à moins de 20ms (une trame ≈ 5.8ms + jitter DP).
    for (const target of targets) {
      const nearest = beats.reduce((best, b) => (Math.abs(b.t - target) < Math.abs(best.t - target) ? b : best));
      expect(Math.abs(nearest.t - target) * 1000).toBeLessThan(20);
    }
    const avgConfidence = beats.reduce((s, b) => s + b.confidence, 0) / beats.length;
    expect(avgConfidence).toBeGreaterThan(0.7);
  });

  it('tolère un temps sans onset (un break) en gardant la grille', () => {
    const bpm = 120;
    const period = 60 / bpm;
    const durationSec = 6;
    const allTargets: number[] = [];
    for (let t = 0.1; t < durationSec - 0.1; t += period) allTargets.push(t);
    const missingIdx = Math.floor(allTargets.length / 2);
    const missingT = allTargets[missingIdx]!;
    const targetsWithGap = allTargets.filter((_, i) => i !== missingIdx);

    const odf = buildClickOdf(targetsWithGap, durationSec);
    const beats = trackBeats({ odf, bpm, tempoConfidence: 0.9, sampleRate: SAMPLE_RATE, hop: HOP, windowSize: WINDOW_SIZE });

    // La grille doit rester régulière : un beat est placé près de la position
    // manquante malgré l'absence d'onset (pénalité de régularité, docs/05 l.103-104).
    const nearestToGap = beats.reduce((best, b) => (Math.abs(b.t - missingT) < Math.abs(best.t - missingT) ? b : best));
    expect(Math.abs(nearestToGap.t - missingT)).toBeLessThan(period / 2);
  });

  it('ODF vide → aucun beat, pas de plantage', () => {
    const beats = trackBeats({ odf: new Float64Array(0), bpm: 120, tempoConfidence: 0.9, sampleRate: SAMPLE_RATE, hop: HOP, windowSize: WINDOW_SIZE });
    expect(beats).toEqual([]);
  });
});
