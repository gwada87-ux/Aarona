/**
 * Finalisation du PMDI — analysis/finalize (docs/05_MUSIC_INTELLIGENCE.md
 * §4, §6, §7 ; docs/00a_ORDRE_DES_ETAPES.md Étape 12/P10). Orchestrateur
 * THREAD PRINCIPAL (jamais le Worker, voir AnalysisPipeline.ts) : prend le
 * document PARTIEL produit par `runAnalysisPipeline` et le complète —
 * classification des onsets, structure, macro-événements.
 *
 * Ordre imposé : classify() AVANT macro(), parce que BREAK a besoin des
 * événements KICK déjà typés (« absence de kick », docs/05 §7).
 */
import { BAND_IDS, type BandId } from './bands';
import { classifyOnsets, DEFAULT_CLASSIFICATION_THRESHOLDS, type ClassificationThresholds } from './classify';
import { detectSections, type StructureFeatureTrack } from './structure';
import { detectMacroEvents } from './macro';
import type { SampledTrack } from './trackSampling';
import type { FeatureTrack, MusicEvent, OnsetDescriptor, PmdiDocument } from '../music/pmdi';

export interface FinalizePmdiOptions {
  readonly classification?: ClassificationThresholds;
}

function findFeatureTrack(doc: PmdiDocument, id: string): FeatureTrack | undefined {
  return doc.features?.find((f) => f.id === id);
}

function toSampledTrack(track: FeatureTrack | undefined): SampledTrack {
  return track ? { hz: track.hz, t0: track.t0, data: track.data } : { hz: 1, t0: 0, data: [] };
}

function sumTracks(a: SampledTrack, b: SampledTrack): SampledTrack {
  const hz = a.hz;
  const t0 = a.t0;
  const length = Math.min(a.data.length, b.data.length);
  const data = new Float64Array(length);
  for (let i = 0; i < length; i++) data[i] = (a.data[i] ?? 0) + (b.data[i] ?? 0);
  return { hz, t0, data };
}

/**
 * `meta.indexInBar` (docs/06) : position (0..3, hypothèse MVP mesure à 4 temps déjà posée par
 * AnalysisPipeline.ts) de chaque beat par rapport au PREMIER downbeat de la piste — pas un simple
 * `i % 4`, qui suppose à tort que le beat 0 est toujours un downbeat (`AnalysisPipeline.ts` calcule
 * `downbeat.phase` dans [0,3], jamais persisté dans le PMDI). `downbeatTimes[0]` est TOUJOURS un
 * élément exact de `beatTimes` par construction (`downbeatTimes = beats.filter(i % 4 === phase)`),
 * d'où la comparaison par égalité stricte. Sans downbeat détecté (piste très courte/silencieuse),
 * repli sur la phase 0 — la seule hypothèse possible faute d'ancrage.
 */
function computeIndexInBar(beatTimes: readonly number[], downbeatTimes: readonly number[]): number[] {
  const phase = downbeatTimes.length > 0 ? beatTimes.indexOf(downbeatTimes[0]!) : -1;
  const basePhase = phase >= 0 ? phase : 0;
  return beatTimes.map((_, i) => (((i - basePhase) % 4) + 4) % 4);
}

/**
 * Complète un document PMDI partiel. Fonction PURE : ne mute pas `partial`,
 * retourne un nouveau document. Sans `ext.onsetDescriptors` (document trop
 * ancien, ou déjà Mode B), la classification est simplement vide — tolérance
 * à l'inconnu (principe #3), pas une erreur.
 */
