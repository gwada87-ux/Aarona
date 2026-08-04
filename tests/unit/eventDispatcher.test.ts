import { describe, expect, it } from 'vitest';
import { validatePmdi } from '../../src/music/validatePmdi';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { EventDispatcher } from '../../src/music/EventDispatcher';
import type { PmdiDocument } from '../../src/music/pmdi';

function docWithEventsEvery(spacingSec: number, count: number): PmdiDocument {
  // Number(...toFixed(10)) : évite le bruit de virgule flottante de i * spacingSec
  // (ex. 3 * 0.3 === 0.8999999999999999 en JS) pour des t exactement comparables aux littéraux des tests.
  const events = Array.from({ length: count }, (_, i) => ({
    t: Number((i * spacingSec).toFixed(10)),
    type: 'HAT',
    intensity: 0.5,
    confidence: 0.9,
  }));
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: count * spacingSec + 1, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events,
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

function buildTimeline(doc: PmdiDocument) {
  expect(validatePmdi(doc).ok).toBe(true);
  return buildMusicTimeline(doc);
}

describe('EventDispatcher — collect()', () => {
  it('capture un événement exactement à t=0 dès le tout premier appel (sous-pas 1/120)', () => {
    const timeline = buildTimeline(docWithEventsEvery(1, 3)); // événements à t=0,1,2
    const dispatcher = new EventDispatcher(timeline);
    const first = dispatcher.collect(1 / 120);
    expect(first.map((e) => e.t)).toEqual([0]);
  });

  it('ne compte jamais deux fois un événement pile sur une frontière de sous-pas', () => {
    const timeline = buildTimeline(docWithEventsEvery(1, 3)); // t=0,1,2
    const dispatcher = new EventDispatcher(timeline);
    dispatcher.collect(0.5); // avant le prochain événement (t=1)
    const atBoundary = dispatcher.collect(1.0); // pile sur l'événement
    const nextStep = dispatcher.collect(1.0 + 1 / 120);
    expect(atBoundary.map((e) => e.t)).toEqual([1]);
    expect(nextStep).toEqual([]);
  });

  it('un balayage complet sous-pas par sous-pas retrouve exactement tous les événements, une fois chacun', () => {
    const timeline = buildTimeline(docWithEventsEvery(0.3, 5)); // t=0,0.3,0.6,0.9,1.2
    const dispatcher = new EventDispatcher(timeline);
    const seen: number[] = [];
    const dt = 1 / 120;
    for (let t = dt; t <= 1.3; t += dt) {
      for (const e of dispatcher.collect(t)) seen.push(e.t);
    }
    expect(seen).toEqual([0, 0.3, 0.6, 0.9, 1.2]);
  });

  it('seek arrière : ne rejoue rien immédiatement, puis reprend correctement en avançant', () => {
    const timeline = buildTimeline(docWithEventsEvery(0.2, 11)); // t=0,0.2,...,2.0
    const dispatcher = new EventDispatcher(timeline);
    dispatcher.collect(0.05); // amorce
    dispatcher.collect(1.0); // avance
    expect(dispatcher.collect(0.5)).toEqual([]); // seek arrière : t < tPrev
    // reprise : refranchit des événements déjà vus avant le seek, sans doublon ni trou
    expect(dispatcher.collect(0.6).map((e) => e.t)).toEqual([0.6]);
    expect(dispatcher.collect(0.8).map((e) => e.t)).toEqual([0.8]);
  });

  it('MAX_WINDOW=0.25s : un saut avant massif ne déverse pas tout l\'historique manqué', () => {
    // un événement toutes les 0.05s de 0 à 2s
    const doc = docWithEventsEvery(0.05, 41);
    const timeline = buildTimeline(doc);
    const dispatcher = new EventDispatcher(timeline);
    dispatcher.collect(1 / 120); // capture t=0
    const jump = dispatcher.collect(2.0); // bascule d'onglet, retour 2s plus tard
    // seuls les événements dans (2 - 0.25, 2] doivent apparaître
    for (const e of jump) {
      expect(e.t).toBeGreaterThan(1.75);
      expect(e.t).toBeLessThanOrEqual(2.0);
    }
    expect(jump.length).toBeGreaterThan(0);
    expect(jump.length).toBeLessThan(41);
  });
});
