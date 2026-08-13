/**
 * Mémoire visuelle (blueprint §F1, chantier P0 n°2). Le test qui porte tout le
 * chantier est celui de la LOI 1 : « après un saut, la même image ». Un tampon
 * qui se contenterait d'accumuler au fil des `update()` le raterait, et c'est
 * précisément le défaut que ce module existe pour éviter.
 */
import { describe, expect, it } from 'vitest';
import { TRACE_CRATER, TRACE_DUST, TRACE_SCAR, TraceField, confidenceRamp } from '../../src/visual/memory/TraceField';
import { TraceMarks } from '../../src/visual/layers/memory/TraceMarks';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';
import type { MusicEvent } from '../../src/music/pmdi';
import type { StepContextBuilder } from '../../src/music/StepContext';

/** 120 BPM, 4/4 : une mesure = 2 s. Kick à chaque temps, snare aux temps 2 et 4, hat aux croches. */
function motif(dureeSec = 40): MusicEvent[] {
  const evts: MusicEvent[] = [];
  const parTemps = 0.5;
  for (let beat = 0; beat * parTemps < dureeSec; beat++) {
    const t = beat * parTemps;
    if (beat % 4 === 0) evts.push({ t, type: 'KICK', intensity: 0.9, confidence: 0.95 });
    if (beat % 4 === 1 || beat % 4 === 3) evts.push({ t, type: 'SNARE', intensity: 0.7, confidence: 0.9 });
    evts.push({ t, type: 'HAT', intensity: 0.4, confidence: 0.9 });
    evts.push({ t: t + parTemps / 2, type: 'HAT', intensity: 0.3, confidence: 0.9 });
  }
  return evts.sort((a, b) => a.t - b.t);
}

/**
 * Lit le champ pas à pas de 0 à `jusquA` INCLUS, comme une lecture continue.
 *
 * L'itération se fait sur l'INDICE de sous-pas, pas par accumulation de
 * `t += 1/120`. Écrit d'abord de la seconde façon, les tests de la Loi 1
 * échouaient : la boucle s'arrêtait un sous-pas AVANT la cible pendant que la
 * reconstruction tombait SUR la cible, et les deux instantanés comparés
 * n'étaient donc pas pris au même instant (restes de vie décalés de 1/120e de
 * mesure, et un événement de plus d'un côté). Le harnais était faux, pas le
 * module — mais l'écart de 0,0005 qu'il montrait disait déjà que le mécanisme
 * était juste à un sous-pas près.
 */
function lireEnContinu(field: TraceField, builder: StepContextBuilder, jusquA: number): void {
  const dernier = Math.round(jusquA * 120);
  for (let i = 0; i <= dernier; i++) field.update(builder.build(i / 120));
}

/** Instantané comparable du champ : ce que la couche dessinerait. */
function instantane(field: TraceField): string {
  const lignes: string[] = [];
  for (let i = 0; i < field.count; i++) {
    const reste = field.remaining(i);
    if (reste <= 0) continue;
    lignes.push(`${field.kinds[i]}|${field.xs[i]!.toFixed(4)}|${field.ys[i]!.toFixed(4)}|${reste.toFixed(4)}|${field.amplitudes[i]!.toFixed(4)}`);
  }
  return lignes.sort().join('\n');
}

describe('TraceField — Loi 3, la rampe de confiance de docs/06', () => {
  it('0 sous 0,60 ; linéaire jusqu\'à 0,85 ; 1 au-dessus', () => {
    expect(confidenceRamp(0.59)).toBe(0);
    expect(confidenceRamp(0.6)).toBeCloseTo(0, 9);
    expect(confidenceRamp(0.725)).toBeCloseTo(0.5, 9);
    expect(confidenceRamp(0.85)).toBe(1);
    expect(confidenceRamp(1)).toBe(1);
  });

  it('un événement sous le seuil ne grave RIEN, il ne prend même pas de place', () => {
    const field = new TraceField();
    const builder = makeStepBuilder([{ t: 0.1, type: 'KICK', intensity: 1, confidence: 0.4 }]);
    lireEnContinu(field, builder, 1);
    expect(field.count).toBe(0);
  });

  it('l\'amplitude vaut intensity × rampe(confidence)', () => {
    const field = new TraceField();
    const builder = makeStepBuilder([{ t: 0.1, type: 'KICK', intensity: 0.8, confidence: 0.725 }]);
    lireEnContinu(field, builder, 1);
    expect(field.count).toBe(1);
    expect(field.amplitudes[0]!).toBeCloseTo(0.8 * 0.5, 5);
  });
});

