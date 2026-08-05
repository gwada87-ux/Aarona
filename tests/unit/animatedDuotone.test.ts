/**
 * Tests de `visual/layers/background/AnimatedDuotone.ts` — Étape 37. Fond du
 * style Spectrum Pro : « dégradé bicolore, très légèrement animé » (docs/07)
 * — seule des trois couches `background/` pilotée par `step.t` (Loi 1 :
 * fonction pure du temps simulé, jamais de l'horloge réelle).
 *
 * `ANIMATION_SPEED = 0.06` (rad/s) n'est pas exportée : reprise en dur ici,
 * comme les valeurs `at0`/`at1` de `LAYER_MACRO_CURVES` à l'Étape 34.
 */
import { describe, expect, it } from 'vitest';
import { AnimatedDuotone } from '../../src/visual/layers/background/AnimatedDuotone';
import { defaultPalette, lerpColor } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

const ANIMATION_SPEED = 0.06;
const [bg0, bg1] = defaultPalette.bg;

function gradientCalls(renderer: FakeRenderer) {
  return renderer.calls.filter((c): c is Extract<typeof c, { type: 'fillRadialGradient' }> => c.type === 'fillRadialGradient');
}

function drawAt(t: number): FakeRenderer {
  const layer = new AnimatedDuotone();
  layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
  layer.update(makeStepBuilder().build(t), makeSignals());
  const renderer = new FakeRenderer();
  layer.draw(renderer, testViewport);
  return renderer;
}

describe('AnimatedDuotone — rayons et bord fixes', () => {
  it('dessine exactement un fillRadialGradient, rayons [0, 1.1], bord = bg[1]', () => {
    const renderer = drawAt(0);
    const calls = gradientCalls(renderer);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.innerRadius).toBe(0);
    expect(calls[0]!.outerRadius).toBe(1.1);
    expect(calls[0]!.outer).toEqual(bg1);
  });
});

describe('AnimatedDuotone — animation pilotée par step.t (Loi 1)', () => {
  it('t=0 : sin(0)=0 -> drift=0.5 -> facteur 0.4', () => {
    const renderer = drawAt(0);
    expect(gradientCalls(renderer)[0]!.inner).toEqual(lerpColor(bg0, bg1, 0.4));
  });

  it('t où sin(t*vitesse)=1 (pic) -> drift=1 -> facteur 0.5 (maximum)', () => {
    const t = Math.PI / 2 / ANIMATION_SPEED;
    const renderer = drawAt(t);
    expect(gradientCalls(renderer)[0]!.inner).toEqual(lerpColor(bg0, bg1, 0.5));
  });

  it('t où sin(t*vitesse)=-1 (creux) -> drift=0 -> facteur 0.3 (minimum)', () => {
    const t = (3 * Math.PI) / 2 / ANIMATION_SPEED;
    const renderer = drawAt(t);
    expect(gradientCalls(renderer)[0]!.inner).toEqual(lerpColor(bg0, bg1, 0.3));
  });

  it('périodique : t et t + période (2π/vitesse) donnent EXACTEMENT le même résultat', () => {
    const period = (2 * Math.PI) / ANIMATION_SPEED;
    const a = gradientCalls(drawAt(17))[0]!.inner;
    const b = gradientCalls(drawAt(17 + period))[0]!.inner;
    expect(b).toEqual(a);
  });

  it('deux update() successifs à des t différents changent bien la couleur dessinée (pas figée après init)', () => {
    const layer = new AnimatedDuotone();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    layer.update(makeStepBuilder().build(0), makeSignals());
    const rendererA = new FakeRenderer();
    layer.draw(rendererA, testViewport);

    const tPeak = Math.PI / 2 / ANIMATION_SPEED;
    layer.update(makeStepBuilder().build(tPeak), makeSignals());
    const rendererB = new FakeRenderer();
    layer.draw(rendererB, testViewport);

    expect(gradientCalls(rendererB)[0]!.inner).not.toEqual(gradientCalls(rendererA)[0]!.inner);
  });
});

describe('AnimatedDuotone — reset()/dispose()', () => {
  it('ne lèvent pas', () => {
    const layer = new AnimatedDuotone();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    expect(() => layer.reset(0)).not.toThrow();
    expect(() => layer.dispose()).not.toThrow();
  });
});
