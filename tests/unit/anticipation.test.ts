import { describe, expect, it } from 'vitest';
import { validatePmdi } from '../../src/music/validatePmdi';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { Anticipation } from '../../src/behaviour/signals/Anticipation';
import type { PmdiDocument } from '../../src/music/pmdi';

function docWithDropAt(t: number): PmdiDocument {
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 20, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [{ t, type: 'DROP', intensity: 1, confidence: 0.8 }],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

function buildTimeline(t: number) {
  const doc = docWithDropAt(t);
  expect(validatePmdi(doc).ok).toBe(true);
  return buildMusicTimeline(doc);
}

describe('Anticipation — courbe linear (référence docs/06)', () => {
  it('reproduit exactement dropIn < window ? 1 - dropIn/window : 0', () => {
    const timeline = buildTimeline(10);
    const anticipation = new Anticipation(4.0, 'linear');
    expect(anticipation.valueFrom(timeline, 'DROP', 6)).toBeCloseTo(0, 10); // dropIn=4, à la borne
    expect(anticipation.valueFrom(timeline, 'DROP', 7)).toBeCloseTo(0.25, 10); // dropIn=3
    expect(anticipation.valueFrom(timeline, 'DROP', 9)).toBeCloseTo(0.75, 10); // dropIn=1
    expect(anticipation.valueFrom(timeline, 'DROP', 5)).toBe(0); // dropIn=5 > window
  });

  it('vaut 0 quand aucun événement du type ne suit (timeToNext = +Infinity)', () => {
    const timeline = buildTimeline(10);
    const anticipation = new Anticipation(4.0, 'linear');
    expect(anticipation.valueFrom(timeline, 'BUILDUP', 0)).toBe(0);
  });
});

describe('Anticipation — courbe easeInQuad (table de câblage docs/07)', () => {
  it('applique x² à la montée linéaire', () => {
    const timeline = buildTimeline(10);
    const anticipation = new Anticipation(4.0, 'easeInQuad');
    // dropIn=1 → raw=0.75 → 0.75² = 0.5625
    expect(anticipation.valueFrom(timeline, 'DROP', 9)).toBeCloseTo(0.5625, 10);
  });
});
