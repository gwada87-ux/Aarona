/**
 * Échantillonnage d'une piste continue à hz/t0 fixes — utilitaire partagé par
 * `structure.ts` et `macro.ts` (Étape 12/P10), toutes deux hors du Worker,
 * qui ne reçoivent que des tableaux (`FeatureTrack`-like), jamais les trames
 * STFT intermédiaires (déjà libérées, docs/03_DATA_FLOW.md).
 */
export interface SampledTrack {
  readonly hz: number;
  readonly t0: number;
  readonly data: ArrayLike<number>;
}

export function sampleAt(track: SampledTrack, t: number): number {
  const idx = Math.round((t - track.t0) * track.hz);
  const clamped = Math.max(0, Math.min(track.data.length - 1, idx));
  return track.data[clamped] ?? 0;
}

/** Moyenne sur `[tStart, tEnd)` — dégénère en un échantillon ponctuel si l'intervalle ne couvre aucune trame. */
export function averageOverInterval(track: SampledTrack, tStart: number, tEnd: number): number {
  const i0 = Math.max(0, Math.round((tStart - track.t0) * track.hz));
  const i1raw = Math.round((tEnd - track.t0) * track.hz);
  const i1 = Math.min(track.data.length - 1, Math.max(i0, i1raw - 1));
  if (i1 < i0) return sampleAt(track, tStart);
  let sum = 0;
  for (let i = i0; i <= i1; i++) sum += track.data[i] ?? 0;
  return sum / (i1 - i0 + 1);
}
