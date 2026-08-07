/**
 * Assets generes du pipeline live (§3.4, §5) : tuile de grain, sprite de halo,
 * et overlay vignette + scanlines PRE-COMPOSE. Reconstruits au resize
 * uniquement - jamais par trame.
 *
 * Trois pieges nommes par le prompt, tous traites ici :
 *
 * 1. **Le grain est ADDITIF, pas `overlay`.** `overlay(Cb, Cs) = 2 * Cb * Cs`
 *    quand `Cb <= 0.5` : sur un fond VJ sombre (Cb autour de 0,03) le grain
 *    est attenue d'un facteur ~0,06, il disparait exactement la ou le banding
 *    vit. Combine a `globalAlpha = 0.04`, le delta applique est strictement
 *    nul apres quantification 8 bits. En additif a pleine opacite, il fait ce
 *    que fait le grain argentique - maximal dans les basses lumieres - et sert
 *    de dithering valide contre le banding.
 * 2. **La tuile est generee sur un canvas JETABLE puis transferee.** Un canvas
 *    ayant subi `putImageData` peut rester bascule sur le chemin logiciel dans
 *    Chrome ; on ne veut pas de ca sur un asset lu a chaque trame.
 * 3. **Les scanlines ne sont jamais N traits** mais un `CanvasPattern` mis en
 *    cache, pose par un unique `fillRect` : 1 passe au lieu de 540 appels.
 *    Ici elles sont meme fondues dans l'overlay multiplicatif avec la
 *    vignette - 2 passes deviennent 1.
 */

import type { LiveRenderConfig } from '../LiveConfig';
import { Layer, resetCompositing, type CanvasFactory, type CanvasLike } from './LayerStack';

