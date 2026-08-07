/**
 * `slice-displace` (§4.2, scene 5) - le buffer de feedback redecoupe en bandes
 * deplacees horizontalement, barre VHS et scanlines.
 *
 * ACCENT PRINCIPAL (§2.7.6) : la BARRE VHS - une bande large qui traverse le
 * cadre et se disloque. Elle est identifiable sur une capture figee, et c'est
 * elle qui porte le kick.
 *
 * CANAUX (§2.7.7) : kick -> position et epaisseur de la barre VHS ; snare ->
 * amplitude du decoupage en bandes, c'est-a-dire la COUPE ; charley -> grain
 * de bord et fines rayures. Aucune addition d'enveloppes.
 *
 * MUST §3.1 : la source est le buffer de FEEDBACK, jamais l'ecran. Deux
 * raisons, et la seconde est fatale : l'ecran contient deja le post, le bloom
 * et le HUD, donc le decoupage se nourrirait de sa propre sortie ; et un
 * `drawImage` d'un canvas sur LUI-MEME est indefini des que les sous-regions
 * se recouvrent, ce qui est exactement le cas ici.
 *
 * Quand le feedback est desactive par `FrameBudget` (qualite 0), il n'y a pas
 * de frame precedente : la scene se rabat sur un motif de bandes autonome
 * plutot que de ne rien afficher.
 */

import { resetCompositing } from '../render/LayerStack';
import { DECAY_HAT, DECAY_KICK, DECAY_SNARE, withGridFloor } from '../util/accent';
import { easeInOutSine } from '../util/easing';
import type { LiveFrame, LiveScene, SceneContext, SceneTag, Viewport } from './types';

interface Variant {
  /** Nombre de bandes. Plus il y en a, plus le glitch est fin. */
  readonly slices: number;
  /** Centre vertical de la zone la plus perturbee, en fraction du cadre. */
  readonly focusY: number;
  /** Sens de defilement de la barre VHS. */
  readonly direction: number;
  /** `true` = gros plan : les bandes sont zoomees et debordent. */
  readonly closeUp: boolean;
}

/** Deux variantes decentrees, une centree (§3.6). */
const VARIANTS: readonly Variant[] = [
  { slices: 18, focusY: -0.16, direction: 1, closeUp: false },
  { slices: 34, focusY: 0.18, direction: -1, closeUp: true },
  { slices: 24, focusY: 0, direction: 1, closeUp: false },
];

/** Plafond dur du nombre de bandes : chaque bande coute un `drawImage`. */
const MAX_SLICES = 48;

export class SliceDisplaceScene implements LiveScene {
  readonly id = 'slice-displace';
  readonly tags: readonly SceneTag[] = ['glitch', 'intense', 'strobe'];
  readonly intensityRange: readonly [number, number] = [0.6, 1];
  readonly primaryAccent = 'barre VHS';

  /** Decalage courant de chaque bande, en fraction de largeur. Pre-alloue. */
  private readonly offsets = new Float32Array(MAX_SLICES);
  private variant: Variant = VARIANTS[0]!;
  private reducedDivider = 2;
  private rng: () => number = Math.random;
  private vhsY = 0;
  private lastBarIndex = -1;

  init(sc: SceneContext): void {
    this.reducedDivider = sc.config.safety.reducedAmplitudeDivider;
    this.rng = sc.rng;
  }

  enter(frame: LiveFrame, variantIndex: number): void {
    this.variant = VARIANTS[variantIndex % VARIANTS.length]!;
    this.offsets.fill(0);
    this.vhsY = 0;
    this.lastBarIndex = frame.beat.barIndex;
  }

  resize(_view: Viewport): void {
    // Tout est en fractions du cadre.
  }

