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
