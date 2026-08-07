import { Scene } from '../../scene/Scene';
import { AnimatedDuotone } from '../../layers/background/AnimatedDuotone';
import { IsoGrid } from '../../layers/field/IsoGrid';
import { FrameFeedback } from '../../layers/postfx/FrameFeedback';

/**
 * Style `iso-pulse` (docs/17_PHASE2_VISUELS.md §8) — house, techno, garage.
 * « La régularité EST le plaisir. »
 *
 * `FrameFeedback` EN PREMIER, comme dans `field` : c'est un décalage global qui
 * n'affecte que ce qui est dessiné après lui (voir sa docstring). Ici la
 * traînée n'est pas décorative — elle laisse voir la trace des ondes déjà
 * passées, ce qui rend l'interférence entre ondes lisible au lieu de la
 * réduire à un scintillement.
 *
 * `AnimatedDuotone` plutôt qu'un fond noir : la house n'est pas un genre
 * sombre, et le duotone donne une base colorée sur laquelle la grille se
 * détache sans avoir à être criarde.
 */
export function createIsoPulseStyle(_maxParticles?: number, feedbackEnabled = true): Scene {
  return new Scene([new FrameFeedback(), new AnimatedDuotone(), new IsoGrid()], feedbackEnabled);
}
