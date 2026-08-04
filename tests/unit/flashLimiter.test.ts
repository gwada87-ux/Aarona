import { describe, expect, it } from 'vitest';
import { FlashRateGate, NORMAL_MODE, REDUCED_FLASHING_MODE } from '../../src/visual/safety/FlashLimiter';

describe('FlashRateGate — sous le seuil de delta', () => {
  it('laisse passer une variation de luminance faible, sans compter de transition', () => {
    const gate = new FlashRateGate(NORMAL_MODE); // deltaThreshold = 0.45
    expect(gate.evaluate(0, 0.5, 0.3)).toBeCloseTo(0.5, 10); // delta = 0.2 < 0.45
  });
});

describe('FlashRateGate — au-delà du seuil, sous la limite de fréquence', () => {
  it('autorise jusqu\'à maxTransitionsPerSecond transitions dans la même seconde musicale', () => {
    const gate = new FlashRateGate(NORMAL_MODE); // max 3/s
    expect(gate.evaluate(0.0, 1.0, 0.0)).toBe(1.0); // 1ère, autorisée
    expect(gate.evaluate(0.1, 0.0, 1.0)).toBe(0.0); // 2e, autorisée
    expect(gate.evaluate(0.2, 1.0, 0.0)).toBe(1.0); // 3e, autorisée
  });
});

describe('FlashRateGate — au-delà de la limite de fréquence', () => {
  it('clampe (interpole vers la valeur précédente) la transition en trop', () => {
    const gate = new FlashRateGate(NORMAL_MODE); // max 3/s
    gate.evaluate(0.0, 1.0, 0.0);
    gate.evaluate(0.1, 0.0, 1.0);
    gate.evaluate(0.2, 1.0, 0.0);
    const clamped = gate.evaluate(0.3, 0.0, 1.0); // 4e dans la même seconde
    expect(clamped).toBe(1.0); // reste à la valeur précédente, pas 0.0
  });

  it('la fenêtre glisse en TEMPS MUSICAL, pas en nombre d\'appels', () => {
    const gate = new FlashRateGate(NORMAL_MODE);
    gate.evaluate(0.0, 1.0, 0.0);
    gate.evaluate(0.1, 0.0, 1.0);
    gate.evaluate(0.2, 1.0, 0.0);
    // plus d'une seconde musicale plus tard : la fenêtre s'est vidée, transition à nouveau autorisée
    const allowed = gate.evaluate(1.3, 0.0, 1.0);
    expect(allowed).toBe(0.0);
  });

  it('reset() vide la fenêtre de transitions récentes', () => {
    const gate = new FlashRateGate(NORMAL_MODE);
    gate.evaluate(0.0, 1.0, 0.0);
    gate.evaluate(0.1, 0.0, 1.0);
    gate.evaluate(0.2, 1.0, 0.0);
    gate.reset();
    expect(gate.evaluate(0.21, 0.0, 1.0)).toBe(0.0); // autorisée à nouveau juste après reset
  });
});

describe('FlashRateGate — mode réduction des flashs', () => {
  it('utilise un seuil plus bas et une limite plus stricte que le mode normal', () => {
    const gate = new FlashRateGate(REDUCED_FLASHING_MODE); // seuil 0.18, max 2/s
    expect(gate.evaluate(0.0, 0.25, 0.0)).toBe(0.25); // delta=0.25 > 0.18 : compte comme transition
    expect(gate.evaluate(0.1, 0.0, 0.25)).toBe(0.0); // 2e transition, encore autorisée
    expect(gate.evaluate(0.2, 0.25, 0.0)).toBe(0.0); // 3e : au-delà de la limite (2/s), clampée
  });
});
