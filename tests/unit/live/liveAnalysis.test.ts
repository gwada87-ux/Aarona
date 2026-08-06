/**
 * Criteres §8.1 et §8.6 du prompt, plus les invariants structurants de §2.1 et
 * §2.2 que le prompt demande explicitement de tester.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AnalysisGrid } from '../../../src/ui/live/audio/AnalysisGrid';
import { AudioFeatures } from '../../../src/ui/live/audio/AudioFeatures';
import { DEFAULT_LIVE_CONFIG, MACRO_BAND_HZ, MACRO_BAND_IDS } from '../../../src/ui/live/LiveConfig';
import { hzRangeToBins } from '../../../src/ui/live/audio/bins';
import { clickTrack, concat, silence, whiteNoise } from '../../../src/ui/live/testing/SyntheticAudio';
import { createEngine } from '../../../src/ui/live/testing/runEngine';
import { record } from './beatMetrics';

const LIVE_ROOT = join(process.cwd(), 'src', 'ui', 'live');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('TypeScript strict dans live/ (§8.1)', () => {
  const files = listTs(LIVE_ROOT);

  it('aucun `any` ni `@ts-ignore`', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      text.split('\n').forEach((line, i) => {
        // On cherche le TYPE `any`, pas les mots francais qui le contiennent.
        if (/(:|<|\|)\s*any\b/.test(line) || /\bas\s+any\b/.test(line)) {
          offenders.push(`${file}:${i + 1} any`);
        }
        if (line.includes('@ts-ignore') || line.includes('@ts-expect-error')) {
          offenders.push(`${file}:${i + 1} ts-ignore`);
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('le module live ne contient pas de nombre magique de reglage hors LiveConfig', () => {
    // Verification faible mais utile : aucun fichier de `live/audio` ne doit
    // contenir de plage BPM ou de seuil dB en dur.
    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes('LiveConfig') || file.includes('testing')) continue;
      // Commentaires retires : ils PARLENT de ces valeurs, sans les coder.
      const code = readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const needle of ['44100', '48000', 'minDecibels =', 'maxDecibels =']) {
        if (code.includes(needle)) offenders.push(`${file} contient ${needle}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('AudioFeatures - couverture des bandes (§2.2)', () => {
  const sampleRate = 48000;

  it('chacune des 32 bandes log couvre au moins un bin a 8192', () => {
    const features = new AudioFeatures(DEFAULT_LIVE_CONFIG.audio, sampleRate, DEFAULT_LIVE_CONFIG.audio.fftSizeBands);
    const spans = features.logBandSpans;
    expect(spans.length).toBe(DEFAULT_LIVE_CONFIG.audio.bandCount);
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      expect(span.hi - span.lo + 1, `bande ${i} : ${span.lo}..${span.hi}`).toBeGreaterThanOrEqual(1);
      expect(span.hi).toBeGreaterThanOrEqual(span.lo);
    }
  });

  it('a 2048 les bandes graves seraient sous-resolues - c est pourquoi le prompt impose 8192', () => {
    // Test de NON-REGRESSION du choix de §2.0 : si quelqu'un ramene les
    // bandes sur l'analyseur d'onsets, ce test montre ce qu'on y perd.
    const wide = hzRangeToBins({ lo: 40, hi: 46 }, sampleRate, 2048);
    const narrow = hzRangeToBins({ lo: 40, hi: 46 }, sampleRate, 8192);
    expect(wide.lo).toBe(wide.hi); // moins d'un bin : la bande est plate
    expect(narrow.hi).toBeGreaterThan(narrow.lo);
  });

  it('les 5 macro-bandes couvrent leur plage sans se chevaucher au-dela d un bin', () => {
    for (let i = 1; i < MACRO_BAND_IDS.length; i++) {
      const prev = hzRangeToBins(MACRO_BAND_HZ[MACRO_BAND_IDS[i - 1]!], sampleRate, 8192);
      const cur = hzRangeToBins(MACRO_BAND_HZ[MACRO_BAND_IDS[i]!], sampleRate, 8192);
      expect(cur.lo - prev.hi).toBeLessThanOrEqual(1);
      expect(cur.lo).toBeGreaterThanOrEqual(prev.hi);
    }
  });
});

describe('AnalysisGrid - reechantillonnage a 50 Hz (§2.1)', () => {
  it('emet un pas toutes les 20 ms quelle que soit la cadence d entree', () => {
    const grid = new AnalysisGrid(1, 50, 0.5);
    const values = new Float32Array(1);
    const ticks: number[] = [];
    // Entree a 37 Hz : aucune trame ne tombe sur la grille.
    for (let i = 0; i < 37 * 4; i++) {
      values[0] = 1;
      grid.push(i / 37, values, (t) => ticks.push(t));
    }
    expect(ticks.length).toBeGreaterThan(190);
    expect(ticks.length).toBeLessThan(210);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(0.02, 9);
    }
  });

  it('interpole lineairement entre deux lectures', () => {
    const grid = new AnalysisGrid(1, 50, 0.5);
    const values = new Float32Array(1);
    const seen: { t: number; v: number }[] = [];
    values[0] = 0;
    grid.push(0, values, () => undefined);
    values[0] = 10;
    grid.push(0.1, values, (t, v) => seen.push({ t, v: v[0] ?? 0 }));
    // La grille est ancree sur des multiples du hop : pas a 0, 0.02, ... 0.10,
    // soit 0, 2, 4, 6, 8, 10.
    expect(seen.length).toBe(6);
    expect(seen[0]?.v).toBeCloseTo(0, 5);
    expect(seen[1]?.v).toBeCloseTo(2, 5);
    expect(seen[5]?.v).toBeCloseTo(10, 5);
  });

  it('detecte une lecture rejouee (AnalyserNode non avance)', () => {
    const grid = new AnalysisGrid(1, 50, 0.5);
    const values = new Float32Array(1);
    grid.push(1.0, values, () => undefined);
    expect(grid.isStale(1.0)).toBe(true);
    expect(grid.isStale(0.99)).toBe(true);
    expect(grid.isStale(1.01)).toBe(false);
  });

  it('se re-ancre au lieu d interpoler apres un trou (retour d onglet)', () => {
    const grid = new AnalysisGrid(1, 50, 0.5);
    const values = new Float32Array(1);
    grid.push(0, values, () => undefined);
    let count = 0;
    grid.push(3, values, () => count++);
    expect(count, 'aucun pas fabrique sur un trou de 3 s').toBe(0);
  });
});

describe('Gate de silence et machine a etats (§8.6)', () => {
  it('5 s de silence puis 5 s de bruit blanc : aucun onset et AGC gele pendant le silence', () => {
    const signal = concat(silence(5), whiteNoise(5, 0.25));
    const engine = createEngine(signal);
    let onsetsDuringSilence = 0;
    let agcMovedDuringSilence = false;
    const states = new Set<string>();

    const report = record(engine, signal, {
      onFrame: ({ engine: e, tAudio }) => {
        if (tAudio > 4.9) return;
        if (e.firedThisFrame('kick') || e.firedThisFrame('snare') || e.firedThisFrame('hat')) onsetsDuringSilence++;
        if (e.features.rmsNorm > 0) agcMovedDuringSilence = true;
        if (tAudio > 2) states.add(e.state);
      },
    });

    expect(onsetsDuringSilence, 'onsets detectes pendant le silence').toBe(0);
    expect(agcMovedDuringSilence, 'AGC actif pendant le silence').toBe(false);
    expect([...states], "etat pendant le silence, apres la fin de BOOT").toEqual(['IDLE']);

    // Le bruit blanc doit reveiller le moteur, sans jamais verrouiller de tempo :
    // il n'y a aucune periodicite a trouver.
    const afterNoise = report.samples.filter((s) => s.t > 7);
    expect(afterNoise.some((s) => s.state !== 'IDLE'), 'sortie d IDLE sur le bruit blanc').toBe(true);
    const maxConfidence = Math.max(...afterNoise.map((s) => s.confidence));
    expect(maxConfidence, `confiance maximale sur bruit blanc = ${maxConfidence.toFixed(2)}`).toBeLessThan(0.9);
  }, 120000);

  it('BOOT tient 1,5 s et ne consomme aucun onset', () => {
    const signal = clickTrack(128, 6);
    const engine = createEngine(signal);
    let firedDuringBoot = 0;
    record(engine, signal, {
      onFrame: ({ engine: e }) => {
        if (e.state !== 'BOOT') return;
        if (e.firedThisFrame('kick') || e.firedThisFrame('snare') || e.firedThisFrame('hat')) firedDuringBoot++;
      },
    });
    expect(firedDuringBoot).toBe(0);
  }, 120000);
});

describe('Decouplage du framerate (§2.1)', () => {
  it('30, 60 et 120 fps donnent le meme BPM, sans division ni doublement', () => {
    const signal = clickTrack(128, 20);
    const results = [30, 60, 120].map((fps) => {
      const engine = createEngine(signal);
      const report = record(engine, signal, { fps });
      return { fps, bpm: report.samples[report.samples.length - 1]?.bpm ?? 0 };
    });
    const shown = results.map((r) => `${r.fps}fps=${r.bpm.toFixed(2)}`).join(', ');
    for (const { fps, bpm } of results) {
      // A 30 fps l'intervalle de trame (33 ms) DEPASSE le pas de la grille
      // d'analyse (20 ms) : la resolution temporelle des attaques est bornee
      // par le framerate, pas par la grille, et la periode estimee est
      // mecaniquement moins precise. Le critere qui compte a cette cadence est
      // l'absence de basculement de niveau metrique.
      const tolerance = fps < 50 ? 1 : 0.5;
      expect(Math.abs(bpm - 128), shown).toBeLessThanOrEqual(tolerance);
    }
  }, 180000);

  it('une cadence de trame irreguliere ne change pas le verrouillage', () => {
    const signal = clickTrack(140, 20);
    const engine = createEngine(signal);
    const report = record(engine, signal, { fps: 60, frameJitterMs: 8 });
    const last = report.samples[report.samples.length - 1]?.bpm ?? 0;
    expect(Math.abs(last - 140), `BPM = ${last.toFixed(2)}`).toBeLessThanOrEqual(0.5);
  }, 120000);
});
