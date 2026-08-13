/**
 * `mandala-32` (§4.2, scene 4) - les 32 bandes en mandala, nombre de segments
 * changeant sur frontiere de mesure (6 -> 8 -> 12 -> 16).
 *
 * C'est la SEULE scene de la selection dont la variante par defaut est centree
 * (§4.2) - toutes les autres decentrent. Elle expose quand meme une variante
 * hors centre, comme §3.6 l'exige de chaque scene.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE N'EST PAS UN SPECTROGRAMME (interdit §6.1)
 * ---------------------------------------------------------------------------
 * Le test de §6.1 est explicite : « si retirer l'audio rend la scene identique
 * a un analyseur de spectre, elle est interdite ». Retirer l'audio ici laisse
 * une structure segmentee qui tourne sur la phrase, dont le nombre de secteurs
 * change sur la mesure, et dont un secteur sur deux est occulte au rythme du
 * snare. Les 32 bandes ne sont pas LUES, elles sont REPLIEES : chaque secteur
 * n'en montre qu'un sous-ensemble, mis en miroir - ce que §6.1 nomme
 * explicitement comme un usage legitime des barres, « un materiau ».
 *
 * POURQUOI CE N'EST PAS L'ANNEAU CENTRE INTERDIT (§6.2)
 * Cinq parametres, cinq sources differentes : nombre de secteurs (mesure),
 * rotation (phrase), longueur des bandes (spectre), onde de choc (kick),
 * occlusion (snare). §6.2 en demande deux.
 *
 * ACCENT PRINCIPAL (§2.7.6) : l'ONDE DE CHOC - un anneau discret qui part du
 * centre a chaque kick. Identifiable sur une capture figee, contrairement a un
 * rayon qui pulse.
 */

import { resetCompositing } from '../render/LayerStack';
import { DECAY_HAT, DECAY_KICK, DECAY_SNARE, beatWeight, withGridFloor } from '../util/accent';
import type { LiveFrame, LiveScene, SceneContext, SceneTag, Viewport } from './types';

interface Variant {
  readonly centerX: number;
  readonly centerY: number;
  /** Sens de rotation. */
  readonly spin: number;
  /** `true` = gros plan : le mandala deborde du cadre. */
  readonly closeUp: boolean;
}

/** La variante 0 est CENTREE - c'est la seule scene qui en a le droit (§4.2). */
const VARIANTS: readonly Variant[] = [
  { centerX: 0, centerY: 0, spin: 1, closeUp: false },
  { centerX: -0.16, centerY: 0.1, spin: -1, closeUp: true },
  { centerX: 0.17, centerY: -0.08, spin: 1, closeUp: false },
];

/** Suite de secteurs imposee par §4.2. */
const SEGMENTS = [6, 8, 12, 16] as const;
/**
 * Fenetre de RETENUE avant une frappe annoncee (SESSION F), en secondes.
 * 60 ms — environ quatre trames a 60 Hz : assez pour que le geste se voie,
 * assez peu pour qu'il appartienne encore a la frappe et ne devienne pas une
 * animation autonome. Borne par le lookahead du scheduler hote (~100 ms), au
 * -dela duquel il n'y a de toute facon rien d'annonce.
 */
const PREARM_SEC = 0.06;

/** Plafond d'ondes de choc simultanees. */
const MAX_WAVES = 6;
const WAVE_LIFE = 0.9;

export class Mandala32Scene implements LiveScene {
  readonly id = 'mandala-32';
  readonly tags: readonly SceneTag[] = ['geometric'];
  readonly intensityRange: readonly [number, number] = [0.3, 0.85];
  readonly primaryAccent = 'onde de choc du kick';

  private readonly waveAge = new Float32Array(MAX_WAVES);
  private readonly waveStrength = new Float32Array(MAX_WAVES);
  private waveCount = 0;

  private variant: Variant = VARIANTS[0]!;
  private reducedDivider = 2;
  private segmentIndex = 0;
  private lastBarIndex = Number.NEGATIVE_INFINITY;
  private lastKickTime = Number.NEGATIVE_INFINITY;
  /** Phase visuelle de la trame precedente, pour detecter le rebouclage. -1 = aucune. */
  private lastVisualPhase = -1;
  private beatsPerBar = 4;

  init(sc: SceneContext): void {
    this.reducedDivider = sc.config.safety.reducedAmplitudeDivider;
    this.beatsPerBar = sc.config.beat.beatsPerBar;
  }

  enter(frame: LiveFrame, variantIndex: number): void {
    this.variant = VARIANTS[variantIndex % VARIANTS.length]!;
    this.lastBarIndex = frame.beat.barIndex;
  }

