/**
 * Bootstrap du Worker d'analyse (docs/02_ARCHITECTURE.md : "ANALYSIS (Web
 * Worker · hors-ligne · Mode A uniquement)"). `worker.ts` définit déjà le
 * protocole de message et s'auto-enregistre côté Worker ; ce module est le
 * seul endroit qui l'INSTANCIE (`new Worker(...)`), jusqu'ici manquant du
 * projet — voir son en-tête ("Vérification manuelle au navigateur prévue
 * quand l'UI branchera ce Worker (Étape 14)").
 *
 * Non couvert par un test automatisé : `Worker` n'existe pas en environnement
 * Node (Vitest) — même limite déjà documentée pour `AudioEngine.ts` et
 * `worker.ts` lui-même.
 */
import type { AnalysisProgressStage, AnalysisResult } from './AnalysisPipeline';
import type { AnalyzeRequest, WorkerResponse } from './worker';

export interface AnalyzeInWorkerOptions {
  /** Signal mono. ⚠️ Son `.buffer` est TRANSFÉRÉ (zéro copie) : inutilisable par l'appelant après cet appel. */
  readonly signal: Float32Array;
  readonly sampleRate: number;
  readonly onProgress?: (fraction: number, stage: AnalysisProgressStage) => void;
  /** Annule l'analyse en cours — utile quand un nouveau fichier est déposé pendant l'analyse du précédent. */
  readonly abortSignal?: AbortSignal;
}

export class AnalysisWorkerError extends Error {}
export class AnalysisCancelledError extends Error {}

/** Lance l'analyse dans un Worker dédié, terminé (`.terminate()`) une fois la promesse réglée ou annulée. */
export function analyzeInWorker(options: AnalyzeInWorkerOptions): Promise<AnalysisResult> {
  const { signal, sampleRate, onProgress, abortSignal } = options;

  return new Promise<AnalysisResult>((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    let settled = false;

    const cleanup = (): void => {
      settled = true;
      worker.terminate();
      abortSignal?.removeEventListener('abort', onAbort);
    };

    const onAbort = (): void => {
      if (settled) return;
      cleanup();
      reject(new AnalysisCancelledError('analyse annulée'));
    };

    if (abortSignal?.aborted) {
      cleanup();
      reject(new AnalysisCancelledError('analyse annulée'));
      return;
    }
    abortSignal?.addEventListener('abort', onAbort);

    worker.onerror = (event: ErrorEvent) => {
      if (settled) return;
      cleanup();
      reject(new AnalysisWorkerError(event.message || "erreur non spécifiée dans le Worker d'analyse"));
    };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === 'progress') {
        onProgress?.(response.fraction, response.stage);
      } else if (response.type === 'result') {
        cleanup();
        resolve(response.result);
      } else if (response.type === 'error') {
        cleanup();
        reject(new AnalysisWorkerError(response.message));
      }
    };

    const request: AnalyzeRequest = { type: 'analyze', signal: signal.buffer as ArrayBuffer, sampleRate };
    worker.postMessage(request, [request.signal]);
  });
}
