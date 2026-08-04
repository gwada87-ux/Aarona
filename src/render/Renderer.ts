import type { Viewport } from './Viewport';

export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Interface de dessin (docs/02_ARCHITECTURE.md §Renderer). Sous-ensemble
 * minimal nécessaire à P2 : sera complétée en P7 (pushLayer/popLayer,
 * strokePath, drawSprite instancié, drawText, createSprite).
 * Toutes les coordonnées reçues sont en espace normalisé (Loi 4).
 */
export interface Renderer {
  beginFrame(viewport: Viewport): void;
  clear(color: Color): void;
  fillCircle(x: number, y: number, radius: number, color: Color): void;
  endFrame(): void;
}
