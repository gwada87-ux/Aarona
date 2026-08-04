import { describe, expect, it } from 'vitest';
import { pickSupportedMimeType } from '../../src/export/encoders/MediaRecorderFallback';

describe('pickSupportedMimeType', () => {
  it('retourne le premier type supporté, dans l\'ordre de préférence (MP4/H.264 avant WebM)', () => {
    const supportsOnly = (allowed: string[]) => (type: string) => allowed.includes(type);
    expect(pickSupportedMimeType(supportsOnly(['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm']))).toBe(
      'video/mp4;codecs=avc1,mp4a.40.2',
    );
    expect(pickSupportedMimeType(supportsOnly(['video/webm;codecs=vp9,opus']))).toBe('video/webm;codecs=vp9,opus');
  });

  it('retourne une chaîne vide si rien n\'est supporté (laisse le navigateur choisir)', () => {
    expect(pickSupportedMimeType(() => false)).toBe('');
  });
});
