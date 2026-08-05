/**
 * Orchestrateur de l'application réelle (docs/00a Étape 14/P12) — le premier
 * point du projet qui connecte tout bout à bout : import de fichier réel →
 * `AudioEngine` (P3) → démixage (`ui/pipeline.ts`) → Worker d'analyse (P4)
 * → `finalizePmdi` (P10) → suggestion de preset (P11) → `MusicTimeline` (P5)
 * → `BehaviourEngine` (P6) → `Scene` (P7/P9) → `Canvas2DRenderer` →
 * `FlashLimiter`, dans l'ordre de docs/03_DATA_FLOW.md FLUX 2 — mais piloté
 * par un `Transport` RÉEL (`AudioEngine`) plutôt que l'horloge synthétique du
 * harnais P7/P9/P11.
 *
 * Remplace `main.ts` : chaque brique en amont est déjà testée isolément
 * (voir `docs/JOURNAL.md`) — le travail propre à cette étape est
 * l'intégration elle-même, pas une nouvelle logique métier.
 */
import { AudioEngine } from '../audio/AudioEngine';
import { AudioValidationError } from '../audio/decode';
import { FixedStep, FIXED_DT } from '../core/time/FixedStep';
import { createViewport } from '../render/Viewport';
import { Canvas2DRenderer } from '../render/canvas2d/Canvas2DRenderer';
import { StepContextBuilder } from '../music/StepContext';
import { buildMusicTimeline, type MusicTimeline } from '../music/MusicTimeline';
import type { PmdiDocument } from '../music/pmdi';
import type { WaveformPeaks } from '../analysis/waveformPeaks';
import { BehaviourEngine } from '../behaviour/BehaviourEngine';
import type { MappingSchema } from '../behaviour/mapping/MappingSchema';
import { createPulseStyle } from '../visual/styles/pulse/createPulseStyle';
import { createFieldStyle } from '../visual/styles/field/createFieldStyle';
import { createSpectrumProStyle } from '../visual/styles/spectrum-pro/createSpectrumProStyle';
import type { Scene } from '../visual/scene/Scene';
import { FlashLimiter } from '../visual/safety/FlashLimiter';
import type { Palette } from '../visual/palette/Palette';
import { PRESET_CATALOG, resolvePreset, type Preset, type PresetMacros, type StyleId, MACRO_NAMES } from '../presets/index';
import type { MacroName } from '../presets/schema';
import { importTrack } from './pipeline';
import { buildDemoAudioFile, buildDemoDoc } from './demoDoc';
import { downmixToMono } from '../audio/downmix';
import { computeWaveformPeaks } from '../analysis/waveformPeaks';
import { primeAfterSeek, RELEASE_PRIME_WINDOW_SEC, SCRUB_PRIME_WINDOW_SEC } from './seekPriming';
import { Timeline } from './timeline/Timeline';
import { SimplePanel } from './panels/SimplePanel';
import { AdvancedPanel } from './panels/AdvancedPanel';
import { PresetEditorDialog } from './dialogs/PresetEditorDialog';
import { ExportDialog } from './dialogs/ExportDialog';

const STYLE_FACTORIES: Readonly<Record<StyleId, () => Scene>> = {
  pulse: createPulseStyle,
  field: createFieldStyle,
  'spectrum-pro': createSpectrumProStyle,
};

/** Palette/mapping/classification "aucun preset" : reprend telle quelle la config JSON de Trap Dark — documentée dans `visual/palette/Palette.ts` comme identique à `defaultPalette`. */
const FALLBACK_PALETTE_CONFIG = PRESET_CATALOG.find((p) => p.id === 'trap-dark')!.palette;

function neutralMacros(): PresetMacros {
  const macros = {} as Record<MacroName, number>;
  for (const name of MACRO_NAMES) macros[name] = 0.5;
  return macros as PresetMacros;
}

function buildFallbackPreset(styleId: StyleId, macros: PresetMacros, reducedFlashing: boolean): Preset {
  return {
    id: 'none',
    version: 1,
    name: 'Aucun',
    genre: { tempoHint: [0, 999], subDominance: 0.5, onsetDensity: 0.5, continuousRegimePreference: false },
    style: styleId,
    palette: FALLBACK_PALETTE_CONFIG,
    macros,
    safety: { reducedFlashing },
  };
}

// ---------------------------------------------------------------------------
// État applicatif
// ---------------------------------------------------------------------------

