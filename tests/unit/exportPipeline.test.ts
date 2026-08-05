import { describe, expect, it } from 'vitest';
import { runExport, ExportCancelledError, type ExportConfig, type ExportTarget } from '../../src/export/ExportPipeline';
import { createPulseStyle } from '../../src/visual/styles/pulse/createPulseStyle';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { validatePmdi } from '../../src/music/validatePmdi';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { FakeFrameEncoder } from './testSupport/FakeFrameEncoder';
import type { PmdiDocument } from '../../src/music/pmdi';
import { MACRO_NAMES } from '../../src/presets/index';
import type { MacroName, PresetMacros } from '../../src/presets/schema';

/** Toutes les macros à 0,5 (neutre) — même valeur que `neutralMacros()` (ui/App.ts). */
function neutralMacros(): PresetMacros {
  const macros = {} as Record<MacroName, number>;
  for (const name of MACRO_NAMES) macros[name] = 0.5;
  return macros as PresetMacros;
}

function buildTimeline() {
  const doc: PmdiDocument = {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 3, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [{ t: 0.5, type: 'KICK', intensity: 0.8, confidence: 0.9 }],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
  expect(validatePmdi(doc).ok).toBe(true);
  return buildMusicTimeline(doc);
}

function baseConfig(overrides: Partial<ExportConfig> = {}): ExportConfig {
  return {
    timeline: buildTimeline(),
    projectSeed: 1,
    mapping: defaultMapping,
    createScene: createPulseStyle,
    macros: neutralMacros(),
    styleId: 'pulse',
    palette: defaultPalette,
    fps: 30,
    durationSec: 0.5,
    audioBuffer: {} as AudioBuffer,
    watermarked: false,
    ...overrides,
  };
}

function fakeTarget(): { target: ExportTarget; renderer: FakeRenderer } {
  const renderer = new FakeRenderer();
  return {
    renderer,
    target: { renderer, viewport: testViewport, applyFlashLimiter: () => {} },
  };
}

describe('runExport — séquence nominale', () => {
  it('start → N×addVideoFrame → addAudio → finish, dans cet ordre', async () => {
    const encoder = new FakeFrameEncoder();
    const { target } = fakeTarget();
    const config = baseConfig({ fps: 30, durationSec: 0.5 }); // 15 images attendues

    const result = await runExport(config, target, encoder);

    expect(encoder.calls[0]).toBe('start');
    expect(encoder.calls.at(-2)).toBe('addAudio');
    expect(encoder.calls.at(-1)).toBe('finish');
    expect(encoder.calls.filter((c) => c === 'addVideoFrame')).toHaveLength(15);
    expect(result.totalFrames).toBe(15);
    expect(result.blob).toBe(encoder.finishedBlob);
  });

  it('les timestamps vidéo sont f/fps, jamais une horloge réelle', async () => {
    const encoder = new FakeFrameEncoder();
    const { target } = fakeTarget();
    await runExport(baseConfig({ fps: 30, durationSec: 0.2 }), target, encoder);

    expect(encoder.videoFrames.map((f) => f.t)).toEqual([0, 1 / 30, 2 / 30, 3 / 30, 4 / 30, 5 / 30]);
    for (const frame of encoder.videoFrames) expect(frame.duration).toBeCloseTo(1 / 30, 10);
  });

  it('rejette un fps non supporté avant tout appel à l\'encodeur', async () => {
    const encoder = new FakeFrameEncoder();
    const { target } = fakeTarget();
    await expect(runExport(baseConfig({ fps: 24 as never }), target, encoder)).rejects.toThrow(/fps non supporté/);
    expect(encoder.calls).toEqual([]);
  });
});

describe('runExport — progression', () => {
  it('émet la progression toutes les 15 images, plus un appel final à totalFrames', async () => {
    const encoder = new FakeFrameEncoder();
    const { target } = fakeTarget();
    const progress: number[] = [];
    const config = baseConfig({ fps: 30, durationSec: 1.2, onProgress: (done) => progress.push(done) }); // 36 images

    await runExport(config, target, encoder);

    expect(progress).toEqual([0, 15, 30, 36]);
  });
});

describe('runExport — annulation', () => {
  it('AbortSignal déjà déclenché : cancel() appelé, finish() jamais, ExportCancelledError levée', async () => {
    const encoder = new FakeFrameEncoder();
    const { target } = fakeTarget();
    const controller = new AbortController();
    controller.abort();

    await expect(runExport(baseConfig({ signal: controller.signal }), target, encoder)).rejects.toThrow(
      ExportCancelledError,
    );
    expect(encoder.calls).toContain('cancel');
    expect(encoder.calls).not.toContain('finish');
  });

  it('annulation en cours de route : aucune image après le signal, aucune fuite (cancel appelé)', async () => {
    const encoder = new FakeFrameEncoder();
    const { target } = fakeTarget();
    const controller = new AbortController();
    const config = baseConfig({
      fps: 30,
      durationSec: 2.0, // 60 images
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 15) controller.abort(); // annule à 25% (~50% du budget de test)
      },
    });

    await expect(runExport(config, target, encoder)).rejects.toThrow(ExportCancelledError);
    const videoFrameCalls = encoder.calls.filter((c) => c === 'addVideoFrame').length;
    expect(videoFrameCalls).toBeLessThan(60);
    expect(encoder.calls).toContain('cancel');
    expect(encoder.calls).not.toContain('finish');
  });
});

describe('runExport — watermark', () => {
  it('dessine des primitives supplémentaires quand watermarked=true, aucune sinon', async () => {
    const withMark = fakeTarget();
    await runExport(baseConfig({ watermarked: true, durationSec: 0.1 }), withMark.target, new FakeFrameEncoder());

    const withoutMark = fakeTarget();
    await runExport(baseConfig({ watermarked: false, durationSec: 0.1 }), withoutMark.target, new FakeFrameEncoder());

    const countFillCircle = (r: FakeRenderer) => r.calls.filter((c) => c.type === 'fillCircle').length;
    expect(countFillCircle(withMark.renderer)).toBeGreaterThan(countFillCircle(withoutMark.renderer));
  });
});

describe('runExport — macros de couche (Étape 26)', () => {
  it("applique les macros de couche (Étape 20) à la Scene d'export — gap découvert et signalé à l'Étape 25, corrigé ici", async () => {
    // pulse.pulseRings.maxActiveRings : { at0: 2, at1: 8 } (layerMacros.ts) — density=1 doit s'approcher de 8.
    const scene = createPulseStyle();
    const macros: PresetMacros = { ...neutralMacros(), density: 1 };
    const { target } = fakeTarget();

    await runExport(baseConfig({ createScene: () => scene, macros, styleId: 'pulse', durationSec: 0.1 }), target, new FakeFrameEncoder());

    const pulseRingsLayer = scene.layers.find((l) => l.id === 'pulseRings')!;
    expect(pulseRingsLayer.params.maxActiveRings).toBeGreaterThan(6);
  });

  it("macros neutres (0,5 partout) : n'écrase pas les params en un objet vide (au moins une clé présente)", async () => {
    const scene = createPulseStyle();
    const { target } = fakeTarget();

    await runExport(baseConfig({ createScene: () => scene, macros: neutralMacros(), styleId: 'pulse', durationSec: 0.1 }), target, new FakeFrameEncoder());

    const pulseRingsLayer = scene.layers.find((l) => l.id === 'pulseRings')!;
    expect(Object.keys(pulseRingsLayer.params).length).toBeGreaterThan(0);
  });
});
