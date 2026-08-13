import { Scene } from '../../scene/Scene';
import type { Layer } from '../../scene/Layer';
import { RadialBackground } from '../../layers/background/RadialBackground';
import { PulseRings } from '../../layers/geometry/PulseRings';
import { CircularWaveform } from '../../layers/waveform/CircularWaveform';
import { CentralGlow } from '../../layers/glow/CentralGlow';
import { ScreenShake } from '../../layers/postfx/ScreenShake';
import { TraceMarks } from '../../layers/memory/TraceMarks';
import { TRACE_FIELD_V1 } from '../../memory/TraceField';

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
/**
 * `TraceMarks` (blueprint SSF1, chantier P0 n2) se place JUSTE APRES le fond et
 * avant les anneaux : les empreintes sont gravees dans la surface, tout le
 * reste passe par-dessus. Drapeau `TRACE_FIELD_V1` eteint : la liste redevient
 * exactement celle d'avant ce chantier.
 */
export function createPulseStyle(): Scene {
  // Annote `Layer[]` : sans cela TypeScript infere l'union des classes
  // concretes du litteral, et `splice` refuse d'y inserer autre chose.
  const layers: Layer[] = [new ScreenShake(), new RadialBackground(), new PulseRings(), new CircularWaveform(), new CentralGlow()];
  if (TRACE_FIELD_V1) layers.splice(2, 0, new TraceMarks());
  return new Scene(layers);
}
