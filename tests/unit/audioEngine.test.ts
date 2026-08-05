import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { FakeAudioContext } from './testSupport/FakeAudioContext';

async function loadedEngine(ctx: FakeAudioContext): Promise<AudioEngine> {
  const engine = new AudioEngine({ context: ctx as unknown as AudioContext });
  await engine.load(new File([], 'test.wav'));
  ctx.state = 'running'; // déjà résumé — évite le chemin async resume() dans play()
  return engine;
}

describe('AudioEngine — cycles play/pause rapprochés (Étape 27)', () => {
  it('play() puis pause() immédiate (0 temps réel écoulé) avec outputLatency non nul : currentRawT() devient négatif', async () => {
    const ctx = new FakeAudioContext();
    ctx.outputLatency = 0.05;
    const engine = await loadedEngine(ctx);

    engine.play();
    engine.pause(); // ne doit jamais lever, même si offsetSeek interne devient négatif

    expect(() => engine.play()).not.toThrow();
  });

  it('cycles play/pause répétés sans avancer ctx.currentTime : jamais de RangeError', async () => {
    const ctx = new FakeAudioContext();
    ctx.outputLatency = 0.0267; // reproduit la valeur exacte observée au navigateur (Étape 24)
    const engine = await loadedEngine(ctx);

    for (let i = 0; i < 10; i++) {
      expect(() => engine.play()).not.toThrow();
      expect(() => engine.pause()).not.toThrow();
    }
  });

  it("seek() négatif (avant t=0) reste clampé à 0 — comportement de référence déjà correct, non régressé", async () => {
    const ctx = new FakeAudioContext();
    const engine = await loadedEngine(ctx);

    engine.seek(-5);
    expect(engine.t).toBe(0);
  });

  it('lecture normale (temps réel avancé entre play et pause) : aucun changement de comportement', async () => {
    const ctx = new FakeAudioContext();
    const engine = await loadedEngine(ctx);

    engine.play();
    ctx.currentTime = 2; // 2s de lecture réelle
    engine.pause();

    expect(engine.t).toBeCloseTo(0, 5); // t n'est mis à jour que par tick(), pas par pause()
  });
});

describe('AudioEngine — load() concurrents (piège #11, régression Étape 48)', () => {
  it("un load() LENT qui résout APRÈS un load() plus rapide, avec un signal déjà annulé à ce moment-là, n'écrase PAS this.decoded", async () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx as unknown as AudioContext });

    // Ordonnancement piloté par ORDRE D'APPEL de decodeAudioData (pas par réassignation
    // synchrone) : robuste face au minimum d'un tick de microtâche que `file.arrayBuffer()`
    // insère avant que decodeAudioFile() n'atteigne effectivement decodeAudioData(). Le PREMIER
    // appel (celui de A, démarré en premier) est tenu manuellement ; le second (B) résout tout de
    // suite — reproduit fidèlement « A lent, démarré avant B, qui résout après B ».
    let resolveFirstCall!: (v: { duration: number }) => void;
    const firstCallPromise = new Promise<{ duration: number }>((resolve) => {
      resolveFirstCall = resolve;
    });
    let decodeCallCount = 0;
    ctx.decodeAudioData = async () => {
      decodeCallCount++;
      return decodeCallCount === 1 ? firstCallPromise : { duration: 42 };
    };

    const controllerA = new AbortController();
    const loadA = engine.load(new File([], 'A.wav'), controllerA.signal);

    // B "gagne" pendant que A est encore en vol : A est annulé côté appelant, B décode normalement (rapide).
    controllerA.abort();
    const controllerB = new AbortController();
    await engine.load(new File([], 'B.wav'), controllerB.signal);

    expect(decodeCallCount).toBe(2); // les deux decodeAudioData() ont bien eu lieu, dans cet ordre
    expect(engine.decodedBuffer?.duration).toBe(42); // B a bien pris

    // A finit ENFIN de "décoder" (résolution tardive), mais son signal est déjà annulé à ce moment précis.
    resolveFirstCall({ duration: 100 });
    await loadA;

    expect(engine.decodedBuffer?.duration).toBe(42); // toujours B : le résultat périmé de A n'écrase rien
  });

  it('load() sans signal (appelant qui ne gère pas l\'annulation) : comportement inchangé, jamais bloquant', async () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx as unknown as AudioContext });
    ctx.nextDecodedDuration = 7;

    await engine.load(new File([], 'test.wav'));

    expect(engine.decodedBuffer?.duration).toBe(7);
  });
});
