import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import { lerpColor, type Palette } from '../../palette/Palette';

const ANIMATION_SPEED = 0.06; // rad/s — « très légèrement animé », non chiffré par docs/07

/** Background du style Spectrum Pro (docs/07) : « dégradé bicolore, très légèrement animé ». */
export class AnimatedDuotone implements Layer {
  readonly id = 'animatedDuotone';
  readonly kind: LayerKind = 'background';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private t = 0;

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(step: StepContext, _signals: VisualSignals): void {
    this.t = step.t;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    // Animation lente et bornée (Loi 1 : fonction pure de `t`, jamais de l'horloge réelle).
    const drift = (Math.sin(this.t * ANIMATION_SPEED) + 1) / 2;
    const inner = lerpColor(this.palette.bg[0], this.palette.bg[1], 0.3 + 0.2 * drift);
    renderer.fillRadialGradient(0, 1.1, inner, this.palette.bg[1]);
  }

  reset(_t: number): void {}
  dispose(): void {}
}
