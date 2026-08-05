import { describe, expect, it } from 'vitest';
import { scoreEvents, isTempoAccurate } from '../bench/scoring';

describe('scoreEvents — cas parfait', () => {
  it('détections exactement aux temps de vérité → précision/rappel/F-mesure = 1', () => {
    const truth = [0.5, 1.0, 1.5, 2.0];
    const result = scoreEvents(truth, truth, 0.07);
    expect(result).toEqual({
      truePositives: 4,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 1,
      recall: 1,
      fMeasure: 1,
    });
  });

  it('un décalage dans la tolérance compte comme vrai positif', () => {
    const truth = [1.0];
    const detected = [1.0 + 0.069]; // < 70ms
    const result = scoreEvents(detected, truth, 0.07);
    expect(result.truePositives).toBe(1);
    expect(result.fMeasure).toBe(1);
  });

  it('la limite de tolérance est incluse (≤, pas <) — valeurs choisies pour un écart exact en virgule flottante', () => {
    const truth = [1.0];
    const detected = [1.5]; // 1.5 - 1 = 0.5 exactement représentable en binaire, contrairement à 1.07 - 1.0
    const result = scoreEvents(detected, truth, 0.5);
    expect(result.truePositives).toBe(1);
  });
});

describe('scoreEvents — faux positifs et faux négatifs', () => {
  it('un décalage hors tolérance compte comme un FP ET un FN', () => {
    const truth = [1.0];
    const detected = [1.5];
    const result = scoreEvents(detected, truth, 0.07);
    expect(result).toEqual({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 1,
      precision: 0,
      recall: 0,
      fMeasure: 0,
    });
  });

  it('détections en trop (aucune vérité correspondante) sont des FP', () => {
    const truth = [1.0];
    const detected = [1.0, 3.0, 5.0];
    const result = scoreEvents(detected, truth, 0.07);
    expect(result.truePositives).toBe(1);
    expect(result.falsePositives).toBe(2);
    expect(result.precision).toBeCloseTo(1 / 3, 5);
    expect(result.recall).toBe(1);
  });

  it('vérités manquées (aucune détection proche) sont des FN', () => {
    const truth = [1.0, 2.0, 3.0];
    const detected = [1.0];
    const result = scoreEvents(detected, truth, 0.07);
    expect(result.truePositives).toBe(1);
    expect(result.falseNegatives).toBe(2);
    expect(result.recall).toBeCloseTo(1 / 3, 5);
    expect(result.precision).toBe(1);
  });
});

describe('scoreEvents — appariement glouton, pas de double-appariement', () => {
  it('une détection proche de deux vérités ne compte qu\'une seule fois', () => {
    const truth = [1.0, 1.05]; // deux vérités à 50ms l'une de l'autre
    const detected = [1.02]; // proche des deux, dans la tolérance des deux
    const result = scoreEvents(detected, truth, 0.07);
    expect(result.truePositives).toBe(1);
    expect(result.falseNegatives).toBe(1); // l'autre vérité reste non appariée
    expect(result.falsePositives).toBe(0);
  });

  it('apparie chaque vérité à la détection la plus proche disponible', () => {
    const truth = [1.0, 1.2];
    const detected = [1.03, 1.18]; // 1.03 plus proche de 1.0, 1.18 plus proche de 1.2
    const result = scoreEvents(detected, truth, 0.07);
    expect(result.truePositives).toBe(2);
  });
});

describe('scoreEvents — ensembles vides', () => {
  it('aucune détection, aucune vérité → tout à 0 (convention documentée, pas 1)', () => {
    const result = scoreEvents([], [], 0.07);
    expect(result).toEqual({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 0,
      recall: 0,
      fMeasure: 0,
    });
  });

  it('aucune vérité mais des détections → précision 0, rappel 0 (dénominateur nul)', () => {
    const result = scoreEvents([1.0, 2.0], [], 0.07);
    expect(result.falsePositives).toBe(2);
    expect(result.precision).toBe(0);
    expect(result.recall).toBe(0);
  });
});

describe('isTempoAccurate', () => {
  it('accepte un écart de ± 2 % (docs/11) — vérité=100 pour un écart exact en virgule flottante', () => {
    expect(isTempoAccurate(100, 100)).toBe(true);
    expect(isTempoAccurate(102, 100)).toBe(true); // exactement +2%
    expect(isTempoAccurate(98, 100)).toBe(true); // exactement -2%
  });

  it('rejette un écart au-delà de ± 2 %', () => {
    expect(isTempoAccurate(125, 120)).toBe(false);
    expect(isTempoAccurate(115, 120)).toBe(false);
  });

  it('rejette une vérité à 0 ou négative plutôt que de diviser par zéro', () => {
    expect(isTempoAccurate(120, 0)).toBe(false);
    expect(isTempoAccurate(120, -10)).toBe(false);
  });
});
