import { describe, expect, it } from 'vitest';
import { PulseRings } from '../../src/visual/layers/geometry/PulseRings';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

function strokeCircleCalls(renderer: FakeRenderer) {
  return renderer.calls.filter((c): c is Extract<typeof c, { type: 'strokeCircle' }> => c.type === 'strokeCircle');
}

describe('PulseRings — anneau central', () => {
  it('rayon = 0.28 + 0.10·impact, épaisseur croît avec weight', () => {
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();

    rings.update(stepper.build(0), makeSignals({ impact: 0.5, weight: 1 }));
    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);

    const [mainRing] = strokeCircleCalls(renderer);
    expect(mainRing?.radius).toBeCloseTo(0.28 + 0.1 * 0.5, 10);

    const rings0 = new PulseRings();
    rings0.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    rings0.update(stepper.build(0), makeSignals({ impact: 0.5, weight: 0 }));
    const renderer0 = new FakeRenderer();
    rings0.draw(renderer0, testViewport);
    const [mainRing0] = strokeCircleCalls(renderer0);
    expect(mainRing?.lineWidth).toBeGreaterThan(mainRing0!.lineWidth);
  });
});

describe('PulseRings — anneaux secondaires sur DOWNBEAT', () => {
  it('un DOWNBEAT ajoute un anneau qui grandit et s\'estompe sur 1,2s', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'DOWNBEAT', intensity: 1, confidence: 1 }]);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    rings.update(stepper.build(0.5), makeSignals());
    const justAfter = new FakeRenderer();
    rings.draw(justAfter, testViewport);
    expect(strokeCircleCalls(justAfter)).toHaveLength(2); // anneau principal + 1 secondaire

    // avance de 0.6s (dans les 1.2s de vie de l'anneau) — update() à CHAQUE
    // sous-pas : PulseRings accumule l'âge par step.dt (toujours 1/120),
    // jamais par l'écart réel entre deux `t`, comme StepContext partout ailleurs.
    for (let t = 0.5 + 1 / 120; t <= 1.1; t += 1 / 120) rings.update(stepper.build(t), makeSignals());
    const midLife = new FakeRenderer();
    rings.draw(midLife, testViewport);
    const secondary = strokeCircleCalls(midLife)[1];
    expect(secondary?.radius).toBeGreaterThan(0.28); // s'est étendu
    expect(secondary?.color.a).toBeLessThan(defaultPalette.secondary.a); // s'est estompé

    // avance au-delà de 1.2s : l'anneau doit avoir disparu
    for (let t = 1.1 + 1 / 120; t <= 1.9; t += 1 / 120) rings.update(stepper.build(t), makeSignals());
    const afterLifetime = new FakeRenderer();
    rings.draw(afterLifetime, testViewport);
    expect(strokeCircleCalls(afterLifetime)).toHaveLength(1); // seulement l'anneau principal
  });

  it('le pool ne déborde jamais (8 emplacements)', () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      t: i * 0.05,
      type: 'DOWNBEAT',
      intensity: 1,
      confidence: 1,
    }));
    const stepper = makeStepBuilder(events, 5);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    for (let t = 1 / 120; t <= 1.0; t += 1 / 120) rings.update(stepper.build(t), makeSignals());

    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    expect(strokeCircleCalls(renderer).length).toBeLessThanOrEqual(1 + 8); // principal + au plus 8 secondaires
  });

  it('reset() efface les anneaux actifs', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'DOWNBEAT', intensity: 1, confidence: 1 }]);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    rings.update(stepper.build(0.5), makeSignals());
    rings.reset(2);
    rings.update(stepper.build(2), makeSignals());

    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    expect(strokeCircleCalls(renderer)).toHaveLength(1); // uniquement l'anneau principal
  });
});

describe('PulseRings — params (Étape 20, macros densité/mouvement/chaos)', () => {
  it('params.maxActiveRings borne le nombre d\'anneaux actifs en dessous de 8', () => {
    const events = Array.from({ length: 20 }, (_, i) => ({ t: i * 0.05, type: 'DOWNBEAT', intensity: 1, confidence: 1 }));
    const stepper = makeStepBuilder(events, 5);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    rings.params = { maxActiveRings: 3 };

    for (let t = 1 / 120; t <= 1.0; t += 1 / 120) rings.update(stepper.build(t), makeSignals());

    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    expect(strokeCircleCalls(renderer).length).toBeLessThanOrEqual(1 + 3); // principal + au plus 3 secondaires
  });

  it('params.lifetimeSec plus court fait disparaître un anneau plus tôt', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'DOWNBEAT', intensity: 1, confidence: 1 }]);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    rings.params = { lifetimeSec: 0.3 };

    rings.update(stepper.build(0.5), makeSignals());
    for (let t = 0.5 + 1 / 120; t <= 0.9; t += 1 / 120) rings.update(stepper.build(t), makeSignals());

    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    // À 0,4s après le DOWNBEAT, un anneau de durée de vie 0,3s a déjà disparu (contrairement au défaut de 1,2s).
    expect(strokeCircleCalls(renderer)).toHaveLength(1);
  });

  it('params.chaosJitter=0 (défaut) → rayon exact BASE_RADIUS+progress·expansion, sans décalage', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'DOWNBEAT', intensity: 1, confidence: 1 }]);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    rings.update(stepper.build(0.5), makeSignals());

    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    const secondary = strokeCircleCalls(renderer)[1];
    expect(secondary?.radius).toBeCloseTo(0.28, 10); // progress ≈ 0 juste après spawn, jitter nul par défaut
  });
});
