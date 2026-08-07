/**
 * Scene TEMOIN de l'etape 2 (§9.2 : « pipeline de rendu valide sur une scene
 * temoin »). Ce n'est PAS une des douze scenes de §4.2 : son role est
 * d'exercer chaque etage du pipeline - feedback, bright pass, bloom,
 * aberration, grain, overlay, camera, palette - avec un contenu assez simple
 * pour qu'un defaut de pipeline soit visible et attribuable.
 *
 * Elle respecte quand meme les deux interdits de §6 :
 *
 * - Ce n'est pas un spectrogramme en barres : retirer l'audio ne la rend pas
 *   identique a un analyseur de spectre, elle continue de tourner sur le temps
 *   musical.
 * - Ce n'est pas « l'anneau centre dont le seul parametre anime est le
 *   volume » : l'arc est DECENTRE, et quatre parametres independants viennent
 *   de quatre sources differentes - rayon du kick, epaisseur de `barPhase`,
 *   rotation de `phrasePhase`, scintillement des graduations du charley.
 *
 * §2.7.6 : l'accent principal est l'ARC. Tout le reste plafonne a 40 % de son
 * amplitude.
 * §2.7.7 : un instrument = un canal visuel. Kick -> geometrie et echelle,
 * snare -> cadrage et revelation, charley -> detail fin. Aucune addition de
 * deux enveloppes d'onset sur un meme parametre.
 */

import { resetCompositing } from '../render/LayerStack';
import { DECAY_HAT, DECAY_KICK, DECAY_SNARE } from '../util/accent';
import type { LiveFrame, LiveScene, SceneContext, SceneTag, Viewport } from './types';

/** Fractions du cadre - jamais de pixels absolus (§3.6). */
const HORIZON_Y = [0.58, 0.66, 0.62] as const;
const ARC_CENTER_X = [-0.19, 0.21, -0.24] as const;
const TICK_COUNT = 48;

export class WitnessScene implements LiveScene {
  readonly id = 'witness-pulse';
  readonly tags: readonly SceneTag[] = ['geometric', 'neon', 'calm'];
  readonly intensityRange: readonly [number, number] = [0, 1];
  readonly primaryAccent = 'arc';

  private view: Viewport = { w: 1, h: 1, dpr: 1, min: 1 };
  private variant = 0;
  /** Diviseur d'amplitude de `prefers-reduced-motion`, lu une fois a l'init. */
  private reducedDivider = 2;
  private horizonGradient: CanvasGradient | null = null;
  private gradientKey = '';
  private readonly stops: string[] = [];

  init(sc: SceneContext): void {
    this.view = sc.view;
    this.reducedDivider = sc.config.safety.reducedAmplitudeDivider;
  }

  enter(frame: LiveFrame, variantIndex: number): void {
    this.variant = variantIndex % HORIZON_Y.length;
    this.view = frame.view;
    this.horizonGradient = null;
  }

  resize(view: Viewport): void {
    this.view = view;
    // Le degrade est cache et reconstruit au RESIZE uniquement : le recreer
    // par trame est l'un des pieges nommes de §3.7.
    this.horizonGradient = null;
  }

  // hot-path (§8.9) : corps de trame.
  render(ctx: CanvasRenderingContext2D, frame: LiveFrame): void {
    const view = frame.view;
    this.view = view;
    const unit = view.min;
    const palette = frame.palette;
    const amp = frame.reducedMotion ? 1 / Math.max(1, this.reducedDivider) : 1;

    // --- accent principal : l'arc, pilote par le KICK -----------------------
    const kick = frame.onsets.envelope('kick', DECAY_KICK);
    const snare = frame.onsets.envelope('snare', DECAY_SNARE);
    const hat = frame.onsets.envelope('hat', DECAY_HAT);

    const cx = ARC_CENTER_X[this.variant]! * view.w;
    const cy = (HORIZON_Y[this.variant]! - 0.5) * view.h;

    // ANTICIPATION (§2.7.3) : dans les derniers instants avant le temps, l'arc
    // recule legerement. Sans contre-mouvement, l'impact parait plat.
    const toBeat = 1 - frame.beat.beatPhase;
    const lead = Math.max(0.09, (frame.beat.periodSec || 0.5) / 5) / Math.max(frame.beat.periodSec || 0.5, 1e-3);
    const anticipation = toBeat < lead ? (1 - toBeat / lead) * 0.06 : 0;

    const radius = unit * (0.17 + kick * 0.14 * amp - anticipation * amp);
    // Epaisseur : `barPhase`, pas un onset. Deuxieme parametre, deuxieme source.
    const thickness = unit * (0.006 + 0.010 * (1 - frame.beat.barPhase) * amp);
    // Rotation : `phrasePhase`. Troisieme source.
    const spin = frame.beat.phrasePhase * Math.PI * 2;

    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';

    ctx.strokeStyle = palette.hexModulated('primary', kick * 2 - 1);
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, spin, spin + Math.PI * 1.45);
    ctx.stroke();

