/**
 * Conversion OKLCH <-> sRGB (§3.5).
 *
 * MUST : la conversion est faite DANS LE CODE, pas deleguee au support de
 * `oklch()` dans `fillStyle`. Deux raisons : le support navigateur n'est pas
 * universel, et surtout on a besoin d'INTERPOLER dans un espace perceptuel -
 * ce qu'une chaine CSS ne permet pas.
 *
 * Matrices d'Ottosson (Oklab, 2020). Fonctions pures, aucune allocation.
 *
 * Rappel de la difference qui compte ici : en OKLCH, `L` est une clarte
 * PERCEPTUELLE. Deux couleurs de meme `L` paraissent aussi claires l'une que
 * l'autre, ce qui n'est vrai ni en HSL ni en HSV - et c'est exactement ce qui
 * fait qu'une rotation de teinte a `L` constant ne produit pas de « trou »
 * sombre au passage du bleu.
 */

export interface Oklch {
  /** Clarte perceptuelle, 0 = noir, 1 = blanc diffus. */
  readonly l: number;
  /** Chroma. 0 = gris. Au-dela de ~0,33 la couleur sort du gamut sRGB. */
  readonly c: number;
  /** Teinte en DEGRES, 0-360. */
  readonly h: number;
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Composante lineaire -> sRGB code (courbe de transfert sRGB, pas une gamma 2.2). */
function linearToSrgb(x: number): number {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return clamp01(v);
}

function srgbToLinear(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** OKLCH -> sRGB, composantes 0-1. Les couleurs hors gamut sont ECRETEES, pas mappees. */
export function oklchToRgb(color: Oklch): Rgb {
  const rad = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(rad);
  const bb = color.c * Math.sin(rad);

  const lp = color.l + 0.3963377774 * a + 0.2158037573 * bb;
  const mp = color.l - 0.1055613458 * a - 0.0638541728 * bb;
  const sp = color.l - 0.0894841775 * a - 1.291485548 * bb;

  const l = lp * lp * lp;
  const m = mp * mp * mp;
  const s = sp * sp * sp;

  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** sRGB (composantes 0-1) -> OKLCH. Reciproque exacte de `oklchToRgb` dans le gamut. */
export function rgbToOklch(color: Rgb): Oklch {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const ll = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const aa = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.hypot(aa, bb);
  let h = (Math.atan2(bb, aa) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: ll, c, h: c < 1e-7 ? 0 : h };
}

const HEX = '0123456789abcdef';

/** `#rrggbb` depuis des composantes 0-1. Sans `toString(16)` : pas d'allocation intermediaire. */
export function rgbToHex(color: Rgb): string {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  return `#${HEX[r >> 4]}${HEX[r & 15]}${HEX[g >> 4]}${HEX[g & 15]}${HEX[b >> 4]}${HEX[b & 15]}`;
}

export function oklchToHex(color: Oklch): string {
  return rgbToHex(oklchToRgb(color));
}

/** Parse `#rgb` ou `#rrggbb` en composantes 0-1. Retourne `null` si la chaine n'est pas reconnue. */
export function hexToRgb(hex: string): Rgb | null {
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  if (s.length === 3) {
    const r = Number.parseInt(s[0] ?? '', 16);
    const g = Number.parseInt(s[1] ?? '', 16);
    const b = Number.parseInt(s[2] ?? '', 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r: (r * 17) / 255, g: (g * 17) / 255, b: (b * 17) / 255 };
  }
  if (s.length !== 6) return null;
  const n = Number.parseInt(s, 16);
  if (Number.isNaN(n)) return null;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/**
 * Interpolation PERCEPTUELLE entre deux couleurs OKLCH. La teinte suit le
 * chemin le plus court sur le cercle - sans ca, un fondu violet -> orange
 * traverserait le vert.
 */
export function mixOklch(a: Oklch, b: Oklch, t: number): Oklch {
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  let h = a.h + dh * t;
  if (h < 0) h += 360;
  if (h >= 360) h -= 360;
  return { l: a.l + (b.l - a.l) * t, c: a.c + (b.c - a.c) * t, h };
}

/**
 * Luminance relative WCAG, depuis des composantes sRGB 0-1. Utilisee pour le
 * critere §8.11 (rapport >= 4:1 entre le fond et le highlight de chaque
 * palette). DIFFERENT du `L` d'OKLCH : celui-ci est perceptuel et non
 * lineaire, celui-la est une luminance physique ponderee Rec. 709.
 */
export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * srgbToLinear(color.r) + 0.7152 * srgbToLinear(color.g) + 0.0722 * srgbToLinear(color.b)
  );
}

/** Rapport de contraste WCAG entre deux couleurs, 1 a 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
