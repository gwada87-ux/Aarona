import { describe, expect, it } from 'vitest';
import { ScreenShake } from '../../src/visual/layers/postfx/ScreenShake';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

function lastShake(renderer: FakeRenderer) {
  const shakes = renderer.calls.filter((c): c is Extract<typeof c, { type: 'applyShake' }> => c.type === 'applyShake');
  return shakes.at(-1);
}

describe('ScreenShake — seuil de déclenchement', () => {
  it('aucun tremblement sous le seuil (impact <= 0,7)', () => {
    const shake = new ScreenShake();
    shake.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    shake.update(stepper.build(0), makeSignals({ impact: 0.7 }));

    const renderer = new FakeRenderer();
    shake.draw(renderer, testViewport);
    expect(lastShake(renderer)).toEqual({ type: 'applyShake', dx: 0, dy: 0 });
  });

  it('un impact > 0,7 déclenche un décalage non nul, borné à l\'amplitude max', () => {
    const shake = new ScreenShake();
    shake.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    shake.update(stepper.build(0), makeSignals({ impact: 1.0 })); // excès maximal

    const renderer = new FakeRenderer();
    shake.draw(renderer, testViewport);
    const call = lastShake(renderer)!;
    const magnitude = Math.hypot(call.dx, call.dy);
    expect(magnitude).toBeGreaterThan(0);
    expect(magnitude).toBeLessThanOrEqual(0.012 + 1e-9); // docs/07 : amplitude ≤ 0,012
  });
});

describe('ScreenShake — décroissance et direction', () => {
  it('décroît vers 0 après le choc (decay 0,15s), même direction tout du long', () => {
    const shake = new ScreenShake();
    shake.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();

    shake.update(stepper.build(0), makeSignals({ impact: 1.0 }));
    const r1 = new FakeRenderer();
    shake.draw(r1, testViewport);
    const first = lastShake(r1)!;
    const angle1 = Math.atan2(first.dy, first.dx);

    // avance sans nouveau choc : la magnitude doit décroître, l'angle rester stable
    let step = stepper.build(0);
    for (let t = 1 / 120; t <= 0.3; t += 1 / 120) {
      step = stepper.build(t);
      shake.update(step, makeSignals({ impact: 0 }));
    }
    const r2 = new FakeRenderer();
    shake.draw(r2, testViewport);
    const later = lastShake(r2)!;
    const angle2 = Math.atan2(later.dy, later.dx);

    expect(Math.hypot(later.dx, later.dy)).toBeLessThan(Math.hypot(first.dx, first.dy));
    expect(angle2).toBeCloseTo(angle1, 6); // même direction, pas un tremblement qui vibre au hasard
  });

  it('reset() interrompt le tremblement', () => {
    const shake = new ScreenShake();
    shake.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    shake.update(stepper.build(0), makeSignals({ impact: 1.0 }));
    shake.reset(1);

    const renderer = new FakeRenderer();
    shake.draw(renderer, testViewport);
    expect(lastShake(renderer)).toEqual({ type: 'applyShake', dx: 0, dy: 0 });
  });
});
