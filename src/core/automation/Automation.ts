/**
 * Automatisation par images-clés (docs/17_PHASE2_VISUELS.md §7.3, chantier 10
 * lot D).
 *
 * §7.3 : « Aujourd'hui tout est automatique : l'utilisateur subit l'analyse. Il
 * ne peut pas dire "à 1:20, monte le glow" ni "ici, coupe tout". »
 *
 * POURQUOI CE MODULE EST SI PETIT
 * -------------------------------
 * « `render(t)` est déjà une fonction pure de `t` (Loi 1). Une courbe
 * d'automatisation EST littéralement `f(t)`. » C'est exact, et c'est pourquoi
 * il n'y a rien d'autre ici qu'une recherche dichotomique et une interpolation
 * linéaire : aucun état de lecture à tenir, aucune position courante à
 * mémoriser, rien à réinitialiser sur un seek. Dans un monteur vidéo, la même
 * fonction demanderait tout cela.
 *
 * POURQUOI DANS `core/`, ET AVEC UNE CIBLE EN CHAÎNE LIBRE
 * --------------------------------------------------------
 * Une cible désigne une macro (`macro:glow`), l'intensité globale ou un
 * paramètre de caméra. Les noms de macros vivent dans `presets/`, que ni
 * `core/` ni `behaviour/` n'ont le droit d'importer — la dépendance va dans
 * l'autre sens. La cible est donc une CHAÎNE LIBRE, vérifiée au point de
 * consommation, exactement comme `EventType` et `FeatureId` le sont déjà.
 *
 * TENUE AUX EXTRÉMITÉS, PAS D'EXTRAPOLATION
 * -----------------------------------------
 * Avant le premier point, la courbe vaut le premier point ; après le dernier,
 * le dernier. Extrapoler la pente donnerait des valeurs hors bornes en fin de
 * morceau, sur une automatisation dont l'utilisateur n'a rien demandé au-delà
 * de ce qu'il a posé.
 */

export interface AutomationPoint {
  /** Instant, en secondes depuis le début du morceau. */
  readonly t: number;
  readonly value: number;
}

export interface AutomationLane {
  /** `macro:<nom>`, `intensity`, `cameraX`, `cameraY` ou `cameraZoom`. */
  readonly target: string;
  /** Points TRIÉS par `t`. `addPoint` s'en charge ; `valueAt` en dépend. */
  readonly points: readonly AutomationPoint[];
}

export type Automation = readonly AutomationLane[];

/** Nombre de points au-delà duquel une piste devient illisible et coûteuse. */
export const MAX_POINTS_PER_LANE = 64;

/**
 * Valeur de la courbe à `t`, ou `null` si la piste est vide.
 *
 * Recherche DICHOTOMIQUE et non linéaire : appelée une fois par piste et par
 * image, elle serait en O(points) sur une courbe de soixante points. Le coût
 * est nul en pratique mais la boucle serait dans le chemin chaud, ce que
 * docs/10 proscrit par principe.
 */
export function valueAt(lane: AutomationLane, t: number): number | null {
  const points = lane.points;
  if (points.length === 0) return null;
  if (t <= points[0]!.t) return points[0]!.value;
  const last = points[points.length - 1]!;
  if (t >= last.t) return last.value;

  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const span = b.t - a.t;
  // Deux points au même instant : on rend le second, ce qui donne une MARCHE.
  // C'est le seul comportement qui ne divise pas par zéro, et il est utile —
  // « ici, coupe tout » de §7.3 est exactement une marche.
  if (span <= 0) return b.value;
  return a.value + (b.value - a.value) * ((t - a.t) / span);
}

/** Valeur de la piste visant `target`, ou `fallback` si elle n'existe pas. */
export function automationValue(automation: Automation, target: string, t: number, fallback: number): number {
  for (const lane of automation) {
    if (lane.target !== target) continue;
    const v = valueAt(lane, t);
    return v ?? fallback;
  }
  return fallback;
}

/** `true` si au moins une piste vise cette cible et porte un point. */
export function hasLane(automation: Automation, target: string): boolean {
  return automation.some((l) => l.target === target && l.points.length > 0);
}

/**
 * Ajoute un point, ou REMPLACE celui qui est à moins de `snap` secondes.
 *
 * Le remplacement plutôt que l'empilement : sans lui, cliquer deux fois au même
 * endroit poserait deux points à des instants presque identiques, et la courbe
 * y ferait une marche que l'utilisateur n'a pas demandée. C'est aussi ce qui
 * permet de corriger un point en recliquant dessus.
 */
export function addPoint(automation: Automation, target: string, point: AutomationPoint, snap = 0.15): Automation {
  const lane = automation.find((l) => l.target === target);
  const kept = (lane?.points ?? []).filter((p) => Math.abs(p.t - point.t) > snap);
  const points = [...kept, point].sort((a, b) => a.t - b.t).slice(0, MAX_POINTS_PER_LANE);
  const next: AutomationLane = { target, points };
  return lane ? automation.map((l) => (l === lane ? next : l)) : [...automation, next];
}

/** Retire le point le plus proche de `t`, s'il est à moins de `snap` secondes. */
export function removePointNear(automation: Automation, target: string, t: number, snap = 0.15): Automation {
  const lane = automation.find((l) => l.target === target);
  if (!lane) return automation;
  const points = lane.points.filter((p) => Math.abs(p.t - t) > snap);
  if (points.length === lane.points.length) return automation;
  // Une piste vidée est RETIRÉE : une piste sans point ne fait rien, et la
  // laisser ferait croire à l'interface qu'une cible est automatisée.
  if (points.length === 0) return automation.filter((l) => l !== lane);
  return automation.map((l) => (l === lane ? { target, points } : l));
}

export function clearLane(automation: Automation, target: string): Automation {
  return automation.filter((l) => l.target !== target);
}

/**
 * Nettoie une automatisation venue d'un projet : cibles vides écartées, points
 * non finis écartés, points triés.
 *
 * `valueAt` suppose les points TRIÉS — c'est ce qui autorise la dichotomie. Un
 * fichier écrit à la main, ou par une version future, ne le garantit pas.
 */
export function normaliseAutomation(value: unknown): Automation {
  if (!Array.isArray(value)) return [];
  const out: AutomationLane[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const lane = raw as { target?: unknown; points?: unknown };
    if (typeof lane.target !== 'string' || lane.target.length === 0) continue;
    if (!Array.isArray(lane.points)) continue;
    const points = lane.points
      .filter((p): p is AutomationPoint =>
        typeof p === 'object' && p !== null &&
        Number.isFinite((p as AutomationPoint).t) && Number.isFinite((p as AutomationPoint).value))
      .map((p) => ({ t: p.t, value: p.value }))
      .sort((a, b) => a.t - b.t)
      .slice(0, MAX_POINTS_PER_LANE);
    if (points.length > 0) out.push({ target: lane.target, points });
  }
  return out;
}
