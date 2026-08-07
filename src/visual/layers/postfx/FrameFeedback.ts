import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';

// docs/07 §"Field" : « canvas précédent redessiné à 0,88 d'alpha, mis à l'échelle 1,004 ».
const FEEDBACK_SCALE = 1.004;
const FEEDBACK_ALPHA = 0.88;
/**
 * Alpha maximal atteint au sommet d'une montée. Plafonné à 0,96 : au-delà, la
 * traînée ne s'efface plus assez vite entre deux images et l'écran sature en
 * quelques secondes — c'est un emballement, pas un effet.
 */
const TENSION_ALPHA_MAX = 0.96;
/**
 * Poussée de zoom sur un kick. Très petite : l'échelle du feedback se compose
 * d'une image à l'autre, donc 0,006 par frappe suffit à produire une onde
 * visible qui traverse la traînée. Au-delà, l'image part en tunnel.
 */
const IMPACT_SCALE_PUNCH = 0.006;

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

  private tension = 0;
  private impact = 0;

  init(_ctx: LayerInitContext): void {}

  /**
   * Chantier 2 : la TRAÎNÉE s'allonge à mesure qu'on approche d'un drop.
   *
   * `tension` (anticipation du DROP) était le signal le plus frustrant du
   * moteur : entièrement implémenté, configurable dans chaque preset avec une
   * fenêtre et une courbe, et lu par personne. Le feedback est son meilleur
   * support — c'est le seul paramètre du style Field qui agit sur l'image
   * ENTIÈRE et dont l'effet s'accumule dans le temps, donc le seul qui puisse
   * traduire une montée plutôt qu'un instant.
   */
  update(_step: StepContext, signals: VisualSignals): void {
    this.tension = signals.tension;
    this.impact = signals.impact;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const alpha = FEEDBACK_ALPHA + this.tension * (TENSION_ALPHA_MAX - FEEDBACK_ALPHA);
    // Le KICK sur l'ÉCHELLE, l'anticipation sur l'ALPHA : deux paramètres, deux
    // canaux. Sans cette ligne, le style `field` — celui du trap et du drill,
    // donc celui dont le kick est l'élément central — ne lisait `impact` NULLE
    // PART : ses particules ne réagissent qu'à `step.fired`, en contournant la
    // table de câblage. Régler `impact.decay` dans un preset n'y changeait rien.
    renderer.drawFeedback(FEEDBACK_SCALE + this.impact * IMPACT_SCALE_PUNCH, alpha);
  }

  reset(_t: number): void {
    // Rien à faire ici : `drawFeedback` est déjà sans effet tant qu'aucune
    // capture n'a eu lieu (voir Renderer.ts), et le rattrapage de seek en
    // fournira une nouvelle avant la frame réelle.
  }

  dispose(): void {}
}
