/**
 * Format de projet — project/Project (docs/13_PROJECT_FORMAT.md §"Modèle").
 * Copie fidèle de l'interface `Project` du document ; ce fichier ne fait
 * qu'énoncer la forme des données, `validateProject` la vérifie — même
 * principe que `music/pmdi.ts`/`validatePmdi.ts` et `presets/schema.ts`.
 */
import type { AudioRef, PmdiDocument } from '../music/pmdi';

export const CURRENT_PROJECT_VERSION = 1;

export class ProjectError extends Error {
  constructor(
    public readonly code: 'FORMAT_UNKNOWN' | 'VERSION_TOO_RECENT' | 'INVALID_SHAPE',
    message: string,
  ) {
    super(message);
  }
}

export type AnalysisProfile = 'fast' | 'balanced' | 'precise';
export type MusicMode = 'analysis' | 'pmdi';
export type ExportAspect = '16:9' | '9:16' | '1:1';
export type Codec = 'h264' | 'av1';
export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

/**
 * Diff de preset : chemin pointé → valeur ("macros.glow", "layers.particles.count",
 * "palette.accent"). Jamais une copie complète du preset — voir docs/13
 * §"Les surcharges sont un diff, pas une copie".
 */
export type PresetDiff = Readonly<Record<string, number | string | boolean>>;

export interface ProjectMeta {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly app: string;
}

export interface ProjectAudio {
  readonly ref: AudioRef;
  readonly title?: string;
  readonly artist?: string;
  readonly duration: number;
}

export interface ProjectMusic {
  readonly mode: MusicMode;
  readonly analysisProfile?: AnalysisProfile;
  readonly cacheKey?: string;
  /** Embarqué UNIQUEMENT en mode "pmdi" — non reproductible depuis l'audio (vient de PULSAR). */
  readonly pmdi?: PmdiDocument;
}

export interface PaletteOverride {
  readonly bg?: readonly [string, string];
  readonly primary?: string;
  readonly secondary?: string;
  readonly accent?: string;
  readonly glow?: string;
  readonly contrast?: number;
  readonly drift?: { readonly lowEnergy?: string; readonly highEnergy?: string };
}

/**
 * Texte affiché (docs/17_PHASE2_VISUELS.md §9.3, chantier 10 lot B).
 *
 * Copie STRUCTURELLE de `visual/text/textConfig.ts::TextConfig`, pour la même
 * raison que `PaletteOverride` est une copie de `PresetPaletteConfig` :
 * `project/` n'a le droit d'importer que `music/` (docs/02, tableau des
 * dépendances). Le typage structurel de TypeScript fait interopérer les deux
 * sans import, `ui/App.ts` faisant le pont — il importe les deux couches.
 *
 * Les champs sont des chaînes libres et non des unions littérales : un projet
 * enregistré par une version future peut porter une animation que celle-ci ne
 * connaît pas, et le rejeter perdrait tout le reste du fichier. C'est
 * `normaliseTextConfig` qui ramène une valeur inconnue au défaut, au point de
 * consommation.
 */
export interface ProjectText {
  readonly text: string;
  readonly layout: string;
  readonly animation: string;
  readonly family: string;
  readonly weight: number;
  readonly textCase: string;
  readonly color: string;
  readonly everyBars: number;
  readonly durationBars: number;
  /** Multiplicateur de taille, hors `TextConfig` : c'est un `layer.params`. */
  readonly size?: number;
}

