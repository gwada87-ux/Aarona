import type { Renderer } from '../render/Renderer';
import type { Viewport } from '../render/Viewport';
import { StepContextBuilder } from '../music/StepContext';
import type { MusicTimeline } from '../music/MusicTimeline';
import { BehaviourEngine } from '../behaviour/BehaviourEngine';
import type { MappingSchema } from '../behaviour/mapping/MappingSchema';
import type { Scene } from '../visual/scene/Scene';
import type { Palette } from '../visual/palette/Palette';
import { FIXED_DT } from '../core/time/FixedStep';
import { EXPORT_QUALITY_LEVEL, QUALITY_LEVEL_CONFIGS } from '../perf/qualityLevels';
import type { FrameEncoder } from './encoders/FrameEncoder';
import { drawWatermark } from './watermark';
import { yieldToEventLoop } from './yieldToEventLoop';
import { SUPPORTED_FPS, type Fps } from './formats';

/** docs/09_EXPORT.md : « progression émise toutes les 15 images ». */
const PROGRESS_EVERY = 15;

export class ExportCancelledError extends Error {
  constructor() {
    super('Export annulé');
    this.name = 'ExportCancelledError';
  }
}

/**
 * Ce que `runExport` dessine dedans — délibérément découplé de la création
 * du canvas (voir `createOffscreenExportTarget.ts`, browser-only) pour que
 * la boucle d'orchestration elle-même soit testable avec un `FakeRenderer`
 * (docs/JOURNAL.md, Étape 10).
 */
export interface ExportTarget {
  readonly renderer: Renderer;
  readonly viewport: Viewport;
  readonly applyFlashLimiter: (t: number) => void;
}

export interface ExportConfig {
  readonly timeline: MusicTimeline;
  readonly projectSeed: number;
  readonly mapping: MappingSchema;
  readonly createScene: () => Scene;
  readonly palette: Palette;
  readonly fps: Fps;
  readonly durationSec: number;
  readonly audioBuffer: AudioBuffer;
  readonly watermarked: boolean;
  readonly onProgress?: (framesDone: number, totalFrames: number) => void;
  readonly signal?: AbortSignal;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly elapsedMs: number;
  readonly totalFrames: number;
}

/**
 * Pipeline déterministe (docs/09_EXPORT.md §"Le pipeline déterministe") :
 * `t = f/fps`, jamais d'horloge réelle dans le rendu — la seule lecture de
 * `performance.now()` ci-dessous chronomètre l'export pour l'UI, exactement
 * comme `spike-export/main.js` ("mesure UI du spike, hors pipeline de
 * rendu"), jamais pour piloter `t`.
 *
 * Instances FRAÎCHES de `StepContextBuilder`/`BehaviourEngine`/`Scene` —
 * jamais celles d'une preview en cours : ne doit jamais interférer avec une
 * lecture en cours, et démarre à `t=0` sans dépendre d'un `reset(0)`
 * générique.
 */
export async function runExport(
  config: ExportConfig,
  target: ExportTarget,
  encoder: FrameEncoder,
): Promise<ExportResult> {
  if (!SUPPORTED_FPS.includes(config.fps)) {
    throw new Error(`fps non supporté pour l'export : ${config.fps} (attendu ${SUPPORTED_FPS.join(' ou ')})`);
  }

  const stepper = new StepContextBuilder(config.timeline, config.projectSeed);
  const behaviourEngine = new BehaviourEngine(config.timeline, config.mapping);
  const scene = config.createScene();
  scene.init({ renderer: target.renderer, palette: config.palette });
  // docs/10 règle non négociable #2 : l'export fige TOUJOURS le bloom au niveau HIGH, quel que
  // soit le niveau courant de la preview — figé ICI plutôt que délégué à l'appelant (`ExportDialog`
  // gèle déjà `getStyleFactory` de la même façon, mais un second point d'application indépendant,
  // dans le pipeline lui-même, ne dépend pas de ce qu'un futur appelant pourrait oublier de faire).
  target.renderer.setBloomConfig(QUALITY_LEVEL_CONFIGS[EXPORT_QUALITY_LEVEL].bloom);

  const totalFrames = Math.max(0, Math.round(config.durationSec * config.fps));
  const startedAt = performance.now();

  try {
    await encoder.start();

    let simT = 0;
    for (let f = 0; f < totalFrames; f++) {
      if (config.signal?.aborted) throw new ExportCancelledError();

      const targetT = f / config.fps;
      while (simT < targetT - 1e-9) {
        simT += FIXED_DT;
        const step = stepper.build(simT);
        const signals = behaviourEngine.update(step);
        scene.update(step, signals);
      }

      target.renderer.beginFrame(target.viewport);
      target.renderer.clear(config.palette.bg[1]);
      scene.draw(target.renderer, target.viewport);
      target.renderer.endFrame();
      if (config.watermarked) drawWatermark(target.renderer, target.viewport);
      target.applyFlashLimiter(targetT);

      await encoder.addVideoFrame(targetT, 1 / config.fps);

      if (f % PROGRESS_EVERY === 0) {
        config.onProgress?.(f, totalFrames);
        await yieldToEventLoop();
      }
    }

    if (config.signal?.aborted) throw new ExportCancelledError();

    config.onProgress?.(totalFrames, totalFrames);
    await encoder.addAudio(config.audioBuffer);
    const blob = await encoder.finish();
    return { blob, elapsedMs: performance.now() - startedAt, totalFrames };
  } catch (err) {
    await encoder.cancel().catch(() => {
      // best-effort : ne masque jamais l'erreur d'origine par une erreur de nettoyage.
    });
    throw err;
  }
}
