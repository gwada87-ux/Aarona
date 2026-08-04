import type { Color, Renderer, SpriteHandle, SpriteTransform } from '../../../src/render/Renderer';
import type { Viewport } from '../../../src/render/Viewport';

export type RecordedCall =
  | { type: 'beginFrame'; viewport: Viewport }
  | { type: 'clear'; color: Color }
  | { type: 'fillCircle'; x: number; y: number; radius: number; color: Color }
  | { type: 'strokeCircle'; x: number; y: number; radius: number; lineWidth: number; color: Color }
  | { type: 'strokePath'; xs: Float32Array; ys: Float32Array; count: number; lineWidth: number; color: Color }
  | { type: 'fillRadialGradient'; innerRadius: number; outerRadius: number; inner: Color; outer: Color }
  | { type: 'drawSprite'; sprite: SpriteHandle; transforms: readonly SpriteTransform[] }
  | { type: 'applyShake'; dx: number; dy: number }
  | { type: 'endFrame' };

/**
 * Double de test pour `Renderer` : enregistre les appels au lieu de dessiner.
 * `Renderer` étant une interface découplée du Canvas (docs/02 §Renderer),
 * cette classe permet de tester le COMPORTEMENT des couches (quels appels,
 * avec quels arguments) sans navigateur ni canvas mocké — seul le backend
 * `Canvas2DRenderer` lui-même reste vérifiable uniquement au navigateur.
 */
export class FakeRenderer implements Renderer {
  readonly calls: RecordedCall[] = [];

  beginFrame(viewport: Viewport): void {
    this.calls.push({ type: 'beginFrame', viewport });
  }

  clear(color: Color): void {
    this.calls.push({ type: 'clear', color });
  }

  fillCircle(x: number, y: number, radius: number, color: Color): void {
    this.calls.push({ type: 'fillCircle', x, y, radius, color });
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, color: Color): void {
    this.calls.push({ type: 'strokeCircle', x, y, radius, lineWidth, color });
  }

  strokePath(xs: Float32Array, ys: Float32Array, count: number, lineWidth: number, color: Color): void {
    this.calls.push({ type: 'strokePath', xs: xs.slice(0, count), ys: ys.slice(0, count), count, lineWidth, color });
  }

  fillRadialGradient(innerRadius: number, outerRadius: number, inner: Color, outer: Color): void {
    this.calls.push({ type: 'fillRadialGradient', innerRadius, outerRadius, inner, outer });
  }

  createSprite(_draw: (ctx: OffscreenCanvasRenderingContext2D) => void, size: number): SpriteHandle {
    return { size }; // ne pas invoquer `_draw` : aucun OffscreenCanvasRenderingContext2D en environnement Node
  }

  drawSprite(sprite: SpriteHandle, transforms: readonly SpriteTransform[]): void {
    this.calls.push({ type: 'drawSprite', sprite, transforms });
  }

  applyShake(dx: number, dy: number): void {
    this.calls.push({ type: 'applyShake', dx, dy });
  }

  endFrame(): void {
    this.calls.push({ type: 'endFrame' });
  }
}

export const testViewport: Viewport = { aspect: 16 / 9, safe: { top: 0, right: 0, bottom: 0, left: 0 } };
