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
import type { Scene } from './Scene';

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
 * Elle se compose avec le `ScreenShake` du style `pulse`, qui appelle le même
 * `applyShake` depuis sa couche : deux translations s'additionnent, ce qui est
 * le comportement voulu — la secousse est une modulation du cadrage, pas un
 * cadrage concurrent.
 */
export function openFrameWithCamera(
  renderer: Renderer,
  viewport: Viewport,
  clearColor: Color,
  director: VisualDirector,
): void {
  renderer.beginFrame(viewport);
  renderer.clear(clearColor);
  const { cameraX, cameraY } = director.budget;
  if (cameraX !== 0 || cameraY !== 0) renderer.applyShake(cameraX, cameraY);
}
