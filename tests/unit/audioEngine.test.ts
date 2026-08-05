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
