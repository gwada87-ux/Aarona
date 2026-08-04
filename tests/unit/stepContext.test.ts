import { describe, expect, it } from 'vitest';
import { validatePmdi } from '../../src/music/validatePmdi';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import { FIXED_DT } from '../../src/core/time/FixedStep';
import type { PmdiDocument } from '../../src/music/pmdi';

function docWithGrid(gridConfidence: number): PmdiDocument {
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 10, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 0.9, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [
      { t: 0.5, type: 'KICK', intensity: 0.9, confidence: 0.9 },
      { t: 1.0, type: 'SNARE', intensity: 0.7, confidence: 0.9 },
    ],
    features: [
      { id: 'energy', hz: 1, t0: 0, data: [0, 1] },
      { id: 'band.sub', hz: 1, t0: 0, data: [0.2, 0.4] },
    ],
    sections: [{ t: 0, dur: 10, energy: 0.6, confidence: 0.9, letter: 'A' }],
    confidence: { tempo: 0.9, grid: gridConfidence, classification: 0.5, structure: 0.5 },
  };
}

function buildTimeline(doc: PmdiDocument) {
  expect(validatePmdi(doc).ok).toBe(true);
  return buildMusicTimeline(doc);
}

describe('StepContext — forme et champs de base', () => {
  it('dt est toujours FIXED_DT, stepIndex = round(t * 120)', () => {
    const timeline = buildTimeline(docWithGrid(0.9));
    const builder = new StepContextBuilder(timeline, 42);
    const ctx = builder.build(0.7);
    expect(ctx.dt).toBe(FIXED_DT);
    expect(ctx.stepIndex).toBe(Math.round(0.7 * 120));
  });

  it('bands/energy/beat/bar/section recopient exactement MusicTimeline pour ce t', () => {
    const timeline = buildTimeline(docWithGrid(0.9));
    const builder = new StepContextBuilder(timeline, 1);
    const t = 0.3;
    const ctx = builder.build(t);
    expect(ctx.bands.sub).toBeCloseTo(timeline.featureAt(t, 'band.sub'), 10);
    expect(ctx.energy).toBeCloseTo(timeline.featureAt(t, 'energy'), 10);
    expect(ctx.beat.index).toBe(timeline.beatIndexAt(t));
    expect(ctx.beat.phase).toBeCloseTo(timeline.beatPhaseAt(t), 10);
    expect(ctx.bar.index).toBe(timeline.barIndexAt(t));
    expect(ctx.bar.phase).toBeCloseTo(timeline.barPhaseAt(t), 10);
    expect(ctx.section).toEqual(timeline.sectionAt(t));
  });
});

describe('StepContext — fired, un sous-pas à la fois', () => {
  it('un événement ne déclenche que sur le sous-pas qui le traverse', () => {
    const timeline = buildTimeline(docWithGrid(0.9));
    const builder = new StepContextBuilder(timeline, 1);
    const before = builder.build(0.5 - 1 / 120);
    const at = builder.build(0.5);
    const after = builder.build(0.5 + 1 / 120);
    expect(before.fired).toEqual([]);
    expect(at.fired.map((e) => e.type)).toEqual(['KICK']);
    expect(after.fired).toEqual([]);
  });
});

describe('StepContext — déterminisme du PRNG (Loi 1)', () => {
  it('la graine ne dépend que de (projectSeed, stepIndex), jamais de l\'historique des appels', () => {
    const timeline = buildTimeline(docWithGrid(0.9));

    const builderA = new StepContextBuilder(timeline, 7);
    // chemin A : plusieurs pas avant d'arriver à t
    builderA.build(0.1);
    builderA.build(0.2);
    const ctxA = builderA.build(0.3);
    const drawsA = [ctxA.rng.next(), ctxA.rng.next(), ctxA.rng.next()];

    const builderB = new StepContextBuilder(timeline, 7);
    // chemin B : arrive directement à t, aucun pas avant
    const ctxB = builderB.build(0.3);
    const drawsB = [ctxB.rng.next(), ctxB.rng.next(), ctxB.rng.next()];

    expect(drawsA).toEqual(drawsB);
  });

  it('un projectSeed différent change le flux pour le même t', () => {
    const timeline = buildTimeline(docWithGrid(0.9));
    const ctxA = new StepContextBuilder(timeline, 1).build(0.3);
    const ctxB = new StepContextBuilder(timeline, 2).build(0.3);
    expect(ctxA.rng.next()).not.toBe(ctxB.rng.next());
  });
});

describe('StepContext — regime', () => {
  it('bascule en régime continu sous le seuil de confiance de grille (0,6)', () => {
    const highConfidence = buildTimeline(docWithGrid(0.9));
    const lowConfidence = buildTimeline(docWithGrid(0.3));
    expect(new StepContextBuilder(highConfidence, 1).build(0).regime).toBe('event');
    expect(new StepContextBuilder(lowConfidence, 1).build(0).regime).toBe('continuous');
  });
});
