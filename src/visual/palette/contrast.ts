/**
 * Contraste WCAG (docs/17_PHASE2_VISUELS.md §9.2, chantier 7).
 *
 * « Chaque palette garantit un rapport de luminance d'au moins 4:1 entre le
 * fond et la couleur de plus haute intensité. » Le critère existait déjà pour
 * les palettes écrites à la main ; il devient indispensable dès qu'une palette
 * est EXTRAITE d'une pochette, puisque plus personne ne la relit avant usage.
 *
 * DUPLICATION LEVÉE AU CHANTIER 9. Ces deux fonctions étaient recopiées ici
 * parce que leur original vivait dans `src/ui/live/util/oklch.ts`, et que
 * `visual/` n'a pas le droit d'importer `ui/`. Le module a été remonté dans
 * `core/color/oklch.ts` (chantier 9, §9.2), exactement comme le bruit simplex
 * l'avait été au chantier 6 : la raison invoquée alors pour ne PAS le faire
 * tenait au découpage du module, et elle ne tient plus une fois le module
 * déplacé en entier. Il n'y a donc plus qu'un seul jeu de matrices et de
 * courbes de transfert sRGB dans le projet.
 *
 * Ce fichier ne garde que l'ADAPTATION d'unités - `Color` est en 0-255 et
 * porte un alpha, `Rgb` est en 0-1 et n'en porte pas - et `ensureContrast`,
 * qui n'a pas d'équivalent côté live.
 *
 * Fonctions pures.
 */

import { contrastRatio as contrastRatio01, relativeLuminance as relativeLuminance01 } from '../../core/color/oklch';
import type { Color } from '../../render/Renderer';

/** Rapport minimal exigé entre le fond et la couleur la plus intense (§9.2). */
export const MIN_CONTRAST = 4;

/** `Color` (0-255, avec alpha) vers `Rgb` (0-1). L'alpha ne participe pas au contraste. */
function toUnit(c: Color): { readonly r: number; readonly g: number; readonly b: number } {
  return { r: c.r / 255, g: c.g / 255, b: c.b / 255 };
}

/**
 * Luminance relative WCAG, 0 à 1.
 *
 * À ne pas confondre avec le `L` d'OKLCH : celui-ci est une luminance PHYSIQUE
 * pondérée Rec. 709, l'autre est perceptuel. Utiliser l'un pour l'autre donne
 * des rapports de contraste faux d'un facteur deux sur les couleurs saturées.
 */
export function relativeLuminance(c: Color): number {
  return relativeLuminance01(toUnit(c));
}

/** Rapport de contraste WCAG entre deux couleurs, de 1 à 21. */
export function contrastRatio(a: Color, b: Color): number {
  return contrastRatio01(toUnit(a), toUnit(b));
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
