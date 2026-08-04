import { Scene } from '../../scene/Scene';
import { RadialBackground } from '../../layers/background/RadialBackground';
import { PulseRings } from '../../layers/geometry/PulseRings';
import { CircularWaveform } from '../../layers/waveform/CircularWaveform';
import { CentralGlow } from '../../layers/glow/CentralGlow';
import { ScreenShake } from '../../layers/postfx/ScreenShake';

/**
 * Style `Pulse` (docs/07_VISUAL_ENGINE.md §"Pulse — géométrie réactive") :
 * « formes primaires concentriques, sobre, percussif, lisible ». Premier
 * style complet du MVP (docs/00b §4).
 *
 * `ScreenShake` en tête du tableau : c'est une couche PostFx qui modifie un
 * décalage global affectant tout ce qui est dessiné APRÈS elle dans la même
 * frame (voir Renderer.applyShake) — l'ordre conceptuel de docs/07
 * (Background/Geometry/Waveform/Glow/PostFx) décrit les RESPONSABILITÉS de
 * chaque couche, pas l'ordre d'exécution requis pour un effet global.
 */
export function createPulseStyle(): Scene {
  return new Scene([new ScreenShake(), new RadialBackground(), new PulseRings(), new CircularWaveform(), new CentralGlow()]);
}
