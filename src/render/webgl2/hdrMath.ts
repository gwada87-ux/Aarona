/**
 * Fonctions PURES du pipeline HDR (ADR-013, lot 2) — conversions sRGB,
 * courbes de tone mapping et constantes du bloom physique. Miroir TypeScript
 * exact des shaders de `shaders.ts` : testable en Node (`bloomMath`, même
 * principe), et c'est la référence quand un chiffre de la sonde surprend.
 *
 * Les deux courbes candidates de l'ADR-013 sont implémentées ; le choix est
 * TRANCHÉ À LA MESURE sur les 8 styles (docs/20, SESSION B) et consigné au
 * JOURNAL. `?renderer=webgl2&tonemap=aces|agx` permet de comparer au
 * navigateur sans recompiler.
 */

// ---------------------------------------------------------------------------
// sRGB exact (IEC 61966-2-1) — PAS l'approximation pow(2.2)
// ---------------------------------------------------------------------------

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const x = c < 0 ? 0 : c > 1 ? 1 : c;
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

// ---------------------------------------------------------------------------
// Réglages exposés du pipeline HDR (liste demandée par docs/20, SESSION B)
// ---------------------------------------------------------------------------

/**
 * Courbe par défaut du tone mapping — TRANCHÉE À LA MESURE sur les 8 styles
 * (JOURNAL du lot 2) : les deux candidates d'ADR-013 échouent TOUTES LES
 * DEUX sur ce produit, dont l'esthétique vit dans les fonds très sombres —
 * leur pied de courbe les écrase de 50 à 80 % (mesuré à la sonde, corner
 * (20,10,36) → (3,2,9) sous ACES), et aucune exposition globale ne corrige
 * les fonds sans surexposer le reste (erreur moyenne ≥ 28 % sur toutes les
 * configurations balayées). La courbe retenue, `pulsar`, est une épaule
 * seule (`pulsarToneMap`) : identité stricte sous le pivot — tout le contenu
 * SDR traverse INTACT, la parité des fonds est structurelle — et épaule
 * exponentielle douce au-dessus, où l'énergie additive accumulée roule vers
 * le blanc au lieu d'écrêter (l'objectif du lot). `?tonemap=aces|agx|pulsar`
 * permet de comparer les trois au navigateur sans recompiler.
 */
export const DEFAULT_TONE_MAP: ToneMapCurve = 'pulsar';

export type ToneMapCurve = 'aces' | 'agx' | 'pulsar';

/** Pivot de l'épaule `pulsar` : identité en dessous, compression au-dessus. */
export const PULSAR_SHOULDER_PIVOT = 0.8;

/**
 * Courbe `pulsar` (épaule seule) : f(x) = x sous le pivot P ; au-dessus,
 * P + (1−P)·(1 − e^−(x−P)/(1−P)) — continue ET de dérivée continue en P
 * (e⁰ = 1), asymptote 1. Entrée linéaire ≥ 0, sortie linéaire [0,1[.
 */
export function pulsarToneMap(x: number): number {
  const p = PULSAR_SHOULDER_PIVOT;
  if (x <= p) return x < 0 ? 0 : x;
  return p + (1 - p) * (1 - Math.exp(-(x - p) / (1 - p)));
}

/**
 * Exposition appliquée avant la courbe. 1 = neutre : avec la courbe `pulsar`
 * (identité sous le pivot), le contenu SDR traverse la chaîne INTACT, et
 * seule l'énergie additive accumulée au-delà du pivot va chercher l'épaule.
 * N'existe que pour la comparaison des courbes (`?exposure=` au navigateur —
 * ACES/AgX, dont le pied écrase les fonds sombres, demandent ≥ 2 pour être
 * regardables sur ce produit).
 */
export const HDR_EXPOSURE = 1.0;

// NOTE de calibration (lot 2) : un « gain émissif » sur les dessins additifs
// a été essayé puis RETIRÉ — l'assombrissement qu'il compensait (−56 à −80 %
// sur les styles à glows) venait en réalité d'un bug de déprémultiplication
// par l'alpha ACCUMULÉ des buffers flottants (voir TONEMAP_FS). Corrigé, la
// mesure a montré que le gain neutre (1) est le meilleur réglage global.

/**
 * Seuil du bright-pass en LINÉAIRE. Même intention perceptuelle que le seuil
 * 200/255 du bloom SDR (`bloomMath.HIGHLIGHT_THRESHOLD`) : c'est sa
 * conversion exacte — srgbToLinear(200/255) ≈ 0,578. « Physique » parce
 * qu'il s'applique à l'énergie linéaire, où l'accumulation additive au-delà
 * de 1 existe réellement au lieu d'être écrêtée avant le bloom.
 */
