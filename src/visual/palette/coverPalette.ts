/**
 * Palette extraite d'une pochette (docs/17_PHASE2_VISUELS.md §7.5, chantier 7).
 *
 * Transforme les couleurs dominantes rendues par `quantize` en une `Palette`
 * utilisable, avec la garantie de contraste de §9.2.
 *
 * CE QUI REND CETTE FONCTION DÉLICATE
 * -----------------------------------
 * Une palette écrite à la main est relue par un humain avant d'être livrée.
 * Une palette extraite ne l'est jamais : elle doit être correcte pour TOUTE
 * image, y compris une pochette entièrement noire, entièrement blanche, ou
 * monochrome. Chaque étape ci-dessous existe pour un de ces cas.
 *
 * §7.5 est explicite sur la conduite à tenir : « si elle échoue [le contraste],
 * corrige la luminance plutôt que de refuser — une pochette sombre est un cas
 * normal, pas une erreur ». Aucun chemin de cette fonction ne rejette une
 * image.
 *
 * Fonction PURE et déterministe : mêmes couleurs en entrée, même palette en
 * sortie. C'est ce qui permet à l'export de reconstruire exactement la palette
 * de l'aperçu.
 */

import type { Color } from '../../render/Renderer';
import { contrastRatio, ensureContrast, relativeLuminance } from './contrast';
import { lerpColor, type Palette } from './Palette';

/** Luminance maximale du fond. Une pochette claire ne doit pas donner un fond blanc. */
const BG_MAX_LUMINANCE = 0.08;
/** Saturation minimale attendue d'un accent, en écart max-min sur 255. */
const MIN_CHROMA = 24;

export interface CoverPaletteReport {
  readonly palette: Palette;
  /** `true` si la garantie de contraste a dû corriger au moins une couleur. */
  readonly corrected: boolean;
  /** Rapport de contraste final entre le fond et la couleur la plus intense. */
  readonly contrast: number;
  /** `true` si l'image était trop monochrome pour en tirer un accent distinct. */
  readonly monochrome: boolean;
}

/**
 * @param dominant couleurs rendues par `quantize`, de la plus peuplée à la
 *                 moins peuplée.
 * @param id       identifiant de la palette produite.
 */
export function paletteFromCover(dominant: readonly Color[], id = 'cover'): CoverPaletteReport {
  // Aucune couleur exploitable — image vide ou entièrement transparente. On
  // rend une palette neutre plutôt que de lever : l'appelant est une action
  // utilisateur, pas un chemin de code fautif.
  if (dominant.length === 0) {
    const neutral = greyPalette(id);
    return { palette: neutral, corrected: true, contrast: contrastRatio(neutral.bg[1], neutral.primary), monochrome: true };
  }

  // FOND : la couleur dominante, ramenée au sombre. La dominante d'une pochette
  // est presque toujours son fond réel, donc c'est le bon choix sémantique —
  // mais un fond clair rendrait tout le reste illisible, quelle que soit la
  // suite. On garde sa TEINTE et on lui impose une luminance basse.
  const base = dominant[0]!;
  const bgDark = darkenTo(base, BG_MAX_LUMINANCE);
  const bgDarker = darkenTo(base, BG_MAX_LUMINANCE * 0.45);

  // ACCENT : la couleur la plus CHROMATIQUE, pas la deuxième plus peuplée.
  // Sur une pochette sombre avec un petit logo vif, le deuxième rang est encore
  // un gris ; c'est le logo qu'on veut.
  const byChroma = [...dominant].map((c) => ({ c, chroma: chromaOf(c) })).sort((a, b) => b.chroma - a.chroma);
  const bestChroma = byChroma[0]!;
  const monochrome = bestChroma.chroma < MIN_CHROMA;
  // Image monochrome : aucun accent à extraire. Plutôt que d'inventer une
  // couleur qui n'est pas dans l'image, on assume le monochrome et on joue sur
  // la seule luminance — ce qui reste fidèle à la pochette.
  const accentRaw = monochrome ? lighten(base, 0.75) : bestChroma.c;

  // PRIMAIRE : une couleur intermédiaire, prise dans l'image quand c'est
  // possible. `dominant[1]` est le second rang de population ; à défaut, un
  // mélange fond/accent, qui appartient encore à la gamme de l'image.
  const primaryRaw = dominant[1] ?? lerpColor(base, accentRaw, 0.5);

  const primary = ensureContrast(saturateIfFlat(primaryRaw), bgDarker);
  const accent = ensureContrast(accentRaw, bgDarker);
  const glow = lighten(accent, 0.25);
  const secondary = lerpColor(bgDark, primary, 0.45);

  const contrast = Math.max(contrastRatio(bgDarker, accent), contrastRatio(bgDarker, primary));
  const corrected = primary !== primaryRaw || accent !== accentRaw;

  const lowEnergy = lerpColor(bgDark, primary, 0.3);
  const highEnergy = accent;

  return {
    palette: Object.freeze({
      id,
      bg: [bgDark, bgDarker] as const,
      primary,
      secondary,
      accent,
      glow,
      // Contraste nominal du preset : on rend la valeur MESURÉE, normalisée,
      // plutôt qu'une constante — une palette extraite d'une image très
      // contrastée mérite d'en profiter.
      contrast: Math.min(1, contrast / 8),
      temperature: (energy: number) => lerpColor(lowEnergy, highEnergy, energy < 0 ? 0 : energy > 1 ? 1 : energy),
    }),
    corrected,
    contrast,
    monochrome,
  };
}

