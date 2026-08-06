/**
 * Banc d'essai synthetique (§7) : genere du PCM equivalent a de vraies frappes
 * de batterie, SANS navigateur et SANS dependance ajoutee. Le spectre consomme
 * par le moteur est ensuite calcule par `AnalyserModel` (vraie FFT), pas
 * fabrique analytiquement - sinon le test validerait le generateur plutot que
 * le detecteur.
 *
 * Le kick porte volontairement un CLIC large bande : c'est exactement ce qui
 * fait declencher a tort un detecteur de snare construit sur une somme de flux
 * au lieu d'une moyenne geometrique (§2.3). Un generateur trop propre
 * masquerait le defaut.
 *
 * Deterministe : PRNG seede, aucun `Math.random`.
 */

export interface SyntheticSignal {
  readonly pcm: Float32Array;
  readonly sampleRate: number;
  readonly durationSec: number;
  /** Instants reels des kicks, jitter compris - reference du test d'erreur de phase. */
  readonly kickTimes: readonly number[];
  /** Instants reels des « 1 » de mesure. */
  readonly downbeatTimes: readonly number[];
}

export const DEFAULT_SAMPLE_RATE = 48000;

type HitKind = 'kick' | 'snare' | 'hat' | 'bass';

interface Hit {
  readonly t: number;
  readonly kind: HitKind;
  readonly gain: number;
}

/** PRNG seede (mulberry32) - deterministe et sans dependance. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Passe-bande biquad (recette RBJ), applique en cascade pour des flancs plus
 * raides. En cascader deux evite que le bruit du charley (6-13 kHz) fuie dans
 * la bande 2-6 kHz du detecteur de snare.
 */
function biquadBandpass(buf: Float32Array, sampleRate: number, f0: number, q: number, passes: number): void {
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  for (let p = 0; p < passes; p++) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < buf.length; i++) {
      const x0 = buf[i] ?? 0;
      const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      buf[i] = y0;
    }
  }
}

/**
 * Bruit de bande : VRAI bruit blanc filtre, pas une somme de sinusoides.
 *
 * La somme de sinusoides parait equivalente a l'oreille mais donne un spectre
 * de raies discretes : la platitude spectrale mesuree sur 2-12 kHz s'effondre
 * a 0,2 la ou du bruit donne 0,9, et la porte du detecteur de charley
 * (`flatness > 0.35`) se ferme sur toutes les frappes. Le banc d'essai
 * validerait alors un detecteur qui ne detecte rien.
 */
function bandNoise(out: Float32Array, sampleRate: number, loHz: number, hiHz: number, rng: () => number): void {
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
  const f0 = Math.sqrt(loHz * hiHz);
  const q = f0 / Math.max(1, hiHz - loHz);
  biquadBandpass(out, sampleRate, f0, q, 2);
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i] ?? 0);
    if (a > peak) peak = a;
  }
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / peak;
}

function envelope(out: Float32Array, sampleRate: number, tauSec: number): void {
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * Math.exp(-i / sampleRate / tauSec);
}

function makeKick(sampleRate: number, rng: () => number): Float32Array {
  const n = Math.round(0.35 * sampleRate);
  const buf = new Float32Array(n);
  // Chute de hauteur 145 -> 55 Hz en 20 ms, phase integree analytiquement.
  const f0 = 55;
  const drop = 90;
  const tau = 0.02;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const phi = 2 * Math.PI * (f0 * t + drop * tau * (1 - Math.exp(-t / tau)));
    buf[i] = Math.sin(phi) * Math.exp(-t / 0.1);
  }
  // Clic large bande de 2 ms : le piege a detecteur de snare.
  const clickLen = Math.round(0.004 * sampleRate);
  for (let i = 0; i < clickLen; i++) {
    const t = i / sampleRate;
    buf[i] = (buf[i] ?? 0) + 0.35 * (rng() * 2 - 1) * Math.exp(-t / 0.0015);
  }
  return buf;
}

