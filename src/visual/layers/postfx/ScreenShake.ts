import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import { Impulse } from '../../../behaviour/signals/Impulse';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';

const TRIGGER_THRESHOLD = 0.7; // docs/07 : « sur impact > 0,7 »
const MAX_AMPLITUDE = 0.012; // docs/07 : « amplitude ≤ 0,012 »
const DECAY = 0.15; // docs/07 : « décroissance 0,15 s »

/**
 * PostFx du style Pulse (docs/07) : « tremblement d'écran sur impact > 0,7 ».
 * Réutilise `Impulse` (behaviour/signals) pour la décroissance — c'est
 * exactement la même forme (déclenchement + décroissance exponentielle par
 * `dt`), pas de raison d'en réécrire une variante ici. `visual/` a le droit
 * d'importer `behaviour/` (docs/02, tableau de dépendances).
 *
 * Doit être dessinée AVANT les autres couches du style (voir Renderer.ts,
 * `applyShake`) : `Scene` ne réordonne rien, c'est `createPulseStyle` qui
 * place cette couche en tête du tableau `layers`.
 *
 * Direction seedée par `step.rng` (Loi 1 — jamais `Math.random()`), tirée
 * une seule fois par nouveau choc (pas à chaque sous-pas) : un tirage par
 * `update()` produirait un tremblement qui vibre au hasard plutôt qu'un
 * choc dans une direction, et consommerait `step.rng` même hors déclenchement.
 */
export class ScreenShake implements Layer {
  readonly id = 'screenShake';
  readonly kind: LayerKind = 'postfx';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private readonly impulse = new Impulse(DECAY);
  private angle = 0;
  private dx = 0;
  private dy = 0;

  init(_ctx: LayerInitContext): void {}

  update(step: StepContext, signals: VisualSignals): void {
    this.impulse.update(step.dt);

    if (signals.impact > TRIGGER_THRESHOLD) {
      const wasIdle = this.impulse.value < 1e-4;
      const excess = (signals.impact - TRIGGER_THRESHOLD) / (1 - TRIGGER_THRESHOLD);
      this.impulse.fire(Math.min(1, excess));
      if (wasIdle) this.angle = step.rng.next() * Math.PI * 2;
    }

    const amplitude = this.impulse.value * MAX_AMPLITUDE;
    this.dx = Math.cos(this.angle) * amplitude;
    this.dy = Math.sin(this.angle) * amplitude;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    renderer.applyShake(this.dx, this.dy);
  }

  reset(_t: number): void {
    this.impulse.reset();
    this.dx = 0;
    this.dy = 0;
  }

  dispose(): void {}
}
