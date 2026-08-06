/**
 * Grille d'analyse a 50 Hz, decouplee du framerate (§2.1).
 *
 * Pourquoi : le flux spectral depend du pas de temps. Si la trame passe de
 * 16,7 a 33 ms (charge GPU) ou 8,3 ms (ecran 120 Hz), son amplitude change
 * d'un facteur 2 a 4 sans qu'aucun evenement musical n'ait eu lieu. Les seuils
 * et l'autocorrelation deviennent faux, avec de faux onsets a chaque hoquet de
 * framerate. Une enveloppe « a 100 Hz » est de toute facon impossible depuis
 * rAF, qui plafonne a 60 Hz.
 *
 * Cette classe ne fait QUE du reechantillonnage : elle ne stocke pas
 * d'historique. `OnsetDetector` et `TempoEstimator` gardent chacun la fenetre
 * dont ils ont besoin, ce qui evite un ring buffer partage a plusieurs
 * lecteurs de profondeurs differentes.
 *
 * Classe pure : aucun `window`, aucun `performance.now()`. Le temps est
 * toujours un parametre (§7).
 */

export type GridTickHandler = (tickTime: number, values: Float32Array) => void;

export class AnalysisGrid {
  private readonly hop: number;
  private readonly prev: Float32Array;
  private readonly scratch: Float32Array;
  private prevTime = Number.NaN;
  private nextTick = Number.NaN;
  private lastRawTime = Number.NaN;

  constructor(
    private readonly channels: number,
    private readonly hz: number,
    private readonly reanchorSec: number,
  ) {
    this.hop = 1 / hz;
    this.prev = new Float32Array(channels);
    this.scratch = new Float32Array(channels);
  }

  /** Pas de la grille, en secondes. */
  get hopSec(): number {
    return this.hop;
  }

  /** Frequence de la grille, en Hz. */
  get rateHz(): number {
    return this.hz;
  }

  /**
   * Un `AnalyserNode` peut etre lu deux fois sur le meme buffer interne : sur
   * un ecran 144 Hz avec un quantum de 512 echantillons, deux trames lisent le
   * meme contenu et produiraient un flux nul artificiel. Le facteur de
   * normalisation `dt` serait faux dans les deux cas.
   */
  isStale(t: number): boolean {
    return Number.isFinite(this.lastRawTime) && t <= this.lastRawTime;
  }

  /**
   * Combien de pas `push(t, ...)` emettrait-il ? Permet a l'appelant de
   * repartir sur ces pas une grandeur INTEGREE sur la trame (le flux spectral)
   * plutot que de l'interpoler comme une grandeur instantanee.
   */
  pendingTicks(t: number): number {
    if (!Number.isFinite(this.prevTime)) return 0;
    if (t - this.prevTime > this.reanchorSec) return 0;
    if (this.nextTick > t) return 0;
    return Math.floor((t - this.nextTick) / this.hop) + 1;
  }

  /**
   * Ajoute une lecture brute horodatee sur `audioContext.currentTime`.
   * Appelle `onTick` pour chaque pas de grille franchi, dans l'ordre.
   */
  push(t: number, values: Float32Array, onTick: GridTickHandler): void {
    this.lastRawTime = t;

    if (!Number.isFinite(this.prevTime)) {
      this.prev.set(values);
      this.prevTime = t;
      // Grille globale ancree sur des multiples du hop : deux sessions qui
      // demarrent a 0,003 s d'ecart produisent la meme suite d'instants.
      this.nextTick = Math.ceil(t / this.hop) * this.hop;
      return;
    }

    const span = t - this.prevTime;
    if (span > this.reanchorSec) {
      // Trou trop grand (retour d'onglet, throttling) : interpoler sur 2 s
      // fabriquerait des dizaines de faux echantillons. On re-ancre a sec.
      this.prev.set(values);
      this.prevTime = t;
      this.nextTick = Math.ceil(t / this.hop) * this.hop;
      return;
    }

    while (this.nextTick <= t) {
      const frac = span > 0 ? (this.nextTick - this.prevTime) / span : 1;
      for (let c = 0; c < this.channels; c++) {
        const a = this.prev[c] ?? 0;
        const b = values[c] ?? 0;
        this.scratch[c] = a + (b - a) * frac;
      }
      onTick(this.nextTick, this.scratch);
      this.nextTick += this.hop;
    }

    this.prev.set(values);
    this.prevTime = t;
  }

  reset(): void {
    this.prev.fill(0);
    this.scratch.fill(0);
    this.prevTime = Number.NaN;
    this.nextTick = Number.NaN;
    this.lastRawTime = Number.NaN;
  }
}
