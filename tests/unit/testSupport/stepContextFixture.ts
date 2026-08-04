import { buildMusicTimeline } from '../../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../../src/music/StepContext';
import { validatePmdi } from '../../../src/music/validatePmdi';
import type { MusicEvent, PmdiDocument } from '../../../src/music/pmdi';
import type { VisualSignals } from '../../../src/behaviour/BehaviourEngine';

export function makeStepBuilder(events: MusicEvent[] = [], durationSec = 20): StepContextBuilder {
  const doc: PmdiDocument = {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: durationSec, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events,
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
  const result = validatePmdi(doc);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return new StepContextBuilder(buildMusicTimeline(doc), 1);
}

export function makeSignals(overrides: Partial<VisualSignals> = {}): VisualSignals {
  return {
    impact: 0,
    subImpact: 0,
    accent: 0,
    tick: 0,
    sectionShift: 0,
    drive: 0,
    weight: 0,
    brightness: 0,
    tension: 0,
    pulse: 0.5,
    barPulse: 0.5,
    ...overrides,
  };
}
