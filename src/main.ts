import { Canvas2DRenderer } from './render/canvas2d/Canvas2DRenderer';
import { createViewport } from './render/Viewport';
import type { Color } from './render/Renderer';

/**
 * Harnais de développement P2 — vérification visuelle manuelle de Loi 4 :
 * le même cercle normalisé doit apparaître identique (centré, même
 * proportion du petit côté) en 16:9, 9:16 et 1:1, sans code conditionnel
 * par ratio dans le dessin lui-même (seule la résolution du canvas change).
 */
const RATIOS: Record<string, readonly [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
};

const BACKGROUND: Color = { r: 12, g: 12, b: 16, a: 1 };
const CIRCLE: Color = { r: 255, g: 90, b: 60, a: 1 };
const CIRCLE_RADIUS = 0.3;

const maybeCanvas = document.querySelector<HTMLCanvasElement>('#canvas');
if (!maybeCanvas) {
  throw new Error('main.ts: #canvas introuvable dans index.html');
}
// Type non-nullable explicite : évite la perte de narrowing dans la closure
// de renderAspect (TS ne propage pas le contrôle de flux à travers une
// fonction imbriquée appelée plus tard).
const canvas: HTMLCanvasElement = maybeCanvas;

const renderer = new Canvas2DRenderer(canvas);

function renderAspect(label: string): void {
  const size = RATIOS[label];
  if (!size) return;
  const [width, height] = size;

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${Math.round(width / 2)}px`;
  canvas.style.height = `${Math.round(height / 2)}px`;

  const viewport = createViewport(width / height);
  renderer.beginFrame(viewport);
  renderer.clear(BACKGROUND);
  renderer.fillCircle(0, 0, CIRCLE_RADIUS, CIRCLE);
  renderer.endFrame();

  for (const button of document.querySelectorAll<HTMLButtonElement>('#controls button')) {
    button.setAttribute('aria-pressed', String(button.dataset.aspect === label));
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('#controls button')) {
  button.addEventListener('click', () => {
    const aspect = button.dataset.aspect;
    if (aspect) renderAspect(aspect);
  });
}

renderAspect('16:9');
