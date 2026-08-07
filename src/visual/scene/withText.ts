/**
 * Ajout du texte à n'importe quel style (docs/17_PHASE2_VISUELS.md §9.3,
 * chantier 8).
 *
 * Même raisonnement que `withCover` du chantier 7, et pour la même raison : le
 * texte n'appartient à aucun style. L'écrire dans les huit fabriques obligerait
 * à répéter huit fois la même ligne et à la maintenir sur chaque style ajouté.
 *
 * AU-DESSUS DE LA POCHETTE
 * ------------------------
 * `withCover` puis `withText` : la pochette est une image, le texte est de
 * l'information. Un titre à moitié caché derrière une pochette ne se lit plus,
 * alors qu'une pochette partiellement recouverte par un titre reste une
 * pochette. Quand les deux sont actifs, c'est donc le texte qui passe devant.
 *
 * DEUX FONCTIONS PLUTÔT QU'UNE `withOverlays` GÉNÉRIQUE
 * -----------------------------------------------------
 * Elles se ressemblent, mais elles ne changent pas ensemble : la pochette dépend
 * d'une image importée, le texte d'une chaîne saisie, et chacune se reconstruit
 * pour ses propres raisons. Les fondre en une seule ferait passer les deux états
 * par un même paramètre, et un changement de texte reconstruirait le sprite de
 * la pochette pour rien.
 */

import { TextLayer } from '../layers/text/TextLayer';
import type { TextConfig } from '../text/textConfig';
import { Scene } from './Scene';

/**
 * Rend une NOUVELLE scène augmentée de la couche de texte, ou la scène telle
 * quelle si le texte est vide.
 *
 * Un texte vide ne pose PAS de couche inerte : le coût serait nul à l'image,
 * mais la scène porterait une couche que rien ne justifie, et le panneau debug
 * afficherait une couche `text` sur un projet sans texte.
 */
export function withText(scene: Scene, config: TextConfig): Scene {
  if (config.text.trim().length === 0) return scene;
  if (scene.layers.some((l) => l.id === 'text')) return scene;
  return new Scene([...scene.layers, new TextLayer(config)], scene.usesFeedback);
}
