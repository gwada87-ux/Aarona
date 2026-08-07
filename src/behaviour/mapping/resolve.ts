import type { FeatureId } from '../../music/MusicTimeline';
import type { EventType } from '../../music/pmdi';
import { Anticipation } from '../signals/Anticipation';
import { Continuous } from '../signals/Continuous';
import { Impulse } from '../signals/Impulse';
import type { LfoWaveform } from '../signals/Lfo';
import {
  anticipationEventType,
  continuousFeatureId,
  isAnticipationEntry,
  isContinuousEntry,
  isImpulseEntry,
  isLfoEntry,
  lfoWaveform,
  type MappingSchema,
} from './MappingSchema';

export interface ResolvedImpulse {
  readonly primitive: Impulse;
  readonly from: readonly EventType[];
  readonly gain: number;
}

export interface ResolvedContinuous {
  readonly primitive: Continuous;
  readonly featureId: FeatureId;
}

export interface ResolvedAnticipation {
  readonly primitive: Anticipation;
  readonly eventType: EventType;
}

/**
 * Un LFO n'a pas de primitive à instancier : sa valeur est une fonction pure
 * de la position musicale (voir `signals/Lfo.ts`). On ne retient donc que sa
 * configuration, ce qui le rend gratuit à recâbler — `setMapping` n'a aucun
 * état à reporter, contrairement aux impulsions et aux continus.
 */
export interface ResolvedLfo {
  readonly waveform: LfoWaveform;
  readonly bars: number;
  readonly phase: number;
}

export interface ResolvedMapping {
  readonly impulses: ReadonlyMap<string, ResolvedImpulse>;
  readonly continuous: ReadonlyMap<string, ResolvedContinuous>;
  readonly anticipations: ReadonlyMap<string, ResolvedAnticipation>;
  readonly lfos: ReadonlyMap<string, ResolvedLfo>;
}

/** Instancie une primitive par entrée de la table — une fois, jamais recréée pendant la lecture. */
export function resolve(mapping: MappingSchema): ResolvedMapping {
  const impulses = new Map<string, ResolvedImpulse>();
  const continuous = new Map<string, ResolvedContinuous>();
  const anticipations = new Map<string, ResolvedAnticipation>();
  const lfos = new Map<string, ResolvedLfo>();

  for (const [signal, entry] of Object.entries(mapping)) {
    if (isImpulseEntry(entry)) {
      impulses.set(signal, { primitive: new Impulse(entry.decay), from: entry.from, gain: entry.gain });
    } else if (isContinuousEntry(entry)) {
      continuous.set(signal, {
        primitive: new Continuous(entry.rise, entry.fall),
        featureId: continuousFeatureId(entry),
      });
    } else if (isAnticipationEntry(entry)) {
      anticipations.set(signal, {
        primitive: new Anticipation(entry.window, entry.curve),
        eventType: anticipationEventType(entry),
      });
    } else if (isLfoEntry(entry)) {
      lfos.set(signal, { waveform: lfoWaveform(entry), bars: entry.bars, phase: entry.phase ?? 0 });
    }
  }

  return { impulses, continuous, anticipations, lfos };
}
