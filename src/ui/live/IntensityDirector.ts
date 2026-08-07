/**
 * Dramaturgie (§2.8) - la section la plus importante du prompt, et la seule
 * dont le respect ne se voit pas dans le code mais dans ce que l'ecran ne fait
 * PAS.
 *
 * Un beat ne prend de valeur que par ce qui l'entoure. Bloom + feedback +
 * grain + aberration + shake + overlays cumules en permanence donnent un ecran
 * sature en permanence, donc plus aucun impact - l'exact inverse de l'objectif.
 * Ce module est celui qui sait RETIRER.
 *
 * MUST : aucun effet ne se regle directement sur l'audio. Tout passe par
 * `intensity`, et les autorisations produites ici.
 *
 * Cinq regles, toutes chiffrees par §2.8 :
 *
 * 1. **Budget d'effets** : au plus 1 overlay sous 0,3 d'intensite, 2 sous 0,7,
 *    3 au-dela.
 * 2. **Plancher de vide** : sur chaque phrase, au moins 2 temps CONSECUTIFS ou
 *    la luminance retombe sous 35 % de sa moyenne glissante. S'il n'a pas eu
 *    lieu aux trois quarts de la phrase, il est FORCE.
 * 3. **Retenue avant impact** : sur les 2 dernieres mesures d'une montee,
 *    l'amplitude de reaction aux onsets DIMINUE. Un build qui monte en meme
 *    temps que le drop annule le drop.
 * 4. **Apres le drop** : 1 mesure d'explosion maximale, puis retour a un
 *    niveau INFERIEUR a celui d'avant le drop pendant 2 mesures. L'impact se
 *    mesure a la chute qui suit.
 * 5. **Garde-fou de non-saturation** : si la moyenne glissante de luminance
 *    sur 4 s depasse 0,55, tout descend d'un cran.
 *
 * Classe pure : le temps est un parametre, aucun acces au DOM.
 */

import type { LiveIntensityConfig } from './LiveConfig';
import type { BeatClockState } from './audio/BeatClock';
import type { SectionEnergyState } from './audio/SectionEnergy';

/** Autorisations produites par le director. Aucun module ne lit l'audio directement. */
export interface EffectBudget {
  /** Nombre d'overlays expressifs simultanes autorises, 0 a 3. */
  readonly overlays: number;
  /** Multiplicateur de bloom, 0-1. */
  readonly bloom: number;
  /** Multiplicateur d'amplitude des reactions aux onsets, 0-1. Porte la retenue avant impact. */
  readonly amplitude: number;
  /** Multiplicateur de densite (particules, elements). */
  readonly density: number;
  /** Plafond de luminance moyenne visee, 0-1. Serre en breakdown. */
  readonly luminanceCap: number;
  /** Le grain est le SEUL overlay tolere en breakdown. */
  readonly grainOnly: boolean;
}

export class IntensityDirector {
  /** Intensite finale, multiplicateur utilisateur compris. C'est la seule entree des effets. */
  intensity = 0;
  /** Moyenne glissante de luminance sur `saturationWindowSec`. Affichee au HUD. */
  meanLuminance = 0;
  /** `true` si la moyenne glissante depasse le seuil : tout descend d'un cran. */
  saturated = false;
  /** `true` pendant un vide FORCE, parce que la phrase n'en avait pas eu. */
  forcingVoid = false;
  /** Le plancher de vide a-t-il ete tenu sur la phrase courante ? */
  voidSatisfied = false;
  /** Multiplicateur utilisateur (§4.5, touches + et -). */
  userScale = 1;

  private budgetValue: EffectBudget = {
    overlays: 1,
    bloom: 1,
    amplitude: 1,
    density: 1,
    luminanceCap: 1,
    grainOnly: false,
  };

  private lumAccum = 0;
  private lumTime = 0;
  private darkBeats = 0;
  private lastBeatIndex = Number.NEGATIVE_INFINITY;
  private lastPhraseIndex = Number.NEGATIVE_INFINITY;
  private beatDark = false;
  private beatLumSum = 0;
  private beatLumCount = 0;

  private dropBarIndex = Number.NEGATIVE_INFINITY;
  private preDropIntensity = 0;

  constructor(private readonly config: LiveIntensityConfig) {}

  get budget(): EffectBudget {
    return this.budgetValue;
  }

  /** Touches `+` / `-` de §4.5. Borne a [0.5, 1.5]. */
  nudgeUserScale(direction: number): void {
    const c = this.config;
    const next = this.userScale + direction * c.userScaleStep;
    this.userScale = Math.min(c.userScaleMax, Math.max(c.userScaleMin, Math.round(next * 100) / 100));
  }

