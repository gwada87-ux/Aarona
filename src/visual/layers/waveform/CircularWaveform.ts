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
/** Amplitude ajoutée par la caisse claire, au-delà des ± 0,04 du spectre. */
const ACCENT_DEFORM = 0.05;
/** Épaississement du trait par le charley. Plafonné à 40 % de l'accent principal (§8). */
const TICK_WIDTH_GAIN = 0.6;
/** Rotation lente sur la mesure, en tours. Sous 1/16 de tour, elle ne se lit plus. */
const BAR_ROTATION = 1 / 12;

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
  private tick = 0;

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(step: StepContext, signals: VisualSignals): void {
    const bandCount = BAND_IDS.length;
    // ROTATION sur la mesure : le motif tourne d'un douzième de tour par
    // mesure. Sans elle, la couronne était rigoureusement immobile en
    // orientation, et l'œil finissait par lire une image fixe déformée plutôt
    // qu'un objet qui vit.
    const spin = signals.barPulse * BAR_ROTATION * Math.PI * 2;
    // La CAISSE CLAIRE creuse la déformation. Canal distinct du spectre, qui
    // reste la source de la FORME : le snare en règle l'amplitude, il ne la
    // remplace pas.
    const amplitude = DEFORM_AMPLITUDE + signals.accent * ACCENT_DEFORM;
    this.tick = signals.tick;

    for (let i = 0; i < SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      const sectorPos = (angle / (Math.PI * 2)) * bandCount;
      const i0 = Math.floor(sectorPos) % bandCount;
      const i1 = (i0 + 1) % bandCount;
      const frac = sectorPos - Math.floor(sectorPos);
      const bandValue = lerp(step.bands[BAND_IDS[i0]!], step.bands[BAND_IDS[i1]!], frac);

      const deformation = (bandValue - 0.5) * 2 * amplitude;
      const radius = BASE_RADIUS + deformation;
      this.xs[i] = radius * Math.cos(angle + spin);
      this.ys[i] = radius * Math.sin(angle + spin);
    }
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    // Le CHARLEY épaissit le trait — troisième canal, troisième paramètre.
    const width = LINE_WIDTH * (1 + this.tick * TICK_WIDTH_GAIN);
    renderer.strokePath(this.xs, this.ys, SEGMENTS, width, this.palette.secondary, true);
  }

  reset(_t: number): void {
    // Rien à restaurer : recalculé intégralement par le prochain update().
  }

  dispose(): void {}
}
