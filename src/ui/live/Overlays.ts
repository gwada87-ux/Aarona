/**
 * Overlays expressifs (§4.4).
 *
 * DEUX NIVEAUX DISTINCTS, et les confondre est le piege :
 *
 * (a) La FINITION PERMANENTE de §3.4 - grain leger, vignette, halo - est
 *     toujours active et n'est JAMAIS un overlay. Elle ne compte pas dans le
 *     budget, elle ne s'active pas sur frontiere, elle ne se coupe pas.
 * (b) Les OVERLAYS EXPRESSIFS, optionnels, pilotes par le director : scanlines,
 *     aberration forte, cadre, shake, inversion, bandes VHS. Ce module ne gere
 *     que ceux-la.
 *
 * Trois regles qui font la difference entre un moteur VJ et un sapin de Noel :
 *
 * - **Budget** : 1 / 2 / 3 selon l'intensite (§2.8). Bloom fort, aberration
 *   marquee, shake et grain lourd ne sont jamais actifs ensemble.
 * - **Activation et desactivation sur FRONTIERE DE MESURE uniquement**, avec
 *   une duree de vie minimale de 2 mesures. Sans ca, les overlays clignotent
 *   au rythme des fluctuations d'intensite, ce qui est pire que de ne pas en
 *   avoir.
 * - **Exclusions mutuelles** : shake avec `slice-displace` (la scene deplace
 *   deja l'image, un shake par-dessus la rend illisible), aberration forte avec
 *   inversion (l'inversion detruit la lecture des franges), scanlines avec
 *   cadre (deux grilles concurrentes).
 *
 * Classe pure : le temps et le hasard sont des parametres.
 */

import type { LiveDirectorConfig } from './LiveConfig';
import type { EffectBudget } from './IntensityDirector';
import type { BeatClockState } from './audio/BeatClock';

export type OverlayId = 'shake' | 'scanlines' | 'vhs' | 'aberration' | 'frame' | 'invert';

/**
 * ORDRE D'APPLICATION FIXE (§4.4) : shake (camera) -> scanlines -> aberration
 * -> cadre -> inversion -> finition permanente. Sans ordre fixe, le rendu
 * n'est pas reproductible d'une session a l'autre.
 *
 * `vhs` n'est pas dans la liste ordonnee du prompt ; il est place juste apres
 * `scanlines` parce qu'il joue sur le meme registre - une texture de balayage
 * posee sur l'image, avant toute deformation chromatique.
 */
export const OVERLAY_ORDER: readonly OverlayId[] = [
  'shake',
  'scanlines',
  'vhs',
  'aberration',
  'frame',
  'invert',
];

/** Exclusions mutuelles de §4.4, plus celle liee a la scene. */
const EXCLUSIONS: readonly (readonly [OverlayId, OverlayId])[] = [
  ['aberration', 'invert'],
  ['scanlines', 'frame'],
];

/** Scenes avec lesquelles le shake est exclu : elles deplacent deja l'image. */
const SHAKE_EXCLUDED_SCENES: readonly string[] = ['slice-displace'];

/** Intensite minimale a partir de laquelle chaque overlay a du sens. */
const MIN_INTENSITY: Readonly<Record<OverlayId, number>> = {
  shake: 0.45,
  scanlines: 0.2,
  vhs: 0.55,
  aberration: 0.6,
  frame: 0.15,
  invert: 0.8,
};

interface OverlayState {
  active: boolean;
  /** Index de mesure de la derniere bascule. Sert a la duree de vie minimale. */
  sinceBar: number;
}

export class OverlayDirector {
  private readonly state = new Map<OverlayId, OverlayState>();
  private readonly activeList: OverlayId[] = [];
  private lastBarIndex = Number.NEGATIVE_INFINITY;
  /** `true` apres un panic (§4.5) : tous les overlays coupes jusqu'a la prochaine mesure. */
  private panicked = false;

  constructor(private readonly config: LiveDirectorConfig) {
    for (const id of OVERLAY_ORDER) this.state.set(id, { active: false, sinceBar: Number.NEGATIVE_INFINITY });
  }

  /** Overlays actifs, dans l'ORDRE D'APPLICATION. */
  get active(): readonly OverlayId[] {
    return this.activeList;
  }

