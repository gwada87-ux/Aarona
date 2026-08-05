/**
 * FFT — analysis/fft (docs/04_AUDIO_ANALYSIS.md Étape 1).
 * `fft` : radix-2 complexe, itérative, en place (portée de spike-analysis/stft.mjs,
 * déjà validée face à une DFT naïve dans spike-analysis/dirac-test.mjs).
 * `realSpectrumMagnitudes` : FFT réelle par paquetage dans une FFT complexe de
 * taille N/2 — "une FFT complexe sur signal réel gaspille la moitié du calcul"
 * (docs/04 tableau Étape 1). N doit être une puissance de 2, paire.
 */

/** FFT complexe radix-2, en place. `re`/`im` de même longueur, puissance de 2. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k]!;
        const uIm = im[i + k]!;
        const vRe = re[i + k + half]! * curRe - im[i + k + half]! * curIm;
        const vIm = re[i + k + half]! * curIm + im[i + k + half]! * curRe;
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

/**
 * FFT inverse, en place — via le tour classique « conjuguer, FFT directe, conjuguer et diviser
 * par N » (évite de dupliquer les papillons de `fft()` avec le signe inverse). Ajoutée à l'Étape
 * 19 pour l'autocorrélation par FFT de `bassContour.ts::trackPitch` (théorème de
 * Wiener-Khinchin : autocorrélation = IFFT(|FFT(x)|²)) — bien plus rapide que la somme directe
 * pour la plage de délais utile à la détection de hauteur.
 */
export function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i]!;
  fft(re, im);
  const invN = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] = re[i]! * invN;
    im[i] = -im[i]! * invN;
  }
}

/** Fenêtre de Hann, taille N. */
export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let n = 0; n < size; n++) {
    w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (size - 1));
  }
  return w;
}

/**
 * Magnitudes du spectre d'un signal RÉEL de longueur N (puissance de 2, paire),
 * bins 0..N/2 inclus (N/2 + 1 valeurs). Paquetage classique : x[2n], x[2n+1] →
 * z[n] = x[2n] + i·x[2n+1], FFT complexe de taille N/2, puis dépaquetage par
 * symétrie hermitienne. `out` peut être fourni pour réutiliser un buffer.
 */
export function realSpectrumMagnitudes(signal: Float64Array, out?: Float64Array): Float64Array {
  const n = signal.length;
  const half = n >> 1;
  const result = out ?? new Float64Array(half + 1);

  const zr = new Float64Array(half);
  const zi = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    zr[i] = signal[2 * i]!;
    zi[i] = signal[2 * i + 1]!;
  }
  fft(zr, zi);

  for (let k = 0; k <= half; k++) {
    const mirror = k === 0 ? 0 : half - k;
    const zrK = zr[k % half]!;
    const ziK = zi[k % half]!;
    const zrM = zr[mirror]!;
    const ziM = -zi[mirror]!; // conjugué

    const evenRe = 0.5 * (zrK + zrM);
    const evenIm = 0.5 * (ziK + ziM);
    // Xodd = -i * (Z[k] - conj(Z[mirror])) / 2
    const diffRe = zrK - zrM;
    const diffIm = ziK - ziM;
    const oddRe = 0.5 * diffIm;
    const oddIm = -0.5 * diffRe;

    const ang = (-2 * Math.PI * k) / n;
    const twRe = Math.cos(ang);
    const twIm = Math.sin(ang);
    const xRe = evenRe + (oddRe * twRe - oddIm * twIm);
    const xIm = evenIm + (oddRe * twIm + oddIm * twRe);

    result[k] = Math.hypot(xRe, xIm);
  }

  return result;
}
