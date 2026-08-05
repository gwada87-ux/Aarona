import { describe, expect, it } from 'vitest';
import { Impulse } from '../../src/behaviour/signals/Impulse';

describe('Impulse', () => {
  it('fire() prend le max, ne cumule jamais (+=)', () => {
    const impulse = new Impulse(1);
    impulse.fire(0.6);
    impulse.fire(0.4); // plus faible : ne doit rien changer
    expect(impulse.value).toBe(0.6);
    impulse.fire(0.9); // plus fort : relance
    expect(impulse.value).toBe(0.9);
  });

  it('décroissance exponentielle : deux demi-vies = un quart de la valeur, exactement', () => {
    const impulse = new Impulse(0.5); // demi-vie 0,5 s
    impulse.fire(1.0);
    impulse.update(1.0); // 2 demi-vies écoulées en un seul appel
    expect(impulse.value).toBeCloseTo(0.25, 10);
  });

  it('la décroissance par dt est identique à 30, 60 et 144 fps (Loi 1)', () => {
    const decay = 0.3;
    const totalTime = 1.0;

    const runAt = (fps: number): number => {
      const impulse = new Impulse(decay);
      impulse.fire(1.0);
      const dt = 1 / fps;
      const steps = Math.round(totalTime * fps);
      for (let i = 0; i < steps; i++) impulse.update(dt);
      return impulse.value;
    };

    const v30 = runAt(30);
    const v60 = runAt(60);
    const v144 = runAt(144);

    expect(v60).toBeCloseTo(v30, 9);
    expect(v144).toBeCloseTo(v30, 9);
  });

  it('reset() ramène à 0, l\'équilibre naturel d\'une impulsion', () => {
    const impulse = new Impulse(0.2);
    impulse.fire(1.0);
    impulse.reset();
    expect(impulse.value).toBe(0);
  });

  it('seed() impose une valeur arbitraire, contrairement à reset() qui ne connaît que 0 (Étape 28)', () => {
    const impulse = new Impulse(0.2);
    impulse.seed(0.42);
    expect(impulse.value).toBe(0.42);
  });

  it('après seed(), la décroissance continue normalement depuis la valeur imposée', () => {
    const impulse = new Impulse(0.5); // demi-vie 0,5s
    impulse.seed(1.0);
    impulse.update(0.5);
    expect(impulse.value).toBeCloseTo(0.5, 10);
  });
});
