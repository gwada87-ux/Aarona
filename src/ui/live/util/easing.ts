/**
 * Easings et enveloppes d'impact (§2.7.8, §5).
 *
 * « Resolution apres impact : attaque quasi instantanee, retour au repos sur
 * 0,3 a 0,6 temps, leger depassement (<= 8 %) reserve aux elements massifs. »
 *
 * Les trois parties de cette phrase comptent, et la troisieme surtout : un
 * depassement applique a TOUT donne une image qui rebondit en permanence, ce
 * qui detruit exactement le contraste que l'impact devait creer. Le
 * depassement est un privilege, pas un reglage par defaut - d'ou un parametre
 * explicite plutot qu'une constante cachee.
 *
 * Fonctions pures, aucune allocation.
 *
 * hot-path (§8.9) - appelees plusieurs fois par scene et par trame.
 */

/** Depassement maximal autorise par §2.7.8, en fraction. */
export const MAX_OVERSHOOT = 0.08;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Decroissance douce, sans depassement. Le defaut pour tout ce qui n'est pas massif. */
export function easeOutCubic(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

/** Montee douce puis arret net. Pour les revelations et les masques. */
export function easeOutQuint(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x * x * x;
}

/** Symetrique. Pour les respirations et les micro-variations de phrase. */
export function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(clamp01(t) * Math.PI);
}

/**
 * Lobe de DEPASSEMENT, en cloche, nul aux deux extremites. Partage entre
 * `impact()` et les scenes qui animent une ENTREE plutot qu'un retour : les
 * deux doivent depasser de la meme facon, sinon un fondu entre une scene qui
 * rebondit et une qui ne rebondit pas se lit comme un defaut de synchro.
 *
 * @param t      progression 0-1.
 * @param amount fraction de depassement, ecretee a `MAX_OVERSHOOT`.
 */
export function overshootLobe(t: number, amount: number): number {
  const x = clamp01(t);
  if (x >= 1) return 0;
  const a = Math.min(MAX_OVERSHOOT, Math.max(0, amount));
  return a > 0 ? a * Math.sin(x * Math.PI) * (1 - x) : 0;
}

/**
 * Enveloppe d'IMPACT : attaque instantanee a 1, retour au repos sur
 * `decayBeats` temps, avec un depassement optionnel BORNE a 8 %.
 *
 * @param sinceBeats duree ecoulee depuis l'attaque, EN TEMPS musicaux.
 * @param decayBeats duree de retour au repos. §2.7.8 : 0,3 a 0,6.
 * @param overshoot  fraction de depassement. Ecretee a `MAX_OVERSHOOT`, et
 *                   reservee par convention aux elements massifs.
 */
export function impact(sinceBeats: number, decayBeats: number, overshoot = 0): number {
  if (!(sinceBeats >= 0) || !Number.isFinite(sinceBeats)) return 0;
  const d = Math.max(1e-4, decayBeats);
  const t = sinceBeats / d;
  if (t >= 1) return 0;
  // Decroissance cubique, MOINS un lobe de depassement en cloche qui s'annule
  // aux deux extremites : l'element passe sous son repos puis y revient
  // EXACTEMENT, il ne s'arrete pas legerement au-dessus.
  const decay = (1 - t) * (1 - t) * (1 - t);
  return Math.max(0, decay - overshootLobe(t, overshoot));
}

/**
 * ANTICIPATION (§2.7.3) : contre-mouvement dans les `max(90 ms, periode/5)`
 * qui precedent le temps. Retourne 0 a 1, ou 1 est le recul maximal, atteint
 * juste avant le temps.
 *
 * Sous 90 ms - cinq trames a 60 fps - le contre-mouvement est invisible ; le
 * seuil perceptif est de 80 a 150 ms. C'est pourquoi le plancher est absolu et
 * non proportionnel au tempo.
 */
export function anticipation(beatPhase: number, periodSec: number): number {
  if (!(periodSec > 0)) return 0;
  const leadSec = Math.max(0.09, periodSec / 5);
  const leadPhase = Math.min(0.5, leadSec / periodSec);
  const toBeat = 1 - clamp01(beatPhase);
  if (toBeat > leadPhase) return 0;
  // Progression quadratique : le recul s'amorce en douceur et se creuse en
  // approchant du temps, ce qui le rend lisible sans le rendre saccade.
  const t = 1 - toBeat / leadPhase;
  return t * t;
}
