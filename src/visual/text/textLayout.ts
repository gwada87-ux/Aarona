/**
 * Mise en page du texte (docs/17_PHASE2_VISUELS.md §9.3, chantier 8).
 *
 * DEUX ÉTAPES SÉPARÉES, ET C'EST LA CONTRAINTE DE PERFORMANCE QUI L'IMPOSE
 * -----------------------------------------------------------------------
 * `planText` découpe la chaîne en lignes, mots et glyphes. Il ne dépend NI des
 * métriques de police NI du cadre : on l'appelle une fois, à l'initialisation.
 *
 * `layoutInto` calcule les positions. Il dépend du cadre (donc du `Viewport`,
 * connu seulement au dessin) ET du `tracking`, que `tension` fait varier à
 * chaque image. Il écrit donc dans des `Float32Array` FOURNIS par l'appelant,
 * pré-alloués une fois : aucune allocation par image (docs/10).
 *
 * TOUT EST EN UNITÉS NORMALISÉES (Loi 4)
 * --------------------------------------
 * Les avances viennent en fraction de la taille de police (« em »), la sortie en
 * fraction du PETIT CÔTÉ du cadre. Aucun pixel ne traverse ce module, et c'est
 * ce qui rend les cinq mises en page correctes en 16:9, 9:16 et 1:1 sans une
 * seule ligne conditionnelle sur le format.
 */

import { safeRect } from '../../render/safeArea';
import type { SafeArea } from '../../render/Viewport';
import { MAX_GLYPHS, applyTextCase, type TextCase, type TextLayoutId } from './textConfig';

export interface PlannedGlyph {
  readonly char: string;
  readonly lineIndex: number;
  /** Index du mot dans le texte ENTIER, lignes confondues (animation `word`). */
  readonly wordIndex: number;
  /** Rang de lecture, tous glyphes confondus (animation `typewriter`). */
  readonly order: number;
}

export interface TextPlan {
  readonly glyphs: readonly PlannedGlyph[];
  readonly lineCount: number;
  readonly wordCount: number;
  /** `true` si le texte a dû être coupé à `MAX_GLYPHS`. Remonté à l'interface. */
  readonly truncated: boolean;
}

/**
 * Découpe le texte. Les espaces ne produisent PAS de glyphe : ils comptent dans
 * l'avance de la ligne, mais un sprite vide serait un `drawImage` par image pour
 * rien.
 */
export function planText(raw: string, textCase: TextCase): TextPlan {
  const text = applyTextCase(raw, textCase);
  const glyphs: PlannedGlyph[] = [];
  let wordIndex = -1;
  let inWord = false;
  let order = 0;
  let truncated = false;

  const lines = text.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    // Une nouvelle ligne coupe le mot en cours : le premier glyphe de la ligne
    // suivante ouvre un nouveau mot, sinon deux lignes collées entreraient
    // ensemble dans l'animation `word`.
    inWord = false;
    for (const char of Array.from(lines[lineIndex]!)) {
      if (char === ' ' || char === '\t') {
        inWord = false;
        continue;
      }
      if (!inWord) {
        inWord = true;
        wordIndex++;
      }
      if (glyphs.length >= MAX_GLYPHS) {
        truncated = true;
        break;
      }
      glyphs.push({ char, lineIndex, wordIndex, order: order++ });
    }
    if (truncated) break;
  }

  return {
    glyphs,
    lineCount: truncated ? (glyphs[glyphs.length - 1]?.lineIndex ?? 0) + 1 : lines.length,
    wordCount: wordIndex + 1,
    truncated,
  };
}

export interface LayoutOptions {
  readonly layout: TextLayoutId;
  readonly aspect: number;
  readonly safe: SafeArea;
  /** Multiplicateur utilisateur de la taille de police. */
  readonly sizeScale: number;
  /** Écartement supplémentaire entre glyphes, en em. Piloté par `tension`. */
  readonly tracking: number;
}

export interface LayoutResult {
  /** Taille de police, en fraction du petit côté du cadre. */
  readonly fontNorm: number;
  /** Nombre de glyphes effectivement écrits dans `xs`/`ys`. */
  readonly count: number;
}

/** Interligne, en multiples de la taille de police. */
const LINE_HEIGHT = 1.18;
/** Avance d'un espace quand la mesure réelle n'est pas disponible, en em. */
export const FALLBACK_SPACE_ADVANCE = 0.3;
/** Bornes de la taille de police, en fraction du petit côté. */
const MIN_FONT = 0.02;
const MAX_FONT = 0.62;
/** Décalage horizontal par ligne de la mise en page `diagonal`, en em. */
const DIAGONAL_STEP = 0.55;

