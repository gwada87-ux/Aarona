/**
 * Finition et post-traitement (§3.4). Expose UN SEUL `composite()` (§5).
 *
 * Ordre d'application fixe (§4.4) : aberration -> grain -> overlay
 * multiplicatif (vignette + scanlines). Sans ordre fixe, le rendu n'est pas
 * reproductible d'une session a l'autre.
 *
 * Blending, rappel de §3.4 : `'lighter'` = `a + b`, additif, sature a blanc,
 * pour TOUTE source de lumiere - bloom, particules, trainees. `'screen'` =
 * `1 - (1-a)(1-b)`, ne sature jamais, desature, UNIQUEMENT pour des voiles
 * atmospheriques non saturants. Ils ne sont pas interchangeables.
 */

import type { LiveRenderConfig } from '../LiveConfig';
import { Assets } from './Assets';
import { Layer, resetCompositing, type LayerStack } from './LayerStack';

export interface PostOptions {
  /** Deplacement d'aberration en pixels DEVICE. Sous `aberrationGatePx`, l'effet est saute. */
  readonly aberrationPx: number;
  /** Intensite du grain, 0-1. */
  readonly grain: number;
  /** Poser l'overlay vignette + scanlines. */
  readonly overlay: boolean;
  /** Inclure les scanlines dans l'overlay (overlay expressif, §4.4). */
  readonly scanlines: boolean;
}

const PROBE_W = 32;
const PROBE_H = 18;
const PROBE_INTERVAL = 4;

export class PostFX {
  /** Luminance moyenne du dernier cadre mesure, 0-1 (§2.8). */
  meanLuminance = 0;
  /** Passes plein ecran consommees par le dernier `composite()`. */
  lastPasses = 0;

  private probeCanvas: HTMLCanvasElement | null = null;
  private probeCtx: CanvasRenderingContext2D | null = null;
  private probeCounter = 0;
  private grainSeed = 1;

  constructor(
    private readonly config: LiveRenderConfig,
    private readonly stack: LayerStack,
    private readonly assets: Assets,
  ) {}

  /**
   * Compose `src` sur `dst`. `src` est le buffer de feedback (lecture seule) ;
   * `dst` est le canvas VISIBLE ou le buffer de post, selon le diviseur de
   * resolution.
   */
  composite(src: Layer, dst: CanvasRenderingContext2D, w: number, h: number, opts: PostOptions): void {
    let passes = 0;
    dst.setTransform(1, 0, 0, 1, 0, 0);
    dst.imageSmoothingEnabled = true;

    // Cout PONDERE PAR L'AIRE : le buffer de teinte de l'aberration est en
    // demi-resolution, il coute donc un quart de passe, pas une.
    passes += this.drawAberration(src, dst, w, h, opts.aberrationPx);

    if (opts.grain > 0) {
      this.assets.drawGrain(dst, w, h, opts.grain, this.nextRandom);
      passes += 1;
    }

    if (opts.overlay) {
      this.assets.ensureOverlay(w, h, opts.scanlines);
      this.assets.drawOverlay(dst, w, h);
      passes += 1;
    }

    resetCompositing(dst);
    this.lastPasses = passes;
  }

