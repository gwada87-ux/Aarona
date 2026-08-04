import { describe, expect, it } from 'vitest';
import { createMulberry32 } from '../../src/core/rng/mulberry32';
import { hash } from '../../src/core/rng/hash';

describe('mulberry32 — PRNG seedé (Loi 1)', () => {
  it('même seed → même suite de tirages', () => {
    const a = createMulberry32(42);
    const b = createMulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('seeds différentes → suites différentes', () => {
    const a = createMulberry32(1);
    const b = createMulberry32(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("reseed() redémarre la suite de façon déterministe, indépendamment des tirages déjà consommés", () => {
    const rng = createMulberry32(7);
    rng.next();
    rng.next();
    rng.next();
    rng.reseed(99);
    const afterReseed = rng.next();

    const fresh = createMulberry32(99);
    expect(afterReseed).toBe(fresh.next());
  });

  it('toutes les valeurs sont dans [0, 1)', () => {
    const rng = createMulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('hash(projectSeed, stepIndex) — graine par sous-pas', () => {
  it('projectSeed influence la graine (sinon "Nouvelle variante" ne changerait rien)', () => {
    expect(hash(1, 100)).not.toBe(hash(2, 100));
  });

  it('stepIndex influence la graine (sinon un seek ne changerait rien)', () => {
    expect(hash(1, 100)).not.toBe(hash(1, 101));
  });

  it('est pure : même entrée → même sortie', () => {
    expect(hash(42, 999)).toBe(hash(42, 999));
  });

  it('alimente correctement mulberry32 via reseed', () => {
    const stepIndex = Math.round(2.0 * 120);
    const seedA = hash(7, stepIndex);
    const seedB = hash(7, stepIndex);
    const rngA = createMulberry32(seedA);
    const rngB = createMulberry32(seedB);
    expect(rngA.next()).toBe(rngB.next());
  });
});
