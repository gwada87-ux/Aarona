import { describe, expect, it } from 'vitest';
import { createViewport } from '../../src/render/Viewport';

/**
 * Reproduit la conversion normalisé -> pixel de Canvas2DRenderer (Loi 4)
 * sans dépendre du DOM. Limite connue : la formule est dupliquée ici plutôt
 * que d'exercer Canvas2DRenderer directement (nécessiterait un canvas
 * réel/mocké) — le rendu réel est vérifié manuellement dans le navigateur.
 */
function toPixel(width: number, height: number, x: number, y: number, r: number) {
  const minSide = Math.min(width, height);
  return {
    x: width / 2 + x * minSide,
    y: height / 2 - y * minSide,
    r: r * minSide,
    minSide,
  };
}

describe('Viewport — espace normalisé (Loi 4)', () => {
  const RATIOS: ReadonlyArray<readonly [string, number, number]> = [
    ['16:9', 1920, 1080],
    ['9:16', 1080, 1920],
    ['1:1', 1080, 1080],
  ];

  it('un cercle centré de rayon 0.3 reste centré et proportionnel au petit côté, pour les 3 ratios', () => {
    for (const [, width, height] of RATIOS) {
      const viewport = createViewport(width / height);
      expect(viewport.aspect).toBeCloseTo(width / height);

      const circle = toPixel(width, height, 0, 0, 0.3);

      expect(circle.x).toBeCloseTo(width / 2, 5);
      expect(circle.y).toBeCloseTo(height / 2, 5);
      expect(circle.r / circle.minSide).toBeCloseTo(0.3, 10);
    }
  });

  it("n'expose ni largeur ni hauteur en pixels", () => {
    const viewport = createViewport(16 / 9);
    expect(Object.keys(viewport).sort()).toEqual(['aspect', 'safe']);
  });
});
