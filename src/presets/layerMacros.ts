/**
 * Courbes de macro-contrôles pour les paramètres de COUCHES VISUELLES
 * (docs/08_PRESETS.md §"Les 8 macro-contrôles", colonne « Agit sur » :
 * nombre de particules/bandes/lignes, facteurs de vitesse, perspective,
 * intensité additive, bruit seedé, courbes d'interpolation). Réutilise
 * `MacroCurveTable`/`applyMacroCurves` (`presets/macros.ts`) TEL QUEL — même
 * mécanique que `WIRED_MACRO_CURVES`, chemins pointés différents.
 *
 * Chemins de la forme `<styleId>.<layerId>.<paramKey>`, résolus par
 * `applyLayerMacros()` (`ui/App.ts`) en `LayerParams` assignées à chaque
 * couche de la Scene active — sans jamais reconstruire la Scene (docs/08
 * documentait jusqu'ici l'absence de consommateur ; Étape 20 lève cette
 * limite pour `density`/`movement`/`depth`/`glow`/`chaos`/`smoothness`,
 * `energy`/`reactivity` restant sur `WIRED_MACRO_CURVES`/`mapping.*`).
 *
 * Chaque chemin n'apparaît que dans LES COURBES D'UN SEUL MACRO : deux
 * macros écrivant le même chemin se marqueraient silencieusement l'un
 * l'autre dans `applyMacroCurves` (dernier écrit gagne, `Object.entries`
 * itère macro par macro) — ce fichier respecte cette contrainte partout
 * (voir la séparation rise/fall de `spectrumBars` sous Mouvement/Douceur).
 *
 * `depth` (Profondeur) n'a AUCUNE entrée pour `pulse` : le style est
 * délibérément plat/2D (docs/07, « géométrie réactive », rien à quoi
 * accrocher une sensation de profondeur sans l'inventer) — absence
 * volontaire, pas un oubli.
 *
 * Valeurs numériques auto-choisies (aucun corpus ne les calibre), bornées
 * autour des constantes actuelles de chaque couche pour rester
 * perceptuellement raisonnables — même discipline que `WIRED_MACRO_CURVES`.
 */
import { applyMacroCurves, type MacroCurveTable } from './macros';
import type { PresetMacros, StyleId } from './schema';
import type { Scene } from '../visual/scene/Scene';

