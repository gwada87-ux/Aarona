/**
 * Canal de verite PMDI (ADR-012, lot 1) - criteres fixes a l'avance par
 * l'ADR, verifies sans navigateur sur un hote SYNTHETIQUE a offset connu :
 *
 *   - offset retrouve a +/- 3 ms ;
 *   - bascule verite <-> analyse sans discontinuite d'ancre de temps
 *     superieure a `resyncMaxJumpMs` par trame ;
 *   - confiance 1 et BPM exact tant que la verite a autorite ;
 *   - tolerance a l'inconnu et rejets du canal (doc 12).
 *
 * L'hote simule emet comme Beat Studio : chaque evenement est annonce au
 * moment ou le scheduler le PLANIFIE (`LOOKAHEAD_SEC` avant qu'il ne sonne),
 * avec un `tHost` exprime sur l'horloge de l'HOTE, decalee de `OFFSET_SEC`
 * par rapport a l'horloge locale du banc.
 */

import { describe, expect, it } from 'vitest';
import { clickTrack } from '../../../src/ui/live/testing/SyntheticAudio';
import type { SyntheticSignal } from '../../../src/ui/live/testing/SyntheticAudio';
import { createEngine, makeConfig } from '../../../src/ui/live/testing/runEngine';
import { BeatClock } from '../../../src/ui/live/audio/BeatClock';
import { TruthChannel } from '../../../src/ui/live/truth/TruthChannel';
import { TruthDirector } from '../../../src/ui/live/truth/TruthDirector';
import { maxPhaseJumpMsAfter, phaseErrorRmsMs, record, sampleAt } from './beatMetrics';

/** Offset vrai entre horloge locale et horloge hote : tLocal - tHost. */
const OFFSET_SEC = 12.345;
/** Lookahead du scheduler hote : l'annonce precede le son de cette avance. */
const LOOKAHEAD_SEC = 0.1;
const BPM = 128;
/** Critere ADR-012 : offset retrouve a +/- 3 ms. */
const OFFSET_TOLERANCE_SEC = 0.003;
/** Critere ADR-012 : aucune discontinuite d'ancre au-dela de `resyncMaxJumpMs` (15 ms) par trame. */
const MAX_ANCHOR_JUMP_MS = 15.5;

interface HostMessage {
  readonly tArr: number;
  readonly raw: string;
}

/** Flux de messages de l'hote synthetique, trie par instant d'arrivee locale. */
function buildHostMessages(signal: SyntheticSignal, stopAfterLocalSec = Number.POSITIVE_INFINITY): HostMessage[] {
  const msgs: HostMessage[] = [];
  const push = (tArr: number, tHost: number, payload: Record<string, unknown>): void => {
    if (tArr > stopAfterLocalSec) return;
    msgs.push({ tArr, raw: JSON.stringify({ pmdiLive: '1.0', tHost, payload }) });
  };
  // Le premier kick du click track EST un temps de la grille : il sert
  // d'ancre `tBeat`, exprimee en temps HOTE.
  const tBeatHost = (signal.kickTimes[0] ?? 0) - OFFSET_SEC;
  for (let t = 0.05; t < signal.durationSec; t += 1) {
    push(t, t - OFFSET_SEC, { kind: 'tempo', bpm: BPM, tBeat: tBeatHost });
  }
  for (let t = 0.3; t < signal.durationSec; t += 0.5) {
    push(t, t - OFFSET_SEC, { kind: 'heartbeat' });
  }
  for (const tk of signal.kickTimes) {
    push(tk - LOOKAHEAD_SEC, tk - OFFSET_SEC, { kind: 'event', type: 'KICK', intensity: 1, confidence: 1 });
  }
  for (const td of signal.downbeatTimes) {
    push(td - LOOKAHEAD_SEC, td - OFFSET_SEC, { kind: 'event', type: 'DOWNBEAT', intensity: 1, confidence: 1 });
  }
  msgs.sort((a, b) => a.tArr - b.tArr);
  return msgs;
}

