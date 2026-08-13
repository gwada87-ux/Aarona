/**
 * `note-helix` (ADR-015, lot 3) - la scene VITRINE du chantier melodie :
 * celle qui VOIT les notes annoncees par Beat Studio.
 *
 * ---------------------------------------------------------------------------
 * LA GEOMETRIE : L'HELICE DES HAUTEURS, PAS UN PIANO-ROLL
 * ---------------------------------------------------------------------------
 * Une note MIDI se place en polaire :
 *   - sa CLASSE DE HAUTEUR (midi % 12) donne l'ANGLE, sur le cercle
 *     chromatique. Un la est toujours sur le meme rayon, quelle que soit
 *     l'octave ;
 *   - son OCTAVE donne le RAYON. Les octaves s'empilent vers l'exterieur.
 * C'est l'helice des hauteurs, un objet de theorie musicale, pas une
 * disposition decorative : une melodie y DESSINE une forme reconnaissable, et
 * deux notes a l'octave tombent sur le meme rayon, ce qu'aucun piano-roll ne
 * montre. Un arc relie chaque note a la precedente : c'est la ligne melodique
 * elle-meme qui se trace.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE N'EST PAS UN ANALYSEUR (interdit §6.1)
 * ---------------------------------------------------------------------------
 * Le test de §6.1 est explicite : « si retirer l'audio rend la scene identique
 * a un analyseur, elle est interdite ». Retirer l'audio ici ne laisse pas un
 * ecran vide ni une nappe de barres : l'helice EXISTE en propre - douze rayons
 * et ses anneaux d'octave respirent, l'ensemble tourne lentement sur le temps,
 * et le noyau bat sur le kick. Les notes ALLUMENT cette structure, elles ne la
 * constituent pas. Et surtout, ce qui est montre n'est pas mesurable a
 * l'oreille d'un analyseur : ce sont les notes COMPOSEES, annoncees par l'hote
 * avant meme d'avoir sonne - une information qu'aucune analyse spectrale ne
 * peut produire. C'est tout le sens du canal de verite (ADR-012).
 *
 * POURQUOI CE N'EST PAS L'ANNEAU CENTRE INTERDIT (§6.2) : cinq parametres,
 * cinq sources - angle (classe de hauteur), rayon (octave), taille (velocite),
 * rotation d'ensemble (temps), noyau (kick). §6.2 en demande deux.
 *
 * ACCENT PRINCIPAL (§2.7.6) : le NOYAU central, qui se dilate a chaque kick.
 * Identifiable sur une capture figee, contrairement a une lueur qui varie.
 *
 * TEINTE (§3.5) : la couleur d'une etoile suit sa position sur le CERCLE DES
 * QUINTES, pas sur l'index de sa classe de hauteur - deux notes harmoniquement
 * voisines recoivent des teintes voisines, une gamme chromatique ne produit
 * donc pas un balayage arc-en-ciel. La modulation passe par `hexModulated`,
 * bornee par construction a `hueModulation`. Meme raisonnement qu'au lot 1
 * (voir `util/tonalHue.ts`).
 */

import { resetCompositing } from '../render/LayerStack';
import { DECAY_KICK, withGridFloor } from '../util/accent';
import { fifthsIndex } from '../util/tonalHue';
import type { LiveFrame, LiveScene, SceneContext, SceneTag, Viewport } from './types';

interface Variant {
  /** Centre de l'helice, en fraction du petit cote depuis le centre du cadre. */
  readonly centerX: number;
  readonly centerY: number;
  /** Sens de la rotation d'ensemble. */
  readonly spin: number;
  /** Les anneaux d'octave sont-ils traces ? Sinon seuls les rayons portent la structure. */
  readonly rings: boolean;
}

/**
 * Trois variantes, deux decentrees (§3.6 : « toute scene expose une variante
 * dont le point d'interet est hors centre, sur un point fort du tiers »).
 */
const VARIANTS: readonly Variant[] = [
  { centerX: -0.17, centerY: 0.08, spin: 1, rings: true },
  { centerX: 0.19, centerY: -0.11, spin: -1, rings: true },
  { centerX: 0.02, centerY: 0.03, spin: 1, rings: false },
];

export const NOTE_HELIX_VARIANTS = VARIANTS.length;

/** Etoiles simultanees. Une note tenue en croches sur deux pistes en allume une poignee. */
const STAR_CAP = 96;
/** Segments de ligne melodique retenus. */
const ARC_CAP = 32;
/** Duree de vie d'une etoile, en secondes. Assez pour qu'un motif se lise, assez peu pour ne pas empater. */
const STAR_LIFE_SEC = 1.9;
const ARC_LIFE_SEC = 1.35;
/** Octaves representees : do1 a do7 environ, ce que couvre un beat. */
const MIDI_LOW = 24;
const MIDI_HIGH = 96;
/** Rayons de l'helice, en fraction du petit cote. */
const RADIUS_INNER = 0.1;
const RADIUS_OUTER = 0.42;
/** Tour complet de la rotation d'ensemble, en secondes. Tres lent : c'est une derive, pas un manege. */
const SPIN_PERIOD_SEC = 96;

