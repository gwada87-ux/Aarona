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
import { LaserTunnelScene, LASER_TUNNEL_VARIANTS } from './LaserTunnelScene';
import { Mandala32Scene, MANDALA32_VARIANTS } from './Mandala32Scene';
import { TypeSlamScene, TYPE_SLAM_VARIANTS } from './TypeSlamScene';
import { NoteHelixScene, NOTE_HELIX_VARIANTS } from './NoteHelixScene';

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
  Object.freeze({
    id: 'laser-tunnel',
    tags: Object.freeze(['neon', 'intense', 'strobe'] as const),
    intensityRange: Object.freeze([0.55, 1] as const),
    variants: LASER_TUNNEL_VARIANTS,
    reducedMotionSafe: false,
    create: (): LiveScene => new LaserTunnelScene(),
  }),
  Object.freeze({
    id: 'mandala-32',
    tags: Object.freeze(['geometric'] as const),
    intensityRange: Object.freeze([0.3, 0.85] as const),
    variants: MANDALA32_VARIANTS,
    // §4.2 : « oui (amplitudes / 2) ». La seule scene ou le prompt precise le
    // traitement en mouvement reduit plutot que de l'exclure.
    reducedMotionSafe: true,
    create: (): LiveScene => new Mandala32Scene(),
  }),
  /**
   * ADR-015 lot 3 — la scene vitrine du chantier melodie/accords. Ajoutee
   * APRES la passe 1 de §4.2 : les six scenes de cette table sont inchangees,
   * celle-ci vient d'un mandat posterieur. Le registre etait concu pour ca
   * (« ajouter une scene = ajouter une entree ici »).
   */
  Object.freeze({
    id: 'note-helix',
    tags: Object.freeze(['geometric', 'calm'] as const),
    intensityRange: Object.freeze([0.2, 0.8] as const),
    variants: NOTE_HELIX_VARIANTS,
    // Aucun stroboscope, aucune secousse : la derive de l'helice est lente et
    // les amplitudes sont deja divisees en mouvement reduit.
    reducedMotionSafe: true,
    create: (): LiveScene => new NoteHelixScene(),
  }),
  Object.freeze({
    id: 'type-slam',
    tags: Object.freeze(['glitch', 'intense', 'strobe'] as const),
    intensityRange: Object.freeze([0.55, 1] as const),
    variants: TYPE_SLAM_VARIANTS,
    reducedMotionSafe: false,
    create: (): LiveScene => new TypeSlamScene(),
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

export { GridHorizonScene, CurlFlowScene, SliceDisplaceScene, LaserTunnelScene, Mandala32Scene, TypeSlamScene, NoteHelixScene };
export { WitnessScene } from './WitnessScene';