export function finalizePmdi(partial: PmdiDocument, options: FinalizePmdiOptions = {}): PmdiDocument {
  const thresholds = options.classification ?? DEFAULT_CLASSIFICATION_THRESHOLDS;

  const ext = (partial.ext ?? {}) as { onsetDescriptors?: OnsetDescriptor[]; rawRmsDb?: SampledTrack };
  const onsetDescriptors = ext.onsetDescriptors ?? [];

  const classifiedEvents = classifyOnsets(onsetDescriptors, thresholds);
  const kickTimes = classifiedEvents.filter((e) => e.type === 'KICK').map((e) => e.t);
  const highOnsetTimes = onsetDescriptors.filter((d) => d.band === 'high').map((d) => d.t);

  const bandTracks = {} as Record<BandId, StructureFeatureTrack>;
  for (const band of BAND_IDS) bandTracks[band] = toSampledTrack(findFeatureTrack(partial, `band.${band}`));

  const energyTrack = toSampledTrack(findFeatureTrack(partial, 'energy'));
  const centroidTrack = toSampledTrack(findFeatureTrack(partial, 'centroid'));
  const flatnessTrack = toSampledTrack(findFeatureTrack(partial, 'flatness'));
  const bassEnergyTrack = sumTracks(bandTracks.sub, bandTracks.bass);
  const rawRmsDbTrack: SampledTrack = ext.rawRmsDb ?? { hz: energyTrack.hz, t0: energyTrack.t0, data: [] };

  const beatTimes = partial.grid?.beats ?? [];
  const downbeatTimes = partial.grid?.downbeats ?? [];

  const sections = detectSections({
    duration: partial.audio.duration,
    beatTimes,
    downbeatTimes,
    bandTracks,
    centroidTrack,
    flatnessTrack,
    energyTrack,
    onsetTimes: onsetDescriptors.map((d) => d.t),
  });

  const macroEvents = detectMacroEvents({
    duration: partial.audio.duration,
    downbeatTimes,
    barEnergyTrack: energyTrack,
    bassEnergyTrack,
    highOnsetTimes,
    centroidTrack,
    kickTimes,
    rawRmsDbTrack,
  });

  // docs/06_EVENT_SYSTEM.md §"Grille rythmique" : BEAT/DOWNBEAT/BAR/PHRASE font partie du
  // vocabulaire GÉNÉRAL (pas "Mode B uniquement"), mais `grid.beats`/`grid.downbeats`
  // (AnalysisPipeline.ts) n'étaient jusqu'ici jamais convertis en MusicEvent — PulseRings.ts, seul
  // consommateur réel (DOWNBEAT), n'avait donc jamais d'anneau secondaire sur un morceau
  // auto-analysé (Mode A ; corrigé Étape 44). `confidence` reprend partout celle, déjà calculée,
  // de la détection de grille — jamais une valeur figée.
  const indexInBar = computeIndexInBar(beatTimes, downbeatTimes);
  const beatEvents: MusicEvent[] = beatTimes.map((t, i) => ({
    t,
    type: 'BEAT',
    intensity: 1,
    confidence: partial.confidence.grid,
    meta: { indexInBar: indexInBar[i]! },
  }));

  const downbeatEvents: MusicEvent[] = downbeatTimes.map((t, i) => ({
    t,
    type: 'DOWNBEAT',
    intensity: 1,
    confidence: partial.confidence.grid,
    meta: { barIndex: i },
  }));

  // BAR ("début de mesure") et DOWNBEAT ("premier temps de la mesure") coïncident dans l'hypothèse
  // MVP à 4 temps de ce projet — il n'existe qu'un seul modèle métrique, pas de distinction
  // rythme/perception à faire ici. Pas de payload documenté (docs/06), donc pas de `meta`.
  const barEvents: MusicEvent[] = downbeatTimes.map((t) => ({
    t,
    type: 'BAR',
    intensity: 1,
    confidence: partial.confidence.grid,
  }));

  // PHRASE ("début de phrase, 4 ou 8 mesures") : aucun signal de structure phrastique n'existe
  // dans ce pipeline (`structure.ts` détecte des SECTIONS par énergie, un concept différent, pas
  // aligné sur des multiples de mesures). Hypothèse MVP explicite, au même titre que la mesure à 4
  // temps : une phrase toutes les 4 mesures, `meta.bars` reflète ce choix plutôt que de le taire.
  const PHRASE_BARS = 4;
  const phraseEvents: MusicEvent[] = downbeatTimes
    .filter((_, i) => i % PHRASE_BARS === 0)
    .map((t) => ({
      t,
      type: 'PHRASE',
      intensity: 1,
      confidence: partial.confidence.grid,
      meta: { bars: PHRASE_BARS },
    }));

  const events: MusicEvent[] = [
    ...partial.events,
    ...beatEvents,
    ...downbeatEvents,
    ...barEvents,
    ...phraseEvents,
    ...classifiedEvents,
    ...macroEvents,
  ].sort((a, b) => a.t - b.t);

  const classificationConfidence = classifiedEvents.length > 0 ? average(classifiedEvents.map((e) => e.confidence)) : 0;
  const structureConfidence = sections.length > 0 ? average(sections.map((s) => s.confidence)) : 0;

  return {
    ...partial,
    events,
    sections,
    confidence: {
      ...partial.confidence,
      classification: classificationConfidence,
      structure: structureConfidence,
    },
  };
}

function average(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
