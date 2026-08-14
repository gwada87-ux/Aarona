/**
 * PARTITION DE PLANS — le morceau écrit son storyboard
 * (docs/18_BLUEPRINT_VISUELS_2026.md §F3, chantier P0 n°3, TOP 10 n°3).
 *
 * LE PROBLÈME QU'IL RÉSOUT
 * -----------------------
 * Constat F3 de l'audit : « le `VisualDirector` module intensité/caméra mais
 * pas la COMPOSITION : pas de changement de point de vue entre section A et
 * section B ». Le mode fichier connaît le FUTUR — avantage structurel qu'aucun
 * outil temps réel n'a — et ne s'en sert aujourd'hui que pour l'intensité.
 *
 * CE QU'IL FAIT
 * -------------
 * Il lit la STRUCTURE du morceau (les sections et leurs lettres de répétition)
 * et en dérive une suite de PLANS : un point de vue par identité de section,
 * et des coupes quantifiées sur les temps forts.
 *
 * CE QU'IL NE FAIT PAS, ET POURQUOI
 * ---------------------------------
 * Il ne touche PAS aux variantes de style (`presets/styleVariants.ts`), alors
 * que le blueprint les cite. Mesure faite le 13/08 en diagnostiquant une
 * régression signalée par Aaron : à morceau et macros identiques, changer de
 * variante déplace de **37 %** l'écart-type de luminance sur un temps — la
 * sensation de « punch ». Les variantes vont jusqu'à 0,17 de décalage et 1,30
 * de zoom, et l'une d'elles impose un mode de fusion. Les commuter à chaque
 * frontière de section ferait varier le punch EN COURS DE MORCEAU.
 *
 * Ce module reste donc sur le levier que `VisualDirector` utilisait déjà :
 * un décalage de caméra de l'ordre de `REFRAME` (0,05) et un zoom au plus à
 * 1,07. Même famille d'effet, même ordre de grandeur, aucun mode de fusion.
 * Le « motif de couche alterné » de §F3 (allumer/éteindre des couches selon la
 * section) est écarté pour la même raison : il change la composition, donc le
 * punch. À reprendre quand la régression du 13/08 sera expliquée.
 *
 * LA MÉMOIRE DE MISE EN SCÈNE — ET LE CHOIX QU'ELLE RENVERSE
 * ---------------------------------------------------------
 * §F3 demande « A→variante 1, B→variante 2, répétition A→variante 1 ramenée ».
 * Le plan est donc indexé sur l'IDENTITÉ de la section — sa lettre — et non sur
 * son instant de début.
 *
 * C'est l'INVERSE du choix en place. `VisualDirector.sectionKey(startSec,
 * letter)` fait entrer l'instant de début dans le calcul, et son commentaire
 * l'assume : « c'est ce qui fait qu'un refrain revenu ne se lit pas comme une
 * copie du précédent ». Les deux paris sont défendables ; celui du blueprint
 * est celui du montage — un refrain qui revient ramène son plan, et c'est ce
 * qui fait qu'une vidéo se lit comme composée plutôt que comme tirée au sort.
 * Le drapeau `SECTION_STAGING_V1` permet de revenir à l'autre en une ligne.
 *
 * DÉTERMINISME (Loi 1)
 * --------------------
 * Aucun état. La partition est construite une fois depuis la timeline, et
 * `shotAt(t)` est une fonction pure de `t`. Rejouer, sauter, exporter donnent
 * la même suite de plans.
 */
import type { MusicTimeline } from '../music/MusicTimeline';
import type { Section } from '../music/pmdi';

/**
 * Drapeau du chantier. À `false`, `VisualDirector` garde le recadrage par
 * `sectionKey` — le comportement d'avant ce chantier, à l'identique.
 */
export const SECTION_STAGING_V1 = true;

export interface Shot {
  /** Numéro de plan, stable par identité de section. Pour le HUD et les tests. */
  readonly index: number;
  /** Décalage du point de vue, en coordonnées normalisées (Loi 4). */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Rapprochement, toujours >= 1 (le `Renderer` borne à [1,2], ADR-011). */
  readonly zoom: number;
}

/**
 * Table des plans. Quatre suffisent : au-delà de quatre sections DISTINCTES, un
 * morceau ne se lit plus comme une structure mais comme une suite, et le
 * cinquième plan ne se remarquerait pas.
 *
 * Amplitudes calées sur `REFRAME` (0,05), la valeur déjà en service — ce
 * chantier change QUELLE section reçoit quel décalage, pas la force du geste.
 * Le plan 0 est neutre : la première section entendue, le plus souvent une
 * intro, garde le cadre franc.
 */
