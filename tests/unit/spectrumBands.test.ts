import { describe, expect, it } from 'vitest';
import { computeLogSpacedBinRanges, computeSpectrumEnergyTracks, SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ } from '../../src/analysis/spectrumBands';

const SAMPLE_RATE = 22050;
const WINDOW_SIZE = 1024;

describe('spectrumBands — computeLogSpacedBinRanges', () => {
  it('produit exactement bandCount plages', () => {
    const ranges = computeLogSpacedBinRanges(96, SAMPLE_RATE, WINDOW_SIZE);
    expect(ranges.length).toBe(96);
  });

  it('plages croissantes et jamais inversées (hi >= lo)', () => {
    const ranges = computeLogSpacedBinRanges(96, SAMPLE_RATE, WINDOW_SIZE);
    for (const r of ranges) expect(r.hi).toBeGreaterThanOrEqual(r.lo);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.lo).toBeGreaterThanOrEqual(ranges[i - 1]!.lo);
    }
  });

  it('la première bande commence près de SPECTRUM_MIN_HZ, la dernière finit près de SPECTRUM_MAX_HZ', () => {
    const ranges = computeLogSpacedBinRanges(96, SAMPLE_RATE, WINDOW_SIZE);
    const binHz = SAMPLE_RATE / WINDOW_SIZE;
    expect(ranges[0]!.lo * binHz).toBeLessThan(SPECTRUM_MIN_HZ + binHz);
    const last = ranges[ranges.length - 1]!;
    expect(last.hi * binHz).toBeGreaterThan(SPECTRUM_MAX_HZ - binHz * 2);
  });

  it('jamais au-delà du bin de Nyquist (windowSize/2)', () => {
    const ranges = computeLogSpacedBinRanges(96, SAMPLE_RATE, WINDOW_SIZE);
    for (const r of ranges) expect(r.hi).toBeLessThanOrEqual(WINDOW_SIZE / 2);
  });

  it('fonctionne pour les 4 valeurs de la table de qualité (32/48/64/96)', () => {
    for (const bandCount of [32, 48, 64, 96]) {
      const ranges = computeLogSpacedBinRanges(bandCount, SAMPLE_RATE, WINDOW_SIZE);
      expect(ranges.length).toBe(bandCount);
    }
  });
});

describe('spectrumBands — computeSpectrumEnergyTracks', () => {
  function frame(maxBin: number, hotBin: number, value = 10): Float64Array {
    const f = new Float64Array(maxBin + 1);
    f[hotBin] = value;
    return f;
  }

  it('une piste par plage, une valeur par trame', () => {
    const ranges = computeLogSpacedBinRanges(8, SAMPLE_RATE, WINDOW_SIZE);
    const frames = [frame(512, 10), frame(512, 10), frame(512, 10)];
    const tracks = computeSpectrumEnergyTracks(frames, ranges);
    expect(tracks.length).toBe(8);
    for (const track of tracks) expect(track.length).toBe(3);
  });

  it("l'énergie d'une bande reflète bien un pic tombant dans sa plage", () => {
    const ranges = computeLogSpacedBinRanges(8, SAMPLE_RATE, WINDOW_SIZE);
    const hotRangeIdx = 4;
    const hotBin = ranges[hotRangeIdx]!.lo;
    const frames = [frame(512, hotBin, 10)];
    const tracks = computeSpectrumEnergyTracks(frames, ranges);
    expect(tracks[hotRangeIdx]![0]).toBeGreaterThan(0);
    // une bande loin de hotBin (ranges non chevauchantes) reste à zéro.
    expect(tracks[0]![0]).toBe(0);
  });

  it('silence total => énergie nulle partout', () => {
    const ranges = computeLogSpacedBinRanges(8, SAMPLE_RATE, WINDOW_SIZE);
    const frames = [new Float64Array(513)];
    const tracks = computeSpectrumEnergyTracks(frames, ranges);
    for (const track of tracks) expect(track[0]).toBe(0);
  });
});
