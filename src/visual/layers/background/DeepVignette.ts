import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Color } from '../../../render/Renderer';

const CENTER: Color = { r: 8, g: 8, b: 10, a: 1 };
const EDGE: Color = { r: 0, g: 0, b: 0, a: 1 };

/**
 * Background du style Field (docs/07) : « noir profond, vignettage ». Pas
 * signal-driven (contrairement au fond de Pulse, piloté par `brightness`) —
 * un fond quasi statique, cohérent avec « espace profond ».
 */
export class DeepVignette implements Layer {
  readonly id = 'deepVignette';
  readonly kind: LayerKind = 'background';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  init(_ctx: LayerInitContext): void {}
  update(_step: StepContext, _signals: VisualSignals): void {}

  draw(renderer: Renderer, _viewport: Viewport): void {
    renderer.fillRadialGradient(0, 1.1, CENTER, EDGE);
  }

  reset(_t: number): void {}
  dispose(): void {}
}