const audioEngine = new AudioEngine();
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const renderer = new Canvas2DRenderer(canvas);
const flashLimiter = new FlashLimiter(canvas);
const viewport = createViewport(16 / 9);

let currentDoc: PmdiDocument | null = null;
let currentTimeline: MusicTimeline | null = null;
let currentAudioBuffer: AudioBuffer | null = null;
let stepper: StepContextBuilder | null = null;
let behaviourEngine: BehaviourEngine | null = null;
let scene: Scene | null = null;
/** Style pour lequel `scene` a été construite — distinct de `currentStyleId` (la cible désirée), pour détecter un vrai changement. */
let sceneStyleId: StyleId | null = null;

let selectedPresetId: string | null = null;
/** Preset édité via l'éditeur JSON (docs/08) — remplace le catalogue tant qu'actif, jusqu'à sélection d'un autre preset. */
let customPreset: Preset | null = null;
let currentStyleId: StyleId = 'pulse';
let currentMacros: PresetMacros = neutralMacros();
let currentMapping: MappingSchema | null = null;
let currentPalette: Palette | null = null;
let reducedFlashing = false;

let simT = 0;
/** Dernier `audioEngine.t` vu par la boucle — sert à dériver un delta CORRIGÉ (voir `loop()`). */
let lastAudioT = 0;
const fixedStep = new FixedStep(FIXED_DT);
let lastFrameMs: number | null = null;
let fpsSmoothed = 0;
let lastRegime = '—';
let importAbortController: AbortController | null = null;

// ---------------------------------------------------------------------------
// Résolution de la configuration active (preset choisi + macros + surcharges)
// ---------------------------------------------------------------------------

/**
 * `style`/`macros`/`safety` sont TOUJOURS écrasés par l'état local courant,
 * même quand un preset (catalogue ou édité) est actif : le sélecteur de
 * style du panneau Avancé et les curseurs de macro doivent rester utilisables
 * indépendamment du preset choisi, pas verrouillés par lui.
 */
function activePresetObject(): Preset {
  const catalogPreset = PRESET_CATALOG.find((p) => p.id === selectedPresetId);
  const base = catalogPreset ?? customPreset ?? buildFallbackPreset(currentStyleId, currentMacros, reducedFlashing);
  return { ...base, style: currentStyleId, macros: currentMacros, safety: { reducedFlashing } };
}

/**
 * Ne recrée la `Scene` QUE si le style change réellement : reconstruire à
 * chaque glissement de macro viderait le pool de particules (`ParticleField`)
 * et la traînée de feedback (`FrameFeedback`) — un `reset()` visible et
 * disruptif à chaque toucher de curseur. À style inchangé, seule la palette
 * est réinjectée via `scene.init()` (les couches la relisent sans perdre
 * leur état de simulation).
 *
 * Limite connue assumée (docs/JOURNAL.md, Étape 14/P12) : `BehaviourEngine`
 * N'A PAS ce garde — il est reconstruit à chaque appel, ce qui remet à zéro
 * les enveloppes `Impulse`/`Continuous` en cours (`BehaviourEngine.ts` n'a
 * pas de méthode pour changer son `mapping` sans se reconstruire). Effet
 * perceptible : un bref à-coup sur l'enveloppe en cours si un macro-curseur
 * est déplacé pendant qu'un impact décroît. Non corrigé ici — retoucher
 * `BehaviourEngine` (déjà livré et vérifié en P6) est hors périmètre de
 * cette étape.
 */
function applyActiveConfiguration(): void {
  const preset = activePresetObject();
  const resolved = resolvePreset(preset);

  currentMapping = resolved.mapping;
  currentPalette = resolved.palette;
  flashLimiter.setReducedFlashing(resolved.safety.reducedFlashing);

  const styleChanged = currentStyleId !== sceneStyleId;

  if (styleChanged) {
    scene = STYLE_FACTORIES[currentStyleId]();
    sceneStyleId = currentStyleId;
    scene.init({ renderer, palette: currentPalette });
    if (currentTimeline) scene.reset(simT);
  } else if (scene) {
    scene.init({ renderer, palette: currentPalette });
  }

  if (currentTimeline) {
    behaviourEngine = new BehaviourEngine(currentTimeline, currentMapping);
  }

  simplePanel.setPalette(currentPalette);
  simplePanel.setMacros(currentMacros);
  advancedPanel.setMacros(currentMacros);
  advancedPanel.selectStyle(currentStyleId);
  advancedPanel.setReducedFlashing(resolved.safety.reducedFlashing);
}

