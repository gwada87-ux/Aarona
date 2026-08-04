/**
 * Espace normalisé (Loi 4 — docs/02_ARCHITECTURE.md) : 1,0 = plus petite
 * dimension du viewport, origine au centre, y vers le haut. Volontairement
 * SANS largeur ni hauteur en pixels — la conversion est interne au backend
 * de rendu (Canvas2DRenderer aujourd'hui, WebGL2Renderer en V2).
 */
export interface SafeArea {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface Viewport {
  readonly aspect: number; // largeur / hauteur
  readonly safe: SafeArea;
}

const NO_SAFE_AREA: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

export function createViewport(aspect: number, safe: SafeArea = NO_SAFE_AREA): Viewport {
  return { aspect, safe };
}
