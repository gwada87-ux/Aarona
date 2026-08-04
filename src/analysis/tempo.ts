/**
 * Tempo — analysis/tempo (docs/05_MUSIC_INTELLIGENCE.md §1).
 * ODF global pondéré → autocorrélation → filtre en peigne → pondération
 * perceptuelle → résolution de l'ambiguïté ×2/÷2 → confiance.
 */
import { percentile } from '../core/math/percentile';
import type { BandId } from './bands';
import { smooth3 } from './onsets';

/** "Le grave domine : c'est là que se trouve la pulsation dans nos genres" (docs/05 l.28-29). */
export const GLOBAL_ODF_WEIGHTS: Readonly<Record<BandId, number>> = {
  sub: 0.3,
  bass: 0.3,
  lowmid: 0.15,
  mid: 0.05,
  himid: 0.1,
  high: 0.1,
};

const MIN_BPM = 60;
const MAX_BPM = 200;
const PERCEPTUAL_CENTER_BPM = 120;
const PERCEPTUAL_SIGMA = 0.7;
const COMB_HARMONICS = 4; // T, 2T, 3T, 4T
const AMBIGUITY_MARGIN_THRESHOLD = 0.15; // "moins de 15%" → confiance plafonnée
const AMBIGUOUS_CONFIDENCE_CAP = 0.65;
const HATS_PER_BEAT_THRESHOLD = 3.5;

/**
 * Étape 1 : ODF global = somme pondérée des flux par bande, chacun normalisé
 * par son p95, puis lissée (docs/05 l.27-30) — SANS suppression de tendance :
 * reste non négative, utilisable telle quelle comme force d'onset pour le
 * suivi de beats (analysis/beats.ts, docs/05 §2, qui a besoin d'un score
 * positif, pas d'un signal centré).
 */
export function computeGlobalOdfPositive(bandFlux: Readonly<Record<BandId, Float64Array>>): Float64Array {
  const bands = Object.keys(GLOBAL_ODF_WEIGHTS) as BandId[];
  const n = bandFlux[bands[0]!]!.length;
  const normalized: Record<BandId, Float64Array> = {} as Record<BandId, Float64Array>;
  for (const band of bands) {
    const track = bandFlux[band]!;
    const p95 = percentile(track, 0.95) || 1e-9;
    normalized[band] = Float64Array.from(track, (v) => v / p95);
  }

  const combined = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const band of bands) sum += GLOBAL_ODF_WEIGHTS[band] * normalized[band]![i]!;
    combined[i] = sum;
  }
  return smooth3(combined);
}

/** Étape 2 : suppression de la composante continue de l'ODF positive — pour l'autocorrélation. */
export function computeGlobalOdf(bandFlux: Readonly<Record<BandId, Float64Array>>): Float64Array {
  const positive = computeGlobalOdfPositive(bandFlux);
  const n = positive.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += positive[i]!;
  mean /= n || 1;
  return Float64Array.from(positive, (v) => v - mean);
}

/** Autocorrélation normalisée (moyenne, pas somme — évite le biais en faveur des petits lags). */
function autocorrelationAt(centered: Float64Array, lag: number): number {
  const n = centered.length;
  const count = n - lag;
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += centered[i]! * centered[i + lag]!;
  return sum / count;
}

function perceptualWeight(bpm: number): number {
  const x = Math.log(bpm / PERCEPTUAL_CENTER_BPM) / PERCEPTUAL_SIGMA;
  return Math.exp(-0.5 * x * x);
}

function combScore(centered: Float64Array, lagFrames: number): number {
  let sum = 0;
  for (let h = 1; h <= COMB_HARMONICS; h++) sum += autocorrelationAt(centered, lagFrames * h);
  return sum;
}

export interface TempoCandidateCurve {
  readonly minLag: number;
  readonly maxLag: number;
  readonly scores: Float64Array; // indexé par (lag − minLag)
}

/** Étapes 3-6 : courbe de score par lag candidat (peigne harmonique × pondération perceptuelle). */
export function computeTempoCandidateCurve(centered: Float64Array, frameRate: number): TempoCandidateCurve {
  const minLag = Math.max(1, Math.round(frameRate * (60 / MAX_BPM)));
  const maxLag = Math.round(frameRate * (60 / MIN_BPM));
  const scores = new Float64Array(maxLag - minLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag;
    scores[lag - minLag] = combScore(centered, lag) * perceptualWeight(bpm);
  }
  return { minLag, maxLag, scores };
}