/** PRNG seede : la tuile de grain doit etre reproductible d'une session a l'autre. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Assets {
  /** Tuile de grain, prete a etre posee en `'lighter'`. */
  private grainLayer: Layer | null = null;
  private grainPattern: CanvasPattern | null = null;
  /** Sprite de halo additif, pour les particules de qualite 3. */
  private glowLayer: Layer | null = null;
  /** Overlay multiplicatif vignette + scanlines, a la taille du bitmap de post. */
  private overlayLayer: Layer | null = null;
  private overlayW = 0;
  private overlayH = 0;
  private overlayScanlines = false;
  private grainOffsetX = 0;
  private grainOffsetY = 0;

  constructor(
    private readonly config: LiveRenderConfig,
    private readonly factory: CanvasFactory = () => document.createElement('canvas'),
  ) {}

  get glowSprite(): CanvasLike | null {
    return this.glowLayer?.canvas ?? null;
  }

  get glowSize(): number {
    return this.glowLayer?.width ?? 0;
  }

  get overlay(): CanvasLike | null {
    return this.overlayLayer?.canvas ?? null;
  }

  /** Construit ce qui ne depend pas de la taille. Idempotent. */
  ensureStatic(ctx: CanvasRenderingContext2D): void {
    this.ensureGrain(ctx);
    this.ensureGlow();
  }

  /**
   * Reconstruit l'overlay si la taille - ou la presence des scanlines - a
   * change. Jamais par trame : c'est une texture, pas un effet.
   *
   * La vignette est de la FINITION PERMANENTE (§4.4) ; les scanlines sont un
   * overlay EXPRESSIF, que `FrameBudget` retire des la qualite 2. Les deux
   * cohabitent quand meme dans une seule texture parce que §3.4 impose de ne
   * pas depenser deux passes multiplicatives pour ca - d'ou la reconstruction
   * sur bascule plutot que deux textures resident en memoire.
   */
  ensureOverlay(w: number, h: number, withScanlines: boolean): void {
    if (this.overlayLayer && this.overlayW === w && this.overlayH === h && this.overlayScanlines === withScanlines) {
      return;
    }
    const layer = this.overlayLayer ?? Layer.create(this.factory, true);
    if (!layer) return;
    this.overlayLayer = layer;
    layer.resize(w, h);
    this.overlayW = w;
    this.overlayH = h;
    this.overlayScanlines = withScanlines;
    this.paintOverlay(layer, w, h, withScanlines);
  }

  /**
   * Pose le grain sur `ctx`. La tuile est translatee d'un nombre ENTIER de
   * pixels a chaque trame : une translation fractionnaire ferait interpoler la
   * tuile, ce qui la floute et lui fait perdre precisement la propriete de
   * dithering qu'on cherche.
   */
  drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, rng: () => number): void {
    if (!this.grainPattern || amount <= 0) return;
    const size = this.config.grainTileSize;
    this.grainOffsetX = Math.floor(rng() * size);
    this.grainOffsetY = Math.floor(rng() * size);
    this.grainPattern.setTransform(new DOMMatrix().translate(this.grainOffsetX, this.grainOffsetY));
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = amount;
    ctx.fillStyle = this.grainPattern;
    ctx.fillRect(0, 0, w, h);
    resetCompositing(ctx);
  }

  /** Pose l'overlay vignette + scanlines. Une seule passe multiplicative. */
  drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const overlay = this.overlayLayer;
    if (!overlay) return;
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 1;
    ctx.drawImage(overlay.canvas as CanvasImageSource, 0, 0, w, h);
    resetCompositing(ctx);
  }

  dispose(): void {
    this.grainLayer?.dispose();
    this.glowLayer?.dispose();
    this.overlayLayer?.dispose();
    this.grainLayer = null;
    this.glowLayer = null;
    this.overlayLayer = null;
    this.grainPattern = null;
    this.overlayW = 0;
    this.overlayH = 0;
  }

  private ensureGrain(hostCtx: CanvasRenderingContext2D): void {
    if (this.grainPattern) return;
    const size = this.config.grainTileSize;

    // Canvas JETABLE : c'est lui qui subit `putImageData`, pas l'asset final.
    const scratch = this.factory();
    scratch.width = size;
    scratch.height = size;
    const sctx = scratch.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!sctx) return;
    const image = sctx.createImageData(size, size);
    const rng = mulberry32(0x9e3779b9);
    const max = this.config.grainAmplitude255;
    for (let i = 0; i < image.data.length; i += 4) {
      const v = Math.round(rng() * max);
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    sctx.putImageData(image, 0, 0);

    const layer = Layer.create(this.factory, true);
    if (!layer) return;
    layer.resize(size, size);
    layer.ctx.drawImage(scratch as CanvasImageSource, 0, 0);
    // Le canvas jetable est libere immediatement : il porte la bascule
    // logicielle, il ne doit pas survivre a la construction.
    scratch.width = 0;
    scratch.height = 0;

    this.grainLayer = layer;
    this.grainPattern = hostCtx.createPattern(layer.canvas as CanvasImageSource, 'repeat');
  }

  private ensureGlow(): void {
    if (this.glowLayer) return;
    const size = 64;
    const layer = Layer.create(this.factory, false);
    if (!layer) return;
    layer.resize(size, size);
    const ctx = layer.ctx;
    const r = size / 2;
    const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
    // Profil en cloche plutot qu'en cone : un degrade lineaire donne un halo
    // au bord net, visible des qu'on en superpose plusieurs.
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.16)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    this.glowLayer = layer;
  }

  /**
   * Vignette et scanlines dans UNE texture multiplicative. Blanc = neutre,
   * sombre = attenue.
   */
  private paintOverlay(layer: Layer, w: number, h: number, withScanlines: boolean): void {
    const ctx = layer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const outer = Math.hypot(cx, cy);
    const vignette = ctx.createRadialGradient(cx, cy, outer * 0.35, cx, cy, outer);
    vignette.addColorStop(0, 'rgba(255,255,255,1)');
    vignette.addColorStop(1, `rgba(0,0,0,${this.config.vignetteStrength})`);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    // Scanlines : une rangee sombre toutes les `scanlinePeriodPx`, sur des
    // coordonnees ENTIERES - un trait d'epaisseur 1 pose sur une coordonnee
    // fractionnaire s'etale sur deux rangees grises et scintille (§3.4).
    // Cette boucle n'est PAS un chemin chaud : elle ne tourne qu'au resize.
    if (withScanlines) {
      const period = Math.max(2, Math.round(this.config.scanlinePeriodPx));
      const shade = Math.round(255 * (1 - this.config.scanlineStrength));
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      for (let y = 0; y < h; y += period) {
        ctx.fillRect(0, Math.round(y), w, 1);
      }
    }
    resetCompositing(ctx);
  }
}
