/**
 * Director de scenes (§4.3).
 *
 * GRANULARITE, et c'est la regle qui structure tout le reste :
 * - les changements de SCENE tombent sur frontiere de PHRASE ;
 * - les changements de VARIANTE et d'OVERLAY tombent sur frontiere de MESURE ;
 * - si `downbeatConfidence < 0.5`, LA PHRASE N'EXISTE PAS (§2.5) : le director
 *   se rabat sur des frontieres de 2 mesures pour les scenes, et sur le temps
 *   pour le reste.
 *
 * ARBITRAGE DES COUPES - ordre de priorite STRICT (MUST §4.3) :
 *
 * 1. Drop detecte -> coupe au prochain downbeat, le plancher de 15 s est
 *    SUSPENDU. Contrainte unique qui survit : jamais deux coupes a moins de
 *    4 mesures d'ecart.
 * 2. Plafond de 60 s atteint -> coupe a la prochaine frontiere de phrase ; si
 *    aucune n'arrive avant 75 s, coupe a la prochaine frontiere de mesure.
 * 3. Frontiere de phrase + plancher de 15 s atteint -> coupe si le score de
 *    pertinence de la scene courante passe sous celui de la meilleure
 *    candidate.
 *
 * MODE DEGRADE (`REACTIVE`) : il n'y a plus de frontiere musicale fiable. Le
 * director utilise (a) un creux d'energie, (b) a defaut un minuteur de 20 s.
 * Et les transitions y sont UNIQUEMENT des fondus : une coupe seche n'a de
 * sens que sur une grille - sans grille, elle passe pour un bug.
 *
 * Classe pure : le temps et le hasard sont des parametres.
 */

import type { LiveDirectorConfig } from './LiveConfig';
import type { BeatClockState } from './audio/BeatClock';
import type { EngineState } from './audio/LiveAnalysisEngine';
import type { SectionEnergyState } from './audio/SectionEnergy';
import { SCENE_REGISTRY, playableScenes, type SceneEntry } from './scenes';

export type CutReason =
  | 'init'
  | 'drop'
  | 'ceiling'
  | 'phrase-score'
  | 'degraded-trough'
  | 'degraded-timer'
  | 'manual'
  | 'panic';

export type CutBoundary = 'phrase' | 'deux-mesures' | 'mesure' | 'downbeat' | 'immediate';

export interface SceneChange {
  readonly tSec: number;
  readonly from: string;
  readonly to: string;
  readonly variant: number;
  readonly reason: CutReason;
  /** Frontiere musicale qui a autorise la coupe. Consigne pour que §8.8 soit verifiable. */
  readonly boundary: CutBoundary;
  /** Confiance de downbeat au moment de la coupe : sous 0.5, la phrase n'existait pas. */
  readonly downbeatConfidence: number;
}

export interface DirectorInput {
  readonly tSec: number;
  readonly dt: number;
  readonly state: EngineState;
  readonly beat: BeatClockState;
  readonly section: SectionEnergyState;
  readonly intensity: number;
  /** RMS brut en dBFS, pour le creux d'energie du mode degrade. */
  readonly rmsDbfs: number;
  readonly reducedMotion: boolean;
  readonly rng: () => number;
}

export interface DirectorDecision {
  readonly entry: SceneEntry;
  readonly variant: number;
  /** 0 = coupe franche. > 0 = fondu, en secondes. */
  readonly fadeSec: number;
  readonly reason: CutReason;
  readonly boundary: CutBoundary;
}

/** Preferences de tags par arc narratif (§4.3). */
const ARC_PREFERENCE: Readonly<Record<string, readonly string[]>> = {
  breakdown: ['calm', 'organic'],
  build: ['geometric', 'neon'],
  peak: ['intense', 'neon'],
  drop: ['intense', 'glitch'],
  intro: ['calm', 'geometric'],
};

export class LiveDirector {
  /** Journal des 5 derniers changements, avec la frontiere qui les a declenches (§4.6). */
  readonly log: SceneChange[] = [];
  /** Verrou de scene (touche `L`, §4.5) : seules les variantes changent encore. */
  sceneLocked = false;
  /** `true` quand le director travaille sans frontiere musicale. Affiche au HUD. */
  degraded = false;

