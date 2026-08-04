// spike-analysis/dirac-test.mjs — LE test obligatoire avant tout autre travail DSP
// (docs/04_AUDIO_ANALYSIS.md l.94-97). Node natif, aucune dépendance (Vitest n'est
// pas encore installé — ce sera P2, cf. docs/15_ADR.md).
//
//   node spike-analysis/dirac-test.mjs

import assert from 'node:assert/strict';
import { fft, stft, spectralFlux, detectSingleOnset, WINDOW_SIZE, HOP } from './stft.mjs';

const SAMPLE_RATE = 22050; // sr_analyse, docs/04 Étape 0
const DURATION_S = 6;
const TARGET_S = 3.0;
const TOLERANCE_MS = 2;

function buildSilenceWithImpulse(atSec, sampleRate, durationSec) {
  const n = Math.round(durationSec * sampleRate);
  const sig = new Float64Array(n);
  sig[Math.round(atSec * sampleRate)] = 1.0;
  return sig;
}

function assertClose(actual, expected, epsilon, msg) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${msg}: attendu ${expected}, obtenu ${actual} (écart ${Math.abs(actual - expected)})`);
}

let passed = 0;

// --- 0a. FFT : impulsion → spectre plat (DFT d'un dirac = constante) ---------------
{
  const n = 8;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re[0] = 1;
  fft(re, im);
  for (let k = 0; k < n; k++) {
    assertClose(re[k], 1, 1e-9, `FFT(impulsion)[${k}].re`);
    assertClose(im[k], 0, 1e-9, `FFT(impulsion)[${k}].im`);
  }
  console.log('[OK] FFT(impulsion) = spectre plat (contrôle de correction de la FFT)');
  passed++;
}

// --- 0b. FFT vs DFT naïve sur un signal quelconque ---------------------------------
{
  const n = 16;
  const signal = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 3 * i) / n) + 0.3 * Math.cos((2 * Math.PI * 5 * i) / n));
  const re = Float64Array.from(signal);
  const im = new Float64Array(n);
  fft(re, im);

  for (let k = 0; k < n; k++) {
    let sumRe = 0;
    let sumIm = 0;
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n;
      sumRe += signal[t] * Math.cos(ang);
      sumIm += signal[t] * Math.sin(ang);
    }
    assertClose(re[k], sumRe, 1e-9, `FFT vs DFT naïve, bin ${k} (re)`);
    assertClose(im[k], sumIm, 1e-9, `FFT vs DFT naïve, bin ${k} (im)`);
  }
  console.log('[OK] FFT(16 points) == DFT naïve, à 1e-9 près');
  passed++;
}

// --- 1. Cas nominal : pas de retard de groupe --------------------------------------
{
  const sig = buildSilenceWithImpulse(TARGET_S, SAMPLE_RATE, DURATION_S);
  const { coarseT, refinedT } = detectSingleOnset(sig, SAMPLE_RATE);
  const errMs = Math.abs(refinedT - TARGET_S) * 1000;
  console.log(
    `[${errMs <= TOLERANCE_MS ? 'OK' : 'FAIL'}] Cas 1 (sans retard de groupe) : ` +
    `grossier=${coarseT.toFixed(6)}s affiné=${refinedT.toFixed(6)}s cible=${TARGET_S}s erreur=${errMs.toFixed(3)}ms`
  );
  assert.ok(errMs <= TOLERANCE_MS, `Cas 1: erreur ${errMs}ms > ${TOLERANCE_MS}ms`);
  passed++;
}

// --- 2. Retard de groupe du rééchantillonneur, doit être compensé -----------------
{
  const groupDelaySec = 0.005; // 5 ms, plausible pour un filtre polyphase court
  // Le signal RAW (tel qu'il sortirait du rééchantillonneur) porte l'impulsion
  // décalée en avant de +groupDelaySec par rapport à sa vraie position musicale.
  const sig = buildSilenceWithImpulse(TARGET_S + groupDelaySec, SAMPLE_RATE, DURATION_S);
  const { refinedT } = detectSingleOnset(sig, SAMPLE_RATE, { resamplerGroupDelaySec: groupDelaySec });
  const errMs = Math.abs(refinedT - TARGET_S) * 1000;
  console.log(
    `[${errMs <= TOLERANCE_MS ? 'OK' : 'FAIL'}] Cas 2 (retard de groupe 5ms, compensé) : ` +
    `affiné=${refinedT.toFixed(6)}s cible=${TARGET_S}s erreur=${errMs.toFixed(3)}ms`
  );
  assert.ok(errMs <= TOLERANCE_MS, `Cas 2: erreur ${errMs}ms > ${TOLERANCE_MS}ms`);
  passed++;
}

// --- 3. Témoin négatif : la convention "bord gauche" doit être rejetée par le test -
// Prouve que le test discrime réellement une convention fausse, comme l'exige
// docs/04 l.95 ("Ce test échoue sur les deux conventions fausses").
{
  const sig = buildSilenceWithImpulse(TARGET_S, SAMPLE_RATE, DURATION_S);
  const frames = stft(sig, { windowSize: WINDOW_SIZE, hop: HOP });
  const flux = spectralFlux(frames);
  let bestI = 1;
  let bestV = -Infinity;
  for (let i = 1; i < flux.length; i++) if (flux[i] > bestV) { bestV = flux[i]; bestI = i; }

  // Convention fausse : horodatage au bord GAUCHE de la fenêtre (pas au centre).
  const wrongT = (bestI * HOP) / SAMPLE_RATE;
  const wrongErrMs = Math.abs(wrongT - TARGET_S) * 1000;
  console.log(
    `[OK] Témoin négatif (convention bord gauche) : erreur=${wrongErrMs.toFixed(1)}ms ` +
    `(attendu ~${((WINDOW_SIZE / 2 / SAMPLE_RATE) * 1000).toFixed(1)}ms, doit dépasser ${TOLERANCE_MS}ms)`
  );
  assert.ok(wrongErrMs > TOLERANCE_MS, 'Le témoin négatif aurait dû échouer la tolérance — le test ne discrimine pas, il est invalide');
  passed++;
}

console.log(`\n${passed}/5 assertions passées. Test de Dirac : VERT.`);
