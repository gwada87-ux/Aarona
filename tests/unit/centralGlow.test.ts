import { describe, expect, it } from 'vitest';
import { CentralGlow } from '../../src/visual/layers/glow/CentralGlow';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

function drawSpriteCalls(renderer: FakeRenderer) {
  return renderer.calls.filter((c): c is Extract<typeof c, { type: 'drawSprite' }> => c.type === 'drawSprite');
}

describe('CentralGlow — repos', () => {
  it('drive=0 → aucun sprite dessiné (les deux alphas sont sous le seuil)', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)).toHaveLength(0);
  });
});

describe('CentralGlow — fondu froid/chaud', () => {
  it('brightness=0, drive=1 → un seul sprite (froid), alpha ≈ 1', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 1, brightness: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    const calls = drawSpriteCalls(renderer);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.transforms[0]!.alpha).toBeCloseTo(1, 5);
  });

  it('brightness=1, drive=1 → un seul sprite (chaud), alpha ≈ 1', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 1, brightness: 1 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)).toHaveLength(1);
  });
});

describe('CentralGlow — params (Étape 20, macro glow)', () => {
  it('params.intensityMul réduit l\'alpha du sprite dessiné', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    glow.params = { intensityMul: 0.5 };
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 1, brightness: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)[0]!.transforms[0]!.alpha).toBeCloseTo(0.5, 5);
  });

  it('params absent → comportement inchangé (alpha = drive, sans multiplicateur)', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 0.6, brightness: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)[0]!.transforms[0]!.alpha).toBeCloseTo(0.6, 5);
  });

  it('params.diameter change le scale du sprite dessiné', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    glow.params = { diameter: 0.7 };
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 1, brightness: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)[0]!.transforms[0]!.scale).toBeCloseTo(0.7, 5);
  });

  it('l\'alpha reste borné à 1 même avec un intensityMul élevé', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    glow.params = { intensityMul: 1.8 };
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 1, brightness: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)[0]!.transforms[0]!.alpha).toBe(1);
  });
});
