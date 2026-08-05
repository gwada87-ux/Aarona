/**
 * Tests de `visual/layers/background/DeepVignette.ts` — Étape 37. Couche de
 * fond du style Field, jamais testée jusqu'ici (repérée par le 3e audit de
 * couverture, avec les 6 autres fichiers listés dans JOURNAL.md).
 *
 * La couche la plus simple des trois `background/` : ni palette, ni signal,
 * ni état — un seul dégradé radial constant, couleurs codées en dur dans le
 * fichier source (`CENTER`/`EDGE`, non exportées, reprises ici en dur).
 */
import { describe, expect, it } from 'vitest';
import { DeepVignette } from '../../src/visual/layers/background/DeepVignette';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

function gradientCalls(renderer: FakeRenderer) {
  return renderer.calls.filter((c): c is Extract<typeof c, { type: 'fillRadialGradient' }> => c.type === 'fillRadialGradient');
}

describe('DeepVignette — dégradé constant', () => {
  it('dessine exactement un fillRadialGradient, rayons [0, 1.1]', () => {
    const layer = new DeepVignette();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    const renderer = new FakeRenderer();
    layer.draw(renderer, testViewport);

    const calls = gradientCalls(renderer);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.innerRadius).toBe(0);
    expect(calls[0]!.outerRadius).toBe(1.1);
  });

  it('couleurs fixes : centre { r:8, g:8, b:10, a:1 }, bord noir { r:0, g:0, b:0, a:1 }', () => {
    const layer = new DeepVignette();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    const renderer = new FakeRenderer();
    layer.draw(renderer, testViewport);

    expect(gradientCalls(renderer)[0]!.inner).toEqual({ r: 8, g: 8, b: 10, a: 1 });
    expect(gradientCalls(renderer)[0]!.outer).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('indépendant du temps et des signaux (pas signal-driven, contrairement au fond de Pulse)', () => {
    const layer = new DeepVignette();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();

    layer.update(stepper.build(5), makeSignals({ brightness: 1, drive: 1 }));
    const rendererA = new FakeRenderer();
    layer.draw(rendererA, testViewport);

    layer.update(stepper.build(0), makeSignals({ brightness: 0, drive: 0 }));
    const rendererB = new FakeRenderer();
    layer.draw(rendererB, testViewport);

    expect(gradientCalls(rendererA)[0]).toEqual(gradientCalls(rendererB)[0]);
  });

  it("reset()/dispose() ne lèvent pas", () => {
    const layer = new DeepVignette();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    expect(() => layer.reset(3)).not.toThrow();
    expect(() => layer.dispose()).not.toThrow();
  });
});
