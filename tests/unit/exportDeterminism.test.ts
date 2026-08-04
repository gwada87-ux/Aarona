import { describe, expect, it } from 'vitest';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder, type StepContext } from '../../src/music/StepContext';
import { validatePmdi } from '../../src/music/validatePmdi';
import { FixedStep, FIXED_DT } from '../../src/core/time/FixedStep';
import type { MusicEvent, PmdiDocument } from '../../src/music/pmdi';

/**
 * docs/09_EXPORT.md §"Pourquoi ce pipeline garantit l'identité preview/export" :
 * « mêmes sous-pas, mêmes stepIndex, mêmes graines qu'en preview ». Ce test
 * prouve la partie qui compte vraiment (la simulation, pas les pixels) SANS
 * canvas ni navigateur : que la boucle d'export (`t = f/fps`, ExportPipeline.ts)
 * et la boucle de preview (accumulateur à pas fixe sur un `dt` réel et
 * irrégulier, comme un `requestAnimationFrame` jittery) produisent EXACTEMENT
 * la même séquence de sous-pas, quelle que soit la façon dont le temps réel
 * se découpe en images. Le rendu pixel par pixel n'est qu'une fonction pure
 * de cette séquence (Scene.update est déterministe) — si les sous-pas sont
 * identiques, les pixels le sont aussi ; c'est ce risque-là qui est vérifié
 * ici, le reste (Canvas2DRenderer) est vérifié au navigateur comme d'habitude.
 */

function doc(): PmdiDocument {
  const events: MusicEvent[] = [];
  for (let beat = 0; beat * 0.5 < 3; beat++) {
    events.push({ t: beat * 0.5, type: 'KICK', intensity: 0.8, confidence: 0.9 });
  }
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 3, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events,
    features: [{ id: 'energy', hz: 5, t0: 0, data: Array.from({ length: 16 }, (_, i) => (i % 4) / 4) }],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

function buildTimeline() {
  const document = doc();
  expect(validatePmdi(document).ok).toBe(true);
  return buildMusicTimeline(document);
}

function snapshotOf(step: StepContext) {
  return {
    stepIndex: step.stepIndex,
    fired: step.fired.map((e) => `${e.type}@${e.t}`),
    rngDraw: step.rng.next(),
  };
}

/** Boucle d'export : t = f/fps, sous-pas fixes jusqu'à la cible — copie du cœur d'ExportPipeline.ts. */
function simulateExportStyle(builder: StepContextBuilder, durationSec: number, fps: number) {
  const snapshots: ReturnType<typeof snapshotOf>[] = [];
  let simT = 0;
  const totalFrames = Math.round(durationSec * fps);
  for (let f = 0; f < totalFrames; f++) {
    const targetT = f / fps;
    while (simT < targetT - 1e-9) {
      simT += FIXED_DT;
      snapshots.push(snapshotOf(builder.build(simT)));
    }
  }
  return snapshots;
}

/** Boucle de preview : accumulateur à pas fixe sur un dt réel irrégulier (jitter simulé). */
function simulatePreviewStyle(builder: StepContextBuilder, durationSec: number, frameDts: readonly number[]) {
  const snapshots: ReturnType<typeof snapshotOf>[] = [];
  const fixedStep = new FixedStep(FIXED_DT);
  let simT = 0;
  let elapsed = 0;
  let i = 0;
  while (elapsed < durationSec) {
    const dt = frameDts[i % frameDts.length]!;
    elapsed += dt;
    const steps = fixedStep.advance(dt);
    for (let s = 0; s < steps; s++) {
      simT += FIXED_DT;
      snapshots.push(snapshotOf(builder.build(simT)));
    }
    i++;
  }
  return snapshots;
}

describe('déterminisme preview ≡ export (docs/09, docs/14 critère "≤2% de différence pixel")', () => {
  it('la boucle export (t=f/fps) et la boucle preview (dt réel irrégulier) produisent la même séquence de sous-pas', () => {
    const timeline = buildTimeline();

    const exportBuilder = new StepContextBuilder(timeline, 42);
    const exportSnapshots = simulateExportStyle(exportBuilder, 2.0, 60);

    // dt "réel" volontairement irrégulier : 60fps stable, un décrochage à 30fps,
    // un micro-jitter — jamais un multiple exact de FIXED_DT.
    const jitterDts = [1 / 60, 1 / 60, 1 / 58, 1 / 30, 1 / 60, 1 / 62, 1 / 60];
    const previewBuilder = new StepContextBuilder(timeline, 42);
    const previewSnapshots = simulatePreviewStyle(previewBuilder, 3.0, jitterDts); // fenêtre plus large, tronquée ensuite

    expect(previewSnapshots.length).toBeGreaterThanOrEqual(exportSnapshots.length);
    expect(previewSnapshots.slice(0, exportSnapshots.length)).toEqual(exportSnapshots);
  });

  it('deux exports indépendants avec le même projectSeed sont bit-identiques', () => {
    const timeline = buildTimeline();
    const a = simulateExportStyle(new StepContextBuilder(timeline, 7), 1.5, 60);
    const b = simulateExportStyle(new StepContextBuilder(timeline, 7), 1.5, 60);
    expect(a).toEqual(b);
  });

  it('30 fps et 60 fps convergent sur les mêmes sous-pas (mêmes stepIndex) là où ils se recouvrent', () => {
    const timeline = buildTimeline();
    const at60 = simulateExportStyle(new StepContextBuilder(timeline, 1), 1.0, 60);
    const at30 = simulateExportStyle(new StepContextBuilder(timeline, 1), 1.0, 30);
    // 30fps produit un sous-ensemble strict des sous-pas de 60fps (même grille 1/120s) :
    // tous les stepIndex de la simulation à 30fps doivent apparaître dans celle à 60fps.
    const stepIndexesAt60 = new Set(at60.map((s) => s.stepIndex));
    for (const snap of at30) expect(stepIndexesAt60.has(snap.stepIndex)).toBe(true);
  });
});
