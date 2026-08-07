import { Scene } from '../../scene/Scene';
import { AnimatedDuotone } from '../../layers/background/AnimatedDuotone';
import { DustChamber } from '../../layers/particles/DustChamber';

/**
 * Style `chambre` (docs/17_PHASE2_VISUELS.md §8) — lofi, jazzhop, downtempo.
 * « La texture, pas l'impact. »
 *
 * Pas de feedback : la traînée ajouterait un mouvement là où le parti pris est
 * qu'il n'y en ait presque pas. Les poussières dérivent déjà, et leur dérive
 * est une fonction pure de `t` — donc parfaitement lisse, sans rémanence à
 * simuler.
 *
 * Deux couches, comme `monolith`, mais pour la raison inverse : `monolith` est
 * dépouillé pour que la fissure frappe, `chambre` l'est pour qu'il ne se passe
 * rien de brusque.
 */
export function createChambreStyle(_maxParticles?: number, _feedbackEnabled?: boolean): Scene {
  return new Scene([new AnimatedDuotone(), new DustChamber()], false);
}
