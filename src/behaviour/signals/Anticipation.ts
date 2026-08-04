import { clamp } from '../../core/math/clamp';
import type { MusicTimeline } from '../../music/MusicTimeline';
import type { EventType } from '../../music/pmdi';

/**
 * Anticipation — montée vers un événement futur (docs/07_VISUAL_ENGINE.md,
 * famille "Anticipation" ; référence linéaire donnée en docs/06_EVENT_SYSTEM.md
 * §"Anticipation" : `dropIn < window ? 1 - dropIn/window : 0`).
 *
 * Sans état interne, comme `Trend` : recalculée à chaque pas depuis
 * `timeline.timeToNext`, jamais depuis un historique — c'est justement ce
 * qu'un bus événementiel ne permettrait pas (docs/06).
 */
export type AnticipationCurve = 'linear' | 'easeInQuad';

/**
 * Uniquement les deux courbes attestées dans les docs (`linear` en exemple
 * docs/06, `easeInQuad` dans la table de câblage docs/07) — pas de
 * catalogue de courbes inventé sans plus de spécification.
 */
const CURVES: Readonly<Record<AnticipationCurve, (x: number) => number>> = {
  linear: (x) => x,
  easeInQuad: (x) => x * x,
};

export class Anticipation {
  constructor(
    private readonly window: number,
    private readonly curve: AnticipationCurve = 'linear',
  ) {}

  valueFrom(timeline: MusicTimeline, type: EventType, t: number): number {
    const timeToNext = timeline.timeToNext(type, t);
    if (!Number.isFinite(timeToNext) || timeToNext >= this.window) return 0;
    const raw = clamp(1 - timeToNext / this.window, 0, 1);
    return CURVES[this.curve](raw);
  }
}
