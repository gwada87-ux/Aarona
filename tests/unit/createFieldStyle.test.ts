/**
 * Tests de `visual/styles/field/createFieldStyle.ts` — Étape 39. Jamais
 * testée directement (seul `createPulseStyle` est exercé, indirectement,
 * par `exportPipeline.test.ts`). La mécanique générique de `Scene`
 * (délégation init/update/draw/reset/dispose, `usesFeedback` ->
 * `captureFeedback`) est déjà couverte par `scene.test.ts`/
 * `frameFeedback.test.ts` — ce fichier cible UNIQUEMENT ce qui est propre à
 * cette fabrique : la composition exacte (quelles couches, dans quel ordre)
 * et le CÂBLAGE de ses deux paramètres (`maxParticles`, `feedbackEnabled`)
 * vers `ParticleField`/`Scene`.
 */
import { describe, expect, it } from 'vitest';
import { createFieldStyle } from '../../src/visual/styles/field/createFieldStyle';
import { FrameFeedback } from '../../src/visual/layers/postfx/FrameFeedback';
import { DeepVignette } from '../../src/visual/layers/background/DeepVignette';
import { PerspectiveGrid } from '../../src/visual/layers/field/PerspectiveGrid';
import { ParticleField } from '../../src/visual/layers/particles/ParticleField';
import { TraceMarks } from '../../src/visual/layers/memory/TraceMarks';
import { TRACE_FIELD_V1 } from '../../src/visual/memory/TraceField';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

const DEFAULT_POOL_SIZE = 2500;

/**
 * Liste attendue, drapeau `TRACE_FIELD_V1` COMPRIS. La composition a
 * reellement change au chantier P0 n2 du blueprint (memoire visuelle) : ce test
 * est mis a jour parce que l'intention a change, pas pour le faire taire. Le
 * calcul depuis le drapeau est ce qui verrouille la promesse « drapeau eteint,
 * composition d'avant » - a `false`, ces deux tests exigent les 4 couches
 * d'origine, dans l'ordre d'origine.
 */
const COUCHES_ATTENDUES = TRACE_FIELD_V1
  ? ['frameFeedback', 'deepVignette', 'traceMarks', 'perspectiveGrid', 'particleField']
  : ['frameFeedback', 'deepVignette', 'perspectiveGrid', 'particleField'];

describe('createFieldStyle — composition', () => {
  it('les couches attendues, dans l\'ordre', () => {
    const scene = createFieldStyle();
    expect(scene.layers.map((l) => l.id)).toEqual(COUCHES_ATTENDUES);
    expect(scene.layers).toHaveLength(COUCHES_ATTENDUES.length);
  });

  it('les instances sont bien des VRAIES classes attendues (pas juste des id qui coïncident)', () => {
    const scene = createFieldStyle();
    const parId = new Map(scene.layers.map((l) => [l.id, l]));
    expect(parId.get('frameFeedback')).toBeInstanceOf(FrameFeedback);
    expect(parId.get('deepVignette')).toBeInstanceOf(DeepVignette);
    expect(parId.get('perspectiveGrid')).toBeInstanceOf(PerspectiveGrid);
    expect(parId.get('particleField')).toBeInstanceOf(ParticleField);
    if (TRACE_FIELD_V1) expect(parId.get('traceMarks')).toBeInstanceOf(TraceMarks);
  });

  it('les empreintes sont gravees dans la surface : sous la grille et sous les particules', () => {
    if (!TRACE_FIELD_V1) return;
    const ids = createFieldStyle().layers.map((l) => l.id);
    expect(ids.indexOf('traceMarks')).toBeLessThan(ids.indexOf('perspectiveGrid'));
    expect(ids.indexOf('traceMarks')).toBeLessThan(ids.indexOf('particleField'));
    // APRES le feedback, volontairement : les empreintes entrent dans la trainee.
    expect(ids.indexOf('traceMarks')).toBeGreaterThan(ids.indexOf('frameFeedback'));
  });
});

describe('createFieldStyle — feedbackEnabled câblé vers Scene.usesFeedback', () => {
  function draw(scene: ReturnType<typeof createFieldStyle>): FakeRenderer {
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    scene.update(makeStepBuilder().build(0), makeSignals());
    const renderer = new FakeRenderer();
    scene.draw(renderer, testViewport);
    return renderer;
  }

  it('omis (défaut) : équivaut à true -> captureFeedback() appelé', () => {
    const renderer = draw(createFieldStyle());
    expect(renderer.calls.some((c) => c.type === 'captureFeedback')).toBe(true);
  });

  it('feedbackEnabled=false : captureFeedback() jamais appelé', () => {
    const renderer = draw(createFieldStyle(undefined, false));
    expect(renderer.calls.some((c) => c.type === 'captureFeedback')).toBe(false);
  });
});

describe('createFieldStyle — maxParticles câblé vers ParticleField', () => {
  function particleField(scene: ReturnType<typeof createFieldStyle>): ParticleField {
    const layer = scene.layers.find((l) => l.id === 'particleField');
    return layer as ParticleField;
  }

  it('omis (défaut) : capacité = DEFAULT_POOL_SIZE (2500)', () => {
    const stats = particleField(createFieldStyle()).particleStats!();
    expect(stats.capacity).toBe(DEFAULT_POOL_SIZE);
  });

  it('fourni : capacité = la valeur transmise, pas le défaut', () => {
    const stats = particleField(createFieldStyle(500)).particleStats!();
    expect(stats.capacity).toBe(500);
  });
});
