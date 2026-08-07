/**
 * `iso-pulse` — house, techno, garage (docs/17_PHASE2_VISUELS.md §8, chantier 5).
 *
 * LE PRINCIPE : LA RÉGULARITÉ EST LE PLAISIR
 * ------------------------------------------
 * Sur du four-on-the-floor, l'hypnose vient de la répétition parfaite. Ce style
 * est un métronome qu'on regarde sans s'ennuyer : chaque kick lance une onde de
 * soulèvement qui se propage en losange, plusieurs ondes coexistent et
 * s'additionnent en hauteur. On peut compter le tempo à l'œil, son coupé.
 *
 * ACCENT PRINCIPAL (§8) : l'ONDE DE SOULÈVEMENT, portée par le kick. Sur une
 * capture figée, c'est le relief de la grille qui la désigne.
 *
 * UN INSTRUMENT, UN CANAL
 * -----------------------
 * kick → hauteur des ondes · caisse claire → damier de valeurs · charley →
 * scintillement des crêtes · sub (continu) → inclinaison de la grille ·
 * anticipation → resserrement de la maille · LFO → dérive de la trame.
 *
 * ÉCART ASSUMÉ SUR LA CONCEPTION ANNONCÉE
 * ---------------------------------------
 * `docs/17` §8 prévoyait « 8 tranches de hauteur, donc 8 `fillPath` ». C'est
 * irréalisable : `fillPath(xs, ys, count, color)` dessine **un seul polygone**,
 * pas une collection de sous-chemins. Regrouper cent tuiles en huit appels
 * demanderait un `beginPath` partagé que l'interface n'expose pas.
 *
 * Conception retenue : la grille est un MAILLAGE — une polyligne par rangée et
 * par colonne, dont les sommets se soulèvent. Coût : `2 · N` appels de
 * `strokePath` au lieu de `N²` de `fillPath`, soit 24 au lieu de 144 pour une
 * grille de 12. Seules les tuiles de CRÊTE sont remplies, et leur nombre est
 * plafonné. Le rendu est celui décrit — une grille isométrique qui ondule —
 * pour un coût qui tient dans le budget de 9 ms.
 *
 * LOI 4 : la projection isométrique est calculée EN JS. L'interface n'expose
 * aucun `setTransform`, et de toute façon la hauteur par tuile n'est pas une
 * transformation affine.
 */

import type { Color, Renderer, SpriteHandle, SpriteTransform } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import { NO_SAFE_AREA, safeRect } from '../../../render/safeArea';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import { hash } from '../../../core/rng/hash';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import { lerpColor, type Palette } from '../../palette/Palette';

/** Tuiles par côté. 12 donne 24 polylignes — assez dense pour lire une grille, assez peu pour tenir. */
const N = 12;
/** Ondes simultanées. Au-delà de 6 elles se confondent et le tempo cesse d'être lisible. */
const MAX_WAVES = 6;
/** Durée de vie d'une onde, en TEMPS musicaux : elle traverse la grille en deux temps. */
const WAVE_LIFE_BEATS = 2;
/** Hauteur d'une crête, en unités normalisées. */
const WAVE_HEIGHT = 0.075;
/** Largeur du front de l'onde, en tuiles. */
const WAVE_WIDTH = 2.2;
/** Demi-largeur de la grille au repos. */
const GRID_HALF = 0.46;
/** Écrasement vertical de la projection isométrique. 0,5 est l'isométrie de jeu classique. */
const ISO_SQUASH = 0.5;
/** Tuiles de crête remplies au maximum. Plafond de coût, pas de goût. */
const MAX_CREST = 20;
const SPARK_SPRITE_SIZE = 24;

export class IsoGrid implements Layer {
  readonly id = 'isoGrid';
  readonly kind: LayerKind = 'field';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private sparkSprite!: SpriteHandle;

  /** Hauteur par sommet, recalculée dans `update`, lue dans `draw`. */
  private readonly heights = new Float32Array((N + 1) * (N + 1));
  /** Ondes vivantes : origine (i, j) et instant d'émission, en TEMPS musicaux. */
  private readonly waveI = new Float32Array(MAX_WAVES);
  private readonly waveJ = new Float32Array(MAX_WAVES);
  private readonly waveBeat = new Float32Array(MAX_WAVES).fill(Number.NEGATIVE_INFINITY);
  private waveCursor = 0;

