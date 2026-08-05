import { Scene } from '../../scene/Scene';
import { DeepVignette } from '../../layers/background/DeepVignette';
import { PerspectiveGrid } from '../../layers/field/PerspectiveGrid';
import { ParticleField } from '../../layers/particles/ParticleField';
import { FrameFeedback } from '../../layers/postfx/FrameFeedback';

/**
 * Style `Field` (docs/07_VISUAL_ENGINE.md §"Field — champ de particules") :
 * « espace profond, mouvement continu, réaction en gerbes ». Le style
 * « impressionnant ».
 *
 * Pas de couche `Glow` séparée : `ParticleField` dessine déjà chaque
 * particule en sprite additif dont la taille dépend de sa vitesse — c'est
 * exactement ce que ferait une couche Glow dédiée (docs/07 : « additif par
 * sprite, taille ∝ vitesse de la particule »). Une couche séparée aurait
 * dupliqué le même rendu pour un second passage sur 2500 sprites, sans rien
 * ajouter visuellement.
 *
 * `usesFeedback` (second argument de `Scene`) : seul style du MVP à avoir
 * besoin du buffer de trainée (docs/JOURNAL.md, Étape 11) — `true` par
 * défaut si omis (comportement inchangé depuis P9).
 *
 * `maxParticles`/`feedbackEnabled` (Étape 16/P14, Étape 22) : transmis tels
 * quels — voir le constructeur de `ParticleField` pour la valeur par défaut
 * du premier. Permettent au niveau de qualité courant (câblé dans
 * `ui/App.ts`) de plafonner le pool et d'activer/désactiver la traînée sans
 * que ce fichier ait besoin de connaître `perf/qualityLevels.ts`. La couche
 * `FrameFeedback` reste toujours présente dans la liste : quand
 * `usesFeedback` est faux, `Scene.draw()` n'appelle jamais
 * `captureFeedback()`, donc `feedbackBuffer` (`Canvas2DRenderer`) reste
 * `null` et `drawFeedback()` — appelé par `FrameFeedback.draw()` à chaque
 * image — reste un no-op permanent (voir son commentaire). Retirer la
 * couche serait donc redondant, pas nécessaire pour désactiver l'effet.
 */
export function createFieldStyle(maxParticles?: number, feedbackEnabled = true): Scene {
  return new Scene(
    [new FrameFeedback(), new DeepVignette(), new PerspectiveGrid(), new ParticleField(maxParticles)],
    feedbackEnabled,
  );
}
