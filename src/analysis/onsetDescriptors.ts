/**
 * Descripteurs d'onsets (SANS classification) — analysis/onsetDescriptors
 * (docs/05_MUSIC_INTELLIGENCE.md §4, docs/12_INTEGRATION_PULSAR.md OnsetDescriptor).
 *
 * Point décisif : mesurés sur le spectre de DIFFÉRENCE (Δm), pas le spectre
 * absolu — sur les 17ms qui suivent un kick, le mix contient aussi hats/snare/
 * mélodie ; le centroïde du spectre absolu y est presque toujours > 800Hz,
 * jamais sous 250Hz. Sur le spectre de différence, seul le kick a ajouté de
 * l'énergie sous 120Hz.
 *
 * La classification (KICK/SNARE/…) n'a PAS lieu ici : elle dépend des seuils
 * du preset genre, encore inconnu à cette étape (docs/00a — Étape 12/P10).
 * Cette fonction ne produit que les 9 flottants bruts, conservés dans le PMDI
 * (`ext.onsetDescriptors`) pour permettre un reclassement en < 1ms sans réanalyse.
 */
import { BAND_IDS, bandEnergy, type BandId, type BinRange } from './bands';

export interface OnsetDescriptor {
  readonly t: number;
  readonly band: BandId;
  readonly strength: number; // 0..1
  readonly e: readonly [number, number, number, number, number, number]; // 6 bandes de Δm, fractions du total
  readonly centroid: number; // Hz
  readonly flatness: number; // 0..1
  readonly decay30: number; // secondes, plafonné à 0,5
  readonly decaySaturated: boolean;
}

const FLATNESS_EPS = 1e-12;
const DECAY_RATIO = 1 / 31.6; // −30dB
const DECAY_CAP_SEC = 0.5;

/** Δm(f) = moyenne sur les 3 trames suivant l'onset de max(0, mₜ(f) − mₜ₋₁(f)). */
function computeDeltaSpectrum(frames: readonly Float64Array[], onsetFrameIndex: number): Float64Array {
  const numBins = frames[0]!.length;
  const sum = new Float64Array(numBins);
  let count = 0;
  for (let k = 1; k <= 3; k++) {
    const t = onsetFrameIndex + k;
    if (t <= 0 || t >= frames.length) continue;
    const cur = frames[t]!;
    const prev = frames[t - 1]!;
    for (let bin = 0; bin < numBins; bin++) {
      const d = cur[bin]! - prev[bin]!;
      if (d > 0) sum[bin]! += d;
    }
    count++;
  }
  if (count > 0) {
    for (let bin = 0; bin < numBins; bin++) sum[bin] = sum[bin]! / count;
  }
  return sum;
}

function spectralCentroid(spectrum: Float64Array, binHz: number): number {
  let magSum = 0;
  let weighted = 0;
  for (let k = 0; k < spectrum.length; k++) {
    const m = spectrum[k]!;
    magSum += m;
    weighted += k * binHz * m;
  }
  return magSum > 0 ? weighted / magSum : 0;
}

function spectralFlatness(spectrum: Float64Array): number {
  let magSum = 0;
  let logSum = 0;
  const n = spectrum.length;
  for (let k = 0; k < n; k++) {
    const m = spectrum[k]!;
    magSum += m;
    logSum += Math.log(m + FLATNESS_EPS);
  }
  const geometricMean = Math.exp(logSum / n);
  const arithmeticMean = magSum / n + FLATNESS_EPS;
  return Math.min(1, geometricMean / arithmeticMean);
}

/**
 * `decay30 = min(premier t où env(t) < env_pic/31,6, 500ms)`, `decaySaturated`
 * si le seuil n'est pas atteint. Mesuré sur `framePeakTrack` (le `peak` par
 * trame de analysis/features.ts) — dans un mix dense, l'enveloppe ne redescend
 * souvent pas de 30dB avant le hit suivant : le cas nominal, pas l'exception.
 */
function computeDecay30(framePeakTrack: Float64Array, onsetFrameIndex: number, frameRate: number): { decay30: number; decaySaturated: boolean } {
  const envPeak = framePeakTrack[onsetFrameIndex] ?? 0;
  if (envPeak <= 0) return { decay30: DECAY_CAP_SEC, decaySaturated: true };

  const threshold = envPeak * DECAY_RATIO;
  const maxFrames = Math.round(DECAY_CAP_SEC * frameRate);
  const hi = Math.min(framePeakTrack.length - 1, onsetFrameIndex + maxFrames);

  for (let i = onsetFrameIndex + 1; i <= hi; i++) {
    if (framePeakTrack[i]! < threshold) {
      return { decay30: (i - onsetFrameIndex) / frameRate, decaySaturated: false };
    }
  }
  return { decay30: DECAY_CAP_SEC, decaySaturated: true };
}

export interface ComputeOnsetDescriptorOptions {
  readonly t: number;
  readonly band: BandId;
  readonly strength: number;
  readonly onsetFrameIndex: number;
  readonly frames: readonly Float64Array[];
  readonly framePeakTrack: Float64Array;
  readonly bandRanges: Readonly<Record<BandId, BinRange>>;
  readonly sampleRate: number;
  readonly windowSize: number;
  readonly hop: number;
}

export function computeOnsetDescriptor(opts: ComputeOnsetDescriptorOptions): OnsetDescriptor {
  const { t, band, strength, onsetFrameIndex, frames, framePeakTrack, bandRanges, sampleRate, windowSize, hop } = opts;
  const binHz = sampleRate / windowSize;
  const frameRate = sampleRate / hop;

  const delta = computeDeltaSpectrum(frames, onsetFrameIndex);

  const bandEnergies = BAND_IDS.map((b) => bandEnergy(delta, bandRanges[b]));
  const total = bandEnergies.reduce((a, b) => a + b, 0) || 1e-9;
  const e = bandEnergies.map((v) => v / total) as [number, number, number, number, number, number];

  const centroid = spectralCentroid(delta, binHz);
  const flatness = spectralFlatness(delta);
  const { decay30, decaySaturated } = computeDecay30(framePeakTrack, onsetFrameIndex, frameRate);

  return { t, band, strength, e, centroid, flatness, decay30, decaySaturated };
}
