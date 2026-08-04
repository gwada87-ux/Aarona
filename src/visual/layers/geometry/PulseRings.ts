import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Color } from '../../../render/Renderer';
import type { Palette } from '../../palette/Palette';

const BASE_RADIUS = 0.28;
const IMPACT_RADIUS_GAIN = 0.1; // docs/07 : rayon = 0.28 + 0.10·impact
const MIN_LINE_WIDTH = 0.006;
const WEIGHT_LINE_WIDTH_GAIN = 0.014; // épaisseur = f(weight) — linéaire, non spécifié plus précisément

const SECONDARY_RING_POOL_SIZE = 8;
const SECONDARY_RING_LIFETIME = 1.2; // docs/07 : expansion + fondu (1,2 s)
const SECONDARY_RING_EXPANSION = 0.32; // rayon final ≈ BASE_RADIUS + ceci, non spécifié précisément

/**
 * Geometry du style Pulse (docs/07) : anneau central réactif à `impact`/`weight`,
 * plus des anneaux secondaires émis sur DOWNBEAT (expansion + fondu, 1,2 s).
 *
 * Pool à taille fixe, zéro allocation en boucle de rendu (docs/10) : `ages[i] < 0`
 * signifie « emplacement libre », pas de tableau annexe de booléens.
 */
export class PulseRings implements Layer {
  readonly id = 'pulseRings';
  readonly kind: LayerKind = 'geometry';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private impact = 0;
  private weight = 0;
  private readonly ringAges = new Float32Array(SECONDARY_RING_POOL_SIZE).fill(-1);

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(step: StepContext, signals: VisualSignals): void {
    this.impact = signals.impact;
    this.weight = signals.weight;

    for (let i = 0; i < SECONDARY_RING_POOL_SIZE; i++) {
      if (this.ringAges[i]! >= 0) this.ringAges[i]! += step.dt;
      if (this.ringAges[i]! >= SECONDARY_RING_LIFETIME) this.ringAges[i] = -1;
    }

    if (step.fired.some((e) => e.type === 'DOWNBEAT')) {
      const free = this.ringAges.indexOf(-1);
      if (free !== -1) this.ringAges[free] = 0;
    }
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const radius = BASE_RADIUS + IMPACT_RADIUS_GAIN * this.impact;
    const lineWidth = MIN_LINE_WIDTH + WEIGHT_LINE_WIDTH_GAIN * this.weight;
    renderer.strokeCircle(0, 0, radius, lineWidth, this.palette.primary);

    for (let i = 0; i < SECONDARY_RING_POOL_SIZE; i++) {
      const age = this.ringAges[i]!;
      if (age < 0) continue;
      const progress = age / SECONDARY_RING_LIFETIME;
      const ringRadius = BASE_RADIUS + progress * SECONDARY_RING_EXPANSION;
      const alpha = 1 - progress;
      const color: Color = { ...this.palette.secondary, a: this.palette.secondary.a * alpha };
      renderer.strokeCircle(0, 0, ringRadius, MIN_LINE_WIDTH, color);
    }
  }

  reset(_t: number): void {
    // Les anneaux secondaires actifs au moment d'un seek ne sont pas
    // reconstitués : ils redémarreront naturellement au prochain DOWNBEAT
    // rencontré pendant le rattrapage. Un anneau manqué est invisible
    // (docs/06, même principe que la fenêtre MAX_WINDOW du dispatcher).
    this.ringAges.fill(-1);
  }

  dispose(): void {}
}
