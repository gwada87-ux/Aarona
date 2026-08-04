import type { Color, Renderer } from '../Renderer';
import type { Viewport } from '../Viewport';

/**
 * Backend Canvas 2D de `Renderer`. Convertit l'espace normalisé (Loi 4) en
 * pixels à partir des dimensions RÉELLES du `<canvas>` (`canvas.width` /
 * `canvas.height`), pas de `viewport.aspect` — le viewport ne porte pas de
 * pixels, voir docs/02_ARCHITECTURE.md §Renderer.
 *
 * Limite connue (P2) : `fillStyle` est recalculé en chaîne à chaque appel.
 * Acceptable ici (2 appels/image), mais interdit dans une boucle par
 * particule (règle de perf de CLAUDE.md) — à revoir en P7/P9 avec un cache
 * de couleurs ou des sprites pré-rendus.
 */
export class Canvas2DRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private minSide = 0;
  private halfWidth = 0;
  private halfHeight = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas2DRenderer: contexte 2D indisponible');
    }
    this.ctx = ctx;
  }

  beginFrame(_viewport: Viewport): void {
    this.minSide = Math.min(this.canvas.width, this.canvas.height);
    this.halfWidth = this.canvas.width / 2;
    this.halfHeight = this.canvas.height / 2;
  }

  clear(color: Color): void {
    this.ctx.fillStyle = toCssColor(color);
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  fillCircle(x: number, y: number, radius: number, color: Color): void {
    const px = this.halfWidth + x * this.minSide;
    const py = this.halfHeight - y * this.minSide;
    const pr = radius * this.minSide;

    this.ctx.fillStyle = toCssColor(color);
    this.ctx.beginPath();
    this.ctx.arc(px, py, pr, 0, Math.PI * 2);
    this.ctx.fill();
  }

  endFrame(): void {
    // Rien à faire pour l'instant (pas de double-buffer explicite).
  }
}

function toCssColor(c: Color): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}
