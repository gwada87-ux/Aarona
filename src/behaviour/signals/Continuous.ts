/**
 * Continuous — suivi lissé d'une courbe, lissage asymétrique
 * (docs/07_VISUAL_ENGINE.md §"Continuous — lissage asymétrique").
 * Alimente drive/weight/brightness depuis les `FeatureTracks`.
 */
export class Continuous {
  private v = 0;

  constructor(
    private readonly riseTau: number,
    private readonly fallTau: number,
  ) {}

  /** Montée rapide, descente lente (ou l'inverse selon les taux) : imite un VU-mètre. */
  update(target: number, dt: number): void {
    const tau = target > this.v ? this.riseTau : this.fallTau;
    this.v += (target - this.v) * (1 - Math.exp(-dt / tau));
  }

  get value(): number {
    return this.v;
  }

  /**
   * Ajouté à la classe illustrée par docs/07 : requis par
   * `BehaviourEngine.reset(t)` (docs/02 §Seek), qui doit ramener chaque
   * `Continuous` à sa valeur d'équilibre pour le nouveau `t` — PAS à zéro,
   * contrairement à `Impulse`. `v` saute directement à `target` : le
   * rattrapage par sous-pas qui suit un seek court (0,15 s) est plus bref
   * que certains `fallTau` (ex. `weight` à 0,30 s) et sous-évaluerait sinon
   * la valeur réelle.
   */
  reset(target: number): void {
    this.v = target;
  }
}
