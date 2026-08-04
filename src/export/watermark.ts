import type { Color, Renderer } from '../render/Renderer';
import type { Viewport } from '../render/Viewport';

/**
 * Watermark — docs/09_EXPORT.md §"Watermark et modèle commercial" (ADR-006) :
 * « appliqué DANS le pipeline de rendu, avant l'encodage ». Un appel de plus
 * dans `ExportPipeline`, entre `scene.draw()` et `flashLimiter.apply()`.
 *
 * Périmètre réduit, documenté : une marque géométrique discrète (point +
 * anneau), pas de typographie — `Renderer.drawText` reste différé (aucune
 * couche `Text` avant P12, voir docs/02). La logique commerciale (clé de
 * licence, plafond 720p en version gratuite) n'est PAS implémentée ici :
 * seul le mécanisme de dessin l'est, gardé par un booléen `watermarked`
 * fourni par l'appelant — voir docs/JOURNAL.md, Étape 10.
 */
const MARK_RADIUS = 0.018;
const MARGIN = 0.03;
const MARK_COLOR: Color = { r: 255, g: 255, b: 255, a: 0.35 };

export function drawWatermark(renderer: Renderer, viewport: Viewport): void {
  const halfW = viewport.aspect >= 1 ? viewport.aspect / 2 : 0.5;
  const halfH = viewport.aspect >= 1 ? 0.5 : 1 / (2 * viewport.aspect);
  const x = halfW - viewport.safe.right - MARGIN - MARK_RADIUS;
  const y = -halfH + viewport.safe.bottom + MARGIN + MARK_RADIUS;

  renderer.fillCircle(x, y, MARK_RADIUS, MARK_COLOR);
  renderer.strokeCircle(x, y, MARK_RADIUS * 1.6, MARK_RADIUS * 0.3, MARK_COLOR);
}
