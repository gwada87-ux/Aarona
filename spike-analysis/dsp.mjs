// spike-analysis/dsp.mjs — prototype jetable (P1b), écrit UNIQUEMENT après que
// dirac-test.mjs soit vert (docs/04_AUDIO_ANALYSIS.md l.94-97).
// Détection d'onsets multi-événements (seuil adaptatif, période réfractaire) et
// estimation de tempo par autocorrélation. Pleine bande uniquement (pas encore les
// 6 sous-bandes de docs/04 Étape 2 — ce sera analysis/ en P4). Aucune nouvelle
// dépendance : DSP écrit maison (docs/04 §Pourquoi un DSP écrit maison).

import { stft, spectralFlux, frameTimestamp, WINDOW_SIZE, HOP } from './stft.mjs';

function percentile(arr, p) {
  const sorted = Array.from(arr).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

function median(sortedOrUnsorted) {
  const s = Array.from(sortedOrUnsorted).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function frameEnergy(frame) {
  let e = 0;
  for (let k = 0; k < frame.length; k++) e += frame[k];
  return e;
}

/**
 * Ancre une détection de flux (biaisée sur le flanc montant, cf. dirac-test.mjs) sur
 * la trame d'énergie maximale la plus proche, avant l'affinage fin sur l'enveloppe
 * brute. Même cause racine que stft.mjs:detectSingleOnset — le flux culmine avant
 * le sommet de la bosse d'énergie, pas dessus.
 */
function anchorToEnergyPeak(frames, flankFrame, radiusFrames) {
  const lo = Math.max(0, flankFrame - radiusFrames);
  const hi = Math.min(frames.length - 1, flankFrame + radiusFrames);
  let bestI = flankFrame;
  let bestE = -Infinity;
  for (let i = lo; i <= hi; i++) {
    const e = frameEnergy(frames[i]);
    if (e > bestE) {
      bestE = e;
      bestI = i;
    }
  }
  return bestI;
}

/** Affinage temporel — même principe que stft.mjs:detectSingleOnset (docs/04 étape 4.6). */
function refineOnsetTime(signal, sampleRate, coarseTSec, radiusSec = 0.006) {
  const radiusSamples = Math.round(radiusSec * sampleRate);
  const center = Math.round(coarseTSec * sampleRate);
  const lo = Math.max(0, center - radiusSamples);
  const hi = Math.min(signal.length - 1, center + radiusSamples);
  let peakSample = center;
  let peakAmp = -Infinity;
  for (let n = lo; n <= hi; n++) {
    const a = Math.abs(signal[n]);
    if (a > peakAmp) {
      peakAmp = a;
      peakSample = n;
    }
  }
  return peakSample / sampleRate;
}

/**
 * Détection d'onsets multi-événements, pleine bande (docs/04 Étape 4, étapes 0-5).
 * δ=0.03, λ≈1.6, W=0.15s : valeurs exactes de docs/04 l.144.
 */
export function detectOnsets(signal, sampleRate, {
  windowSize = WINDOW_SIZE,
  hop = HOP,
  medianWindowSec = 0.15,
  delta = 0.03,
  lambda = 1.6,
  refractorySec = 0.05,
  anchorRadiusFrames = 4, // couvre le biais flux-vs-énergie observé (~1-2 hops), reste < période réfractaire
} = {}) {
  const frames = stft(signal, { windowSize, hop });
  const rawFlux = spectralFlux(frames);

  // Étape 0 (obligatoire avant seuillage) : normalisation par le p95 sur tout le morceau.
  const p95 = percentile(rawFlux, 0.95) || 1e-9;
  const flux = Float64Array.from(rawFlux, (v) => v / p95);

  const n = flux.length;
  const frameRate = sampleRate / hop;
  const medianWindowFrames = Math.round(medianWindowSec * frameRate);

  const threshold = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - medianWindowFrames);
    const hi = Math.min(n - 1, i + medianWindowFrames);
    threshold[i] = delta + lambda * median(flux.subarray(lo, hi + 1));
  }

  const rawPeaks = [];
  for (let i = 1; i < n - 1; i++) {
    if (flux[i] > threshold[i] && flux[i] > flux[i - 1] && flux[i] >= flux[i + 1]) {
      rawPeaks.push(i);
    }
  }

  const refractoryFrames = Math.round(refractorySec * frameRate);
  const peakFrames = [];
  for (const i of rawPeaks) {
    const last = peakFrames[peakFrames.length - 1];
    if (last !== undefined && i - last < refractoryFrames) {
      if (flux[i] > flux[last]) peakFrames[peakFrames.length - 1] = i;
      continue;
    }
    peakFrames.push(i);
  }

  const onsets = peakFrames.map((i) => {
    const anchorFrame = anchorToEnergyPeak(frames, i, anchorRadiusFrames);
    const coarseT = frameTimestamp(anchorFrame, { windowSize, hop, sampleRate });
    const t = refineOnsetTime(signal, sampleRate, coarseT);
    const strength = Math.tanh((flux[i] - threshold[i]) / Math.max(threshold[i], delta));
    return { t, frameIndex: i, strength };
  });

  return { onsets, flux, threshold };
}

/**
 * Tempo par autocorrélation de l'ODF (flux normalisé), plage 60-200 BPM.
 * Confiance = corrélation au meilleur lag normalisée par l'énergie à lag 0
 * (mesure grossière — la vraie confiance multi-résolution est P10/docs/05).
 */
export function estimateTempoByAutocorrelation(flux, hop, sampleRate, { minBpm = 60, maxBpm = 200 } = {}) {
  const frameRate = sampleRate / hop;
  const minLag = Math.max(1, Math.round(frameRate * (60 / maxBpm)));
  const maxLag = Math.round(frameRate * (60 / minBpm));

  const n = flux.length;
  const mean = flux.reduce((a, b) => a + b, 0) / n;
  const centered = Float64Array.from(flux, (v) => v - mean);

  let energy0 = 0;
  for (let i = 0; i < n; i++) energy0 += centered[i] * centered[i];

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += centered[i] * centered[i + lag];
    if (sum > bestScore) {
      bestScore = sum;
      bestLag = lag;
    }
  }

  const bpm = 60 / (bestLag * (hop / sampleRate));
  const confidence = energy0 > 0 ? Math.max(0, Math.min(1, bestScore / energy0)) : 0;
  return { bpm, lagFrames: bestLag, confidence };
}