  /**
   * Aberration chromatique : 2 canaux, DEMI-RESOLUTION, gatee.
   *
   * Le vert reste en place - deux canaux suffisent, pas trois, et ca divise
   * par trois le nombre de passes. Le buffer de teinte DOIT etre opaque : sur
   * un buffer transparent, `'multiply'` contre un primaire laisse passer la
   * source telle quelle (alpha du fond = 0 => co = Cs) et l'ecran devient
   * rouge uni.
   *
   * Le « 0,5 px au repos » du brief initial ne produit rien de visible : d'ou
   * la porte a 1 px device, sous laquelle on saute tout.
   */
  private drawAberration(src: Layer, dst: CanvasRenderingContext2D, w: number, h: number, px: number): number {
    const source = src.canvas as CanvasImageSource;
    if (px < this.config.aberrationGatePx) {
      dst.globalCompositeOperation = 'source-over';
      dst.globalAlpha = 1;
      dst.drawImage(source, 0, 0, w, h);
      resetCompositing(dst);
      return 1;
    }
    const clamped = Math.min(px, this.config.aberrationMaxPx);
    const hw = Math.max(1, Math.round(w / 2));
    const hh = Math.max(1, Math.round(h / 2));
    const tint = this.stack.acquire('tint', hw, hh);
    if (!tint) {
      dst.globalCompositeOperation = 'source-over';
      dst.globalAlpha = 1;
      dst.drawImage(source, 0, 0, w, h);
      resetCompositing(dst);
      return 1;
    }

    dst.globalCompositeOperation = 'source-over';
    dst.globalAlpha = 1;
    dst.drawImage(source, 0, 0, w, h);
    dst.globalCompositeOperation = 'lighter';

    const tctx = tint.ctx;
    for (let i = 0; i < 2; i++) {
      const color = i === 0 ? '#ff0000' : '#0000ff';
      const dx = i === 0 ? clamped : -clamped;
      tctx.globalCompositeOperation = 'copy';
      tctx.globalAlpha = 1;
      tctx.drawImage(source, 0, 0, hw, hh);
      tctx.globalCompositeOperation = 'multiply';
      tctx.fillStyle = color;
      tctx.fillRect(0, 0, hw, hh);
      resetCompositing(tctx);
      // `'lighter'` : le noir n'ajoute rien, seuls les canaux teintes comptent.
      dst.drawImage(tint.canvas as CanvasImageSource, dx, 0, w, h);
    }
    resetCompositing(dst);
    // 1 blit plein ecran + 2 remontees plein ecran + 4 dessins en demi-
    // resolution (2 copies + 2 teintes), soit 4 x 1/4 = 1 passe equivalente.
    return 4;
  }

  /**
   * Mesure de luminance moyenne (§2.8), une trame sur quatre, sur un
   * downscale 32x18 reutilise. C'est la SEULE lecture de pixels du pipeline,
   * et elle ne porte jamais sur un calque pleine resolution.
   */
  measure(source: CanvasImageSource): void {
    this.probeCounter = (this.probeCounter + 1) % PROBE_INTERVAL;
    if (this.probeCounter !== 0) return;
    const ctx = this.ensureProbe();
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, PROBE_W, PROBE_H);
    const { data } = ctx.getImageData(0, 0, PROBE_W, PROBE_H);
    let sum = 0;
    const pixels = PROBE_W * PROBE_H;
    for (let i = 0; i < pixels; i++) {
      const o = i * 4;
      sum += (0.2126 * (data[o] ?? 0) + 0.7152 * (data[o + 1] ?? 0) + 0.0722 * (data[o + 2] ?? 0)) / 255;
    }
    this.meanLuminance = sum / pixels;
  }

  dispose(): void {
    this.stack.release('tint');
    if (this.probeCanvas) {
      this.probeCanvas.width = 0;
      this.probeCanvas.height = 0;
    }
    this.probeCanvas = null;
    this.probeCtx = null;
    this.meanLuminance = 0;
  }

  private ensureProbe(): CanvasRenderingContext2D | null {
    if (this.probeCtx) return this.probeCtx;
    const canvas = document.createElement('canvas');
    canvas.width = PROBE_W;
    canvas.height = PROBE_H;
    // `willReadFrequently` est LEGITIME ici et seulement ici : ce buffer 32x18
    // n'est pas un calque du pipeline, c'est une sonde de mesure - meme
    // exception que celle deja accordee a `FlashLimiter`.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    this.probeCanvas = canvas;
    this.probeCtx = ctx;
    return ctx;
  }

  private readonly nextRandom = (): number => {
    this.grainSeed = (this.grainSeed * 1664525 + 1013904223) >>> 0;
    return this.grainSeed / 4294967296;
  };
}
