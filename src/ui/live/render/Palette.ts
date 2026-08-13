/**
 * Palettes du mode live (§3.5).
 *
 * EXACTEMENT 8 palettes, definies en OKLCH avec 5 roles. Composition imposee
 * par le prompt : au moins 2 froides, 2 chaudes, 2 bichromies contrastees,
 * 1 monochrome, et 1 « violet -> rose/orange » qui assure la continuite avec
 * la palette par defaut du mode fichier.
 *
 * INTERDIT (§3.5, §6.3) : la rotation de teinte pilotee par l'index d'un
 * element (`hue = f(i)`) ou par le temps parcourant le cercle chromatique.
 * C'est la signature de l'amateurisme, et c'est structurellement empeche ici :
 * une scene ne peut demander qu'un ROLE, eventuellement module de
 * `hueModulation` degres au maximum autour de la teinte de ce role.
 *
 * Precision importante : la limite de +/- 40 degres porte sur la MODULATION
 * EN TEMPS REEL d'un role donne - une meme barre, une meme particule ne se
 * promene pas sur le cercle. Elle ne porte PAS sur l'ecart entre les roles
 * d'une palette : opposer un violet profond et un orange chaud est
 * parfaitement legitime, c'est meme ce qui fait un accent.
 *
 * Le fond n'est jamais `#000` pur mais un tres sombre TEINTE : un noir pur
 * fait perdre toute la teinte dans les basses lumieres, et le bloom additif
 * ramene alors un gris neutre au lieu d'un halo colore.
 */

import { contrastRatio, mixOklch, oklchToHex, oklchToRgb, type Oklch } from '../../../core/color/oklch';
import { CHORD_HUE_SHARE } from '../util/tonalHue';

/**
 * Vitesse de glissement du decalage harmonique (ADR-015), en degres par
 * seconde. Choisie pour qu'une modulation d'un demi-ton voisin (quelques
 * degres) se resorbe en une fraction de mesure et qu'un saut au triton prenne
 * environ une mesure a tempo courant : la couleur SUIT l'harmonie sans jamais
 * clignoter avec elle.
 */
export const TONAL_HUE_GLIDE_DEG_PER_SEC = 9;

export type PaletteRole = 'background' | 'primary' | 'secondary' | 'accent' | 'highlight';

export const PALETTE_ROLES: readonly PaletteRole[] = [
  'background',
  'primary',
  'secondary',
  'accent',
  'highlight',
];

export type PaletteTag = 'cold' | 'warm' | 'duotone' | 'mono' | 'heritage';

export interface Palette {
  readonly id: string;
  readonly tags: readonly PaletteTag[];
  /** Teinte dominante en degres OKLCH. */
  readonly dominantHue: number;
  /** Teinte d'accent. Ecart libre avec la dominante, choisi harmoniquement. */
  readonly accentHue: number;
  /** Amplitude MAXIMALE de modulation en temps reel autour de chaque role, en degres. Toujours <= 40. */
  readonly hueModulation: number;
  readonly roles: Readonly<Record<PaletteRole, Oklch>>;
}

/** Plafond dur de §3.5. Toute palette qui le depasse est rejetee par le test. */
export const MAX_HUE_MODULATION = 40;

function palette(
  id: string,
  tags: readonly PaletteTag[],
  dominantHue: number,
  accentHue: number,
  hueModulation: number,
  roles: Readonly<Record<PaletteRole, Oklch>>,
): Palette {
  return Object.freeze({ id, tags, dominantHue, accentHue, hueModulation, roles: Object.freeze(roles) });
}

