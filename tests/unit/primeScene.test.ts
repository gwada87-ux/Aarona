/**
 * Amorçage d'une scène fraîche (`primeScene`) — correctif du « creux en pause ».
 *
 * Défaut trouvé au chantier 10 lot C et corrigé après la phase 2 : une scène qui
 * vient d'être construite est VIDE, et ses couches ne se remplissent que dans
 * `update()`, qui ne tourne qu'en lecture. Changer de style, de couche ou de
 * palette EN PAUSE laissait l'aperçu noir jusqu'à la reprise — mesuré au
 * navigateur : 2 828 pixels clairs, puis 0, puis 10 858 après deux secondes de
 * lecture.
 *
 * Ce qui avait fait repousser le correctif : amorcer avec le moteur VIVANT
 * ferait avancer ses enveloppes sans que le temps avance, un accroc à la Loi 1.
 * `primeScene` travaille sur des moteurs JETABLES — c'est ce que ces tests
 * protègent en premier.
 */

import { describe, expect, it } from 'vitest';
import { PRIME_SECONDS, primeScene } from '../../src/visual/scene/dramaFrame';
import { createPulseStyle } from '../../src/visual/styles/pulse/createPulseStyle';
import { createFieldStyle } from '../../src/visual/styles/field/createFieldStyle';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { BehaviourEngine } from '../../src/behaviour/BehaviourEngine';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import { buildDemoDoc } from '../../src/ui/demoDoc';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';

const timeline = buildMusicTimeline(buildDemoDoc(30));
const SEED = 1234;

function fingerprint(scene: ReturnType<typeof createPulseStyle>): string {
  const r = new FakeRenderer();
  scene.draw(r, testViewport);
  return JSON.stringify(
    r.calls.map((c) =>
      c.type === 'drawSprite'
        ? c.transforms.map((t) => `${t.x.toFixed(3)},${t.y.toFixed(3)},${t.scale.toFixed(3)},${t.alpha.toFixed(3)}`).join(';')
        : JSON.stringify(c),
    ),
  );
}

describe('primeScene — la scène n\'est plus vide en pause', () => {
  it('une scène AMORCÉE ne dessine pas comme une scène fraîche', () => {
    const fraiche = createPulseStyle();
    fraiche.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    const amorcee = createPulseStyle();
    amorcee.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    primeScene(amorcee, timeline, SEED, defaultMapping, 8);

    expect(fingerprint(amorcee), 'l\'amorçage n\'a rien changé').not.toBe(fingerprint(fraiche));
  });

  it('remplit un pool de particules, que `field` laisse vide sans ça', () => {
    // Le cas le plus visible : `field` n'a RIEN a montrer tant que ses
    // particules n'ont pas ete emises, et elles ne le sont que dans `update`.
    const fraiche = createFieldStyle(800, false);
    fraiche.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const avant = fraiche.layers.find((l) => l.particleStats)?.particleStats?.().live ?? -1;

    const amorcee = createFieldStyle(800, false);
    amorcee.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    primeScene(amorcee, timeline, SEED, defaultMapping, 8);
    const apres = amorcee.layers.find((l) => l.particleStats)?.particleStats?.().live ?? -1;

    expect(avant, 'une scène fraîche doit avoir un pool vide').toBe(0);
    expect(apres, 'l\'amorçage doit avoir peuplé le pool').toBeGreaterThan(0);
  });
});

describe('primeScene — la Loi 1 tient', () => {
  it('ne touche PAS le moteur vivant', () => {
    // C'est l'objection qui avait fait repousser le correctif : amorcer avec le
    // moteur vivant avancerait ses enveloppes sans que le temps avance.
    // DEUX moteurs menés à l'identique, `primeScene` intercalé sur un seul.
    // Comparer un moteur à lui-même ne marcherait pas : `update` est ce qui fait
    // avancer ses enveloppes, donc l'appeler deux fois change la réponse — c'est
    // exactement la raison pour laquelle on ne peut pas amorcer avec lui.
    // Un SEUL `build` par instant, partagé par les deux moteurs :
    // `StepContextBuilder` est lui aussi statefull — il rend les événements
    // survenus depuis l'appel précédent, donc deux appels au même `t` en
    // donneraient à l'un et rien à l'autre.
    const stepper = new StepContextBuilder(timeline, SEED);
    const temoin = new BehaviourEngine(timeline, defaultMapping);
    const sujet = new BehaviourEngine(timeline, defaultMapping);
    for (let t = 0; t < 4; t += 1 / 120) {
      const step = stepper.build(t);
      temoin.update(step);
      sujet.update(step);
    }

    const scene = createPulseStyle();
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    primeScene(scene, timeline, SEED, defaultMapping, 8);

    // Le moteur qui a « vu » l'amorçage répond exactement comme celui qui ne l'a
    // pas vu : `primeScene` a joué sur les siens, jetables.
    const dernier = stepper.build(4);
    expect({ ...sujet.update(dernier) }).toEqual({ ...temoin.update(dernier) });
  });

  it('est une fonction PURE de l\'instant et de la graine', () => {
    const a = createPulseStyle();
    a.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    primeScene(a, timeline, SEED, defaultMapping, 8);

    const b = createPulseStyle();
    b.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    primeScene(b, timeline, SEED, defaultMapping, 8);

    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('deux instants différents donnent deux états différents', () => {
    const a = createPulseStyle();
    a.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    primeScene(a, timeline, SEED, defaultMapping, 5);

    const b = createPulseStyle();
    b.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    primeScene(b, timeline, SEED, defaultMapping, 12);

    expect(fingerprint(b)).not.toBe(fingerprint(a));
  });

  it('rend le director portant le budget de l\'instant demandé', () => {
    // Un appelant qui DESSINE juste après en a besoin : `openFrameWithCamera`
    // lit `director.budget`, et un director neuf rendrait une caméra neutre.
    const scene = createPulseStyle();
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const director = primeScene(scene, timeline, SEED, defaultMapping, 12);
    expect(director.budget).toBeDefined();
    expect(director.budget.arc, 'le director doit avoir été mis à jour').toBeTruthy();
  });

  it('ne remonte jamais avant zéro', () => {
    const scene = createPulseStyle();
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    expect(() => primeScene(scene, timeline, SEED, defaultMapping, 0.3)).not.toThrow();
    expect(PRIME_SECONDS).toBeGreaterThan(0);
  });
});
