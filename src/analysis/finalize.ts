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

  // docs/06_EVENT_SYSTEM.md §"Grille rythmique" : DOWNBEAT fait partie du vocabulaire général
  // (pas "Mode B uniquement"), mais `grid.downbeats` (AnalysisPipeline.ts) n'était jusqu'ici
  // jamais converti en MusicEvent — PulseRings.ts, seul consommateur réel, n'avait donc jamais
  // d'anneau secondaire sur un morceau auto-analysé (Mode A). `confidence` reprend celle, déjà
  // calculée, de la détection de grille — pas une valeur figée.
  const downbeatEvents: MusicEvent[] = downbeatTimes.map((t, i) => ({
    t,
    type: 'DOWNBEAT',
    intensity: 1,
    confidence: partial.confidence.grid,
    meta: { barIndex: i },
  }));

  const events: MusicEvent[] = [...partial.events, ...downbeatEvents, ...classifiedEvents, ...macroEvents].sort((a, b) => a.t - b.t);

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
