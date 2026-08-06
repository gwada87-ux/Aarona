/**
 * Pilote le moteur d'analyse trame par trame sur un signal synthetique, sans
 * navigateur (§7). C'est ce harnais qui rend les criteres §8.1 a §8.7
 * verifiables sans humain.
 *
 * Le temps est entierement simule : `tAudio` avance de `1/fps`, exactement
 * comme `audioContext.currentTime` entre deux `requestAnimationFrame`.
 */

import { AnalyserModel } from './AnalyserModel';
import type { SyntheticSignal } from './SyntheticAudio';
import { LiveAnalysisEngine } from '../audio/LiveAnalysisEngine';
import { mergeLiveConfig, type LiveConfig, type LiveConfigPatch } from '../LiveConfig';

export interface FrameContext {
  readonly engine: LiveAnalysisEngine;
  readonly frame: number;
  readonly tAudio: number;
}

export interface EngineRunOptions {
  /** Cadence de trame simulee. 60 par defaut ; 120 et 30 servent aux tests de decouplage. */
  readonly fps?: number;
  /** Gigue de trame en ms, pour verifier que la grille 50 Hz absorbe un framerate irregulier. */
  readonly frameJitterMs?: number;
  /** Valeur d'`audioAheadMs` simulee. 20 ms = filaire typique. */
  readonly audioAheadMs?: number;
  /** Decalage d'horloge audio au demarrage - un `AudioContext` reel ne repart pas de 0. */
  readonly timeOffsetSec?: number;
  readonly onFrame?: (ctx: FrameContext) => void;
}

export function makeConfig(patch?: LiveConfigPatch): LiveConfig {
  return mergeLiveConfig(patch);
}

export function createEngine(signal: SyntheticSignal, config: LiveConfig = makeConfig()): LiveAnalysisEngine {
  return new LiveAnalysisEngine(config, signal.sampleRate, config.audio.fftSizeOnset, config.audio.fftSizeBands);
}

/** PRNG seede local a la gigue de trame - garde le harnais deterministe. */
function jitterSource(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (((t ^ (t >>> 15)) >>> 0) / 4294967296) * 2 - 1;
  };
}

export function runEngine(engine: LiveAnalysisEngine, signal: SyntheticSignal, opts: EngineRunOptions = {}): void {
  const fps = opts.fps ?? 60;
  const frameInterval = 1 / fps;
  const audioAheadMs = opts.audioAheadMs ?? 20;
  const offset = opts.timeOffsetSec ?? 0;
  const jitter = opts.frameJitterMs ? jitterSource(0x1234) : null;

  const config = engineConfig(engine);
  const onset = new AnalyserModel(config.fftSizeOnset);
  const bands = new AnalyserModel(config.fftSizeBands);
  const onsetDb = new Float32Array(onset.frequencyBinCount);
  const bandsDb = new Float32Array(bands.frequencyBinCount);
  const timeDomain = new Float32Array(config.fftSizeOnset);

  const frames = Math.floor(signal.durationSec * fps);
  for (let i = 0; i < frames; i++) {
    const jitterSec = jitter ? (jitter() * (opts.frameJitterMs ?? 0)) / 1000 : 0;
    const local = Math.min(signal.durationSec, Math.max(0, i * frameInterval + jitterSec));
    const endSample = Math.round(local * signal.sampleRate);
    onset.read(signal.pcm, endSample, onsetDb);
    bands.read(signal.pcm, endSample, bandsDb);
    onset.readTime(signal.pcm, endSample, timeDomain);
    engine.step({
      tAudio: offset + local,
      freqOnsetDb: onsetDb,
      freqBandsDb: bandsDb,
      timeDomain,
      audioAheadMs,
      frameIntervalSec: frameInterval,
    });
    opts.onFrame?.({ engine, frame: i, tAudio: offset + local });
  }
}

/** Le moteur ne republie pas sa config ; on la relit depuis les tailles de FFT qu'il a construites. */
function engineConfig(engine: LiveAnalysisEngine): { fftSizeOnset: number; fftSizeBands: number } {
  return {
    fftSizeOnset: engine.onsetFftSize,
    fftSizeBands: engine.bandsFftSize,
  };
}
