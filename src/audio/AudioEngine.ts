import type { Transport } from '../core/time/Transport';
import { correctDrift } from '../core/time/driftCorrection';
import { decodeAudioFile, type DecodedAudio } from './decode';

export interface AudioEngineOptions {
  readonly context?: AudioContext;
}

/**
 * Implémentation concrète de `Transport` pour le Mode A (fichier analysé).
 * `AudioBufferSourceNode` est one-shot (piège #10) : un nouveau nœud est créé
 * à chaque `play()` et chaque `seek()`, l'offset de lecture est tenu à la main.
 *
 * `tick(nowMs)` doit être appelé une fois par image par la boucle de preview
 * (docs/03_DATA_FLOW.md FLUX 2, `Transport.tick()` — la boucle elle-même
 * arrive en P7). `nowMs` est le timestamp fourni par `requestAnimationFrame`,
 * pas un `performance.now()` lu ailleurs : seul le `Transport` dérive du
 * temps réel (Loi 1).
 */
export class AudioEngine implements Transport {
  private readonly ctx: AudioContext;
  private readonly gainNode: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private decoded: DecodedAudio | null = null;

  private tStart = 0; // ctx.currentTime au dernier démarrage de source
  private offsetSeek = 0; // position dans le morceau au dernier démarrage
  private predictedT = 0;
  private lastTickMs: number | null = null;
  private calibrationOffsetSeconds = 0;
  private looping = false;

  t = 0;
  dt = 0;
  playing = false;

  constructor(options: AudioEngineOptions = {}) {
    this.ctx = options.context ?? new AudioContext();
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.ctx.destination);
  }

  get duration(): number {
    return this.decoded?.buffer.duration ?? 0;
  }

  /** Point d'attache pour une sonde décorative (RealtimeProbe) ou un futur remux. */
  get outputNode(): AudioNode {
    return this.gainNode;
  }

  /** Diagnostic — exposé pour distinguer un décalage de latence fixe d'une vraie dérive. */
  get outputLatencySeconds(): number {
    return this.ctx.outputLatency ?? this.ctx.baseLatency ?? 0;
  }

  async load(file: File): Promise<void> {
    this.stopSource();
    this.decoded = await decodeAudioFile(file, this.ctx);
    this.playing = false;
    this.offsetSeek = 0;
    this.predictedT = 0;
    this.lastTickMs = null;
    this.t = 0;
    this.dt = 0;
  }

  play(): void {
    if (!this.decoded || this.playing) return;
    // Le contexte démarre suspendu (politique d'autoplay) tant qu'aucun geste
    // utilisateur ne l'a résumé. play() est déclenché par un clic, donc c'est
    // le bon endroit — sans ce resume(), currentTime reste figé et startSource
    // ne produit ni son ni avancée de t.
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.startSource(this.offsetSeek);
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.offsetSeek = this.currentRawT();
    this.stopSource();
    this.playing = false;
  }

  seek(t: number): void {
    if (!this.decoded) return;
    const clamped = Math.max(0, Math.min(t, this.decoded.buffer.duration));
    this.offsetSeek = clamped;
    this.predictedT = clamped;
    this.t = clamped;
    if (this.playing) {
      this.startSource(clamped); // piège #10 : nouveau nœud, l'ancien est jeté
    }
  }

  setVolume(v: number): void {
    this.gainNode.gain.value = Math.max(0, Math.min(1, v));
  }

  setLoop(loop: boolean): void {
    this.looping = loop;
    if (this.source) this.source.loop = loop;
  }

  /** Décalage mémorisé par la calibration manuelle (docs/03_DATA_FLOW.md §dérive). */
  setCalibrationOffset(seconds: number): void {
    this.calibrationOffsetSeconds = seconds;
  }

  tick(nowMs: number): void {
    if (!this.playing) {
      this.lastTickMs = nowMs;
      this.dt = 0;
      return;
    }

    const frameDt = this.lastTickMs === null ? 0 : Math.max(0, (nowMs - this.lastTickMs) / 1000);
    this.lastTickMs = nowMs;

    const predicted = this.predictedT + frameDt;
    const measured = this.currentRawT();
    const result = correctDrift(predicted, measured);

    this.predictedT = result.t;
    this.dt = frameDt;
    this.t = result.t;

    if (!this.looping && this.decoded && this.t >= this.decoded.buffer.duration) {
      this.pause();
      this.offsetSeek = this.decoded.buffer.duration;
      this.predictedT = this.decoded.buffer.duration;
      this.t = this.decoded.buffer.duration;
    }
  }

  dispose(): void {
    this.stopSource();
    this.gainNode.disconnect();
  }

  private currentRawT(): number {
    if (!this.playing) return this.offsetSeek;
    const outputLatency = this.ctx.outputLatency ?? this.ctx.baseLatency ?? 0;
    return (
      this.ctx.currentTime - this.tStart + this.offsetSeek - outputLatency + this.calibrationOffsetSeconds
    );
  }

  private startSource(offset: number): void {
    if (!this.decoded) return;
    this.stopSource();
    const node = this.ctx.createBufferSource();
    node.buffer = this.decoded.buffer;
    node.loop = this.looping;
    node.connect(this.gainNode);
    node.start(0, offset);
    this.source = node;
    this.tStart = this.ctx.currentTime;
    this.offsetSeek = offset;
    // predictedT doit démarrer déjà compensé de la latence, sinon il part de
    // `offset` pendant que currentRawT() (dans le premier tick) part de
    // `offset − outputLatency` : l'écart initial (~outputLatency) doit alors
    // être rattrapé à 2 ms/image, ce qui fige un retard transitoire de
    // plusieurs centaines de ms à chaque play()/seek() en lecture.
    this.predictedT = offset - this.outputLatencySeconds + this.calibrationOffsetSeconds;
  }

  private stopSource(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // déjà arrêté (fin naturelle de lecture) — pas d'erreur à propager
    }
    this.source.disconnect();
    this.source = null;
  }
}