  private current: SceneEntry | null = null;
  private variant = 0;
  private enteredAtSec = 0;
  private enteredAtBar = 0;
  private lastCutBar = Number.NEGATIVE_INFINITY;
  private lastBarIndex = Number.NEGATIVE_INFINITY;
  private lastPhraseIndex = Number.NEGATIVE_INFINITY;
  /** Historique des identifiants joues, du plus recent au plus ancien. */
  private readonly history: string[] = [];
  private pendingReason: CutReason | null = null;
  private manualDirection = 0;

  private rmsMean = -60;
  private troughSec = 0;
  private degradedTimer = 0;

  constructor(private readonly config: LiveDirectorConfig) {}

  get currentEntry(): SceneEntry | null {
    return this.current;
  }

  get currentVariant(): number {
    return this.variant;
  }

  /** Secondes ecoulees dans la scene courante. */
  elapsed(tSec: number): number {
    return this.current ? tSec - this.enteredAtSec : 0;
  }

  /** Touches `<-` / `->` (§4.5) : quantifie a la MESURE suivante, jamais immediat. */
  requestManual(direction: number): void {
    this.manualDirection = direction >= 0 ? 1 : -1;
    this.pendingReason = 'manual';
  }

  /** Touche `Echap` (§4.5) : retour immediat a la scene la plus calme. */
  panic(input: DirectorInput): DirectorDecision | null {
    const playable = playableScenes(input.reducedMotion);
    // « Scene d'attente » : la plus calme des jouables, c'est-a-dire celle dont
    // la plage d'intensite commence le plus bas.
    let calmest = playable[0];
    for (const e of playable) if (e.intensityRange[0] < (calmest?.intensityRange[0] ?? 1)) calmest = e;
    if (!calmest) return null;
    return this.commit(calmest, 0, 0, 'panic', 'immediate', input);
  }

  /**
   * Une trame. Retourne une decision quand une coupe est autorisee ET
   * souhaitable, `null` sinon.
   */
  update(input: DirectorInput): DirectorDecision | null {
    this.updateDegraded(input);

    const playable = playableScenes(input.reducedMotion);
    if (playable.length === 0) return null;

    // Premiere scene : aucune frontiere a attendre.
    if (!this.current) {
      const first = this.pick(playable, input);
      return this.commit(first, this.pickVariant(first, input), 0, 'init', 'immediate', input);
    }

    // La scene courante est-elle devenue injouable ? (bascule en mouvement
    // reduit pendant la lecture, par exemple.)
    if (!playable.includes(this.current)) {
      const next = this.pick(playable, input);
      return this.commit(next, this.pickVariant(next, input), this.config.degradedFadeSec, 'manual', 'immediate', input);
    }

    const bar = input.beat.barIndex;
    const barBoundary = bar !== this.lastBarIndex;
    const phraseBoundary = input.beat.phraseValid && input.beat.phraseIndex !== this.lastPhraseIndex;
    if (barBoundary) this.lastBarIndex = bar;
    if (phraseBoundary) this.lastPhraseIndex = input.beat.phraseIndex;

    // La variante change sur frontiere de MESURE, la scene sur frontiere de
    // PHRASE : deux granularites differentes, jamais melangees.
    if (barBoundary && !phraseBoundary && this.current.variants > 1) {
      // Une variante par phrase au maximum : plus souvent, la scene n'a pas le
      // temps de s'installer et la variante devient du bruit.
      const barsIn = bar - this.enteredAtBar;
      if (barsIn > 0 && barsIn % 8 === 0) {
        this.variant = (this.variant + 1) % this.current.variants;
      }
    }

    if (this.sceneLocked && this.pendingReason !== 'manual') return null;

    const decision = this.arbitrate(input, playable, barBoundary, phraseBoundary);
    return decision;
  }

