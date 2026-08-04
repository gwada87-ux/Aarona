/**
 * Bandes d'énergie — analysis/bands (docs/04_AUDIO_ANALYSIS.md Étape 2).
 * Frontières fixes, pas arbitraires : elles suivent la répartition réelle des
 * éléments d'un beat en Trap / Drill / House.
 */

export type BandId = 'sub' | 'bass' | 'lowmid' | 'mid' | 'himid' | 'high';

export const BAND_IDS: readonly BandId[] = ['sub', 'bass', 'lowmid', 'mid', 'himid', 'high'];

export const BAND_RANGES_HZ: Readonly<Record<BandId, readonly [number, number]>> = {
  sub: [20, 60],
  bass: [60, 120],
  lowmid: [120, 400],
  mid: [400, 2000],
  himid: [2000, 6000],
  high: [6000, 11000],
};

export interface BinRange {
  readonly lo: number; // inclus
  readonly hi: number; // inclus
}

function hzToBin(hz: number, binHz: number): number {
  return Math.round(hz / binHz);
}

export function bandBinRange(band: BandId, sampleRate: number, windowSize: number): BinRange {
  const binHz = sampleRate / windowSize;
  const maxBin = windowSize / 2;
  const [loHz, hiHz] = BAND_RANGES_HZ[band];
  return {
    lo: Math.max(0, hzToBin(loHz, binHz)),
    hi: Math.min(maxBin, hzToBin(hiHz, binHz)),
  };
}

export function bandBinRanges(sampleRate: number, windowSize: number): Record<BandId, BinRange> {
  const out = {} as Record<BandId, BinRange>;
  for (const band of BAND_IDS) out[band] = bandBinRange(band, sampleRate, windowSize);
  return out;
}

/** Somme des magnitudes (linéaire) sur une plage de bins — base du flux par bande. */
export function bandMagnitudeSum(frame: Float64Array, range: BinRange): number {
  let sum = 0;
  for (let k = range.lo; k <= range.hi; k++) sum += frame[k]!;
  return sum;
}

/** Énergie d'une bande = somme des magnitudes² (docs/04 l.114). */
export function bandEnergy(frame: Float64Array, range: BinRange): number {
  let sum = 0;
  for (let k = range.lo; k <= range.hi; k++) {
    const m = frame[k]!;
    sum += m * m;
  }
  return sum;
}

/** Piste d'énergie par bande sur toutes les trames (linéaire, avant dB/normalisation). */
export function bandEnergyTracks(
  frames: readonly Float64Array[],
  ranges: Readonly<Record<BandId, BinRange>>,
): Record<BandId, Float64Array> {
  const out = {} as Record<BandId, Float64Array>;
  for (const band of BAND_IDS) {
    const range = ranges[band];
    const track = new Float64Array(frames.length);
    for (let i = 0; i < frames.length; i++) track[i] = bandEnergy(frames[i]!, range);
    out[band] = track;
  }
  return out;
}

/**
 * Flux spectral demi-redressé PAR BANDE (docs/04 Étape 3 `flux[band]`, base de la
 * détection d'onsets Étape 4). Restreint la somme du flux plein spectre à la
 * plage de bins de la bande.
 */
export function bandFluxTracks(
  frames: readonly Float64Array[],
  ranges: Readonly<Record<BandId, BinRange>>,
): Record<BandId, Float64Array> {
  const out = {} as Record<BandId, Float64Array>;
  for (const band of BAND_IDS) {
    const range = ranges[band];
    const track = new Float64Array(frames.length);
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1]!;
      const cur = frames[i]!;
      let sum = 0;
      for (let k = range.lo; k <= range.hi; k++) {
        const d = cur[k]! - prev[k]!;
        if (d > 0) sum += d;
      }
      track[i] = sum;
    }
    out[band] = track;
  }
  return out;
}
