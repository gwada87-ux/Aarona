import type { Color } from '../../render/Renderer';

/**
 * Ré-exporté ici : `presets/` construit des `Palette`, donc manipule des
 * couleurs, et la règle de dépendance lui interdit `render/`. Une couleur de
 * palette est légitimement une notion de palette. Même précédent que
 * `BlendMode`, ré-exporté par `visual/scene/Layer.ts` pour la même raison.
 */
export type { Color };

/**
 * Palette — pas une liste de couleurs, un système (docs/07_VISUAL_ENGINE.md
 * §"Palettes"). `temperature` est ce qui fait dériver la palette avec
 * l'énergie du morceau sans jamais de changement brutal.
 */
export interface Palette {
  readonly id: string;
  readonly bg: readonly [Color, Color];
  readonly primary: Color;
  readonly secondary: Color;
  readonly accent: Color;
  readonly glow: Color;
  readonly contrast: number;
  readonly temperature: (energy: number) => Color;
}

export function hexToColor(hex: string, alpha = 1): Color {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return { r, g, b, a: alpha };
}

export function lerpColor(a: Color, b: Color, t: number): Color {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

/**
 * Palette par défaut — copie fidèle des valeurs "Trap Dark" de
 * docs/08_PRESETS.md, seul exemple de palette concret documenté (les
 * presets eux-mêmes sont hors périmètre, P11). Sert de palette de
 * démonstration au harnais et de valeur par défaut avant qu'un système de
 * presets n'existe.
 */
export const defaultPalette: Palette = Object.freeze({
  id: 'trap-dark',
  bg: [hexToColor('#05060B'), hexToColor('#0D0A18')] as const,
  primary: hexToColor('#7B4CFF'),
  secondary: hexToColor('#2A1B5E'),
  accent: hexToColor('#FF2E63'),
  glow: hexToColor('#8A5CFF'),
  contrast: 0.85,
  temperature: (energy: number) => lerpColor(hexToColor('#3A2A6B'), hexToColor('#FF2E63'), clamp01(energy)),
});

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
