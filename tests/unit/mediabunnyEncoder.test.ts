/**
 * Tests de `export/encoders/MediabunnyEncoder.ts` — Étape 32. Wrapper mince
 * autour des classes Mediabunny (`Output`/`CanvasSource`/`AudioBufferSource`/
 * ...), elles-mêmes enveloppant WebCodecs (absent de Node) — `mediabunny`
 * mocké EN ENTIER via `vi.mock`, pas réimplémenté : ce fichier vérifie que
 * `MediabunnyEncoder` appelle les bonnes méthodes, dans le bon ordre, avec
 * les bons paramètres (codec/bitrate/frameRate) — pas que Mediabunny
 * encode correctement, hors de portée d'un test unitaire de ce module.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  outputs: [] as FakeOutput[],
  canvasSources: [] as FakeCanvasSource[],
  audioBufferSources: [] as FakeAudioBufferSource[],
}));

// Déclarations `class` hissées par `vi.hoisted` — TypeScript exige les types AVANT usage,
// donc les interfaces ci-dessous sont déclarées séparément pour que `state` (au-dessus) les référence.
interface FakeOutput {
  target: { buffer: ArrayBuffer | null };
  format: unknown;
  addVideoTrack: ReturnType<typeof vi.fn>;
  addAudioTrack: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  finalize: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}
interface FakeCanvasSource {
  canvas: unknown;
  opts: { codec: string; quality: { bitrate: number } };
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}
interface FakeAudioBufferSource {
  opts: { codec: string; quality: { bitrate: number } };
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

vi.mock('mediabunny', () => {
  class MockBufferTarget {
    buffer: ArrayBuffer | null = null;
  }
  class MockOutput {
    target: { buffer: ArrayBuffer | null };
    format: unknown;
    addVideoTrack = vi.fn();
    addAudioTrack = vi.fn();
    start = vi.fn(async () => {});
    finalize = vi.fn(async () => {
      this.target.buffer = new ArrayBuffer(8);
    });
    cancel = vi.fn(async () => {});
    constructor(opts: { format: unknown; target: { buffer: ArrayBuffer | null } }) {
      this.target = opts.target;
      this.format = opts.format;
      state.outputs.push(this);
    }
  }
  class MockCanvasSource {
    canvas: unknown;
    opts: { codec: string; quality: { bitrate: number } };
    add = vi.fn(async () => {});
    close = vi.fn();
    constructor(canvas: unknown, opts: { codec: string; quality: { bitrate: number } }) {
      this.canvas = canvas;
      this.opts = opts;
      state.canvasSources.push(this);
    }
  }
  class MockAudioBufferSource {
    opts: { codec: string; quality: { bitrate: number } };
    add = vi.fn(async () => {});
    close = vi.fn();
    constructor(opts: { codec: string; quality: { bitrate: number } }) {
      this.opts = opts;
      state.audioBufferSources.push(this);
    }
  }
  class MockMp4OutputFormat {}
  class MockQuality {
    bitrate: number;
    constructor(opts: { bitrate: number }) {
      this.bitrate = opts.bitrate;
    }
  }
  return {
    Output: MockOutput,
    BufferTarget: MockBufferTarget,
    CanvasSource: MockCanvasSource,
    AudioBufferSource: MockAudioBufferSource,
    Mp4OutputFormat: MockMp4OutputFormat,
    Quality: MockQuality,
  };
});

import { MediabunnyEncoder } from '../../src/export/encoders/MediabunnyEncoder';
import { AUDIO_BITRATE_BPS } from '../../src/export/formats';

beforeEach(() => {
  state.outputs.length = 0;
  state.canvasSources.length = 0;
  state.audioBufferSources.length = 0;
});

function fakeCanvas(): OffscreenCanvas {
  return {} as OffscreenCanvas;
}

describe('MediabunnyEncoder — construction', () => {
  it('construit une piste vidéo (codec avc, bitrate demandé, frameRate) et une piste audio (codec aac, AUDIO_BITRATE_BPS)', () => {
    const canvas = fakeCanvas();
    new MediabunnyEncoder(canvas, 30, 12_000_000);

    expect(state.canvasSources).toHaveLength(1);
    expect(state.canvasSources[0]!.canvas).toBe(canvas);
    expect(state.canvasSources[0]!.opts.codec).toBe('avc');
    expect(state.canvasSources[0]!.opts.quality.bitrate).toBe(12_000_000);

    expect(state.audioBufferSources).toHaveLength(1);
    expect(state.audioBufferSources[0]!.opts.codec).toBe('aac');
    expect(state.audioBufferSources[0]!.opts.quality.bitrate).toBe(AUDIO_BITRATE_BPS);

    expect(state.outputs).toHaveLength(1);
    expect(state.outputs[0]!.addVideoTrack).toHaveBeenCalledWith(state.canvasSources[0], { frameRate: 30 });
    expect(state.outputs[0]!.addAudioTrack).toHaveBeenCalledWith(state.audioBufferSources[0]);
  });

  it('bitrate vidéo et fps distincts transmis fidèlement (pas de valeur figée en dur)', () => {
    new MediabunnyEncoder(fakeCanvas(), 60, 20_000_000);
    expect(state.canvasSources[0]!.opts.quality.bitrate).toBe(20_000_000);
    expect(state.outputs[0]!.addVideoTrack).toHaveBeenCalledWith(expect.anything(), { frameRate: 60 });
  });
});

describe('MediabunnyEncoder — séquence nominale', () => {
  it('start() délègue à output.start()', async () => {
    const encoder = new MediabunnyEncoder(fakeCanvas(), 30, 12_000_000);
    await encoder.start();
    expect(state.outputs[0]!.start).toHaveBeenCalledTimes(1);
  });

  it('addVideoFrame() délègue à videoSource.add(timestamp, duration)', async () => {
    const encoder = new MediabunnyEncoder(fakeCanvas(), 30, 12_000_000);
    await encoder.addVideoFrame(1.5, 1 / 30);
    expect(state.canvasSources[0]!.add).toHaveBeenCalledWith(1.5, 1 / 30);
  });

  it('addAudio() délègue à audioSource.add(buffer)', async () => {
    const encoder = new MediabunnyEncoder(fakeCanvas(), 30, 12_000_000);
    const buffer = {} as AudioBuffer;
    await encoder.addAudio(buffer);
    expect(state.audioBufferSources[0]!.add).toHaveBeenCalledWith(buffer);
  });

  it('finish() ferme les deux sources AVANT finalize(), puis renvoie un Blob video/mp4', async () => {
    const encoder = new MediabunnyEncoder(fakeCanvas(), 30, 12_000_000);
    const callOrder: string[] = [];
    state.canvasSources[0]!.close.mockImplementation(() => callOrder.push('video-close'));
    state.audioBufferSources[0]!.close.mockImplementation(() => callOrder.push('audio-close'));
    state.outputs[0]!.finalize.mockImplementation(async () => {
      callOrder.push('finalize');
      state.outputs[0]!.target.buffer = new ArrayBuffer(4);
    });

    const blob = await encoder.finish();

    expect(callOrder).toEqual(['video-close', 'audio-close', 'finalize']);
    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBe(4);
  });

  it('finish() lève si le buffer de sortie est vide après finalize() (finalize() n\'a pas produit de données)', async () => {
    const encoder = new MediabunnyEncoder(fakeCanvas(), 30, 12_000_000);
    state.outputs[0]!.finalize.mockImplementation(async () => {
      // NE remplit PAS target.buffer — simule un échec silencieux de Mediabunny.
    });
    await expect(encoder.finish()).rejects.toThrow(/buffer de sortie vide/);
  });

  it('cancel() délègue à output.cancel()', async () => {
    const encoder = new MediabunnyEncoder(fakeCanvas(), 30, 12_000_000);
    await encoder.cancel();
    expect(state.outputs[0]!.cancel).toHaveBeenCalledTimes(1);
  });
});
