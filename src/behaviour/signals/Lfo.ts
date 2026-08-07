/**
 * LFO verrouillé au tempo (docs/17_PHASE2_VISUELS.md §7.1, chantier 2).
 *
 * Un oscillateur dont la période est comptée en MESURES, pas en secondes : à
 * 90 comme à 140 BPM, un LFO réglé sur « 2 mesures » boucle en deux mesures.
 * C'est le mécanisme central de richesse des logiciels VJ, et il est presque
 * gratuit ici — la valeur est une fonction PURE de la position musicale, donc
 * sans état, sans allocation, et déterministe par construction (Loi 1).
 *
 * Aucune dépendance à `dt` ni à un compteur d'images : la position est lue
 * directement dans le `StepContext`, ce qui rend le résultat identique en
 * preview 60 fps, en scrub et en export.
 */

import { hash } from '../../core/rng/hash';

export type LfoWaveform = 'sine' | 'triangle' | 'saw' | 'square' | 'random';

export const LFO_WAVEFORMS: readonly LfoWaveform[] = ['sine', 'triangle', 'saw', 'square', 'random'];

export function isLfoWaveform(value: string): value is LfoWaveform {
  return (LFO_WAVEFORMS as readonly string[]).includes(value);
}

/**
 * Graine fixe du tirage `random`. Volontairement CONSTANTE et non liée à
 * `projectSeed` : un LFO est un réglage de mouvement, pas une variation
 * aléatoire du projet. Deux lectures du même morceau avec le même mapping
 * doivent donner le même mouvement, y compris après un changement de graine
 * de projet — sinon le bouton « relancer » (§7.9) déplacerait aussi les LFO,
 * ce qui n'est pas ce qu'il annonce.
 */
const LFO_SALT = 0x5ea1f0;

/**
 * Évalue un LFO. Retourne 0..1.
 *
 * @param barPosition position musicale CONTINUE en mesures
 *                    (`bar.index + bar.phase`).
 * @param bars        période en mesures. 0,25 = une noire en 4/4.
 * @param phaseOffset décalage, 0..1 de la période.
 */
export function evaluateLfo(waveform: LfoWaveform, barPosition: number, bars: number, phaseOffset: number): number {
  const period = Math.max(1e-4, bars);
  const raw = barPosition / period + phaseOffset;
  // `wrap01` explicite : `%` en JavaScript garde le signe du dividende, et
  // `barPosition` est négatif avant le premier downbeat sur certains morceaux.
  const phase = raw - Math.floor(raw);

  switch (waveform) {
    case 'sine':
      return (Math.sin(phase * Math.PI * 2) + 1) / 2;
    case 'triangle':
      return phase < 0.5 ? phase * 2 : 2 - phase * 2;
    case 'saw':
      return phase;
    case 'square':
      return phase < 0.5 ? 1 : 0;
    case 'random': {
      // Échantillonné-bloqué : une valeur tirée par période, tenue jusqu'à la
      // suivante. `Math.floor(raw)` est l'index de période — un entier stable,
      // donc un hachage pur suffit. Surtout PAS `step.rng` : consommer un
      // tirage déplacerait tous les tirages suivants, et la Loi 1 interdit
      // qu'un résultat dépende du nombre de tirages déjà consommés.
      return hash(LFO_SALT, Math.floor(raw)) / 0xffffffff;
    }
  }
}