export const BLOOM_THRESHOLD_LINEAR = srgbToLinear(200 / 255);

/**
 * Poids de composition du bloom, réparti sur les niveaux de la chaîne MIP
 * (chaque niveau composite à `BLOOM_INTENSITY / levelCount`). Étalonné à la
 * sonde pour retomber sur la même luminance moyenne que le bloom SDR sur
 * les 8 styles (±25 %).
 */
export const BLOOM_INTENSITY = 0.55;

/** σ du flou gaussien par NIVEAU de la chaîne MIP, en px du niveau. */
export const BLOOM_LEVEL_SIGMA = 2.0;

/** La chaîne MIP compte `passes + 2` niveaux (docs/10 : passes 1-2), bornée par des niveaux ≥ 8 px. */
export function bloomLevelCount(passes: number, baseWidth: number, baseHeight: number): number {
  const wanted = Math.max(1, passes + 2);
  let levels = 0;
  let w = baseWidth;
  let h = baseHeight;
  while (levels < wanted && w >= 8 && h >= 8) {
    levels++;
    w = Math.floor(w / 2);
    h = Math.floor(h / 2);
  }
  return Math.max(1, levels);
}

// ---------------------------------------------------------------------------
// ACES — approximation de Narkowicz (2015), par canal
// ---------------------------------------------------------------------------

/** Entrée : linéaire ≥ 0. Sortie : linéaire [0,1], à encoder en sRGB ensuite. */
export function acesToneMap(x: number): number {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  const y = (x * (a * x + b)) / (x * (c * x + d) + e);
  return y < 0 ? 0 : y > 1 ? 1 : y;
}

// ---------------------------------------------------------------------------
// AgX — ajustement minimal (matrices + polynôme de contraste), look neutre
// ---------------------------------------------------------------------------

/**
 * Matrice d'entrée AgX, stockée COLONNE-MAJEURE (la convention de `mulMat3`
 * et du mat3 GLSL) — l'ordre des 9 valeurs est exactement celui du mat3 de
 * l'ajustement minimal de référence. Matrice NON symétrique : une
 * transposition passerait inaperçue à l'œil mais fausserait les teintes.
 */
export const AGX_MAT: readonly number[] = [
  0.842479062253094, 0.0423282422610123, 0.0423756549057051,
  0.0784335999999992, 0.878468636469772, 0.0784336,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104,
];

/** Matrice inverse de sortie AgX — même convention. */
export const AGX_MAT_INV: readonly number[] = [
  1.19687900512017, -0.0528968517574562, -0.0529716355144438,
  -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
  -0.0990297440797205, -0.0989611768448433, 1.15107367264116,
];

export const AGX_MIN_EV = -12.47393;
export const AGX_MAX_EV = 4.026069;

/** Polynôme de contraste AgX (approximation 6e degré), sur [0,1]. */
export function agxContrast(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

function mulMat3(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]! * v[0] + m[3]! * v[1] + m[6]! * v[2],
    m[1]! * v[0] + m[4]! * v[1] + m[7]! * v[2],
    m[2]! * v[0] + m[5]! * v[1] + m[8]! * v[2],
  ];
}

/**
 * Chaîne AgX complète : entrée linéaire ≥ 0, sortie LINÉAIRE [0,1] (l'EOTF
 * de sortie AgX — pow 2,2, l'approximation d'usage de l'ajustement minimal —
 * est appliqué ici pour que l'appelant encode en sRGB exactement comme pour
 * ACES : une seule convention de sortie pour les deux courbes).
 */
export function agxToneMap(rgb: readonly [number, number, number]): [number, number, number] {
  let v = mulMat3(AGX_MAT, [Math.max(rgb[0], 1e-10), Math.max(rgb[1], 1e-10), Math.max(rgb[2], 1e-10)]);
  const norm = (x: number): number => {
    const ev = Math.log2(Math.max(x, 1e-10));
    const clamped = ev < AGX_MIN_EV ? AGX_MIN_EV : ev > AGX_MAX_EV ? AGX_MAX_EV : ev;
    return (clamped - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
  };
  v = [agxContrast(norm(v[0])), agxContrast(norm(v[1])), agxContrast(norm(v[2]))];
  v = mulMat3(AGX_MAT_INV, v);
  const out = (x: number): number => {
    const c = x < 0 ? 0 : x > 1 ? 1 : x;
    return Math.pow(c, 2.2);
  };
  return [out(v[0]), out(v[1]), out(v[2])];
}
