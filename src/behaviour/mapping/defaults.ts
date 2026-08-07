import type { MappingSchema } from './MappingSchema';

/**
 * Table de câblage par défaut — copie fidèle de l'exemple JSON de
 * docs/07_VISUAL_ENGINE.md §"Table de câblage (mapping)", plus `sectionShift`
 * (même famille Impulse ; decay 1,2 s donné dans le tableau des temps de
 * décroissance par défaut du même document, absent de l'exemple JSON lui-même).
 *
 * `pulse`/`barPulse` n'apparaissent PAS ici : ce sont des fonctions directes
 * de `StepContext.beat.phase`/`bar.phase`, calculées sans passer par la
 * table de câblage (voir BehaviourEngine.ts). `density`, `release`, `chaos`
 * n'y figurent pas non plus — aucune formule ni durée n'est spécifiée dans
 * la documentation pour ces trois signaux (voir JOURNAL.md, Étape 8).
 */
export const defaultMapping: MappingSchema = Object.freeze({
  impact: { from: ['KICK'], gain: 1.0, decay: 0.12 },
  subImpact: { from: ['SUB_HIT'], gain: 0.9, decay: 0.45 },
  accent: { from: ['SNARE', 'CLAP'], gain: 0.85, decay: 0.18 },
  tick: { from: ['HAT', 'PERC'], gain: 0.4, decay: 0.06 },
  sectionShift: { from: ['SECTION'], gain: 1.0, decay: 1.2 },
  drive: { from: 'feature:energy', rise: 0.08, fall: 0.55 },
  weight: { from: 'feature:band.sub', rise: 0.05, fall: 0.3 },
  brightness: { from: 'feature:centroid', rise: 0.2, fall: 0.4 },
  tension: { from: 'anticipate:DROP', window: 4.0, curve: 'easeInQuad' },

  // Quatre LFO par défaut (§7.1, chantier 2). Périodes volontairement PREMIÈRES
  // entre elles — 1, 2, 4 et 0,5 mesure avec un décalage de phase sur le
  // dernier : des périodes multiples l'une de l'autre se réaligneraient
  // périodiquement, et le mouvement se lirait alors comme une seule oscillation
  // au lieu de quatre indépendantes.
  lfoA: { from: 'lfo:sine', bars: 4 },
  lfoB: { from: 'lfo:triangle', bars: 2, phase: 0.25 },
  lfoC: { from: 'lfo:sine', bars: 1, phase: 0.5 },
  lfoD: { from: 'lfo:random', bars: 0.5 },
});