export class NoteHelixScene implements LiveScene {
  readonly id = 'note-helix';
  readonly tags: readonly SceneTag[] = ['geometric', 'calm'];
  readonly intensityRange: readonly [number, number] = [0.2, 0.8];
  readonly primaryAccent = 'noyau central';

  private variant: Variant = VARIANTS[0]!;
  private view: Viewport = { w: 1, h: 1, dpr: 1, min: 1 };
  private twinkleSeed = 0;

  // Pools pre-alloues : aucune allocation dans `render` (docs/10).
  private readonly starAngle = new Float32Array(STAR_CAP);
  private readonly starRadius = new Float32Array(STAR_CAP);
  private readonly starSize = new Float32Array(STAR_CAP);
  private readonly starLife = new Float32Array(STAR_CAP);
  private readonly starFifths = new Float32Array(STAR_CAP);
  private starNext = 0;

  private readonly arcFromA = new Float32Array(ARC_CAP);
  private readonly arcFromR = new Float32Array(ARC_CAP);
  private readonly arcToA = new Float32Array(ARC_CAP);
  private readonly arcToR = new Float32Array(ARC_CAP);
  private readonly arcLife = new Float32Array(ARC_CAP);
  private arcNext = 0;

  /** Derniere note posee, pour tracer l'arc suivant. `-1` = aucune. */
  private lastAngle = -1;
  private lastRadius = 0;

  init(sc: SceneContext): void {
    this.view = sc.view;
    // Unique tirage, a l'initialisation : le scintillement doit etre STABLE
    // d'une trame a l'autre, donc derive d'une graine, jamais retire.
    this.twinkleSeed = sc.rng() * 1000;
  }

  enter(_frame: LiveFrame, variantIndex: number): void {
    this.variant = VARIANTS[((variantIndex % VARIANTS.length) + VARIANTS.length) % VARIANTS.length]!;
    this.reset();
  }

  resize(view: Viewport): void {
    this.view = view;
  }

  reset(): void {
    this.starLife.fill(0);
    this.arcLife.fill(0);
    this.starNext = 0;
    this.arcNext = 0;
    this.lastAngle = -1;
  }

  exit(): void {
    // Rien a relacher : la scene ne detient aucun calque propre.
  }

  dispose(): void {
    this.reset();
  }

  /** Angle (radians) de la classe de hauteur d'une note — le cercle chromatique. */
  private angleOf(midi: number): number {
    return ((midi % 12) / 12) * Math.PI * 2;
  }

  /** Rayon normalise d'une note — son octave, borne aux extremes representes. */
  private radiusOf(midi: number): number {
    const clamped = midi < MIDI_LOW ? MIDI_LOW : midi > MIDI_HIGH ? MIDI_HIGH : midi;
    const t = (clamped - MIDI_LOW) / (MIDI_HIGH - MIDI_LOW);
    return RADIUS_INNER + t * (RADIUS_OUTER - RADIUS_INNER);
  }

  private spawn(midi: number, velocity: number): void {
    const a = this.angleOf(midi);
    const r = this.radiusOf(midi);
    const i = this.starNext % STAR_CAP;
    this.starNext++;
    this.starAngle[i] = a;
    this.starRadius[i] = r;
    this.starSize[i] = 0.008 + velocity * 0.026;
    this.starLife[i] = 1;
    // Position sur le cercle des quintes, ramenee dans [-1, 1] : c'est elle
    // qui choisit la teinte, de sorte que deux notes harmoniquement voisines
    // soient visuellement voisines (voir l'en-tete).
    this.starFifths[i] = (fifthsIndex(Math.round(midi) % 12) / 11) * 2 - 1;

    if (this.lastAngle >= 0) {
      const j = this.arcNext % ARC_CAP;
      this.arcNext++;
      this.arcFromA[j] = this.lastAngle;
      this.arcFromR[j] = this.lastRadius;
      this.arcToA[j] = a;
      this.arcToR[j] = r;
      this.arcLife[j] = 1;
    }
    this.lastAngle = a;
    this.lastRadius = r;
  }

