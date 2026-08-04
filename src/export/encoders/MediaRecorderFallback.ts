import { ExportCancelledError, type ExportResult } from '../ExportPipeline';

/**
 * Repli dégradé (docs/09_EXPORT.md §"Repli MediaRecorder", ADR-005-A) :
 * `canvas.captureStream(fps)` + `MediaRecorder`, EN TEMPS RÉEL — pas la
 * boucle déterministe. Ne réimplémente pas de rendu : capture un canvas
 * `<canvas>` RÉEL déjà piloté par la boucle de preview existante
 * (`requestAnimationFrame`), qui doit être en train de jouer depuis `t=0`
 * pendant tout l'appel. Voir docs/JOURNAL.md, Étape 10, pour pourquoi ce
 * chemin n'implémente pas `FrameEncoder` (interface par-image inadaptée à
 * un flux temps réel).
 *
 * `setTimeout` ci-dessous n'enfreint PAS le piège #4 de docs/09 (jamais de
 * `setTimeout` dans la boucle d'export) : cette règle vise `ExportPipeline`,
 * la boucle DÉTERMINISTE hors temps réel. Ici, l'enregistrement est de toute
 * façon lié à l'horloge réelle par `captureStream` — attendre en temps réel
 * est la seule option cohérente.
 */
const CANDIDATE_MIME_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickSupportedMimeType(
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
): string {
  return CANDIDATE_MIME_TYPES.find(isSupported) ?? '';
}

export interface RealtimeCaptureConfig {
  readonly canvas: HTMLCanvasElement;
  readonly fps: number;
  readonly bitrateBps: number;
  readonly durationSec: number;
  readonly signal?: AbortSignal;
}

export async function runRealtimeCapture(config: RealtimeCaptureConfig): Promise<ExportResult> {
  const mimeType = pickSupportedMimeType();
  const stream = config.canvas.captureStream(config.fps);
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: config.bitrateBps,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (event) => {
      const error = (event as unknown as { error?: Error }).error;
      reject(error ?? new Error('MediaRecorder : erreur inconnue'));
    };
  });

  const startedAt = performance.now();
  recorder.start();

  const waiters: Promise<void>[] = [
    new Promise((resolve) => setTimeout(resolve, config.durationSec * 1000)),
  ];
  if (config.signal) {
    waiters.push(new Promise((resolve) => config.signal!.addEventListener('abort', () => resolve(), { once: true })));
  }
  await Promise.race(waiters);

  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());

  if (config.signal?.aborted) throw new ExportCancelledError();

  return {
    blob: new Blob(chunks, { type: mimeType || 'video/webm' }),
    elapsedMs: performance.now() - startedAt,
    totalFrames: Math.round(config.durationSec * config.fps),
  };
}
