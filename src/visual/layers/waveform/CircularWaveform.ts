import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import { BAND_IDS } from '../../../music/StepContext';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Palette } from '../../palette/Palette';
import { lerp } from '../../../core/math/lerp';

const SEGMENTS = 64;
const BASE_RADIUS = 0.4;
const DEFORM_AMPLITUDE = 0.04; // docs/07 : « ± 0.04 »
const LINE_WIDTH = 0.004;

/**
 * Waveform du style Pulse (docs/07) : « forme d'onde circulaire déformée par
 * le spectre, ± 0.04 ». Aucun spectre pleine résolution n'atteint `visual/`
 * (Loi 2 : uniquement `StepContext`) — la déformation utilise les 6
 * `step.bands` déjà livrés en P5/P6, interpolés entre secteurs adjacents
 * pour une courbe lisse plutôt qu'un hexagone à paliers.
 *
 * `xs`/`ys` pré-alloués une fois (zéro allocation en boucle de rendu,
 * docs/10) et mutés dans `update()`, lus dans `draw()`.
 */
export class CircularWaveform implements Layer {
  readonly id = 'circularWaveform';
  readonly kind: LayerKind = 'waveform';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private readonly xs = new Float32Array(SEGMENTS);
  private readonly ys = new Float32Array(SEGMENTS);

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(step: StepContext, _signals: VisualSignals): void {
    const bandCount = BAND_IDS.length;
    for (let i = 0; i < SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      const sectorPos = (angle / (Math.PI * 2)) * bandCount;
      const i0 = Math.floor(sectorPos) % bandCount;
      const i1 = (i0 + 1) % bandCount;
      const frac = sectorPos - Math.floor(sectorPos);
      const bandValue = lerp(step.bands[BAND_IDS[i0]!], step.bands[BAND_IDS[i1]!], frac);

      const deformation = (bandValue - 0.5) * 2 * DEFORM_AMPLITUDE;
      const radius = BASE_RADIUS + deformation;
      this.xs[i] = radius * Math.cos(angle);
      this.ys[i] = radius * Math.sin(angle);
    }
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    renderer.strokePath(this.xs, this.ys, SEGMENTS, LINE_WIDTH, this.palette.secondary, true);
  }

  reset(_t: number): void {
    // Rien à restaurer : recalculé intégralement par le prochain update().
  }

  dispose(): void {}
}
