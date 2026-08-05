/**
 * Tests de `visual/styles/spectrum-pro/createSpectrumProStyle.ts` — Étape 39.
 * Même principe que `createFieldStyle.test.ts` : la mécanique générique de
 * `Scene` est déjà couverte ailleurs (`scene.test.ts`/`frameFeedback.test.ts`)
 * — ce fichier cible uniquement la composition propre à cette fabrique, la
 * plus simple des trois styles (aucun paramètre à câbler, `usesFeedback`
 * jamais activé).
 */
import { describe, expect, it } from 'vitest';
import { createSpectrumProStyle } from '../../src/visual/styles/spectrum-pro/createSpectrumProStyle';
import { AnimatedDuotone } from '../../src/visual/layers/background/AnimatedDuotone';
import { SpectrumBars } from '../../src/visual/layers/spectrum/SpectrumBars';
import { FlatWaveform } from '../../src/visual/layers/waveform/FlatWaveform';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

describe('createSpectrumProStyle — composition', () => {
  it('3 couches dans l\'ordre : animatedDuotone, spectrumBars, flatWaveform', () => {
    const scene = createSpectrumProStyle();
    expect(scene.layers.map((l) => l.id)).toEqual(['animatedDuotone', 'spectrumBars', 'flatWaveform']);
    expect(scene.layers).toHaveLength(3);
  });

  it('les instances sont bien des VRAIES classes attendues (pas juste des id qui coïncident)', () => {
    const scene = createSpectrumProStyle();
    expect(scene.layers[0]).toBeInstanceOf(AnimatedDuotone);
    expect(scene.layers[1]).toBeInstanceOf(SpectrumBars);
    expect(scene.layers[2]).toBeInstanceOf(FlatWaveform);
  });
});

describe('createSpectrumProStyle — pas de feedback (aucun 2e argument transmis à Scene)', () => {
  it('captureFeedback() jamais appelé', () => {
    const scene = createSpectrumProStyle();
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    scene.update(makeStepBuilder().build(0), makeSignals());

    const renderer = new FakeRenderer();
    scene.draw(renderer, testViewport);
    expect(renderer.calls.some((c) => c.type === 'captureFeedback')).toBe(false);
  });
});
