import { describe, expect, it } from 'vitest';
import { detectMacroEvents, type DetectMacroEventsOptions } from '../../src/analysis/macro';
import type { SampledTrack } from '../../src/analysis/trackSampling';

function constantTrack(hz: number, durationSec: number, value: number): SampledTrack {
  const n = Math.ceil(durationSec * hz) + 1;
  return { hz, t0: 0, data: new Array(n).fill(value) };
}

function stepTrack(hz: number, durationSec: number, valueAt: (t: number) => number): SampledTrack {
  const n = Math.ceil(durationSec * hz) + 1;
  const data = Array.from({ length: n }, (_, i) => valueAt(i / hz));
  return { hz, t0: 0, data };
}

function baseOptions(overrides: Partial<DetectMacroEventsOptions> = {}): DetectMacroEventsOptions {
  const duration = overrides.duration ?? 8;
  return {
    duration,
    downbeatTimes: [0, 2, 4, 6],
    barEnergyTrack: constantTrack(10, duration, 0.5),
    bassEnergyTrack: constantTrack(10, duration, 0.1),
    highOnsetTimes: [],
    centroidTrack: constantTrack(10, duration, 1000),
    kickTimes: [],
    rawRmsDbTrack: constantTrack(10, duration, -20),
    ...overrides,
  };
}

describe('detectMacroEvents — DROP', () => {
  it('E_bar passe de <0,45 à >0,80 en ≤2 mesures, basse faible juste avant → DROP', () => {
    const duration = 6;
    const barEnergyTrack = stepTrack(10, duration, (t) => (t < 4 ? 0.2 : 0.9)); // bar0,1 bas ; bar2 haut
    const events = detectMacroEvents(baseOptions({ duration, downbeatTimes: [0, 2, 4, 6], barEnergyTrack }));

    const drops = events.filter((e) => e.type === 'DROP');
    expect(drops).toHaveLength(1);
    expect(drops[0]!.t).toBeCloseTo(2, 5);
    expect(drops[0]!.confidence).toBe(0.85);
  });

  it('pas de DROP si l\'énergie basse était déjà forte juste avant (pas un vrai silence de sub)', () => {
    const duration = 6;
    const barEnergyTrack = stepTrack(10, duration, (t) => (t < 4 ? 0.2 : 0.9));
    const bassEnergyTrack = constantTrack(10, duration, 0.6); // basse déjà forte
    const events = detectMacroEvents(baseOptions({ duration, downbeatTimes: [0, 2, 4, 6], barEnergyTrack, bassEnergyTrack }));
    expect(events.filter((e) => e.type === 'DROP')).toHaveLength(0);
  });

  it('n\'émet pas aussi un ENERGY_UP redondant sur la même transition', () => {
    const duration = 6;
    const barEnergyTrack = stepTrack(10, duration, (t) => (t < 4 ? 0.2 : 0.9));
    const events = detectMacroEvents(baseOptions({ duration, downbeatTimes: [0, 2, 4, 6], barEnergyTrack }));
    expect(events.filter((e) => e.type === 'ENERGY_UP')).toHaveLength(0);
  });
});

describe('detectMacroEvents — BUILDUP', () => {
  it('E_bar croît sur ≥4 mesures avec une densité d\'onsets aigus en hausse → BUILDUP de durée', () => {
    const duration = 10;
    const downbeatTimes = [0, 2, 4, 6, 8, 10];
    const barEnergyTrack = stepTrack(10, duration, (t) => Math.min(0.8, 0.2 + 0.15 * Math.floor(t / 2)));
    // densité croissante mesure par mesure : 1, 2, 3, 4, 5 onsets aigus.
    const highOnsetTimes = [0.5, 2.5, 2.6, 4.5, 4.6, 4.7, 6.5, 6.6, 6.7, 6.8, 8.5, 8.6, 8.7, 8.8, 8.9];

    const events = detectMacroEvents(baseOptions({ duration, downbeatTimes, barEnergyTrack, highOnsetTimes }));
    const buildups = events.filter((e) => e.type === 'BUILDUP');
    expect(buildups).toHaveLength(1);
    expect(buildups[0]!.t).toBeCloseTo(0, 5);
    expect(buildups[0]!.dur).toBeCloseTo(10, 5);
  });

  it('pas de BUILDUP si la densité d\'onsets aigus ne monte pas (décroît ici : forte au début, nulle à la fin)', () => {
    const duration = 10;
    const downbeatTimes = [0, 2, 4, 6, 8, 10];
    const barEnergyTrack = stepTrack(10, duration, (t) => Math.min(0.8, 0.2 + 0.15 * Math.floor(t / 2)));
    const highOnsetTimes = [0.1, 0.2, 0.3, 0.4, 0.5]; // 5 onsets dans la 1re mesure, aucun ailleurs
    const events = detectMacroEvents(baseOptions({ duration, downbeatTimes, barEnergyTrack, highOnsetTimes }));
    expect(events.filter((e) => e.type === 'BUILDUP')).toHaveLength(0);
  });
});

