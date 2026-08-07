/**
 * Bright pass et bloom (§3.2).
 *
 * Le chemin PAR DEFAUT est une cascade de resolutions, universelle : descente
 * 1/4 -> 1/8 -> 1/16 puis remontee additive PAR PALIERS. `imageSmoothingEnabled`
 * fournit le bilineaire, et trois etages approchent correctement une
 * gaussienne. `ctx.filter = 'blur()'` n'est qu'un BONUS de qualite, active si
 * `HAS_CTX_FILTER` - il n'existe pas sur Safari, ou la couverture reelle est
 * d'environ 80 % du trafic. Tout le pipeline d'image serait mort sur iOS s'il
 * en dependait.
 *
 * Deux artefacts anticipes :
 *
 * (a) Le modele de dessin HTML rend la forme sur un bitmap TRANSPARENT avant
 *     d'appliquer le filtre : un `blur()` plein cadre aspire du transparent
 *     depuis l'exterieur et assombrit tout le pourtour sur environ 3 sigma.
 *     Le prompt propose d'allouer une marge de `ceil(3 sigma)` et de ne
 *     recomposer que l'interieur. On obtient le meme resultat sans buffer
 *     supplementaire ni comptabilite d'offset en REPLIQUANT les bords avant
 *     de flouter : le filtre aspire alors la couleur du bord au lieu du vide.
 * (b) Remonter un 1/8 directement en pleine resolution donne un halo
 *     visiblement CARRE. D'ou la remontee par paliers.
 *
 * MUST : les rayons sont exprimes en pixels du BITMAP DE SORTIE, recalcules
 * depuis sa hauteur (`sigma = k * bufferH / 1080`), jamais en px CSS. Les
 * coordonnees de filtre ne sont pas affectees par la matrice de
 * transformation : un `setTransform(dpr, ...)` suivi de `blur(8px)` floute de
 * 8 pixels device, pas 8 px CSS.
 *
 * Correction d'une idee fausse repandue : `shadowBlur` et `filter: blur()`
 * passent par le meme `SkBlurImageFilter` dans Skia. Le probleme de
 * `shadowBlur` n'est pas l'acceleration, c'est qu'il s'applique PAR OPERATION
 * DE DESSIN. Il n'est donc interdit qu'a l'interieur d'une boucle de formes.
 */

import type { LiveRenderConfig } from '../LiveConfig';
import {
  HAS_CTX_FILTER,
  Layer,
  resetCompositing,
  withFilter,
  type LayerStack,
} from './LayerStack';

/** Hauteur de reference des rayons de flou. */
const SIGMA_REFERENCE_HEIGHT = 1080;

export class Bloom {
  constructor(
    private readonly config: LiveRenderConfig,
    private readonly stack: LayerStack,
  ) {}

  /** Rayon de flou en pixels du bitmap de sortie, pour une hauteur de buffer donnee. */
  sigmaFor(bufferHeight: number): number {
    return (this.config.bloomSigmaAt1080 * bufferHeight) / SIGMA_REFERENCE_HEIGHT;
  }

  /**
   * Extrait les hautes lumieres de `scene`, les floute, et les recompose en
   * additif sur `dst`. `scales` vient de `FrameBudget` : 0 = pas de bloom.
   *
   * Retourne le cout en passes PLEIN ECRAN, PONDERE PAR L'AIRE : une passe sur
   * un buffer au quart de la resolution lineaire coute 1/16 de passe, pas 1.
   * C'est la seule lecture sous laquelle les budgets de §3.7 (10 / 6 / 3) sont
   * atteignables - et c'est aussi la seule qui corresponde a ce que coute
   * reellement le remplissage.
   */
  apply(
    scene: Layer,
    dst: CanvasRenderingContext2D,
    w: number,
    h: number,
    scales: number,
    refArea: number,
    /** Multiplicateur venu d'`IntensityDirector` (§2.8). 1 = gain nominal. */
    gainScale = 1,
  ): number {
    if (scales <= 0 || gainScale <= 0) return 0;
    const cost = (bw: number, bh: number, draws: number): number => (refArea > 0 ? (bw * bh * draws) / refArea : 0);
    const w4 = Math.max(1, Math.round(w / 4));
    const h4 = Math.max(1, Math.round(h / 4));
    const bright = this.stack.acquire('bright', w4, h4);
    if (!bright) return 0;

    this.brightPass(scene, bright, w4, h4);
    // 3 dessins en variante A, 2 en variante B, tous a 1/4 de resolution.
    let passes = cost(w4, h4, HAS_CTX_FILTER ? 2 : 3);

    if (scales >= 2) {
      const w8 = Math.max(1, Math.round(w / 8));
      const h8 = Math.max(1, Math.round(h / 8));
      const small = this.stack.acquire('blurA', w8, h8);
      if (small) {
        // Descente puis remontee PAR PALIERS : 1/8 -> 1/4, jamais 1/8 -> 1/1.
        small.ctx.globalCompositeOperation = 'copy';
        small.ctx.globalAlpha = 1;
        small.ctx.drawImage(bright.canvas as CanvasImageSource, 0, 0, w8, h8);
        resetCompositing(small.ctx);
        this.blur(small, this.sigmaFor(h8));

        bright.ctx.globalCompositeOperation = 'lighter';
        bright.ctx.globalAlpha = 0.7;
        bright.ctx.drawImage(small.canvas as CanvasImageSource, 0, 0, w4, h4);
        resetCompositing(bright.ctx);
        passes += cost(w8, h8, 3) + cost(w4, h4, 1);
      }
    } else {
      this.stack.release('blurA');
    }

    this.blur(bright, this.sigmaFor(h4));
    passes += cost(w4, h4, 2);

    // SEULE passe reellement plein ecran du bloom : la recomposition.
    dst.globalCompositeOperation = 'lighter';
    dst.globalAlpha = this.config.bloomGain * gainScale;
    dst.imageSmoothingEnabled = true;
    dst.drawImage(bright.canvas as CanvasImageSource, 0, 0, w, h);
    resetCompositing(dst);
    return passes + cost(w, h, 1);
  }

