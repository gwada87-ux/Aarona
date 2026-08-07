/**
 * Accent de GRILLE (§2.7.8, derniere phrase) :
 *
 *   « Les temps faibles et contretemps recoivent un accent reduit (30-50 %)
 *     plutot qu'aucun. »
 *
 * C'est une regle facile a manquer, parce qu'elle est en creux. Un moteur qui
 * ne reagit qu'aux onsets DETECTES laisse les temps faibles a zero : sur un
 * motif ou seuls les temps 1 et 3 portent un kick, les temps 2 et 4 ne
 * produisent rien du tout, et le visuel bat a demi-vitesse alors que l'horloge,
 * elle, est juste. L'accent de grille comble ce creux.
 *
 * Distinction importante avec §2.7.7 (« interdit d'additionner deux enveloppes
 * d'onset sur un meme parametre ») : ceci n'est PAS une enveloppe d'onset.
 * C'est l'horloge. Une scene l'utilise comme PLANCHER - `max(onset, grille)` -
 * jamais comme terme d'une somme.
 *
 * Fonctions pures.
 *
 * hot-path (§8.9) - appelees plusieurs fois par scene et par trame.
 */

import { impact } from './easing';

/**
 * Durees de RETOUR AU REPOS par canal, en temps musicaux. Partagees par toutes
 * les scenes : deux scenes qui reagissent au meme kick avec des decroissances
 * differentes se lisent comme deux tempos differents pendant un fondu.
 *
 * Reglees pour `impact()`, ou la valeur atteint zero exactement a l'echeance.
 * Les anciennes valeurs (0,35 / 0,2 / 0,08) etaient des constantes de temps
 * d'exponentielle : la duree VISIBLE y valait environ trois fois la constante,
 * soit 1,05 temps pour le kick. Reprendre ces nombres tels quels aurait rendu
 * toutes les reactions trois fois plus breves.
 */
/** Kick : dans la bande 0,3-0,6 de §2.7.8, et sous 1 temps, donc au repos avant la frappe suivante. */
export const DECAY_KICK = 0.5;
/** Caisse claire : plus courte que le kick, elle tombe en general en contretemps du kick. */
export const DECAY_SNARE = 0.35;
/**
 * Charley : DELIBEREMENT sous la bande de §2.7.8. Cette bande suppose un accent
 * par temps ; un charley en doubles croches frappe toutes les 0,25 temps, et une
 * decroissance de 0,3 ne reviendrait jamais au repos - le scintillement
 * deviendrait un voile continu.
 */
export const DECAY_HAT = 0.18;

/**
 * Tous les poids tiennent dans la bande 30-50 % de §2.7.8, temps 1 COMPRIS.
 *
 * Le temps 1 a d'abord ete mis a 1. C'est une erreur, et de la pire espece :
 * un plancher a 1 n'est plus un plancher, c'est un remplacement. Il forcait
 * chaque mesure a l'amplitude maximale meme quand aucun kick n'etait joue -
 * donc pendant un breakdown, en contradiction directe avec le plancher de vide
 * et le plafond de luminance de §2.8 - et il ECRASAIT les frappes faibles :
 * un kick de force 0,3 tombant sur le temps 1 ressortait a 1,0, ce qui aplatit
 * exactement la dynamique que le detecteur mesure.
 *
 * Le plein accent doit venir de la frappe DETECTEE. La grille ne fait que
 * garantir qu'aucun temps ne reste a zero.
 */
/** Temps 1 : haut de la bande. Le reste de son accent vient du kick detecte. */
const WEIGHT_DOWNBEAT = 0.5;
/** Temps fort secondaire (le 3 en 4/4). */
const WEIGHT_SECONDARY = 0.4;
/** Temps faibles (2 et 4). */
const WEIGHT_WEAK = 0.35;
/** Contretemps (les croches) : bas de la bande. */
const WEIGHT_OFFBEAT = 0.3;

/** Poids d'accent d'une position dans la mesure, 0 = temps 1. */
export function beatWeight(positionInBar: number, beatsPerBar: number): number {
  const n = Math.max(1, Math.floor(beatsPerBar));
  const p = ((Math.floor(positionInBar) % n) + n) % n;
  if (p === 0) return WEIGHT_DOWNBEAT;
  // Temps fort secondaire : la moitie de la mesure, quand elle tombe juste.
  if (n % 2 === 0 && p === n / 2) return WEIGHT_SECONDARY;
  return WEIGHT_WEAK;
}

/**
 * Accent de grille a l'instant courant.
 *
 * @param barPhase   phase de mesure VISUELLE, decalee de `syncOffsetMs`.
 * @param beatPhase  phase de temps VISUELLE.
 * @param decayBeats duree de retour au repos, en temps (§2.7.8 : 0,3 a 0,6).
 * @param beatsPerBar hypothese metrique, explicite et configurable.
 */
export function gridAccent(barPhase: number, beatPhase: number, decayBeats: number, beatsPerBar: number): number {
  const n = Math.max(1, Math.floor(beatsPerBar));
  const position = Math.floor(barPhase * n);
  const onBeat = beatWeight(position, n) * impact(beatPhase, decayBeats);
  // Contretemps : la croche. Le plancher de §2.7.8 s'y applique aussi - un
  // contretemps sans aucune reaction fait paraitre le visuel en retard d'une
  // croche sur la musique.
  const sinceHalf = beatPhase < 0.5 ? beatPhase : beatPhase - 0.5;
  const offBeat = WEIGHT_OFFBEAT * impact(sinceHalf, decayBeats);
  return Math.max(onBeat, offBeat);
}

/**
 * Combine une enveloppe d'onset et l'accent de grille. `max`, JAMAIS une
 * somme : une somme ferait exactement ce que §2.7.7 interdit, et sur un temps
 * ou l'onset EST detecte les deux se cumuleraient a 1,4.
 */
export function withGridFloor(onsetEnvelope: number, grid: number, floorRatio: number): number {
  const floor = grid * Math.max(0, Math.min(1, floorRatio));
  return onsetEnvelope > floor ? onsetEnvelope : floor;
}
