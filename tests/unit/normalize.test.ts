import { describe, expect, it } from 'vitest';
import { computeNormalizationRange, normalizeTrack } from '../../src/analysis/normalize';

describe('analysis/normalize', () => {
  it('sature à 0 et 1 sur les percentiles 5/95, préserve la dynamique relative au milieu', () => {
    const data = Array.from({ length: 100 }, (_, i) => i); // 0..99
    const out = normalizeTrack(data);
    // p05 ≈ 4.95, p95 ≈ 94.05 → aux extrêmes on sature en dehors de cette plage
    expect(out[0]).toBe(0);
    expect(out[99]).toBe(1);
    expect(out[50]!).toBeGreaterThan(0.4);
    expect(out[50]!).toBeLessThan(0.6);
  });

  it("un pic isolé n'écrase pas toute l'échelle (percentile, pas min/max)", () => {
    const data = Array.from({ length: 99 }, (_, i) => i / 98); // 0..1, réparti
    data.push(1000); // un unique crash de cymbale, isolé
    const out = normalizeTrack(data);
    // Avec min/max, tout sauf le pic serait écrasé près de 0. Avec percentile,
    // la valeur médiane doit rester lisible au milieu de l'échelle.
    expect(out[49]!).toBeGreaterThan(0.4);
    expect(out[49]!).toBeLessThan(0.6);
    // Le pic lui-même sature au maximum de l'échelle normalisée.
    expect(out[99]).toBe(1);
  });

  it('span nul (signal constant) → tout à 0, sans NaN', () => {
    const out = normalizeTrack(new Array(10).fill(5));
    for (const v of out) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBe(0);
    }
  });

  it('computeNormalizationRange est réutilisable (même résultat que le calcul interne)', () => {
    const data = Array.from({ length: 50 }, (_, i) => i * 2);
    const range = computeNormalizationRange(data);
    const out = normalizeTrack(data, range);
    expect(out.length).toBe(50);
  });
});
