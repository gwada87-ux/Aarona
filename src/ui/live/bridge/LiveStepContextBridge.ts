/**
 * Pont StepContext — mode direct, moteur fichier (chantier « panneau
 * Style/Preset/Palette/Texte/Macros réellement fonctionnel en direct »).
 *
 * Construit un `StepContext` par IMAGE (pas de sous-pas fixe à 120 Hz comme
 * en mode fichier — `dt` = delta réel de la frame, comme le fait déjà le
 * mode direct actuel), à partir de l'état courant de `LiveAnalysisEngine`.
 *
 * Sur les 12 champs de `StepContext`, un seul — `section` — n'a AUCUN
 * équivalent causal ici : toujours `null` (voir le plan, section « ce qui
 * rend ce chantier possible »). Les événements DROP/BUILDUP/BREAK/SILENCE
 * sont une approximation construite depuis `SectionEnergy` (voir
 * `LiveEventBridge`), pas une reproduction de `analysis/macro.ts`.
 *
 * `regime`, à la différence du mode fichier, n'est PAS figé à la
 * construction : recalculé chaque frame depuis `tempo.confidence`, parce que
 * cette confiance peut réellement dériver sur une session de plusieurs
 * heures, contrairement à un fichier déjà analysé en entier.
 */

import { createMulberry32, type Rng } from '../../../core/rng/mulberry32';
import { BAND_IDS, SPECTRUM_BAND_COUNT, type BandId, type Regime, type StepContext } from '../../../music/StepContext';
import type { FeatureId, GlobalConfidence, MusicTimeline } from '../../../music/MusicTimeline';
import type { EventType, MusicEvent, Section } from '../../../music/pmdi';
import { BAND_RANGES_HZ } from '../../../analysis/bands';
import type { LiveAnalysisEngine } from '../audio/LiveAnalysisEngine';
import { LiveEventBridge } from './LiveEventBridge';

/** Identique à `music/StepContext.ts::REGIME_THRESHOLD` — dupliqué pour la même raison que `BAND_IDS` : une constante privée d'un autre module ne se réimporte pas pour un simple seuil. */
const REGIME_THRESHOLD = 0.6;

/** Aucune mesure composée nulle part dans ce dépôt (`MusicTimeline.ts`, commentaire de `cumulativeBars`) — 4/4 partout, mode direct comme mode fichier. */
const BEATS_PER_BAR = 4;

/**
 * Pour chaque bande fichier (`sub`/`bass`/.../`high`), les index du tableau
 * `bandsNorm` (32 bandes log 40 Hz-18 kHz, `LiveConfig.audio`) dont le centre
 * tombe dans sa plage Hz (`analysis/bands.ts::BAND_RANGES_HZ`). Une bande
 * trop étroite pour couvrir un bin entier (`sub`, 20-60 Hz, contre un plancher
 * suivi à 40 Hz) prend le bin le plus proche de son centre géométrique plutôt
 * que de valoir zéro.
 */
function buildBandIndexMap(bandCount: number, minHz: number, maxHz: number): Record<BandId, readonly number[]> {
  const logMin = Math.log(minHz);
  const logMax = Math.log(maxHz);
  const centers: number[] = [];
  for (let i = 0; i < bandCount; i++) centers.push(Math.exp(logMin + ((logMax - logMin) * (i + 0.5)) / bandCount));

  const map = {} as Record<BandId, readonly number[]>;
  for (const id of BAND_IDS) {
    const [lo, hi] = BAND_RANGES_HZ[id];
    const indices: number[] = [];
    for (let i = 0; i < centers.length; i++) {
      if (centers[i]! >= lo && centers[i]! < hi) indices.push(i);
    }
    if (indices.length === 0) {
      const target = Math.sqrt(lo * hi);
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const d = Math.abs(centers[i]! - target);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      indices.push(best);
    }
    map[id] = indices;
  }
  return map;
}

function average(values: Float32Array, indices: readonly number[]): number {
  if (indices.length === 0) return 0;
  let sum = 0;
  for (const i of indices) sum += values[i] ?? 0;
  return sum / indices.length;
}

/**
 * Implémentation minimale de `MusicTimeline` pour le direct. `t` est ignoré
 * par la plupart des méthodes de lecture instantanée (`featureAt`, `tempoAt`,
 * ...) : en direct il n'existe qu'un seul instant, « maintenant ». Exception
 * : `barIndexAt`/`barPhaseAt`/`beatIndexAt`/`beatPhaseAt` DOIVENT rester
 * correctes pour un `t` PASSÉ récent — `VisualDirector` les appelle avec des
 * horodatages de drop pour calculer « mesures depuis le drop » — donc
 * extrapolées en arrière depuis la position courante au tempo courant
 * (approximation honnête : le tempo ne bouge pas assez sur quelques mesures
 * pour que ça se voie).
 */
class LiveMusicTimeline implements MusicTimeline {
  readonly duration = Infinity;

  constructor(
    private readonly engine: LiveAnalysisEngine,
    private readonly events: LiveEventBridge,
    private readonly bandIndexMap: Record<BandId, readonly number[]>,
  ) {}

  get confidence(): GlobalConfidence {
    return {
      tempo: this.engine.tempo.confidence,
      grid: this.engine.effectiveConfidence,
      classification: 1, // les onsets kick/snare/hat sont déjà classés de façon définitive, pas de score séparé en direct
      structure: 0, // aucune détection de structure en direct (voir `sectionAt`)
    };
  }

  eventsBetween(t0: number, t1: number): readonly MusicEvent[] {
    return this.events.eventsBetween(t0, t1);
  }