export const PALETTES: readonly Palette[] = Object.freeze([
  // --- 2 froides -----------------------------------------------------------
  palette('nocturne', ['cold'], 258, 200, 22, {
    background: { l: 0.13, c: 0.035, h: 262 },
    primary: { l: 0.56, c: 0.15, h: 258 },
    secondary: { l: 0.42, c: 0.12, h: 246 },
    accent: { l: 0.72, c: 0.14, h: 200 },
    highlight: { l: 0.93, c: 0.05, h: 220 },
  }),
  palette('glacier', ['cold'], 205, 168, 18, {
    background: { l: 0.12, c: 0.028, h: 212 },
    primary: { l: 0.62, c: 0.11, h: 205 },
    secondary: { l: 0.48, c: 0.09, h: 218 },
    accent: { l: 0.78, c: 0.12, h: 168 },
    highlight: { l: 0.95, c: 0.03, h: 195 },
  }),
  // --- 2 chaudes -----------------------------------------------------------
  palette('ember', ['warm'], 34, 68, 24, {
    background: { l: 0.12, c: 0.03, h: 28 },
    primary: { l: 0.55, c: 0.17, h: 34 },
    secondary: { l: 0.41, c: 0.14, h: 20 },
    accent: { l: 0.74, c: 0.16, h: 68 },
    highlight: { l: 0.94, c: 0.05, h: 60 },
  }),
  palette('amber', ['warm'], 72, 40, 20, {
    background: { l: 0.13, c: 0.026, h: 66 },
    primary: { l: 0.66, c: 0.15, h: 72 },
    secondary: { l: 0.5, c: 0.13, h: 84 },
    accent: { l: 0.72, c: 0.17, h: 40 },
    highlight: { l: 0.95, c: 0.04, h: 88 },
  }),
  // --- 2 bichromies contrastees -------------------------------------------
  palette('duotone-cyan-magenta', ['duotone', 'cold'], 196, 330, 16, {
    background: { l: 0.11, c: 0.032, h: 288 },
    primary: { l: 0.68, c: 0.15, h: 196 },
    secondary: { l: 0.45, c: 0.12, h: 205 },
    accent: { l: 0.63, c: 0.22, h: 330 },
    highlight: { l: 0.94, c: 0.04, h: 250 },
  }),
  palette('duotone-lime-violet', ['duotone', 'warm'], 132, 296, 16, {
    background: { l: 0.12, c: 0.03, h: 300 },
    primary: { l: 0.74, c: 0.17, h: 132 },
    secondary: { l: 0.52, c: 0.13, h: 146 },
    accent: { l: 0.55, c: 0.2, h: 296 },
    highlight: { l: 0.95, c: 0.03, h: 120 },
  }),
  // --- 1 monochrome --------------------------------------------------------
  palette('graphite', ['mono', 'cold'], 264, 264, 8, {
    background: { l: 0.12, c: 0.012, h: 264 },
    primary: { l: 0.52, c: 0.022, h: 264 },
    secondary: { l: 0.36, c: 0.018, h: 264 },
    accent: { l: 0.72, c: 0.03, h: 264 },
    highlight: { l: 0.96, c: 0.008, h: 264 },
  }),
  // --- 1 heritage : violet -> rose/orange, continuite avec le mode fichier --
  palette('pulsar', ['heritage', 'warm'], 296, 38, 28, {
    background: { l: 0.13, c: 0.034, h: 296 },
    primary: { l: 0.6, c: 0.17, h: 296 },
    secondary: { l: 0.5, c: 0.19, h: 332 },
    accent: { l: 0.73, c: 0.17, h: 38 },
    highlight: { l: 0.95, c: 0.05, h: 350 },
  }),
]);

/** Nombre de pas de quantification de la modulation de teinte. */
const MOD_STEPS = 16;

/**
 * Palette RESOLUE et mise en cache, prete a etre consommee par une scene.
 *
 * Zero allocation dans la boucle chaude (§3.7) : les chaines `#rrggbb` sont
 * construites au plus une fois par « epoque » - un temps musical, ou une
 * avance suffisante du fondu de palette - et relues telles quelles ensuite.
 * Sans ce cache, une conversion OKLCH par element et par trame produit des
 * milliers de chaines par seconde, ce qui est un des pieges nommes de §3.7.
 */
export class PaletteBook {
  private fromPalette: Palette;
  private toPalette: Palette;
  private mix = 1;
  private mixSpeed = 0;
  private dirty = true;
  private index: number;

  private readonly resolved = new Map<PaletteRole, Oklch>();
  private readonly baseHex = new Map<PaletteRole, string>();
  /** `role -> pas de modulation -> chaine`. Taille bornee : 5 roles x 16 pas. */
  private readonly modHex = new Map<PaletteRole, string[]>();
  /** Decalage harmonique courant et sa cible, en degres (ADR-015). 0 = aucun accord connu. */
  private tonalHue = 0;
  private tonalHueTarget = 0;

