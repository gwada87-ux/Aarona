import { describe, expect, it } from 'vitest';
import { AUDIO_BITRATE_BPS, BITRATE_BPS, FORMATS, SUPPORTED_FPS, findFormat } from '../../src/export/formats';

describe('formats — table de docs/09_EXPORT.md', () => {
  it('contient les 5 formats documentés avec les bonnes résolutions', () => {
    expect(findFormat('youtube')).toEqual({ id: 'youtube', label: expect.any(String), width: 1920, height: 1080 });
    expect(findFormat('vertical')).toEqual({ id: 'vertical', label: expect.any(String), width: 1080, height: 1920 });
    expect(findFormat('square')).toEqual({ id: 'square', label: expect.any(String), width: 1080, height: 1080 });
    expect(findFormat('free')).toEqual({ id: 'free', label: expect.any(String), width: 1280, height: 720 });
    expect(findFormat('preview')).toEqual({ id: 'preview', label: expect.any(String), width: 854, height: 480 });
    expect(FORMATS).toHaveLength(5);
  });

  it('findFormat retourne undefined pour un id inconnu', () => {
    expect(findFormat('inexistant')).toBeUndefined();
  });

  it('30 et 60 fps divisent exactement 120 (sous-pas de simulation par image)', () => {
    for (const fps of SUPPORTED_FPS) {
      expect(120 % fps).toBe(0);
    }
    expect(SUPPORTED_FPS).toEqual([30, 60]);
  });

  it('les paliers de débit correspondent à 8/12/20 Mb/s (docs/09)', () => {
    expect(BITRATE_BPS.low).toBe(8_000_000);
    expect(BITRATE_BPS.medium).toBe(12_000_000);
    expect(BITRATE_BPS.high).toBe(20_000_000);
    expect(AUDIO_BITRATE_BPS).toBeGreaterThan(0);
  });
});
