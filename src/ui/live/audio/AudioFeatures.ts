/**
 * Descripteurs spectraux et niveaux du mode live (§2.2).
 *
 * Trois regles structurantes appliquees ici :
 *
 * 1. **Repassage en lineaire avant tout descripteur.** `getFloatFrequencyData`
 *    renvoie des decibels ; un centroide pondere par des dB n'est pas un
 *    centroide, et une platitude calculee sur des dB n'a aucun sens
 *    mathematique. `p[k] = 10^(dB[k]/10)` d'abord, toujours.
 * 2. **Tous les coefficients d'enveloppe sont fonction de `dt`**
 *    (`a = 1 - exp(-dt/tau)`). Un alpha constant donnerait un rendu different
 *    a 30, 60 et 120 Hz.
 * 3. **Deux sorties par grandeur** : la valeur BRUTE en dB, seule consommee par
 *    la detection d'onsets, l'estimation de tempo et la detection de sections ;
 *    et la valeur AGC, seule consommee par le mapping visuel.
 *
 * Classe pure : le temps est un parametre, aucune allocation dans `update()`.
 */

import { MACRO_BAND_HZ, MACRO_BAND_IDS, type LiveAudioConfig } from '../LiveConfig';
import { bandPowerFromDb, binToHz, hzRangeToBins, logSpacedBins, powerToDb, type BinSpan } from './bins';

export interface AudioFeatureSet {
  /** 5 macro-bandes, en dB. BRUT - c'est ce que lit la detection. */
  readonly macroDb: Float32Array;
  /** 5 macro-bandes, 0-1 apres AGC et enveloppe. Mapping visuel uniquement. */
  readonly macroNorm: Float32Array;
  /** 32 bandes log, en dB. BRUT. */
  readonly bandsDb: Float32Array;
  /** 32 bandes log, 0-1 apres AGC et enveloppe. Mapping visuel uniquement. */
  readonly bandsNorm: Float32Array;
  /** Centroide spectral en Hz, calcule en puissance lineaire, bins 0-1 exclus. */
  readonly centroidHz: number;
  /** Platitude spectrale sur 2-12 kHz, 0-1. Porte du detecteur de charley. */
  readonly flatness: number;
  /** Niveau RMS du domaine temporel, en dBFS. BRUT - gate de silence, sections. */
  readonly rmsDbfs: number;
  /** RMS perceptuel apres AGC, 0-1. Mapping visuel uniquement. */
  readonly rmsNorm: number;
}