  update(dt: number, section: SectionEnergyState, beat: BeatClockState, frameLuminance: number): void {
    this.updateLuminance(dt, frameLuminance);
    this.updateVoidFloor(beat, frameLuminance);

    // L'intensite BRUTE vient de `SectionEnergy` (§2.7.9) ; le director n'y
    // ajoute que la dramaturgie et le reglage utilisateur.
    let value = section.intensity * this.userScale;

    // L'ordre compte : le drop doit etre enregistre AVANT le calcul de
    // `barsSinceDrop`, sinon l'explosion ne commence qu'a la trame suivante et
    // la mesure d'explosion est amputee de son premier instant - exactement
    // celui qui porte l'impact.
    if (section.dropFired) {
      this.dropBarIndex = beat.barIndex;
      this.preDropIntensity = value;
    }
    const barsSinceDrop = beat.barIndex - this.dropBarIndex;

    let amplitude = 1;
    let bloom = 1;
    let density = 1;
    let luminanceCap = 1;
    let grainOnly = false;

    // --- 3. RETENUE AVANT IMPACT -------------------------------------------
    // Pendant une montee, la reaction aux onsets DIMINUE. C'est contre-intuitif
    // et c'est le point : si tout monte en meme temps que le drop, le drop
    // n'a plus de contraste a franchir.
    if (section.build) {
      amplitude *= this.config.buildRestraint;
      bloom *= 0.75;
      value *= 0.85;
    }

    // --- 4. APRES LE DROP ---------------------------------------------------
    if (barsSinceDrop >= 0 && barsSinceDrop < this.config.dropExplosionBars) {
      // Explosion maximale : une mesure, pas deux.
      value = Math.min(1, value * 1.35);
      amplitude *= 1.25;
    } else if (barsSinceDrop < this.config.dropExplosionBars + this.config.dropFalloutBars) {
      // Retombee SOUS le niveau d'avant le drop. L'impact se mesure a la chute.
      value = Math.min(value, this.preDropIntensity * this.config.dropFalloutRatio);
      bloom *= 0.6;
      density *= 0.7;
    }

    // --- BREAKDOWN : quasi-noir assume -------------------------------------
    if (section.breakdown) {
      luminanceCap = this.config.breakdownLuminance;
      grainOnly = true;
      bloom *= 0.35;
      density *= 0.45;
      value *= 0.5;
    }

    // --- 2. PLANCHER DE VIDE ------------------------------------------------
    if (this.forcingVoid) {
      luminanceCap = Math.min(luminanceCap, this.config.voidFloorRatio);
      bloom *= 0.3;
      density *= 0.5;
      amplitude *= 0.6;
      value *= 0.45;
    }

    // --- 5. GARDE-FOU DE NON-SATURATION ------------------------------------
    if (this.saturated) {
      bloom *= 0.7;
      density *= 0.7;
    }

    this.intensity = clamp01(value);

    // --- 1. BUDGET D'OVERLAYS ----------------------------------------------
    let overlays =
      this.intensity < this.config.overlayThreshold1 ? 1 : this.intensity < this.config.overlayThreshold2 ? 2 : 3;
    if (this.saturated) overlays = Math.max(0, overlays - 1);
    if (grainOnly || this.forcingVoid) overlays = 0;

    this.budgetValue = {
      overlays,
      bloom: clamp01(bloom),
      amplitude: clamp01(amplitude),
      density: clamp01(density),
      luminanceCap,
      grainOnly,
    };
  }

  /**
   * Moyenne glissante de la luminance mesuree sur le downscale 32x18 (§2.8).
   * Le seuil est teste sur la MOYENNE, jamais sur une trame isolee : un flash
   * volontaire ne doit pas faire retomber la qualite d'un cran.
   */
  private updateLuminance(dt: number, frameLuminance: number): void {
    const w = this.config.saturationWindowSec;
    const a = 1 - Math.exp(-dt / Math.max(w, 0.1));
    this.meanLuminance += (frameLuminance - this.meanLuminance) * a;
    this.lumAccum += frameLuminance * dt;
    this.lumTime += dt;
    this.saturated = this.meanLuminance > this.config.saturationLimit;
  }

  /**
   * Plancher de vide (§2.8). Un temps compte comme vide si sa luminance
   * moyenne est sous `voidFloorRatio` de la moyenne glissante. Il en faut
   * `voidFloorBeats` CONSECUTIFS par phrase - deux temps sombres separes par
   * un temps clair ne font pas un vide, ils font un clignotement.
   */
  private updateVoidFloor(beat: BeatClockState, frameLuminance: number): void {
    this.beatLumSum += frameLuminance;
    this.beatLumCount++;

    if (beat.beatIndex !== this.lastBeatIndex) {
      this.lastBeatIndex = beat.beatIndex;
      const mean = this.beatLumCount > 0 ? this.beatLumSum / this.beatLumCount : 0;
      this.beatLumSum = 0;
      this.beatLumCount = 0;
      this.beatDark = mean < this.meanLuminance * this.config.voidFloorRatio;
      this.darkBeats = this.beatDark ? this.darkBeats + 1 : 0;
      if (this.darkBeats >= this.config.voidFloorBeats) this.voidSatisfied = true;
    }

    if (beat.phraseIndex !== this.lastPhraseIndex) {
      this.lastPhraseIndex = beat.phraseIndex;
      this.voidSatisfied = false;
      this.forcingVoid = false;
      this.darkBeats = 0;
    }

    // Aux trois quarts de la phrase sans vide : on le force. Sans ca, la regle
    // serait une intention pieuse et non une garantie.
    this.forcingVoid = !this.voidSatisfied && beat.phrasePhase >= this.config.voidForceFrom && beat.phraseValid;
  }

  reset(): void {
    this.intensity = 0;
    this.meanLuminance = 0;
    this.saturated = false;
    this.forcingVoid = false;
    this.voidSatisfied = false;
    this.lumAccum = 0;
    this.lumTime = 0;
    this.darkBeats = 0;
    this.lastBeatIndex = Number.NEGATIVE_INFINITY;
    this.lastPhraseIndex = Number.NEGATIVE_INFINITY;
    this.beatDark = false;
    this.beatLumSum = 0;
    this.beatLumCount = 0;
    this.dropBarIndex = Number.NEGATIVE_INFINITY;
    this.preDropIntensity = 0;
    this.budgetValue = { overlays: 1, bloom: 1, amplitude: 1, density: 1, luminanceCap: 1, grainOnly: false };
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
