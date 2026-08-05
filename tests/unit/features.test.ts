/**
 * Tests de `analysis/features.ts::computeFrameFeatures()`/`rawFrameSegment()`/
 * `computeFrameFeatureTracks()` — Étape 51 (6e audit de couverture). Jamais
 * testé directement : `computeFrameFeatureTracks()` est bien appelé par
 * `onsetDescriptors.test.ts`, mais seul `.peak` y transite (vers
 * `computeOnsetDescriptor`, qui recalcule son PROPRE centroïde
 * indépendamment) — `centroid`/`flatness`/`rolloff85`/`rms`/`energy` ne sont
 * jamais assertés nulle part.
 */
import { describe, expect, it } from 'vitest';
import { computeFrameFeatures, rawFrameSegment, computeFrameFeatureTracks } from '../../src/analysis/features';

describe('computeFrameFeatures — rms/peak (domaine temporel, signal BRUT)', () => {
  it('rms/peak calculés correctement sur un segment connu', () => {
    const raw = new Float64Array([3, 4]);
    const mag = new Float64Array([0]); // sans effet sur rms/peak
    const f = computeFrameFeatures(raw, mag, 1);
    expect(f.peak).toBe(4);
    expect(f.rms).toBeCloseTo(Math.sqrt((9 + 16) / 2), 10);
  });

  it('peak prend la valeur ABSOLUE (un négatif de plus grande amplitude gagne)', () => {
    const raw = new Float64Array([-5, 3]);
    const f = computeFrameFeatures(raw, new Float64Array([0]), 1);
    expect(f.peak).toBe(5);
    expect(f.rms).toBeCloseTo(Math.sqrt((25 + 9) / 2), 10);
  });

  it('segment silencieux (tout à zéro) : rms=0, peak=0', () => {
    const f = computeFrameFeatures(new Float64Array([0, 0, 0]), new Float64Array([0]), 1);
    expect(f.rms).toBe(0);
    expect(f.peak).toBe(0);
  });
});

describe('computeFrameFeatures — energy (domaine spectral)', () => {
  it('somme des carrés de magnitude', () => {
    const f = computeFrameFeatures(new Float64Array([0]), new Float64Array([1, 2, 3]), 1);
    expect(f.energy).toBe(1 + 4 + 9);
  });
});

describe('computeFrameFeatures — centroid (moyenne pondérée par fréquence)', () => {
  it('une seule bande non nulle : le centroïde tombe exactement sur sa fréquence', () => {
    const mag = new Float64Array([0, 1, 0]);
    const f = computeFrameFeatures(new Float64Array([0]), mag, 10);
    expect(f.centroid).toBe(10); // bin 1 * 10 Hz
  });

  it('distribution symétrique : le centroïde tombe sur le bin médian', () => {
    const mag = new Float64Array([1, 0, 1]); // poids égal en 0 et 2
    const f = computeFrameFeatures(new Float64Array([0]), mag, 5);
    expect(f.centroid).toBe(5); // bin (0+2)/2=1 * 5 Hz
  });

  it('trame silencieuse (magSum=0) : repli sur 0, pas de division par zéro (NaN)', () => {
    const mag = new Float64Array([0, 0, 0]);
    const f = computeFrameFeatures(new Float64Array([0]), mag, 10);
    expect(f.centroid).toBe(0);
  });
});

describe('computeFrameFeatures — flatness (moyenne géométrique / arithmétique)', () => {
  it('magnitudes toutes égales (spectre parfaitement plat) : flatness proche de 1', () => {
    const mag = new Float64Array([2, 2, 2, 2]);
    const f = computeFrameFeatures(new Float64Array([0]), mag, 1);
    expect(f.flatness).toBeCloseTo(1, 6);
  });

  it('un seul pic dominant (spectre très tonal) : flatness proche de 0', () => {
    const mag = new Float64Array([100, 1e-10, 1e-10, 1e-10]);
    const f = computeFrameFeatures(new Float64Array([0]), mag, 1);
    expect(f.flatness).toBeLessThan(0.01);
  });

  it("reste borné à 1 (Math.min(1, ...)), jamais au-dessus même en cas d'arrondi flottant", () => {
    const mag = new Float64Array([5, 5, 5]);
    const f = computeFrameFeatures(new Float64Array([0]), mag, 1);
    expect(f.flatness).toBeLessThanOrEqual(1);
  });
});

describe('computeFrameFeatures — rolloff85 (fréquence de coupure à 85% de l\'énergie cumulée)', () => {
  it('magnitudes égales : le seuil de 85% est franchi au DERNIER bin (4 bins -> 3/4 = 75% < 85%)', () => {
    const mag = new Float64Array([1, 1, 1, 1]); // énergie cumulée : 25%, 50%, 75%, 100%
    const f = computeFrameFeatures(new Float64Array([0]), mag, 100);
    expect(f.rolloff85).toBe(300); // bin 3 (le dernier) * 100 Hz
  });

  it('énergie concentrée dans le premier bin : le seuil est franchi immédiatement (bin 0)', () => {
    const mag = new Float64Array([100, 1, 1, 1]);
    const f = computeFrameFeatures(new Float64Array([0]), mag, 50);
    expect(f.rolloff85).toBe(0);
  });

  it('un seul bin : rolloff85 tombe nécessairement sur ce bin', () => {
    const f = computeFrameFeatures(new Float64Array([0]), new Float64Array([7]), 20);
    expect(f.rolloff85).toBe(0);
  });
});

describe('rawFrameSegment — extraction du segment brut non fenêtré', () => {
  it('frameIndex=0 : les windowSize premiers échantillons', () => {
    const signal = Float64Array.from([1, 2, 3, 4, 5, 6]);
    const seg = rawFrameSegment(signal, 0, 3, 2);
    expect(Array.from(seg)).toEqual([1, 2, 3]);
  });

  it('frameIndex>0 : décalé de frameIndex * hop', () => {
    const signal = Float64Array.from([1, 2, 3, 4, 5, 6]);
    const seg = rawFrameSegment(signal, 1, 3, 2);
    expect(Array.from(seg)).toEqual([3, 4, 5]);
  });
});

describe('computeFrameFeatureTracks — une entrée FrameFeatures par trame', () => {
  it('longueur du résultat = nombre de trames, valeurs cohérentes avec un calcul direct', () => {
    const signal = Float64Array.from([1, 1, 1, 1, 2, 2, 2, 2]);
    const frames = [new Float64Array([1, 1]), new Float64Array([3, 4])];
    const windowSize = 4;
    const hop = 4;
    const sampleRate = 40; // binHz = 40/4 = 10

    const tracks = computeFrameFeatureTracks(signal, frames, { windowSize, hop, sampleRate });

    expect(tracks).toHaveLength(2);
    const expectedSecond = computeFrameFeatures(rawFrameSegment(signal, 1, windowSize, hop), frames[1]!, 10);
    expect(tracks[1]).toEqual(expectedSecond);
  });
});
