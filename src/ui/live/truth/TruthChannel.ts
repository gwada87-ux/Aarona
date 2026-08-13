/**
 * Canal de verite PMDI en direct (ADR-012, lot 1 : horloge).
 *
 * Recoit les messages `pmdiLive` emis par l'hote (Beat Studio) au moment ou
 * son scheduler PLANIFIE un evenement, jamais au moment ou il sonne. Les
 * horodatages `tHost` sont exprimes sur l'horloge audio de l'HOTE : ils ne
 * sont comparables a rien localement tant que `ClockAligner` n'a pas estime
 * l'offset entre les deux horloges.
 *
 * Regles de doc 12 conservees telles quelles : tolerance a l'inconnu (un
 * `kind` ou un type d'evenement inconnu est compte puis ignore, jamais une
 * erreur), version majeure incompatible rejetee explicitement.
 *
 * Classe pure au sens de section 7 du prompt live : aucun DOM, aucun
 * transport. `ingest()` recoit la chaine (ou l'objet) et l'heure locale
 * d'arrivee ; le DataChannel vit dans `LiveAudioSource`, le cablage dans
 * `LiveVisualPanel`. C'est ce qui rend le canal pilotable par le banc
 * synthetique sans navigateur.
 */

import type { LiveTruthConfig } from '../LiveConfig';
import type { OnsetKind } from '../audio/OnsetDetector';

export type TruthIngestResult = 'accepted' | 'ignored' | 'rejected';

/** Types d'evenements annonces que le rendu sait tirer (lot 2). Un type hors de cette table est transporte mais pas mis en file. */
const FIREABLE: Readonly<Record<string, OnsetKind>> = Object.freeze({
  KICK: 'kick',
  SNARE: 'snare',
  CLAP: 'snare',
  HAT: 'hat',
});
const KIND_CODE: Readonly<Record<OnsetKind, number>> = Object.freeze({ kick: 0, snare: 1, hat: 2 });
const CODE_KIND: readonly OnsetKind[] = Object.freeze(['kick', 'snare', 'hat']);

interface ParsedMessage {
  readonly pmdiLive: string;
  readonly tHost: number;
  readonly payload: Record<string, unknown> & { readonly kind: string };
}

export class TruthChannel {
  /** Instants HOTE des kicks annonces - ring indexe par sequence croissante. */
  private readonly kicks: Float64Array;
  private kickSeq = 0;
  /** File des evenements annonces en attente de tir (lot 2) - trois rings paralleles, indexes par sequence croissante. */
  private readonly eventT: Float64Array;
  private readonly eventKind: Uint8Array;
  private readonly eventVel: Float32Array;
  private eventSeqW = 0;
  /** Ecarts arrivee locale - tHost, pour l'amorce grossiere de l'aligneur. */
  private readonly arrivals: Float64Array;
  private arrivalCount = 0;
  private arrivalIndex = 0;
  private readonly arrivalScratch: Float64Array;

  private lastMessageLocal = Number.NEGATIVE_INFINITY;
  private resetPending = false;

  /** Dernier tempo annonce, en BPM. 0 tant qu'aucun message `tempo` valide n'est arrive. */
  tempoBpm = 0;
  /** Instant HOTE d'un temps de reference (`tBeat` du payload `tempo`). */
  tempoAnchorHost = Number.NaN;
  /** Instant HOTE du dernier downbeat annonce. */
  lastDownbeatHost = Number.NaN;

  /** Compteurs de diagnostic, pour le HUD et les tests. */
  accepted = 0;
  ignored = 0;
  rejected = 0;

  constructor(private readonly config: LiveTruthConfig) {
    this.kicks = new Float64Array(config.announcedRingSize);
    this.arrivals = new Float64Array(config.arrivalRingSize);
    this.arrivalScratch = new Float64Array(config.arrivalRingSize);
    this.eventT = new Float64Array(config.eventRingSize);
    this.eventKind = new Uint8Array(config.eventRingSize);
    this.eventVel = new Float32Array(config.eventRingSize);
  }

  /**
   * Consomme un message brut. `tLocalArrival` est l'heure d'ARRIVEE sur
   * l'horloge audio LOCALE (`audioContext.currentTime`) - la seule base de
   * temps comparable aux onsets detectes.
   */
  ingest(tLocalArrival: number, raw: unknown): TruthIngestResult {
    const msg = this.parse(raw);
    if (!msg) {
      this.rejected++;
      return 'rejected';
    }
    // Version : MAJEUR == 1 accepte, MINEUR superieur tolere (doc 12).
    if (!msg.pmdiLive.startsWith('1.')) {
      this.rejected++;
      return 'rejected';
    }

    this.lastMessageLocal = tLocalArrival;
    this.pushArrival(tLocalArrival - msg.tHost);

    const p = msg.payload;
    switch (p.kind) {
      case 'event': {
        const type = typeof p['type'] === 'string' ? p['type'] : '';
        if (type === 'KICK') this.pushKick(msg.tHost);
        else if (type === 'DOWNBEAT') this.lastDownbeatHost = msg.tHost;
        // Lot 2 : les types que le rendu sait tirer entrent dans la file
        // d'evenements, avec leur velocite REELLE. Un type inconnu est
        // transporte sans erreur (regle 3 de doc 12) mais pas mis en file.
        const kind = FIREABLE[type];
        if (kind !== undefined) {
          const raw = p['intensity'];
          const vel = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.min(1, raw) : 1;
          const i = this.eventSeqW % this.eventT.length;
          this.eventT[i] = msg.tHost;
          this.eventKind[i] = KIND_CODE[kind];
          this.eventVel[i] = vel;
          this.eventSeqW++;
        }
        this.accepted++;
        return 'accepted';
      }
      case 'tempo': {
        const bpm = typeof p['bpm'] === 'number' && Number.isFinite(p['bpm']) && p['bpm'] > 0 ? p['bpm'] : 0;
        const tBeat = typeof p['tBeat'] === 'number' && Number.isFinite(p['tBeat']) ? p['tBeat'] : Number.NaN;
        if (bpm > 0 && Number.isFinite(tBeat)) {
          this.tempoBpm = bpm;
          this.tempoAnchorHost = tBeat;
          this.accepted++;
          return 'accepted';
        }
        this.rejected++;
        return 'rejected';
      }
      case 'heartbeat':
        this.accepted++;
        return 'accepted';
      case 'reset':
        this.resetPending = true;
        this.accepted++;
        return 'accepted';
      default:
        // Tolerance a l'inconnu (doc 12, regle 3) : compte, jamais une erreur.
        this.ignored++;
        return 'ignored';
    }
  }

