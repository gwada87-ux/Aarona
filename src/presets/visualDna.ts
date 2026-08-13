/**
 * ADN VISUEL — le morceau paramètre le monde (docs/18_BLUEPRINT_VISUELS_2026.md
 * §G, chantier P0 n°1 de la feuille de route §J).
 *
 * LE PROBLÈME QU'IL RÉSOUT
 * -----------------------
 * Constat F1 de l'audit : « un même preset + style rend presque la même chose
 * pour deux morceaux différents ». Les onze presets de genre déclarent des
 * macros FIXES ; deux morceaux de trap partagent donc exactement les mêmes
 * huit curseurs, et seule la graine aléatoire les distingue — c'est-à-dire
 * rien de musical.
 *
 * CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS
 * ----------------------------------------------
 * Il DÉRIVE, à partir du document PMDI seul :
 *   1. huit deltas de macro bornés, à appliquer sur les macros du preset ;
 *   2. une graine de projet, fonction du contenu du morceau.
 *
 * Il ne dessine rien, ne touche à aucune couche, n'ajoute aucun rendu. Le
 * gain est entièrement obtenu par dérivation de paramètres qui EXISTENT
 * déjà (`WIRED_MACRO_CURVES` pour energy/reactivity, `LAYER_MACRO_CURVES`
 * pour les six autres, `variantFor(styleId, seed)` pour le cadrage).
 *
 * LE PRESET RESTE UN PRIOR
 * ------------------------
 * `DNA_MAX_DELTA = 0,20` : le morceau module de +/- 20 points de macro au
 * plus, jamais davantage. Sans cette borne, un morceau très dense ferait
 * ressembler `ambient` à `techno` et le catalogue de genres perdrait son
 * sens. Le genre reste reconnaissable, le morceau se reconnaît dedans.
 *
 * DÉTERMINISME (Loi 1)
 * --------------------
 * Fonction PURE du document : aucune horloge, aucun `Math.random()`. Même
 * morceau -> même ADN -> même graine -> même variante de cadrage -> même
 * monde, en preview comme à l'export. La graine est repliée par `hash()`,
 * le même mélangeur que `StepContext`, sur des valeurs QUANTIFIÉES : un
 * aller-retour JSON du PMDI (sauvegarde de projet, cache IndexedDB) ne doit
 * pas changer la graine par un bit de flottant.
 *
 * POURQUOI DANS `presets/` ET NON DANS `analysis/`
 * ------------------------------------------------
 * Il traduit « propriétés du morceau » en « réglages de preset » — le même
 * travail que `layerMacros.ts` et `styleVariants.ts`, qui vivent ici pour
 * cette raison. `analysis/` n'a pas le droit de connaître les presets
 * (`tests/unit/architecture.test.ts`), et il n'a rien à y gagner.
 */
import { hash } from '../core/rng/hash';
import type { PmdiDocument } from '../music/pmdi';
import { MACRO_NAMES, type MacroName, type PresetMacros } from './schema';

/**
 * Drapeau du chantier. À `false`, `applyVisualDna` renvoie les macros
 * d'entrée TELLES QUELLES et `App.ts` ne touche pas à la graine : la sortie
 * est identique à celle d'avant ce chantier, image par image.
 */
export const VISUAL_DNA_V1 = false; // ETEINT sur signalement d'Aaron (13/08) - voir JOURNAL

/** Amplitude maximale d'un delta de macro. Voir « LE PRESET RESTE UN PRIOR ». */
export const DNA_MAX_DELTA = 0.2;

/**
 * Même référence de normalisation que `suggest.ts` (16 onsets/s = 1,0),
 * recalibrée par la mesure post-phase 2 et documentée là-bas. Réutilisée
 * plutôt que redéfinie : deux échelles de densité divergentes dans le même
 * dossier finiraient par se contredire.
 */
const ONSET_DENSITY_REFERENCE_PER_SEC = 16;

/** Plage de tempo ramenée à 0..1. 60 BPM = 0, 180 BPM = 1 : couvre les onze genres du catalogue. */
const TEMPO_LO_BPM = 60;
const TEMPO_HI_BPM = 180;

