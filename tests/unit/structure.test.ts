import { describe, expect, it } from 'vitest';
import { detectSections, SECTION_ENERGY_HIGH_MIN, SECTION_ENERGY_LOW_MAX, type StructureFeatureTrack } from '../../src/analysis/structure';
import { BAND_IDS, type BandId } from '../../src/analysis/bands';

function constantTrack(hz: number, durationSec: number, value: number): StructureFeatureTrack {
  const n = Math.ceil(durationSec * hz) + 1;
  return { hz, t0: 0, data: new Array(n).fill(value) };
}

function steppedTrack(hz: number, durationSec: number, breakpoints: number[], values: number[]): StructureFeatureTrack {
  const n = Math.ceil(durationSec * hz) + 1;
  const data = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / hz;
    let seg = 0;
    while (seg < breakpoints.length && t >= breakpoints[seg]!) seg++;
    data[i] = values[seg]!;
  }
  return { hz, t0: 0, data };
}

function beatsAt(count: number, spacingSec: number): number[] {
  return Array.from({ length: count }, (_, i) => i * spacingSec);
}

describe('detectSections — trop peu de battements', () => {
  it('retombe sur une section unique couvrant tout le morceau, honnêtement (pas de frontière fabriquée)', () => {
    const hz = 10;
    const duration = 4;
    const bandTracks = {} as Record<BandId, StructureFeatureTrack>;
    for (const b of BAND_IDS) bandTracks[b] = constantTrack(hz, duration, 0.5);

    const sections = detectSections({
      duration,
      beatTimes: beatsAt(8, 0.5), // 8 battements < 2×8+1=17 requis
      downbeatTimes: [0, 2],
      bandTracks,
      centroidTrack: constantTrack(hz, duration, 1000),
      flatnessTrack: constantTrack(hz, duration, 0.3),
      energyTrack: constantTrack(hz, duration, 0.6),
      onsetTimes: [],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]!.t).toBe(0);
    expect(sections[0]!.dur).toBe(duration);
  });
});

describe('detectSections — rupture nette de profil spectral', () => {
  it('détecte une frontière entre deux moitiés au profil radicalement différent, et réutilise la lettre pour un profil qui revient', () => {
    const hz = 10;
    const spacingSec = 0.5; // 120 BPM
    const beatCount = 60; // 30s — 3 segments de 10s, largement au-dessus du minimum de 17 battements
    const duration = beatCount * spacingSec;
    const beatTimes = beatsAt(beatCount, spacingSec);
    const downbeatTimes = beatTimes.filter((_, i) => i % 4 === 0);

    // Segment A [0,10s) et [20,30s) : grave dominant. Segment B [10,20s) : aigu dominant.
    const bandTracks = {} as Record<BandId, StructureFeatureTrack>;
    bandTracks.sub = steppedTrack(hz, duration, [10, 20], [0.9, 0.1, 0.9]);
    bandTracks.high = steppedTrack(hz, duration, [10, 20], [0.1, 0.9, 0.1]);
    bandTracks.bass = constantTrack(hz, duration, 0.5);
    bandTracks.lowmid = constantTrack(hz, duration, 0.5);
    bandTracks.mid = constantTrack(hz, duration, 0.5);
    bandTracks.himid = constantTrack(hz, duration, 0.5);

    const centroidTrack = steppedTrack(hz, duration, [10, 20], [200, 6000, 200]);
    const flatnessTrack = constantTrack(hz, duration, 0.3);
    // Énergie IDENTIQUE partout : isole la détection par SIMILARITÉ de l'étiquetage par énergie.
    const energyTrack = constantTrack(hz, duration, 0.55);

    const sections = detectSections({
      duration,
      beatTimes,
      downbeatTimes,
      bandTracks,
      centroidTrack,
      flatnessTrack,
      energyTrack,
      onsetTimes: [],
    });

    expect(sections.length).toBeGreaterThanOrEqual(2);

    // Une frontière doit tomber raisonnablement près de t=10s (alignée sur un downbeat proche).
    const hasBoundaryNear10 = sections.some((s) => Math.abs(s.t - 10) <= 2);
    expect(hasBoundaryNear10).toBe(true);

    // energy (0,55) est dans la bande "mid" (]0.4, 0.7[) pour toutes les sections.
    for (const s of sections) {
      expect(s.energy).toBeGreaterThan(SECTION_ENERGY_LOW_MAX);
      expect(s.energy).toBeLessThan(SECTION_ENERGY_HIGH_MIN);
    }

    // Si une 3e section existe (retour au profil A), elle doit partager la lettre de la 1re —
    // et dans tous les cas, au moins deux lettres distinctes doivent apparaître (A ≠ B détectés).
    const letters = new Set(sections.map((s) => s.letter));
    expect(letters.size).toBeGreaterThanOrEqual(2);
    if (sections.length >= 3) {
      expect(sections[0]!.letter).toBe(sections[sections.length - 1]!.letter);
    }
  });
});
