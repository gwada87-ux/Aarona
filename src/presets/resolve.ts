/**
 * Résolution d'un preset (docs/08_PRESETS.md §"Résolution d'un preset") :
 *
 *   preset de base (JSON) → surcharges de style → macros (macroCurves)
 *     → surcharges utilisateur (diff) → configuration finale, gelée
 *
 * « Surcharges de style » : un seul jeu de valeurs par défaut existe
 * aujourd'hui (`defaultMapping`, `DEFAULT_CLASSIFICATION_THRESHOLDS`), pas un
 * jeu distinct par style — cette étape du pipeline est donc un no-op ici
 * (voir aussi `macros.ts`, même limite pour `macroCurves`).
 */
import { defaultMapping } from '../behaviour/mapping/defaults';
import type { MappingEntry, MappingSchema } from '../behaviour/mapping/MappingSchema';
import { DEFAULT_CLASSIFICATION_THRESHOLDS, type ClassificationThresholds } from '../analysis/classify';
import type { Palette } from '../visual/palette/Palette';
import { buildPalette } from './palette';
import { applyMacroCurves, WIRED_MACRO_CURVES, type MacroCurveTable } from './macros';
import type { ClassificationOverrides, Preset, PresetLayers, PresetMacros, PresetMapping, PresetSafety, StyleId } from './schema';

export interface ResolvedPreset {
  readonly id: string;
  readonly styleId: StyleId;
  readonly mapping: MappingSchema;
  readonly classification: ClassificationThresholds;
  readonly palette: Palette;
  readonly macros: PresetMacros;
  readonly layers: PresetLayers;
  readonly safety: PresetSafety;
}

export interface ResolvePresetOptions {
  readonly macroCurves?: MacroCurveTable;
  /** "surcharges utilisateur, stockées comme un diff" (docs/08) — dernier pas du pipeline, remplace l'entrée entière du signal touché. */
  readonly userMappingOverrides?: PresetMapping;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Marche/clone les objets intermédiaires d'un chemin pointé
 * (`"mapping.impact.gain"`) et pose la feuille numérique sur le CLONE, jamais
 * sur l'objet existant : `root.mapping.<signal>` peut être la même référence
 * qu'une entrée de `preset.mapping` (voir `mergeMapping`, pas de clonage
 * profond) — muter en place corromprait le preset d'entrée (`resolvePreset`
 * doit rester pure).
 */
function setDeep(root: Record<string, unknown>, path: string, value: number): void {
  const parts = path.split('.');
  let node: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const existing = node[key];
    node[key] = isRecord(existing) ? { ...existing } : {};
    node = node[key] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

function mergeMapping(overrides: PresetMapping | undefined): Record<string, MappingEntry> {
  const merged: Record<string, MappingEntry> = { ...defaultMapping };
  if (overrides) {
    for (const [signal, entry] of Object.entries(overrides)) {
      if (entry) merged[signal] = entry;
    }
  }
  return merged;
}

function mergeClassification(overrides?: ClassificationOverrides): ClassificationThresholds {
  const base = DEFAULT_CLASSIFICATION_THRESHOLDS;
  return Object.freeze({
    kick: Object.freeze({ ...base.kick, ...overrides?.kick }),
    snare: Object.freeze({ ...base.snare, ...overrides?.snare }),
    clap: Object.freeze({ ...base.clap, ...overrides?.clap }),
    hat: Object.freeze({ ...base.hat, ...overrides?.hat }),
    perc: Object.freeze({ ...base.perc, ...overrides?.perc }),
  });
}

function freezeMapping(draft: Record<string, unknown>): MappingSchema {
  const out: Record<string, MappingEntry> = {};
  for (const [signal, entry] of Object.entries(draft)) out[signal] = Object.freeze({ ...(entry as MappingEntry) });
  return Object.freeze(out);
}

/**
 * Résout un preset en une configuration figée et immédiatement utilisable
 * (`BehaviourEngine`, `classifyOnsets`, `Scene.init`, `FlashLimiter`).
 * Fonction PURE : ne mute jamais `preset`.
 */
export function resolvePreset(preset: Preset, options: ResolvePresetOptions = {}): ResolvedPreset {
  const macroCurves = options.macroCurves ?? WIRED_MACRO_CURVES;

  const baseMapping = mergeMapping(preset.mapping);
  const macroOverrides = applyMacroCurves(preset.macros, macroCurves);

  const root: Record<string, unknown> = { mapping: { ...baseMapping } };
  for (const [path, value] of Object.entries(macroOverrides)) setDeep(root, path, value);
  let mapping = freezeMapping(root.mapping as Record<string, unknown>);

  if (options.userMappingOverrides) {
    const merged: Record<string, MappingEntry> = { ...mapping };
    for (const [signal, entry] of Object.entries(options.userMappingOverrides)) {
      if (entry) merged[signal] = entry;
    }
    mapping = Object.freeze(merged);
  }

  return Object.freeze({
    id: preset.id,
    styleId: preset.style,
    mapping,
    classification: mergeClassification(preset.classification),
    palette: buildPalette(preset.id, preset.palette),
    macros: preset.macros,
    layers: preset.layers ?? {},
    safety: preset.safety,
  });
}