  /**
   * Seuil de luminance.
   *
   * « Seuil via `globalCompositeOperation` » n'est pas une recette :
   * `'luminosity'` est un blend NON SEPARABLE qui n'extrait rien, et un
   * `'multiply'` sur un buffer TRANSPARENT ne s'applique pas du tout - avec un
   * alpha de fond nul, la formule W3C donne `co = Cs`. D'ou le prerequis
   * absolu : le buffer de bright pass est OPAQUE (`alpha: false`, garanti par
   * `LayerStack`).
   */
  private brightPass(scene: Layer, bright: Layer, w4: number, h4: number): void {
    const ctx = bright.ctx;
    const src = scene.canvas as CanvasImageSource;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;

    if (HAS_CTX_FILTER) {
      // Variante B : VRAI seuil sur la luminance. `grayscale()` porte les
      // coefficients Rec. 709, `contrast()` pivote sur 0,5 :
      //   sortie = (bK * x - 0.5) * cK + 0.5
      //   passage a zero en x = 0.5 * (1 - 1/cK) / bK
      // donc pour un seuil T : bK = 0.5 * (1 - 1/cK) / T.
      const cK = this.config.bloomContrast;
      const bK = (0.5 * (1 - 1 / cK)) / Math.max(0.01, this.config.bloomThreshold);
      ctx.globalCompositeOperation = 'copy';
      withFilter(ctx, `grayscale(1) brightness(${bK}) contrast(${cK})`, () => {
        ctx.drawImage(src, 0, 0, w4, h4);
      });
      // Le masque est en niveaux de gris : on le RECOLORISE par la scene.
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(src, 0, 0, w4, h4);
    } else {
      // Variante A : universelle, sans `ctx.filter`. Seuil doux par canal
      // x -> x^3 (0,5 -> 0,125 ; 0,9 -> 0,73 ; 1 -> 1).
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(src, 0, 0, w4, h4);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(src, 0, 0, w4, h4);
      ctx.drawImage(src, 0, 0, w4, h4);
    }
    resetCompositing(ctx);
  }

  /**
   * Interface UNIQUE de flou. Deux implementations : `ctx.filter` quand il
   * existe, cascade de resolutions sinon.
   */
  private blur(layer: Layer, sigmaPx: number): void {
    if (sigmaPx < 0.5) return;
    if (HAS_CTX_FILTER) {
      this.clampEdges(layer);
      const ctx = layer.ctx;
      ctx.globalCompositeOperation = 'copy';
      withFilter(ctx, `blur(${sigmaPx.toFixed(2)}px)`, () => {
        ctx.drawImage(layer.canvas as CanvasImageSource, 0, 0);
      });
      resetCompositing(ctx);
      return;
    }
    this.cascadeBlur(layer);
  }

  /**
   * Replique les bords d'un pixel vers l'exterieur avant le flou : le filtre
   * aspire alors la couleur du bord au lieu du transparent, et le pourtour ne
   * s'assombrit plus. Equivaut a la marge de `ceil(3 sigma)` du prompt, sans
   * buffer supplementaire.
   */
  private clampEdges(layer: Layer): void {
    const { ctx } = layer;
    const w = layer.width;
    const h = layer.height;
    const src = layer.canvas as CanvasImageSource;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(src, 0, 0, w, 1, 0, -1, w, 1);
    ctx.drawImage(src, 0, h - 1, w, 1, 0, h, w, 1);
    ctx.drawImage(src, 0, 0, 1, h, -1, 0, 1, h);
    ctx.drawImage(src, w - 1, 0, 1, h, w, 0, 1, h);
    resetCompositing(ctx);
  }

  /**
   * Flou par cascade : descente en 1/2 deux fois puis remontee, le bilineaire
   * du `drawImage` faisant office de noyau. Se fait EN PLACE sur le calque,
   * en s'appuyant sur un buffer temporaire deux fois plus petit.
   */
  private cascadeBlur(layer: Layer): void {
    const w = layer.width;
    const h = layer.height;
    const half = this.stack.acquire('blurB', Math.max(1, w >> 1), Math.max(1, h >> 1));
    if (!half) return;
    const src = layer.canvas as CanvasImageSource;

    half.ctx.globalCompositeOperation = 'copy';
    half.ctx.globalAlpha = 1;
    half.ctx.imageSmoothingEnabled = true;
    half.ctx.drawImage(src, 0, 0, half.width, half.height);
    // Second aller-retour : deux passes bilineaires successives donnent un
    // noyau nettement plus proche d'une gaussienne qu'une seule.
    half.ctx.drawImage(half.canvas as CanvasImageSource, 0, 0, half.width >> 1 || 1, half.height >> 1 || 1);
    half.ctx.drawImage(
      half.canvas as CanvasImageSource,
      0,
      0,
      half.width >> 1 || 1,
      half.height >> 1 || 1,
      0,
      0,
      half.width,
      half.height,
    );
    resetCompositing(half.ctx);

    layer.ctx.globalCompositeOperation = 'copy';
    layer.ctx.globalAlpha = 1;
    layer.ctx.imageSmoothingEnabled = true;
    layer.ctx.drawImage(half.canvas as CanvasImageSource, 0, 0, w, h);
    resetCompositing(layer.ctx);
  }
}
