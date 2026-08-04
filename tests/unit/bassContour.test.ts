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
