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
import { PRESET_CATALOG, resolvePreset, validatePreset, type Preset, type PresetMacros, type StyleId, MACRO_NAMES } from '../presets/index';
import type { MacroName } from '../presets/schema';
import { applyLayerMacrosToScene } from '../presets/layerMacros';
import { importTrack, type ImportedTrack } from './pipeline';
import { LiveAudioSource } from '../audio/LiveAudioSource';
import { LiveVisualPanel } from './live/LiveVisualPanel';
import { buildDemoAudioFile, buildDemoDoc } from './demoDoc';
import { downmixToMono } from '../audio/downmix';
import { computeWaveformPeaks } from '../analysis/waveformPeaks';
import { primeAfterSeek, RELEASE_PRIME_WINDOW_SEC, SCRUB_PRIME_WINDOW_SEC } from './seekPriming';
import { Timeline } from './timeline/Timeline';
import { SimplePanel } from './panels/SimplePanel';
import { AdvancedPanel } from './panels/AdvancedPanel';
import { PresetEditorDialog } from './dialogs/PresetEditorDialog';
import { ExportDialog } from './dialogs/ExportDialog';
import {
  openDatabase,
  saveProject,
  listProjects,
  deleteProject,
  cacheAudio,
  getCachedAudio,
  cacheAnalysis,
  getCachedAnalysis,
  requestPersistentStorage,
} from '../project/storage/db';
import { CURRENT_PROJECT_VERSION, ProjectError, type Project } from '../project/Project';
import { computePresetDiff, applyPresetDiff } from '../project/diff';
import { computeAudioHash, computeCacheKey } from '../project/cacheKey';
import { writePvprojBlob, readPvprojBlob, PvprojFormatError } from '../project/pvproj';
import { QualityGovernor } from '../perf/QualityGovernor';
import { PerfMonitor } from '../perf/PerfMonitor';
import { QUALITY_LEVEL_CONFIGS, EXPORT_QUALITY_LEVEL, type QualityLevel } from '../perf/qualityLevels';

/**
 * `field` est le seul style avec un consommateur réel du plafond de
 * particules (`ParticleField`, Étape 16/P14) — `pulse`/`spectrum-pro`
 * ignorent l'argument optionnel sans erreur (JS ignore les arguments
 * surnuméraires), donc les appeler tous via cette même signature est sans
 * risque et évite un branchement par style à chaque appel.
 */
