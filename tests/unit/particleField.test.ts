import { describe, expect, it } from 'vitest';
import { ParticleField } from '../../src/visual/layers/particles/ParticleField';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

function lastDrawSprite(renderer: FakeRenderer) {
  const calls = renderer.calls.filter((c): c is Extract<typeof c, { type: 'drawSprite' }> => c.type === 'drawSprite');
  return calls.at(-1);
}

describe('ParticleField — repos', () => {
  it('aucune particule avant tout événement', () => {
    const field = new ParticleField();
    field.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    field.update(stepper.build(0), makeSignals());

    const renderer = new FakeRenderer();
    field.draw(renderer, testViewport);
    expect(lastDrawSprite(renderer)).toBeUndefined();
  });
});

describe('ParticleField — spawn par type d\'événement', () => {
  it('KICK fait apparaître 120 particules', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'KICK', intensity: 0.8, confidence: 0.9 }]);
    const field = new ParticleField();
    field.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    field.update(stepper.build(0.5), makeSignals());

    const renderer = new FakeRenderer();
    field.draw(renderer, testViewport);
    expect(lastDrawSprite(renderer)?.count).toBe(120);
  });

  it('HAT fait apparaître 20 particules fines et courtes', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'HAT', intensity: 0.5, confidence: 0.8 }]);
    const field = new ParticleField();
    field.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    field.update(stepper.build(0.5), makeSignals());

    const renderer = new FakeRenderer();
    field.draw(renderer, testViewport);
    expect(lastDrawSprite(renderer)?.count).toBe(20);
  });

  it('SNARE fait apparaître une onde annulaire de 60 particules', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'SNARE', intensity: 0.7, confidence: 0.85 }]);
    const field = new ParticleField();
    field.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    field.update(stepper.build(0.5), makeSignals());

    const renderer = new FakeRenderer();
    field.draw(renderer, testViewport);
    expect(lastDrawSprite(renderer)?.count).toBe(60);
  });

  it('DROP déclenche une explosion de 400 particules', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'DROP', intensity: 1, confidence: 0.7 }]);
    const field = new ParticleField();
    field.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    field.update(stepper.build(0.5), makeSignals());

    const renderer = new FakeRenderer();
    field.draw(renderer, testViewport);
    expect(lastDrawSprite(renderer)?.count).toBe(400);
  });
});

describe('ParticleField — cycle de vie', () => {
  it('les particules meurent après leur durée de vie (≤ 1,1s ici)', () => {
    const stepper = makeStepBuilder([{ t: 0, type: 'HAT', intensity: 0.5, confidence: 0.8 }]);
    const field = new ParticleField();
    field.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    for (let t = 1 / 120; t <= 1.2; t += 1 / 120) field.update(stepper.build(t), makeSignals());

    const renderer = new FakeRenderer();
    field.draw(renderer, testViewport);
    expect(lastDrawSprite(renderer)).toBeUndefined(); // toutes mortes (durée de vie HAT < 0.4s)
  });

  it('le pool ne déborde jamais (2500 emplacements)', () => {
    const events = Array.from({ length: 40 }, (_, i) => ({
      t: i * 0.02,
      type: 'DROP',
      intensity: 1,
      confidence: 0.7,
    })); // 40 × 400 = 16 000 tentatives de spawn, bien au-delà du pool
    const stepper = makeStepBuilder(events, 3);
    const field = new ParticleField();
    field.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    for (let t = 1 / 120; t <= 1.0; t += 1 / 120) field.update(stepper.build(t), makeSignals());

    const renderer = new FakeRenderer();
    field.draw(renderer, testViewport);
    expect(lastDrawSprite(renderer)!.count).toBeLessThanOrEqual(2500);
  });
});

describe('ParticleField — reset', () => {
  it('reset() efface toutes les particules vivantes', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'KICK', intensity: 0.8, confidence: 0.9 }]);
    const field = new ParticleField();
    field.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    field.update(stepper.build(0.5), makeSignals());
    field.reset(2);
    field.update(stepper.build(2), makeSignals());

    const renderer = new FakeRenderer();
    field.draw(renderer, testViewport);
    expect(lastDrawSprite(renderer)).toBeUndefined();
  });
});
