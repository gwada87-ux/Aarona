/**
 * Tests de `core/math/percentile.ts` — Étape 41. `percentile()`/`median()`
 * ne sont exercées qu'INDIRECTEMENT par `analysis/normalize.ts` (p=0,05/
 * 0,95 fixes, jamais les cas limites) — repéré par le 4e audit de couverture
 * (le 3e, couches visuelles/harnais, s'est achevé à l'Étape 40).
 */
import { describe, expect, it } from 'vitest';
import { percentile, median } from '../../src/core/math/percentile';

describe('percentile — cas limites (n=0, n=1)', () => {
  it('tableau vide : renvoie 0 quel que soit p', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([], 0)).toBe(0);
    expect(percentile([], 1)).toBe(0);
  });

  it('un seul élément : le renvoie tel quel, quel que soit p', () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });
});

describe('percentile — bornes p (clamp [0,1])', () => {
  const data = [5, 1, 4, 2, 3]; // non trié en entrée, volontairement

  it('p=0 : renvoie le minimum (après tri interne)', () => {
    expect(percentile(data, 0)).toBe(1);
  });

  it('p=1 : renvoie le maximum', () => {
    expect(percentile(data, 1)).toBe(5);
  });

  it('p<0 : clampé à 0, même résultat que p=0', () => {
    expect(percentile(data, -3)).toBe(percentile(data, 0));
  });

  it('p>1 : clampé à 1, même résultat que p=1', () => {
    expect(percentile(data, 7)).toBe(percentile(data, 1));
  });
});

describe('percentile — interpolation linéaire entre rangs', () => {
  it('pos entier (aucune interpolation) : n=5, p=0.25 -> pos=1.0 -> sorted[1] exactement', () => {
    expect(percentile([5, 1, 4, 2, 3], 0.25)).toBe(2); // trié : [1,2,3,4,5], index 1 = 2
  });

  it('pos fractionnaire : n=4, p=0.5 -> pos=1.5 -> moyenne de sorted[1] et sorted[2]', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25); // (20+30)/2
  });

  it('interpolation asymétrique (frac != 0.5) donne le poids attendu à chaque borne', () => {
    // n=5 trié [0,10,20,30,40], p=0.3 -> pos=0.3*4=1.2 -> lo=1,hi=2,frac=0.2
    // résultat = 10*(1-0.2) + 20*0.2 = 8+4 = 12
    expect(percentile([40, 0, 20, 30, 10], 0.3)).toBeCloseTo(12, 10);
  });
});

describe('percentile — trie réellement les données (ne suppose pas une entrée triée)', () => {
  it('ordre d\'entrée aléatoire ne change pas le résultat', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = [7, 2, 9, 1, 5, 10, 3, 8, 4, 6];
    expect(percentile(shuffled, 0.5)).toBe(percentile(sorted, 0.5));
  });

  it('ne mute pas le tableau d\'entrée', () => {
    const data = [5, 1, 4, 2, 3];
    const copy = [...data];
    percentile(data, 0.5);
    expect(data).toEqual(copy);
  });
});

describe('median — délègue à percentile(data, 0.5)', () => {
  it('n impair : la valeur centrale exacte', () => {
    expect(median([5, 1, 4, 2, 3])).toBe(3);
  });

  it('n pair : moyenne des deux valeurs centrales', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('identique à percentile(data, 0.5) pour un jeu de données quelconque', () => {
    const data = [8, 3, 9, 1, 6, 2];
    expect(median(data)).toBe(percentile(data, 0.5));
  });
});
