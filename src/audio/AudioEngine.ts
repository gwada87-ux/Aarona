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

  /** Motif du refus de `resume()`, `null` si le contexte n'a jamais été bloqué. */
  contextBlockedReason: string | null = null;

  /**
   * État réel du contexte audio. `'running'` est le seul état où `ctx.currentTime`
   * avance, donc le seul où l'horloge audio fait autorité (voir `tick`).
   */
  get contextState(): AudioContextState {
    return this.ctx.state;
  }

  constructor(options: AudioEngineOptions = {}) {
    this.ctx = options.context ?? new AudioContext();
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.ctx.destination);
  }

  get duration(): number {
    return this.decoded?.buffer.duration ?? 0;
  }

  /** L'`AudioBuffer` décodé — `null` avant `load()`. Besoin réel : export (audio source) et analyse (démixage). */
  get decodedBuffer(): AudioBuffer | null {
    return this.decoded?.buffer ?? null;
  }

  /** Point d'attache pour une sonde décorative (RealtimeProbe) ou un futur remux. */
  get outputNode(): AudioNode {
    return this.gainNode;
  }

  /** Diagnostic — exposé pour distinguer un décalage de latence fixe d'une vraie dérive. */
  get outputLatencySeconds(): number {
    return this.ctx.outputLatency ?? this.ctx.baseLatency ?? 0;
  }

  /**
   * `signal` optionnel : piège #11 — deux `load()` qui se chevauchent (import lent puis import
   * rapide avant que le premier ne finisse) n'ont aucune garantie d'ordre de résolution, le
   * décodage le plus LENT peut résoudre en dernier et écraser silencieusement `this.decoded` avec
   * un fichier qui n'est déjà plus celui affiché. Un `signal` déjà annulé au moment où CE décodage
   * précis se termine signale que l'appelant a depuis démarré un autre chargement : le résultat est
   * alors ignoré (pas d'erreur — même convention que le reste du pipeline face à un abandon), sans
   * toucher à `this.decoded` ni au reste de l'état, qui restent ceux du chargement gagnant.
   */
  async load(file: File, signal?: AbortSignal): Promise<void> {
    this.stopSource();
    const decoded = await decodeAudioFile(file, this.ctx);
    if (signal?.aborted) return;
    this.decoded = decoded;
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
      // Le refus était AVALÉ (`void this.ctx.resume()`). Dans une iframe sans
      // `allow="autoplay"` — le cas d'Aaron, PULSAR étant embarqué en
      // surcouche — `resume()` rejette, et rien nulle part ne le disait : ni
      // son, ni avancée du temps, ni message. Une panne muette est une panne
      // qu'on cherche pendant des heures.
      this.ctx
        .resume()
        .then(() => {
          this.contextBlockedReason = null;
        })
        .catch((err: unknown) => {
          this.contextBlockedReason = err instanceof Error ? err.message : String(err);
          console.error("PULSAR — le contexte audio a refusé de démarrer ; la lecture avancera sans son :", err);
        });
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
    // L'horloge audio ne fait autorité QUE si le contexte tourne réellement.
    //
    // ## La panne que ceci corrige
    //
    // Signalée par Aaron : après un clic sur ▶, le compteur restait bloqué à
    // 0:00 indéfiniment, la boucle de rendu tournant pourtant (plus de 4000
    // images), le canevas pixel pour pixel identique, et AUCUNE erreur console.
    //
    // Mécanisme exact. Contexte suspendu — politique d'autoplay, ou iframe sans
    // `allow="autoplay"` — donc `ctx.currentTime` gelé, donc `currentRawT()`
    // constant à ~0. `predicted`, lui, avance sur l'horloge murale. Au bout de
    // huit images l'écart franchit `HARD_RESYNC_THRESHOLD_SECONDS` (0,12 s) et
    // `correctDrift` fait ce pour quoi il est écrit : une resynchronisation
    // dure vers la valeur mesurée, c'est-à-dire ZÉRO. À chaque image.
    // **Le transport était épinglé à zéro par un correcteur qui fonctionnait
    // parfaitement.**
    //
    // Se caler sur une horloge à l'arrêt n'a aucun sens. Quand le contexte ne
    // tourne pas, la position avance sur l'horloge murale : le visuel joue,
    // silencieusement, au lieu de se figer sans explication. La correction
    // reprend d'elle-même dès que le contexte démarre — un simple écart de plus
    // de 0,12 s déclenchera alors la resynchronisation dure prévue pour ça.
    const horlogeAudioValide = this.ctx.state === 'running';
    const result = horlogeAudioValide
      ? correctDrift(predicted, this.currentRawT())
      : { t: predicted, resynced: false };

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
    // Clamp défensif (Étape 27) : `offset` peut arriver légèrement négatif via
    // `play()` → `this.offsetSeek`, lui-même dérivé de `pause()` → `currentRawT()`
    // (`ctx.currentTime − tStart + offsetSeek − outputLatency`) — sur un cycle
    // play/pause très rapproché (quasi aucun temps réel écoulé), la soustraction
    // de `outputLatency` suffit à faire passer le résultat sous 0. `node.start(0,
    // offset)` lève alors un `RangeError` natif (bug réellement observé au
    // navigateur, Étape 24 : « offset provided (-0.0267) is less than the minimum
    // bound (0) »). Même clamp que `seek()` (`Math.max(0, Math.min(t, duration))`),
    // appliqué ici au seul point d'appel de `node.start()` — protège TOUS les
    // appelants (`play()`/`seek()`), pas seulement celui qui a déclenché le bug.
    const clamped = Math.max(0, Math.min(offset, this.decoded.buffer.duration));
    this.stopSource();
    const node = this.ctx.createBufferSource();
    node.buffer = this.decoded.buffer;
    node.loop = this.looping;
    node.connect(this.gainNode);
    node.start(0, clamped);
    this.source = node;
    this.tStart = this.ctx.currentTime;
    this.offsetSeek = clamped;
    // predictedT doit démarrer déjà compensé de la latence, sinon il part de
    // `offset` pendant que currentRawT() (dans le premier tick) part de
    // `offset − outputLatency` : l'écart initial (~outputLatency) doit alors
    // être rattrapé à 2 ms/image, ce qui fige un retard transitoire de
    // plusieurs centaines de ms à chaque play()/seek() en lecture.
    this.predictedT = clamped - this.outputLatencySeconds + this.calibrationOffsetSeconds;
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
