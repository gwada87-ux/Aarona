/**
 * Features par trame — analysis/features (docs/04_AUDIO_ANALYSIS.md Étape 3).
 * `rms`/`peak` se mesurent sur le signal temporel BRUT de la fenêtre (pas la
 * magnitude) ; les autres, sur le spectre de magnitude de la trame.
 */

export interface FrameFeatures {
  readonly rms: number;
  readonly peak: number;
  readonly energy: number; // Σ m² — pilote `drive`
  readonly centroid: number; // Hz — pilote `brightness`
  readonly flatness: number; // 0..1 — bruit (hats, crashs) vs tonal (basse, voix)
  readonly rolloff85: number; // Hz — fréquence sous laquelle se trouve 85% de l'énergie
}

const FLATNESS_EPS = 1e-12;

export function computeFrameFeatures(rawSegment: Float64Array, magnitudeFrame: Float64Array, binHz: number): FrameFeatures {
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < rawSegment.length; i++) {
    const v = rawSegment[i]!;
    sumSq += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sumSq / rawSegment.length);

  let energy = 0;
  let weightedFreqSum = 0;
  let magSum = 0;
  let logSum = 0;
  const n = magnitudeFrame.length;
  for (let k = 0; k < n; k++) {
    const m = magnitudeFrame[k]!;
    energy += m * m;
    weightedFreqSum += k * binHz * m;
    magSum += m;
    logSum += Math.log(m + FLATNESS_EPS);
  }
  const centroid = magSum > 0 ? weightedFreqSum / magSum : 0;
  const geometricMean = Math.exp(logSum / n);
  const arithmeticMean = magSum / n + FLATNESS_EPS;
  const flatness = Math.min(1, geometricMean / arithmeticMean);

  const target = 0.85 * energy;
  let cum = 0;
  let rolloffBin = n - 1;
  for (let k = 0; k < n; k++) {
    const m = magnitudeFrame[k]!;
    cum += m * m;
    if (cum >= target) {
      rolloffBin = k;
      break;
    }
  }

  return { rms, peak, energy, centroid, flatness, rolloff85: rolloffBin * binHz };
}

/** Extrait le segment brut (non fenêtré) correspondant à la trame `frameIndex`. */
export function rawFrameSegment(signal: Float64Array, frameIndex: number, windowSize: number, hop: number): Float64Array {
  const start = frameIndex * hop;
  return signal.subarray(start, start + windowSize);
}

export function computeFrameFeatureTracks(
  signal: Float64Array,
  frames: readonly Float64Array[],
  opts: { windowSize: number; hop: number; sampleRate: number },
): FrameFeatures[] {
  const binHz = opts.sampleRate / opts.windowSize;
  const out: FrameFeatures[] = new Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    const raw = rawFrameSegment(signal, i, opts.windowSize, opts.hop);
    out[i] = computeFrameFeatures(raw, frames[i]!, binHz);
  }
  return out;
}
