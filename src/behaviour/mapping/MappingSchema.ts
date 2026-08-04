import type { FeatureId } from '../../music/MusicTimeline';
import type { EventType } from '../../music/pmdi';
import type { AnticipationCurve } from '../signals/Anticipation';

/**
 * Forme JSON exacte de docs/07_VISUAL_ENGINE.md §"Table de câblage (mapping)" :
 * « le lien musique → signal est une donnée, pas du code ». Aucun champ
 * `kind` ajouté — la famille se déduit de la forme de `from`, pour rester
 * fidèle au JSON illustré (un preset R&B peut réécrire une seule entrée sans
 * connaître de discriminant). Voir `resolve.ts`.
 */
export interface ImpulseMappingEntry {
  readonly from: readonly EventType[];
  readonly gain: number;
  readonly decay: number;
}

export interface ContinuousMappingEntry {
  readonly from: `feature:${string}`;
  readonly rise: number;
  readonly fall: number;
}

export interface AnticipationMappingEntry {
  readonly from: `anticipate:${string}`;
  readonly window: number;
  readonly curve: AnticipationCurve;
}

export type MappingEntry = ImpulseMappingEntry | ContinuousMappingEntry | AnticipationMappingEntry;

/** Nom du signal (clé de `VisualSignals`) → entrée de câblage. */
export type MappingSchema = Readonly<Record<string, MappingEntry>>;

export function isImpulseEntry(entry: MappingEntry): entry is ImpulseMappingEntry {
  return Array.isArray(entry.from);
}

export function isContinuousEntry(entry: MappingEntry): entry is ContinuousMappingEntry {
  return typeof entry.from === 'string' && entry.from.startsWith('feature:');
}

export function isAnticipationEntry(entry: MappingEntry): entry is AnticipationMappingEntry {
  return typeof entry.from === 'string' && entry.from.startsWith('anticipate:');
}

export function continuousFeatureId(entry: ContinuousMappingEntry): FeatureId {
  return entry.from.slice('feature:'.length);
}

export function anticipationEventType(entry: AnticipationMappingEntry): EventType {
  return entry.from.slice('anticipate:'.length);
}
