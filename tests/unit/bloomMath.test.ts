import { describe, expect, it } from 'vitest';
import { computeBlurRadiusPx, computeSmallDimensions, extractHighlights, HIGHLIGHT_THRESHOLD } from '../../src/render/canvas2d/bloomMath';

describe('bloomMath — computeSmallDimensions', () => {
  it('applique resolutionScale et arrondit', () => {
    expect(computeSmallDimensions(1920, 1080, 0.25)).toEqual({ width: 480, height: 270 });
  });

  it('ne descend jamais sous 1×1, même à une échelle minuscule', () => {
    expect(computeSmallDimensions(10, 10, 0.001)).toEqual({ width: 1, height: 1 });
  });
});

describe('bloomMath — computeBlurRadiusPx', () => {
  it('passes=0 → rayon nul', () => {
    expect(computeBlurRadiusPx(480, 270, 0)).toBe(0);
  });

  it('le rayon croît avec le nombre de passes', () => {
    const r1 = computeBlurRadiusPx(480, 270, 1);
    const r2 = computeBlurRadiusPx(480, 270, 2);
    expect(r2).toBeGreaterThan(r1);
    expect(r2).toBeCloseTo(r1 * 2, 9); // linéaire en passes, par construction
  });

  it('se base sur le PETIT côté du buffer', () => {
    const wide = computeBlurRadiusPx(1000, 100, 1);
    const square = computeBlurRadiusPx(100, 100, 1);
    expect(wide).toBeCloseTo(square, 9);
  });
});

describe('bloomMath — extractHighlights', () => {
  function pixel(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
    return new Uint8ClampedArray([r, g, b, a]);
  }

  it('un pixel sous le seuil est mis à zéro (RGBA)', () => {
    const px = pixel(HIGHLIGHT_THRESHOLD - 1, 10, 10, 200);
    extractHighlights(px);
    expect(Array.from(px)).toEqual([0, 0, 0, 0]);
  });

  it('un pixel exactement au seuil est mis à zéro (borne inclusive côté zéro)', () => {
    const px = pixel(HIGHLIGHT_THRESHOLD, 0, 0, 255);
    extractHighlights(px);
    expect(Array.from(px)).toEqual([0, 0, 0, 0]);
  });

  it('un pixel blanc pur (255) traverse inchangé (facteur 1)', () => {
    const px = pixel(255, 255, 255, 255);
    extractHighlights(px);
    expect(Array.from(px)).toEqual([255, 255, 255, 255]);
  });

  it('un pixel rouge saturé pur est détecté comme point chaud (brightness = max, pas la luma)', () => {
    const px = pixel(255, 0, 0, 255);
    extractHighlights(px);
    expect(px[0]).toBe(255); // canal dominant inchangé (facteur 1)
    expect(px[1]).toBe(0);
    expect(px[2]).toBe(0);
    expect(px[3]).toBe(255); // alpha non touché pour un pixel conservé
  });

  it('un pixel juste au-dessus du seuil est fortement atténué (transition douce, pas un couperet dur)', () => {
    const px = pixel(HIGHLIGHT_THRESHOLD + 1, 0, 0, 255);
    extractHighlights(px);
    expect(px[0]!).toBeGreaterThan(0);
    expect(px[0]!).toBeLessThan(10); // facteur ≈ 1/(255-seuil), donc une petite valeur
  });

  it('traite plusieurs pixels dans le même buffer, indépendamment', () => {
    const buf = new Uint8ClampedArray([
      10, 10, 10, 255, // sous le seuil
      255, 255, 255, 255, // au-dessus
    ]);
    extractHighlights(buf);
    expect(Array.from(buf.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(buf.subarray(4, 8))).toEqual([255, 255, 255, 255]);
  });

  it('accepte un seuil personnalisé', () => {
    const px = pixel(50, 50, 50, 255);
    extractHighlights(px, 30);
    expect(px[0]!).toBeGreaterThan(0); // 50 > 30, conservé (atténué)
  });
});