/**
 * Largeur visée par mise en page, en fraction de la LARGEUR SÛRE.
 *
 * `oversize` dépasse 1 volontairement : §9.3 demande « très gros débordant du
 * cadre ». C'est la seule mise en page qui sort de la zone sûre, et c'est son
 * objet — le texte y est un motif graphique, pas une information à lire en
 * entier.
 */
const WIDTH_RATIO: Readonly<Record<TextLayoutId, number>> = Object.freeze({
  center: 0.86,
  'lower-third': 0.9,
  diagonal: 0.72,
  oversize: 1.5,
  third: 0.56,
});

/**
 * Marge reservee a la CAMERA DE DRAMATURGIE, mesuree, pas estimee.
 *
 * `framingFor` neutralise deja le cadrage de variante des qu'un habillage est
 * present (voir `visual/scene/dramaFrame.ts`). Reste la camera du
 * `VisualDirector`, qui zoome jusqu'a 1,12 et derive d'environ 0,05 : elle
 * suit le morceau, pas un tirage, et un titre doit la suivre.
 *
 * Mesure au navigateur, 122 echantillons sur 46 s de la piste de demonstration,
 * titre centre a sa taille par defaut : la marge droite minimale tombait a
 * **1 px** sur un cadre de 893 au moment ou la camera pousse (t = 7,7 s ; le
 * titre passait de 752 a 843 px de large). Un mot plus long coupait.
 *
 * 0,88 est l'inverse arrondi de ce zoom maximal. Applique a toutes les mises en
 * page SAUF `oversize`, dont l'objet est precisement de deborder.
 */
const CAMERA_HEADROOM = 0.88;

/**
 * Calcule les positions de chaque glyphe et les écrit dans `xs`/`ys`.
 *
 * @param advances avance de chaque glyphe de `plan.glyphs`, en em (même ordre).
 * @param spaceAdvance avance d'un espace, en em.
 * @param xs `Float32Array` d'au moins `plan.glyphs.length` cases, MUTÉ.
 * @param ys idem.
 */
