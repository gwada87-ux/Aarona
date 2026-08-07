/**
 * `aurore` — ambient, cinematic, chill (docs/17_PHASE2_VISUELS.md §8, chantier 6).
 *
 * LE PRINCIPE : LA LENTEUR ASSUMÉE
 * --------------------------------
 * Pas de rythme à marquer, une atmosphère à tenir. C'est aussi le style qui
 * PROUVE la Loi 3 : « un morceau non analysable doit rester beau ». Aucun onset
 * ne déclenche quoi que ce soit ici — pas par oubli, par conception. Le seul
 * événement toléré est le changement de section, qui fait lentement dériver les
 * teintes.
 *
 * Conséquence directe : ce style est le seul du catalogue qui rend exactement
 * la même chose en régime événementiel et en régime continu. Sur un morceau que
 * l'analyse comprend mal, c'est vers lui qu'il faut se tourner.
 *
 * LE DÉGRADÉ S'EMPILE, IL NE SE DESSINE PAS
 * -----------------------------------------
 * `fillPath` ne prend qu'une couleur PLATE. Un ruban dégradé est donc fabriqué
 * en empilant cinq bandes translucides de largeur décroissante autour de la
 * même médiane. C'est moins cher qu'un vrai dégradé — qui n'existe pas dans
 * l'interface — et le rendu est meilleur en additif : les recouvrements créent
 * une montée de densité vers le centre du ruban, ce qu'un dégradé linéaire ne
 * ferait pas.
 *
 * LES SIX BANDES, PAS UN SPECTRE
 * ------------------------------
 * Loi 2 : `visual/` ne voit jamais un spectre plein. L'épaisseur locale des
 * rubans est pilotée par les six `step.bands` — graves en bas, aigus en haut —
 * interpolées le long du ruban pour une variation lisse plutôt qu'en paliers.
 */

