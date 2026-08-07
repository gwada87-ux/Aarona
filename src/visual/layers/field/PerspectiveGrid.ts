import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Color } from '../../../render/Renderer';
import type { Palette } from '../../palette/Palette';

// docs/08_PRESETS.md, exemple "Trap Dark" : layers.field = { rows: 24, perspective: 0.65 }.
// Valeurs par défaut — reprises telles quelles si `params` ne fournit rien (Étape 20 : densité/
// profondeur pilotent `rows`/`perspective` via `presets/layerMacros.ts`).
const DEFAULT_ROW_COUNT = 24;
const DEFAULT_PERSPECTIVE = 0.65;
const MAX_RADIUS = 0.75;
const LINE_WIDTH = 0.0025;
/** Part de l'alpha qui respire sur le temps. Le reste est le fondu de profondeur. */
const PULSE_ALPHA_SHARE = 0.3;
/** Épaississement de l'anneau frappé par la caisse claire. */
const ACCENT_WIDTH_GAIN = 3;
/** Profondeur, en rangées, de l'anneau que frappe la caisse claire. */
const ACCENT_DEPTH = 3;

function mod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

/**
 * Field du style Field (docs/07) : « grille en perspective, avancée pilotée
 * par pulse (phase continue, jamais un saut) ». Rendue comme des anneaux
 * concentriques dont le rayon suit une division hyperbolique de la
 * profondeur (`rayon = maxRayon·perspective / (perspective + profondeur)`)
 * — la formule de perspective classique (rayon ∝ 1/profondeur), pas une
 * vraie projection 3D.
 *
 * « Piloté par pulse » : l'AVANCÉE utilise `step.beat.index + step.beat.phase`
 * directement, PAS `signals.pulse` — ce dernier est une sinusoïde (docs/03),
 * qui oscillerait avant/arrière et romprait « jamais un saut ». La grandeur
 * qui avance continûment (sauf seek) est la phase de battement brute.
 *
 * Chantier 2 : c'est précisément pour cette raison que `signals.pulse` n'était
 * lu par AUCUNE couche du moteur — seule cette grille pouvait le vouloir, et
 * sa forme sinusoïdale y était inutilisable. Il trouve ici son emploi juste :
 * la sinusoïde pilote l'ALPHA des lignes, où osciller est exactement ce qu'on
 * veut, pendant que la position brute continue de piloter le défilement. Un
 * signal, deux paramètres, aucune contradiction.
 *
 * La CAISSE CLAIRE frappe un anneau à profondeur fixe : elle marque le
 * contretemps sans toucher au défilement, qui reste le métronome.
 */
export class PerspectiveGrid implements Layer {
  readonly id = 'perspectiveGrid';
  readonly kind: LayerKind = 'field';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private scrollDistance = 0;
  private pulse = 0.5;
  private accent = 0;

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(step: StepContext, signals: VisualSignals): void {
    this.scrollDistance = step.beat.index + step.beat.phase;
    this.pulse = signals.pulse;
    this.accent = signals.accent;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const rowsRaw = this.params.rows;
    const rowCount = typeof rowsRaw === 'number' ? Math.max(1, Math.round(rowsRaw)) : DEFAULT_ROW_COUNT;
    const perspectiveRaw = this.params.perspective;
    const perspective = typeof perspectiveRaw === 'number' ? perspectiveRaw : DEFAULT_PERSPECTIVE;

    const base = this.palette.secondary;
    // Respiration sur le temps : 70 % de l'alpha reste le fondu de profondeur,
    // 30 % suit la sinusoïde. Au-delà, la grille clignote au lieu de respirer.
    const breath = 1 - PULSE_ALPHA_SHARE + this.pulse * PULSE_ALPHA_SHARE;
    // Anneau frappé par la caisse claire, à profondeur FIXE : il ne défile pas
    // avec la grille, il marque le contretemps au même endroit à chaque fois.
    const hitDepth = Math.min(rowCount - 1, ACCENT_DEPTH);
    for (let i = 0; i < rowCount; i++) {
      const depth = mod(i - this.scrollDistance, rowCount);
      const radius = (MAX_RADIUS * perspective) / (perspective + depth);
      const alpha = (1 - depth / rowCount) * 0.35 * base.a * breath;
      const color: Color = { r: base.r, g: base.g, b: base.b, a: alpha };
      const hit = this.accent > 0.01 && Math.abs(depth - hitDepth) < 1;
      const width = hit ? LINE_WIDTH * (1 + this.accent * ACCENT_WIDTH_GAIN) : LINE_WIDTH;
      renderer.strokeCircle(0, 0, radius, width, color);
    }
  }

  reset(_t: number): void {
    // Rien à restaurer : `scrollDistance` est recalculé intégralement par le prochain update().
  }

  dispose(): void {}
}
