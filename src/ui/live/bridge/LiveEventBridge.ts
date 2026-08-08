/**
 * Pont d'événements — mode direct, moteur fichier (chantier « panneau
 * Style/Preset/Palette/Texte/Macros réellement fonctionnel en direct »).
 *
 * Traduit les signaux temps réel déjà calculés par `LiveAnalysisEngine` en
 * `MusicEvent[]`, le même type que `StepContext.fired` en mode fichier —
 * c'est ce qui permet à `BehaviourEngine`/aux couches (`ParticleField`,
 * `PulseRings`, ...) de consommer un flux en direct sans aucune modification.
 *
 * APPROXIMATION ASSUMÉE (voir le plan, section « hors périmètre ») :
 * DROP/BUILDUP/BREAK ne sont pas une reproduction de `analysis/macro.ts`
 * (qui lit des pistes précalculées sur tout le fichier) — construits à partir
 * de ce que `SectionEnergy` calcule déjà en direct (`arc`, `dropFired`).
 * Suffisant pour que les styles/presets réagissent de façon crédible, pas
 * garanti identique image pour image au mode fichier.
 */

import type { LiveAnalysisEngine } from '../audio/LiveAnalysisEngine';
import type { MusicEvent, EventType } from '../../../music/pmdi';

/** Bornée : une session direct peut durer des heures, un historique non borné fuirait. */
const HISTORY_LIMIT = 500;

export class LiveEventBridge {
  private lastBarIndex = -1;
  private lastArc: string | null = null;
  private wasIdle = false;
  private readonly history: MusicEvent[] = [];

  /** À appeler une fois par frame, avant de construire le `StepContext`. Retourne les événements de CETTE frame. */
  collect(engine: LiveAnalysisEngine): readonly MusicEvent[] {
    const fired: MusicEvent[] = [];
    const t = engine.tSec;

    const push = (type: EventType, intensity: number, confidence: number): void => {
      const e: MusicEvent = { t, type, intensity, confidence };
      fired.push(e);
      this.history.push(e);
    };

    if (engine.firedThisFrame('kick')) push('KICK', engine.onsetSet.strength('kick'), engine.tempo.confidence);
    if (engine.firedThisFrame('snare')) push('SNARE', engine.onsetSet.strength('snare'), engine.tempo.confidence);
    if (engine.firedThisFrame('hat')) push('HAT', engine.onsetSet.strength('hat'), engine.tempo.confidence);

    // Front sur `barIndex` : une nouvelle mesure a commencé. Le tout premier
    // relevé (`lastBarIndex === -1`) ne compte pas comme un DOWNBEAT — sinon
    // chaque connexion démarrerait par un flash artificiel, comme la première
    // frontière ignorée par `derivedSectionEvents` en mode fichier.
    const barIndex = engine.beat.barIndex;
    if (barIndex !== this.lastBarIndex) {
      if (this.lastBarIndex !== -1) push('DOWNBEAT', 1, engine.tempo.confidence);
      this.lastBarIndex = barIndex;
    }

    if (engine.section.dropFired) push('DROP', 1, 1);

    const arc = engine.section.arc;
    if (arc !== this.lastArc) {
      if (arc === 'build') push('BUILDUP', 1, 0.8);
      else if (arc === 'breakdown') push('BREAK', 1, 0.8);
      this.lastArc = arc;
    }

    const idle = engine.state === 'IDLE';
    if (idle && !this.wasIdle) push('SILENCE', 1, 1);
    this.wasIdle = idle;

    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);

    return fired;
  }

  /**
   * Dernier événement de ce type déjà survenu à `t` ou avant — utilisé par
   * `VisualDirector`/couches via `MusicTimeline.prevEventOfType`. Il n'existe
   * PAS d'équivalent `nextEventOfType` : en direct, l'avenir n'est pas connu
   * (voir `LiveMusicTimeline.nextEventOfType`, toujours `null`).
   */
  prevEventOfType(type: EventType, t: number): MusicEvent | null {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const e = this.history[i]!;
      if (e.type === type && e.t <= t) return e;
    }
    return null;
  }

  eventsBetween(t0: number, t1: number): readonly MusicEvent[] {
    return this.history.filter((e) => e.t > t0 && e.t <= t1);
  }

  eventsOfTypeBetween(type: EventType, t0: number, t1: number): readonly MusicEvent[] {
    return this.history.filter((e) => e.type === type && e.t > t0 && e.t <= t1);
  }

  reset(): void {
    this.lastBarIndex = -1;
    this.lastArc = null;
    this.wasIdle = false;
    this.history.length = 0;
  }
}
