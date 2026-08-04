/**
 * Suivi de beats — analysis/beats (docs/05_MUSIC_INTELLIGENCE.md §2).
 * Programmation dynamique (approche Ellis) : place les temps, pas seulement la
 * période. Tolère les mesures sans onset (un break, un silence) tout en
 * gardant la grille — un détecteur de pics naïf perdrait le compte.
 */
import { percentile } from '../core/math/percentile';
import { frameTimestamp } from './stft';

const ALPHA = 0.8; // compromis "suivre le signal" / "rester régulier", docs/05 l.98
const SEARCH_WINDOW_PERIODS = 2; // "W ≈ 2 périodes", docs/05 l.106

export interface Beat {
  readonly t: number;
  readonly confidence: number;
}

export interface TrackBeatsOptions {
  readonly odf: Float64Array; // ODF global POSITIF (tempo.computeGlobalOdfPositive), 172 trames/s
  readonly bpm: number;
  readonly tempoConfidence: number;
  readonly sampleRate: number;
  readonly hop: number;
  readonly windowSize: number;
  readonly alpha?: number;
}

/**
 * `score(i) = ODF(i) + max_j[score(j) + α·pénalité(i−j, période)]`
 * `pénalité(Δ,P) = −(ln(Δ/P))²` (docs/05 l.93-98). Remontée du chemin optimal
 * depuis le maximum final. Confiance par beat : docs/05 l.111.
 */
export function trackBeats(opts: TrackBeatsOptions): Beat[] {
  const { odf, bpm, tempoConfidence, sampleRate, hop, windowSize } = opts;
  const alpha = opts.alpha ?? ALPHA;
  const frameRate = sampleRate / hop;
  const periodFrames = (60 / bpm) * frameRate;
  const n = odf.length;
  if (n === 0 || periodFrames < 1) return [];

  const score = new Float64Array(n);
  const backptr = new Int32Array(n).fill(-1);
  const windowFrames = Math.max(1, Math.round(periodFrames * SEARCH_WINDOW_PERIODS));

  for (let i = 0; i < n; i++) {
    let bestTerm = 0; // pas de prédécesseur : le beat commence ici
    let bestJ = -1;
    const jLo = Math.max(0, i - windowFrames);
    for (let j = jLo; j < i; j++) {
      const delta = i - j;
      const penalty = -Math.pow(Math.log(delta / periodFrames), 2);
      const candidate = score[j]! + alpha * penalty;
      if (candidate > bestTerm) {
        bestTerm = candidate;
        bestJ = j;
      }
    }
    score[i] = odf[i]! + bestTerm;
    backptr[i] = bestJ;
  }

  let endIdx = 0;
  let endScore = -Infinity;
  for (let i = 0; i < n; i++) {
    if (score[i]! > endScore) {
      endScore = score[i]!;
      endIdx = i;
    }
  }

  const indices: number[] = [];
  for (let cur = endIdx; cur !== -1; cur = backptr[cur]!) indices.push(cur);
  indices.reverse();

  const odfP95 = percentile(odf, 0.95) || 1e-9;
  return indices.map((i) => {
    const odfNormalized = Math.min(1, Math.max(0, odf[i]! / odfP95));
    const confidence = 0.6 * odfNormalized + 0.4 * tempoConfidence;
    return { t: frameTimestamp(i, { sampleRate, hop, windowSize }), confidence };
  });
}
