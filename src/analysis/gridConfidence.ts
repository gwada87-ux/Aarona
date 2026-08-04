/**
 * Confiance de grille et régime — analysis/gridConfidence
 * (docs/05_MUSIC_INTELLIGENCE.md §8). Calcule le scalaire
 * `confiance_grille` conservé dans `PmdiDocument.confidence.grid`.
 *
 * Le BASCULEMENT de régime "lissé sur 2 secondes" (docs/05 l.362) est un
 * comportement d'exécution (StepContext/BehaviourEngine, Étapes 7-8), pas un
 * calcul d'analyse hors-ligne : hors périmètre de ce module, qui ne fournit
 * que la valeur scalaire et un classement instantané informatif.
 */

/** Au-delà, la densité d'onsets est jugée maximale (edge-04 Hyperpop ≈ 40/s, docs/11 l.53). */
const ONSET_DENSITY_REFERENCE_PER_SEC = 20;

export function computeOnsetDensityNorm(totalOnsetCount: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  const perSec = totalOnsetCount / durationSec;
  return Math.max(0, Math.min(1, perSec / ONSET_DENSITY_REFERENCE_PER_SEC));
}

/** `0,5·confiance_tempo + 0,3·confiance_beats_moyenne + 0,2·densité_onsets_norm` (docs/05 l.350). */
export function computeGridConfidence(tempoConfidence: number, avgBeatConfidence: number, onsetDensityNorm: number): number {
  const raw = 0.5 * tempoConfidence + 0.3 * avgBeatConfidence + 0.2 * onsetDensityNorm;
  return Math.max(0, Math.min(1, raw));
}

export type Regime = 'event' | 'continuous';

/** Classement instantané, informatif — le lissage de transition vit ailleurs (voir en-tête). */
export function regimeFor(gridConfidence: number): Regime {
  return gridConfidence >= 0.6 ? 'event' : 'continuous';
}
