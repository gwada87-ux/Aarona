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
 * de performance interdit. Compromis retenu : des variantes pré-rendues de la
 * dérive de température, dessinées ADDITIVEMENT avec des poids d'alpha dont la
 * somme fait 1 — un fondu enchaîné entre sprites fixes, pas un sprite recoloré.
 *
 * TROIS SPRITES, PAS DEUX (chantier 9, §9.2)
 * ------------------------------------------
 * Il y en avait deux, aux EXTRÊMES de la dérive. `temperature(0,5)` n'était donc
 * lu par personne dans tout le moteur, et le fondu additif entre les deux
 * extrêmes reproduisait exactement le défaut que l'interpolation OKLCH vient de
 * corriger : la somme de deux couleurs opposées à demi-alpha est le milieu
 * ARITHMÉTIQUE, c'est-à-dire la zone terne. Sur `house`, dont la dérive va d'un
 * brun sombre à un cyan, le point milieu perdait 58,5 % de son chroma.
 *
 * Un troisième sprite au milieu perceptuel, et des poids en triangle, font
 * passer le fondu PAR ce milieu. Une seule allocation de plus, à
 * l'initialisation, et `temperature` cesse d'être une fonction dont seules les
 * deux bornes servent.
 */
export class CentralGlow implements Layer {
  readonly id = 'centralGlow';
  readonly kind: LayerKind = 'glow';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private coolSprite!: SpriteHandle;
  private midSprite!: SpriteHandle;
  private hotSprite!: SpriteHandle;
  private drive = 0;
  private brightness = 0;
  private tension = 0;
  private driftX = 0;
  private driftY = 0;
  private readonly transform: SpriteTransform[] = [{ x: 0, y: 0, scale: 1, alpha: 1 }];

  init(ctx: LayerInitContext): void {
    const cool = ctx.palette.temperature(0);
    const mid = ctx.palette.temperature(0.5);
    const hot = ctx.palette.temperature(1);
    this.coolSprite = ctx.renderer.createSprite((offCtx) => drawGlowSprite(offCtx, SPRITE_SIZE, cool), SPRITE_SIZE);
    this.midSprite = ctx.renderer.createSprite((offCtx) => drawGlowSprite(offCtx, SPRITE_SIZE, mid), SPRITE_SIZE);
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

    // Poids en TRIANGLE sur trois sprites : leur somme vaut 1 pour toute valeur
    // de `brightness`, donc l'intensité totale du halo ne dépend que de `drive`
    // - c'est ce qui empêche le fondu de température de se lire comme une
    // pulsation de luminosité.
    const b = this.brightness;
    const gain = this.drive * intensityMul;
    const coolAlpha = Math.min(1, Math.max(0, 1 - 2 * b) * gain);
    const midAlpha = Math.min(1, (1 - Math.abs(2 * b - 1)) * gain);
    const hotAlpha = Math.min(1, Math.max(0, 2 * b - 1) * gain);
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
    if (midAlpha > 0.001) {
      t.alpha = midAlpha;
      renderer.drawSprite(this.midSprite, this.transform, 1);
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
