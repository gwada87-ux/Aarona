import { clamp } from '../../core/math/clamp';
import { easeInOutSine, easeInQuad } from '../../core/math/easing';
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
/**
 * Liste EXÉCUTABLE des courbes, et non seulement un type. Le défaut corrigé ici
 * venait précisément de là : les noms de courbes vivaient dans un type
 * TypeScript, effacé à la compilation, tandis que les presets sont du JSON lu à
 * l'exécution. Rien ne pouvait confronter les deux. `validatePreset` s'appuie
 * maintenant sur ce tableau.
 */
export const ANTICIPATION_CURVES = ['linear', 'easeInQuad', 'easeInOutSine'] as const;
export type AnticipationCurve = (typeof ANTICIPATION_CURVES)[number];

/**
 * `easeInOutSine` AJOUTÉE après un défaut signalé par Aaron : « quand je clique
 * sur un preset du visualizer, l'image ne change pas ».
 *
 * Diagnostic mesuré, onze presets essayés un par un : quatre d'entre eux —
 * `lofi`, `rnb`, `afro`, `ambient` — levaient
 * `TypeError: CURVES[this.curve] is not a function`, et leur écart d'image
 * valait **exactement 0**. Les sept autres changeaient normalement (0,054 à
 * 0,225). L'exception tuait la boucle de rendu : l'image ne changeait pas
 * parce qu'elle ne se dessinait plus.
 *
 * Ces quatre presets déclarent `curve: "easeInOutSine"` depuis le chantier 9.
 * La fonction EXISTE dans `core/math/easing` et `ReactionEditor` la propose
 * déjà dans sa liste ; seule cette table ne l'avait jamais reçue. Le commentaire
 * qui la précédait — « pas de catalogue de courbes inventé sans plus de
 * spécification » — était une bonne règle appliquée trop tard : la décision
 * d'offrir cette courbe avait déjà été prise deux fois ailleurs, et le moteur
 * ne l'avait pas suivie.
 */
const CURVES: Readonly<Record<AnticipationCurve, (x: number) => number>> = {
  linear: (x) => x,
  easeInQuad,
  easeInOutSine,
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
    // Repli sur `linear` plutôt qu'une exception. Un preset qui nomme une
    // courbe inconnue est une donnée fausse, pas une raison d'ARRÊTER LE
    // RENDU : c'est exactement ce qui est arrivé aux quatre presets ci-dessus,
    // et l'utilisateur n'a vu qu'une image figée, sans le moindre indice.
    // Même esprit que la Loi 3 — un morceau non analysable doit rester beau.
    // Le mauvais nom est refusé à l'entrée par `validatePreset`, qui lui dit
    // clairement ce qui ne va pas ; ici, on ne fait que refuser de mourir.
    return (CURVES[this.curve] ?? CURVES.linear)(raw);
  }
}
