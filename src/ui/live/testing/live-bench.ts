/**
 * Banc d'essai NAVIGATEUR du moteur d'analyse live (§9.1, livrable
 * « live-bench.html affiche BPM et phase sur un click track »).
 *
 * Contrairement au harnais de test (`runEngine.ts`), celui-ci utilise de VRAIS
 * `AnalyserNode` sur un vrai `AudioContext` : c'est ce qui permet de verifier
 * ce que le harnais ne peut pas - `getOutputTimestamp()`, la latence de
 * sortie, et la calibration a l'oreille de `userTrimMs`.
 *
 * Fichier de banc d'essai : jamais importe par l'application.
 */

import { LiveAnalysisEngine } from '../audio/LiveAnalysisEngine';
import { mergeLiveConfig } from '../LiveConfig';

const config = mergeLiveConfig();
const ui = {
  bpm: document.getElementById('bpm') as HTMLInputElement,
  jitter: document.getElementById('jitter') as HTMLInputElement,
  start: document.getElementById('start') as HTMLButtonElement,
  stop: document.getElementById('stop') as HTMLButtonElement,
  audible: document.getElementById('audible') as HTMLInputElement,
  readout: document.getElementById('readout') as HTMLPreElement,
  canvas: document.getElementById('view') as HTMLCanvasElement,
};

const ctx2d = ui.canvas.getContext('2d');
if (!ctx2d) throw new Error('live-bench: contexte 2D indisponible');

let audio: AudioContext | null = null;
let engine: LiveAnalysisEngine | null = null;
let onset: AnalyserNode | null = null;
let bands: AnalyserNode | null = null;
let onsetDb: Float32Array<ArrayBuffer> | null = null;
let bandsDb: Float32Array<ArrayBuffer> | null = null;
let timeDomain: Float32Array<ArrayBuffer> | null = null;
let master: GainNode | null = null;
let raf = 0;
let scheduledUpTo = 0;
let beatIndex = 0;
let seed = 12345;

function rng(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

/** Kick : sinus a hauteur descendante plus un clic large bande. */
function kick(ac: AudioContext, at: number, dest: AudioNode): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.setValueAtTime(145, at);
  osc.frequency.exponentialRampToValueAtTime(55, at + 0.06);
  gain.gain.setValueAtTime(1, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
  osc.connect(gain).connect(dest);
  osc.start(at);
  osc.stop(at + 0.32);
  noise(ac, at, 0.004, 0.35, dest, 4000, 1);
}

/** Bruit filtre : sert au snare et au charley. */
function noise(
  ac: AudioContext,
  at: number,
  durSec: number,
  level: number,
  dest: AudioNode,
  centerHz: number,
  q: number,
): void {
  const frames = Math.max(1, Math.round(durSec * ac.sampleRate));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = rng() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = centerHz;
  filter.Q.value = q;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(level, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + durSec);
  src.connect(filter).connect(gain).connect(dest);
  src.start(at);
}

function snare(ac: AudioContext, at: number, dest: AudioNode): void {
  noise(ac, at, 0.09, 0.5, dest, 3500, 0.7);
  noise(ac, at, 0.06, 0.4, dest, 250, 1.2);
}

function hat(ac: AudioContext, at: number, level: number, dest: AudioNode): void {
  noise(ac, at, 0.03, level, dest, 9000, 1.2);
}

/** Programme les temps a venir. Appelee a chaque trame, elle garde 0,4 s d'avance. */
function schedule(): void {
  if (!audio || !master) return;
  const bpm = Number(ui.bpm.value) || 128;
  const jitterPct = Number(ui.jitter.value) || 0;
  const period = 60 / bpm;
  const horizon = audio.currentTime + 0.4;
  while (scheduledUpTo < horizon) {
    const jitter = jitterPct > 0 ? (rng() * 2 - 1) * jitterPct * 0.01 * period : 0;
    const at = scheduledUpTo + jitter;
    const pos = beatIndex % 4;
    kick(audio, at, master);
    if (pos === 1 || pos === 3) snare(audio, at, master);
    hat(audio, at, 0.22, master);
    hat(audio, at + period / 2, 0.16, master);
    scheduledUpTo += period;
    beatIndex++;
  }
}

function start(): void {
  stop();
  const ac = new AudioContext();
  audio = ac;
  master = ac.createGain();
  master.gain.value = 0.8;

  onset = ac.createAnalyser();
  onset.fftSize = config.audio.fftSizeOnset;
  onset.smoothingTimeConstant = config.audio.smoothingTimeConstant;
  onset.minDecibels = config.audio.minDecibels;
  onset.maxDecibels = config.audio.maxDecibels;

  bands = ac.createAnalyser();
  bands.fftSize = config.audio.fftSizeBands;
  bands.smoothingTimeConstant = config.audio.smoothingTimeConstant;
  bands.minDecibels = config.audio.minDecibels;
  bands.maxDecibels = config.audio.maxDecibels;

  master.connect(onset);
  master.connect(bands);
  // La sortie est optionnelle : le banc sert aussi a la calibration a
  // l'oreille, qui exige d'entendre le click track.
  if (ui.audible.checked) master.connect(ac.destination);

  onsetDb = new Float32Array(onset.frequencyBinCount);
  bandsDb = new Float32Array(bands.frequencyBinCount);
  timeDomain = new Float32Array(onset.fftSize);
  engine = new LiveAnalysisEngine(config, ac.sampleRate, onset.fftSize, bands.fftSize);

  scheduledUpTo = ac.currentTime + 0.2;
  beatIndex = 0;
  seed = 12345;
  void ac.resume();
  loop(0);
}

function stop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  engine?.reset();
  engine = null;
  void audio?.close();
  audio = null;
  master = null;
  onset = null;
  bands = null;
}

