/**
 * `laser-tunnel` (§4.2, scene 2) - anneaux emis a chaque kick, filant vers la
 * camera. Espacement = tempo, epaisseur = force de frappe.
 *
 * ACCENT PRINCIPAL (§2.7.6) : les ANNEAUX. Chacun nait sur un kick et son
 * epaisseur porte la force de la frappe - sur une capture figee, on lit le
 * motif rythmique des dernieres secondes dans l'espacement des anneaux. C'est
 * la seule scene de la selection ou l'accent principal est un HISTORIQUE
 * plutot qu'un etat instantane, et c'est ce qui la rend lisible son coupe.
 *
 * CANAUX (§2.7.7) : kick -> emission et epaisseur ; snare -> deplacement du
 * point de fuite, donc recadrage ; charley -> etincelles le long des parois.
 *
 * Le tempo fixe l'espacement sans qu'on ait a le calculer : un anneau par
 * kick, tous a la meme vitesse, donc la distance entre deux anneaux EST la
 * periode. Rien a synchroniser.
 */

import { resetCompositing } from '../render/LayerStack';
import { DECAY_HAT, DECAY_SNARE, beatWeight } from '../util/accent';
import type { LiveFrame, LiveScene, SceneContext, SceneTag, Viewport } from './types';

interface Variant {
  /** Point de fuite, en fraction du cadre depuis le centre. */
  readonly vanishX: number;
  readonly vanishY: number;
  /** Nombre de parois radiales. 0 = tunnel lisse. */
  readonly walls: number;
  /** `true` = gros plan : les anneaux debordent largement du cadre. */
  readonly closeUp: boolean;
}

/**
 * §4.2 : « decentre le point de fuite dans au moins une variante ». Deux le
 * sont ici, sur des points forts du tiers, une seule reste centree - ce qui
 * respecte aussi la regle du tiers de §3.6 a l'echelle des variantes.
 */
const VARIANTS: readonly Variant[] = [
  { vanishX: -0.18, vanishY: 0.06, walls: 8, closeUp: false },
  { vanishX: 0.2, vanishY: -0.1, walls: 12, closeUp: true },
  { vanishX: 0, vanishY: 0, walls: 6, closeUp: false },
];

/** Plafond d'anneaux vivants. Chaque anneau coute un `arc()` : au-dela de 24 on ne les distingue plus. */
/**
 * Fenetre de CHARGE avant une frappe annoncee (SESSION F), en secondes.
 * 80 ms, un peu plus que les 60 ms de `mandala-32` : l'anneau du tunnel part
 * tres vite (progression exponentielle), il faut donc voir la lumiere
 * s'amasser un peu plus longtemps pour que le lien de cause a effet se lise.
 * Chaque scene regle SA fenetre — c'est un parametre de geste, pas une
 * constante du canal.
 */
const PREARM_SEC = 0.08;

const MAX_RINGS = 24;
/** Duree de vie d'un anneau, en secondes. Regle la profondeur apparente du tunnel. */
const RING_LIFE = 2.6;

export class LaserTunnelScene implements LiveScene {
  readonly id = 'laser-tunnel';
  readonly tags: readonly SceneTag[] = ['neon', 'intense', 'strobe'];
  readonly intensityRange: readonly [number, number] = [0.55, 1];
  readonly primaryAccent = 'anneaux emis sur le kick';

  /** Age de chaque anneau, en secondes. Pre-alloue : aucune allocation en boucle. */
  private readonly age = new Float32Array(MAX_RINGS);
  private readonly strength = new Float32Array(MAX_RINGS);
  private count = 0;
  private variant: Variant = VARIANTS[0]!;
  private reducedDivider = 2;
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
    // Les anneaux vivants sont CONSERVES : une variante est un changement de
    // cadrage, pas un redemarrage. Vider le tunnel a chaque variante ferait
    // clignoter la scene toutes les huit mesures.
    void frame;
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
    const unit = view.min;

