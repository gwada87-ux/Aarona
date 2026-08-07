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
   * Enveloppe de frappe (§2.7.2). Decroit selon le TEMPS ECOULE depuis
   * l'attaque, jamais selon `beatPhase` - sinon l'enveloppe remonte a 1 sur
   * TOUS les temps, meme sans frappe, et une frappe en contretemps nait deja
   * a moitie attenuee.
   */
  envelope(kind: OnsetKind, decayBeats: number): number;
}

export interface SceneContext {
  /** Surface de SCENE - un buffer, jamais l'ecran. */
  readonly ctx: CanvasRenderingContext2D;
  readonly view: Viewport;
  readonly config: LiveConfig;
  readonly assets: Assets;
  /** PRNG SEEDE fourni par le director. Jamais `Math.random()` : une scene doit etre reproductible. */
  readonly rng: () => number;
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
