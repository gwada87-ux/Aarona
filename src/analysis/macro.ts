/**
 * Macro-événements — analysis/macro (docs/05_MUSIC_INTELLIGENCE.md §7).
 * DROP / BUILDUP / BREAK / ENERGY_UP / ENERGY_DOWN / SILENCE, depuis
 * l'enveloppe d'énergie lissée sur une mesure (`E_bar`).
 *
 * BREAK dépend de l'« absence de kick » — nécessite les événements KICK déjà
 * CLASSIFIÉS (classify.ts). Ordre d'exécution imposé : classify() puis
 * macro(), jamais l'inverse — voir finalize.ts.
 */
import type { MusicEvent } from '../music/pmdi';
import { averageOverInterval, type SampledTrack } from './trackSampling';

const DROP_LOW_MAX = 0.45;
const DROP_HIGH_MIN = 0.8;
const DROP_MAX_BARS = 2;
const DROP_PRE_BASS_MAX = 0.3;

const BUILDUP_MIN_BARS = 4;

const BREAK_MAX_ENERGY = 0.35;
const BREAK_MIN_BARS = 2;
const BREAK_PRECEDING_MIN_ENERGY = 0.65;

const ENERGY_STEP_UP = 0.2;
const ENERGY_STEP_DOWN = -0.2;

const SILENCE_THRESHOLD_DB = -45;
const SILENCE_MIN_DUR_SEC = 0.4;

export interface DetectMacroEventsOptions {
  readonly duration: number;
  readonly downbeatTimes: readonly number[]; // une mesure = intervalle entre deux downbeats consécutifs
  readonly barEnergyTrack: SampledTrack; // `energy`, déjà normalisée p05/p95 (comme le reste du pipeline)
  readonly bassEnergyTrack: SampledTrack; // band.sub + band.bass, pré-sommée par l'appelant
  readonly highOnsetTimes: readonly number[]; // pour la densité d'onsets aigus (rolls) de BUILDUP
  readonly centroidTrack: SampledTrack;
  readonly kickTimes: readonly number[]; // événements KICK déjà classifiés (classify.ts)
  readonly rawRmsDbTrack: SampledTrack; // dBFS BRUT, ext.rawRmsDb — SILENCE a besoin d'un niveau absolu
}

function barBoundaries(downbeatTimes: readonly number[], duration: number): number[] {
  if (downbeatTimes.length === 0) return [0, duration];
  const bounds = [...downbeatTimes];
  if (bounds[0]! > 0) bounds.unshift(0);
  if (bounds[bounds.length - 1]! < duration) bounds.push(duration);
  return bounds;
}

function countInInterval(times: readonly number[], tStart: number, tEnd: number): number {
  let count = 0;
  for (const t of times) if (t >= tStart && t < tEnd) count++;
  return count;
}

function hasEventInInterval(times: readonly number[], tStart: number, tEnd: number): boolean {
  for (const t of times) if (t >= tStart && t < tEnd) return true;
  return false;
}