    const kickTime = frame.onsets.lastTime('kick');
    const snare = frame.onsets.envelope('snare', DECAY_SNARE);
    const hat = frame.onsets.envelope('hat', DECAY_HAT);

    // --- emission : un anneau par KICK -------------------------------------
    const kickFired = frame.onsets.fired('kick') && kickTime !== this.lastKickTime;
    if (kickFired) {
      this.lastKickTime = kickTime;
      this.emit(frame.onsets.strength('kick'));
    }

    // --- emission de GRILLE sur les temps sans frappe (§2.7.8) --------------
    // Ici le plancher ne peut pas etre un `max` sur une enveloppe : le tunnel
    // EMET des objets discrets. Un temps sans kick detecte ne produisait donc
    // aucun anneau, et sur un motif a kick sur 1 et 3 le tunnel avancait a
    // demi-vitesse alors que l'horloge, elle, etait juste.
    //
    // La frontiere est detectee sur le REBOUCLAGE de `visualBeatPhase`, pas sur
    // l'increment de `beatIndex`. `beatIndex` avance a la frontiere BRUTE : s'y
    // fier ferait naitre l'anneau de grille a l'instant ou l'analyse voit le
    // temps, decale de `syncOffsetMs` par rapport a l'instant ou l'auditeur
    // l'entend - exactement ce que §2.5 corrige partout ailleurs.
    const vphase = frame.beat.visualBeatPhase;
    const wrapped = this.lastVisualPhase >= 0 && vphase < this.lastVisualPhase - 0.5;
    this.lastVisualPhase = vphase;
    if (wrapped) {
      // Position dans la MESURE, lue sur la phase de mesure visuelle : c'est
      // elle qui sait ou est le temps 1.
      const position = Math.floor(frame.beat.visualBarPhase * this.beatsPerBar);
      // `kickFired` couvre le cas ou les deux tombent sur la meme trame : on
      // n'emet pas deux anneaux pour un seul temps.
      const weight = beatWeight(position, this.beatsPerBar) * frame.beat.confidence;
      if (!kickFired && weight > 0.05) this.emit(weight);
    }

    // --- avance et rendu ----------------------------------------------------
    // Le SNARE deplace le point de fuite : recadrage, pas echelle (§2.7.7).
    const shift = snare * unit * 0.06 * amp;
    const cx = v.vanishX * view.w + shift;
    const cy = v.vanishY * view.h;
    const reach = (v.closeUp ? 1.6 : 1.0) * Math.hypot(view.w, view.h) * 0.6;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';

    // --- RETENUE AVANT IMPACT (SESSION F, anticipation d'ADR-012) ----------
    // L'hote annonce ses frappes avant qu'elles ne sonnent : le tunnel CHARGE
    // au lieu de seulement reagir. La lumiere s'amasse au POINT DE FUITE, et
    // l'anneau jaillit ensuite exactement de la.
    //
    // Geste DELIBEREMENT different de celui de `mandala-32`, qui fait
    // converger un anneau depuis l'exterieur : ici tout le vocabulaire de la
    // scene est centrifuge (les anneaux naissent au fond et foncent vers
    // l'oeil), donc la retenue se lit en PROFONDEUR, pas en rayon. Deux
    // scenes qui inspireraient du meme geste n'apprendraient rien de plus.
    //
    // Sans canal de verite, `nextIn` vaut `+Infinity`, `charge` reste nul et
    // ce bloc ne dessine rien : la scene est alors strictement celle d'avant.
    const nextKick = frame.anticipation?.nextIn('kick') ?? Number.POSITIVE_INFINITY;
    const charge = nextKick < PREARM_SEC ? 1 - nextKick / PREARM_SEC : 0;
    if (charge > 0) {
      ctx.globalAlpha = charge * charge * 0.7 * amp;
      ctx.fillStyle = palette.hex('highlight');
      ctx.beginPath();
      ctx.arc(cx, cy, unit * (0.004 + charge * 0.014) * amp, 0, Math.PI * 2);
      ctx.fill();
    }

