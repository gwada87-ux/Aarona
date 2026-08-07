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
/**
 * Part de la dérive cédée au LFO au chantier 2. Le contrat a changé : la
 * dérive n'est plus pilotée par `step.t` SEUL, elle est à moitié verrouillée
 * au tempo. Les tests d'extrêmes ci-dessous fixent donc explicitement `lfoA`
 * pour isoler chaque composante.
 */
const LFO_SHARE = 0.5;
const [bg0, bg1] = defaultPalette.bg;

function gradientCalls(renderer: FakeRenderer) {
  return renderer.calls.filter((c): c is Extract<typeof c, { type: 'fillRadialGradient' }> => c.type === 'fillRadialGradient');
}

/** Facteur d'interpolation attendu pour une valeur libre et une valeur de LFO. */
function expectedMix(free: number, lfo: number): number {
  return 0.3 + 0.2 * (free * (1 - LFO_SHARE) + lfo * LFO_SHARE);
}

function drawAt(t: number, signals = makeSignals()): FakeRenderer {
  const layer = new AnimatedDuotone();
  layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
  layer.update(makeStepBuilder().build(t), signals);
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
  it('t=0 : sin(0)=0 -> composante libre 0.5', () => {
    const renderer = drawAt(0);
    expect(gradientCalls(renderer)[0]!.inner).toEqual(lerpColor(bg0, bg1, expectedMix(0.5, 0.5)));
  });

  it('t où sin(t*vitesse)=1 (pic) -> composante libre au maximum', () => {
    const t = Math.PI / 2 / ANIMATION_SPEED;
    const renderer = drawAt(t);
    expect(gradientCalls(renderer)[0]!.inner).toEqual(lerpColor(bg0, bg1, expectedMix(1, 0.5)));
  });

  it('t où sin(t*vitesse)=-1 (creux) -> composante libre au minimum', () => {
    const t = (3 * Math.PI) / 2 / ANIMATION_SPEED;
    const renderer = drawAt(t);
    expect(gradientCalls(renderer)[0]!.inner).toEqual(lerpColor(bg0, bg1, expectedMix(0, 0.5)));
  });

  /**
   * Chantier 2 : le LFO doit vraiment atteindre l'image. Sans ce test, le
   * blocage corrigé par ce chantier — un signal calculé puis jeté — pourrait
   * revenir sans que rien ne le signale.
   */
  it('lfoA à 0 et à 1 donnent deux images DIFFÉRENTES, à t identique', () => {
    const bas = gradientCalls(drawAt(0, makeSignals({ lfoA: 0 })))[0]!;
    const haut = gradientCalls(drawAt(0, makeSignals({ lfoA: 1 })))[0]!;
    expect(bas.inner).toEqual(lerpColor(bg0, bg1, expectedMix(0.5, 0)));
    expect(haut.inner).toEqual(lerpColor(bg0, bg1, expectedMix(0.5, 1)));
    expect(haut.inner).not.toEqual(bas.inner);
  });

  it('subImpact ouvre le rayon, sectionShift teinte le centre', () => {
    const repos = gradientCalls(drawAt(0))[0]!;
    const sub = gradientCalls(drawAt(0, makeSignals({ subImpact: 1 })))[0]!;
    const section = gradientCalls(drawAt(0, makeSignals({ sectionShift: 1 })))[0]!;
    expect(sub.outerRadius).toBeGreaterThan(repos.outerRadius);
    expect(section.inner).not.toEqual(repos.inner);
    // Le bord reste la couleur de fond : seul le CENTRE est teinté.
    expect(section.outer).toEqual(bg1);
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
