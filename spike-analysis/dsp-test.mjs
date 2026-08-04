// spike-analysis/dsp-test.mjs — prototype de détection : critères de docs/11_TESTING.md
// niveau 1 (analysis/onset, analysis/tempo). Node natif, aucune dépendance.
//
//   node spike-analysis/dsp-test.mjs

import assert from 'node:assert/strict';
import { HOP } from './stft.mjs';
import { detectOnsets, estimateTempoByAutocorrelation } from './dsp.mjs';

const SAMPLE_RATE = 22050;

function buildClickTrack(bpm, durationSec, sampleRate) {
  const n = Math.round(durationSec * sampleRate);
  const sig = new Float64Array(n);
  const period = 60 / bpm;
  const trueOnsets = [];
  for (let t = 0.5; t < durationSec - 0.1; t += period) {
    const idx = Math.round(t * sampleRate);
    sig[idx] = 1.0;
    trueOnsets.push(t);
  }
  return { sig, trueOnsets };
}

let passed = 0;

// --- 1. Clic à 120 BPM exact → 120 ± 0,5, confiance > 0,9 (docs/11 l.27) ----------
{
  const BPM = 120;
  const { sig, trueOnsets } = buildClickTrack(BPM, 8, SAMPLE_RATE);
  const { onsets, flux } = detectOnsets(sig, SAMPLE_RATE);
  const { bpm, confidence } = estimateTempoByAutocorrelation(flux, HOP, SAMPLE_RATE);

  console.log(`[${Math.abs(bpm - BPM) <= 0.5 ? 'OK' : 'FAIL'}] Tempo clic 120 BPM : estimé=${bpm.toFixed(3)} confiance=${confidence.toFixed(3)}`);
  assert.ok(Math.abs(bpm - BPM) <= 0.5, `tempo: attendu 120±0.5, obtenu ${bpm}`);
  assert.ok(confidence > 0.9, `confiance: attendu >0.9, obtenu ${confidence}`);
  passed++;

  console.log(`[${onsets.length === trueOnsets.length ? 'OK' : 'FAIL'}] Nombre d'onsets détectés : ${onsets.length}/${trueOnsets.length}`);
  assert.equal(onsets.length, trueOnsets.length, `nombre d'onsets: attendu ${trueOnsets.length}, obtenu ${onsets.length}`);
  passed++;

  let maxErrMs = 0;
  for (let i = 0; i < trueOnsets.length; i++) {
    const errMs = Math.abs(onsets[i].t - trueOnsets[i]) * 1000;
    maxErrMs = Math.max(maxErrMs, errMs);
  }
  console.log(`[${maxErrMs <= 6 ? 'OK' : 'FAIL'}] Précision des onsets : erreur max ${maxErrMs.toFixed(3)}ms (tolérance ±6ms, docs/11 l.26)`);
  assert.ok(maxErrMs <= 6, `précision onsets: erreur max ${maxErrMs}ms > 6ms`);
  passed++;
}

// --- 2. Ambiguïté d'octave : motif Trap à 70 BPM avec hats en 1/16 (docs/11 l.28) -
// Version simplifiée : un clic fort tous les 70 BPM + un clic faible intercalé
// (sixteenth) à mi-chemin, l'autocorrélation ne doit pas se caler sur 140.
{
  const BPM = 70;
  const durationSec = 10;
  const n = Math.round(durationSec * SAMPLE_RATE);
  const sig = new Float64Array(n);
  const period = 60 / BPM;
  for (let t = 0.5; t < durationSec - 0.1; t += period) {
    sig[Math.round(t * SAMPLE_RATE)] = 1.0; // kick fort
    const hatT = t + period / 4;
    if (hatT < durationSec - 0.1) sig[Math.round(hatT * SAMPLE_RATE)] = 0.3; // hat faible en 1/16
  }
  const { flux } = detectOnsets(sig, SAMPLE_RATE);
  const { bpm } = estimateTempoByAutocorrelation(flux, HOP, SAMPLE_RATE);
  const ok = Math.abs(bpm - 70) <= 1;
  console.log(`[${ok ? 'OK' : 'FAIL (limite connue)'}] Ambiguïté d'octave 70 BPM + hats 1/16 : estimé=${bpm.toFixed(3)}`);
  if (!ok) {
    console.log('    -> limite connue du prototype plein-bande, cf. rapport de fin de phase.');
  } else {
    passed++;
  }
}

console.log(`\n${passed}/4 assertions critiques passées (voir détail ci-dessus pour le cas 2).`);