export const SHOTS: readonly Shot[] = Object.freeze([
  Object.freeze({ index: 0, offsetX: 0, offsetY: 0, zoom: 1 }),
  Object.freeze({ index: 1, offsetX: 0.055, offsetY: -0.03, zoom: 1.05 }),
  Object.freeze({ index: 2, offsetX: -0.05, offsetY: 0.035, zoom: 1.03 }),
  Object.freeze({ index: 3, offsetX: 0.028, offsetY: 0.05, zoom: 1.07 }),
]);

/** Plan par défaut, hors de toute section. Identique au plan 0 : cadre franc. */
export const NEUTRAL_SHOT: Shot = SHOTS[0]!;

/**
 * Identité d'une section. La lettre de répétition quand l'analyse en a trouvé
 * une — c'est elle qui porte « le refrain revient ». À défaut, le rang de la
 * section, ce qui redonne un plan par section et donc le comportement le plus
 * proche de l'ancien.
 */
function identityOf(section: Section, rank: number): string {
  return section.letter ?? `#${rank}`;
}

interface Cut {
  /** Instant de la coupe, quantifié au temps fort le plus proche. */
  readonly t: number;
  readonly shot: Shot;
}

export interface SectionScore {
  /** Plan à l'instant `t`. Jamais nul. */
  shotAt(t: number): Shot;
  /** Coupes, dans l'ordre. Pour le HUD, les tests et le rapport. */
  readonly cuts: readonly Cut[];
  /** Nombre de plans DISTINCTS réellement utilisés. */
  readonly distinctShots: number;
}

/**
 * Quantifie une frontière sur le temps fort le PLUS PROCHE.
 *
 * Les frontières de section viennent de l'analyse et ne tombent pas
 * nécessairement sur un temps fort ; une coupe à contretemps se lit comme un
 * accroc, jamais comme une intention. On prend le plus proche et non le suivant
 * : une section détectée 80 ms trop tard ne doit pas décaler son plan d'une
 * mesure entière.
 *
 * Sans DOWNBEAT dans la timeline (grille absente ou peu fiable), la frontière
 * brute est gardée telle quelle — mieux vaut une coupe non quantifiée qu'une
 * coupe déplacée au hasard.
 */
function quantize(timeline: MusicTimeline, t: number): number {
  const prev = timeline.prevEventOfType('DOWNBEAT', t);
  const next = timeline.nextEventOfType('DOWNBEAT', t);
  if (!prev && !next) return t;
  if (!prev) return next!.t;
  if (!next) return prev.t;
  return t - prev.t <= next.t - t ? prev.t : next.t;
}

/**
 * Construit la partition depuis la timeline. À appeler UNE FOIS par director :
 * la construction lit toutes les sections et fait deux recherches binaires par
 * frontière, ce qui est négligeable une fois et gaspillé par image.
 */
export function buildSectionScore(timeline: MusicTimeline): SectionScore {
  const sections = timeline.sections();
  const shotByIdentity = new Map<string, Shot>();
  const cuts: Cut[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const identity = identityOf(section, i);
    let shot = shotByIdentity.get(identity);
    if (shot === undefined) {
      // Les identités reçoivent leur plan dans l'ORDRE D'APPARITION, pas par la
      // valeur de la lettre : un morceau dont l'analyse nomme la première
      // section « B » doit quand même commencer sur le plan neutre.
      shot = SHOTS[shotByIdentity.size % SHOTS.length]!;
      shotByIdentity.set(identity, shot);
    }
    const t = quantize(timeline, section.t);
    // Une coupe quantifiée peut tomber AVANT la précédente si deux sections
    // très courtes se partagent le même temps fort. On garde la dernière : la
    // section la plus récente est celle qu'on entend.
    if (cuts.length > 0 && t <= cuts[cuts.length - 1]!.t) cuts[cuts.length - 1] = { t, shot };
    else cuts.push({ t, shot });
  }

  const frozen = Object.freeze(cuts.map((c) => Object.freeze(c)));

  return Object.freeze({
    cuts: frozen,
    distinctShots: shotByIdentity.size,
    shotAt(t: number): Shot {
      // Recherche linéaire à rebours : une partition compte quelques unités de
      // coupes, jamais des milliers. Une recherche binaire coûterait plus en
      // lisibilité qu'elle ne rapporterait ici.
      for (let i = frozen.length - 1; i >= 0; i--) {
        if (t >= frozen[i]!.t) return frozen[i]!.shot;
      }
      return NEUTRAL_SHOT;
    },
  });
}
