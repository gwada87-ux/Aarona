import type { Viewport } from './Viewport';

export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Sprite pré-rendu (glow additif, docs/07 §"Le glow : jamais shadowBlur"). Opaque côté appelant. */
export interface SpriteHandle {
  readonly size: number;
}

/** Une instance de sprite à dessiner — `drawSprite` prend un tableau pour permettre l'instanciation. */
export interface SpriteTransform {
  readonly x: number;
  readonly y: number;
  /** Taille de rendu en unités normalisées (diamètre) — pas un facteur multipliant `sprite.size`. */
  readonly scale: number;
  readonly alpha: number;
}

/**
 * Interface de dessin (docs/02_ARCHITECTURE.md §Renderer). Complétée en P7
 * avec exactement ce que le style Pulse requiert : `strokeCircle`/`strokePath`
 * (anneaux, forme d'onde circulaire), `fillRadialGradient` (fond), `createSprite`/
 * `drawSprite` (glow additif), `applyShake` (tremblement d'écran, PostFx).
 *
 * `pushLayer`/`popLayer` (compositing hors-écran groupé, ex. feedback de
 * `Field`) restent DIFFÉRÉS — voir docs/JOURNAL.md Étape 9 : aucune couche de
 * Pulse n'a besoin d'un groupe alpha, seulement d'un composite additif par
 * sprite. `drawText` reste différé aussi : aucune couche `Text` avant P12.
 *
 * Toutes les coordonnées reçues sont en espace normalisé (Loi 4).
 */
export interface Renderer {
  beginFrame(viewport: Viewport): void;
  clear(color: Color): void;
  fillCircle(x: number, y: number, radius: number, color: Color): void;

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, color: Color): void;

  /**
   * Chemin fermé à partir de tableaux typés parallèles — zéro allocation
   * par appel côté appelant (docs/10_PERFORMANCE.md). `count` peut être
   * inférieur à la capacité des tableaux (pool pré-alloué plus grand que
   * l'usage courant).
   */
  strokePath(xs: Float32Array, ys: Float32Array, count: number, lineWidth: number, color: Color): void;

  /** Dégradé radial couvrant tout le viewport, centré en (0,0). */
  fillRadialGradient(innerRadius: number, outerRadius: number, inner: Color, outer: Color): void;

  /** Rendu une seule fois dans un canvas hors écran ; réutilisé par `drawSprite`. */
  createSprite(draw: (ctx: OffscreenCanvasRenderingContext2D) => void, size: number): SpriteHandle;

  /** Composite additif (`globalCompositeOperation = 'lighter'`), une traversée pour tout `transforms`. */
  drawSprite(sprite: SpriteHandle, transforms: readonly SpriteTransform[]): void;

  /**
   * Décalage global (unités normalisées) appliqué à tout ce qui est dessiné
   * ENSUITE dans cette frame — PostFx "tremblement d'écran" doit donc être
   * la première couche à dessiner, pas la dernière (docs/07 liste l'ordre
   * conceptuel des couches, pas l'ordre d'exécution : un décalage global ne
   * peut affecter que ce qui est dessiné après lui).
   */
  applyShake(dx: number, dy: number): void;

  endFrame(): void;
}