  render(ctx: CanvasRenderingContext2D, frame: LiveFrame): void {
    const view = frame.view;
    const unit = view.min;
    const cx = view.w / 2 + this.variant.centerX * unit;
    const cy = view.h / 2 + this.variant.centerY * unit;
    const reduce = frame.reducedMotion ? 0.5 : 1;

    // 1. Les notes de la trame allument l'helice. Absentes (pas de canal de
    //    verite, ou hote sans notes), la structure vit quand meme.
    const notes = frame.notes;
    if (notes) {
      for (let i = 0; i < notes.count; i++) this.spawn(notes.midi(i), notes.velocity(i));
    }

    // 2. Vieillissement. Un seul parcours, pas de compactage : une entree
    //    morte est simplement sautee au dessin.
    const dt = frame.dt;
    for (let i = 0; i < STAR_CAP; i++) {
      if (this.starLife[i]! > 0) this.starLife[i] = Math.max(0, this.starLife[i]! - dt / STAR_LIFE_SEC);
    }
    for (let i = 0; i < ARC_CAP; i++) {
      if (this.arcLife[i]! > 0) this.arcLife[i] = Math.max(0, this.arcLife[i]! - dt / ARC_LIFE_SEC);
    }

    const spin = this.variant.spin * (frame.tSec / SPIN_PERIOD_SEC) * Math.PI * 2 * reduce;
    const breath = 0.97 + 0.03 * Math.sin(frame.tSec * 0.55);
    // `withGridFloor` prend un MAX, jamais une somme (§2.7.7) : sur un temps
    // ou le kick est detecte, les deux se cumuleraient sinon.
    const kick = withGridFloor(frame.onsets.envelope('kick', DECAY_KICK, 0.06), frame.gridAccent(DECAY_KICK), 1);

    // 3. LA STRUCTURE - douze rayons, anneaux d'octave. Elle ne depend
    //    d'aucune note : c'est ce qui rend la scene lisible sur un morceau
    //    que l'hote n'annonce pas (§6.1).
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = frame.palette.hex('secondary');
    ctx.globalAlpha = 0.16 + frame.intensity * 0.1;
    ctx.lineWidth = Math.max(1, unit * 0.0012);
    ctx.beginPath();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + spin;
      const ri = RADIUS_INNER * unit * breath;
      const ro = RADIUS_OUTER * unit * breath;
      ctx.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri);
      ctx.lineTo(cx + Math.cos(a) * ro, cy + Math.sin(a) * ro);
    }
    ctx.stroke();

    if (this.variant.rings) {
      ctx.globalAlpha = 0.1 + frame.intensity * 0.07;
      ctx.beginPath();
      for (let o = 0; o <= 4; o++) {
        const r = (RADIUS_INNER + (o / 4) * (RADIUS_OUTER - RADIUS_INNER)) * unit * breath;
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.stroke();
    }

    // 4. LA LIGNE MELODIQUE - un arc par intervalle joue. Additif : les
    //    croisements s'illuminent, ce qui fait ressortir les notes pivots.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = frame.palette.hex('primary');
    ctx.lineWidth = Math.max(1, unit * 0.0022);
    for (let i = 0; i < ARC_CAP; i++) {
      const life = this.arcLife[i]!;
      if (life <= 0) continue;
      ctx.globalAlpha = life * life * 0.5;
      const a0 = this.arcFromA[i]! + spin;
      const a1 = this.arcToA[i]! + spin;
      const r0 = this.arcFromR[i]! * unit * breath;
      const r1 = this.arcToR[i]! * unit * breath;
      const x0 = cx + Math.cos(a0) * r0;
      const y0 = cy + Math.sin(a0) * r0;
      const x1 = cx + Math.cos(a1) * r1;
      const y1 = cy + Math.sin(a1) * r1;
      // Courbe passant pres du centre : l'intervalle se lit comme un geste,
      // une corde droite donnerait un polygone sans direction.
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx + (mx - cx) * 0.45, cy + (my - cy) * 0.45, x1, y1);
      ctx.stroke();
    }

    // 5. LES ETOILES - une note, un point. Taille = velocite, teinte = quinte.
    for (let i = 0; i < STAR_CAP; i++) {
      const life = this.starLife[i]!;
      if (life <= 0) continue;
      const a = this.starAngle[i]! + spin;
      const r = this.starRadius[i]! * unit * breath;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      // Scintillement stable : fonction de la graine et de l'index, jamais
      // d'un tirage par trame (une etoile ne doit pas papilloter au hasard).
      const twinkle = 0.85 + 0.15 * Math.sin(frame.tSec * 2.1 + this.twinkleSeed + i);
      const size = this.starSize[i]! * unit * (0.35 + life * 0.65) * twinkle;
      ctx.globalAlpha = life * 0.9;
      ctx.fillStyle = frame.palette.hexModulated('accent', this.starFifths[i]!);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. LE NOYAU - accent principal (§2.7.6) : il se dilate sur le kick.
    const coreR = unit * (0.018 + kick * 0.03 * reduce);
    ctx.globalAlpha = 0.5 + kick * 0.45;
    ctx.fillStyle = frame.palette.hex('highlight');
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    resetCompositing(ctx);
  }
}
