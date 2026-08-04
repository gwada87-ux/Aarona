import { describe, expect, it } from 'vitest';
import { Scene } from '../../src/visual/scene/Scene';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../src/visual/scene/Layer';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

class SpyLayer implements Layer {
  readonly kind: LayerKind = 'background';
  readonly needsDrawPriming = false;
  params: LayerParams = {};
  readonly calls: string[] = [];

  constructor(readonly id: string) {}

  init(_ctx: LayerInitContext): void {
    this.calls.push('init');
  }
  update(): void {
    this.calls.push('update');
  }
  draw(): void {
    this.calls.push('draw');
  }
  reset(_t: number): void {
    this.calls.push('reset');
  }
  dispose(): void {
    this.calls.push('dispose');
  }
}

describe('Scene — délégation dans l\'ordre du tableau', () => {
  it('init/update/draw/reset/dispose appellent chaque couche, dans l\'ordre', () => {
    const a = new SpyLayer('a');
    const b = new SpyLayer('b');
    const scene = new Scene([a, b]);
    const order: string[] = [];
    const origADraw = a.draw.bind(a);
    const origBDraw = b.draw.bind(b);
    a.draw = () => {
      order.push('a');
      origADraw();
    };
    b.draw = () => {
      order.push('b');
      origBDraw();
    };

    const stepper = makeStepBuilder();
    const step = stepper.build(0);
    const signals = makeSignals();

    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    scene.update(step, signals);
    scene.draw(new FakeRenderer(), testViewport);
    scene.reset(1.5);
    scene.dispose();

    expect(a.calls).toEqual(['init', 'update', 'draw', 'reset', 'dispose']);
    expect(b.calls).toEqual(['init', 'update', 'draw', 'reset', 'dispose']);
    expect(order).toEqual(['a', 'b']); // ordre du tableau = ordre de dessin
  });

  it('layers expose le tableau tel que construit', () => {
    const a = new SpyLayer('a');
    const b = new SpyLayer('b');
    const scene = new Scene([a, b]);
    expect(scene.layers).toEqual([a, b]);
  });
});
