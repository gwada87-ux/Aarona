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
// Feuille de style de l'application (docs/17 §10.1, chantier 10). Importée ici
// plutôt que liée depuis `index.html` : Vite l'assemble et la versionne avec le
// reste, et un chemin faux casse la compilation au lieu de laisser passer une
// page sans style.
import './styles.css';
import { AudioEngine } from '../audio/AudioEngine';
import { AudioValidationError } from '../audio/decode';
import { FixedStep, FIXED_DT } from '../core/time/FixedStep';
import { createViewport } from '../render/Viewport';
import { Canvas2DRenderer } from '../render/canvas2d/Canvas2DRenderer';
import { StepContextBuilder } from '../music/StepContext';
import { buildMusicTimeline, type MusicTimeline } from '../music/MusicTimeline';
import { NO_CORRECTIONS, addDrop, applyCorrections, isNeutral, moveSectionStart, normaliseCorrections, removeDropNear, type AnalysisCorrections } from '../music/corrections';
import { FORMATS as EXPORT_FORMATS, findFormat } from '../export/formats';
import { createOffscreenExportTarget } from '../export/createOffscreenExportTarget';
import type { PmdiDocument } from '../music/pmdi';
import type { WaveformPeaks } from '../analysis/waveformPeaks';
import { BehaviourEngine } from '../behaviour/BehaviourEngine';
import { VisualDirector } from '../behaviour/VisualDirector';
import type { MappingSchema } from '../behaviour/mapping/MappingSchema';
import { createPulseStyle } from '../visual/styles/pulse/createPulseStyle';
import { createFieldStyle } from '../visual/styles/field/createFieldStyle';
import { createSpectrumProStyle } from '../visual/styles/spectrum-pro/createSpectrumProStyle';
import { createMonolithStyle } from '../visual/styles/monolith/createMonolithStyle';
import { createIsoPulseStyle } from '../visual/styles/iso-pulse/createIsoPulseStyle';
import { createChambreStyle } from '../visual/styles/chambre/createChambreStyle';
import { createEclatsStyle } from '../visual/styles/eclats/createEclatsStyle';
import { createAuroreStyle } from '../visual/styles/aurore/createAuroreStyle';
import type { Scene } from '../visual/scene/Scene';
import { withCover } from '../visual/scene/withCover';
import { withText } from '../visual/scene/withText';
import { composeLayers, type ComposeResult, type LayerComposition } from '../visual/scene/composeLayers';
import {
  TEXT_ANIMATION_LABELS,
  TEXT_LAYOUT_LABELS,
  normaliseTextConfig,
  textStructureKey,
  type TextAnimationId,
  type TextColorRole,
  type TextConfig,
  type TextFamily,
  type TextLayoutId,
  type TextWeight,
} from '../visual/text/textConfig';
import { planText } from '../visual/text/textLayout';
import { importCover, CoverImportError } from './coverImport';
import { applyLayerBlends, framingFor, openFrameWithCamera, primeScene, stepSceneWithDrama, NEUTRAL_AUTOMATION, type AutomationFrame } from '../visual/scene/dramaFrame';
import { variantFor, type StyleVariant } from '../presets/styleVariants';
import { FlashLimiter } from '../visual/safety/FlashLimiter';
import type { Palette } from '../visual/palette/Palette';
import { PRESET_CATALOG, resolvePreset, validatePreset, type Preset, type PresetMacros, type StyleId, MACRO_NAMES } from '../presets/index';
import { pickReducedMotionStyle } from '../presets/reducedMotion';
import { STYLE_IDS, type MacroName, type PresetBloomConfig, type PresetMapping } from '../presets/schema';
import type { PresetPaletteConfig } from '../presets/schema';
import { DEFAULT_PRESET_BLOOM, resolveBloom } from '../presets/bloom';
import { PALETTE_CATALOGUE, cataloguePaletteById } from '../presets/paletteCatalogue';
import { renderStyleThumbnail } from './styleThumbnails';
import { addPoint, automationValue, clearLane, hasLane, normaliseAutomation, removePointNear, type Automation } from '../core/automation/Automation';
import { ReactionEditor } from './panels/ReactionEditor';
import { LayerComposer } from './panels/LayerComposer';
import { readLooks, removeLook, writeLook, type Look } from './looks';
import { buildPalette } from '../presets/palette';
import { MIN_CONTRAST, contrastRatio } from '../visual/palette/contrast';
import { rgbToHex } from '../core/color/oklch';
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
  getSettings,
  saveSettings,
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
  monolith: createMonolithStyle,
  'iso-pulse': createIsoPulseStyle,
  chambre: createChambreStyle,
  eclats: createEclatsStyle,
  aurore: createAuroreStyle,
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
let visualDirector: VisualDirector | null = null;
let visualDirectorTimeline: MusicTimeline | null = null;
let currentVariant: StyleVariant | undefined;
/** Pochette décodée (§7.5). `null` = aucune ; la couche `CoverArt` est alors absente. */
let coverImage: ImageBitmap | null = null;
/** Palette extraite de la pochette. Elle l'emporte sur celle du preset tant qu'une pochette est active. */
let coverPalette: Palette | null = null;
/** La scène courante porte-t-elle la couche pochette ? Sert à détecter qu'il faut la reconstruire. */
let sceneHasCover = false;
/** Texte affiche (docs/17 §9.3). Vide = la couche `TextLayer` est absente. */
let textConfig: TextConfig = normaliseTextConfig({});
/**
 * Cle structurelle du texte pour laquelle `scene` a ete construite. Meme role
 * que `sceneStyleId` : changer le texte, la police ou l'animation change les
 * SPRITES, donc exige une reconstruction ; changer la taille n'en exige aucune.
 */
let sceneTextKey = textStructureKey(textConfig);
/** Multiplicateur de taille du texte, envoye en `params` (aucune reconstruction). */
let textSize = 1;
/**
 * Déclaré ICI et non près de son écouteur, plus bas : `refreshVariant()` y
 * écrit, et `refreshVariant` est appelée depuis la résolution de preset, qui
 * s'exécute pendant l'initialisation du module. Un `const` déclaré après aurait
 * été dans sa zone morte temporelle au premier appel.
 */
const seedOutput = document.querySelector<HTMLInputElement>('#seed-value')!;
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
/** Intention de bloom du preset actif (§6.5, chantier 9), modulee par la macro Glow. */
let currentBloom: PresetBloomConfig = DEFAULT_PRESET_BLOOM;
/** Palette EDITEE a la main ou choisie au catalogue (§9.2). `null` = celle du preset. */
let paletteOverride: PresetPaletteConfig | null = null;
/**
 * Identifiant du catalogue quand `paletteOverride` en vient tel quel (chantier
 * 10 lot B). `null` des qu'une pastille est touchee : la palette n'est alors
 * plus celle du catalogue et doit etre enregistree couleur par couleur.
 */
let cataloguePaletteId: string | null = null;
/**
 * Octets D'ORIGINE de la pochette, gardes pour la persistance (chantier 10 lot
 * B). `coverImage` est un bitmap DECODE : il ne se reecrit pas dans un fichier
 * sans une seconde compression.
 */
let coverSource: { readonly blob: Blob; readonly name: string } | null = null;
/** Diff de câblage posé par l'éditeur de réaction (§7.11). `null` = celui du preset. */
let mappingOverride: PresetMapping | null = null;
/** Couches désactivées par le compositeur (§7.7). Absente = active. */
let layerEnabled: LayerComposition = {};
/** Ordre voulu des couches. Vide = celui de la fabrique du style. */
let layerOrder: readonly string[] = [];
/** Dernière composition appliquée — sert à peupler le panneau avec ce qui est RÉELLEMENT dessiné. */
let lastComposition: ComposeResult | null = null;
/** Courbes d'automatisation (§7.3). Vide = aucune, et le rendu est alors EXACTEMENT celui d'avant. */
let automation: Automation = [];
/** Corrections manuelles de l'analyse (§7.8, lot E). */
let corrections: AnalysisCorrections = NO_CORRECTIONS;
/** Document d'analyse BRUT, avant corrections — pour pouvoir les annuler. */
let rawDoc: PmdiDocument | null = null;
/** Dernières crêtes de forme d'onde, réutilisées quand la frise se reconstruit. */
let lastWaveformPeaks: WaveformPeaks | null = null;
/** Cible en cours d'édition sur la frise. */
let automationTarget = 'intensity';
/**
 * Automatisation résolue à `t`, réutilisée en place.
 *
 * Un objet MUTÉ et non recréé : `stepSceneWithDrama` est appelée à chaque
 * sous-pas de simulation (120 Hz), et un littéral par appel serait une
 * allocation dans la boucle chaude - ce que docs/10 interdit.
 */
const automationFrame = { intensity: 1, cameraX: 0, cameraY: 0, cameraZoom: 1 };

/**
 * Évalue les quatre courbes à `t`.
 *
 * Court-circuit sur `automation.length === 0` : le cas courant - aucune
 * automatisation - ne doit pas payer quatre parcours de tableau par sous-pas.
 */
