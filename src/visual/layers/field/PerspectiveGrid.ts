import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Color } from '../../../render/Renderer';
import type { Palette } from '../../palette/Palette';

// docs/08_PRESETS.md, exemple "Trap Dark" : layers.field = { rows: 24, perspective: 0.65 }.
const ROW_COUNT = 24;
const PERSPECTIVE = 0.65;
const MAX_RADIUS = 0.75;
const LINE_WIDTH = 0.0025;

function mod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

/**
 * Field du style Field (docs/07) : « grille en perspective, avancée pilotée
 * par pulse (phase continue, jamais un saut) ». Rendue comme des anneaux
 * concentriques dont le rayon suit une division hyperbolique de la
 * profondeur (`rayon = maxRayon·perspective / (perspective + profondeur)`)
 * — la formule de perspective classique (rayon ∝ 1/profondeur), pas une
 * vraie projection 3D.
 *
 * « Piloté par pulse » : utilise `step.beat.index + step.beat.phase`
 * directement, PAS `signals.pulse` — ce dernier est une sinusoïde (docs/03),
 * qui oscillerait avant/arrière et romprait « jamais un saut ». La grandeur
 * qui avance continûment (sauf seek) est la phase de battement brute.
 */
export class PerspectiveGrid implements Layer {
  readonly id = 'perspectiveGrid';
  readonly kind: LayerKind = 'field';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private scrollDistance = 0;

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(step: StepContext, _signals: VisualSignals): void {
    this.scrollDistance = step.beat.index + step.beat.phase;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const base = this.palette.secondary;
    for (let i = 0; i < ROW_COUNT; i++) {
      const depth = mod(i - this.scrollDistance, ROW_COUNT);
      const radius = (MAX_RADIUS * PERSPECTIVE) / (PERSPECTIVE + depth);
      const alpha = (1 - depth / ROW_COUNT) * 0.35 * base.a;
      const color: Color = { r: base.r, g: base.g, b: base.b, a: alpha };
      renderer.strokeCircle(0, 0, radius, LINE_WIDTH, color);
    }
  }

  reset(_t: number): void {
    // Rien à restaurer : `scrollDistance` est recalculé intégralement par le prochain update().
  }

  dispose(): void {}
}
