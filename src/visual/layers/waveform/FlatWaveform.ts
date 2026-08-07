import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import { BAND_IDS } from '../../../music/StepContext';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Palette } from '../../palette/Palette';
import { lerp } from '../../../core/math/lerp';

const SEGMENTS = 96;
const AMPLITUDE = 0.05;
const LINE_ALPHA = 0.4; // docs/07 : « ligne d'onde superposée, fine, alpha 0,4 »
/** Amplitude ajoutée par la caisse claire. */
const ACCENT_AMPLITUDE = 0.055;
/** Dérive verticale sur la mesure, en unités normalisées. */
const BAR_DRIFT = 0.02;

/**
 * Waveform du style Spectrum Pro (docs/07) : « ligne d'onde superposée,
 * fine, alpha 0,4 ». Comme `CircularWaveform` (Pulse), aucune forme d'onde
 * réelle n'atteint `visual/` (Loi 2 : uniquement `StepContext`) — approximée
 * par une interpolation lisse des 6 `step.bands`, dépliée horizontalement
 * plutôt qu'en cercle. Décorative, pas une vraie représentation du signal.
 */
export class FlatWaveform implements Layer {
  readonly id = 'flatWaveform';
  readonly kind: LayerKind = 'waveform';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private readonly xs = new Float32Array(SEGMENTS);
  private readonly ys = new Float32Array(SEGMENTS);

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(step: StepContext, signals: VisualSignals): void {
    const bandCount = BAND_IDS.length;
    const halfW = 0.5;
    // Deux canaux distincts : la CAISSE CLAIRE creuse l'amplitude, la MESURE
    // fait dériver la ligne verticalement. Cette couche ne lisait aucun signal
    // avant le chantier 2.
    const amplitude = AMPLITUDE + signals.accent * ACCENT_AMPLITUDE;
    const drift = (signals.barPulse - 0.5) * 2 * BAR_DRIFT;
    for (let i = 0; i < SEGMENTS; i++) {
      const frac = i / (SEGMENTS - 1);
      const sectorPos = frac * bandCount;
      const i0 = Math.min(bandCount - 1, Math.floor(sectorPos));
      const i1 = Math.min(bandCount - 1, i0 + 1);
      const localFrac = sectorPos - i0;
      const bandValue = lerp(step.bands[BAND_IDS[i0]!], step.bands[BAND_IDS[i1]!], localFrac);

      this.xs[i] = -halfW + frac * halfW * 2;
      this.ys[i] = (bandValue - 0.5) * 2 * amplitude + drift;
    }
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const c = this.palette.secondary;
    renderer.strokePath(this.xs, this.ys, SEGMENTS, 0.0018, { r: c.r, g: c.g, b: c.b, a: LINE_ALPHA }, false);
  }

  reset(_t: number): void {}
  dispose(): void {}
}
