import type { Renderer, SpriteHandle, SpriteTransform } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import { BAND_IDS } from '../../../music/StepContext';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Color } from '../../../render/Renderer';
import type { Palette } from '../../palette/Palette';

const BAND_COUNT = BAND_IDS.length;
// Largeurs relatives ∝ log(borneHaute/borneBasse) des plages Hz de analysis/bands.ts,
// dupliquées ici en constantes : `visual/` n'a pas le droit d'importer `analysis/`
// (docs/02, tableau de dépendances). sub[20-60] bass[60-120] lowmid[120-400]
// mid[400-2000] himid[2000-6000] high[6000-11000].
const BAND_WIDTH_WEIGHTS = [1.1, 0.69, 1.2, 1.61, 1.1, 0.61] as const;
const TOTAL_WEIGHT = BAND_WIDTH_WEIGHTS.reduce((a, b) => a + b, 0);

// Valeurs par défaut — reprises telles quelles si `params` ne fournit rien (Étape 20 : densité/
// mouvement/profondeur/glow/chaos/douceur pilotent ces constantes via `presets/layerMacros.ts`).
const DEFAULT_BAR_RISE_TAU = 0.05;
const DEFAULT_BAR_FALL_TAU = 0.35;
const DEFAULT_GAP = 0.006;
const MAX_HEIGHT = 0.42;
const BASELINE = -0.05;
const PEAK_GRAVITY = 1.3; // unités normalisées / s² — chute des chapeaux de pics
const PEAK_HEIGHT = 0.006;
const DEFAULT_REFLECTION_ALPHA = 0.25; // docs/07 : « réflexion inférieure atténuée à 0,25 »
const DEFAULT_GLOW_ALPHA_MUL = 1;
const DEFAULT_PEAK_CHAOS_JITTER = 0;
const GLOW_SPRITE_SIZE = 48;

/**
 * Spectrum du style Spectrum Pro (docs/07) : « 64 bandes en échelle
 * logarithmique... lissage par bande, montée rapide / descente lente...
 * réflexion inférieure atténuée à 0,25... chapeaux de pics avec chute
 * gravitaire ».
 *
 * PÉRIMÈTRE RÉDUIT ET DOCUMENTÉ : 6 bandes RÉELLES (`step.bands`), pas 64 —
 * le spectrogramme est explicitement jeté après l'analyse hors-ligne
 * (docs/03_DATA_FLOW.md : « le spectrogramme est traité par blocs et libéré
 * au fur et à mesure »), aucune donnée plus fine n'atteint `visual/`.
 * Étendre l'analyse à un vrai spectre log-scale serait un chantier P4
 * séparé (voir docs/JOURNAL.md, Étape 11). Les largeurs de barres restent
 * non uniformes (plus larges pour le grave) pour garder l'esprit de
 * l'échelle logarithmique avec les données disponibles.
 *
 * Lissage par bande INLINE (Étape 20) plutôt que via `Continuous`
 * (behaviour/signals) : `Continuous` fixe `riseTau`/`fallTau` au
 * constructeur, alors que les macros mouvement/douceur doivent pouvoir les
 * faire varier à tout instant pendant la lecture — recréer des `Continuous`
 * à chaque changement réinitialiserait leur valeur et ferait sauter les
 * barres. Même raisonnement que `ScreenShake` pour `Impulse`.
 */
