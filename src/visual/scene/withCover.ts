/**
 * Ajout de la pochette à n'importe quel style (docs/17_PHASE2_VISUELS.md §7.5,
 * chantier 7).
 *
 * POURQUOI PAS UNE COUCHE DANS CHAQUE FABRIQUE
 * --------------------------------------------
 * La pochette n'appartient à aucun style : c'est un habillage que l'utilisateur
 * ajoute par-dessus celui qu'il a choisi. L'inscrire dans les huit
 * `create*Style` obligerait à modifier huit fichiers, à répéter huit fois la
 * même ligne, et surtout à la maintenir sur chaque style ajouté ensuite.
 *
 * POURQUOI PAS UN STYLE `cover` DÉDIÉ
 * -----------------------------------
 * Ce serait le format de Specterr — pochette au centre, un seul décor autour —
 * et ça reviendrait à n'offrir la pochette qu'avec UN décor sur huit. Or c'est
 * l'inverse qu'on veut : n'importe quel style, avec ou sans pochette.
 *
 * EN DERNIÈRE POSITION, TOUJOURS
 * ------------------------------
 * `Scene.draw` parcourt les couches dans l'ordre. La pochette doit passer
 * par-dessus le décor, jamais dessous — une pochette à moitié cachée par des
 * particules ne remplit plus sa fonction, qui est d'être lisible.
 */

import { CoverArt } from '../layers/cover/CoverArt';
import { Scene } from './Scene';

/**
 * Rend une NOUVELLE scène augmentée de la couche pochette, ou la scène telle
 * quelle si aucune pochette n'est présente.
 *
 * Une nouvelle instance plutôt qu'une mutation : `Scene.layers` est en lecture
 * seule, et ce n'est pas un détail — l'ordre des couches est une propriété de
 * la scène, pas un état modifiable en cours de lecture. L'appelant reconstruit
 * déjà sa scène quand le style change ; il la reconstruit de même quand la
 * pochette change.
 */
export function withCover(scene: Scene, hasCover: boolean): Scene {
  if (!hasCover) return scene;
  if (scene.layers.some((l) => l.id === 'coverArt')) return scene;
  return new Scene([...scene.layers, new CoverArt()], scene.usesFeedback);
}
