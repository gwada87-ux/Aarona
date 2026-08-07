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
import { rgbToOklch } from '../../src/core/color/oklch';
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

  it('energy=0.5 renvoie le point médian PERCEPTUEL, pas arithmétique', () => {
    // Chantier 9 : la derive est interpolee en OKLCH. Le milieu perceptuel entre
    // le noir et le blanc n'est PAS 127,5 - c'est un gris nettement plus sombre,
    // parce que la reponse de l'oeil a la luminance n'est pas lineaire. Le
    // milieu arithmetique est precisement ce qui rendait ternes les derives
    // entre deux teintes opposees.
    const palette = buildPalette('p', config({ drift: { lowEnergy: '#000000', highEnergy: '#ffffff' } }));
    const mid = palette.temperature(0.5);
    // 4 decimales : la conversion aller-retour laisse un residu de l'ordre de
    // 1e-5 sur chaque canal, qui n'a aucune existence a l'ecran (les canaux sont
    // arrondis a l'entier au moment du dessin).
    expect(mid.r).toBeCloseTo(mid.g, 4);
    expect(mid.g).toBeCloseTo(mid.b, 4);
    // Milieu OKLCH de #000000 et #ffffff : L = 0,5, soit environ 99/255. Le
    // milieu arithmetique vaudrait 127,5.
    expect(mid.r).toBeLessThan(127.5);
    expect(mid.r).toBeGreaterThan(94);
    expect(mid.r).toBeLessThan(104);
  });

  it('conserve le CHROMA au milieu d\'une derive entre deux teintes', () => {
    // C'est tout l'objet du changement. `house` derive de `#402410` (brun
    // sombre) vers `#3CE7FF` (cyan) : en RGB le premier quart du trajet perdait
    // 58,5 % de son chroma - un gris. Le seuil ci-dessous est tenu par
    // l'interpolation OKLCH et ne l'etait pas par la RGB (0,0306 mesure).
    const palette = buildPalette('p', config({ drift: { lowEnergy: '#402410', highEnergy: '#3CE7FF' } }));
    const q = palette.temperature(0.25);
    const chroma = rgbToOklch({ r: q.r / 255, g: q.g / 255, b: q.b / 255 }).c;
    expect(chroma).toBeGreaterThan(0.06);
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