// ---------------------------------------------------------------------------
// Panneaux
// ---------------------------------------------------------------------------

const simplePanel = new SimplePanel({
  onPresetSelect: (id) => {
    selectedPresetId = id;
    customPreset = null;
    const preset = PRESET_CATALOG.find((p) => p.id === id);
    currentMacros = preset?.macros ?? neutralMacros();
    currentStyleId = preset?.style ?? currentStyleId;
    applyActiveConfiguration();
  },
  onMacroChange: (name, value) => {
    currentMacros = { ...currentMacros, [name]: value };
    applyActiveConfiguration();
  },
  onExportFormatChange: (formatId) => {
    const exportFormatSelect = document.querySelector<HTMLSelectElement>('#export-format')!;
    exportFormatSelect.value = formatId;
  },
});
simplePanel.setPresetCatalog(PRESET_CATALOG);

const advancedPanel = new AdvancedPanel({
  onStyleSelect: (styleId) => {
    currentStyleId = styleId;
    applyActiveConfiguration();
  },
  onMacroChange: (name, value) => {
    currentMacros = { ...currentMacros, [name]: value };
    applyActiveConfiguration();
  },
  onReducedFlashingChange: (reduced) => {
    reducedFlashing = reduced;
    applyActiveConfiguration();
  },
});

const presetEditorDialog = new PresetEditorDialog({
  onApply: (preset) => {
    // Le preset édité devient la config active telle quelle (`customPreset`), jusqu'à
    // sélection d'un autre preset du catalogue (voir `activePresetObject`).
    selectedPresetId = null;
    customPreset = preset;
    currentStyleId = preset.style;
    currentMacros = preset.macros;
    reducedFlashing = preset.safety.reducedFlashing;
    applyActiveConfiguration();
  },
});

document.querySelector<HTMLButtonElement>('#btn-preset-editor-open')!.addEventListener('click', () => {
  presetEditorDialog.open(activePresetObject());
});

const exportDialog = new ExportDialog({
  canvas,
  getTimeline: () => currentTimeline,
  getMapping: () => currentMapping ?? ({} as MappingSchema),
  getPalette: () => currentPalette!,
  getStyleFactory: () => STYLE_FACTORIES[currentStyleId],
  getAudioBuffer: () => currentAudioBuffer,
  seekToStart: () => handleSeek(0, 'release'),
  play: () => audioEngine.play(),
  pause: () => audioEngine.pause(),
});

// ---------------------------------------------------------------------------
// Onglets Simple / Avancé
// ---------------------------------------------------------------------------

const tabSimple = document.querySelector<HTMLButtonElement>('#tab-simple')!;
const tabAdvanced = document.querySelector<HTMLButtonElement>('#tab-advanced')!;
const panelSimple = document.querySelector<HTMLElement>('#panel-simple')!;
const panelAdvanced = document.querySelector<HTMLElement>('#panel-advanced')!;

function selectTab(tab: 'simple' | 'advanced'): void {
  const simple = tab === 'simple';
  tabSimple.setAttribute('aria-selected', String(simple));
  tabAdvanced.setAttribute('aria-selected', String(!simple));
  panelSimple.hidden = !simple;
  panelAdvanced.hidden = simple;
}
tabSimple.addEventListener('click', () => selectTab('simple'));
tabAdvanced.addEventListener('click', () => selectTab('advanced'));

// ---------------------------------------------------------------------------
// Timeline (frise)
// ---------------------------------------------------------------------------

const timelineCanvas = document.querySelector<HTMLCanvasElement>('#timeline-canvas')!;
const timelineComponent = new Timeline({
  canvas: timelineCanvas,
  onSeek: (t, kind) => handleSeek(t, kind),
});

function resizeTimelineCanvas(): void {
  const rect = timelineCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  timelineCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  timelineCanvas.height = Math.max(1, Math.round(rect.height * dpr));
}

function handleSeek(t: number, kind: 'scrub' | 'release'): void {
  if (!currentTimeline || !stepper || !behaviourEngine || !scene) return;
  audioEngine.seek(t);
  simT = t;
  lastAudioT = t;
  fixedStep.reset();
  scene.reset(t);
  behaviourEngine.reset(t);
  primeAfterSeek({
    t,
    windowSec: kind === 'scrub' ? SCRUB_PRIME_WINDOW_SEC : RELEASE_PRIME_WINDOW_SEC,
    stepper,
    behaviourEngine,
    scene,
    renderer,
    viewport,
  });
  timelineComponent.setPlayhead(t);
}

