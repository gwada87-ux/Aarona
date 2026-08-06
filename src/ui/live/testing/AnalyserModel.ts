/**
 * Modele d'`AnalyserNode` sans navigateur (§7) : produit exactement ce que
 * `getFloatFrequencyData` / `getFloatTimeDomainData` renverraient pour un
 * signal PCM donne, a un instant de lecture donne.
 *
 * Conforme a la definition Web Audio :
 *   1. fenetre de Blackman `w[n] = a0 - a1*cos(2*pi*n/N) + a2*cos(4*pi*n/N)`
 *      avec `a0 = 0.42, a1 = 0.5, a2 = 0.08` ;
 *   2. FFT ;
 *   3. magnitude divisee par `fftSize` ;
 *   4. lissage temporel - ici toujours 0, conformement a §2.0 ;
 *   5. `20 * log10(X)`.
 *
 * Reutilise `src/analysis/fft.ts` (radix-2 en place, deja teste par
 * `tests/unit/fft.test.ts`) plutot que d'en ecrire une seconde.
 *
 * Fichier de banc d'essai : jamais importe par le code d'application, donc
 * absent du bundle de production.
 */

import { fft } from '../../../analysis/fft';

/** Plancher applique a la place de `-Infinity` pour un bin nul. */
const DB_FLOOR = -200;

export class AnalyserModel {
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(readonly fftSize: number) {
    this.window = new Float64Array(fftSize);
    for (let n = 0; n < fftSize; n++) {
      this.window[n] = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / fftSize) + 0.08 * Math.cos((4 * Math.PI * n) / fftSize);
    }
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
  }

  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }

  /**
   * Remplit `outDb` (taille `fftSize/2`) avec le spectre en dBFS de la fenetre
   * de `fftSize` echantillons se TERMINANT a `endSample` (exclu), comme le
   * ferait un `AnalyserNode` lu a cet instant. Les echantillons avant le debut
   * du signal valent 0.
   */
  read(signal: Float32Array, endSample: number, outDb: Float32Array): void {
    const start = endSample - this.fftSize;
    for (let n = 0; n < this.fftSize; n++) {
      const i = start + n;
      const x = i >= 0 && i < signal.length ? (signal[i] ?? 0) : 0;
      this.re[n] = x * this.window[n]!;
      this.im[n] = 0;
    }
    fft(this.re, this.im);
    const bins = this.fftSize / 2;
    for (let k = 0; k < bins; k++) {
      const mag = Math.hypot(this.re[k]!, this.im[k]!) / this.fftSize;
      outDb[k] = mag > 0 ? 20 * Math.log10(mag) : DB_FLOOR;
    }
  }

  /** Bloc temporel brut (pas de fenetrage), meme convention de fin de fenetre. */
  readTime(signal: Float32Array, endSample: number, out: Float32Array): void {
    const start = endSample - out.length;
    for (let n = 0; n < out.length; n++) {
      const i = start + n;
      out[n] = i >= 0 && i < signal.length ? (signal[i] ?? 0) : 0;
    }
  }
}
