/**
 * Mesures partagees par les tests du mode live. Aucun `.test.ts` : ce fichier
 * n'est pas collecte par vitest, seulement importe.
 */

import type { LiveAnalysisEngine } from '../../../src/ui/live/audio/LiveAnalysisEngine';
import type { SyntheticSignal } from '../../../src/ui/live/testing/SyntheticAudio';
import { runEngine, type EngineRunOptions } from '../../../src/ui/live/testing/runEngine';

export interface BeatSample {
  readonly t: number;
  readonly bpm: number;
  readonly periodSec: number;
  readonly beatPhase: number;
  readonly state: string;
  readonly confidence: number;
}

export interface RunReport {
  readonly samples: readonly BeatSample[];
  /** Nombre d'onsets emis par type. */
  readonly onsetCounts: Readonly<Record<'kick' | 'snare' | 'hat', number>>;
  /** Instants ou l'hypothese de downbeat a change. */
  readonly downbeatChanges: readonly number[];
  /** Sauts d'ancre de temps entre deux trames, en ms (hors franchissement de temps), horodates. */
  readonly phaseJumps: readonly { readonly t: number; readonly ms: number }[];
  /** `true` si au moins une trame a vu `rmsNorm > 0`. */
  readonly agcMoved: boolean;
}

export function record(engine: LiveAnalysisEngine, signal: SyntheticSignal, opts: EngineRunOptions = {}): RunReport {
  const samples: BeatSample[] = [];
  const downbeatChanges: number[] = [];
  const onsetCounts = { kick: 0, snare: 0, hat: 0 };
  const phaseJumps: { t: number; ms: number }[] = [];
  let prevAnchor = Number.NaN;
  let agcMoved = false;

  runEngine(engine, signal, {
    ...opts,
    onFrame: (ctx) => {
      const e = ctx.engine;
      if (e.firedThisFrame('kick')) onsetCounts.kick++;
      if (e.firedThisFrame('snare')) onsetCounts.snare++;
      if (e.firedThisFrame('hat')) onsetCounts.hat++;
      if (e.beat.downbeatChangedThisFrame) downbeatChanges.push(ctx.tAudio);
      if (e.features.rmsNorm > 0) agcMoved = true;

      const period = e.beat.periodSec;
      if (period > 0) {
        // Ancre = instant du dernier temps. Une horloge en roue libre la garde
        // constante modulo la periode ; seule une CORRECTION la deplace.
        const anchor = ctx.tAudio - e.beat.beatPhase * period;
        if (Number.isFinite(prevAnchor)) {
          const raw = anchor - prevAnchor;
          phaseJumps.push({ t: ctx.tAudio, ms: Math.abs(raw - period * Math.round(raw / period)) * 1000 });
        }
        prevAnchor = anchor;
      } else {
        prevAnchor = Number.NaN;
      }

      samples.push({
        t: ctx.tAudio,
        bpm: e.beat.bpm,
        periodSec: period,
        beatPhase: e.beat.beatPhase,
        state: e.state,
        confidence: e.tempo.confidence,
      });
      opts.onFrame?.(ctx);
    },
  });

  return { samples, onsetCounts, downbeatChanges, phaseJumps, agcMoved };
}

/** Plus grand saut d'ancre de temps sur `[from, +inf[`, en ms. */
export function maxPhaseJumpMsAfter(report: RunReport, from: number): number {
  let max = 0;
  for (const j of report.phaseJumps) {
    if (j.t >= from && j.ms > max) max = j.ms;
  }
  return max;
}

/** Premier echantillon a `t >= at`. */
export function sampleAt(report: RunReport, at: number): BeatSample {
  const s = report.samples.find((x) => x.t >= at);
  if (!s) throw new Error(`aucun echantillon a t >= ${at}`);
  return s;
}

/**
 * Erreur de phase RMS, en ms, sur les kicks tombant dans `[from, to]`.
 * Pour chaque kick reel on lit la phase de l'horloge a cet instant et on
 * mesure l'ecart CIRCULAIRE au temps le plus proche.
 */
export function phaseErrorRmsMs(report: RunReport, kickTimes: readonly number[], from: number, to: number): number {
  let sum = 0;
  let n = 0;
  let cursor = 0;
  for (const tk of kickTimes) {
    if (tk < from || tk > to) continue;
    while (cursor + 1 < report.samples.length && report.samples[cursor + 1]!.t <= tk) cursor++;
    const s = report.samples[cursor];
    if (!s || s.periodSec <= 0) continue;
    // Phase extrapolee jusqu'a l'instant exact du kick.
    const phase = s.beatPhase + (tk - s.t) / s.periodSec;
    const e = phase - Math.round(phase);
    const ms = e * s.periodSec * 1000;
    sum += ms * ms;
    n++;
  }
  if (n === 0) throw new Error('aucun kick dans la fenetre de mesure');
  return Math.sqrt(sum / n);
}

/** Premier instant a partir duquel `|bpm - expected| <= tol` sans jamais en ressortir. */
export function lockTimeSec(report: RunReport, expected: number, tol = 0.5): number {
  let lock = -1;
  for (const s of report.samples) {
    if (s.bpm > 0 && Math.abs(s.bpm - expected) <= tol) {
      if (lock < 0) lock = s.t;
    } else {
      lock = -1;
    }
  }
  return lock;
}
