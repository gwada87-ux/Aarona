import { describe, expect, it } from 'vitest';
import { createMulberry32 } from '../../src/core/rng/mulberry32';
import { runAnalysisPipeline } from '../../src/analysis/AnalysisPipeline';
import { finalizePmdi } from '../../src/analysis/finalize';

/**
 * bench:analysis (docs/11_TESTING.md §"Niveau 4 — Tests de performance",
 * docs/00b_MASTER_PROMPT_V2.md §6) : « morceau de 4 min → ≤ 8 s ». Exclu de
 * la suite rapide (`vitest.bench.config.ts`, pas `vitest.config.ts`) —
 * génère ~10,5 M échantillons et fait tourner le pipeline d'analyse complet,
 * bien plus lent qu'un test unitaire ordinaire.
 *
 * Le SEUL étage réellement bancable sans navigateur : `bench:render` a
 * besoin d'un vrai Canvas 2D (absent de l'environnement Node de ce projet,
 * `environment: 'node'` dans vitest.config.ts — l'ajouter exigerait une
 * dépendance native comme `node-canvas`, une décision d'ADR, pas prise ici),
 * `bench:export` a besoin de WebCodecs, `bench:memory`/`bench:leak` ont
 * besoin de `performance.memory` (Chrome uniquement). Voir docs/JOURNAL.md,
 * Étape 17/P15.
 *
 * `runAnalysisPipeline` est la fonction PURE appelée à l'intérieur du Worker
 * (`analysis/worker.ts`) — l'appeler directement ici mesure le même travail
 * DSP, sans la latence de `postMessage`/sérialisation (négligeable pour un
 * message par analyse, pas ce qui est mesuré par ce critère). `finalizePmdi`
 * (thread principal en usage réel) est chaîné à la suite pour mesurer le
 * temps de bout en bout tel que vécu par `ui/pipeline.ts::importTrack`.
 */

const SAMPLE_RATE = 44100;
const DURATION_SEC = 4 * 60;
const BPM = 120;

/**
 * Signal synthétique déterministe (PRNG seedé, Loi 1) : fond tonal (deux
 * sinusoïdes graves) + enveloppe percussive périodique à 120 BPM (decay
 * exponentiel après chaque temps, pour donner à `onsets.ts`/`tempo.ts` de
 * vraies transitoires à détecter) + bruit large bande faible amplitude (pour
 * que `bands.ts`/`stft.ts` voient un contenu haute fréquence non nul, comme
 * des hats). N'a besoin d'être ni musical ni précis — seul le TEMPS
 * D'EXÉCUTION du pipeline est mesuré, pas la qualité de la détection
 * (docs/11 Niveau 2, hors périmètre de ce banc).
 */
function generateSyntheticSignal(durationSec: number, sampleRate: number, seed: number): Float32Array {
  const rng = createMulberry32(seed);
  const length = Math.round(durationSec * sampleRate);
  const signal = new Float32Array(length);
  const beatSec = 60 / BPM;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const tone = 0.15 * Math.sin(2 * Math.PI * 110 * t) + 0.08 * Math.sin(2 * Math.PI * 220 * t);
    const beatPhase = (t % beatSec) / beatSec;
    const kickEnvelope = Math.exp(-beatPhase * 40);
    const kick = 0.6 * kickEnvelope * Math.sin(2 * Math.PI * 60 * t);
    const noise = 0.05 * (rng.next() * 2 - 1);
    signal[i] = tone + kick + noise;
  }
  return signal;
}

describe('bench:analysis', () => {
  it('analyse un morceau synthétique de 4 minutes en ≤ 8 s (docs/11, docs/00b §6)', () => {
    const signal = generateSyntheticSignal(DURATION_SEC, SAMPLE_RATE, 1);

    // Chronométrage par étape (via `onProgress`, déjà exposé par `runAnalysisPipeline` pour la
    // barre de progression UI) : un diagnostic utile en cas d'échec, pas seulement un total brut.
    let lastMark = performance.now();
    const stageDurationsMs: Record<string, number> = {};
    const startedAt = performance.now();
    const { pmdi } = runAnalysisPipeline({
      signal,
      sampleRate: SAMPLE_RATE,
      onProgress: (_fraction, stage) => {
        const now = performance.now();
        stageDurationsMs[stage] = now - lastMark;
        lastMark = now;
      },
    });
    const finalizeStartedAt = performance.now();
    const finalized = finalizePmdi(pmdi);
    stageDurationsMs.finalize = performance.now() - finalizeStartedAt;
    const elapsedMs = performance.now() - startedAt;

    // eslint-disable-next-line no-console
    console.log(`bench:analysis — ${DURATION_SEC / 60} min à ${SAMPLE_RATE} Hz : ${elapsedMs.toFixed(0)} ms au total`);
    for (const [stage, ms] of Object.entries(stageDurationsMs)) {
      // eslint-disable-next-line no-console
      console.log(`  ${stage.padEnd(11)} ${ms.toFixed(0)} ms`);
    }

    expect(finalized.audio.duration).toBeCloseTo(DURATION_SEC, 0);
    expect(elapsedMs).toBeLessThanOrEqual(8000);
  });
});
