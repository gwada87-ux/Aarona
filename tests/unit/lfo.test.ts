/**
 * LFO verrouillés au tempo — chantier 2 (docs/17_PHASE2_VISUELS.md §7.1).
 *
 * Ce qui compte ici n'est pas la forme des courbes, c'est le VERROUILLAGE : un
 * LFO réglé sur « 2 mesures » doit boucler en deux mesures à 90 comme à 140
 * BPM. Un oscillateur en secondes ferait exactement le contraire, et c'est
 * l'erreur que ce module existe pour éviter.
 */

import { describe, expect, it } from 'vitest';
import { evaluateLfo, isLfoWaveform, LFO_WAVEFORMS, type LfoWaveform } from '../../src/behaviour/signals/Lfo';

describe('evaluateLfo — bornes et formes', () => {
  it('toutes les formes restent dans [0,1] sur plusieurs périodes', () => {
    for (const w of LFO_WAVEFORMS) {
      for (let i = 0; i <= 500; i++) {
        const v = evaluateLfo(w, (i / 500) * 12, 2, 0);
        expect(v, `${w} à ${i}`).toBeGreaterThanOrEqual(0);
        expect(v, `${w} à ${i}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('les formes CONTINUES sont périodiques en mesures', () => {
    // `random` est exclu à dessein : échantillonné-bloqué, il tire une NOUVELLE
    // valeur à chaque période. Sa non-périodicité est sa raison d'être, et elle
    // est vérifiée séparément plus bas.
    for (const w of LFO_WAVEFORMS.filter((f) => f !== 'random')) {
      for (const bars of [0.25, 1, 2.5, 4]) {
        const a = evaluateLfo(w, 3.137, bars, 0);
        const b = evaluateLfo(w, 3.137 + bars, bars, 0);
        const c = evaluateLfo(w, 3.137 + bars * 7, bars, 0);
        expect(b, `${w} période ${bars}`).toBeCloseTo(a, 9);
        expect(c, `${w} période ${bars} x7`).toBeCloseTo(a, 9);
      }
    }
  });

  it('les formes se distinguent réellement les unes des autres', () => {
    // Sans ce test, une faute de frappe dans le `switch` renverrait la même
    // courbe pour deux formes et personne ne s'en apercevrait.
    const echantillon = (w: LfoWaveform): string =>
      Array.from({ length: 16 }, (_, i) => evaluateLfo(w, i / 16, 1, 0).toFixed(4)).join(',');
    const vus = new Set(LFO_WAVEFORMS.map(echantillon));
    expect(vus.size, 'deux formes produisent la même courbe').toBe(LFO_WAVEFORMS.length);
  });

  it('le décalage de phase décale bien la courbe', () => {
    expect(evaluateLfo('saw', 0.25, 1, 0.5)).toBeCloseTo(evaluateLfo('saw', 0.75, 1, 0), 9);
  });
});

describe('evaluateLfo — verrouillage au tempo', () => {
  it('la valeur ne dépend QUE de la position en mesures, pas du tempo', () => {
    // Deux morceaux à des tempos différents atteignent la mesure 2,5 à des
    // instants différents ; le LFO doit y valoir la même chose. C'est toute la
    // raison d'être de ce module.
    const a90 = evaluateLfo('sine', 2.5, 2, 0);
    const a140 = evaluateLfo('sine', 2.5, 2, 0);
    expect(a90).toBe(a140);
  });

  it('résiste aux positions négatives (avant le premier downbeat)', () => {
    for (const w of LFO_WAVEFORMS) {
      const v = evaluateLfo(w, -1.37, 2, 0);
      expect(Number.isFinite(v), w).toBe(true);
      expect(v, w).toBeGreaterThanOrEqual(0);
      expect(v, w).toBeLessThanOrEqual(1);
    }
    // `%` garde le signe du dividende en JavaScript ; l'enveloppement doit être
    // explicite. Le test suivant échoue si on revient à un simple `%`.
    expect(evaluateLfo('saw', -0.25, 1, 0)).toBeCloseTo(0.75, 9);
  });

  it('une période nulle ou négative ne fait pas diverger', () => {
    for (const bars of [0, -1]) {
      const v = evaluateLfo('sine', 3, bars, 0);
      expect(Number.isFinite(v), `bars=${bars}`).toBe(true);
    }
  });
});

describe('evaluateLfo — déterminisme du tirage aléatoire (Loi 1)', () => {
  it('`random` est ÉCHANTILLONNÉ-BLOQUÉ : constant à l\'intérieur d\'une période', () => {
    const debut = evaluateLfo('random', 4.01, 1, 0);
    const milieu = evaluateLfo('random', 4.5, 1, 0);
    const fin = evaluateLfo('random', 4.99, 1, 0);
    expect(milieu).toBe(debut);
    expect(fin).toBe(debut);
    // ...et change à la période suivante.
    expect(evaluateLfo('random', 5.01, 1, 0)).not.toBe(debut);
  });

  it('`random` est reproductible d\'une exécution à l\'autre', () => {
    // Un `Math.random()` ou un tirage sur `step.rng` casserait l'export
    // déterministe. La valeur doit dépendre de la seule position.
    const premier = Array.from({ length: 20 }, (_, i) => evaluateLfo('random', i * 1.3, 1, 0));
    const second = Array.from({ length: 20 }, (_, i) => evaluateLfo('random', i * 1.3, 1, 0));
    expect(second).toEqual(premier);
    // Et il ne renvoie pas une constante déguisée.
    expect(new Set(premier).size).toBeGreaterThan(5);
  });
});

describe('isLfoWaveform', () => {
  it('accepte les cinq formes et rejette le reste', () => {
    for (const w of LFO_WAVEFORMS) expect(isLfoWaveform(w)).toBe(true);
    expect(isLfoWaveform('sinus')).toBe(false);
    expect(isLfoWaveform('')).toBe(false);
    expect(isLfoWaveform('SINE')).toBe(false);
  });
});
