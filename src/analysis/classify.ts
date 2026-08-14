/**
 * Classification des onsets — analysis/classify (docs/05_MUSIC_INTELLIGENCE.md
 * §4). Arbre de règles sur l'empreinte spectrale du spectre de DIFFÉRENCE
 * (`OnsetDescriptor`, déjà calculé par le Worker en P4/P10 — voir
 * onsetDescriptors.ts).
 *
 * Fonction PURE `descripteurs × seuils → événements typés`, exécutée sur le
 * THREAD PRINCIPAL, jamais dans le Worker (docs/05 : « le preset est suggéré
 * à partir du résultat de l'analyse — la dépendance serait circulaire »).
 * Effet secondaire recherché : reclasser tout le morceau en < 1ms sans
 * réanalyse quand l'utilisateur change de preset.
 */
import type { EventType, MusicEvent, OnsetDescriptor } from '../music/pmdi';

// Échelles de marge de docs/05 §4 — ratios d'énergie 0,10 · centroïde 200Hz · decay30 60ms · flatness 0,10.
const ENERGY_SCALE = 0.1;
const CENTROID_SCALE = 200;
const DECAY_SCALE = 0.06;
const FLATNESS_SCALE = 0.1;
// Non spécifiée par docs/05 (champ ajouté à cette étape, voir onsetDescriptors.ts) : 1 micro-onset d'écart.
const MICRO_ONSET_SCALE = 1;

export interface KickThresholds {
  readonly bassRatio: number;
  readonly maxCentroid: number;
  readonly maxDecay30: number;
}
export interface SnareLikeThresholds {
  readonly lowmidRatio: number;
  readonly highRatio: number;
  readonly minFlatness: number;
  readonly minDecay30: number;
  readonly maxDecay30: number;
}
export interface ClapThresholds extends SnareLikeThresholds {
  readonly minMicroOnsets: number;
  readonly maxMicroOnsets: number;
}
export interface HatThresholds {
  readonly highRatio: number;
  readonly minCentroid: number;
  readonly maxDecay30: number;
  readonly openDecay30: number;
}
export interface PercThresholds {
  readonly minCentroid: number;
  readonly maxCentroid: number;
}
export interface ClassificationThresholds {
  readonly kick: KickThresholds;
  readonly snare: SnareLikeThresholds;
  readonly clap: ClapThresholds;
  readonly hat: HatThresholds;
  readonly perc: PercThresholds;
}

/** Valeurs par défaut de docs/05 §4 — « points de départ à calibrer sur le corpus », surchargeables par preset (§"Calibration par genre"). */
export const DEFAULT_CLASSIFICATION_THRESHOLDS: ClassificationThresholds = Object.freeze({
  kick: { bassRatio: 0.55, maxCentroid: 250, maxDecay30: 0.22 },
  snare: { lowmidRatio: 0.2, highRatio: 0.25, minFlatness: 0.35, minDecay30: 0.08, maxDecay30: 0.4 },
  clap: {
    lowmidRatio: 0.2,
    highRatio: 0.25,
    minFlatness: 0.35,
    minDecay30: 0.08,
    maxDecay30: 0.4,
    minMicroOnsets: 2,
    maxMicroOnsets: 4,
  },
  hat: { highRatio: 0.45, minCentroid: 5000, maxDecay30: 0.4, openDecay30: 0.12 },
  perc: { minCentroid: 800, maxCentroid: 5000 },
});

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function marginAbove(value: number, threshold: number, scale: number): number {
  return (value - threshold) / scale;
}
function marginBelow(value: number, threshold: number, scale: number): number {
  return (threshold - value) / scale;
}
function marginInRange(value: number, lo: number, hi: number, scale: number): number {
  return Math.min((value - lo) / scale, (hi - value) / scale);
}

interface RuleOutcome {
  readonly type: EventType;
  readonly margin: number;
  readonly meta?: Record<string, number | string | boolean>;
}

