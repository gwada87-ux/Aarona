import type { BloomConfig, Color, Renderer, SpriteHandle, SpriteTransform } from '../Renderer';
import type { Viewport } from '../Viewport';
import { BLOOM_COMPOSITE_ALPHA, computeBlurRadiusPx, computeSmallDimensions, extractHighlights } from './bloomMath';

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
  private feedbackBuffer: OffscreenCanvas | null = null;
  private feedbackCtx: OffscreenCanvasRenderingContext2D | null = null;
  /** `enabled: false` par défaut — un `Canvas2DRenderer` jamais configuré via `setBloomConfig` rend exactement comme avant l'Étape 21. */
  private bloomConfig: BloomConfig = { enabled: false, resolutionScale: 1, passes: 0 };
  private bloomExtractBuffer: OffscreenCanvas | null = null;
  private bloomExtractCtx: OffscreenCanvasRenderingContext2D | null = null;
  private bloomBlurBuffer: OffscreenCanvas | null = null;
  private bloomBlurCtx: OffscreenCanvasRenderingContext2D | null = null;

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

  strokePath(xs: Float32Array, ys: Float32Array, count: number, lineWidth: number, color: Color, closed: boolean): void {
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
    if (closed) this.ctx.closePath();
    this.ctx.stroke();
  }

  fillPath(xs: Float32Array, ys: Float32Array, count: number, color: Color): void {
    if (count < 3) return;
    this.ctx.fillStyle = toCssColor(color);
    this.ctx.beginPath();
    const [x0, y0] = this.toPx(xs[0]!, ys[0]!);
    this.ctx.moveTo(x0, y0);
    for (let i = 1; i < count; i++) {
      const [px, py] = this.toPx(xs[i]!, ys[i]!);
      this.ctx.lineTo(px, py);
    }
    this.ctx.closePath();
    this.ctx.fill();
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

  drawSprite(sprite: SpriteHandle, transforms: readonly SpriteTransform[], count: number): void {
    if (!(sprite instanceof CanvasSpriteHandle)) {
      throw new Error('Canvas2DRenderer.drawSprite: SpriteHandle étranger à ce Renderer');
    }
    const prevComposite = this.ctx.globalCompositeOperation;
    const prevAlpha = this.ctx.globalAlpha;
    this.ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const t = transforms[i]!;
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

  drawFeedback(scale: number, alpha: number): void {
    if (!this.feedbackBuffer) return; // rien capturé encore (première image, ou juste après un seek)
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scaledW = w * scale;
    const scaledH = h * scale;
    const prevAlpha = this.ctx.globalAlpha;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.feedbackBuffer, (w - scaledW) / 2, (h - scaledH) / 2, scaledW, scaledH);
    this.ctx.globalAlpha = prevAlpha;
  }

  captureFeedback(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.feedbackBuffer || this.feedbackBuffer.width !== w || this.feedbackBuffer.height !== h) {
      this.feedbackBuffer = new OffscreenCanvas(w, h);
      this.feedbackCtx = this.feedbackBuffer.getContext('2d');
    }
    // `drawImage(this.canvas, ...)` fonctionne que `this.canvas` soit un
    // <canvas> réel ou un OffscreenCanvas (export) — même méthode des deux côtés.
    this.feedbackCtx!.clearRect(0, 0, w, h);
    this.feedbackCtx!.drawImage(this.canvas, 0, 0);
  }

  setBloomConfig(config: BloomConfig): void {
    this.bloomConfig = config;
  }

  endFrame(): void {
    // `restore()` D'ABORD : annule le décalage de `applyShake()` avant que le bloom ne lise les
    // pixels du canvas — le bloom travaille en espace écran, pas dans l'espace transformé de la frame.
    this.ctx.restore();
    if (this.bloomConfig.enabled) this.applyBloom();
  }

  /**
   * Bloom d'ensemble (docs/07 §"Le bloom d'ensemble", Étape 21) : sous-échantillonnage → extraction
   * des hautes lumières → flou → composition additive, sur l'image COMPOSITE finale de la frame
   * (jamais par couche individuelle — une couche ne sait pas ce que les autres ont dessiné).
   *
   * Écart assumé par rapport à « deux passes de flou séparable » (docs/07) : `ctx.filter =
   * 'blur()'` natif (supporté par toute la matrice navigateurs de docs/11 — Chrome 52+, Firefox
   * 35+, Safari 9.1+) plutôt qu'une convolution séparable écrite à la main. `passes` (docs/10)
   * élargit le RAYON du flou plutôt que de répéter une vraie passe de convolution : un flou gaussien
   * de rayon R et N flous successifs de rayon R/N produisent un résultat visuellement très proche
   * pour un halo stylisé — la différence ne justifie pas la complexité d'un buffer ping-pong pour
   * ce produit. Même résultat DOCUMENTÉ (un halo qui s'étale), mécanisme plus simple.
   *
   * `getImageData`/`putImageData` uniquement sur le PETIT buffer réduit (jamais l'image pleine
   * résolution) — même principe que `FlashLimiter`, qui échantillonne déjà à 32×18 pour la même
   * raison de coût (docs/07 §"Canvas 2D" : `ctx.getImageData()` par image est listé comme un piège,
   * la parade documentée est justement le sous-échantillonnage AVANT lecture des pixels).
   */
  private applyBloom(): void {
    const fullW = this.canvas.width;
    const fullH = this.canvas.height;
    const { width: smallW, height: smallH } = computeSmallDimensions(fullW, fullH, this.bloomConfig.resolutionScale);

    if (!this.bloomExtractBuffer || this.bloomExtractBuffer.width !== smallW || this.bloomExtractBuffer.height !== smallH) {
      this.bloomExtractBuffer = new OffscreenCanvas(smallW, smallH);
      this.bloomExtractCtx = this.bloomExtractBuffer.getContext('2d');
      this.bloomBlurBuffer = new OffscreenCanvas(smallW, smallH);
      this.bloomBlurCtx = this.bloomBlurBuffer.getContext('2d');
    }
    const extractCtx = this.bloomExtractCtx!;
    const blurCtx = this.bloomBlurCtx!;

    // 1. Sous-échantillonnage : image composite pleine résolution -> petit buffer (rééchantillonnage
    //    bilinéaire gratuit via drawImage, même s'il s'agit du même `this.canvas` en source).
    extractCtx.clearRect(0, 0, smallW, smallH);
    extractCtx.drawImage(this.canvas, 0, 0, fullW, fullH, 0, 0, smallW, smallH);

    // 2. Extraction des hautes lumières, en place, sur le petit buffer.
    const imageData = extractCtx.getImageData(0, 0, smallW, smallH);
    extractHighlights(imageData.data);
    extractCtx.putImageData(imageData, 0, 0);

    // 3. Flou natif, rayon fonction du nombre de passes du niveau de qualité.
    const radiusPx = computeBlurRadiusPx(smallW, smallH, this.bloomConfig.passes);
    blurCtx.clearRect(0, 0, smallW, smallH);
    blurCtx.filter = radiusPx > 0 ? `blur(${radiusPx}px)` : 'none';
    blurCtx.drawImage(this.bloomExtractBuffer, 0, 0);
    blurCtx.filter = 'none';

    // 4. Composition additive par-dessus l'image d'origine, remise à l'échelle réelle.
    const prevComposite = this.ctx.globalCompositeOperation;
    const prevAlpha = this.ctx.globalAlpha;
    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.globalAlpha = BLOOM_COMPOSITE_ALPHA;
    this.ctx.drawImage(this.bloomBlurBuffer!, 0, 0, smallW, smallH, 0, 0, fullW, fullH);
    this.ctx.globalCompositeOperation = prevComposite;
    this.ctx.globalAlpha = prevAlpha;
  }
}

function toCssColor(c: Color): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}
