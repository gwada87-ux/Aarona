/**
 * Estimation de l'offset entre l'horloge audio de l'hote et l'horloge audio
 * locale (ADR-012) : `offset = tLocal - tHost`, l'inconnue unique du canal de
 * verite. Les deux `AudioContext` demarrent a 0 a des instants differents :
 * l'offset peut valoir des minutes, et il derive lentement (quelques ppm).
 *
 * Methode : appariement des kicks ANNONCES (tHost) avec les kicks DETECTES
 * par l'`OnsetDetector` local (tLocal, retro-dates), puis mediane glissante
 * des ecarts apparies. La mediane d'un ring glissant EST le suivi lent de
 * derive demande par l'ADR - pas de second estimateur.
 *
 * Amorce : avant convergence, la fenetre d'appariement part de la mediane des
 * ecarts d'ARRIVEE des messages (l'annonce precede le son du lookahead du
 * scheduler) et s'etend de `maxPipelineDelaySec` (lookahead + jitter buffer
 * WebRTC + tampon de lecture).
 *
 * Ambiguite : si PLUSIEURS kicks annonces tombent dans la fenetre, la paire
 * est JETEE plutot qu'arbitree - un appariement faux biaise la mediane, un
 * appariement manque ne coute qu'un peu de temps de convergence. Aux tempi
 * extremes (200 BPM : periode 0,3 s < fenetre 0,35 s), l'acquisition ne
 * retient donc que les kicks non repetes ; elle est plus lente, jamais fausse.
 *
 * La verite n'a d'autorite qu'alignee : `converged` ne passe a vrai qu'avec
 * au moins `adoptMinPairs` paires et une dispersion MAD sous `adoptMaxMadMs`.
 * Si la dispersion depasse `dropMadMs` (horloge qui a saute, session hote
 * rechargee), tout est jete et l'acquisition recommence - le repli PLL prend
 * le relais pendant ce temps.
 */

import type { LiveTruthConfig } from '../LiveConfig';
import type { TruthChannel } from './TruthChannel';

export class ClockAligner {
  private readonly pairs: Float64Array;
  private pairCount = 0;
  private pairIndex = 0;
  private readonly scratch: Float64Array;

  /** Offset estime `tLocal - tHost`, en secondes. NaN tant qu'aucune paire. */
  offsetSec = Number.NaN;
  /** L'estimation a-t-elle l'autorite requise par l'ADR-012 ? */
  converged = false;
  /** Dispersion MAD des paires retenues, en ms. */
  madMs = Number.POSITIVE_INFINITY;
  /** Kicks detectes jetes pour cause d'ambiguite d'appariement (diagnostic). */
  ambiguousSkips = 0;

  /** Nombre de paires actuellement retenues (diagnostic, affiche au HUD). */
  get matchedPairs(): number {
    return this.pairCount;
  }

  constructor(private readonly config: LiveTruthConfig) {
    this.pairs = new Float64Array(config.pairRingSize);
    this.scratch = new Float64Array(config.pairRingSize);
  }

  /**
   * Tentative d'appariement d'un kick detecte localement a `tLocal` (temps
   * audio local, retro-date par l'`OnsetDetector`) avec un kick annonce.
   */
  noteDetectedKick(tLocal: number, channel: TruthChannel): void {
    if (channel.arrivalSamples < this.config.arrivalMinSamples) return;
    let lo: number;
    let hi: number;
    if (this.converged) {
      const w = this.config.trackWindowMs / 1000;
      lo = this.offsetSec - w;
      hi = this.offsetSec + w;
    } else {
      const arr = channel.arrivalOffsetSec();
      if (!Number.isFinite(arr)) return;
      // Petite marge negative : l'arrivee est relevee a la trame suivante,
      // cette quantification peut placer l'annonce APRES le son sur un
      // message emis tres tard dans le lookahead.
      lo = arr - 0.03;
      hi = arr + this.config.maxPipelineDelaySec;
    }

    let found = 0;
    let d = 0;
    const n = channel.announcedCount;
    for (let i = 0; i < n; i++) {
      const cand = tLocal - channel.announcedAt(i);
      if (cand >= lo && cand <= hi) {
        found++;
        d = cand;
      }
    }
    if (found !== 1) {
      if (found > 1) this.ambiguousSkips++;
      return;
    }

    this.pairs[this.pairIndex] = d;
    this.pairIndex = (this.pairIndex + 1) % this.pairs.length;
    if (this.pairCount < this.pairs.length) this.pairCount++;
    this.evaluate();
  }

  reset(): void {
    this.pairCount = 0;
    this.pairIndex = 0;
    this.offsetSec = Number.NaN;
    this.converged = false;
    this.madMs = Number.POSITIVE_INFINITY;
  }

  /** Mediane + MAD du ring de paires. n <= `pairRingSize` (24) : le tri est negligeable, ~2 appels/s. */
  private evaluate(): void {
    const n = this.pairCount;
    const view = this.scratch.subarray(0, n);
    for (let i = 0; i < n; i++) this.scratch[i] = this.pairs[i]!;
    view.sort();
    const median = n % 2 === 1 ? view[(n - 1) / 2]! : (view[n / 2 - 1]! + view[n / 2]!) / 2;
    for (let i = 0; i < n; i++) this.scratch[i] = Math.abs(this.pairs[i]! - median);
    view.sort();
    const mad = n % 2 === 1 ? view[(n - 1) / 2]! : (view[n / 2 - 1]! + view[n / 2]!) / 2;

    this.offsetSec = median;
    this.madMs = mad * 1000;
    if (!this.converged) {
      if (n >= this.config.adoptMinPairs && this.madMs <= this.config.adoptMaxMadMs) this.converged = true;
    } else if (this.madMs > this.config.dropMadMs) {
      // Desalignement franc : on ne raccommode pas une grille morte, on
      // recommence l'acquisition. Le repli PLL couvre l'intervalle.
      this.reset();
    }
  }
}
