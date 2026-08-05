import { describe, expect, it } from 'vitest';
import { downmixToMono } from '../../src/audio/downmix';

function fakeAudioBuffer(channels: number[][]): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    numberOfChannels: channels.length,
    length,
    getChannelData: (ch: number) => Float32Array.from(channels[ch]!),
  } as unknown as AudioBuffer;
}

describe('downmixToMono', () => {
  it('moyenne (L+R)/2 pour un buffer stéréo', () => {
    const buffer = fakeAudioBuffer([
      [1, 0, -1],
      [0, 1, 1],
    ]);
    const mono = downmixToMono(buffer);
    expect(Array.from(mono)).toEqual([0.5, 0.5, 0]);
  });

  it('renvoie le canal unique tel quel pour un buffer mono', () => {
    const buffer = fakeAudioBuffer([[0.25, -0.5, 1]]);
    const mono = downmixToMono(buffer);
    expect(Array.from(mono)).toEqual([0.25, -0.5, 1]);
  });

  it('moyenne les N canaux pour un buffer multicanal (5.1, etc.)', () => {
    const buffer = fakeAudioBuffer([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    const mono = downmixToMono(buffer);
    expect(Array.from(mono)).toEqual([1, 1]);
  });

  it('ne mute pas les canaux sources (le mono retourné a son propre buffer)', () => {
    const channelData = [1, 2, 3];
    const buffer = fakeAudioBuffer([channelData]);
    const mono = downmixToMono(buffer);
    mono[0] = 999;
    expect(buffer.getChannelData(0)[0]).toBe(1);
  });
});
