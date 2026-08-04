/**
 * MusicTimeline — source de vérité musicale, requêtable et immuable
 * (docs/06_EVENT_SYSTEM.md, docs/02_ARCHITECTURE.md §2). Construite une fois
 * depuis un `PmdiDocument` déjà validé (`validatePmdi(doc).ok === true`),
 * jamais mutée ensuite.
 *
 * Convention de bornes, valable pour TOUTES les méthodes de plage/anticipation
 * de ce fichier : demi-ouvert **(t0, t1]** — t0 exclu, t1 inclus. C'est la
 * seule convention qui permette à `EventDispatcher.collect()` de balayer le
 * temps sans jamais compter un événement deux fois ni en manquer un pile sur
 * une frontière de sous-pas (voir EventDispatcher.ts). `nextEventOfType`
 * et `prevEventOfType` suivent la même logique : un événement exactement à
 * `t` est considéré comme déjà passé (« prev »), jamais comme « next ».
 */

import { clamp } from '../core/math/clamp';
import { lerp } from '../core/math/lerp';
import type {
  EventType,
  FeatureTrack,
  MeterPoint,
  MusicEvent,
  PmdiDocument,
  Section,
  TempoPoint,
} from './pmdi';

export type FeatureId = string;

export interface GlobalConfidence {
  readonly tempo: number;
  readonly grid: number;
  readonly classification: number;
  readonly structure: number;
}

export interface MusicTimeline {
  readonly duration: number;
  readonly confidence: GlobalConfidence;

  eventsBetween(t0: number, t1: number): readonly MusicEvent[];
  eventsOfTypeBetween(type: EventType, t0: number, t1: number): readonly MusicEvent[];

  nextEventOfType(type: EventType, t: number): MusicEvent | null;
  prevEventOfType(type: EventType, t: number): MusicEvent | null;
  timeToNext(type: EventType, t: number): number;

  featureAt(t: number, id: FeatureId): number;
  featureSlope(t: number, id: FeatureId, window: number): number;

  tempoAt(t: number): number;
  beatPhaseAt(t: number): number;
  barPhaseAt(t: number): number;
  beatIndexAt(t: number): number;
  /**
   * Absent de la table de docs/06_EVENT_SYSTEM.md (mise à jour dans ce lot) :
   * `StepContext.bar.index` (docs/02) en a besoin, et il ne peut pas être
   * reconstruit correctement en dehors de la timeline en présence de
   * changements de mesure (meter.map). Ajouté ici pour combler l'écart entre
   * les deux documents plutôt que de dupliquer l'intégration tempo/mesure
   * côté StepContext.
   */
  barIndexAt(t: number): number;

  sectionAt(t: number): Section | null;
  sections(): readonly Section[];
}

/** Première position où `keyOf(arr[i]) > x` — recherche binaire, O(log n). */
function upperBound<T>(arr: readonly T[], x: number, keyOf: (item: T) => number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keyOf(arr[mid]!) <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sortedByT<T extends { t: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.t - b.t);
}

/** Intègre le tempo (piecewise constant entre points de `tempoMap`) en battements cumulés depuis t=0. */
function cumulativeBeats(tempoMap: readonly TempoPoint[], t: number): number {
  if (tempoMap.length === 0) return t * 2; // repli 120 BPM si aucune donnée
  const first = tempoMap[0]!;
  if (t <= first.t) return (t - first.t) * (first.bpm / 60);

  let beats = 0;
  let prevT = first.t;
  let prevBpm = first.bpm;
  for (let i = 1; i < tempoMap.length; i++) {
    const point = tempoMap[i]!;
    const segEnd = Math.min(point.t, t);
    if (segEnd > prevT) beats += (segEnd - prevT) * (prevBpm / 60);
    if (t <= point.t) return beats;
    prevT = point.t;
    prevBpm = point.bpm;
  }
  beats += (t - prevT) * (prevBpm / 60);
  return beats;
}

/**
 * Intègre les mesures en réutilisant `cumulativeBeats` par segment de
 * `meterMap`. `num` est traité comme le nombre de battements par mesure
 * (simplification déjà en usage dans ce dépôt, ex. downbeats.ts sur 4
 * phases) — `den` n'est pas exploité, aucun preset MVP n'est en mesure
 * composée (docs/08_PRESETS.md, tous en 4/4).
 */
