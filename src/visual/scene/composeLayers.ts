/**
 * Compositeur de couches (docs/17_PHASE2_VISUELS.md §7.7, chantier 10 lot C).
 *
 * « Activer, désactiver et réordonner les couches d'un style. » Trois verbes,
 * dont un est un piège :
 *
 * > **Attention, l'ordre des couches n'est pas cosmétique** : `ScreenShake` doit
 * > être dessinée **en premier** parce que son décalage n'affecte que ce qui
 * > vient après, et `drawFeedback` aussi. L'éditeur doit empêcher les ordres
 * > invalides, ou au minimum les signaler.
 *
 * Il les EMPÊCHE. Une couche marquée `mustDrawFirst` est ramenée en tête quoi
 * qu'en dise la composition, et une composition qui la descendait n'est pas
 * refusée — elle est corrigée, en silence côté moteur et avec une mention côté
 * interface. Refuser aurait obligé l'utilisateur à comprendre une contrainte de
 * pipeline pour déplacer un curseur.
 *
 * POURQUOI PAS DANS `Scene`
 * -------------------------
 * `Scene` est la liste ordonnée finale ; la composition est un CHOIX qui la
 * précède. Les mêmes raisons que `withCover` et `withText` : une fonction qui
 * rend une nouvelle scène, appelée par `ui/App.ts` et par `ExportPipeline`,
 * plutôt qu'un état mutable dont on ne saurait plus quand il s'applique.
 *
 * ORDRE D'APPLICATION : composition D'ABORD, habillages ENSUITE. La pochette et
 * le texte ne sont pas des couches du style ; les faire passer par le
 * compositeur permettrait de les désactiver depuis deux endroits différents,
 * ou pire, de les glisser sous le décor.
 */

import { Scene } from './Scene';
import type { Layer } from './Layer';

/**
 * Choix de l'utilisateur sur les couches d'un style : identifiant → activée.
 * Une couche absente de la table est ACTIVE — une composition vide est donc le
 * style tel que sa fabrique le construit.
 */
export type LayerComposition = Readonly<Record<string, boolean>>;

export interface ComposeResult {
  readonly scene: Scene;
  /** `true` si l'ordre demandé a dû être corrigé (voir `mustDrawFirst`). */
  readonly reordered: boolean;
  /** Couches retirées, dans l'ordre d'origine. Pour l'affichage. */
  readonly disabled: readonly string[];
}

/**
 * Applique une composition à une scène.
 *
 * @param order  ordre voulu, par identifiant. Les couches absentes gardent leur
 *               rang d'origine, à la suite de celles qui sont citées.
 */
export function composeLayers(
  scene: Scene,
  enabled: LayerComposition,
  order: readonly string[] = [],
): ComposeResult {
  const disabled: string[] = [];
  const kept: Layer[] = [];
  for (const layer of scene.layers) {
    if (enabled[layer.id] === false) disabled.push(layer.id);
    else kept.push(layer);
  }

  // Réordonnancement : les couches citées dans `order` d'abord, dans cet ordre ;
  // les autres derrière, dans leur ordre d'origine. Une couche citée mais
  // absente de la scène est ignorée — la composition d'un projet peut venir d'un
  // autre style.
  let arranged = kept;
  if (order.length > 0) {
    const byId = new Map(kept.map((l) => [l.id, l]));
    const cited: Layer[] = [];
    for (const id of order) {
      const layer = byId.get(id);
      if (layer) {
        cited.push(layer);
        byId.delete(id);
      }
    }
    arranged = [...cited, ...kept.filter((l) => byId.has(l.id))];
  }

  // La correction. `filter` deux fois plutôt qu'un tri : un tri stable sur un
  // booléen ferait la même chose, mais se lirait comme une préférence alors que
  // c'est une contrainte.
  const first = arranged.filter((l) => l.mustDrawFirst === true);
  const rest = arranged.filter((l) => l.mustDrawFirst !== true);
  const final = first.length > 0 ? [...first, ...rest] : arranged;
  const reordered = final.some((l, i) => l !== arranged[i]);

  // `usesFeedback` SUIT la couche de feedback : si elle est désactivée, capturer
  // le composite à chaque image coûterait un `drawImage` plein écran pour un
  // buffer que plus personne ne lit.
  const feedbackKept = scene.usesFeedback && !disabled.includes('frameFeedback');

  const inchange = disabled.length === 0 && !reordered && final.length === scene.layers.length && final.every((l, i) => l === scene.layers[i]);
  return {
    scene: inchange ? scene : new Scene(final, feedbackKept),
    reordered,
    disabled,
  };
}
