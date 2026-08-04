/**
 * Worker d'analyse — analysis/worker (docs/02_ARCHITECTURE.md :
 * "ANALYSIS (Web Worker · hors-ligne · Mode A uniquement)", docs/03 FLUX 1).
 * Enveloppe fine autour de `runAnalysisPipeline` : reçoit le signal mono par
 * `ArrayBuffer` transférable (zéro copie, docs/03 l.27-28), relaie la
 * progression, renvoie le résultat.
 *
 * Non couvert par un test automatisé : `self`/`postMessage` n'existent pas en
 * environnement Node (Vitest) — même limite que `audio/AudioEngine.ts`
 * (docs/JOURNAL.md Étape 4). Vérification manuelle au navigateur prévue
 * quand l'UI branchera ce Worker (Étape 14).
 */
import { runAnalysisPipeline, type AnalysisProgressStage } from './AnalysisPipeline';

export interface AnalyzeRequest {
  readonly type: 'analyze';
  readonly signal: ArrayBuffer; // Float32Array mono transférable
  readonly sampleRate: number;
}

export type WorkerRequest = AnalyzeRequest;

export interface ProgressResponse {
  readonly type: 'progress';
  readonly fraction: number;
  readonly stage: AnalysisProgressStage;
}

export interface ResultResponse {
  readonly type: 'result';
  readonly result: ReturnType<typeof runAnalysisPipeline>;
}

export interface ErrorResponse {
  readonly type: 'error';
  readonly message: string;
}

export type WorkerResponse = ProgressResponse | ResultResponse | ErrorResponse;

function handleAnalyze(request: AnalyzeRequest, post: (response: WorkerResponse) => void): void {
  const signal = new Float32Array(request.signal);
  try {
    const result = runAnalysisPipeline({
      signal,
      sampleRate: request.sampleRate,
      onProgress: (fraction, stage) => post({ type: 'progress', fraction, stage }),
    });
    post({ type: 'result', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

// `self` est un DedicatedWorkerGlobalScope au runtime ; typé largement ici pour
// rester chargeable hors Worker (tests, analyse statique) sans lib "webworker".
declare const self: any;
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
    if (event.data.type === 'analyze') {
      handleAnalyze(event.data, (response) => self.postMessage(response));
    }
  });
}