  // hot-path (§8.9) : corps de trame.
  render(ctx: CanvasRenderingContext2D, frame: LiveFrame): void {
    const view = frame.view;
    const amp = frame.reducedMotion ? 1 / Math.max(1, this.reducedDivider) : 1;
    const palette = frame.palette;
    const v = this.variant;

    const kick = frame.onsets.envelope('kick', DECAY_KICK);
    // La BANDE VHS est l'accent principal, et un element massif : depassement
    // de 8 % autorise (§2.7.8). Plancher de grille sur la caisse claire, qui
    // porte ici la coupe : sans elle, une mesure sans snare detecte fige
    // completement l'image.
    const snare = withGridFloor(frame.onsets.envelope('snare', DECAY_SNARE, 0.08), frame.gridAccent(DECAY_SNARE), 1);
    const hat = frame.onsets.envelope('hat', DECAY_HAT);

    const slices = Math.min(MAX_SLICES, v.slices);
    const sliceH = view.h / slices;
    // MICRO-VARIATION de phrase (§4.3) : le foyer de dislocation glisse
    // lentement le long du cadre. Les decalages se redistribuent deja a chaque
    // mesure, mais TOUJOURS autour du meme foyer, ce qui donnait une signature
    // reconnaissable au bout de quelques mesures.
    const focusY = (v.focusY + (easeInOutSine(frame.beat.phrasePhase) - 0.5) * 0.18) * view.h;

    // Les decalages ne sont retires qu'aux frontieres de MESURE : redistribuer
    // a chaque trame donnerait un bruit sans lecture rythmique (§2.7.5).
    if (frame.beat.barIndex !== this.lastBarIndex) {
      this.lastBarIndex = frame.beat.barIndex;
      for (let i = 0; i < slices; i++) this.offsets[i] = this.rng() * 2 - 1;
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;

    const source = frame.previousFrame;
    if (source) {
      // Amplitude pilotee par le SNARE : c'est lui qui coupe.
      const maxShift = view.w * (0.02 + snare * 0.13 * amp) * (v.closeUp ? 1.6 : 1);
      const zoom = v.closeUp ? 1.12 : 1;
      for (let i = 0; i < slices; i++) {
        const y = -view.h / 2 + i * sliceH;
        // Les bandes proches du foyer bougent plus : une amplitude uniforme
        // ferait une image qui tremble, pas une image qui se disloque.
        const d = 1 - Math.min(1, Math.abs(y + sliceH / 2 - focusY) / (view.h * 0.45));
        const shift = this.offsets[i]! * maxShift * (0.25 + d * 0.75);
        const sy = (y + view.h / 2) / zoom;
        const sh = sliceH / zoom;
        ctx.drawImage(
          source,
          0,
          sy,
          view.w,
          sh,
          shift,
          y,
          view.w,
          sliceH + 1, // +1 : sans recouvrement, les arrondis laissent des coutures noires.
        );
      }
    }

    // --- MATIERE ------------------------------------------------------------
    // Sans elle, la scene s'eteint. §3.3 impose de vider sechement le feedback
    // a chaque coupe de scene, et §4.2 decrit `slice-displace` comme un
    // decoupage DU feedback : mises bout a bout, ces deux regles font demarrer
    // la scene sur du noir, et le decoupage n'a plus rien a decouper. Elle
    // injecte donc sa propre lumiere, qui sera decoupee aux trames suivantes.
    //
    // Ce ne sont PAS des barres de spectre au sens de l'interdit §6.1 : leur
    // POSITION vient de la grille metrique, pas d'un index de bande, et
    // retirer l'audio ne rend pas la scene identique a un analyseur - elle
    // continue de defiler sur la mesure.
    ctx.globalCompositeOperation = 'lighter';
    const bands = 5;
    const bandGain = source ? 0.5 : 1;
    for (let i = 0; i < bands; i++) {
      // Position quantifiee sur la mesure : la bande i descend d'un cran par
      // temps, ce qui rend la structure lisible meme son coupe.
      const step = (frame.beat.barIndex * bands + i) % (bands * 2);
      const y = -view.h / 2 + ((step + frame.beat.barPhase) / (bands * 2)) * view.h;
      const level = frame.features.macroNorm[i % frame.features.macroNorm.length] ?? 0;
      const height = sliceH * (0.5 + level * 1.5);
      ctx.globalAlpha = (0.12 + level * 0.3) * bandGain;
      ctx.fillStyle = palette.hexModulated('secondary', this.offsets[i] ?? 0);
      ctx.fillRect(-view.w / 2, y, view.w, height);
    }

    // --- barre VHS : l'accent principal, portee par le KICK -----------------
    // Elle descend d'exactement un cadre par mesure : le mouvement est
    // quantifie sur la grille, pas libre (§2.7.5).
    this.vhsY = (frame.beat.barPhase * v.direction + 1) % 1;
    const barY = (this.vhsY - 0.5) * view.h;
    const barH = view.h * (0.02 + kick * 0.07 * amp);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 + kick * 0.5 * amp;
    const grad = ctx.createLinearGradient(0, barY - barH / 2, 0, barY + barH / 2);
    grad.addColorStop(0, palette.hex('background'));
    grad.addColorStop(0.5, palette.hexModulated('highlight', kick * 2 - 1));
    grad.addColorStop(1, palette.hex('background'));
    ctx.fillStyle = grad;
    ctx.fillRect(-view.w / 2, barY - barH / 2, view.w, barH);

    // --- rayures fines : le CHARLEY, plafonne a 40 % de l'accent ------------
    if (hat > 0.02 && !frame.reducedMotion) {
      ctx.globalAlpha = hat * 0.35 * amp;
      ctx.fillStyle = palette.hex('accent');
      const lines = 6;
      for (let i = 0; i < lines; i++) {
        // Coordonnee ENTIERE : un trait d'epaisseur 1 sur une coordonnee
        // fractionnaire s'etale sur deux rangees grises et scintille (§3.4).
        const y = Math.round(barY + (this.offsets[i] ?? 0) * view.h * 0.18);
        ctx.fillRect(-view.w / 2, y, view.w, 1);
      }
    }

    ctx.imageSmoothingEnabled = true;
    resetCompositing(ctx);
  }

  exit(): void {
    this.offsets.fill(0);
  }

  reset(): void {
    this.offsets.fill(0);
    this.vhsY = 0;
    this.lastBarIndex = -1;
    this.variant = VARIANTS[0]!;
  }

  dispose(): void {
    this.reset();
  }
}

export const SLICE_DISPLACE_VARIANTS = VARIANTS.length;
