import { describe, expect, it } from 'vitest';
import { validatePmdi } from '../../src/music/validatePmdi';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import type { PmdiDocument } from '../../src/music/pmdi';

/** Document écrit à la main, sciemment plus riche que le minimal de pmdi.test.ts. */
function handWrittenDoc(): PmdiDocument {
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 10, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: {
      global: 120,
      confidence: 0.9,
      map: [
        { t: 0, bpm: 120 },
        { t: 4, bpm: 180 },
      ],
    },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [
      { t: 0, type: 'BAR', intensity: 1, confidence: 1 },
      { t: 0.5, type: 'BEAT', intensity: 0.8, confidence: 0.95 },
      { t: 1.0, type: 'BEAT', intensity: 0.8, confidence: 0.95 },
      { t: 1.0, type: 'SNARE', intensity: 0.9, confidence: 0.8 },
      { t: 3.0, type: 'DROP', intensity: 1, confidence: 0.7 },
      // type hors du vocabulaire connu de docs/06 — doit être toléré sans erreur (principe #3).
      { t: 5.0, type: 'XENOMORPH_STINGER', intensity: 0.5, confidence: 0.4 },
    ],
    features: [{ id: 'energy', hz: 1, t0: 0, data: [0, 1] }],
    sections: [
      { t: 0, dur: 2, energy: 0.5, confidence: 0.9, letter: 'A' },
      { t: 2, dur: 8, energy: 0.8, confidence: 0.9, letter: 'B' },
    ],
    confidence: { tempo: 0.9, grid: 0.85, classification: 0.6, structure: 0.5 },
  };
}

function buildFromHandWrittenDoc() {
  const doc = handWrittenDoc();
  const result = validatePmdi(doc);
  expect(result.ok, JSON.stringify(!result.ok ? result.errors : [])).toBe(true);
  return buildMusicTimeline(doc);
}

describe('MusicTimeline — construction depuis un document écrit à la main', () => {
  it('expose duration et confidence tels quels', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.duration).toBe(10);
    expect(timeline.confidence).toEqual({ tempo: 0.9, grid: 0.85, classification: 0.6, structure: 0.5 });
  });

  it('ne lance jamais, y compris avec un type d\'événement hors vocabulaire connu', () => {
    expect(() => buildFromHandWrittenDoc()).not.toThrow();
  });
});

describe('MusicTimeline — eventsBetween, borne demi-ouverte (t0, t1]', () => {
  it('exclut t0, inclut t1', () => {
    const timeline = buildFromHandWrittenDoc();
    const window1 = timeline.eventsBetween(0, 0.5);
    expect(window1.map((e) => e.type)).toEqual(['BEAT']); // BAR@0 exclu (t0), BEAT@0.5 inclus (t1)

    const window2 = timeline.eventsBetween(0.5, 1.0);
    expect(window2.map((e) => e.type)).toEqual(['BEAT', 'SNARE']); // BEAT@0.5 exclu, BEAT@1.0 + SNARE@1.0 inclus
  });

  it('un balayage de fenêtres consécutives ne compte jamais un événement deux fois', () => {
    const timeline = buildFromHandWrittenDoc();
    const a = timeline.eventsBetween(-1, 1.0);
    const b = [...timeline.eventsBetween(-1, 0.5), ...timeline.eventsBetween(0.5, 1.0)];
    expect(b).toEqual(a);
  });

  it('type hors vocabulaire connu : présent dans eventsBetween, requêtable par type sans erreur', () => {
    const timeline = buildFromHandWrittenDoc();
    const all = timeline.eventsBetween(4, 6);
    expect(all.map((e) => e.type)).toEqual(['XENOMORPH_STINGER']);
    expect(timeline.eventsOfTypeBetween('XENOMORPH_STINGER', 4, 6)).toHaveLength(1);
    expect(timeline.eventsOfTypeBetween('COMPLETEMENT_INCONNU', 0, 10)).toEqual([]);
  });
});

