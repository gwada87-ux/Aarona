/**
 * Tests de `visual/layers/waveform/FlatWaveform.ts` — Étape 38. Waveform du
 * style Spectrum Pro, jamais testée. Même principe que
 * `circularWaveform.test.ts` (bandes différenciées via `features` explicites),
 * mais ce fichier vise spécifiquement les DEUX différences documentées face
 * à `CircularWaveform` : un secteur CLAMPÉ en bout de piste (pas de bouclage
 * modulo — `Math.min`, pas `% bandCount`), et une alpha FORCÉE à 0,4 dans la
 * couleur dessinée quelle que soit `palette.secondary.a`.
 *
 * `SEGMENTS=96`, `AMPLITUDE=0.05`, `LINE_ALPHA=0.4` ne sont pas exportées :
 * reprises en dur (même convention qu'aux Étapes 34/37/38).
 */
import { describe, expect, it } from 'vitest';
import { FlatWaveform } from '../../src/visual/layers/waveform/FlatWaveform';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder, BAND_IDS } from '../../src/music/StepContext';
import { validatePmdi } from '../../src/music/validatePmdi';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals } from './testSupport/stepContextFixture';
import type { PmdiDocument } from '../../src/music/pmdi';
import type { BandId } from '../../src/music/StepContext';

const SEGMENTS = 96;
const AMPLITUDE = 0.05;

/** Une valeur constante par bande, choisie individuellement via `values`. */
function stepperWithBands(values: Partial<Record<BandId, number>>): StepContextBuilder {
  const doc: PmdiDocument = {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 10, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [],
    features: BAND_IDS.map((id) => ({ id: `band.${id}`, hz: 1, t0: 0, data: [values[id] ?? 0] })),
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
  expect(validatePmdi(doc).ok).toBe(true);
  return new StepContextBuilder(buildMusicTimeline(doc), 1);
}

function strokePathCall(renderer: FakeRenderer) {
  const calls = renderer.calls.filter((c): c is Extract<typeof c, { type: 'strokePath' }> => c.type === 'strokePath');
  expect(calls).toHaveLength(1);
  return calls[0]!;
}

describe('FlatWaveform — forme générale', () => {
  it('dessine exactement un strokePath OUVERT, 96 segments, lineWidth 0.0018', () => {
    const waveform = new FlatWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    waveform.update(stepperWithBands({}).build(0), makeSignals());

    const renderer = new FakeRenderer();
    waveform.draw(renderer, testViewport);
    const call = strokePathCall(renderer);

    expect(call.count).toBe(SEGMENTS);
    expect(call.closed).toBe(false);
    expect(call.lineWidth).toBe(0.0018);
  });

  it("couleur : RGB de palette.secondary, mais alpha FORCÉE à 0.4 (indépendante de palette.secondary.a)", () => {
    const waveform = new FlatWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    waveform.update(stepperWithBands({}).build(0), makeSignals());

    const renderer = new FakeRenderer();
    waveform.draw(renderer, testViewport);
    const call = strokePathCall(renderer);

    const c = defaultPalette.secondary;
    expect(call.color).toEqual({ r: c.r, g: c.g, b: c.b, a: 0.4 });
    expect(c.a).toBe(1); // la palette par défaut a bien alpha=1 : la valeur 0.4 vient donc bien d'un forçage, pas d'un passe-plat
  });
});

describe('FlatWaveform — abscisses (déplié horizontalement, pas de cercle)', () => {
  it('xs suit -0.5 + (i/(SEGMENTS-1))*1.0 : vérifié aux bornes et à un point interne', () => {
    const waveform = new FlatWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    waveform.update(stepperWithBands({}).build(0), makeSignals());

    const renderer = new FakeRenderer();
    waveform.draw(renderer, testViewport);
    const call = strokePathCall(renderer);

    const expectedAt = (i: number): number => -0.5 + (i / (SEGMENTS - 1)) * 1.0;
    expect(call.xs[0]).toBeCloseTo(expectedAt(0), 6);
    expect(call.xs[SEGMENTS - 1]).toBeCloseTo(expectedAt(SEGMENTS - 1), 6);
    expect(call.xs[47]).toBeCloseTo(expectedAt(47), 6);
  });
});

describe('FlatWaveform — secteurs CLAMPÉS (pas de bouclage, contrairement à CircularWaveform)', () => {
  it('segment 0 (frac=0, secteur pur "sub") : ys reflète bandValue = bands.sub', () => {
    const waveform = new FlatWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    waveform.update(stepperWithBands({ sub: 1 }).build(0), makeSignals());

    const renderer = new FakeRenderer();
    waveform.draw(renderer, testViewport);
    const call = strokePathCall(renderer);

    // sectorPos = 0 -> i0=0='sub', localFrac=0 -> bandValue = bands.sub = 1
    expect(call.ys[0]).toBeCloseTo((1 - 0.5) * 2 * AMPLITUDE, 6);
  });

  it('dernier segment (frac=1, sectorPos=6) : i0 ET i1 clampés à "high" (index 5), pas de bouclage vers "sub"', () => {
    const waveform = new FlatWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    // sub=0, high=1 : si CLAMPÉ (réel), i1=i0='high' -> bandValue=1 -> ys>0. Si un bouclage vers
    // 'sub' existait (comme CircularWaveform), i1='sub'=0 -> bandValue=lerp(1,0,1)=0 -> ys<0.
    // Les deux hypothèses donnent des signes OPPOSÉS : ce test les distingue sans ambiguïté.
    waveform.update(stepperWithBands({ sub: 0, high: 1 }).build(0), makeSignals());

    const renderer = new FakeRenderer();
    waveform.draw(renderer, testViewport);
    const call = strokePathCall(renderer);

    // Si CLAMPÉ (comportement réel) : i0=i1=5='high' -> bandValue = bands.high = 1, PAS lerp(high, sub, frac).
    expect(call.ys[SEGMENTS - 1]).toBeCloseTo((1 - 0.5) * 2 * AMPLITUDE, 6);
  });
});

describe('FlatWaveform — reset()/dispose()', () => {
  it('ne lèvent pas', () => {
    const waveform = new FlatWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    expect(() => waveform.reset(0)).not.toThrow();
    expect(() => waveform.dispose()).not.toThrow();
  });
});
