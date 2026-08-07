/**
 * Pochette d'album (docs/17_PHASE2_VISUELS.md §7.5, chantier 7).
 *
 * POURQUOI CETTE COUCHE EXISTE
 * ----------------------------
 * Il n'existait AUCUNE entrée d'image dans tout le projet. Or le cas d'usage le
 * plus courant d'un visualiseur musical, c'est la pochette au centre avec le
 * visuel autour — le format que produisent Specterr, Renderforest et les
 * autres. Sans ça, PULSAR ne pouvait pas rendre ce que la plupart des gens
 * attendent de ce genre d'outil.
 *
 * AUCUNE EXTENSION DU `Renderer` N'A ÉTÉ NÉCESSAIRE
 * -------------------------------------------------
 * `docs/17` §4 autorisait `drawImage` comme seconde extension. Elle n'a pas
 * servi : `createSprite(draw, size)` donne un `OffscreenCanvasRenderingContext2D`
 * hors écran, où l'on peut dessiner l'image UNE FOIS ; `drawSprite` la place
 * ensuite. Les sprites sont carrés, et les pochettes aussi.
 *
 * Ce chemin satisfait par construction la contrainte de la Loi 1 rappelée par
 * §7.5 — « l'image doit être décodée AVANT le rendu, jamais pendant » : le
 * décodage a lieu à l'import, le tracé dans le sprite à l'initialisation de la
 * couche, et la boucle ne fait plus que placer une texture.
 *
 * LA RÉACTION EST VOLONTAIREMENT MINUSCULE
 * ----------------------------------------
 * §7.5 : « réaction discrète au kick (2 à 4 % d'échelle, pas plus — une
 * pochette qui pompe fait cheap) ». C'est la borne haute qui compte. Une
 * pochette est un objet de référence dans le cadre : si elle bouge autant que
 * le décor, elle cesse d'être un point fixe et l'image entière perd son ancre.
 */

import type { Color, Renderer, SpriteHandle, SpriteTransform } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import { NO_SAFE_AREA, safeRect } from '../../../render/safeArea';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Palette } from '../../palette/Palette';

/** Résolution du sprite. 512 suffit : la pochette n'occupe jamais tout le cadre. */
const SPRITE_SIZE = 512;
/** Côté de la pochette, en fraction du petit côté du cadre. */
const DEFAULT_SIZE = 0.42;
/** Rayon des coins, en fraction du côté de la pochette. */
const CORNER_RADIUS = 0.06;
/** Échelle ajoutée par le kick. §7.5 plafonne à 4 % ; on prend 3 %. */
const KICK_SCALE = 0.03;
/** Sprites de halo posés derrière la pochette. */
const HALO_STAMPS = 4;
const HALO_SPRITE_SIZE = 256;

export class CoverArt implements Layer {
  readonly id = 'coverArt';
  readonly kind: LayerKind = 'cover';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private coverSprite: SpriteHandle | null = null;
  private haloSprite!: SpriteHandle;

  private readonly coverTransform: SpriteTransform[] = [{ x: 0, y: 0, scale: 0, alpha: 1 }];
  private readonly haloTransforms: SpriteTransform[] = Array.from({ length: HALO_STAMPS }, () => ({
    x: 0,
    y: 0,
    scale: 0,
    alpha: 0,
  }));

  private impact = 0;
  private drive = 0;
  private driftX = 0;
  private driftY = 0;

  private param(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
    const glow = ctx.palette.glow;
    this.haloSprite = ctx.renderer.createSprite((g) => radial(g, HALO_SPRITE_SIZE, glow), HALO_SPRITE_SIZE);

    const image = ctx.cover ?? null;
    if (!image) {
      // Aucune pochette : la couche est INERTE, elle ne dessine rien. Un
      // rectangle de remplacement serait pire que rien — il occuperait le
      // centre du cadre sans porter d'information.
      this.coverSprite = null;
      return;
    }
    this.coverSprite = ctx.renderer.createSprite((g) => {
      drawRounded(g, SPRITE_SIZE, CORNER_RADIUS * SPRITE_SIZE);
      // `drawImage` DANS le sprite, une seule fois : c'est ici que le décodage
      // se paie, hors de la boucle de rendu.
      g.drawImage(image, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
    }, SPRITE_SIZE);
  }

  update(_step: StepContext, signals: VisualSignals): void {
    this.impact = signals.impact;
    this.drive = signals.drive;
    // Dérive très lente, sur deux LFO en quadrature : la pochette n'est pas
    // rigoureusement collée au centre, ce que §8 refuse pour tout élément.
    this.driftX = (signals.lfoC - 0.5) * 0.02;
    this.driftY = (signals.lfoB - 0.5) * 0.014;
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    if (!this.coverSprite) return;
    const frame = safeRect(viewport.aspect, viewport.safe);
    const size = this.param('size', DEFAULT_SIZE);
    // Recentrage dans la zone SÛRE, pas dans le cadre (§7.4) : en 9:16, une
    // pochette centrée sur le cadre tomberait derrière la légende et les
    // boutons de la plateforme. C'est le premier élément du moteur qui porte de
    // l'information, donc le premier à devoir la respecter.
    const cx = (frame.left + frame.right) / 2 + this.driftX;
    const cy = (frame.bottom + frame.top) / 2 + this.driftY;
    const scale = size * (1 + this.impact * this.param('kickScale', KICK_SCALE));

    // HALO derrière : plusieurs empreintes concentriques, faute de dégradé de
    // forme dans l'interface. Son intensité suit `drive`, un niveau continu —
    // pas un onset, qui ferait clignoter le fond de la pochette.
    const haloAlpha = (0.1 + this.drive * 0.25) * this.param('glowMul', 1);
    for (let i = 0; i < HALO_STAMPS; i++) {
      const t = (i + 1) / HALO_STAMPS;
      const h = this.haloTransforms[i]!;
      h.x = cx;
      h.y = cy;
      h.scale = scale * (1.1 + t * 0.9);
      h.alpha = (haloAlpha * (1 - t * 0.7)) / HALO_STAMPS;
    }
    renderer.drawSprite(this.haloSprite, this.haloTransforms, HALO_STAMPS);

    const tr = this.coverTransform[0]!;
    tr.x = cx;
    tr.y = cy;
    tr.scale = scale;
    tr.alpha = 1;
    renderer.drawSprite(this.coverSprite, this.coverTransform, 1);
  }

  reset(_t: number): void {}

  dispose(): void {
    this.coverSprite = null;
  }
}

/**
 * Découpe un rectangle à coins arrondis dans le sprite avant d'y dessiner
 * l'image. `clip()` est interdit aux COUCHES, qui n'ont pas de contexte — mais
 * `createSprite` en fournit un, hors écran et hors boucle, où il est légitime.
 */
function drawRounded(ctx: OffscreenCanvasRenderingContext2D, size: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.clip();
}

function radial(ctx: OffscreenCanvasRenderingContext2D, size: number, color: Color): void {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 1)`);
  g.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}
