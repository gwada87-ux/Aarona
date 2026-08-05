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
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

const DEFAULT_POOL_SIZE = 2500;

describe('createFieldStyle — composition', () => {
  it('4 couches dans l\'ordre : frameFeedback, deepVignette, perspectiveGrid, particleField', () => {
    const scene = createFieldStyle();
    expect(scene.layers.map((l) => l.id)).toEqual(['frameFeedback', 'deepVignette', 'perspectiveGrid', 'particleField']);
    expect(scene.layers).toHaveLength(4);
  });

  it('les instances sont bien des VRAIES classes attendues (pas juste des id qui coïncident)', () => {
    const scene = createFieldStyle();
    expect(scene.layers[0]).toBeInstanceOf(FrameFeedback);
    expect(scene.layers[1]).toBeInstanceOf(DeepVignette);
    expect(scene.layers[2]).toBeInstanceOf(PerspectiveGrid);
    expect(scene.layers[3]).toBeInstanceOf(ParticleField);
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