function tryKick(d: OnsetDescriptor, th: KickThresholds): RuleOutcome | null {
  const bassEnergy = d.e[0] + d.e[1]; // E_sub + E_bass
  if (!(bassEnergy > th.bassRatio && d.centroid < th.maxCentroid && (d.decaySaturated || d.decay30 < th.maxDecay30))) {
    return null;
  }
  const margins = [marginAbove(bassEnergy, th.bassRatio, ENERGY_SCALE), marginBelow(d.centroid, th.maxCentroid, CENTROID_SCALE)];
  if (!d.decaySaturated) margins.push(marginBelow(d.decay30, th.maxDecay30, DECAY_SCALE));
  return { type: 'KICK', margin: clamp01(Math.min(...margins)) };
}

/** Conditions communes à SNARE et CLAP (« profil de SNARE » — docs/05 §4). */
function snareLikeMargins(d: OnsetDescriptor, th: SnareLikeThresholds): readonly number[] | null {
  const lowmid = d.e[2];
  const highEnergy = d.e[4] + d.e[5]; // E_himid + E_high
  const decayOk = d.decaySaturated || (d.decay30 >= th.minDecay30 && d.decay30 <= th.maxDecay30);
  if (!(lowmid > th.lowmidRatio && highEnergy > th.highRatio && d.flatness > th.minFlatness && decayOk)) return null;

  const margins = [
    marginAbove(lowmid, th.lowmidRatio, ENERGY_SCALE),
    marginAbove(highEnergy, th.highRatio, ENERGY_SCALE),
    marginAbove(d.flatness, th.minFlatness, FLATNESS_SCALE),
  ];
  if (!d.decaySaturated) margins.push(marginInRange(d.decay30, th.minDecay30, th.maxDecay30, DECAY_SCALE));
  return margins;
}

function trySnare(d: OnsetDescriptor, th: SnareLikeThresholds): RuleOutcome | null {
  const margins = snareLikeMargins(d, th);
  if (!margins) return null;
  return { type: 'SNARE', margin: clamp01(Math.min(...margins)) };
}

/** CLAP = profil de SNARE + 2 à 4 micro-onsets espacés de 8-25ms (docs/05 §4). Vérifié AVANT SNARE (plus spécifique). */
function tryClap(d: OnsetDescriptor, th: ClapThresholds): RuleOutcome | null {
  const margins = snareLikeMargins(d, th);
  if (!margins) return null;
  const microCount = d.microOnsetCount ?? 0;
  if (!(microCount >= th.minMicroOnsets && microCount <= th.maxMicroOnsets)) return null;
  const microMargin = marginInRange(microCount, th.minMicroOnsets, th.maxMicroOnsets, MICRO_ONSET_SCALE);
  return { type: 'CLAP', margin: clamp01(Math.min(...margins, microMargin)) };
}

function tryHat(d: OnsetDescriptor, th: HatThresholds): RuleOutcome | null {
  const high = d.e[5]; // E_high
  if (!(high > th.highRatio && d.centroid > th.minCentroid && (d.decaySaturated || d.decay30 < th.maxDecay30))) {
    return null;
  }
  const margins = [marginAbove(high, th.highRatio, ENERGY_SCALE), marginAbove(d.centroid, th.minCentroid, CENTROID_SCALE)];
  if (!d.decaySaturated) margins.push(marginBelow(d.decay30, th.maxDecay30, DECAY_SCALE));
  const open = d.decaySaturated || d.decay30 >= th.openDecay30;
  return { type: 'HAT', margin: clamp01(Math.min(...margins)), meta: { open } };
}

function tryPerc(d: OnsetDescriptor, th: PercThresholds): RuleOutcome | null {
  if (!(d.centroid >= th.minCentroid && d.centroid <= th.maxCentroid)) return null;
  return { type: 'PERC', margin: clamp01(marginInRange(d.centroid, th.minCentroid, th.maxCentroid, CENTROID_SCALE)) };
}