function argmaxCurve(curve: TempoCandidateCurve): number {
  let bestIdx = 0;
  let bestV = -Infinity;
  for (let i = 0; i < curve.scores.length; i++) {
    if (curve.scores[i]! > bestV) {
      bestV = curve.scores[i]!;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Deuxième meilleur candidat, distinct du premier (hors voisinage immédiat, ET
 * hors voisinage de ses harmoniques d'octave ×2/÷2). Une harmonique n'est pas
 * une hypothèse concurrente : l'ambiguïté qu'elle pose est déjà traitée par
 * `resolveOctaveAmbiguity` ; la compter ici comme "second candidat" pénaliserait
 * à tort la marge de confiance d'un tempo par ailleurs non ambigu.
 */
function secondBestScore(curve: TempoCandidateCurve, bestIdx: number, excludeRadius = 4, extraExcludeIdx: readonly number[] = []): number {
  let bestV = -Infinity;
  for (let i = 0; i < curve.scores.length; i++) {
    if (Math.abs(i - bestIdx) <= excludeRadius) continue;
    if (extraExcludeIdx.some((e) => Math.abs(i - e) <= excludeRadius)) continue;
    if (curve.scores[i]! > bestV) bestV = curve.scores[i]!;
  }
  return bestV === -Infinity ? 0 : bestV;
}

/**
 * Netteté du pic : à quel point le meilleur candidat domine l'ENSEMBLE de la
 * courbe (et pas seulement ses voisins immédiats). Un pic franc sur fond plat
 * donne une valeur proche de 1 même si l'étalement dû à la période fractionnaire
 * (le vrai tempo ne tombe pas toujours sur un lag entier) déborde sur 1-2 bins
 * voisins — ce débordement ne doit pas, à lui seul, faire chuter la confiance.
 */
function peakSharpness(curve: TempoCandidateCurve, bestIdx: number): number {
  const best = curve.scores[bestIdx]!;
  if (best <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < curve.scores.length; i++) sum += curve.scores[i]!;
  const mean = sum / curve.scores.length;
  return Math.max(0, Math.min(1, (best - mean) / best));
}

/** Stabilité temporelle : cohérence de l'autocorrélation au meilleur lag sur 3 tiers du morceau. */
function temporalStability(centered: Float64Array, bestLag: number): number {
  const n = centered.length;
  const thirdLen = Math.floor(n / 3);
  if (thirdLen <= bestLag) return 0.5; // morceau trop court pour juger — neutre
  const values: number[] = [];
  for (let part = 0; part < 3; part++) {
    const slice = centered.subarray(part * thirdLen, (part + 1) * thirdLen);
    const energy0 = autocorrelationAt(slice, 0) || 1e-9;
    values.push(autocorrelationAt(slice, bestLag) / energy0);
  }
  const mean = (values[0]! + values[1]! + values[2]!) / 3;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const spread = max - min;
  return Math.max(0, Math.min(1, 1 - spread / (Math.abs(mean) + 1e-9)));
}

export interface OctaveResolution {
  readonly bpm: number;
  readonly alternate?: number;
  readonly ambiguous: boolean;
}

function pickOctaveCompetitor(bpm: number): number | null {
  const half = bpm / 2;
  const double = bpm * 2;
  if (half >= MIN_BPM && half <= MAX_BPM) return half;
  if (double >= MIN_BPM && double <= MAX_BPM) return double;
  return null;
}

/**
 * Test 1 (poids 0,5) : cohérence du grave. Pour une grille périodique de
 * période `periodSec`, la meilleure phase est cherchée (le tempo dont les
 * temps tombent sur les kicks gagne).
 */
function bassCoherenceScore(bassEnergyTrack: Float64Array, frameRate: number, periodSec: number, phaseSamples = 16): number {
  const periodFrames = periodSec * frameRate;
  if (periodFrames < 1) return 0;
  let best = -Infinity;
  for (let p = 0; p < phaseSamples; p++) {
    const phase = (p / phaseSamples) * periodFrames;
    let sum = 0;
    let count = 0;
    for (let pos = phase; pos < bassEnergyTrack.length; pos += periodFrames) {
      sum += bassEnergyTrack[Math.round(pos)]!;
      count++;
    }
    const mean = count > 0 ? sum / count : 0;
    if (mean > best) best = mean;
  }
  return best === -Infinity ? 0 : best;
}

/** Test 2 (poids 0,3) : régularité de la sous-division — hats par temps. */
function subdivisionScore(highOnsetCount: number, periodSec: number, durationSec: number): number {
  const beatCount = durationSec / periodSec;
  const hatsPerBeat = beatCount > 0 ? highOnsetCount / beatCount : 0;
  const excess = Math.max(0, hatsPerBeat - HATS_PER_BEAT_THRESHOLD);
  return Math.max(0, Math.min(1, 1 - excess / HATS_PER_BEAT_THRESHOLD));
}

export interface ResolveOctaveAmbiguityInput {
  readonly rawBpm: number;
  readonly rawBpmScore: number; // score du candidat principal sur la courbe primaire (étapes 3-6)
  readonly competitorScore: number | null; // score du concurrent sur la MÊME courbe ; null si hors plage
  readonly frameRate: number;
  readonly durationSec: number;
  readonly bassEnergyTrack: Float64Array;
  readonly highOnsetCount: number;
}

/**
 * Résolution de l'ambiguïté ×2/÷2 (docs/05 l.45-65). Le troisième test (plage
 * de genre) est omis : aucun preset genre n'est encore choisi à cette étape
 * (docs/00a — les presets arrivent à l'Étape 13), et il est de toute façon
 * "indicatif, jamais bloquant".
 *
 * L'ambiguïté se juge sur l'écart de score de la COURBE PRIMAIRE (déjà
 * favorisée par la pondération perceptuelle centrée sur 120 BPM) entre le
 * candidat principal et son concurrent d'octave : si elle sépare déjà
 * nettement les deux (≥15%), il n'y a rien à arbitrer. Ce n'est que lorsque la
 * courbe primaire hésite elle-même (cas du piège hats-en-1/16, docs/05 l.39-43)
 * que l'arbitrage à trois tests tranche — et sa propre proximité (<15%)
 * plafonne alors la confiance.
 */
export function resolveOctaveAmbiguity(input: ResolveOctaveAmbiguityInput): OctaveResolution {
  const { rawBpm, rawBpmScore, competitorScore, frameRate, durationSec, bassEnergyTrack, highOnsetCount } = input;
  const competitor = pickOctaveCompetitor(rawBpm);
  if (competitor === null || competitorScore === null) {
    return { bpm: rawBpm, ambiguous: false };
  }

  const primaryBest = Math.max(rawBpmScore, competitorScore);
  const primaryRelDiff = primaryBest > 0 ? Math.abs(rawBpmScore - competitorScore) / primaryBest : 0;
  if (primaryRelDiff >= AMBIGUITY_MARGIN_THRESHOLD) {
    // La courbe primaire sépare déjà nettement les deux candidats : on la suit.
    return { bpm: rawBpm, ambiguous: false };
  }

  // Écart insuffisant sur la courbe primaire : l'arbitrage à trois tests tranche.
  const periodA = 60 / rawBpm;
  const periodB = 60 / competitor;
  const bassA = bassCoherenceScore(bassEnergyTrack, frameRate, periodA);
  const bassB = bassCoherenceScore(bassEnergyTrack, frameRate, periodB);
  const maxBass = Math.max(bassA, bassB, 1e-9);
  const subA = subdivisionScore(highOnsetCount, periodA, durationSec);
  const subB = subdivisionScore(highOnsetCount, periodB, durationSec);

  const scoreA = 0.5 * (bassA / maxBass) + 0.3 * subA;
  const scoreB = 0.5 * (bassB / maxBass) + 0.3 * subB;

  const winnerBpm = scoreB > scoreA ? competitor : rawBpm;
  const loserBpm = winnerBpm === rawBpm ? competitor : rawBpm;
  return { bpm: winnerBpm, alternate: loserBpm, ambiguous: true };
}

export interface TempoEstimate {
  readonly bpm: number;
  readonly confidence: number;
  readonly alternate?: number;
}

export interface EstimateTempoInput {
  readonly bandFlux: Readonly<Record<BandId, Float64Array>>;
  readonly bassEnergyTrack: Float64Array;
  readonly highOnsetCount: number;
  readonly sampleRate: number;
  readonly hop: number;
  readonly durationSec: number;
}

/** Étapes 1-6 + confiance (docs/05 §1) + résolution de l'ambiguïté ×2/÷2. */
export function estimateTempo(input: EstimateTempoInput): TempoEstimate {
  const frameRate = input.sampleRate / input.hop;
  const centered = computeGlobalOdf(input.bandFlux);
  const curve = computeTempoCandidateCurve(centered, frameRate);
  const bestIdx = argmaxCurve(curve);
  const bestLag = curve.minLag + bestIdx;
  const rawBpm = (60 * frameRate) / bestLag;

  const best = curve.scores[bestIdx]!;

  // Concurrent d'octave (×2/÷2) : exclu de la recherche du "second candidat"
  // pour la marge de confiance (c'est une harmonique attendue, pas une
  // hypothèse rivale — l'ambiguïté qu'il pose est traitée séparément ci-dessous).
  const competitorBpm = pickOctaveCompetitor(rawBpm);
  let competitorScore: number | null = null;
  let competitorIdx: number | null = null;
  if (competitorBpm !== null) {
    const competitorLag = Math.round((60 * frameRate) / competitorBpm);
    if (competitorLag >= curve.minLag && competitorLag <= curve.maxLag) {
      competitorIdx = competitorLag - curve.minLag;
      competitorScore = curve.scores[competitorIdx]!;
    }
  }

  const sharpness = peakSharpness(curve, bestIdx);
  const stability = temporalStability(centered, bestLag);
  const second = secondBestScore(curve, bestIdx, 4, competitorIdx !== null ? [competitorIdx] : []);
  const margin = best > 0 ? Math.max(0, Math.min(1, (best - second) / best)) : 0;

  let confidence = 0.45 * sharpness + 0.35 * stability + 0.2 * margin;

  const resolution = resolveOctaveAmbiguity({
    rawBpm,
    rawBpmScore: best,
    competitorScore,
    frameRate,
    durationSec: input.durationSec,
    bassEnergyTrack: input.bassEnergyTrack,
    highOnsetCount: input.highOnsetCount,
  });

  if (resolution.ambiguous) confidence = Math.min(confidence, AMBIGUOUS_CONFIDENCE_CAP);
  confidence = Math.max(0, Math.min(1, confidence));

  return { bpm: resolution.bpm, confidence, alternate: resolution.alternate };
}