function makeSnare(sampleRate: number, rng: () => number): Float32Array {
  const n = Math.round(0.25 * sampleRate);
  const buf = new Float32Array(n);
  const low = new Float32Array(n);
  const high = new Float32Array(n);
  bandNoise(low, sampleRate, 150, 400, rng);
  envelope(low, sampleRate, 0.06);
  bandNoise(high, sampleRate, 2000, 6000, rng);
  envelope(high, sampleRate, 0.09);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const tone = Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t / 0.05) * 0.3;
    buf[i] = tone + 0.45 * (low[i] ?? 0) + 0.6 * (high[i] ?? 0);
  }
  return buf;
}

function makeHat(sampleRate: number, rng: () => number): Float32Array {
  const n = Math.round(0.09 * sampleRate);
  const buf = new Float32Array(n);
  bandNoise(buf, sampleRate, 6000, 13000, rng);
  envelope(buf, sampleRate, 0.025);
  for (let i = 0; i < n; i++) buf[i] = (buf[i] ?? 0) * 0.5;
  return buf;
}

function makeBass(sampleRate: number): Float32Array {
  const n = Math.round(0.5 * sampleRate);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    buf[i] = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t / 0.3) * 0.5;
  }
  return buf;
}

interface Kit {
  readonly kick: Float32Array;
  readonly snare: Float32Array;
  readonly hat: Float32Array;
  readonly bass: Float32Array;
}

const kitCache = new Map<number, Kit>();

function kitFor(sampleRate: number): Kit {
  const cached = kitCache.get(sampleRate);
  if (cached) return cached;
  const rng = mulberry32(0x5eed);
  const kit: Kit = {
    kick: makeKick(sampleRate, rng),
    snare: makeSnare(sampleRate, rng),
    hat: makeHat(sampleRate, rng),
    bass: makeBass(sampleRate),
  };
  kitCache.set(sampleRate, kit);
  return kit;
}

function render(
  hits: readonly Hit[],
  durationSec: number,
  sampleRate: number,
  noiseFloorDbfs: number,
  seed: number,
): Float32Array {
  const kit = kitFor(sampleRate);
  const n = Math.round(durationSec * sampleRate);
  const pcm = new Float32Array(n);
  for (const hit of hits) {
    const src = kit[hit.kind];
    const at = Math.round(hit.t * sampleRate);
    for (let i = 0; i < src.length; i++) {
      const j = at + i;
      if (j < 0 || j >= n) continue;
      pcm[j] = (pcm[j] ?? 0) + (src[i] ?? 0) * hit.gain;
    }
  }
  if (noiseFloorDbfs > -200) {
    const rng = mulberry32(seed);
    const amp = Math.pow(10, noiseFloorDbfs / 20) * Math.SQRT2;
    for (let i = 0; i < n; i++) pcm[i] = (pcm[i] ?? 0) + amp * (rng() * 2 - 1);
  }
  // Normalisation douce : un master reel n'ecrete pas, mais ne vit pas non
  // plus a -30 dBFS. Vise un pic a 0.85.
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(pcm[i] ?? 0);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    const g = 0.85 / peak;
    for (let i = 0; i < n; i++) pcm[i] = (pcm[i] ?? 0) * g;
  }
  return pcm;
}

interface PatternOptions {
  readonly sampleRate?: number;
  readonly jitterPct?: number;
  readonly seed?: number;
  readonly noiseFloorDbfs?: number;
  /** Ajoute une note de basse sur le « 1 » : marque la mesure sans toucher au kick. */
  readonly bassOnDownbeat?: boolean;
  /** Charley sur la croche. */
  readonly hats?: boolean;
  readonly beatsPerBar?: number;
}

/**
 * Motif 4/4 de base : kick sur 1 et 3, snare sur 2 et 4, charley sur la croche.
 * `bpmAt` permet les rampes de tempo.
 */
