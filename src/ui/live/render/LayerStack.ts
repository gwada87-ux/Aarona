/**
 * Calques du pipeline live (§3.1).
 *
 * Trois interdits structurants, appliques ici plutot que rappeles ailleurs :
 *
 * 1. **Pas d'`OffscreenCanvas`.** Sur le thread principal il n'apporte aucun
 *    gain - l'acceleration est identique a celle d'un `<canvas>` detache - et
 *    son contexte 2D ne supporte pas `filter` sur Safari (toutes versions) ni
 *    Firefox < 116. Tous les buffers sont des `document.createElement('canvas')`
 *    jamais inseres dans le DOM.
 * 2. **Pas de `willReadFrequently`** sur un calque du pipeline : c'est une
 *    bascule logicielle PERMANENTE dans Chrome. Seul le buffer de mesure
 *    32x18 de `FlashLimiter` a le droit de le porter, et il n'est pas un
 *    calque du pipeline.
 * 3. **`ctx.filter` est un etat PERSISTANT du contexte**, que ni `beginPath()`
 *    ni un changement de composite ne reinitialisent. L'oubli d'un
 *    `filter = 'none'` floute silencieusement tout ce qui suit - bug classique,
 *    tres couteux a diagnostiquer. `withFilter` est le SEUL point d'ecriture
 *    autorise de `ctx.filter` dans tout le code.
 *
 * Le plafond memoire n'est pas cosmetique : Safari plafonne la memoire canvas
 * GLOBALE a ~224-256 Mo, et au-dela `getContext()` renvoie `null` - pas une
 * exception, `null`. D'ou `LayerBudget`, et d'ou le test systematique du
 * retour de `getContext`.
 */

import type { LiveRenderConfig } from '../LiveConfig';

/**
 * Feature-test de `ctx.filter`.
 *
 * MUST : le test naif `c.filter = 'blur(1px)'; c.filter === 'blur(1px)'` donne
 * un FAUX POSITIF sur Safari - la propriete n'existant pas sur le prototype,
 * l'affectation cree une simple propriete propre qui se relit a l'identique.
 * Il faut interroger le PROTOTYPE.
 */
export const HAS_CTX_FILTER =
  typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

/** Surface minimale attendue d'un canvas - permet de tester sans DOM. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d', options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
}

export type CanvasFactory = () => CanvasLike;

const BYTES_PER_PIXEL = 4;

/**
 * Inventaire memoire des calques. Pur et testable : c'est la partie ou une
 * erreur coute un `getContext()` a `null` en production, donc un ecran noir.
 */
export class LayerBudget {
  private used = 0;

  constructor(readonly limitBytes: number) {}

  get bytes(): number {
    return this.used;
  }

  get megabytes(): number {
    return this.used / (1024 * 1024);
  }

  /** Reste-t-il de la place pour un buffer `w x h` ? */
  fits(w: number, h: number): boolean {
    return this.used + w * h * BYTES_PER_PIXEL <= this.limitBytes;
  }

  reserve(w: number, h: number): boolean {
    const cost = w * h * BYTES_PER_PIXEL;
    if (this.used + cost > this.limitBytes) return false;
    this.used += cost;
    return true;
  }

  release(w: number, h: number): void {
    this.used = Math.max(0, this.used - w * h * BYTES_PER_PIXEL);
  }

  reset(): void {
    this.used = 0;
  }
}

/** Un buffer hors ecran, avec son contexte. */
export class Layer {
  readonly canvas: CanvasLike;
  readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;

