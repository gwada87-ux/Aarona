/**
 * Structure du morceau — analysis/structure (docs/05_MUSIC_INTELLIGENCE.md §6).
 * Matrice d'auto-similarité synchrone aux battements, noyau en damier,
 * détection de frontières par pics de nouveauté, alignement sur le downbeat
 * le plus proche, étiquetage par niveau d'énergie relatif + regroupement par
 * lettre. « On peut détecter OÙ ça change, pas nommer COMMENT » (docs/05) —
 * pas de « couplet »/« refrain », uniquement low/mid/high + lettre.
 */
import { BAND_IDS, type BandId } from './bands';
import { normalizeTrack } from './normalize';
import { averageOverInterval, type SampledTrack } from './trackSampling';
import type { Section } from '../music/pmdi';

const BEAT_VECTOR_DIMS = BAND_IDS.length + 3; // 6 bandes + centroïde + platitude + densité d'onsets
const NOVELTY_KERNEL_HALF = 8; // 16 battements = 4 mesures (docs/05 §6)
const MIN_PEAK_DISTANCE_BEATS = 16;
const DOWNBEAT_SNAP_BEATS = 2;
const LETTER_SIMILARITY_THRESHOLD = 0.85;

/**
 * Seuils de docs/05 §6 pour interpréter `Section.energy` en « low / mid /
 * high ». PAS stockés dans un champ dédié : `Section.label` est documenté
 * « Mode B uniquement » (music/pmdi.ts — noms sémantiques réels, « intro »/
 * « verse »), pas un synonyme de ce triage par énergie. `Section.energy`
 * (0..1, toujours présent) suffit à quiconque veut catégoriser ainsi.
 */
export const SECTION_ENERGY_LOW_MAX = 0.4;
export const SECTION_ENERGY_HIGH_MIN = 0.7;

export type StructureFeatureTrack = SampledTrack;

export interface DetectSectionsOptions {
  readonly duration: number;
  readonly beatTimes: readonly number[];
  readonly downbeatTimes: readonly number[];
  readonly bandTracks: Readonly<Record<BandId, StructureFeatureTrack>>;
  readonly centroidTrack: StructureFeatureTrack;
  readonly flatnessTrack: StructureFeatureTrack;
  readonly energyTrack: StructureFeatureTrack; // pour l'étiquetage low/mid/high, distinct du vecteur 9D
  readonly onsetTimes: readonly number[];
}

function countOnsetsInInterval(onsetTimes: readonly number[], tStart: number, tEnd: number): number {
  let count = 0;
  for (const t of onsetTimes) if (t >= tStart && t < tEnd) count++;
  return count;
}

function beatEndTime(beatTimes: readonly number[], i: number, duration: number): number {
  return i + 1 < beatTimes.length ? beatTimes[i + 1]! : duration;
}

/** Agrégation par battement (docs/05 §6, étape 1) : 9 dimensions, chacune normalisée p05/p95 ensuite. */
function buildBeatVectors(opts: DetectSectionsOptions): Float64Array[] {
  const { beatTimes, duration, bandTracks, centroidTrack, flatnessTrack, onsetTimes } = opts;
  const n = beatTimes.length;
  const dims: Float64Array[] = Array.from({ length: BEAT_VECTOR_DIMS }, () => new Float64Array(n));

  for (let i = 0; i < n; i++) {
    const tStart = beatTimes[i]!;
    const tEnd = beatEndTime(beatTimes, i, duration);
    BAND_IDS.forEach((band, bi) => {
      dims[bi]![i] = averageOverInterval(bandTracks[band], tStart, tEnd);
    });
    dims[BAND_IDS.length]![i] = averageOverInterval(centroidTrack, tStart, tEnd);
    dims[BAND_IDS.length + 1]![i] = averageOverInterval(flatnessTrack, tStart, tEnd);
    dims[BAND_IDS.length + 2]![i] = countOnsetsInInterval(onsetTimes, tStart, tEnd) / Math.max(1e-6, tEnd - tStart);
  }

  const normalizedDims = dims.map((d) => normalizeTrack(d));
  const vectors: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = new Float64Array(BEAT_VECTOR_DIMS);
    for (let dim = 0; dim < BEAT_VECTOR_DIMS; dim++) v[dim] = normalizedDims[dim]![i]!;
    vectors.push(v);
  }
  return vectors;
}

function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function buildSimilarityMatrix(vectors: readonly Float64Array[]): Float64Array[] {
  const n = vectors.length;
  const S: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    S[i]![i] = 1;
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(vectors[i]!, vectors[j]!);
      S[i]![j] = sim;
      S[j]![i] = sim;
    }
  }
  return S;
}