/** Classe un seul onset, ou `null` s'il ne correspond à aucune règle (« rejeté — conservé en debug », docs/05 §4). */
/**
 * FORCE D'UN KICK : SUB + BASS, ET NON LA SEULE BANDE « BASS »
 * (drapeau `KICK_INTENSITY_SUB_V1`, 15/08/2026).
 *
 * LE DEFAUT, TROUVE PAR AARON PUIS REPRODUIT
 * ------------------------------------------
 * « Ça le fait à certains moments mais à d'autres non, pas du tout », puis
 * « 1 kick sur 4 ou 5 marche ». Le geste visuel etait bon : c'est la FORCE des
 * evenements qui etait nulle.
 *
 * La ligne fautive lisait `d.e[1]` — la bande « bass » SEULE — en s'appuyant sur
 * docs/05 (« intensité = E_bass normalisée »). Or un 808 met l'essentiel de son
 * energie dans `d.e[0]`, la bande « sub ». Le code regardait donc a cote de la
 * caisse.
 *
 * Mesure sur un vrai WAV analyse de bout en bout (808 glissando 62->42 Hz,
 * clic d'attaque, charley, caisse, nappe) :
 *
 * ```
 * avant   KICK 19 (force 0,00)   <- des kicks detectes, mais AUCUN visuel
 * ```
 *
 * Force nulle veut dire `fire(0)`, donc anneau immobile, halo immobile,
 * secousse absente. Et cela explique exactement le « 1 sur 4 ou 5 » d'Aaron :
 * seuls les kicks dont l'energie deborde dans la bande « bass » produisaient
 * quelque chose ; un 808 pur ne donnait rien.
 *
 * POURQUOI SUB+BASS, ET PAS AUTRE CHOSE
 * -------------------------------------
 * Parce que c'est EXACTEMENT la grandeur que la regle utilise pour decider
 * qu'il s'agit d'un kick (`tryKick` teste `d.e[0] + d.e[1] > bassRatio`).
 * Juger la presence d'un kick sur sub+bass puis sa force sur bass seule etait
 * une incoherence interne, pas un choix.
 */
export const KICK_INTENSITY_SUB_V1 = true;

function kickIntensity(d: OnsetDescriptor): number {
  // Meme grandeur que celle qui a fait passer la regle (voir `tryKick`).
  return KICK_INTENSITY_SUB_V1 ? d.e[0] + d.e[1] : d.e[1];
}

export function classifyOnset(d: OnsetDescriptor, thresholds: ClassificationThresholds = DEFAULT_CLASSIFICATION_THRESHOLDS): MusicEvent | null {
  // CLAP avant SNARE : règle strictement plus spécifique (même profil + micro-onsets) — un
  // clap qui échouerait sur les micro-onsets doit pouvoir retomber sur SNARE, pas l'inverse.
  const outcome =
    tryKick(d, thresholds.kick) ?? tryClap(d, thresholds.clap) ?? trySnare(d, thresholds.snare) ?? tryHat(d, thresholds.hat) ?? tryPerc(d, thresholds.perc);
  if (!outcome) return null;

  const confidence = Math.min(d.strength, outcome.margin);
  const intensity = outcome.type === 'KICK' ? kickIntensity(d) : d.strength;

  return {
    t: d.t,
    type: outcome.type,
    intensity: clamp01(intensity),
    confidence: clamp01(confidence),
    band: d.band,
    ...(outcome.meta ? { meta: outcome.meta } : {}),
  };
}

export function classifyOnsets(
  descriptors: readonly OnsetDescriptor[],
  thresholds: ClassificationThresholds = DEFAULT_CLASSIFICATION_THRESHOLDS,
): MusicEvent[] {
  const events: MusicEvent[] = [];
  for (const d of descriptors) {
    const event = classifyOnset(d, thresholds);
    if (event) events.push(event);
  }
  return events;
}
