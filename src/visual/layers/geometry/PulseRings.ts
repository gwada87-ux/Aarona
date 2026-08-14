import type { Renderer } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Color } from '../../../render/Renderer';
import type { Palette } from '../../palette/Palette';

const BASE_RADIUS = 0.28;

/**
 * LE KICK FAIT GROSSIR L'ANNEAU PRINCIPAL (drapeau `KICK_RING_V1`, 15/08/2026).
 *
 * DEMANDE D'AARON, MOT POUR MOT
 * -----------------------------
 * « Le kick ne fait pas autant de visuel dans mon beat Beat Studio importé, le
 * kick devrait faire grossir le cercle principal. »
 *
 * CE QUE LA MESURE DONNE RAISON
 * -----------------------------
 * `IMPACT_RADIUS_GAIN` valait 0,10 — la valeur de docs/07 (« rayon = 0,28 +
 * 0,10·impact »). Au maximum theorique cela fait 0,28 -> 0,38, soit +36 % de
 * rayon. Mais son relevé donne `KICK 20 (force 0,35)`, remonte a 0,48 par la
 * normalisation : l'anneau ne grossit en pratique que de **+17 %**, sur un
 * trait de 6 millièmes d'epaisseur. C'est invisible, et c'est exactement ce
 * qu'il decrit.
 *
 * DEUX GESTES PLUTOT QU'UN
 * ------------------------
 * Le rayon seul ne suffit pas : un cercle fin qui s'agrandit de 17 % se remarque
 * mal, parce que l'oeil suit les CONTRASTES avant les positions. L'epaisseur
 * reagit donc aussi a la frappe — elle etait jusqu'ici pilotee par le seul
 * `weight`, un signal continu qui ne marque aucun temps.
 *
 * POURQUOI ON S'ECARTE DE docs/07
 * -------------------------------
 * Le 0,10 du document n'a jamais ete confronte a un morceau reel : il suppose
 * un `impact` qui atteint 1, ce qu'aucun morceau maitrise ne produit. Le
 * drapeau permet de revenir au chiffre du document en une ligne.
 */
export const KICK_RING_V1 = true;

/** Rayon : 0,28 -> 0,48 a pleine frappe. Les anneaux secondaires vont deja jusqu'a 0,60, le cadre le supporte. */
const IMPACT_RADIUS_GAIN = KICK_RING_V1 ? 0.2 : 0.1;

/** Epaisseur ajoutee par la frappe. Comparable au gain de `weight` (0,014) : la frappe pese autant que la masse. */
const IMPACT_LINE_WIDTH_GAIN = KICK_RING_V1 ? 0.012 : 0;
const MIN_LINE_WIDTH = 0.006;
const WEIGHT_LINE_WIDTH_GAIN = 0.014; // épaisseur = f(weight) — linéaire, non spécifié plus précisément

const SECONDARY_RING_POOL_SIZE = 8;
const DEFAULT_SECONDARY_RING_LIFETIME = 1.2; // docs/07 : expansion + fondu (1,2 s)
const SECONDARY_RING_EXPANSION = 0.32; // rayon final ≈ BASE_RADIUS + ceci, non spécifié précisément
const DEFAULT_MAX_ACTIVE_RINGS = SECONDARY_RING_POOL_SIZE;
const DEFAULT_CHAOS_JITTER = 0;

/**
 * Geometry du style Pulse (docs/07) : anneau central réactif à `impact`/`weight`,
 * plus des anneaux secondaires émis sur DOWNBEAT (expansion + fondu, 1,2 s).
 *
 * Pool à taille fixe, zéro allocation en boucle de rendu (docs/10) : `ages[i] < 0`
 * signifie « emplacement libre », pas de tableau annexe de booléens.
 */
export class PulseRings implements Layer {
  readonly id = 'pulseRings';
  readonly kind: LayerKind = 'geometry';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private impact = 0;
  private weight = 0;
  private readonly ringAges = new Float32Array(SECONDARY_RING_POOL_SIZE).fill(-1);
  /** Décalage de rayon tiré une fois à l'apparition de chaque anneau (macro chaos, Étape 20) — pas redessiné au hasard chaque image. */
  private readonly ringJitter = new Float32Array(SECONDARY_RING_POOL_SIZE);

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
  }

  private param(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  private activeRingCount(): number {
    let count = 0;
    for (let i = 0; i < SECONDARY_RING_POOL_SIZE; i++) if (this.ringAges[i]! >= 0) count++;
    return count;
  }

  update(step: StepContext, signals: VisualSignals): void {
    this.impact = signals.impact;
    this.weight = signals.weight;

    const lifetime = this.param('lifetimeSec', DEFAULT_SECONDARY_RING_LIFETIME);
    for (let i = 0; i < SECONDARY_RING_POOL_SIZE; i++) {
      if (this.ringAges[i]! >= 0) this.ringAges[i]! += step.dt;
      if (this.ringAges[i]! >= lifetime) this.ringAges[i] = -1;
    }

    if (step.fired.some((e) => e.type === 'DOWNBEAT')) {
      const maxActive = Math.max(0, Math.round(this.param('maxActiveRings', DEFAULT_MAX_ACTIVE_RINGS)));
      if (this.activeRingCount() < maxActive) {
        const free = this.ringAges.indexOf(-1);
        if (free !== -1) {
          this.ringAges[free] = 0;
          const chaosJitter = this.param('chaosJitter', DEFAULT_CHAOS_JITTER);
          this.ringJitter[free] = (step.rng.next() * 2 - 1) * chaosJitter;
        }
      }
    }
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    const lifetime = this.param('lifetimeSec', DEFAULT_SECONDARY_RING_LIFETIME);
    const radius = BASE_RADIUS + IMPACT_RADIUS_GAIN * this.impact;
    // L'epaisseur suit la FRAPPE en plus de la masse : un cercle fin qui
    // s'agrandit se remarque mal, l'oeil suit les contrastes avant les
    // positions (voir `KICK_RING_V1`).
    const lineWidth = MIN_LINE_WIDTH + WEIGHT_LINE_WIDTH_GAIN * this.weight + IMPACT_LINE_WIDTH_GAIN * this.impact;
    renderer.strokeCircle(0, 0, radius, lineWidth, this.palette.primary);

    for (let i = 0; i < SECONDARY_RING_POOL_SIZE; i++) {
      const age = this.ringAges[i]!;
      if (age < 0) continue;
      const progress = age / lifetime;
      const ringRadius = Math.max(0, BASE_RADIUS + progress * SECONDARY_RING_EXPANSION + this.ringJitter[i]!);
      const alpha = 1 - progress;
      const color: Color = { ...this.palette.secondary, a: this.palette.secondary.a * alpha };
      renderer.strokeCircle(0, 0, ringRadius, MIN_LINE_WIDTH, color);
    }
  }

  reset(_t: number): void {
    // Les anneaux secondaires actifs au moment d'un seek ne sont pas
    // reconstitués : ils redémarreront naturellement au prochain DOWNBEAT
    // rencontré pendant le rattrapage. Un anneau manqué est invisible
    // (docs/06, même principe que la fenêtre MAX_WINDOW du dispatcher).
    this.ringAges.fill(-1);
    this.ringJitter.fill(0);
  }

  dispose(): void {}
}