function buildPattern(
  durationSec: number,
  bpmAt: (beatIndex: number) => number,
  opts: PatternOptions,
): { hits: Hit[]; kickTimes: number[]; downbeatTimes: number[] } {
  const jitterPct = opts.jitterPct ?? 0;
  const rng = mulberry32(opts.seed ?? 0xc0ffee);
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const hits: Hit[] = [];
  const kickTimes: number[] = [];
  const downbeatTimes: number[] = [];

  let t = 0;
  let beat = 0;
  while (t < durationSec) {
    const period = 60 / bpmAt(beat);
    const jitter = jitterPct > 0 ? (rng() * 2 - 1) * jitterPct * 0.01 * period : 0;
    const tb = t + jitter;
    const pos = beat % beatsPerBar;

    if (pos === 0) downbeatTimes.push(tb);

    // §7 : « kick 60 Hz sur la NOIRE » - sur chaque temps, pas seulement 1 et 3.
    if (tb >= 0 && tb < durationSec) {
      hits.push({ t: tb, kind: 'kick', gain: pos === 0 ? 1 : 0.85 });
      kickTimes.push(tb);
    }
    if (beatsPerBar === 4 && (pos === 1 || pos === 3) && tb < durationSec) {
      hits.push({ t: tb, kind: 'snare', gain: 0.9 });
    }
    if (opts.hats !== false) {
      hits.push({ t: tb, kind: 'hat', gain: 0.7 });
      const half = tb + period / 2;
      if (half < durationSec) hits.push({ t: half, kind: 'hat', gain: 0.5 });
    }
    if (opts.bassOnDownbeat === true && pos === 0) {
      hits.push({ t: tb, kind: 'bass', gain: 0.9 });
    }

    t += period;
    beat++;
  }
  return { hits, kickTimes, downbeatTimes };
}

function finish(
  built: { hits: Hit[]; kickTimes: number[]; downbeatTimes: number[] },
  durationSec: number,
  opts: PatternOptions,
): SyntheticSignal {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  return {
    pcm: render(built.hits, durationSec, sampleRate, opts.noiseFloorDbfs ?? -65, (opts.seed ?? 1) + 7),
    sampleRate,
    durationSec,
    kickTimes: built.kickTimes,
    downbeatTimes: built.downbeatTimes,
  };
}

/** Kick sur la noire, snare sur 2 et 4, charley sur la croche (§7). */
export function clickTrack(bpm: number, durationSec: number, opts: PatternOptions = {}): SyntheticSignal {
  return finish(buildPattern(durationSec, () => bpm, opts), durationSec, opts);
}

/** Silence numerique pur : rien a detecter, et l'AGC doit rester gele. */
export function silence(durationSec: number, sampleRate = DEFAULT_SAMPLE_RATE): SyntheticSignal {
  return {
    pcm: new Float32Array(Math.round(durationSec * sampleRate)),
    sampleRate,
    durationSec,
    kickTimes: [],
    downbeatTimes: [],
  };
}

/** Bruit blanc large bande : de l'energie partout, aucune periodicite. */
export function whiteNoise(durationSec: number, amplitude = 0.25, sampleRate = DEFAULT_SAMPLE_RATE, seed = 99): SyntheticSignal {
  const n = Math.round(durationSec * sampleRate);
  const pcm = new Float32Array(n);
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i++) pcm[i] = amplitude * (rng() * 2 - 1);
  return { pcm, sampleRate, durationSec, kickTimes: [], downbeatTimes: [] };
}

/** Balayage sinusoidal 40 Hz -> 12 kHz : energie mouvante, aucun transitoire. */
export function sweep(durationSec: number, sampleRate = DEFAULT_SAMPLE_RATE): SyntheticSignal {
  const n = Math.round(durationSec * sampleRate);
  const pcm = new Float32Array(n);
  const f0 = 40;
  const f1 = 12000;
  const k = Math.log(f1 / f0) / durationSec;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    pcm[i] = 0.6 * Math.sin(((2 * Math.PI * f0) / k) * (Math.exp(k * t) - 1));
  }
  return { pcm, sampleRate, durationSec, kickTimes: [], downbeatTimes: [] };
}

/**
 * Rampe de tempo : `holdSec` au tempo de depart, `rampSec` de transition
 * lineaire, puis maintien au tempo d'arrivee. Le test de reverrouillage mesure
 * a partir de la FIN de la rampe.
 */
