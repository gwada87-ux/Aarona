import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';
import type { FrameEncoder } from './FrameEncoder';
import { AUDIO_BITRATE_BPS } from '../formats';

/**
 * Chemin principal (ADR-005) : WebCodecs via Mediabunny, technique validée
 * par le spike jetable de l'Étape 1 (`spike-export/`, docs/JOURNAL.md).
 *
 * `CanvasSource.add()`/`AudioBufferSource.add()` renvoient une Promise qui
 * respecte DÉJÀ la contre-pression de l'encodeur en interne — inutile de
 * re-câbler `VideoEncoder.encodeQueueSize`/`ondequeue` à la main comme le
 * pseudocode bas niveau de docs/09 le suggère ; `await` suffit.
 */
export class MediabunnyEncoder implements FrameEncoder {
  private readonly output: Output;
  private readonly target: BufferTarget;
  private readonly videoSource: CanvasSource;
  private readonly audioSource: AudioBufferSource;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, fps: number, bitrateBps: number) {
    this.target = new BufferTarget();
    this.output = new Output({ format: new Mp4OutputFormat(), target: this.target });

    this.videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      quality: new Quality({ bitrate: bitrateBps }),
    });
    this.output.addVideoTrack(this.videoSource, { frameRate: fps });

    this.audioSource = new AudioBufferSource({
      codec: 'aac',
      quality: new Quality({ bitrate: AUDIO_BITRATE_BPS }),
    });
    this.output.addAudioTrack(this.audioSource);
  }

  async start(): Promise<void> {
    await this.output.start();
  }

  async addVideoFrame(timestampSec: number, durationSec: number): Promise<void> {
    await this.videoSource.add(timestampSec, durationSec);
  }

  async addAudio(buffer: AudioBuffer): Promise<void> {
    await this.audioSource.add(buffer);
  }

  async finish(): Promise<Blob> {
    this.videoSource.close();
    this.audioSource.close();
    await this.output.finalize();
    if (!this.target.buffer) throw new Error('MediabunnyEncoder: buffer de sortie vide après finalize()');
    return new Blob([this.target.buffer], { type: 'video/mp4' });
  }

  async cancel(): Promise<void> {
    await this.output.cancel();
  }
}