/**
 * Écart-type de l'enveloppe d'énergie qui vaut 1,0 sur l'échelle de variance.
 * Une piste normalisée dans [0,1] dont l'énergie oscille de +/- 0,25 autour de
 * sa moyenne est déjà très contrastée (couplets/refrains francs) — au-delà,
 * la distinction cesse d'être perceptible et le critère saturerait.
 */
const ENERGY_STDDEV_REFERENCE = 0.25;

/** Nombre de sections qui vaut 1,0 : au-delà, un morceau n'est pas « plus structuré », il est découpé. */
const SECTION_COUNT_REFERENCE = 10;

/**
 * Traits du morceau, tous ramenés à 0..1 — c'est la seule forme dans laquelle
 * une propriété musicale entre dans une macro. Exposés pour l'affichage et
 * pour les tests : un delta de macro inexplicable serait indéfendable.
 */
export interface DnaTraits {
  /** Tempo, `TEMPO_LO_BPM`..`TEMPO_HI_BPM` ramené à 0..1. */
  readonly tempo: number;
  /** Moyenne de la piste `energy`. 0,5 par défaut si la piste est absente. */
  readonly energy: number;
  /** Écart-type de la piste `energy`, normalisé — le contraste du morceau, pas son niveau. */
  readonly energyVariance: number;
  /** Grave (`band.sub`+`band.bass`) contre médium/aigu (`band.himid`+`band.high`). */
  readonly subDominance: number;
  /** Moyenne de la piste `centroid` (déjà normalisée par `AnalysisPipeline`). */
  readonly brightness: number;
  /** Moyenne de la piste `flatness` : bruité contre tonal. */
  readonly flatness: number;
  /** Événements ponctuels par seconde, normalisés (voir `ONSET_DENSITY_REFERENCE_PER_SEC`). */
  readonly onsetDensity: number;
  /** Nombre de sections, normalisé. */
  readonly structure: number;
}

export interface VisualDna {
  /** Graine de projet dérivée du contenu du morceau (Loi 1). */
  readonly seed: number;
  readonly traits: DnaTraits;
  /** Deltas signés à ajouter aux macros du preset, chacun dans [-`DNA_MAX_DELTA`, +`DNA_MAX_DELTA`]. */
  readonly deltas: Readonly<Record<MacroName, number>>;
  /** Deux ou trois traits saillants, en français, pour le panneau. Vide si le morceau est quelconque. */
  readonly summary: string;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function norm(value: number, lo: number, hi: number): number {
  return clamp01((value - lo) / (hi - lo));
}

function trackData(doc: PmdiDocument, id: string): readonly number[] | null {
  const track = doc.features?.find((f) => f.id === id);
  return track && track.data.length > 0 ? track.data : null;
}

/** Moyenne d'une piste de descripteurs. `fallback` quand la piste manque (Mode B sans analyse spectrale). */
function trackMean(doc: PmdiDocument, id: string, fallback: number): number {
  const data = trackData(doc, id);
  if (!data) return fallback;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]!;
  return sum / data.length;
}

/** Écart-type d'une piste, normalisé par `ENERGY_STDDEV_REFERENCE`. */
function trackSpread(doc: PmdiDocument, id: string, fallback: number): number {
  const data = trackData(doc, id);
  if (!data) return fallback;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]!;
  const mean = sum / data.length;
  let sq = 0;
  for (let i = 0; i < data.length; i++) {
    const d = data[i]! - mean;
    sq += d * d;
  }
  return clamp01(Math.sqrt(sq / data.length) / ENERGY_STDDEV_REFERENCE);
}

/** Grave contre médium/aigu, même calcul que `suggest.ts` étape 2. */
function computeSubDominance(doc: PmdiDocument): number {
  const low = trackMean(doc, 'band.sub', 0) + trackMean(doc, 'band.bass', 0);
  const high = trackMean(doc, 'band.himid', 0) + trackMean(doc, 'band.high', 0);
  const total = low + high;
  return total > 0 ? low / total : 0.5;
}

/** Densité d'événements PONCTUELS (sans `dur` : exclut DROP/BUILDUP/BREAK/SILENCE), comme `suggest.ts` étape 3. */
function computeOnsetDensity(doc: PmdiDocument): number {
  if (doc.audio.duration <= 0) return 0;
  let count = 0;
  for (const e of doc.events) if (e.dur === undefined) count++;
  return clamp01(count / doc.audio.duration / ONSET_DENSITY_REFERENCE_PER_SEC);
}

