import { describe, expect, it } from 'vitest';
import { correctDrift, HARD_RESYNC_THRESHOLD_SECONDS, resyncVisualClock, visualNudge } from '../../src/core/time/driftCorrection';

describe('correctDrift — lissage de la dérive (docs/03_DATA_FLOW.md §dérive)', () => {
  it('erreur nulle : aucune correction', () => {
    const r = correctDrift(5, 5);
    expect(r).toEqual({ t: 5, resynced: false });
  });

  it('rattrape au maximum 2 ms par appel quand la mesure est en avance', () => {
    const r = correctDrift(10.0, 10.01); // 10 ms d'écart, sous le seuil de resync dur
    expect(r.resynced).toBe(false);
    expect(r.t).toBeCloseTo(10.002, 10);
  });

  it('rattrape au maximum 2 ms par appel quand la mesure est en retard (cas symétrique)', () => {
    const r = correctDrift(10.0, 9.99);
    expect(r.resynced).toBe(false);
    expect(r.t).toBeCloseTo(9.998, 10);
  });

  it('resynchronise directement au-delà du seuil (seek externe présumé)', () => {
    const r = correctDrift(10.0, 10.2); // 200 ms
    expect(r.resynced).toBe(true);
    expect(r.t).toBe(10.2);
  });

  it('seuil strictement supérieur : exactement 120 ms ne déclenche pas de resync dur', () => {
    const r = correctDrift(10.0, 10.0 + HARD_RESYNC_THRESHOLD_SECONDS);
    expect(r.resynced).toBe(false);
  });

  it('juste au-dessus du seuil déclenche la resync dur', () => {
    const r = correctDrift(10.0, 10.0 + HARD_RESYNC_THRESHOLD_SECONDS + 0.001);
    expect(r.resynced).toBe(true);
  });

  it('un resync dur ne dépasse jamais la mesure : t == tMeasured exactement, jamais en avance', () => {
    const r = correctDrift(0, 3.5);
    expect(r.t).toBe(3.5);
  });

  it(
    'boucle de rattrapage réaliste : une dérive de 50 ms se résorbe en moins de 30 pas ' +
      'de 1/120 s sans jamais dépasser la mesure (le budget de convergence douce ne "double-corrige" pas)',
    () => {
      let predicted = 0;
      const measured = 0.05; // le prédit est 50 ms en retard sur la mesure, la mesure reste fixe
      let steps = 0;
      while (predicted < measured && steps < 100) {
        const r = correctDrift(predicted, measured);
        expect(r.t).toBeLessThanOrEqual(measured);
        predicted = r.t;
        steps += 1;
      }
      expect(steps).toBeLessThan(30);
      expect(predicted).toBeCloseTo(measured, 10);
    },
  );

  it(
    'jitter réaliste (mesure qui alterne autour du prédit, comme les paliers d\'AudioContext.currentTime) : ' +
      'le t corrigé reste borné à ±2 ms de la mesure, aucune divergence',
    () => {
      let predicted = 10.0;
      const jitters = [0.0005, -0.0007, 0.0003, -0.0002, 0.0006, -0.0004, 0.0001, -0.0009];
      for (const jitter of jitters) {
        const measured = predicted + jitter;
        const r = correctDrift(predicted, measured);
        expect(Math.abs(r.t - measured)).toBeLessThanOrEqual(0.002 + 1e-9);
        predicted = r.t + 1 / 120; // avance d'un sous-pas avant le prochain appel
      }
    },
  );
});

/**
 * Reancrage de l'horloge VISUELLE (14/08/2026). Defaut signale par Aaron
 * (« c'etait synchro, et ensuite non »), puis reproduit a la mesure : la
 * boucle d'apercu n'avancait `simT` que par deltas, sans jamais la comparer a
 * la position audio absolue. Toute avance perdue l'etait definitivement.
 */