  resize(_view: Viewport): void {
    // Tout est en fractions du petit cote.
  }

  // hot-path (§8.9) : corps de trame.
  render(ctx: CanvasRenderingContext2D, frame: LiveFrame): void {
    const view = frame.view;
    // §4.2, colonne reduced-motion : « oui (amplitudes / 2) ». C'est la seule
    // scene pour laquelle le prompt precise le traitement plutot que de
    // l'exclure.
    const amp = frame.reducedMotion ? 1 / Math.max(1, this.reducedDivider) : 1;
    const palette = frame.palette;
    const v = this.variant;
    const unit = view.min;

    // --- nombre de secteurs : frontiere de MESURE (§4.2) --------------------
    if (frame.beat.barIndex !== this.lastBarIndex) {
      this.lastBarIndex = frame.beat.barIndex;
      this.segmentIndex = (this.segmentIndex + 1) % SEGMENTS.length;
    }
    const segments = SEGMENTS[this.segmentIndex] ?? 8;

    // Le noyau du mandala est l'element MASSIF de la scene : depassement de
    // 8 % autorise (§2.7.8), plus le plancher de grille.
    const kick = withGridFloor(frame.onsets.envelope('kick', DECAY_KICK, 0.08), frame.gridAccent(DECAY_KICK), 1);
    const snare = frame.onsets.envelope('snare', DECAY_SNARE);
    const hat = frame.onsets.envelope('hat', DECAY_HAT);

    const kickTime = frame.onsets.lastTime('kick');
    const kickFired = frame.onsets.fired('kick') && kickTime !== this.lastKickTime;
    if (kickFired) {
      this.lastKickTime = kickTime;
      this.emitWave(frame.onsets.strength('kick'));
    }

    // Onde de GRILLE sur les temps sans frappe (§2.7.8). Meme raison que dans
    // `laser-tunnel` : l'onde est un objet discret, un `max` d'enveloppes ne
    // peut pas la creer. Detection sur le rebouclage de la phase VISUELLE, pas
    // sur `beatIndex`, qui avance a la frontiere brute.
    const vphase = frame.beat.visualBeatPhase;
    const wrapped = this.lastVisualPhase >= 0 && vphase < this.lastVisualPhase - 0.5;
    this.lastVisualPhase = vphase;
    if (wrapped && !kickFired) {
      const position = Math.floor(frame.beat.visualBarPhase * this.beatsPerBar);
      const weight = beatWeight(position, this.beatsPerBar) * frame.beat.confidence;
      if (weight > 0.05) this.emitWave(weight);
    }

    const cx = v.centerX * view.w;
    const cy = v.centerY * view.h;
    const scale = v.closeUp ? 1.55 : 1;
    // SESSION F — l'avance d'annonce, quand elle existe. `+Infinity` (aucun
    // canal, ou rien d'annonce) donne une charge nulle : tout ce qui suit est
    // alors inerte, et la scene rend exactement ce qu'elle rendait avant.
    const nextKick = frame.anticipation?.nextIn('kick') ?? Number.POSITIVE_INFINITY;
    const charge = nextKick < PREARM_SEC ? 1 - nextKick / PREARM_SEC : 0;

    // Le noyau se CONTRACTE pendant la retenue, puis se dilate sur la frappe :
    // deux gestes opposes, donc lisibles l'un apres l'autre.
    const inner = unit * 0.09 * scale * (1 + kick * 0.18 * amp - charge * 0.06 * amp);
    const reach = unit * 0.34 * scale;

    // Rotation sur la PHRASE : deuxieme parametre, deuxieme source.
    const spin = frame.beat.phrasePhase * Math.PI * 2 * v.spin;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    const bands = frame.features.bandsNorm;
    const perSector = Math.max(1, Math.ceil(bands.length / segments));

    for (let s = 0; s < segments; s++) {
      const base = spin + (s / segments) * Math.PI * 2;
      // OCCLUSION pilotee par le SNARE : un secteur sur deux s'efface et
      // reapparait. C'est la « revelation » que §2.7.7 attribue au snare, et le
      // cinquieme parametre independant qui sort la scene de l'interdit §6.2.
      const occluded = s % 2 === 1 ? 1 - snare * 0.85 * amp : 1;
      if (occluded < 0.05) continue;

      const mirrored = s % 2 === 1;
      ctx.globalAlpha = occluded * (0.4 + frame.intensity * 0.4);
      ctx.strokeStyle = palette.hexModulated('primary', (s / Math.max(1, segments - 1)) * 2 - 1);
      ctx.lineWidth = Math.max(1, (unit / segments) * 0.09);
      ctx.beginPath();
      for (let k = 0; k < perSector; k++) {
        // REPLIEMENT : chaque secteur ne montre qu'un sous-ensemble de bandes,
        // mis en miroir un secteur sur deux. Le spectre est un materiau, pas
        // une lecture.
        const bandIndex = mirrored ? perSector - 1 - k : k;
        const level = bands[(s * perSector + bandIndex) % bands.length] ?? 0;
        const a = base + ((k + 0.5) / perSector) * (Math.PI * 2 / segments);
        const r0 = inner;
        const r1 = inner + reach * (0.12 + level * 0.88);
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      }
      ctx.stroke();
    }

    // --- RETENUE AVANT IMPACT (SESSION F, anticipation d'ADR-012) ----------
    // L'hote annonce ses frappes avant qu'elles ne sonnent : l'onde de choc
    // peut donc s'ARMER au lieu de seulement reagir. Un anneau fin converge
    // vers le noyau pendant les dernieres millisecondes, et l'onde part de
    // l'endroit exact ou il arrive. C'est l'inverse d'un effet reactif : on
    // voit le systeme INSPIRER.
    //
    // Sans canal de verite, `nextIn` vaut `+Infinity`, `charge` reste nul et
    // ce bloc ne dessine rien — la scene est alors strictement celle d'avant.
    if (charge > 0) {
      ctx.globalAlpha = charge * charge * 0.45 * amp;
      ctx.strokeStyle = palette.hex('highlight');
      ctx.lineWidth = Math.max(1, unit * 0.0025 * amp);
      ctx.beginPath();
      // Converge de l'exterieur vers le noyau : a l'impact, il l'atteint
      // exactement, et l'onde repart de la.
      ctx.arc(cx, cy, inner + reach * 0.5 * (1 - charge), 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- ondes de choc : l'accent principal --------------------------------
    let write = 0;
    ctx.lineCap = 'butt';
    for (let i = 0; i < this.waveCount; i++) {
      const age = this.waveAge[i]! + frame.dt;
      if (age >= WAVE_LIFE) continue;
      this.waveAge[write] = age;
      this.waveStrength[write] = this.waveStrength[i]!;
      write++;
      const t = age / WAVE_LIFE;
      const s = this.waveStrength[write - 1]!;
      ctx.globalAlpha = (1 - t) * (0.3 + s * 0.6);
      ctx.strokeStyle = palette.hexModulated('highlight', s * 2 - 1);
      ctx.lineWidth = Math.max(1, unit * 0.006 * (1 - t) * (0.4 + s * 0.9) * amp);
      ctx.beginPath();
      ctx.arc(cx, cy, inner + reach * 1.35 * t, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.waveCount = write;

    // --- detail fin : le CHARLEY, plafonne a 40 % de l'accent --------------
    if (hat > 0.02) {
      ctx.globalAlpha = hat * 0.4 * amp;
      ctx.fillStyle = palette.hex('accent');
      const size = Math.max(1, unit * 0.003);
      ctx.beginPath();
      for (let s = 0; s < segments; s++) {
        const a = spin + ((s + 0.5) / segments) * Math.PI * 2;
        const r = inner + reach * 1.12;
        ctx.rect(cx + Math.cos(a) * r - size / 2, cy + Math.sin(a) * r - size / 2, size, size);
      }
      ctx.fill();
    }

    resetCompositing(ctx);
  }

  /** Nombre de secteurs courant - lu par les tests et le HUD. */
  get segments(): number {
    return SEGMENTS[this.segmentIndex] ?? 8;
  }

  private emitWave(strength: number): void {
    if (this.waveCount >= MAX_WAVES) {
      for (let i = 1; i < this.waveCount; i++) {
        this.waveAge[i - 1] = this.waveAge[i]!;
        this.waveStrength[i - 1] = this.waveStrength[i]!;
      }
      this.waveCount--;
    }
    this.waveAge[this.waveCount] = 0;
    this.waveStrength[this.waveCount] = strength;
    this.waveCount++;
  }

  exit(): void {
    this.waveCount = 0;
  }

  reset(): void {
    this.waveCount = 0;
    this.segmentIndex = 0;
    this.variant = VARIANTS[0]!;
    this.lastBarIndex = Number.NEGATIVE_INFINITY;
    this.lastKickTime = Number.NEGATIVE_INFINITY;
    this.lastVisualPhase = -1;
  }

  dispose(): void {
    this.reset();
  }
}

export const MANDALA32_VARIANTS = VARIANTS.length;
export const MANDALA32_SEGMENTS = SEGMENTS;