/** Noyau en damier convolué le long de la diagonale (docs/05 §6, étape 4) — courbe de nouveauté. */
function computeNovelty(S: readonly Float64Array[]): Float64Array {
  const n = S.length;
  const L = NOVELTY_KERNEL_HALF;
  const novelty = new Float64Array(n);
  for (let i = L; i < n - L; i++) {
    let sum = 0;
    for (let a = -L; a < L; a++) {
      const row = S[i + a]!;
      for (let b = -L; b < L; b++) {
        const sameQuadrant = a < 0 === b < 0;
        sum += (sameQuadrant ? 1 : -1) * row[i + b]!;
      }
    }
    novelty[i] = sum;
  }
  return novelty;
}

/** Pics locaux positifs, triés par force puis filtrés par distance minimale (docs/05 §6, étape 5). */
function pickPeaks(novelty: Float64Array, minDistance: number): number[] {
  const candidates: Array<{ i: number; v: number }> = [];
  for (let i = 1; i < novelty.length - 1; i++) {
    if (novelty[i]! > 0 && novelty[i]! > novelty[i - 1]! && novelty[i]! >= novelty[i + 1]!) {
      candidates.push({ i, v: novelty[i]! });
    }
  }
  candidates.sort((a, b) => b.v - a.v);
  const chosen: number[] = [];
  for (const c of candidates) {
    if (chosen.every((j) => Math.abs(j - c.i) >= minDistance)) chosen.push(c.i);
  }
  return chosen.sort((a, b) => a - b);
}

function snapToNearestDownbeat(t: number, downbeatTimes: readonly number[], avgBeatDur: number): number {
  let best = t;
  let bestDist = Infinity;
  for (const db of downbeatTimes) {
    const dist = Math.abs(db - t);
    if (dist < bestDist) {
      bestDist = dist;
      best = db;
    }
  }
  return bestDist <= DOWNBEAT_SNAP_BEATS * avgBeatDur ? best : t;
}

export function detectSections(opts: DetectSectionsOptions): Section[] {
  const { beatTimes, duration, downbeatTimes, energyTrack } = opts;
  if (beatTimes.length < NOVELTY_KERNEL_HALF * 2 + 1) {
    // Trop peu de battements pour une matrice de nouveauté significative (morceau très court,
    // ou grille peu fiable) : une seule section couvrant tout le morceau, honnête plutôt que
    // de fabriquer des frontières sur un bruit de fond.
    const avgEnergy = averageOverInterval(energyTrack, 0, duration);
    return [{ t: 0, dur: duration, energy: avgEnergy, confidence: 0.3, letter: 'A' }];
  }

  const vectors = buildBeatVectors(opts);
  const S = buildSimilarityMatrix(vectors);
  const novelty = computeNovelty(S);
  const peakBeatIndices = pickPeaks(novelty, MIN_PEAK_DISTANCE_BEATS);

  const avgBeatDur = beatTimes.length > 1 ? (beatTimes[beatTimes.length - 1]! - beatTimes[0]!) / (beatTimes.length - 1) : 0.5;
  const boundaryTimes = [0, ...peakBeatIndices.map((i) => snapToNearestDownbeat(beatTimes[i]!, downbeatTimes, avgBeatDur)), duration];
  // dédoublonne (deux pics peuvent s'aligner sur le même downbeat) et trie.
  const uniqueBoundaries = [...new Set(boundaryTimes)].sort((a, b) => a - b);

  const sections: Section[] = [];
  const groupVectors: Array<{ letter: string; vector: Float64Array }> = [];
  let nextLetterCode = 65; // 'A'

  for (let s = 0; s < uniqueBoundaries.length - 1; s++) {
    const tStart = uniqueBoundaries[s]!;
    const tEnd = uniqueBoundaries[s + 1]!;
    const avgEnergy = averageOverInterval(energyTrack, tStart, tEnd);

    const beatIdxStart = beatTimes.findIndex((t) => t >= tStart);
    const beatIdxEnd = beatTimes.findIndex((t) => t >= tEnd);
    const lastIdx = beatIdxEnd === -1 ? vectors.length : beatIdxEnd;
    const sectionVector = new Float64Array(BEAT_VECTOR_DIMS);
    let count = 0;
    for (let i = Math.max(0, beatIdxStart); i < lastIdx; i++) {
      const v = vectors[i];
      if (!v) continue;
      for (let d = 0; d < BEAT_VECTOR_DIMS; d++) sectionVector[d]! += v[d]!;
      count++;
    }
    if (count > 0) for (let d = 0; d < BEAT_VECTOR_DIMS; d++) sectionVector[d] = sectionVector[d]! / count;

    let letter = String.fromCharCode(nextLetterCode);
    let matched = false;
    for (const group of groupVectors) {
      if (cosineSimilarity(group.vector, sectionVector) >= LETTER_SIMILARITY_THRESHOLD) {
        letter = group.letter;
        matched = true;
        break;
      }
    }
    if (!matched) {
      groupVectors.push({ letter, vector: sectionVector });
      nextLetterCode++;
    }

    sections.push({
      t: tStart,
      dur: tEnd - tStart,
      energy: avgEnergy,
      confidence: 0.6, // frontière détectée algorithmiquement, pas de vérité terrain disponible (corpus non fourni)
      letter,
    });
  }

  return sections;
}