export interface ProjectVisual {
  readonly presetId: string;
  readonly presetVersion: number;
  readonly overrides: PresetDiff;
  /**
   * Palette CHOISIE OU ÉDITÉE, qui l'emporte sur celle du preset (§9.2).
   * Une chaîne désigne une entrée du catalogue — la stocker par identifiant
   * plutôt que par ses huit couleurs laisse le catalogue évoluer sans figer
   * dans chaque projet la version d'alors.
   *
   * Déclaré depuis l'Étape 13 et écrit par PERSONNE jusqu'au chantier 10 :
   * l'éditeur de couleurs du chantier 9 perdait son réglage au rechargement.
   */
  readonly palette?: string | PaletteOverride;
  /** Texte affiché, ou absent (chantier 10 lot B). */
  readonly text?: ProjectText;
  /**
   * Diff de câblage posé par l'éditeur de réaction (§7.11, chantier 10 lot C) :
   * nom de signal → entrée de `MappingSchema`.
   *
   * Objet OPAQUE ici, pour la raison déjà écrite au-dessus de `customPreset` :
   * `project/` n'a le droit d'importer que `music/`. Il ne peut pas non plus
   * vivre dans `overrides`, qui est un diff chemin → PRIMITIVE : une entrée de
   * câblage porte un tableau (`from: EventType[]`), que `computePresetDiff`
   * ignore délibérément plutôt que d'écrire une valeur qui ne se rechargerait
   * pas.
   */
  readonly mapping?: Readonly<Record<string, unknown>>;
  /**
   * Compositeur de couches (§7.7, chantier 10 lot C) : couches désactivées et
   * ordre voulu. Une couche absente de `enabled` est ACTIVE, et un `order` vide
   * signifie « celui de la fabrique du style ».
   */
  /**
   * Courbes d'automatisation (§7.3, chantier 10 lot D) : cible vers
   * images-clés. Objet opaque, même raison que `mapping` : `project/` ne peut
   * importer que `music/`. `normaliseAutomation` le remet en forme au
   * chargement — points triés compris, ce dont dépend la dichotomie de
   * `valueAt`.
   */
  readonly automation?: readonly Readonly<Record<string, unknown>>[];
  readonly layers?: {
    readonly enabled?: Readonly<Record<string, boolean>>;
    readonly order?: readonly string[];
  };
  /**
   * Pochette (§7.5). Le NOM du fichier seulement : les octets vivent à côté du
   * projet — entrée `cover/<nom>` du `.pvproj`, champ `cover` de
   * l'enregistrement IndexedDB. Mettre une image en base64 dans `project.json`
   * le ferait grossir de 33 % du poids de l'image, alors que docs/13 exige
   * qu'il reste petit — c'est déjà la raison pour laquelle le PMDI en est sorti.
   */
  readonly coverName?: string;
  /**
   * Copie COMPLÈTE du preset actif quand il vient de l'éditeur JSON (Étape 29,
   * corrige la limite connue depuis l'Étape 15/P13) — `overrides` (diff
   * ci-dessus) ne représente que des primitives (docs/13 §"les surcharges
   * sont un diff"), donc ne peut pas capturer fidèlement `mapping`/`palette`/
   * `classification`, qui contiennent des tableaux (`from: EventType[]`,
   * `bg: [string, string]`...) : `computePresetDiff` (project/diff.ts) les
   * ignore délibérément plutôt que d'écrire une valeur qui ne se
   * rechargerait pas correctement.
   *
   * Typé en objet opaque ICI : `project/` n'a pas le droit d'importer
   * `presets/` pour connaître la forme exacte de `Preset` (docs/02, tableau
   * des dépendances — `project: ['music']` seulement). Validé par
   * `presets/schema.ts::validatePreset()` au point de consommation
   * (`ui/App.ts`, seule couche qui importe les deux). `undefined` = preset du
   * catalogue + macros, comportement inchangé, restauré via `overrides`
   * comme avant cette étape.
   */
  readonly customPreset?: Readonly<Record<string, unknown>>;
}

export interface ProjectExport {
  readonly format: ExportAspect;
  readonly resolution: readonly [number, number];
  readonly fps: 30 | 60;
  readonly bitrateMbps: number;
  readonly codec: Codec;
}

export interface ProjectPrefs {
  readonly reducedFlashing: boolean;
  readonly quality: Quality;
  readonly debugOverlay: boolean;
}

export interface Project {
  readonly format: 'pvproj';
  readonly version: number;
  readonly meta: ProjectMeta;
  readonly audio: ProjectAudio;
  readonly music: ProjectMusic;
  readonly visual: ProjectVisual;
  readonly export: ProjectExport;
  readonly prefs: ProjectPrefs;
  /** Graine du PRNG — sans elle, deux ouvertures du même projet produisent deux rendus différents. */
  readonly seed: number;
  /** Champs inconnus préservés tels quels par les migrations (docs/13 §"Migration"). */
  readonly ext?: Record<string, unknown>;
}

