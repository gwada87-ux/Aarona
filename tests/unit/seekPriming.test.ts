import { describe, expect, it } from 'vitest';
import { primeAfterSeek, RELEASE_PRIME_WINDOW_SEC, SCRUB_PRIME_WINDOW_SEC } from '../../src/ui/seekPriming';
import { FIXED_DT } from '../../src/core/time/FixedStep';
import { BehaviourEngine } from '../../src/behaviour/BehaviourEngine';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { Scene } from '../../src/visual/scene/Scene';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import { validatePmdi } from '../../src/music/validatePmdi';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import type { Layer, LayerInitContext } from '../../src/visual/scene/Layer';
import type { StepContext } from '../../src/music/StepContext';
import type { VisualSignals } from '../../src/behaviour/BehaviourEngine';
import type { PmdiDocument } from '../../src/music/pmdi';

class FakeLayer implements Layer {
  readonly id: string;
  readonly kind = 'background' as const;
  params = {};
  updateTimes: number[] = [];
  drawCalls = 0;
  resetCalls = 0;

  constructor(
    id: string,
    readonly needsDrawPriming: boolean,
  ) {
    this.id = id;
  }

  init(_ctx: LayerInitContext): void {}
  update(step: StepContext, _signals: VisualSignals): void {
    this.updateTimes.push(step.t);
  }
  draw(): void {
    this.drawCalls++;
  }
  reset(_t: number): void {
    this.resetCalls++;
  }
  dispose(): void {}
}

function setup(primingId = 'priming', plainId = 'plain') {
  const doc: PmdiDocument = {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 60, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
  const result = validatePmdi(doc);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const timeline = buildMusicTimeline(doc);
  const stepper = new StepContextBuilder(timeline, 1);
  const behaviourEngine = new BehaviourEngine(timeline, defaultMapping);
  const priming = new FakeLayer(primingId, true);
  const plain = new FakeLayer(plainId, false);
  const scene = new Scene([plain, priming]);
  const renderer = new FakeRenderer();
  return { stepper, behaviourEngine, scene, priming, plain, renderer };
}

describe('primeAfterSeek', () => {
  it('rejoue exactement windowSec / FIXED_DT sous-pas', () => {
    const { stepper, behaviourEngine, scene, priming, plain, renderer } = setup();
    primeAfterSeek({ t: 10, windowSec: RELEASE_PRIME_WINDOW_SEC, stepper, behaviourEngine, scene, renderer, viewport: testViewport });

    const expectedSteps = Math.round(RELEASE_PRIME_WINDOW_SEC / FIXED_DT);
    expect(plain.updateTimes).toHaveLength(expectedSteps);
    expect(priming.updateTimes).toHaveLength(expectedSteps);
  });

  it('ne dessine QUE les couches needsDrawPriming, jamais les autres', () => {
    const { stepper, behaviourEngine, scene, priming, plain, renderer } = setup();
    primeAfterSeek({ t: 10, windowSec: RELEASE_PRIME_WINDOW_SEC, stepper, behaviourEngine, scene, renderer, viewport: testViewport });

    expect(priming.drawCalls).toBe(Math.round(RELEASE_PRIME_WINDOW_SEC / FIXED_DT));
    expect(plain.drawCalls).toBe(0);
  });

  it('toutes les couches sont mises à jour à CHAQUE sous-pas (progression de l\'état, pas seulement la dernière)', () => {
    const { stepper, behaviourEngine, scene, priming, renderer } = setup();
    primeAfterSeek({ t: 10, windowSec: SCRUB_PRIME_WINDOW_SEC, stepper, behaviourEngine, scene, renderer, viewport: testViewport });

    const start = 10 - SCRUB_PRIME_WINDOW_SEC;
    expect(priming.updateTimes[0]).toBeCloseTo(start + FIXED_DT, 5);
    // strictement croissant, chaque pas avance de FIXED_DT
    for (let i = 1; i < priming.updateTimes.length; i++) {
      expect(priming.updateTimes[i]! - priming.updateTimes[i - 1]!).toBeCloseTo(FIXED_DT, 5);
    }
  });

  it('le dernier sous-pas correspond exactement à t (pas d\'imprécision flottante résiduelle)', () => {
    const { stepper, behaviourEngine, scene, priming, renderer } = setup();
    primeAfterSeek({ t: 10, windowSec: RELEASE_PRIME_WINDOW_SEC, stepper, behaviourEngine, scene, renderer, viewport: testViewport });
    expect(priming.updateTimes.at(-1)).toBe(10);
  });

  it('fenêtre tronquée à 0 quand t < windowSec (pas de rattrapage avant le début du morceau)', () => {
    const { stepper, behaviourEngine, scene, priming, renderer } = setup();
    primeAfterSeek({ t: 0.1, windowSec: RELEASE_PRIME_WINDOW_SEC, stepper, behaviourEngine, scene, renderer, viewport: testViewport });

    expect(priming.updateTimes.length).toBe(Math.round(0.1 / FIXED_DT));
    expect(priming.updateTimes[0]).toBeCloseTo(FIXED_DT, 5);
  });

  it('t = 0 exactement : aucun sous-pas (rien à rattraper avant le début)', () => {
    const { stepper, behaviourEngine, scene, priming, renderer } = setup();
    primeAfterSeek({ t: 0, windowSec: RELEASE_PRIME_WINDOW_SEC, stepper, behaviourEngine, scene, renderer, viewport: testViewport });
    expect(priming.updateTimes).toHaveLength(0);
    expect(priming.drawCalls).toBe(0);
  });

  it('une fenêtre de scrub plus courte rejoue moins de sous-pas qu\'une fenêtre de relâchement', () => {
    const a = setup('p1', 'q1');
    const b = setup('p2', 'q2');
    primeAfterSeek({ t: 10, windowSec: SCRUB_PRIME_WINDOW_SEC, stepper: a.stepper, behaviourEngine: a.behaviourEngine, scene: a.scene, renderer: a.renderer, viewport: testViewport });
    primeAfterSeek({ t: 10, windowSec: RELEASE_PRIME_WINDOW_SEC, stepper: b.stepper, behaviourEngine: b.behaviourEngine, scene: b.scene, renderer: b.renderer, viewport: testViewport });
    expect(a.priming.updateTimes.length).toBeLessThan(b.priming.updateTimes.length);
  });
});
