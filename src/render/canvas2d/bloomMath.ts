/**
 * Fonctions PURES du bloom (docs/07_VISUAL_ENGINE.md §"Le bloom d'ensemble",
 * Étape 21) — aucun appel Canvas 2D ici, seulement de l'arithmétique sur des
 * tableaux de pixels et des dimensions. Séparées de `Canvas2DRenderer.ts`
 * précisément pour rester testables en Node (`Canvas2DRenderer` lui-même ne
 * l'est pas, faute de `<canvas>`/`OffscreenCanvas` réel — voir son
 * commentaire d'en-tête).
 *
 * Valeurs numériques auto-choisies ci-dessous (aucune n'est chiffrée par
 * docs/07, qui décrit la CHAÎNE — sous-échantillonnage, extraction,
 * flou, composition — sans donner de seuil ni de rayon) : bornées pour
 * rester perceptuellement raisonnables, ajustables sans changer la forme de
 * l'API si l'usage au navigateur révèle un besoin de calibrage.
 */

/** Sur 0..255 — un pixel dont le canal max est en dessous n'est pas un "point chaud". */
export const HIGHLIGHT_THRESHOLD = 200;

/** Fraction du petit côté du buffer réduit, par passe de flou (voir `computeBlurRadiusPx`). */
export const BLUR_RADIUS_FRACTION_PER_PASS = 0.06;

/** Alpha de composition additive du bloom flouté par-dessus l'image d'origine. */
export const BLOOM_COMPOSITE_ALPHA = 0.55;

/** Dimensions du buffer réduit pour un `resolutionScale` donné — au moins 1×1. */
export function computeSmallDimensions(fullWidth: number, fullHeight: number, resolutionScale: number): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(1, Math.round(fullWidth * resolutionScale)),
    height: Math.max(1, Math.round(fullHeight * resolutionScale)),
  };
}

/**
 * Rayon de flou (px, dans l'espace du buffer RÉDUIT) pour `ctx.filter =
 * 'blur(...)'`. `passes` (docs/10, table des 4 niveaux) élargit le rayon
 * plutôt que de répéter une vraie convolution en boucle — voir le
 * commentaire de `Canvas2DRenderer::applyBloom` pour la justification de cet
 * écart par rapport au « deux passes de flou séparable » de docs/07.
 */
export function computeBlurRadiusPx(smallWidth: number, smallHeight: number, passes: number): number {
  const minSide = Math.min(smallWidth, smallHeight);
  return minSide * BLUR_RADIUS_FRACTION_PER_PASS * Math.max(0, passes);
}

/**
 * Extraction des hautes lumières, EN PLACE, sur un buffer RGBA
 * (`ImageData.data`). Seuil doux : un pixel dont le canal max dépasse
 * `threshold` est conservé, atténué proportionnellement à son excès
 * au-dessus du seuil (transition continue, pas un couperet dur qui
 * découperait des bords visibles dans le halo). Sous le seuil, le pixel est
 * mis à zéro (RGBA) — n'apporte rien à une composition additive ultérieure.
 *
 * `brightness` = max(r,g,b), pas une luma perceptuelle (0,2126·r + ...) :
 * une particule d'une seule couleur saturée (ex. rouge pur) doit être
 * détectée comme un point chaud même si sa luma pondérée serait faible —
 * choix délibéré pour une scène dominée par des couleurs de palette
 * saturées plutôt que du blanc/gris.
 */
export function extractHighlights(pixels: Uint8ClampedArray, threshold: number = HIGHLIGHT_THRESHOLD): void {
  const range = 255 - threshold;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const brightness = Math.max(r, g, b);
    if (brightness <= threshold) {
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      pixels[i + 3] = 0;
    } else {
      const factor = range > 0 ? (brightness - threshold) / range : 1;
      pixels[i] = r * factor;
      pixels[i + 1] = g * factor;
      pixels[i + 2] = b * factor;
    }
  }
}
