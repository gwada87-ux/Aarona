/**
 * Contour de basse / 808 — analysis/bassContour (docs/04_AUDIO_ANALYSIS.md
 * Étape 6, docs/05_MUSIC_INTELLIGENCE.md §5). Une 808 n'est pas un onset :
 * c'est une note tenue avec un contour. Sortie : segments `{t, dur, midi,
 * confidence}` — la fiabilité réelle est 60-80% sur un mix dense (masquage
 * par le kick), suffisant pour piloter un mouvement lent, pas pour afficher
 * des noms de notes (le produit ne le prétendra jamais en Mode A).
 */
import { median } from '../core/math/percentile';

export interface BiquadCoeffs {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** RBJ Audio EQ Cookbook, section passe-bas. */
function lowpassBiquad(cutoffHz: number, q: number, sampleRate: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosw0) / 2 / a0,
    b1: (1 - cosw0) / a0,
    b2: (1 - cosw0) / 2 / a0,
    a1: (-2 * cosw0) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyBiquad(signal: Float64Array, c: BiquadCoeffs): Float64Array {
  const out = new Float64Array(signal.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x0 = signal[i]!;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** Facteurs Q des 2 sections biquad d'un Butterworth ordre 4 : Q_k = 1/(2·cos((2k−1)π/8)). */
const BUTTERWORTH4_Q: readonly number[] = [1 / (2 * Math.cos(Math.PI / 8)), 1 / (2 * Math.cos((3 * Math.PI) / 8))];

const DEFAULT_CUTOFF_HZ = 200;

/** Passe-bas Butterworth ordre 4 à `cutoffHz` (docs/04 l.191), 2 biquads en cascade. */
export function lowpassButterworth4(signal: Float64Array, sampleRate: number, cutoffHz: number = DEFAULT_CUTOFF_HZ): Float64Array {
  let out = signal;
  for (const q of BUTTERWORTH4_Q) out = applyBiquad(out, lowpassBiquad(cutoffHz, q, sampleRate));
  return out;
}

export interface PitchFrame {
  readonly t: number;
  readonly f0: number; // Hz
  readonly confidence: number; // 0..1, hauteur du pic d'autocorrélation normalisée
}

const PITCH_WINDOW = 2048;
const PITCH_HOP = 512;
const MIN_F0_HZ = 27.5; // A0
const MAX_F0_HZ = 200; // G3, docs/04 l.193

/** Autocorrélation par fenêtre de 2048 échantillons, hop 512 (docs/04 l.192). */
export function trackPitch(lowpassed: Float64Array, sampleRate: number): PitchFrame[] {
  const minLag = Math.max(1, Math.round(sampleRate / MAX_F0_HZ));
  const maxLag = Math.round(sampleRate / MIN_F0_HZ);
  const numFrames = Math.max(0, Math.floor((lowpassed.length - PITCH_WINDOW) / PITCH_HOP) + 1);

  const out: PitchFrame[] = [];
  for (let i = 0; i < numFrames; i++) {
    const start = i * PITCH_HOP;
    const seg = lowpassed.subarray(start, start + PITCH_WINDOW);

    let energy0 = 0;
    for (let n = 0; n < seg.length; n++) energy0 += seg[n]! * seg[n]!;

    let bestLag = minLag;
    let bestCorr = -Infinity;
    for (let lag = minLag; lag <= maxLag && lag < seg.length; lag++) {
      let sum = 0;
      for (let n = 0; n + lag < seg.length; n++) sum += seg[n]! * seg[n + lag]!;
      if (sum > bestCorr) {
        bestCorr = sum;
        bestLag = lag;
      }
    }

    const f0 = sampleRate / bestLag;
    const confidence = energy0 > 0 ? Math.max(0, Math.min(1, bestCorr / energy0)) : 0;
    const t = (start + PITCH_WINDOW / 2) / sampleRate; // centre de fenêtre
    out.push({ t, f0, confidence });
  }
  return out;
}

export interface BassNoteSegment {
  readonly t: number;
  readonly dur: number;
  readonly midi: number; // décimale autorisée
  readonly confidence: number;
}

const CENTS_TOLERANCE = 40;
const MIN_SEGMENT_SEC = 0.08;
/** En dessous, le pic d'autocorrélation n'est pas assez marqué pour parler de hauteur. */
const MIN_PITCH_CONFIDENCE = 0.1;

function centsDiff(f0a: number, f0b: number): number {
  return 1200 * Math.log2(f0a / f0b);
}

function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** `f0 stable (±40 cents) pendant ≥ 80ms` (docs/04 l.195). */
export function segmentBassNotes(pitchFrames: readonly PitchFrame[]): BassNoteSegment[] {
  const segments: BassNoteSegment[] = [];
  let i = 0;
  while (i < pitchFrames.length) {
    if (pitchFrames[i]!.confidence < MIN_PITCH_CONFIDENCE) {
      i++;
      continue;
    }
    const refF0 = pitchFrames[i]!.f0;
    let j = i;
    while (
      j + 1 < pitchFrames.length &&
      pitchFrames[j + 1]!.confidence >= MIN_PITCH_CONFIDENCE &&
      Math.abs(centsDiff(pitchFrames[j + 1]!.f0, refF0)) <= CENTS_TOLERANCE
    ) {
      j++;
    }

    const startT = pitchFrames[i]!.t;
    const dur = pitchFrames[j]!.t - startT;
    if (dur >= MIN_SEGMENT_SEC) {
      const slice = pitchFrames.slice(i, j + 1);
      const medianF0 = median(slice.map((p) => p.f0));
      const avgConfidence = slice.reduce((s, p) => s + p.confidence, 0) / slice.length;
      segments.push({ t: startT, dur, midi: hzToMidi(medianF0), confidence: avgConfidence });
    }
    i = j + 1;
  }
  return segments;
}

/** Chaîne complète : filtre → suivi de f0 → segmentation en notes. */
export function extractBassContour(signal: Float64Array, sampleRate: number): BassNoteSegment[] {
  const lowpassed = lowpassButterworth4(signal, sampleRate);
  const pitchFrames = trackPitch(lowpassed, sampleRate);
  return segmentBassNotes(pitchFrames);
}
