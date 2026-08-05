/**
 * Rattrapage de seek (docs/02_ARCHITECTURE.md §"Traitement du `seek`") :
 *
 *   1. Transport.seek(t)                          — fait par l'appelant, AVANT
 *   2. scene.reset(t) / behaviourEngine.reset(t)   — fait par l'appelant, AVANT
 *   3. rattrapage : N sous-pas de 1/120 s depuis max(t − windowSec, 0)      ← ce module
 *   4. render(t) à résolution pleine               — fait par l'appelant, APRÈS
 *
 * Sans rattrapage, un champ de particules (style Field) apparaît figé
 * pendant la fenêtre de rattrapage après chaque saut — le « saut mort »
 * décrit par docs/02.
 *
 * Écart assumé vis-à-vis de docs/02 : les couches `needsDrawPriming` sont
 * redessinées ici À PLEINE RÉSOLUTION à chaque sous-pas, pas à 0,4× comme
 * suggéré par le document. Le `Viewport` de ce projet ne porte qu'un ratio et
 * une zone de sécurité (`render/Viewport.ts`), aucune dimension en pixels :
 * une résolution réduite exigerait soit un second canvas hors écran dédié
 * (le buffer de feedback capturé dessus serait à la mauvaise résolution pour
 * le rendu plein écran qui suit), soit une manipulation de
 * `canvas.width`/`height` du canvas RÉEL (scintillement visible). Seule
 * `FrameFeedback` (style Field) déclare `needsDrawPriming` aujourd'hui — un
 * seul appel `draw()` par sous-pas, jamais la scène entière — donc le coût
 * reste borné même sans cette optimisation. Voir docs/JOURNAL.md, Étape
 * 14/P12.
 */
import { FIXED_DT } from '../core/time/FixedStep';
import type { BehaviourEngine } from '../behaviour/BehaviourEngine';
import type { StepContextBuilder } from '../music/StepContext';
import type { Renderer } from '../render/Renderer';
import type { Viewport } from '../render/Viewport';
import type { Scene } from '../visual/scene/Scene';

/** Seek « relâché » (clic sur la timeline) — docs/02, tableau des deux fenêtres. */
export const RELEASE_PRIME_WINDOW_SEC = 0.5;
/** Scrub continu (glissement de souris) — fenêtre réduite pour tenir le budget de 40 ms/saut. */
export const SCRUB_PRIME_WINDOW_SEC = 0.15;

export interface PrimeAfterSeekOptions {
  readonly t: number;
  readonly windowSec: number;
  readonly stepper: StepContextBuilder;
  readonly behaviourEngine: BehaviourEngine;
  readonly scene: Scene;
  readonly renderer: Renderer;
  readonly viewport: Viewport;
}

/**
 * Rejoue les sous-pas depuis `max(t − windowSec, 0)` jusqu'à `t` : fait
 * progresser l'état (`StepContext` → `BehaviourEngine` → `Scene.update`) à
 * CHAQUE sous-pas, et ne redessine que les couches à état de framebuffer.
 * L'appelant doit avoir appelé `scene.reset(t)`/`behaviourEngine.reset(t)`
 * avant, et fera le rendu plein écran après (docs/02).
 */
export function primeAfterSeek(options: PrimeAfterSeekOptions): void {
  const { t, windowSec, stepper, behaviourEngine, scene, renderer, viewport } = options;
  const primingLayers = scene.layers.filter((layer) => layer.needsDrawPriming);
  const start = Math.max(0, t - windowSec);
  const stepCount = Math.max(0, Math.round((t - start) / FIXED_DT));

  for (let i = 1; i <= stepCount; i++) {
    const tSub = Math.min(t, start + i * FIXED_DT);
    const step = stepper.build(tSub);
    const signals = behaviourEngine.update(step);
    scene.update(step, signals);
    for (const layer of primingLayers) layer.draw(renderer, viewport);
  }
}
