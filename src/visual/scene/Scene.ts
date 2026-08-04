import type { Renderer } from '../../render/Renderer';
import type { Viewport } from '../../render/Viewport';
import type { StepContext } from '../../music/StepContext';
import type { VisualSignals } from '../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext } from './Layer';

/**
 * Scene — liste ORDONNÉE de couches (docs/07_VISUAL_ENGINE.md §"SceneEngine").
 * L'ordre du tableau EST l'ordre de dessin, fond vers avant — une couche qui
 * doit affecter tout ce qui suit (ex. `ScreenShake`, un décalage global via
 * `Renderer.applyShake`) doit donc être placée en tête, quel que soit
 * l'ordre conceptuel décrit par style dans docs/07 (voir Renderer.ts).
 *
 * Ne bracket PAS `renderer.beginFrame`/`endFrame` : c'est à l'appelant de le
 * faire (docs/03_DATA_FLOW.md FLUX 2 : beginFrame → scene.draw → endFrame →
 * FlashLimiter.apply, dans cet ordre — le clampage du FlashLimiter doit voir
 * un canvas dont le décalage de shake a déjà été annulé par `endFrame`).
 */
export class Scene {
  constructor(readonly layers: readonly Layer[]) {}

  init(ctx: LayerInitContext): void {
    for (const layer of this.layers) layer.init(ctx);
  }

  update(step: StepContext, signals: VisualSignals): void {
    for (const layer of this.layers) layer.update(step, signals);
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    for (const layer of this.layers) layer.draw(renderer, viewport);
  }

  reset(t: number): void {
    for (const layer of this.layers) layer.reset(t);
  }

  dispose(): void {
    for (const layer of this.layers) layer.dispose();
  }
}