interface TruthSample {
  readonly t: number;
  readonly truthActive: boolean;
  readonly effectiveConfidence: number;
}

/**
 * Biais d'horodatage du detecteur : mediane de (kick DETECTE - kick VRAI le
 * plus proche). Le detecteur a sa propre convention d'instant d'attaque
 * (retro-datation, interpolation parabolique) ; elle differe des instants
 * nominaux du generateur d'environ 5-6 ms - la MEME constante que le PLL
 * porte deja (NOTES.md : moyenne 5,3 ms), absorbee par `userTrimMs`.
 * L'aligneur ne peut pas faire mieux que sa source : il se mesure contre
 * cette convention, pas contre le generateur.
 */
function medianDetectionBias(detected: readonly number[], trueTimes: readonly number[]): number {
  const diffs: number[] = [];
  for (const td of detected) {
    let best = Number.POSITIVE_INFINITY;
    for (const tk of trueTimes) {
      const d = td - tk;
      if (Math.abs(d) < Math.abs(best)) best = d;
    }
    if (Math.abs(best) < 0.05) diffs.push(best);
  }
  diffs.sort((a, b) => a - b);
  if (diffs.length === 0) throw new Error('aucun kick detecte apparie a un kick vrai');
  const n = diffs.length;
  return n % 2 === 1 ? diffs[(n - 1) / 2]! : (diffs[n / 2 - 1]! + diffs[n / 2]!) / 2;
}

/** Fait tourner moteur + director sur le click track, l'hote livrant ses messages a la trame. */
function runWithHost(signal: SyntheticSignal, stopAfterLocalSec = Number.POSITIVE_INFINITY) {
  const engine = createEngine(signal);
  const truth = new TruthDirector(makeConfig().truth);
  const messages = buildHostMessages(signal, stopAfterLocalSec);
  const truthSamples: TruthSample[] = [];
  const detectedKicks: number[] = [];
  let msgIndex = 0;
  let convergedAt = -1;

  const report = record(engine, signal, {
    onFrame: (ctx) => {
      if (ctx.engine.firedThisFrame('kick')) detectedKicks.push(ctx.engine.onsets.lastTime('kick'));
      // Livraison : un message arrive a la premiere trame qui suit `tArr`,
      // comme un `onmessage` reel horodate a `audioContext.currentTime`.
      while (msgIndex < messages.length && messages[msgIndex]!.tArr <= ctx.tAudio) {
        truth.ingest(ctx.tAudio, messages[msgIndex]!.raw);
        msgIndex++;
      }
      truth.step(ctx.tAudio, ctx.engine);
      if (convergedAt < 0 && truth.aligner.converged) convergedAt = ctx.tAudio;
      truthSamples.push({
        t: ctx.tAudio,
        truthActive: ctx.engine.beat.truthActive,
        effectiveConfidence: ctx.engine.effectiveConfidence,
      });
    },
  });

  return { engine, truth, report, truthSamples, detectedKicks, convergedAt };
}

function truthSampleAt(samples: readonly TruthSample[], at: number): TruthSample {
  const s = samples.find((x) => x.t >= at);
  if (!s) throw new Error(`aucun echantillon de verite a t >= ${at}`);
  return s;
}

