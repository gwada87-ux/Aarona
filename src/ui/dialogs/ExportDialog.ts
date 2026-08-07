/**
 * Dialogue d'export (docs/09_EXPORT.md, docs/00a Étape 14/P12 : « le
 * dialogue d'export »). Reprend la logique déjà vérifiée au navigateur en
 * P8/P9/P11 (`main.ts`, `runExportFromUi`), adaptée pour exporter le morceau
 * RÉELLEMENT chargé (durée et `AudioBuffer` réels) plutôt que le ton
 * sinusoïdal synthétique du harnais.
 */
import { findFormat, BITRATE_BPS, type Fps } from '../../export/formats';
import { runExport, ExportCancelledError, type ExportResult } from '../../export/ExportPipeline';
import { createOffscreenExportTarget } from '../../export/createOffscreenExportTarget';
import { MediabunnyEncoder } from '../../export/encoders/MediabunnyEncoder';
import { detectExportPath } from '../../export/encoders/detectSupport';
import { runRealtimeCapture } from '../../export/encoders/MediaRecorderFallback';
import type { MappingSchema } from '../../behaviour/mapping/MappingSchema';
import type { MusicTimeline } from '../../music/MusicTimeline';
import type { Palette } from '../../visual/palette/Palette';
import type { Scene } from '../../visual/scene/Scene';
import type { PresetBloomConfig, PresetMacros, StyleId } from '../../presets/schema';
import type { Automation } from '../../core/automation/Automation';

export interface ExportDialogOptions {
  readonly canvas: HTMLCanvasElement;
  readonly getTimeline: () => MusicTimeline | null;
  readonly getMapping: () => MappingSchema;
  readonly getPalette: () => Palette;
  readonly getStyleFactory: () => () => Scene;
  /** Pochette décodée (§7.5). L'export doit voir la MÊME que l'aperçu, sinon il rend une image amputée. */
  readonly getCover: () => ImageBitmap | null;
  /** Étape 26 : macros de couche + style actif, transmis à `runExport()` pour corriger le gap « macros absentes à l'export ». */
  readonly getMacros: () => PresetMacros;
  readonly getStyleId: () => StyleId;
  /** Intention de bloom du preset actif (docs/17 SS6.5, chantier 9). */
  readonly getBloom: () => PresetBloomConfig;
  /** Courbes d'automatisation (docs/17 SS7.3, chantier 10 lot D). */
  readonly getAutomation: () => Automation;
  readonly getAudioBuffer: () => AudioBuffer | null;
  /** Graine du projet (docs/13_PROJECT_FORMAT.md) — DOIT être la même qu'en preview pour un export reproductible au pixel près. */
  readonly getProjectSeed: () => number;
  /** Repli `MediaRecorder` : capture le canvas de preview EN TEMPS RÉEL — il doit donc jouer pendant l'export. */
  readonly seekToStart: () => void;
  readonly play: () => void;
  readonly pause: () => void;
  /**
   * Étape 16/P14 (docs/10_PERFORMANCE.md règle non négociable #2 : « l'export
   * … désactive le QualityGovernor pour toute sa durée »). Optionnels : sans
   * eux, le comportement d'avant cette étape est inchangé.
   */
  readonly onExportStart?: () => void;
  readonly onExportEnd?: () => void;
}

export class ExportDialog {
  private readonly dialog = document.querySelector<HTMLDialogElement>('#export-dialog')!;
  private readonly formatSelect = document.querySelector<HTMLSelectElement>('#export-format')!;
  private readonly fpsSelect = document.querySelector<HTMLSelectElement>('#export-fps')!;
  private readonly watermarkCheckbox = document.querySelector<HTMLInputElement>('#export-watermark')!;
  private readonly statusEl = document.querySelector<HTMLElement>('#export-status')!;
  private readonly exportBtn = document.querySelector<HTMLButtonElement>('#btn-export')!;
  private readonly cancelBtn = document.querySelector<HTMLButtonElement>('#btn-export-cancel')!;
  private readonly closeBtn = document.querySelector<HTMLButtonElement>('#btn-export-close')!;
  private readonly openBtn = document.querySelector<HTMLButtonElement>('#btn-export-open')!;
  private controller: AbortController | null = null;