// ---------------------------------------------------------------------------
// Import de fichier (glisser-déposer + sélecteur + démo)
// ---------------------------------------------------------------------------

const dropzone = document.querySelector<HTMLElement>('#dropzone')!;
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
const importErrorEl = document.querySelector<HTMLElement>('#import-error')!;
const analysisStatus = document.querySelector<HTMLElement>('#analysis-status')!;
const analysisStage = document.querySelector<HTMLElement>('#analysis-stage')!;
const analysisProgress = document.querySelector<HTMLProgressElement>('#analysis-progress')!;

document.querySelector<HTMLButtonElement>('#btn-pick-file')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
});

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragover');
  const file = event.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
});

document.querySelector<HTMLButtonElement>('#btn-demo')!.addEventListener('click', () => void loadDemo());

async function loadFile(file: File): Promise<void> {
  importErrorEl.textContent = '';
  importAbortController?.abort();
  const controller = new AbortController();
  importAbortController = controller;

  try {
    await audioEngine.load(file);
  } catch (err) {
    importErrorEl.textContent =
      err instanceof AudioValidationError ? err.message : `Impossible de lire ce fichier : ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  const audioBuffer = audioEngine.decodedBuffer;
  if (!audioBuffer) return;
  await runImportPipeline(audioBuffer, controller.signal);
}

/**
 * Passe par le VRAI `AudioEngine.load()` (un ton WAV synthétique tient lieu
 * de fichier, voir `demoDoc.ts`) — sans ça, `audioEngine.play()` ne ferait
 * rien (aucun `AudioBuffer` décodé) et le bouton Lecture resterait inerte en
 * mode démo.
 */
async function loadDemo(): Promise<void> {
  importErrorEl.textContent = '';
  importAbortController?.abort();

  const file = buildDemoAudioFile(60);
  await audioEngine.load(file);
  const audioBuffer = audioEngine.decodedBuffer;
  if (!audioBuffer) return;
  currentAudioBuffer = audioBuffer;

  const doc = buildDemoDoc(audioBuffer.duration);
  const waveformPeaks = computeWaveformPeaks(downmixToMono(audioBuffer));
  applyImportedDoc(doc, null, waveformPeaks);
}

async function runImportPipeline(audioBuffer: AudioBuffer, abortSignal: AbortSignal): Promise<void> {
  dropzone.classList.add('hidden');
  analysisStatus.classList.remove('hidden');
  analysisProgress.value = 0;
  analysisStage.textContent = 'Analyse…';

  try {
    const imported = await importTrack({
      audioBuffer,
      abortSignal,
      onProgress: (fraction, stage) => {
        analysisProgress.value = fraction;
        analysisStage.textContent = `Analyse — ${stage}`;
      },
    });
    if (abortSignal.aborted) return;
    currentAudioBuffer = audioBuffer;
    applyImportedDoc(imported.doc, imported.suggestion?.preset.id ?? null, imported.waveformPeaks);
    simplePanel.setSuggestion(imported.suggestion);
  } catch (err) {
    if (abortSignal.aborted) return;
    importErrorEl.textContent = `Échec de l'analyse : ${err instanceof Error ? err.message : String(err)}`;
    dropzone.classList.remove('hidden');
  } finally {
    analysisStatus.classList.add('hidden');
  }
}

