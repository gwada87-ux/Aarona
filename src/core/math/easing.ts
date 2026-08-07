/**
 * Courbes d'accélération et enveloppes d'impact — module partagé
 * (docs/17_PHASE2_VISUELS.md §6.3, chantier 2).
 *
 * Jusqu'ici chaque couche improvisait ses courbes : une interpolation linéaire
 * ici, une exponentielle là, un `Math.sin` ailleurs. Deux couches réagissant au
 * même signal ne remontaient donc pas au même rythme, ce qui se lit comme un
 * défaut de synchronisation alors que l'horloge est juste.
 *
 * Placé dans `core/` et non dans `visual/` : `behaviour/` en a besoin pour les
 * LFO, `visual/` pour les couches, et la règle de dépendance autorise les deux
 * à importer `core/` alors qu'ils ne peuvent pas s'importer l'un l'autre.
 *
 * Fonctions PURES, sans allocation, sans état — Loi 1 : le rendu doit rester
 * une fonction du temps seul.
 */

/**
 * Dépassement maximal autorisé, en fraction.
 *
 * La borne n'est pas décorative : un dépassement appliqué à TOUT donne une
 * image qui rebondit en permanence, ce qui détruit exactement le contraste que
 * l'impact devait créer. Le dépassement est un privilège réservé aux éléments
 * massifs, d'où un paramètre explicite plutôt qu'une constante cachée.
 */
export const MAX_OVERSHOOT = 0.08;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Décroissance douce, sans dépassement. Le défaut pour tout ce qui n'est pas massif. */
export function easeOutCubic(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

/** Montée douce puis arrêt net. Pour les révélations et les masques. */
export function easeOutQuint(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x * x * x;
}

/** Démarrage lent. Pour ce qui se creuse en approchant d'un événement. */
export function easeInQuad(t: number): number {
  const x = clamp01(t);
  return x * x;
}

/** Symétrique. Pour les respirations et les micro-variations de phrase. */
export function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(clamp01(t) * Math.PI);
}

/**
 * Lobe de DÉPASSEMENT, en cloche, nul aux deux extrémités. Partagé entre
 * `impact()` et les couches qui animent une ENTRÉE plutôt qu'un retour : les
 * deux doivent dépasser de la même façon, sinon deux éléments qui réagissent au
 * même temps ne rebondissent pas ensemble.
 *
 * @param amount fraction de dépassement, écrêtée à `MAX_OVERSHOOT`.
 */
export function overshootLobe(t: number, amount: number): number {
  const x = clamp01(t);
  if (x >= 1) return 0;
  const a = Math.min(MAX_OVERSHOOT, Math.max(0, amount));
  return a > 0 ? a * Math.sin(x * Math.PI) * (1 - x) : 0;
}

/**
 * Enveloppe d'IMPACT : attaque instantanée à 1, retour au repos EXACT à
 * `duration`, avec un dépassement optionnel borné à 8 %.
 *
 * Différence avec `signals/Impulse`, et raison d'être des deux : `Impulse` est
 * une décroissance exponentielle À DEMI-VIE, pilotée par la table de câblage et
 * partagée par tous les styles — elle a un état et sert de signal global.
 * `impact()` est sans état et s'annule vraiment ; une couche s'en sert pour une
 * animation LOCALE dont elle connaît la durée (une entrée, un éclat, une
 * secousse ponctuelle), là où traîner une exponentielle jusqu'à l'infini
 * empêcherait l'élément de revenir précisément au repos.
 *
 * @param elapsed  durée écoulée depuis l'attaque, même unité que `duration`.
 * @param duration durée de retour au repos. En temps musicaux : 0,3 à 0,6.
 * @param overshoot fraction de dépassement, réservée aux éléments massifs.
 */
export function impact(elapsed: number, duration: number, overshoot = 0): number {
  if (!(elapsed >= 0) || !Number.isFinite(elapsed)) return 0;
  const d = Math.max(1e-6, duration);
  const t = elapsed / d;
  if (t >= 1) return 0;
  // Décroissance cubique MOINS un lobe en cloche qui s'annule aux deux
  // extrémités : l'élément passe sous son repos puis y revient exactement, il
  // ne s'arrête pas légèrement au-dessus.
  const decay = (1 - t) * (1 - t) * (1 - t);
  return Math.max(0, decay - overshootLobe(t, overshoot));
}
