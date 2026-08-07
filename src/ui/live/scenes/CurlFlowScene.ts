/**
 * `curl-flow` (§4.2, scene 3) - particules dans un champ de bruit curl.
 *
 * ACCENT PRINCIPAL (§2.7.6) : le NOYAU EMETTEUR. Son rayon et son emission
 * sautent sur le kick, et il reste identifiable sur une capture figee.
 *
 * CANAUX (§2.7.7) : kick -> noyau et bouffee d'emission ; snare -> torsion
 * globale du champ, qui recadre le mouvement ; charley -> dispersion fine des
 * particules. La basse tord le champ en continu, les aigus le dispersent -
 * mais aucun de ces deux-la n'est un onset, ce sont des NIVEAUX de bande.
 *
 * TRAINEES : elles viennent du FEEDBACK du pipeline, pas d'un trace de
 * segments. C'est ce qui permet 6000 particules a 60 fps : chaque particule
 * coute un `rect()` dans un chemin partage, pas une ligne avec son etat.
 *
 * ZERO ALLOCATION (§3.7) : tous les tableaux sont pre-alloues au plafond
 * maximal, et les particules sont groupees en buckets rendus par UN SEUL
 * `fill()` chacun. On n'alloue meme pas de `Path2D` par bucket - le chemin
 * courant du contexte fait exactement le meme travail sans allouer, ce que
 * §3.7 liste justement comme piege.
 */

import { CurlField } from '../util/noise';
import { resetCompositing } from '../render/LayerStack';
import { DECAY_HAT, DECAY_KICK, DECAY_SNARE, withGridFloor } from '../util/accent';
import type { LiveFrame, LiveScene, SceneContext, SceneTag, Viewport } from './types';

interface Variant {
  /** Position de l'emetteur, en fraction du cadre depuis le centre. */
  readonly emitterX: number;
  readonly emitterY: number;
  /** Echelle du champ. Grand = tourbillons larges. */
  readonly fieldScale: number;
  /** Sens de la torsion. */
  readonly spin: number;
  /** `true` = gros plan : le champ deborde largement du cadre. */
  readonly closeUp: boolean;
}

/** Deux variantes decentrees sur des points forts du tiers, une centree (§3.6). */
const VARIANTS: readonly Variant[] = [
  { emitterX: -0.17, emitterY: 0.08, fieldScale: 2.4, spin: 1, closeUp: false },
  { emitterX: 0.16, emitterY: -0.12, fieldScale: 1.5, spin: -1, closeUp: true },
  { emitterX: 0, emitterY: 0, fieldScale: 3.1, spin: 1, closeUp: false },
];

/** Plafond absolu, aligne sur la qualite 3 de §3.7. */
const MAX_PARTICLES = 6000;
/** Buckets de couleur. §3.7 en preconise 6 a 8 : au-dela, le gain d'un `fill()` groupe s'efface. */
const BUCKETS = 7;
/** Duree de vie maximale, en secondes. Au-dela la particule est recyclee meme si elle est encore visible. */
const MAX_AGE = 6;

export class CurlFlowScene implements LiveScene {
  readonly id = 'curl-flow';
  readonly tags: readonly SceneTag[] = ['organic', 'calm'];
  readonly intensityRange: readonly [number, number] = [0.1, 0.75];
  readonly primaryAccent = 'noyau emetteur';

  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly pvx = new Float32Array(MAX_PARTICLES);
  private readonly pvy = new Float32Array(MAX_PARTICLES);
  private readonly page = new Float32Array(MAX_PARTICLES);
  private readonly pbucket = new Uint8Array(MAX_PARTICLES);
  /** Indices tries par bucket, remplis a chaque trame. Pre-alloue : aucun tableau cree en boucle. */
  private readonly bucketCounts = new Int32Array(BUCKETS);
  private readonly bucketStart = new Int32Array(BUCKETS + 1);
  /** Curseur d'ecriture du tri par comptage. Pre-alloue : un `slice()` par trame serait une allocation en boucle chaude. */
  private readonly bucketCursor = new Int32Array(BUCKETS);
  private readonly ordered = new Int32Array(MAX_PARTICLES);
  private readonly sample = new Float32Array(2);

  private field = new CurlField(1);
  private rng: () => number = Math.random;
  private variant: Variant = VARIANTS[0]!;
  private reducedDivider = 2;
  private count = 0;
  private twist = 0;

  init(sc: SceneContext): void {
    this.reducedDivider = sc.config.safety.reducedAmplitudeDivider;
    this.rng = sc.rng;
    // Le champ est seede par le PRNG du director : deux sessions identiques
    // donnent le meme champ, ce qui rend un bug de mouvement reproductible.
    this.field = new CurlField(Math.floor(sc.rng() * 0xffff) + 1);
    this.count = 0;
  }