    ctx.strokeStyle = palette.hex('secondary');
    ctx.lineWidth = thickness * 0.45;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.28, spin + Math.PI, spin + Math.PI * 1.7);
    ctx.stroke();

    // --- detail fin : le CHARLEY, jamais l'echelle globale (§2.7.7) ---------
    // Reaction plafonnee a 40 % de l'accent principal.
    const tickLen = unit * 0.02 * (0.35 + hat * 0.4 * amp);
    ctx.strokeStyle = palette.hexModulated('accent', hat * 2 - 1);
    ctx.lineWidth = Math.max(1, unit * 0.0015);
    ctx.beginPath();
    for (let i = 0; i < TICK_COUNT; i++) {
      const band = frame.features.bandsNorm[i % frame.features.bandsNorm.length] ?? 0;
      const a = spin * 0.5 + (i / TICK_COUNT) * Math.PI * 2;
      const r0 = radius * 1.42;
      const r1 = r0 + tickLen * (0.4 + band * 0.6);
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    }
    ctx.stroke();

    // --- horizon : macro-bande grave, revelee par le SNARE ------------------
    const sub = frame.features.macroNorm[0] ?? 0;
    const bass = frame.features.macroNorm[1] ?? 0;
    const bandHeight = unit * (0.012 + (sub * 0.5 + bass * 0.5) * 0.06 * amp);
    const y = (HORIZON_Y[this.variant]! - 0.5) * view.h;
    const reveal = 0.35 + snare * 0.4 * amp;
    ctx.globalAlpha = reveal;
    ctx.fillStyle = this.gradient(ctx, palette, y, bandHeight);
    ctx.fillRect(-view.w / 2, y - bandHeight / 2, view.w, bandHeight);
    ctx.globalAlpha = 1;

    // Ligne d'horizon nette, au demi-pixel pour ne pas scintiller (§3.4).
    ctx.strokeStyle = palette.hex('highlight');
    ctx.globalAlpha = 0.25 + snare * 0.35 * amp;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-view.w / 2, Math.round(y) + 0.5);
    ctx.lineTo(view.w / 2, Math.round(y) + 0.5);
    ctx.stroke();

    resetCompositing(ctx);
  }

  /** Degrade construit une fois par taille, pas par trame (§3.7). */
  private gradient(
    ctx: CanvasRenderingContext2D,
    palette: LiveFrame['palette'],
    y: number,
    height: number,
  ): CanvasGradient | string {
    const key = `${Math.round(y)}:${Math.round(height)}:${palette.current.id}`;
    if (this.horizonGradient && this.gradientKey === key) return this.horizonGradient;
    const g = ctx.createLinearGradient(0, y - height / 2, 0, y + height / 2);
    palette.gradientStops('secondary', 'accent', this.stops);
    for (let i = 0; i < this.stops.length; i++) {
      g.addColorStop(i / (this.stops.length - 1), this.stops[i] ?? '#000000');
    }
    this.horizonGradient = g;
    this.gradientKey = key;
    return g;
  }

  exit(): void {
    this.horizonGradient = null;
  }

  reset(): void {
    this.variant = 0;
    this.horizonGradient = null;
    this.gradientKey = '';
  }

  dispose(): void {
    this.horizonGradient = null;
    this.stops.length = 0;
  }
}
