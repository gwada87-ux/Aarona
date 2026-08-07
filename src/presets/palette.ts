/**
 * Construction d'une `Palette` runtime (visual/palette) depuis la config JSON
 * d'un preset (docs/08_PRESETS.md) — même logique que `defaultPalette`
 * (visual/palette/Palette.ts), généralisée à un `PresetPaletteConfig`
 * quelconque plutôt qu'aux seules valeurs "Trap Dark" codées en dur.
 *
 * LA DÉRIVE DE TEMPÉRATURE EST INTERPOLÉE EN OKLCH (chantier 9, §9.2)
 * ------------------------------------------------------------------
 * `temperature(energy)` relie deux couleurs choisies dans le preset. Le faire
 * en RGB fait passer le trajet par une zone TERNE : les deux composantes qui
 * s'annulent au croisement ne se compensent pas perceptuellement.
 *
 * Mesuré sur les cinq presets existants, chroma OKLCH du point intermédiaire,
 * interpolation RGB contre interpolation OKLCH :
 *
 * | preset      | pire perte de chroma en RGB |
 * |-------------|------------------------------|
 * | `house`     | **58,5 %** (à un quart du trajet) |
 * | `lofi`      | 23,9 % |
 * | `rnb`       | 18,2 % |
 * | `trap-dark` | 12,6 % |
 * | `drill`     | 5,5 % |
 *
 * `house` dérive de `#402410` (brun sombre) vers `#3CE7FF` (cyan) : en RGB, le
 * premier quart du trajet est un gris. En OKLCH la teinte tourne à chroma
 * presque constant, ce que §9.2 demande explicitement de regarder avant
 * d'inventer quoi que ce soit.
 *
 * Le module de conversion a été remonté de `ui/live/util/` vers `core/color/`
 * pour cela : `visual/` et `presets/` n'ont pas le droit d'importer `ui/`.
 */
import { hexToRgb, mixOklch, oklchToRgb, rgbToOklch, type Oklch } from '../core/color/oklch';
import { hexToColor, type Color, type Palette } from '../visual/palette/Palette';
import type { PresetPaletteConfig } from './schema';

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** `#rrggbb` vers OKLCH. Un hex illisible tombe sur du noir, comme `hexToColor`. */
function hexToOklch(hex: string): Oklch {
  return rgbToOklch(hexToRgb(hex) ?? { r: 0, g: 0, b: 0 });
}

function oklchToColor(c: Oklch): Color {
  const rgb = oklchToRgb(c);
  return { r: rgb.r * 255, g: rgb.g * 255, b: rgb.b * 255, a: 1 };
}

export function buildPalette(id: string, config: PresetPaletteConfig): Palette {
  // Conversion faite UNE FOIS ici, pas à chaque appel de `temperature` : les
  // matrices d'Ottosson coûtent trois racines cubiques par sens.
  const lowEnergy = hexToOklch(config.drift.lowEnergy);
  const highEnergy = hexToOklch(config.drift.highEnergy);
  // Les EXTRÊMES sont rendus tels qu'écrits dans le preset, sans passer par la
  // conversion. L'aller-retour sRGB -> OKLCH -> sRGB est exact à 1e-5 près, mais
  // pas au bit : `#111111` revenait à 17,0000026. C'est invisible à l'écran et
  // sans conséquence sur le rendu, mais `temperature(0)` doit rendre la couleur
  // que l'auteur du preset a TAPÉE, pas une approximation de celle-ci - c'est
  // une propriété de justesse, et deux tests la vérifiaient déjà.
  const lowColor = hexToColor(config.drift.lowEnergy);
  const highColor = hexToColor(config.drift.highEnergy);
  return Object.freeze({
    id,
    bg: [hexToColor(config.bg[0]), hexToColor(config.bg[1])] as const,
    primary: hexToColor(config.primary),
    secondary: hexToColor(config.secondary),
    accent: hexToColor(config.accent),
    glow: hexToColor(config.glow),
    contrast: config.contrast,
    temperature: (energy: number) => {
      const t = clamp01(energy);
      if (t <= 0) return lowColor;
      if (t >= 1) return highColor;
      return oklchToColor(mixOklch(lowEnergy, highEnergy, t));
    },
  });
}