export const LAYER_MACRO_CURVES: MacroCurveTable = Object.freeze({
  density: Object.freeze({
    // Field — ParticleField.ts : POOL_SIZE/spawn de base (120/20/60/400) × ce multiplicateur.
    'field.particleField.spawnCountMul': { at0: 0.4, at1: 1.4 },
    // Field — PerspectiveGrid.ts : ROW_COUNT = 24 par défaut.
    'field.perspectiveGrid.rows': { at0: 12, at1: 36 },
    // Pulse — PulseRings.ts : pool fixe de 8 emplacements, ce paramètre borne combien sont actifs à la fois.
    'pulse.pulseRings.maxActiveRings': { at0: 2, at1: 8 },
    // Spectrum Pro — SpectrumBars.ts : GAP = 0.006 par défaut (plus dense = barres plus serrées).
    'spectrum-pro.spectrumBars.gap': { at0: 0.014, at1: 0.002 },
  }),
  movement: Object.freeze({
    // Field — ParticleField.ts : DRIFT_Y = 0.012 par défaut.
    'field.particleField.driftSpeed': { at0: 0.006, at1: 0.02 },
    // Pulse — PulseRings.ts : SECONDARY_RING_LIFETIME = 1.2s par défaut (durée = vitesse d'expansion inverse).
    'pulse.pulseRings.lifetimeSec': { at0: 1.8, at1: 0.6 },
    // Spectrum Pro — SpectrumBars.ts : BAR_RISE_TAU = 0.05s par défaut (attaque des barres, pas la retombée — voir smoothness).
    'spectrum-pro.spectrumBars.riseTau': { at0: 0.09, at1: 0.02 },
  }),
  depth: Object.freeze({
    // Field — PerspectiveGrid.ts : PERSPECTIVE = 0.65 par défaut ; plus BAS = falloff plus dramatique (formule rayon ∝ 1/profondeur).
    'field.perspectiveGrid.perspective': { at0: 1.2, at1: 0.35 },
    // Spectrum Pro — SpectrumBars.ts : REFLECTION_ALPHA = 0.25 par défaut (repère de « sol » sous les barres).
    'spectrum-pro.spectrumBars.reflectionAlpha': { at0: 0.1, at1: 0.4 },
    // (aucune entrée pulse.* — voir note en tête de fichier)
  }),
  glow: Object.freeze({
    // Field — ParticleField.ts : multiplie l'alpha de base (0.85) du sprite additif par particule.
    'field.particleField.glowAlphaMul': { at0: 0.5, at1: 1.3 },
    // Pulse — CentralGlow.ts : SPRITE_SIZE/GLOW_DIAMETER = 0.5 par défaut.
    'pulse.centralGlow.intensityMul': { at0: 0.4, at1: 1.8 },
    'pulse.centralGlow.diameter': { at0: 0.35, at1: 0.7 },
    // Spectrum Pro — SpectrumBars.ts : multiplie l'alpha (0.5) du halo par barre.
    'spectrum-pro.spectrumBars.glowAlphaMul': { at0: 0.4, at1: 1.6 },
  }),
  chaos: Object.freeze({
    // Field — ParticleField.ts : multiplie l'amplitude des tirages `step.rng` DÉJÀ existants au spawn (angle/vitesse), n'en ajoute aucun.
    'field.particleField.chaosMul': { at0: 0.5, at1: 2.0 },
    // Pulse — PulseRings.ts : jitter de rayon (unités normalisées) tiré UNE fois par anneau, à son apparition sur DOWNBEAT.
    'pulse.pulseRings.chaosJitter': { at0: 0, at1: 0.04 },
    // Spectrum Pro — SpectrumBars.ts : à-coup de vitesse (unités normalisées/s) tiré à chaque réinitialisation de chapeau de pic.
    'spectrum-pro.spectrumBars.peakChaosJitter': { at0: 0, at1: 0.5 },
  }),
  smoothness: Object.freeze({
    // Field — ParticleField.ts : DRAG_PER_SEC = 0.6 par défaut (amortissement de vitesse — plus haut = plus « flottant »).
    'field.particleField.drag': { at0: 0.3, at1: 1.2 },
    // Pulse — ScreenShake.ts : DECAY = 0.15s par défaut (décroissance du tremblement, plus long = plus rond).
    'pulse.screenShake.decaySec': { at0: 0.08, at1: 0.3 },
    // Spectrum Pro — SpectrumBars.ts : BAR_FALL_TAU = 0.35s par défaut (retombée des barres, pas l'attaque — voir movement).
    'spectrum-pro.spectrumBars.fallTau': { at0: 0.15, at1: 0.55 },
  }),
});

/**
 * Résout `LAYER_MACRO_CURVES` pour `macros`/`styleId` et assigne le résultat à `layer.params` de
 * chaque couche de `scene` — extrait ici (Étape 26) pour être appelé identiquement par
 * `ui/App.ts::applyLayerMacros()` (preview) ET `export/ExportPipeline.ts::runExport()` (export),
 * qui construisaient jusqu'ici deux Scenes indépendantes sans jamais partager cette logique :
 * l'export ne l'appliquait tout simplement JAMAIS (gap découvert et signalé à l'Étape 25, corrigé
 * ici). Dupliquer cette boucle dans les deux fichiers aurait risqué de les faire diverger — un seul
 * point de vérité plutôt que deux copies à maintenir en phase.
 *
 * Remplace ENTIÈREMENT `layer.params` (comme avant l'extraction) : un appelant qui a besoin d'y
 * ajouter un réglage supplémentaire (ex. `bandCount` de `spectrumBars`, Étape 25 — piloté par le
 * niveau de qualité, pas par les macros) doit le faire APRÈS cet appel, pas avant.
 */
export function applyLayerMacrosToScene(scene: Scene, macros: PresetMacros, styleId: StyleId): void {
  const flat = applyMacroCurves(macros, LAYER_MACRO_CURVES);
  const layerPrefix = `${styleId}.`;
  for (const layer of scene.layers) {
    const paramPrefix = `${layerPrefix}${layer.id}.`;
    const params: Record<string, number> = {};
    for (const [path, value] of Object.entries(flat)) {
      if (path.startsWith(paramPrefix)) params[path.slice(paramPrefix.length)] = value;
    }
    layer.params = params;
  }
}
