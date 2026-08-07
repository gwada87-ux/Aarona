import type { Renderer } from '../render/Renderer';
import type { Viewport } from '../render/Viewport';
import { StepContextBuilder } from '../music/StepContext';
import type { MusicTimeline } from '../music/MusicTimeline';
import { BehaviourEngine } from '../behaviour/BehaviourEngine';
import { VisualDirector } from '../behaviour/VisualDirector';
import type { MappingSchema } from '../behaviour/mapping/MappingSchema';
import type { Scene } from '../visual/scene/Scene';
import { applyLayerBlends, framingFor, openFrameWithCamera, stepSceneWithDrama, NEUTRAL_AUTOMATION } from '../visual/scene/dramaFrame';
import { variantFor } from '../presets/styleVariants';
import type { Palette } from '../visual/palette/Palette';
import { FIXED_DT } from '../core/time/FixedStep';
import { EXPORT_QUALITY_LEVEL, QUALITY_LEVEL_CONFIGS } from '../perf/qualityLevels';
import { applyLayerMacrosToScene } from '../presets/layerMacros';
import { MACRO_NAMES, type PresetBloomConfig, type PresetMacros, type StyleId } from '../presets/schema';
import { automationValue, hasLane, type Automation } from '../core/automation/Automation';
import { resolveBloom } from '../presets/bloom';
import type { FrameEncoder } from './encoders/FrameEncoder';
import { drawWatermark } from './watermark';
import { yieldToEventLoop } from './yieldToEventLoop';
import { SUPPORTED_FPS, type Fps } from './formats';

/** docs/09_EXPORT.md : « progression émise toutes les 15 images ». */
const PROGRESS_EVERY = 15;

/**
 * Secondes simulees avant la premiere image en mode boucle.
 *
 * Deux secondes : assez pour remplir un pool de particules et saturer une
 * trainee de feedback (dont l alpha de 0,88 par image ne laisse plus rien de
 * visible au bout d une demi-seconde), assez peu pour ne pas doubler la duree
 * d un export court.
 */
