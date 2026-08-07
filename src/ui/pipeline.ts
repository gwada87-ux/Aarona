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
import { PRESET_CATALOG, resolvePreset, suggestPreset, type SuggestResult } from '../presets/index';

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

/**
 * Seuils du preset suggéré, ou `undefined` s'il n'y a rien à faire.
 *
 * `resolvePreset` fusionne les surcharges sur les défauts ; un preset qui ne
 * déclare aucun bloc `classification` rendrait donc les défauts, et refaire la
 * passe serait du travail pur perdu. On ne la refait que si le preset a
 * réellement quelque chose à dire.
 */
function classificationDuPreset(suggestion: SuggestResult | null): ClassificationThresholds | undefined {
  if (!suggestion?.preset.classification) return undefined;
  return resolvePreset(suggestion.preset).classification;
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

  // Première passe : seuils par défaut, ou ceux imposés par l'appelant.
  const premier = finalizePmdi(result.pmdi, options.classification ? { classification: options.classification } : {});
  const suggestion = suggestPreset(premier, PRESET_CATALOG);

  // SECONDE PASSE avec les seuils du preset suggéré (docs/05 §"Calibration par
  // genre" : « surchargeables par preset »).
  //
  // ## Le défaut que ceci corrige
  //
  // Huit presets sur onze déclarent un bloc `classification`, et il ne servait
  // À RIEN. `App.ts` n'a jamais passé `classification` à `importTrack`, donc
  // `finalizePmdi` retombait toujours sur `DEFAULT_CLASSIFICATION_THRESHOLDS`.
  // Mesuré : sur cinq onsets synthétiques, les seuils de `drill`, `techno`,
  // `dubstep` et `trap-dark` font basculer jusqu'à trois classifications sur
  // cinq — le mécanisme fonctionne, il n'était simplement jamais alimenté.
  //
  // ## Pourquoi ici et pas dans `App.ts`
  //
  // C'est un problème de l'oeuf et de la poule : on ne sait quel preset
  // proposer qu'APRÈS avoir analysé, et il faut avoir classé pour analyser.
  // Le résoudre dans l'interface obligerait chaque appelant à connaître cette
  // subtilité. Ici, `importTrack` rend un document déjà cohérent avec la
  // suggestion qu'il rend.
  //
  // ## Le coût
  //
  // `finalizePmdi` est PUR et travaille sur `ext.onsetDescriptors` déjà
  // calculés : ni FFT, ni Worker, ni relecture de l'audio. MESURÉ à
  // **0,58 ms** sur 3000 onsets (moyenne de 20 passes après chauffe), contre
  // plusieurs secondes pour l'analyse elle-même. Le doublement du travail de
  // finalisation est invisible à côté.
  //
  // Sauté quand l'appelant a imposé ses seuils (il sait ce qu'il veut) et
  // quand le preset suggéré n'en déclare aucun.
  const seuilsSuggeres = options.classification ? undefined : classificationDuPreset(suggestion);
  const doc = seuilsSuggeres ? finalizePmdi(result.pmdi, { classification: seuilsSuggeres }) : premier;
  const timeline = buildMusicTimeline(doc);

  return { doc, timeline, waveformPeaks: result.waveformPeaks, suggestion };
}
