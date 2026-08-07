/**
 * Detection de sections, chiffree (§2.7.9), et intensite globale (§2.8).
 *
 * MUST : tout est calcule sur les niveaux BRUTS, pre-AGC. L'AGC est justement
 * ce qui detruit l'information dont cette detection a besoin - apres 4 s de
 * breakdown il a tout ramene a pleine echelle, il n'y a plus de contraste, et
 * le drop ne rend plus.
 *
 * Definitions du prompt, appliquees telles quelles :
 *   E         = 10 * log10(sub + bass), lisse a tau = 300 ms
 *   reference = mediane glissante sur 30 s
 *   breakdown : E < ref - 6 dB maintenu >= 2 mesures
 *   build     : `air` monte de facon monotone sur >= 4 mesures pendant que E
 *               reste sous ref - 3 dB
 *   drop      : E remonte de >= 8 dB en moins d'une mesure apres un breakdown
 *               ou un build. QUANTIFIE sur le downbeat le plus proche, jamais
 *               declenche a la trame de detection.
 *
 * Classe pure : le temps est un parametre.
 */

import type { LiveStateConfig } from '../LiveConfig';

export type SectionArc = 'intro' | 'build' | 'peak' | 'breakdown' | 'drop';

export interface SectionEnergyState {
  /** `E` lisse, en dB. */
  readonly lowDb: number;
  /** Mediane glissante sur 30 s, en dB. */
  readonly referenceDb: number;
  readonly arc: SectionArc;
  readonly breakdown: boolean;
  readonly build: boolean;
  /** `true` sur la trame ou un drop a ete quantifie sur un downbeat. */
  readonly dropFired: boolean;
  /** Intensite globale 0-1 (§2.8). AUCUN effet ne lit l'audio directement. */
  readonly intensity: number;
}

/** Cadence d'echantillonnage de la reference. 4 Hz x 30 s = 120 echantillons. */
const REFERENCE_HZ = 4;

export class SectionEnergy implements SectionEnergyState {
  lowDb = -80;
  referenceDb = -80;
  arc: SectionArc = 'intro';
  breakdown = false;
  build = false;
  dropFired = false;
  intensity = 0;

  private readonly ring: Float32Array;
  private ringCount = 0;
  private ringHead = 0;
  private readonly sortScratch: Float32Array;
  private nextSampleAt = 0;

  private smoothedLow = -80;
  private smoothedAir = -80;
  private primed = false;

  private belowSince = Number.NaN;
  private airRisingBars = 0;
  private lastBarIndex = Number.NEGATIVE_INFINITY;
  private airAtLastBar = -80;
  private lowAtLastBar = -80;
  private dropArmed = false;
  private dropPending = false;
  private lastSectionChangeSec = 0;
  private smoothedIntensity = 0;

  constructor(
    private readonly config: LiveStateConfig,
    /** Duree de la fenetre de reference, en secondes. */
    private readonly referenceWindowSec = 30,
  ) {
    const n = Math.round(referenceWindowSec * REFERENCE_HZ);
    this.ring = new Float32Array(n);
    this.sortScratch = new Float32Array(n);
  }

  /**
   * @param macroDb     5 macro-bandes en dB BRUT, ordre `MACRO_BAND_IDS`.
   * @param rmsDbfs     RMS brut, en dBFS.
   * @param onsetRate   onsets par seconde, lisse par l'appelant.
   * @param barIndex    index de mesure courant de `BeatClock`.
   * @param isDownbeat  une frontiere de mesure est tombee sur cette trame.
   */
  update(
    tSec: number,
    dt: number,
    macroDb: Float32Array,
    rmsDbfs: number,
    onsetRate: number,
    barIndex: number,
    isDownbeat: boolean,
    barSec: number,
  ): void {
    this.dropFired = false;

    // E = 10*log10(sub + bass). Les macro-bandes sont deja en dB, on repasse
    // en puissance lineaire pour les sommer - additionner des dB n'a pas de sens.
    const sub = Math.pow(10, (macroDb[0] ?? -80) / 10);
    const bass = Math.pow(10, (macroDb[1] ?? -80) / 10);
    const air = macroDb[4] ?? -80;
    const rawLow = 10 * Math.log10(sub + bass + 1e-12);

    if (!this.primed) {
      this.primed = true;
      this.smoothedLow = rawLow;
      this.smoothedAir = air;
      this.referenceDb = rawLow;
      this.lowAtLastBar = rawLow;
      this.airAtLastBar = air;
    } else {
      const a = 1 - Math.exp(-dt / 0.3);
      this.smoothedLow += (rawLow - this.smoothedLow) * a;
      this.smoothedAir += (air - this.smoothedAir) * a;
    }
    this.lowDb = this.smoothedLow;

    if (tSec >= this.nextSampleAt) {
      this.nextSampleAt = tSec + 1 / REFERENCE_HZ;
      this.ring[this.ringHead] = this.smoothedLow;
      this.ringHead = (this.ringHead + 1) % this.ring.length;
      if (this.ringCount < this.ring.length) this.ringCount++;
      this.referenceDb = this.median();
    }

    this.updateSections(tSec, dt, barIndex, isDownbeat, barSec);
    this.updateIntensity(dt, rmsDbfs, onsetRate);
  }

