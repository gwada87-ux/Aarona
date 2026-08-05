/**
 * Les 4 niveaux de qualité — perf/qualityLevels (docs/10_PERFORMANCE.md
 * §"Les quatre niveaux de qualité"). Table de données pure, copie fidèle du
 * tableau du document.
 *
 * **Règle non négociable #1 (docs/10)** : le pas de simulation ne varie
 * JAMAIS — 1/120 s à tous les niveaux, y compris LOW. Le faire varier
 * casserait `stepIndex = round(t·120)`, donc la reproductibilité du PRNG,
 * donc le test golden. Ce fichier n'expose donc AUCUN champ « pas de
 * simulation » par niveau : la seule valeur qui existe est la constante
 * globale `FIXED_SIMULATION_DT`, identique pour tous.
 *
 * **Implémenté à l'Étape 16/P14** : seul `maxParticles` a un consommateur
 * réel aujourd'hui (`visual/layers/particles/ParticleField.ts` via
 * `visual/styles/field/createFieldStyle.ts`). `bloom`/`feedback`/
 * `chromaticAberration`/`internalResolutionScale`/`spectrumBands` sont
 * déclarés (la table du document existe intégralement, rien n'est omis) mais
 * SANS EFFET pour l'instant : aucun n'a de consommateur dans `visual/`/
 * `render/` — les ajouter exigerait de retoucher `FrameFeedback`,
 * `Canvas2DRenderer` (résolution interne) et `SpectrumBars`, hors budget de
 * cette étape. Voir docs/JOURNAL.md, Étape 16/P14, « limites connues ».
 */

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

/** Identique à tous les niveaux — voir l'avertissement en tête de fichier. */
export const FIXED_SIMULATION_DT = 1 / 120;

export interface BloomConfig {
  readonly enabled: boolean;
  /** Fraction de la résolution native (1/8, 1/4, 1/2) — sans objet si `enabled` est faux. */
  readonly resolutionScale: number;
  readonly passes: number;
}

export interface QualityLevelConfig {
  readonly maxParticles: number;
  readonly bloom: BloomConfig;
  readonly feedback: boolean;
  readonly chromaticAberration: boolean;
  /** Résolution interne du canvas, fraction de la résolution native (0,6× à 1,0×). */
  readonly internalResolutionScale: number;
  readonly spectrumBands: number;
}

export const QUALITY_LEVEL_CONFIGS: Readonly<Record<QualityLevel, QualityLevelConfig>> = Object.freeze({
  low: Object.freeze({
    maxParticles: 400,
    bloom: Object.freeze({ enabled: false, resolutionScale: 1, passes: 0 }),
    feedback: false,
    chromaticAberration: false,
    internalResolutionScale: 0.6,
    spectrumBands: 32,
  }),
  medium: Object.freeze({
    maxParticles: 1200,
    bloom: Object.freeze({ enabled: true, resolutionScale: 1 / 8, passes: 1 }),
    feedback: false,
    chromaticAberration: false,
    internalResolutionScale: 0.8,
    spectrumBands: 48,
  }),
  high: Object.freeze({
    maxParticles: 2500,
    bloom: Object.freeze({ enabled: true, resolutionScale: 1 / 4, passes: 2 }),
    feedback: true,
    chromaticAberration: true,
    internalResolutionScale: 1.0,
    spectrumBands: 64,
  }),
  ultra: Object.freeze({
    maxParticles: 5000,
    bloom: Object.freeze({ enabled: true, resolutionScale: 1 / 2, passes: 2 }),
    feedback: true,
    chromaticAberration: true,
    internalResolutionScale: 1.0,
    spectrumBands: 96,
  }),
});

/** Niveau imposé pour tout export (docs/10 règle non négociable #2) — jamais le `QualityGovernor` en vidéo finale. */
export const EXPORT_QUALITY_LEVEL: QualityLevel = 'high';