describe('ADR-012 - alignement et autorite de la verite', () => {
  it('retrouve l\'offset a +/- 3 ms, impose BPM exact et confiance 1', () => {
    const signal = clickTrack(BPM, 30, { jitterPct: 0 });
    const { engine, truth, report, truthSamples, detectedKicks, convergedAt } = runWithHost(signal);

    expect(convergedAt, `convergence a t=${convergedAt.toFixed(2)} s`).toBeGreaterThan(0);
    expect(convergedAt, 'convergence en moins de 10 s').toBeLessThanOrEqual(10);
    // Critere ADR +/- 3 ms : l'aligneur se mesure contre la convention
    // d'horodatage de SA source (le detecteur), voir `medianDetectionBias`.
    const bias = medianDetectionBias(detectedKicks, signal.kickTimes);
    expect(
      Math.abs(truth.aligner.offsetSec - (OFFSET_SEC + bias)),
      `offset estime ${truth.aligner.offsetSec.toFixed(4)} s (vrai ${OFFSET_SEC}, biais detecteur ${(bias * 1000).toFixed(1)} ms)`,
    ).toBeLessThanOrEqual(OFFSET_TOLERANCE_SEC);
    // Borne de coherence ABSOLUE, biais du detecteur compris : la constante
    // residuelle est du meme ordre que celle du PLL et releve de `userTrimMs`.
    expect(Math.abs(truth.aligner.offsetSec - OFFSET_SEC)).toBeLessThanOrEqual(0.01);

    const end = truthSampleAt(truthSamples, 29);
    expect(end.truthActive, 'verite active en fin de course').toBe(true);
    expect(end.effectiveConfidence).toBe(1);
    expect(Math.abs(engine.beat.bpm - BPM), `BPM tenu : ${engine.beat.bpm.toFixed(3)}`).toBeLessThanOrEqual(0.01);
    expect(engine.beat.downbeatConfidence).toBe(1);
    expect(sampleAt(report, 29).state).toBe('LOCKED');

    // La grille de verite ancre les temps sur la grille de l'hote, vue a
    // travers la convention du detecteur : l'erreur de phase contre les kicks
    // VRAIS porte donc le biais constant du detecteur (releve par `userTrimMs`,
    // comme en mode PLL) plus la gigue residuelle de l'alignement. C'est la
    // gigue qu'on borne a 3 ms ; le total reste sous le RMS du PLL seul.
    const rms = phaseErrorRmsMs(report, signal.kickTimes, convergedAt + 1, 30);
    const biasMs = Math.abs(bias) * 1000;
    const residual = Math.sqrt(Math.max(0, rms * rms - biasMs * biasMs));
    expect(residual, `gigue residuelle = ${residual.toFixed(2)} ms (RMS ${rms.toFixed(2)}, biais ${biasMs.toFixed(2)})`).toBeLessThan(3);
    expect(rms, `erreur de phase RMS totale = ${rms.toFixed(2)} ms`).toBeLessThan(10);
  }, 120000);

  it('canal muet : repli PLL sans discontinuite, BPM conserve', () => {
    const cutoffSec = 15;
    const signal = clickTrack(BPM, 40, { jitterPct: 0 });
    const { report, truthSamples, convergedAt } = runWithHost(signal, cutoffSec);

    expect(convergedAt).toBeGreaterThan(0);
    expect(truthSampleAt(truthSamples, 14).truthActive, 'verite active avant la coupure').toBe(true);

    // Timeout de 2 s apres le dernier message : la verite doit etre rendue.
    const released = truthSamples.find((s) => s.t > cutoffSec && !s.truthActive);
    expect(released, 'la verite est abandonnee apres la coupure').toBeDefined();
    expect(released!.t, `verite rendue a t=${released!.t.toFixed(2)} s`).toBeLessThanOrEqual(cutoffSec + 2.3);

    // Le PLL reprend : BPM tenu, etat LOCKED, aucune resynchronisation seche.
    const late = sampleAt(report, 25);
    expect(Math.abs(late.bpm - BPM), `BPM apres repli : ${late.bpm.toFixed(2)}`).toBeLessThanOrEqual(0.5);
    expect(late.state).toBe('LOCKED');

    const jump = maxPhaseJumpMsAfter(report, convergedAt);
    expect(jump, `plus grand saut d'ancre : ${jump.toFixed(2)} ms`).toBeLessThanOrEqual(MAX_ANCHOR_JUMP_MS);
  }, 120000);
});

