/**
 * StepContext — état musical immuable à un pas de simulation
 * (docs/02_ARCHITECTURE.md §3). Construit une fois PAR SOUS-PAS (1/120 s),
 * jamais par image — voir l'avertissement du document cité, repris ici pour
 * mémoire : appliquer les événements par image plutôt que par sous-pas
 * introduit jusqu'à 33 ms d'erreur à 30 fps et romprait l'égalité
 * preview 60 fps ≡ export 30 fps.
 */

import { hash } from '../core/rng/hash';
import { createMulberry32, type Rng } from '../core/rng/mulberry32';
import { FIXED_DT } from '../core/time/FixedStep';
import { EventDispatcher } from './EventDispatcher';
import type { MusicTimeline } from './MusicTimeline';
import type { MusicEvent, Section } from './pmdi';

/**
 * Dupliqué depuis `analysis/bands.ts` : `music/` n'a pas le droit d'importer
 * `analysis/` (docs/02_ARCHITECTURE.md, tableau de dépendances). Les deux
 * listes doivent rester synchronisées manuellement si les bandes changent —
 * improbable, elles suivent une répartition Trap/Drill/House figée.
 */
export const BAND_IDS = ['sub', 'bass', 'lowmid', 'mid', 'himid', 'high'] as const;
export type BandId = (typeof BAND_IDS)[number];

/**
 * Dupliqué depuis `analysis/spectrumBands.ts::SPECTRUM_BAND_COUNT` — même
 * raison que `BAND_IDS` ci-dessus (`music/` ne peut pas importer `analysis/`).
 * Résolution MAXIMALE du spectre visuel fin (docs/07 §"Spectrum", Étape 25) ;
 * le regroupement en moins de bandes selon le niveau de qualité se fait côté
 * `visual/` (`spectrumGrouping.ts`), pas ici.
 */
export const SPECTRUM_BAND_COUNT = 96;

export type Regime = 'event' | 'continuous';

/** Seuil de bascule de régime, docs/05_MUSIC_INTELLIGENCE.md §8 (identique à analysis/gridConfidence.ts). */
const REGIME_THRESHOLD = 0.6;

export interface StepContext {
  readonly t: number;
  readonly dt: number;
  readonly stepIndex: number;
  readonly fired: readonly MusicEvent[];
  readonly bands: Readonly<Record<BandId, number>>;
  /** Spectre visuel fin, résolution MAX (`SPECTRUM_BAND_COUNT` valeurs) — voir `spectrumGrouping.ts` côté `visual/` pour le regroupement en moins de bandes. */
  readonly spectrum: Float32Array;
  readonly energy: number;
  readonly beat: { readonly phase: number; readonly index: number; readonly confidence: number };
  readonly bar: { readonly phase: number; readonly index: number };
  readonly section: Section | null;
  readonly regime: Regime;
  readonly rng: Rng;
  readonly timeline: MusicTimeline;
}

/**
 * Construit des `StepContext` successifs pour une `MusicTimeline` donnée.
 * Possède l'état qu'un `StepContext` individuel ne peut pas porter :
 * l'`EventDispatcher` (fenêtre `tPrev`) et l'unique instance de `Rng`
 * reseedée à chaque pas — jamais recréée, voir docs/02 §StepContext, tableau
 * des trois erreurs de graine à éviter.
 *
 * `regime` : `PmdiDocument.confidence.grid` est un scalaire GLOBAL au
 * morceau (analysis/gridConfidence.ts l'agrège sur toute la durée), pas une
 * valeur qui varie dans le temps. Le lissage « sur 2 secondes » mentionné en
 * commentaire de ce module d'analyse suppose donc un signal instantané qui
 * n'existe pas encore dans le contrat PMDI actuel — l'ajouter ici serait du
 * code d'hystérésis mort, jamais exécutable puisque son entrée ne change
 * jamais pendant une lecture. `regime` est donc figé une fois pour toutes à
 * la construction du builder. Voir LIMITES CONNUES.
 */
export class StepContextBuilder {
  private readonly dispatcher: EventDispatcher;
  private readonly rng: Rng = createMulberry32(0);
  private readonly regime: Regime;

  constructor(
    private readonly timeline: MusicTimeline,
    private readonly projectSeed: number,
  ) {
    this.dispatcher = new EventDispatcher(timeline);
    this.regime = timeline.confidence.grid >= REGIME_THRESHOLD ? 'event' : 'continuous';
  }

  build(t: number): StepContext {
    const stepIndex = Math.round(t * 120);
    this.rng.reseed(hash(this.projectSeed, stepIndex));
    const fired = this.dispatcher.collect(t);

    const bands = {} as Record<BandId, number>;
    for (const id of BAND_IDS) bands[id] = this.timeline.featureAt(t, `band.${id}`);

    // Toujours calculé, même si le style courant ne consomme pas le spectre fin — même convention
    // que `bands`/`energy` ci-dessus (StepContext est un instantané générique, pas spécifique à un
    // style). Coût négligeable : `featureAt` est une recherche binaire + lerp, pas une FFT en direct.
    const spectrum = new Float32Array(SPECTRUM_BAND_COUNT);
    for (let i = 0; i < SPECTRUM_BAND_COUNT; i++) spectrum[i] = this.timeline.featureAt(t, `spectrum.${i}`);

    return Object.freeze({
      t,
      dt: FIXED_DT,
      stepIndex,
      fired,
      bands: Object.freeze(bands),
      // PAS de Object.freeze() sur un TypedArray non vide : lève TypeError
      // (« Cannot freeze array buffer views with elements ») — piège JS connu,
      // les éléments indexés d'un TypedArray ne peuvent pas devenir non-inscriptibles
      // individuellement. Convention déjà en vigueur ailleurs dans ce backend
      // (`Float32Array` de `strokePath`/`fillPath` etc.) : jamais frozen non plus.
      spectrum,
      energy: this.timeline.featureAt(t, 'energy'),
      beat: Object.freeze({
        phase: this.timeline.beatPhaseAt(t),
        index: this.timeline.beatIndexAt(t),
        confidence: this.timeline.confidence.grid,
      }),
      bar: Object.freeze({
        phase: this.timeline.barPhaseAt(t),
        index: this.timeline.barIndexAt(t),
      }),
      section: this.timeline.sectionAt(t),
      regime: this.regime,
      rng: this.rng,
      timeline: this.timeline,
    });
  }
}