const STYLE_FACTORIES: Readonly<Record<StyleId, (maxParticles?: number, feedbackEnabled?: boolean) => Scene>> = {
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
/** Timeline pour laquelle `behaviourEngine` a été construit — distinct de `currentTimeline`, même rôle que `sceneStyleId` pour `scene` (Étape 28). */
let behaviourEngineTimeline: MusicTimeline | null = null;
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

// --- Performance (Étape 16/P14, docs/10_PERFORMANCE.md) -----------------------

const qualityGovernor = new QualityGovernor({ initialLevel: 'high' });
const perfMonitor = new PerfMonitor();
let currentQualityLevel: QualityLevel = 'high';
let qualityChangeReason: 'auto' | 'manual' = 'auto';
/**
 * Vrai pendant tout export (`ExportDialog.onExportStart`/`onExportEnd`) :
 * le `QualityGovernor` cesse d'être nourri par `loop()` pour toute la durée
 * (docs/10 règle non négociable #2 : « désactive le QualityGovernor pour
 * toute sa durée »). Le rendu d'export lui-même est de toute façon toujours
 * figé à `EXPORT_QUALITY_LEVEL` via `getStyleFactory` ci-dessous, indépendamment
 * de ce booléen — celui-ci sert seulement à éviter qu'un export qui monopolise
 * le thread principal (docs/10 : rendu d'export en V1 = thread principal) ne
 * fasse chuter à tort le niveau de la PREVIEW pendant que l'export tourne.
 */
let exportInProgress = false;

// --- Persistance (Étape 15/P13, docs/13_PROJECT_FORMAT.md) --------------------

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

let db: IDBDatabase | null = null;
let projectId: string = crypto.randomUUID();
let projectName = 'Projet sans titre';
let projectCreatedAt = new Date().toISOString();
/** Graine du PRNG — sauvegardée (docs/13 §"La graine est sauvegardée") : sans elle, deux ouvertures du même projet produiraient deux rendus différents. */
let projectSeed = randomSeed();
let audioFileName: string | null = null;
let audioFileSize = 0;
let audioHash: string | null = null;
let analysisCacheKeyValue: string | null = null;
let autosaveTimer: number | null = null;
/** Identité stable de la démo synthétique (voir loadDemo()) — un seul projet sauvegardé, mis à jour à chaque clic, pas un nouveau par clic. */
let demoProjectId: string | null = null;
let demoProjectCreatedAt: string | null = null;

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
 * `BehaviourEngine` suit le même principe depuis l'Étape 28 (corrige la
 * limite connue depuis l'Étape 14/P12) : `behaviourEngineTimeline` détecte
 * un vrai changement de morceau, comme `sceneStyleId` pour `scene` —
 * `BehaviourEngine.setMapping()` (Étape 28) recâble sans perdre les
 * enveloppes `Impulse`/`Continuous` en cours si le timeline n'a pas changé ;
 * seule une reconstruction fraîche (nouveau morceau chargé) justifie encore
 * `new BehaviourEngine(...)`.
 */
function applyActiveConfiguration(): void {
  const preset = activePresetObject();
  const resolved = resolvePreset(preset);

  currentMapping = resolved.mapping;
  currentPalette = resolved.palette;
  flashLimiter.setReducedFlashing(resolved.safety.reducedFlashing);

  const styleChanged = currentStyleId !== sceneStyleId;

  if (styleChanged) {
    // Le plafond du niveau de qualité courant s'applique dès la construction (voir `applyQualityLevel`
    // pour le cas où le niveau change alors que le style `field` est DÉJÀ actif).
    scene = STYLE_FACTORIES[currentStyleId](
      QUALITY_LEVEL_CONFIGS[currentQualityLevel].maxParticles,
      QUALITY_LEVEL_CONFIGS[currentQualityLevel].feedback,
    );
    sceneStyleId = currentStyleId;
    scene.init({ renderer, palette: currentPalette });
    if (currentTimeline) scene.reset(simT);
  } else if (scene) {
    scene.init({ renderer, palette: currentPalette });
  }
  applyLayerMacros();
  renderer.setBloomConfig(QUALITY_LEVEL_CONFIGS[currentQualityLevel].bloom);
  renderer.setChromaticAberration(QUALITY_LEVEL_CONFIGS[currentQualityLevel].chromaticAberration);
  renderer.setInternalResolutionScale(QUALITY_LEVEL_CONFIGS[currentQualityLevel].internalResolutionScale);

  if (currentTimeline) {
    if (behaviourEngine && behaviourEngineTimeline === currentTimeline) {
      behaviourEngine.setMapping(currentMapping);
    } else {
      behaviourEngine = new BehaviourEngine(currentTimeline, currentMapping);
      behaviourEngineTimeline = currentTimeline;
    }
  }

  simplePanel.setPalette(currentPalette);
  simplePanel.setMacros(currentMacros);
  advancedPanel.setMacros(currentMacros);
  advancedPanel.selectStyle(currentStyleId);
  advancedPanel.setReducedFlashing(resolved.safety.reducedFlashing);
  scheduleAutosave();
}

/**
 * Réagit à un changement de niveau de qualité (`QualityGovernor` automatique
 * ou choix manuel via le sélecteur) : seul le style `field` a aujourd'hui un
 * consommateur réel du plafond de particules (`ParticleField` — voir
 * docs/JOURNAL.md, Étape 16/P14 : bloom/feedback/décalage chromatique/
 * résolution interne/bandes de spectre restent déclarés mais inertes). Le
 * pool étant un `Float32Array` de taille fixe, le seul moyen de le
 * redimensionner est de reconstruire la Scene — les particules vivantes sont
 * perdues à cette occasion, comme à tout changement de style
 * (`applyActiveConfiguration`). Effet accepté : rare par construction (le
 * `QualityGovernor` ne change de niveau qu'après 2 à 8 s de tenue, et au plus
 * 1×/minute en remontée).
 *
 * `chromaticAberration`/`internalResolutionScale` (Étapes 23/24) : câblés
 * indépendamment du style — ce sont des réglages du `Renderer` (docs/07
 * §"Le décalage chromatique"/§"La résolution interne"), pas une couche de
 * Scene, donc pas concernés par la reconstruction ci-dessus.
 */
function applyQualityLevel(level: QualityLevel, reason: 'auto' | 'manual'): void {
  currentQualityLevel = level;
  qualityChangeReason = reason;
  advancedPanel.selectQuality(level);
  renderer.setBloomConfig(QUALITY_LEVEL_CONFIGS[level].bloom);
  renderer.setChromaticAberration(QUALITY_LEVEL_CONFIGS[level].chromaticAberration);
  renderer.setInternalResolutionScale(QUALITY_LEVEL_CONFIGS[level].internalResolutionScale);

  if (currentStyleId === 'field' && sceneStyleId === 'field' && currentPalette) {
    scene = STYLE_FACTORIES.field(QUALITY_LEVEL_CONFIGS[level].maxParticles, QUALITY_LEVEL_CONFIGS[level].feedback);
    scene.init({ renderer, palette: currentPalette });
    if (currentTimeline) scene.reset(simT);
    applyLayerMacros(); // la Scene vient d'être reconstruite : ses couches ont des `params` vides tant qu'on ne les réapplique pas
  }
}

/**
 * Câble `density`/`movement`/`depth`/`glow`/`chaos`/`smoothness` (Étape 20,
 * `presets/layerMacros.ts`) sur `layer.params` de chaque couche de la Scene
 * active — SANS jamais reconstruire la Scene (contrairement à un changement
 * de style ou de niveau de qualité) : chaque couche lit ses `params` à
 * chaque `update()`/`draw()`, donc réassigner l'objet suffit à faire
 * apparaître l'effet dès l'image suivante, pool de particules et traînée de
 * feedback intacts. `energy`/`reactivity` restent sur `WIRED_MACRO_CURVES` →
 * `mapping.*` → `BehaviourEngine` (`resolvePreset`, inchangé).
 *
 * `bandCount` (Étape 25, `spectrumBars` uniquement) : injecté APRÈS
 * `applyLayerMacrosToScene`, ce n'est pas un macro-curseur mais un réglage du
 * niveau de qualité (`QUALITY_LEVEL_CONFIGS[...].spectrumBands`) — même
 * source que `bloom`/`chromaticAberration`/`internalResolutionScale`, mais
 * c'est un `layer.params`, pas un réglage de `Renderer`.
 *
 * Boucle macros extraite dans `presets/layerMacros.ts::applyLayerMacrosToScene`
 * (Étape 26) : appelée IDENTIQUEMENT ici et par `ExportPipeline.ts::runExport()`
 * — l'export construisait jusque-là sa propre Scene sans jamais appliquer ces
 * 6 macros, gap découvert et signalé à l'Étape 25, corrigé en partageant cette
 * fonction plutôt qu'en dupliquant la boucle dans les deux fichiers.
 */
function applyLayerMacros(): void {
  if (!scene) return;
  applyLayerMacrosToScene(scene, currentMacros, currentStyleId);
  const spectrumBarsLayer = scene.layers.find((l) => l.id === 'spectrumBars');
  if (spectrumBarsLayer) {
    spectrumBarsLayer.params = { ...spectrumBarsLayer.params, bandCount: QUALITY_LEVEL_CONFIGS[currentQualityLevel].spectrumBands };
  }
}

/** Première couche de la Scene active à exposer `particleStats()` (au plus une, aujourd'hui : `ParticleField`). */
function findParticleStats(): { readonly live: number; readonly capacity: number } | null {
  if (!scene) return null;
  for (const layer of scene.layers) {
    if (layer.particleStats) return layer.particleStats();
  }
  return null;
}

/**
 * Tolérance "Sync" — pas documentée en valeur exacte par docs/10 (juste
 * l'exemple « +4,2 ms ✅ »), donc choisie ici : un sous-pas de simulation
 * (`FIXED_DT`, 1/120 s ≈ 8,33 ms). Au-delà, l'écart entre `simT` et la
 * position audio réelle dépasse ce que le pas fixe peut rattraper en une
 * seule image — signal honnête plutôt qu'un seuil arbitraire sans rapport
 * avec la mécanique réelle de la boucle.
 */
const SYNC_TOLERANCE_MS = FIXED_DT * 1000;

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
  onQualitySelect: (level) => {
    qualityGovernor.setManualLevel(level);
    applyQualityLevel(level, 'manual');
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
  // docs/10 règle non négociable #2 : l'export fige TOUJOURS le niveau à `EXPORT_QUALITY_LEVEL`
  // (HIGH), quel que soit le niveau courant de la preview — jamais `currentQualityLevel` ici.
  getStyleFactory: () => () =>
    STYLE_FACTORIES[currentStyleId](
      QUALITY_LEVEL_CONFIGS[EXPORT_QUALITY_LEVEL].maxParticles,
      QUALITY_LEVEL_CONFIGS[EXPORT_QUALITY_LEVEL].feedback,
    ),
  getMacros: () => currentMacros,
  getStyleId: () => currentStyleId,
  getAudioBuffer: () => currentAudioBuffer,
  getProjectSeed: () => projectSeed,
  seekToStart: () => handleSeek(0, 'release'),
  play: () => audioEngine.play(),
  pause: () => audioEngine.pause(),
  onExportStart: () => {
    exportInProgress = true;
  },
  onExportEnd: () => {
    exportInProgress = false;
  },
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
  // `audioEngine.load()` bascule sur le nouveau fichier dès sa résolution, mais `currentTimeline`/
  // `scene`/`currentAudioBuffer` ne rattrapent l'ancien qu'après l'analyse (peut prendre plusieurs
  // secondes, Worker) — pas seulement en cas d'imports qui se chevauchent (piège #11) : un import
  // simple, seul, suffit à ouvrir cette fenêtre. Scruber pendant cette fenêtre appliquerait le seek
  // au NOUVEL audio avec l'ANCIENNE grille de battements/sections encore affichée. `currentAudioBuffer`
  // n'est mis à jour qu'une fois l'analyse terminée (voir loadFile/loadDemo/restoreProject) : tant
  // qu'il diffère de ce que le moteur a réellement chargé, la timeline affichée est encore périmée.
  if (currentAudioBuffer !== audioEngine.decodedBuffer) return;
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

/**
 * Nouveau projet à partir d'un fichier fraîchement importé : identité,
 * graine et hash tout neufs. `displayName` (titre du projet, sans
 * extension) et `file.name` (référence audio EXACTE, avec extension —
 * doit rester le vrai nom pour que la ré-association par nom+hash, docs/13,
 * ait un sens) sont deux choses distinctes — un bug réel de cette étape,
 * corrigé avant toute vérification navigateur : les deux partageaient le
 * même nom tronqué.
 */
async function startNewProjectIdentity(displayName: string, file: File): Promise<void> {
  projectId = crypto.randomUUID();
  projectName = displayName;
  projectCreatedAt = new Date().toISOString();
  projectSeed = randomSeed();
  audioFileName = file.name;
  audioFileSize = file.size;
  audioHash = await computeAudioHash(await file.arrayBuffer());
  if (db && audioHash) void cacheAudio(db, audioHash, file);
}

async function loadFile(file: File): Promise<void> {
  importErrorEl.textContent = '';
  importAbortController?.abort();
  const controller = new AbortController();
  importAbortController = controller;

  try {
    await audioEngine.load(file, controller.signal);
  } catch (err) {
    importErrorEl.textContent =
      err instanceof AudioValidationError ? err.message : `Impossible de lire ce fichier : ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  if (controller.signal.aborted) return; // piège #11 (AudioEngine.ts) : un import plus récent a déjà pris le dessus

  const audioBuffer = audioEngine.decodedBuffer;
  if (!audioBuffer) return;
  await startNewProjectIdentity(file.name.replace(/\.[^.]+$/, ''), file);

  const imported = await runAnalysisWithProgress(audioBuffer, controller.signal);
  if (!imported) return;
  currentAudioBuffer = audioBuffer;
  if (audioHash) {
    analysisCacheKeyValue = await computeCacheKey(audioHash, 'balanced');
    if (db) void cacheAnalysis(db, analysisCacheKeyValue, imported.doc);
  }
  applyImportedDoc(imported.doc, imported.suggestion?.preset.id ?? null, imported.waveformPeaks);
  simplePanel.setSuggestion(imported.suggestion);
}

/**
 * Passe par le VRAI `AudioEngine.load()` (un ton WAV synthétique tient lieu
 * de fichier, voir `demoDoc.ts`) — sans ça, `audioEngine.play()` ne ferait
 * rien (aucun `AudioBuffer` décodé) et le bouton Lecture resterait inerte en
 * mode démo. Le hash/cache s'appliquent aussi à la démo, pour rester
 * cohérent avec le chemin réel — sans conséquence pratique (contenu déterministe).
 */
async function loadDemo(): Promise<void> {
  importErrorEl.textContent = '';
  importAbortController?.abort();
  const controller = new AbortController();
  importAbortController = controller;

  const file = buildDemoAudioFile(60);
  await audioEngine.load(file, controller.signal);
  if (controller.signal.aborted) return; // piège #11 (AudioEngine.ts) : un import plus récent a déjà pris le dessus
  const audioBuffer = audioEngine.decodedBuffer;
  if (!audioBuffer) return;
  currentAudioBuffer = audioBuffer;
  await startNewProjectIdentity('Démo synthétique', file);
  // Charger la démo plusieurs fois met à jour LE MÊME projet (comme "Nouvelle variante",
  // ci-dessous) plutôt que d'en accumuler un nouveau à chaque clic dans le panneau Projets —
  // startNewProjectIdentity() donne à chaque fois une identité neuve, ici volontairement
  // remplacée par l'identité stable de la démo après coup.
  if (demoProjectId === null) {
    demoProjectId = projectId;
    demoProjectCreatedAt = projectCreatedAt;
  } else {
    projectId = demoProjectId;
    projectCreatedAt = demoProjectCreatedAt!;
  }

  const doc = buildDemoDoc(audioBuffer.duration);
  const waveformPeaks = computeWaveformPeaks(downmixToMono(audioBuffer));
  applyImportedDoc(doc, null, waveformPeaks);
}

/** Affiche/masque la progression d'analyse autour de `importTrack` — partagé entre import direct et restauration de projet (cache d'analyse manquant). */
async function runAnalysisWithProgress(audioBuffer: AudioBuffer, abortSignal: AbortSignal): Promise<ImportedTrack | null> {
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
    return abortSignal.aborted ? null : imported;
  } catch (err) {
    if (!abortSignal.aborted) {
      importErrorEl.textContent = `Échec de l'analyse : ${err instanceof Error ? err.message : String(err)}`;
      dropzone.classList.remove('hidden');
    }
    return null;
  } finally {
    analysisStatus.classList.add('hidden');
  }
}

/** Construit la timeline/scène pour un document déjà décidé, SANS toucher au preset actif — partagé par `applyImportedDoc` (suggestion) et `restoreProject` (préset restauré). */
function applyDocCore(doc: PmdiDocument, waveformPeaks: WaveformPeaks | null): void {
  currentDoc = doc;
  currentTimeline = buildMusicTimeline(doc);
  stepper = new StepContextBuilder(currentTimeline, projectSeed);
  simT = 0;
  lastAudioT = 0;
  fixedStep.reset();

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

function applyImportedDoc(doc: PmdiDocument, suggestedPresetId: string | null, waveformPeaks: WaveformPeaks | null): void {
  selectedPresetId = suggestedPresetId;
  customPreset = null;
  const preset = PRESET_CATALOG.find((p) => p.id === suggestedPresetId);
  currentMacros = preset?.macros ?? neutralMacros();
  currentStyleId = preset?.style ?? currentStyleId;
  simplePanel.selectPreset(selectedPresetId);
  applyDocCore(doc, waveformPeaks);
}

// ---------------------------------------------------------------------------
// Persistance — projet (Étape 15/P13, docs/13_PROJECT_FORMAT.md)
// ---------------------------------------------------------------------------

interface PersistedVisualState {
  readonly macros: PresetMacros;
  readonly style: StyleId;
  readonly reducedFlashing: boolean;
}

/** Valeurs par défaut d'un preset (ou de "Aucun") — base du diff `visual.overrides` (docs/13 §"Les surcharges sont un diff"). */
function visualStateBase(presetId: string | null): PersistedVisualState {
  const preset = PRESET_CATALOG.find((p) => p.id === presetId);
  return { macros: preset?.macros ?? neutralMacros(), style: preset?.style ?? 'pulse', reducedFlashing: false };
}

/**
 * `customPreset` (Étape 29, corrige la limite connue depuis l'Étape 15/P13) :
 * sauvé EN ENTIER dans `visual.customPreset` quand actif — `overrides` seul
 * (diff, calculé ci-dessous comme avant, toujours présent pour compatibilité)
 * ne peut pas capturer fidèlement `mapping`/`palette`/`classification`
 * (tableaux, hors du format diff — voir `ProjectVisual.customPreset`,
 * `project/Project.ts`). `restoreProject` privilégie `customPreset` quand
 * présent et valide, sinon retombe sur le mécanisme diff existant.
 */
function buildCurrentProject(): Project | null {
  if (!currentDoc || !audioHash || !audioFileName) return null;
  const base = visualStateBase(selectedPresetId);
  const current: PersistedVisualState = { macros: currentMacros, style: currentStyleId, reducedFlashing };
  const overrides = computePresetDiff(base as unknown as Record<string, unknown>, current as unknown as Record<string, unknown>);
  const catalogPreset = PRESET_CATALOG.find((p) => p.id === selectedPresetId);

  return {
    format: 'pvproj',
    version: CURRENT_PROJECT_VERSION,
    meta: { id: projectId, name: projectName, createdAt: projectCreatedAt, modifiedAt: new Date().toISOString(), app: 'pulsar-visualizer@0.0.0-p0' },
    audio: { ref: { kind: 'file', name: audioFileName, size: audioFileSize, hash: audioHash }, duration: currentDoc.audio.duration },
    music: { mode: 'analysis', analysisProfile: 'balanced', cacheKey: analysisCacheKeyValue ?? undefined },
    visual: {
      presetId: selectedPresetId ?? 'none',
      presetVersion: catalogPreset?.version ?? 1,
      overrides,
      ...(customPreset ? { customPreset: customPreset as unknown as Record<string, unknown> } : {}),
    },
    export: { format: '16:9', resolution: [1920, 1080], fps: 30, bitrateMbps: 12, codec: 'h264' },
    // `prefs.quality` (type déjà anticipé en P13, câblé au vrai `QualityGovernor` en P14/Étape 16) :
    // 'auto' si le niveau courant vient du gouverneur, sinon le niveau choisi manuellement — restauré
    // par `restoreProject` (voir plus bas).
    prefs: { reducedFlashing, quality: qualityChangeReason === 'manual' ? currentQualityLevel : 'auto', debugOverlay: false },
    seed: projectSeed,
  };
}

/**
 * Vignette = image actuellement affichée, pas "à 25 % de la durée"
 * (docs/13) — chercher/dessiner à 25 % exigerait de déplacer la tête de
 * lecture rien que pour la capture, perturbant l'écoute en cours. Simplifié
 * délibérément ; voir docs/JOURNAL.md, Étape 15/P13.
 */
function captureThumbnail(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('capture de vignette impossible'))), 'image/jpeg', 0.8);
  });
}