describe('ADR-012 - contrat du canal (doc 12)', () => {
  const config = makeConfig().truth;

  it('rejette le malforme, ignore l\'inconnu, tolere le mineur superieur', () => {
    const c = new TruthChannel(config);
    expect(c.ingest(1, '{pas du json')).toBe('rejected');
    expect(c.ingest(1, JSON.stringify({ tHost: 1, payload: { kind: 'tempo' } }))).toBe('rejected');
    expect(c.ingest(1, JSON.stringify({ pmdiLive: '2.0', tHost: 1, payload: { kind: 'heartbeat' } }))).toBe('rejected');
    expect(c.ingest(1, JSON.stringify({ pmdiLive: '1.0', tHost: Number.NaN, payload: { kind: 'heartbeat' } }))).toBe('rejected');
    expect(c.ingest(1, JSON.stringify({ pmdiLive: '1.0', tHost: 1, payload: { kind: 'grille-quantique' } }))).toBe('ignored');
    expect(c.ingest(1, JSON.stringify({ pmdiLive: '1.7', tHost: 1, payload: { kind: 'heartbeat' } }))).toBe('accepted');
    // Type d'evenement inconnu : transporte sans erreur (tolerance a l'inconnu).
    expect(c.ingest(1, JSON.stringify({ pmdiLive: '1.0', tHost: 1, payload: { kind: 'event', type: 'THEREMIN' } }))).toBe('accepted');
    expect(c.rejected).toBe(4);
    expect(c.ignored).toBe(1);
    expect(c.accepted).toBe(2);
  });

  it('tempo invalide rejete, tempo valide adopte', () => {
    const c = new TruthChannel(config);
    expect(c.ingest(1, JSON.stringify({ pmdiLive: '1.0', tHost: 1, payload: { kind: 'tempo', bpm: 0, tBeat: 1 } }))).toBe('rejected');
    expect(c.ingest(1, JSON.stringify({ pmdiLive: '1.0', tHost: 1, payload: { kind: 'tempo', bpm: 128, tBeat: 0.5 } }))).toBe('accepted');
    expect(c.tempoBpm).toBe(128);
    expect(c.tempoAnchorHost).toBe(0.5);
  });

  it('vivacite et reset', () => {
    const c = new TruthChannel(config);
    expect(c.alive(0)).toBe(false);
    c.ingest(5, JSON.stringify({ pmdiLive: '1.0', tHost: 1, payload: { kind: 'heartbeat' } }));
    expect(c.alive(5 + config.heartbeatTimeoutSec)).toBe(true);
    expect(c.alive(5 + config.heartbeatTimeoutSec + 0.01)).toBe(false);
    c.ingest(6, JSON.stringify({ pmdiLive: '1.0', tHost: 2, payload: { kind: 'reset' } }));
    expect(c.takeReset()).toBe(true);
    expect(c.takeReset(), 'le drapeau est consomme').toBe(false);
  });
});

describe('ADR-012 - priorite operateur > hote > PLL', () => {
  it('le tap tempo manuel refuse la verite ; elle reprend a la liberation', () => {
    const cfg = makeConfig();
    const clock = new BeatClock(cfg.beat, cfg.sync, 5);
    clock.advance(0.01, 10);
    clock.tap(8);
    clock.tap(8.5);
    clock.tap(9);
    clock.tap(9.5);
    expect(clock.manual).toBe(true);
    expect(Math.abs(clock.bpm - 120)).toBeLessThan(0.01);

    clock.setTruthGrid(60 / 128, 10, 10);
    expect(clock.truthActive, 'operateur > hote').toBe(false);
    expect(Math.abs(clock.bpm - 120), 'le tap garde la main').toBeLessThan(0.01);

    clock.releaseManual();
    clock.setTruthGrid(60 / 128, 10, 10);
    expect(clock.truthActive).toBe(true);
    expect(Math.abs(clock.bpm - 128)).toBeLessThan(0.01);

    clock.truthDownbeatAt(10);
    expect(clock.downbeatConfidence).toBe(1);

    clock.clearTruth();
    expect(clock.truthActive).toBe(false);
    expect(Math.abs(clock.bpm - 128), 'periode conservee au repli').toBeLessThan(0.01);
  });
});