/** Écart max-min des canaux : une mesure de saturation qui ne coûte rien. */
function chromaOf(c: Color): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
}

/** Ramène une couleur sous une luminance cible en préservant sa teinte. */
function darkenTo(c: Color, maxLuminance: number): Color {
  let lo = 0;
  let hi = 1;
  let best: Color = { r: 0, g: 0, b: 0, a: 1 };
  if (relativeLuminance(c) <= maxLuminance) return { ...c, a: 1 };
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const candidate: Color = { r: c.r * mid, g: c.g * mid, b: c.b * mid, a: 1 };
    if (relativeLuminance(candidate) <= maxLuminance) {
      best = candidate;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

function lighten(c: Color, t: number): Color {
  return { r: c.r + (255 - c.r) * t, g: c.g + (255 - c.g) * t, b: c.b + (255 - c.b) * t, a: 1 };
}

/**
 * Une couleur intermédiaire complètement grise donnerait un rendu terne. Si
 * elle l'est, on la pousse légèrement — sans inventer une teinte, en amplifiant
 * l'écart qu'elle a déjà.
 */
function saturateIfFlat(c: Color): Color {
  if (chromaOf(c) >= MIN_CHROMA) return c;
  const mean = (c.r + c.g + c.b) / 3;
  const k = 1.6;
  return {
    r: clamp255(mean + (c.r - mean) * k),
    g: clamp255(mean + (c.g - mean) * k),
    b: clamp255(mean + (c.b - mean) * k),
    a: 1,
  };
}

function clamp255(x: number): number {
  return x < 0 ? 0 : x > 255 ? 255 : x;
}

function greyPalette(id: string): Palette {
  const bg: Color = { r: 10, g: 10, b: 12, a: 1 };
  const bg2: Color = { r: 4, g: 4, b: 6, a: 1 };
  const primary: Color = { r: 170, g: 172, b: 180, a: 1 };
  const accent: Color = { r: 225, g: 228, b: 235, a: 1 };
  return Object.freeze({
    id,
    bg: [bg, bg2] as const,
    primary,
    secondary: lerpColor(bg, primary, 0.45),
    accent,
    glow: accent,
    contrast: 0.7,
    temperature: (energy: number) => lerpColor(primary, accent, energy < 0 ? 0 : energy > 1 ? 1 : energy),
  });
}
