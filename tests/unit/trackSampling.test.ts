/**
 * Tests de `analysis/trackSampling.ts` — Étape 41. `averageOverInterval()`
 * est exercée abondamment par `macro.ts`/`structure.ts` (déjà testés), mais
 * uniquement avec des intervalles non dégénérés — son repli sur `sampleAt`
 * (intervalle hors piste) et le clampage de `sampleAt` lui-même ne sont
 * jamais exercés directement. Repéré par le 4e audit de couverture.
 */
import { describe, expect, it } from 'vitest';
import { sampleAt, averageOverInterval } from '../../src/analysis/trackSampling';
import type { SampledTrack } from '../../src/analysis/trackSampling';

describe('sampleAt — lecture directe', () => {
  const track: SampledTrack = { hz: 10, t0: 0, data: [1, 2, 3, 4, 5] };

  it('index en plage : arrondi au sample le plus proche', () => {
    expect(sampleAt(track, 0.2)).toBe(3); // idx = round(0.2*10) = 2 -> data[2]
  });

  it('arrondi à 0,5 pile : vers le haut (Math.round)', () => {
    // hz=2, t0=0, data=[0,10,20,30] ; t=0.75 -> (0.75)*2=1.5 -> round=2 -> data[2]=20
    const t2: SampledTrack = { hz: 2, t0: 0, data: [0, 10, 20, 30] };
    expect(sampleAt(t2, 0.75)).toBe(20);
  });

  it('t0 non nul : décalage pris en compte', () => {
    const shifted: SampledTrack = { hz: 10, t0: 5, data: [1, 2, 3, 4, 5] };
    expect(sampleAt(shifted, 5.2)).toBe(3); // idx = round((5.2-5)*10) = 2
  });
});

describe('sampleAt — clampage aux bornes', () => {
  const track: SampledTrack = { hz: 10, t0: 0, data: [1, 2, 3, 4, 5] };

  it('t très négatif : clampé au premier échantillon', () => {
    expect(sampleAt(track, -100)).toBe(1);
  });

  it('t très grand : clampé au dernier échantillon', () => {
    expect(sampleAt(track, 1000)).toBe(5);
  });

  it('piste vide : renvoie 0 (repli ??), quel que soit t', () => {
    const empty: SampledTrack = { hz: 10, t0: 0, data: [] };
    expect(sampleAt(empty, 0)).toBe(0);
    expect(sampleAt(empty, 100)).toBe(0);
  });
});

describe('averageOverInterval — intervalle normal (plusieurs trames)', () => {
  it('moyenne exacte des échantillons couverts par [tStart, tEnd)', () => {
    // hz=1, t0=0, data=[10,20,30,40,50] ; [1,4) -> i0=round(1)=1, i1raw=round(4)=4, i1=min(4,max(1,3))=3
    // moyenne de data[1..3] = (20+30+40)/3 = 30
    const track: SampledTrack = { hz: 1, t0: 0, data: [10, 20, 30, 40, 50] };
    expect(averageOverInterval(track, 1, 4)).toBe(30);
  });

  it('intervalle couvrant toute la piste : moyenne de tous les échantillons', () => {
    const track: SampledTrack = { hz: 1, t0: 0, data: [10, 20, 30, 40, 50] };
    expect(averageOverInterval(track, 0, 5)).toBe(30); // (10+20+30+40+50)/5
  });

  it('tStart avant t0 : i0 clampé à 0, la moyenne démarre au premier échantillon', () => {
    const track: SampledTrack = { hz: 1, t0: 0, data: [10, 20, 30, 40, 50] };
    expect(averageOverInterval(track, -100, 2)).toBe(averageOverInterval(track, 0, 2));
  });
});

describe('averageOverInterval — intervalle sous-trame (dégénère en un seul échantillon)', () => {
  it("intervalle plus court qu'une trame, mais en plage : moyenne == l'unique échantillon couvert", () => {
    // hz=1, t0=0 ; [2, 2.3) -> i0=round(2)=2, i1raw=round(2.3)=2, i1=min(4,max(2,1))=2 -> data[2] seul
    const track: SampledTrack = { hz: 1, t0: 0, data: [10, 20, 30, 40, 50] };
    expect(averageOverInterval(track, 2, 2.3)).toBe(30);
  });
});

describe('averageOverInterval — intervalle hors piste (vrai repli sur sampleAt)', () => {
  it('tStart au-delà de la fin de la piste : bascule sur sampleAt(track, tStart)', () => {
    const track: SampledTrack = { hz: 1, t0: 0, data: [10, 20, 30, 40, 50] };
    // i0 = round(100) = 100, largement > data.length-1 (4) -> repli garanti
    expect(averageOverInterval(track, 100, 101)).toBe(sampleAt(track, 100));
    expect(averageOverInterval(track, 100, 101)).toBe(50); // sampleAt clampe au dernier échantillon
  });
});