  private readonly lineX = new Float32Array(N + 1);
  private readonly lineY = new Float32Array(N + 1);
  private readonly crestX = new Float32Array(4);
  private readonly crestY = new Float32Array(4);
  private readonly sparkTransforms: SpriteTransform[] = Array.from({ length: MAX_CREST }, () => ({
    x: 0,
    y: 0,
    scale: 0,
    alpha: 0,
  }));

  private accent = 0;
  private tick = 0;
  private tension = 0;
  private weight = 0;
  private drift = 0.5;

  /** Lecture d'un `layer.params` avec repli — même contrat que les autres couches. */
  private param(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }
  private lastKickBeat = Number.NEGATIVE_INFINITY;

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
    const c = ctx.palette.glow;
    this.sparkSprite = ctx.renderer.createSprite((g) => radial(g, SPARK_SPRITE_SIZE, c), SPARK_SPRITE_SIZE);
  }

  update(step: StepContext, signals: VisualSignals): void {
    this.accent = signals.accent;
    this.tick = signals.tick;
    this.tension = signals.tension;
    this.weight = signals.weight;
    this.drift = signals.lfoA;

    // Position musicale CONTINUE en temps. Toute la propagation est comptée
    // là-dedans et non en secondes : à 128 comme à 170 BPM, une onde traverse
    // la grille en deux temps, donc le motif reste lisible au même rythme.
    const beatPos = step.beat.index + step.beat.phase;

    // ÉMISSION sur le kick. Détectée sur `step.fired` plutôt que sur le signal
    // `impact` : il faut un instant discret, et une enveloppe ne dit pas quand
    // elle a commencé.
    for (const event of step.fired) {
      if (event.type !== 'KICK') continue;
      if (beatPos - this.lastKickBeat < 0.05) break; // deux kicks dans le même sous-pas
      this.lastKickBeat = beatPos;
      // Origine hachée sur l'index de temps : chaque kick part d'un coin
      // différent, sans quoi la grille se répéterait à l'identique et
      // l'hypnose deviendrait de la monotonie. Pas de `step.rng` — il est
      // partagé par toutes les couches.
      const h = hash(0x49534f, step.beat.index);
      this.waveI[this.waveCursor] = (h % (N + 1));
      this.waveJ[this.waveCursor] = ((h >>> 8) % (N + 1));
      this.waveBeat[this.waveCursor] = beatPos;
      this.waveCursor = (this.waveCursor + 1) % MAX_WAVES;
      break;
    }

    const life = this.param('waveLifeBeats', WAVE_LIFE_BEATS);
    // HAUTEURS. Somme des ondes vivantes : elles s'additionnent, ce qui produit
    // les interférences qui rendent la grille intéressante sur un motif
    // pourtant parfaitement régulier.
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        let h = 0;
        for (let w = 0; w < MAX_WAVES; w++) {
          const age = beatPos - this.waveBeat[w]!;
          if (!(age >= 0) || age > life) continue;
          const radius = (age / life) * (N * 1.4);
          // Distance en LOSANGE (norme de Manhattan) : c'est elle qui donne la
          // propagation en diamant caractéristique de l'isométrie. Une distance
          // euclidienne produirait un cercle, qui se lit mal sur une grille.
          const d = Math.abs(i - this.waveI[w]!) + Math.abs(j - this.waveJ[w]!);
          const front = 1 - Math.abs(d - radius) / WAVE_WIDTH;
          if (front <= 0) continue;
          // Atténuation avec l'âge : l'onde s'éteint en s'éloignant.
          h += front * front * (1 - age / life);
        }
        this.heights[j * (N + 1) + i] = h;
      }
    }
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    const frame = safeRect(viewport.aspect, NO_SAFE_AREA);
    // La maille se RESSERRE à l'approche du drop : le motif se densifie sans
    // que rien ne s'illumine, ce qui prépare sans dépenser.
    const half = Math.min(GRID_HALF, Math.min(frame.right, frame.top) * 0.92) * (1 - this.tension * 0.12);
    const step = (half * 2) / N;
    // Le SUB incline la grille : une isométrie plus ou moins écrasée. Continu,
    // jamais un à-coup — un basculement brusque ferait perdre le repère.
    const squash = this.param('squash', ISO_SQUASH) * (0.85 + this.weight * 0.3);
    // Dérive très lente de la trame, pour qu'aucun plan ne reste figé.
    const originY = (this.drift - 0.5) * 0.03;

    const base = this.palette.secondary;
    const lit = this.palette.primary;

    // RANGÉES puis COLONNES : 2·(N+1) polylignes au lieu de N² polygones.
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        this.project(i, j, step, half, squash, originY, i);
      }
      renderer.strokePath(this.lineX, this.lineY, N + 1, 0.0022, this.rowColor(base, lit, j), false);
    }
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        this.project(i, j, step, half, squash, originY, j);
      }
      renderer.strokePath(this.lineX, this.lineY, N + 1, 0.0022, this.rowColor(base, lit, i), false);
    }

    this.drawCrests(renderer, step, half, squash, originY);
  }

  /** Projection isométrique + soulèvement, écrite dans `lineX`/`lineY` à l'index `slot`. */
  private project(i: number, j: number, step: number, half: number, squash: number, originY: number, slot: number): void {
    const h = this.heights[j * (N + 1) + i]!;
    this.lineX[slot] = (i - j) * step * 0.5;
    this.lineY[slot] = (i + j - N) * step * 0.5 * squash + h * WAVE_HEIGHT + originY;
    // `half` n'entre pas dans la formule : il a déjà servi à calculer `step`.
    void half;
  }

  /**
   * Damier de valeurs, porté par la CAISSE CLAIRE. Une rangée sur deux
   * s'éclaircit — canal distinct de la hauteur, qui appartient au kick.
   */
  private rowColor(base: Color, lit: Color, index: number): Color {
    const checker = index % 2 === 0 ? this.accent : 0;
    return lerpColor(base, lit, 0.25 + checker * 0.6);
  }

  /**
   * Crêtes : les sommets les plus hauts reçoivent un losange plein et une
   * étincelle. Nombre PLAFONNÉ — sans plafond, un empilement d'ondes ferait
   * exploser le nombre d'appels au pire moment, celui où le budget est déjà
   * le plus sollicité.
   */
  private drawCrests(renderer: Renderer, step: number, half: number, squash: number, originY: number): void {
    let drawn = 0;
    const cap = Math.max(1, Math.round(this.param('crestCap', MAX_CREST)));
    for (let j = 0; j < N && drawn < cap; j++) {
      for (let i = 0; i < N && drawn < cap; i++) {
        const h = this.heights[j * (N + 1) + i]!;
        if (h < 0.45) continue;
        // Losange de la tuile : quatre sommets voisins, déjà soulevés.
        for (let k = 0; k < 4; k++) {
          const di = k === 1 || k === 2 ? 1 : 0;
          const dj = k >= 2 ? 1 : 0;
          const hk = this.heights[(j + dj) * (N + 1) + (i + di)]!;
          this.crestX[k] = (i + di - (j + dj)) * step * 0.5;
          this.crestY[k] = (i + di + j + dj - N) * step * 0.5 * squash + hk * WAVE_HEIGHT + originY;
        }
        renderer.fillPath(this.crestX, this.crestY, 4, lerpColor(this.palette.primary, this.palette.accent, Math.min(1, h)));

        // Étincelle de CHARLEY sur la crête, plafonnée à 40 % de l'accent
        // principal (§8).
        const tr = this.sparkTransforms[drawn]!;
        tr.x = (this.crestX[0]! + this.crestX[2]!) / 2;
        tr.y = (this.crestY[0]! + this.crestY[2]!) / 2;
        tr.scale = 0.02 + this.tick * 0.02;
        tr.alpha = this.tick * 0.4 * this.param('glowMul', 1);
        drawn++;
      }
    }
    void half;
    if (drawn > 0 && this.tick > 0.02) renderer.drawSprite(this.sparkSprite, this.sparkTransforms, drawn);
  }

  reset(_t: number): void {
    this.waveBeat.fill(Number.NEGATIVE_INFINITY);
    this.heights.fill(0);
    this.lastKickBeat = Number.NEGATIVE_INFINITY;
  }

  dispose(): void {}
}

function radial(ctx: OffscreenCanvasRenderingContext2D, size: number, color: Color): void {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 1)`);
  g.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}
