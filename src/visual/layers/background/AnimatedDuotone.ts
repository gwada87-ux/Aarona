import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import { lerpColor, type Palette } from '../../palette/Palette';

const ANIMATION_SPEED = 0.06; // rad/s — « très légèrement animé », non chiffré par docs/07
const BASE_OUTER_RADIUS = 1.1;
const SUB_BREATH = 0.12;
const SECTION_TINT = 0.3;
/** Part de la dérive lente cédée au LFO. Le reste reste piloté par `t`. */
const LFO_SHARE = 0.5;

/**
 * Background du style Spectrum Pro (docs/07) : « dégradé bicolore, très
 * légèrement animé ».
 *
 * Chantier 2 : cette couche ne lisait AUCUN signal. Elle en lit trois, tous sur
 * des paramètres distincts — `subImpact` sur le rayon, `sectionShift` sur la
 * teinte, `lfoA` sur la dérive lente. Le cas de `spectrum-pro` était le pire du
 * moteur : ses trois couches étaient sourdes, donc modifier le `mapping` du
 * preset lofi ne pouvait litéralement rien changer.
 *
 * La dérive garde une part pilotée par `t` : un morceau sans grille fiable
 * (Loi 3, régime continu) a une position de mesure douteuse, et l'arrière-plan
 * ne doit pas se figer pour autant.
 */
export class AnimatedDuotone implements Layer {
  readonly id = 'animatedDuotone';
  readonly kind: LayerKind = 'background';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private t = 0;
  private subImpact = 0;
  private sectionShift = 0;
  private lfo = 0.5;

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(step: StepContext, signals: VisualSignals): void {
    this.t = step.t;
    this.subImpact = signals.subImpact;
    this.sectionShift = signals.sectionShift;
    this.lfo = signals.lfoA;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    // Animation lente et bornée (Loi 1 : fonction pure de `t`, jamais de l'horloge réelle).
    const free = (Math.sin(this.t * ANIMATION_SPEED) + 1) / 2;
    const drift = free * (1 - LFO_SHARE) + this.lfo * LFO_SHARE;
    const base = lerpColor(this.palette.bg[0], this.palette.bg[1], 0.3 + 0.2 * drift);
    const inner = lerpColor(base, this.palette.accent, this.sectionShift * SECTION_TINT);
    renderer.fillRadialGradient(0, BASE_OUTER_RADIUS + this.subImpact * SUB_BREATH, inner, this.palette.bg[1]);
  }

  reset(_t: number): void {}
  dispose(): void {}
}
