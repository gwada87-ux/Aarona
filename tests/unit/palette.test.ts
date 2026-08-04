import { describe, expect, it } from 'vitest';
import { defaultPalette, hexToColor, lerpColor } from '../../src/visual/palette/Palette';

describe('hexToColor', () => {
  it('convertit un hex 6 chiffres en Color', () => {
    expect(hexToColor('#FF2E63')).toEqual({ r: 255, g: 46, b: 99, a: 1 });
  });

  it('accepte une alpha explicite', () => {
    expect(hexToColor('#000000', 0.5)).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });
});

describe('lerpColor', () => {
  it('interpole chaque canal linéairement', () => {
    const a = { r: 0, g: 0, b: 0, a: 0 };
    const b = { r: 100, g: 200, b: 50, a: 1 };
    expect(lerpColor(a, b, 0.5)).toEqual({ r: 50, g: 100, b: 25, a: 0.5 });
  });

  it('t=0 retourne a, t=1 retourne b', () => {
    const a = { r: 10, g: 20, b: 30, a: 1 };
    const b = { r: 90, g: 80, b: 70, a: 0 };
    expect(lerpColor(a, b, 0)).toEqual(a);
    expect(lerpColor(a, b, 1)).toEqual(b);
  });
});

describe('defaultPalette', () => {
  it('temperature(0)/(1) retombent sur les couleurs drift de docs/08 (Trap Dark)', () => {
    expect(defaultPalette.temperature(0)).toEqual(hexToColor('#3A2A6B'));
    expect(defaultPalette.temperature(1)).toEqual(hexToColor('#FF2E63'));
  });

  it('clampe une énergie hors [0,1]', () => {
    expect(defaultPalette.temperature(-5)).toEqual(defaultPalette.temperature(0));
    expect(defaultPalette.temperature(5)).toEqual(defaultPalette.temperature(1));
  });
});
