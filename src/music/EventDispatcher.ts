/**
 * EventDispatcher — consommateur de MusicTimeline, jamais producteur
 * (docs/06_EVENT_SYSTEM.md §"Le dispatcher"). Compare deux instants et
 * retourne la différence : aucun état durable au-delà de `tPrev`, aucun
 * abonné, aucun `EventEmitter`.
 *
 * ⚠️ Appelé une fois PAR SOUS-PAS de simulation (1/120 s), jamais une fois
 * par image — voir docs/02_ARCHITECTURE.md §StepContext.
 */

import type { MusicEvent } from './pmdi';
import type { MusicTimeline } from './MusicTimeline';

/** Au-delà, on ne déverse pas d'un coup tout l'historique manqué (bascule d'onglet, etc.). */
const MAX_WINDOW = 0.25;

const EMPTY: readonly MusicEvent[] = Object.freeze([]);

export class EventDispatcher {
  /**
   * Sentinelle strictement négative (et non 0, contrairement au pseudocode
   * illustratif de docs/06) : `MusicTimeline.eventsBetween` est demi-ouvert
   * (t0, t1], donc un `tPrev` initial à 0 exclurait un événement exactement
   * à t=0 du tout premier `collect()`. Toute valeur de `t` légitime est >= 0,
   * donc -1 ne collisionne jamais avec un temps réel.
   */
  private tPrev = -1;

  constructor(private readonly timeline: MusicTimeline) {}

  /** Appelé une fois par sous-pas, avec la borne haute du sous-pas. */
  collect(t: number): readonly MusicEvent[] {
    if (t < this.tPrev) {
      // seek arrière : aucun événement rejoué, c'est reset()/scene.reset(t) qui gère l'état visuel
      this.tPrev = t;
      return EMPTY;
    }
    if (t - this.tPrev > MAX_WINDOW) {
      this.tPrev = t - MAX_WINDOW;
    }
    const out = this.timeline.eventsBetween(this.tPrev, t);
    this.tPrev = t;
    return out;
  }
}