export function deriveTraits(doc: PmdiDocument): DnaTraits {
  return {
    tempo: norm(doc.tempo.global, TEMPO_LO_BPM, TEMPO_HI_BPM),
    energy: trackMean(doc, 'energy', 0.5),
    energyVariance: trackSpread(doc, 'energy', 0.5),
    subDominance: computeSubDominance(doc),
    brightness: trackMean(doc, 'centroid', 0.5),
    flatness: trackMean(doc, 'flatness', 0.5),
    onsetDensity: computeOnsetDensity(doc),
    structure: clamp01((doc.sections?.length ?? 0) / SECTION_COUNT_REFERENCE),
  };
}

/**
 * Câblage trait -> macro. Une entrée par macro, avec les poids des traits qui
 * la nourrissent (somme des valeurs absolues = 1, pour que le résultat reste
 * une position 0..1 avant centrage). Un poids négatif inverse le trait.
 *
 * Les choix, un par un — aucun n'est arbitraire, tous sont défendables à
 * l'oreille :
 *
 * | macro      | lu depuis                        | pourquoi |
 * |------------|----------------------------------|----------|
 * | energy     | énergie moyenne + densité        | un morceau plein et dense pousse les gains d'impact |
 * | reactivity | densité + tempo                  | plus il y a d'événements par seconde, plus les enveloppes doivent être courtes pour rester lisibles |
 * | density    | densité d'onsets                 | correspondance directe : le nombre de particules/barres suit le nombre de frappes |
 * | movement   | tempo                            | la vitesse du visuel suit celle de la musique, pas son intensité |
 * | depth      | dominance du grave               | le grave est ce qui donne l'échelle ; un morceau sans sub n'a pas de profondeur à montrer |
 * | glow       | brillance (centroïde)            | l'éclat visuel suit l'éclat spectral |
 * | chaos      | platitude + variance d'énergie   | bruité et contrasté = matière instable ; tonal et régulier = matière tenue |
 * | smoothness | densité et tempo, INVERSÉS       | l'antagoniste de `reactivity` : un morceau lent et clairsemé peut se permettre des retombées longues |
 *
 * `structure` n'alimente AUCUNE macro ici, volontairement : le nombre de
 * sections ne décrit pas une texture, il décrit un DÉROULÉ. Sa place est le
 * chantier « mise en scène par section » (blueprint §F3), pas un curseur
 * global qui vaudrait pareil à la minute 1 et à la minute 3. Il est calculé
 * et exposé dès maintenant pour que ce chantier n'ait pas à revenir ici.
 */
const TRAIT_WEIGHTS: Readonly<Record<MacroName, Readonly<Partial<Record<keyof DnaTraits, number>>>>> = Object.freeze({
  energy: Object.freeze({ energy: 0.6, onsetDensity: 0.4 }),
  reactivity: Object.freeze({ onsetDensity: 0.5, tempo: 0.5 }),
  density: Object.freeze({ onsetDensity: 1 }),
  movement: Object.freeze({ tempo: 1 }),
  depth: Object.freeze({ subDominance: 1 }),
  glow: Object.freeze({ brightness: 1 }),
  chaos: Object.freeze({ flatness: 0.5, energyVariance: 0.5 }),
  smoothness: Object.freeze({ onsetDensity: -0.5, tempo: -0.5 }),
});

/**
 * Position 0..1 d'une macro d'après ses traits, puis centrage en delta signé.
 *
 * Un poids négatif lit `1 - trait` : c'est ce qui permet à `smoothness` d'être
 * l'exact opposé de `reactivity` sans table séparée.
 */
export function deriveDeltas(traits: DnaTraits): Readonly<Record<MacroName, number>> {
  const out = {} as Record<MacroName, number>;
  for (const macro of MACRO_NAMES) {
    const weights = TRAIT_WEIGHTS[macro];
    let position = 0;
    for (const [traitName, weight] of Object.entries(weights)) {
      const value = traits[traitName as keyof DnaTraits];
      position += weight! > 0 ? weight! * value : -weight! * (1 - value);
    }
    // `position` est dans 0..1 (somme des |poids| = 1) ; 0,5 = « rien à dire », delta nul.
    out[macro] = (clamp01(position) - 0.5) * 2 * DNA_MAX_DELTA;
  }
  return Object.freeze(out);
}