describe('TraceField — familles et durées de vie', () => {
  it('kick → cratère, snare → cicatrice, hat → poussière', () => {
    const field = new TraceField();
    const builder = makeStepBuilder([
      { t: 0.1, type: 'KICK', intensity: 1, confidence: 1 },
      { t: 0.2, type: 'SNARE', intensity: 1, confidence: 1 },
      { t: 0.3, type: 'HAT', intensity: 1, confidence: 1 },
    ]);
    lireEnContinu(field, builder, 1);
    expect([...field.kinds.slice(0, 3)]).toEqual([TRACE_CRATER, TRACE_SCAR, TRACE_DUST]);
  });

  it('les repères de grille et les macro-états ne gravent rien', () => {
    const field = new TraceField();
    const builder = makeStepBuilder([
      { t: 0.1, type: 'DOWNBEAT', intensity: 1, confidence: 1 },
      { t: 0.2, type: 'BEAT', intensity: 1, confidence: 1 },
      { t: 0.3, type: 'PHRASE', intensity: 1, confidence: 1 },
    ]);
    lireEnContinu(field, builder, 1);
    expect(field.count).toBe(0);
  });

  it('la poussière meurt en 2 mesures, la cicatrice en 4, le cratère en 8', () => {
    // 120 BPM, 4/4 : une mesure = 2 s. Un seul événement de chaque à t = 0,1.
    const builder = makeStepBuilder([
      { t: 0.1, type: 'KICK', intensity: 1, confidence: 1 },
      { t: 0.1, type: 'SNARE', intensity: 1, confidence: 1 },
      { t: 0.1, type: 'HAT', intensity: 1, confidence: 1 },
    ], 40);
    const vivants = (jusquA: number) => {
      const field = new TraceField();
      lireEnContinu(field, builder, jusquA);
      const kinds: number[] = [];
      for (let i = 0; i < field.count; i++) if (field.remaining(i) > 0) kinds.push(field.kinds[i]!);
      return kinds.sort();
    };
    expect(vivants(1), 'à 0,5 mesure, les trois sont là').toEqual([TRACE_CRATER, TRACE_SCAR, TRACE_DUST]);
    expect(vivants(5), 'à 2,5 mesures, la poussière est partie').toEqual([TRACE_CRATER, TRACE_SCAR]);
    expect(vivants(9), 'à 4,5 mesures, la cicatrice aussi').toEqual([TRACE_CRATER]);
    expect(vivants(17), 'à 8,5 mesures, plus rien').toEqual([]);
  });

  it('la décroissance se compte en MESURES, pas en secondes : moitié du tempo, moitié plus lent', () => {
    // Le même champ à la même POSITION MUSICALE doit avoir le même reste de vie,
    // que le morceau tourne à 120 ou à 60 BPM.
    const evt: MusicEvent[] = [{ t: 0.1, type: 'KICK', intensity: 1, confidence: 1 }];
    const rapide = new TraceField();
    lireEnContinu(rapide, makeStepBuilder(evt, 40), 4); // 2 mesures à 120 BPM
    const restant = rapide.remaining(0);
    expect(restant).toBeGreaterThan(0.7);
    expect(restant).toBeLessThan(0.8); // ~1 - 2/8 corrigé du décalage de 0,1 s
  });
});

describe('TraceField — LOI 1 : après un saut, la même image', () => {
  it('reconstruction depuis la timeline ≡ lecture continue, au même instant', () => {
    const evts = motif(40);
    const cible = 24.5; // plus de 12 mesures : hors de portée d'un `primeScene` de 2 s

    const continu = new TraceField();
    lireEnContinu(continu, makeStepBuilder(evts, 40), cible);

    // Le chemin « saut » : champ neuf, marqué périmé, un seul `update` à la cible.
    const apresSaut = new TraceField();
    apresSaut.markStale();
    apresSaut.update(makeStepBuilder(evts, 40).build(cible));

    expect(instantane(apresSaut)).toBe(instantane(continu));
  });

  it('...et ce n\'est pas trivialement vrai parce que le champ serait vide', () => {
    const evts = motif(40);
    const field = new TraceField();
    field.markStale();
    field.update(makeStepBuilder(evts, 40).build(24.5));
    let vivants = 0;
    for (let i = 0; i < field.count; i++) if (field.remaining(i) > 0) vivants++;
    expect(vivants, 'un motif ordinaire doit laisser des dizaines d\'empreintes').toBeGreaterThan(20);
  });

  it('la position d\'une empreinte ne dépend PAS du sous-pas où elle est déposée', () => {
    // C'est ce qui rend la reconstruction possible : si la position venait de
    // `step.rng`, une empreinte reconstruite (toutes au même sous-pas) tomberait
    // ailleurs que la même empreinte déposée en lecture.
    const evt: MusicEvent[] = [{ t: 7.3, type: 'KICK', intensity: 1, confidence: 1 }];
    const a = new TraceField();
    lireEnContinu(a, makeStepBuilder(evt, 40), 8);
    const b = new TraceField();
    b.markStale();
    b.update(makeStepBuilder(evt, 40).build(8));
    expect(b.xs[0]).toBe(a.xs[0]);
    expect(b.ys[0]).toBe(a.ys[0]);
    expect(b.angles[0]).toBe(a.angles[0]);
  });

  it('deux morceaux différents ne gravent pas au même endroit', () => {
    const a = new TraceField();
    lireEnContinu(a, makeStepBuilder([{ t: 1.0, type: 'KICK', intensity: 1, confidence: 1 }], 40), 2);
    const b = new TraceField();
    lireEnContinu(b, makeStepBuilder([{ t: 1.25, type: 'KICK', intensity: 1, confidence: 1 }], 40), 2);
    expect(b.xs[0]).not.toBe(a.xs[0]);
  });
});