  isActive(id: OverlayId): boolean {
    return this.state.get(id)?.active ?? false;
  }

  get count(): number {
    return this.activeList.length;
  }

  /** Coupe tout immediatement (touche Echap, §4.5). */
  panic(): void {
    this.panicked = true;
    for (const s of this.state.values()) {
      s.active = false;
      s.sinceBar = Number.NEGATIVE_INFINITY;
    }
    this.activeList.length = 0;
  }

  update(
    beat: BeatClockState,
    budget: EffectBudget,
    intensity: number,
    sceneId: string,
    reducedMotion: boolean,
    rng: () => number,
  ): void {
    // §4.2 : en mouvement reduit, AUCUN overlay hors grain et vignette - or ce
    // sont justement les deux qui ne sont pas des overlays. Donc : aucun.
    if (reducedMotion || budget.grainOnly || budget.overlays <= 0) {
      if (this.activeList.length > 0) this.clearAll();
      return;
    }

    // Rien ne bascule en dehors d'une frontiere de mesure.
    if (beat.barIndex === this.lastBarIndex) return;
    this.lastBarIndex = beat.barIndex;
    this.panicked = false;

    // 1. Retirer ce qui n'a plus lieu d'etre, en respectant la duree de vie.
    for (const id of OVERLAY_ORDER) {
      const s = this.state.get(id);
      if (!s || !s.active) continue;
      const age = beat.barIndex - s.sinceBar;
      if (age < this.config.overlayMinBars) continue;
      if (intensity < MIN_INTENSITY[id] * 0.8) {
        s.active = false;
        s.sinceBar = beat.barIndex;
      }
    }

    // 2. Rabattre sur le budget, en retirant les plus recents d'abord : un
    //    overlay installe depuis longtemps fait partie du plan, un overlay tout
    //    juste arrive ne manque a personne.
    let current = OVERLAY_ORDER.filter((id) => this.state.get(id)?.active === true);
    while (current.length > budget.overlays) {
      let newest: OverlayId | null = null;
      let newestBar = Number.NEGATIVE_INFINITY;
      for (const id of current) {
        const s = this.state.get(id);
        if (!s) continue;
        if (s.sinceBar >= newestBar) {
          newestBar = s.sinceBar;
          newest = id;
        }
      }
      if (!newest) break;
      const s = this.state.get(newest);
      if (s) {
        s.active = false;
        s.sinceBar = beat.barIndex;
      }
      current = current.filter((id) => id !== newest);
    }

    // 3. Ajouter, si le budget le permet et si aucune exclusion ne s'y oppose.
    if (current.length < budget.overlays) {
      const candidates = OVERLAY_ORDER.filter((id) => {
        const s = this.state.get(id);
        if (!s || s.active) return false;
        if (beat.barIndex - s.sinceBar < this.config.overlayMinBars) return false;
        if (intensity < MIN_INTENSITY[id]) return false;
        return this.allowed(id, current, sceneId);
      });
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(rng() * candidates.length) % candidates.length];
        if (pick) {
          const s = this.state.get(pick);
          if (s) {
            s.active = true;
            s.sinceBar = beat.barIndex;
          }
        }
      }
    }

    this.rebuild();
  }

  /** Un overlay est-il compatible avec ceux deja actifs et avec la scene ? */
  private allowed(id: OverlayId, current: readonly OverlayId[], sceneId: string): boolean {
    if (id === 'shake' && SHAKE_EXCLUDED_SCENES.includes(sceneId)) return false;
    for (const [a, b] of EXCLUSIONS) {
      if (id === a && current.includes(b)) return false;
      if (id === b && current.includes(a)) return false;
    }
    return true;
  }

  private rebuild(): void {
    this.activeList.length = 0;
    for (const id of OVERLAY_ORDER) {
      if (this.state.get(id)?.active === true) this.activeList.push(id);
    }
  }

  private clearAll(): void {
    for (const s of this.state.values()) s.active = false;
    this.activeList.length = 0;
  }

  reset(): void {
    for (const s of this.state.values()) {
      s.active = false;
      s.sinceBar = Number.NEGATIVE_INFINITY;
    }
    this.activeList.length = 0;
    this.lastBarIndex = Number.NEGATIVE_INFINITY;
    this.panicked = false;
  }
}