function automationAt(t: number): AutomationFrame {
  if (automation.length === 0) return NEUTRAL_AUTOMATION;
  automationFrame.intensity = automationValue(automation, 'intensity', t, 1);
  // Les trois pistes de caméra sont ÉTALÉES, et une vérification au navigateur
  // l'a imposé : la frise ne produit que des valeurs de 0 à 1, or `applyCamera`
  // borne le zoom à [1, 2] — une piste de zoom brute était donc TOUJOURS sous 1,
  // c'est-à-dire toujours écrêtée à la neutralité. Une option de plus qui ne
  // change rien, exactement ce que cette phase est censée éliminer.
  //
  // Le neutre reste ATTEIGNABLE et intuitif : milieu de la frise pour un
  // décalage nul, bas de la frise pour aucun zoom.
  automationFrame.cameraX = hasLane(automation, 'cameraX')
    ? (automationValue(automation, 'cameraX', t, 0.5) - 0.5) * 2 * CAMERA_SHIFT_MAX
    : 0;
  automationFrame.cameraY = hasLane(automation, 'cameraY')
    ? (automationValue(automation, 'cameraY', t, 0.5) - 0.5) * 2 * CAMERA_SHIFT_MAX
    : 0;
  automationFrame.cameraZoom = hasLane(automation, 'cameraZoom')
    ? 1 + automationValue(automation, 'cameraZoom', t, 0) * (CAMERA_ZOOM_MAX - 1)
    : 1;
  return automationFrame;
}

/** Décalage maximal d'une piste de caméra, en unités normalisées. */
const CAMERA_SHIFT_MAX = 0.3;
/** Zoom maximal d'une piste de caméra. `applyCamera` borne de toute façon à 2. */
const CAMERA_ZOOM_MAX = 1.8;

/**
 * Macros après automatisation, ou `currentMacros` telles quelles.
 *
 * Les macros ne se lisent PAS par image : `applyLayerMacrosToScene` remplace
 * `layer.params` en entier, donc une allocation par couche. Les recalculer à
 * 120 Hz serait exactement ce que docs/10 proscrit. Elles sont donc réappliquées
 * seulement quand une valeur automatisée a bougé de plus de `MACRO_EPSILON` —
 * assez fin pour qu'aucune transition ne se voie par paliers, assez grossier
 * pour que la boucle n'y touche presque jamais.
 */
const MACRO_EPSILON = 0.01;
let automatedMacros: PresetMacros | null = null;

function refreshAutomatedMacros(t: number): void {
  if (automation.length === 0) {
    automatedMacros = null;
    return;
  }
  let changed = automatedMacros === null;
  const next: Record<string, number> = { ...currentMacros };
  for (const name of MACRO_NAMES) {
    const target = `macro:${name}`;
    if (!hasLane(automation, target)) continue;
    const v = Math.min(1, Math.max(0, automationValue(automation, target, t, currentMacros[name])));
    next[name] = v;
    if (!automatedMacros || Math.abs(automatedMacros[name] - v) > MACRO_EPSILON) changed = true;
  }
  if (!changed) return;
  automatedMacros = next as unknown as PresetMacros;
  if (scene) {
    applyLayerMacrosToScene(scene, automatedMacros, currentStyleId);
    applyLayerBlends(scene, currentVariant?.blend);
    applyTextParams();
  }
}
/** Palette du preset actif, en hexadecimal : point de depart de l'editeur. */
let presetPaletteConfig: PresetPaletteConfig | null = null;
let reducedFlashing = false;
/**
 * `prefers-reduced-motion` (docs/17 §12, critère 14). Jusqu'ici la préférence
 * système n'était observée QUE du côté live (`LiveVisualPanel`) : le chemin
 * preview/export n'avait que la case à cocher manuelle « Réduction des flashs ».
 * Une préférence système et un réglage manuel ne sont pas la même chose, et
 * l'utilisateur qui a réglé son OS n'a aucune raison de venir le redire ici.
 */
