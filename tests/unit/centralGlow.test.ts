import { describe, expect, it } from 'vitest';
import { CentralGlow, KICK_PUNCH_V1 } from '../../src/visual/layers/glow/CentralGlow';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

function drawSpriteCalls(renderer: FakeRenderer) {
  return renderer.calls.filter((c): c is Extract<typeof c, { type: 'drawSprite' }> => c.type === 'drawSprite');
}

describe('CentralGlow — repos', () => {
  it('drive=0 → aucun sprite dessiné (les deux alphas sont sous le seuil)', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)).toHaveLength(0);
  });
});

describe('CentralGlow — fondu froid/chaud', () => {
  it('brightness=0, drive=1 → un seul sprite (froid), alpha ≈ 1', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 1, brightness: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    const calls = drawSpriteCalls(renderer);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.transforms[0]!.alpha).toBeCloseTo(1, 5);
  });

  it('brightness=1, drive=1 → un seul sprite (chaud), alpha ≈ 1', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 1, brightness: 1 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)).toHaveLength(1);
  });
});

describe('CentralGlow — params (Étape 20, macro glow)', () => {
  it('params.intensityMul réduit l\'alpha du sprite dessiné', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    glow.params = { intensityMul: 0.5 };
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 1, brightness: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)[0]!.transforms[0]!.alpha).toBeCloseTo(0.5, 5);
  });

  it('params absent → comportement inchangé (alpha = drive, sans multiplicateur)', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 0.6, brightness: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)[0]!.transforms[0]!.alpha).toBeCloseTo(0.6, 5);
  });

  it('params.diameter change le scale du sprite dessiné', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    glow.params = { diameter: 0.7 };
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 1, brightness: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)[0]!.transforms[0]!.scale).toBeCloseTo(0.7, 5);
  });

  it('l\'alpha reste borné à 1 même avec un intensityMul élevé', () => {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    glow.params = { intensityMul: 1.8 };
    const stepper = makeStepBuilder();
    glow.update(stepper.build(0), makeSignals({ drive: 1, brightness: 0 }));

    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    expect(drawSpriteCalls(renderer)[0]!.transforms[0]!.alpha).toBe(1);
  });
});

/**
 * Le halo bat sur la grosse caisse (drapeau `KICK_PUNCH_V1`, 14/08/2026).
 * Defaut signale par Aaron a l'oreille : « le kick manque d'impact visuel ».
 * Mesure : ce halo, l'element le plus visible du style, ne lisait pas `impact`.
 */
describe('CentralGlow — le kick fait battre le halo', () => {
  function diametre(signaux: Parameters<typeof makeSignals>[0]): number {
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    glow.update(makeStepBuilder().build(0), makeSignals(signaux));
    const renderer = new FakeRenderer();
    glow.draw(renderer, testViewport);
    const calls = drawSpriteCalls(renderer);
    expect(calls.length, 'aucun sprite dessine : le montage du test est faux').toBeGreaterThan(0);
    return calls[0]!.transforms[0]!.scale;
  }

  it('une frappe pleine gonfle le halo de 30 %', () => {
    const repos = diametre({ drive: 1, impact: 0 });
    const frappe = diametre({ drive: 1, impact: 1 });
    if (!KICK_PUNCH_V1) {
      expect(frappe).toBe(repos);
      return;
    }
    expect(frappe / repos).toBeCloseTo(1.3, 6);
  });

  it('le gonflement est PROPORTIONNEL a la force de la frappe', () => {
    if (!KICK_PUNCH_V1) return;
    const repos = diametre({ drive: 1, impact: 0 });
    const moitie = diametre({ drive: 1, impact: 0.5 });
    expect(moitie / repos).toBeCloseTo(1.15, 6);
  });

  it('la frappe et la montee vers le drop s\'ADDITIONNENT sans se confondre', () => {
    // Deux instruments differents : l'un dure des mesures, l'autre un dixieme
    // de seconde. Les empiler ne viole pas « un instrument, un canal ».
    if (!KICK_PUNCH_V1) return;
    const repos = diametre({ drive: 1, impact: 0, tension: 0 });
    const lesDeux = diametre({ drive: 1, impact: 1, tension: 1 });
    expect(lesDeux / repos).toBeCloseTo(1 + 0.55 + 0.3, 6);
  });

  it('l\'INTENSITE ne bouge pas : le kick n\'agit que sur la taille', () => {
    // C'est le coeur du choix. A fort niveau l'intensite est saturee (gain
    // deja > 1), donc y brancher le kick ne produirait rien.
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const lire = (impact: number) => {
      glow.update(makeStepBuilder().build(0), makeSignals({ drive: 0.5, brightness: 0.5, impact }));
      const r = new FakeRenderer();
      glow.draw(r, testViewport);
      return drawSpriteCalls(r).map((c) => c.transforms[0]!.alpha);
    };
    expect(lire(1)).toEqual(lire(0));
  });

  it('sans frappe, le diametre est celui d\'avant ce chantier', () => {
    // La promesse du drapeau, verifiee dans les DEUX positions : `impact` a
    // zero, le halo doit valoir exactement `diameter * (1 + tension * 0,55)`.
    const glow = new CentralGlow();
    glow.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    glow.params = { diameter: 0.5 };
    glow.update(makeStepBuilder().build(0), makeSignals({ drive: 1, impact: 0, tension: 0 }));
    const r = new FakeRenderer();
    glow.draw(r, testViewport);
    expect(drawSpriteCalls(r)[0]!.transforms[0]!.scale).toBeCloseTo(0.5, 9);
  });
});