  private constructor(canvas: CanvasLike, ctx: CanvasRenderingContext2D, readonly opaque: boolean) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** Retourne `null` si le contexte est indisponible - Safari au plafond memoire. */
  static create(factory: CanvasFactory, opaque: boolean): Layer | null {
    const canvas = factory();
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { alpha: !opaque });
    if (!ctx) return null;
    return new Layer(canvas, ctx, opaque);
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  /**
   * Ecrire `canvas.width` REINITIALISE tout l'etat du contexte et vide le
   * bitmap. On ne le fait donc qu'en cas de changement reel, et on reapplique
   * explicitement l'etat derriere - sinon `imageSmoothingEnabled` et
   * `filter` reviennent a leurs defauts sans prevenir.
   */
  resize(w: number, h: number): boolean {
    const nw = Math.max(1, Math.round(w));
    const nh = Math.max(1, Math.round(h));
    if (nw === this.w && nh === this.h) return false;
    this.canvas.width = nw;
    this.canvas.height = nh;
    this.w = nw;
    this.h = nh;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    if (HAS_CTX_FILTER) this.ctx.filter = 'none';
    return true;
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    if (this.opaque) {
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(0, 0, this.w, this.h);
    } else {
      this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  /**
   * Libere le backing store. `width = 0; height = 0` est le SEUL moyen de le
   * rendre de facon deterministe - et Safari compte les canvas non collectes
   * dans son plafond global.
   */
  dispose(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.w = 0;
    this.h = 0;
  }
}

/**
 * Applique un filtre le temps d'une operation, puis le remet a `'none'`.
 *
 * SEUL point d'ecriture autorise de `ctx.filter` (§3.1). Sur un navigateur
 * sans support, le filtre est simplement ignore et `fn` s'execute quand meme :
 * l'appelant DOIT donc avoir un chemin de repli visuellement acceptable, pas
 * seulement fonctionnel.
 */
export function withFilter(ctx: CanvasRenderingContext2D, filter: string, fn: () => void): void {
  if (!HAS_CTX_FILTER) {
    fn();
    return;
  }
  ctx.filter = filter;
  try {
    fn();
  } finally {
    ctx.filter = 'none';
  }
}

/** Remet l'etat de composition a neutre. A appeler en fin de chaque module (§3.1). */
export function resetCompositing(ctx: CanvasRenderingContext2D): void {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (HAS_CTX_FILTER) ctx.filter = 'none';
}

export type LayerName =
  | 'scene'
  | 'feedbackA'
  | 'feedbackB'
  | 'bright'
  | 'blurA'
  | 'blurB'
  | 'post'
  | 'tint';

/**
 * Allocation, redimensionnement et liberation des calques, sous plafond
 * memoire. Les calques d'effets OPTIONNELS sont alloues a la demande et
 * liberes des leur desactivation par `FrameBudget`.
 */
export class LayerStack {
  readonly budget: LayerBudget;
  /** `true` si une allocation a echoue : le pipeline doit passer en mode degrade. */
  degraded = false;

  private readonly layers = new Map<LayerName, Layer>();
  private readonly opaqueNames: ReadonlySet<LayerName>;

  constructor(
    config: LiveRenderConfig,
    private readonly factory: CanvasFactory = defaultFactory,
  ) {
    this.budget = new LayerBudget(config.layerMemoryLimitMb * 1024 * 1024);
    // Les buffers OPAQUES sont un prerequis, pas une optimisation : sur un
    // buffer transparent, `'multiply'` contre un primaire laisse passer la
    // source telle quelle (alpha du fond = 0 => co = Cs), ce qui rend le
    // seuil de bright pass et la teinte d'aberration totalement inoperants.
    this.opaqueNames = new Set<LayerName>(['bright', 'tint', 'post']);
  }

  /** Alloue si besoin, redimensionne, et retourne le calque. `null` si le plafond est atteint. */
  acquire(name: LayerName, w: number, h: number): Layer | null {
    const target = { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
    let layer = this.layers.get(name);
    if (layer) {
      if (layer.width === target.w && layer.height === target.h) return layer;
      this.budget.release(layer.width, layer.height);
    } else {
      layer = Layer.create(this.factory, this.opaqueNames.has(name)) ?? undefined;
      if (!layer) {
        this.degraded = true;
        return null;
      }
      this.layers.set(name, layer);
    }
    if (!this.budget.reserve(target.w, target.h)) {
      this.degraded = true;
      layer.dispose();
      this.layers.delete(name);
      return null;
    }
    layer.resize(target.w, target.h);
    return layer;
  }

  get(name: LayerName): Layer | null {
    return this.layers.get(name) ?? null;
  }

  /** Libere un calque d'effet devenu inutile. */
  release(name: LayerName): void {
    const layer = this.layers.get(name);
    if (!layer) return;
    this.budget.release(layer.width, layer.height);
    layer.dispose();
    this.layers.delete(name);
  }

  disposeAll(): void {
    for (const layer of this.layers.values()) layer.dispose();
    this.layers.clear();
    this.budget.reset();
    this.degraded = false;
  }
}

function defaultFactory(): CanvasLike {
  return document.createElement('canvas');
}
