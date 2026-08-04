/**
 * Détection d'onsets par bande — analysis/onsets (docs/04_AUDIO_ANALYSIS.md Étape 4).
 * Pour chaque bande, indépendamment : normalisation p95 → lissage → seuil adaptatif
 * médian → pics → période réfractaire → force → affinage temporel.
 *
 * Inclut l'ancrage sur le pic d'énergie avant affinage, un correctif trouvé par
 * exécution (pas dans la description abstraite de docs/04), documenté dans
 * docs/JOURNAL.md Étape 2 : le pic du flux spectral est en avance sur le pic
 * d'énergie (biais systématique de plus d'un hop, ~5,8ms) — sans cet ancrage, la
 * fenêtre de recherche ±6ms de l'affinage peut manquer le vrai pic.
 */
import type { BandId } from './bands';
import { bandEnergy, type BinRange } from './bands';
import { median, percentile } from '../core/math/percentile';
import { frameTimestamp } from './stft';

export interface RawOnset {
  readonly t: number; // secondes, affiné
  readonly frameIndex: number; // trame de détection (flux), avant ancrage
  readonly band: BandId;
  readonly strength: number; // 0..1, tanh((ODF−seuil)/max(seuil,δ))
}

const MEDIAN_WINDOW_SEC = 0.15; // W, docs/04 l.144
const DELTA = 0.03;
const LAMBDA = 1.6;
const REFINE_RADIUS_SEC = 0.006;
const ANCHOR_RADIUS_FRAMES = 3; // couvre le biais flux-vs-énergie, reste < la plus petite période réfractaire

/** Périodes réfractaires par bande, docs/04 l.148 : "un hat peut être doublé à 25ms ; un kick, non." */
export const REFRACTORY_SEC: Readonly<Record<BandId, number>> = {
  sub: 0.06,
  bass: 0.06,
  lowmid: 0.05,
  mid: 0.045,
  himid: 0.04,
  high: 0.025,
};

/** Lissage sur 3 trames — réutilisé par analysis/tempo pour l'ODF global. */
export function smooth3(data: Float64Array): Float64Array {
  const n = data.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    let sum = 0;
    let count = 0;
    for (let k = lo; k <= hi; k++) {
      sum += data[k]!;
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

function anchorToEnergyPeak(frames: readonly Float64Array[], range: BinRange, flankFrame: number, radiusFrames: number): number {
  const lo = Math.max(0, flankFrame - radiusFrames);
  const hi = Math.min(frames.length - 1, flankFrame + radiusFrames);
  let bestI = flankFrame;
  let bestE = -Infinity;
  for (let i = lo; i <= hi; i++) {
    const e = bandEnergy(frames[i]!, range);
    if (e > bestE) {
      bestE = e;
      bestI = i;
    }
  }
  return bestI;
}

function refineOnsetTime(rawSignal: Float64Array, sampleRate: number, coarseTSec: number): number {
  const radiusSamples = Math.round(REFINE_RADIUS_SEC * sampleRate);
  const center = Math.round(coarseTSec * sampleRate);
  const lo = Math.max(0, center - radiusSamples);
  const hi = Math.min(rawSignal.length - 1, center + radiusSamples);
  let peakSample = center;
  let peakAmp = -Infinity;
  for (let n = lo; n <= hi; n++) {
    const a = Math.abs(rawSignal[n]!);
    if (a > peakAmp) {
      peakAmp = a;
      peakSample = n;
    }
  }
  return peakSample / sampleRate;
}

export interface DetectBandOnsetsOptions {
  readonly band: BandId;
  readonly range: BinRange;
  readonly frames: readonly Float64Array[]; // spectre plein, pour l'ancrage énergie
  readonly rawFlux: Float64Array; // flux[band], docs Étape 3
  readonly rawSignal: Float64Array; // signal temporel complet, pour l'affinage
  readonly sampleRate: number;
  readonly windowSize: number;
  readonly hop: number;
  readonly resamplerGroupDelaySec?: number;
}

export function detectBandOnsets(opts: DetectBandOnsetsOptions): RawOnset[] {
  const { band, range, frames, rawFlux, rawSignal, sampleRate, windowSize, hop } = opts;
  const groupDelay = opts.resamplerGroupDelaySec ?? 0;

  // Étape 0 (obligatoire avant seuillage) : normalisation par le p95 sur tout le morceau.
  const p95 = percentile(rawFlux, 0.95) || 1e-9;
  const normalized = Float64Array.from(rawFlux, (v) => v / p95);

  // Étape 1 : lissage sur 3 trames.
  const odf = smooth3(normalized);

  const frameRate = sampleRate / hop;
  const medianWindowFrames = Math.round(MEDIAN_WINDOW_SEC * frameRate);
  const n = odf.length;

  // Étape 2 : seuil adaptatif, médiane (insensible aux pics eux-mêmes).
  const threshold = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - medianWindowFrames);
    const hi = Math.min(n - 1, i + medianWindowFrames);
    threshold[i] = DELTA + LAMBDA * median(odf.subarray(lo, hi + 1));
  }

  // Étape 3 : maximum local strict, au-dessus du seuil.
  const rawPeaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (odf[i]! > threshold[i]! && odf[i]! > odf[i - 1]! && odf[i]! >= odf[i + 1]!) {
      rawPeaks.push(i);
    }
  }

  // Étape 4 : période réfractaire par bande.
  const refractoryFrames = Math.round(REFRACTORY_SEC[band] * frameRate);
  const peakFrames: number[] = [];
  for (const i of rawPeaks) {
    const last = peakFrames[peakFrames.length - 1];
    if (last !== undefined && i - last < refractoryFrames) {
      if (odf[i]! > odf[last]!) peakFrames[peakFrames.length - 1] = i;
      continue;
    }
    peakFrames.push(i);
  }

  // Étape 5 (force) + ancrage énergie + Étape 6 (affinage ±6ms sur l'enveloppe brute).
  return peakFrames.map((i) => {
    // max(seuil, δ) au dénominateur — évite Infinity/NaN sur un passage silencieux.
    const rawStrength = Math.tanh((odf[i]! - threshold[i]!) / Math.max(threshold[i]!, DELTA));
    const strength = Math.max(0, Math.min(1, rawStrength));

    const anchorFrame = anchorToEnergyPeak(frames, range, i, ANCHOR_RADIUS_FRAMES);
    const coarseT = frameTimestamp(anchorFrame, { sampleRate, windowSize, hop, resamplerGroupDelaySec: groupDelay });
    const searchCenterSec = coarseT + groupDelay; // le signal RAW porte encore le retard de groupe
    const t = refineOnsetTime(rawSignal, sampleRate, searchCenterSec) - groupDelay;

    return { t, frameIndex: i, band, strength };
  });
}
