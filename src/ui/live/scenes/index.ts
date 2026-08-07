/**
 * Registre des scenes (§4.2 : « le registre doit etre extensible sans rien
 * modifier ailleurs »).
 *
 * Ajouter une scene = ajouter une entree ici. Ni le pipeline, ni le panneau,
 * ni le futur director n'ont a etre touches : ils ne connaissent que
 * `SCENE_REGISTRY` et l'interface `LiveScene`.
 *
 * `reducedMotionSafe` reprend la colonne « reduced-motion » de la table §4.2.
 * En `prefers-reduced-motion`, seules les scenes marquees eligibles sont
 * jouables, et aucune scene taguee `strobe` ne l'est - c'est un invariant
 * verifie par test, pas une convention.
 */

import type { LiveScene, SceneTag } from './types';
import { CurlFlowScene, CURL_FLOW_VARIANTS } from './CurlFlowScene';
import { GridHorizonScene, GRID_HORIZON_VARIANTS } from './GridHorizonScene';
import { SliceDisplaceScene, SLICE_DISPLACE_VARIANTS } from './SliceDisplaceScene';

export interface SceneEntry {
  readonly id: string;
  readonly tags: readonly SceneTag[];
  readonly intensityRange: readonly [number, number];
  /** Nombre de variantes internes. §4.2 en impose 2 a 3 par scene. */
  readonly variants: number;
  /** Jouable en `prefers-reduced-motion` (colonne de la table §4.2). */
  readonly reducedMotionSafe: boolean;
  create(): LiveScene;
}

export const SCENE_REGISTRY: readonly SceneEntry[] = Object.freeze([
  Object.freeze({
    id: 'grid-horizon',
    tags: Object.freeze(['neon', 'geometric', 'calm'] as const),
    intensityRange: Object.freeze([0.15, 0.7] as const),
    variants: GRID_HORIZON_VARIANTS,
    reducedMotionSafe: true,
    create: (): LiveScene => new GridHorizonScene(),
  }),
  Object.freeze({
    id: 'curl-flow',
    tags: Object.freeze(['organic', 'calm'] as const),
    intensityRange: Object.freeze([0.1, 0.75] as const),
    variants: CURL_FLOW_VARIANTS,
    reducedMotionSafe: true,
    create: (): LiveScene => new CurlFlowScene(),
  }),
  Object.freeze({
    id: 'slice-displace',
    tags: Object.freeze(['glitch', 'intense', 'strobe'] as const),
    intensityRange: Object.freeze([0.6, 1] as const),
    variants: SLICE_DISPLACE_VARIANTS,
    reducedMotionSafe: false,
    create: (): LiveScene => new SliceDisplaceScene(),
  }),
]);

/** Entree par identifiant, ou `null`. */
export function sceneById(id: string): SceneEntry | null {
  return SCENE_REGISTRY.find((entry) => entry.id === id) ?? null;
}

/** Scenes jouables dans le mode de mouvement courant. Jamais vide. */
export function playableScenes(reducedMotion: boolean): readonly SceneEntry[] {
  if (!reducedMotion) return SCENE_REGISTRY;
  const safe = SCENE_REGISTRY.filter((entry) => entry.reducedMotionSafe);
  // §8.12 : la liste ne doit jamais etre vide. Si elle l'etait, le mode live
  // n'aurait plus rien a afficher pour un utilisateur qui a justement demande
  // moins de mouvement.
  return safe.length > 0 ? safe : SCENE_REGISTRY.slice(0, 1);
}

export { GridHorizonScene, CurlFlowScene, SliceDisplaceScene };
export { WitnessScene } from './WitnessScene';