const autosaveStatusEl = document.querySelector<HTMLElement>('#autosave-status')!;

async function saveCurrentProject(): Promise<void> {
  if (!db) return;
  const project = buildCurrentProject();
  if (!project) return;
  try {
    const thumbnail = await captureThumbnail();
    await saveProject(db, project, thumbnail);
    autosaveStatusEl.textContent = `Enregistré ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    autosaveStatusEl.textContent = 'Échec de la sauvegarde automatique';
    console.error(err);
  }
}

/** Sauvegarde automatique par diff toutes les 5s après une modification (docs/13 §"Persistance IndexedDB"). */
function scheduleAutosave(): void {
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => void saveCurrentProject(), 5000);
}

// --- Ré-association de l'audio par empreinte (docs/13 : "redemandé proprement, vérifié par hash") ---

const relinkDialog = document.querySelector<HTMLDialogElement>('#relink-audio-dialog')!;
const relinkMessage = document.querySelector<HTMLElement>('#relink-audio-message')!;
const relinkError = document.querySelector<HTMLElement>('#relink-audio-error')!;
const relinkFileInput = document.querySelector<HTMLInputElement>('#relink-file-input')!;
let relinkResolve: ((blob: Blob | null) => void) | null = null;
let expectedRelinkHash: string | undefined;

document.querySelector<HTMLButtonElement>('#btn-relink-pick')!.addEventListener('click', () => relinkFileInput.click());
document.querySelector<HTMLButtonElement>('#btn-relink-cancel')!.addEventListener('click', () => {
  relinkDialog.close();
  relinkResolve?.(null);
  relinkResolve = null;
});
relinkFileInput.addEventListener('change', () => {
  const file = relinkFileInput.files?.[0];
  if (file) void handleRelinkFile(file);
});

async function handleRelinkFile(file: File): Promise<void> {
  if (expectedRelinkHash) {
    const hash = await computeAudioHash(await file.arrayBuffer());
    if (hash !== expectedRelinkHash) {
      relinkError.textContent = 'Ce fichier ne correspond pas (empreinte différente) — sélectionne le bon fichier.';
      return;
    }
  }
  relinkDialog.close();
  relinkResolve?.(file);
  relinkResolve = null;
}

function promptRelinkAudio(filename: string, expectedHash: string | undefined): Promise<Blob | null> {
  expectedRelinkHash = expectedHash;
  relinkMessage.textContent = `Fichier « ${filename} » introuvable dans le cache local. Sélectionne-le à nouveau — son nom peut avoir changé, il sera vérifié par empreinte.`;
  relinkError.textContent = '';
  relinkDialog.showModal();
  return new Promise((resolve) => {
    relinkResolve = resolve;
  });
}

// --- Restauration d'un projet (magasin IndexedDB ou fichier .pvproj importé) ---

async function restoreProject(stored: { id: string; project: Project }, providedAudioBlob?: Blob): Promise<void> {
  const { project } = stored;
  const ref = project.audio.ref;
  if (ref.kind !== 'file') {
    projectsStatus.textContent = "Ce projet ne référence pas de fichier audio local — non pris en charge par cette version.";
    return;
  }

  let audioBlob: Blob | null = providedAudioBlob ?? null;
  if (!audioBlob && ref.hash && db) audioBlob = await getCachedAudio(db, ref.hash);
  if (!audioBlob) {
    audioBlob = await promptRelinkAudio(ref.name, ref.hash);
    if (!audioBlob) return; // annulé par l'utilisateur
  }

  importAbortController?.abort();
  const controller = new AbortController();
  importAbortController = controller;

  const file = new File([audioBlob], ref.name, { type: audioBlob.type || 'audio/mpeg' });
  try {
    await audioEngine.load(file, controller.signal);
  } catch (err) {
    projectsStatus.textContent = `Impossible de charger l'audio : ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  if (controller.signal.aborted) return; // piège #11 (AudioEngine.ts) : un import plus récent a déjà pris le dessus
  const audioBuffer = audioEngine.decodedBuffer;
  if (!audioBuffer) return;

  projectId = project.meta.id;
  projectName = project.meta.name;
  projectCreatedAt = project.meta.createdAt;
  projectSeed = project.seed;
  currentAudioBuffer = audioBuffer;
  audioFileName = ref.name;
  audioFileSize = audioBlob.size; // taille RÉELLE du blob chargé, plus fiable qu'un ref.size potentiellement obsolète
  audioHash = ref.hash ?? (await computeAudioHash(await file.arrayBuffer()));
  if (db && audioHash) void cacheAudio(db, audioHash, audioBlob);

  let doc: PmdiDocument | null = project.music.cacheKey && db ? await getCachedAnalysis(db, project.music.cacheKey) : null;
  let waveformPeaks: WaveformPeaks | null = null;
  if (doc) {
    analysisCacheKeyValue = project.music.cacheKey ?? null;
    waveformPeaks = computeWaveformPeaks(downmixToMono(audioBuffer));
  } else {
    const imported = await runAnalysisWithProgress(audioBuffer, controller.signal);
    if (!imported) return;
    doc = imported.doc;
    waveformPeaks = imported.waveformPeaks;
    if (audioHash) {
      analysisCacheKeyValue = await computeCacheKey(audioHash, 'balanced');
      if (db) void cacheAnalysis(db, analysisCacheKeyValue, doc);
    }
  }

  selectedPresetId = project.visual.presetId === 'none' ? null : project.visual.presetId;
  // Étape 29 : `customPreset` (preset édité via l'éditeur JSON, sauvé EN ENTIER) restauré en
  // priorité quand présent et valide — capture mapping/palette/classification, que le diff
  // `overrides` seul ne peut pas représenter fidèlement (voir `buildCurrentProject`). Repli sur
  // le mécanisme diff existant si absent (projet catalogue + macros, cas courant) ou invalide
  // (défense en profondeur : un fichier corrompu/d'une version future ne doit jamais planter la
  // restauration, juste dégrader vers le comportement d'avant cette étape).
  const restoredCustomPreset = project.visual.customPreset ? validatePreset(project.visual.customPreset) : null;
  if (restoredCustomPreset?.ok) {
    customPreset = restoredCustomPreset.preset;
    currentMacros = customPreset.macros;
    currentStyleId = customPreset.style;
    reducedFlashing = customPreset.safety.reducedFlashing;
  } else {
    customPreset = null;
    const base = visualStateBase(selectedPresetId);
    const restored = applyPresetDiff(base as unknown as Record<string, unknown>, project.visual.overrides) as unknown as PersistedVisualState;
    currentMacros = restored.macros;
    currentStyleId = restored.style;
    reducedFlashing = restored.reducedFlashing;
  }
  simplePanel.selectPreset(selectedPresetId);

  applyDocCore(doc, waveformPeaks);

  // Restaure `prefs.quality` (voir `buildCurrentProject`) APRÈS `applyDocCore` : la Scene existe déjà,
  // donc `applyQualityLevel` peut la reconstruire si nécessaire plutôt que de dupliquer sa logique.
  if (project.prefs.quality === 'auto') {
    qualityGovernor.resetAuto('high');
    applyQualityLevel('high', 'auto');
  } else {
    qualityGovernor.setManualLevel(project.prefs.quality);
    applyQualityLevel(project.prefs.quality, 'manual');
  }
}

// --- Panneau "Projets" : liste IndexedDB, .pvproj export/import ---

const projectsDialog = document.querySelector<HTMLDialogElement>('#projects-dialog')!;
const projectsList = document.querySelector<HTMLElement>('#projects-list')!;
const projectsStatus = document.querySelector<HTMLElement>('#projects-status')!;

document.querySelector<HTMLButtonElement>('#btn-projects-open')!.addEventListener('click', () => {
  projectsDialog.showModal();
  void refreshProjectsList();
});
document.querySelector<HTMLButtonElement>('#btn-projects-close')!.addEventListener('click', () => projectsDialog.close());

async function refreshProjectsList(): Promise<void> {
  if (!db) return;
  const projects = await listProjects(db);
  projectsList.replaceChildren();
  const sorted = [...projects].sort((a, b) => b.project.meta.modifiedAt.localeCompare(a.project.meta.modifiedAt));
  for (const stored of sorted) {
    const li = document.createElement('li');
    li.className = 'project-row';

    const img = document.createElement('img');
    img.src = URL.createObjectURL(stored.thumbnail);
    li.appendChild(img);

    const info = document.createElement('div');
    info.className = 'project-info';
    const name = document.createElement('div');
    name.className = 'project-name';
    name.textContent = stored.project.meta.name;
    const date = document.createElement('div');
    date.className = 'project-date';
    date.textContent = new Date(stored.project.meta.modifiedAt).toLocaleString();
    info.append(name, date);
    li.appendChild(info);

    const btnLoad = document.createElement('button');
    btnLoad.textContent = 'Ouvrir';
    btnLoad.addEventListener('click', () => {
      projectsDialog.close();
      void restoreProject(stored);
    });
    li.appendChild(btnLoad);

    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Supprimer';
    btnDelete.addEventListener('click', () => {
      void (async () => {
        if (db) await deleteProject(db, stored.id);
        void refreshProjectsList();
      })();
    });
    li.appendChild(btnDelete);

    projectsList.appendChild(li);
  }
  projectsStatus.textContent = sorted.length === 0 ? 'Aucun projet enregistré.' : '';
}

document.querySelector<HTMLButtonElement>('#btn-project-save-pvproj')!.addEventListener('click', () => void exportPvproj());

async function exportPvproj(): Promise<void> {
  const project = buildCurrentProject();
  if (!project) {
    projectsStatus.textContent = "Aucun projet à exporter — importe un morceau d'abord.";
    return;
  }
  const thumbnailBlob = await captureThumbnail();
  const thumbnail = new Uint8Array(await thumbnailBlob.arrayBuffer());
  const blob = await writePvprojBlob({ project, thumbnail });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.meta.name || 'projet'}.pvproj`;
  link.click();
  projectsStatus.textContent = 'Fichier .pvproj téléchargé.';
}

const pvprojFileInput = document.querySelector<HTMLInputElement>('#pvproj-file-input')!;
document.querySelector<HTMLButtonElement>('#btn-project-import-pvproj')!.addEventListener('click', () => pvprojFileInput.click());
pvprojFileInput.addEventListener('change', () => {
  const file = pvprojFileInput.files?.[0];
  if (file) void importPvproj(file);
});

async function importPvproj(file: File): Promise<void> {
  try {
    const result = await readPvprojBlob(file);
    projectsDialog.close();
    const embeddedAudio = result.audio ? new Blob([result.audio.data as BlobPart]) : undefined;
    await restoreProject({ id: result.project.meta.id, project: result.project }, embeddedAudio);
  } catch (err) {
    projectsStatus.textContent =
      err instanceof PvprojFormatError || err instanceof ProjectError ? err.message : `Erreur : ${err instanceof Error ? err.message : String(err)}`;
  }
}

// --- "Nouvelle variante" (docs/13 : régénère la graine, effet fort, coût nul) ---

document.querySelector<HTMLButtonElement>('#btn-variant')!.addEventListener('click', () => {
  if (!currentTimeline || !stepper) return;
  projectSeed = randomSeed();
  stepper = new StepContextBuilder(currentTimeline, projectSeed);
  handleSeek(simT, 'release');
  scheduleAutosave();
});

// ---------------------------------------------------------------------------
// Transport (lecture réelle)
// ---------------------------------------------------------------------------

const btnPlay = document.querySelector<HTMLButtonElement>('#btn-play')!;
const btnPause = document.querySelector<HTMLButtonElement>('#btn-pause')!;
const volumeInput = document.querySelector<HTMLInputElement>('#volume')!;
const outTime = document.querySelector<HTMLElement>('#out-time')!;
const outFps = document.querySelector<HTMLElement>('#out-fps')!;
const outPerfPercentiles = document.querySelector<HTMLElement>('#out-perf-percentiles')!;
const outPerfRender = document.querySelector<HTMLElement>('#out-perf-render')!;
const outPerfUpdate = document.querySelector<HTMLElement>('#out-perf-update')!;
const debugStateEl = document.querySelector<HTMLDetailsElement>('#debug-state')!;
const outRegime = document.querySelector<HTMLElement>('#out-regime')!;
const outClamped = document.querySelector<HTMLElement>('#out-clamped')!;
const outGridConfidence = document.querySelector<HTMLElement>('#out-grid-confidence')!;
const outQuality = document.querySelector<HTMLElement>('#out-quality')!;
const outParticles = document.querySelector<HTMLElement>('#out-particles')!;
const outSync = document.querySelector<HTMLElement>('#out-sync')!;

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

  let frameTimeMs = 0;
  if (lastFrameMs !== null) {
    frameTimeMs = nowMs - lastFrameMs;
    const frameDt = frameTimeMs / 1000;
    if (frameDt > 0) fpsSmoothed = fpsSmoothed === 0 ? 1 / frameDt : fpsSmoothed * 0.9 + (1 / frameDt) * 0.1;
  }
  lastFrameMs = nowMs;

  const updateStartMs = performance.now();
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
  const updateMs = performance.now() - updateStartMs;

  const renderStartMs = performance.now();
  if (scene && currentPalette) {
    renderer.beginFrame(viewport);
    renderer.clear(currentPalette.bg[1]);
    scene.draw(renderer, viewport);
    renderer.endFrame();
    flashLimiter.apply(simT);
  }
  const renderMs = performance.now() - renderStartMs;

  // Toujours collecté (docs/10 §"Le moniteur de performance"), même sans image "utile" (pas
  // de morceau chargé, en pause…) : `updateMs`/`renderMs` restent significatifs dans tous les cas.
  perfMonitor.recordFrame({ frameTimeMs, updateMs, renderMs });

  // `snapshot()` trie (coût non négligeable pour ce module, voir son commentaire d'en-tête) —
  // calculé seulement si le panneau debug est OUVERT, pas à chaque image inconditionnellement
  // (Étape 30, corrige la limite connue depuis l'Étape 16/P14 : les données étaient déjà
  // collectées via `recordFrame` ci-dessus, mais `snapshot()` n'était jamais appelé nulle part).
  if (debugStateEl.open) {
    const perf = perfMonitor.snapshot();
    if (perf.sampleCount > 0) {
      outPerfPercentiles.textContent = `${perf.p50Ms.toFixed(1)} / ${perf.p95Ms.toFixed(1)} / ${perf.p99Ms.toFixed(1)} ms`;
      outPerfRender.textContent = `${perf.renderMs.toFixed(1)} ms`;
      outPerfUpdate.textContent = `${perf.updateMs.toFixed(1)} ms`;
    }
  }

  if (!exportInProgress && frameTimeMs > 0) {
    const govResult = qualityGovernor.recordFrame(frameTimeMs);
    if (govResult.changed) applyQualityLevel(govResult.level, 'auto');
  }

  outTime.textContent = `${formatTime(simT)} / ${formatTime(currentTimeline?.duration ?? 0)}`;
  outFps.textContent = fpsSmoothed.toFixed(1);
  outRegime.textContent = lastRegime;
  outClamped.textContent = String(flashLimiter.clampedCount);

  outQuality.textContent = `${currentQualityLevel.toUpperCase()} (${qualityChangeReason === 'auto' ? 'auto' : 'manuel'})`;

  const particleStats = findParticleStats();
  outParticles.textContent = particleStats ? `${particleStats.live} / ${particleStats.capacity}` : '—';

  const syncMs = (lastAudioT - simT) * 1000;
  const syncOk = Math.abs(syncMs) <= SYNC_TOLERANCE_MS;
  outSync.textContent = audioEngine.playing ? `${syncMs >= 0 ? '+' : ''}${syncMs.toFixed(1)} ms ${syncOk ? '✅' : '⚠️'}` : '—';
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

void (async () => {
  try {
    db = await openDatabase();
    void requestPersistentStorage();
  } catch (err) {
    console.error('IndexedDB indisponible — la persistance de projet restera désactivée cette session :', err);
  }
})();

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

/**
 * Étape 52 (hors roadmap) : pont audio depuis un hôte parent qui embarque ce
 * visualizer dans une iframe (ex. un séquenceur qui veut afficher son beat
 * courant sans que l'utilisateur ait à ré-importer un fichier). Le parent
 * poste `{ type: 'pulsar:load-audio', buffer: ArrayBuffer, filename?: string }`
 * — converti en `File` puis passé tel quel à `loadFile()`, le MÊME chemin que
 * l'import glisser-déposer/sélecteur de fichier : aucune nouvelle logique
 * d'analyse/décodage. N'écoute qu'en contexte iframe (`window !== window.top`)
 * pour ne rien changer à l'usage autonome de l'application.
 *
 * Étape 53 (hors roadmap) : `pulsar:live-offer` — pont audio EN DIRECT (WebRTC)
 * sur le MÊME listener plutôt qu'un second `addEventListener`. `LiveAudioSource`
 * répond à l'offre, puis `pc.ontrack` branche l'analyse et démarre
 * `LiveVisualPanel` — un chemin de rendu entièrement séparé du moteur
 * StepContext/BehaviourEngine/Scene (Loi 1), jamais touché ici.
 * `event.source === window.parent` : seule vérification faite, cohérente avec
 * `pulsar:load-audio` ci-dessus — le parent peut être `file://`
 * (`event.origin === "null"`), donc pas de vérification stricte d'origine.
 */
let liveAudioSource: LiveAudioSource | null = null;
let liveCtx: AudioContext | null = null;
let liveVisualPanel: LiveVisualPanel | null = null;

if (window !== window.top) {
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data as { type?: unknown; buffer?: unknown; filename?: unknown; sdp?: unknown } | null;
    if (!data) return;

    if (data.type === 'pulsar:load-audio' && data.buffer instanceof ArrayBuffer) {
      const filename = typeof data.filename === 'string' ? data.filename : 'beat.wav';
      void loadFile(new File([data.buffer], filename, { type: 'audio/wav' }));
      return;
    }

    if (data.type === 'pulsar:live-offer' && data.sdp) {
      void (async () => {
        liveAudioSource?.dispose();
        liveVisualPanel?.stop();
        const wrap = document.querySelector<HTMLElement>('#preview-wrap');
        if (!wrap) return;
        if (!liveVisualPanel) liveVisualPanel = new LiveVisualPanel(wrap);
        const source = new LiveAudioSource({
          onConnectionStateChange: (state) => {
            if (state === 'closed' || state === 'failed' || state === 'disconnected') {
              liveVisualPanel?.stop();
            }
          },
          onTrack: (stream) => {
            if (!liveCtx) liveCtx = new AudioContext();
            // Tailles de FFT et plage dB : defauts de `LiveAudioSource`
            // (2048 / 8192, lissage 0, -90/0 dB), alignes sur `LiveConfig`.
            source.attachAnalysis(liveCtx, stream);
            liveVisualPanel?.start(source);
            // APRÈS `start()` : celui-ci commence par `stop()`, qui relâche la
            // référence au contexte audio (il appartient à App, pas au panneau).
            liveVisualPanel?.attachAudioContext(liveCtx);
          },
        });
        liveAudioSource = source;
        const answer = await source.handleOffer(data.sdp as RTCSessionDescriptionInit);
        (event.source as Window).postMessage({ type: 'pulsar:live-answer', sdp: answer }, '*');
      })();
      return;
    }
  });
}

/** Dev uniquement — accès direct pour la vérification Playwright du pont en direct (Étape 53). */
if (import.meta.env.DEV) {
  (window as unknown as { __pulsarLiveDebug: unknown }).__pulsarLiveDebug = {
    get source() {
      return liveAudioSource;
    },
    get panelActive() {
      return liveVisualPanel?.active ?? false;
    },
    get ctxState() {
      return liveCtx?.state ?? null;
    },
    /** Étape 1 de la refonte live : état du moteur d'analyse et tempo verrouillé. */
    get engineState() {
      return liveVisualPanel?.engineState ?? 'STOPPED';
    },
    get bpm() {
      return liveVisualPanel?.bpm ?? 0;
    },
    /** Étape 3 de la refonte live : scène courante et sélection manuelle pour la vérification. */
    get sceneId() {
      return liveVisualPanel?.sceneId ?? '-';
    },
    selectScene(id: string) {
      liveVisualPanel?.selectScene(id);
    },
  };
}
