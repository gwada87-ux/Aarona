import { describe, expect, it } from 'vitest';
import { finalizePmdi } from '../../src/analysis/finalize';
import { BAND_IDS } from '../../src/analysis/bands';
import type { FeatureTrack, OnsetDescriptor, PmdiDocument } from '../../src/music/pmdi';

function constantFeature(id: string, hz: number, durationSec: number, value: number): FeatureTrack {
  const n = Math.ceil(durationSec * hz) + 1;
  return { id, hz, t0: 0, data: new Array(n).fill(value) };
}

function stepFeature(id: string, hz: number, durationSec: number, breakpoints: number[], values: number[]): FeatureTrack {
  const n = Math.ceil(durationSec * hz) + 1;
  const data = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / hz;
    let seg = 0;
    while (seg < breakpoints.length && t >= breakpoints[seg]!) seg++;
    data[i] = values[seg]!;
  }
  return { id, hz, t0: 0, data };
}

function kickDescriptor(t: number): OnsetDescriptor {
  return {
    t,
    band: 'bass',
    strength: 0.9,
    e: [0.4, 0.3, 0.1, 0.1, 0.05, 0.05],
    centroid: 150,
    flatness: 0,
    decay30: 0.15,
    decaySaturated: false,
  };
}

function baseDoc(overrides: Partial<PmdiDocument> = {}): PmdiDocument {
  const duration = 8;
  const hz = 10;
  const features: FeatureTrack[] = [
    ...BAND_IDS.map((b) => constantFeature(`band.${b}`, hz, duration, 0.1)),
    constantFeature('energy', hz, duration, 0.5),
    constantFeature('centroid', hz, duration, 1000),
    constantFeature('flatness', hz, duration, 0.3),
  ];

  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test', createdAt: '2026-01-01T00:00:00Z' },
    audio: { duration, sampleRate: 44100, channels: 2 },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    grid: { beats: [], downbeats: [] },
    events: [],
    features,
    confidence: { tempo: 1, grid: 1, classification: 0, structure: 0 },
    ...overrides,
  };
}

describe('finalizePmdi — document minimal complet', () => {
  it('classe les onsets, produit une section (repli faute de battements) et des confiances non nulles', () => {
    const doc = baseDoc({
      ext: {
        onsetDescriptors: [kickDescriptor(1)],
        rawRmsDb: constantFeature('ext.rawRmsDb', 10, 8, -20),
      },
    });

    const result = finalizePmdi(doc);

    const kicks = result.events.filter((e) => e.type === 'KICK');
    expect(kicks).toHaveLength(1);
    expect(kicks[0]!.t).toBeCloseTo(1, 5);

    expect(result.sections).toHaveLength(1);
    expect(result.sections![0]!.dur).toBe(8);

    expect(result.confidence.classification).toBeGreaterThan(0);
    expect(result.confidence.structure).toBe(0.3); // repli structure.ts, trop peu de battements
  });
});

describe('finalizePmdi — ordre classify() avant macro() (BREAK a besoin des KICK déjà typés)', () => {
  function breakScenario(onsetDescriptors: OnsetDescriptor[]): PmdiDocument {
    const duration = 8;
    const hz = 10;
    const energy = stepFeature('energy', hz, duration, [2, 6], [0.8, 0.2, 0.5]); // haut, bas, bas, moyen
    const doc = baseDoc({
      grid: { beats: [], downbeats: [0, 2, 4, 6, 8] },
      features: [
        ...BAND_IDS.map((b) => constantFeature(`band.${b}`, hz, duration, 0.1)),
        energy,
        constantFeature('centroid', hz, duration, 1000),
        constantFeature('flatness', hz, duration, 0.3),
      ],
      ext: {
        onsetDescriptors,
        rawRmsDb: constantFeature('ext.rawRmsDb', hz, duration, -20),
      },
    });
    return doc;
  }

  it('sans onset caché dans la plage basse → BREAK détecté', () => {
    const result = finalizePmdi(breakScenario([]));
    expect(result.events.filter((e) => e.type === 'BREAK')).toHaveLength(1);
  });

  it('un KICK caché dans la plage basse (t=3, entre les downbeats 2 et 6) → BREAK supprimé', () => {
    const result = finalizePmdi(breakScenario([kickDescriptor(3)]));
    expect(result.events.filter((e) => e.type === 'KICK')).toHaveLength(1);
    expect(result.events.filter((e) => e.type === 'BREAK')).toHaveLength(0);
  });
});

