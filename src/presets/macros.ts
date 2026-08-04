/**
 * Courbes de macro-contrôles (docs/08_PRESETS.md §"Les 8 macro-contrôles") :
 * chaque macro (0..1) est ramenée à un ensemble de chemins pointés vers des
 * paramètres réels via une interpolation `at0 → at1`. « Un même curseur
 * produit un effet différent selon le style » (docs/08) — non implémenté ici
 * (voir la limite ci-dessous) : la table est PARTAGÉE entre les 3 styles,
 * faute de valeurs distinctes spécifiées par style dans la documentation
 * (le seul exemple chiffré donné, `reactivity`, n'est pas différencié par
 * style).
 *
 * Limite assumée (voir docs/JOURNAL.md, Étape 13/P11) : seules `energy` et
 * `reactivity` ont un effet câblé ici, parce que ce sont les deux seules
 * macros dont la colonne « Agit sur » de docs/08 pointe vers des paramètres
 * RÉELLEMENT CONSOMMÉS aujourd'hui (`behaviour/mapping` — gains et
 * décroissances/lissages de `BehaviourEngine`). Les 6 autres (densité,
 * mouvement, profondeur, glow, chaos, douceur) ciblent des paramètres de
 * couches visuelles (`layers.*`, bloom, dispersion de bruit) qu'aucune
 * couche du MVP (P7/P9) n'accepte encore en entrée — leur valeur brute
 * reste disponible dans `ResolvedPreset.macros` pour un futur consommateur,
 * mais `applyMacroCurves` ne produit aucun chemin pour elles : prétendre le
 * contraire serait afficher une confiance que le code n'a pas.
 */
import type { MacroName, PresetMacros } from './schema';

export type CurveName = 'linear' | 'easeInQuad' | 'easeOut';

/**
 * `linear` et `easeInQuad` sont les seules attestées ailleurs dans le code
 * (`behaviour/signals/Anticipation.ts`, docs/06/07). `easeOut` est NOMMÉE par
 * l'exemple de docs/08 (`mapping.impact.decay`) mais sans formule donnée :
 * ease quadratique standard, symétrique de `easeInQuad` — choix auto-documenté,
 * pas une valeur du corpus.
 */
const CURVES: Readonly<Record<CurveName, (x: number) => number>> = {
  linear: (x) => x,
  easeInQuad: (x) => x * x,
  easeOut: (x) => 1 - (1 - x) * (1 - x),
};

export interface MacroCurvePoint {
  readonly at0: number;
  readonly at1: number;
  readonly curve?: CurveName;
}

/** macro → (chemin pointé → point de courbe). */
export type MacroCurveTable = Partial<Record<MacroName, Readonly<Record<string, MacroCurvePoint>>>>;

/**
 * Table partagée par les 3 styles (voir limite en tête de fichier). Chemins
 * enracinés sur `mapping.<signal>.<champ>` — tous réellement lus par
 * `resolve.ts` → `BehaviourEngine` (`gain` par `Impulse.fire`, `decay` par le
 * constructeur d'`Impulse`, `rise`/`fall` par celui de `Continuous`).
 *
 * Valeurs numériques auto-choisies (aucun corpus ne les calibre) : bornes
 * raisonnables autour des décroissances par défaut de `behaviour/mapping/
 * defaults.ts`, jamais au-delà de ce qui reste perceptuellement sain.
 */
export const WIRED_MACRO_CURVES: MacroCurveTable = Object.freeze({
  energy: Object.freeze({
    'mapping.impact.gain': { at0: 0.3, at1: 1.3 },
    'mapping.subImpact.gain': { at0: 0.3, at1: 1.3 },
    'mapping.accent.gain': { at0: 0.3, at1: 1.3 },
    'mapping.tick.gain': { at0: 0.2, at1: 1.0 },
    'mapping.sectionShift.gain': { at0: 0.3, at1: 1.3 },
  }),
  reactivity: Object.freeze({
    'mapping.impact.decay': { at0: 0.3, at1: 0.06, curve: 'easeOut' as const }, // docs/08, valeurs exactes de l'exemple
    'mapping.tick.decay': { at0: 0.15, at1: 0.03 }, // docs/08, valeurs exactes de l'exemple
    'mapping.subImpact.decay': { at0: 0.7, at1: 0.2 },
    'mapping.accent.decay': { at0: 0.3, at1: 0.08 },
    'mapping.sectionShift.decay': { at0: 1.8, at1: 0.6 },
    'mapping.drive.rise': { at0: 0.2, at1: 0.05 },
    'mapping.drive.fall': { at0: 1.0, at1: 0.3 },
    'mapping.weight.rise': { at0: 0.12, at1: 0.03 },
    'mapping.weight.fall': { at0: 0.6, at1: 0.15 },
    'mapping.brightness.rise': { at0: 0.4, at1: 0.1 },
    'mapping.brightness.fall': { at0: 0.8, at1: 0.2 },
  }),
});

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function evalCurve(point: MacroCurvePoint, macroValue: number): number {
  const x = clamp01(macroValue);
  const eased = CURVES[point.curve ?? 'linear'](x);
  return point.at0 + (point.at1 - point.at0) * eased;
}

/** Résout toutes les macros d'un preset via `table` → chemin pointé (`mapping.*`) → valeur numérique. */
export function applyMacroCurves(macros: PresetMacros, table: MacroCurveTable = WIRED_MACRO_CURVES): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [macroName, curves] of Object.entries(table)) {
    const macroValue = macros[macroName as MacroName];
    if (macroValue === undefined || !curves) continue;
    for (const [path, point] of Object.entries(curves)) out[path] = evalCurve(point, macroValue);
  }
  return out;
}
