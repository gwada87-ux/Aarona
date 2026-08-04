import { describe, expect, it } from 'vitest';
import { bandBinRanges, bandFluxTracks } from '../../src/analysis/bands';
import { computeFrameFeatureTracks } from '../../src/analysis/features';
import { detectBandOnsets } from '../../src/analysis/onsets';
import { computeOnsetDescriptor } from '../../src/analysis/onsetDescriptors';
import { stft, WINDOW_SIZE, HOP } from '../../src/analysis/stft';

const SAMPLE_RATE = 22050;

function addDecayingTone(sig: Float64Array, tSec: number, freqHz: number, sampleRate: number, durSec: number, amp: number): void {
  const start = Math.round(tSec * sampleRate);
  const n = Math.round(durSec * sampleRate);
  for (let i = 0; i < n && start + i < sig.length; i++) {
    const decay = Math.exp(-i / (n / 4));
    sig[start + i]! += amp * decay * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
}

describe('analysis/onsetDescriptors — computeOnsetDescriptor (docs/05 §4)', () => {
  it('kick synthétique (60Hz, décroissance rapide) → énergie basse dominante, centroïde bas, decay30 court', () => {
    const durationSec = 2;
    const signal = new Float64Array(Math.round(durationSec * SAMPLE_RATE));
    addDecayingTone(signal, 0.5, 60, SAMPLE_RATE, 0.05, 1.0);

    const frames = stft(signal);
    const ranges = bandBinRanges(SAMPLE_RATE, WINDOW_SIZE);
    const flux = bandFluxTracks(frames, ranges);
    const onsets = detectBandOnsets({
      band: 'bass',
      range: ranges.bass,
      frames,
      rawFlux: flux.bass,
      rawSignal: signal,
      sampleRate: SAMPLE_RATE,
      windowSize: WINDOW_SIZE,
      hop: HOP,
    });
    expect(onsets.length).toBeGreaterThan(0);
    const onset = onsets[0]!;

    const featureTracks = computeFrameFeatureTracks(signal, frames, { windowSize: WINDOW_SIZE, hop: HOP, sampleRate: SAMPLE_RATE });
    const framePeakTrack = Float64Array.from(featureTracks, (f) => f.peak);

    const descriptor = computeOnsetDescriptor({
      t: onset.t,
      band: onset.band,
      strength: onset.strength,
      onsetFrameIndex: onset.frameIndex,
      frames,
      framePeakTrack,
      bandRanges: ranges,
      sampleRate: SAMPLE_RATE,
      windowSize: WINDOW_SIZE,
      hop: HOP,
    });

    const [eSub, eBass] = descriptor.e;
    expect(eSub! + eBass!).toBeGreaterThan(0.5); // règle KICK, docs/05 l.186
    expect(descriptor.centroid).toBeLessThan(300);
    expect(descriptor.decay30).toBeLessThan(0.22);
    expect(descriptor.decaySaturated).toBe(false);

    const sumE = descriptor.e.reduce((a, b) => a + b, 0);
    expect(sumE).toBeCloseTo(1, 5); // fractions du total
  });

  it('signal soutenu (pas de décroissance de 30dB en 500ms) → decaySaturated = true, decay30 plafonné', () => {
    const durationSec = 2;
    const signal = new Float64Array(Math.round(durationSec * SAMPLE_RATE));
    // Tonalité soutenue, sans décroissance notable sur la fenêtre de mesure.
    for (let i = 0; i < signal.length; i++) {
      signal[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE);
    }
    // Un onset artificiel au milieu, sur un signal qui ne redescend jamais.
    const onsetFrameIndex = 200;

    const frames = stft(signal);
    const ranges = bandBinRanges(SAMPLE_RATE, WINDOW_SIZE);
    const featureTracks = computeFrameFeatureTracks(signal, frames, { windowSize: WINDOW_SIZE, hop: HOP, sampleRate: SAMPLE_RATE });
    const framePeakTrack = Float64Array.from(featureTracks, (f) => f.peak);

    const descriptor = computeOnsetDescriptor({
      t: onsetFrameIndex * (HOP / SAMPLE_RATE),
      band: 'lowmid',
      strength: 1,
      onsetFrameIndex,
      frames,
      framePeakTrack,
      bandRanges: ranges,
      sampleRate: SAMPLE_RATE,
      windowSize: WINDOW_SIZE,
      hop: HOP,
    });

    expect(descriptor.decaySaturated).toBe(true);
    expect(descriptor.decay30).toBe(0.5);
  });

  it('microOnsetCount (docs/05 §4, signature du CLAP) : 3 micro-pics espacés de ~17ms → compte 3', () => {
    // Piste d'enveloppe construite à la main (pas de synthèse audio réelle ici) : contrôle
    // exact de l'espacement entre pics, ce qu'une vraie synthèse via STFT ne permettrait pas
    // facilement à la résolution de trame (~5,8ms/trame).
    const onsetFrameIndex = 50;
    const framePeakTrack = new Float64Array(onsetFrameIndex + 20);
    framePeakTrack[onsetFrameIndex] = 1.0;
    framePeakTrack[onsetFrameIndex + 1] = 0.6;
    framePeakTrack[onsetFrameIndex + 2] = 0.2;
    framePeakTrack[onsetFrameIndex + 3] = 0.5; // pic 1 (~17,4ms après l'onset)
    framePeakTrack[onsetFrameIndex + 4] = 0.3;
    framePeakTrack[onsetFrameIndex + 5] = 0.15;
    framePeakTrack[onsetFrameIndex + 6] = 0.4; // pic 2 (+3 trames = ~17,4ms après le pic 1)
    framePeakTrack[onsetFrameIndex + 7] = 0.25;
    framePeakTrack[onsetFrameIndex + 8] = 0.1;
    framePeakTrack[onsetFrameIndex + 9] = 0.35; // pic 3 (+3 trames)
    framePeakTrack[onsetFrameIndex + 10] = 0.05;

    const dummyFrames: Float64Array[] = Array.from({ length: framePeakTrack.length }, () => new Float64Array(WINDOW_SIZE / 2 + 1));
    const ranges = bandBinRanges(SAMPLE_RATE, WINDOW_SIZE);

    const descriptor = computeOnsetDescriptor({
      t: onsetFrameIndex * (HOP / SAMPLE_RATE),
      band: 'lowmid',
      strength: 1,
      onsetFrameIndex,
      frames: dummyFrames,
      framePeakTrack,
      bandRanges: ranges,
      sampleRate: SAMPLE_RATE,
      windowSize: WINDOW_SIZE,
      hop: HOP,
    });

    expect(descriptor.microOnsetCount).toBe(3);
  });

  it('microOnsetCount = 0 sur une décroissance simple, sans micro-pics (profil KICK)', () => {
    const onsetFrameIndex = 50;
    const framePeakTrack = new Float64Array(onsetFrameIndex + 20);
    framePeakTrack[onsetFrameIndex] = 1.0;
    for (let i = 1; i <= 15; i++) framePeakTrack[onsetFrameIndex + i] = 1.0 * Math.exp(-i / 4); // décroissance monotone lisse

    const dummyFrames: Float64Array[] = Array.from({ length: framePeakTrack.length }, () => new Float64Array(WINDOW_SIZE / 2 + 1));
    const ranges = bandBinRanges(SAMPLE_RATE, WINDOW_SIZE);

    const descriptor = computeOnsetDescriptor({
      t: onsetFrameIndex * (HOP / SAMPLE_RATE),
      band: 'bass',
      strength: 1,
      onsetFrameIndex,
      frames: dummyFrames,
      framePeakTrack,
      bandRanges: ranges,
      sampleRate: SAMPLE_RATE,
      windowSize: WINDOW_SIZE,
      hop: HOP,
    });

    expect(descriptor.microOnsetCount).toBe(0);
  });
});
