import type { Color, Renderer, SpriteHandle, SpriteTransform } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Palette } from '../../palette/Palette';
import { TRACE_CRATER, TRACE_DUST, TRACE_SCAR, TraceField } from '../../memory/TraceField';

/**
 * Empreintes laissées par les événements (blueprint §F1, chantier P0 n°2).
 * Couche de PREUVE : elle rend visible le `TraceField` sur `pulse` et `field`,
 * pour qu'on puisse juger la mémoire à l'œil avant de bâtir le style `sillage`
 * (§E1, chantier P2 n°6) qui en fera son sujet entier.
 *
 * LA RETENUE EST LE POINT, PAS UN RÉGLAGE
 * ---------------------------------------
 * Une empreinte ne doit JAMAIS concurrencer la géométrie vivante : c'est du
 * passé, ça se lit au second regard. D'où `MAX_ALPHA` très bas et la position
 * de la couche dans la pile, juste au-dessus du fond et sous tout le reste.
 * Le test à l'œil qui compte n'est pas « est-ce que je les vois » mais
 * « est-ce que le break montre l'histoire du morceau ».
 *
 * TROIS PRIMITIVES, CHOISIES PAR LEUR COÛT
 * ----------------------------------------
 * - poussière : sprite pré-rendu, TOUTES les instances en un seul
 *   `drawSprite` — c'est la famille la plus nombreuse (docs/10 : jamais un
 *   `arc()` par particule) ;
 * - cratère : `strokeCircle`, au plus quelques dizaines vivants ;
 * - cicatrice : `strokePath` sur deux points, tableaux pré-alloués.
 *
 * `SpriteTransform` ne porte pas de rotation, ce qui interdit de faire
 * l'entaille oblique avec un sprite : d'où `strokePath`. Ce n'est pas un
 * détour, c'est la seule primitive orientable du `Renderer`.
 */

const SPRITE_SIZE = 32;

/** Opacité maximale d'une empreinte fraîche, avant décroissance. Voir « LA RETENUE ». */
const DEFAULT_MAX_ALPHA = 0.3;

/** Rayon d'un cratère au dépôt, et son élargissement en fin de vie. */
const CRATER_RADIUS = 0.045;
const CRATER_SPREAD = 0.03;
const CRATER_LINE_WIDTH = 0.0035;

/** Demi-longueur d'une entaille et son épaisseur. */
const SCAR_HALF_LENGTH = 0.055;
const SCAR_LINE_WIDTH = 0.004;

/** Diamètre de rendu d'un grain de poussière, unités normalisées. */
const DUST_DIAMETER = 0.018;

/**
 * Décroissance PERCEPTUELLE : l'alpha suit le carré du reste de vie plutôt que
 * le reste lui-même. Une décroissance linéaire garde une empreinte lisible
 * pendant les trois quarts de sa durée puis disparaît d'un coup ; le carré la
 * fait s'effacer tôt et longtemps, ce qui se lit comme une trace qui s'estompe
 * et non comme un calque qu'on éteint.
 */
function fade(remaining: number): number {
  return remaining * remaining;
}

export class TraceMarks implements Layer {
  readonly id = 'traceMarks';
  /**
   * `background` : ces marques sont gravées DANS la surface, elles ne sont pas
   * un objet de la scène. La famille décide aussi de leur place dans l'éditeur
   * de composition, où « fond » est le bon rayon pour aller les éteindre.
   */
  readonly kind: LayerKind = 'background';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  readonly field = new TraceField();

  private palette!: Palette;
  private dustSprite!: SpriteHandle;
  /** Une transformation par emplacement du champ : alloué une fois, muté en place. */
  private readonly dustTransforms: SpriteTransform[] = [];
  private readonly scarXs = new Float32Array(2);
  private readonly scarYs = new Float32Array(2);

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
    const color = ctx.palette.secondary;
    this.dustSprite = ctx.renderer.createSprite((offCtx) => {
      const gradient = offCtx.createRadialGradient(SPRITE_SIZE / 2, SPRITE_SIZE / 2, 0, SPRITE_SIZE / 2, SPRITE_SIZE / 2, SPRITE_SIZE / 2);
      gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 1)`);
      gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
      offCtx.fillStyle = gradient;
      offCtx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    }, SPRITE_SIZE);
  }

  private param(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  update(step: StepContext, _signals: VisualSignals): void {
    this.field.update(step);
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const maxAlpha = this.param('traceAlpha', DEFAULT_MAX_ALPHA);
    if (maxAlpha <= 0) return;

    const field = this.field;
    let dustCount = 0;

    for (let i = 0; i < field.count; i++) {
      const remaining = field.remaining(i);
      if (remaining <= 0) continue;
      const alpha = fade(remaining) * field.amplitudes[i]! * maxAlpha;
      if (alpha <= 0.002) continue;

      const x = field.xs[i]!;
      const y = field.ys[i]!;

      switch (field.kinds[i]) {
        case TRACE_CRATER: {
          // Le cratère s'ÉLARGIT en vieillissant : une onde de choc qui se
          // dissipe, pas une pastille qui s'éteint sur place.
          const radius = CRATER_RADIUS + (1 - remaining) * CRATER_SPREAD;
          renderer.strokeCircle(x, y, radius, CRATER_LINE_WIDTH, withAlpha(this.palette.primary, alpha));
          break;
        }
        case TRACE_SCAR: {
          const angle = field.angles[i]!;
          const dx = Math.cos(angle) * SCAR_HALF_LENGTH;
          const dy = Math.sin(angle) * SCAR_HALF_LENGTH;
          this.scarXs[0] = x - dx;
          this.scarYs[0] = y - dy;
          this.scarXs[1] = x + dx;
          this.scarYs[1] = y + dy;
          renderer.strokePath(this.scarXs, this.scarYs, 2, SCAR_LINE_WIDTH, withAlpha(this.palette.accent, alpha), false);
          break;
        }
        case TRACE_DUST: {
          // Le tableau grandit au plus jusqu'à la capacité du champ, une seule
          // fois : après quelques mesures il ne réalloue plus jamais.
          let t = this.dustTransforms[dustCount];
          if (t === undefined) {
            t = { x: 0, y: 0, scale: DUST_DIAMETER, alpha: 0 };
            this.dustTransforms.push(t);
          }
          t.x = x;
          t.y = y;
          t.scale = DUST_DIAMETER * (0.6 + 0.4 * remaining);
          t.alpha = alpha;
          dustCount++;
          break;
        }
        default:
          break;
      }
    }

    if (dustCount > 0) renderer.drawSprite(this.dustSprite, this.dustTransforms, dustCount);
  }

  reset(_t: number): void {
    // Le champ ne se VIDE pas : il se RECONSTRUIT depuis la timeline au
    // prochain `update()`. Le vider ici et s'arrêter là ferait exactement le
    // défaut que la Loi 1 interdit — l'image après un saut dépendrait du
    // chemin par lequel on y est arrivé.
    this.field.markStale();
  }

  dispose(): void {}
}

function withAlpha(color: Color, alpha: number): Color {
  return { r: color.r, g: color.g, b: color.b, a: color.a * alpha };
}