let reducedMotion = false;

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
  // Le diff de l'éditeur de réaction est le DERNIER étage du pipeline de
  // résolution (docs/08 : « surcharges utilisateur, stockées comme un diff »),
  // donc appliqué après le preset ET après les macros. C'est déjà la place que
  // `resolvePreset` lui réservait ; personne ne s'en servait (§7.11, lot C).
  const resolved = resolvePreset(preset, { userMappingOverrides: mappingOverride ?? undefined });

  currentMapping = resolved.mapping;
  // La palette EXTRAITE d'une pochette l'emporte sur celle du preset (§7.5) :
  // l'utilisateur qui importe une image attend que les couleurs en viennent,
  // c'est tout l'intérêt de l'extraction. Changer de preset après coup ne la
  // reprend donc pas — il faut retirer la pochette pour cela, ce que le bouton
  // « Retirer » fait explicitement.
  // PRIORITE DES COULEURS (§9.2, chantier 9) : edition explicite, puis pochette,
  // puis preset. Une couleur choisie a la main est l'acte le plus deliberé, elle
  // l'emporte donc ; symetriquement, importer une pochette EFFACE l'edition en
  // cours - demander les couleurs d'une image, c'est renoncer aux siennes.
  currentPalette = paletteOverride
    ? buildPalette('personnalisée', paletteOverride)
    : (coverPalette ?? resolved.palette);
  presetPaletteConfig = resolved.paletteConfig;
  flashLimiter.setReducedFlashing(resolved.safety.reducedFlashing);

  const styleChanged = currentStyleId !== sceneStyleId;
  const coverChanged = (coverImage !== null) !== sceneHasCover;
  const textChanged = textStructureKey(textConfig) !== sceneTextKey;

  if (styleChanged || coverChanged || textChanged) {
    // Le plafond du niveau de qualité courant s'applique dès la construction (voir `applyQualityLevel`
    // pour le cas où le niveau change alors que le style `field` est DÉJÀ actif).
    // La pochette puis le texte sont AJOUTÉS après coup, en dernières couches :
    // ils n'appartiennent à aucun style, ils se posent par-dessus celui qu'on a
    // choisi. Le texte EN DERNIER : il porte de l'information, une pochette non.
    // Composition D'ABORD, habillages ENSUITE : la pochette et le texte ne sont
    // pas des couches du style, les faire passer par le compositeur permettrait
    // de les glisser sous le décor (§7.7, lot C).
    const composed = composeLayers(
      STYLE_FACTORIES[currentStyleId](
        QUALITY_LEVEL_CONFIGS[currentQualityLevel].maxParticles,
        QUALITY_LEVEL_CONFIGS[currentQualityLevel].feedback,
      ),
      layerEnabled,
      layerOrder,
    );
    lastComposition = composed;
    scene = withText(withCover(composed.scene, coverImage !== null), textConfig);
    sceneStyleId = currentStyleId;
    sceneHasCover = coverImage !== null;
    sceneTextKey = textStructureKey(textConfig);
    scene.init({ renderer, palette: currentPalette, cover: coverImage });
    if (currentTimeline) scene.reset(simT);
    sceneNeedsPriming = true;
  } else if (scene) {
    scene.init({ renderer, palette: currentPalette, cover: coverImage });
  }
  refreshVariant();
  applyLayerMacros();
  applyTextParams();
  currentBloom = resolved.bloom;
  applyBloom();
  renderer.setChromaticAberration(QUALITY_LEVEL_CONFIGS[currentQualityLevel].chromaticAberration);
  renderer.setInternalResolutionScale(QUALITY_LEVEL_CONFIGS[currentQualityLevel].internalResolutionScale);

  if (currentTimeline) {
    if (behaviourEngine && behaviourEngineTimeline === currentTimeline) {
      behaviourEngine.setMapping(currentMapping);
    } else {
      behaviourEngine = new BehaviourEngine(currentTimeline, currentMapping);
      behaviourEngineTimeline = currentTimeline;
    }
    // Le director est SANS ÉTAT : le reconstruire à chaque changement de
    // timeline suffit, et il n'a rien à préserver au passage — contrairement au
    // `BehaviourEngine`, dont les enveloppes en cours doivent survivre à un
    // simple glissement de macro.
    if (visualDirectorTimeline !== currentTimeline) {
      visualDirector = new VisualDirector(currentTimeline);
      visualDirectorTimeline = currentTimeline;
    }
  }

  primeSceneIfPaused();
  refreshPaletteEditor();
  refreshStyleThumbnails();
  // L'éditeur montre le câblage RÉSOLU : une ligne jamais touchée affiche ce
  // que le preset lui donne, et changer de preset rafraîchit visiblement les
  // treize lignes.
  reactionEditor.render(currentMapping);
  if (lastComposition) {
    layerComposer.render(lastComposition.scene.layers, layerEnabled, lastComposition.disabled);
    layerComposerNote.textContent = lastComposition.reordered
      ? 'Ordre corrigé : une couche marquée 🔒 doit rester en tête.'
      : '';
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
  applyBloom();
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
/**
 * Variante de cadrage active (§7.10). Dérivée de la GRAINE, donc renouvelée par
 * le bouton « Nouvelle variante » — qui régénère déjà la graine depuis
 * l'Étape 13 et gagne ici un second effet, visible celui-là.
 */
function refreshVariant(): void {
  currentVariant = variantFor(currentStyleId, projectSeed);
  if (scene) applyLayerBlends(scene, currentVariant?.blend);
  seedOutput.value = String(projectSeed);
}

function applyLayerMacros(): void {
  if (!scene) return;
  applyLayerMacrosToScene(scene, currentMacros, currentStyleId);
  // APRÈS les macros, jamais avant : `applyLayerMacrosToScene` remplace
  // `layer.params` en entier, et le mode de fusion doit survivre à cet écrasement.
  applyLayerBlends(scene, currentVariant?.blend);
  const spectrumBarsLayer = scene.layers.find((l) => l.id === 'spectrumBars');
  if (spectrumBarsLayer) {
    spectrumBarsLayer.params = { ...spectrumBarsLayer.params, bandCount: QUALITY_LEVEL_CONFIGS[currentQualityLevel].spectrumBands };
  }
}

/**
 * `true` quand une scène vient d'être RECONSTRUITE et n'a encore rien simulé.
 * Posé par `applyActiveConfiguration`, consommé par `primeSceneIfPaused`.
 */
let sceneNeedsPriming = false;

/**
 * Amorce la scène quand le transport est À L'ARRÊT.
 *
 * Une scène fraîche est vide, et ses couches ne se remplissent que dans
 * `update()`, qui ne tourne qu'en lecture. Changer de style, de couche ou de
 * palette en pause laissait donc l'aperçu noir jusqu'à la reprise — mesuré :
 * 2 828 pixels clairs, puis 0, puis 10 858 après deux secondes de lecture.
 *
 * TROIS CONDITIONS, et chacune évite un coût inutile :
 *
 * - **seulement à l'arrêt** — en lecture, l'image suivante remplit la scène
 *   toute seule, et amorcer par-dessus serait deux fois le même travail ;
 * - **seulement si la scène a été reconstruite** — `applyActiveConfiguration`
 *   se déclenche à chaque pixel de course d'un curseur de macro, et rejouer deux
 *   secondes à chacun figerait l'interface ;
 * - **seulement s'il y a un morceau** — sans timeline, il n'y a rien à rejouer.
 *
 * `primeScene` n'avance PAS le `behaviourEngine` vivant : il travaille sur des
 * moteurs jetables. C'était l'objection qui avait fait repousser ce correctif.
 */
function primeSceneIfPaused(): void {
  if (!sceneNeedsPriming) return;
  sceneNeedsPriming = false;
  if (audioEngine.playing || !scene || !currentTimeline || !currentMapping) return;
  primeScene(scene, currentTimeline, projectSeed, currentMapping, simT, automationAt);
}

/**
 * La scène telle que l'EXPORT doit la voir.
 *
 * Extraite de `getStyleFactory` au lot E, parce que l'export d'image fixe (§7.12)
 * en a besoin exactement de la même : deux fabriques auraient divergé, et
 * l'image fixe aurait fini par ne plus ressembler à la vidéo du même projet.
 *
 * `composeLayers`, `withCover` et `withText` ICI AUSSI, et pas seulement dans la
 * boucle d'aperçu : sans eux, l'export produirait la même image moins les
 * habillages et avec les couches désactivées. C'est très exactement le piège de
 * l'Étape 25, et trois tests le vérifient.
 *
 * docs/10 règle non négociable #2 : l'export fige TOUJOURS le niveau à
 * `EXPORT_QUALITY_LEVEL`, jamais `currentQualityLevel`.
 */
function buildExportScene(): Scene {
  const built = withText(
    withCover(
      composeLayers(
        STYLE_FACTORIES[currentStyleId](
          QUALITY_LEVEL_CONFIGS[EXPORT_QUALITY_LEVEL].maxParticles,
          QUALITY_LEVEL_CONFIGS[EXPORT_QUALITY_LEVEL].feedback,
        ),
        layerEnabled,
        layerOrder,
      ).scene,
      coverImage !== null,
    ),
    textConfig,
  );
  // Les `params` du texte ne passent NI par les macros NI par le preset : le
  // pipeline d'export ne les poserait donc jamais, et un texte agrandi à
  // l'aperçu sortirait à sa taille par défaut dans la vidéo.
  const layer = built.layers.find((l) => l.id === 'text');
  if (layer) layer.params = { size: textSize };
  return built;
}

/**
 * Bloom = intention du PRESET, modulee par la macro Glow, PLAFONNEE par le
 * niveau de qualite (docs/17 §6.5, chantier 9).
 *
 * Rappele a deux moments : quand le preset ou les macros changent, et quand le
 * niveau de qualite change. Avant ce chantier, `setBloomConfig` recevait
 * directement le bloom du niveau de qualite - un preset mat et un preset
 * incandescent recevaient donc exactement le meme halo, et le curseur Glow
 * n'avait aucune action sur lui.
 */
function applyBloom(): void {
  renderer.setBloomConfig(resolveBloom(currentBloom, currentMacros.glow, QUALITY_LEVEL_CONFIGS[currentQualityLevel].bloom));
}

/**
 * Redessine les huit vignettes de style avec la palette et la graine courantes
 * (docs/17 §10.1, chantier 10).
 *
 * PAS À CHAQUE APPEL DE `applyActiveConfiguration` : celle-ci se déclenche à
 * chaque pixel de course d'un curseur de macro, et huit scènes simulées sur
 * 240 pas à chaque mouvement figeraient l'interface. Deux garde-fous :
 *
 * - **rien tant que le groupe « Visuel » est replié** — on ne rend pas ce qui
 *   n'est pas regardé, et le groupe est le seul endroit d'où les vignettes sont
 *   visibles ;
 * - **une empreinte** palette + graine : les vignettes ne dépendent que de ces
 *   deux choses, donc un changement de macro ne les redessine pas.
 */
let thumbnailKey = '';
let thumbnailTimer: number | null = null;

function refreshStyleThumbnails(force = false): void {
  const groupe = document.querySelector<HTMLDetailsElement>('#groupe-visuel');
  if (!groupe?.open || !currentPalette) return;
  const key = `${currentPalette.id}|${colorToHex(currentPalette.primary)}|${colorToHex(currentPalette.accent)}|${colorToHex(currentPalette.bg[1])}|${projectSeed}`;
  if (!force && key === thumbnailKey) return;
  thumbnailKey = key;

  // UNE VIGNETTE À LA FOIS, et la mesure l'a imposé : les huit d'affilée
  // coûtaient 68,7 ms au navigateur, soit quatre images perdues d'un coup, et
  // ça se voyait comme un à-coup au moindre changement de palette. Étalées, ce
  // sont huit tâches de 8,6 ms, chacune sous le budget de 16 ms.
  //
  // `setTimeout` et NON `requestAnimationFrame`, alors que c'est du dessin :
  // rAF ne se déclenche pas dans un onglet qui ne composite pas — arrière-plan,
  // fenêtre masquée, navigateur automatisé. Mesuré : les huit vignettes
  // restaient noires. Un `setTimeout` s'exécute partout, laisse le navigateur
  // peindre entre deux tâches exactement de la même façon, et son ralentissement
  // en arrière-plan ne concerne que des vignettes que personne ne regarde.
  if (thumbnailTimer !== null) clearTimeout(thumbnailTimer);
  const queue = [...STYLE_IDS];
  const palette = currentPalette;
  const seed = projectSeed;
  const next = (): void => {
    const id = queue.shift();
    if (!id) {
      thumbnailTimer = null;
      return;
    }
    const canvas = advancedPanel.styleCanvas(id);
    if (canvas) renderStyleThumbnail(canvas, STYLE_FACTORIES[id], palette, seed);
    thumbnailTimer = window.setTimeout(next, 0);
  };
  thumbnailTimer = window.setTimeout(next, 0);
}

/**
 * Reglages continus du texte (§9.3). APRES `applyLayerMacros()`, jamais avant.
 *
 * `applyLayerMacrosToScene` epargne desormais les couches d'habillage (chantier
 * 8), donc ces `params` survivraient de toute facon - mais l'ordre reste celui
 * qu'impose sa docstring depuis l'Etape 25, et le respecter ici evite de faire
 * dependre ce fichier d'un detail interne de l'autre.
 */
function applyTextParams(): void {
  const layer = scene?.layers.find((l) => l.id === 'text');
  if (layer) layer.params = { size: textSize };
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

/**
 * `prefers-reduced-motion` écouté EN CONTINU, comme `LiveVisualPanel` le fait
 * déjà côté live : l'utilisateur peut activer la préférence pendant que le
 * visuel tourne, et c'est précisément le moment où il en a besoin.
 *
 * La préférence ALLUME la réduction des flashs sans jamais l'éteindre : si elle
 * disparaît, une case cochée à la main le reste. L'inverse effacerait un
 * réglage que l'utilisateur a posé lui-même.
 *
 * ## Ne JAMAIS appeler ceci pendant l'évaluation du module
 *
 * `applyActiveConfiguration()` touche `reactionEditor`, `layerComposer`,
 * `SWATCHES`... tous déclarés en `const` PLUS BAS dans ce fichier. L'appeler
 * trop tôt lève une `ReferenceError` de zone morte temporelle, l'évaluation du
 * module s'arrête net, et le `requestAnimationFrame(raf)` de la fin n'est
 * jamais atteint : **canevas gelé, tous les contrôles morts.**
 *
 * C'est exactement ce qui est arrivé — signalé par Aaron, « ça ne change pas du
 * tout le visuel ». L'appel initial vivait ici, à côté de la déclaration, ce
 * qui semblait propre. Il ne se déclenchait QUE si la préférence système était
 * active, donc jamais sur ma machine, et aucun de mes tests ne l'a vu.
 * L'installation de l'écoute est faite tout en bas, après la configuration
 * initiale (voir `installerReducedMotion`).
 */
function applyReducedMotion(active: boolean): void {
  reducedMotion = active;
  advancedPanel.setReducedMotion(active);
  if (active && !reducedFlashing) {
    reducedFlashing = true;
    advancedPanel.setReducedFlashing(true);
    applyActiveConfiguration();
  }
}

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
  // `withCover` et `withText` ICI AUSSI, et pas seulement dans la boucle
  // d'aperçu : sans ces lignes, l'export produirait la même image MOINS la
  // pochette et MOINS le texte, et le défaut ne se verrait sur aucune vignette.
  // C'est très exactement le piège de l'Étape 25, où les macros de couche
  // avaient été branchées d'un seul côté. Un test lit ce fichier pour le
  // vérifier, sur les deux habillages.
  getStyleFactory: () => buildExportScene,
  getCover: () => coverImage,
  getMacros: () => currentMacros,
  getStyleId: () => currentStyleId,
  getBloom: () => currentBloom,
  // Sans cette ligne, la video ignorerait toutes les images-cles : le meme
  // piege de l'Etape 25 que pour la pochette, le texte et les couches.
  getAutomation: () => automation,
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

/**
 * Simple / Avancé FILTRE, il ne découpe plus (docs/17 §10.1, chantier 10).
 *
 * Il y avait deux panneaux, `#panel-simple` et `#panel-advanced`, dont un seul
 * était visible. Un réglage changeait donc de place selon l'onglet, et certains
 * n'existaient que d'un côté : le curseur Glow était dans les deux, la palette
 * dans un seul, sans que rien ne l'indique. Les cinq groupes par intention sont
 * désormais toujours là ; seuls les éléments marqués `data-mode` apparaissent
 * ou disparaissent.
 */
function selectTab(tab: 'simple' | 'advanced'): void {
  const simple = tab === 'simple';
  tabSimple.setAttribute('aria-selected', String(simple));
  tabAdvanced.setAttribute('aria-selected', String(!simple));
  for (const el of document.querySelectorAll<HTMLElement>('[data-mode]')) {
    el.hidden = el.dataset.mode === (simple ? 'avance' : 'simple');
  }
}
tabSimple.addEventListener('click', () => selectTab('simple'));
tabAdvanced.addEventListener('click', () => selectTab('advanced'));
// Etat initial pose ICI et non par un attribut `hidden` dans le HTML : avec
// `data-mode`, le filtre porte sur une dizaine d'elements dissemines dans les
// cinq groupes, et les marquer un a un dans le HTML garantissait un oubli.
selectTab('simple');

// ---------------------------------------------------------------------------
// Timeline (frise)
// ---------------------------------------------------------------------------

const timelineCanvas = document.querySelector<HTMLCanvasElement>('#timeline-canvas')!;
const timelineComponent = new Timeline({
  canvas: timelineCanvas,
  onSeek: (t, kind) => handleSeek(t, kind),
  onAutomationPoint: (t, value, remove) => {
    automation = remove
      ? removePointNear(automation, automationTarget, t)
      : addPoint(automation, automationTarget, { t, value });
    refreshAutomationLane();
    refreshAutomationStatus();
    // La macro automatisée doit se voir tout de suite, même à l'arrêt : le
    // premier point posé n'aurait sinon d'effet qu'à la lecture suivante.
    automatedMacros = null;
    refreshAutomatedMacros(simT);
    scheduleAutosave();
  },
});

/** Passe la piste courante à la frise, ou `null` quand l'automatisation est repliée. */
function refreshAutomationLane(): void {
  const ouvert = document.querySelector<HTMLDetailsElement>('#groupe-automation')?.open === true;
  if (!ouvert) {
    timelineComponent.setAutomation(null);
    return;
  }
  const lane = automation.find((l) => l.target === automationTarget);
  timelineComponent.setAutomation({
    label: `${AUTOMATION_LABELS[automationTarget] ?? automationTarget} — clic pour poser, clic droit pour retirer`,
    points: lane?.points ?? [],
  });
}

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
function applyDocCore(doc: PmdiDocument, waveformPeaks: WaveformPeaks | null, keepPosition = false): void {
  // Document BRUT gardé à part du corrigé : les corrections doivent pouvoir
  // s'annuler, et on ne peut pas retirer un décalage de grille d'un document
  // auquel on l'a déjà appliqué sans accumuler les arrondis (§7.8, lot E).
  rawDoc = doc;
  const corrected = applyCorrections(doc, corrections);
  currentDoc = corrected;
  currentTimeline = buildMusicTimeline(corrected);
  stepper = new StepContextBuilder(currentTimeline, projectSeed);
  if (!keepPosition) {
    simT = 0;
    lastAudioT = 0;
  }
  fixedStep.reset();
  lastWaveformPeaks = waveformPeaks ?? lastWaveformPeaks;

  applyActiveConfiguration();

  resizeTimelineCanvas();
  timelineComponent.setData({
    duration: corrected.audio.duration,
    waveformPeaks: lastWaveformPeaks,
    // Downbeats DÉCALÉS comme la grille : ce sont eux qu'on voit sur la frise,
    // et les laisser en place ferait mentir la correction à l'écran alors
    // qu'elle agit dans le moteur.
    downbeats: (corrected.grid?.downbeats ?? []).map((t: number) => Math.max(0, t + corrections.gridOffsetSec)),
    sections: currentTimeline.sections(),
  });

  outGridConfidence.textContent = corrected.confidence.grid.toFixed(2);
  dropzone.classList.add('hidden');
}

/**
 * Rebâtit la timeline après une correction, SANS perdre la position de lecture.
 *
 * `applyDocCore` remet `simT` à zéro — ce qu'on veut au chargement d'un morceau,
 * jamais quand on vient de déplacer une frontière de section : on regarde
 * précisément l'endroit qu'on corrige.
 */
function reapplyCorrections(): void {
  if (!rawDoc) return;
  applyDocCore(rawDoc, lastWaveformPeaks, true);
  refreshCorrectionsStatus();
  scheduleAutosave();
}

function applyImportedDoc(doc: PmdiDocument, suggestedPresetId: string | null, waveformPeaks: WaveformPeaks | null): void {
  selectedPresetId = suggestedPresetId;
  customPreset = null;
  const preset = PRESET_CATALOG.find((p) => p.id === suggestedPresetId);
  currentMacros = preset?.macros ?? neutralMacros();
  // Critère 14 : c'est ICI, et seulement ici, que l'application impose un style
  // — la suggestion à l'import. Sous `prefers-reduced-motion`, un style à
  // mouvement soutenu n'est pas proposé d'office ; il reste choisissable à la
  // main dans la grille, parce que refuser un geste explicite serait décider à
  // la place de l'utilisateur ce qu'il a le droit de regarder.
  currentStyleId = pickReducedMotionStyle(preset?.style ?? currentStyleId, reducedMotion);
  simplePanel.selectPreset(selectedPresetId);
  advancedPanel.selectStyle(currentStyleId);
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
    music: {
      mode: 'analysis',
      analysisProfile: 'balanced',
      cacheKey: analysisCacheKeyValue ?? undefined,
      ...(isNeutral(corrections) ? {} : { corrections: corrections as unknown as Record<string, unknown> }),
    },
    visual: {
      presetId: selectedPresetId ?? 'none',
      presetVersion: catalogPreset?.version ?? 1,
      overrides,
      ...(customPreset ? { customPreset: customPreset as unknown as Record<string, unknown> } : {}),
      // Chantier 10 lot B : la palette editee, le texte et le nom de la
      // pochette rejoignent le projet. Les trois etaient perdus au
      // rechargement - limite signalee aux chantiers 7, 8 et 9.
      //
      // La palette est enregistree par IDENTIFIANT quand elle vient du
      // catalogue : figer ses huit couleurs dans chaque projet interdirait au
      // catalogue d'evoluer.
      ...(cataloguePaletteId ? { palette: cataloguePaletteId } : paletteOverride ? { palette: paletteOverride } : {}),
      ...(textConfig.text.length > 0 ? { text: { ...textConfig, size: textSize } } : {}),
      ...(coverSource ? { coverName: coverSource.name } : {}),
      ...(mappingOverride && Object.keys(mappingOverride).length > 0
        ? { mapping: mappingOverride as Readonly<Record<string, unknown>> }
        : {}),
      ...(Object.keys(layerEnabled).length > 0 || layerOrder.length > 0
        ? { layers: { enabled: layerEnabled, order: layerOrder } }
        : {}),
      ...(automation.length > 0 ? { automation: automation as unknown as readonly Record<string, unknown>[] } : {}),
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
    await saveProject(db, project, thumbnail, coverSource?.blob ?? null);
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

/**
 * Restaure la palette, le texte et la pochette (chantier 10 lot B).
 *
 * Les trois étaient perdus au rechargement, limite signalée aux chantiers 7, 8
 * et 9. Regroupés ici plutôt qu'insérés dans `restoreProject`, déjà longue, et
 * surtout parce qu'ils partagent une même règle : **une valeur absente ou
 * illisible remet le réglage à zéro, elle ne fait jamais échouer la
 * restauration.** Un projet écrit par une version future doit s'ouvrir, quitte
 * à perdre ce que celle-ci ne comprend pas.
 */
async function restoreVisualExtras(project: Project, coverBlob: Blob | null): Promise<void> {
  // --- Palette -------------------------------------------------------------
  const savedPalette = project.visual.palette;
  paletteOverride = null;
  cataloguePaletteId = null;
  if (typeof savedPalette === 'string') {
    const entry = cataloguePaletteById(savedPalette);
    if (entry) {
      paletteOverride = entry.config;
      cataloguePaletteId = entry.id;
    }
  } else if (savedPalette) {
    // Surcharge PARTIELLE : `PaletteOverride` a tous ses champs optionnels, et
    // un projet peut n'en porter qu'un. Les manquants viennent du preset actif,
    // ce qui est la définition même d'une surcharge.
    const base = activePresetObject().palette;
    paletteOverride = {
      bg: savedPalette.bg ?? base.bg,
      primary: savedPalette.primary ?? base.primary,
      secondary: savedPalette.secondary ?? base.secondary,
      accent: savedPalette.accent ?? base.accent,
      glow: savedPalette.glow ?? base.glow,
      contrast: savedPalette.contrast ?? base.contrast,
      drift: {
        lowEnergy: savedPalette.drift?.lowEnergy ?? base.drift.lowEnergy,
        highEnergy: savedPalette.drift?.highEnergy ?? base.drift.highEnergy,
      },
    };
  }
  paletteSelect.value = cataloguePaletteId ?? '';

  // --- Câblage (§7.11, lot C) ----------------------------------------------
  // Aucune validation de forme au-delà de « c'est un objet » : `resolvePreset`
  // remplace l'entrée ENTIÈRE du signal touché, et `BehaviourEngine` déduit la
  // famille de `from`. Une entrée abîmée dégrade donc un signal, pas la
  // restauration - et c'est la règle du lot B.
  mappingOverride = (project.visual.mapping as PresetMapping | undefined) ?? null;
  reactionEditor.setMapping(mappingOverride);

  // --- Composition des couches (SS7.7, lot C) ------------------------------
  layerEnabled = project.visual.layers?.enabled ?? {};
  layerOrder = project.visual.layers?.order ?? [];
  // `normaliseAutomation` TRIE les points : `valueAt` fait une recherche
  // dichotomique, et un fichier écrit à la main ne garantit pas l'ordre.
  automation = normaliseAutomation(project.visual.automation);
  // Les corrections vivent dans `music` : elles corrigent la LECTURE du
  // morceau, pas son habillage (§7.8, lot E).
  corrections = normaliseCorrections(project.music.corrections);
  automatedMacros = null;
  refreshAutomationLane();
  refreshAutomationStatus();
  // Invalide la scène pour que le chemin normal la reconstruise avec la
  // composition restaurée : `applyDocCore`, appelé juste après, ne regarde que
  // le style, et une couche désactivée n'en change pas.
  sceneStyleId = null;

  // --- Texte ---------------------------------------------------------------
  const savedText = project.visual.text;
  textConfig = normaliseTextConfig(savedText as Partial<TextConfig> | undefined);
  textSize = savedText?.size ?? 1;
  writeTextControls();

  // --- Pochette ------------------------------------------------------------
  coverImage?.close();
  coverImage = null;
  coverPalette = null;
  coverSource = null;
  coverStatus.textContent = '';
  coverInput.value = '';
  if (coverBlob) {
    try {
      const named = Object.assign(coverBlob.slice(0, coverBlob.size, coverBlob.type), {
        name: project.visual.coverName ?? 'pochette',
      });
      const imported = await importCover(named);
      coverImage = imported.image;
      coverPalette = imported.report.palette;
      coverSource = { blob: coverBlob, name: imported.fileName };
      coverStatus.textContent = `${imported.fileName} — restaurée`;
    } catch {
      // Une pochette illisible ne doit pas empêcher le projet de s'ouvrir : on
      // le dit dans le panneau, on ne jette pas.
      coverStatus.textContent = 'Pochette du projet illisible — réimporte-la.';
    }
  }
}

async function restoreProject(stored: { id: string; project: Project; cover?: Blob }, providedAudioBlob?: Blob): Promise<void> {
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
  await restoreVisualExtras(project, stored.cover ?? null);

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
  // La pochette voyage AVEC le fichier, dans son entree `cover/` (chantier 10
  // lot B). Un .pvproj partage sans elle rouvrirait sans son image, alors que le
  // nom est bien dans `project.json` : le symptome serait une pochette annoncee
  // et absente, pire qu'une absence franche.
  const cover = coverSource
    ? { filename: coverSource.name, data: new Uint8Array(await coverSource.blob.arrayBuffer()) }
    : undefined;
  const blob = await writePvprojBlob({ project, thumbnail, cover });
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
    const embeddedCover = result.cover ? new Blob([result.cover.data as BlobPart]) : undefined;
    await restoreProject({ id: result.project.meta.id, project: result.project, cover: embeddedCover }, embeddedAudio);
  } catch (err) {
    projectsStatus.textContent =
      err instanceof PvprojFormatError || err instanceof ProjectError ? err.message : `Erreur : ${err instanceof Error ? err.message : String(err)}`;
  }
}

// --- Pochette (docs/17 §7.5) -----------------------------------------------

const coverInput = document.querySelector<HTMLInputElement>('#cover-input')!;
const coverStatus = document.querySelector<HTMLElement>('#cover-status')!;

coverInput.addEventListener('change', () => {
  const file = coverInput.files?.[0];
  if (!file) return;
  coverStatus.textContent = 'Lecture…';
  void importCover(file)
    .then((imported) => {
      coverImage?.close();
      coverImage = imported.image;
      coverPalette = imported.report.palette;
      coverSource = { blob: imported.source, name: imported.fileName };
      // Demander les couleurs d'une image, c'est renoncer aux siennes : une
      // edition manuelle en cours l'emporterait sinon sur la palette extraite,
      // et l'import n'aurait aucun effet visible (§9.2, chantier 9).
      paletteOverride = null;
      cataloguePaletteId = null;
      paletteSelect.value = '';
      // Le rapport est MONTRÉ, pas seulement calculé : quand la garantie de
      // contraste a dû corriger une couleur, l'utilisateur doit savoir que ce
      // qu'il voit n'est pas exactement ce qu'il y avait dans son image.
      const notes: string[] = [`${imported.fileName} — contraste ${imported.report.contrast.toFixed(1)}:1`];
      if (imported.report.monochrome) notes.push('image monochrome, accent dérivé de la luminance');
      if (imported.report.corrected) notes.push('luminance corrigée pour rester lisible');
      coverStatus.textContent = notes.join(' · ');
      applyActiveConfiguration();
    })
    .catch((err: unknown) => {
      // Une image refusée n'est pas une panne de l'application : on le dit
      // dans le panneau, on ne jette pas dans la console.
      coverStatus.textContent =
        err instanceof CoverImportError ? err.message : 'Import impossible';
      coverInput.value = '';
    });
});

document.querySelector<HTMLButtonElement>('#btn-cover-clear')!.addEventListener('click', () => {
  if (!coverImage) return;
  // `close()` libère la mémoire du bitmap tout de suite plutôt que d'attendre
  // le ramasse-miettes — une pochette 4000×4000 pèse 64 Mo décompressée.
  coverImage.close();
  coverImage = null;
  coverPalette = null;
  coverSource = null;
  coverInput.value = '';
  coverStatus.textContent = '';
  // La palette du preset reprend la main : c'est le seul moyen de revenir en
  // arrière une fois qu'une pochette a imposé la sienne.
  applyActiveConfiguration();
});

// Le groupe « Visuel » ne rend ses vignettes qu'une fois ouvert : les huit
// scènes simulées ne se paient donc que si quelqu'un les regarde.
document.querySelector<HTMLDetailsElement>('#groupe-visuel')?.addEventListener('toggle', () => refreshStyleThumbnails());

// --- Correction manuelle de l'analyse (docs/17 §7.8) -----------------------

const gridOffsetInput = document.querySelector<HTMLInputElement>('#grid-offset')!;
const gridOffsetValue = document.querySelector<HTMLElement>('#grid-offset-value')!;
const sectionSelect = document.querySelector<HTMLSelectElement>('#section-select')!;
const correctionsStatus = document.querySelector<HTMLElement>('#corrections-status')!;

function refreshCorrectionsStatus(): void {
  gridOffsetInput.value = String(corrections.gridOffsetSec);
  gridOffsetValue.textContent = `${Math.round(corrections.gridOffsetSec * 1000)} ms`;

  // Les sections listées viennent du document CORRIGÉ : déplacer une frontière
  // doit se voir dans la liste, sinon on corrige à l'aveugle.
  const sections = currentTimeline?.sections() ?? [];
  const selected = sectionSelect.value;
  sectionSelect.replaceChildren(
    ...sections.map((s, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `${s.letter ?? String.fromCharCode(65 + i)} — ${formatTime(s.t)}`;
      return option;
    }),
  );
  if (selected && Number(selected) < sections.length) sectionSelect.value = selected;

  const parts: string[] = [];
  if (corrections.gridOffsetSec !== 0) parts.push(`grille ${Math.round(corrections.gridOffsetSec * 1000)} ms`);
  if (corrections.drops.length > 0) parts.push(`${corrections.drops.length} drop(s) marqué(s)`);
  const moved = Object.keys(corrections.sectionStarts).length;
  if (moved > 0) parts.push(`${moved} frontière(s) déplacée(s)`);
  correctionsStatus.textContent = parts.length > 0 ? parts.join(' · ') : 'Analyse non corrigée.';
}

gridOffsetInput.addEventListener('input', () => {
  gridOffsetValue.textContent = `${Math.round(Number(gridOffsetInput.value) * 1000)} ms`;
});
// Sur `change` et non `input` : chaque pas du curseur reconstruit la timeline
// ENTIÈRE, la scène et la frise. Le faire à chaque pixel de course rendrait le
// curseur inutilisable.
gridOffsetInput.addEventListener('change', () => {
  corrections = { ...corrections, gridOffsetSec: Number(gridOffsetInput.value) };
  reapplyCorrections();
});

document.querySelector<HTMLButtonElement>('#btn-drop-add')!.addEventListener('click', () => {
  corrections = addDrop(corrections, simT);
  reapplyCorrections();
});
document.querySelector<HTMLButtonElement>('#btn-drop-remove')!.addEventListener('click', () => {
  corrections = removeDropNear(corrections, simT);
  reapplyCorrections();
});

document.querySelector<HTMLButtonElement>('#btn-section-move')!.addEventListener('click', () => {
  const index = Number(sectionSelect.value);
  if (!Number.isInteger(index)) return;
  corrections = moveSectionStart(corrections, index, simT);
  reapplyCorrections();
});

document.querySelector<HTMLButtonElement>('#btn-corrections-reset')!.addEventListener('click', () => {
  corrections = NO_CORRECTIONS;
  reapplyCorrections();
});

document.querySelector<HTMLDetailsElement>('#groupe-analyse')!.addEventListener('toggle', refreshCorrectionsStatus);

// --- Export d'une image fixe (docs/17 §7.12) -------------------------------

const stillStatus = document.querySelector<HTMLElement>('#still-status')!;

/**
 * Enregistre l'instant courant en PNG, à la résolution du format d'export.
 *
 * §7.12 : « Presque gratuit, la chaîne existe déjà. » C'est vrai, à une
 * condition qui n'est pas évidente : la scène doit être SIMULÉE jusqu'à `simT`
 * avant d'être dessinée. Un `scene.draw` sur une scène fraîche rendrait un cadre
 * vide — pools de particules à zéro, feedback noir. Le pré-roll ci-dessous est
 * le même remède que celui des vignettes de style du lot A.
 */
async function exportStillFrame(): Promise<void> {
  if (!currentTimeline || !currentPalette || !currentMapping) {
    stillStatus.textContent = "Importe un morceau d'abord.";
    return;
  }
  // Le format vient du selecteur du dialogue d'export, source unique : une
  // image fixe et une video du meme projet doivent avoir le meme cadre.
  const formatId = document.querySelector<HTMLSelectElement>('#export-format')!.value;
  const format = findFormat(formatId) ?? EXPORT_FORMATS[0]!;
  stillStatus.textContent = 'Rendu…';
  try {
    const { target, canvas } = createOffscreenExportTarget(format.width, format.height, reducedFlashing);
    const scene = buildExportScene();
    scene.init({ renderer: target.renderer, palette: currentPalette, cover: coverImage });
    applyLayerMacrosToScene(scene, automatedMacros ?? currentMacros, currentStyleId);
    const variant = variantFor(currentStyleId, projectSeed);
    applyLayerBlends(scene, variant.blend);
    target.renderer.setBloomConfig(
      resolveBloom(currentBloom, currentMacros.glow, QUALITY_LEVEL_CONFIGS[EXPORT_QUALITY_LEVEL].bloom),
    );

    // Simulation depuis un PRÉ-ROLL et non depuis zéro : rejouer tout le morceau
    // pour une image fixe coûterait des minutes sur un long titre, et deux
    // secondes suffisent à remplir les pools. `primeScene` est la même fonction
    // qui amorce l'aperçu après un changement de style en pause — trois usages,
    // un seul endroit à corriger.
    // Le director RENDU par `primeScene` porte le budget de `simT` : en
    // construire un neuf ici rendrait une caméra neutre, et l'image fixe
    // perdrait la dramaturgie que l'aperçu montre au même instant.
    const director = primeScene(scene, currentTimeline, projectSeed, currentMapping, simT, automationAt);
    openFrameWithCamera(target.renderer, target.viewport, currentPalette.bg[1], director, framingFor(scene, variant), automationAt(simT));
    scene.draw(target.renderer, target.viewport);
    target.renderer.endFrame();
    target.applyFlashLimiter(simT);
    scene.dispose();

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${projectName || 'pulsar'}-${Math.round(simT * 1000)}ms.png`;
    link.click();
    URL.revokeObjectURL(url);
    stillStatus.textContent = `PNG ${format.width}×${format.height} enregistré (${(blob.size / 1024).toFixed(0)} Ko).`;
  } catch (err) {
    stillStatus.textContent = `Échec du rendu : ${err instanceof Error ? err.message : String(err)}`;
  }
}

// La durée de simulation avant capture n'est plus déclarée ici : c'est
// `PRIME_SECONDS`, partagée avec l'amorçage de l'aperçu (`primeScene`).

document.querySelector<HTMLButtonElement>('#btn-export-still')!.addEventListener('click', () => void exportStillFrame());

// --- Automatisation par images-clés (docs/17 §7.3) -------------------------

/**
 * Cibles automatisables : l'intensité globale, les huit macros et les
 * paramètres de caméra — la liste de §7.3, mot pour mot.
 *
 * Table construite ICI et non dans `core/automation` : les noms de macros
 * viennent de `presets/`, que `core/` n'a pas le droit d'importer. C'est ce qui
 * fait de `AutomationLane.target` une chaîne libre, validée au point de
 * consommation — exactement le traitement réservé à `EventType` et `FeatureId`.
 */
const AUTOMATION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  intensity: 'Intensité globale',
  cameraX: 'Caméra — horizontale (milieu = centré)',
  cameraY: 'Caméra — verticale (milieu = centré)',
  cameraZoom: 'Caméra — zoom (bas = aucun)',
  ...Object.fromEntries(MACRO_NAMES.map((n) => [`macro:${n}`, `Macro — ${n}`])),
});

const automationTargetSelect = document.querySelector<HTMLSelectElement>('#automation-target')!;
const automationStatus = document.querySelector<HTMLElement>('#automation-status')!;

automationTargetSelect.replaceChildren(
  ...Object.entries(AUTOMATION_LABELS).map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }),
);

function refreshAutomationStatus(): void {
  const lane = automation.find((l) => l.target === automationTarget);
  const n = lane?.points.length ?? 0;
  const autres = automation.filter((l) => l.target !== automationTarget).length;
  automationStatus.textContent =
    n === 0
      ? autres > 0
        ? `Aucune image-clé sur cette piste — ${autres} autre(s) piste(s) automatisée(s).`
        : 'Aucune image-clé.'
      : `${n} image(s)-clé(s) sur cette piste.`;
}

automationTargetSelect.addEventListener('change', () => {
  automationTarget = automationTargetSelect.value;
  refreshAutomationLane();
  refreshAutomationStatus();
});

document.querySelector<HTMLDetailsElement>('#groupe-automation')!.addEventListener('toggle', () => {
  refreshAutomationLane();
  refreshAutomationStatus();
});

document.querySelector<HTMLButtonElement>('#btn-automation-clear')!.addEventListener('click', () => {
  automation = clearLane(automation, automationTarget);
  refreshAutomationLane();
  refreshAutomationStatus();
  // Les macros reviennent à leur valeur de preset : sans cette invalidation,
  // `refreshAutomatedMacros` verrait un écart nul et ne réappliquerait rien.
  automatedMacros = null;
  refreshAutomatedMacros(simT);
  scheduleAutosave();
});

// --- « Looks » (docs/17 §7.7) ----------------------------------------------

const lookSelect = document.querySelector<HTMLSelectElement>('#look-select')!;
const lookStatus = document.querySelector<HTMLElement>('#look-status')!;
let looks: Look[] = [];

function refreshLookList(): void {
  lookSelect.replaceChildren(
    ...[{ name: '', label: looks.length > 0 ? 'Choisir un look…' : 'Aucun look enregistré' }, ...looks.map((l) => ({ name: l.name, label: l.name }))].map(
      ({ name, label }) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = label;
        return option;
      },
    ),
  );
}

async function loadLooks(): Promise<void> {
  if (!db) return;
  looks = readLooks(await getSettings(db));
  refreshLookList();
}

/**
 * Capture l'identité visuelle courante.
 *
 * Ni la graine ni la variante de cadrage : elles se DÉRIVENT l'une de l'autre
 * (§7.10), et les figer casserait « Nouvelle variante ». Ni la pochette : c'est
 * l'image d'un morceau, pas une identité réutilisable.
 */
function currentLook(name: string): Look {
  return {
    name,
    styleId: currentStyleId,
    macros: currentMacros,
    palette: cataloguePaletteId ?? paletteOverride ?? null,
    text: textConfig.text.length > 0 ? textConfig : null,
    textSize,
    mapping: mappingOverride,
    layers: { enabled: layerEnabled, order: layerOrder },
  };
}

function applyLook(look: Look): void {
  currentStyleId = look.styleId;
  currentMacros = look.macros;
  if (typeof look.palette === 'string') {
    const entry = cataloguePaletteById(look.palette);
    paletteOverride = entry?.config ?? null;
    cataloguePaletteId = entry?.id ?? null;
  } else {
    paletteOverride = look.palette;
    cataloguePaletteId = null;
  }
  paletteSelect.value = cataloguePaletteId ?? '';
  textConfig = normaliseTextConfig(look.text ?? { text: '' });
  textSize = look.textSize;
  writeTextControls();
  mappingOverride = look.mapping;
  reactionEditor.setMapping(look.mapping);
  layerEnabled = look.layers.enabled;
  layerOrder = look.layers.order;
  // Le style ET la composition changent : la scène est invalidée pour que le
  // chemin normal la reconstruise entièrement.
  sceneStyleId = null;
  applyActiveConfiguration();
  scheduleAutosave();
}

document.querySelector<HTMLButtonElement>('#btn-look-apply')!.addEventListener('click', () => {
  const look = looks.find((l) => l.name === lookSelect.value);
  if (!look) {
    lookStatus.textContent = 'Choisis un look dans la liste.';
    return;
  }
  applyLook(look);
  lookStatus.textContent = `« ${look.name} » appliqué.`;
});

document.querySelector<HTMLButtonElement>('#btn-look-save')!.addEventListener('click', () => {
  // `prompt` natif : §10.1 interdit toute dépendance, et une boîte de dialogue
  // maison pour saisir une ligne de texte serait trois fois plus de code que ce
  // qu'elle remplace.
  const name = window.prompt('Nom du look', lookSelect.value || currentStyleId)?.trim();
  if (!name) return;
  void (async () => {
    if (!db) return;
    const settings = writeLook(await getSettings(db), currentLook(name));
    await saveSettings(db, settings);
    looks = readLooks(settings);
    refreshLookList();
    lookSelect.value = name;
    lookStatus.textContent = `« ${name} » enregistré.`;
  })();
});

document.querySelector<HTMLButtonElement>('#btn-look-delete')!.addEventListener('click', () => {
  const name = lookSelect.value;
  if (!name) return;
  void (async () => {
    if (!db) return;
    const settings = removeLook(await getSettings(db), name);
    await saveSettings(db, settings);
    looks = readLooks(settings);
    refreshLookList();
    lookStatus.textContent = `« ${name} » supprimé.`;
  })();
});

// --- Compositeur de couches (docs/17 §7.7) ---------------------------------

const layerComposerNote = document.querySelector<HTMLElement>('#layer-composer-note')!;
const layerComposer = new LayerComposer(document.querySelector<HTMLElement>('#layer-composer')!, {
  onToggle: (id, enabled) => {
    layerEnabled = { ...layerEnabled, [id]: enabled };
    rebuildSceneForComposition();
  },
  onMove: (id, delta) => {
    // L'ordre courant sert de base : la première flèche cliquée part de l'ordre
    // de la fabrique, pas d'une liste vide qui remettrait tout à plat.
    const current = layerOrder.length > 0 ? [...layerOrder] : (lastComposition?.scene.layers.map((l) => l.id) ?? []);
    const from = current.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= current.length) return;
    [current[from], current[to]] = [current[to]!, current[from]!];
    layerOrder = current;
    rebuildSceneForComposition();
  },
});

document.querySelector<HTMLButtonElement>('#btn-layers-reset')!.addEventListener('click', () => {
  layerEnabled = {};
  layerOrder = [];
  rebuildSceneForComposition();
});

/**
 * Force la reconstruction de la scène après un changement de composition.
 *
 * `applyActiveConfiguration` ne reconstruit que si le STYLE, la pochette ou le
 * texte ont changé — une couche activée ou déplacée ne coche aucune de ces
 * cases. Plutôt que d'ajouter une quatrième empreinte à comparer, on invalide
 * `sceneStyleId` : la scène est alors rebâtie par le chemin normal, avec ses
 * macros, ses modes de fusion et ses habillages, et il n'y a pas deux endroits
 * qui savent construire une scène.
 */
function rebuildSceneForComposition(): void {
  sceneStyleId = null;
  applyActiveConfiguration();
  scheduleAutosave();
}

// --- Éditeur de réaction (docs/17 §7.11) -----------------------------------

const reactionEditor = new ReactionEditor(document.querySelector<HTMLElement>('#reaction-editor')!, {
  onChange: (mapping) => {
    mappingOverride = mapping;
    applyActiveConfiguration();
  },
});

document.querySelector<HTMLButtonElement>('#btn-reaction-reset')!.addEventListener('click', () => {
  mappingOverride = null;
  reactionEditor.setMapping(null);
  applyActiveConfiguration();
});

// --- Couleurs (docs/17 §9.2) -----------------------------------------------

const paletteSelect = document.querySelector<HTMLSelectElement>('#palette-select')!;
const paletteWarning = document.querySelector<HTMLElement>('#palette-warning')!;
const paletteContrastInput = document.querySelector<HTMLInputElement>('#palette-contrast')!;
const SWATCHES = {
  bg0: document.querySelector<HTMLInputElement>('#col-bg0')!,
  bg1: document.querySelector<HTMLInputElement>('#col-bg1')!,
  primary: document.querySelector<HTMLInputElement>('#col-primary')!,
  secondary: document.querySelector<HTMLInputElement>('#col-secondary')!,
  accent: document.querySelector<HTMLInputElement>('#col-accent')!,
  glow: document.querySelector<HTMLInputElement>('#col-glow')!,
  driftLo: document.querySelector<HTMLInputElement>('#col-drift-lo')!,
  driftHi: document.querySelector<HTMLInputElement>('#col-drift-hi')!,
};

paletteSelect.replaceChildren(
  ...[
    { value: '', label: 'Palette du preset' },
    ...PALETTE_CATALOGUE.map((p) => ({ value: p.id, label: p.label })),
  ].map(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }),
);

/** `Color` (0-255) vers `#rrggbb`, pour remplir un `<input type="color">`. */
function colorToHex(c: { r: number; g: number; b: number }): string {
  return rgbToHex({ r: c.r / 255, g: c.g / 255, b: c.b / 255 });
}

/**
 * Remplit les huit pastilles et le curseur depuis la palette ACTIVE.
 *
 * Depuis l'active et non depuis celle du preset : l'edition doit partir de ce
 * qui est a l'ecran, sinon deplacer une seule pastille ramenerait d'un coup les
 * sept autres a des valeurs que l'utilisateur ne voyait plus - notamment apres
 * l'import d'une pochette.
 */
function refreshPaletteEditor(): void {
  const p = currentPalette;
  if (!p) return;
  SWATCHES.bg0.value = colorToHex(p.bg[0]);
  SWATCHES.bg1.value = colorToHex(p.bg[1]);
  SWATCHES.primary.value = colorToHex(p.primary);
  SWATCHES.secondary.value = colorToHex(p.secondary);
  SWATCHES.accent.value = colorToHex(p.accent);
  SWATCHES.glow.value = colorToHex(p.glow);
  const config = paletteOverride ?? presetPaletteConfig;
  SWATCHES.driftLo.value = config?.drift.lowEnergy ?? colorToHex(p.temperature(0));
  SWATCHES.driftHi.value = config?.drift.highEnergy ?? colorToHex(p.temperature(1));
  paletteContrastInput.value = String(p.contrast);

  // §9.2 : « L'editeur AVERTIT quand un choix passe sous ce seuil - il avertit,
  // il n'interdit pas. » Interdire serait pire : sur une palette extraite d'une
  // pochette sombre, l'utilisateur n'a aucun moyen de « corriger » son image, et
  // se retrouverait bloque sur un reglage qu'il n'a pas choisi.
  const plusIntense = [p.primary, p.secondary, p.accent, p.glow].reduce((m, c) =>
    contrastRatio(c, p.bg[1]) > contrastRatio(m, p.bg[1]) ? c : m,
  );
  const ratio = contrastRatio(plusIntense, p.bg[1]);
  paletteWarning.textContent =
    ratio < MIN_CONTRAST
      ? `Contraste ${ratio.toFixed(1)}:1 — sous le seuil de ${MIN_CONTRAST}:1. Le visuel sera difficile à lire.`
      : '';
}

/** Construit une configuration depuis les huit pastilles et le curseur. */
function readPaletteEditor(): PresetPaletteConfig {
  return {
    bg: [SWATCHES.bg0.value, SWATCHES.bg1.value] as const,
    primary: SWATCHES.primary.value,
    secondary: SWATCHES.secondary.value,
    accent: SWATCHES.accent.value,
    glow: SWATCHES.glow.value,
    contrast: Number(paletteContrastInput.value),
    drift: { lowEnergy: SWATCHES.driftLo.value, highEnergy: SWATCHES.driftHi.value },
  };
}

for (const input of Object.values(SWATCHES)) {
  input.addEventListener('input', () => {
    paletteOverride = readPaletteEditor();
    // Le catalogue retombe sur « Palette du preset » : les couleurs ne sont plus
    // celles d'une entree du catalogue des qu'on en a bouge une - et le projet
    // doit alors les enregistrer une par une, plus par identifiant.
    cataloguePaletteId = null;
    paletteSelect.value = '';
    applyActiveConfiguration();
  });
}

paletteContrastInput.addEventListener('input', () => {
  paletteOverride = readPaletteEditor();
  cataloguePaletteId = null;
  paletteSelect.value = '';
  applyActiveConfiguration();
});

paletteSelect.addEventListener('change', () => {
  const entry = cataloguePaletteById(paletteSelect.value);
  paletteOverride = entry ? entry.config : null;
  cataloguePaletteId = entry ? entry.id : null;
  applyActiveConfiguration();
});

document.querySelector<HTMLButtonElement>('#btn-palette-reset')!.addEventListener('click', () => {
  paletteOverride = null;
  cataloguePaletteId = null;
  paletteSelect.value = '';
  applyActiveConfiguration();
});

// --- Texte (docs/17 §9.3, §7.6) --------------------------------------------

const textContent = document.querySelector<HTMLTextAreaElement>('#text-content')!;
const textStatus = document.querySelector<HTMLElement>('#text-status')!;
const textLayoutSelect = document.querySelector<HTMLSelectElement>('#text-layout')!;
const textAnimationSelect = document.querySelector<HTMLSelectElement>('#text-animation')!;
const textEverySelect = document.querySelector<HTMLSelectElement>('#text-every')!;
const textFamilySelect = document.querySelector<HTMLSelectElement>('#text-family')!;
const textWeightSelect = document.querySelector<HTMLSelectElement>('#text-weight')!;
const textCaseSelect = document.querySelector<HTMLSelectElement>('#text-case')!;
const textColorSelect = document.querySelector<HTMLSelectElement>('#text-color')!;
const textSizeInput = document.querySelector<HTMLInputElement>('#text-size')!;

/**
 * Peuple un `<select>` depuis une table de libelles.
 *
 * Les options ne sont PAS ecrites dans `index.html` : ajouter une animation
 * demanderait alors de modifier deux fichiers, et rien ne garantirait qu'ils
 * restent d'accord. Meme raison que pour `#style-select` (chantier 1).
 */
function fillSelect(select: HTMLSelectElement, entries: readonly (readonly [string, string])[], selected: string): void {
  select.replaceChildren(
    ...entries.map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === selected;
      return option;
    }),
  );
}

fillSelect(textLayoutSelect, Object.entries(TEXT_LAYOUT_LABELS), textConfig.layout);
fillSelect(textAnimationSelect, Object.entries(TEXT_ANIMATION_LABELS), textConfig.animation);
fillSelect(
  textEverySelect,
  [
    ['0', 'Une seule fois, au début'],
    ['4', 'Toutes les 4 mesures'],
    ['8', 'Toutes les 8 mesures'],
    ['16', 'Toutes les 16 mesures'],
  ],
  String(textConfig.everyBars),
);
fillSelect(
  textFamilySelect,
  [
    ['sans', 'Sans (grotesque)'],
    ['mono', 'Monospace'],
    ['serif', 'Serif'],
  ],
  textConfig.family,
);
fillSelect(
  textWeightSelect,
  [
    ['400', 'Normale'],
    ['700', 'Grasse'],
    ['900', 'Très grasse'],
  ],
  String(textConfig.weight),
);
fillSelect(
  textCaseSelect,
  [
    ['upper', 'MAJUSCULES'],
    ['none', 'Telle que saisie'],
    ['lower', 'minuscules'],
  ],
  textConfig.textCase,
);
fillSelect(
  textColorSelect,
  [
    ['white', 'Blanc'],
    ['accent', 'Accent'],
    ['primary', 'Primaire'],
    ['secondary', 'Secondaire'],
    ['glow', 'Halo'],
  ],
  textConfig.color,
);

/**
 * Relit les huit contrôles et reconstruit la scène si nécessaire.
 *
 * `normaliseTextConfig` borne `durationBars` en fonction de `everyBars` : une
 * animation plus longue que sa période redémarrerait avant d'avoir fini, et le
 * texte ne serait jamais entièrement posé.
 */
function readTextControls(): void {
  const everyBars = Number(textEverySelect.value);
  textConfig = normaliseTextConfig({
    text: textContent.value,
    layout: textLayoutSelect.value as TextLayoutId,
    animation: textAnimationSelect.value as TextAnimationId,
    family: textFamilySelect.value as TextFamily,
    weight: Number(textWeightSelect.value) as TextWeight,
    textCase: textCaseSelect.value as 'none' | 'upper' | 'lower',
    color: textColorSelect.value as TextColorRole,
    everyBars,
    // Une mesure d'animation par defaut ; sur une periode de 4 mesures ou plus,
    // deux mesures laissent le geste respirer sans mordre sur le temps pose.
    durationBars: everyBars === 0 || everyBars >= 8 ? 2 : 1,
  });

  // Une troncature SILENCIEUSE donnerait un texte amputé sans explication.
  const plan = planText(textConfig.text, textConfig.textCase);
  textStatus.textContent = plan.truncated
    ? `Texte tronqué à ${plan.glyphs.length} caractères (hors espaces).`
    : '';

  applyActiveConfiguration();
  // Le mode live partage CE texte : c'est la reponse a « `slamText` existe mais
  // aucune interface ne l'expose » (§9.3). Un seul champ, deux moteurs.
  liveVisualPanel?.setSlamText(slamLinesFromText(textConfig.text));
}

/**
 * Reflète `textConfig` dans les huit contrôles — l'inverse de
 * `readTextControls` (chantier 10 lot B).
 *
 * Nécessaire dès que le texte peut venir d'AILLEURS que des contrôles : un
 * projet restauré. Sans ça, le texte réapparaîtrait bien à l'écran mais les
 * champs afficheraient les valeurs par défaut, et la première interaction avec
 * l'un d'eux écraserait tout le reste par ce qu'affichent les autres.
 */
function writeTextControls(): void {
  textContent.value = textConfig.text;
  textLayoutSelect.value = textConfig.layout;
  textAnimationSelect.value = textConfig.animation;
  textEverySelect.value = String(textConfig.everyBars);
  textFamilySelect.value = textConfig.family;
  textWeightSelect.value = String(textConfig.weight);
  textCaseSelect.value = textConfig.textCase;
  textColorSelect.value = textConfig.color;
  textSizeInput.value = String(textSize);
  textStatus.textContent = '';
}

/**
 * Le texte du mode fichier, converti pour `LiveConfig.content.slamText`.
 *
 * Le mode live fait DEFILER ses lignes, une toutes les deux mesures : chaque
 * ligne saisie devient donc une phrase du defile. Un texte vide rend le tableau
 * vide, ce que `TypeSlamScene` traite deja en repli sur le BPM puis sur `LIVE`.
 */
function slamLinesFromText(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

for (const control of [
  textLayoutSelect,
  textAnimationSelect,
  textEverySelect,
  textFamilySelect,
  textWeightSelect,
  textCaseSelect,
  textColorSelect,
]) {
  control.addEventListener('change', readTextControls);
}
textContent.addEventListener('input', readTextControls);

textSizeInput.addEventListener('input', () => {
  // La taille ne touche AUCUN sprite : elle se lit à chaque image. Passer par
  // `applyActiveConfiguration` reconstruirait la scène à chaque pixel de course
  // du curseur, pour rien.
  textSize = Number(textSizeInput.value);
  applyTextParams();
});

// --- "Nouvelle variante" (docs/13 : régénère la graine, effet fort, coût nul) ---

document.querySelector<HTMLButtonElement>('#btn-variant')!.addEventListener('click', () => {
  if (!currentTimeline || !stepper) return;
  applySeed(randomSeed());
});

/**
 * Saisie manuelle de la graine (§7.9). Le bouton ci-dessus donne la variation ;
 * ce champ donne la REPRODUCTIBILITÉ — sans lui, un rendu qu'on aime est perdu
 * dès qu'on reclique. La graine est déjà persistée dans le `.pvproj`
 * (docs/13), il ne manquait que de pouvoir la lire et la ressaisir.
 */
seedOutput.addEventListener('change', () => {
  const parsed = Number.parseInt(seedOutput.value, 10);
  // Toute saisie non appliquée est ANNULÉE À L'AFFICHAGE — qu'elle soit
  // invalide ou qu'aucun morceau ne soit chargé. Laisser le champ montrer une
  // graine qui n'est pas celle du rendu ferait mentir l'interface, et c'est
  // précisément le champ dont l'utilisateur attend qu'il dise la vérité :
  // il sert à retrouver un résultat.
  if (!Number.isFinite(parsed) || !currentTimeline || !stepper) {
    seedOutput.value = String(projectSeed);
    return;
  }
  applySeed(parsed >>> 0);
});

function applySeed(seed: number): void {
  if (!currentTimeline) return;
  projectSeed = seed;
  stepper = new StepContextBuilder(currentTimeline, projectSeed);
  // La variante DÉPEND de la graine : sans ce rafraîchissement, « Nouvelle
  // variante » ne changerait que les tirages internes des couches et laisserait
  // le cadrage identique — c'est-à-dire l'essentiel de ce que l'utilisateur
  // regarde.
  refreshVariant();
  // Les vignettes dependent aussi de la graine : sans ce rappel, « Nouvelle
  // variante » changerait l'apercu et laisserait les huit vignettes montrer le
  // cadrage precedent.
  refreshStyleThumbnails();
  handleSeek(simT, 'release');
  scheduleAutosave();
}

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
  if (audioEngine.playing && stepper && behaviourEngine && visualDirector && scene && currentTimeline) {
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
      // Dramaturgie appliquée par le MÊME point que l'export (chantier 3) :
      // deux boucles d'images distinctes, un seul endroit qui les dose.
      stepSceneWithDrama(scene, behaviourEngine, visualDirector, step, automationAt(simT));
      lastRegime = step.regime;
    }
    // Les macros automatisées, elles, sont revues UNE FOIS par image et non par
    // sous-pas : elles remplacent `layer.params` en entier, donc allouent.
    if (steps > 0) refreshAutomatedMacros(simT);
    timelineComponent.setPlayhead(simT);
  }
  const updateMs = performance.now() - updateStartMs;

  const renderStartMs = performance.now();
  if (scene && currentPalette) {
    // Sans director (aucun morceau chargé), la caméra est simplement neutre :
    // on ouvre l'image comme avant.
    if (visualDirector) {
      openFrameWithCamera(renderer, viewport, currentPalette.bg[1], visualDirector, framingFor(scene, currentVariant), automationAt(simT));
    } else {
      renderer.beginFrame(viewport);
      renderer.clear(currentPalette.bg[1]);
    }
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

/**
 * Observation de `prefers-reduced-motion` — installée ICI, et pas à côté de
 * `applyReducedMotion`, parce que l'appel initial peut déclencher
 * `applyActiveConfiguration()` : tout ce qu'elle touche doit déjà exister.
 * Voir l'avertissement en tête de `applyReducedMotion`.
 */
function installerReducedMotion(): void {
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', (event) => applyReducedMotion(event.matches));
  applyReducedMotion(motionQuery.matches);
}
installerReducedMotion();

void (async () => {
  try {
    db = await openDatabase();
    void requestPersistentStorage();
    // Les Looks sont une préférence d'APPLICATION, pas de projet : ils sont
    // chargés dès l'ouverture de la base, avant tout morceau.
    await loadLooks();
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
    /** Automatisation résolue à l'instant courant — vérification du lot D. */
    get automation() {
      return { pistes: automation.length, frame: { ...automationAt(simT) }, macros: automatedMacros };
    },
    // `setBlend` et `clamped` ont été RETIRÉS après la vérification du critère
    // 13 de §12. Ils forçaient un mode de fusion sur toutes les couches et
    // exposaient le compteur d'écrêtage du `FlashLimiter` ; le critère est
    // vérifié, le verdict est dans docs/JOURNAL.md, et deux crochets qui ne
    // servent plus sont deux chemins de plus à maintenir. Le compteur reste
    // visible dans le panneau debug (« frames clampées »).
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
