/**
 * Fonctions PURES du décalage chromatique (docs/07_VISUAL_ENGINE.md,
 * Étape 23) — aucun appel Canvas 2D ici, seulement de l'arithmétique.
 * Séparées de `Canvas2DRenderer.ts` pour rester testables en Node, même
 * principe que `bloomMath.ts` (voir son commentaire d'en-tête).
 *
 * Valeurs numériques auto-choisies (docs/07 ne chiffre ni le décalage ni
 * l'alpha) : bornées pour rester une frange discrète, ajustables sans
 * changer la forme de l'API.
 */

/** Fraction du petit côté du canvas — décalage horizontal de chaque passe teintée. */
export const ABERRATION_OFFSET_FRACTION = 0.0025;

/** Alpha de composition additive de chaque passe teintée (rouge, bleue) par-dessus l'image d'origine. */
export const ABERRATION_TINT_ALPHA = 0.5;

/**
 * Décalage horizontal en pixels pour un canvas donné — au moins 1px dès que
 * `chromaticAberration` est actif, pour rester visible même sur un petit
 * canvas (aperçu réduit).
 */
export function computeAberrationOffsetPx(width: number, height: number): number {
  const minSide = Math.min(width, height);
  return Math.max(1, minSide * ABERRATION_OFFSET_FRACTION);
}