export function layoutInto(
  plan: TextPlan,
  advances: Float32Array,
  spaceAdvance: number,
  opts: LayoutOptions,
  xs: Float32Array,
  ys: Float32Array,
): LayoutResult {
  const count = Math.min(plan.glyphs.length, xs.length, ys.length);
  if (count === 0) return { fontNorm: 0, count: 0 };

  const frame = safeRect(opts.aspect, opts.safe);
  const frameW = frame.right - frame.left;
  const frameH = frame.top - frame.bottom;

  // --- 1. Largeur de chaque ligne, en em ------------------------------------
  const lineWidths = new Float64Array(plan.lineCount);
  let previousLine = -1;
  let previousWord = -1;
  for (let i = 0; i < count; i++) {
    const g = plan.glyphs[i]!;
    if (g.lineIndex !== previousLine) {
      previousLine = g.lineIndex;
      previousWord = g.wordIndex;
    } else {
      // Changement de mot sur la MÊME ligne : l'espace qui les sépare n'a pas de
      // glyphe (voir `planText`), son avance doit donc être rajoutée ici.
      if (g.wordIndex !== previousWord) {
        lineWidths[g.lineIndex]! += spaceAdvance;
        previousWord = g.wordIndex;
      }
      lineWidths[g.lineIndex]! += opts.tracking;
    }
    lineWidths[g.lineIndex]! += advances[i]!;
  }

  let widest = 0;
  for (let l = 0; l < plan.lineCount; l++) if (lineWidths[l]! > widest) widest = lineWidths[l]!;
  if (widest <= 0) return { fontNorm: 0, count: 0 };

  // --- 2. Taille de police ---------------------------------------------------
  const diagonalSpread = opts.layout === 'diagonal' ? (plan.lineCount - 1) * DIAGONAL_STEP : 0;
  const headroom = opts.layout === 'oversize' ? 1 : CAMERA_HEADROOM;
  const targetW = frameW * WIDTH_RATIO[opts.layout] * headroom;
  let fontNorm = (targetW / (widest + diagonalSpread)) * opts.sizeScale;

  // Plafond en HAUTEUR. Sans lui, un texte de cinq lignes courtes serait
  // dimensionné sur sa largeur et sortirait du cadre par le haut et par le bas.
  if (opts.layout !== 'oversize') {
    const heightBudget = frameH * 0.86 * CAMERA_HEADROOM;
    const heightCap = heightBudget / (plan.lineCount * LINE_HEIGHT);
    if (heightCap < fontNorm) fontNorm = heightCap;
  }
  fontNorm = Math.min(MAX_FONT, Math.max(MIN_FONT, fontNorm));

  // --- 3. Ancrage du bloc ----------------------------------------------------
  const blockH = plan.lineCount * LINE_HEIGHT * fontNorm;
  // `centred` : les lignes sont centrées les unes sur les autres. Sinon elles
  // sont alignées à gauche, ce qu'exigent le bandeau bas et la règle des tiers -
  // un bloc centré posé sur un tiers ne se lit plus comme aligné sur ce tiers.
  //
  // `diagonal` est ALIGNÉE À GAUCHE, et un test l'a imposé : en centrant chaque
  // ligne sur son propre décalage, une ligne plus longue que la précédente
  // repartait vers la GAUCHE - le centrage tirait plus fort que le pas de
  // l'escalier, et la diagonale s'inversait selon la longueur des mots. Aligner
  // les bords gauches rend le pas visible quel que soit le texte.
  const centred = opts.layout === 'center' || opts.layout === 'oversize';
  let anchorX: number;
  let blockTop: number;
  switch (opts.layout) {
    case 'lower-third':
      anchorX = frame.left + frameW * 0.04;
      blockTop = frame.bottom + frameH * 0.1 + blockH;
      break;
    case 'third':
      anchorX = frame.left + frameW / 3;
      blockTop = frame.bottom + frameH * (2 / 3) + blockH / 2;
      break;
    case 'diagonal':
      // Le bloc ENTIER est recentré : la ligne la plus longue plus la course de
      // l'escalier. Recentrer seulement l'escalier laisserait le texte pendre à
      // droite dès que la dernière ligne est la plus longue.
      anchorX = (frame.left + frame.right) / 2 - ((widest + diagonalSpread) * fontNorm) / 2;
      blockTop = (frame.bottom + frame.top) / 2 + blockH / 2;
      break;
    default:
      anchorX = (frame.left + frame.right) / 2;
      blockTop = (frame.bottom + frame.top) / 2 + blockH / 2;
      break;
  }

  // RABATTEMENT dans la zone sure. `third` place le centre du bloc sur la ligne
  // des deux tiers : sur un texte tres court, la police monte jusqu'a son
  // plafond et les hampes depassent alors par le haut. Le plafond de hauteur
  // (etape 2) garantit que le bloc TIENT dans la zone, pas qu'il y soit place -
  // ces deux lignes s'en chargent, et elles ne peuvent rien deplacer tant que le
  // bloc tient, ce qui laisse les quatre mises en page intactes dans le cas
  // courant. `oversize` en est exempte : son objet est de deborder.
  if (opts.layout !== 'oversize') {
    if (blockTop > frame.top) blockTop = frame.top;
    if (blockTop - blockH < frame.bottom) blockTop = frame.bottom + blockH;
  }

  // --- 4. Position de chaque glyphe -----------------------------------------
  previousLine = -1;
  previousWord = -1;
  let penX = 0;
  let lineY = 0;
  for (let i = 0; i < count; i++) {
    const g = plan.glyphs[i]!;
    if (g.lineIndex !== previousLine) {
      previousLine = g.lineIndex;
      previousWord = g.wordIndex;
      const lineShift = opts.layout === 'diagonal' ? g.lineIndex * DIAGONAL_STEP * fontNorm : 0;
      const width = lineWidths[g.lineIndex]! * fontNorm;
      penX = centred ? anchorX - width / 2 + lineShift : anchorX + lineShift;
      lineY = blockTop - (g.lineIndex + 0.5) * LINE_HEIGHT * fontNorm;
    } else {
      if (g.wordIndex !== previousWord) {
        penX += spaceAdvance * fontNorm;
        previousWord = g.wordIndex;
      }
      penX += opts.tracking * fontNorm;
    }
    const advance = advances[i]! * fontNorm;
    // `x` est le CENTRE du glyphe : `drawSprite` place un carré par son centre.
    xs[i] = penX + advance / 2;
    ys[i] = lineY;
    penX += advance;
  }

  return { fontNorm, count };
}
