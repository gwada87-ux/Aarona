/**
 * Pipeline d'analyse — analysis/AnalysisPipeline (docs/03_DATA_FLOW.md FLUX 1,
 * étapes 0-9). Orchestre : pics de waveform → rééchantillonnage → STFT →
 * features/bandes → onsets par bande → tempo → beats → downbeats →
 * descripteurs d'onsets → contour de basse → confiance de grille.
 *
 * Toujours HORS PÉRIMÈTRE de CE module, par construction (docs/05 §4 : « pas
 * dans le Worker ») : classification des onsets (KICK/SNARE/CLAP/HAT/PERC —
 * dépend des seuils du preset), structure par auto-similarité,
 * macro-événements (DROP/BUILDUP/BREAK/…). Le document PMDI produit ici est
 * donc PARTIEL : `events` ne contient que les SUB_HIT (docs/05 §5, qui ne
 * dépendent d'aucune classification) ; `sections` est absent ;
 * `confidence.classification` et `confidence.structure` valent 0. Complété
 * sur le THREAD PRINCIPAL par `analysis/finalize.ts` (Étape 12/P10), qui
 * appelle `classify.ts`/`structure.ts`/`macro.ts` sur ce document partiel.
 *
 * Prend un signal mono déjà démixé ((L+R)/2) — le démixage est un souci de
 * `audio/`, que `analysis/` n'a pas le droit d'importer (docs/02 tableau des
 * dépendances).
 */
import type { PmdiDocument, MusicEvent, FeatureTrack, NoteEvent } from '../music/pmdi';
import { BAND_IDS, bandBinRanges, bandEnergyTracks, bandFluxTracks, type BandId } from './bands';
import { computeLogSpacedBinRanges, computeSpectrumEnergyTracks, SPECTRUM_BAND_COUNT } from './spectrumBands';
import { extractBassContour } from './bassContour';
import { trackBeats } from './beats';
import { computeFrameFeatureTracks } from './features';
import { computeGridConfidence, computeOnsetDensityNorm } from './gridConfidence';
import { normalizeTrack } from './normalize';
import { detectDownbeat } from './downbeats';
import { computeOnsetDescriptor, type OnsetDescriptor } from './onsetDescriptors';
import { detectBandOnsets, type RawOnset } from './onsets';
import { resample } from './resample';
import { computeGlobalOdfPositive, estimateTempo } from './tempo';
import { spectralFlux, stft, WINDOW_SIZE, HOP, frameTimestamp } from './stft';
import { computeWaveformPeaks, type WaveformPeaks } from './waveformPeaks';

const ANALYSIS_SAMPLE_RATE = 22050;
const PMDI_VERSION = '1.0';
const GENERATOR = 'pulsar-visualizer/analysis@1.0';

export type AnalysisProgressStage =
  | 'waveform'
  | 'resample'
  | 'stft'
  | 'features'
  | 'onsets'
  | 'tempo'
  | 'beats'
  | 'downbeats'
  | 'descriptors'
  | 'bassContour';

export type OnAnalysisProgress = (fraction: number, stage: AnalysisProgressStage) => void;

export interface AnalysisResult {
  readonly pmdi: PmdiDocument;
  readonly waveformPeaks: WaveformPeaks;
}

export interface RunAnalysisPipelineOptions {
  readonly signal: Float32Array | Float64Array; // mono, déjà démixé
  readonly sampleRate: number; // taux d'origine du signal fourni
  readonly onProgress?: OnAnalysisProgress;
}

const STAGES: readonly AnalysisProgressStage[] = [
  'waveform',
  'resample',
  'stft',
  'features',
  'onsets',
  'tempo',
  'beats',
  'downbeats',
  'descriptors',
  'bassContour',
];

function report(onProgress: OnAnalysisProgress | undefined, stage: AnalysisProgressStage): void {
  if (!onProgress) return;
  const idx = STAGES.indexOf(stage);
  onProgress((idx + 1) / STAGES.length, stage);
}

