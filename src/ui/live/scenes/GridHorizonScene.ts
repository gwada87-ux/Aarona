/**
 * `grid-horizon` (§4.2, scene 1) - sol en perspective, soleil a scanlines,
 * brume neon.
 *
 * ACCENT PRINCIPAL (§2.7.6) : le DEFILEMENT du sol. Il avance d'exactement une
 * cellule par temps - le defilement EST le metronome. Son coupe, on doit
 * pouvoir compter le tempo rien qu'en regardant les lignes passer.
 *
 * CANAUX (§2.7.7) : kick -> echelle et impulsion du sol ; snare -> revelation
 * du soleil et decalage lateral du point de fuite ; charley -> scintillement
 * des fuyantes. Aucune addition de deux enveloppes sur un meme parametre.
 *
 * CONTRAINTE TECHNIQUE : le Canvas 2D n'a QUE des transformations affines, pas
 * de division perspective. La perspective est donc calculee en JS, ligne par
 * ligne : pour chaque rangee `i`, `z = z0 / (1 - i/H)`, une ligne horizontale
 * pleine largeur, et les fuyantes projetees a la main. Toute tentative de la
 * confier a `setTransform` donnerait un cisaillement, pas une perspective.
 *
 * Horizon place entre 55 % et 70 % de la hauteur selon la variante, JAMAIS
 * centre (§3.6).
 */

import { resetCompositing } from '../render/LayerStack';
import { DECAY_HAT, DECAY_KICK, DECAY_SNARE, withGridFloor } from '../util/accent';
import { easeInOutSine } from '../util/easing';
import type { LiveFrame, LiveScene, SceneContext, SceneTag, Viewport } from './types';

interface Variant {
  /** Hauteur de l'horizon, en fraction du cadre. Toujours dans [0.55, 0.70]. */
  readonly horizon: number;
  /** Decalage du point de fuite, en fraction de la largeur. */
  readonly vanishX: number;
  /** Nombre de fuyantes de chaque cote. */
  readonly rays: number;
  /** `true` = gros plan (le sol deborde), `false` = plan large. */
  readonly closeUp: boolean;
}

/**
 * Trois variantes : deux decentrees, une centree en plan large. §3.6 impose
 * qu'au plus une scene sur trois soit centree, et que chaque scene expose une
 * variante dont le point d'interet est hors centre, sur un point fort du tiers.
 */
const VARIANTS: readonly Variant[] = [
  { horizon: 0.62, vanishX: -0.17, rays: 9, closeUp: false },
  { horizon: 0.57, vanishX: 0.19, rays: 13, closeUp: true },
  { horizon: 0.68, vanishX: 0, rays: 11, closeUp: false },
];

/** Rangees de sol. Au-dela de 40 les lignes proches se confondent, en dessous de 20 la grille se lit comme un escalier. */
const ROWS = 32;

export class GridHorizonScene implements LiveScene {
  readonly id = 'grid-horizon';
  readonly tags: readonly SceneTag[] = ['neon', 'geometric', 'calm'];
  readonly intensityRange: readonly [number, number] = [0.15, 0.7];
  readonly primaryAccent = 'defilement du sol';

  private variant: Variant = VARIANTS[0]!;
  private reducedDivider = 2;
  /** Position de defilement, en CELLULES. Avance d'exactement 1 par temps. */
  private scroll = 0;
  private lastBeatIndex = 0;
  private lastBeatPhase = 0;

  init(sc: SceneContext): void {
    this.reducedDivider = sc.config.safety.reducedAmplitudeDivider;
  }

  enter(frame: LiveFrame, variantIndex: number): void {
    this.variant = VARIANTS[variantIndex % VARIANTS.length]!;
    this.scroll = 0;
    this.lastBeatIndex = frame.beat.beatIndex;
    this.lastBeatPhase = frame.beat.beatPhase;
  }

  resize(_view: Viewport): void {
    // Rien de mis en cache a la taille : tout est recalcule en fractions du
    // cadre a chaque trame, ce qui rend la scene lisible en 21:9 comme en 9:16.
  }

