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
 *
 * `usesFeedback` (Étape 11/P9) : si `true`, `draw()` appelle
 * `renderer.captureFeedback()` après avoir dessiné toutes les couches — la
 * capture doit voir le composite COMPLET de l'image (grille + particules +
 * glow), donc ne peut pas être la responsabilité d'une couche individuelle
 * (aucune n'est garantie d'être dessinée en dernier). Coût non nul
 * (`drawImage` + `clearRect` par image) : `false` par défaut pour ne pas le
 * payer sur les styles qui n'en ont pas besoin (Pulse, Spectrum Pro).
 */
export class Scene {
  constructor(
    readonly layers: readonly Layer[],
    readonly usesFeedback: boolean = false,
  ) {}

  init(ctx: LayerInitContext): void {
    for (const layer of this.layers) layer.init(ctx);
  }

  update(step: StepContext, signals: VisualSignals): void {
    for (const layer of this.layers) layer.update(step, signals);
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    for (const layer of this.layers) {
      // Mode de fusion par couche (§7.2, chantier 4). Posé AVANT et retiré
      // APRÈS, systématiquement : sans la remise à `null`, une couche qui
      // déclare `multiply` imposerait son mode à toutes les suivantes, et le
      // symptôme — « le style est trop sombre » — ne pointerait pas vers elle.
      //
      // Aucun appel quand aucune couche n'en déclare : le chemin par défaut
      // reste rigoureusement celui d'avant ce chantier.
      if (layer.blend !== undefined) {
        renderer.setBlendMode(layer.blend);
        layer.draw(renderer, viewport);
        renderer.setBlendMode(null);
      } else {
        layer.draw(renderer, viewport);
      }
    }
    if (this.usesFeedback) renderer.captureFeedback();
  }

  reset(t: number): void {
    for (const layer of this.layers) layer.reset(t);
  }

  dispose(): void {
    for (const layer of this.layers) layer.dispose();
  }
}
