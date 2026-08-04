import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';

// docs/07 §"Field" : « canvas précédent redessiné à 0,88 d'alpha, mis à l'échelle 1,004 ».
const FEEDBACK_SCALE = 1.004;
const FEEDBACK_ALPHA = 0.88;

/**
 * PostFx du style Field (docs/07) : feedback léger — traînées naturelles,
 * aucun coût de simulation. Couche à état de FRAMEBUFFER
 * (`needsDrawPriming = true`, docs/02 §Layer) : son état « vit » dans le
 * `Renderer` (voir `drawFeedback`/`captureFeedback`), pas dans cette
 * classe, qui ne fait que déclencher l'appel — la capture elle-même est la
 * responsabilité de `Scene.draw()` (`usesFeedback`), pas d'une couche.
 *
 * Doit être dessinée EN PREMIER (comme `ScreenShake` en Pulse) : c'est la
 * base sur laquelle le reste de l'image se compose.
 */
export class FrameFeedback implements Layer {
  readonly id = 'frameFeedback';
  readonly kind: LayerKind = 'postfx';
  readonly needsDrawPriming = true;
  params: LayerParams = {};

  init(_ctx: LayerInitContext): void {}
  update(_step: StepContext, _signals: VisualSignals): void {}

  draw(renderer: Renderer, _viewport: Viewport): void {
    renderer.drawFeedback(FEEDBACK_SCALE, FEEDBACK_ALPHA);
  }

  reset(_t: number): void {
    // Rien à faire ici : `drawFeedback` est déjà sans effet tant qu'aucune
    // capture n'a eu lieu (voir Renderer.ts), et le rattrapage de seek en
    // fournira une nouvelle avant la frame réelle.
  }

  dispose(): void {}
}
