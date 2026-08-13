import type { Renderer } from './Renderer';
import { Canvas2DRenderer } from './canvas2d/Canvas2DRenderer';
import { WebGL2Renderer } from './webgl2/WebGL2Renderer';
import { chooseBackend, isWebGL2Available, type RendererOverride } from './backendChoice';
import type { ToneMapCurve } from './webgl2/hdrMath';

export interface RendererOptions {
  readonly toneMap?: ToneMapCurve;
  readonly exposure?: number;
}

/**
 * Fabrique UNIQUE d'un backend de rendu (ADR-013, lot 3). Tous les points du
 * produit qui ont besoin d'un `Renderer` passent par ici — l'aperçu ET
 * l'export, qui DOIVENT partager le même backend : sinon l'aperçu montrerait
 * le rendu HDR du lot 2 et la vidéo livrerait autre chose, et le critère
 * golden « preview ≡ export » comparerait deux rasterizers différents, ce
 * qu'ADR-013 exclut explicitement.
 *
 * Vit dans `render/` et non dans `ui/` pour une raison d'architecture : le
 * pipeline d'export (`export/`) en a besoin et n'a pas le droit d'importer
 * `ui/` (docs/02, tableau des dépendances). La DÉCISION de l'utilisateur,
 * elle, reste bien dans `ui/` : c'est `ui/App.ts` qui lit `?renderer=` et
 * passe l'`override` — cette fabrique ne connaît ni l'URL ni le DOM.
 *
 * Ne jette jamais : un WebGL2 refusé (pilote sur liste noire, contexte
 * indisponible, shaders rejetés) retombe silencieusement sur Canvas 2D.
 */
export function createRenderer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  override: RendererOverride,
  options?: RendererOptions,
): Renderer {
  if (chooseBackend(override, isWebGL2Available()) === 'webgl2') {
    try {
      return new WebGL2Renderer(canvas, options);
    } catch (err) {
      // Repli SILENCIEUX côté image, VISIBLE côté console : l'utilisateur voit
      // un rendu correct, le développeur sait pourquoi il n'a pas le GPU.
      console.warn('PULSAR - WebGL2 indisponible, repli Canvas 2D :', err);
    }
  }
  return new Canvas2DRenderer(canvas);
}

/**
 * Libère le contexte WebGL d'un renderer qui ne servira plus (sans effet sur
 * un `Canvas2DRenderer`). À appeler après chaque EXPORT : un navigateur borne
 * le nombre de contextes WebGL vivants (~16) et tue le PLUS ANCIEN au-delà —
 * or le plus ancien est celui de l'aperçu. Sans cette libération, une dizaine
 * d'exports successifs feraient perdre son contexte à l'aperçu, qui
 * basculerait en Canvas 2D sans que rien ne l'explique.
 */
export function disposeRenderer(renderer: Renderer): void {
  if (renderer instanceof WebGL2Renderer) renderer.dispose();
}
