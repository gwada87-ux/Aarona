/**
 * Tests de `presets/palette.ts::buildPalette()` — Étape 36. Jamais testé
 * directement : `tests/unit/presetResolve.test.ts` couvre déjà `primary` et
 * `temperature()` mais UNIQUEMENT via `resolvePreset()` de bout en bout — pas
 * `bg`/`secondary`/`accent`/`glow`/`contrast`/le gel (`Object.freeze`), et pas
 * le `clamp01` interne à ce fichier (distinct de celui de `visual/palette
 * /Palette.ts`, déjà testé pour `defaultPalette` dans `palette.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { buildPalette } from '../../src/presets/palette';
import { hexToColor } from '../../src/visual/palette/Palette';
import type { PresetPaletteConfig } from '../../src/presets/schema';

function config(overrides: Partial<PresetPaletteConfig> = {}): PresetPaletteConfig {
  return {
    bg: ['#010203', '#040506'],
    primary: '#ff0000',
    secondary: '#00ff00',
    accent: '#0000ff',
    glow: '#ffffff',
    contrast: 0.75,
    drift: { lowEnergy: '#111111', highEnergy: '#eeeeee' },
    ...overrides,
  };
}

describe('buildPalette — champs directs', () => {
  it('reprend id tel quel', () => {
    expect(buildPalette('mon-preset', config()).id).toBe('mon-preset');
  });

  it('convertit bg[0]/bg[1] en Color, dans le même ordre', () => {
    const palette = buildPalette('p', config());
    expect(palette.bg[0]).toEqual(hexToColor('#010203'));
    expect(palette.bg[1]).toEqual(hexToColor('#040506'));
  });

  it('convertit primary/secondary/accent/glow en Color', () => {
    const palette = buildPalette('p', config());
    expect(palette.primary).toEqual(hexToColor('#ff0000'));
    expect(palette.secondary).toEqual(hexToColor('#00ff00'));
    expect(palette.accent).toEqual(hexToColor('#0000ff'));
    expect(palette.glow).toEqual(hexToColor('#ffffff'));
  });

  it('reprend contrast tel quel (aucun clamp)', () => {
    expect(buildPalette('p', config({ contrast: 1.5 })).contrast).toBe(1.5);
  });

  it('renvoie un objet gelé (Object.freeze)', () => {
    expect(Object.isFrozen(buildPalette('p', config()))).toBe(true);
  });
});

describe('buildPalette — temperature() (interpolation drift)', () => {
  it('energy=0 renvoie exactement drift.lowEnergy', () => {
    const palette = buildPalette('p', config());
    expect(palette.temperature(0)).toEqual(hexToColor('#111111'));
  });

  it('energy=1 renvoie exactement drift.highEnergy', () => {
    const palette = buildPalette('p', config());
    expect(palette.temperature(1)).toEqual(hexToColor('#eeeeee'));
  });

  it('energy=0.5 renvoie le point médian', () => {
    const palette = buildPalette('p', config({ drift: { lowEnergy: '#000000', highEnergy: '#ffffff' } }));
    expect(palette.temperature(0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });

  it('clamp interne : energy < 0 se comporte comme energy=0', () => {
    const palette = buildPalette('p', config());
    expect(palette.temperature(-5)).toEqual(palette.temperature(0));
  });

  it('clamp interne : energy > 1 se comporte comme energy=1', () => {
    const palette = buildPalette('p', config());
    expect(palette.temperature(5)).toEqual(palette.temperature(1));
  });
});

describe('buildPalette — indépendance entre appels', () => {
  it('deux appels avec des configs différentes ne partagent aucun état', () => {
    const a = buildPalette('a', config({ primary: '#ff0000' }));
    const b = buildPalette('b', config({ primary: '#00ff00' }));
    expect(a.primary).toEqual(hexToColor('#ff0000'));
    expect(b.primary).toEqual(hexToColor('#00ff00'));
  });
});
