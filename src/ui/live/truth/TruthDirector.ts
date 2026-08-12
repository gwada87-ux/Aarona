/**
 * Orchestration du canal de verite (ADR-012, lot 1) : le seul module qui
 * traduit l'etat du canal en autorite sur `BeatClock`.
 *
 * Cycle par trame (`step`), appele par `LiveVisualPanel` juste apres
 * `engine.step()` :
 *
 *   1. kick detecte cette trame -> tentative d'appariement (aligneur) ;
 *   2. canal vivant + tempo connu + aligneur converge -> mode verite :
 *      periode et ancre de phase imposees a `BeatClock` - glissees, jamais
 *      seches, `resyncMaxJumpMs` borne chaque trame - et downbeat ancre ;
 *   3. sinon -> `clearTruth()`, le PLL reprend la ou il en est. Il n'a jamais
 *      cesse d'etre alimente en arriere-plan (onsets, estimateur de tempo,
 *      historique de kicks), la bascule est donc sans a-coup.
 *
 * Le tap tempo manuel garde la main sur la verite : operateur > hote > PLL.
 */

import type { LiveAnalysisEngine } from '../audio/LiveAnalysisEngine';
import type { LiveTruthConfig } from '../LiveConfig';
import { ClockAligner } from './ClockAligner';
import { TruthChannel, type TruthIngestResult } from './TruthChannel';

export class TruthDirector {
  readonly channel: TruthChannel;
  readonly aligner: ClockAligner;
  /** Le mode verite pilote-t-il l'horloge en ce moment ? */
  active = false;

  constructor(config: LiveTruthConfig) {
    this.channel = new TruthChannel(config);
    this.aligner = new ClockAligner(config);
  }

  /** Message brut du transport (DataChannel, postMessage ou banc synthetique). */
  ingest(tLocalArrival: number, raw: unknown): TruthIngestResult {
    return this.channel.ingest(tLocalArrival, raw);
  }

  step(tLocalNow: number, engine: LiveAnalysisEngine): void {
    if (this.channel.takeReset()) this.aligner.reset();

    if (engine.firedThisFrame('kick')) {
      const tKick = engine.onsets.lastTime('kick');
      if (Number.isFinite(tKick)) this.aligner.noteDetectedKick(tKick, this.channel);
    }

    const shouldBeActive =
      this.channel.alive(tLocalNow) &&
      this.channel.tempoBpm > 0 &&
      Number.isFinite(this.channel.tempoAnchorHost) &&
      this.aligner.converged;

    if (shouldBeActive) {
      const periodSec = 60 / this.channel.tempoBpm;
      engine.beat.setTruthGrid(periodSec, this.channel.tempoAnchorHost + this.aligner.offsetSec, tLocalNow);
      // `setTruthGrid` peut refuser (tap tempo manuel actif) : l'etat suit
      // l'horloge, pas l'intention.
      this.active = engine.beat.truthActive;
      if (this.active && Number.isFinite(this.channel.lastDownbeatHost)) {
        engine.beat.truthDownbeatAt(this.channel.lastDownbeatHost + this.aligner.offsetSec);
      }
    } else if (this.active) {
      engine.beat.clearTruth();
      this.active = false;
    }
  }
}
