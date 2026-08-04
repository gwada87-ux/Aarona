import { buildMusicTimeline } from './music/MusicTimeline';
import { StepContextBuilder } from './music/StepContext';
import { validatePmdi } from './music/validatePmdi';
import type { MusicEvent, PmdiDocument } from './music/pmdi';
import { BehaviourEngine } from './behaviour/BehaviourEngine';
import { defaultMapping } from './behaviour/mapping/defaults';
import { createPulseStyle } from './visual/styles/pulse/createPulseStyle';
import { createFieldStyle } from './visual/styles/field/createFieldStyle';
import { createSpectrumProStyle } from './visual/styles/spectrum-pro/createSpectrumProStyle';
import type { Scene } from './visual/scene/Scene';
import { defaultPalette } from './visual/palette/Palette';
import { FlashLimiter } from './visual/safety/FlashLimiter';
import { Canvas2DRenderer } from './render/canvas2d/Canvas2DRenderer';
import { createViewport } from './render/Viewport';
import { FixedStep, FIXED_DT } from './core/time/FixedStep';
import { findFormat } from './export/formats';
import { runExport, ExportCancelledError } from './export/ExportPipeline';
import { createOffscreenExportTarget } from './export/createOffscreenExportTarget';
import { MediabunnyEncoder } from './export/encoders/MediabunnyEncoder';
import { detectExportPath } from './export/encoders/detectSupport';
import { runRealtimeCapture } from './export/encoders/MediaRecorderFallback';
import { BITRATE_BPS } from './export/formats';

/**
 * Harnais de développement P9 — vérification manuelle des trois styles
 * (`Pulse` P7, `Field`/`Spectrum Pro` P9 — docs/07_VISUAL_ENGINE.md).
 * Piloté par une timeline SYNTHÉTIQUE (clic 120 BPM écrit à la main) plutôt
 * que par un fichier audio réel : l'analyse (P4) et le rendu visuel sont
 * déjà tous deux vérifiés séparément, l'intégration bout en bout
 * audio→visuel reste un chantier futur (UI, P12).
 *
 * Le pipeline câblé ici est RÉEL, pas une maquette : MusicTimeline (P5) →
 * StepContextBuilder (P5) → BehaviourEngine (P6) → Scene (P7/P9) →
 * Canvas2DRenderer → FlashLimiter, exactement l'ordre de docs/03_DATA_FLOW.md
 * FLUX 2. Seule l'horloge est un repli : sans `AudioEngine.Transport` réel
 * branché ici, `t` avance par le temps réel écoulé entre deux `rAF` plutôt
 * que par l'horloge audio compensée (déjà vérifiée séparément en P3).
 */

