/**
 * Envelope — attaque + maintien + relâchement, avec durée
 * (docs/07_VISUAL_ENGINE.md, famille "Envelope" : alimentée par des
 * événements à durée comme BUILDUP/BREAK, docs/06_EVENT_SYSTEM.md).
 *
 * docs/07 ne donne pas de code de référence pour cette classe (contrairement
 * à Impulse et Continuous) : forme ADSR simplifiée (attaque/maintien/
 * relâchement linéaires), la plus simple qui satisfasse la description en
 * une ligne. Aucune entrée de la table de câblage par défaut ne l'utilise
 * encore (voir BehaviourEngine.ts, LIMITES CONNUES) — livrée et testée en
 * primitive autonome, conformément au périmètre de l'Étape 8/P6
 * (docs/16_STRUCTURE_ET_RISQUES.md).
 *
 * Limite connue : un seul `update(dt)` ne traverse jamais plus d'une
 * transition de phase — un `dt` qui dépasse la phase courante clampe à sa
 * frontière (v=1 en fin d'attaque/hold, v=0 en fin de release) et le
 * surplus n'est PAS reporté sur la phase suivante dans le même appel ; il
 * ne sera consommé qu'au prochain `update()`. Sans conséquence en usage
 * réel : `BehaviourEngine` appelle toujours `update(FIXED_DT)` avec
 * `FIXED_DT = 1/120 s`, largement sous la durée de toute attaque/maintien/
 * relâchement réaliste (secondes).
 */
export class Envelope {
  private v = 0;
  private phase: 'idle' | 'attack' | 'hold' | 'release' = 'idle';
  private elapsed = 0;
  private holdDur = 0;

  constructor(
    private readonly attack: number,
    private readonly release: number,
  ) {}

  /** `dur` : durée de l'événement porteur (ex. `MusicEvent.dur` d'un BUILDUP/BREAK). */
  fire(dur: number): void {
    this.phase = 'attack';
    this.elapsed = 0;
    this.holdDur = Math.max(0, dur - this.attack);
  }

  update(dt: number): void {
    if (this.phase === 'idle') return;
    this.elapsed += dt;

    if (this.phase === 'attack') {
      this.v = this.attack > 0 ? Math.min(1, this.elapsed / this.attack) : 1;
      if (this.elapsed >= this.attack) {
        this.phase = 'hold';
        this.elapsed = 0;
      }
      return;
    }
    if (this.phase === 'hold') {
      this.v = 1;
      if (this.elapsed >= this.holdDur) {
        this.phase = 'release';
        this.elapsed = 0;
      }
      return;
    }
    // release
    this.v = this.release > 0 ? Math.max(0, 1 - this.elapsed / this.release) : 0;
    if (this.elapsed >= this.release) {
      this.phase = 'idle';
      this.v = 0;
    }
  }

  get value(): number {
    return this.v;
  }

  reset(): void {
    this.v = 0;
    this.phase = 'idle';
    this.elapsed = 0;
    this.holdDur = 0;
  }
}