let lastStamp = 0;
let frameMs = 16.7;

function loop(stamp: number): void {
  raf = requestAnimationFrame(loop);
  if (!audio || !engine || !onset || !bands || !onsetDb || !bandsDb || !timeDomain) return;
  schedule();

  if (lastStamp > 0) {
    const d = stamp - lastStamp;
    if (d > 0 && d < 500) frameMs += 0.1 * (d - frameMs);
  }
  lastStamp = stamp;

  onset.getFloatFrequencyData(onsetDb);
  bands.getFloatFrequencyData(bandsDb);
  onset.getFloatTimeDomainData(timeDomain);

  const contextTime = audio.getOutputTimestamp?.().contextTime;
  const ahead =
    typeof contextTime === 'number' && contextTime > 0
      ? (audio.currentTime - contextTime) * 1000
      : (audio.baseLatency + (audio.outputLatency ?? config.sync.fallbackOutputLatencySec)) * 1000;

  engine.step({
    tAudio: audio.currentTime,
    freqOnsetDb: onsetDb,
    freqBandsDb: bandsDb,
    timeDomain,
    audioAheadMs: ahead,
    frameIntervalSec: frameMs / 1000,
  });

  render();
}

function render(): void {
  if (!engine || !ctx2d) return;
  const beat = engine.beat;
  const w = ui.canvas.width;
  const h = ui.canvas.height;
  ctx2d.fillStyle = '#0b0b12';
  ctx2d.fillRect(0, 0, w, h);

  // Pastille de temps : c'est elle qu'on filme a 240 fps avec le son pour
  // mesurer la latence reelle (point a valider par un humain, §8).
  const r = 40 + 40 * Math.max(0, 1 - beat.beatPhase * 4);
  ctx2d.fillStyle = beat.barPhase < 0.25 ? '#ff9060' : '#8f7cff';
  ctx2d.beginPath();
  ctx2d.arc(w / 2, h / 2, r, 0, Math.PI * 2);
  ctx2d.fill();

  ctx2d.strokeStyle = '#4a4a66';
  ctx2d.strokeRect(20.5, h - 40.5, w - 40, 16);
  ctx2d.fillStyle = '#60ffc0';
  ctx2d.fillRect(21, h - 40, (w - 42) * beat.beatPhase, 15);

  const sync = beat.sync;
  ui.readout.textContent = [
    `etat        ${engine.state}`,
    `tempo       ${beat.bpm.toFixed(2)} BPM   conf ${engine.tempo.confidence.toFixed(2)}   downbeat ${beat.downbeatConfidence.toFixed(2)}`,
    `octaves     ${engine.tempo.hypotheses.map((x) => `${x.bpm.toFixed(1)}:${x.score.toFixed(2)}`).join('  ')}`,
    `position    temps ${beat.beatIndex}   mesure ${beat.barIndex}   phrase ${beat.phraseIndex}`,
    `kicks       ${beat.acceptedKicks} acceptes / ${beat.rejectedKicks} rejetes   resync ${beat.hardResyncs}`,
    `sync        ${sync.totalMs.toFixed(1)} ms   avance audio ${sync.audioAheadMs.toFixed(1)} ms   trim ${sync.userTrimMs.toFixed(0)} ms`,
    `trame       ${frameMs.toFixed(1)} ms`,
  ].join('\n');
}

ui.start.addEventListener('click', start);
ui.stop.addEventListener('click', stop);
window.addEventListener('keydown', (e) => {
  if (!engine) return;
  if (e.key === 'ArrowUp') engine.beat.setUserTrimMs(engine.beat.userTrimMs + config.sync.userTrimStepMs);
  if (e.key === 'ArrowDown') engine.beat.setUserTrimMs(engine.beat.userTrimMs - config.sync.userTrimStepMs);
});
