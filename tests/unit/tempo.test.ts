import { describe, expect, it } from 'vitest';
import { bandBinRanges, bandEnergyTracks, bandFluxTracks } from '../../src/analysis/bands';
import { detectBandOnsets } from '../../src/analysis/onsets';
import { estimateTempo, resolveOctaveAmbiguity } from '../../src/analysis/tempo';
import { stft, WINDOW_SIZE, HOP } from '../../src/analysis/stft';

const SAMPLE_RATE = 22050;

function addImpulse(sig: Float64Array, tSec: number, sampleRate: number, amp = 1): void {
  const i = Math.round(tSec * sampleRate);
  if (i >= 0 && i < sig.length) sig[i] = sig[i]! + amp;
}

function addDecayingTone(sig: Float64Array, tSec: number, freqHz: number, sampleRate: number, durSec: number, amp: number): void {
  const start = Math.round(tSec * sampleRate);
  const n = Math.round(durSec * sampleRate);
  for (let i = 0; i < n && start + i < sig.length; i++) {
    if (start + i < 0) continue;
    const decay = Math.exp(-i / (n / 4));
    sig[start + i]! += amp * decay * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
}

interface Analyzed {
  bandFlux: ReturnType<typeof bandFluxTracks>;
  bandEnergy: ReturnType<typeof bandEnergyTracks>;
  highOnsetCount: number;
  durationSec: number;
}

function analyze(signal: Float64Array): Analyzed {
  const frames = stft(signal);
  const ranges = bandBinRanges(SAMPLE_RATE, WINDOW_SIZE);
  const bandFlux = bandFluxTracks(frames, ranges);
  const bandEnergy = bandEnergyTracks(frames, ranges);
  const highOnsets = detectBandOnsets({
    band: 'high',
    range: ranges.high,
    frames,
    rawFlux: bandFlux.high,
    rawSignal: signal,
    sampleRate: SAMPLE_RATE,
    windowSize: WINDOW_SIZE,
    hop: HOP,
  });
  return { bandFlux, bandEnergy, highOnsetCount: highOnsets.length, durationSec: signal.length / SAMPLE_RATE };
}

describe('analysis/tempo — estimateTempo (docs/05 §1, docs/11)', () => {
  it('clic à 120 BPM exact → 120 ± 0.5, confiance > 0.9', () => {
    const bpm = 120;
    const period = 60 / bpm;
    const durationSec = 12;
    const signal = new Float64Array(Math.round(durationSec * SAMPLE_RATE));
    for (let t = 0; t < durationSec; t += period) addImpulse(signal, t, SAMPLE_RATE);

    const { bandFlux, bandEnergy, highOnsetCount, durationSec: dur } = analyze(signal);
    const result = estimateTempo({
      bandFlux,
      bassEnergyTrack: bandEnergy.bass,
      highOnsetCount,
      sampleRate: SAMPLE_RATE,
      hop: HOP,
      durationSec: dur,
    });

    expect(Math.abs(result.bpm - 120)).toBeLessThanOrEqual(0.5);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('motif Trap synthétique à 70 BPM avec hats en 1/16 → retourne 70, pas 140 (piège ×2/÷2, docs/05 l.39-68)', () => {
    const bpm = 70;
    const period = 60 / bpm; // ≈0.857s
    const durationSec = 16;
    const signal = new Float64Array(Math.round(durationSec * SAMPLE_RATE));

    for (let t = 0; t < durationSec; t += period) {
      addDecayingTone(signal, t, 70, SAMPLE_RATE, 0.05, 1.0); // kick : bande bass (60-120Hz)
    }
    const hatPeriod = period / 4; // doubles-croches
    for (let t = 0; t < durationSec; t += hatPeriod) {
      addDecayingTone(signal, t, 8500, SAMPLE_RATE, 0.01, 0.6); // hat : bande high (6-11kHz)
    }

    const { bandFlux, bandEnergy, highOnsetCount, durationSec: dur } = analyze(signal);
    const result = estimateTempo({
      bandFlux,
      bassEnergyTrack: bandEnergy.bass,
      highOnsetCount,
      sampleRate: SAMPLE_RATE,
      hop: HOP,
      durationSec: dur,
    });

    expect(Math.abs(result.bpm - 70)).toBeLessThanOrEqual(1);
  });
});

describe('analysis/tempo — resolveOctaveAmbiguity (bassCoherenceScore, régression Étape 43)', () => {
  it("un grave PARFAITEMENT aligné sur rawBpm doit le faire gagner, même quand une phase de test touche pile la fin du tableau (piège d'arrondi)", () => {
    // frameRate/durationSec/rawBpm choisis (par recherche exhaustive sur des valeurs réalistes)
    // pour que la corruption round-hors-limites de bassCoherenceScore change RÉELLEMENT le
    // vainqueur de l'arbitrage — pas seulement le score interne d'un candidat.
    const frameRate = 22050 / 128; // hop STFT réaliste
    const rawBpm = 70; // -> competitor = 140 (pickOctaveCompetitor : ÷2=35 hors plage, ×2=140 dans la plage)
    const durationSec = 6;
    const length = Math.round(durationSec * frameRate);
    const periodFramesA = (60 / rawBpm) * frameRate;

    const bassEnergyTrack = new Float64Array(length).fill(0.1);
    for (let pos = 0; pos < length; pos += periodFramesA) {
      const idx = Math.min(length - 1, Math.round(pos));
      bassEnergyTrack[idx] = 1.0;
    }

    const result = resolveOctaveAmbiguity({
      rawBpm,
      rawBpmScore: 1, // égal au concurrent : force l'arbitrage à 3 tests (écart < 15%, docs/05 l.45-65)
      competitorScore: 1,
      frameRate,
      durationSec,
      bassEnergyTrack,
      highOnsetCount: 0, // neutralise subdivisionScore (= 1 des deux côtés, ne doit pas trancher ici)
    });

    // Le grave est parfaitement en phase avec rawBpm (70) : c'est lui qui doit gagner l'arbitrage,
    // pas son octave (140). Avec le bug, la phase correcte est corrompue en NaN et silencieusement
    // écartée du max() -> l'octave gagne à tort.
    expect(result.bpm).toBe(rawBpm);
  });
});