  constructor(startIndex = 0) {
    this.index = ((startIndex % PALETTES.length) + PALETTES.length) % PALETTES.length;
    const start = PALETTES[this.index]!;
    this.fromPalette = start;
    this.toPalette = start;
    this.refresh();
  }

  get current(): Palette {
    return this.toPalette;
  }

  get currentIndex(): number {
    return this.index;
  }

  /** Le fondu de palette est-il en cours ? */
  get blending(): boolean {
    return this.mix < 1;
  }

  /**
   * Fondu vers une autre palette. `durationSec = 0` = coupe franche (§3.5 :
   * coupe franche sur un drop, fondu de 200 a 400 ms sinon).
   */
  crossfadeTo(index: number, durationSec: number): void {
    const next = ((index % PALETTES.length) + PALETTES.length) % PALETTES.length;
    if (next === this.index && this.mix >= 1) return;
    // Le point de depart est la palette REELLEMENT affichee, pas la cible
    // precedente : sans ca, interrompre un fondu produit un saut.
    this.fromPalette = this.snapshot();
    this.index = next;
    this.toPalette = PALETTES[next]!;
    this.mix = durationSec > 0 ? 0 : 1;
    this.mixSpeed = durationSec > 0 ? 1 / durationSec : 0;
    this.dirty = true;
  }

  /** Palette suivante dans l'ordre du livre. */
  next(durationSec: number): void {
    this.crossfadeTo(this.index + 1, durationSec);
  }

  /**
   * Cible du decalage de teinte HARMONIQUE, en degres (ADR-015). Bornee ICI a
   * `CHORD_HUE_SHARE x hueModulation` de la palette courante — la borne est
   * donc structurelle, elle ne depend pas de la bonne foi de l'appelant.
   *
   * Le decalage ne saute jamais : `update()` l'y amene en glissant. L'appelant
   * ne pose une nouvelle cible qu'a la frontiere de MESURE (§3.5 : la couleur
   * suit l'harmonie, elle ne clignote pas avec elle).
   */
  setTonalHueTarget(deg: number): void {
    const max = this.toPalette.hueModulation * CHORD_HUE_SHARE;
    const safe = Number.isFinite(deg) ? deg : 0;
    this.tonalHueTarget = safe < -max ? -max : safe > max ? max : safe;
  }

  /** Decalage harmonique effectivement applique a cet instant, en degres. */
  get tonalHueDeg(): number {
    return this.tonalHue;
  }

  update(dt: number): void {
    if (this.tonalHue !== this.tonalHueTarget) {
      const step = TONAL_HUE_GLIDE_DEG_PER_SEC * dt;
      const delta = this.tonalHueTarget - this.tonalHue;
      this.tonalHue = Math.abs(delta) <= step ? this.tonalHueTarget : this.tonalHue + Math.sign(delta) * step;
      this.dirty = true;
    }
    if (this.mix < 1) {
      this.mix = Math.min(1, this.mix + dt * this.mixSpeed);
      this.dirty = true;
    }
  }

  /**
   * Marque le cache a rafraichir. Appele sur frontiere de temps : §3.7 impose
   * que la palette interpolee soit recalculee « au plus une fois par temps ».
   */
  markBeat(): void {
    if (this.mix < 1) this.dirty = true;
  }

  /** Couleur du role, en `#rrggbb`. Chaine mise en cache, ne pas concatener dessus. */
  hex(role: PaletteRole): string {
    if (this.dirty) this.refresh();
    return this.baseHex.get(role) ?? '#000000';
  }

  /**
   * Couleur du role modulee en teinte. `amount` est dans [-1, 1] et correspond
   * a +/- `hueModulation` degres - JAMAIS plus, quelle que soit la valeur
   * passee. C'est ce qui rend la regle de §3.5 structurelle plutot que
   * declarative.
   */
  hexModulated(role: PaletteRole, amount: number): string {
    if (this.dirty) this.refresh();
    const clamped = amount < -1 ? -1 : amount > 1 ? 1 : amount;
    const step = Math.round(((clamped + 1) / 2) * (MOD_STEPS - 1));
    return this.modHex.get(role)?.[step] ?? this.hex(role);
  }