function cumulativeBars(tempoMap: readonly TempoPoint[], meterMap: readonly MeterPoint[], t: number): number {
  if (meterMap.length === 0) return cumulativeBeats(tempoMap, t) / 4;
  const first = meterMap[0]!;
  if (t <= first.t) {
    return (cumulativeBeats(tempoMap, t) - cumulativeBeats(tempoMap, first.t)) / first.num;
  }

  let bars = 0;
  let prevT = first.t;
  let prevNum = first.num;
  for (let i = 1; i < meterMap.length; i++) {
    const point = meterMap[i]!;
    const segEnd = Math.min(point.t, t);
    if (segEnd > prevT) {
      bars += (cumulativeBeats(tempoMap, segEnd) - cumulativeBeats(tempoMap, prevT)) / prevNum;
    }
    if (t <= point.t) return bars;
    prevT = point.t;
    prevNum = point.num;
  }
  bars += (cumulativeBeats(tempoMap, t) - cumulativeBeats(tempoMap, prevT)) / prevNum;
  return bars;
}

function tempoAtImpl(tempoMap: readonly TempoPoint[], t: number): number {
  if (tempoMap.length === 0) return 120;
  const idx = upperBound(tempoMap, t, (p) => p.t) - 1;
  return tempoMap[Math.max(0, idx)]!.bpm;
}

export function buildMusicTimeline(doc: PmdiDocument): MusicTimeline {
  const events = sortedByT(doc.events);
  const byType = new Map<EventType, MusicEvent[]>();
  for (const event of events) {
    let list = byType.get(event.type);
    if (!list) {
      list = [];
      byType.set(event.type, list);
    }
    list.push(event);
  }

  const featuresById = new Map<string, FeatureTrack>();
  for (const track of doc.features ?? []) featuresById.set(track.id, track);

  const sections = sortedByT(doc.sections ?? []);
  const tempoMap = sortedByT(doc.tempo.map);
  const meterMap = sortedByT(doc.meter.map);

  function eventsBetween(t0: number, t1: number): readonly MusicEvent[] {
    const lo = upperBound(events, t0, (e) => e.t);
    const hi = upperBound(events, t1, (e) => e.t);
    return events.slice(lo, hi);
  }

  function eventsOfTypeBetween(type: EventType, t0: number, t1: number): readonly MusicEvent[] {
    const list = byType.get(type);
    if (!list) return [];
    const lo = upperBound(list, t0, (e) => e.t);
    const hi = upperBound(list, t1, (e) => e.t);
    return list.slice(lo, hi);
  }

  function nextEventOfType(type: EventType, t: number): MusicEvent | null {
    const list = byType.get(type);
    if (!list) return null;
    const idx = upperBound(list, t, (e) => e.t); // premier avec e.t > t
    return idx < list.length ? list[idx]! : null;
  }

  function prevEventOfType(type: EventType, t: number): MusicEvent | null {
    const list = byType.get(type);
    if (!list) return null;
    const idx = upperBound(list, t, (e) => e.t) - 1; // dernier avec e.t <= t
    return idx >= 0 ? list[idx]! : null;
  }

  function timeToNext(type: EventType, t: number): number {
    const next = nextEventOfType(type, t);
    return next ? next.t - t : Infinity;
  }

  function featureAt(t: number, id: FeatureId): number {
    const track = featuresById.get(id);
    if (!track || track.data.length === 0) return 0;
    if (track.data.length === 1) return track.data[0]!;

    const rawIndex = (t - track.t0) * track.hz;
    const i0 = clamp(Math.floor(rawIndex), 0, track.data.length - 1);
    const i1 = clamp(i0 + 1, 0, track.data.length - 1);
    const frac = i1 === i0 ? 0 : clamp(rawIndex - i0, 0, 1);
    return lerp(track.data[i0]!, track.data[i1]!, frac);
  }

  function featureSlope(t: number, id: FeatureId, window: number): number {
    if (window <= 0) return 0;
    return (featureAt(t + window / 2, id) - featureAt(t - window / 2, id)) / window;
  }

  function sectionAt(t: number): Section | null {
    if (sections.length === 0) return null;
    const idx = upperBound(sections, t, (s) => s.t) - 1;
    return idx >= 0 ? sections[idx]! : null;
  }

  return Object.freeze({
    duration: doc.audio.duration,
    confidence: Object.freeze({ ...doc.confidence }),
    eventsBetween,
    eventsOfTypeBetween,
    nextEventOfType,
    prevEventOfType,
    timeToNext,
    featureAt,
    featureSlope,
    tempoAt: (t: number) => tempoAtImpl(tempoMap, t),
    beatPhaseAt: (t: number) => {
      const beats = cumulativeBeats(tempoMap, t);
      return beats - Math.floor(beats);
    },
    barPhaseAt: (t: number) => {
      const bars = cumulativeBars(tempoMap, meterMap, t);
      return bars - Math.floor(bars);
    },
    beatIndexAt: (t: number) => Math.floor(cumulativeBeats(tempoMap, t)),
    barIndexAt: (t: number) => Math.floor(cumulativeBars(tempoMap, meterMap, t)),
    sectionAt,
    sections: () => sections,
  });
}
