import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';

const TRIGGER_THRESHOLD = 0.7; // docs/07 : « sur impact > 0,7 »
const MAX_AMPLITUDE = 0.012; // docs/07 : « amplitude ≤ 0,012 »
const DEFAULT_DECAY = 0.15; // docs/07 : « décroissance 0,15 s » — pilotée par la macro douceur (Étape 20)

/**
 * PostFx du style Pulse (docs/07) : « tremblement d'écran sur impact > 0,7 ».
 * Reproduit la forme d'`Impulse` (behaviour/signals — déclenchement par
 * `max`, décroissance exponentielle par `dt`) SANS l'instancier : `Impulse`
 * fixe sa décroissance au constructeur (`private readonly decay`), alors que
 * la macro douceur (Étape 20) doit pouvoir la faire varier à tout instant
 * pendant la lecture — recréer un `Impulse` à chaque changement réinitialiserait
 * `v` à 0 et couperait un tremblement en cours. Deux lignes dupliquées plutôt
 * que rendre `decay` mutable sur une primitive partagée par tout `behaviour/`.
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
  /** Son effet ne porte que sur ce qui est dessine APRES elle : elle reste en tete (docs/17 SS7.7). */
  readonly mustDrawFirst = true;
  readonly kind: LayerKind = 'postfx';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private impulseValue = 0;
  private angle = 0;
  private dx = 0;
  private dy = 0;

  init(_ctx: LayerInitContext): void {}

  update(step: StepContext, signals: VisualSignals): void {
    const decaySecRaw = this.params.decaySec;
    const decaySec = typeof decaySecRaw === 'number' ? decaySecRaw : DEFAULT_DECAY;
    this.impulseValue *= Math.exp((-step.dt * Math.LN2) / decaySec);

    if (signals.impact > TRIGGER_THRESHOLD) {
      const wasIdle = this.impulseValue < 1e-4;
      const excess = (signals.impact - TRIGGER_THRESHOLD) / (1 - TRIGGER_THRESHOLD);
      this.impulseValue = Math.max(this.impulseValue, Math.min(1, excess));
      if (wasIdle) this.angle = step.rng.next() * Math.PI * 2;
    }

    const amplitude = this.impulseValue * MAX_AMPLITUDE;
    this.dx = Math.cos(this.angle) * amplitude;
    this.dy = Math.sin(this.angle) * amplitude;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    renderer.applyShake(this.dx, this.dy);
  }

  reset(_t: number): void {
    this.impulseValue = 0;
    this.dx = 0;
    this.dy = 0;
  }

  dispose(): void {}
}
