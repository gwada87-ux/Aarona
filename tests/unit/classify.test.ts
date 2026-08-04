import { describe, expect, it } from 'vitest';
import { classifyOnset, classifyOnsets, DEFAULT_CLASSIFICATION_THRESHOLDS } from '../../src/analysis/classify';
import type { OnsetDescriptor } from '../../src/music/pmdi';

/** e = [E_sub, E_bass, E_lowmid, E_mid, E_himid, E_high] — docs/05 §4. */
function descriptor(overrides: Partial<OnsetDescriptor> = {}): OnsetDescriptor {
  return {
    t: 1.0,
    band: 'bass',
    strength: 0.9,
    e: [0, 0, 0, 0, 0, 0],
    centroid: 1000,
    flatness: 0,
    decay30: 0.1,
    decaySaturated: false,
    microOnsetCount: 0,
    ...overrides,
  };
}

describe('classifyOnset — KICK', () => {
  it('classe un profil grave/décroissance rapide comme KICK', () => {
    const d = descriptor({ e: [0.4, 0.3, 0.1, 0.1, 0.05, 0.05], centroid: 150, decay30: 0.15 });
    const event = classifyOnset(d);
    expect(event?.type).toBe('KICK');
    expect(event?.intensity).toBeCloseTo(0.3, 10); // « intensité = E_bass normalisée » (d.e[1])
  });

  it('un decay30 saturé ne bloque PAS KICK (condition neutralisée, docs/05 §4)', () => {
    const d = descriptor({ e: [0.4, 0.3, 0.1, 0.1, 0.05, 0.05], centroid: 150, decay30: 0.5, decaySaturated: true });
    expect(classifyOnset(d)?.type).toBe('KICK');
  });

  it('confiance basse quand la marge est faible (à peine au-dessus du seuil)', () => {
    const barelyOver = descriptor({ e: [0.3, 0.26, 0.15, 0.15, 0.07, 0.07], centroid: 150, decay30: 0.05, strength: 1 });
    const comfortablyOver = descriptor({ e: [0.5, 0.3, 0.05, 0.05, 0.05, 0.05], centroid: 100, decay30: 0.05, strength: 1 });
    const evBarely = classifyOnset(barelyOver);
    const evComfortable = classifyOnset(comfortablyOver);
    expect(evBarely?.type).toBe('KICK');
    expect(evComfortable?.type).toBe('KICK');
    expect(evBarely!.confidence).toBeLessThan(evComfortable!.confidence);
  });
});

describe('classifyOnset — SNARE et CLAP (priorité CLAP avant SNARE)', () => {
  const snareLikeDescriptor = (microOnsetCount: number) =>
    descriptor({
      e: [0.05, 0.05, 0.25, 0.2, 0.2, 0.25],
      flatness: 0.5,
      decay30: 0.2,
      microOnsetCount,
    });

  it('profil SNARE sans micro-onsets → SNARE', () => {
    expect(classifyOnset(snareLikeDescriptor(0))?.type).toBe('SNARE');
  });

  it('même profil AVEC 2-4 micro-onsets → CLAP, pas SNARE', () => {
    expect(classifyOnset(snareLikeDescriptor(3))?.type).toBe('CLAP');
  });

  it('trop de micro-onsets (hors [2,4]) → retombe sur SNARE', () => {
    expect(classifyOnset(snareLikeDescriptor(6))?.type).toBe('SNARE');
  });

  it('rejette SNARE si la platitude est trop faible (composante bruitée absente)', () => {
    // centroid hors plage PERC ([800,5000]) pour isoler le rejet SNARE, pas un repli PERC.
    const d = descriptor({ e: [0.05, 0.05, 0.25, 0.2, 0.2, 0.25], flatness: 0.1, decay30: 0.2, centroid: 100 });
    expect(classifyOnset(d)).toBeNull();
  });

  it('un decay30 saturé neutralise la borne haute de la plage [80,400]ms', () => {
    const d = descriptor({ e: [0.05, 0.05, 0.25, 0.2, 0.2, 0.25], flatness: 0.5, decay30: 0.5, decaySaturated: true });
    expect(classifyOnset(d)?.type).toBe('SNARE');
  });
});

describe('classifyOnset — HAT', () => {
  it('classe un profil aigu comme HAT, closed si decay30 court', () => {
    const d = descriptor({ e: [0.02, 0.02, 0.03, 0.08, 0.25, 0.6], centroid: 7000, decay30: 0.05 });
    const event = classifyOnset(d);
    expect(event?.type).toBe('HAT');
    expect(event?.meta?.open).toBe(false);
  });

  it('open si decay30 dépasse le seuil openDecay30', () => {
    const d = descriptor({ e: [0.02, 0.02, 0.03, 0.08, 0.25, 0.6], centroid: 7000, decay30: 0.2 });
    expect(classifyOnset(d)?.meta?.open).toBe(true);
  });

  it('un HAT saturé (jamais redescendu) est considéré open', () => {
    const d = descriptor({ e: [0.02, 0.02, 0.03, 0.08, 0.25, 0.6], centroid: 7000, decay30: 0.5, decaySaturated: true });
    expect(classifyOnset(d)?.meta?.open).toBe(true);
  });
});

describe('classifyOnset — PERC (repli) et rejet', () => {
  it('un onset qui ne correspond à aucune règle mais a un centroïde médian devient PERC', () => {
    const d = descriptor({ e: [0.16, 0.16, 0.17, 0.17, 0.17, 0.17], centroid: 2000, flatness: 0.2, decay30: 0.3 });
    expect(classifyOnset(d)?.type).toBe('PERC');
  });

  it('rejette (null) un onset qui ne correspond à aucune règle, y compris PERC', () => {
    const d = descriptor({ e: [0.16, 0.16, 0.17, 0.17, 0.17, 0.17], centroid: 100, flatness: 0.2, decay30: 0.3 });
    expect(classifyOnset(d)).toBeNull();
  });
});

describe('classifyOnset — seuils surchargés (calibration par genre, docs/05 §"Calibration par genre")', () => {
  it('un seuil bassRatio plus strict rejette un kick qui passait avec les valeurs par défaut', () => {
    const d = descriptor({ e: [0.3, 0.28, 0.1, 0.1, 0.11, 0.11], centroid: 150, decay30: 0.1 }); // 0.58 > défaut 0.55
    expect(classifyOnset(d)?.type).toBe('KICK');

    const stricter = { ...DEFAULT_CLASSIFICATION_THRESHOLDS, kick: { ...DEFAULT_CLASSIFICATION_THRESHOLDS.kick, bassRatio: 0.62 } };
    expect(classifyOnset(d, stricter)).toBeNull();
  });
});

describe('classifyOnsets — traitement en lot', () => {
  it('filtre les onsets rejetés, conserve les autres dans l\'ordre', () => {
    const kick = descriptor({ t: 0, e: [0.4, 0.3, 0.1, 0.1, 0.05, 0.05], centroid: 150, decay30: 0.1 });
    const rejected = descriptor({ t: 0.5, e: [0.16, 0.16, 0.17, 0.17, 0.17, 0.17], centroid: 100, flatness: 0.2, decay30: 0.3 });
    const hat = descriptor({ t: 1, e: [0.02, 0.02, 0.03, 0.08, 0.25, 0.6], centroid: 7000, decay30: 0.05 });

    const events = classifyOnsets([kick, rejected, hat]);
    expect(events.map((e) => e.type)).toEqual(['KICK', 'HAT']);
  });
});
