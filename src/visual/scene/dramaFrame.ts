/**
 * Point d'application UNIQUE de la dramaturgie (chantier 3,
 * docs/17_PHASE2_VISUELS.md §6.2 et §6.4).
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `ui/App.ts` (preview) et `export/ExportPipeline.ts` (export) contiennent deux
 * boucles d'images indépendantes qui font la même chose. À l'Étape 25, les
 * macros de couche avaient été branchées dans la première et oubliées dans la
 * seconde : pendant plusieurs étapes, l'export ne produisait pas la même image
 * que l'aperçu, et personne ne l'a vu. L'Étape 26 a corrigé le trou en
 * extrayant `applyLayerMacrosToScene`, appelée des deux côtés.
 *
 * La dramaturgie présente exactement le même risque, en pire : un morceau
 * exporté sans elle serait plat de bout en bout, ce qui ne saute pas aux yeux
 * sur une vignette. D'où ces deux fonctions, qui remplacent chacune trois
 * lignes recopiées et donnent un seul endroit à changer.
 *
 * Emplacement : `visual/`, seule couche autorisée à importer à la fois
 * `render/` (l'interface `Renderer`) et `behaviour/` (les signaux). `behaviour/`
 * ne peut pas appliquer la caméra lui-même, la règle de dépendance lui
 * interdisant `render/`.
 */

import type { Color, Renderer } from '../../render/Renderer';
import type { Viewport } from '../../render/Viewport';
import type { StepContext } from '../../music/StepContext';
import type { BehaviourEngine } from '../../behaviour/BehaviourEngine';
import type { VisualDirector } from '../../behaviour/VisualDirector';
import type { BlendMode } from './Layer';
import type { Scene } from './Scene';

/**
 * Cadrage fixe venant de l'appelant, indépendant de la dramaturgie.
 *
 * Type STRUCTUREL et non `StyleVariant` : une variante est une notion de
 * preset, et `visual/` n'a pas le droit d'importer `presets/` — ce que
 * `architecture.test.ts` a refusé sur une première version. La contrainte a
 * produit une meilleure signature : ce module n'a besoin que d'un décalage et
 * d'une échelle, pas de savoir d'où ils viennent.
 */
export interface Framing {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: number;
}

/**
 * Un pas de simulation, dramaturgie comprise.
 *
 * L'ordre compte : le budget est calculé AVANT la modulation, et la modulation
 * avant que la scène ne voie quoi que ce soit. Une couche ne sait rien de la
 * dramaturgie — elle réagit aux signaux, qui arrivent déjà dosés.
 */
export function stepSceneWithDrama(
  scene: Scene,
  behaviour: BehaviourEngine,
  director: VisualDirector,
  step: StepContext,
): void {
  const budget = director.update(step);
  scene.update(step, director.modulate(behaviour.update(step), budget));
}

/**
 * Ouverture d'image, caméra comprise.
 *
 * La caméra est posée APRÈS `clear` et AVANT le dessin : `applyShake` est un
 * décalage global qui n'affecte que ce qui vient ensuite. Poser la caméra avant
 * le `clear` décalerait le fond lui-même et laisserait une bande non peinte au
 * bord du cadre.
 *
 * Elle se compose avec le `ScreenShake` du style `pulse`, qui appelle
 * `applyShake` depuis sa couche : les deux transformations s'additionnent, ce
 * qui est le comportement voulu — la secousse est une modulation du cadrage,
 * pas un cadrage concurrent.
 */
export function openFrameWithCamera(
  renderer: Renderer,
  viewport: Viewport,
  clearColor: Color,
  director: VisualDirector,
  framing?: Framing,
): void {
  renderer.beginFrame(viewport);
  renderer.clear(clearColor);
  const { cameraX, cameraY, cameraZoom } = director.budget;
  // La variante décale le point d'intérêt et rapproche ; la dramaturgie ajoute
  // sa dérive et sa poussée par-dessus. Les deux se COMPOSENT : la variante
  // dit d'où on regarde, la dramaturgie ce que le morceau fait au cadre.
  //
  // Les zooms se multiplient plutôt que de s'additionner — deux rapprochements
  // successifs sont un produit d'échelles, pas une somme. Le `Renderer` borne
  // le résultat à [1, 2] de toute façon (ADR-011).
  const dx = cameraX + (framing?.offsetX ?? 0);
  const dy = cameraY + (framing?.offsetY ?? 0);
  const zoom = cameraZoom * (framing?.zoom ?? 1);
  if (dx !== 0 || dy !== 0 || zoom !== 1) renderer.applyCamera(dx, dy, zoom);
}

/**
 * Applique les modes de fusion d'une variante aux couches concernées (§7.2,
 * §7.10). À appeler une fois, après la construction de la scène — pas par
 * image : un mode de fusion est une propriété de couche, pas un état de trame.
 *
 * Remet explicitement à `undefined` les couches que la variante ne mentionne
 * pas. Sans ça, changer de variante laisserait en place les modes de la
 * précédente, et le style dériverait à chaque relance de graine.
 */
export function applyLayerBlends(scene: Scene, blend: Readonly<Record<string, BlendMode>> | undefined): void {
  for (const layer of scene.layers) {
    layer.blend = blend?.[layer.id];
  }
}