describe('TraceField — tampon circulaire', () => {
  it('au-delà de la capacité, c\'est la PLUS ANCIENNE qui saute', () => {
    const field = new TraceField(4);
    const evts: MusicEvent[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((t) => ({ t, type: 'HAT', intensity: 1, confidence: 1 }));
    lireEnContinu(field, makeStepBuilder(evts, 40), 1);
    expect(field.count).toBe(4);
    // Les deux premières ont été écrasées : leurs positions ne doivent plus être là.
    const attendu = new TraceField(16);
    lireEnContinu(attendu, makeStepBuilder(evts, 40), 1);
    const restantes = new Set<number>();
    for (let i = 0; i < field.count; i++) restantes.add(field.xs[i]!);
    expect(restantes.has(attendu.xs[0]!), 'la plus ancienne devrait avoir saute').toBe(false);
    expect(restantes.has(attendu.xs[5]!), 'la plus recente doit etre la').toBe(true);
  });

  it('aucune allocation par image : les tableaux sont dimensionnés une fois', () => {
    const field = new TraceField(8);
    expect(field.xs.length).toBe(8);
    expect(field.kinds.length).toBe(8);
    lireEnContinu(field, makeStepBuilder(motif(20), 20), 20);
    expect(field.xs.length).toBe(8);
  });
});

describe('TraceMarks — la couche de preuve', () => {
  function dessiner(jusquA: number): FakeRenderer {
    const layer = new TraceMarks();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const builder = makeStepBuilder(motif(40), 40);
    for (let i = 0; i <= Math.round(jusquA * 120); i++) layer.update(builder.build(i / 120), makeSignals());
    const renderer = new FakeRenderer();
    layer.draw(renderer, testViewport);
    return renderer;
  }

  it('dessine les trois familles : cercles, segments, sprites', () => {
    const calls = dessiner(3).calls;
    expect(calls.filter((c) => c.type === 'strokeCircle').length, 'crateres').toBeGreaterThan(0);
    expect(calls.filter((c) => c.type === 'strokePath').length, 'cicatrices').toBeGreaterThan(0);
    expect(calls.filter((c) => c.type === 'drawSprite').length, 'poussiere').toBe(1);
  });

  it('toute la poussière part en UN SEUL appel de sprite (docs/10)', () => {
    const sprites = dessiner(3).calls.filter((c) => c.type === 'drawSprite');
    expect(sprites).toHaveLength(1);
    expect(sprites[0]!.count).toBeGreaterThan(1);
  });

  it('la retenue est tenue : aucune empreinte au-dessus de 0,30 d\'alpha', () => {
    for (const call of dessiner(3).calls) {
      if (call.type === 'strokeCircle' || call.type === 'strokePath') expect(call.color.a).toBeLessThanOrEqual(0.3);
      if (call.type === 'drawSprite') for (const t of call.transforms) expect(t.alpha).toBeLessThanOrEqual(0.3);
    }
  });

  it('les empreintes restent dans le cadre', () => {
    for (const call of dessiner(6).calls) {
      if (call.type === 'strokeCircle') {
        expect(Math.abs(call.x)).toBeLessThan(0.8);
        expect(Math.abs(call.y)).toBeLessThan(0.45);
      }
    }
  });

  it('une scène neuve ne dessine rien tant qu\'aucun événement n\'est passé', () => {
    const layer = new TraceMarks();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    layer.update(makeStepBuilder([], 40).build(0), makeSignals());
    const renderer = new FakeRenderer();
    layer.draw(renderer, testViewport);
    expect(renderer.calls).toHaveLength(0);
  });

  it('`traceAlpha` à 0 éteint la couche sans rien dessiner', () => {
    const layer = new TraceMarks();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const builder = makeStepBuilder(motif(40), 40);
    for (let i = 0; i <= 360; i++) layer.update(builder.build(i / 120), makeSignals());
    layer.params = { traceAlpha: 0 };
    const renderer = new FakeRenderer();
    layer.draw(renderer, testViewport);
    expect(renderer.calls).toHaveLength(0);
  });

  it('`reset(t)` ne vide pas : il demande une reconstruction', () => {
    const layer = new TraceMarks();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const builder = makeStepBuilder(motif(40), 40);
    for (let i = 0; i <= 360; i++) layer.update(builder.build(i / 120), makeSignals());
    const avant = instantane(layer.field);

    layer.reset(3);
    layer.update(builder.build(3), makeSignals());
    expect(instantane(layer.field)).toBe(avant);
  });
});
