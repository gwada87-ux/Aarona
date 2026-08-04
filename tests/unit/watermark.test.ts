import { describe, expect, it } from 'vitest';
import { drawWatermark } from '../../src/export/watermark';
import { FakeRenderer } from './testSupport/FakeRenderer';
import type { Viewport } from '../../src/render/Viewport';

describe('drawWatermark', () => {
  it('place la marque dans le quadrant bas-droit, quel que soit le ratio', () => {
    const landscape: Viewport = { aspect: 16 / 9, safe: { top: 0, right: 0, bottom: 0, left: 0 } };
    const portrait: Viewport = { aspect: 9 / 16, safe: { top: 0, right: 0, bottom: 0, left: 0 } };

    for (const viewport of [landscape, portrait]) {
      const renderer = new FakeRenderer();
      drawWatermark(renderer, viewport);
      const fill = renderer.calls.find((c) => c.type === 'fillCircle');
      expect(fill).toBeDefined();
      if (fill && fill.type === 'fillCircle') {
        expect(fill.x).toBeGreaterThan(0); // droite
        expect(fill.y).toBeLessThan(0); // bas (y vers le haut, Loi 4)
      }
    }
  });

  it('respecte la safe area (recule quand right/bottom sont non nuls)', () => {
    const noSafe: Viewport = { aspect: 16 / 9, safe: { top: 0, right: 0, bottom: 0, left: 0 } };
    const withSafe: Viewport = { aspect: 16 / 9, safe: { top: 0, right: 0.1, bottom: 0.1, left: 0 } };

    const r1 = new FakeRenderer();
    drawWatermark(r1, noSafe);
    const r2 = new FakeRenderer();
    drawWatermark(r2, withSafe);

    const x1 = (r1.calls.find((c) => c.type === 'fillCircle') as { x: number }).x;
    const x2 = (r2.calls.find((c) => c.type === 'fillCircle') as { x: number }).x;
    expect(x2).toBeLessThan(x1); // reculé vers le centre pour respecter la marge de droite
  });

  it('dessine un point plein et un anneau — aucun texte (drawText différé)', () => {
    const viewport: Viewport = { aspect: 1, safe: { top: 0, right: 0, bottom: 0, left: 0 } };
    const renderer = new FakeRenderer();
    drawWatermark(renderer, viewport);
    expect(renderer.calls.map((c) => c.type)).toEqual(['fillCircle', 'strokeCircle']);
  });
});
