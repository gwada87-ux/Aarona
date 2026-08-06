/**
 * Conversions Hz <-> bin FFT pour le mode live. Tout est derive du
 * `sampleRate` reel fourni par l'`AudioContext` (§2.0 : aucun `44100` en dur -
 * 48 kHz est tres courant).
 *
 * Distinct de `src/analysis/bands.ts` : la-bas les plages sont semantiques et
 * calculees une fois sur un spectrogramme complet ; ici on borne aussi le bin
 * bas pour exclure la composante continue et le repli de fenetre (§2.3.4), ce
 * que le mode fichier n'a pas a faire.
 */

import type { LiveHzRange } from '../LiveConfig';

/** Plage de bins inclusive aux deux bouts. */
export interface BinSpan {
  readonly lo: number;
  readonly hi: number;
}

/** Bins 0 et 1 exclus partout : continue + repli de la fenetre d'analyse (§2.3.4). */
export const MIN_USABLE_BIN = 2;

/** Largeur d'un bin, en Hz. */
export function binWidthHz(sampleRate: number, fftSize: number): number {
  return sampleRate / fftSize;
}

/** Frequence centrale du bin `k`, en Hz. */
export function binToHz(k: number, sampleRate: number, fftSize: number): number {
  return (k * sampleRate) / fftSize;
}

/**
 * Plage de bins couvrant `[loHz, hiHz]`. `hi` est toujours >= `lo` : une bande
 * plus etroite qu'un bin renverrait 0 sinon (§2.2, « verifie que chaque bande
 * couvre au moins 1 bin »). `lo` est borne a `MIN_USABLE_BIN`.
 */
export function hzRangeToBins(range: LiveHzRange, sampleRate: number, fftSize: number): BinSpan {
  const width = binWidthHz(sampleRate, fftSize);
  const lastBin = fftSize / 2 - 1;
  const lo = Math.min(lastBin, Math.max(MIN_USABLE_BIN, Math.round(range.lo / width)));
  const hi = Math.min(lastBin, Math.max(lo, Math.round(range.hi / width)));
  return { lo, hi };
}

/**
 * `bandCount` tranches log-espacees entre `minHz` et `maxHz`. Meme partage de
 * l'espace log(Hz) que `computeLogSpacedBinRanges` (src/analysis/spectrumBands),
 * mais avec le plancher de bin et la garantie « au moins 1 bin » du live.
 */
export function logSpacedBins(
  bandCount: number,
  minHz: number,
  maxHz: number,
  sampleRate: number,
  fftSize: number,
): BinSpan[] {
  const logMin = Math.log(minHz);
  const logMax = Math.log(maxHz);
  const spans: BinSpan[] = [];
  for (let i = 0; i < bandCount; i++) {
    const loHz = Math.exp(logMin + ((logMax - logMin) * i) / bandCount);
    const hiHz = Math.exp(logMin + ((logMax - logMin) * (i + 1)) / bandCount);
    spans.push(hzRangeToBins({ lo: loHz, hi: hiHz }, sampleRate, fftSize));
  }
  return spans;
}

/** Somme de puissance lineaire sur une plage de bins, depuis un spectre en dB. */
export function bandPowerFromDb(db: Float32Array, span: BinSpan, dbFloor: number): number {
  let sum = 0;
  for (let k = span.lo; k <= span.hi && k < db.length; k++) {
    const v = db[k];
    if (v === undefined) continue;
    sum += Math.pow(10, (v > dbFloor ? v : dbFloor) / 10);
  }
  return sum;
}

/** Conversion puissance lineaire -> dB, avec le meme epsilon partout. */
export function powerToDb(power: number): number {
  return 10 * Math.log10(power + 1e-12);
}