describe('resyncVisualClock — reancrage de l\'image sur le son', () => {
  const D = 120; // duree du morceau

  it('une derive normale ne declenche RIEN : on ne saute pas pour 50 ms', () => {
    const r = resyncVisualClock(10, 10.05, D);
    expect(r.resynced).toBe(false);
    expect(r.t).toBe(10);
  });

  it('juste sous le seuil, toujours rien', () => {
    expect(resyncVisualClock(10, 10 + HARD_RESYNC_THRESHOLD_SECONDS, D).resynced).toBe(false);
  });

  it('au-dela du seuil, l\'image se recale sur le son', () => {
    const r = resyncVisualClock(10, 10.5, D);
    expect(r.resynced).toBe(true);
    expect(r.t).toBeCloseTo(10.5, 9);
  });

  it('rattrape aussi une image EN AVANCE, pas seulement en retard', () => {
    // C'est le cas reel mesure : un saut arriere de l'horloge audio donnait
    // `max(0, negatif) = 0`, donc l'image gardait son avance pour toujours.
    const r = resyncVisualClock(10.5, 10, D);
    expect(r.resynced).toBe(true);
    expect(r.t).toBeCloseTo(10, 9);
  });

  it('le cas mesure au navigateur : 424 ms d\'avance, jamais rattrapes avant ce correctif', () => {
    const r = resyncVisualClock(25.424, 25, D);
    expect(r.resynced).toBe(true);
    expect(r.t).toBeCloseTo(25, 9);
  });

  it('ne sort jamais du morceau', () => {
    expect(resyncVisualClock(0, -5, D).t).toBe(0);
    expect(resyncVisualClock(D, D + 10, D).t).toBe(D);
  });

  it('le seuil est CELUI de correctDrift, pas un second seuil parallele', () => {
    // Deux constantes auraient derive l'une de l'autre sans que rien ne le dise.
    expect(resyncVisualClock(10, 10 + HARD_RESYNC_THRESHOLD_SECONDS + 1e-9, D).resynced).toBe(true);
  });
});

/**
 * Rattrapage DOUX (14/08/2026, second defaut). Le reancrage dur ne se declenche
 * qu'au-dela de 120 ms ; en dessous, rien ne faisait diminuer l'ecart. Mesure
 * sur le beat d'Aaron : -114,0 ms permanents, ZERO reancrage, soit un quart de
 * temps a 136 BPM.
 */
describe('visualNudge — l\'ecart sous le seuil doit se resorber', () => {
  it('le cas mesure chez Aaron : 114 ms d\'avance sont rattrapes', () => {
    // L'image est EN AVANCE de 114 ms : le rattrapage doit etre NEGATIF, donc
    // ralentir l'image jusqu'a ce que le son la rejoigne.
    const n = visualNudge(25.114, 25);
    expect(n).toBeLessThan(0);
    expect(Math.abs(n)).toBeCloseTo(0.002, 9);
  });

  it('rattrape aussi dans l\'autre sens', () => {
    expect(visualNudge(25, 25.114)).toBeCloseTo(0.002, 9);
  });

  it('jamais plus de 2 ms par image : aucun saut visible', () => {
    for (const erreur of [0.005, 0.02, 0.05, 0.1, 0.119]) {
      expect(Math.abs(visualNudge(10, 10 + erreur))).toBeLessThanOrEqual(0.002 + 1e-12);
      expect(Math.abs(visualNudge(10 + erreur, 10))).toBeLessThanOrEqual(0.002 + 1e-12);
    }
  });

  it('un ecart minuscule est corrige a sa juste valeur, pas au maximum', () => {
    expect(visualNudge(10, 10.0005)).toBeCloseTo(0.0005, 9);
  });

  it('au-dela du seuil, il se tait : c\'est le reancrage DUR qui prend le relais', () => {
    expect(visualNudge(10, 10.5)).toBe(0);
    expect(visualNudge(10.5, 10)).toBe(0);
  });

  it('114 ms se resorbent en environ une seconde a 60 images par seconde', () => {
    // 2 ms par image x 60 = 120 ms par seconde.
    let sim = 25.114;
    const audio = 25;
    let images = 0;
    while (Math.abs(audio - sim) > 0.002 && images < 600) {
      sim += visualNudge(sim, audio);
      images++;
    }
    expect(images).toBeLessThanOrEqual(60);
  });
});