describe('detectMacroEvents — BREAK', () => {
  it('E_bar <0,35 pendant ≥2 mesures après une section >0,65, sans kick → BREAK', () => {
    const duration = 8;
    const downbeatTimes = [0, 2, 4, 6, 8];
    const barEnergyTrack = stepTrack(10, duration, (t) => {
      if (t < 2) return 0.8;
      if (t < 6) return 0.2;
      return 0.5;
    });
    const events = detectMacroEvents(baseOptions({ duration, downbeatTimes, barEnergyTrack, kickTimes: [] }));
    const breaks = events.filter((e) => e.type === 'BREAK');
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.t).toBeCloseTo(2, 5);
    expect(breaks[0]!.dur).toBeCloseTo(4, 5);
  });

  it('un kick présent dans la plage basse annule le BREAK (« absence de kick »)', () => {
    const duration = 8;
    const downbeatTimes = [0, 2, 4, 6, 8];
    const barEnergyTrack = stepTrack(10, duration, (t) => {
      if (t < 2) return 0.8;
      if (t < 6) return 0.2;
      return 0.5;
    });
    const events = detectMacroEvents(baseOptions({ duration, downbeatTimes, barEnergyTrack, kickTimes: [3] }));
    expect(events.filter((e) => e.type === 'BREAK')).toHaveLength(0);
  });
});

describe('detectMacroEvents — ENERGY_UP / ENERGY_DOWN', () => {
  it('détecte une variation isolée de plus de ±0,20 entre deux mesures', () => {
    const duration = 8;
    const downbeatTimes = [0, 2, 4, 6, 8];
    // 0.5 → 0.75 (+0.25, UP) → 0.5 (−0.25, DOWN) → 0.5 (stable)
    const barEnergyTrack = stepTrack(10, duration, (t) => {
      if (t < 2) return 0.5;
      if (t < 4) return 0.75;
      return 0.5;
    });
    const events = detectMacroEvents(baseOptions({ duration, downbeatTimes, barEnergyTrack }));
    expect(events.filter((e) => e.type === 'ENERGY_UP')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'ENERGY_DOWN')).toHaveLength(1);
  });
});

describe('detectMacroEvents — SILENCE', () => {
  it('RMS brut < −45dBFS pendant ≥0,4s → un seul événement SILENCE couvrant toute la plage', () => {
    const duration = 2;
    const hz = 100;
    const rawRmsDbTrack = stepTrack(hz, duration, (t) => (t >= 0.5 && t < 1.2 ? -50 : -20));
    const events = detectMacroEvents(baseOptions({ duration, downbeatTimes: [0], rawRmsDbTrack }));

    const silences = events.filter((e) => e.type === 'SILENCE');
    expect(silences).toHaveLength(1);
    expect(silences[0]!.t).toBeCloseTo(0.5, 1);
    expect(silences[0]!.dur!).toBeGreaterThanOrEqual(0.4);
  });

  it('pas de SILENCE si le passage bas dure moins de 0,4s', () => {
    const duration = 2;
    const hz = 100;
    const rawRmsDbTrack = stepTrack(hz, duration, (t) => (t >= 0.5 && t < 0.7 ? -50 : -20)); // 0,2s seulement
    const events = detectMacroEvents(baseOptions({ duration, downbeatTimes: [0], rawRmsDbTrack }));
    expect(events.filter((e) => e.type === 'SILENCE')).toHaveLength(0);
  });
});
