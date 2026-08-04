/**
 * BehaviourEngine — musique → signaux visuels normalisés (docs/07_VISUAL_ENGINE.md
 * §"BehaviourEngine", docs/02_ARCHITECTURE.md, docs/03_DATA_FLOW.md
 * §"VisualSignals"). Une couche visuelle ne doit jamais savoir ce qu'est un
 * kick ; elle lit `impact`.
 */

import type { MusicTimeline } from '../music/MusicTimeline';
import type { StepContext } from '../music/StepContext';
import { resolve, type ResolvedMapping } from './mapping/resolve';
import type { MappingSchema } from './mapping/MappingSchema';

/**
 * Sous-ensemble de docs/03 (~20 valeurs prévues, `// …`) : les 11 signaux
 * pour lesquels une formule ou une durée est réellement spécifiée quelque
 * part dans docs/06/07 (voir defaults.ts et JOURNAL.md, Étape 8). `density`,
 * `release`, `chaos` en sont volontairement absents.
 */
export interface VisualSignals {
  readonly impact: number;
  readonly subImpact: number;
  readonly accent: number;
  readonly tick: number;
  readonly sectionShift: number;
  readonly drive: number;
  readonly weight: number;
  readonly brightness: number;
  readonly tension: number;
  /** sinusoïde synchronisée sur le beat, phase continue, remise à l'échelle 0..1. */
  readonly pulse: number;
  /** idem, sur la mesure. */
  readonly barPulse: number;
}

function pulseFromPhase(phase: number): number {
  return (Math.sin(2 * Math.PI * phase) + 1) / 2;
}

export class BehaviourEngine {
  private readonly resolved: ResolvedMapping;

  constructor(
    private readonly timeline: MusicTimeline,
    mapping: MappingSchema,
  ) {
    this.resolved = resolve(mapping);
  }

  update(step: StepContext): VisualSignals {
    for (const entry of this.resolved.impulses.values()) {
      entry.primitive.update(step.dt); // décroît d'abord la valeur du pas précédent...
      for (const event of step.fired) {
        if (entry.from.includes(event.type)) entry.primitive.fire(event.intensity * entry.gain);
      } // ...puis un déclenchement de ce pas l'emporte via le max() interne à Impulse.fire
    }
    for (const entry of this.resolved.continuous.values()) {
      entry.primitive.update(this.timeline.featureAt(step.t, entry.featureId), step.dt);
    }

    const impulseValue = (signal: string): number => this.resolved.impulses.get(signal)?.primitive.value ?? 0;
    const continuousValue = (signal: string): number => this.resolved.continuous.get(signal)?.primitive.value ?? 0;
    const anticipationValue = (signal: string): number => {
      const entry = this.resolved.anticipations.get(signal);
      return entry ? entry.primitive.valueFrom(this.timeline, entry.eventType, step.t) : 0;
    };

    return Object.freeze({
      impact: impulseValue('impact'),
      subImpact: impulseValue('subImpact'),
      accent: impulseValue('accent'),
      tick: impulseValue('tick'),
      sectionShift: impulseValue('sectionShift'),
      drive: continuousValue('drive'),
      weight: continuousValue('weight'),
      brightness: continuousValue('brightness'),
      tension: anticipationValue('tension'),
      pulse: pulseFromPhase(step.beat.phase),
      barPulse: pulseFromPhase(step.bar.phase),
    });
  }

  /**
   * docs/02_ARCHITECTURE.md §Seek : « les enveloppes et amortissements
   * repartent à leur valeur d'équilibre pour ce t, pas à zéro ». `Impulse`
   * est ramenée à 0 (son équilibre naturel hors déclenchement — le
   * rattrapage par sous-pas qui suit ce `reset()` la refera sonner
   * correctement si un événement tombe dans la fenêtre de rattrapage).
   * `Continuous` saute directement à `featureAt(t, id)`, sa vraie valeur
   * d'équilibre, pour ne pas dépendre de la durée de la fenêtre de
   * rattrapage (voir Continuous.reset).
   */
  reset(t: number): void {
    for (const entry of this.resolved.impulses.values()) entry.primitive.reset();
    for (const entry of this.resolved.continuous.values()) {
      entry.primitive.reset(this.timeline.featureAt(t, entry.featureId));
    }
  }
}