export type ValidationResult = { ok: true; project: Project; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function checkMeta(meta: unknown, errors: string[]): void {
  if (!isRecord(meta)) {
    errors.push('champ "meta" absent ou mal formé');
    return;
  }
  for (const key of ['id', 'name', 'createdAt', 'modifiedAt', 'app'] as const) {
    if (!isNonEmptyString(meta[key])) errors.push(`"meta.${key}" doit être une chaîne non vide`);
  }
}

function checkAudio(audio: unknown, errors: string[]): void {
  if (!isRecord(audio)) {
    errors.push('champ "audio" absent ou mal formé');
    return;
  }
  if (!isRecord(audio.ref) || typeof audio.ref.kind !== 'string') errors.push('"audio.ref.kind" absent ou mal formé');
  if (!isFiniteNumber(audio.duration) || audio.duration < 0) errors.push('"audio.duration" doit être un nombre positif');
}

function checkMusic(music: unknown, errors: string[]): void {
  if (!isRecord(music)) {
    errors.push('champ "music" absent ou mal formé');
    return;
  }
  if (music.mode !== 'analysis' && music.mode !== 'pmdi') errors.push('"music.mode" doit être "analysis" ou "pmdi"');
  if (music.mode === 'pmdi' && !isRecord(music.pmdi)) errors.push('"music.pmdi" requis en mode "pmdi" (non reproductible depuis l\'audio)');
}

function checkVisual(visual: unknown, errors: string[]): void {
  if (!isRecord(visual)) {
    errors.push('champ "visual" absent ou mal formé');
    return;
  }
  if (!isNonEmptyString(visual.presetId)) errors.push('"visual.presetId" doit être une chaîne non vide');
  if (!isFiniteNumber(visual.presetVersion)) errors.push('"visual.presetVersion" doit être un nombre');
  if (!isRecord(visual.overrides)) errors.push('"visual.overrides" doit être un objet (diff chemin -> valeur)');
  // Vérification structurelle SEULEMENT — la forme exacte d'un `Preset` est validée par
  // `presets/schema.ts::validatePreset()`, hors de portée ici (voir le commentaire de
  // `ProjectVisual.customPreset`, `project/` n'a pas le droit d'importer `presets/`).
  if (visual.customPreset !== undefined && !isRecord(visual.customPreset)) {
    errors.push('"visual.customPreset" doit être un objet quand présent');
  }
  // Chantier 10 lot B. Même discipline que ci-dessus : on vérifie la FORME, pas
  // les valeurs. Une animation ou une mise en page inconnue de cette version est
  // ramenée au défaut par `normaliseTextConfig` au moment de l'application ;
  // rejeter le projet entier pour ça ferait perdre tout le reste du fichier.
  if (visual.palette !== undefined && typeof visual.palette !== 'string' && !isRecord(visual.palette)) {
    errors.push('"visual.palette" doit être un identifiant de catalogue ou un objet de surcharge');
  }
  if (visual.text !== undefined) {
    if (!isRecord(visual.text)) {
      errors.push('"visual.text" doit être un objet quand présent');
    } else if (typeof visual.text.text !== 'string') {
      errors.push('"visual.text.text" doit être une chaîne');
    }
  }
  if (visual.coverName !== undefined && typeof visual.coverName !== 'string') {
    errors.push('"visual.coverName" doit être une chaîne quand présent');
  }
  if (visual.mapping !== undefined && !isRecord(visual.mapping)) {
    errors.push('"visual.mapping" doit être un objet quand présent');
  }
  if (visual.automation !== undefined && !Array.isArray(visual.automation)) {
    errors.push('"visual.automation" doit être un tableau quand présent');
  }
  if (visual.layers !== undefined && !isRecord(visual.layers)) {
    errors.push('"visual.layers" doit être un objet quand présent');
  }
}

function checkExport(exp: unknown, errors: string[]): void {
  if (!isRecord(exp)) {
    errors.push('champ "export" absent ou mal formé');
    return;
  }
  if (!Array.isArray(exp.resolution) || exp.resolution.length !== 2) errors.push('"export.resolution" doit être [largeur, hauteur]');
  if (exp.fps !== 30 && exp.fps !== 60) errors.push('"export.fps" doit être 30 ou 60');
}

function checkPrefs(prefs: unknown, errors: string[]): void {
  if (!isRecord(prefs)) {
    errors.push('champ "prefs" absent ou mal formé');
    return;
  }
  if (typeof prefs.reducedFlashing !== 'boolean') errors.push('"prefs.reducedFlashing" doit être un booléen');
}

/**
 * Vérifie la forme structurelle d'un projet (jamais un `Project` déjà
 * supposé valide), sans jamais lancer d'exception. Ne vérifie PAS la
 * compatibilité de version — c'est le rôle de `migrate()` (docs/13
 * §"Migration de version"), appelé avant cette fonction dans le chemin normal
 * (`readPvproj`/chargement IndexedDB).
 */
export function validateProject(value: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(value)) return { ok: false, errors: ['le projet doit être un objet JSON'], warnings };
  if (value.format !== 'pvproj') errors.push(`"format" doit être "pvproj" (reçu : ${JSON.stringify(value.format)})`);
  if (!isFiniteNumber(value.version)) errors.push('"version" doit être un nombre');
  if (!isFiniteNumber(value.seed)) errors.push('"seed" doit être un nombre');

  checkMeta(value.meta, errors);
  checkAudio(value.audio, errors);
  checkMusic(value.music, errors);
  checkVisual(value.visual, errors);
  checkExport(value.export, errors);
  checkPrefs(value.prefs, errors);

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, project: value as unknown as Project, warnings };
}
