import { describe, expect, it } from 'vitest';
import { PerspectiveGrid } from '../../src/visual/layers/field/PerspectiveGrid';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

function radiiOf(renderer: FakeRenderer): number[] {
  return renderer.calls
    .filter((c): c is Extract<typeof c, { type: 'strokeCircle' }> => c.type === 'strokeCircle')
    .map((c) => c.radius);
}

describe('PerspectiveGrid — forme générale', () => {
  it('dessine 24 anneaux, tous à un rayon dans (0, 0.75]', () => {
    const grid = new PerspectiveGrid();
    grid.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    grid.update(stepper.build(0.3), makeSignals());

    const renderer = new FakeRenderer();
    grid.draw(renderer, testViewport);
    const radii = radiiOf(renderer);
    expect(radii).toHaveLength(24);
    for (const r of radii) {
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(0.75);
    }
  });

  it('est déterministe : deux draw() consécutifs sans update() produisent les mêmes rayons', () => {
    const grid = new PerspectiveGrid();
    grid.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    grid.update(stepper.build(0.3), makeSignals());

    const r1 = new FakeRenderer();
    grid.draw(r1, testViewport);
    const r2 = new FakeRenderer();
    grid.draw(r2, testViewport);
    expect(radiiOf(r2)).toEqual(radiiOf(r1));
  });
});

describe('PerspectiveGrid — avancée continue', () => {
  it('avance avec le temps (les rayons changent), indépendamment de signals.pulse', () => {
    const grid = new PerspectiveGrid();
    grid.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();

    grid.update(stepper.build(0), makeSignals({ pulse: 0.1 }));
    const early = new FakeRenderer();
    grid.draw(early, testViewport);

    grid.update(stepper.build(0.25), makeSignals({ pulse: 0.9 })); // même step, pulse différent
    const later = new FakeRenderer();
    grid.draw(later, testViewport);

    expect(radiiOf(later)).not.toEqual(radiiOf(early));
  });

  it('même scrollDistance (beat.index+phase identique) → mêmes rayons, quel que soit signals.pulse', () => {
    // à 120 BPM, une mesure (4 temps) dure 2s : t=0 et t=2 ont le même beat.phase (0)
    // mais des beat.index différents (0 vs 4) — utilisons plutôt deux pulse différents au MÊME t.
    const grid = new PerspectiveGrid();
    grid.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    const step = stepper.build(0.3);

    grid.update(step, makeSignals({ pulse: 0 }));
    const a = new FakeRenderer();
    grid.draw(a, testViewport);

    grid.update(step, makeSignals({ pulse: 1 }));
    const b = new FakeRenderer();
    grid.draw(b, testViewport);

    expect(radiiOf(b)).toEqual(radiiOf(a));
  });
});

describe('PerspectiveGrid — params (Étape 20, macro densité/profondeur)', () => {
  it('params.rows change le nombre d\'anneaux dessinés', () => {
    const grid = new PerspectiveGrid();
    grid.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    grid.params = { rows: 12 };
    const stepper = makeStepBuilder();
    grid.update(stepper.build(0.3), makeSignals());

    const renderer = new FakeRenderer();
    grid.draw(renderer, testViewport);
    expect(radiiOf(renderer)).toHaveLength(12);
  });

  it('params absent → comportement inchangé (24 anneaux, comme sans params)', () => {
    const grid = new PerspectiveGrid();
    grid.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    grid.update(stepper.build(0.3), makeSignals());

    const renderer = new FakeRenderer();
    grid.draw(renderer, testViewport);
    expect(radiiOf(renderer)).toHaveLength(24);
  });

  it('params.perspective plus bas → falloff plus marqué (rayons plus resserrés vers le centre)', () => {
    const stepper = makeStepBuilder();
    const step = stepper.build(0.3);

    const flat = new PerspectiveGrid();
    flat.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    flat.params = { perspective: 1.2 };
    flat.update(step, makeSignals());
    const flatRenderer = new FakeRenderer();
    flat.draw(flatRenderer, testViewport);

    const deep = new PerspectiveGrid();
    deep.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    deep.params = { perspective: 0.35 };
    deep.update(step, makeSignals());
    const deepRenderer = new FakeRenderer();
    deep.draw(deepRenderer, testViewport);

    // Même nombre d'anneaux, mais la moyenne des rayons est plus petite avec une perspective plus marquée
    // (rayon = maxRayon·perspective/(perspective+profondeur), decroît avec perspective).
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    expect(avg(radiiOf(deepRenderer))).toBeLessThan(avg(radiiOf(flatRenderer)));
  });
});
