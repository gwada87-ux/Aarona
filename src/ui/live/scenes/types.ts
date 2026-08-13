/**
 * Contrat des scenes du mode live (§4.1). A lire avant d'ecrire une scene.
 *
 * Deux regles que le type ne peut pas imposer mais que toute scene doit tenir :
 *
 * - Une scene ne touche JAMAIS `globalCompositeOperation` ni `filter` sans les
 *   restaurer. `resetCompositing(ctx)` en fin de `render()` suffit.
 * - Une scene ne dessine JAMAIS sur le canvas visible. Elle recoit la surface
 *   de scene, qui est un buffer.
 *
 * Les types deja definis ailleurs (`BeatClockState`, `AudioFeatureSet`,
 * `Palette`, `Assets`) sont RE-EXPORTES ici plutot que redefinis : §4.1 veut
 * qu'une scene n'ait qu'un seul import de types, pas qu'on entretienne deux
 * declarations du meme contrat.
 */

import type { BeatClockState } from '../audio/BeatClock';
import type { AudioFeatureSet } from '../audio/AudioFeatures';
import type { EngineState } from '../audio/LiveAnalysisEngine';
import type { OnsetKind } from '../audio/OnsetDetector';
import type { SectionArc, SectionEnergyState } from '../audio/SectionEnergy';
import type { LiveConfig } from '../LiveConfig';
import type { Assets } from '../render/Assets';
import type { PaletteBook } from '../render/Palette';
import type { QualityLevel } from '../render/FrameBudget';

export type { BeatClockState, AudioFeatureSet, EngineState, OnsetKind, SectionArc, SectionEnergyState, QualityLevel };
export type { Palette, PaletteRole } from '../render/Palette';

export type SceneTag = 'calm' | 'intense' | 'neon' | 'organic' | 'geometric' | 'glitch' | 'strobe';

/** Dimensions du BITMAP, pas du CSS. Les scenes n'ont jamais a connaitre le DPR. */
export interface Viewport {
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  /** Petit cote. Unite de reference de toutes les tailles relatives (§3.6). */
  readonly min: number;
}

/** Etat des onsets tel qu'une scene le consomme. */
export interface OnsetSet {
  /** Un onset de ce type est-il tombe pendant cette trame ? */
  fired(kind: OnsetKind): boolean;
  /** Force du dernier onset de ce type, 0-1. */
  strength(kind: OnsetKind): number;
  /**
   * Instant du dernier onset de ce type, sur l'horloge audio. `-Infinity` si
   * aucun. Une scene qui EMET quelque chose par frappe - un anneau, une onde -
   * s'en sert pour ne pas emettre deux fois : pendant une transition, deux
   * scenes rendent la meme trame, et `fired()` y est vrai pour les deux.
   */
  lastTime(kind: OnsetKind): number;
  /**
   * Enveloppe de frappe (§2.7.2). Decroit selon le TEMPS ECOULE depuis
   * l'attaque, jamais selon `beatPhase` - sinon l'enveloppe remonte a 1 sur
   * TOUS les temps, meme sans frappe, et une frappe en contretemps nait deja
   * a moitie attenuee.
   *
   * `decayBeats` est la duree de RETOUR AU REPOS effectif : l'enveloppe vaut
   * exactement 0 au-dela (§2.7.8), elle ne traine pas. Utiliser les constantes
   * `DECAY_*` de `util/accent` plutot que des nombres en dur.
   *
   * `overshoot` (<= 8 %) est reserve aux elements MASSIFS - cf. `impact`.
   */
  envelope(kind: OnsetKind, decayBeats: number, overshoot?: number): number;
}

/**
 * Calques appartenant a une scene. Passer par ici plutot que par
 * `document.createElement('canvas')` n'est pas une preference de style :
 * §3.1 impose un inventaire memoire, et un canvas alloue en douce y echappe.
 * Safari plafonne la memoire canvas GLOBALE ; au-dela, `getContext()` renvoie
 * `null` sans lever.
 */
export interface SceneLayers {
  acquire(key: string, w: number, h: number, opaque: boolean): SceneLayer | null;
  release(key: string): void;
}

export interface SceneLayer {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  /** Source utilisable par `drawImage`. */
  readonly image: CanvasImageSource;
}

/**
 * Notes ANNONCEES tombees pendant cette trame (ADR-015, lot 3). Interface a
 * accesseurs plutot que tableau d'objets, pour la meme raison qu'`OnsetSet` :
 * le tampon est pre-alloue et reutilise, une scene ne provoque aucune
 * allocation en le lisant (docs/10, zero allocation dans la boucle).
 *
 * Rappel de §6.1 : une scene qui se contenterait de DESSINER ces notes serait
 * un piano-roll, donc un analyseur deguise. Elles sont une MATIERE, pas un
 * affichage.
 */
export interface NoteSet {
  /** Combien de notes sont tombees pendant cette trame. */
  readonly count: number;
  /** Hauteur MIDI de la i-eme note (decimale autorisee, doc 12). */
  midi(i: number): number;
  /** Velocite 0-1 de la i-eme note. */
  velocity(i: number): number;
}