  enter(frame: LiveFrame, variantIndex: number): void {
    this.variant = VARIANTS[variantIndex % VARIANTS.length]!;
    this.count = 0;
    this.twist = 0;
    void frame;
  }

  resize(_view: Viewport): void {
    // Les positions sont stockees en fractions du petit cote : un
    // redimensionnement ne les invalide pas.
  }

  // hot-path (§8.9) : corps de trame.
  render(ctx: CanvasRenderingContext2D, frame: LiveFrame): void {
    const view = frame.view;
    const amp = frame.reducedMotion ? 1 / Math.max(1, this.reducedDivider) : 1;
    const palette = frame.palette;
    const v = this.variant;
    const dt = frame.dt;

    const cap = capFor(frame.quality);
    // Le noyau de l'emetteur est MASSIF : depassement de 8 % autorise (§2.7.8).
    // Plancher de grille : sans lui, une mesure sans kick detecte n'emet plus
    // que le debit de base et le flux se vide visiblement.
    const kick = withGridFloor(frame.onsets.envelope('kick', DECAY_KICK, 0.08), frame.gridAccent(DECAY_KICK), 1);
    const snare = frame.onsets.envelope('snare', DECAY_SNARE);
    const hat = frame.onsets.envelope('hat', DECAY_HAT);
    const bass = frame.features.macroNorm[1] ?? 0;
    const air = frame.features.macroNorm[4] ?? 0;

    // La BASSE tord le champ - un niveau, pas un onset : la torsion doit etre
    // continue, sinon le champ tressaute a chaque frappe.
    this.twist += dt * (0.15 + bass * 0.9) * v.spin;

    // MICRO-VARIATION de phrase (§4.3) : l'emetteur derive lentement sur une
    // petite ellipse. La torsion evolue deja, mais elle est pilotee par la
    // basse, donc statique sur un passage a niveau constant.
    const drift = frame.beat.phrasePhase * Math.PI * 2;
    const emitterX = (v.emitterX + Math.cos(drift) * 0.03) * view.w;
    const emitterY = (v.emitterY + Math.sin(drift) * 0.02) * view.h;
    const unit = view.min;

    // --- emission : bouffee sur le KICK ------------------------------------
    const base = Math.round(cap * 0.012);
    const burst = Math.round(cap * 0.05 * kick * amp);
    this.emit(base + burst, cap, emitterX, emitterY, unit);

    // --- integration --------------------------------------------------------
    const octaves = frame.quality >= 2 ? 3 : 2;
    const speedScale = unit * (v.closeUp ? 0.55 : 0.35);
    // Les AIGUS dispersent : un bruit additif proportionnel a la bande `air`.
    const disperse = unit * (0.02 + air * 0.10) * amp;
    const fieldScale = v.fieldScale / unit;
    let write = 0;
    this.bucketCounts.fill(0);

    for (let i = 0; i < this.count; i++) {
      const age = this.page[i]! + dt;
      const x = this.px[i]!;
      const y = this.py[i]!;
      const margin = unit * 0.6;
      if (age > MAX_AGE || x < -view.w / 2 - margin || x > view.w / 2 + margin || y < -view.h / 2 - margin || y > view.h / 2 + margin) {
        continue;
      }

      this.field.sample(x * fieldScale, y * fieldScale, this.twist, octaves, this.sample);
      const vx = this.sample[0]! * speedScale;
      const vy = this.sample[1]! * speedScale;
      // Inertie : la particule suit le champ sans y coller, ce qui produit des
      // trajectoires lisses plutot que des cassures a chaque cellule de bruit.
      const nvx = this.pvx[i]! + (vx - this.pvx[i]!) * Math.min(1, dt * 4);
      const nvy = this.pvy[i]! + (vy - this.pvy[i]!) * Math.min(1, dt * 4);
      const jx = (this.rng() * 2 - 1) * disperse;
      const jy = (this.rng() * 2 - 1) * disperse;

      this.px[write] = x + nvx * dt + jx * dt;
      this.py[write] = y + nvy * dt + jy * dt;
      this.pvx[write] = nvx;
      this.pvy[write] = nvy;
      this.page[write] = age;
      // Bucket par VITESSE, pas par index : la couleur porte alors une
      // information physique. Une teinte pilotee par l'index serait la
      // rotation arc-en-ciel interdite par §6.3.
      const speed = Math.hypot(nvx, nvy) / Math.max(speedScale, 1e-6);
      const b = Math.min(BUCKETS - 1, Math.max(0, Math.floor(speed * BUCKETS)));
      this.pbucket[write] = b;
      this.bucketCounts[b] = this.bucketCounts[b]! + 1;
      write++;
    }
    this.count = write;

    // --- tri par bucket, par comptage : O(n), sans allocation ---------------
    this.bucketStart[0] = 0;
    for (let b = 0; b < BUCKETS; b++) this.bucketStart[b + 1] = this.bucketStart[b]! + this.bucketCounts[b]!;
    for (let b = 0; b < BUCKETS; b++) this.bucketCursor[b] = this.bucketStart[b]!;
    for (let i = 0; i < this.count; i++) {
      const b = this.pbucket[i]!;
      this.ordered[this.bucketCursor[b]!] = i;
      this.bucketCursor[b] = this.bucketCursor[b]! + 1;
    }

    // --- rendu : UN SEUL `fill()` par bucket --------------------------------
    ctx.globalCompositeOperation = 'lighter';
    const size = Math.max(1, unit * (v.closeUp ? 0.0035 : 0.0022));
    for (let b = 0; b < BUCKETS; b++) {
      const from = this.bucketStart[b]!;
      const to = this.bucketStart[b + 1]!;
      if (to <= from) continue;
      // Modulation BORNEE d'un seul role : la teinte reste dans la palette.
      const t = (b / (BUCKETS - 1)) * 2 - 1;
      ctx.fillStyle = palette.hexModulated('primary', t);
      ctx.globalAlpha = 0.22 + (b / (BUCKETS - 1)) * 0.5;
      ctx.beginPath();
      for (let k = from; k < to; k++) {
        const i = this.ordered[k]!;
        // Fondu de fin de vie : une particule qui disparait d'un coup se voit.
        const fade = 1 - this.page[i]! / MAX_AGE;
        if (fade <= 0.02) continue;
        const s = size * (0.5 + fade * 0.5);
        ctx.rect(this.px[i]! - s * 0.5, this.py[i]! - s * 0.5, s, s);
      }
      ctx.fill();
    }

    // --- noyau emetteur : l'accent principal --------------------------------
    // Le SNARE decale lateralement le noyau : recadrage, pas echelle (§2.7.7).
    const shift = snare * unit * 0.05 * amp;
    const coreR = unit * (0.012 + kick * 0.05 * amp);
    const grad = ctx.createRadialGradient(emitterX + shift, emitterY, 0, emitterX + shift, emitterY, coreR * 4);
    grad.addColorStop(0, palette.hex('highlight'));
    grad.addColorStop(0.35, palette.hex('accent'));
    grad.addColorStop(1, palette.hex('background'));
    ctx.globalAlpha = 0.55 + kick * 0.45 * amp;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(emitterX + shift, emitterY, coreR * 4, 0, Math.PI * 2);
    ctx.fill();

    // Scintillement du CHARLEY sur le noyau, plafonne a 40 % de l'accent.
    if (hat > 0.02) {
      ctx.globalAlpha = hat * 0.4 * amp;
      ctx.fillStyle = palette.hex('highlight');
      ctx.beginPath();
      ctx.arc(emitterX + shift, emitterY, coreR * (1 + hat), 0, Math.PI * 2);
      ctx.fill();
    }

    resetCompositing(ctx);
  }