export function detectMacroEvents(opts: DetectMacroEventsOptions): MusicEvent[] {
  const { duration, downbeatTimes, barEnergyTrack, bassEnergyTrack, highOnsetTimes, centroidTrack, kickTimes, rawRmsDbTrack } = opts;
  const bounds = barBoundaries(downbeatTimes, duration);
  const barCount = bounds.length - 1;
  if (barCount < 1) return [];

  const barEnergy = new Float64Array(barCount);
  const barBass = new Float64Array(barCount);
  const barHighOnsetDensity = new Float64Array(barCount);
  const barCentroid = new Float64Array(barCount);
  for (let i = 0; i < barCount; i++) {
    const tStart = bounds[i]!;
    const tEnd = bounds[i + 1]!;
    barEnergy[i] = averageOverInterval(barEnergyTrack, tStart, tEnd);
    barBass[i] = averageOverInterval(bassEnergyTrack, tStart, tEnd);
    barHighOnsetDensity[i] = countInInterval(highOnsetTimes, tStart, tEnd) / Math.max(1e-6, tEnd - tStart);
    barCentroid[i] = averageOverInterval(centroidTrack, tStart, tEnd);
  }

  const events: MusicEvent[] = [];
  const dropBarIndices = new Set<number>();

  // DROP : E_bar passe de <0,45 à >0,80 en ≤2 mesures, énergie basse <0,3 juste avant.
  for (let i = 0; i < barCount; i++) {
    if (barEnergy[i]! <= DROP_HIGH_MIN) continue;
    for (let back = 1; back <= DROP_MAX_BARS; back++) {
      const j = i - back;
      if (j < 0) break;
      if (barEnergy[j]! < DROP_LOW_MAX && barBass[j]! < DROP_PRE_BASS_MAX) {
        events.push({
          t: bounds[j]!,
          type: 'DROP',
          intensity: Math.max(0, Math.min(1, barEnergy[i]! - barEnergy[j]!)),
          confidence: 0.85, // « un des motifs les plus fiables à détecter » (docs/05 §7)
        });
        for (let k = j; k <= i; k++) dropBarIndices.add(k);
        break;
      }
    }
  }

  // BUILDUP : E_bar croît de façon monotone sur ≥4 mesures, densité d'onsets aigus en hausse.
  {
    let runStart = 0;
    for (let i = 1; i <= barCount; i++) {
      const monotonic = i < barCount && barEnergy[i]! >= barEnergy[i - 1]!;
      if (!monotonic) {
        const runLength = i - runStart;
        if (runLength >= BUILDUP_MIN_BARS) {
          const onsetsRising = barHighOnsetDensity[i - 1]! >= barHighOnsetDensity[runStart]!;
          if (onsetsRising) {
            const centroidRising = barCentroid[i - 1]! >= barCentroid[runStart]!; // "souvent" — informatif seulement
            events.push({
              t: bounds[runStart]!,
              type: 'BUILDUP',
              intensity: Math.max(0, Math.min(1, barEnergy[i - 1]! - barEnergy[runStart]!)),
              confidence: centroidRising ? 0.75 : 0.6,
              dur: bounds[i]! - bounds[runStart]!,
            });
          }
        }
        runStart = i;
      }
    }
  }

  // BREAK : E_bar <0,35 pendant ≥2 mesures, après une section >0,65, absence de kick.
  {
    let precedingHigh = false;
    let runStart = -1;
    for (let i = 0; i < barCount; i++) {
      if (barEnergy[i]! > BREAK_PRECEDING_MIN_ENERGY) precedingHigh = true;
      const low = barEnergy[i]! < BREAK_MAX_ENERGY;
      if (low && runStart === -1) runStart = i;
      if (!low || i === barCount - 1) {
        const runEnd = low ? i + 1 : i;
        const runLength = runEnd - runStart;
        if (runStart !== -1 && runLength >= BREAK_MIN_BARS && precedingHigh) {
          const tStart = bounds[runStart]!;
          const tEnd = bounds[runEnd]!;
          if (!hasEventInInterval(kickTimes, tStart, tEnd)) {
            events.push({ t: tStart, type: 'BREAK', intensity: 1 - barEnergy[runStart]!, confidence: 0.7, dur: tEnd - tStart });
          }
          precedingHigh = false;
        }
        if (!low) runStart = -1;
      }
    }
  }

  // ENERGY_UP / ENERGY_DOWN : variation >|0,20| sur 1 mesure, hors mesures déjà couvertes par un DROP.
  for (let i = 1; i < barCount; i++) {
    if (dropBarIndices.has(i) || dropBarIndices.has(i - 1)) continue;
    const delta = barEnergy[i]! - barEnergy[i - 1]!;
    if (delta > ENERGY_STEP_UP) {
      events.push({ t: bounds[i]!, type: 'ENERGY_UP', intensity: Math.max(0, Math.min(1, delta)), confidence: 0.6 });
    } else if (delta < ENERGY_STEP_DOWN) {
      events.push({ t: bounds[i]!, type: 'ENERGY_DOWN', intensity: Math.max(0, Math.min(1, -delta)), confidence: 0.6 });
    }
  }

  // SILENCE : RMS brut < −45dBFS pendant ≥0,4s d'affilée.
  // Balayage échantillon par échantillon (pas par pas fixe de 0,4s : un pas fixe
  // raterait le vrai début du silence quand il tombe au milieu d'un pas, et le
  // détecterait jusqu'à ~0,4s en retard — synchronisation musicale, priorité #1).
  {
    const n = rawRmsDbTrack.data.length;
    const hz = rawRmsDbTrack.hz;
    const t0 = rawRmsDbTrack.t0;
    let i = 0;
    while (i < n) {
      const t = t0 + i / hz;
      if (t >= duration) break;
      const value = rawRmsDbTrack.data[i] ?? 0;
      if (value < SILENCE_THRESHOLD_DB) {
        let j = i + 1;
        while (j < n && t0 + j / hz < duration && (rawRmsDbTrack.data[j] ?? 0) < SILENCE_THRESHOLD_DB) j++;
        const runDur = t0 + j / hz - t;
        if (runDur >= SILENCE_MIN_DUR_SEC) {
          events.push({ t, type: 'SILENCE', intensity: 1, confidence: 0.9, dur: Math.min(runDur, duration - t) });
        }
        i = j;
      } else {
        i++;
      }
    }
  }

  return events.sort((a, b) => a.t - b.t);
}
