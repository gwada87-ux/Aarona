/**
 * Combine la graine du projet et l'index de sous-pas en une graine 32 bits.
 * `seed = hash(projectSeed, stepIndex)`, jamais l'inverse et jamais l'un sans
 * l'autre — voir docs/02_ARCHITECTURE.md §StepContext, tableau des 3 erreurs
 * à éviter (dépendance au fps, graine unique au démarrage, projectSeed oublié).
 */
export function hash(projectSeed: number, stepIndex: number): number {
  let h = (projectSeed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ stepIndex, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