export function runAnalysisPipeline(opts: RunAnalysisPipelineOptions): AnalysisResult {
  const { onProgress } = opts;
  const originalSignal = Float64Array.from(opts.signal);

  // Étape 0 : pics de waveform, sur le signal ORIGINAL (pleine résolution pour l'UI).
  const waveformPeaks = computeWaveformPeaks(originalSignal);
  report(onProgress, 'waveform');

  // Étape 1 : rééchantillonnage vers 22 050 Hz.
  const { signal, groupDelaySec } = resample(originalSignal, opts.sampleRate, ANALYSIS_SAMPLE_RATE);
  const sampleRate = ANALYSIS_SAMPLE_RATE;
  const durationSec = signal.length / sampleRate;
  report(onProgress, 'resample');

  // Étape 2 : STFT.
  const frames = stft(signal, { windowSize: WINDOW_SIZE, hop: HOP });
  const ranges = bandBinRanges(sampleRate, WINDOW_SIZE);
  report(onProgress, 'stft');

  // Étape 3 : features par trame + par bande.
  const frameFeatures = computeFrameFeatureTracks(signal, frames, { windowSize: WINDOW_SIZE, hop: HOP, sampleRate });
  const bandEnergy = bandEnergyTracks(frames, ranges);
  const bandFlux = bandFluxTracks(frames, ranges);
  const fullSpectrumFlux = spectralFlux(frames);
  // Spectre visuel fin (docs/07 §"Spectrum", Étape 25) : 96 bandes log-espacées, calculées ICI
  // pendant que `frames` (le spectrogramme complet) est déjà en mémoire pour bandEnergy/bandFlux —
  // jamais retenu au-delà de cette fonction (voir docs/03 : « libéré au fur et à mesure »).
  const spectrumRanges = computeLogSpacedBinRanges(SPECTRUM_BAND_COUNT, sampleRate, WINDOW_SIZE);
  const spectrumEnergy = computeSpectrumEnergyTracks(frames, spectrumRanges);
  report(onProgress, 'features');

  // Étape 4 : onsets, indépendamment par bande.
  const onsetsByBand: Record<BandId, RawOnset[]> = {} as Record<BandId, RawOnset[]>;
  const allOnsets: RawOnset[] = [];
  for (const band of BAND_IDS) {
    const bandOnsets = detectBandOnsets({
      band,
      range: ranges[band],
      frames,
      rawFlux: bandFlux[band],
      rawSignal: signal,
      sampleRate,
      windowSize: WINDOW_SIZE,
      hop: HOP,
      resamplerGroupDelaySec: groupDelaySec,
    });
    onsetsByBand[band] = bandOnsets;
    allOnsets.push(...bandOnsets);
  }
  allOnsets.sort((a, b) => a.t - b.t);
  report(onProgress, 'onsets');

  // Étape 5 : tempo (+ résolution de l'ambiguïté ×2/÷2).
  const tempo = estimateTempo({
    bandFlux,
    bassEnergyTrack: bandEnergy.bass,
    highOnsetCount: onsetsByBand.high.length,
    sampleRate,
    hop: HOP,
    durationSec,
  });
  report(onProgress, 'tempo');

  // Étape 6 : suivi de beats (programmation dynamique).
  const globalOdfPositive = computeGlobalOdfPositive(bandFlux);
  const beats = trackBeats({
    odf: globalOdfPositive,
    bpm: tempo.bpm,
    tempoConfidence: tempo.confidence,
    sampleRate,
    hop: HOP,
    windowSize: WINDOW_SIZE,
  });
  report(onProgress, 'beats');

  // Étape 7 : downbeats (hypothèse MVP : mesure à 4 temps).
  const beatFrameIndices = beats.map((b) => Math.round((b.t * sampleRate - WINDOW_SIZE / 2) / HOP));
  const downbeat = detectDownbeat({
    beatFrameIndices,
    bassEnergyTrack: normalizeTrack(bandEnergy.bass),
    onsetStrengthTrack: normalizeTrack(globalOdfPositive),
    noveltyTrack: normalizeTrack(fullSpectrumFlux),
  });
  report(onProgress, 'downbeats');

  // Étape 8 : descripteurs d'onsets bruts (PAS de classification — docs/05 §4).
  const framePeakTrack = Float64Array.from(frameFeatures, (f) => f.peak);
  const onsetDescriptors: OnsetDescriptor[] = allOnsets.map((onset) =>
    computeOnsetDescriptor({
      t: onset.t,
      band: onset.band,
      strength: onset.strength,
      onsetFrameIndex: onset.frameIndex,
      frames,
      framePeakTrack,
      bandRanges: ranges,
      sampleRate,
      windowSize: WINDOW_SIZE,
      hop: HOP,
    }),
  );
  report(onProgress, 'descriptors');

  // Étape 9 : contour de basse / 808.
  const bassSegments = extractBassContour(signal, sampleRate);
  report(onProgress, 'bassContour');

  // --- Assemblage du document PMDI (partiel — voir en-tête) ---

  const avgBeatConfidence = beats.length > 0 ? beats.reduce((s, b) => s + b.confidence, 0) / beats.length : 0;
  const onsetDensityNorm = computeOnsetDensityNorm(allOnsets.length, durationSec);
  const gridConfidence = computeGridConfidence(tempo.confidence, avgBeatConfidence, onsetDensityNorm);

  const downbeatTimes = beats.filter((_, i) => i % 4 === downbeat.phase).map((b) => b.t);

  const subHitEvents: MusicEvent[] = bassSegments.map((seg) => ({
    t: seg.t,
    type: 'SUB_HIT',
    intensity: Math.max(0, Math.min(1, seg.confidence)),
    confidence: seg.confidence,
    dur: seg.dur,
    meta: { midi: seg.midi },
  }));
  subHitEvents.sort((a, b) => a.t - b.t);

  const notes: NoteEvent[] = bassSegments.map((seg) => ({
    t: seg.t,
    dur: seg.dur,
    midi: seg.midi,
    velocity: Math.max(0, Math.min(1, seg.confidence)), // approximation Mode A — docs/12 l.193
    confidence: seg.confidence,
  }));

  const featureHz = sampleRate / HOP; // FLOTTANT, jamais arrondi (docs/03 l.256-266)
  const featureT0 = frameTimestamp(0, { sampleRate, windowSize: WINDOW_SIZE, hop: HOP });
  const toFeatureTrack = (id: string, data: Float64Array | Float32Array): FeatureTrack => ({
    id,
    hz: featureHz,
    t0: featureT0,
    data: Array.from(data),
  });

  const features: FeatureTrack[] = [
    toFeatureTrack('energy', normalizeTrack(Float64Array.from(frameFeatures, (f) => f.energy))),
    toFeatureTrack('rms', normalizeTrack(Float64Array.from(frameFeatures, (f) => f.rms))),
    toFeatureTrack('centroid', normalizeTrack(Float64Array.from(frameFeatures, (f) => f.centroid))),
    toFeatureTrack('flatness', Float64Array.from(frameFeatures, (f) => f.flatness)), // déjà 0..1
    toFeatureTrack('rolloff85', normalizeTrack(Float64Array.from(frameFeatures, (f) => f.rolloff85))),
    ...BAND_IDS.map((band) => toFeatureTrack(`band.${band}`, normalizeTrack(bandEnergy[band]))),
    ...spectrumEnergy.map((track, i) => toFeatureTrack(`spectrum.${i}`, normalizeTrack(track))),
  ];

  // RMS en dBFS BRUT (non normalisé par percentile) — nécessaire à SILENCE (docs/05 §7 : seuil
  // absolu −45dBFS). Volontairement PAS dans `features[]` : ce tableau est normalisé par
  // convention (docs/04, "aucune normalisation par valeur absolue" — vrai pour les signaux
  // continus qui pilotent le visuel, faux pour la détection de silence, qui a besoin d'un niveau
  // absolu). Conservé dans `ext` pour ne pas induire en erreur un consommateur de `features[]`.
  const RMS_FLOOR_DB = -90;
  const rawRmsDb = Float64Array.from(frameFeatures, (f) => (f.rms > 0 ? 20 * Math.log10(f.rms) : RMS_FLOOR_DB));

  const pmdi: PmdiDocument = {
    pmdi: PMDI_VERSION,
    source: { kind: 'analysis', generator: GENERATOR, createdAt: new Date().toISOString() },
    audio: { duration: durationSec, sampleRate, channels: 1 },
    tempo: { global: tempo.bpm, confidence: tempo.confidence, map: [{ t: 0, bpm: tempo.bpm }], ...(tempo.alternate !== undefined ? { alternate: tempo.alternate } : {}) },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    grid: { beats: beats.map((b) => b.t), downbeats: downbeatTimes },
    events: subHitEvents,
    features,
    notes,
    confidence: { tempo: tempo.confidence, grid: gridConfidence, classification: 0, structure: 0 },
    ext: { onsetDescriptors, rawRmsDb: { hz: featureHz, t0: featureT0, data: Array.from(rawRmsDb) } },
  };

  return { pmdi, waveformPeaks };
}
