/**
 * Orchestration du canal de verite (ADR-012, lots 1 et 2) : le seul module qui
 * traduit l'etat du canal en autorite sur `BeatClock` et sur les onsets vus
 * par le rendu.
 *
 * Cycle par trame (`step`), appele par `LiveVisualPanel` juste apres
 * `engine.step()` :
 *
 *   1. kick DETECTE depuis la derniere trame -> tentative d'appariement
 *      (aligneur). La detection est surveillee sur `onsets.lastTime`, pas sur
 *      `firedThisFrame` : en mode verite-evenements, les drapeaux `fired`
 *      appartiennent aux annonces, plus au detecteur.
 *   2. canal vivant + tempo connu + aligneur converge -> mode verite :
 *      periode et ancre de phase imposees a `BeatClock` (glissees, jamais
 *      seches), downbeat ancre, et TIR des evenements annonces (lot 2) a
 *      l'instant VISUEL exact : tFire = (tHost + offset) - syncOffset. C'est
 *      la meme convention que `visualBeatPhase` - l'image frappe quand
 *      l'oreille entend, pas quand l'analyse voit. L'anticipation du
 *      scheduler hote (annonce ~100 ms avant le son) est ce qui rend ce tir
 *      possible sans aucune latence de detection.
 *   3. sinon -> `clearTruth()` + retour des onsets au detecteur. Le PLL n'a
 *      jamais cesse d'etre alimente, la bascule est sans a-coup.
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
  /** Evenements annonces reellement tires (diagnostic, affiche au HUD). */
  firedCount = 0;
  /** Evenements annonces perimes ou depasses, jetes sans tir (diagnostic). */
  droppedCount = 0;

  private eventCursor = 0;
  private prevDetectedKickT = Number.NEGATIVE_INFINITY;

  constructor(private readonly config: LiveTruthConfig) {
    this.channel = new TruthChannel(config);
    this.aligner = new ClockAligner(config);
  }

  /** Message brut du transport (DataChannel, postMessage ou banc synthetique). */
  ingest(tLocalArrival: number, raw: unknown): TruthIngestResult {
    return this.channel.ingest(tLocalArrival, raw);
  }

  step(tLocalNow: number, engine: LiveAnalysisEngine): void {
    if (this.channel.takeReset()) {
      this.aligner.reset();
      this.eventCursor = this.channel.eventSeq;
    }

    // Alimentation de l'aligneur : tout kick DETECTE depuis la derniere
    // trame, lu directement sur le detecteur (independant des drapeaux
    // `fired`, qui appartiennent a la verite quand elle est active).
    const tKick = engine.onsets.lastTime('kick');
    if (Number.isFinite(tKick) && tKick !== this.prevDetectedKickT) {
      this.prevDetectedKickT = tKick;
      this.aligner.noteDetectedKick(tKick, this.channel);
    }

    const shouldBeActive =
      this.channel.alive(tLocalNow) &&
      this.channel.tempoBpm > 0 &&
      Number.isFinite(this.channel.tempoAnchorHost) &&
      this.aligner.converged;

    if (shouldBeActive) {
      const wasActive = this.active;
      const periodSec = 60 / this.channel.tempoBpm;
      engine.beat.setTruthGrid(periodSec, this.channel.tempoAnchorHost + this.aligner.offsetSec, tLocalNow);
      // `setTruthGrid` peut refuser (tap tempo manuel actif) : l'etat suit
      // l'horloge, pas l'intention.
      this.active = engine.beat.truthActive;
      if (this.active && Number.isFinite(this.channel.lastDownbeatHost)) {
        engine.beat.truthDownbeatAt(this.channel.lastDownbeatHost + this.aligner.offsetSec);
      }
      engine.setTruthEvents(this.active);
      if (this.active) {
        // A l'ACTIVATION, la file contient les annonces de la periode
        // d'acquisition : les tirer d'un coup ferait une rafale de rattrapage.
        // On saute tout ce qui est deja du, on ne tire que l'avenir.
        this.fireDueEvents(tLocalNow, engine, !wasActive);
      }
    } else if (this.active) {
      engine.beat.clearTruth();
      engine.setTruthEvents(false);
      // La file en attente ne survit pas au repli : la retirer d'un coup
      // evite une rafale de tirs perimes a la reactivation.
      this.eventCursor = this.channel.eventSeq;
      this.active = false;
    }
  }

  /**
   * Tire les evenements annonces dont l'instant VISUEL est atteint.
   * Convention de `BeatClock` : un temps a l'instant d'analyse tBeat est
   * AFFICHE a tBeat - syncOffset. Les evenements suivent la meme regle.
   */
  private fireDueEvents(tLocalNow: number, engine: LiveAnalysisEngine, skipDue: boolean): void {
    const ch = this.channel;
    if (this.eventCursor < ch.eventSeqFloor) {
      // Le ring a tourne plus vite que la consommation (onglet cache) : ce
      // qui est perdu est perdu, on repart du plus ancien disponible.
      this.droppedCount += ch.eventSeqFloor - this.eventCursor;
      this.eventCursor = ch.eventSeqFloor;
    }
    const syncSec = engine.beat.sync.totalMs / 1000;
    while (this.eventCursor < ch.eventSeq) {
      const seq = this.eventCursor;
      const tFire = ch.eventHostTimeAt(seq) + this.aligner.offsetSec - syncSec;
      if (tFire > tLocalNow) break;
      this.eventCursor++;
      if (skipDue || tLocalNow - tFire > this.config.fireMaxLateSec) {
        this.droppedCount++;
        continue;
      }
      engine.fireTruth(ch.eventKindAt(seq), tFire, ch.eventVelAt(seq));
      this.firedCount++;
    }
  }
}
