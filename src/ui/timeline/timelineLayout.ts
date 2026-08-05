/**
 * Maths pures de la timeline (Étape 14/P12) — conversions temps↔pixel,
 * ré-échantillonnage des pics de waveform à la largeur d'affichage, et mise
 * en rectangles des sections/ticks. Aucun DOM, aucun canvas : testable sans
 * navigateur (contrairement à `Timeline.ts`, qui dessine).
 */
import type { WaveformPeaks } from '../../analysis/waveformPeaks';
import type { Section } from '../../music/pmdi';

export function timeToX(t: number, duration: number, width: number): number {
  if (duration <= 0) return 0;
  return (t / duration) * width;
}

/** Inverse de `timeToX`, bornée à `[0, duration]` — utilisée pour le scrub (clic/glissement → seek). */
export function xToTime(x: number, duration: number, width: number): number {
  if (width <= 0) return 0;
  const t = (x / width) * duration;
  return Math.max(0, Math.min(duration, t));
}

/**
 * Ré-échantillonne les pics min/max de `computeWaveformPeaks` (2048
 * compartiments par défaut) à `width` colonnes de pixels — même méthode
 * min/max par plage que la fonction source, pour ne pas aplatir les crêtes
 * en rétrécissant, ni dupliquer un bruit de compartiment isolé en zoomant.
 */
export function resampleWaveformPeaks(peaks: WaveformPeaks, width: number): { readonly min: Float32Array; readonly max: Float32Array } {
  const columnCount = Math.max(1, Math.floor(width));
  const outMin = new Float32Array(columnCount);
  const outMax = new Float32Array(columnCount);
  if (peaks.bucketCount === 0) return { min: outMin, max: outMax };

  const perColumn = peaks.bucketCount / columnCount;
  for (let x = 0; x < columnCount; x++) {
    const start = Math.floor(x * perColumn);
    const end = Math.max(start + 1, Math.floor((x + 1) * perColumn));
    let mn = Infinity;
    let mx = -Infinity;
    for (let b = start; b < end && b < peaks.bucketCount; b++) {
      const bMin = peaks.min[b]!;
      const bMax = peaks.max[b]!;
      if (bMin < mn) mn = bMin;
      if (bMax > mx) mx = bMax;
    }
    if (mn === Infinity) {
      mn = 0;
      mx = 0;
    }
    outMin[x] = mn;
    outMax[x] = mx;
  }
  return { min: outMin, max: outMax };
}

export interface SectionRect {
  readonly x: number;
  readonly width: number;
  readonly section: Section;
}

export function layoutSections(sections: readonly Section[], duration: number, width: number): readonly SectionRect[] {
  return sections.map((section) => {
    const x = timeToX(section.t, duration, width);
    return { x, width: timeToX(section.t + section.dur, duration, width) - x, section };
  });
}

/** Positions en x d'une liste d'instants (temps forts/mesures) — pour les ticks de la timeline. */
export function layoutTicks(times: readonly number[], duration: number, width: number): readonly number[] {
  return times.map((t) => timeToX(t, duration, width));
}
