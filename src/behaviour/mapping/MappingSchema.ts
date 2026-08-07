import type { FeatureId } from '../../music/MusicTimeline';
import type { EventType } from '../../music/pmdi';
import type { AnticipationCurve } from '../signals/Anticipation';
import { isLfoWaveform, type LfoWaveform } from '../signals/Lfo';

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

/**
 * Quatrième famille, ajoutée au chantier 2 de la phase 2
 * (docs/17_PHASE2_VISUELS.md §7.1). Suit la même convention que les trois
 * autres : aucun champ `kind`, la famille se déduit du préfixe de `from`.
 *
 * Un LFO n'a PAS de source musicale événementielle — il est piloté par la
 * grille seule. C'est ce qui le rend utile : il fait vivre l'image entre les
 * frappes, là où toutes les autres familles retombent au repos.
 */
export interface LfoMappingEntry {
  readonly from: `lfo:${LfoWaveform}`;
  /** Période en MESURES. 0,25 = une noire en 4/4, 4 = quatre mesures. */
  readonly bars: number;
  /** Décalage de phase, 0..1 de la période. Absent = 0. */
  readonly phase?: number;
}

export type MappingEntry =
  | ImpulseMappingEntry
  | ContinuousMappingEntry
  | AnticipationMappingEntry
  | LfoMappingEntry;

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

export function isLfoEntry(entry: MappingEntry): entry is LfoMappingEntry {
  return typeof entry.from === 'string' && entry.from.startsWith('lfo:') && isLfoWaveform(entry.from.slice('lfo:'.length));
}

export function lfoWaveform(entry: LfoMappingEntry): LfoWaveform {
  return entry.from.slice('lfo:'.length) as LfoWaveform;
}

export function continuousFeatureId(entry: ContinuousMappingEntry): FeatureId {
  return entry.from.slice('feature:'.length);
}

export function anticipationEventType(entry: AnticipationMappingEntry): EventType {
  return entry.from.slice('anticipate:'.length);
}