function applyImportedDoc(doc: PmdiDocument, suggestedPresetId: string | null, waveformPeaks: WaveformPeaks | null): void {
  currentDoc = doc;
  currentTimeline = buildMusicTimeline(doc);
  stepper = new StepContextBuilder(currentTimeline, 1);
  simT = 0;
  lastAudioT = 0;
  fixedStep.reset();

  selectedPresetId = suggestedPresetId;
  customPreset = null;
  const preset = PRESET_CATALOG.find((p) => p.id === suggestedPresetId);
  currentMacros = preset?.macros ?? neutralMacros();
  currentStyleId = preset?.style ?? currentStyleId;
  simplePanel.selectPreset(selectedPresetId);

  applyActiveConfiguration();

  resizeTimelineCanvas();
  timelineComponent.setData({
    duration: doc.audio.duration,
    waveformPeaks,
    downbeats: doc.grid?.downbeats ?? [],
    sections: currentTimeline.sections(),
  });

  outGridConfidence.textContent = doc.confidence.grid.toFixed(2);
  dropzone.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Transport (lecture réelle)
// ---------------------------------------------------------------------------

const btnPlay = document.querySelector<HTMLButtonElement>('#btn-play')!;
const btnPause = document.querySelector<HTMLButtonElement>('#btn-pause')!;
const volumeInput = document.querySelector<HTMLInputElement>('#volume')!;
const outTime = document.querySelector<HTMLElement>('#out-time')!;
const outFps = document.querySelector<HTMLElement>('#out-fps')!;
const outRegime = document.querySelector<HTMLElement>('#out-regime')!;
const outClamped = document.querySelector<HTMLElement>('#out-clamped')!;
const outGridConfidence = document.querySelector<HTMLElement>('#out-grid-confidence')!;

btnPlay.addEventListener('click', () => audioEngine.play());
btnPause.addEventListener('click', () => audioEngine.pause());
volumeInput.addEventListener('input', () => audioEngine.setVolume(Number(volumeInput.value)));
audioEngine.setVolume(Number(volumeInput.value));

document.querySelector<HTMLButtonElement>('#btn-fullscreen')!.addEventListener('click', () => {
  const wrap = document.querySelector<HTMLElement>('#preview-wrap')!;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void wrap.requestFullscreen();
});

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

window.addEventListener('resize', () => {
  resizeCanvas();
  resizeTimelineCanvas();
});

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}
resizeCanvas();
resizeTimelineCanvas();

// ---------------------------------------------------------------------------
// Boucle de rendu — docs/03_DATA_FLOW.md FLUX 2, Transport RÉEL (AudioEngine)
// ---------------------------------------------------------------------------

function loop(nowMs: number): void {
  audioEngine.tick(nowMs);

  if (lastFrameMs !== null) {
    const frameDt = (nowMs - lastFrameMs) / 1000;
    if (frameDt > 0) fpsSmoothed = fpsSmoothed === 0 ? 1 / frameDt : fpsSmoothed * 0.9 + (1 / frameDt) * 0.1;
  }
  lastFrameMs = nowMs;

  if (audioEngine.playing && stepper && behaviourEngine && scene && currentTimeline) {
    // `audioEngine.dt` est le delta BRUT (non corrigé) — `audioEngine.t`, lui, intègre la
    // correction de dérive de `correctDrift()` (±2ms/image, convergence douce vers l'horloge
    // audio réelle). Alimenter l'accumulateur avec le delta de `t` plutôt que `dt` fait hériter
    // `simT` de cette correction ; sinon `simT` s'écarte lentement de la position audio réelle au
    // fil de la lecture (dérive constatée au navigateur avant ce correctif — voir docs/JOURNAL.md,
    // Étape 14/P12).
    const audioAdvance = Math.max(0, audioEngine.t - lastAudioT);
    lastAudioT = audioEngine.t;
    const steps = fixedStep.advance(Math.min(audioAdvance, 0.25));
    for (let i = 0; i < steps; i++) {
      simT = Math.min(currentTimeline.duration, simT + FIXED_DT);
      const step = stepper.build(simT);
      const signals = behaviourEngine.update(step);
      scene.update(step, signals);
      lastRegime = step.regime;
    }
    timelineComponent.setPlayhead(simT);
  }

  if (scene && currentPalette) {
    renderer.beginFrame(viewport);
    renderer.clear(currentPalette.bg[1]);
    scene.draw(renderer, viewport);
    renderer.endFrame();
    flashLimiter.apply(simT);
  }

  outTime.textContent = `${formatTime(simT)} / ${formatTime(currentTimeline?.duration ?? 0)}`;
  outFps.textContent = fpsSmoothed.toFixed(1);
  outRegime.textContent = lastRegime;
  outClamped.textContent = String(flashLimiter.clampedCount);
}

function raf(nowMs: number): void {
  loop(nowMs);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// ---------------------------------------------------------------------------
// Configuration initiale ("Aucun" preset, style Pulse par défaut)
// ---------------------------------------------------------------------------
applyActiveConfiguration();

/** Console de développement — dev uniquement (import.meta.env.DEV), même convention que main.ts (P7-P11). */
if (import.meta.env.DEV) {
  (window as unknown as { __pulsarDebug: unknown }).__pulsarDebug = {
    step: (dtSeconds = 1 / 60) => loop((lastFrameMs ?? performance.now()) + dtSeconds * 1000),
    play: () => btnPlay.click(),
    pause: () => btnPause.click(),
    loadDemo: () => void loadDemo(),
    get t() {
      return simT;
    },
  };
}
