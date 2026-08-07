/**
 * Easings et accent de grille (§2.7.8) - etape 6.
 *
 * §2.7.8 tient en une phrase : « Resolution apres impact : attaque quasi
 * instantanee, retour au repos sur 0,3 a 0,6 temps, leger depassement (<= 8 %)
 * reserve aux elements massifs. Les temps faibles et contretemps recoivent un
 * accent reduit (30-50 %) plutot qu'aucun. »
 *
 * Chaque clause y est verifiee separement, parce que chacune correspond a un
 * defaut visuel distinct : une attaque molle rate le temps, un retour trop long
 * mange le contraste de la frappe suivante, un depassement generalise fait
 * rebondir toute l'image, et des temps faibles a zero font battre le visuel a
 * demi-vitesse.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_OVERSHOOT,
  anticipation,
  easeInOutSine,
  easeOutCubic,
  easeOutQuint,
  impact,
  overshootLobe,
} from '../../../src/ui/live/util/easing';
import {
  DECAY_HAT,
  DECAY_KICK,
  DECAY_SNARE,
  beatWeight,
  gridAccent,
  withGridFloor,
} from '../../../src/ui/live/util/accent';

describe('easings (§2.7.8)', () => {
  it('les easings sont bornes, monotones et ancres a 0 et 1', () => {
    for (const [name, fn] of [
      ['easeOutCubic', easeOutCubic],
      ['easeOutQuint', easeOutQuint],
      ['easeInOutSine', easeInOutSine],
    ] as const) {
      expect(fn(0), `${name}(0)`).toBeCloseTo(0, 6);
      expect(fn(1), `${name}(1)`).toBeCloseTo(1, 6);
      let previous = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const y = fn(i / 100);
        expect(y, `${name} borne`).toBeGreaterThanOrEqual(0);
        expect(y, `${name} borne`).toBeLessThanOrEqual(1);
        expect(y, `${name} monotone en ${i / 100}`).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = y;
      }
      // Hors domaine : ecrete, jamais extrapole.
      expect(fn(-5), `${name}(-5)`).toBeCloseTo(0, 6);
      expect(fn(5), `${name}(5)`).toBeCloseTo(1, 6);
    }
  });

  it('impact : attaque instantanee a 1 et retour au repos EXACT a l echeance', () => {
    expect(impact(0, 0.5)).toBe(1);
    // C'est la clause que l'exponentielle utilisee jusqu'a l'etape 6 ne tenait
    // pas : `exp(-t/tau)` vaut encore 0,37 a `tau` et ne s'annule jamais.
    expect(impact(0.5, 0.5), 'doit valoir exactement 0 a l echeance').toBe(0);
    expect(impact(0.51, 0.5)).toBe(0);
    expect(impact(50, 0.5)).toBe(0);
  });

  it('impact : decroissance monotone, sans depassement par defaut', () => {
    let previous = Infinity;
    for (let i = 0; i <= 200; i++) {
      const y = impact((i / 200) * 0.5, 0.5);
      expect(y, 'jamais au-dessus de 1').toBeLessThanOrEqual(1);
      expect(y, 'jamais negatif').toBeGreaterThanOrEqual(0);
      expect(y, 'decroissance monotone').toBeLessThanOrEqual(previous + 1e-9);
      previous = y;
    }
  });

  it('le depassement est ECRETE a 8 % et revient exactement au repos', () => {
    for (const asked of [0.08, 0.2, 1, 100]) {
      let minimum = Infinity;
      for (let i = 0; i <= 400; i++) {
        const t = (i / 400) * 0.5;
        minimum = Math.min(minimum, impact(t, 0.5, asked));
      }
      // Le lobe est SOUSTRAIT : la valeur ne descend jamais sous -8 %, et comme
      // `impact` ecrete a zero, elle ne descend pas sous zero non plus.
      expect(minimum, `demande ${asked}`).toBeGreaterThanOrEqual(0);
      expect(impact(0.5, 0.5, asked), 'retour au repos exact').toBe(0);
    }
    // Le lobe lui-meme est bien plafonne.
    let peak = 0;
    for (let i = 0; i <= 400; i++) peak = Math.max(peak, overshootLobe(i / 400, 100));
    expect(peak, 'lobe plafonne a MAX_OVERSHOOT').toBeLessThanOrEqual(MAX_OVERSHOOT + 1e-9);
    expect(overshootLobe(0, MAX_OVERSHOOT), 'nul a l attaque').toBe(0);
    expect(overshootLobe(1, MAX_OVERSHOOT), 'nul a l echeance').toBe(0);
  });

  it('impact resiste aux entrees degenerees', () => {
    expect(impact(NaN, 0.5)).toBe(0);
    expect(impact(-1, 0.5)).toBe(0);
    expect(impact(Infinity, 0.5)).toBe(0);
    // Echeance nulle : l'attaque vaut 1 par definition - elle est instantanee -
    // puis tout est fini. Le plancher de 1e-4 temps (50 us a 120 BPM) evite la
    // division par zero sans creer d'enveloppe perceptible.
    expect(impact(0, 0), 'l attaque vaut 1 meme sans decroissance').toBe(1);
    expect(impact(1e-3, 0), 'et rien apres').toBe(0);
  });

  it('les decroissances par canal respectent la bande de §2.7.8', () => {
    expect(DECAY_KICK).toBeGreaterThanOrEqual(0.3);
    expect(DECAY_KICK).toBeLessThanOrEqual(0.6);
    expect(DECAY_SNARE).toBeGreaterThanOrEqual(0.3);
    expect(DECAY_SNARE).toBeLessThanOrEqual(0.6);
    // Le kick doit etre au repos AVANT la frappe suivante, sinon le contraste
    // du temps d'apres est deja entame.
    expect(DECAY_KICK, 'le kick doit se resoudre en moins d un temps').toBeLessThan(1);
    // Le charley sort de la bande DELIBEREMENT : en doubles croches il frappe
    // toutes les 0,25 temps, une decroissance de 0,3 ne reviendrait jamais au
    // repos et le scintillement deviendrait un voile.
    expect(DECAY_HAT, 'plus court que l intervalle des doubles croches').toBeLessThan(0.25);
  });

  it('anticipation : contre-mouvement sur au moins 90 ms, jamais avant', () => {
    // A 174 BPM la periode fait 345 ms ; periode/5 = 69 ms, sous le seuil
    // perceptif. Le plancher absolu de 90 ms doit alors prendre le relais.
    const fast = 60 / 174;
    expect(anticipation(0, fast), 'aucun recul en debut de temps').toBe(0);
    expect(anticipation(1, fast), 'recul maximal juste avant le temps').toBeCloseTo(1, 6);
    // Debut du contre-mouvement : 90 ms avant le temps, pas 69.
    const phase90 = 1 - 0.09 / fast;
    expect(anticipation(phase90 - 0.01, fast)).toBe(0);
    expect(anticipation(phase90 + 0.01, fast)).toBeGreaterThan(0);
    expect(anticipation(0.5, 0), 'periode inconnue').toBe(0);
  });
});

describe('accent de grille (§2.7.8, derniere phrase)', () => {
  it('TOUS les poids tiennent dans la bande 30-50 %, temps 1 compris', () => {
    // Le temps 1 y est inclus DELIBEREMENT. Un plancher a 1 n'est plus un
    // plancher : il forcerait chaque mesure a l'amplitude maximale meme sans
    // kick joue - donc pendant un breakdown - et ecraserait les frappes faibles
    // tombant sur le temps 1. Le plein accent doit venir de la frappe detectee.
    for (const beatsPerBar of [3, 4]) {
      for (let position = 0; position < beatsPerBar; position++) {
        const w = beatWeight(position, beatsPerBar);
        expect(w, `${beatsPerBar}/4 temps ${position + 1} : ${w}`).toBeGreaterThanOrEqual(0.3);
        expect(w, `${beatsPerBar}/4 temps ${position + 1} : ${w}`).toBeLessThanOrEqual(0.5);
      }
    }
    // La HIERARCHIE reste lisible : le temps 1 domine ses voisins.
    expect(beatWeight(0, 4), 'temps 1 au-dessus du temps 2').toBeGreaterThan(beatWeight(1, 4));
    expect(beatWeight(2, 4), 'temps 3 au-dessus du temps 2').toBeGreaterThan(beatWeight(1, 4));
    // Index hors mesure : ramene dans la mesure, jamais NaN.
    expect(beatWeight(4, 4)).toBe(beatWeight(0, 4));
    expect(beatWeight(-4, 4)).toBe(beatWeight(0, 4));
  });

  it('la grille ne remplace jamais une frappe detectee', () => {
    // Un kick faible sur le temps 1 doit rester faible : c'est de la dynamique,
    // pas du bruit. Le plancher ne remonte que ce qui est SOUS lui.
    const weak = 0.3;
    const floor = gridAccent(0, 0, DECAY_KICK, 4);
    expect(withGridFloor(weak, floor, 1), 'un kick a 0,3 ne doit pas ressortir a 1').toBeLessThanOrEqual(0.5);
    // Et une frappe pleine reste pleine.
    expect(withGridFloor(1, floor, 1)).toBe(1);
  });

  it('aucun temps de la mesure ne reste sans accent', () => {
    // Le defaut que la regle corrige : sur un motif a kick sur 1 et 3, les
    // temps 2 et 4 restaient a zero et le visuel battait a demi-vitesse.
    for (let beat = 0; beat < 4; beat++) {
      const barPhase = beat / 4;
      const value = gridAccent(barPhase, 0, DECAY_KICK, 4);
      expect(value, `temps ${beat + 1}`).toBeGreaterThanOrEqual(0.3);
    }
    // Les contretemps aussi.
    const off = gridAccent(0.125, 0.5, DECAY_KICK, 4);
    expect(off, 'contretemps').toBeGreaterThanOrEqual(0.25);
  });

  it('l accent de grille retombe entre les temps', () => {
    // Juste avant le temps suivant, la grille doit etre proche du repos -
    // sinon elle vaut un plancher permanent et non un accent.
    const justBefore = gridAccent(0.24, 0.99, DECAY_KICK, 4);
    expect(justBefore, `${justBefore.toFixed(3)}`).toBeLessThan(0.1);
  });

  it('le plancher combine par MAX, jamais par addition (§2.7.7)', () => {
    // Une somme donnerait 1,4 sur un temps ou l'onset EST detecte.
    expect(withGridFloor(1, 1, 1)).toBe(1);
    expect(withGridFloor(0, 0.4, 1), 'la grille prend le relais').toBeCloseTo(0.4, 9);
    expect(withGridFloor(0.9, 0.4, 1), 'l onset reste maitre').toBeCloseTo(0.9, 9);
    // Le ratio est ecrete : aucun appelant ne peut amplifier la grille.
    expect(withGridFloor(0, 1, 5)).toBeCloseTo(1, 9);
    expect(withGridFloor(0, 1, -5)).toBe(0);
  });
});
