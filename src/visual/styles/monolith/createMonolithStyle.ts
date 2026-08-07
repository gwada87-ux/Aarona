import { Scene } from '../../scene/Scene';
import { DeepVignette } from '../../layers/background/DeepVignette';
import { MonolithMass } from '../../layers/geometry/MonolithMass';

/**
 * Style `monolith` (docs/17_PHASE2_VISUELS.md §8) — trap, drill, phonk.
 * « La masse et le silence » : presque immobile, puis violent.
 *
 * DEUX COUCHES SEULEMENT, et c'est délibéré. Le trap a d'énormes vides entre
 * les frappes ; tout ce qu'on ajouterait pour « meubler » détruirait le
 * contraste dont la fissure tire son impact. `DeepVignette` fournit le noir
 * profond, `MonolithMass` fait tout le reste.
 *
 * Pas de `FrameFeedback` : une traînée adoucirait les arêtes, or c'est leur
 * netteté qui donne son poids à la masse. C'est le seul style du catalogue
 * dont le parti pris est de ne PAS traîner.
 *
 * `maxParticles`/`feedbackEnabled` sont acceptés et ignorés : la signature est
 * imposée par `STYLE_FACTORIES`, et ce style n'a ni particules ni feedback.
 */
export function createMonolithStyle(_maxParticles?: number, _feedbackEnabled?: boolean): Scene {
  return new Scene([new DeepVignette(), new MonolithMass()], false);
}
