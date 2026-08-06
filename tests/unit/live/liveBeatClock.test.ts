/**
 * Criteres §8.2 a §8.5 et §8.7 du prompt de refonte du mode live, tous
 * verifies sans navigateur et sans humain sur signaux synthetiques.
 */

import { describe, expect, it } from 'vitest';
import { clickTrack, fourOnTheFloor, tempoRamp } from '../../../src/ui/live/testing/SyntheticAudio';
import { createEngine } from '../../../src/ui/live/testing/runEngine';
import { maxPhaseJumpMsAfter, phaseErrorRmsMs, record, sampleAt } from './beatMetrics';

const LOCK_DEADLINE_SEC = 4;
const BPM_TOLERANCE = 0.5;
const PHASE_RMS_LIMIT_MS = 12;
const MEASURE_SEC = 60;

function checkTempo(bpm: number, jitterPct: number): void {
  const signal = clickTrack(bpm, LOCK_DEADLINE_SEC + MEASURE_SEC, { jitterPct });
  const engine = createEngine(signal);
  const report = record(engine, signal);

  const atDeadline = sampleAt(report, LOCK_DEADLINE_SEC);
  expect(
    Math.abs(atDeadline.bpm - bpm),
    `BPM a t=${LOCK_DEADLINE_SEC}s : ${atDeadline.bpm.toFixed(2)} (attendu ${bpm})`,
  ).toBeLessThanOrEqual(BPM_TOLERANCE);

  const rms = phaseErrorRmsMs(report, signal.kickTimes, LOCK_DEADLINE_SEC, LOCK_DEADLINE_SEC + MEASURE_SEC);
  expect(rms, `erreur de phase RMS = ${rms.toFixed(2)} ms`).toBeLessThan(PHASE_RMS_LIMIT_MS);
}

describe('BeatClock - verrouillage de tempo (§8.2, §8.3)', () => {
  it('128 BPM : +/- 0,5 BPM en moins de 4 s, phase RMS < 12 ms sur 60 s', () => {
    checkTempo(128, 0);
  }, 120000);

  it('90 BPM', () => {
    checkTempo(90, 0);
  }, 120000);

  it('140 BPM', () => {
    checkTempo(140, 0);
  }, 120000);

  it('174 BPM', () => {
    checkTempo(174, 0);
  }, 120000);

  it('128 BPM avec +/- 2 % de gigue', () => {
    checkTempo(128, 2);
  }, 120000);

  it('174 BPM avec +/- 2 % de gigue', () => {
    checkTempo(174, 2);
  }, 120000);
});

describe('BeatClock - rampe de tempo (§8.4)', () => {
  it('120 -> 128 : reverrouillage en moins de 8 s, aucun saut de phase > 20 ms par trame', () => {
    const holdSec = 12;
    const rampSec = 4;
    const signal = tempoRamp(120, 128, 40, holdSec, rampSec);
    const engine = createEngine(signal);
    const report = record(engine, signal);

    const after = report.samples.filter((s) => s.t >= signal.rampEndSec);
    const relocked = after.find((s) => Math.abs(s.bpm - 128) <= BPM_TOLERANCE);
    expect(relocked, 'aucun reverrouillage a 128 BPM apres la rampe').toBeDefined();
    const delay = (relocked?.t ?? Number.POSITIVE_INFINITY) - signal.rampEndSec;
    expect(delay, `reverrouillage ${delay.toFixed(2)} s apres la fin de la rampe`).toBeLessThan(8);

    // Mesure sur TOUTE la duree, acquisition de phase comprise : le
    // glissement borne de `BeatClock` rend l'invariant structurel.
    const jump = maxPhaseJumpMsAfter(report, 0);
    expect(jump, `plus grand saut d'ancre de temps = ${jump.toFixed(2)} ms`).toBeLessThanOrEqual(20);
  }, 120000);
});

describe('BeatClock - downbeat en four-on-the-floor (§8.5)', () => {
  it('126 BPM : hypothese de downbeat stable sur 32 mesures', () => {
    const barSec = (60 / 126) * 4;
    const settleSec = barSec * 8;
    const signal = fourOnTheFloor(126, settleSec + barSec * 32);
    const engine = createEngine(signal);
    const report = record(engine, signal);

    const changes = report.downbeatChanges.filter((t) => t >= settleSec);
    expect(
      changes.length,
      `changements de downbeat apres stabilisation : ${changes.map((t) => t.toFixed(1)).join(', ')}`,
    ).toBeLessThanOrEqual(1);
  }, 120000);
});

describe('BeatClock - stop puis start (§8.7)', () => {
  it('90 BPM, reset, 140 BPM : le BPM verrouille est 140, pas un melange', () => {
    const first = clickTrack(90, 12);
    const engine = createEngine(first);
    const firstReport = record(engine, first);
    expect(Math.abs(sampleAt(firstReport, 8).bpm - 90)).toBeLessThanOrEqual(BPM_TOLERANCE);

    // `reset()` doit rendre le moteur identique a un premier demarrage, y
    // compris quand l'horloge audio ne repart pas de zero (cas reel).
    engine.reset();
    const second = clickTrack(140, 16);
    const secondReport = record(engine, second, { timeOffsetSec: 12 });

    const final = secondReport.samples[secondReport.samples.length - 1];
    expect(final).toBeDefined();
    expect(Math.abs((final?.bpm ?? 0) - 140), `BPM final = ${(final?.bpm ?? 0).toFixed(2)}`).toBeLessThanOrEqual(
      BPM_TOLERANCE,
    );
    // Aucun residu de 90 : le BPM ne doit jamais repasser par la zone 90 +/- 2.
    const contaminated = secondReport.samples.filter((s) => s.t > 12 + 6 && Math.abs(s.bpm - 90) < 2);
    expect(contaminated.length, 'residu du tempo precedent apres reset').toBe(0);
  }, 120000);
});