  private updateSections(tSec: number, dt: number, barIndex: number, isDownbeat: boolean, barSec: number): void {
    const belowBreakdown = this.smoothedLow < this.referenceDb - 6;
    const belowBuild = this.smoothedLow < this.referenceDb - 3;

    if (belowBreakdown) {
      if (!Number.isFinite(this.belowSince)) this.belowSince = tSec;
    } else {
      this.belowSince = Number.NaN;
    }
    // « maintenu >= 2 mesures » : exprime en mesures, pas en secondes - a
    // 90 BPM deux mesures durent 5,3 s, a 174 BPM 2,8 s.
    const held = Number.isFinite(this.belowSince) ? tSec - this.belowSince : 0;
    this.breakdown = held >= 2 * barSec;

    if (isDownbeat && barIndex !== this.lastBarIndex) {
      // `air` monte-t-il de facon monotone ? Un seul recul remet le compteur a
      // zero : un build est par definition un mouvement continu.
      if (this.smoothedAir > this.airAtLastBar + 0.3 && belowBuild) this.airRisingBars++;
      else this.airRisingBars = 0;

      // Drop : remontee de >= 8 dB en MOINS d'une mesure, apres un creux.
      if (this.dropArmed && this.smoothedLow >= this.lowAtLastBar + 8) this.dropPending = true;

      this.airAtLastBar = this.smoothedAir;
      this.lowAtLastBar = this.smoothedLow;
      this.lastBarIndex = barIndex;
    }
    this.build = this.airRisingBars >= 4;

    if (this.breakdown || this.build) this.dropArmed = true;

    // Le drop est QUANTIFIE : il attend le downbeat, il ne se declenche pas a
    // la trame de detection. Un drop qui tombe au milieu d'une mesure se voit.
    if (this.dropPending && isDownbeat) {
      this.dropPending = false;
      this.dropArmed = false;
      this.dropFired = true;
      this.arc = 'drop';
      this.lastSectionChangeSec = tSec;
      return;
    }

    if (this.arc === 'drop' && tSec - this.lastSectionChangeSec < barSec) return;

    const next: SectionArc = this.breakdown ? 'breakdown' : this.build ? 'build' : this.peakOrIntro();
    if (next !== this.arc) {
      this.arc = next;
      this.lastSectionChangeSec = tSec;
    }
    void dt;
  }

  private peakOrIntro(): SectionArc {
    return this.smoothedLow >= this.referenceDb - 1 ? 'peak' : 'intro';
  }

  /**
   * Intensite (§2.8). Version de l'etape 2 : combinaison lissee du RMS, de la
   * densite d'onsets et de la section detectee.
   *
   * Le DIRECTOR de §2.8 - budget d'effets simultanes, plancher de vide,
   * retenue avant impact, chute apres le drop, garde-fou de non-saturation -
   * est de l'etape 4. Ce qui existe deja ici est le SIGNAL qu'il consommera ;
   * ce qui manque est la dramaturgie qui s'en sert.
   */
  private updateIntensity(dt: number, rmsDbfs: number, onsetRate: number): void {
    const level = clamp01((rmsDbfs - this.config.idleEnterDbfs) / (0 - this.config.idleEnterDbfs));
    const density = clamp01(onsetRate / 8);
    const sectionBias =
      this.arc === 'breakdown' ? -0.35 : this.arc === 'drop' ? 0.25 : this.arc === 'build' ? 0.05 : 0;
    const target = clamp01(level * 0.6 + density * 0.4 + sectionBias);
    // Le drop doit pouvoir monter vite ; le retour au calme doit etre lent,
    // sinon l'intensite suit chaque respiration du morceau.
    const tau = target > this.smoothedIntensity ? 0.25 : 1.2;
    this.smoothedIntensity += (target - this.smoothedIntensity) * (1 - Math.exp(-dt / tau));
    this.intensity = this.smoothedIntensity;
  }

  private median(): number {
    if (this.ringCount === 0) return this.smoothedLow;
    const view = this.sortScratch.subarray(0, this.ringCount);
    for (let i = 0; i < this.ringCount; i++) view[i] = this.ring[i]!;
    view.sort();
    return view[this.ringCount >> 1] ?? this.smoothedLow;
  }

  reset(): void {
    this.ring.fill(0);
    this.ringCount = 0;
    this.ringHead = 0;
    this.nextSampleAt = 0;
    this.lowDb = -80;
    this.referenceDb = -80;
    this.arc = 'intro';
    this.breakdown = false;
    this.build = false;
    this.dropFired = false;
    this.intensity = 0;
    this.smoothedLow = -80;
    this.smoothedAir = -80;
    this.primed = false;
    this.belowSince = Number.NaN;
    this.airRisingBars = 0;
    this.lastBarIndex = Number.NEGATIVE_INFINITY;
    this.airAtLastBar = -80;
    this.lowAtLastBar = -80;
    this.dropArmed = false;
    this.dropPending = false;
    this.lastSectionChangeSec = 0;
    this.smoothedIntensity = 0;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
