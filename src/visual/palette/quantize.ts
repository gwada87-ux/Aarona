/**
 * Quantification par COUPE D'ÉTENDUE (docs/17_PHASE2_VISUELS.md §7.5,
 * chantier 7).
 *
 * Extrait les couleurs dominantes d'une image réduite. §7.5 proposait « une
 * quantification par médiane répétée ou un k-moyennes à graine fixe ». Ni l'une
 * ni l'autre exactement : la structure est celle de la coupe médiane — on
 * divise récursivement des boîtes de couleurs — mais le POINT DE COUPE est le
 * milieu de l'étendue du canal, pas la médiane de la population. Voir
 * `splitIndex` pour la mesure qui a imposé ce choix.
 *
 * Pourquoi pas un k-moyennes :
 *
 * - **Le déterminisme est ici acquis SANS graine.** Aucun tirage, aucune
 *   initialisation à choisir. La Loi 1 est tenue par construction, pas par
 *   précaution — et il n'y a rien à re-semer si l'extraction est rejouée dans
 *   le pipeline d'export.
 * - **Les petites zones vives survivent.** Un k-moyennes converge vers les
 *   masses ; sur une pochette majoritairement noire avec un logo rouge, il rend
 *   cinq nuances de noir. C'est exactement le cas d'usage à ne pas rater : les
 *   pochettes sont souvent sombres, et ce qu'on veut en tirer, c'est l'accent.
 *
 * Fonctions pures, testables sans canvas : l'appelant fournit les octets, la
 * lecture de l'image est son affaire.
 */

import type { Color } from '../../render/Renderer';

/** Boîte de couleurs : une tranche du tableau d'index, plus ses bornes. */
interface Box {
  readonly from: number;
  readonly to: number;
  /** Étendue du canal le plus dispersé — c'est elle qui décide quelle boîte couper. */
  readonly spread: number;
  /** Canal à trier pour la coupe : 0 = rouge, 1 = vert, 2 = bleu. */
  readonly channel: number;
}

/**
 * Couleurs dominantes, de la plus peuplée à la moins peuplée.
 *
 * @param rgba   octets RGBA, quatre par pixel.
 * @param count  nombre de couleurs voulu. Arrondi à la puissance de deux
 *               inférieure ou égale : la coupe médiane divise par deux à chaque
 *               passe, demander 5 donnerait 4 ou 8 selon l'implémentation, et
 *               un nombre imprévisible serait pire qu'un nombre arrondi.
 */
export function quantize(rgba: Uint8ClampedArray, count: number): Color[] {
  const pixels = collectOpaque(rgba);
  if (pixels.length === 0) return [];

  const passes = Math.max(0, Math.floor(Math.log2(Math.max(1, count))));
  let boxes: Box[] = [makeBox(pixels, 0, pixels.length / 3)];

  for (let p = 0; p < passes; p++) {
    // On coupe TOUJOURS la boîte la plus étendue : c'est ce qui garantit que
    // les couleurs rendues sont écartées les unes des autres, plutôt que
    // groupées autour de la dominante.
    boxes.sort((a, b) => b.spread - a.spread);
    const next: Box[] = [];
    let split = false;
    for (const box of boxes) {
      if (!split && box.to - box.from > 1 && box.spread > 0) {
        sortByChannel(pixels, box);
        const mid = splitIndex(pixels, box);
        next.push(makeBox(pixels, box.from, mid), makeBox(pixels, mid, box.to));
        split = true;
      } else {
        next.push(box);
      }
    }
    // Plus rien à couper : l'image a moins de couleurs distinctes que demandé.
    if (!split) break;
    boxes = next;
  }

  return boxes
    .map((box) => ({ color: averageOf(pixels, box), weight: box.to - box.from }))
    .sort((a, b) => b.weight - a.weight)
    .map((e) => e.color);
}

/**
 * Pixels opaques, à plat : `[r, g, b, r, g, b, …]`.
 *
 * Les pixels TRANSPARENTS sont écartés. Une pochette au format PNG avec un fond
 * transparent donnerait sinon une dominante noire — la couleur des octets
 * derrière un alpha nul — qui n'est visible nulle part dans l'image.
 */
