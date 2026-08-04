/**
 * Normalisation par percentile — analysis/normalize (docs/04_AUDIO_ANALYSIS.md Étape 5).
 * Toute normalisation par valeur absolue est exclue : un morceau à −6 LUFS et un à
 * −24 LUFS doivent produire les mêmes visuels. Percentiles plutôt que min/max : un
 * unique crash ou un blanc de début ne doit pas écraser toute l'échelle — 5% des
 * trames saturent en haut et en bas, ce qui est le comportement visuel voulu.
 */
import { percentile } from '../core/math/percentile';

export interface NormalizationRange {
  readonly p05: number;
  readonly p95: number;
}

export function computeNormalizationRange(data: ArrayLike<number>): NormalizationRange {
  return { p05: percentile(data, 0.05), p95: percentile(data, 0.95) };
}

/** `normalisé = clamp((x − p05) / (p95 − p05), 0, 1)` (docs/04 l.176). */
export function normalizeTrack(data: ArrayLike<number>, range?: NormalizationRange): Float32Array {
  const r = range ?? computeNormalizationRange(data);
  const span = r.p95 - r.p05;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = span > 0 ? (data[i]! - r.p05) / span : 0;
    out[i] = Math.min(1, Math.max(0, v));
  }
  return out;
}
