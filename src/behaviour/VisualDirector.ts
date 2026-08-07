/**
 * VisualDirector — dramaturgie sur la durée d'un morceau
 * (docs/17_PHASE2_VISUELS.md §6.2 et §6.4, chantier 3).
 *
 * LE DÉFAUT QU'IL CORRIGE
 * -----------------------
 * `step.section` existe depuis toujours dans le `StepContext` — avec son
 * énergie, sa lettre de répétition (A/B/C), son label et sa confiance — et
 * AUCUNE couche ne le lisait. `step.regime` non plus. Un morceau de trois
 * minutes se rendait donc sans la moindre variation structurelle : l'intro, le
 * couplet, la montée, le drop et le breakdown produisaient la même image. C'est
 * la signature amateur la plus reconnaissable, et aucune quantité de nouveaux
 * styles ne l'aurait corrigée.
 *
 * COMMENT IL RESPECTE LA LOI 1
 * ----------------------------
 * `IntensityDirector`, son équivalent du mode live, ACCUMULE : il compte les
 * mesures depuis le drop, mémorise le niveau d'avant, suit une moyenne
 * glissante de luminance. Rien de tout ça n'est permis ici — le rendu doit être
 * une fonction pure de `t`, identique en preview, en scrub et en export.
 *
 * Cette classe n'a donc AUCUN état de dramaturgie. Chaque valeur est recalculée
 * depuis `t` par consultation de la `MusicTimeline`, qui sait regarder en
 * arrière (`prevEventOfType`) comme en avant (`nextEventOfType`). Le seul champ
 * mutable est un objet de travail réutilisé pour éviter d'allouer par pas.
 *
 * TOUT EST COMPTÉ EN MESURES, JAMAIS EN SECONDES
 * ----------------------------------------------
 * « Deux mesures avant le drop » veut dire la même chose à 90 et à 140 BPM ;
 * « quatre secondes avant le drop » ne veut rien dire musicalement. Les
 * positions viennent de `barIndexAt` + `barPhaseAt`, ce qui évite en prime
 * d'avoir à connaître la métrique — l'API de la timeline ne l'expose pas.
 */

import { clamp } from '../core/math/clamp';
import { easeInOutSine, easeInQuad } from '../core/math/easing';
import type { MusicTimeline } from '../music/MusicTimeline';
import type { StepContext } from '../music/StepContext';
import type { VisualSignals } from './BehaviourEngine';

/** Phase dramatique courante. Exposée pour le HUD et pour les tests. */
export type DramaArc = 'intro' | 'build' | 'drop' | 'fallout' | 'breakdown' | 'void' | 'sustain';

export interface DramaBudget {
  /** Multiplicateur des réactions aux frappes, 0-1. Porte la retenue et la retombée. */
  readonly amplitude: number;
  /** Multiplicateur des niveaux continus (drive, weight, brightness), 0-1. */
  readonly level: number;
  /** Décalage de caméra, en coordonnées normalisées (Loi 4). */
  readonly cameraX: number;
  readonly cameraY: number;
  /** Échelle de caméra, bornée à [1, 2] par le `Renderer` (ADR-011). */
  readonly cameraZoom: number;
  readonly arc: DramaArc;
}

