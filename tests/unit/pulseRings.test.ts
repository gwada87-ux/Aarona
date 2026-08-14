import { describe, expect, it } from 'vitest';
import { KICK_RING_V1, PulseRings } from '../../src/visual/layers/geometry/PulseRings';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

function strokeCircleCalls(renderer: FakeRenderer) {
  return renderer.calls.filter((c): c is Extract<typeof c, { type: 'strokeCircle' }> => c.type === 'strokeCircle');
}

describe('PulseRings — anneau central', () => {
  /** Dessine l'anneau principal pour un jeu de signaux donne. */
  function anneau(signaux: Parameters<typeof makeSignals>[0]) {
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    rings.update(makeStepBuilder().build(0), makeSignals(signaux));
    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    return strokeCircleCalls(renderer)[0]!;
  }

  it('le rayon croît avec l\'impact, l\'épaisseur avec weight', () => {
    // Gain CALCULE depuis le drapeau : a `false` ce test exige la formule de
    // docs/07 (0,28 + 0,10 impact), a `true` celle du chantier du 15/08. Il
    // verrouille donc les DEUX positions au lieu de figer un chiffre.
    const gain = KICK_RING_V1 ? 0.2 : 0.1;
    expect(anneau({ impact: 0.5, weight: 1 }).radius).toBeCloseTo(0.28 + gain * 0.5, 10);
    expect(anneau({ impact: 0.5, weight: 1 }).lineWidth).toBeGreaterThan(anneau({ impact: 0.5, weight: 0 }).lineWidth);
  });

  /**
   * Demande d'Aaron le 15/08 : « le kick devrait faire grossir le cercle
   * principal ». Ses kicks culminent vers 0,48 apres normalisation, pas 1 :
   * c'est A CE NIVEAU-LA que le geste doit se voir, pas au maximum theorique.
   */
  it('une frappe REELLE (0,48) fait nettement grossir le cercle', () => {
    if (!KICK_RING_V1) return;
    const repos = anneau({ impact: 0, weight: 0.5 });
    const frappe = anneau({ impact: 0.48, weight: 0.5 });
    expect(frappe.radius / repos.radius, 'moins de 30 % ne se voit pas').toBeGreaterThan(1.3);
  });

  it('la frappe épaissit le trait, pas seulement le rayon', () => {
    // L'oeil suit les contrastes avant les positions : un cercle fin qui
    // s'agrandit se remarque mal.
    if (!KICK_RING_V1) return;
    const repos = anneau({ impact: 0, weight: 0.5 });
    const frappe = anneau({ impact: 0.48, weight: 0.5 });
    expect(frappe.lineWidth).toBeGreaterThan(repos.lineWidth);
  });

  it('le cercle reste dans le cadre même à pleine frappe', () => {
    // Loi 4 : 1,0 = petit cote. Les anneaux secondaires vont deja jusqu'a 0,60,
    // mais l'anneau PRINCIPAL ne doit pas les rejoindre.
    expect(anneau({ impact: 1, weight: 1 }).radius).toBeLessThanOrEqual(0.5);
  });
});

describe('PulseRings — anneaux secondaires sur DOWNBEAT', () => {
  it('un DOWNBEAT ajoute un anneau qui grandit et s\'estompe sur 1,2s', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'DOWNBEAT', intensity: 1, confidence: 1 }]);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    rings.update(stepper.build(0.5), makeSignals());
    const justAfter = new FakeRenderer();
    rings.draw(justAfter, testViewport);
    expect(strokeCircleCalls(justAfter)).toHaveLength(2); // anneau principal + 1 secondaire

    // avance de 0.6s (dans les 1.2s de vie de l'anneau) — update() à CHAQUE
    // sous-pas : PulseRings accumule l'âge par step.dt (toujours 1/120),
    // jamais par l'écart réel entre deux `t`, comme StepContext partout ailleurs.
    for (let t = 0.5 + 1 / 120; t <= 1.1; t += 1 / 120) rings.update(stepper.build(t), makeSignals());
    const midLife = new FakeRenderer();
    rings.draw(midLife, testViewport);
    const secondary = strokeCircleCalls(midLife)[1];
    expect(secondary?.radius).toBeGreaterThan(0.28); // s'est étendu
    expect(secondary?.color.a).toBeLessThan(defaultPalette.secondary.a); // s'est estompé

    // avance au-delà de 1.2s : l'anneau doit avoir disparu
    for (let t = 1.1 + 1 / 120; t <= 1.9; t += 1 / 120) rings.update(stepper.build(t), makeSignals());
    const afterLifetime = new FakeRenderer();
    rings.draw(afterLifetime, testViewport);
    expect(strokeCircleCalls(afterLifetime)).toHaveLength(1); // seulement l'anneau principal
  });

  it('le pool ne déborde jamais (8 emplacements)', () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      t: i * 0.05,
      type: 'DOWNBEAT',
      intensity: 1,
      confidence: 1,
    }));
    const stepper = makeStepBuilder(events, 5);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });

    for (let t = 1 / 120; t <= 1.0; t += 1 / 120) rings.update(stepper.build(t), makeSignals());

    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    expect(strokeCircleCalls(renderer).length).toBeLessThanOrEqual(1 + 8); // principal + au plus 8 secondaires
  });

  it('reset() efface les anneaux actifs', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'DOWNBEAT', intensity: 1, confidence: 1 }]);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    rings.update(stepper.build(0.5), makeSignals());
    rings.reset(2);
    rings.update(stepper.build(2), makeSignals());

    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    expect(strokeCircleCalls(renderer)).toHaveLength(1); // uniquement l'anneau principal
  });
});

describe('PulseRings — params (Étape 20, macros densité/mouvement/chaos)', () => {
  it('params.maxActiveRings borne le nombre d\'anneaux actifs en dessous de 8', () => {
    const events = Array.from({ length: 20 }, (_, i) => ({ t: i * 0.05, type: 'DOWNBEAT', intensity: 1, confidence: 1 }));
    const stepper = makeStepBuilder(events, 5);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    rings.params = { maxActiveRings: 3 };

    for (let t = 1 / 120; t <= 1.0; t += 1 / 120) rings.update(stepper.build(t), makeSignals());

    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    expect(strokeCircleCalls(renderer).length).toBeLessThanOrEqual(1 + 3); // principal + au plus 3 secondaires
  });

  it('params.lifetimeSec plus court fait disparaître un anneau plus tôt', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'DOWNBEAT', intensity: 1, confidence: 1 }]);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    rings.params = { lifetimeSec: 0.3 };

    rings.update(stepper.build(0.5), makeSignals());
    for (let t = 0.5 + 1 / 120; t <= 0.9; t += 1 / 120) rings.update(stepper.build(t), makeSignals());

    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    // À 0,4s après le DOWNBEAT, un anneau de durée de vie 0,3s a déjà disparu (contrairement au défaut de 1,2s).
    expect(strokeCircleCalls(renderer)).toHaveLength(1);
  });

  it('params.chaosJitter=0 (défaut) → rayon exact BASE_RADIUS+progress·expansion, sans décalage', () => {
    const stepper = makeStepBuilder([{ t: 0.5, type: 'DOWNBEAT', intensity: 1, confidence: 1 }]);
    const rings = new PulseRings();
    rings.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    rings.update(stepper.build(0.5), makeSignals());

    const renderer = new FakeRenderer();
    rings.draw(renderer, testViewport);
    const secondary = strokeCircleCalls(renderer)[1];
    expect(secondary?.radius).toBeCloseTo(0.28, 10); // progress ≈ 0 juste après spawn, jitter nul par défaut
  });
});
