import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import { lerpColor, type Palette } from '../../palette/Palette';

/** Background du style Pulse (docs/07) : « dégradé radial sombre, teinte pilotée par brightness ». */
export class RadialBackground implements Layer {
  readonly id = 'background';
  readonly kind: LayerKind = 'background';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private brightness = 0;

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(_step: StepContext, signals: VisualSignals): void {
    this.brightness = signals.brightness;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const [dark, darker] = this.palette.bg;
    const inner = lerpColor(dark, darker, this.brightness);
    renderer.fillRadialGradient(0, 1.0, inner, darker);
  }

  reset(_t: number): void {
    // Rien à restaurer : `brightness` est recalculé par le prochain update().
  }

  dispose(): void {}
}
