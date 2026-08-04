import { describe, expect, it } from 'vitest';
import { FrameFeedback } from '../../src/visual/layers/postfx/FrameFeedback';
import { Scene } from '../../src/visual/scene/Scene';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';

describe('FrameFeedback', () => {
  it('draw() appelle renderer.drawFeedback(1.004, 0.88) — docs/07 §Field', () => {
    const layer = new FrameFeedback();
    layer.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const renderer = new FakeRenderer();
    renderer.feedbackCaptured = true; // simule un buffer déjà capturé, pour voir l'appel enregistré
    layer.draw(renderer, testViewport);

    const call = renderer.calls.find((c) => c.type === 'drawFeedback');
    expect(call).toEqual({ type: 'drawFeedback', scale: 1.004, alpha: 0.88 });
  });

  it('needsDrawPriming = true (état de framebuffer, docs/02 §Layer)', () => {
    expect(new FrameFeedback().needsDrawPriming).toBe(true);
  });
});

describe('Scene — usesFeedback', () => {
  it('capture le feedback APRÈS toutes les couches quand usesFeedback=true', () => {
    const scene = new Scene([new FrameFeedback()], true);
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const renderer = new FakeRenderer();
    scene.draw(renderer, testViewport);

    const types = renderer.calls.map((c) => c.type);
    expect(types.at(-1)).toBe('captureFeedback');
  });

  it('n\'appelle jamais captureFeedback quand usesFeedback=false (par défaut)', () => {
    const scene = new Scene([new FrameFeedback()]);
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    const renderer = new FakeRenderer();
    scene.draw(renderer, testViewport);

    expect(renderer.calls.some((c) => c.type === 'captureFeedback')).toBe(false);
  });
});
