import type { Color, Renderer, SpriteHandle, SpriteTransform } from '../Renderer';
import type { Viewport } from '../Viewport';

/**
 * Backend Canvas 2D de `Renderer`. Convertit l'espace normalisé (Loi 4) en
 * pixels à partir des dimensions RÉELLES du `<canvas>` (`canvas.width` /
 * `canvas.height`), pas de `viewport.aspect` — le viewport ne porte pas de
 * pixels, voir docs/02_ARCHITECTURE.md §Renderer.
 *
 * Limite connue (P2, toujours vraie en P7) : `fillStyle` est recalculé en
 * chaîne à chaque appel (`toCssColor`). Acceptable pour Pulse (poignée
 * d'appels/image, pas de boucle par particule) ; à revoir en P9 (`Field`,
 * 2500 particules) avec un cache de couleurs.
 *
 * Non testé automatiquement (nécessiterait un canvas mocké, comme en P2) :
 * vérifié manuellement au navigateur.
 *
 * Accepte `OffscreenCanvas` depuis l'Étape 10/P8 : `ExportPipeline` dessine
 * sur un canvas hors écran, INDÉPENDANT du canvas de preview (docs/09
 * §"Le pipeline déterministe" — étape 1, préparation).
 */
class CanvasSpriteHandle implements SpriteHandle {
  constructor(
    readonly size: number,
    readonly canvas: OffscreenCanvas,
  ) {}
}

type Canvas2DLike = HTMLCanvasElement | OffscreenCanvas;
type Context2DLike = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class Canvas2DRenderer implements Renderer {
  private readonly ctx: Context2DLike;
  private minSide = 0;
  private halfWidth = 0;
  private halfHeight = 0;

  constructor(private readonly canvas: Canvas2DLike) {
    // `getContext('2d')` sur l'union HTMLCanvasElement|OffscreenCanvas perd la
    // surcharge précise de TypeScript (retombe sur `RenderingContext`, qui
    // inclut `ImageBitmapRenderingContext`) : on sait par construction que
    // l'id `'2d'` ne peut renvoyer que l'un des deux types 2D.
    const ctx = canvas.getContext('2d') as Context2DLike | null;
    if (!ctx) {
      throw new Error('Canvas2DRenderer: contexte 2D indisponible');
    }
    this.ctx = ctx;
  }

  beginFrame(_viewport: Viewport): void {
    this.minSide = Math.min(this.canvas.width, this.canvas.height);
    this.halfWidth = this.canvas.width / 2;
    this.halfHeight = this.canvas.height / 2;
    // Un seul save/restore PAR IMAGE (pas par primitive) : c'est ce qui rend
    // applyShake() bon marché malgré la règle "pas de save/restore en boucle
    // serrée" de docs/10_PERFORMANCE.md, qui vise les appels par particule.
    this.ctx.save();
  }

  private toPx(x: number, y: number): [number, number] {
    return [this.halfWidth + x * this.minSide, this.halfHeight - y * this.minSide];
  }

  clear(color: Color): void {
    this.ctx.fillStyle = toCssColor(color);
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  fillCircle(x: number, y: number, radius: number, color: Color): void {
    const [px, py] = this.toPx(x, y);
    const pr = radius * this.minSide;

    this.ctx.fillStyle = toCssColor(color);
    this.ctx.beginPath();
    this.ctx.arc(px, py, pr, 0, Math.PI * 2);
    this.ctx.fill();
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, color: Color): void {
    const [px, py] = this.toPx(x, y);
    this.ctx.strokeStyle = toCssColor(color);
    this.ctx.lineWidth = lineWidth * this.minSide;
    this.ctx.beginPath();
    this.ctx.arc(px, py, radius * this.minSide, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  strokePath(xs: Float32Array, ys: Float32Array, count: number, lineWidth: number, color: Color): void {
    if (count < 2) return;
    this.ctx.strokeStyle = toCssColor(color);
    this.ctx.lineWidth = lineWidth * this.minSide;
    this.ctx.beginPath();
    const [x0, y0] = this.toPx(xs[0]!, ys[0]!);
    this.ctx.moveTo(x0, y0);
    for (let i = 1; i < count; i++) {
      const [px, py] = this.toPx(xs[i]!, ys[i]!);
      this.ctx.lineTo(px, py);
    }
    this.ctx.closePath();
    this.ctx.stroke();
  }

  fillRadialGradient(innerRadius: number, outerRadius: number, inner: Color, outer: Color): void {
    // Recréé par image : acceptable pour un fond, docs/10_PERFORMANCE.md
    // reporte explicitement sa mise en cache à la phase 12 ("fond statique
    // mis en cache"). Pas un fond figé ici : `inner`/`outer` varient avec
    // `brightness`, un cache par couleur exacte thrasherait de toute façon.
    const gradient = this.ctx.createRadialGradient(
      this.halfWidth,
      this.halfHeight,
      innerRadius * this.minSide,
      this.halfWidth,
      this.halfHeight,
      outerRadius * this.minSide,
    );
    gradient.addColorStop(0, toCssColor(inner));
    gradient.addColorStop(1, toCssColor(outer));
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  createSprite(draw: (ctx: OffscreenCanvasRenderingContext2D) => void, size: number): SpriteHandle {
    const offscreen = new OffscreenCanvas(size, size);
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) throw new Error('Canvas2DRenderer.createSprite: contexte 2D hors écran indisponible');
    draw(offCtx);
    return new CanvasSpriteHandle(size, offscreen);
  }

  drawSprite(sprite: SpriteHandle, transforms: readonly SpriteTransform[]): void {
    if (!(sprite instanceof CanvasSpriteHandle)) {
      throw new Error('Canvas2DRenderer.drawSprite: SpriteHandle étranger à ce Renderer');
    }
    const prevComposite = this.ctx.globalCompositeOperation;
    const prevAlpha = this.ctx.globalAlpha;
    this.ctx.globalCompositeOperation = 'lighter';
    for (const t of transforms) {
      const [px, py] = this.toPx(t.x, t.y);
      // `t.scale` : taille de rendu en unités normalisées (diamètre), pas un
      // facteur appliqué à `sprite.size` — cohérent avec `radius` ailleurs
      // dans ce backend, toujours normalisé puis multiplié par `minSide` ici.
      const pixelSize = t.scale * this.minSide;
      this.ctx.globalAlpha = t.alpha;
      this.ctx.drawImage(sprite.canvas, px - pixelSize / 2, py - pixelSize / 2, pixelSize, pixelSize);
    }
    this.ctx.globalCompositeOperation = prevComposite;
    this.ctx.globalAlpha = prevAlpha;
  }

  applyShake(dx: number, dy: number): void {
    this.ctx.translate(dx * this.minSide, -dy * this.minSide);
  }

  endFrame(): void {
    this.ctx.restore();
  }
}

function toCssColor(c: Color): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}
