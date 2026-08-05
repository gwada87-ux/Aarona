/**
 * Pipeline d'import réel (Étape 14/P12) — le chemin complet que P4/P10/P11
 * ont chacun livré et testé isolément, jamais connecté bout à bout avant
 * cette étape (docs/02_ARCHITECTURE.md, Mode A) :
 *
 *   AudioBuffer décodé → démixage mono → Worker d'analyse → finalizePmdi
 *   → suggestion de preset → MusicTimeline
 *
 * `analyze` est injectable (défaut : `analyzeInWorker`) pour rester testable
 * sans `Worker` réel (indisponible en environnement Node/Vitest — même
 * limite que `worker.ts`/`AudioEngine.ts`).
 */
import { downmixToMono } from '../audio/downmix';
import { analyzeInWorker } from '../analysis/analyzeInWorker';
import type { AnalysisProgressStage, AnalysisResult } from '../analysis/AnalysisPipeline';
import type { ClassificationThresholds } from '../analysis/classify';
import { finalizePmdi } from '../analysis/finalize';
import type { WaveformPeaks } from '../analysis/waveformPeaks';
import { buildMusicTimeline, type MusicTimeline } from '../music/MusicTimeline';
import type { PmdiDocument } from '../music/pmdi';
import { PRESET_CATALOG, suggestPreset, type SuggestResult } from '../presets/index';

export interface AnalyzeFnOptions {
  readonly signal: Float32Array;
  readonly sampleRate: number;
  readonly onProgress?: (fraction: number, stage: AnalysisProgressStage) => void;
}

export type AnalyzeFn = (options: AnalyzeFnOptions) => Promise<AnalysisResult>;

export interface ImportedTrack {
  readonly doc: PmdiDocument;
  readonly timeline: MusicTimeline;
  readonly waveformPeaks: WaveformPeaks;
  /** `null` seulement si `PRESET_CATALOG` est vide — n'arrive jamais en pratique (5 presets livrés en P11). */
  readonly suggestion: SuggestResult | null;
}

export interface ImportTrackOptions {
  readonly audioBuffer: AudioBuffer;
  /** Remplacement pour les tests — le défaut lance un vrai Worker. */
  readonly analyze?: AnalyzeFn;
  readonly onProgress?: (fraction: number, stage: AnalysisProgressStage) => void;
  readonly classification?: ClassificationThresholds;
  readonly abortSignal?: AbortSignal;
}

export async function importTrack(options: ImportTrackOptions): Promise<ImportedTrack> {
  const mono = downmixToMono(options.audioBuffer);
  const analyze: AnalyzeFn =
    options.analyze ?? ((opts) => analyzeInWorker({ ...opts, abortSignal: options.abortSignal }));

  const result = await analyze({
    signal: mono,
    sampleRate: options.audioBuffer.sampleRate,
    onProgress: options.onProgress,
  });

  const doc = finalizePmdi(result.pmdi, options.classification ? { classification: options.classification } : {});
  const suggestion = suggestPreset(doc, PRESET_CATALOG);
  const timeline = buildMusicTimeline(doc);

  return { doc, timeline, waveformPeaks: result.waveformPeaks, suggestion };
}