/**
 * Quantification avant repliement : un aller-retour JSON du PMDI ne doit pas
 * déplacer la graine. Trois décimales suffisent partout (temps en secondes,
 * BPM, confidences) et absorbent les arrondis d'écriture.
 */
function fold(acc: number, x: number): number {
  return hash(acc, Math.round(x * 1000) | 0);
}

function foldText(acc: number, text: string): number {
  let h = acc;
  for (let i = 0; i < text.length; i++) h = hash(h, text.charCodeAt(i));
  return h;
}

/**
 * Graine dérivée du CONTENU du morceau.
 *
 * Repliée sur un condensé plutôt que sur le document entier : replier les
 * dizaines de milliers d'échantillons des pistes de descripteurs coûterait des
 * millisecondes pour aucune discrimination supplémentaire — la durée, le
 * tempo, le nombre d'événements et un échantillon régulier de leurs positions
 * séparent déjà deux morceaux qui n'ont rien à voir.
 *
 * `EVENT_SAMPLE_COUNT` positions réparties sur toute la durée : deux morceaux
 * de même tempo et de même longueur, mais de motifs différents, obtiennent
 * bien deux graines différentes.
 */
const EVENT_SAMPLE_COUNT = 64;

export function deriveSeed(doc: PmdiDocument): number {
  let h = 0x9e3779b9;
  h = fold(h, doc.audio.duration);
  h = fold(h, doc.tempo.global);
  h = fold(h, doc.confidence.grid);
  h = fold(h, doc.events.length);
  h = fold(h, doc.sections?.length ?? 0);
  h = fold(h, doc.notes?.length ?? 0);
  h = fold(h, doc.chords?.length ?? 0);

  const events = doc.events;
  if (events.length > 0) {
    const stride = Math.max(1, Math.floor(events.length / EVENT_SAMPLE_COUNT));
    for (let i = 0; i < events.length; i += stride) {
      const e = events[i]!;
      h = fold(h, e.t);
      h = foldText(h, e.type);
    }
  }
  // `>>> 0` : `hash` renvoie déjà un entier non signé, la conversion garde le
  // contrat de `projectSeed` (entier 32 bits positif) explicite.
  return h >>> 0;
}

/** Deux ou trois traits saillants, en français. Vide quand rien ne dépasse. */
function summarize(traits: DnaTraits): string {
  const parts: string[] = [];
  if (traits.onsetDensity > 0.62) parts.push('très dense');
  else if (traits.onsetDensity < 0.28) parts.push('clairsemé');
  if (traits.subDominance > 0.62) parts.push('grave dominant');
  else if (traits.subDominance < 0.38) parts.push('médium/aigu dominant');
  if (traits.energyVariance > 0.62) parts.push('fort contraste');
  else if (traits.energyVariance < 0.25) parts.push('énergie tenue');
  if (traits.brightness > 0.62) parts.push('brillant');
  return parts.slice(0, 3).join(', ');
}

/**
 * ADN complet d'un morceau. Fonction PURE, ne lit que `doc` — pas de
 * `MusicTimeline`, comme `suggestPreset` (Mode A ou Mode B indifféremment).
 */
export function deriveVisualDna(doc: PmdiDocument): VisualDna {
  const traits = deriveTraits(doc);
  return Object.freeze({
    seed: deriveSeed(doc),
    traits: Object.freeze(traits),
    deltas: deriveDeltas(traits),
    summary: summarize(traits),
  });
}

/**
 * Applique l'ADN sur les macros d'un preset. Le preset est le PRIOR, l'ADN le
 * module dans la limite de `DNA_MAX_DELTA`, le résultat reste dans [0,1] —
 * `validatePreset` refuse toute macro hors bornes, et un curseur d'interface
 * ne va pas au-delà non plus.
 *
 * Drapeau à `false` : renvoie `macros` sans le copier, donc sans le moindre
 * effet de bord possible.
 */
export function applyVisualDna(macros: PresetMacros, dna: VisualDna | null): PresetMacros {
  if (!VISUAL_DNA_V1 || !dna) return macros;
  const out = {} as Record<MacroName, number>;
  for (const name of MACRO_NAMES) out[name] = clamp01(macros[name] + dna.deltas[name]);
  return Object.freeze(out) as PresetMacros;
}