describe('MusicTimeline — nextEventOfType / prevEventOfType / timeToNext aux bornes', () => {
  it('un événement exactement à t compte comme "prev", jamais comme "next"', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.nextEventOfType('BEAT', 0.5)?.t).toBe(1.0);
    expect(timeline.prevEventOfType('BEAT', 0.5)?.t).toBe(0.5);
    expect(timeline.prevEventOfType('BEAT', 0.49)).toBeNull();
  });

  it('retourne null / +Infinity quand aucun événement du type ne suit', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.nextEventOfType('BEAT', 1.0)).toBeNull();
    expect(timeline.timeToNext('BEAT', 1.0)).toBe(Infinity);
    expect(timeline.nextEventOfType('COMPLETEMENT_INCONNU', 0)).toBeNull();
  });

  it('timeToNext donne le délai exact avant une anticipation (ex. DROP)', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.timeToNext('DROP', 1.0)).toBeCloseTo(2.0, 10);
  });
});

describe('MusicTimeline — featureAt / featureSlope', () => {
  it('interpole linéairement entre deux échantillons', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.featureAt(0.5, 'energy')).toBeCloseTo(0.5, 10);
    expect(timeline.featureAt(0.25, 'energy')).toBeCloseTo(0.25, 10);
  });

  it('clampe hors des bornes de la piste plutôt que d\'extrapoler', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.featureAt(-5, 'energy')).toBe(0);
    expect(timeline.featureAt(50, 'energy')).toBe(1);
  });

  it('retourne 0 pour un id de feature inconnu, sans erreur', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.featureAt(1, 'centroid')).toBe(0);
  });

  it('calcule une pente cohérente avec une rampe linéaire', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.featureSlope(0.5, 'energy', 0.2)).toBeCloseTo(1, 6);
  });
});

describe('MusicTimeline — tempo/beat/bar', () => {
  it('tempoAt reflète les points de tempo.map en fonction en escalier', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.tempoAt(0)).toBe(120);
    expect(timeline.tempoAt(3.999)).toBe(120);
    expect(timeline.tempoAt(4)).toBe(180);
    expect(timeline.tempoAt(9)).toBe(180);
  });

  it('beatIndexAt/beatPhaseAt intègrent le tempo, y compris à travers un changement', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.beatIndexAt(0)).toBe(0);
    expect(timeline.beatPhaseAt(0)).toBeCloseTo(0, 10);
    expect(timeline.beatIndexAt(0.25)).toBe(0);
    expect(timeline.beatPhaseAt(0.25)).toBeCloseTo(0.5, 10); // 120 BPM = 2 battements/s
    expect(timeline.beatIndexAt(4)).toBe(8); // 4s à 120 BPM = 8 battements pile
    expect(timeline.beatIndexAt(4.5)).toBe(9); // + 0.5s à 180 BPM (3 battements/s) = +1.5 battement
    expect(timeline.beatPhaseAt(4.5)).toBeCloseTo(0.5, 10);
  });

  it('barIndexAt/barPhaseAt : 4 temps par mesure en 4/4', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.barIndexAt(0)).toBe(0);
    expect(timeline.barIndexAt(1.999)).toBe(0); // 1 mesure = 2s à 120 BPM
    expect(timeline.barIndexAt(2)).toBe(1);
    expect(timeline.barPhaseAt(2)).toBeCloseTo(0, 10);
  });

  it('barIndexAt/barPhaseAt intègrent aussi un changement de mesure', () => {
    const doc: PmdiDocument = {
      ...handWrittenDoc(),
      tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] }, // tempo constant pour isoler l'effet du meter
      meter: {
        map: [
          { t: 0, num: 4, den: 4 },
          { t: 6, num: 3, den: 4 },
        ],
      },
    };
    expect(validatePmdi(doc).ok).toBe(true);
    const timeline = buildMusicTimeline(doc);
    expect(timeline.barIndexAt(6)).toBe(3); // 6s à 120 BPM = 12 battements / 4 par mesure = 3 mesures pile
    expect(timeline.barIndexAt(6.5)).toBe(3);
    expect(timeline.barPhaseAt(6.5)).toBeCloseTo(1 / 3, 10); // +1 battement / 3 par mesure désormais
  });
});

describe('MusicTimeline — sections', () => {
  it('sectionAt retourne la section courante, null avant la première', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.sectionAt(-1)).toBeNull();
    expect(timeline.sectionAt(0)?.letter).toBe('A');
    expect(timeline.sectionAt(1.999)?.letter).toBe('A');
    expect(timeline.sectionAt(2)?.letter).toBe('B');
  });

  it('sections() retourne toutes les sections triées', () => {
    const timeline = buildFromHandWrittenDoc();
    expect(timeline.sections().map((s) => s.letter)).toEqual(['A', 'B']);
  });
});
