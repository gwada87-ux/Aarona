/**
 * `chambre` — lofi, jazzhop, downtempo (docs/17_PHASE2_VISUELS.md §8, chantier 6).
 *
 * LE PRINCIPE : LA TEXTURE, PAS L'IMPACT
 * --------------------------------------
 * Rien ne doit être brusque. C'est le style « repos » du catalogue, et son rôle
 * dans l'ensemble est double : offrir une respiration au milieu des styles
 * violents, et laisser du budget aux autres.
 *
 * Le kick ne produit qu'une inflexion de 2 % sur la luminosité du faisceau —
 * DÉLIBÉRÉMENT sous le seuil de conscience. On ne doit pas voir l'image réagir ;
 * on doit seulement sentir qu'elle est vivante. Un lofi qui pulse au kick n'est
 * plus du lofi.
 *
 * ACCENT PRINCIPAL (§8) : le FAISCEAU oblique. C'est lui qui structure le cadre
 * sur une capture figée, et les poussières n'existent que parce qu'il les
 * éclaire.
 *
 * `prefers-reduced-motion` : ce style doit passer SANS AUCUNE modification.
 * Rien n'y clignote, rien n'y bouge vite — c'est une contrainte tenue par
 * construction, pas par un garde-fou.
 */

import type { Color, Renderer, SpriteHandle, SpriteTransform } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import { NO_SAFE_AREA, safeRect } from '../../../render/safeArea';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import { hash } from '../../../core/rng/hash';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import { lerpColor, type Palette } from '../../palette/Palette';

/** Grains de poussière. Un seul sprite, placé N fois. */
const MOTES = 90;
const MOTE_SPRITE_SIZE = 16;
/** Rayures de pellicule simultanées. */
const SCRATCHES = 3;
/** Inclinaison du faisceau, en unités normalisées de décalage horizontal par unité de hauteur. */
const BEAM_SLANT = 0.42;
/** Demi-largeur du faisceau au sommet du cadre. */
const BEAM_TOP_HALF = 0.1;
/** Demi-largeur au pied — un faisceau s'élargit en descendant. */
const BEAM_BOTTOM_HALF = 0.34;
/** Décentrage du faisceau. Jamais centré (§8, §3.6). */
const BEAM_OFFSET = -0.16;
/**
 * Inflexion du kick sur la luminosité du faisceau. 2 % : sous le seuil de
 * conscience, et c'est le chiffre annoncé par §8. Le monter trahirait le style.
 */
const KICK_INFLECTION = 0.02;
/** Vitesse de dérive des poussières, en unités normalisées par seconde. */
const MOTE_DRIFT = 0.012;

export class DustChamber implements Layer {
  readonly id = 'dustChamber';
  readonly kind: LayerKind = 'particles';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private moteSprite!: SpriteHandle;

  private readonly beamX = new Float32Array(4);
  private readonly beamY = new Float32Array(4);
  private readonly scratchX = new Float32Array(4);
  private readonly scratchY = new Float32Array(4);
  private readonly moteTransforms: SpriteTransform[] = Array.from({ length: MOTES }, () => ({
    x: 0,
    y: 0,
    scale: 0,
    alpha: 0,
  }));

  private t = 0;
  private impact = 0;
  private accent = 0;
  private tick = 0;
  private breath = 0.5;
  private barIndex = 0;