import type { Color, Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import { NO_SAFE_AREA, safeRect } from '../../../render/safeArea';
import type { StepContext } from '../../../music/StepContext';
import { BAND_IDS } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import { SimplexNoise } from '../../../core/math/noise';
import { lerp } from '../../../core/math/lerp';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import { lerpColor, type Palette } from '../../palette/Palette';

/** Rubans superposés. */
const RIBBONS = 5;
/** Points par ruban. 40 donne une courbe lisse sans coûter. */
const POINTS = 40;
/** Bandes translucides empilées par ruban — c'est elles qui simulent le dégradé. */
const STACK = 5;
/** Demi-épaisseur maximale d'un ruban, en unités normalisées. */
const THICKNESS = 0.085;
/** Vitesse d'évolution du bruit, en unités de bruit par seconde. Très lente : c'est le sujet. */
const FLOW_SPEED = 0.035;
/** Échelle spatiale du bruit le long du ruban. */
const NOISE_SCALE = 1.6;
/** Amplitude d'ondulation verticale de la médiane. */
const WAVE = 0.16;

export class AuroraRibbons implements Layer {
  readonly id = 'auroraRibbons';
  readonly kind: LayerKind = 'field';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private readonly noise = new SimplexNoise(0x41555230);

  // Deux tampons par bande empilée : aller par le haut, retour par le bas.
  private readonly polyX = new Float32Array(POINTS * 2);
  private readonly polyY = new Float32Array(POINTS * 2);
  /** Médiane et demi-épaisseur, calculées dans `update`, lues dans `draw`. */
  private readonly midY = new Float32Array(RIBBONS * POINTS);
  private readonly halfT = new Float32Array(RIBBONS * POINTS);

  private sectionShift = 0;
  private drive = 0;
  private brightness = 0;
  private slowDrift = 0.5;

  private param(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  update(step: StepContext, signals: VisualSignals): void {
    this.sectionShift = signals.sectionShift;
    this.drive = signals.drive;
    // Deux CONTINUS de plus, aucun onset : le style reste piloté par des
    // niveaux, ce qui est sa définition. `brightness` (centroïde) fait glisser
    // la teinte vers l'accent quand le morceau s'éclaircit ; `lfoB` déplace très
    // lentement les rubans les uns par rapport aux autres, pour qu'ils ne
    // gardent pas éternellement le même ordre d'empilement.
    this.brightness = signals.brightness;
    this.slowDrift = signals.lfoB;

    const wave = this.param('wave', WAVE);
    const flow = this.param('flowSpeed', FLOW_SPEED);
    const bandCount = BAND_IDS.length;
    // Le temps AVANCE le bruit — Loi 1 : fonction pure de `t`, jamais d'un
    // compteur d'images ni d'un `dt` accumulé.
    const phase = step.t * flow;

    for (let r = 0; r < RIBBONS; r++) {
      // Chaque ruban est décalé dans le champ de bruit : ils ondulent
      // ensemble sans jamais se superposer exactement.
      // Écartement des rubans piloté par un LFO très lent : ils se resserrent
      // et se rouvrent sur plusieurs mesures, sans qu'on voie jamais le
      // mouvement.
      const spread = 1.1 * (0.85 + this.slowDrift * 0.3);
      const lane = (r / (RIBBONS - 1) - 0.5) * spread;
      const seedRow = r * 7.13;
      for (let p = 0; p < POINTS; p++) {
        const u = p / (POINTS - 1);
        const n = this.noise.noise2(u * NOISE_SCALE + phase, seedRow + phase * 0.4);
        this.midY[r * POINTS + p] = lane * 0.5 + n * wave;

        // ÉPAISSEUR par les six bandes : graves en bas du cadre, aigus en
        // haut. `lane` sert d'index vertical, donc un ruban bas suit le grave.
        const bandPos = ((lane + 0.55) / 1.1) * (bandCount - 1);
        const i0 = Math.max(0, Math.min(bandCount - 1, Math.floor(bandPos)));
        const i1 = Math.min(bandCount - 1, i0 + 1);
        const band = lerp(step.bands[BAND_IDS[i0]!], step.bands[BAND_IDS[i1]!], bandPos - i0);
        // Renflement le long du ruban : il s'affine aux deux bouts, sinon il se
        // lit comme une barre coupée par le bord du cadre.
        const taper = Math.sin(u * Math.PI);
        this.halfT[r * POINTS + p] = THICKNESS * (0.35 + band * 0.65) * taper;
      }
    }
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    const frame = safeRect(viewport.aspect, NO_SAFE_AREA);
    const spanX = frame.right - frame.left;
    // Le changement de SECTION fait dériver les teintes — le seul événement que
    // ce style accepte. Il ne déclenche rien, il déplace lentement une couleur.
    const tint = this.sectionShift;
    const alphaMul = this.param('alphaMul', 1);

    for (let r = 0; r < RIBBONS; r++) {
      // La teinte glisse vers l'accent avec le CENTROÏDE : un morceau qui
      // s'éclaircit fait virer les rubans, sans le moindre événement.
      const warm = (r / (RIBBONS - 1)) * 0.55 + tint * 0.25 + this.brightness * 0.2;
      const hue = lerpColor(this.palette.primary, this.palette.accent, Math.min(1, warm));
      for (let s = 0; s < STACK; s++) {
        // Bandes de largeur DÉCROISSANTE, empilées : le recouvrement fait
        // monter la densité vers le centre. C'est le dégradé que `fillPath` ne
        // sait pas produire.
        const widthMul = 1 - s / STACK;
        for (let p = 0; p < POINTS; p++) {
          const u = p / (POINTS - 1);
          const x = frame.left + u * spanX;
          const mid = this.midY[r * POINTS + p]!;
          const half = this.halfT[r * POINTS + p]! * widthMul;
          this.polyX[p] = x;
          this.polyY[p] = mid + half;
          const j = POINTS * 2 - 1 - p;
          this.polyX[j] = x;
          this.polyY[j] = mid - half;
        }
        // Alpha faible et cumulatif : cinq bandes à 0,08 donnent un centre à
        // 0,4 sans qu'aucune ne se voie individuellement.
        const a = 0.08 * (0.6 + this.drive * 0.4) * alphaMul;
        const color: Color = { r: hue.r, g: hue.g, b: hue.b, a };
        renderer.fillPath(this.polyX, this.polyY, POINTS * 2, color);
      }
    }
  }

  reset(_t: number): void {
    // Rien à restaurer : tout est recalculé depuis `step.t` au prochain update.
  }

  dispose(): void {}
}
