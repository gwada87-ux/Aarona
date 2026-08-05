/**
 * Tests de `audio/RealtimeProbe.ts` — Étape 33. Premier test de ce module
 * (sonde décorative `AnalyserNode`, ADR-003) — testable en Node via
 * `FakeAudioContext`/`FakeAnalyserNode` (`testSupport/FakeAudioContext.ts`,
 * étendu à cette étape), même principe que `AudioEngine.ts` (Étape 27).
 */
import { describe, expect, it, vi } from 'vitest';
import { RealtimeProbe } from '../../src/audio/RealtimeProbe';
import { FakeAudioContext, FakeAnalyserNode, FakeGainNode } from './testSupport/FakeAudioContext';

function buildProbe(fftSize?: number): { probe: RealtimeProbe; analyser: FakeAnalyserNode; source: FakeGainNode } {
  const ctx = new FakeAudioContext();
  const createAnalyserSpy = vi.spyOn(ctx, 'createAnalyser');
  const source = new FakeGainNode();
  const probe = new RealtimeProbe(ctx as unknown as AudioContext, source as unknown as AudioNode, fftSize);
  const analyser = createAnalyserSpy.mock.results[0]!.value as FakeAnalyserNode;
  return { probe, analyser, source };
}

describe('RealtimeProbe — construction', () => {
  it('configure fftSize/smoothingTimeConstant (0,6 fixe) sur l\'analyser créé', () => {
    const { analyser } = buildProbe(512);
    expect(analyser.fftSize).toBe(512);
    expect(analyser.smoothingTimeConstant).toBe(0.6);
  });

  it('fftSize par défaut à 1024 si omis', () => {
    const { analyser } = buildProbe();
    expect(analyser.fftSize).toBe(1024);
  });

  it('connecte la source EXACTEMENT à l\'analyser créé (pas à un autre nœud)', () => {
    const ctx = new FakeAudioContext();
    const createAnalyserSpy = vi.spyOn(ctx, 'createAnalyser');
    const source = new FakeGainNode();
    const connectSpy = vi.spyOn(source, 'connect');

    new RealtimeProbe(ctx as unknown as AudioContext, source as unknown as AudioNode, 256);

    const analyser = createAnalyserSpy.mock.results[0]!.value;
    expect(connectSpy).toHaveBeenCalledExactlyOnceWith(analyser);
  });

  it('enabled vaut true par défaut', () => {
    const { probe } = buildProbe();
    expect(probe.enabled).toBe(true);
  });
});

describe('RealtimeProbe — sample()', () => {
  it('désactivée (enabled=false) : renvoie 0 SANS lire les données de l\'analyser', () => {
    const { probe, analyser } = buildProbe();
    const readSpy = vi.spyOn(analyser, 'getByteTimeDomainData');
    probe.enabled = false;

    expect(probe.sample()).toBe(0);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('silence (128 partout, valeur de repos réelle) : niveau 0', () => {
    const { probe, analyser } = buildProbe(64);
    analyser.timeDomainPattern = () => 128;
    expect(probe.sample()).toBe(0);
  });

  it('signal saturé haut (255 partout) : niveau proche de 1 (127/128)', () => {
    const { probe, analyser } = buildProbe(64);
    analyser.timeDomainPattern = () => 255;
    expect(probe.sample()).toBeCloseTo(127 / 128, 10);
  });

  it('signal saturé bas (0 partout) : niveau exactement 1 (128/128)', () => {
    const { probe, analyser } = buildProbe(64);
    analyser.timeDomainPattern = () => 0;
    expect(probe.sample()).toBeCloseTo(1, 10);
  });

  it('calcule bien la MOYENNE des écarts absolus, pas juste un échantillon', () => {
    const { probe, analyser } = buildProbe(64);
    // Moitié à 128 (silence), moitié à 255 (saturé) -> moyenne des écarts = 127/2.
    analyser.timeDomainPattern = (i, length) => (i < length / 2 ? 128 : 255);
    const expected = 127 / 2 / 128;
    expect(probe.sample()).toBeCloseTo(expected, 10);
  });

  it('dimensionne son tableau interne sur frequencyBinCount (fftSize / 2)', () => {
    const { probe, analyser } = buildProbe(128); // frequencyBinCount = 64
    let receivedLength = -1;
    analyser.timeDomainPattern = (_i, length) => {
      receivedLength = length;
      return 128;
    };
    probe.sample();
    expect(receivedLength).toBe(64);
  });
});

describe('RealtimeProbe — dispose', () => {
  it('déconnecte l\'analyser', () => {
    const { probe, analyser } = buildProbe();
    const disconnectSpy = vi.spyOn(analyser, 'disconnect');
    probe.dispose();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
