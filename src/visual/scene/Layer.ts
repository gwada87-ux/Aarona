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
  | 'text'
  | 'cover';

/**
 * Familles qui n'appartiennent A AUCUN STYLE : elles se posent par-dessus celui
 * qu'on a choisi (`withCover` chantier 7, `withText` chantier 8).
 *
 * La distinction n'est pas cosmetique. Deux fonctions parcourent TOUTES les
 * couches d'une scene et ecrasent leurs champs : `applyLayerMacrosToScene`
 * remplace `params` en entier, `applyLayerBlends` remplace `blend`. Toutes deux
 * travaillent a partir de tables indexees par STYLE. Une couche d'habillage n'y
 * figure par construction jamais, donc elles lui remettraient ses valeurs a
 * vide - le texte redeviendrait additif, et un titre additif sur fond clair
 * s'eclaircit jusqu'au blanc.
 */
export const OVERLAY_KINDS: readonly LayerKind[] = Object.freeze(['cover', 'text']);

/** `true` si la couche est un habillage, pose par-dessus le style. */
export function isOverlayLayer(layer: { readonly kind: LayerKind }): boolean {
  return OVERLAY_KINDS.includes(layer.kind);
}

/** Sérialisable, animable (docs/02) — chaque couche interprète ses propres clés. */
export type LayerParams = Readonly<Record<string, number | string | boolean>>;

/**
 * Image décodée fournie aux couches. `ImageBitmap` plutôt que
 * `HTMLImageElement` : il est déjà décodé — c'est la contrainte de §7.5, « le
 * décodage a lieu AVANT le rendu, jamais pendant » — et il fonctionne aussi
 * bien dans un worker, ce dont le pipeline d'export a besoin.
 */
export type DecodedImage = ImageBitmap;

export interface LayerInitContext {
  readonly renderer: Renderer;
  readonly palette: Palette;
  /**
   * Pochette décodée, si l'utilisateur en a importé une (§7.5, chantier 7).
   * Absente pour toutes les couches sauf `CoverArt`, qui devient inerte quand
   * elle vaut `null`.
   */
  readonly cover?: DecodedImage | null;
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
  /**
   * La couche doit être dessinée EN PREMIER (docs/17 §7.7, chantier 10 lot C).
   *
   * `ScreenShake` et `FrameFeedback` posent l'une un décalage global, l'autre
   * l'image précédente : les deux n'affectent que ce qui vient APRÈS elles.
   * Les descendre dans la pile ne les casse pas visiblement — elles cessent
   * simplement d'agir sur la moitié du décor, ce qui se lit comme « le style a
   * perdu sa secousse » et n'oriente vers rien.
   *
   * §7.7 : « L'éditeur doit empêcher les ordres invalides, ou au minimum les
   * signaler. » Il les empêche, et c'est ce drapeau qui le lui permet — plutôt
   * qu'une liste d'identifiants recopiée dans le compositeur, qui aurait
   * silencieusement raté la prochaine couche de ce genre.
   */
  readonly mustDrawFirst?: boolean;
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