/**
 * ANTICIPATION (ADR-012, « l'anticipation ~100 ms est exposee au dispatcher »).
 * L'hote annonce ses frappes au moment ou son scheduler les PLANIFIE, donc
 * avant qu'elles ne sonnent : on connait l'avenir proche, et une scene peut
 * s'y PREPARER — retenue avant impact, charge d'un anneau, inspiration avant
 * le coup.
 *
 * C'est la seule information du canal de verite qu'AUCUNE analyse ne pourra
 * jamais fournir : un detecteur ne connait le passe qu'apres coup.
 */
export interface Anticipation {
  /**
   * Secondes avant l'instant VISUEL de la prochaine frappe ANNONCEE de ce
   * type. `+Infinity` si rien n'est annonce — une scene doit donc toujours
   * savoir se passer de la reponse.
   */
  nextIn(kind: OnsetKind): number;
}

export interface SceneContext {
  /** Surface de SCENE - un buffer, jamais l'ecran. */
  readonly ctx: CanvasRenderingContext2D;
  readonly view: Viewport;
  readonly config: LiveConfig;
  readonly assets: Assets;
  /** PRNG SEEDE fourni par le director. Jamais `Math.random()` : une scene doit etre reproductible. */
  readonly rng: () => number;
  /** Calques propres a la scene, comptabilises dans le plafond memoire. */
  readonly layers: SceneLayers;
}

export interface LiveFrame {
  /** Secondes, deja clampe a [0, 0.05]. */
  readonly dt: number;
  readonly tSec: number;
  readonly view: Viewport;
  readonly state: EngineState;
  readonly beat: BeatClockState;
  readonly features: AudioFeatureSet;
  readonly onsets: OnsetSet;
  readonly energy: SectionEnergyState;
  /** 0-1 (§2.8). AUCUN effet ne se regle directement sur l'audio : tout passe par ici. */
  readonly intensity: number;
  readonly quality: QualityLevel;
  readonly palette: PaletteBook;
  /** `prefers-reduced-motion` actif : amplitudes divisees, aucun stroboscope. */
  readonly reducedMotion: boolean;
  /**
   * Buffer de FEEDBACK de la trame precedente, ou `null` si le feedback est
   * desactive par `FrameBudget`.
   *
   * MUST §3.1 : toute scene qui parle de « la frame precedente » lit CECI,
   * jamais l'ecran. Lire l'ecran melangerait le post, le bloom et le HUD dans
   * la source, et un `drawImage` du canvas sur lui-meme est indefini des que
   * les regions se recouvrent - ce que fait justement `slice-displace`.
   */
  readonly previousFrame: CanvasImageSource | null;
  /**
   * Accent de GRILLE (§2.7.8) : « les temps faibles et contretemps recoivent un
   * accent reduit (30-50 %) plutot qu'aucun ».
   *
   * Pilote par l'horloge, pas par la detection : sur un motif ou seuls les
   * temps 1 et 3 portent un kick, `onsets.envelope('kick', ...)` laisse les
   * temps 2 et 4 a zero et le visuel bat a demi-vitesse. A utiliser comme
   * PLANCHER via `withGridFloor`, jamais comme terme d'une somme - §2.7.7.
   *
   * Lit les phases VISUELLES, donc deja decalees de `syncOffsetMs`.
   */
  readonly gridAccent: (decayBeats: number) => number;
  /**
   * Notes annoncees par l'hote pendant cette trame (ADR-015). OPTIONNEL a
   * dessein : il n'y en a que si le canal de verite est actif ET que l'hote
   * emet des notes (flag `_PMDI_LIVE_NOTES_V1` cote Beat Studio). Une scene
   * qui l'ignore se comporte exactement comme avant ce chantier, et les
   * constructeurs de trame qui ne le fournissent pas (banc de mesure) restent
   * valides sans modification.
   */
  readonly notes?: NoteSet;
  /**
   * Avance d'annonce du canal de verite (ADR-012). OPTIONNEL, comme `notes` :
   * absent sans canal, et une scene qui l'ignore se comporte exactement comme
   * avant. Une scene qui le lit doit rester juste quand il vaut `+Infinity` —
   * c'est le cas nominal sur du son externe.
   */
  readonly anticipation?: Anticipation;
}

export interface LiveScene {
  readonly id: string;
  readonly tags: readonly SceneTag[];
  /** Plage d'intensite ou la scene a du sens (§4.2). */
  readonly intensityRange: readonly [number, number];
  /**
   * Element qui porte le kick de facon NON AMBIGUE (§2.7.6). Doit etre
   * identifiable sur une capture figee. Toutes les autres reactions plafonnent
   * a 40 % de son amplitude.
   */
  readonly primaryAccent: string;

  init(sc: SceneContext): void;
  /** Tire et applique une variante. Appelee a l'entree dans la scene. */
  enter(frame: LiveFrame, variantIndex: number): void;
  resize(view: Viewport): void;
  render(ctx: CanvasRenderingContext2D, frame: LiveFrame): void;
  exit(): void;
  reset(): void;
  dispose(): void;
}
