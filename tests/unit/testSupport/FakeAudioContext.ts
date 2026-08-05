/**
 * Double de test minimal pour `AudioContext`/`AudioBufferSourceNode` — Étape 27.
 * Aucun test `AudioEngine` n'existait avant cette étape (nécessite un `AudioContext`
 * réel, absent de Node ; `AudioEngine` accepte un `context` injecté via
 * `AudioEngineOptions`, ce qui rend ce double possible sans navigateur).
 *
 * `FakeAudioBufferSourceNode.start()` reproduit fidèlement le comportement natif
 * observé au navigateur (Étape 24) : `RangeError` si l'offset est négatif — c'est
 * exactement ce piège que le test de régression de l'Étape 27 vérifie.
 *
 * Étendu à l'Étape 33 (`createAnalyser`/`FakeAnalyserNode`) pour `RealtimeProbe.ts`,
 * même principe : un double MINIMAL de la seule surface réellement utilisée, pas
 * une réimplémentation de Web Audio.
 */
export class FakeAudioBufferSourceNode {
  buffer: unknown = null;
  loop = false;
  startedWhen: number | null = null;
  startedOffset: number | null = null;
  stopped = false;

  connect(_dest: unknown): void {}
  disconnect(): void {}

  start(when: number, offset: number): void {
    if (offset < 0) {
      throw new RangeError(
        `Failed to execute 'start' on 'AudioBufferSourceNode': The offset provided (${offset}) is less than the minimum bound (0).`,
      );
    }
    this.startedWhen = when;
    this.startedOffset = offset;
  }

  stop(): void {
    this.stopped = true;
  }
}

export class FakeGainNode {
  readonly gain = { value: 1 };
  connect(_dest: unknown): void {}
  disconnect(): void {}
}

/**
 * `frequencyBinCount` DÉRIVÉ de `fftSize` (comme le vrai `AnalyserNode`, jamais un champ
 * indépendant) : `RealtimeProbe` lit `frequencyBinCount` juste après avoir écrit `fftSize`
 * dans son constructeur — un champ figé à la construction du double masquerait ce lien.
 * `getByteTimeDomainData` renvoie par défaut le silence (128 partout, valeur de repos réelle
 * de l'API) — `timeDomainPattern` overridable par test pour simuler un signal.
 */
export class FakeAnalyserNode {
  fftSize = 2048;
  smoothingTimeConstant = 0;
  timeDomainPattern: (index: number, length: number) => number = () => 128;

  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }

  connect(_dest: unknown): void {}
  disconnect(): void {}

  getByteTimeDomainData(array: Uint8Array): void {
    for (let i = 0; i < array.length; i++) array[i] = this.timeDomainPattern(i, array.length);
  }
}

export class FakeAudioContext {
  currentTime = 0;
  state: 'suspended' | 'running' = 'suspended';
  outputLatency = 0;
  baseLatency = 0;
  readonly destination = {};
  /** Durée renvoyée par `decodeAudioData()` — ajustable par test. */
  nextDecodedDuration = 10;

  createBufferSource(): FakeAudioBufferSourceNode {
    return new FakeAudioBufferSourceNode();
  }

  createGain(): FakeGainNode {
    return new FakeGainNode();
  }

  createAnalyser(): FakeAnalyserNode {
    return new FakeAnalyserNode();
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async decodeAudioData(_data: ArrayBuffer): Promise<{ duration: number }> {
    return { duration: this.nextDecodedDuration };
  }
}
