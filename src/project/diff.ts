/**
 * Diff de preset — project/diff (docs/13_PROJECT_FORMAT.md §"Les surcharges
 * sont un diff, pas une copie") : chemins pointés ("macros.glow",
 * "layers.particles.count") vers des valeurs primitives, jamais une copie
 * complète du preset.
 */
import type { PresetDiff } from './Project';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is number | string | boolean {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
}

/**
 * Marche/crée les objets intermédiaires d'un chemin pointé et pose la
 * valeur — même principe que `presets/resolve.ts` (`setDeep`), dupliqué ici
 * plutôt qu'importé : `project/` ne peut pas dépendre de `presets/`
 * (docs/02, séparation des couches — `project/` est un format de
 * sauvegarde, pas un consommateur de presets), et la fonction ne fait
 * qu'une dizaine de lignes.
 */
function setByPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

/** Applique un diff de preset sur une base — fonction PURE, ne mute jamais `base`. */
export function applyPresetDiff<T extends Record<string, unknown>>(base: T, diff: PresetDiff): T {
  const root: Record<string, unknown> = structuredClone(base);
  for (const [path, value] of Object.entries(diff)) setByPath(root, path, value);
  return root as T;
}

function collectDiff(
  base: Record<string, unknown>,
  modified: Record<string, unknown>,
  prefix: string,
  out: Record<string, number | string | boolean>,
): void {
  for (const [key, modifiedValue] of Object.entries(modified)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const baseValue = base[key];

    if (isPlainObject(modifiedValue) && (baseValue === undefined || isPlainObject(baseValue))) {
      // `baseValue` absent (clé nouvelle, pas seulement modifiée) : traité comme `{}` pour que
      // la récursion continue et rapporte chaque feuille comme nouvelle, plutôt que de perdre
      // tout le sous-arbre — un vrai bug rencontré et corrigé pendant les tests unitaires.
      collectDiff(isPlainObject(baseValue) ? baseValue : {}, modifiedValue, path, out);
      continue;
    }
    if (isPrimitive(modifiedValue)) {
      if (modifiedValue !== baseValue) out[path] = modifiedValue;
      continue;
    }
    // Tableaux (ex. palette.bg, layers.*.lifetime) : `PresetDiff` (docs/13) ne type ses valeurs
    // qu'en primitives (number|string|boolean) — un tableau n'a pas de représentation dans ce
    // format. Ignoré plutôt que silencieusement encodé en JSON dans un champ censé être une
    // primitive : une telle personnalisation ne survivrait pas à la sauvegarde, mieux vaut ne
    // rien écrire de faux que d'écrire quelque chose qui ne se recharge pas correctement.
  }
}

/**
 * Calcule le diff entre une base (valeurs par défaut d'un preset résolu) et
 * une version modifiée — parcourt récursivement les objets imbriqués,
 * compare les primitives par égalité de valeur. Fonction PURE.
 */
export function computePresetDiff(base: Record<string, unknown>, modified: Record<string, unknown>): PresetDiff {
  const diff: Record<string, number | string | boolean> = {};
  collectDiff(base, modified, '', diff);
  return diff;
}
