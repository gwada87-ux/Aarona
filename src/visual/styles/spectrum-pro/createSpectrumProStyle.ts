import { Scene } from '../../scene/Scene';
import { AnimatedDuotone } from '../../layers/background/AnimatedDuotone';
import { SpectrumBars } from '../../layers/spectrum/SpectrumBars';
import { FlatWaveform } from '../../layers/waveform/FlatWaveform';

/**
 * Style `Spectrum Pro` (docs/07_VISUAL_ENGINE.md §"Spectrum Pro — le
 * spectre, mais bien fait") : « le classique, exécuté avec le soin qu'on ne
 * lui accorde jamais ». Périmètre réduit à 6 bandes réelles (voir
 * SpectrumBars.ts) — pas de couche `Text` (titre/artiste, différée à P12).
 *
 * Pas de couche `Glow` séparée : `SpectrumBars` dessine déjà un halo
 * additif par barre (même raisonnement que `Field`, voir createFieldStyle.ts).
 */
export function createSpectrumProStyle(): Scene {
  return new Scene([new AnimatedDuotone(), new SpectrumBars(), new FlatWaveform()]);
}