  private param(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
    const c = ctx.palette.glow;
    this.moteSprite = ctx.renderer.createSprite((g) => {
      const grad = g.createRadialGradient(
        MOTE_SPRITE_SIZE / 2,
        MOTE_SPRITE_SIZE / 2,
        0,
        MOTE_SPRITE_SIZE / 2,
        MOTE_SPRITE_SIZE / 2,
        MOTE_SPRITE_SIZE / 2,
      );
      grad.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 1)`);
      grad.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, MOTE_SPRITE_SIZE, MOTE_SPRITE_SIZE);
    }, MOTE_SPRITE_SIZE);
  }

  update(step: StepContext, signals: VisualSignals): void {
    this.t = step.t;
    this.impact = signals.impact;
    this.accent = signals.accent;
    this.tick = signals.tick;
    // RESPIRATION du vignettage sur la PHRASE, pas sur la mesure : à 90 BPM une
    // mesure dure 2,7 s, ce qui donnerait une pulsation perceptible. Sur la
    // phrase, le cycle dure une vingtaine de secondes et ne se remarque pas.
    this.breath = signals.lfoA;
    this.barIndex = step.bar.index;
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    const frame = safeRect(viewport.aspect, NO_SAFE_AREA);
    this.drawBeam(renderer, frame);
    this.drawMotes(renderer, frame);
    this.drawScratches(renderer, frame);
  }

  /**
   * Le FAISCEAU, en trapèze oblique. Sa luminosité porte l'inflexion du kick —
   * 2 %, invisible en tant que réaction, sensible en tant que présence.
   *
   * La CAISSE CLAIRE décale sa teinte vers l'accent : deuxième canal, et le
   * seul de ce style qui produise quelque chose de repérable à l'œil nu.
   */
  private drawBeam(renderer: Renderer, frame: { left: number; right: number; top: number; bottom: number }): void {
    const slant = this.param('slant', BEAM_SLANT);
    const height = frame.top - frame.bottom;
    const cxTop = BEAM_OFFSET + slant * height * 0.5;
    const cxBottom = BEAM_OFFSET - slant * height * 0.5;

    this.beamX[0] = cxTop - BEAM_TOP_HALF;
    this.beamY[0] = frame.top;
    this.beamX[1] = cxTop + BEAM_TOP_HALF;
    this.beamY[1] = frame.top;
    this.beamX[2] = cxBottom + BEAM_BOTTOM_HALF;
    this.beamY[2] = frame.bottom;
    this.beamX[3] = cxBottom - BEAM_BOTTOM_HALF;
    this.beamY[3] = frame.bottom;

    const base = lerpColor(this.palette.glow, this.palette.accent, this.accent * 0.45);
    // `breath` module l'alpha de fond, `impact` n'ajoute que 2 %.
    const alpha = (0.055 + this.breath * 0.02 + this.impact * KICK_INFLECTION) * this.param('beamAlphaMul', 1);
    renderer.fillPath(this.beamX, this.beamY, 4, { r: base.r, g: base.g, b: base.b, a: alpha });
  }

  /**
   * Poussières : UN sprite, placé `MOTES` fois. Leurs positions dérivent
   * lentement et se rebouclent, sans état — chaque position est une fonction
   * pure de `t` et de l'index, donc un seek n'a rien à rattraper.
   *
   * Elles ne sont visibles que DANS le faisceau : c'est ce qui fait qu'on lit
   * un rai de lumière et pas un ciel étoilé.
   */
  private drawMotes(renderer: Renderer, frame: { left: number; right: number; top: number; bottom: number }): void {
    const drift = this.param('driftSpeed', MOTE_DRIFT);
    const spanX = frame.right - frame.left;
    const spanY = frame.top - frame.bottom;
    const slant = this.param('slant', BEAM_SLANT);

    for (let i = 0; i < MOTES; i++) {
      const h = hash(0x44555354, i);
      const ux = (h / 0xffffffff);
      const uy0 = ((h >>> 11) % 10000) / 10000;
      // Dérive verticale lente, rebouclée. `%` sur une valeur toujours positive.
      const uy = (uy0 + this.t * drift * (0.6 + ux * 0.8)) % 1;
      const x = frame.left + ux * spanX;
      const y = frame.bottom + uy * spanY;

      // Atténuation par la distance à l'axe du faisceau.
      const axis = BEAM_OFFSET + slant * (y - (frame.bottom + spanY * 0.5));
      const half = BEAM_TOP_HALF + (1 - uy) * (BEAM_BOTTOM_HALF - BEAM_TOP_HALF);
      const inBeam = Math.max(0, 1 - Math.abs(x - axis) / Math.max(1e-4, half));

      const tr = this.moteTransforms[i]!;
      tr.x = x;
      tr.y = y;
      tr.scale = 0.004 + ((h >>> 23) % 100) / 100 * 0.006;
      tr.alpha = inBeam * inBeam * (0.18 + this.breath * 0.1);
    }
    renderer.drawSprite(this.moteSprite, this.moteTransforms, MOTES);
  }

  /**
   * Rayures de pellicule, portées par le CHARLEY. Intermittentes par
   * construction : leur présence dépend d'un hachage de l'index de MESURE, donc
   * elles apparaissent et disparaissent sans jamais clignoter — une rayure qui
   * changerait à chaque image serait du bruit, pas du grain.
   */
  private drawScratches(renderer: Renderer, frame: { left: number; right: number; top: number; bottom: number }): void {
    const grain = this.tick * this.param('grainMul', 1);
    if (grain < 0.03) return;
    const spanX = frame.right - frame.left;
    const width = 0.0018;

    for (let s = 0; s < SCRATCHES; s++) {
      const h = hash(0x53435243, this.barIndex * 4 + s);
      // Une rayure sur deux environ : le seuil crée l'intermittence.
      if (h % 100 < 45) continue;
      const x = frame.left + (h / 0xffffffff) * spanX;
      this.scratchX[0] = x - width;
      this.scratchY[0] = frame.bottom;
      this.scratchX[1] = x + width;
      this.scratchY[1] = frame.bottom;
      this.scratchX[2] = x + width;
      this.scratchY[2] = frame.top;
      this.scratchX[3] = x - width;
      this.scratchY[3] = frame.top;
      const c: Color = { r: 255, g: 250, b: 240, a: grain * 0.12 };
      renderer.fillPath(this.scratchX, this.scratchY, 4, c);
    }
  }

  reset(_t: number): void {
    // Sans état : les positions sont des fonctions pures de `t`.
  }

  dispose(): void {}
}
