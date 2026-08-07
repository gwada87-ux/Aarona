/**
 * Gouverneur de qualite du mode live (§3.7).
 *
 * MUST : mesure EXCLUSIVEMENT les deltas d'horodatage de `requestAnimationFrame`.
 * Un `performance.now()` autour du code de rendu renvoie ~2 ms alors que le GPU
 * en met 30 : le travail Canvas 2D est soumis de facon asynchrone, la mesure
 * ne veut rien dire.
 *
 * MUST : la periode de reference est ESTIMEE (mediane des 60 premiers deltas),
 * jamais 16,7 ms en dur. Un ecran 120 Hz doit etre juge a 8,3 ms, un ecran
 * 144 Hz a 6,9 ms - sinon le gouverneur ne se declenche jamais sur les ecrans
 * rapides, qui sont justement ceux ou le budget est le plus serre.
 *
 * Convention : `quality` 0 = mode survie, 3 = qualite pleine.
 *
 * Classe pure : aucun `performance.now()` interne, le temps est un parametre.
 */

import type { LivePerfConfig } from '../LiveConfig';

export type QualityLevel = 0 | 1 | 2 | 3;

export interface QualityProfile {
  readonly level: QualityLevel;
  /** Plafond de particules (§3.7). */
  readonly particleCap: number;
  /** Nombre d'echelles de bloom. 0 = pas de bloom. */
  readonly bloomScales: number;
  /** Diviseur de resolution de la chaine de post. */
  readonly postDivider: number;
  /** Passes plein ecran autorisees par trame. */
  readonly fullscreenBudget: number;
  readonly feedback: boolean;
  readonly grain: boolean;
  readonly scanlines: boolean;
  readonly aberration: boolean;
}

/**
 * Ordre de degradation impose par §3.7 : aberration -> scanlines -> 2e echelle
 * de bloom -> grain -> feedback. Le feedback part en dernier parce que c'est
 * lui qui porte la lisibilite du mouvement ; l'aberration part en premier
 * parce qu'elle coute 4 passes plein ecran pour un effet ponctuel.
 *
 * Trois descentes pour cinq effets : le decoupage retenu suit l'ordre sans le
 * violer - 3 -> 2 retire aberration et scanlines, 2 -> 1 retire la seconde
 * echelle de bloom et le grain, 1 -> 0 retire le feedback.
 *
 * ECART ASSUME : §3.7 donne aussi, entre parentheses, « passes de bloom
 * (0/1/2/2) », ce qui garderait deux echelles au niveau 1 et contredirait son
 * propre ordre de desactivation - la 2e echelle y part AVANT le grain. L'ordre
 * de desactivation est la phrase normative (« FrameBudget les desactive dans
 * l'ordre »), la parenthese est une illustration : c'est l'ordre qui est suivi.
 * Le budget de passes mesure ci-dessous confirme que la parenthese ne tient
 * pas dans les 6 passes autorisees au niveau 2.
 */
export const QUALITY_PROFILES: readonly QualityProfile[] = Object.freeze([
  Object.freeze({
    level: 0,
    particleCap: 600,
    bloomScales: 0,
    postDivider: 2,
    fullscreenBudget: 3,
    feedback: false,
    grain: false,
    scanlines: false,
    aberration: false,
  }),
  Object.freeze({
    level: 1,
    particleCap: 1500,
    bloomScales: 1,
    postDivider: 2,
    fullscreenBudget: 3,
    feedback: true,
    grain: false,
    scanlines: false,
    aberration: false,
  }),
  Object.freeze({
    level: 2,
    particleCap: 3000,
    bloomScales: 2,
    postDivider: 1,
    fullscreenBudget: 6,
    feedback: true,
    grain: true,
    scanlines: false,
    aberration: false,
  }),
  // Niveau 3 : tout. C'est le seul niveau ou l'aberration et les scanlines
  // existent, et le seul qui alloue le buffer de post intermediaire.
  Object.freeze({
    level: 3,
    particleCap: 6000,
    bloomScales: 2,
    postDivider: 1,
    fullscreenBudget: 10,
    feedback: true,
    grain: true,
    scanlines: true,
    aberration: true,
  }),
] as const);

export class FrameBudget {
  private levelValue: QualityLevel = 3;
  private lastStamp = Number.NaN;
  private readonly calibration: number[] = [];
  private referenceMs = 0;
  /** Fenetre glissante des N derniers deltas, pour la regle « 8 trames sur 12 ». */
  private readonly window: number[] = [];
  private goodStreak = 0;
  private frozenUntilMs = Number.NEGATIVE_INFINITY;
  private cooldownUntilMs = Number.NEGATIVE_INFINITY;
  /** Horodatage de la derniere DESCENTE. Deux descentes rapprochees valent deux crans. */
  private lastDescentMs = Number.NEGATIVE_INFINITY;
  private lastFrameMs = 0;
  private medianMs = 0;

  constructor(private readonly config: LivePerfConfig) {}

  get level(): QualityLevel {
    return this.levelValue;
  }

  get profile(): QualityProfile {
    return QUALITY_PROFILES[this.levelValue] ?? QUALITY_PROFILES[3]!;
  }

  /** Periode de reference estimee, en ms. 0 tant que la calibration n'est pas finie. */
  get referencePeriodMs(): number {
    return this.referenceMs;
  }

  /** Duree de la derniere trame, en ms. */
  get frameMs(): number {
    return this.lastFrameMs;
  }

