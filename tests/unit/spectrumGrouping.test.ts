import { describe, expect, it } from 'vitest';
import { groupBinsIntoBars } from '../../src/visual/layers/spectrum/spectrumGrouping';

function makeFine(n: number, fill: (i: number) => number): Float32Array {
  const arr = new Float32Array(n);
  for (let i = 0; i < n; i++) arr[i] = fill(i);
  return arr;
}

describe('spectrumGrouping — groupBinsIntoBars', () => {
  it('produit exactement barCount valeurs', () => {
    const fine = makeFine(96, () => 1);
    for (const barCount of [32, 48, 64, 96]) {
      expect(groupBinsIntoBars(fine, barCount).length).toBe(barCount);
    }
  });

  it('valeur constante => moyenne inchangée quel que soit le regroupement', () => {
    const fine = makeFine(96, () => 7);
    for (const barCount of [32, 48, 64, 96]) {
      const bars = groupBinsIntoBars(fine, barCount);
      for (const v of bars) expect(v).toBeCloseTo(7, 9);
    }
  });

  it('96 -> 96 barres = identité (aucun regroupement)', () => {
    const fine = makeFine(96, (i) => i);
    const bars = groupBinsIntoBars(fine, 96);
    for (let i = 0; i < 96; i++) expect(bars[i]).toBeCloseTo(i, 9);
  });

  it('96 -> 32 barres = moyenne de groupes de 3 (division exacte)', () => {
    const fine = makeFine(96, (i) => i);
    const bars = groupBinsIntoBars(fine, 32);
    expect(bars[0]).toBeCloseTo((0 + 1 + 2) / 3, 9);
    expect(bars[31]).toBeCloseTo((93 + 94 + 95) / 3, 9);
  });

  it('96 -> 64 barres (division non exacte, 1,5 bin/barre) : couvre tous les bins, sans trou', () => {
    const fine = makeFine(96, () => 1);
    const bars = groupBinsIntoBars(fine, 64);
    expect(bars.length).toBe(64);
    for (const v of bars) expect(v).toBeCloseTo(1, 9); // uniforme => moyenne toujours 1, peu importe la taille du groupe
  });

  it('un pic isolé reste localisé après regroupement (pas étalé sur toutes les barres)', () => {
    const fine = makeFine(96, (i) => (i === 50 ? 100 : 0));
    const bars = groupBinsIntoBars(fine, 32);
    const nonZero = Array.from(bars).filter((v) => v > 0);
    expect(nonZero.length).toBeLessThanOrEqual(2); // au plus 2 barres voisines touchées par l'arrondi de frontière
    expect(bars.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('barCount borné à au moins 1 même si demandé à 0 ou négatif', () => {
    const fine = makeFine(96, () => 1);
    expect(groupBinsIntoBars(fine, 0).length).toBe(1);
    expect(groupBinsIntoBars(fine, -5).length).toBe(1);
  });

  it('barCount borné au nombre de bins source même si demandé plus grand', () => {
    const fine = makeFine(96, () => 1);
    expect(groupBinsIntoBars(fine, 500).length).toBe(96);
  });
});
