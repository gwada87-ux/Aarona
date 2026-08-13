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
import type { NoteSet } from '../scenes/types';

/**
 * Combien de notes une seule trame peut porter. Un accord plaque en croches
 * sur deux pistes en produit une poignee ; 24 laisse une marge confortable
 * sans jamais allouer. Au-dela, les notes surnumeraires sont ignorees : mieux
 * vaut une trame dense tronquee qu'une allocation dans la boucle de rendu.
 */
const NOTE_FRAME_CAP = 24;

class LiveNoteBuffer implements NoteSet {
  private readonly midis = new Float32Array(NOTE_FRAME_CAP);
  private readonly vels = new Float32Array(NOTE_FRAME_CAP);
  private n = 0;

  get count(): number {
    return this.n;
  }

  midi(i: number): number {
    return i >= 0 && i < this.n ? this.midis[i]! : 0;
  }

  velocity(i: number): number {
    return i >= 0 && i < this.n ? this.vels[i]! : 0;
  }

  clear(): void {
    this.n = 0;
  }

  push(midi: number, velocity: number): void {
    if (this.n >= NOTE_FRAME_CAP) return;
    this.midis[this.n] = midi;
    this.vels[this.n] = velocity;
    this.n++;
  }
}

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

  /**
   * Fondamentale de l'accord COURANT (0..11), ou -1 tant qu'aucun accord n'a
   * ete annonce (ADR-015). Un accord s'INSTALLE : il reste courant jusqu'au
   * suivant, contrairement a une frappe qui se tire et retombe.
   */
  chordRoot = -1;
  /**
   * Centre tonal du morceau : le PREMIER accord annonce depuis le dernier
   * `reset`. C'est lui qui met la palette au repos sur sa propre teinte — un
   * morceau en fa# n'a aucune raison de vivre a l'oppose du cercle.
   */
  tonalCenter = -1;
  private chordCursor = 0;

  /**
   * Notes tombees pendant la trame courante (ADR-015, lot 3). Tampon
   * PRE-ALLOUE et reutilise : lire ou remplir cette structure n'alloue rien
   * (docs/10). Vide a chaque trame, y compris hors mode verite — une scene
   * voit donc zero note des que le canal se retire, sans cas particulier.
   */
  readonly notes = new LiveNoteBuffer();
  private noteCursor = 0;

  constructor(private readonly config: LiveTruthConfig) {
    this.channel = new TruthChannel(config);
    this.aligner = new ClockAligner(config);
  }

  /** Message brut du transport (DataChannel, postMessage ou banc synthetique). */
  ingest(tLocalArrival: number, raw: unknown): TruthIngestResult {
    return this.channel.ingest(tLocalArrival, raw);
  }

  step(tLocalNow: number, engine: LiveAnalysisEngine): void {
    // Vide a CHAQUE trame, avant tout : une trame sans verite doit montrer
    // zero note, pas les notes de la trame precedente.
    this.notes.clear();
    if (this.channel.takeReset()) {
      this.aligner.reset();
      this.eventCursor = this.channel.eventSeq;
      // Nouveau morceau : le centre tonal du precedent n'a plus de sens.
      this.chordCursor = this.channel.chordSeq;
      this.chordRoot = -1;
      this.tonalCenter = -1;
      this.noteCursor = this.channel.noteSeq;
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
        this.installDueChords(tLocalNow, engine);
        this.collectDueNotes(tLocalNow, engine, !wasActive);
      }
    } else if (this.active) {
      engine.beat.clearTruth();
      engine.setTruthEvents(false);
      // La file en attente ne survit pas au repli : la retirer d'un coup
      // evite une rafale de tirs perimes a la reactivation.
      this.eventCursor = this.channel.eventSeq;
      // L'harmonie annoncee devient caduque avec l'horloge qui la datait : la
      // couleur revient au repos (en glissant, jamais d'un coup - c'est
      // `PaletteBook` qui tient le fondu). Le CENTRE TONAL, lui, survit : il
      // appartient au morceau, pas a la session de canal, et le reperdre
      // ferait sauter la couleur a chaque micro-coupure.
      this.chordCursor = this.channel.chordSeq;
      this.chordRoot = -1;
      this.noteCursor = this.channel.noteSeq;
      this.active = false;
    }
  }

  /**
   * Rassemble les notes dont l'instant VISUEL est atteint — meme convention
   * que les frappes et les accords. Contrairement a un accord, une note est
   * une IMPULSION : trop en retard, elle est jetee comme une frappe ratee
   * (`fireMaxLateSec`), et la rafale d'activation est sautee. Une note qu'on
   * verrait apparaitre une seconde apres l'avoir entendue serait pire
   * qu'absente.
   */
  private collectDueNotes(tLocalNow: number, engine: LiveAnalysisEngine, skipDue: boolean): void {
    const ch = this.channel;
    if (this.noteCursor < ch.noteSeqFloor) this.noteCursor = ch.noteSeqFloor;
    const syncSec = engine.beat.sync.totalMs / 1000;
    while (this.noteCursor < ch.noteSeq) {
      const seq = this.noteCursor;
      const tFire = ch.noteHostTimeAt(seq) + this.aligner.offsetSec - syncSec;
      if (tFire > tLocalNow) break;
      this.noteCursor++;
      if (skipDue || tLocalNow - tFire > this.config.fireMaxLateSec) continue;
      this.notes.push(ch.noteMidiAt(seq), ch.noteVelAt(seq));
    }
  }

  /**
   * Installe les accords annonces dont l'instant VISUEL est atteint - meme
   * convention que `fireDueEvents` (tInstall = tHost + offset - syncOffset).
   *
   * Deux differences assumees avec les frappes : un accord en RETARD s'installe
   * quand meme (il decrit un etat qui dure, pas une impulsion qu'on raterait),
   * et il n'existe pas de garde anti-rafale a l'activation - installer
   * successivement trois accords perimes en une trame ne produit qu'un seul
   * etat final, le dernier.
   */
  private installDueChords(tLocalNow: number, engine: LiveAnalysisEngine): void {
    const ch = this.channel;
    if (this.chordCursor < ch.chordSeqFloor) this.chordCursor = ch.chordSeqFloor;
    const syncSec = engine.beat.sync.totalMs / 1000;
    while (this.chordCursor < ch.chordSeq) {
      const seq = this.chordCursor;
      if (ch.chordHostTimeAt(seq) + this.aligner.offsetSec - syncSec > tLocalNow) break;
      this.chordCursor++;
      this.chordRoot = ch.chordRootAt(seq);
      // Le premier accord entendu FIXE le centre tonal du morceau.
      if (this.tonalCenter < 0) this.tonalCenter = this.chordRoot;
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
