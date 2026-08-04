/**
 * Impulse — saut instantané, décroissance exponentielle
 * (docs/07_VISUAL_ENGINE.md §"Impulse — la brique la plus importante").
 * Alimente impact/subImpact/accent/tick/sectionShift.
 */
export class Impulse {
  private v = 0;

  /** `decay` : temps de demi-vie, en secondes. */
  constructor(private readonly decay: number) {}

  /** `max`, jamais `+=` : deux coups rapprochés relancent l'impulsion, ils ne l'additionnent pas. */
  fire(amount: number): void {
    this.v = Math.max(this.v, amount);
  }

  /** Décroissance exponentielle par `dt`, jamais par frame — identique à 30/60/144 fps. */
  update(dt: number): void {
    this.v *= Math.exp((-dt * Math.LN2) / this.decay);
  }

  get value(): number {
    return this.v;
  }

  /**
   * Ajouté à la classe illustrée par docs/07 : requis par
   * `BehaviourEngine.reset(t)` (docs/02 §Seek). Le repos naturel d'une
   * impulsion quand rien n'a déclenché récemment est déjà 0 — contrairement
   * à `Continuous`, ce n'est donc pas une approximation de son équilibre.
   */
  reset(): void {
    this.v = 0;
  }
}
