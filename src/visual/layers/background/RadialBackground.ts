import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import { lerpColor, type Palette } from '../../palette/Palette';

/** Rayon du dégradé au repos. Le `subImpact` le fait respirer autour de cette valeur. */
const BASE_OUTER_RADIUS = 1.0;
/** Amplitude de la respiration sur un coup de sub, en unités normalisées. */
const SUB_BREATH = 0.14;
/** Poids maximal de la teinte d'accent au changement de section. */
const SECTION_TINT = 0.35;

/**
 * Background du style Pulse (docs/07) : « dégradé radial sombre, teinte
 * pilotée par brightness ».
 *
 * Chantier 2 : deux signaux jusqu'ici jetés par tout le moteur sont branchés
 * ici, sur des paramètres DISTINCTS de `brightness` (règle « un instrument, un
 * canal ») — `subImpact` sur le RAYON du dégradé, `sectionShift` sur la TEINTE
 * du centre. Le fond était le seul endroit où un coup de sub pouvait se lire
 * sans concurrencer l'accent principal : il occupe tout le cadre, donc une
 * variation de 14 % de rayon s'y voit sans rien écraser.
 */
export class RadialBackground implements Layer {
  readonly id = 'background';
  readonly kind: LayerKind = 'background';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private brightness = 0;
  private subImpact = 0;
  private sectionShift = 0;

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(_step: StepContext, signals: VisualSignals): void {
    this.brightness = signals.brightness;
    this.subImpact = signals.subImpact;
    this.sectionShift = signals.sectionShift;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const [dark, darker] = this.palette.bg;
    const base = lerpColor(dark, darker, this.brightness);
    // Le changement de section teinte le centre vers l'accent puis se résorbe :
    // une ponctuation, pas un état. C'est le seul moment où le fond porte une
    // couleur qui n'est pas une des deux du dégradé.
    const inner = lerpColor(base, this.palette.accent, this.sectionShift * SECTION_TINT);
    renderer.fillRadialGradient(0, BASE_OUTER_RADIUS + this.subImpact * SUB_BREATH, inner, darker);
  }

  reset(_t: number): void {
    // Rien à restaurer : `brightness` est recalculé par le prochain update().
  }

  dispose(): void {}
}
