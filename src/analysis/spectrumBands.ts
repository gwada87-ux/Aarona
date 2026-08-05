/**
 * Bandes log-espacées pour un spectre visuel fin (docs/07 §"Spectrum" — 64
 * bandes en échelle logarithmique) — Étape 25. DIFFÉRENT de `bands.ts` : ici
 * pas de frontières sémantiques (sub/bass/lowmid/...), juste un partage
 * uniforme de l'espace log(Hz) en `bandCount` tranches. Réutilise `BinRange`/
 * `bandEnergy` de `bands.ts` (déjà génériques sur n'importe quelle plage de
 * bins), pas de raison de les dupliquer.
 *
 * Calculé UNE SEULE FOIS à la résolution MAXIMALE (`SPECTRUM_BAND_COUNT`,
 * doit correspondre à `perf/qualityLevels.ts::QUALITY_LEVEL_CONFIGS.ultra
 * .spectrumBands` — dupliqué ici comme `BloomConfig` l'est entre `render/`
 * et `perf/`, `analysis/` n'a pas le droit d'importer `perf/`, docs/02).
 * Le regroupement en moins de bandes pour LOW/MEDIUM/HIGH se fait côté
 * visuel (`visual/layers/spectrum/spectrumGrouping.ts`), pas ici — évite de
 * recalculer/stocker 4 résolutions distinctes du même spectrogramme.
 *
 * Coût : parcourt le même `frames` (spectrogramme complet, déjà en mémoire à
 * ce stade du pipeline, voir `AnalysisPipeline.ts`) que `bandEnergyTracks`,
 * juste partitionné en 96 tranches log au lieu de 6 tranches sémantiques —
 * même ORDRE de grandeur de travail total (les bins visités au total sont
 * sensiblement les mêmes, seulement répartis plus finement).
 *
 * Bins partagés à chaque frontière (le bin haut d'une bande == le bin bas de
 * la suivante après arrondi) : même caractéristique déjà présente dans
 * `bandBinRange` (`bands.ts`) pour les 6 bandes sémantiques, dont les
 * frontières Hz sont elles aussi exactement contiguës — pas une régression
 * introduite ici, un comportement hérité et cohérent.
 */

import type { BinRange } from './bands';
import { bandEnergy } from './bands';

/** Résolution maximale calculée — voir le commentaire d'en-tête pour la synchronisation avec qualityLevels.ts. */
export const SPECTRUM_BAND_COUNT = 96;
/** Mêmes bornes que `BAND_RANGES_HZ.sub[0]`/`BAND_RANGES_HZ.high[1]` (bands.ts). */
export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 11000;

/**
 * `bandCount` tranches log-espacées entre `minHz` et `maxHz`, en bins FFT
 * pour `sampleRate`/`windowSize` donnés. Les frontières successives sont
 * exactement contiguës (le haut de la tranche i == le bas de la tranche i+1
 * avant arrondi en bins) — même principe que `bandBinRange`.
 */
export function computeLogSpacedBinRanges(
  bandCount: number,
  sampleRate: number,
  windowSize: number,
  minHz: number = SPECTRUM_MIN_HZ,
  maxHz: number = SPECTRUM_MAX_HZ,
): BinRange[] {
  const binHz = sampleRate / windowSize;
  const maxBin = windowSize / 2;
  const logMin = Math.log(minHz);
  const logMax = Math.log(maxHz);

  const ranges: BinRange[] = [];
  for (let i = 0; i < bandCount; i++) {
    const loHz = Math.exp(logMin + ((logMax - logMin) * i) / bandCount);
    const hiHz = Math.exp(logMin + ((logMax - logMin) * (i + 1)) / bandCount);
    const lo = Math.max(0, Math.round(loHz / binHz));
    const hi = Math.min(maxBin, Math.round(hiHz / binHz));
    ranges.push({ lo, hi: Math.max(lo, hi) });
  }
  return ranges;
}

/** Piste d'énergie par bande log-espacée sur toutes les trames — même forme que `bandEnergyTracks` (bands.ts), indexée par position plutôt que par `BandId`. */
export function computeSpectrumEnergyTracks(frames: readonly Float64Array[], ranges: readonly BinRange[]): Float64Array[] {
  return ranges.map((range) => {
    const track = new Float64Array(frames.length);
    for (let i = 0; i < frames.length; i++) track[i] = bandEnergy(frames[i]!, range);
    return track;
  });
}
