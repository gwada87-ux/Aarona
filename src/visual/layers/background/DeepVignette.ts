import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Color } from '../../../render/Renderer';

const CENTER: Color = { r: 8, g: 8, b: 10, a: 1 };
const EDGE: Color = { r: 0, g: 0, b: 0, a: 1 };
const BASE_OUTER_RADIUS = 1.1;
/** Resserrement du vignettage sur un coup de sub. Négatif : le cadre se referme. */
const SUB_CLOSE = -0.16;
/** Éclaircissement maximal du centre au changement de section. */
const SECTION_LIFT = 26;

/**
 * Background du style Field (docs/07) : « noir profond, vignettage ».
 *
 * Restait « quasi statique » et ne lisait aucun signal. Chantier 2 : le sub
 * REFERME le vignettage au lieu de l'ouvrir — un coup de grave doit donner
 * l'impression que l'espace se resserre, pas qu'il s'illumine ; c'est
 * l'inverse du fond de Pulse, et c'est délibéré, les deux styles ne racontent
 * pas la même chose. Le changement de section éclaircit brièvement le centre.
 *
 * Le fond reste sombre en toutes circonstances : « espace profond » (docs/07)
 * est une contrainte de style, pas un défaut à corriger.
 */
export class DeepVignette implements Layer {
  readonly id = 'deepVignette';
  readonly kind: LayerKind = 'background';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private subImpact = 0;
  private sectionShift = 0;

  init(_ctx: LayerInitContext): void {}

  update(_step: StepContext, signals: VisualSignals): void {
    this.subImpact = signals.subImpact;
    this.sectionShift = signals.sectionShift;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const lift = this.sectionShift * SECTION_LIFT;
    const center: Color = { r: CENTER.r + lift, g: CENTER.g + lift, b: CENTER.b + lift * 1.2, a: 1 };
    renderer.fillRadialGradient(0, BASE_OUTER_RADIUS + this.subImpact * SUB_CLOSE, center, EDGE);
  }

  reset(_t: number): void {}
  dispose(): void {}
}