  /** Mediane glissante de la fenetre courante, en ms - c'est elle qu'affiche le HUD. */
  get medianFrameMs(): number {
    return this.medianMs;
  }

  get calibrated(): boolean {
    return this.referenceMs > 0;
  }

  /**
   * Gele l'adaptation. A appeler sur une transition de scene (son cout x2
   * n'est pas representatif) et apres un resize (§3.7).
   */
  freeze(nowMs: number, durationMs: number): void {
    this.frozenUntilMs = Math.max(this.frozenUntilMs, nowMs + durationMs);
  }

  /** Force un niveau - reglage manuel, ou test. Remet le compte a zero. */
  setLevel(level: QualityLevel, nowMs: number): void {
    this.levelValue = level;
    this.window.length = 0;
    this.goodStreak = 0;
    this.cooldownUntilMs = nowMs + this.config.qualityCooldownMs;
  }

  /** Un horodatage de `requestAnimationFrame`, en ms. */
  sample(stampMs: number): void {
    if (!Number.isFinite(this.lastStamp)) {
      this.lastStamp = stampMs;
      return;
    }
    const delta = stampMs - this.lastStamp;
    this.lastStamp = stampMs;
    // Une trame de plus d'une demi-seconde n'est pas une trame lente : c'est un
    // onglet qui revient au premier plan, un GC majeur, ou un point d'arret.
    // La compter degraderait la qualite pour une raison qui n'existe plus.
    if (!(delta > 0) || delta > this.config.outlierFrameMs) return;
    this.lastFrameMs = delta;

    if (this.referenceMs <= 0) {
      this.calibration.push(delta);
      if (this.calibration.length >= this.config.calibrationFrames) {
        const sorted = [...this.calibration].sort((a, b) => a - b);
        this.referenceMs = sorted[sorted.length >> 1] ?? delta;
        this.medianMs = this.referenceMs;
      }
      return;
    }

    this.window.push(delta);
    if (this.window.length > this.config.windowFrames) this.window.shift();
    this.updateMedian();

    if (stampMs < this.frozenUntilMs || stampMs < this.cooldownUntilMs) {
      this.goodStreak = 0;
      return;
    }

    // DESCENTE : `slowFrames` trames sur `windowFrames` au-dessus du seuil.
    if (this.window.length >= this.config.windowFrames) {
      const limit = this.referenceMs * this.config.slowFactor;
      let slow = 0;
      for (let i = 0; i < this.window.length; i++) if ((this.window[i] ?? 0) > limit) slow++;
      if (slow >= this.config.slowFrames && this.levelValue > 0) {
        // DESCENTE DE DEUX CRANS quand une descente vient DEJA d'avoir lieu.
        //
        // Un cran a la fois est la bonne regle au premier declenchement : le
        // depassement y est ambigu et sur-degrader coute une qualite qu'on
        // aurait pu garder. Mais si la fenetre suivante retombe en faute, le
        // premier cran n'a manifestement pas suffi, et continuer un cran a la
        // fois coute une fenetre PLUS un delai anti-rebond a chaque fois :
        // mesure sur une scene a deux fois le budget, trois crans prenaient
        // 1 369 ms, soit une seconde et demie a 20 fps. §8.10 exige moins d'une
        // seconde.
        //
        // Le critere est la RECURRENCE, pas l'ampleur du depassement. Une
        // premiere version comparait `medianMs / referenceMs` a 3 et ne se
        // declenchait jamais : sur un ecran a frequence fixe les horodatages
        // sont quantifies au vsync, donc une scene a 18 ms et une scene a 33 ms
        // presentent toutes deux a 33,4 ms. Le rapport observe sature a 2 et ne
        // dit rien du cout reel. La recurrence, elle, reste lisible.
        const sinceLast = stampMs - this.lastDescentMs;
        const steps = sinceLast < this.config.severeWindowMs ? 2 : 1;
        this.lastDescentMs = stampMs;
        this.setLevel(Math.max(0, this.levelValue - steps) as QualityLevel, stampMs);
        return;
      }
    }

    // REMONTEE : `goodFrames` trames CONSECUTIVES sous le seuil bas. La zone
    // morte entre `fastFactor` et `slowFactor` est ce qui empeche l'oscillation :
    // une trame a 1,2 x la periode ne compte ni comme lente ni comme rapide.
    if (delta < this.referenceMs * this.config.fastFactor) {
      this.goodStreak++;
      if (this.goodStreak >= this.config.goodFrames && this.levelValue < 3) {
        this.setLevel((this.levelValue + 1) as QualityLevel, stampMs);
      }
    } else {
      this.goodStreak = 0;
    }
  }

  private updateMedian(): void {
    const n = this.window.length;
    if (n === 0) return;
    // Fenetre de 12 elements : un tri par insertion sur une copie coute moins
    // qu'une structure dediee, et ce n'est pas un chemin par particule.
    const sorted = [...this.window].sort((a, b) => a - b);
    this.medianMs = sorted[n >> 1] ?? 0;
  }

  reset(): void {
    this.levelValue = 3;
    this.lastStamp = Number.NaN;
    this.calibration.length = 0;
    this.referenceMs = 0;
    this.window.length = 0;
    this.goodStreak = 0;
    this.frozenUntilMs = Number.NEGATIVE_INFINITY;
    this.cooldownUntilMs = Number.NEGATIVE_INFINITY;
    this.lastDescentMs = Number.NEGATIVE_INFINITY;
    this.lastFrameMs = 0;
    this.medianMs = 0;
  }
}
