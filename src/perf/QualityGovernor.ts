/**
 * Ajustement automatique du niveau de qualité — perf/QualityGovernor
 * (docs/10_PERFORMANCE.md §"QualityGovernor") :
 *
 *   fenêtre glissante de 90 images
 *   p95 > 20 ms pendant 2 s consécutives  → descendre d'un niveau
 *   p95 < 12 ms pendant 8 s consécutives  → remonter d'un niveau (1×/minute max)
 *   le niveau choisi manuellement par l'utilisateur n'est jamais remonté automatiquement
 *
 * Fonction PURE au sens comportemental : ne touche à rien en dehors de son
 * propre état, l'horloge est injectable (`now`) pour des tests déterministes
 * sans dépendre du temps réel.
 */
import { percentile } from '../core/math/percentile';
import { QUALITY_LEVELS, type QualityLevel } from './qualityLevels';

const WINDOW_SIZE = 90;
const DEGRADE_THRESHOLD_MS = 20;
const DEGRADE_HOLD_MS = 2000;
const UPGRADE_THRESHOLD_MS = 12;
const UPGRADE_HOLD_MS = 8000;
const UPGRADE_COOLDOWN_MS = 60_000;

export interface QualityGovernorOptions {
  readonly initialLevel?: QualityLevel;
  /** Horloge injectable (ms) — défaut `performance.now()`. */
  readonly now?: () => number;
}

export type QualityChangeReason = 'degrade' | 'upgrade' | null;

export interface QualityGovernorResult {
  readonly level: QualityLevel;
  readonly changed: boolean;
  /** `null` si `changed` est faux — sinon la raison, pour l'annonce discrète dans l'UI (docs/10). */
  readonly reason: QualityChangeReason;
}

function levelIndex(level: QualityLevel): number {
  return QUALITY_LEVELS.indexOf(level);
}

export class QualityGovernor {
  private level: QualityLevel;
  /**
   * Plafond de remontée automatique = dernier niveau choisi MANUELLEMENT
   * (docs/10 : jamais dépassé tout seul). `initialLevel` est un point de
   * DÉPART, pas un choix manuel de l'utilisateur — tant qu'aucun appel à
   * `setManualLevel` n'a eu lieu, la remontée automatique reste libre
   * jusqu'à "ultra" (rien dans docs/10 ne restreint la remontée avant toute
   * intervention explicite de l'utilisateur ; un bug de conception initial
   * faisait de `initialLevel` un plafond immédiat, empêchant toute remontée
   * sauf à démarrer déjà à "ultra" — trouvé en écrivant les tests, corrigé
   * avant toute vérification navigateur).
   */
  private manualCeiling: QualityLevel = 'ultra';
  private readonly frameTimesMs: number[] = [];
  private badSinceMs: number | null = null;
  private goodSinceMs: number | null = null;
  private lastUpgradeMs: number | null = null;
  private readonly now: () => number;

  constructor(options: QualityGovernorOptions = {}) {
    this.level = options.initialLevel ?? 'high';
    this.now = options.now ?? (() => performance.now());
  }

  get currentLevel(): QualityLevel {
    return this.level;
  }

  /** Choix explicite de l'utilisateur — devient aussi le nouveau plafond de remontée auto, et repart d'un historique propre. */
  setManualLevel(level: QualityLevel): void {
    this.level = level;
    this.manualCeiling = level;
    this.frameTimesMs.length = 0;
    this.badSinceMs = null;
    this.goodSinceMs = null;
  }

  /**
   * Revient en mode automatique à partir de `level` : plafond LEVÉ (remontée
   * libre jusqu'à "ultra", comme à la construction), historique purgé.
   * Distinct de `setManualLevel` (qui plafonne AU niveau donné) — nécessaire
   * pour restaurer un projet marqué qualité "auto" après qu'un plafond
   * manuel ait été posé par un AUTRE projet dans la même session (Étape
   * 16/P14, `ui/App.ts` § restauration de projet).
   */
  resetAuto(level: QualityLevel): void {
    this.level = level;
    this.manualCeiling = 'ultra';
    this.frameTimesMs.length = 0;
    this.badSinceMs = null;
    this.goodSinceMs = null;
  }

  /** Enregistre le temps (ms) d'une image ; retourne le niveau à utiliser pour la suite. */
  recordFrame(frameTimeMs: number): QualityGovernorResult {
    this.frameTimesMs.push(frameTimeMs);
    if (this.frameTimesMs.length > WINDOW_SIZE) this.frameTimesMs.shift();

    if (this.frameTimesMs.length < WINDOW_SIZE) {
      return { level: this.level, changed: false, reason: null };
    }

    const p95 = percentile(this.frameTimesMs, 0.95);
    const t = this.now();

    if (p95 > DEGRADE_THRESHOLD_MS) {
      this.goodSinceMs = null;
      if (this.badSinceMs === null) this.badSinceMs = t;
      if (t - this.badSinceMs >= DEGRADE_HOLD_MS && levelIndex(this.level) > 0) {
        this.level = QUALITY_LEVELS[levelIndex(this.level) - 1]!;
        this.badSinceMs = null;
        return { level: this.level, changed: true, reason: 'degrade' };
      }
      return { level: this.level, changed: false, reason: null };
    }

    this.badSinceMs = null;
    if (p95 >= UPGRADE_THRESHOLD_MS) {
      this.goodSinceMs = null;
      return { level: this.level, changed: false, reason: null };
    }

    if (this.goodSinceMs === null) this.goodSinceMs = t;
    const heldLongEnough = t - this.goodSinceMs >= UPGRADE_HOLD_MS;
    const cooldownElapsed = this.lastUpgradeMs === null || t - this.lastUpgradeMs >= UPGRADE_COOLDOWN_MS;
    const belowCeiling = levelIndex(this.level) < levelIndex(this.manualCeiling);

    if (heldLongEnough && cooldownElapsed && belowCeiling) {
      this.level = QUALITY_LEVELS[levelIndex(this.level) + 1]!;
      this.goodSinceMs = null;
      this.lastUpgradeMs = t;
      return { level: this.level, changed: true, reason: 'upgrade' };
    }
    return { level: this.level, changed: false, reason: null };
  }
}
