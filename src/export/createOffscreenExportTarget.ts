import { createRenderer, disposeRenderer } from '../render/createRenderer';
import type { RendererOverride } from '../render/backendChoice';
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
 *
 * Depuis le lot 3 d'ADR-013, l'export utilise le MÊME backend que l'aperçu
 * (`createRenderer`, `override` transmis depuis `ui/`). Ce n'est pas un
 * détail d'implémentation : si l'aperçu rendait en HDR et l'export en
 * Canvas 2D, l'aperçu MENTIRAIT sur le fichier livré, et le critère golden
 * « preview ≡ export » comparerait deux rasterizers différents — ce
 * qu'ADR-013 exclut explicitement (« sur le MÊME backend »).
 *
 * `dispose()` est à appeler quand l'export est terminé (succès, échec ou
 * annulation) : il rend le contexte WebGL, dont le nombre est borné par le
 * navigateur — voir `createRenderer.ts::disposeRenderer`.
 */
export function createOffscreenExportTarget(
  width: number,
  height: number,
  reducedFlashing: boolean,
  rendererOverride?: RendererOverride,
): { readonly target: ExportTarget; readonly canvas: OffscreenCanvas; readonly dispose: () => void } {
  const canvas = new OffscreenCanvas(width, height);
  const renderer = createRenderer(canvas, rendererOverride);
  const flashLimiter = new FlashLimiter(canvas, reducedFlashing ? REDUCED_FLASHING_MODE : NORMAL_MODE);
  // Zone sûre (§7.4) : jusqu'ici toujours nulle, y compris sur les formats
  // verticaux, où TikTok/Reels/Shorts recouvrent le bas et la droite du cadre
  // de leur propre interface.
  const viewport = createViewport(width / height, safeAreaFor(width, height));

  return {
    canvas,
    dispose: () => disposeRenderer(renderer),
    target: {
      renderer,
      viewport,
      applyFlashLimiter: (t: number) => flashLimiter.apply(t),
    },
  };
}
