/**
 * `eclats` — drum & bass, jungle, breakbeat (docs/17_PHASE2_VISUELS.md §8,
 * chantier 6).
 *
 * LE PRINCIPE : LA SYNCOPE
 * ------------------------
 * Sur un break, l'imprévisibilité rythmique est le sujet. Le cadre se brise sur
 * chaque caisse claire, les éclats se décalent et se recollent avant la
 * suivante.
 *
 * ACCENT PRINCIPAL (§8) : le DÉCALAGE DES ÉCLATS, porté par la caisse claire.
 * Sur une capture figée, c'est la dislocation qui saute aux yeux.
 *
 * LA CONTRAINTE QUI A CHANGÉ LA CONCEPTION
 * ----------------------------------------
 * `docs/17` §8 la signale, et elle mérite d'être répétée ici : l'idée naturelle
 * — chaque éclat montrant une portion de l'image DÉCALÉE DANS LE TEMPS — est
 * irréalisable. `drawFeedback(scale, alpha)` redessine l'image précédente
 * ENTIÈRE ; il n'existe ni `clip()` ni lecture de région dans l'interface.
 * N'y repars pas.
 *
 * La conception est donc entièrement GÉOMÉTRIQUE : les éclats sont des
 * polygones dessinés, pas des morceaux d'image découpés.
 *
 * POURQUOI PAS UN VRAI VORONOÏ
 * ----------------------------
 * §8 dit « partition de Voronoï pré-calculée ». Un vrai diagramme de Voronoï
 * demande une triangulation de Delaunay — quelques centaines de lignes, pour un
 * résultat visuellement indiscernable ici. La partition retenue est POLAIRE :
 * anneaux × secteurs, avec rayons et angles perturbés par hachage. Elle produit
 * la même lecture — un miroir brisé, éclats plus fins au centre — et se calcule
 * en une passe triviale, une seule fois.
 */