/** Durée de l'explosion après un drop, en mesures. */
const EXPLOSION_BARS = 1;
/** Durée de la retombée qui suit, en mesures. */
const FALLOUT_BARS = 2;
/** Niveau de la retombée, en fraction de ce qu'il était AVANT le drop. */
const FALLOUT_RATIO = 0.55;
/** Fenêtre de retenue avant un drop, en mesures. */
const RESTRAINT_BARS = 2;
/** Amplitude minimale atteinte juste avant le drop. */
const RESTRAINT_FLOOR = 0.45;
/** Sous cette énergie de section, on est en breakdown. */
const BREAKDOWN_ENERGY = 0.25;
/** Niveau imposé en breakdown — quasi-noir assumé. */
const BREAKDOWN_LEVEL = 0.18;
/** Niveau d'une intro : sombre, mais nettement plus lisible qu'un breakdown. */
const INTRO_LEVEL = 0.42;
/** Durée du vide avant une frontière de section, en mesures. */
const VOID_BARS = 0.5;
/** Niveau pendant le vide. */
const VOID_LEVEL = 0.3;
/** Amplitude de la dérive de caméra dans les passages calmes, en unités normalisées. */
const DRIFT_CALM = 0.035;
/** Période de la dérive, en mesures. Longue et non entière : elle ne doit pas se caler sur les phrases. */
const DRIFT_BARS = 6.5;
/** Amplitude du recadrage à une frontière de section. */
const REFRAME = 0.05;
/**
 * Poussée maximale atteinte juste avant un drop (ADR-011, chantier 4).
 *
 * 12 % : au-delà, le recadrage devient un effet en soi et vole la vedette au
 * drop qu'il est censé préparer. La poussée doit se sentir sans se voir.
 */
const PUSH_MAX = 0.12;
/** Poussée résiduelle pendant l'explosion, avant relâchement complet. */
const PUSH_DROP = 0.04;
/** Niveau plancher : même en breakdown, l'image ne disparaît jamais complètement. */
const MIN_LEVEL = 0.12;

/** Signaux modulés — même forme que `VisualSignals`, en version mutable interne. */
type MutableSignals = { -readonly [K in keyof VisualSignals]: VisualSignals[K] };

export class VisualDirector {
  /**
   * Objet de travail réutilisé. `CLAUDE.md` interdit d'allouer dans la boucle ;
   * l'appelant ne doit donc PAS conserver la référence rendue par
   * `modulate()` au-delà du pas courant.
   */
  private readonly scratch: MutableSignals = {
    impact: 0,
    subImpact: 0,
    accent: 0,
    tick: 0,
    sectionShift: 0,
    drive: 0,
    weight: 0,
    brightness: 0,
    tension: 0,
    pulse: 0,
    barPulse: 0,
    lfoA: 0,
    lfoB: 0,
    lfoC: 0,
    lfoD: 0,
  };

  private readonly budgetValue: { -readonly [K in keyof DramaBudget]: DramaBudget[K] } = {
    amplitude: 1,
    level: 1,
    cameraX: 0,
    cameraY: 0,
    cameraZoom: 1,
    arc: 'sustain',
  };

  constructor(private readonly timeline: MusicTimeline) {}

  get budget(): DramaBudget {
    return this.budgetValue;
  }

  /** Position musicale continue, en mesures. */
  private barPos(t: number): number {
    return this.timeline.barIndexAt(t) + this.timeline.barPhaseAt(t);
  }

