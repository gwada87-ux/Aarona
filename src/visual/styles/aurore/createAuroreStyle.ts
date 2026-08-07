import { Scene } from '../../scene/Scene';
import { DeepVignette } from '../../layers/background/DeepVignette';
import { AuroraRibbons } from '../../layers/field/AuroraRibbons';

/**
 * Style `aurore` (docs/17_PHASE2_VISUELS.md §8) — ambient, cinematic, chill.
 * « La lenteur assumée. »
 *
 * Pas de feedback : les rubans sont déjà translucides et se recouvrent ; y
 * ajouter une rémanence empâterait l'image au lieu de l'enrichir. Leur
 * continuité vient du bruit simplex, qui évolue lentement et sans à-coup.
 *
 * C'est le style qui PROUVE la Loi 3 — aucun onset ne le pilote, donc il rend
 * exactement la même chose sur un morceau que l'analyse ne comprend pas.
 */
export function createAuroreStyle(_maxParticles?: number, _feedbackEnabled?: boolean): Scene {
  return new Scene([new DeepVignette(), new AuroraRibbons()], false);
}