    let write = 0;
    for (let i = 0; i < this.count; i++) {
      const age = this.age[i]! + frame.dt;
      if (age >= RING_LIFE) continue;
      this.age[write] = age;
      this.strength[write] = this.strength[i]!;
      write++;

      const t = age / RING_LIFE;
      // Progression EXPONENTIELLE : un anneau qui approche accelere, ce qui
      // donne la perspective. Une progression lineaire donnerait des cercles
      // qui grossissent, pas un tunnel.
      const radius = reach * (Math.exp(t * 2.2) - 1) / (Math.exp(2.2) - 1);
      if (radius < unit * 0.004) continue;

      const s = this.strength[write - 1]!;
      // EPAISSEUR = force de frappe. Elle decroit avec la distance parcourue,
      // sinon l'anneau le plus proche ecrase tous les autres.
      ctx.lineWidth = Math.max(1, unit * (0.002 + s * 0.012 * amp) * (1 - t * 0.55));
      ctx.globalAlpha = (1 - t) * (0.35 + s * 0.5);
      ctx.strokeStyle = palette.hexModulated('primary', s * 2 - 1);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.count = write;

    // --- parois radiales : la structure du tunnel ---------------------------
    // Elles tournent sur `phrasePhase` : deuxieme parametre, deuxieme source.
    if (v.walls > 0) {
      const spin = frame.beat.phrasePhase * Math.PI * 2 * (v.closeUp ? -1 : 1);
      ctx.globalAlpha = 0.18 + frame.intensity * 0.15;
      ctx.strokeStyle = palette.hex('secondary');
      ctx.lineWidth = Math.max(1, unit * 0.0014);
      ctx.beginPath();
      for (let i = 0; i < v.walls; i++) {
        const a = spin + (i / v.walls) * Math.PI * 2;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
      }
      ctx.stroke();
    }

    // --- etincelles : le CHARLEY, plafonne a 40 % de l'accent ---------------
    if (hat > 0.02) {
      ctx.globalAlpha = hat * 0.4 * amp;
      ctx.fillStyle = palette.hexModulated('accent', hat * 2 - 1);
      const sparks = 14;
      const size = Math.max(1, unit * 0.0035);
      ctx.beginPath();
      for (let i = 0; i < sparks; i++) {
        // Position deterministe sur la paroi : liee a l'index de temps, pas a
        // un tirage par trame, sinon les etincelles grouillent au lieu de
        // scintiller en mesure.
        const a = ((i * 2.39996 + frame.beat.beatIndex * 0.7) % (Math.PI * 2));
        const r = reach * (0.12 + ((i * 0.137 + frame.beat.barPhase) % 1) * 0.55);
        ctx.rect(cx + Math.cos(a) * r - size / 2, cy + Math.sin(a) * r - size / 2, size, size);
      }
      ctx.fill();
    }

    resetCompositing(ctx);
  }

  /** Anneaux vivants - lu par le HUD et les tests. */
  get ringCount(): number {
    return this.count;
  }

  private emit(strength: number): void {
    if (this.count >= MAX_RINGS) {
      // Plein : on laisse tomber le plus ANCIEN, pas le nouveau - une frappe
      // qui ne produit pas d'anneau se voit immediatement.
      for (let i = 1; i < this.count; i++) {
        this.age[i - 1] = this.age[i]!;
        this.strength[i - 1] = this.strength[i]!;
      }
      this.count--;
    }
    this.age[this.count] = 0;
    this.strength[this.count] = strength;
    this.count++;
  }

  exit(): void {
    this.count = 0;
  }

  reset(): void {
    this.count = 0;
    this.variant = VARIANTS[0]!;
    this.lastKickTime = Number.NEGATIVE_INFINITY;
    this.lastVisualPhase = -1;
  }

  dispose(): void {
    this.reset();
  }
}

export const LASER_TUNNEL_VARIANTS = VARIANTS.length;
