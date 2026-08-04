import { clamp } from '../math/clamp';

/** Correction bornée par appel — convergence douce, aucun saut visible. */
const MAX_CORRECTION_SECONDS = 0.002;

/** Au-delà, un seek externe est présumé : on resynchronise directement. */
export const HARD_RESYNC_THRESHOLD_SECONDS = 0.12;

export interface DriftCorrectionResult {
  readonly t: number;
  readonly resynced: boolean;
}

/**
 * docs/03_DATA_FLOW.md §Détail : la correction de dérive.
 * `tPredicted` avance en douceur (+dt, calculé par l'appelant) ; `tMeasured`
 * vient de l'horloge audio, par paliers. L'écart est rattrapé à 2 ms par
 * appel maximum, sauf au-delà du seuil de resync dur.
 */
export function correctDrift(tPredicted: number, tMeasured: number): DriftCorrectionResult {
  const error = tMeasured - tPredicted;
  if (Math.abs(error) > HARD_RESYNC_THRESHOLD_SECONDS) {
    return { t: tMeasured, resynced: true };
  }
  return {
    t: tPredicted + clamp(error, -MAX_CORRECTION_SECONDS, MAX_CORRECTION_SECONDS),
    resynced: false,
  };
}
