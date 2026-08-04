import { describe, expect, it } from 'vitest';
import { validatePmdi } from '../../src/music/validatePmdi';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { Trend } from '../../src/behaviour/signals/Trend';
import type { PmdiDocument } from '../../src/music/pmdi';

function docWithLinearEnergy(): PmdiDocument {
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 10, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [],
    features: [{ id: 'energy', hz: 1, t0: 0, data: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }], // pente = 1/s
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

describe('Trend', () => {
  it('délègue à MusicTimeline.featureSlope — pente correcte sur une rampe linéaire', () => {
    const doc = docWithLinearEnergy();
    expect(validatePmdi(doc).ok).toBe(true);
    const timeline = buildMusicTimeline(doc);
    const trend = new Trend(0.5);
    expect(trend.valueFrom(timeline, 'energy', 5)).toBeCloseTo(1, 6);
  });

  it('ne retient aucun état entre deux appels (fonction pure de t)', () => {
    const doc = docWithLinearEnergy();
    const timeline = buildMusicTimeline(doc);
    const trend = new Trend(0.5);
    trend.valueFrom(timeline, 'energy', 2);
    expect(trend.valueFrom(timeline, 'energy', 5)).toBeCloseTo(1, 6);
  });
});
