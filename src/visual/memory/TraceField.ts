/**
 * MÉMOIRE VISUELLE — les événements laissent des traces
 * (docs/18_BLUEPRINT_VISUELS_2026.md §F1 et §E1, chantier P0 n°2, TOP 10 n°2).
 *
 * LE PROBLÈME QU'IL RÉSOUT
 * -----------------------
 * Constat F2 de l'audit : « aucune trace persistante des événements : un kick
 * est un flash, pas une empreinte ; le seul passé visuel est le feedback
 * (uniforme, non sémantique) ». Le monde n'a pas d'histoire, et la répétition
 * se voit. Ici, chaque frappe GRAVE la surface, et l'empreinte décline sur
 * plusieurs MESURES — pas plusieurs secondes : un morceau lent laisse des
 * marques aussi longues qu'un morceau rapide, en nombre de mesures.
 *
 * TROIS FAMILLES D'EMPREINTES
 * ---------------------------
 * | famille  | événements      | vit    | forme                         |
 * |----------|-----------------|--------|-------------------------------|
 * | cratère  | KICK, SUB_HIT   | 8 mes. | creux lumineux, anneau        |
 * | cicatrice| SNARE, CLAP     | 4 mes. | entaille oblique              |
 * | poussière| HAT, PERC       | 2 mes. | point ténu                    |
 *
 * Les autres types (BEAT, BAR, DOWNBEAT, PHRASE, DROP, BUILDUP...) ne gravent
 * rien : ce sont des repères de grille ou des macro-états, pas des frappes. Le
 * DROP qui EFFACE tout (« reset narratif », §E1) appartient au style `sillage`,
 * chantier P2 n°6 — pas à la mémoire elle-même, qui ne fait que décroître.
 *
 * POURQUOI CE N'EST PAS UN SIMPLE TAMPON QUI S'ACCUMULE (Loi 1)
 * ------------------------------------------------------------
 * `primeScene` ne rejoue que `PRIME_SECONDS` = 2 secondes, soit environ UNE
 * mesure à 120 BPM. Un tampon qui ne ferait qu'accumuler au fil des `update()`
 * serait donc VIDE aux trois quarts après un seek, et l'image à 1 min 30
 * dépendrait de la façon dont on y est arrivé — exactement ce que la Loi 1
 * interdit.
 *
 * D'où la mécanique de §F1 : après un `reset(t)`, le champ se RECONSTRUIT en
 * relisant `timeline.eventsBetween(t - horizon, t)`. Même instant, même image,
 * qu'on ait lu le morceau depuis le début ou sauté directement là.
 *
 * Corollaire imposé : la position d'une empreinte ne peut PAS être tirée de
 * `step.rng`. Ce générateur est reseedé par sous-pas ; une empreinte déposée
 * pendant une reconstruction (toutes au même sous-pas) tomberait ailleurs que
 * la même empreinte déposée en lecture continue. La position est donc une
 * fonction PURE de l'événement — son temps quantifié et sa famille — repliée
 * par `hash()`.
 *
 * CE QUE CE CHOIX COÛTE, ASSUMÉ
 * -----------------------------
 * La graine de projet n'entre pas dans la position : « Nouvelle variante » ne
 * redistribue donc pas les empreintes. L'alternative — passer `projectSeed` aux
 * couches — demandait d'ajouter un champ à `LayerInitContext` et de le
 * transmettre aux SEPT appelants de `scene.init()` ; en oublier un donnait une
 * graine nulle, donc la même disposition partout, sans que rien ne le signale.
 * Le jeu n'en valait pas la chandelle pour ce lot. Et l'argument tient aussi
 * sur le fond : une empreinte est le RELEVÉ de ce qui a été joué, pas un
 * habillage tiré au sort. Le cadrage de variante, lui, la recadre déjà.
 *
 * LA LOI 3 EST APPLIQUÉE ICI, ET NULLE PART AILLEURS EN MODE FICHIER
 * -----------------------------------------------------------------
 * `confidenceRamp` implémente la rampe de docs/06_EVENT_SYSTEM.md
 * (`effet = intensity × rampe(confidence)`). Constat fait en écrivant ce
 * module : `BehaviourEngine.update()` fait `fire(event.intensity * gain)`
 * SANS jamais lire `event.confidence` — la rampe de docs/06 n'est appliquée
 * nulle part dans le moteur fichier. La corriger changerait le rendu de tous
 * les styles existants : c'est un lot à part, avec son drapeau. Signalé, pas
 * corrigé ici. Ce module, lui, est neuf : il l'applique dès le départ.
 */