  /**
   * Arbitrage, dans l'ordre de priorite STRICT de §4.3. L'ordre des `if` EST
   * la specification : une reorganisation change le comportement.
   */
  private arbitrate(
    input: DirectorInput,
    playable: readonly SceneEntry[],
    barBoundary: boolean,
    phraseBoundary: boolean,
  ): DirectorDecision | null {
    const elapsed = this.elapsed(input.tSec);
    const barsSinceCut = input.beat.barIndex - this.lastCutBar;
    const c = this.config;

    // Contrainte qui survit a TOUT, drop compris.
    const spacingOk = barsSinceCut >= c.minBarsBetweenCuts;

    // --- 0. Demande manuelle : quantifiee a la mesure suivante --------------
    if (this.pendingReason === 'manual' && barBoundary) {
      this.pendingReason = null;
      const next = this.step(playable, this.manualDirection);
      return this.commit(next, this.pickVariant(next, input), 0, 'manual', 'mesure', input);
    }

    // --- Mode degrade : plus de frontiere musicale --------------------------
    if (this.degraded) {
      if (elapsed < c.minSceneSec) return null;
      if (this.troughSec >= c.degradedTroughSec) {
        this.troughSec = 0;
        const next = this.pick(playable, input);
        // Fondu UNIQUEMENT : une coupe seche sans grille passe pour un bug.
        return this.commit(next, this.pickVariant(next, input), c.degradedFadeSec, 'degraded-trough', 'immediate', input);
      }
      if (this.degradedTimer >= c.degradedTimerSec) {
        this.degradedTimer = 0;
        const next = this.pick(playable, input);
        return this.commit(next, this.pickVariant(next, input), c.degradedFadeSec, 'degraded-timer', 'immediate', input);
      }
      return null;
    }

    // --- 1. DROP : priorite absolue, plancher de 15 s suspendu -------------
    if (input.section.dropFired && spacingOk) {
      const next = this.pick(playable, input, 'drop');
      // « drop -> coupe FRANCHE vers `intense`, jamais un fondu » (§4.3).
      return this.commit(next, this.pickVariant(next, input), 0, 'drop', 'downbeat', input);
    }

    // --- 2. PLAFOND -------------------------------------------------------
    if (elapsed >= c.hardMaxSceneSec && barBoundary && spacingOk) {
      const next = this.pick(playable, input);
      return this.commit(next, this.pickVariant(next, input), 0, 'ceiling', 'mesure', input);
    }
    if (elapsed >= c.maxSceneSec && phraseBoundary && spacingOk) {
      const next = this.pick(playable, input);
      return this.commit(next, this.pickVariant(next, input), 0, 'ceiling', 'phrase', input);
    }

    // --- 3. FRONTIERE DE PHRASE + PLANCHER --------------------------------
    // Sans downbeat fiable, la phrase n'existe pas : on se rabat sur deux
    // mesures (§2.5, dernier paragraphe).
    const structural = input.beat.phraseValid
      ? phraseBoundary
      : barBoundary && input.beat.barIndex % 2 === 0;
    const current = this.current;
    if (structural && elapsed >= c.minSceneSec && spacingOk && current) {
      const best = this.pick(playable, input);
      if (best !== current) {
        const currentScore = this.score(current, input);
        const bestScore = this.score(best, input);
        if (bestScore > currentScore) {
          return this.commit(
            best,
            this.pickVariant(best, input),
            0,
            'phrase-score',
            input.beat.phraseValid ? 'phrase' : 'deux-mesures',
            input,
          );
        }
      }
    }

    return null;
  }

  /**
   * Mode degrade : `REACTIVE` signifie que la confiance de tempo est trop
   * basse pour se fier a une grille. On surveille alors un creux d'energie -
   * RMS sous 45 % de sa moyenne glissante sur 4 s pendant au moins 300 ms -
   * et, a defaut, un minuteur.
   */
  private updateDegraded(input: DirectorInput): void {
    this.degraded = input.state !== 'LOCKED';

    const a = 1 - Math.exp(-input.dt / 4);
    this.rmsMean += (input.rmsDbfs - this.rmsMean) * a;
    // Comparaison en AMPLITUDE, pas en dB : « 45 % de la moyenne » n'a de sens
    // que sur une grandeur lineaire. -6 dB, ce n'est pas 45 % de -3 dB.
    const level = Math.pow(10, input.rmsDbfs / 20);
    const mean = Math.pow(10, this.rmsMean / 20);
    if (this.degraded && level < mean * this.config.degradedTroughRatio) {
      this.troughSec += input.dt;
    } else {
      this.troughSec = 0;
    }
    this.degradedTimer = this.degraded ? this.degradedTimer + input.dt : 0;
  }

