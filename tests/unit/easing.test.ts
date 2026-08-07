/**
 * Courbes partagées — chantier 2 (docs/17_PHASE2_VISUELS.md §6.3).
 *
 * `Anticipation` en consomme déjà une (`easeInQuad`, qu'elle redéfinissait sur
 * place). Les autres sont les fondations des chantiers 3 (caméra), 5-6
 * (nouveaux styles) et 8 (animations de texte). Elles sont testées MAINTENANT
 * plutôt qu'au moment de leur premier usage : du code non couvert livré
 * d'avance est du code dont personne ne sait s'il marche.
 */

import { describe, expect, it } from 'vitest';
import {
  easeInOutSine,
  easeInQuad,
  easeOutCubic,
  easeOutQuint,
  impact,
  MAX_OVERSHOOT,
  overshootLobe,
} from '../../src/core/math/easing';

const CURVES = [
  ['easeOutCubic', easeOutCubic],
  ['easeOutQuint', easeOutQuint],
  ['easeInQuad', easeInQuad],
  ['easeInOutSine', easeInOutSine],
] as const;

describe('courbes — bornes, monotonie, ancrage', () => {
  it('valent 0 en 0 et 1 en 1, restent dans [0,1], et croissent', () => {
    for (const [name, fn] of CURVES) {
      expect(fn(0), `${name}(0)`).toBeCloseTo(0, 9);
      expect(fn(1), `${name}(1)`).toBeCloseTo(1, 9);
      let precedent = -Infinity;
      for (let i = 0; i <= 200; i++) {
        const y = fn(i / 200);
        expect(y, `${name} borne basse`).toBeGreaterThanOrEqual(0);
        expect(y, `${name} borne haute`).toBeLessThanOrEqual(1);
        expect(y, `${name} monotone en ${i / 200}`).toBeGreaterThanOrEqual(precedent - 1e-12);
        precedent = y;
      }
    }
  });

  it('écrêtent hors domaine au lieu d\'extrapoler', () => {
    for (const [name, fn] of CURVES) {
      expect(fn(-5), `${name}(-5)`).toBeCloseTo(0, 9);
      expect(fn(5), `${name}(5)`).toBeCloseTo(1, 9);
      expect(fn(-0.001), `${name} juste sous 0`).toBeCloseTo(0, 9);
    }
  });

  it('se distinguent réellement les unes des autres', () => {
    const signature = (fn: (x: number) => number): string =>
      Array.from({ length: 9 }, (_, i) => fn((i + 1) / 10).toFixed(6)).join(',');
    expect(new Set(CURVES.map(([, fn]) => signature(fn))).size).toBe(CURVES.length);
  });
});

describe('impact — attaque instantanée, retour au repos EXACT', () => {
  it('vaut 1 à l\'attaque et exactement 0 à l\'échéance', () => {
    expect(impact(0, 0.5)).toBe(1);
    // C'est la propriété que ne tient PAS une exponentielle : à sa constante de
    // temps elle vaut encore 0,37 et ne s'annule jamais. Un élément qui ne
    // revient pas au repos mange le contraste de la frappe suivante.
    expect(impact(0.5, 0.5)).toBe(0);
    expect(impact(0.5001, 0.5)).toBe(0);
    expect(impact(1000, 0.5)).toBe(0);
  });

  it('décroît de façon monotone, sans jamais dépasser 1 ni passer sous 0', () => {
    let precedent = Infinity;
    for (let i = 0; i <= 300; i++) {
      const y = impact((i / 300) * 0.5, 0.5);
      expect(y).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y, `monotone en ${i}`).toBeLessThanOrEqual(precedent + 1e-12);
      precedent = y;
    }
  });

  it('résiste aux entrées dégénérées', () => {
    expect(impact(NaN, 0.5)).toBe(0);
    expect(impact(-1, 0.5)).toBe(0);
    expect(impact(Infinity, 0.5)).toBe(0);
    // Durée nulle : l'attaque vaut 1 par définition — elle est instantanée —
    // puis tout est fini. Le plancher interne évite la division par zéro.
    expect(impact(0, 0)).toBe(1);
    expect(impact(1e-3, 0)).toBe(0);
  });
});

describe('overshootLobe — un privilège borné', () => {
  it('est écrêté à MAX_OVERSHOOT quelle que soit la demande', () => {
    let pic = 0;
    for (let i = 0; i <= 400; i++) pic = Math.max(pic, overshootLobe(i / 400, 1000));
    expect(pic).toBeLessThanOrEqual(MAX_OVERSHOOT + 1e-12);
    expect(pic, 'le lobe doit exister, pas seulement être borné').toBeGreaterThan(0);
  });

  it('est nul aux deux extrémités — l\'élément revient exactement au repos', () => {
    expect(overshootLobe(0, MAX_OVERSHOOT)).toBe(0);
    expect(overshootLobe(1, MAX_OVERSHOOT)).toBe(0);
    expect(overshootLobe(0.5, 0)).toBe(0);
    expect(overshootLobe(0.5, -3), 'une demande négative ne crée pas de lobe').toBe(0);
  });

  it('un impact avec dépassement revient lui aussi exactement à 0', () => {
    for (const demande of [0.08, 0.5, 100]) {
      expect(impact(0.5, 0.5, demande), `demande ${demande}`).toBe(0);
      let minimum = Infinity;
      for (let i = 0; i <= 400; i++) minimum = Math.min(minimum, impact((i / 400) * 0.5, 0.5, demande));
      expect(minimum, 'jamais négatif').toBeGreaterThanOrEqual(0);
    }
  });
});