import { hash } from '../../core/rng/hash';
import type { MusicEvent } from '../../music/pmdi';
import type { StepContext } from '../../music/StepContext';

/**
 * Drapeau du chantier. À `false`, aucune couche de traces n'est ajoutée aux
 * styles (`createPulseStyle`, `createFieldStyle`) : la composition des scènes
 * et l'image produite sont celles d'avant ce chantier, à l'identique.
 */
export const TRACE_FIELD_V1 = false; // ETEINT : regression signalee par Aaron, non expliquee. Voir JOURNAL.

export const TRACE_CRATER = 0;
export const TRACE_SCAR = 1;
export const TRACE_DUST = 2;
export type TraceKind = typeof TRACE_CRATER | typeof TRACE_SCAR | typeof TRACE_DUST;

/** Durée de vie par famille, EN MESURES (§E1 : « décline sur 2 à 8 mesures »). */
export const TRACE_LIFE_BARS: Readonly<Record<TraceKind, number>> = Object.freeze({
  [TRACE_CRATER]: 8,
  [TRACE_SCAR]: 4,
  [TRACE_DUST]: 2,
});

const MAX_LIFE_BARS = 8;

/** Capacité du tampon circulaire. Voir `DEFAULT_CAPACITY` pour le dimensionnement. */
const DEFAULT_CAPACITY = 96;

/**
 * Dimensionnement, à 4/4 : cratères 4/mesure × 8 mesures = 32, cicatrices
 * 2/mesure × 4 = 8, poussière 8/mesure × 2 = 16. Environ 56 empreintes vivantes
 * sur un motif ordinaire, 96 laisse la marge d'un roulement de charley. Au-delà,
 * l'anneau écrase la PLUS ANCIENNE, ce qui est le bon comportement : c'est
 * toujours celle qui allait disparaître.
 */

/**
 * Demi-étendue du semis d'empreintes, en coordonnées normalisées (Loi 4 :
 * 1,0 = petit côté, origine au centre). En 16/9 le cadre visible va jusqu'à
 * ±0,889 en x et ±0,5 en y ; ces bornes gardent les empreintes à l'intérieur
 * même sous le zoom de variante le plus serré (1,30) combiné à la dérive de
 * caméra de la dramaturgie.
 */
const SPREAD_X = 0.6;
const SPREAD_Y = 0.34;

/** Familles, par type d'événement. Un type absent ne grave rien. */
const KIND_BY_TYPE: Readonly<Record<string, TraceKind>> = Object.freeze({
  KICK: TRACE_CRATER,
  SUB_HIT: TRACE_CRATER,
  SNARE: TRACE_SCAR,
  CLAP: TRACE_SCAR,
  HAT: TRACE_DUST,
  PERC: TRACE_DUST,
});

/**
 * Rampe de confiance de docs/06_EVENT_SYSTEM.md, à la virgule près :
 * 0 sous 0,60 ; (c - 0,60) / 0,25 entre 0,60 et 0,85 ; 1 au-dessus.
 */
export function confidenceRamp(confidence: number): number {
  if (confidence < 0.6) return 0;
  if (confidence >= 0.85) return 1;
  return (confidence - 0.6) / 0.25;
}

/** Position fractionnaire en mesures — l'unité de vieillissement du champ. */
function barPositionAt(step: StepContext): number {
  return step.bar.index + step.bar.phase;
}

/** [0,1) déterministe, replié sur le temps QUANTIFIÉ de l'événement et un sel. */
function unitHash(quantizedT: number, salt: number): number {
  return hash(quantizedT, salt) / 4294967296;
}

/**
 * Champ de traces d'UNE scène. Zéro allocation après construction : tampon
 * circulaire de tableaux typés parallèles, écrasement de la plus ancienne.
 *
 * Lecture : les consommateurs bouclent sur `count` et lisent les tableaux
 * exposés en lecture seule, puis filtrent par `ageBars()`. Aucune méthode ne
 * rend de tableau ni d'objet : ce champ est lu à chaque image.
 */
export class TraceField {
  readonly kinds: Uint8Array;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  /** Orientation de l'entaille, en radians. Sans objet pour cratère/poussière. */
  readonly angles: Float32Array;
  /** `intensity × rampe(confidence)` — Loi 3, appliquée au dépôt. */
  readonly amplitudes: Float32Array;
  private readonly bornBars: Float32Array;

