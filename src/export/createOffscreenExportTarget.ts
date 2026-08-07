import { Canvas2DRenderer } from '../render/canvas2d/Canvas2DRenderer';
import { createViewport } from '../render/Viewport';
import { safeAreaFor } from '../render/safeArea';
import { FlashLimiter, NORMAL_MODE, REDUCED_FLASHING_MODE } from '../visual/safety/FlashLimiter';
import type { ExportTarget } from './ExportPipeline';

/**
 * Construit un `ExportTarget` réel adossé à un `OffscreenCanvas`
 * (docs/09_EXPORT.md : « canvas hors écran à la résolution cible,
 * indépendant du canvas de preview »). Séparé de `ExportPipeline.ts` pour
 * que celui-ci reste testable sans navigateur (voir son en-tête) — cette
 * fabrique, elle, ne l'est pas (comme `Canvas2DRenderer`/`FlashLimiter`),
 * vérifiée manuellement au navigateur.
 */
export function createOffscreenExportTarget(
  width: number,
  height: number,
  reducedFlashing: boolean,
): { readonly target: ExportTarget; readonly canvas: OffscreenCanvas } {
  const canvas = new OffscreenCanvas(width, height);
  const renderer = new Canvas2DRenderer(canvas);
  const flashLimiter = new FlashLimiter(canvas, reducedFlashing ? REDUCED_FLASHING_MODE : NORMAL_MODE);
  // Zone sûre (§7.4) : jusqu'ici toujours nulle, y compris sur les formats
  // verticaux, où TikTok/Reels/Shorts recouvrent le bas et la droite du cadre
  // de leur propre interface.
  const viewport = createViewport(width / height, safeAreaFor(width, height));

  return {
    canvas,
    target: {
      renderer,
      viewport,
      applyFlashLimiter: (t: number) => flashLimiter.apply(t),
    },
  };
}
