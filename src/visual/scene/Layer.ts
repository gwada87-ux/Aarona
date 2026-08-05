import type { Renderer } from '../../render/Renderer';
import type { Viewport } from '../../render/Viewport';
import type { StepContext } from '../../music/StepContext';
import type { VisualSignals } from '../../behaviour/BehaviourEngine';
import type { Palette } from '../palette/Palette';

/**
 * Familles de docs/07_VISUAL_ENGINE.md §"Familles de couches" — celles
 * utilisées par Pulse (P7), Field et Spectrum Pro (P9). `text`/`overlay`
 * restent hors périmètre, attendent P12.
 */
export type LayerKind = 'background' | 'geometry' | 'waveform' | 'glow' | 'postfx' | 'field' | 'particles' | 'spectrum';

/** Sérialisable, animable (docs/02) — chaque couche interprète ses propres clés. */
export type LayerParams = Readonly<Record<string, number | string | boolean>>;

export interface LayerInitContext {
  readonly renderer: Renderer;
  readonly palette: Palette;
}

/**
 * Contrat d'une couche (docs/02_ARCHITECTURE.md §4, docs/07_VISUAL_ENGINE.md
 * §"Contrat d'une couche"). `update`/`draw` sont strictement séparés : en
 * rattrapage de seek, `update` peut être appelé plusieurs fois pour un seul
 * `draw`.
 */
export interface Layer {
  readonly id: string;
  readonly kind: LayerKind;
  /**
   * `true` pour les couches à état de FRAMEBUFFER (dépendent de ce qui a été
   * DESSINÉ, pas seulement simulé) — aucune couche de Pulse n'en a besoin :
   * toutes reconstruisent leur état par `update()` seul. Premier cas réel :
   * le feedback de `Field`, P9.
   */
  readonly needsDrawPriming: boolean;
  params: LayerParams;

  init(ctx: LayerInitContext): void;
  update(step: StepContext, signals: VisualSignals): void;
  draw(renderer: Renderer, viewport: Viewport): void;
  reset(t: number): void;
  dispose(): void;

  /**
   * Statistiques du pool de particules, pour le panneau debug
   * (docs/10_PERFORMANCE.md §"Le moniteur de performance", ligne
   * "Particules"). Optionnelle : seules les couches à pool de particules
   * l'implémentent (`ParticleField`, Étape 16/P14) — laissée `undefined`
   * ailleurs plutôt que forcée à un `{ live: 0, capacity: 0 }` trompeur.
   */
  particleStats?(): { readonly live: number; readonly capacity: number };
}
