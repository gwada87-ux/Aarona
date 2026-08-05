import type { Renderer, SpriteHandle, SpriteTransform } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import { BAND_IDS } from '../../../music/StepContext';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Color } from '../../../render/Renderer';
import type { Palette } from '../../palette/Palette';
import { groupBinsIntoBars } from './spectrumGrouping';

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
 *
 * `params.bandCount` (Étape 25, docs/07 §"Spectrum") : SECOND chemin,
 * complètement séparé du chemin par défaut ci-dessus. Absent (comportement
 * par défaut, byte-identique à avant cette étape) : 6 barres, `step.bands`.
 * Présent (câblé depuis `perf/qualityLevels.ts::spectrumBands` selon le
 * niveau de qualité — 32/48/64/96) : `step.spectrum` (résolution MAX, 96
 * valeurs, voir `StepContext.ts`) regroupé en `bandCount` barres de largeur
 * ÉGALE (`spectrumGrouping.ts`) — pas de `BAND_WIDTH_WEIGHTS`, un spectre
 * log-espacé uniforme n'a pas de raison sémantique de varier en largeur,
 * contrairement aux 6 bandes nommées d'origine. Les deux chemins partagent
 * la même physique de lissage/pics (`updateBars`/`drawBars` ci-dessous),
 * seules les données source et les tableaux d'état diffèrent.
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

  // Chemin `params.bandCount` (Étape 25) : tableaux dimensionnés dynamiquement, redimensionnés
  // seulement quand `bandCount` change (`ensureGroupedCapacity`) — pas à chaque image.
  private groupedHeights = new Float32Array(0);
  private groupedPeakHeights = new Float32Array(0);
  private groupedPeakVelocities = new Float32Array(0);
  private groupedGlowTransforms: SpriteTransform[] = [];

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
    const bandCount = this.param('bandCount', 0);

    if (bandCount > 0) {
      const n = this.ensureGroupedCapacity(bandCount);
      const grouped = groupBinsIntoBars(step.spectrum, n);
      this.updateBars(n, (i) => grouped[i]!, this.groupedHeights, this.groupedPeakHeights, this.groupedPeakVelocities, step, riseTau, fallTau, peakChaosJitter);
    } else {
      this.updateBars(BAND_COUNT, (i) => step.bands[BAND_IDS[i]!], this.heights, this.peakHeights, this.peakVelocities, step, riseTau, fallTau, peakChaosJitter);
    }
  }

  /** Physique commune aux deux chemins (lissage asymétrique + chute gravitaire des pics) — voir le commentaire d'en-tête de la classe. */
  private updateBars(
    count: number,
    source: (i: number) => number,
    heights: Float32Array,
    peakHeights: Float32Array,
    peakVelocities: Float32Array,
    step: StepContext,
    riseTau: number,
    fallTau: number,
    peakChaosJitter: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const target = source(i);
      const tau = target > heights[i]! ? riseTau : fallTau;
      heights[i]! += (target - heights[i]!) * (1 - Math.exp(-step.dt / tau));

      peakVelocities[i]! += PEAK_GRAVITY * step.dt;
      peakHeights[i]! -= peakVelocities[i]! * step.dt;
      if (peakHeights[i]! < 0) peakHeights[i] = 0;
      if (heights[i]! > peakHeights[i]!) {
        peakHeights[i] = heights[i]!;
        // Macro chaos (Étape 20) : au lieu de retomber exactement de 0, un petit à-coup de
        // vitesse initiale — amplitude nulle par défaut (comportement inchangé).
        peakVelocities[i] = peakChaosJitter > 0 ? -step.rng.next() * peakChaosJitter : 0;
      }
    }
  }

  /** Redimensionne (et remet à zéro) les tableaux du chemin `bandCount` seulement si `n` a changé. */
  private ensureGroupedCapacity(n: number): number {
    const count = Math.max(1, Math.round(n));
    if (this.groupedHeights.length !== count) {
      this.groupedHeights = new Float32Array(count);
      this.groupedPeakHeights = new Float32Array(count);
      this.groupedPeakVelocities = new Float32Array(count);
      this.groupedGlowTransforms = Array.from({ length: count }, () => ({ x: 0, y: 0, scale: 0, alpha: 0 }));
    }
    return count;
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    const gap = this.param('gap', DEFAULT_GAP);
    const reflectionAlpha = this.param('reflectionAlpha', DEFAULT_REFLECTION_ALPHA);
    const glowAlphaMul = this.param('glowAlphaMul', DEFAULT_GLOW_ALPHA_MUL);
    const bandCount = this.param('bandCount', 0);

    const halfW = viewport.aspect >= 1 ? viewport.aspect / 2 : 0.5;
    const totalWidth = halfW * 1.6;

    if (bandCount > 0) {
      const n = this.groupedHeights.length; // déjà dimensionné par update() de cette même image
      this.drawBars(renderer, n, () => totalWidth / n, this.groupedHeights, this.groupedPeakHeights, this.groupedGlowTransforms, totalWidth, gap, reflectionAlpha, glowAlphaMul);
    } else {
      this.drawBars(
        renderer,
        BAND_COUNT,
        (i) => (BAND_WIDTH_WEIGHTS[i]! / TOTAL_WEIGHT) * totalWidth,
        this.heights,
        this.peakHeights,
        this.glowTransforms,
        totalWidth,
        gap,
        reflectionAlpha,
        glowAlphaMul,
      );
    }
  }

  /** Dessin commun aux deux chemins — `widthOf(i)` renvoie la largeur PLEINE du créneau i (gap inclus), voir le commentaire d'en-tête. */
  private drawBars(
    renderer: Renderer,
    count: number,
    widthOf: (i: number) => number,
    heights: Float32Array,
    peakHeights: Float32Array,
    glowTransforms: SpriteTransform[],
    totalWidth: number,
    gap: number,
    reflectionAlpha: number,
    glowAlphaMul: number,
  ): void {
    const left = -totalWidth / 2;
    const barColor: Color = this.palette.primary;
    const reflectionColor: Color = { ...barColor, a: barColor.a * reflectionAlpha };

    let cursor = left;
    for (let i = 0; i < count; i++) {
      const slotWidth = widthOf(i);
      const width = slotWidth - gap;
      const height = heights[i]! * MAX_HEIGHT;
      const cx = cursor + width / 2;

      this.drawBar(renderer, cx, BASELINE, width, height, barColor);
      this.drawBar(renderer, cx, BASELINE, width, -height * (1 - reflectionAlpha), reflectionColor);

      const peakY = BASELINE + peakHeights[i]! * MAX_HEIGHT;
      this.drawBar(renderer, cx, peakY, width, PEAK_HEIGHT, barColor);

      const t = glowTransforms[i]!;
      t.x = cx;
      t.y = BASELINE + height;
      t.scale = 0.12 + heights[i]! * 0.18;
      t.alpha = Math.min(1, heights[i]! * 0.5 * glowAlphaMul);

      cursor += slotWidth;
    }
    renderer.drawSprite(this.glowSprite, glowTransforms, count);
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
    this.groupedHeights.fill(0);
    this.groupedPeakHeights.fill(0);
    this.groupedPeakVelocities.fill(0);
  }

  dispose(): void {}
}
