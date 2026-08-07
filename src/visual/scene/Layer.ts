import type { BlendMode, Renderer } from '../../render/Renderer';

/**
 * Ré-exporté ici : `presets/` en a besoin pour décrire les modes de fusion
 * d'une variante, et la règle de dépendance lui interdit `render/`. Le mode de
 * fusion d'une COUCHE est légitimement une notion de couche.
 */
export type { BlendMode };
import type { Viewport } from '../../render/Viewport';
import type { StepContext } from '../../music/StepContext';
import type { VisualSignals } from '../../behaviour/BehaviourEngine';
import type { Palette } from '../palette/Palette';

/**
 * Familles de docs/07_VISUAL_ENGINE.md §"Familles de couches" — celles
 * utilisées par Pulse (P7), Field et Spectrum Pro (P9).
 *
 * `text` ajouté au chantier 1 de la phase 2 (docs/17_PHASE2_VISUELS.md §9.3) :
 * la valeur existe désormais, mais AUCUNE couche ne la porte encore — la couche
 * de texte est le chantier 8. L'ajouter maintenant évite d'avoir à rouvrir ce
 * fichier au milieu d'un chantier qui n'a rien à voir.
 *
 * `overlay` reste hors périmètre : aucun besoin identifié en phase 2.
 */
export type LayerKind =
  | 'background'
  | 'geometry'
  | 'waveform'
  | 'glow'
  | 'postfx'
  | 'field'
  | 'particles'
  | 'spectrum'
  | 'text';

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
  /**
   * Mode de fusion de la couche (§7.2, chantier 4). ABSENT = comportement
   * historique, inchangé : les tracés composent normalement, les sprites
   * restent additifs.
   *
   * Le déclarer donne un caractère complètement différent à la MÊME géométrie,
   * ce qui en fait la variété la moins chère du moteur. `Scene.draw` le pose
   * avant la couche et le retire après, si bien qu'une couche ne peut pas
   * contaminer la suivante.
   */
  blend?: BlendMode;
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
