/**
 * Horloge unique du système (docs/02_ARCHITECTURE.md §1). Seul objet
 * autorisé à dériver son `t` d'une horloge réelle — le reste du moteur ne
 * connaît que la valeur qu'on lui passe.
 */
export interface Transport {
  readonly t: number;
  readonly dt: number;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  seek(t: number): void;
}