describe('finalizePmdi — tolérance à l\'inconnu', () => {
  it('document sans ext.onsetDescriptors : classification vide, aucune exception', () => {
    const doc = baseDoc();
    expect(() => finalizePmdi(doc)).not.toThrow();

    const result = finalizePmdi(doc);
    expect(result.events.filter((e) => ['KICK', 'SNARE', 'CLAP', 'HAT', 'PERC'].includes(e.type))).toHaveLength(0);
    expect(result.confidence.classification).toBe(0);
  });

  it('ne mute pas le document partiel passé en entrée (fonction pure)', () => {
    const doc = baseDoc({ ext: { onsetDescriptors: [kickDescriptor(1)] } });
    const eventsBefore = doc.events;
    finalizePmdi(doc);
    expect(doc.events).toBe(eventsBefore);
    expect(doc.events).toHaveLength(0);
  });
});

describe('finalizePmdi — événements DOWNBEAT synthétisés depuis grid.downbeats (régression Étape 44)', () => {
  it('un temps fort par entrée de grid.downbeats, au bon instant', () => {
    const doc = baseDoc({ grid: { beats: [], downbeats: [0, 2, 4, 6] } });
    const result = finalizePmdi(doc);

    const downbeats = result.events.filter((e) => e.type === 'DOWNBEAT');
    expect(downbeats).toHaveLength(4);
    expect(downbeats.map((e) => e.t)).toEqual([0, 2, 4, 6]);
  });

  it('meta.barIndex reflète la position dans grid.downbeats (0-based)', () => {
    const doc = baseDoc({ grid: { beats: [], downbeats: [0, 2, 4] } });
    const result = finalizePmdi(doc);

    const downbeats = result.events.filter((e) => e.type === 'DOWNBEAT');
    expect(downbeats.map((e) => e.meta?.barIndex)).toEqual([0, 1, 2]);
  });

  it('confidence reprend celle de la grille (partial.confidence.grid), pas une valeur figée', () => {
    const doc = baseDoc({ grid: { beats: [], downbeats: [0] }, confidence: { tempo: 1, grid: 0.42, classification: 0, structure: 0 } });
    const result = finalizePmdi(doc);

    const downbeat = result.events.find((e) => e.type === 'DOWNBEAT');
    expect(downbeat?.confidence).toBe(0.42);
  });

  it('grid.downbeats vide (ou grid absent) : aucun DOWNBEAT, ne lève pas', () => {
    const doc = baseDoc({ grid: { beats: [], downbeats: [] } });
    expect(() => finalizePmdi(doc)).not.toThrow();
    expect(finalizePmdi(doc).events.filter((e) => e.type === 'DOWNBEAT')).toHaveLength(0);
  });

  it('les DOWNBEAT sont fusionnés et triés avec les autres événements, pas ajoutés à part', () => {
    const doc = baseDoc({
      grid: { beats: [], downbeats: [5, 1] }, // volontairement non trié en entrée
      ext: { onsetDescriptors: [kickDescriptor(3)], rawRmsDb: constantFeature('ext.rawRmsDb', 10, 8, -20) },
    });
    const result = finalizePmdi(doc);

    const ts = result.events.map((e) => e.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(result.events.filter((e) => e.type === 'DOWNBEAT').map((e) => e.t)).toEqual([1, 5]);
  });
});
