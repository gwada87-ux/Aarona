/**
 * Import d'une pochette (docs/17_PHASE2_VISUELS.md §7.5, chantier 7).
 *
 * Seul endroit du chantier qui touche le DOM. Tout ce qui est calcul — la
 * quantification, la construction de palette, la garantie de contraste — vit
 * dans `visual/palette/` et se teste sans navigateur ; ici on ne fait que lire
 * un fichier, le décoder, le réduire et lire ses octets.
 *
 * LE `getImageData` D'ICI EST LÉGITIME
 * ------------------------------------
 * `CLAUDE.md` interdit `getImageData()` à chaque image. L'interdit vise la
 * BOUCLE DE RENDU : une lecture de pixels y coûte une synchronisation GPU par
 * trame. Ici il s'agit d'une action utilisateur, une fois par import, sur un
 * bitmap de 64×64. Le rapprochement mérite d'être écrit pour qu'on ne le
 * signale pas comme une infraction à la relecture suivante.
 */

import { paletteFromCover, type CoverPaletteReport } from '../visual/palette/coverPalette';
import { quantize } from '../visual/palette/quantize';

/**
 * Côté de l'image réduite servant à l'extraction. 64 suffit largement : on
 * cherche des masses de couleur, pas des détails, et 4 096 pixels donnent déjà
 * une statistique très stable. Monter à 256 multiplierait le coût par seize
 * pour un résultat identique à l'œil.
 */
const SAMPLE_SIZE = 64;
/** Couleurs extraites. Puissance de deux : la coupe médiane divise par deux. */
const DOMINANT_COUNT = 8;
/** Garde-fou de taille de fichier, en octets. */
const MAX_BYTES = 12 * 1024 * 1024;

export interface ImportedCover {
  /** Bitmap décodé, prêt à être dessiné dans un sprite. */
  readonly image: ImageBitmap;
  readonly report: CoverPaletteReport;
  readonly fileName: string;
}

export class CoverImportError extends Error {
  constructor(
    message: string,
    readonly code: 'TOO_LARGE' | 'DECODE_FAILED' | 'NO_CANVAS',
  ) {
    super(message);
    this.name = 'CoverImportError';
  }
}

/**
 * Lit un fichier image, le décode, et en extrait une palette.
 *
 * Le décodage a lieu ICI, une fois — jamais pendant le rendu (Loi 1, et §7.5
 * le rappelle explicitement). Ce qui en ressort est un `ImageBitmap` déjà
 * décodé, que la couche `CoverArt` se contente de dessiner dans un sprite.
 */
export async function importCover(file: File): Promise<ImportedCover> {
  if (file.size > MAX_BYTES) {
    throw new CoverImportError(
      `Image trop lourde : ${(file.size / 1024 / 1024).toFixed(1)} Mo (maximum ${MAX_BYTES / 1024 / 1024} Mo)`,
      'TOO_LARGE',
    );
  }

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch (cause) {
    // Format non reconnu, fichier tronqué, ou image trop grande pour le
    // navigateur. Le message d'origine n'est pas montrable à l'utilisateur.
    throw new CoverImportError('Image illisible ou format non reconnu', 'DECODE_FAILED');
  }

  const report = paletteFromCover(sampleDominantColors(image), `cover:${file.name}`);
  return { image, report, fileName: file.name };
}

/**
 * Réduit l'image à `SAMPLE_SIZE` carré et en extrait les couleurs dominantes.
 *
 * La réduction est confiée au navigateur (`drawImage` vers un canvas plus
 * petit), qui moyenne les pixels bien mieux qu'un sous-échantillonnage naïf :
 * prendre un pixel sur N raterait complètement un petit logo vif, qui est
 * précisément ce qu'on cherche à extraire.
 */
function sampleDominantColors(image: ImageBitmap) {
  const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new CoverImportError('Contexte 2D indisponible pour l\'extraction', 'NO_CANVAS');
  ctx.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return quantize(data, DOMINANT_COUNT);
}
