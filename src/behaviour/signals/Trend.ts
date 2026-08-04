import type { FeatureId, MusicTimeline } from '../../music/MusicTimeline';

/**
 * Trend — pente sur une fenêtre glissante, dérivée des courbes
 * (docs/07_VISUAL_ENGINE.md, famille "Trend"). Délègue directement à
 * `MusicTimeline.featureSlope`, déjà livré en P5 — c'est littéralement la
 * même définition ("pente sur une fenêtre glissante").
 *
 * Sans état interne (contrairement à Impulse/Envelope/Continuous) : une
 * pente est déjà une fonction pure de `t`, rien à faire décroître ni à
 * réinitialiser sur seek. Retourne la pente BRUTE (unité : par seconde),
 * non recadrée sur 0..1 — comme `Impulse.fire(amount)` ou
 * `Continuous.update(target)`, la mise à l'échelle est laissée à
 * l'entrée de la table de câblage qui l'utilisera, pas à la primitive.
 * Aucune entrée de la table par défaut ne l'utilise encore (voir
 * BehaviourEngine.ts, LIMITES CONNUES).
 */
export class Trend {
  constructor(private readonly window: number) {}

  valueFrom(timeline: MusicTimeline, id: FeatureId, t: number): number {
    return timeline.featureSlope(t, id, this.window);
  }
}