  // hot-path (§8.9) : corps de trame.
  render(ctx: CanvasRenderingContext2D, frame: LiveFrame): void {
    const view = frame.view;
    const amp = frame.reducedMotion ? 1 / Math.max(1, this.reducedDivider) : 1;
    const palette = frame.palette;
    const v = this.variant;

    // --- defilement : UNE cellule par temps ---------------------------------
    // Calcule sur la position musicale continue, pas en integrant `dt` : une
    // integration accumulerait la derive du framerate, et le sol finirait
    // desynchronise du son au bout de quelques minutes.
    const beatPos = frame.beat.beatIndex + frame.beat.visualBeatPhase;
    const delta = beatPos - (this.lastBeatIndex + this.lastBeatPhase);
    // Bornage : au retour d'onglet `beatPos` peut sauter de plusieurs temps.
    this.scroll += Math.max(0, Math.min(2, delta));
    this.lastBeatIndex = frame.beat.beatIndex;
    this.lastBeatPhase = frame.beat.visualBeatPhase;

    // La ligne d'horizon est un element MASSIF : elle a droit au depassement
    // de 8 % de §2.7.8. Plancher de grille (§2.7.8, derniere phrase) : sur un
    // motif a kick sur 1 et 3, sans lui le sol se souleverait une fois sur deux.
    const kick = withGridFloor(frame.onsets.envelope('kick', DECAY_KICK, 0.08), frame.gridAccent(DECAY_KICK), 1);
    const snare = frame.onsets.envelope('snare', DECAY_SNARE);
    const hat = frame.onsets.envelope('hat', DECAY_HAT);

    // MICRO-VARIATION de phrase (§4.3) : « aucun plan statique plus de quelques
    // secondes ». Le defilement bat le tempo mais le CADRAGE, lui, ne bougeait
    // pas d'un pixel sur toute la duree d'une scene. L'horizon respire donc de
    // +/- 1,5 % de hauteur et le point de fuite derive de +/- 2 % de largeur sur
    // la phrase - assez pour que l'image vive, trop peu pour se remarquer.
    const breath = easeInOutSine(frame.beat.phrasePhase) * 2 - 1;
    const horizonY = (v.horizon + breath * 0.015 - 0.5) * view.h;
    const vanishX = (v.vanishX + breath * 0.02) * view.w;
    const depth = v.closeUp ? 0.55 : 1;
    const bottom = view.h / 2;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';

    // --- soleil a scanlines, revele par le SNARE ---------------------------
    // Dessine AVANT le sol : il est derriere l'horizon.
    const sunR = view.min * (v.closeUp ? 0.16 : 0.22) * (1 + snare * 0.12 * amp);
    const sunY = horizonY - sunR * 0.35;
    ctx.globalAlpha = 0.5 + snare * 0.35 * amp;
    ctx.fillStyle = palette.hexModulated('accent', snare * 2 - 1);
    // Les bandes du soleil sont des rangees pleines, pas un disque puis des
    // traits : une passe de moins, et aucun trait d'epaisseur 1 qui scintille.
    const bands = 11;
    for (let b = 0; b < bands; b++) {
      const t0 = b / bands;
      const t1 = (b + 0.62) / bands;
      const y0 = sunY - sunR + 2 * sunR * t0;
      const y1 = sunY - sunR + 2 * sunR * t1;
      const half0 = Math.sqrt(Math.max(0, sunR * sunR - (y0 - sunY) * (y0 - sunY)));
      const half1 = Math.sqrt(Math.max(0, sunR * sunR - (y1 - sunY) * (y1 - sunY)));
      const half = Math.max(half0, half1);
      if (half <= 0) continue;
      ctx.fillRect(vanishX - half, y0, half * 2, Math.max(1, y1 - y0));
    }

    // --- rangees du sol : l'accent principal --------------------------------
    const kickLift = kick * 0.1 * amp;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.hex('primary');
    ctx.lineWidth = Math.max(1, view.min * 0.0022);
    ctx.beginPath();
    for (let i = 0; i < ROWS; i++) {
      // Phase de rangee : la fraction de cellule dont on a defile.
      const raw = (i + (this.scroll % 1)) / ROWS;
      // z = z0 / (1 - i/H) : la projection perspective, en JS.
      const z = depth / Math.max(0.02, 1 - raw * 0.985);
      const y = horizonY + (bottom - horizonY) / z;
      if (y <= horizonY || y > bottom + view.h) continue;
      ctx.moveTo(-view.w / 2, y);
      ctx.lineTo(view.w / 2, y);
    }
    ctx.stroke();

    // --- fuyantes, scintillement du CHARLEY --------------------------------
    // Reaction plafonnee a 40 % de l'accent principal (§2.7.6).
    ctx.strokeStyle = palette.hexModulated('secondary', hat * 2 - 1);
    ctx.globalAlpha = 0.55 + hat * 0.3 * amp;
    ctx.lineWidth = Math.max(1, view.min * 0.0016);
    ctx.beginPath();
    const spread = view.w * (v.closeUp ? 2.4 : 1.5);
    for (let r = -v.rays; r <= v.rays; r++) {
      if (r === 0) continue;
      const x = vanishX + (r / v.rays) * spread;
      ctx.moveTo(vanishX, horizonY);
      ctx.lineTo(x, bottom + view.h * 0.5);
    }
    ctx.stroke();

    // --- ligne d'horizon, soulevee par le KICK ------------------------------
    const hy = horizonY - kickLift * view.min;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = palette.hex('highlight');
    ctx.lineWidth = Math.max(1, view.min * 0.003 * (1 + kick * 0.8 * amp));
    ctx.beginPath();
    ctx.moveTo(-view.w / 2, hy);
    ctx.lineTo(view.w / 2, hy);
    ctx.stroke();

    // --- brume neon : macro-bande grave, jamais un onset --------------------
    const sub = frame.features.macroNorm[0] ?? 0;
    const haze = view.min * (0.05 + sub * 0.07);
    const g = ctx.createLinearGradient(0, hy, 0, hy + haze);
    g.addColorStop(0, palette.hex('accent'));
    g.addColorStop(1, palette.hex('background'));
    ctx.globalAlpha = 0.28 + sub * 0.22;
    ctx.fillStyle = g;
    ctx.fillRect(-view.w / 2, hy, view.w, haze);

    resetCompositing(ctx);
  }

  exit(): void {
    this.scroll = 0;
  }

  reset(): void {
    this.scroll = 0;
    this.variant = VARIANTS[0]!;
    this.lastBeatIndex = 0;
    this.lastBeatPhase = 0;
  }

  dispose(): void {
    this.reset();
  }
}

/** Nombre de variantes, expose au director et au test d'invariants. */
export const GRID_HORIZON_VARIANTS = VARIANTS.length;
