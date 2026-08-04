/**
 * STFT — analysis/stft (docs/04_AUDIO_ANALYSIS.md Étape 1 et convention d'horodatage).
 * Fenêtre Hann 1024, hop 128 par défaut → 172 trames/s, résolution 21,5 Hz.
 */
import { hannWindow, realSpectrumMagnitudes } from './fft';

export const WINDOW_SIZE = 1024;
export const HOP = 128;

export interface StftOptions {
  readonly windowSize?: number;
  readonly hop?: number;
}

export interface FrameTimestampOptions extends StftOptions {
  readonly sampleRate: number;
  readonly resamplerGroupDelaySec?: number;
}

/**
 * `t_trame(i) = (i·hop + fenêtre/2) / sr_analyse − retardGroupeResampler`
 * (docs/04 l.83). Horodatage au CENTRE de la fenêtre — voir justification l.86-89.
 */
export function frameTimestamp(frameIndex: number, opts: FrameTimestampOptions): number {
  const windowSize = opts.windowSize ?? WINDOW_SIZE;
  const hop = opts.hop ?? HOP;
  const groupDelay = opts.resamplerGroupDelaySec ?? 0;
  return (frameIndex * hop + windowSize / 2) / opts.sampleRate - groupDelay;
}

/** Nombre de trames produites par `stft` pour un signal de `signalLength` échantillons. */
export function frameCount(signalLength: number, opts: StftOptions = {}): number {
  const windowSize = opts.windowSize ?? WINDOW_SIZE;
  const hop = opts.hop ?? HOP;
  return Math.max(0, Math.floor((signalLength - windowSize) / hop) + 1);
}

/**
 * STFT : fenêtrage Hann + hop, magnitude sur windowSize/2 + 1 bins.
 * Retourne un tableau de trames (Float64Array par trame).
 */
export function stft(signal: Float64Array, opts: StftOptions = {}): Float64Array[] {
  const windowSize = opts.windowSize ?? WINDOW_SIZE;
  const hop = opts.hop ?? HOP;
  const window = hannWindow(windowSize);
  const numFrames = frameCount(signal.length, { windowSize, hop });

  const frames: Float64Array[] = [];
  const windowed = new Float64Array(windowSize);
  for (let i = 0; i < numFrames; i++) {
    const start = i * hop;
    for (let n = 0; n < windowSize; n++) {
      windowed[n] = signal[start + n]! * window[n]!;
    }
    frames.push(realSpectrumMagnitudes(windowed));
  }
  return frames;
}

/** Résolution fréquentielle d'un bin, en Hz. */
export function binHz(sampleRate: number, windowSize: number = WINDOW_SIZE): number {
  return sampleRate / windowSize;
}

/** Flux spectral demi-redressé (docs/04 Étape 3) : ne compte que les augmentations de magnitude. */
export function spectralFlux(frames: readonly Float64Array[]): Float64Array {
  const flux = new Float64Array(frames.length);
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1]!;
    const cur = frames[i]!;
    let sum = 0;
    for (let k = 0; k < cur.length; k++) {
      const d = cur[k]! - prev[k]!;
      if (d > 0) sum += d;
    }
    flux[i] = sum;
  }
  return flux;
}
