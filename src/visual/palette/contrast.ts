/**
 * Contraste WCAG (docs/17_PHASE2_VISUELS.md §9.2, chantier 7).
 *
 * « Chaque palette garantit un rapport de luminance d'au moins 4:1 entre le
 * fond et la couleur de plus haute intensité. » Le critère existait déjà pour
 * les palettes écrites à la main ; il devient indispensable dès qu'une palette
 * est EXTRAITE d'une pochette, puisque plus personne ne la relit avant usage.
 *
 * DUPLICATION ASSUMÉE. `src/ui/live/util/oklch.ts` contient déjà
 * `relativeLuminance` et `contrastRatio`. Ils n'ont pas été déplacés dans
 * `core/` comme l'a été le bruit simplex au chantier 6, et la différence tient
 * en une phrase : `noise.ts` était un fichier autonome de 120 lignes sans le
 * moindre import, donc un déplacement sans risque ; ces deux fonctions-ci sont
 * huit lignes enfouies dans un module de conversion OKLCH propre au mode live,
 * et les extraire demanderait de découper ce module pour un gain nul. Même
 * arbitrage que `BAND_WIDTH_WEIGHTS`, recopié dans `SpectrumBars` plutôt
 * qu'importé depuis `analysis/`.
 *
 * Fonctions pures.
 */

import type { Color } from '../../render/Renderer';

/** Rapport minimal exigé entre le fond et la couleur la plus intense (§9.2). */
export const MIN_CONTRAST = 4;

function srgbToLinear(channel255: number): number {
  const c = Math.min(1, Math.max(0, channel255 / 255));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Luminance relative WCAG, 0 à 1.
 *
 * À ne pas confondre avec le `L` d'OKLCH : celui-ci est une luminance PHYSIQUE
 * pondérée Rec. 709, l'autre est perceptuel. Utiliser l'un pour l'autre donne
 * des rapports de contraste faux d'un facteur deux sur les couleurs saturées.
 */
export function relativeLuminance(c: Color): number {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/** Rapport de contraste WCAG entre deux couleurs, de 1 à 21. */
export function contrastRatio(a: Color, b: Color): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Éclaircit ou assombrit `color` jusqu'à atteindre `target` de contraste avec
 * `against`, en préservant sa TEINTE.
 *
 * §7.5 est explicite : « si elle échoue, corrige la luminance plutôt que de
 * refuser — une pochette sombre est un cas normal, pas une erreur ». Refuser
 * une palette extraite serait la pire réponse : l'utilisateur a choisi une
 * image, pas une palette, et il n'a aucun moyen de la « corriger ».
 *
 * La direction est choisie en fonction du fond : sur un fond sombre on
 * éclaircit, sur un fond clair on assombrit. Recherche par dichotomie sur un
 * facteur multiplicatif, 24 itérations — largement au-delà de la précision
 * visible, et borné donc sans risque de boucle infinie.
 */
export function ensureContrast(color: Color, against: Color, target = MIN_CONTRAST): Color {
  if (contrastRatio(color, against) >= target) return color;

  const towardsWhite = relativeLuminance(against) < 0.5;
  let lo = 0;
  let hi = 1;
  let best = mix(color, towardsWhite, 1);
  // Si même l'extrême ne suffit pas — un fond gris moyen n'atteint 4:1 ni avec
  // du blanc ni avec du noir — on rend le meilleur effort plutôt qu'un échec.
  if (contrastRatio(best, against) < target) return best;

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = mix(color, towardsWhite, mid);
    if (contrastRatio(candidate, against) >= target) {
      best = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

/** Mélange vers blanc ou noir, `t` de 0 (inchangé) à 1 (extrême). */
function mix(c: Color, towardsWhite: boolean, t: number): Color {
  const edge = towardsWhite ? 255 : 0;
  return {
    r: c.r + (edge - c.r) * t,
    g: c.g + (edge - c.g) * t,
    b: c.b + (edge - c.b) * t,
    a: c.a,
  };
}
