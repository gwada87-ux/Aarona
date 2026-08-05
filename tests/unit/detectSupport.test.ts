/**
 * Tests de `export/encoders/detectSupport.ts` — Étape 32. Premier test de ce
 * fichier : `canEncodeVideo`/`canEncodeAudio` (Mediabunny) enveloppent des
 * API WebCodecs (`VideoEncoder.isConfigSupported`/`AudioEncoder
 * .isConfigSupported`), absentes de Node — mockées via `vi.mock('mediabunny')`
 * plutôt que testées via une vraie implémentation, comme `MediabunnyEncoder`
 * (voir `mediabunnyEncoder.test.ts`, même étape).
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canEncodeVideo: vi.fn(),
  canEncodeAudio: vi.fn(),
}));

vi.mock('mediabunny', () => ({
  canEncodeVideo: mocks.canEncodeVideo,
  canEncodeAudio: mocks.canEncodeAudio,
}));

import { detectExportPath } from '../../src/export/encoders/detectSupport';

describe('detectExportPath', () => {
  it('vidéo ET audio supportés -> "webcodecs"', async () => {
    mocks.canEncodeVideo.mockResolvedValue(true);
    mocks.canEncodeAudio.mockResolvedValue(true);
    expect(await detectExportPath(1920, 1080, 12_000_000)).toBe('webcodecs');
  });

  it('vidéo supportée, audio non -> "media-recorder" (pas de repli partiel, docs/09)', async () => {
    mocks.canEncodeVideo.mockResolvedValue(true);
    mocks.canEncodeAudio.mockResolvedValue(false);
    expect(await detectExportPath(1920, 1080, 12_000_000)).toBe('media-recorder');
  });

  it('audio supporté, vidéo non -> "media-recorder"', async () => {
    mocks.canEncodeVideo.mockResolvedValue(false);
    mocks.canEncodeAudio.mockResolvedValue(true);
    expect(await detectExportPath(1920, 1080, 12_000_000)).toBe('media-recorder');
  });

  it('ni vidéo ni audio supportés -> "media-recorder"', async () => {
    mocks.canEncodeVideo.mockResolvedValue(false);
    mocks.canEncodeAudio.mockResolvedValue(false);
    expect(await detectExportPath(1920, 1080, 12_000_000)).toBe('media-recorder');
  });

  it('transmet width/height/bitrate à canEncodeVideo, "avc" fixe, "aac" fixe pour l\'audio', async () => {
    mocks.canEncodeVideo.mockResolvedValue(true);
    mocks.canEncodeAudio.mockResolvedValue(true);
    await detectExportPath(1280, 720, 8_000_000);

    expect(mocks.canEncodeVideo).toHaveBeenCalledWith('avc', { width: 1280, height: 720, bitrate: 8_000_000 });
    expect(mocks.canEncodeAudio).toHaveBeenCalledWith('aac');
  });

  it('interroge vidéo et audio en parallèle (Promise.all), pas séquentiellement', async () => {
    const order: string[] = [];
    mocks.canEncodeVideo.mockImplementation(async () => {
      order.push('video-start');
      await Promise.resolve();
      order.push('video-end');
      return true;
    });
    mocks.canEncodeAudio.mockImplementation(async () => {
      order.push('audio-start');
      await Promise.resolve();
      order.push('audio-end');
      return true;
    });
    await detectExportPath(1920, 1080, 12_000_000);
    // Les deux "start" doivent précéder les deux "end" si lancés en parallèle —
    // un enchaînement séquentiel donnerait [video-start, video-end, audio-start, audio-end].
    expect(order.indexOf('audio-start')).toBeLessThan(order.indexOf('video-end'));
  });
});
