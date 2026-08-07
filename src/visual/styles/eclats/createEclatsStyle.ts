import { Scene } from '../../scene/Scene';
import { DeepVignette } from '../../layers/background/DeepVignette';
import { ShatterCells } from '../../layers/geometry/ShatterCells';
import { FrameFeedback } from '../../layers/postfx/FrameFeedback';

/**
 * Style `eclats` (docs/17_PHASE2_VISUELS.md §8) — drum & bass, jungle, breakbeat.
 * « La syncope. »
 *
 * `FrameFeedback` EN PREMIER, comme partout : son décalage global n'affecte que
 * ce qui vient après. Ici la rémanence est essentielle — c'est elle qui laisse
 * voir OÙ ÉTAIENT les éclats juste avant, donc qui rend la dislocation lisible
 * au lieu de la réduire à un clignotement. Sur un break à 174 BPM, une caisse
 * claire dure moins de 200 ms : sans traînée, l'œil ne suivrait pas.
 */
export function createEclatsStyle(_maxParticles?: number, feedbackEnabled = true): Scene {
  return new Scene([new FrameFeedback(), new DeepVignette(), new ShatterCells()], feedbackEnabled);
}