  constructor(private readonly options: ExportDialogOptions) {
    this.openBtn.addEventListener('click', () => this.dialog.showModal());
    this.closeBtn.addEventListener('click', () => this.dialog.close());
    this.cancelBtn.addEventListener('click', () => this.controller?.abort());
    this.exportBtn.addEventListener('click', () => void this.run());
  }

  private async run(): Promise<void> {
    const format = findFormat(this.formatSelect.value);
    const timeline = this.options.getTimeline();
    const audioBuffer = this.options.getAudioBuffer();
    if (!format || !timeline || !audioBuffer) {
      this.statusEl.textContent = 'Aucun morceau chargé — importe un fichier ou charge la démo avant d\'exporter.';
      return;
    }

    const fps = Number(this.fpsSelect.value) as Fps;
    const durationSec = timeline.duration;
    const watermarked = this.watermarkCheckbox.checked;

    this.options.onExportStart?.();
    this.exportBtn.disabled = true;
    this.cancelBtn.disabled = false;
    this.controller = new AbortController();
    const startedAt = performance.now();

    try {
      const bitrateBps = BITRATE_BPS.medium;
      this.statusEl.textContent = 'Détection du support codec…';
      const path = await detectExportPath(format.width, format.height, bitrateBps);

      let result: ExportResult;
      if (path === 'webcodecs') {
        this.statusEl.textContent = `Export WebCodecs — ${format.label}, ${fps}fps…`;
        const { target, canvas: exportCanvas } = createOffscreenExportTarget(format.width, format.height, false);
        const encoder = new MediabunnyEncoder(exportCanvas, fps, bitrateBps);
        result = await runExport(
          {
            timeline,
            projectSeed: this.options.getProjectSeed(),
            mapping: this.options.getMapping(),
            createScene: this.options.getStyleFactory(),
            cover: this.options.getCover(),
            macros: this.options.getMacros(),
            styleId: this.options.getStyleId(),
            bloom: this.options.getBloom(),
            automation: this.options.getAutomation(),
            palette: this.options.getPalette(),
            fps,
            durationSec,
            audioBuffer,
            watermarked,
            signal: this.controller.signal,
            onProgress: (done, total) => {
              this.statusEl.textContent = `Encodage : image ${done}/${total}`;
            },
          },
          target,
          encoder,
        );
      } else {
        this.statusEl.textContent = 'WebCodecs indisponible — repli MediaRecorder (temps réel)…';
        this.options.seekToStart();
        this.options.play();
        try {
          result = await runRealtimeCapture({
            canvas: this.options.canvas,
            fps,
            bitrateBps,
            durationSec,
            signal: this.controller.signal,
          });
        } finally {
          this.options.pause();
        }
      }

      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pulsar-export-${format.id}-${fps}fps.mp4`;
      link.click();

      const totalMs = performance.now() - startedAt;
      this.statusEl.textContent =
        `Terminé (${path}) — ${result.totalFrames} images, ${(result.blob.size / 1024).toFixed(1)} Ko, ` +
        `encodage ${result.elapsedMs.toFixed(0)} ms, total ${totalMs.toFixed(0)} ms.`;
    } catch (err) {
      if (err instanceof ExportCancelledError) {
        this.statusEl.textContent = 'Export annulé.';
      } else {
        this.statusEl.textContent = `Échec : ${err instanceof Error ? err.message : String(err)}`;
        console.error(err);
      }
    } finally {
      this.exportBtn.disabled = false;
      this.cancelBtn.disabled = true;
      this.controller = null;
      this.options.onExportEnd?.();
    }
  }
}
