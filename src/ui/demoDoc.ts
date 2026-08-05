/**
 * Document PMDI synthétique de démonstration — extrait du harnais P7/P9/P11
 * (`main.ts`, `buildSyntheticDoc`) pour un bouton « Charger une démo » dans
 * l'UI réelle (Étape 14/P12) : permet de vérifier tout le pipeline visuel
 * sans dépendre d'un fichier audio sous la main. Étendu ici avec `grid`
 * (beats/downbeats) et `sections` — absents de l'original, nécessaires pour
 * la timeline (Étape 14) qui n'existait pas encore quand ce document a été
 * écrit.
 */
import type { MusicEvent, PmdiDocument, Section } from '../music/pmdi';

export function buildDemoDoc(durationSec = 60): PmdiDocument {
  const events: MusicEvent[] = [];
  const beatDur = 0.5; // 120 BPM
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let beat = 0; beat * beatDur < durationSec; beat++) {
    const t = beat * beatDur;
    beats.push(t);
    events.push({ t, type: 'KICK', intensity: 0.75 + 0.2 * Math.sin(beat), confidence: 0.9 });
    if (beat % 4 === 0) {
      downbeats.push(t);
      events.push({ t, type: 'DOWNBEAT', intensity: 1, confidence: 0.95 });
    }
    if (beat % 4 === 1 || beat % 4 === 3) events.push({ t, type: 'SNARE', intensity: 0.65, confidence: 0.85 });
  }
  for (let eighth = 0; eighth * (beatDur / 2) < durationSec; eighth++) {
    events.push({ t: eighth * (beatDur / 2), type: 'HAT', intensity: 0.3, confidence: 0.8 });
  }
  const dropTimes = [8, 20, 36].filter((t) => t < durationSec);
  for (const dropT of dropTimes) events.push({ t: dropT, type: 'DROP', intensity: 1, confidence: 0.7 });
  for (const dropT of dropTimes) events.push({ t: dropT - 3, type: 'BUILDUP', intensity: 0.9, confidence: 0.7, dur: 3 });
  events.sort((a, b) => a.t - b.t);

  const hz = 10;
  const sampleCount = Math.ceil(durationSec * hz) + 1;
  const energy = new Array<number>(sampleCount);
  const centroid = new Array<number>(sampleCount);
  const bandIds = ['sub', 'bass', 'lowmid', 'mid', 'himid', 'high'];
  const bands: Record<string, number[]> = {};
  for (const id of bandIds) bands[id] = new Array<number>(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / hz;
    energy[i] = 0.5 + 0.35 * Math.sin(t * 0.25);
    centroid[i] = 0.5 + 0.4 * Math.sin(t * 0.15 + 2);
    bandIds.forEach((id, bandIndex) => {
      const phase = bandIndex * 0.9;
      const freq = 0.3 + bandIndex * 0.05;
      bands[id]![i] = 0.5 + 0.4 * Math.sin(t * freq + phase);
    });
  }

  // Sections synthétiques (A basse énergie, B haute énergie, A à nouveau) — juste assez pour
  // que la timeline ait quelque chose à afficher, sans prétendre à une vraie détection.
  const sections: Section[] = [
    { t: 0, dur: durationSec * 0.3, energy: 0.3, letter: 'A', confidence: 1 },
    { t: durationSec * 0.3, dur: durationSec * 0.4, energy: 0.85, letter: 'B', confidence: 1 },
    { t: durationSec * 0.7, dur: durationSec * 0.3, energy: 0.3, letter: 'A', confidence: 1 },
  ];

  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'ui-demo@1.0', createdAt: new Date(0).toISOString() },
    audio: { duration: durationSec, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    grid: { beats, downbeats },
    events,
    features: [
      { id: 'energy', hz, t0: 0, data: energy },
      { id: 'centroid', hz, t0: 0, data: centroid },
      ...bandIds.map((id) => ({ id: `band.${id}`, hz, t0: 0, data: bands[id]! })),
    ],
    sections,
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

/**
 * Fichier WAV synthétique (ton 220 Hz discret, déterministe — même choix que
 * l'ancien harnais, `main.ts`/P8, « pas de Math.random, pas de fichier
 * source ») pour donner un `AudioBuffer` RÉEL à `AudioEngine.load()` : sans
 * fichier réellement décodé, `AudioEngine.play()` ne fait rien
 * (`if (!this.decoded || this.playing) return`) et le bouton Lecture de la
 * démo resterait inerte. Passe par le VRAI chemin de décodage
 * (`decodeAudioFile`), pas un contournement.
 */
export function buildDemoAudioFile(durationSec = 60, sampleRate = 48000): File {
  const numSamples = Math.round(durationSec * sampleRate);
  const blockAlign = 2; // mono, 16 bits
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits/échantillon
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const sample = 0.15 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }

  return new File([buffer], 'pulsar-demo.wav', { type: 'audio/wav' });
}
