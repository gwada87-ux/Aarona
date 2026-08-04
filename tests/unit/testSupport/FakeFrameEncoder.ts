import type { FrameEncoder } from '../../../src/export/encoders/FrameEncoder';

export class FakeFrameEncoder implements FrameEncoder {
  readonly calls: string[] = [];
  readonly videoFrames: { t: number; duration: number }[] = [];
  readonly audioBuffers: AudioBuffer[] = [];
  finishedBlob: Blob | null = null;

  async start(): Promise<void> {
    this.calls.push('start');
  }

  async addVideoFrame(timestampSec: number, durationSec: number): Promise<void> {
    this.videoFrames.push({ t: timestampSec, duration: durationSec });
    this.calls.push('addVideoFrame');
  }

  async addAudio(buffer: AudioBuffer): Promise<void> {
    this.audioBuffers.push(buffer);
    this.calls.push('addAudio');
  }

  async finish(): Promise<Blob> {
    this.calls.push('finish');
    this.finishedBlob = new Blob(['fake-mp4']);
    return this.finishedBlob;
  }

  async cancel(): Promise<void> {
    this.calls.push('cancel');
  }
}
