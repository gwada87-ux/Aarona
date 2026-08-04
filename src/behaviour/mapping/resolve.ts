import type { FeatureId } from '../../music/MusicTimeline';
import type { EventType } from '../../music/pmdi';
import { Anticipation } from '../signals/Anticipation';
import { Continuous } from '../signals/Continuous';
import { Impulse } from '../signals/Impulse';
import {
  anticipationEventType,
  continuousFeatureId,
  isAnticipationEntry,
  isContinuousEntry,
  isImpulseEntry,
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

export interface ResolvedMapping {
  readonly impulses: ReadonlyMap<string, ResolvedImpulse>;
  readonly continuous: ReadonlyMap<string, ResolvedContinuous>;
  readonly anticipations: ReadonlyMap<string, ResolvedAnticipation>;
}

/** Instancie une primitive par entrée de la table — une fois, jamais recréée pendant la lecture. */
export function resolve(mapping: MappingSchema): ResolvedMapping {
  const impulses = new Map<string, ResolvedImpulse>();
  const continuous = new Map<string, ResolvedContinuous>();
  const anticipations = new Map<string, ResolvedAnticipation>();

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
    }
  }

  return { impulses, continuous, anticipations };
}