  eventsOfTypeBetween(type: EventType, t0: number, t1: number): readonly MusicEvent[] {
    return this.events.eventsOfTypeBetween(type, t0, t1);
  }

  nextEventOfType(): MusicEvent | null {
    return null; // l'avenir n'est pas connu en direct
  }

  prevEventOfType(type: EventType, t: number): MusicEvent | null {
    return this.events.prevEventOfType(type, t);
  }

  timeToNext(): number {
    return Infinity;
  }

  featureAt(t: number, id: FeatureId): number {
    if (id === 'energy') return this.engine.features.rmsNorm;
    if (id.startsWith('band.')) {
      const bandId = id.slice('band.'.length) as BandId;
      const indices = this.bandIndexMap[bandId];
      return indices ? average(this.engine.features.bandsNorm, indices) : 0;
    }
    if (id.startsWith('spectrum.')) {
      const i = Number(id.slice('spectrum.'.length));
      const live = this.engine.features.bandsNorm;
      // Ré-échantillonnage log grossier du tableau 32 bandes vers l'index fin demandé
      // (0..95) -- approximation visuelle assumée (voir plan), seul le style Spectrum
      // Pro lit `spectrum.*`.
      const frac = Number.isFinite(i) ? Math.min(1, Math.max(0, i / (SPECTRUM_BAND_COUNT - 1))) : 0;
      const liveIdx = Math.min(live.length - 1, Math.round(frac * (live.length - 1)));
      return live[liveIdx] ?? 0;
    }
    return 0;
  }

  featureSlope(t: number, id: FeatureId, window: number): number {
    // Pas d'historique de features en direct au-delà de l'instant courant --
    // approximation à zéro (aucune couche du mode fichier examinée n'en dépend
    // pour un rendu correct, voir le plan).
    return 0;
  }

  tempoAt(): number {
    return this.engine.beat.bpm || 120;
  }

  private barPosAt(t: number): number {
    const bpm = this.engine.beat.bpm || 120;
    const barsPerSec = bpm / 60 / BEATS_PER_BAR;
    const nowBar = this.engine.beat.barIndex + this.engine.beat.visualBarPhase;
    return nowBar - (this.engine.tSec - t) * barsPerSec;
  }

  private beatPosAt(t: number): number {
    const bpm = this.engine.beat.bpm || 120;
    const beatsPerSec = bpm / 60;
    const nowBeat = this.engine.beat.beatIndex + this.engine.beat.visualBeatPhase;
    return nowBeat - (this.engine.tSec - t) * beatsPerSec;
  }

  beatPhaseAt(t: number): number {
    const b = this.beatPosAt(t);
    return b - Math.floor(b);
  }

  barPhaseAt(t: number): number {
    const b = this.barPosAt(t);
    return b - Math.floor(b);
  }

  beatIndexAt(t: number): number {
    return Math.floor(this.beatPosAt(t));
  }

  barIndexAt(t: number): number {
    return Math.floor(this.barPosAt(t));
  }

  sectionAt(): Section | null {
    return null; // pas de structure connue en direct
  }

  sections(): readonly Section[] {
    return [];
  }
}

let stepCounter = 0;

export class LiveStepContextBridge {
  readonly timeline: MusicTimeline;
  private readonly eventBridge = new LiveEventBridge();
  private readonly rng: Rng = createMulberry32((Math.random() * 0xffffffff) >>> 0);
  private readonly bandIndexMap: Record<BandId, readonly number[]>;

  constructor(private readonly engine: LiveAnalysisEngine) {
    // 32/40/18000 : mêmes valeurs que `LiveConfig.audio.bandCount`/`bandMinHz`/`bandMaxHz`
    // par défaut (`LiveConfig.ts`) -- `engine.config` est privé, non lu ici.
    this.bandIndexMap = buildBandIndexMap(32, 40, 18000);
    this.timeline = new LiveMusicTimeline(engine, this.eventBridge, this.bandIndexMap);
  }

  /** À appeler une fois par frame de rendu en direct. */
  build(dt: number): StepContext {
    const t = this.engine.tSec;
    const fired = this.eventBridge.collect(this.engine);

    const bands = {} as Record<BandId, number>;
    for (const id of BAND_IDS) bands[id] = average(this.engine.features.bandsNorm, this.bandIndexMap[id]);

    const spectrum = new Float32Array(SPECTRUM_BAND_COUNT);
    const live = this.engine.features.bandsNorm;
    for (let i = 0; i < SPECTRUM_BAND_COUNT; i++) {
      const frac = i / (SPECTRUM_BAND_COUNT - 1);
      const liveIdx = Math.min(live.length - 1, Math.round(frac * (live.length - 1)));
      spectrum[i] = live[liveIdx] ?? 0;
    }

    const regime: Regime = this.engine.effectiveConfidence >= REGIME_THRESHOLD ? 'event' : 'continuous';

    return Object.freeze({
      t,
      dt,
      stepIndex: stepCounter++,
      fired,
      bands: Object.freeze(bands),
      spectrum,
      energy: this.engine.features.rmsNorm,
      beat: Object.freeze({
        phase: this.engine.beat.visualBeatPhase,
        index: this.engine.beat.beatIndex,
        confidence: this.engine.effectiveConfidence,
      }),
      bar: Object.freeze({
        phase: this.engine.beat.visualBarPhase,
        index: this.engine.beat.barIndex,
      }),
      section: null,
      regime,
      rng: this.rng,
      timeline: this.timeline,
    });
  }

  reset(): void {
    this.eventBridge.reset();
  }
}