  private head = 0;
  private liveCount = 0;
  private stale = true;
  private currentBar = 0;

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {
    this.kinds = new Uint8Array(capacity);
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.angles = new Float32Array(capacity);
    this.amplitudes = new Float32Array(capacity);
    this.bornBars = new Float32Array(capacity);
  }

  /** Nombre d'emplacements occupés — dont certains peuvent être périmés, voir `ageBars`. */
  get count(): number {
    return this.liveCount;
  }

  /**
   * Signale qu'un saut a eu lieu : le champ se reconstruira depuis la timeline
   * au prochain `update()`. Appelée depuis `Layer.reset(t)`, qui ne reçoit pas
   * de `StepContext` et ne peut donc pas reconstruire lui-même.
   */
  markStale(): void {
    this.stale = true;
  }

  /**
   * Avance le champ d'un sous-pas. Reconstruit intégralement si un saut vient
   * d'avoir lieu, sinon dépose les événements de ce sous-pas.
   *
   * Les deux chemins sont EXCLUSIFS : la fenêtre de reconstruction se termine à
   * `step.t` inclus, donc elle contient déjà `step.fired`. Déposer les deux
   * doublerait les empreintes de ce sous-pas.
   */
  update(step: StepContext): void {
    this.currentBar = barPositionAt(step);
    if (this.stale) {
      this.stale = false;
      this.rebuild(step);
      return;
    }
    for (let i = 0; i < step.fired.length; i++) this.deposit(step.fired[i]!, this.currentBar);
  }

  /**
   * Âge de l'empreinte `i`, en mesures. Négatif impossible en lecture normale ;
   * `>= TRACE_LIFE_BARS[kind]` signifie « périmée, ne pas dessiner ».
   */
  ageBars(i: number): number {
    return this.currentBar - this.bornBars[i]!;
  }

  /** Reste de vie, 1 au dépôt et 0 à l'extinction. `0` pour une empreinte périmée. */
  remaining(i: number): number {
    const life = TRACE_LIFE_BARS[this.kinds[i]! as TraceKind];
    const age = this.ageBars(i);
    if (age < 0 || age >= life) return 0;
    return 1 - age / life;
  }

  clear(): void {
    this.head = 0;
    this.liveCount = 0;
  }

  /**
   * Reconstruction depuis la timeline (§F1). La fenêtre est prise avec une
   * marge de 50 % : `MAX_LIFE_BARS` mesures converties en secondes au tempo
   * COURANT, alors qu'un morceau à tempo variable a pu être plus lent en
   * arrière. Une empreinte lue en trop est déjà périmée et sera ignorée par
   * `remaining()` — jamais l'inverse, qui produirait un trou visible.
   */
  private rebuild(step: StepContext): void {
    this.clear();
    const bpm = step.timeline.tempoAt(step.t);
    if (!(bpm > 0)) return;
    const secondsPerBar = (4 * 60) / bpm;
    const horizonSec = MAX_LIFE_BARS * secondsPerBar * 1.5;
    const events = step.timeline.eventsBetween(Math.max(0, step.t - horizonSec), step.t);
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (KIND_BY_TYPE[e.type] === undefined) continue;
      // Position en mesures de l'événement lui-même, pas du sous-pas courant :
      // c'est ce qui donne à une empreinte reconstruite exactement l'âge
      // qu'elle aurait eu en lecture continue.
      this.deposit(e, step.timeline.barIndexAt(e.t) + step.timeline.barPhaseAt(e.t));
    }
  }

  private deposit(e: MusicEvent, bornBar: number): void {
    const kind = KIND_BY_TYPE[e.type];
    if (kind === undefined) return;
    const amplitude = e.intensity * confidenceRamp(e.confidence);
    // Loi 3 : sous 0,60 de confiance, contribution NULLE. Une empreinte
    // invisible qui occuperait un emplacement chasserait une vraie.
    if (amplitude <= 0) return;

    const q = Math.round(e.t * 1000) | 0;
    const slot = this.head;
    this.kinds[slot] = kind;
    this.xs[slot] = (unitHash(q, 101 + kind) - 0.5) * 2 * SPREAD_X;
    this.ys[slot] = (unitHash(q, 211 + kind) - 0.5) * 2 * SPREAD_Y;
    this.angles[slot] = unitHash(q, 307 + kind) * Math.PI;
    this.amplitudes[slot] = amplitude;
    this.bornBars[slot] = bornBar;

    this.head = (this.head + 1) % this.capacity;
    if (this.liveCount < this.capacity) this.liveCount++;
  }
}
