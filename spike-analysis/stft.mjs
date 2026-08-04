// spike-analysis/stft.mjs — prototype jetable (P1b).
// FFT réelle 1024, fenêtrage Hann, hop 128 : le minimum requis par le test de Dirac
// (docs/04_AUDIO_ANALYSIS.md, Étape 1 et convention d'horodatage l.77-97).
// Deviendra analysis/fft.ts et analysis/stft.ts (P4), optimisé (vraie FFT réelle, pas
// une FFT complexe sur signal réel) — ce fichier privilégie la clarté et la preuve de
// correction, pas la performance.

export const WINDOW_SIZE = 1024;
export const HOP = 128;

/** FFT complexe radix-2, itérative, en place. n doit être une puissance de 2. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len / 2;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

/** Fenêtre de Hann, taille N. */
export function hannWindow(size) {
  const w = new Float64Array(size);
  for (let n = 0; n < size; n++) {
    w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (size - 1));
  }
  return w;
}

/**
 * STFT : fenêtrage Hann + hop, magnitude sur 513 bins (0..windowSize/2).
 * Retourne un tableau de trames (Float64Array de longueur windowSize/2 + 1).
 */
export function stft(signal, { windowSize = WINDOW_SIZE, hop = HOP } = {}) {
  const window = hannWindow(windowSize);
  const numFrames = Math.max(0, Math.floor((signal.length - windowSize) / hop) + 1);
  const frames = [];
  for (let i = 0; i < numFrames; i++) {
    const start = i * hop;
    const re = new Float64Array(windowSize);
    const im = new Float64Array(windowSize);
    for (let n = 0; n < windowSize; n++) {
      re[n] = signal[start + n] * window[n];
    }
    fft(re, im);
    const mags = new Float64Array(windowSize / 2 + 1);
    for (let k = 0; k <= windowSize / 2; k++) {
      mags[k] = Math.hypot(re[k], im[k]);
    }
    frames.push(mags);
  }
  return frames;
}

/**
 * Horodatage d'une trame — convention CENTRE de fenêtre, moins le retard de groupe
 * du rééchantillonneur (docs/04 l.83) :
 *   t_trame(i) = (i·hop + fenetre/2) / sr_analyse − retardGroupeResampler
 */
export function frameTimestamp(frameIndex, { windowSize = WINDOW_SIZE, hop = HOP, sampleRate, resamplerGroupDelaySec = 0 }) {
  return (frameIndex * hop + windowSize / 2) / sampleRate - resamplerGroupDelaySec;
}

/** Flux spectral demi-redressé (docs/04 Étape 3) : ne compte que les augmentations de magnitude. */
export function spectralFlux(frames) {
  const flux = new Float64Array(frames.length);
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const cur = frames[i];
    let sum = 0;
    for (let k = 0; k < cur.length; k++) {
      const d = cur[k] - prev[k];
      if (d > 0) sum += d;
    }
    flux[i] = sum;
  }
  return flux;
}

/**
 * Détection d'un onset unique par énergie de trame maximale + affinage temporel
 * (docs/04 Étape 4, point 6) : recherche du maximum de l'enveloppe BRUTE dans une
 * fenêtre de ±6 ms autour de la trame grossière. Volontairement minimal — un seul
 * onset, pas de seuil adaptatif ni de période réfractaire (ça, c'est dsp.mjs / P4).
 *
 * Pourquoi l'ÉNERGIE et non le flux pour la position grossière : pour une impulsion
 * isolée fenêtrée par une Hann, l'énergie par trame suit la forme de la fenêtre —
 * une bosse symétrique dont le sommet est exactement la trame centrée sur
 * l'impulsion (précision ±hop/2). Le flux (dérivée demi-redressée de cette bosse)
 * culmine sur le flanc montant, AVANT le sommet — biais systématique de plus d'un
 * hop, découvert par le test de Dirac (docs/04, spike-analysis/dirac-test.mjs).
 * Le flux reste calculé/exporté : il sert à la détection multi-onset de dsp.mjs.
 */
export function detectSingleOnset(signal, sampleRate, { windowSize = WINDOW_SIZE, hop = HOP, resamplerGroupDelaySec = 0 } = {}) {
  const frames = stft(signal, { windowSize, hop });
  const flux = spectralFlux(frames);

  let bestI = 0;
  let bestV = -Infinity;
  for (let i = 0; i < frames.length; i++) {
    let energy = 0;
    const f = frames[i];
    for (let k = 0; k < f.length; k++) energy += f[k];
    if (energy > bestV) {
      bestV = energy;
      bestI = i;
    }
  }
  const coarseT = frameTimestamp(bestI, { windowSize, hop, sampleRate, resamplerGroupDelaySec });

  // Le signal RAW porte encore le retard de groupe : on recentre la recherche dessus
  // avant de re-soustraire la compensation sur le résultat affiné.
  const searchCenterSec = coarseT + resamplerGroupDelaySec;
  const searchRadiusSamples = Math.round(0.006 * sampleRate);
  const centerSample = Math.round(searchCenterSec * sampleRate);
  const lo = Math.max(0, centerSample - searchRadiusSamples);
  const hi = Math.min(signal.length - 1, centerSample + searchRadiusSamples);

  let peakSample = centerSample;
  let peakAmp = -Infinity;
  for (let n = lo; n <= hi; n++) {
    const a = Math.abs(signal[n]);
    if (a > peakAmp) {
      peakAmp = a;
      peakSample = n;
    }
  }
  const refinedT = peakSample / sampleRate - resamplerGroupDelaySec;

  return { coarseT, refinedT, frameIndex: bestI, energy: bestV, flux };
}