  /** Le canal a-t-il donne signe de vie recemment ? Tout message valide compte. */
  alive(tLocalNow: number): boolean {
    return tLocalNow - this.lastMessageLocal <= this.config.heartbeatTimeoutSec;
  }

  /** Un `reset` est-il arrive depuis le dernier appel ? Consomme le drapeau. */
  takeReset(): boolean {
    const r = this.resetPending;
    this.resetPending = false;
    return r;
  }

  /** Nombre de kicks annonces encore retenus dans le ring. */
  get announcedCount(): number {
    return Math.min(this.kickSeq, this.kicks.length);
  }

  /** Instant HOTE du i-eme kick retenu, du plus ancien au plus recent. */
  announcedAt(i: number): number {
    const n = this.announcedCount;
    const start = this.kickSeq - n;
    return this.kicks[(start + i) % this.kicks.length]!;
  }

  /** Sequence d'ecriture de la file d'evenements. Le lecteur garde son propre curseur. */
  get eventSeq(): number {
    return this.eventSeqW;
  }

  /** Plus ancienne sequence encore presente dans le ring. */
  get eventSeqFloor(): number {
    return Math.max(0, this.eventSeqW - this.eventT.length);
  }

  eventHostTimeAt(seq: number): number {
    return this.eventT[seq % this.eventT.length]!;
  }

  eventKindAt(seq: number): OnsetKind {
    return CODE_KIND[this.eventKind[seq % this.eventKind.length]!] ?? 'kick';
  }

  eventVelAt(seq: number): number {
    return this.eventVel[seq % this.eventVel.length]!;
  }

  get arrivalSamples(): number {
    return this.arrivalCount;
  }

  /**
   * Mediane des ecarts d'arrivee locale - tHost. C'est une borne INFERIEURE
   * approchee de l'offset reel : l'annonce precede le son du lookahead du
   * scheduler, plus le jitter buffer et le tampon de lecture cote local.
   * Elle ne sert qu'a AMORCER la fenetre d'appariement de `ClockAligner`.
   */
  arrivalOffsetSec(): number {
    const n = this.arrivalCount;
    if (n === 0) return Number.NaN;
    for (let i = 0; i < n; i++) this.arrivalScratch[i] = this.arrivals[i]!;
    const view = this.arrivalScratch.subarray(0, n);
    view.sort();
    return n % 2 === 1 ? view[(n - 1) / 2]! : (view[n / 2 - 1]! + view[n / 2]!) / 2;
  }

  reset(): void {
    this.kickSeq = 0;
    this.eventSeqW = 0;
    this.arrivalCount = 0;
    this.arrivalIndex = 0;
    this.lastMessageLocal = Number.NEGATIVE_INFINITY;
    this.resetPending = false;
    this.tempoBpm = 0;
    this.tempoAnchorHost = Number.NaN;
    this.lastDownbeatHost = Number.NaN;
    this.accepted = 0;
    this.ignored = 0;
    this.rejected = 0;
  }

  private pushKick(tHost: number): void {
    this.kicks[this.kickSeq % this.kicks.length] = tHost;
    this.kickSeq++;
  }

  private pushArrival(d: number): void {
    this.arrivals[this.arrivalIndex] = d;
    this.arrivalIndex = (this.arrivalIndex + 1) % this.arrivals.length;
    if (this.arrivalCount < this.arrivals.length) this.arrivalCount++;
  }

  /** Validation de forme. Une entree non conforme retourne `null`, jamais une exception. */
  private parse(raw: unknown): ParsedMessage | null {
    let value: unknown = raw;
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (typeof value !== 'object' || value === null) return null;
    const m = value as Record<string, unknown>;
    if (typeof m['pmdiLive'] !== 'string') return null;
    if (typeof m['tHost'] !== 'number' || !Number.isFinite(m['tHost'])) return null;
    const payload = m['payload'];
    if (typeof payload !== 'object' || payload === null) return null;
    if (typeof (payload as Record<string, unknown>)['kind'] !== 'string') return null;
    return {
      pmdiLive: m['pmdiLive'],
      tHost: m['tHost'],
      payload: payload as ParsedMessage['payload'],
    };
  }
}