const LOOP_PREROLL_SEC = 2;

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
  /** Pochette décodée, ou `null`. Transmise telle quelle à `scene.init` (§7.5). */
  readonly cover?: ImageBitmap | null;
  /**
   * Macros de couche (Étape 20, densité/mouvement/profondeur/glow/chaos/
   * douceur) + style actif — Étape 26 : jusque-là absents d'`ExportConfig`,
   * `runExport()` construisait sa propre Scene sans jamais leur appliquer
   * ces macros (gap découvert et signalé à l'Étape 25). `styleId` DOIT
   * correspondre au style de la Scene produite par `createScene()` — c'est
   * à l'appelant (`ExportDialog`) de les garder synchronisés, comme il le
   * fait déjà pour `createScene`/`palette`.
   */
  readonly macros: PresetMacros;
  readonly styleId: StyleId;
  /**
   * Intention de bloom du preset (§6.5, chantier 9). Absente = le defaut, donc
   * le comportement d'avant ce chantier. Meme raison d'etre optionnelle que
   * `cover` : un appelant ecrit avant reste valide.
   */
  readonly bloom?: PresetBloomConfig;
  /**
   * Courbes d'automatisation (docs/17 SS7.3, chantier 10 lot D). Absentes = le
   * rendu est EXACTEMENT celui d'avant ce lot, ligne pour ligne.
   */
  readonly automation?: Automation;
  readonly palette: Palette;
  readonly fps: Fps;
  readonly durationSec: number;
  readonly audioBuffer: AudioBuffer;
  readonly watermarked: boolean;
  /**
   * Export EN BOUCLE (docs/17 SS7.12, chantier 10 lot E).
   *
   * Ce que ca fait, precisement : la scene est SIMULEE sur les dernieres
   * secondes du morceau avant que la premiere image ne soit dessinee. Les
   * couches a etat - pools de particules, trainee de feedback - demarrent donc
   * dans l etat ou elles finissent, et la couture ne se voit plus.
   *
   * Ce que ca ne fait PAS, et SS7.12 demande de le dire honnetement : la
   * derniere image n est pas IDENTIQUE a la premiere. Elle ne peut pas l etre -
   * les signaux viennent de la musique, et la musique de la derniere seconde
   * n est pas celle de la premiere. La boucle est visuellement continue, pas
   * mathematiquement fermee.
   */
  readonly loop?: boolean;
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
  // Dramaturgie (chantier 3) : sans état, entièrement recalculée depuis `t`,
  // donc l'export en produit exactement la même que la preview.
  const director = new VisualDirector(config.timeline);
  const scene = config.createScene();
  scene.init({ renderer: target.renderer, palette: config.palette, cover: config.cover ?? null });
  // Macros de couche (Étape 20) — CORRIGÉ à l'Étape 26 : jusque-là jamais appliquées à l'export
  // (gap signalé à l'Étape 25). Même fonction que `ui/App.ts::applyLayerMacros()`, un seul point
  // de vérité pour ne pas laisser preview et export diverger.
  applyLayerMacrosToScene(scene, config.macros, config.styleId);
  // Variante de cadrage (§7.10) : dérivée de la GRAINE, donc identique à celle
  // de l'aperçu pour le même projet. La recalculer ici plutôt que la recevoir
  // en configuration suit le même raisonnement que le bloom et `bandCount`
  // ci-dessous — un point d'application indépendant, qui ne dépend pas de ce
  // qu'un futur appelant pourrait oublier de transmettre.
  const variant = variantFor(config.styleId, config.projectSeed);
  applyLayerBlends(scene, variant.blend);
  // Cadrage NEUTRE des que la scene porte un habillage (chantier 8) : le meme
  // arbitrage que l'apercu, calcule ici plutot que recu, pour la meme raison que
  // les trois reglages ci-dessous. Sans lui, l'export decadrerait le titre
  // exactement comme l'apercu le faisait avant ce chantier.
  const framing = framingFor(scene, variant);
  // docs/10 règle non négociable #2 : l'export fige TOUJOURS le bloom au niveau HIGH, quel que
  // soit le niveau courant de la preview — figé ICI plutôt que délégué à l'appelant (`ExportDialog`
  // gèle déjà `getStyleFactory` de la même façon, mais un second point d'application indépendant,
  // dans le pipeline lui-même, ne dépend pas de ce qu'un futur appelant pourrait oublier de faire).
  // Chantier 9 : le PLAFOND reste celui d'EXPORT_QUALITY_LEVEL, mais ce qui est
  // pose dessous vient du preset et de la macro Glow (§6.5). Sans cette ligne,
  // un preset volontairement mat sortirait a l'export avec le halo maximal de la
  // qualite HIGH - l'apercu et la video ne se ressembleraient plus.
  target.renderer.setBloomConfig(
    resolveBloom(config.bloom, config.macros.glow, QUALITY_LEVEL_CONFIGS[EXPORT_QUALITY_LEVEL].bloom),
  );
  target.renderer.setChromaticAberration(QUALITY_LEVEL_CONFIGS[EXPORT_QUALITY_LEVEL].chromaticAberration);
  target.renderer.setInternalResolutionScale(QUALITY_LEVEL_CONFIGS[EXPORT_QUALITY_LEVEL].internalResolutionScale);
  // `bandCount` (Étape 25) : un `layer.params`, pas un réglage de `Renderer` — appliqué APRÈS
  // les macros ci-dessus (dont il ne fait pas partie), point d'application indépendant, ne dépend
  // pas de ce qu'un futur appelant pourrait oublier.
  const spectrumBarsLayer = scene.layers.find((l) => l.id === 'spectrumBars');
  if (spectrumBarsLayer) {
    spectrumBarsLayer.params = { ...spectrumBarsLayer.params, bandCount: QUALITY_LEVEL_CONFIGS[EXPORT_QUALITY_LEVEL].spectrumBands };
  }

  const totalFrames = Math.max(0, Math.round(config.durationSec * config.fps));
  const startedAt = performance.now();

  try {
    await encoder.start();

    // Automatisation resolue par image (SS7.3). Objet MUTE, comme cote apercu :
    // un litteral par sous-pas serait une allocation dans la boucle chaude.
    const auto = { intensity: 1, cameraX: 0, cameraY: 0, cameraZoom: 1 };
    const curves = config.automation ?? [];
    const automatedMacroNames = MACRO_NAMES.filter((n) => hasLane(curves, `macro:${n}`));
    const evaluate = (t: number) => {
      if (curves.length === 0) return NEUTRAL_AUTOMATION;
      auto.intensity = automationValue(curves, 'intensity', t, 1);
      auto.cameraX = automationValue(curves, 'cameraX', t, 0);
      auto.cameraY = automationValue(curves, 'cameraY', t, 0);
      auto.cameraZoom = automationValue(curves, 'cameraZoom', t, 1);
      return auto;
    };

    // Pre-roll de bouclage (SS7.12). Avant la premiere image, pas apres : c est
    // l etat de DEPART qu il faut faire correspondre a celui d arrivee.
    if (config.loop === true) {
      for (let t = Math.max(0, config.durationSec - LOOP_PREROLL_SEC); t < config.durationSec; t += FIXED_DT) {
        stepSceneWithDrama(scene, behaviourEngine, director, stepper.build(t), evaluate(t));
      }
    }

    let simT = 0;
    for (let f = 0; f < totalFrames; f++) {
      if (config.signal?.aborted) throw new ExportCancelledError();

      const targetT = f / config.fps;
      while (simT < targetT - 1e-9) {
        simT += FIXED_DT;
        stepSceneWithDrama(scene, behaviourEngine, director, stepper.build(simT), evaluate(simT));
      }

      // Macros automatisees : reappliquees par IMAGE et non par sous-pas, pour
      // la meme raison que cote apercu - elles remplacent `layer.params` en
      // entier, donc allouent un objet par couche.
      if (automatedMacroNames.length > 0) {
        const macros: Record<string, number> = { ...config.macros };
        for (const n of automatedMacroNames) {
          macros[n] = Math.min(1, Math.max(0, automationValue(curves, `macro:${n}`, targetT, config.macros[n])));
        }
        applyLayerMacrosToScene(scene, macros as unknown as PresetMacros, config.styleId);
        applyLayerBlends(scene, variant.blend);
      }

      openFrameWithCamera(target.renderer, target.viewport, config.palette.bg[1], director, framing, evaluate(targetT));
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
