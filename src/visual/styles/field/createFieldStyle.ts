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
 * `usesFeedback = true` (second argument de `Scene`) : seul style du MVP à
 * avoir besoin du buffer de trainée (docs/JOURNAL.md, Étape 11).
 */
export function createFieldStyle(): Scene {
  return new Scene([new FrameFeedback(), new DeepVignette(), new PerspectiveGrid(), new ParticleField()], true);
}
