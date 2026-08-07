import type { Renderer, SpriteHandle, SpriteTransform } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Color } from '../../../render/Renderer';

const SPRITE_SIZE = 128; // docs/07 §"Le glow : jamais shadowBlur" — 128×128, exemple donné
const DEFAULT_GLOW_DIAMETER = 0.5; // taille de rendu, unités normalisées — non spécifié précisément
const DEFAULT_INTENSITY_MUL = 1;
/** Gonflement du halo au sommet d'une montée, en fraction du diamètre. */
const TENSION_SWELL = 0.55;
/**
 * Dérive lente du halo, en unités normalisées. Petite mais non nulle : §8
 * refuse qu'un élément reste rigoureusement centré, et un halo parfaitement
 * immobile au milieu du cadre est la signature la plus reconnaissable d'un
 * visualiseur bas de gamme.
 */
const LFO_DRIFT = 0.045;

/**
 * Glow du style Pulse (docs/07) : « halo central, intensité = drive, teinte
 * = brightness ». Sprite pré-rendu additif, JAMAIS `ctx.shadowBlur`
 * (docs/07 §"Techniques Canvas 2D indispensables").
 *
 * Un sprite est rendu UNE FOIS (`createSprite`, en `init`) : il ne peut donc
 * pas changer de teinte image par image sans le re-rendre, ce que la règle
 * de performance interdit. Compromis retenu : deux variantes pré-rendues
 * (`palette.temperature(0)` froid, `temperature(1)` chaud), dessinées
 * ADDITIVEMENT toutes les deux avec des poids d'alpha complémentaires
 * (`1-brightness` / `brightness`) — un fondu enchaîné entre deux sprites
 * fixes, pas un sprite recoloré.
 */
export class CentralGlow implements Layer {
  readonly id = 'centralGlow';
  readonly kind: LayerKind = 'glow';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private coolSprite!: SpriteHandle;
  private hotSprite!: SpriteHandle;
  private drive = 0;
  private brightness = 0;
  private tension = 0;
  private driftX = 0;
  private driftY = 0;
  private readonly transform: SpriteTransform[] = [{ x: 0, y: 0, scale: 1, alpha: 1 }];

  init(ctx: LayerInitContext): void {
    const cool = ctx.palette.temperature(0);
    const hot = ctx.palette.temperature(1);
    this.coolSprite = ctx.renderer.createSprite((offCtx) => drawGlowSprite(offCtx, SPRITE_SIZE, cool), SPRITE_SIZE);
    this.hotSprite = ctx.renderer.createSprite((offCtx) => drawGlowSprite(offCtx, SPRITE_SIZE, hot), SPRITE_SIZE);
  }

  update(_step: StepContext, signals: VisualSignals): void {
    this.drive = signals.drive;
    this.brightness = signals.brightness;
    this.tension = signals.tension;
    // Deux LFO en QUADRATURE pour une dérive elliptique. Utiliser deux fois le
    // même donnerait une diagonale, qui se lit comme un glissement et non comme
    // une flottaison.
    this.driftX = (signals.lfoC - 0.5) * 2 * LFO_DRIFT;
    this.driftY = (signals.lfoB - 0.5) * 2 * LFO_DRIFT * 0.6;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const intensityRaw = this.params.intensityMul;
    const intensityMul = typeof intensityRaw === 'number' ? intensityRaw : DEFAULT_INTENSITY_MUL;
    const diameterRaw = this.params.diameter;
    const baseDiameter = typeof diameterRaw === 'number' ? diameterRaw : DEFAULT_GLOW_DIAMETER;
    // ANTICIPATION du drop sur le DIAMÈTRE, pas sur l'intensité : `drive` tient
    // déjà l'intensité, et empiler les deux violerait « un instrument, un
    // canal ». Le halo enfle sans s'éclaircir — le cadre se remplit avant que
    // quoi que ce soit n'arrive, ce qui est exactement la sensation cherchée.
    const diameter = baseDiameter * (1 + this.tension * TENSION_SWELL);

    const coolAlpha = Math.min(1, (1 - this.brightness) * this.drive * intensityMul);
    const hotAlpha = Math.min(1, this.brightness * this.drive * intensityMul);
    // Tableaux de transformation MUTÉS en place : un littéral par image serait
    // une allocation dans la boucle de rendu, interdite par CLAUDE.md.
    const t = this.transform[0]!;
    t.x = this.driftX;
    t.y = this.driftY;
    t.scale = diameter;
    if (coolAlpha > 0.001) {
      t.alpha = coolAlpha;
      renderer.drawSprite(this.coolSprite, this.transform, 1);
    }
    if (hotAlpha > 0.001) {
      t.alpha = hotAlpha;
      renderer.drawSprite(this.hotSprite, this.transform, 1);
    }
  }

  reset(_t: number): void {
    // Rien à restaurer : `drive`/`brightness` recalculés par le prochain update().
  }

  dispose(): void {}
}

function drawGlowSprite(ctx: OffscreenCanvasRenderingContext2D, size: number, color: Color): void {
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 1)`);
  gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
}
