/**
 * Construction d'une `Palette` runtime (visual/palette) depuis la config JSON
 * d'un preset (docs/08_PRESETS.md) — même logique que `defaultPalette`
 * (visual/palette/Palette.ts), généralisée à un `PresetPaletteConfig`
 * quelconque plutôt qu'aux seules valeurs "Trap Dark" codées en dur.
 */
import { hexToColor, lerpColor, type Palette } from '../visual/palette/Palette';
import type { PresetPaletteConfig } from './schema';

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function buildPalette(id: string, config: PresetPaletteConfig): Palette {
  const lowEnergy = hexToColor(config.drift.lowEnergy);
  const highEnergy = hexToColor(config.drift.highEnergy);
  return Object.freeze({
    id,
    bg: [hexToColor(config.bg[0]), hexToColor(config.bg[1])] as const,
    primary: hexToColor(config.primary),
    secondary: hexToColor(config.secondary),
    accent: hexToColor(config.accent),
    glow: hexToColor(config.glow),
    contrast: config.contrast,
    temperature: (energy: number) => lerpColor(lowEnergy, highEnergy, clamp01(energy)),
  });
}
