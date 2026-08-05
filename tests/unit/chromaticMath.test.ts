import { describe, expect, it } from 'vitest';
import { ABERRATION_OFFSET_FRACTION, computeAberrationOffsetPx } from '../../src/render/canvas2d/chromaticMath';

describe('chromaticMath — computeAberrationOffsetPx', () => {
  it('se base sur le PETIT côté du canvas', () => {
    const wide = computeAberrationOffsetPx(1920, 1080);
    const square = computeAberrationOffsetPx(1080, 1080);
    expect(wide).toBeCloseTo(square, 9);
  });

  it('proportionnel à ABERRATION_OFFSET_FRACTION', () => {
    expect(computeAberrationOffsetPx(1000, 1000)).toBeCloseTo(1000 * ABERRATION_OFFSET_FRACTION, 9);
  });

  it('ne descend jamais sous 1px, même sur un très petit canvas', () => {
    expect(computeAberrationOffsetPx(10, 10)).toBe(1);
  });

  it('croît avec la résolution', () => {
    const small = computeAberrationOffsetPx(640, 360);
    const large = computeAberrationOffsetPx(1920, 1080);
    expect(large).toBeGreaterThan(small);
  });
});
