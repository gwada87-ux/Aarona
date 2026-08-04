/**
 * Simulation à pas fixe avec accumulateur (Loi 1). Le reliquat n'est pas
 * simulé, il est reporté à l'appel suivant — c'est ce qui garantit que le
 * nombre total de pas sur une durée donnée ne dépend pas du découpage en
 * `dt` (60 fps, 30 fps, scrub irrégulier...).
 */
export const FIXED_DT = 1 / 120;

export class FixedStep {
  private accumulator = 0;

  constructor(private readonly dt: number = FIXED_DT) {}

  /** Ajoute `deltaTime` et retourne le nombre de pas fixes à simuler. */
  advance(deltaTime: number): number {
    this.accumulator += deltaTime;
    const steps = Math.floor(this.accumulator / this.dt);
    this.accumulator -= steps * this.dt;
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
