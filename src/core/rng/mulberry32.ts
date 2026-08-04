/**
 * PRNG seedé (Loi 1 — docs/02_ARCHITECTURE.md).
 * `reseed` permet de repartir d'une graine connue sans recréer l'objet :
 * c'est ce qui permet `rng.reseed(hash(projectSeed, stepIndex))` à chaque
 * sous-pas, y compris pendant un rattrapage de seek.
 */
export interface Rng {
  /** Tirage suivant dans [0, 1). */
  next(): number;
  /** Réinitialise la suite à partir d'une graine 32 bits. */
  reseed(seed: number): void;
}

export function createMulberry32(seed: number): Rng {
  let a = seed >>> 0;

  return {
    next(): number {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    reseed(newSeed: number): void {
      a = newSeed >>> 0;
    },
  };
}
