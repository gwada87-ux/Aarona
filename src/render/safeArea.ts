/**
 * Zones sûres des formats sociaux (docs/17_PHASE2_VISUELS.md §7.4, chantier 4).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * `Viewport.safe` était DÉCLARÉ et jamais lu : `createViewport` recevait
 * toujours son défaut `{0,0,0,0}`, dans l'aperçu comme à l'export. Or
 * `export/formats.ts` propose Shorts/TikTok/Reels en 1080×1920, et ces
 * plateformes recouvrent une partie du cadre de leur propre interface —
 * légende et boutons en bas, colonne d'actions à droite. Tout ce qui porte du
 * sens et tombe là-dedans est simplement invisible pour le spectateur.
 *
 * LES VALEURS
 * -----------
 * Elles ne sont pas publiées par les plateformes et changent avec leurs
 * versions. Celles-ci sont des marges de sécurité prudentes, exprimées en
 * fraction du CÔTÉ CONCERNÉ, et volontairement un peu larges : une marge trop
 * grande coûte un peu de composition, une marge trop petite coûte un texte
 * illisible sur la moitié des téléphones.
 *
 * Unité : fraction du petit côté, comme tout le reste du repère normalisé
 * (Loi 4). Un `bottom` de 0,22 en 9:16 veut dire 22 % de la LARGEUR, pas de la
 * hauteur — ce qui vaut environ 12 % de la hauteur du cadre.
 */

import type { SafeArea } from './Viewport';

export const NO_SAFE_AREA: SafeArea = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Bande basse recouverte par la légende et les boutons, en fraction du petit côté. */
const VERTICAL_BOTTOM = 0.34;
/** Colonne d'actions à droite (avatar, cœur, partage). */
const VERTICAL_RIGHT = 0.2;
/** Bandeau haut : nom du compte, bouton retour. Plus discret. */
const VERTICAL_TOP = 0.12;

/**
 * Zone sûre pour un format d'export donné.
 *
 * Le critère est l'ORIENTATION, pas l'identifiant de format : un format
 * vertical ajouté plus tard héritera des mêmes marges sans qu'on ait à toucher
 * cette fonction. Les formats paysage et carré n'ont pas de zone recouverte —
 * on les regarde dans un lecteur, pas dans un fil.
 */
export function safeAreaFor(width: number, height: number): SafeArea {
  if (height <= width) return NO_SAFE_AREA;
  return Object.freeze({
    top: VERTICAL_TOP,
    right: VERTICAL_RIGHT,
    bottom: VERTICAL_BOTTOM,
    left: 0,
  });
}

/**
 * Le rectangle réellement sûr, en coordonnées normalisées (Loi 4 : origine au
 * centre, `y` vers le haut, 1 = petit côté).
 *
 * Fourni comme fonction plutôt que laissé à chaque appelant : la conversion
 * « marges vers rectangle » demande de connaître le demi-cadre dans les deux
 * axes, qui dépend de `aspect`, et la refaire à trois endroits garantit qu'un
 * des trois se trompera de signe sur `y`.
 */
export function safeRect(aspect: number, safe: SafeArea): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} {
  // Demi-dimensions du cadre : le petit côté vaut 1, donc le grand vaut
  // `aspect` ou `1/aspect` selon l'orientation.
  const halfW = aspect >= 1 ? aspect / 2 : 0.5;
  const halfH = aspect >= 1 ? 0.5 : 1 / (2 * aspect);
  return Object.freeze({
    left: -halfW + safe.left,
    right: halfW - safe.right,
    top: halfH - safe.top,
    bottom: -halfH + safe.bottom,
  });
}
