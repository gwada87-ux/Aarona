/**
 * Tests de `visual/layers/waveform/CircularWaveform.ts` — Étape 38. Waveform
 * du style Pulse, jamais testée. Comme `SpectrumBars.test.ts`, un
 * `PmdiDocument` avec des `features` explicites par bande permet de fixer
 * des valeurs DIFFÉRENTES par bande (`stepperWithBands`), condition
 * nécessaire pour vérifier le VRAI comportement d'interpolation/secteur —
 * une seule valeur constante pour toutes les bandes ne le distinguerait pas
 * d'un simple cercle.
 *
 * `SEGMENTS=64`, `BASE_RADIUS=0.4`, `DEFORM_AMPLITUDE=0.04`, `LINE_WIDTH=
 * 0.004` ne sont pas exportées : reprises en dur (même convention qu'aux
 * Étapes 34/37).
 */
import { describe, expect, it } from 'vitest';
import { CircularWaveform } from '../../src/visual/layers/waveform/CircularWaveform';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder, BAND_IDS } from '../../src/music/StepContext';
import { validatePmdi } from '../../src/music/validatePmdi';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals } from './testSupport/stepContextFixture';
import type { PmdiDocument } from '../../src/music/pmdi';
import type { BandId } from '../../src/music/StepContext';

const SEGMENTS = 64;
const BASE_RADIUS = 0.4;
const DEFORM_AMPLITUDE = 0.04;

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

function radiusAt(call: ReturnType<typeof strokePathCall>, i: number): number {
  return Math.hypot(call.xs[i]!, call.ys[i]!);
}

describe('CircularWaveform — forme générale', () => {
  it('dessine exactement un strokePath FERMÉ, 64 segments, lineWidth 0.004, couleur = palette.secondary', () => {
    const waveform = new CircularWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    waveform.update(stepperWithBands({}).build(0), makeSignals());

    const renderer = new FakeRenderer();
    waveform.draw(renderer, testViewport);
    const call = strokePathCall(renderer);

    expect(call.count).toBe(SEGMENTS);
    expect(call.closed).toBe(true);
    expect(call.lineWidth).toBe(0.004);
    expect(call.color).toEqual(defaultPalette.secondary);
  });
});

describe('CircularWaveform — déformation par bande (bandValue=0.5 -> rayon de base)', () => {
  it('toutes les bandes à 0.5 : rayon constant = BASE_RADIUS (0.4) sur tout le cercle', () => {
    const waveform = new CircularWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    waveform.update(stepperWithBands({ sub: 0.5, bass: 0.5, lowmid: 0.5, mid: 0.5, himid: 0.5, high: 0.5 }).build(0), makeSignals());

    const renderer = new FakeRenderer();
    waveform.draw(renderer, testViewport);
    const call = strokePathCall(renderer);

    for (let i = 0; i < SEGMENTS; i++) expect(radiusAt(call, i)).toBeCloseTo(BASE_RADIUS, 6);
  });
});

describe('CircularWaveform — secteurs (64 segments / 6 bandes, aux limites exactes)', () => {
  it('segment 0 (secteur pur "sub", frac=0) : rayon = BASE_RADIUS + amplitude max', () => {
    const waveform = new CircularWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    waveform.update(stepperWithBands({ sub: 1 }).build(0), makeSignals()); // autres bandes = 0

    const renderer = new FakeRenderer();
    waveform.draw(renderer, testViewport);
    const call = strokePathCall(renderer);

    // segment 0 : sectorPos=0 -> i0='sub', frac=0 -> bandValue = bands.sub = 1 -> deformation = +0.04
    expect(radiusAt(call, 0)).toBeCloseTo(BASE_RADIUS + DEFORM_AMPLITUDE, 6);
  });

  it('segment 32 (secteur pur "mid", frac=0, 64/6*3=32 exactement) : bandValue=0 -> rayon minimal', () => {
    const waveform = new CircularWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    waveform.update(stepperWithBands({ sub: 1 }).build(0), makeSignals()); // mid reste à 0

    const renderer = new FakeRenderer();
    waveform.draw(renderer, testViewport);
    const call = strokePathCall(renderer);

    // segment 32 : sectorPos = 6*32/64 = 3.0 exactement -> i0='mid' (index 3), frac=0 -> bandValue = bands.mid = 0
    expect(radiusAt(call, 32)).toBeCloseTo(BASE_RADIUS - DEFORM_AMPLITUDE, 6);
  });

  it('segment 63 (dernier) : le secteur suivant BOUCLE sur "sub" (modulo), pas de dépassement d\'index', () => {
    const waveform = new CircularWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    // high=0 (i0 au segment 63), sub=1 (i1 après bouclage) -> interpolation partielle vers 1.
    waveform.update(stepperWithBands({ high: 0, sub: 1 }).build(0), makeSignals());

    const renderer = new FakeRenderer();
    waveform.draw(renderer, testViewport);
    const call = strokePathCall(renderer);

    // sectorPos = 6*63/64 = 5.90625 -> i0=5 ('high'), i1=(5+1)%6=0 ('sub'), frac=0.90625
    const frac = 0.90625;
    const bandValue = 0 + (1 - 0) * frac; // lerp(high=0, sub=1, frac)
    const expectedRadius = BASE_RADIUS + (bandValue - 0.5) * 2 * DEFORM_AMPLITUDE;
    expect(radiusAt(call, 63)).toBeCloseTo(expectedRadius, 6);
  });
});

describe('CircularWaveform — reset()/dispose()', () => {
  it('ne lèvent pas', () => {
    const waveform = new CircularWaveform();
    waveform.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    expect(() => waveform.reset(0)).not.toThrow();
    expect(() => waveform.dispose()).not.toThrow();
  });
});
