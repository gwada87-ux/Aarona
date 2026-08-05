import { describe, expect, it } from 'vitest';
import { layoutSections, layoutTicks, resampleWaveformPeaks, timeToX, xToTime } from '../../src/ui/timeline/timelineLayout';
import type { WaveformPeaks } from '../../src/analysis/waveformPeaks';
import type { Section } from '../../src/music/pmdi';

describe('timeToX / xToTime', () => {
  it('sont inverses l\'une de l\'autre sur la plage valide', () => {
    const duration = 180;
    const width = 900;
    for (const t of [0, 12.5, 90, 179.9, 180]) {
      expect(xToTime(timeToX(t, duration, width), duration, width)).toBeCloseTo(t, 5);
    }
  });

  it('borne xToTime à [0, duration] même hors plage (clic avant le début / après la fin)', () => {
    expect(xToTime(-50, 180, 900)).toBe(0);
    expect(xToTime(9999, 180, 900)).toBe(180);
  });

  it('dégénère proprement à durée nulle plutôt que diviser par zéro', () => {
    expect(timeToX(5, 0, 900)).toBe(0);
    expect(xToTime(450, 0, 0)).toBe(0);
  });
});

describe('resampleWaveformPeaks', () => {
  function peaks(min: number[], max: number[]): WaveformPeaks {
    return { min: Float32Array.from(min), max: Float32Array.from(max), bucketCount: min.length };
  }

  it('préserve un pic isolé en rétrécissant (min/max sur la plage, pas une moyenne)', () => {
    // 8 compartiments -> 2 colonnes : la colonne 0 doit voir le pic à -1/+1 du compartiment 3.
    const src = peaks([0, 0, 0, -1, 0, 0, 0, 0], [0, 0, 0, 1, 0, 0, 0, 0]);
    const out = resampleWaveformPeaks(src, 2);
    expect(out.min[0]).toBe(-1);
    expect(out.max[0]).toBe(1);
  });

  it('largeur = bucketCount : passthrough (une colonne par compartiment)', () => {
    const src = peaks([-1, -2, -3], [1, 2, 3]);
    const out = resampleWaveformPeaks(src, 3);
    expect(Array.from(out.min)).toEqual([-1, -2, -3]);
    expect(Array.from(out.max)).toEqual([1, 2, 3]);
  });

  it('largeur > bucketCount (zoom) : chaque compartiment source couvre au moins une colonne, aucune colonne vide', () => {
    const src = peaks([-1, -2], [1, 2]);
    const out = resampleWaveformPeaks(src, 5);
    expect(out.min).toHaveLength(5);
    // aucune colonne à Infinity/-Infinity résiduel (repli à 0 géré)
    for (const v of out.min) expect(Number.isFinite(v)).toBe(true);
    for (const v of out.max) expect(Number.isFinite(v)).toBe(true);
  });

  it('bucketCount = 0 : largeur de sortie correcte, tout à zéro', () => {
    const out = resampleWaveformPeaks({ min: new Float32Array(0), max: new Float32Array(0), bucketCount: 0 }, 10);
    expect(out.min).toHaveLength(10);
    expect(Array.from(out.min).every((v) => v === 0)).toBe(true);
  });
});

describe('layoutSections', () => {
  it('convertit t/dur en x/width proportionnels à la largeur totale', () => {
    const sections: Section[] = [
      { t: 0, dur: 60, energy: 0.5, confidence: 0.6 },
      { t: 60, dur: 30, energy: 0.8, confidence: 0.6 },
    ];
    const rects = layoutSections(sections, 90, 900);
    expect(rects[0]).toMatchObject({ x: 0, width: 600 });
    expect(rects[1]).toMatchObject({ x: 600, width: 300 });
  });
});

describe('layoutTicks', () => {
  it('mappe chaque instant à sa position x, dans l\'ordre', () => {
    const xs = layoutTicks([0, 45, 90], 90, 900);
    expect(xs).toEqual([0, 450, 900]);
  });
});