function collectOpaque(rgba: Uint8ClampedArray): Float64Array {
  const total = Math.floor(rgba.length / 4);
  const out = new Float64Array(total * 3);
  let n = 0;
  for (let i = 0; i < total; i++) {
    if (rgba[i * 4 + 3]! < 16) continue;
    out[n * 3] = rgba[i * 4]!;
    out[n * 3 + 1] = rgba[i * 4 + 1]!;
    out[n * 3 + 2] = rgba[i * 4 + 2]!;
    n++;
  }
  return out.subarray(0, n * 3);
}

/**
 * Point de coupe : le MILIEU DE L'ÉTENDUE du canal, pas la médiane de la
 * population.
 *
 * C'est la différence qui décide de tout, et la première version se trompait.
 * La coupe médiane classique divise la boîte en deux moitiés de même
 * POPULATION. Sur une pochette faite de 98 % de noir et de 2 % de rouge vif,
 * la médiane tombe donc en plein dans le noir, et il faut cinq ou six passes
 * avant que le rouge soit isolé — huit couleurs demandées n'y suffisent pas,
 * l'accent est noyé. Mesuré : sur 80 pixels rouges parmi 4 096, aucune couleur
 * rendue n'avait `r > 150`.
 *
 * Couper au milieu de l'ÉTENDUE sépare selon la distance dans l'espace des
 * couleurs, indépendamment du nombre de pixels. Le rouge part du premier coup.
 * C'est exactement le cas d'usage — les pochettes sont souvent sombres, et ce
 * qu'on veut en tirer, c'est le petit élément vif.
 *
 * Le repli sur la médiane sert quand tous les pixels tombent du même côté du
 * milieu, ce qui produirait une boîte vide et une couleur `NaN`.
 */
function splitIndex(pixels: Float64Array, box: Box): number {
  const c = box.channel;
  const lo = pixels[box.from * 3 + c]!;
  const hi = pixels[(box.to - 1) * 3 + c]!;
  const middle = (lo + hi) / 2;
  let i = box.from;
  while (i < box.to && pixels[i * 3 + c]! <= middle) i++;
  if (i <= box.from || i >= box.to) return box.from + Math.floor((box.to - box.from) / 2);
  return i;
}

function makeBox(pixels: Float64Array, from: number, to: number): Box {
  let spread = 0;
  let channel = 0;
  for (let c = 0; c < 3; c++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i < to; i++) {
      const v = pixels[i * 3 + c]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const range = hi - lo;
    if (range > spread) {
      spread = range;
      channel = c;
    }
  }
  return { from, to, spread, channel };
}

/** Tri sur place de la tranche, par le canal choisi. Trois valeurs échangées à la fois. */
function sortByChannel(pixels: Float64Array, box: Box): void {
  const n = box.to - box.from;
  const slice = new Float64Array(n * 3);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = 0; i < n * 3; i++) slice[i] = pixels[box.from * 3 + i]!;
  const c = box.channel;
  // `Array.prototype.sort` sur un `Int32Array` d'index : le comparateur lit la
  // tranche copiée, ce qui évite d'échanger trois valeurs à chaque comparaison.
  const sorted = Array.from(order).sort((a, b) => slice[a * 3 + c]! - slice[b * 3 + c]!);
  for (let i = 0; i < n; i++) {
    const src = sorted[i]!;
    pixels[(box.from + i) * 3] = slice[src * 3]!;
    pixels[(box.from + i) * 3 + 1] = slice[src * 3 + 1]!;
    pixels[(box.from + i) * 3 + 2] = slice[src * 3 + 2]!;
  }
}

function averageOf(pixels: Float64Array, box: Box): Color {
  const n = Math.max(1, box.to - box.from);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = box.from; i < box.to; i++) {
    r += pixels[i * 3]!;
    g += pixels[i * 3 + 1]!;
    b += pixels[i * 3 + 2]!;
  }
  return { r: r / n, g: g / n, b: b / n, a: 1 };
}