  /**
   * Recalcule le budget pour `t`. Aucun état conservé d'un appel à l'autre :
   * appeler `update(12.48)` donne le même résultat quel que soit ce qui a été
   * calculé avant.
   */
  update(step: StepContext): DramaBudget {
    const t = step.t;
    const barNow = this.barPos(t);
    const section = this.timeline.sectionAt(t);
    const b = this.budgetValue;

    // --- niveau de base : l'énergie de la section -------------------------
    // Écrasé vers le haut : une section à 0,5 d'énergie ne doit pas rendre
    // l'image deux fois moins présente qu'une section à 1, seulement un peu
    // moins. La dramaturgie se joue sur les RUPTURES, pas sur un fondu continu.
    const energy = section ? clamp(section.energy, 0, 1) : 0.6;
    let level = 0.55 + 0.45 * energy;
    let amplitude = 1;
    let arc: DramaArc = 'sustain';

    // --- drop : explosion puis retombée SOUS le niveau d'avant ------------
    const prevDrop = this.timeline.prevEventOfType('DROP', t);
    const barsSinceDrop = prevDrop ? barNow - this.barPos(prevDrop.t) : Number.POSITIVE_INFINITY;
    if (barsSinceDrop >= 0 && barsSinceDrop < EXPLOSION_BARS) {
      arc = 'drop';
      amplitude = 1;
      level = 1;
    } else if (barsSinceDrop >= EXPLOSION_BARS && barsSinceDrop < EXPLOSION_BARS + FALLOUT_BARS) {
      // « L'impact se mesure à la chute qui suit. » Le niveau de référence est
      // celui d'AVANT le drop, relu dans la timeline — pas mémorisé.
      arc = 'fallout';
      const before = this.timeline.sectionAt(prevDrop!.t - 1e-3);
      const beforeLevel = 0.55 + 0.45 * clamp(before ? before.energy : energy, 0, 1);
      const progress = (barsSinceDrop - EXPLOSION_BARS) / FALLOUT_BARS;
      const floor = beforeLevel * FALLOUT_RATIO;
      // `easeInQuad` et non `easeOutCubic` : la retombée doit TENIR bas puis
      // remonter à la fin, pas récupérer immédiatement. Mesuré avec une courbe
      // ease-out, le niveau était revenu à 0,99 au bout de 2,5 mesures alors
      // qu'il valait 0,865 avant le drop — la règle « rester SOUS le niveau
      // d'avant pendant deux mesures » n'était donc pas tenue.
      level = floor + (level - floor) * easeInQuad(progress);
      // Et garantie dure : quelle que soit la courbe, la retombée ne repasse
      // pas au-dessus du niveau d'avant tant que la fenêtre dure. Sans elle,
      // tout réglage ultérieur de la courbe pourrait casser la règle en
      // silence.
      level = Math.min(level, beforeLevel * 0.98);
      amplitude = 0.6 + 0.4 * progress;
    }

    // --- retenue avant l'impact -------------------------------------------
    // Contre-intuitif et c'est le point : si tout monte en même temps que le
    // drop, le drop n'a plus de contraste à franchir.
    const nextDrop = this.timeline.nextEventOfType('DROP', t);
    const barsToDrop = nextDrop ? this.barPos(nextDrop.t) - barNow : Number.POSITIVE_INFINITY;
    let restraint = 1;
    if (arc === 'sustain' && barsToDrop >= 0 && barsToDrop < RESTRAINT_BARS) {
      arc = 'build';
      const closeness = 1 - barsToDrop / RESTRAINT_BARS;
      restraint = 1 - (1 - RESTRAINT_FLOOR) * easeInOutSine(closeness);
      amplitude *= restraint;
    }

    // --- intro / breakdown : deux moments calmes, deux intentions ---------
    // Une intro et un breakdown ont souvent la MÊME énergie et ne racontent pas
    // du tout la même chose : l'une prépare, l'autre effondre. Les confondre
    // ferait démarrer le morceau sur un quasi-noir, alors qu'une intro doit
    // donner envie d'attendre la suite. Ce qui les distingue n'est pas
    // l'énergie mais la POSITION : la première section d'un morceau est une
    // intro, quelle que soit son énergie.
    if (arc === 'sustain' && energy < BREAKDOWN_ENERGY) {
      const first = this.timeline.sections()[0];
      const isIntro = section !== null && first !== undefined && section.t === first.t;
      if (isIntro) {
        arc = 'intro';
        level = Math.min(level, INTRO_LEVEL);
        amplitude *= 0.7;
      } else {
        arc = 'breakdown';
        level = Math.min(level, BREAKDOWN_LEVEL);
        amplitude *= 0.5;
      }
    }

    // --- plancher de vide -------------------------------------------------
    // La demi-mesure qui précède une frontière de section. Position PURE, donc
    // reproductible : c'est aussi l'endroit où un opérateur couperait à la
    // main. Sans respiration, il n'y a pas d'accent.
    if (section) {
      const barsToEnd = this.barPos(section.t + section.dur) - barNow;
      if (arc === 'sustain' && barsToEnd >= 0 && barsToEnd < VOID_BARS) {
        arc = 'void';
        level = Math.min(level, VOID_LEVEL);
        amplitude *= 0.35;
      }
    }

    // --- régime continu (Loi 3) -------------------------------------------
    // Grille peu fiable : la dramaturgie événementielle serait posée à côté de
    // la musique. On garde le niveau, on renonce aux ruptures.
    if (step.regime === 'continuous' && (arc === 'drop' || arc === 'fallout' || arc === 'build')) {
      arc = 'sustain';
      amplitude = 1;
    }

    // --- caméra -----------------------------------------------------------
    // Dérive lente, d'autant plus ample que le passage est calme — un plan qui
    // ne bouge pas du tout pendant trente secondes se lit comme une image
    // figée. Elle se RESSERRE à l'approche du drop, en même temps que la
    // poussée monte : le cadre se fige ET se rapproche.
    const calm = 1 - energy * 0.6;
    const driftAmp = DRIFT_CALM * calm * restraint;
    const phase = (barNow / DRIFT_BARS) * Math.PI * 2;
    // Recadrage par SECTION : constant à l'intérieur d'une section, il ne peut
    // donc pas changer au milieu d'une mesure. La lettre de répétition entre
    // dans le calcul, si bien que les sections A et B ne sont pas cadrées
    // pareil — c'est ce qui fait qu'un refrain revenu ne se lit pas comme une
    // copie du précédent.
    const key = section ? sectionKey(section.t, section.letter) : 0;
    b.cameraX = Math.cos(phase) * driftAmp + Math.cos(key) * REFRAME;
    b.cameraY = Math.sin(phase * 0.7) * driftAmp * 0.6 + Math.sin(key * 1.7) * REFRAME * 0.6;

    // POUSSÉE (ADR-011). Elle monte pendant la montée et se RELÂCHE d'un coup
    // au drop : c'est le relâchement qui produit la sensation d'ouverture, pas
    // la poussée elle-même. La maintenir pendant l'explosion annulerait
    // l'effet — le cadre resterait serré au moment où il doit s'ouvrir.
    let push = 0;
    if (arc === 'build') push = PUSH_MAX * (1 - restraint) / (1 - RESTRAINT_FLOOR);
    else if (arc === 'drop') push = PUSH_DROP;
    b.cameraZoom = 1 + clamp(push, 0, PUSH_MAX);

    b.amplitude = clamp(amplitude, 0, 1);
    b.level = clamp(Math.max(level, MIN_LEVEL), 0, 1);
    b.arc = arc;
    return b;
  }