/** Suiveur de crete asymetrique (§2.2) : attaque instantanee, relachement lent. */
function trackPeak(peak: number, x: number, dt: number, tau: number): number {
  if (x > peak) return x;
  return peak + (x - peak) * (1 - Math.exp(-dt / tau));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export class AudioFeatures implements AudioFeatureSet {
  readonly macroDb: Float32Array;
  readonly macroNorm: Float32Array;
  readonly bandsDb: Float32Array;
  readonly bandsNorm: Float32Array;
  centroidHz = 0;
  flatness = 0;
  rmsDbfs = -120;
  rmsNorm = 0;

  private readonly macroSpans: readonly BinSpan[];
  private readonly bandSpans: readonly BinSpan[];
  private readonly flatnessSpan: BinSpan;
  private readonly macroPeak: Float32Array;
  private readonly bandPeak: Float32Array;
  private readonly macroEnv: Float32Array;
  private readonly bandEnv: Float32Array;
  private rmsPeak = 0;
  private rmsEnv = 0;

  constructor(
    private readonly config: LiveAudioConfig,
    private readonly sampleRate: number,
    private readonly fftSizeBands: number,
  ) {
    this.macroSpans = MACRO_BAND_IDS.map((id) => hzRangeToBins(MACRO_BAND_HZ[id], sampleRate, fftSizeBands));
    this.bandSpans = logSpacedBins(config.bandCount, config.bandMinHz, config.bandMaxHz, sampleRate, fftSizeBands);
    this.flatnessSpan = hzRangeToBins(config.flatnessHz, sampleRate, fftSizeBands);

    const m = MACRO_BAND_IDS.length;
    this.macroDb = new Float32Array(m);
    this.macroNorm = new Float32Array(m);
    this.macroPeak = new Float32Array(m);
    this.macroEnv = new Float32Array(m);
    this.bandsDb = new Float32Array(config.bandCount);
    this.bandsNorm = new Float32Array(config.bandCount);
    this.bandPeak = new Float32Array(config.bandCount);
    this.bandEnv = new Float32Array(config.bandCount);
    this.reset();
  }

  /** Plages de bins des 32 bandes log - expose pour le test « au moins 1 bin par bande » (§2.2). */
  get logBandSpans(): readonly BinSpan[] {
    return this.bandSpans;
  }

  /**
   * @param dt          secondes ecoulees depuis la trame precedente, deja clampe.
   * @param bandsDb     spectre de l'analyseur 8192, en dBFS.
   * @param timeDomain  bloc temporel flottant (`getFloatTimeDomainData`).
   * @param agcEnabled  `false` en IDLE : l'AGC est gele pour ne pas amplifier le bruit de fond.
   */
  update(dt: number, bandsDb: Float32Array, timeDomain: Float32Array, agcEnabled: boolean): void {
    const { dbFloor, agcReleaseSec, agcFloor, envAttackSec, envReleaseSec, rmsReleaseSec } = this.config;

    for (let i = 0; i < this.macroSpans.length; i++) {
      const power = bandPowerFromDb(bandsDb, this.macroSpans[i]!, dbFloor);
      this.macroDb[i] = powerToDb(power);
      const amp = Math.sqrt(power);
      if (agcEnabled) this.macroPeak[i] = trackPeak(this.macroPeak[i]!, amp, dt, agcReleaseSec);
      const norm = clamp01(amp / Math.max(this.macroPeak[i]!, agcFloor));
      this.macroEnv[i] = this.applyEnvelope(this.macroEnv[i]!, norm, dt, envAttackSec, envReleaseSec);
      this.macroNorm[i] = this.macroEnv[i]!;
    }

    for (let i = 0; i < this.bandSpans.length; i++) {
      const power = bandPowerFromDb(bandsDb, this.bandSpans[i]!, dbFloor);
      this.bandsDb[i] = powerToDb(power);
      const amp = Math.sqrt(power);
      if (agcEnabled) this.bandPeak[i] = trackPeak(this.bandPeak[i]!, amp, dt, agcReleaseSec);
      const norm = clamp01(amp / Math.max(this.bandPeak[i]!, agcFloor));
      this.bandEnv[i] = this.applyEnvelope(this.bandEnv[i]!, norm, dt, envAttackSec, envReleaseSec);
      this.bandsNorm[i] = this.bandEnv[i]!;
    }

    this.centroidHz = this.computeCentroid(bandsDb);
    this.flatness = this.computeFlatness(bandsDb);

    let sumSq = 0;
    for (let i = 0; i < timeDomain.length; i++) {
      const v = timeDomain[i] ?? 0;
      sumSq += v * v;
    }
    const rms = timeDomain.length > 0 ? Math.sqrt(sumSq / timeDomain.length) : 0;
    this.rmsDbfs = 20 * Math.log10(rms + 1e-9);
    if (agcEnabled) this.rmsPeak = trackPeak(this.rmsPeak, rms, dt, agcReleaseSec);
    const rmsTarget = clamp01(rms / Math.max(this.rmsPeak, agcFloor));
    this.rmsEnv = this.applyEnvelope(this.rmsEnv, rmsTarget, dt, envAttackSec, rmsReleaseSec);
    this.rmsNorm = this.rmsEnv;
  }

  private applyEnvelope(current: number, target: number, dt: number, attackSec: number, releaseSec: number): number {
    const tau = target > current ? attackSec : releaseSec;
    const a = 1 - Math.exp(-dt / Math.max(tau, 1e-4));
    return current + (target - current) * a;
  }

  /** `centroid = sum(f[k]*p[k]) / sum(p[k])`, en puissance LINEAIRE, bins 0-1 exclus. */
  private computeCentroid(db: Float32Array): number {
    const { dbFloor } = this.config;
    const first = this.bandSpans[0]?.lo ?? 2;
    const last = Math.min(db.length - 1, this.fftSizeBands / 2 - 1);
    let num = 0;
    let den = 0;
    for (let k = first; k <= last; k++) {
      const v = db[k];
      if (v === undefined) continue;
      const p = Math.pow(10, (v > dbFloor ? v : dbFloor) / 10);
      num += binToHz(k, this.sampleRate, this.fftSizeBands) * p;
      den += p;
    }
    return den > 0 ? num / den : 0;
  }

  /** `flatness = exp(mean(log p)) / mean(p)` sur 2-12 kHz seulement. */
  private computeFlatness(db: Float32Array): number {
    const { dbFloor } = this.config;
    const { lo, hi } = this.flatnessSpan;
    let logSum = 0;
    let linSum = 0;
    let n = 0;
    for (let k = lo; k <= hi && k < db.length; k++) {
      const v = db[k];
      if (v === undefined) continue;
      const p = Math.pow(10, (v > dbFloor ? v : dbFloor) / 10);
      logSum += Math.log(p + 1e-12);
      linSum += p;
      n++;
    }
    if (n === 0) return 0;
    const geo = Math.exp(logSum / n);
    const arith = linSum / n;
    return clamp01(geo / (arith + 1e-12));
  }

  reset(): void {
    this.macroDb.fill(this.config.dbFloor);
    this.macroNorm.fill(0);
    this.macroPeak.fill(0);
    this.macroEnv.fill(0);
    this.bandsDb.fill(this.config.dbFloor);
    this.bandsNorm.fill(0);
    this.bandPeak.fill(0);
    this.bandEnv.fill(0);
    this.rmsPeak = 0;
    this.rmsEnv = 0;
    this.rmsDbfs = -120;
    this.centroidHz = 0;
    this.flatness = 0;
    this.rmsNorm = 0;
  }
}
