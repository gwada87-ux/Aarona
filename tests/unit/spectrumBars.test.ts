import { describe, expect, it } from 'vitest';
import { SpectrumBars } from '../../src/visual/layers/spectrum/SpectrumBars';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import { validatePmdi } from '../../src/music/validatePmdi';
import { BAND_IDS } from '../../src/music/StepContext';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals } from './testSupport/stepContextFixture';
import type { PmdiDocument } from '../../src/music/pmdi';

/** Toutes les bandes constantes à `value`, pour cibler une convergence connue. */
function stepperWithConstantBands(value: number): StepContextBuilder {
  const doc: PmdiDocument = {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 10, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [],
    features: BAND_IDS.map((id) => ({ id: `band.${id}`, hz: 1, t0: 0, data: Array(11).fill(value) })),
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
  expect(validatePmdi(doc).ok).toBe(true);
  return new StepContextBuilder(buildMusicTimeline(doc), 1);
}

/** Bandes à 1.0 jusqu'à t=5s, puis 0 — transition nette (hz élevé) pour isoler la chute du pic. */
function stepperWithDroppingBands(): StepContextBuilder {
  const sampleCount = 1001; // hz=100 sur 10s
  const data = Array.from({ length: sampleCount }, (_, i) => (i < 500 ? 1 : 0));
  const doc: PmdiDocument = {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 10, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [],
    features: BAND_IDS.map((id) => ({ id: `band.${id}`, hz: 100, t0: 0, data: [...data] })),
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
  expect(validatePmdi(doc).ok).toBe(true);
  return new StepContextBuilder(buildMusicTimeline(doc), 1);
}

function fillPathCalls(renderer: FakeRenderer) {
  return renderer.calls.filter((c): c is Extract<typeof c, { type: 'fillPath' }> => c.type === 'fillPath');
}

describe('SpectrumBars — forme générale', () => {
  it('dessine 3 fillPath par bande (barre, réflexion, pic) + 1 drawSprite groupé (glow)', () => {
    const bars = new SpectrumBars();
    bars.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = stepperWithConstantBands(0.5);
    bars.update(stepper.build(0), makeSignals());

    const renderer = new FakeRenderer();
    bars.draw(renderer, testViewport);
    expect(fillPathCalls(renderer)).toHaveLength(BAND_IDS.length * 3);
    const sprites = renderer.calls.filter((c) => c.type === 'drawSprite');
    expect(sprites).toHaveLength(1);
    if (sprites[0]?.type === 'drawSprite') expect(sprites[0].count).toBe(BAND_IDS.length);
  });
});

describe('SpectrumBars — lissage asymétrique par bande', () => {
  it('converge vers la valeur constante de step.bands avec assez de temps', () => {
    const bars = new SpectrumBars();
    bars.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = stepperWithConstantBands(0.8);

    let step = stepper.build(0);
    for (let t = 1 / 120; t <= 2.0; t += 1 / 120) {
      step = stepper.build(t);
      bars.update(step, makeSignals());
    }

    const renderer = new FakeRenderer();
    bars.draw(renderer, testViewport);
    // barre principale de la bande 0 = premier appel fillPath (voir SpectrumBars.draw : bar, reflet, pic, par bande)
    const mainBarYs = fillPathCalls(renderer)[0]!.ys;
    const height = Math.max(...Array.from(mainBarYs)) - (-0.05); // BASELINE = -0.05
    expect(height).toBeCloseTo(0.8 * 0.42, 1); // MAX_HEIGHT = 0.42, tolérance large (asymptote exponentielle)
  });
});

describe('SpectrumBars — pics à chute gravitaire', () => {
  it('le pic retombe plus lentement que la barre après une chute nette du signal', () => {
    const bars = new SpectrumBars();
    bars.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = stepperWithDroppingBands(); // bandes à 1.0 jusqu'à t=5s, puis 0

    // dépasse la chute d'une durée = fallTau (0,35s) : la barre (Continuous) est retombée à
    // exp(-1) ≈ 37% de son maximum ; le pic, en chute libre (accélération constante,
    // 0,5·g·t²) depuis le sommet, ne peut pas être descendu de plus de 0,5·1,3·0,35² ≈ 0,08.
    let step = stepper.build(0);
    for (let t = 1 / 120; t <= 5.35; t += 1 / 120) {
      step = stepper.build(t);
      bars.update(step, makeSignals());
    }

    const renderer = new FakeRenderer();
    bars.draw(renderer, testViewport);
    const barTopY = fillPathCalls(renderer)[0]!.ys[2]!; // sommet de la barre principale (bande 0)
    const peakTopY = fillPathCalls(renderer)[2]!.ys[2]!; // sommet du pic (bande 0)
    const BASELINE = -0.05;
    const MAX_HEIGHT = 0.42;

    expect((barTopY - BASELINE) / MAX_HEIGHT).toBeLessThan(0.45); // barre bien retombée
    expect((peakTopY - BASELINE) / MAX_HEIGHT).toBeGreaterThan(0.85); // pic encore presque au sommet
  });
});

describe('SpectrumBars — params (Étape 20, macros densité/mouvement/profondeur/glow/chaos/douceur)', () => {
  it('params.gap plus petit → barres plus larges (densité)', () => {
    const stepper = stepperWithConstantBands(0.5);

    function firstBarWidth(gap: number | undefined): number {
      const bars = new SpectrumBars();
      bars.init({ renderer: new FakeRenderer(), palette: defaultPalette });
      if (gap !== undefined) bars.params = { gap };
      bars.update(stepper.build(0), makeSignals());
      const renderer = new FakeRenderer();
      bars.draw(renderer, testViewport);
      const xs = fillPathCalls(renderer)[0]!.xs;
      return Math.max(...Array.from(xs)) - Math.min(...Array.from(xs));
    }

    expect(firstBarWidth(0.002)).toBeGreaterThan(firstBarWidth(0.014));
  });

  it('params absent → largeur inchangée par rapport au gap par défaut (0,006)', () => {
    const stepper1 = stepperWithConstantBands(0.5);
    const stepper2 = stepperWithConstantBands(0.5);

    function firstBarWidth(withParams: boolean, stepper: StepContextBuilder): number {
      const bars = new SpectrumBars();
      bars.init({ renderer: new FakeRenderer(), palette: defaultPalette });
      if (withParams) bars.params = { gap: 0.006 };
      bars.update(stepper.build(0), makeSignals());
      const renderer = new FakeRenderer();
      bars.draw(renderer, testViewport);
      const xs = fillPathCalls(renderer)[0]!.xs;
      return Math.max(...Array.from(xs)) - Math.min(...Array.from(xs));
    }

    expect(firstBarWidth(false, stepper1)).toBeCloseTo(firstBarWidth(true, stepper2), 9);
  });

  it('params.riseTau plus court → convergence plus rapide vers la cible (mouvement)', () => {
    function heightAfter(riseTau: number): number {
      const bars = new SpectrumBars();
      bars.init({ renderer: new FakeRenderer(), palette: defaultPalette });
      bars.params = { riseTau };
      const stepper = stepperWithConstantBands(1.0);
      let step = stepper.build(0);
      for (let t = 1 / 120; t <= 0.05; t += 1 / 120) {
        step = stepper.build(t);
        bars.update(step, makeSignals());
      }
      const renderer = new FakeRenderer();
      bars.draw(renderer, testViewport);
      return Math.max(...Array.from(fillPathCalls(renderer)[0]!.ys)) - -0.05;
    }

    expect(heightAfter(0.02)).toBeGreaterThan(heightAfter(0.09));
  });

  it('params.reflectionAlpha plus élevé → reflet plus opaque', () => {
    const stepper = stepperWithConstantBands(0.5);

    function reflectionAlphaOf(reflectionAlpha: number): number {
      const bars = new SpectrumBars();
      bars.init({ renderer: new FakeRenderer(), palette: defaultPalette });
      bars.params = { reflectionAlpha };
      bars.update(stepper.build(0), makeSignals());
      const renderer = new FakeRenderer();
      bars.draw(renderer, testViewport);
      return fillPathCalls(renderer)[1]!.color.a; // 2e fillPath par bande = le reflet
    }

    expect(reflectionAlphaOf(0.4)).toBeGreaterThan(reflectionAlphaOf(0.1));
  });

  it('params.glowAlphaMul réduit proportionnellement l\'alpha du halo par bande', () => {
    const stepper1 = stepperWithConstantBands(0.5);
    const stepper2 = stepperWithConstantBands(0.5);

    function glowAlpha(glowAlphaMul: number | undefined, stepper: StepContextBuilder): number {
      const bars = new SpectrumBars();
      bars.init({ renderer: new FakeRenderer(), palette: defaultPalette });
      if (glowAlphaMul !== undefined) bars.params = { glowAlphaMul };
      let step = stepper.build(0);
      for (let t = 1 / 120; t <= 2.0; t += 1 / 120) {
        step = stepper.build(t);
        bars.update(step, makeSignals());
      }
      const renderer = new FakeRenderer();
      bars.draw(renderer, testViewport);
      const sprite = renderer.calls.find((c): c is Extract<typeof c, { type: 'drawSprite' }> => c.type === 'drawSprite')!;
      return sprite.transforms[0]!.alpha;
    }

    const base = glowAlpha(undefined, stepper1);
    const scaled = glowAlpha(0.2, stepper2);
    expect(scaled).toBeCloseTo(base * 0.2, 3);
  });

  it('params.peakChaosJitter=0 (défaut) : deux exécutions identiques (même graine) donnent le même résultat', () => {
    function run(): number {
      const bars = new SpectrumBars();
      bars.init({ renderer: new FakeRenderer(), palette: defaultPalette });
      const stepper = stepperWithDroppingBands();
      let step = stepper.build(0);
      for (let t = 1 / 120; t <= 5.35; t += 1 / 120) {
        step = stepper.build(t);
        bars.update(step, makeSignals());
      }
      const renderer = new FakeRenderer();
      bars.draw(renderer, testViewport);
      return fillPathCalls(renderer)[2]!.ys[2]!;
    }
    expect(run()).toBe(run());
  });
});

describe('SpectrumBars — reset', () => {
  it('reset() ramène toutes les barres et pics à 0', () => {
    const bars = new SpectrumBars();
    bars.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const stepper = stepperWithConstantBands(1.0);
    let step = stepper.build(0);
    for (let t = 1 / 120; t <= 0.5; t += 1 / 120) {
      step = stepper.build(t);
      bars.update(step, makeSignals());
    }
    bars.reset(0);

    const renderer = new FakeRenderer();
    bars.draw(renderer, testViewport);
    const mainBarYs = fillPathCalls(renderer)[0]!.ys;
    const height = Math.max(...Array.from(mainBarYs)) - (-0.05);
    expect(height).toBeCloseTo(0, 6);
  });
});