  /** Nombre de particules vivantes - lu par le HUD et par les tests. */
  get particleCount(): number {
    return this.count;
  }

  private emit(n: number, cap: number, ex: number, ey: number, unit: number): void {
    const room = Math.min(cap, MAX_PARTICLES) - this.count;
    const toEmit = Math.min(n, Math.max(0, room));
    for (let k = 0; k < toEmit; k++) {
      const a = this.rng() * Math.PI * 2;
      const r = unit * 0.01 * Math.sqrt(this.rng());
      const i = this.count++;
      this.px[i] = ex + Math.cos(a) * r;
      this.py[i] = ey + Math.sin(a) * r;
      this.pvx[i] = 0;
      this.pvy[i] = 0;
      this.page[i] = 0;
      this.pbucket[i] = 0;
    }
  }

  exit(): void {
    this.count = 0;
  }

  reset(): void {
    this.count = 0;
    this.twist = 0;
    this.variant = VARIANTS[0]!;
  }

  dispose(): void {
    this.reset();
  }
}

/** Plafonds de §3.7 : Q0 = 600, Q1 = 1500, Q2 = 3000, Q3 = 6000. */
export function capFor(quality: number): number {
  return quality >= 3 ? 6000 : quality === 2 ? 3000 : quality === 1 ? 1500 : 600;
}

export const CURL_FLOW_VARIANTS = VARIANTS.length;
export const CURL_FLOW_BUCKETS = BUCKETS;
