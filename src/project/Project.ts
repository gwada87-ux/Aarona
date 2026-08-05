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

export interface ProjectVisual {
  readonly presetId: string;
  readonly presetVersion: number;
  readonly overrides: PresetDiff;
  readonly palette?: string | PaletteOverride;
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