  /** Valeur OKLCH resolue du role - pour les calculs, pas pour `fillStyle`. */
  oklch(role: PaletteRole): Oklch {
    if (this.dirty) this.refresh();
    return this.resolved.get(role) ?? { l: 0, c: 0, h: 0 };
  }

  /**
   * Quatre arrets de degrade entre deux roles, avec une legere derive de
   * teinte (§3.5 : « degrades a >= 4 stops avec legere variation de teinte »).
   * Un degrade a 2 arrets sur une teinte constante donne une bande plate qui
   * se voit immediatement en grand format.
   */
  gradientStops(from: PaletteRole, to: PaletteRole, out: string[]): readonly string[] {
    if (this.dirty) this.refresh();
    const a = this.oklch(from);
    const b = this.oklch(to);
    const drift = Math.min(this.toPalette.hueModulation, 12);
    out.length = 0;
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const mixed = mixOklch(a, b, t);
      // Derive en cloche : nulle aux extremites, maximale au milieu. Les deux
      // bouts restent donc exactement les couleurs des roles demandes.
      const bell = Math.sin(t * Math.PI);
      out.push(oklchToHex({ l: mixed.l, c: mixed.c, h: mixed.h + drift * bell }));
    }
    return out;
  }

  /** Palette effectivement affichee a cet instant du fondu. */
  private snapshot(): Palette {
    if (this.mix >= 1) return this.toPalette;
    const roles: Record<PaletteRole, Oklch> = {
      background: this.oklch('background'),
      primary: this.oklch('primary'),
      secondary: this.oklch('secondary'),
      accent: this.oklch('accent'),
      highlight: this.oklch('highlight'),
    };
    const t = this.mix;
    return {
      ...this.toPalette,
      id: `${this.fromPalette.id}~${this.toPalette.id}`,
      dominantHue: this.fromPalette.dominantHue + (this.toPalette.dominantHue - this.fromPalette.dominantHue) * t,
      accentHue: this.fromPalette.accentHue + (this.toPalette.accentHue - this.fromPalette.accentHue) * t,
      hueModulation: Math.min(this.fromPalette.hueModulation, this.toPalette.hueModulation),
      roles,
    };
  }

  private refresh(): void {
    this.dirty = false;
    const t = this.mix;
    const modulation = Math.min(
      MAX_HUE_MODULATION,
      t >= 1 ? this.toPalette.hueModulation : Math.min(this.fromPalette.hueModulation, this.toPalette.hueModulation),
    );
    // ADR-015 : l'harmonie et la modulation par element puisent dans la MEME
    // enveloppe. Ce que l'accord consomme est retire au reste, de sorte que
    // l'excursion totale d'un element reste bornee par `hueModulation`
    // exactement comme avant ce chantier - l'invariant de §3.5 demeure
    // STRUCTUREL. A decalage nul (aucun accord annonce), `perElement` vaut
    // `modulation` et la teinte de base est inchangee : le rendu est alors
    // rigoureusement identique a celui d'avant.
    const shift = this.tonalHue;
    const perElement = Math.max(0, modulation - Math.abs(shift));
    for (const role of PALETTE_ROLES) {
      const a = this.fromPalette.roles[role];
      const b = this.toPalette.roles[role];
      const base = t >= 1 ? b : mixOklch(a, b, t);
      const c = shift === 0 ? base : { l: base.l, c: base.c, h: base.h + shift };
      this.resolved.set(role, c);
      this.baseHex.set(role, oklchToHex(c));

      let bucket = this.modHex.get(role);
      if (!bucket) {
        bucket = new Array<string>(MOD_STEPS);
        this.modHex.set(role, bucket);
      }
      for (let i = 0; i < MOD_STEPS; i++) {
        const amount = (i / (MOD_STEPS - 1)) * 2 - 1;
        bucket[i] = oklchToHex({ l: c.l, c: c.c, h: c.h + amount * perElement });
      }
    }
  }
}

/** Rapport de contraste WCAG entre le fond et le highlight d'une palette (critere §8.11). */
export function paletteContrast(p: Palette): number {
  return contrastRatio(oklchToRgb(p.roles.background), oklchToRgb(p.roles.highlight));
}
