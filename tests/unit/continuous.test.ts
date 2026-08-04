import { describe, expect, it } from 'vitest';
import { Continuous } from '../../src/behaviour/signals/Continuous';

describe('Continuous', () => {
  it('monte avec riseTau quand la cible augmente', () => {
    const continuous = new Continuous(0.1, 1.0); // montée rapide, descente lente
    continuous.update(1.0, 0.1); // une constante de temps : ~63% de la cible
    expect(continuous.value).toBeGreaterThan(0.55);
    expect(continuous.value).toBeLessThan(0.7);
  });

  it('utilise fallTau (plus lent) quand la cible diminue, jamais riseTau', () => {
    const continuous = new Continuous(0.05, 1.0);
    continuous.update(1.0, 10); // converge près de 1
    const atPeak = continuous.value;
    continuous.update(0, 0.05); // redescend : doit utiliser fallTau=1.0, pas riseTau=0.05
    // avec fallTau=1.0 et dt=0.05, la baisse est faible (~5% de l'écart)
    expect(continuous.value).toBeGreaterThan(atPeak * 0.9);
  });

  it('converge vers la cible avec un dt suffisamment grand', () => {
    const continuous = new Continuous(0.1, 0.1);
    continuous.update(0.8, 5);
    expect(continuous.value).toBeCloseTo(0.8, 6);
  });

  it('reset(v) saute directement à la valeur donnée, sans ramper', () => {
    const continuous = new Continuous(0.1, 0.1);
    continuous.reset(0.42);
    expect(continuous.value).toBe(0.42);
  });
});