import type { Color, Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import { hash } from '../../../core/rng/hash';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import { lerpColor, type Palette } from '../../palette/Palette';

/** Anneaux de la partition. */
const RINGS = 5;
/** Secteurs par anneau. */
const SECTORS = 10;
const CELLS = RINGS * SECTORS;
/** Rayon extérieur de la partition, en unités normalisées. Déborde du cadre à dessein. */
const OUTER_R = 0.95;
/** Décalage maximal d'un éclat sur une frappe. */
const MAX_SHIFT = 0.075;
/** Rotation maximale d'un éclat, en radians. Faible : au-delà, les éclats se chevauchent. */
const MAX_SPIN = 0.16;
/** Respiration d'échelle sur le kick. */
const KICK_BREATH = 0.06;
/** Vibration des arêtes sur le charley. */
const TICK_JITTER = 0.008;
/** Décentrage du point d'impact. Jamais centré (§8, §3.6). */
const IMPACT_X = 0.14;
const IMPACT_Y = -0.08;

export class ShatterCells implements Layer {
  readonly id = 'shatterCells';
  readonly kind: LayerKind = 'geometry';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;

  /**
   * Partition PRÉ-CALCULÉE une seule fois : centre de chaque éclat, et ses
   * quatre sommets en coordonnées relatives au centre. La transformer revient
   * ensuite à une translation et une rotation — aucune trigonométrie de
   * partition par image.
   */
  private readonly cellCx = new Float32Array(CELLS);
  private readonly cellCy = new Float32Array(CELLS);
  private readonly cellVx = new Float32Array(CELLS * 4);
  private readonly cellVy = new Float32Array(CELLS * 4);
  /** Distance normalisée au point d'impact, pré-calculée : elle pondère le décalage. */
  private readonly cellFar = new Float32Array(CELLS);

  private readonly quadX = new Float32Array(4);
  private readonly quadY = new Float32Array(4);

  private accent = 0;
  private impact = 0;
  private tick = 0;
  private drift = 0.5;
  private barIndex = 0;

  private param(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
    this.buildPartition();
  }

  /** Une seule fois, à l'initialisation. Jamais par image. */
  private buildPartition(): void {
    for (let ring = 0; ring < RINGS; ring++) {
      // Rayons en progression quadratique : éclats fins au centre, larges au
      // bord — c'est ainsi que casse un vrai panneau de verre.
      const r0 = OUTER_R * Math.pow(ring / RINGS, 1.6);
      const r1 = OUTER_R * Math.pow((ring + 1) / RINGS, 1.6);
      for (let sec = 0; sec < SECTORS; sec++) {
        const index = ring * SECTORS + sec;
        const h = hash(0x45434c54, index);
        // Perturbation des bornes : sans elle, la partition se lit comme une
        // cible et non comme une cassure.
        const jitterA = ((h & 0xffff) / 0xffff - 0.5) * (Math.PI * 2) / SECTORS * 0.45;
        const jitterR = ((h >>> 16) / 0xffff - 0.5) * (r1 - r0) * 0.4;
        const a0 = (sec / SECTORS) * Math.PI * 2 + jitterA;
        const a1 = ((sec + 1) / SECTORS) * Math.PI * 2 + jitterA;
        const ri = r0 + jitterR;
        const ro = r1 + jitterR;

        const xs = [Math.cos(a0) * ri, Math.cos(a0) * ro, Math.cos(a1) * ro, Math.cos(a1) * ri];
        const ys = [Math.sin(a0) * ri, Math.sin(a0) * ro, Math.sin(a1) * ro, Math.sin(a1) * ri];
        const cx = (xs[0]! + xs[1]! + xs[2]! + xs[3]!) / 4;
        const cy = (ys[0]! + ys[1]! + ys[2]! + ys[3]!) / 4;
        this.cellCx[index] = cx;
        this.cellCy[index] = cy;
        for (let k = 0; k < 4; k++) {
          this.cellVx[index * 4 + k] = xs[k]! - cx;
          this.cellVy[index * 4 + k] = ys[k]! - cy;
        }
        // Les éclats PROCHES du point d'impact bougent plus (§8).
        const d = Math.hypot(cx - IMPACT_X, cy - IMPACT_Y);
        this.cellFar[index] = Math.max(0, 1 - d / (OUTER_R * 1.2));
      }
    }
  }

  update(step: StepContext, signals: VisualSignals): void {
    this.accent = signals.accent;
    this.impact = signals.impact;
    this.tick = signals.tick;
    this.drift = signals.lfoB;
    this.barIndex = step.bar.index;
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    // `aspect` n'entre pas dans le calcul : la partition est circulaire et
    // déborde du cadre dans les trois formats. C'est ce qui la rend correcte en
    // 9:16 comme en 16:9 sans une seule ligne conditionnelle (Loi 4).
    void viewport;

    const shift = this.accent * this.param('shiftMax', MAX_SHIFT);
    const spin = this.accent * this.param('spinMax', MAX_SPIN);
    // Le KICK fait respirer l'échelle globale — canal distinct du décalage.
    const scale = 1 + this.impact * this.param('kickBreath', KICK_BREATH);
    const jitter = this.tick * TICK_JITTER;

    for (let i = 0; i < CELLS; i++) {
      const far = this.cellFar[i]!;
      const cx = this.cellCx[i]!;
      const cy = this.cellCy[i]!;
      const dist = Math.hypot(cx - IMPACT_X, cy - IMPACT_Y) || 1e-6;
      // Décalage RADIAL depuis le point d'impact : les éclats fuient la
      // cassure, ils ne glissent pas dans une direction commune.
      const push = shift * far;
      const ox = ((cx - IMPACT_X) / dist) * push;
      const oy = ((cy - IMPACT_Y) / dist) * push;

      // Rotation propre, de signe alterné par hachage — deux éclats voisins qui
      // tourneraient dans le même sens se liraient comme une roue.
      const sign = (hash(0x53504e, i) & 1) === 0 ? 1 : -1;
      const ang = spin * far * sign;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // Vibration d'arête sur le charley, hachée par éclat et par mesure : elle
      // ne change qu'aux frontières de mesure, donc elle ne grouille pas.
      const jx = ((hash(0x4a495452, i + this.barIndex * 97) / 0xffffffff) - 0.5) * jitter;

      for (let k = 0; k < 4; k++) {
        const vx = this.cellVx[i * 4 + k]! * scale;
        const vy = this.cellVy[i * 4 + k]! * scale;
        this.quadX[k] = cx + ox + vx * ca - vy * sa + jx;
        this.quadY[k] = cy + oy + vx * sa + vy * ca;
      }

      // Valeur par éclat : le décalage l'éclaircit, ce qui fait ressortir la
      // dislocation même sur une capture figée.
      const base = lerpColor(this.palette.bg[1], this.palette.primary, 0.25 + far * 0.35);
      const litColor = lerpColor(base, this.palette.accent, this.accent * far * 0.7);
      const a = 0.55 + this.drift * 0.15;
      const color: Color = { r: litColor.r, g: litColor.g, b: litColor.b, a };
      renderer.fillPath(this.quadX, this.quadY, 4, color);
    }
  }

  reset(_t: number): void {
    // La partition ne change jamais ; les signaux sont relus au prochain update.
  }

  dispose(): void {}
}