  /** Score de pertinence d'une scene : ajustement d'intensite, arc, anti-repetition. */
  private score(entry: SceneEntry, input: DirectorInput, arcOverride?: string): number {
    const [lo, hi] = entry.intensityRange;
    const i = input.intensity;
    // Ajustement d'intensite : 1 dans la plage, decroissance lineaire dehors.
    const fit = i >= lo && i <= hi ? 1 : Math.max(0, 1 - (i < lo ? lo - i : i - hi) * 3);

    const arc = arcOverride ?? input.section.arc;
    const preferred = ARC_PREFERENCE[arc] ?? [];
    let arcBonus = 0;
    for (const tag of preferred) if (entry.tags.includes(tag as never)) arcBonus += 0.25;

    // ANTI-REPETITION : une scene ne revient pas avant que `antiRepeat` autres
    // soient passees. Le plafond a `nombre de scenes - 1` est indispensable :
    // avec 3 scenes et un anti-repeat de 3, aucune scene ne serait jamais
    // eligible et le director se figerait.
    const window = Math.min(this.config.antiRepeat, Math.max(0, SCENE_REGISTRY.length - 1));
    const recent = this.history.indexOf(entry.id);
    if (recent >= 0 && recent < window) return -1;

    return fit + arcBonus;
  }

  private pick(playable: readonly SceneEntry[], input: DirectorInput, arcOverride?: string): SceneEntry {
    let best = playable[0]!;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const entry of playable) {
      // Une pincee de hasard SEEDE : sans elle, deux passages sur la meme
      // intensite donnent toujours la meme scene et la variete promise par §0
      // se reduit a la variete de l'audio.
      const s = this.score(entry, input, arcOverride) + input.rng() * 0.15;
      if (s > bestScore) {
        bestScore = s;
        best = entry;
      }
    }
    // Toutes ecartees par l'anti-repetition : on prend la plus ancienne jouee.
    if (bestScore < 0) {
      let oldest = playable[0]!;
      let oldestRank = -1;
      for (const entry of playable) {
        const rank = this.history.indexOf(entry.id);
        const effective = rank < 0 ? Number.POSITIVE_INFINITY : rank;
        if (effective > oldestRank) {
          oldestRank = effective;
          oldest = entry;
        }
      }
      return oldest;
    }
    return best;
  }

  private step(playable: readonly SceneEntry[], direction: number): SceneEntry {
    const index = this.current ? playable.indexOf(this.current) : -1;
    const n = playable.length;
    const next = ((index + direction) % n + n) % n;
    return playable[next] ?? playable[0]!;
  }

  private pickVariant(entry: SceneEntry, input: DirectorInput): number {
    if (entry.variants <= 1) return 0;
    // Jamais la meme variante deux fois de suite sur la meme scene.
    const previous = entry === this.current ? this.variant : -1;
    let v = Math.floor(input.rng() * entry.variants) % entry.variants;
    if (v === previous) v = (v + 1) % entry.variants;
    return v;
  }

  private commit(
    entry: SceneEntry,
    variant: number,
    fadeSec: number,
    reason: CutReason,
    boundary: CutBoundary,
    input: DirectorInput,
  ): DirectorDecision {
    const from = this.current?.id ?? '-';
    this.current = entry;
    this.variant = variant;
    this.enteredAtSec = input.tSec;
    this.enteredAtBar = input.beat.barIndex;
    this.lastCutBar = input.beat.barIndex;
    this.pendingReason = null;

    this.history.unshift(entry.id);
    if (this.history.length > 8) this.history.pop();

    this.log.unshift({
      tSec: input.tSec,
      from,
      to: entry.id,
      variant,
      reason,
      boundary,
      downbeatConfidence: input.beat.downbeatConfidence,
    });
    if (this.log.length > 5) this.log.pop();

    return { entry, variant, fadeSec, reason, boundary };
  }

  reset(): void {
    this.log.length = 0;
    this.history.length = 0;
    this.current = null;
    this.variant = 0;
    this.enteredAtSec = 0;
    this.enteredAtBar = 0;
    this.lastCutBar = Number.NEGATIVE_INFINITY;
    this.lastBarIndex = Number.NEGATIVE_INFINITY;
    this.lastPhraseIndex = Number.NEGATIVE_INFINITY;
    this.pendingReason = null;
    this.manualDirection = 0;
    this.rmsMean = -60;
    this.troughSec = 0;
    this.degradedTimer = 0;
    this.sceneLocked = false;
    this.degraded = false;
  }
}