function buildSyntheticDoc(durationSec: number): PmdiDocument {
  const events: MusicEvent[] = [];
  const beatDur = 0.5; // 120 BPM
  for (let beat = 0; beat * beatDur < durationSec; beat++) {
    const t = beat * beatDur;
    events.push({ t, type: 'KICK', intensity: 0.75 + 0.2 * Math.sin(beat), confidence: 0.9 });
    if (beat % 4 === 0) events.push({ t, type: 'DOWNBEAT', intensity: 1, confidence: 0.95 });
    if (beat % 4 === 1 || beat % 4 === 3) events.push({ t, type: 'SNARE', intensity: 0.65, confidence: 0.85 });
  }
  for (let eighth = 0; eighth * (beatDur / 2) < durationSec; eighth++) {
    events.push({ t: eighth * (beatDur / 2), type: 'HAT', intensity: 0.3, confidence: 0.8 });
  }
  for (const dropT of [8, 20, 36]) {
    if (dropT < durationSec) events.push({ t: dropT, type: 'DROP', intensity: 1, confidence: 0.7 });
  }
  // BUILDUP de 3s avant chaque DROP — teste la convergence des particules du style Field (docs/07).
  for (const dropT of [8, 20, 36]) {
    if (dropT < durationSec) events.push({ t: dropT - 3, type: 'BUILDUP', intensity: 0.9, confidence: 0.7, dur: 3 });
  }
  events.sort((a, b) => a.t - b.t);

  const hz = 10;
  const sampleCount = Math.ceil(durationSec * hz) + 1;
  const energy = new Array<number>(sampleCount);
  const centroid = new Array<number>(sampleCount);
  // 6 bandes (docs/06 : sub/bass/lowmid/mid/himid/high) — déphasées entre elles pour un
  // spectre visuellement varié (Spectrum Pro) plutôt que 6 courbes identiques.
  const bandIds = ['sub', 'bass', 'lowmid', 'mid', 'himid', 'high'];
  const bands: Record<string, number[]> = {};
  for (const id of bandIds) bands[id] = new Array<number>(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / hz;
    energy[i] = 0.5 + 0.35 * Math.sin(t * 0.25);
    centroid[i] = 0.5 + 0.4 * Math.sin(t * 0.15 + 2);
    bandIds.forEach((id, bandIndex) => {
      const phase = bandIndex * 0.9;
      const freq = 0.3 + bandIndex * 0.05;
      bands[id]![i] = 0.5 + 0.4 * Math.sin(t * freq + phase);
    });
  }

  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'harness-p7@1.0', createdAt: new Date(0).toISOString() },
    audio: { duration: durationSec, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events,
    features: [
      { id: 'energy', hz, t0: 0, data: energy },
      { id: 'centroid', hz, t0: 0, data: centroid },
      ...bandIds.map((id) => ({ id: `band.${id}`, hz, t0: 0, data: bands[id]! })),
    ],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

const DURATION_SEC = 60;
const doc = buildSyntheticDoc(DURATION_SEC);
const validation = validatePmdi(doc);
if (!validation.ok) throw new Error(`Timeline synthétique invalide : ${JSON.stringify(validation.errors)}`);

const timeline = buildMusicTimeline(doc);
const stepper = new StepContextBuilder(timeline, 1);
const behaviourEngine = new BehaviourEngine(timeline, defaultMapping);

const STYLE_FACTORIES: Record<string, () => Scene> = {
  pulse: createPulseStyle,
  field: createFieldStyle,
  'spectrum-pro': createSpectrumProStyle,
};
let scene: Scene = createPulseStyle();

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const renderer = new Canvas2DRenderer(canvas);
const flashLimiter = new FlashLimiter(canvas);
scene.init({ renderer, palette: defaultPalette });

const styleSelect = document.querySelector<HTMLSelectElement>('#style-select')!;
styleSelect.addEventListener('change', () => {
  const factory = STYLE_FACTORIES[styleSelect.value];
  if (!factory) return;
  scene = factory();
  scene.init({ renderer, palette: defaultPalette });
  scene.reset(t);
});

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const btnPlay = document.querySelector<HTMLButtonElement>('#btn-play')!;
const btnPause = document.querySelector<HTMLButtonElement>('#btn-pause')!;
const seekRange = document.querySelector<HTMLInputElement>('#seek-range')!;
const reducedFlashingCheckbox = document.querySelector<HTMLInputElement>('#reduced-flashing')!;
const stressCheckbox = document.querySelector<HTMLInputElement>('#flash-stress')!;
seekRange.max = String(DURATION_SEC);

const outT = document.querySelector<HTMLElement>('#out-t')!;
const outFps = document.querySelector<HTMLElement>('#out-fps')!;
const outRegime = document.querySelector<HTMLElement>('#out-regime')!;
const outClamped = document.querySelector<HTMLElement>('#out-clamped')!;

let t = 0;
let playing = false;
const fixedStep = new FixedStep(FIXED_DT);
let lastFrameMs: number | null = null;
let fpsSmoothed = 0;
let lastRegime = '—';

btnPlay.addEventListener('click', () => {
  playing = true;
  lastFrameMs = null;
});
btnPause.addEventListener('click', () => {
  playing = false;
});
seekRange.addEventListener('input', () => {
  t = Number(seekRange.value);
  fixedStep.reset();
  scene.reset(t);
});
reducedFlashingCheckbox.addEventListener('change', () => {
  flashLimiter.setReducedFlashing(reducedFlashingCheckbox.checked);
});

const viewport = createViewport(1);

function loop(nowMs: number): void {
  let frameDt = 0;
  if (lastFrameMs !== null) {
    frameDt = (nowMs - lastFrameMs) / 1000;
    if (frameDt > 0) fpsSmoothed = fpsSmoothed === 0 ? 1 / frameDt : fpsSmoothed * 0.9 + (1 / frameDt) * 0.1;
  }
  lastFrameMs = nowMs;

  if (playing) {
    // Temps réel écoulé, PAS une constante 1/60 : sinon la simulation ne
    // reflète plus l'horloge réelle (rAF throttlé en arrière-plan, moniteur
    // externe à fréquence différente...). Plafonné à 0,25 s (même logique
    // que MAX_WINDOW dans EventDispatcher, docs/06) pour éviter une rafale
    // de rattrapage géante après une pause de l'onglet.
    const steps = fixedStep.advance(Math.min(frameDt, 0.25));
    for (let i = 0; i < steps; i++) {
      t += FIXED_DT;
      if (t > DURATION_SEC) t = 0;
      const step = stepper.build(t);
      const signals = behaviourEngine.update(step);
      scene.update(step, signals);
      lastRegime = step.regime;
    }
    seekRange.value = String(t);
  }

  renderer.beginFrame(viewport);
  renderer.clear(defaultPalette.bg[1]);
  scene.draw(renderer, viewport);
  renderer.endFrame();

  if (stressCheckbox.checked) {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = Math.floor(nowMs / 50) % 2 === 0 ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  flashLimiter.apply(t);

  outT.textContent = t.toFixed(2);
  outFps.textContent = fpsSmoothed.toFixed(1);
  outRegime.textContent = lastRegime;
  outClamped.textContent = String(flashLimiter.clampedCount);
}

function raf(nowMs: number): void {
  loop(nowMs);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

/**
 * Export (Étape 10/P8) — docs/09_EXPORT.md. Aucun fichier audio réel dans ce
 * harnais (timeline synthétique, voir en-tête) : un ton sinusoïdal déterministe
 * tient lieu de piste audio, exactement comme `spike-export/main.js` ("pas de
 * Math.random, pas de fichier source"). Uniquement un besoin du harnais — la
 * production attendra un vrai `AudioBuffer` décodé par `AudioEngine` (P3).
 */
function buildToneBuffer(durationSec: number): AudioBuffer {
  const sampleRate = 48000;
  const length = Math.round(sampleRate * durationSec);
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = 0.15 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  void ctx.close();
  return buffer;
}

const exportFormatSelect = document.querySelector<HTMLSelectElement>('#export-format')!;
const exportFpsSelect = document.querySelector<HTMLSelectElement>('#export-fps')!;
const exportDurationInput = document.querySelector<HTMLInputElement>('#export-duration')!;
const exportWatermarkCheckbox = document.querySelector<HTMLInputElement>('#export-watermark')!;
const btnExport = document.querySelector<HTMLButtonElement>('#btn-export')!;
const btnExportCancel = document.querySelector<HTMLButtonElement>('#btn-export-cancel')!;
const exportStatus = document.querySelector<HTMLElement>('#export-status')!;

let exportController: AbortController | null = null;

btnExportCancel.addEventListener('click', () => exportController?.abort());

btnExport.addEventListener('click', () => {
  void runExportFromUi();
});

async function runExportFromUi(): Promise<void> {
  const format = findFormat(exportFormatSelect.value);
  if (!format) return;
  const fps = Number(exportFpsSelect.value) as 30 | 60;
  const durationSec = Number(exportDurationInput.value);
  const watermarked = exportWatermarkCheckbox.checked;

  btnExport.disabled = true;
  btnExportCancel.disabled = false;
  exportController = new AbortController();
  const startedAt = performance.now();

  try {
    const bitrateBps = BITRATE_BPS.medium;
    exportStatus.textContent = 'Détection du support codec…';
    const path = await detectExportPath(format.width, format.height, bitrateBps);

    const exportTimeline = timeline; // même timeline que la preview — voir buildSyntheticDoc plus haut
    const audioBuffer = buildToneBuffer(durationSec);

    let result;
    if (path === 'webcodecs') {
      exportStatus.textContent = `Export WebCodecs — ${format.label}, ${fps}fps…`;
      const { target, canvas: exportCanvas } = createOffscreenExportTarget(format.width, format.height, false);
      const encoder = new MediabunnyEncoder(exportCanvas, fps, bitrateBps);
      result = await runExport(
        {
          timeline: exportTimeline,
          projectSeed: 1,
          mapping: defaultMapping,
          createScene: STYLE_FACTORIES[styleSelect.value] ?? createPulseStyle,
          palette: defaultPalette,
          fps,
          durationSec,
          audioBuffer,
          watermarked,
          signal: exportController.signal,
          onProgress: (done, total) => {
            exportStatus.textContent = `Encodage : image ${done}/${total}`;
          },
        },
        target,
        encoder,
      );
    } else {
      exportStatus.textContent = 'WebCodecs indisponible — repli MediaRecorder (temps réel)…';
      result = await runRealtimeCapture({
        canvas,
        fps,
        bitrateBps,
        durationSec,
        signal: exportController.signal,
      });
    }

    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pulsar-export-${format.id}-${fps}fps.mp4`;
    link.click();

    const totalMs = performance.now() - startedAt;
    exportStatus.textContent =
      `Terminé (${path}) — ${result.totalFrames} images, ${(result.blob.size / 1024).toFixed(1)} Ko, ` +
      `encodage ${result.elapsedMs.toFixed(0)} ms, total ${totalMs.toFixed(0)} ms.`;
  } catch (err) {
    if (err instanceof ExportCancelledError) {
      exportStatus.textContent = 'Export annulé.';
    } else {
      exportStatus.textContent = `Échec : ${err instanceof Error ? err.message : String(err)}`;
      console.error(err);
    }
  } finally {
    btnExport.disabled = false;
    btnExportCancel.disabled = true;
    exportController = null;
  }
}

/**
 * `requestAnimationFrame` est suspendu par le navigateur tant que l'onglet
 * n'est pas COMPOSITÉ à l'écran (`document.hidden`), pas seulement invisible
 * au sens de la fenêtre active — un simple onglet d'arrière-plan suffit.
 * Ce hook permet de faire avancer et redessiner une frame manuellement
 * (console, ou vérification automatisée) sans dépendre de rAF. Utile aussi
 * pour Aaron en session de développement (`__pulsarDebug.step(1/60)`).
 */
if (import.meta.env.DEV) {
  (window as unknown as { __pulsarDebug: unknown }).__pulsarDebug = {
    step: (dtSeconds = 1 / 60) => loop((lastFrameMs ?? performance.now()) + dtSeconds * 1000),
    play: () => btnPlay.click(),
    pause: () => btnPause.click(),
    get t() {
      return t;
    },
  };
}