export class SpectrumBars implements Layer {
  readonly id = 'spectrumBars';
  readonly kind: LayerKind = 'spectrum';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private glowSprite!: SpriteHandle;
  private readonly heights = new Float32Array(BAND_COUNT);
  private readonly peakHeights = new Float32Array(BAND_COUNT);
  private readonly peakVelocities = new Float32Array(BAND_COUNT);
  private readonly glowTransforms: SpriteTransform[] = Array.from({ length: BAND_COUNT }, () => ({
    x: 0,
    y: 0,
    scale: 0,
    alpha: 0,
  }));

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
    const glow = ctx.palette.glow;
    this.glowSprite = ctx.renderer.createSprite((offCtx) => {
      const g = offCtx.createRadialGradient(
        GLOW_SPRITE_SIZE / 2,
        GLOW_SPRITE_SIZE / 2,
        0,
        GLOW_SPRITE_SIZE / 2,
        GLOW_SPRITE_SIZE / 2,
        GLOW_SPRITE_SIZE / 2,
      );
      g.addColorStop(0, `rgba(${glow.r}, ${glow.g}, ${glow.b}, 1)`);
      g.addColorStop(1, `rgba(${glow.r}, ${glow.g}, ${glow.b}, 0)`);
      offCtx.fillStyle = g;
      offCtx.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
    }, GLOW_SPRITE_SIZE);
  }

  private param(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  update(step: StepContext, _signals: VisualSignals): void {
    const riseTau = this.param('riseTau', DEFAULT_BAR_RISE_TAU);
    const fallTau = this.param('fallTau', DEFAULT_BAR_FALL_TAU);
    const peakChaosJitter = this.param('peakChaosJitter', DEFAULT_PEAK_CHAOS_JITTER);

    for (let i = 0; i < BAND_COUNT; i++) {
      const target = step.bands[BAND_IDS[i]!];
      const tau = target > this.heights[i]! ? riseTau : fallTau;
      this.heights[i]! += (target - this.heights[i]!) * (1 - Math.exp(-step.dt / tau));

      this.peakVelocities[i]! += PEAK_GRAVITY * step.dt;
      this.peakHeights[i]! -= this.peakVelocities[i]! * step.dt;
      if (this.peakHeights[i]! < 0) this.peakHeights[i] = 0;
      if (this.heights[i]! > this.peakHeights[i]!) {
        this.peakHeights[i] = this.heights[i]!;
        // Macro chaos (Étape 20) : au lieu de retomber exactement de 0, un petit à-coup de
        // vitesse initiale — amplitude nulle par défaut (comportement inchangé).
        this.peakVelocities[i] = peakChaosJitter > 0 ? -step.rng.next() * peakChaosJitter : 0;
      }
    }
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    const gap = this.param('gap', DEFAULT_GAP);
    const reflectionAlpha = this.param('reflectionAlpha', DEFAULT_REFLECTION_ALPHA);
    const glowAlphaMul = this.param('glowAlphaMul', DEFAULT_GLOW_ALPHA_MUL);

    const halfW = viewport.aspect >= 1 ? viewport.aspect / 2 : 0.5;
    const totalWidth = halfW * 1.6;
    const left = -totalWidth / 2;
    const barColor: Color = this.palette.primary;
    const reflectionColor: Color = { ...barColor, a: barColor.a * reflectionAlpha };

    let cursor = left;
    for (let i = 0; i < BAND_COUNT; i++) {
      const width = (BAND_WIDTH_WEIGHTS[i]! / TOTAL_WEIGHT) * totalWidth - gap;
      const height = this.heights[i]! * MAX_HEIGHT;
      const cx = cursor + width / 2;

      this.drawBar(renderer, cx, BASELINE, width, height, barColor);
      this.drawBar(renderer, cx, BASELINE, width, -height * (1 - reflectionAlpha), reflectionColor);

      const peakY = BASELINE + this.peakHeights[i]! * MAX_HEIGHT;
      this.drawBar(renderer, cx, peakY, width, PEAK_HEIGHT, barColor);

      const t = this.glowTransforms[i]!;
      t.x = cx;
      t.y = BASELINE + height;
      t.scale = 0.12 + this.heights[i]! * 0.18;
      t.alpha = Math.min(1, this.heights[i]! * 0.5 * glowAlphaMul);

      cursor += width + gap;
    }
    renderer.drawSprite(this.glowSprite, this.glowTransforms, BAND_COUNT);
  }

  private drawBar(renderer: Renderer, cx: number, baseY: number, width: number, height: number, color: Color): void {
    const xs = new Float32Array([cx - width / 2, cx + width / 2, cx + width / 2, cx - width / 2]);
    const ys = new Float32Array([baseY, baseY, baseY + height, baseY + height]);
    renderer.fillPath(xs, ys, 4, color);
  }

  reset(_t: number): void {
    this.heights.fill(0);
    this.peakHeights.fill(0);
    this.peakVelocities.fill(0);
  }

  dispose(): void {}
}
