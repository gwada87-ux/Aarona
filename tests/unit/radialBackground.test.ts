/**
 * Tests de `visual/layers/background/RadialBackground.ts` — Étape 37. Couche
 * de fond du style Pulse : « dégradé radial sombre, teinte pilotée par
 * brightness » (docs/07) — seule des trois couches `background/` pilotée par
 * un signal comportemental plutôt que par le temps ou une constante.
 */
import { describe, expect, it } from 'vitest';
import { RadialBackground } from '../../src/visual/layers/background/RadialBackground';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { lerpColor } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

function gradientCalls(renderer: FakeRenderer) {
  return renderer.calls.filter((c): c is Extract<typeof c, { type: 'fillRadialGradient' }> => c.type === 'fillRadialGradient');
}

const [dark, darker] = defaultPalette.bg;

describe('RadialBackground — rayons fixes', () => {
  it('dessine exactement un fillRadialGradient, rayons [0, 1.0]', () => {
    const layer = new RadialBackground();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    layer.update(makeStepBuilder().build(0), makeSignals());

    const renderer = new FakeRenderer();
    layer.draw(renderer, testViewport);

    const calls = gradientCalls(renderer);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.innerRadius).toBe(0);
    expect(calls[0]!.outerRadius).toBe(1.0);
  });
});

describe('RadialBackground — teinte pilotée par brightness', () => {
  it('brightness=0 : couleur intérieure = bg[0] exactement (dark)', () => {
    const layer = new RadialBackground();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    layer.update(makeStepBuilder().build(0), makeSignals({ brightness: 0 }));

    const renderer = new FakeRenderer();
    layer.draw(renderer, testViewport);
    expect(gradientCalls(renderer)[0]!.inner).toEqual(dark);
  });

  it('brightness=1 : couleur intérieure = bg[1] exactement (darker)', () => {
    const layer = new RadialBackground();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    layer.update(makeStepBuilder().build(0), makeSignals({ brightness: 1 }));

    const renderer = new FakeRenderer();
    layer.draw(renderer, testViewport);
    expect(gradientCalls(renderer)[0]!.inner).toEqual(darker);
  });

  it('brightness=0.5 : couleur intérieure au point médian exact', () => {
    const layer = new RadialBackground();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    layer.update(makeStepBuilder().build(0), makeSignals({ brightness: 0.5 }));

    const renderer = new FakeRenderer();
    layer.draw(renderer, testViewport);
    expect(gradientCalls(renderer)[0]!.inner).toEqual(lerpColor(dark, darker, 0.5));
  });

  it('la couleur extérieure reste TOUJOURS bg[1] (darker), quel que soit brightness', () => {
    const layer = new RadialBackground();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    layer.update(makeStepBuilder().build(0), makeSignals({ brightness: 0 }));
    const rendererLow = new FakeRenderer();
    layer.draw(rendererLow, testViewport);

    layer.update(makeStepBuilder().build(0), makeSignals({ brightness: 1 }));
    const rendererHigh = new FakeRenderer();
    layer.draw(rendererHigh, testViewport);

    expect(gradientCalls(rendererLow)[0]!.outer).toEqual(darker);
    expect(gradientCalls(rendererHigh)[0]!.outer).toEqual(darker);
  });
});

describe('RadialBackground — reset()', () => {
  it("reset() ne lève pas ; l'état est reconstruit par le prochain update(), pas par reset()", () => {
    const layer = new RadialBackground();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    layer.update(makeStepBuilder().build(0), makeSignals({ brightness: 1 }));

    expect(() => layer.reset(0)).not.toThrow();

    // Sans update() après reset(), le brightness précédent (1) est toujours en mémoire.
    const renderer = new FakeRenderer();
    layer.draw(renderer, testViewport);
    expect(gradientCalls(renderer)[0]!.inner).toEqual(darker);
  });
});