  /**
   * Applique le budget aux signaux. Les couches n'ont rien à savoir de la
   * dramaturgie : elles réagissent déjà aux signaux, le director ne fait que
   * les doser. C'est ce qui permet d'ajouter toute cette section SANS toucher
   * une seule couche.
   *
   * Ce qui n'est PAS dosé, et pourquoi :
   * - `pulse` / `barPulse` / `lfo*` sont des HORLOGES. Les atténuer ferait
   *   ralentir le mouvement au lieu de le calmer, ce qui se lit comme une
   *   erreur de tempo.
   * - `tension` EST la montée. La réduire pendant la retenue reviendrait à
   *   effacer le signal qui décrit exactement ce moment.
   */
  modulate(signals: VisualSignals, budget: DramaBudget): VisualSignals {
    const s = this.scratch;
    const a = budget.amplitude;
    const l = budget.level;
    s.impact = signals.impact * a;
    s.subImpact = signals.subImpact * a;
    s.accent = signals.accent * a;
    s.tick = signals.tick * a;
    s.sectionShift = signals.sectionShift * a;
    s.drive = signals.drive * l;
    s.weight = signals.weight * l;
    s.brightness = signals.brightness * l;
    s.tension = signals.tension;
    s.pulse = signals.pulse;
    s.barPulse = signals.barPulse;
    s.lfoA = signals.lfoA;
    s.lfoB = signals.lfoB;
    s.lfoC = signals.lfoC;
    s.lfoD = signals.lfoD;
    return s;
  }
}

/**
 * Angle stable et bien réparti par section. Dérivé de l'instant de début et de
 * la lettre : deux sections différentes n'ont pas le même cadrage, et la même
 * section relue donne toujours le même — l'export doit reproduire la preview.
 */
function sectionKey(startSec: number, letter: string | undefined): number {
  const l = letter ? letter.charCodeAt(0) - 65 : 0;
  return (startSec * 0.61803 + l * 2.399963) % (Math.PI * 2);
}
