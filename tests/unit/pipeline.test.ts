import { describe, expect, it } from 'vitest';
import { runAnalysisPipeline, type AnalysisProgressStage } from '../../src/analysis/AnalysisPipeline';
import { validatePmdi } from '../../src/music/validatePmdi';

const ORIGINAL_SAMPLE_RATE = 44100;

function addDecayingTone(sig: Float64Array, tSec: number, freqHz: number, sampleRate: number, durSec: number, amp: number): void {
  const start = Math.round(tSec * sampleRate);
  const n = Math.round(durSec * sampleRate);
  for (let i = 0; i < n && start + i < sig.length; i++) {
    const decay = Math.exp(-i / (n / 4));
    sig[start + i]! += amp * decay * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
}

function buildSyntheticTrack(bpm: number, durationSec: number, sampleRate: number): Float64Array {
  const period = 60 / bpm;
  const signal = new Float64Array(Math.round(durationSec * sampleRate));

  for (let t = 0.1; t < durationSec - 0.1; t += period) {
    addDecayingTone(signal, t, 55, sampleRate, 0.08, 1.0); // kick + sustain 808-ish
  }
  for (let t = 0.1; t < durationSec - 0.1; t += period / 2) {
    addDecayingTone(signal, t, 9000, sampleRate, 0.008, 0.5); // hat
  }
  return signal;
}

describe('analysis/AnalysisPipeline — intégration (docs/03 FLUX 1, étapes 0-9)', () => {
  it('produit un document PMDI valide (validatePmdi) sur un morceau synthétique complet', () => {
    const bpm = 100;
    const durationSec = 10;
    const signal = buildSyntheticTrack(bpm, durationSec, ORIGINAL_SAMPLE_RATE);

    const stagesSeen: AnalysisProgressStage[] = [];
    const fractions: number[] = [];
    const result = runAnalysisPipeline({
      signal,
      sampleRate: ORIGINAL_SAMPLE_RATE,
      onProgress: (fraction, stage) => {
        stagesSeen.push(stage);
        fractions.push(fraction);
      },
    });

    const validation = validatePmdi(result.pmdi);
    expect(validation.ok, JSON.stringify(!validation.ok ? validation.errors : [])).toBe(true);

    // Progression : 10 étapes, croissante, se termine à 1.0.
    expect(stagesSeen.length).toBe(10);
    expect(fractions[fractions.length - 1]).toBeCloseTo(1, 9);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]!).toBeGreaterThan(fractions[i - 1]!);
    }

    // Tempo dans une fourchette raisonnable (le piège ×2/÷2 est testé isolément ailleurs).
    expect([bpm, bpm / 2, bpm * 2].some((candidate) => Math.abs(result.pmdi.tempo.global - candidate) < 2)).toBe(true);

    expect(result.pmdi.grid?.beats.length ?? 0).toBeGreaterThan(0);
    expect(result.pmdi.audio.duration).toBeCloseTo(durationSec, 0);
    expect(result.pmdi.audio.sampleRate).toBe(22050);

    // events triés, confiances bornées.
    const events = result.pmdi.events;
    for (let i = 1; i < events.length; i++) expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t);
    for (const e of events) {
      expect(e.confidence).toBeGreaterThanOrEqual(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }

    // features : 5 pistes globales + 6 bandes sémantiques + 96 bandes du spectre visuel fin (Étape 25).
    expect(result.pmdi.features?.length).toBe(11 + 96);
    for (const track of result.pmdi.features ?? []) {
      expect(track.hz).toBeCloseTo(22050 / 128, 6);
      expect(Number.isInteger(track.hz)).toBe(false); // jamais arrondi, docs/03 l.256-266
    }

    // confiance globale bornée, classification/structure pas encore calculées (Étape 12).
    expect(result.pmdi.confidence.classification).toBe(0);
    expect(result.pmdi.confidence.structure).toBe(0);
    expect(result.pmdi.confidence.tempo).toBeGreaterThanOrEqual(0);
    expect(result.pmdi.confidence.tempo).toBeLessThanOrEqual(1);

    // waveformPeaks : 2048 buckets par défaut, calculés sur le signal ORIGINAL.
    expect(result.waveformPeaks.bucketCount).toBe(2048);
  });

  it('signal quasi silencieux → pipeline ne plante pas, confiance basse', () => {
    const signal = new Float64Array(ORIGINAL_SAMPLE_RATE * 3);
    const result = runAnalysisPipeline({ signal, sampleRate: ORIGINAL_SAMPLE_RATE });
    const validation = validatePmdi(result.pmdi);
    expect(validation.ok, JSON.stringify(!validation.ok ? validation.errors : [])).toBe(true);
    expect(result.pmdi.confidence.grid).toBeLessThan(0.6);
  });
});