export function tempoRamp(
  fromBpm: number,
  toBpm: number,
  durationSec: number,
  holdSec: number,
  rampSec: number,
  opts: PatternOptions = {},
): SyntheticSignal & { readonly rampEndSec: number } {
  let elapsed = 0;
  const bpmAt = (beatIndex: number): number => {
    // `elapsed` suit la construction sequentielle de `buildPattern`.
    void beatIndex;
    const k = elapsed <= holdSec ? 0 : Math.min(1, (elapsed - holdSec) / rampSec);
    const bpm = fromBpm + (toBpm - fromBpm) * k;
    elapsed += 60 / bpm;
    return bpm;
  };
  const built = buildPattern(durationSec, bpmAt, opts);
  return { ...finish(built, durationSec, opts), rampEndSec: holdSec + rampSec };
}

/** Swing : la croche de charley est repoussee selon `ratio` (0.5 = droit, 0.66 = triolet). */
export function swing(bpm: number, durationSec: number, ratio = 0.66, opts: PatternOptions = {}): SyntheticSignal {
  const built = buildPattern(durationSec, () => bpm, { ...opts, hats: false });
  const period = 60 / bpm;
  for (let t = 0; t < durationSec; t += period) {
    built.hits.push({ t, kind: 'hat', gain: 0.7 });
    const off = t + period * ratio;
    if (off < durationSec) built.hits.push({ t: off, kind: 'hat', gain: 0.5 });
  }
  return finish(built, durationSec, opts);
}

/** 3/4 : pas de backbeat, le downbeat ne peut venir que de la nouveaute et de la basse. */
export function waltz3_4(bpm: number, durationSec: number, opts: PatternOptions = {}): SyntheticSignal {
  return finish(
    buildPattern(durationSec, () => bpm, { ...opts, beatsPerBar: 3, bassOnDownbeat: true }),
    durationSec,
    opts,
  );
}

/** Double kick : une double-croche de kick sur chaque temps - piege du refractaire fixe. */
export function doubleKick(bpm: number, durationSec: number, opts: PatternOptions = {}): SyntheticSignal {
  const built = buildPattern(durationSec, () => bpm, opts);
  const period = 60 / bpm;
  const extra: Hit[] = [];
  for (const t of built.kickTimes) {
    const second = t + period / 4;
    if (second < durationSec) extra.push({ t: second, kind: 'kick', gain: 0.7 });
  }
  built.hits.push(...extra);
  return finish(built, durationSec, opts);
}

/** Cas critique du downbeat : kick sur les 4 temps, clap sur 2 et 4, basse sur le « 1 ». */
export function fourOnTheFloor(bpm: number, durationSec: number, opts: PatternOptions = {}): SyntheticSignal {
  return finish(buildPattern(durationSec, () => bpm, { ...opts, bassOnDownbeat: true }), durationSec, opts);
}

/** 8 mesures pleines, 8 mesures quasi vides, puis drop - materiau de §2.7.9. */
export function breakdownDrop(bpm: number, opts: PatternOptions = {}): SyntheticSignal {
  const barSec = (60 / bpm) * 4;
  const durationSec = barSec * 24;
  const built = buildPattern(durationSec, () => bpm, { ...opts, bassOnDownbeat: true });
  const from = barSec * 8;
  const to = barSec * 16;
  const hits = built.hits.filter((h) => h.t < from || h.t >= to || h.kind === 'hat');
  return finish({ ...built, hits }, durationSec, opts);
}

/** Concatene plusieurs signaux de meme `sampleRate` (silence puis bruit, etc.). */
export function concat(...parts: readonly SyntheticSignal[]): SyntheticSignal {
  const first = parts[0];
  if (!first) throw new Error('concat: au moins un signal');
  const sampleRate = first.sampleRate;
  let total = 0;
  for (const p of parts) {
    if (p.sampleRate !== sampleRate) throw new Error('concat: sampleRate heterogenes');
    total += p.pcm.length;
  }
  const pcm = new Float32Array(total);
  const kickTimes: number[] = [];
  const downbeatTimes: number[] = [];
  let offset = 0;
  for (const p of parts) {
    pcm.set(p.pcm, offset);
    const shift = offset / sampleRate;
    for (const t of p.kickTimes) kickTimes.push(t + shift);
    for (const t of p.downbeatTimes) downbeatTimes.push(t + shift);
    offset += p.pcm.length;
  }
  return { pcm, sampleRate, durationSec: total / sampleRate, kickTimes, downbeatTimes };
}
